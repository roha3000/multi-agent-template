/**
 * Hook Debug Logger
 *
 * Centralized logging for debugging parallel session crashes.
 * Logs to a file so we can see what happened before crash.
 */

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'logs', 'hook-debug.log');
const MAX_LOG_SIZE = 1024 * 1024; // 1MB max

// Ensure log directory exists
const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch (e) {
    // Ignore - might be parallel creation
  }
}

// Rotate log if too big
function rotateLogIfNeeded() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size > MAX_LOG_SIZE) {
        const backupPath = LOG_FILE + '.old';
        if (fs.existsSync(backupPath)) {
          fs.unlinkSync(backupPath);
        }
        fs.renameSync(LOG_FILE, backupPath);
      }
    }
  } catch (e) {
    // Ignore rotation errors
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

    // Append to log file
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (e) {
    // Silent fail - don't crash the hook due to logging
  }
}

/**
 * Wrap a hook function with debug logging
 * @param {string} hookName - Name of the hook
 * @param {Function} hookFn - The hook function to wrap
 * @returns {Function} Wrapped function with logging
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

      log(hookName, 'exit', {
        duration: Date.now() - startTime,
        success: true,
        hasResult: !!result
      });

      return result;
    } catch (error) {
      log(hookName, 'error', {
        duration: Date.now() - startTime,
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 3).join(' | ')
      });

      throw error;
    }
  };
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
  wrapHook,
  logFileOp,
  logExit,
  LOG_FILE
};
