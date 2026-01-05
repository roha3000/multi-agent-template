#!/usr/bin/env node
/**
 * SessionEnd Hook - Deregister session from dashboard
 *
 * This hook:
 * 1. Reads Claude session info from stdin (includes session_id and reason)
 * 2. Calls the dashboard API to mark the session as ended
 * 3. Implements retry logic with exponential backoff and jitter
 * 4. Falls back to file-based persistence if API is unavailable
 *
 * Exit reasons provided by Claude:
 * - "clear" - Session cleared with /clear command
 * - "logout" - User logged out
 * - "prompt_input_exit" - User exited while prompt input was visible
 * - "other" - Other exit reasons
 *
 * Reliability features:
 * - Exponential backoff retry (3 attempts, 500ms base delay, capped at 4s)
 * - Jitter (±25%) to prevent thundering herd on retries
 * - Error classification (transient, server_error, client_error, network, unknown)
 * - Circuit breaker (opens after 5 consecutive failures, resets after 1 minute)
 * - File-based fallback when HTTP fails (pending-deregistrations directory)
 * - Enhanced diagnostic logging with timing and error details
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

// Debug logging - use enhanced session-end logging with metrics
const debug = require('./hook-debug');
const hookStartTime = Date.now();
debug.logSessionEnd('load', {
  cwd: process.cwd(),
  argv: process.argv.slice(2),
  nodeVersion: process.version
});

// Track hook execution for metrics reporting
let hookSuccess = false;
let hookErrorCategory = null;

const DASHBOARD_PORT = process.env.DASHBOARD_PORT || 3033;
const DASHBOARD_HOST = process.env.DASHBOARD_HOST || 'localhost';

// Fallback directory for pending deregistrations when HTTP fails
const PENDING_DEREGISTER_DIR = path.join(__dirname, '..', 'data', 'pending-deregistrations');

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500; // Base delay between retries (with exponential backoff)
const MAX_BACKOFF_MS = 4000; // Cap on backoff delay

// Circuit breaker state file
const CIRCUIT_STATE_FILE = path.join(__dirname, '..', 'data', 'session-end-circuit.json');

// Circuit breaker configuration
const CIRCUIT_BREAKER = {
  failureThreshold: 5,      // Open circuit after 5 consecutive failures
  resetTimeMs: 60000        // Try again after 1 minute
};

// Error classification for targeted retry strategy
const ErrorType = {
  TRANSIENT: 'transient',       // Retry immediately (connection refused, timeout)
  SERVER_ERROR: 'server_error', // Retry with backoff (5xx errors)
  CLIENT_ERROR: 'client_error', // Don't retry (4xx errors)
  NETWORK: 'network',           // Retry (DNS, socket errors)
  UNKNOWN: 'unknown'            // Retry once
};

/**
 * Classify an error to determine retry strategy
 * @param {Error|string} error - The error to classify
 * @param {number} statusCode - HTTP status code if available
 * @returns {string} ErrorType constant
 */
function classifyError(error, statusCode = null) {
  // HTTP status code classification
  if (statusCode) {
    if (statusCode >= 500) return ErrorType.SERVER_ERROR;
    if (statusCode >= 400) return ErrorType.CLIENT_ERROR;
  }

  const message = (error?.message || error || '').toString().toLowerCase();
  const code = error?.code || '';

  // Connection errors - transient, retry immediately
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EPIPE') {
    return ErrorType.TRANSIENT;
  }

  // Timeout errors - transient
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || message.includes('timeout')) {
    return ErrorType.TRANSIENT;
  }

  // DNS/network errors
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ENETUNREACH') {
    return ErrorType.NETWORK;
  }

  return ErrorType.UNKNOWN;
}

/**
 * Check if error type is retryable
 * @param {string} errorType - ErrorType constant
 * @returns {boolean} Whether the error is retryable
 */
function isRetryableError(errorType) {
  return errorType !== ErrorType.CLIENT_ERROR;
}

/**
 * Delay helper for retry backoff with jitter
 * @param {number} ms - Base milliseconds to wait
 * @returns {Promise<void>}
 */
function delay(ms) {
  // Add jitter (±25%) to prevent thundering herd
  const jitter = ms * 0.25 * (Math.random() * 2 - 1);
  const actualDelay = Math.min(ms + jitter, MAX_BACKOFF_MS);
  return new Promise(resolve => setTimeout(resolve, actualDelay));
}

/**
 * Load circuit breaker state
 * @returns {Object} Circuit state { failures, lastFailure, state }
 */
