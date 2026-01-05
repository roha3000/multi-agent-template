/**
 * Hook Debug Logger
 *
 * Centralized logging for debugging parallel session crashes.
 * Logs to a file so we can see what happened before crash.
 *
 * Also records hook execution metrics for success/failure rate tracking.
 */

const fs = require('fs');
const path = require('path');

// Lazy-load hook metrics to avoid circular dependencies
let _hookMetrics = null;
function getMetrics() {
  if (_hookMetrics === null) {
    try {
      const { getHookMetrics } = require('../core/hook-metrics');
      _hookMetrics = getHookMetrics();
    } catch (e) {
      // Metrics not available - silent fail
      _hookMetrics = false;
    }
  }
  return _hookMetrics || null;
}

// Primary debug log location (as specified in task requirements)
const LOG_FILE = path.join(__dirname, '..', 'debug', 'hook-debug.log');
// Legacy log location for backward compatibility
const LEGACY_LOG_FILE = path.join(__dirname, '..', 'logs', 'hook-debug.log');
const MAX_LOG_SIZE = 1024 * 1024; // 1MB max
const ENABLE_DUAL_LOGGING = process.env.HOOK_DEBUG_DUAL_LOG === 'true';

// Ensure log directory exists
const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch (e) {
    // Ignore - might be parallel creation
  }
}

// Rotate a specific log file if too big
function rotateLog(logPath) {
  try {
    if (fs.existsSync(logPath)) {
      const stats = fs.statSync(logPath);
      if (stats.size > MAX_LOG_SIZE) {
        const backupPath = logPath + '.old';
        if (fs.existsSync(backupPath)) {
          fs.unlinkSync(backupPath);
        }
        fs.renameSync(logPath, backupPath);
      }
    }
  } catch (e) {
    // Ignore rotation errors
  }
}

// Rotate primary log if too big
function rotateLogIfNeeded() {
  rotateLog(LOG_FILE);
  if (ENABLE_DUAL_LOGGING) {
    rotateLog(LEGACY_LOG_FILE);
  }
}

/**
 * Append log entry to a file
 * @param {string} logPath - Path to log file
 * @param {string} entry - JSON string entry to log
 */
function appendToLog(logPath, entry) {
  try {
    // Ensure directory exists
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(logPath, entry);
  } catch (e) {
    // Silent fail
  }
}

/**
 * Log a debug message with timestamp and process info
 * @param {string} hookName - Name of the hook
 * @param {string} event - Event type (enter, exit, error, etc)
 * @param {Object} data - Additional data to log
 */
function log(hookName, event, data = {}) {
  try {
    rotateLogIfNeeded();

    const entry = {
      ts: new Date().toISOString(),
      pid: process.pid,
      ppid: process.ppid,
      hook: hookName,
      event,
      ...data
    };

    const entryStr = JSON.stringify(entry) + '\n';

    // Append to primary log file
    appendToLog(LOG_FILE, entryStr);

    // Also append to legacy log if dual logging is enabled
    if (ENABLE_DUAL_LOGGING) {
      appendToLog(LEGACY_LOG_FILE, entryStr);
    }
  } catch (e) {
    // Silent fail - don't crash the hook due to logging
  }
}

/**
 * Enhanced session-end specific logging
 * Logs detailed information useful for debugging session-end hook failures
 * @param {string} stage - Stage of session-end processing
 * @param {Object} details - Detailed information to log
 */
function logSessionEnd(stage, details = {}) {
  const enhancedDetails = {
    ...details,
    memory: process.memoryUsage(),
    uptime: process.uptime(),
    env: {
      DASHBOARD_PORT: process.env.DASHBOARD_PORT,
      DASHBOARD_HOST: process.env.DASHBOARD_HOST,
      NODE_ENV: process.env.NODE_ENV
    }
  };
  log('session-end', stage, enhancedDetails);
}

/**
 * Wrap a hook function with debug logging and metrics recording
 * @param {string} hookName - Name of the hook
 * @param {Function} hookFn - The hook function to wrap
 * @returns {Function} Wrapped function with logging and metrics
 */
function wrapHook(hookName, hookFn) {
  return async function wrappedHook(context) {
    const startTime = Date.now();

    log(hookName, 'enter', {
      hasContext: !!context,
      contextKeys: context ? Object.keys(context) : []
    });

    try {
      const result = await hookFn(context);
      const duration = Date.now() - startTime;

      log(hookName, 'exit', {
        duration,
        success: true,
        hasResult: !!result
      });

      // Record success metric
      const metrics = getMetrics();
      if (metrics) {
        metrics.recordSuccess(hookName, duration);
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorCategory = categorizeError(error);

      log(hookName, 'error', {
        duration,
        error: error.message,
        errorCategory,
        stack: error.stack?.split('\n').slice(0, 3).join(' | ')
      });

      // Record failure metric
      const metrics = getMetrics();
      if (metrics) {
        metrics.recordFailure(hookName, errorCategory, duration, { error: error.message });
      }

      throw error;
    }
  };
}

/**
 * Categorize an error for metrics tracking
 * @param {Error} error - The error to categorize
 * @returns {string} Error category
 */
function categorizeError(error) {
  const message = (error.message || '').toLowerCase();

  if (message.includes('timeout') || message.includes('timed out')) {
    return 'timeout';
  }
  if (message.includes('parse') || message.includes('json') || message.includes('syntax')) {
    return 'parse-error';
  }
  if (message.includes('network') || message.includes('econnrefused') || message.includes('enotfound')) {
    return 'network-error';
  }
  if (message.includes('enoent') || message.includes('eacces') || message.includes('file')) {
    return 'file-error';
  }
  if (message.includes('validation') || message.includes('invalid')) {
    return 'validation-error';
  }

  return 'unknown';
}

/**
 * Record a hook execution directly (for hooks that don't use wrapHook)
 * @param {string} hookName - Name of the hook
 * @param {boolean} success - Whether execution succeeded
 * @param {number} durationMs - Execution duration
 * @param {Object} details - Additional details
 */
function recordExecution(hookName, success, durationMs, details = {}) {
  const metrics = getMetrics();
  if (!metrics) return;

  if (success) {
    metrics.recordSuccess(hookName, durationMs, details);
  } else {
    const errorCategory = details.errorCategory || categorizeError({ message: details.error || '' });
    metrics.recordFailure(hookName, errorCategory, durationMs, details);
  }
}

/**
 * Log file system operations for concurrency debugging
 * @param {string} operation - Operation type (read, write, stat, etc)
 * @param {string} filePath - Path being accessed
 * @param {boolean} success - Whether operation succeeded
 */
function logFileOp(operation, filePath, success, error = null) {
  log('fs-operation', operation, {
    path: filePath,
    success,
    error: error?.message
  });
}

/**
 * Log when process is about to exit
 */
function logExit(code) {
  log('process', 'exit', { code });
}

// Log uncaught exceptions in hooks
process.on('uncaughtException', (err) => {
  log('process', 'uncaughtException', {
    error: err.message,
    stack: err.stack?.split('\n').slice(0, 5).join(' | ')
  });
});

process.on('unhandledRejection', (reason) => {
  log('process', 'unhandledRejection', {
    reason: String(reason)
  });
});

module.exports = {
  log,
  logSessionEnd,
  wrapHook,
  logFileOp,
  logExit,
  recordExecution,
  categorizeError,
  getMetrics,
  LOG_FILE,
  LEGACY_LOG_FILE
};
