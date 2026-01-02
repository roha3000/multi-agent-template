#!/usr/bin/env node
/**
 * SessionEnd Hook - Deregister session from dashboard
 *
 * This hook:
 * 1. Reads Claude session info from stdin (includes session_id and reason)
 * 2. Calls the dashboard API to mark the session as ended
 *
 * Exit reasons provided by Claude:
 * - "clear" - Session cleared with /clear command
 * - "logout" - User logged out
 * - "prompt_input_exit" - User exited while prompt input was visible
 * - "other" - Other exit reasons
 */

const http = require('http');
const path = require('path');

// Debug logging
const debug = require('./hook-debug');
debug.log('session-end', 'load', { pid: process.pid, ppid: process.ppid });

const DASHBOARD_PORT = process.env.DASHBOARD_PORT || 3033;
const DASHBOARD_HOST = process.env.DASHBOARD_HOST || 'localhost';

/**
 * Read JSON input from stdin (Claude provides session info here)
 */
function readStdin() {
  return new Promise((resolve) => {
    let data = '';

    // Set a timeout in case stdin is empty
    const timeout = setTimeout(() => {
      debug.log('session-end', 'stdin-timeout', {});
      resolve(null);
    }, 1000);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      clearTimeout(timeout);
      try {
        const parsed = JSON.parse(data);
        debug.log('session-end', 'stdin-parsed', { keys: Object.keys(parsed), session_id: parsed.session_id, reason: parsed.reason });
        resolve(parsed);
      } catch (e) {
        debug.log('session-end', 'stdin-parse-error', { error: e.message, data: data.substring(0, 100) });
        resolve(null);
      }
    });
    process.stdin.on('error', (err) => {
      clearTimeout(timeout);
      debug.log('session-end', 'stdin-error', { error: err.message });
      resolve(null);
    });

    // Resume stdin in case it's paused
    process.stdin.resume();
  });
}

/**
 * Deregister session from the dashboard
 */
function deregisterFromDashboard(sessionInfo) {
  return new Promise((resolve) => {
    if (!sessionInfo?.session_id) {
      debug.log('session-end', 'no-session-id', {});
      resolve({ success: false, error: 'No session_id provided' });
      return;
    }

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
        try {
          const result = JSON.parse(data);
          debug.log('session-end', 'deregister-success', { found: result.found, sessionId: result.session?.id });
          resolve({ success: true, ...result });
        } catch (e) {
          debug.log('session-end', 'deregister-parse-error', { error: e.message });
          resolve({ success: false, error: 'Parse error' });
        }
      });
    });

    req.on('error', (err) => {
      // Dashboard might not be running - that's OK
      debug.log('session-end', 'deregister-error', { error: err.message });
      resolve({ success: false, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      debug.log('session-end', 'deregister-timeout', {});
      resolve({ success: false, error: 'Timeout' });
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Main entry point
 */
async function main() {
  debug.log('session-end', 'main-start', {});

  // Read session info from stdin
  const sessionInfo = await readStdin();

  // Deregister from dashboard
  const result = await deregisterFromDashboard(sessionInfo);

  debug.log('session-end', 'exit', { result, reason: sessionInfo?.reason });

  // Exit silently - no console output for session end
  process.exit(0);
}

main().catch((err) => {
  debug.log('session-end', 'main-error', { error: err.message });
  // Don't show error to user - session end should be silent
  process.exit(0);
});