function loadCircuitState() {
  try {
    if (fs.existsSync(CIRCUIT_STATE_FILE)) {
      const data = fs.readFileSync(CIRCUIT_STATE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    // Ignore read errors, return default state
  }
  return { failures: 0, lastFailure: null, state: 'closed' };
}

/**
 * Save circuit breaker state
 * @param {Object} state - Circuit state to save
 */
function saveCircuitState(state) {
  try {
    const dir = path.dirname(CIRCUIT_STATE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CIRCUIT_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    // Silent fail - don't disrupt session end for circuit state
  }
}

/**
 * Check if circuit breaker allows request
 * @returns {Object} { allowed: boolean, state: string }
 */
function checkCircuit() {
  const circuitState = loadCircuitState();
  const now = Date.now();

  // If circuit is open, check if reset time has passed
  if (circuitState.state === 'open') {
    const timeSinceFailure = now - circuitState.lastFailure;
    if (timeSinceFailure >= CIRCUIT_BREAKER.resetTimeMs) {
      // Move to half-open state
      circuitState.state = 'half-open';
      saveCircuitState(circuitState);
      debug.logSessionEnd('circuit-half-open', {
        elapsed: Date.now() - hookStartTime,
        timeSinceFailure
      });
      return { allowed: true, state: 'half-open' };
    }
    debug.logSessionEnd('circuit-open-blocked', {
      elapsed: Date.now() - hookStartTime,
      failures: circuitState.failures,
      waitRemaining: CIRCUIT_BREAKER.resetTimeMs - timeSinceFailure
    });
    return { allowed: false, state: 'open' };
  }

  return { allowed: true, state: circuitState.state };
}

/**
 * Record circuit breaker failure
 */
function recordCircuitFailure() {
  const circuitState = loadCircuitState();
  circuitState.failures++;
  circuitState.lastFailure = Date.now();

  if (circuitState.failures >= CIRCUIT_BREAKER.failureThreshold) {
    circuitState.state = 'open';
    debug.logSessionEnd('circuit-opened', {
      elapsed: Date.now() - hookStartTime,
      failures: circuitState.failures
    });
  }

  saveCircuitState(circuitState);
}

/**
 * Record circuit breaker success (reset)
 */
function recordCircuitSuccess() {
  const circuitState = { failures: 0, lastFailure: null, state: 'closed' };
  saveCircuitState(circuitState);
}

/**
 * Read JSON input from stdin (Claude provides session info here)
 */
function readStdin() {
  return new Promise((resolve) => {
    let data = '';

    // Set a timeout in case stdin is empty (2s for reliability)
    const timeout = setTimeout(() => {
      debug.logSessionEnd('stdin-timeout', { elapsed: Date.now() - hookStartTime });
      resolve(null);
    }, 2000);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      clearTimeout(timeout);
      try {
        const parsed = JSON.parse(data);
        debug.logSessionEnd('stdin-parsed', {
          elapsed: Date.now() - hookStartTime,
          dataLen: data.length,
          keys: Object.keys(parsed),
          session_id: parsed.session_id,
          reason: parsed.reason
        });
        resolve(parsed);
      } catch (e) {
        debug.logSessionEnd('stdin-parse-error', {
          elapsed: Date.now() - hookStartTime,
          error: e.message,
          dataLen: data.length,
          dataPreview: data.substring(0, 100)
        });
        resolve(null);
      }
    });
    process.stdin.on('error', (err) => {
      clearTimeout(timeout);
      debug.logSessionEnd('stdin-error', {
        elapsed: Date.now() - hookStartTime,
        error: err.message,
        code: err.code
      });
      resolve(null);
    });

    // Resume stdin in case it's paused
    process.stdin.resume();
  });
}

/**
 * Single attempt to deregister session from the dashboard
 * @param {Object} sessionInfo - Session information with session_id and reason
 * @returns {Promise<Object>} Result with success status, error type, and retryability
 */
function deregisterAttempt(sessionInfo) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      claudeSessionId: sessionInfo.session_id,
      reason: sessionInfo.reason || 'unknown'
    });

    const options = {
      hostname: DASHBOARD_HOST,
      port: DASHBOARD_PORT,
      path: '/api/sessions/end-by-claude-id',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 2000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        // Check for HTTP error status codes
        if (res.statusCode >= 400) {
          const errorType = classifyError(null, res.statusCode);
          resolve({
            success: false,
            error: `HTTP ${res.statusCode}`,
            errorType,
            retryable: isRetryableError(errorType),
            statusCode: res.statusCode
          });
          return;
        }

        try {
          const result = JSON.parse(data);
          resolve({ success: true, ...result });
        } catch (e) {
          resolve({
            success: false,
            error: 'Parse error',
            errorType: ErrorType.SERVER_ERROR,
            retryable: true
          });
        }
      });
    });

    req.on('error', (err) => {
      const errorType = classifyError(err);
      resolve({
        success: false,
        error: err.message,
        errorCode: err.code,
        errorType,
        retryable: isRetryableError(errorType)
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        success: false,
        error: 'Timeout',
        errorType: ErrorType.TRANSIENT,
        retryable: true
      });
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Deregister session from the dashboard with retry logic and circuit breaker
 * - Checks circuit breaker before attempting requests
 * - Retries up to MAX_RETRIES times on transient failures with exponential backoff
 * - Records failures/successes to circuit breaker state
 */
async function deregisterFromDashboard(sessionInfo) {
  if (!sessionInfo?.session_id) {
    debug.logSessionEnd('no-session-id', { elapsed: Date.now() - hookStartTime });
    return { success: false, error: 'No session_id provided' };
  }

  // Check circuit breaker before attempting
  const circuit = checkCircuit();
  if (!circuit.allowed) {
    debug.logSessionEnd('circuit-blocked', {
      elapsed: Date.now() - hookStartTime,
      circuitState: circuit.state,
      sessionId: sessionInfo.session_id
    });
    return {
      success: false,
      error: 'Circuit breaker open - dashboard unavailable',
      circuitOpen: true,
      retriesExhausted: true,
      totalAttempts: 0
    };
  }

  let lastResult = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    debug.logSessionEnd('deregister-attempt', {
      elapsed: Date.now() - hookStartTime,
      attempt,
      maxRetries: MAX_RETRIES,
      circuitState: circuit.state,
      sessionId: sessionInfo.session_id
    });

    lastResult = await deregisterAttempt(sessionInfo);

    if (lastResult.success) {
      // Record success to reset circuit breaker
      recordCircuitSuccess();

      debug.logSessionEnd('deregister-success', {
        elapsed: Date.now() - hookStartTime,
        attempt,
        found: lastResult.found,
        sessionId: lastResult.session?.id,
        claudeSessionId: sessionInfo.session_id
      });
      return lastResult;
    }

    // Check if the error is retryable
    if (!lastResult.retryable) {
      debug.logSessionEnd('deregister-non-retryable', {
        elapsed: Date.now() - hookStartTime,
        attempt,
        error: lastResult.error,
        errorType: lastResult.errorType
      });
      return lastResult;
    }

    // Log the failed attempt with error classification
    const nextDelay = attempt < MAX_RETRIES ? RETRY_DELAY_MS * Math.pow(2, attempt - 1) : null;
    debug.logSessionEnd('deregister-retry', {
      elapsed: Date.now() - hookStartTime,
      attempt,
      error: lastResult.error,
      errorType: lastResult.errorType,
      errorCode: lastResult.errorCode,
      nextAttemptIn: nextDelay
    });

    // Wait before retrying (exponential backoff with jitter), but not after the last attempt
    if (attempt < MAX_RETRIES) {
      const backoffDelay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      await delay(backoffDelay);
    }
  }

  // All retries exhausted - record failure for circuit breaker
  recordCircuitFailure();

  debug.logSessionEnd('deregister-exhausted', {
    elapsed: Date.now() - hookStartTime,
    totalAttempts: MAX_RETRIES,
    lastError: lastResult?.error,
    lastErrorType: lastResult?.errorType,
    sessionId: sessionInfo.session_id
  });

  return {
    success: false,
    error: lastResult?.error || 'Max retries exceeded',
    errorType: lastResult?.errorType,
    retriesExhausted: true,
    totalAttempts: MAX_RETRIES
  };
}

/**
 * Write pending deregistration request to file as fallback
 * When HTTP requests fail (dashboard not running, network issues, etc.),
 * this writes the request to a file that the dashboard will process later.
 *
 * @param {Object} sessionInfo - Session information with session_id and reason
 * @param {Object} failureInfo - Information about why HTTP failed
 * @returns {Object} Result with success status
 */
function writePendingDeregistration(sessionInfo, failureInfo) {
  if (!sessionInfo?.session_id) {
    debug.logSessionEnd('fallback-skip-no-id', { elapsed: Date.now() - hookStartTime });
    return { success: false, error: 'No session_id to write' };
  }

  try {
    // Ensure the pending-deregistrations directory exists
    if (!fs.existsSync(PENDING_DEREGISTER_DIR)) {
      fs.mkdirSync(PENDING_DEREGISTER_DIR, { recursive: true });
      debug.logSessionEnd('fallback-dir-created', {
        elapsed: Date.now() - hookStartTime,
        dir: PENDING_DEREGISTER_DIR
      });
    }

    // Create unique filename using timestamp and session ID
    const timestamp = Date.now();
    const safeSessionId = sessionInfo.session_id.replace(/[^a-zA-Z0-9-]/g, '_');
    const filename = `deregister-${timestamp}-${safeSessionId}.json`;
    const filepath = path.join(PENDING_DEREGISTER_DIR, filename);

    // Write the pending deregistration request
    const pendingRequest = {
      claudeSessionId: sessionInfo.session_id,
      reason: sessionInfo.reason || 'unknown',
      createdAt: new Date().toISOString(),
      failureInfo: {
        error: failureInfo.error,
        totalAttempts: failureInfo.totalAttempts || MAX_RETRIES,
        timestamp: new Date().toISOString()
      }
    };

    fs.writeFileSync(filepath, JSON.stringify(pendingRequest, null, 2), 'utf8');

    debug.logSessionEnd('fallback-written', {
      elapsed: Date.now() - hookStartTime,
      filename,
      claudeSessionId: sessionInfo.session_id,
      reason: sessionInfo.reason
    });

    return { success: true, filepath, filename };
  } catch (err) {
    debug.logSessionEnd('fallback-write-error', {
      elapsed: Date.now() - hookStartTime,
      error: err.message,
      sessionId: sessionInfo.session_id
    });
    return { success: false, error: err.message };
  }
}

/**
 * Main entry point
 */
async function main() {
  debug.logSessionEnd('main-start', { elapsed: 0 });

  // Read session info from stdin
  const sessionInfo = await readStdin();

  // Deregister from dashboard
  const result = await deregisterFromDashboard(sessionInfo);

  // Track success/failure for metrics
  let hookSuccess = false;
  let hookErrorCategory = null;

  // If HTTP deregistration failed after all retries (or circuit breaker blocked), write to fallback file
  if (!result.success && (result.retriesExhausted || result.circuitOpen)) {
    debug.logSessionEnd('using-fallback', {
      elapsed: Date.now() - hookStartTime,
      error: result.error,
      errorType: result.errorType,
      circuitOpen: result.circuitOpen || false
    });

    const fallbackResult = writePendingDeregistration(sessionInfo, {
      error: result.error,
      errorType: result.errorType,
      totalAttempts: result.totalAttempts,
      circuitOpen: result.circuitOpen
    });

    // Mark hook as failed for metrics (fallback is backup, still counts as failure)
    hookSuccess = false;
    hookErrorCategory = result.errorType === ErrorType.TRANSIENT ? 'network-error' :
                        result.errorType === ErrorType.SERVER_ERROR ? 'network-error' :
                        result.errorType === ErrorType.NETWORK ? 'network-error' : 'unknown';

    debug.logSessionEnd('exit', {
      elapsed: Date.now() - hookStartTime,
      success: false,
      fallbackUsed: true,
      fallbackSuccess: fallbackResult.success,
      fallbackFile: fallbackResult.filename,
      circuitOpen: result.circuitOpen || false,
      reason: sessionInfo?.reason,
      sessionId: sessionInfo?.session_id
    });
  } else {
    const totalElapsed = Date.now() - hookStartTime;

    // Track success/failure for metrics
    hookSuccess = result.success;
    if (!result.success) {
      hookErrorCategory = result.errorType === ErrorType.TRANSIENT ? 'timeout' :
                          result.errorType === ErrorType.NETWORK ? 'network-error' : 'unknown';
    }

    debug.logSessionEnd('exit', {
      elapsed: totalElapsed,
      success: result.success,
      retriesExhausted: result.retriesExhausted || false,
      totalAttempts: result.totalAttempts,
      error: result.error,
      errorType: result.errorType,
      reason: sessionInfo?.reason,
      sessionId: sessionInfo?.session_id
    });
  }

  // Record hook metrics for success/failure tracking
  const hookDuration = Date.now() - hookStartTime;
  debug.recordExecution('session-end', hookSuccess, hookDuration, {
    errorCategory: hookErrorCategory,
    error: result?.error,
    retriesExhausted: result?.retriesExhausted
  });

  // Exit silently - no console output for session end
  process.exit(0);
}

main().catch((err) => {
  debug.logSessionEnd('main-error', {
    elapsed: Date.now() - hookStartTime,
    error: err.message,
    stack: err.stack?.split('\n').slice(0, 3).join(' | ')
  });
  // Don't show error to user - session end should be silent
  process.exit(0);
});
