#!/usr/bin/env node
/**
 * SessionStart Hook - Register session with dashboard and load project context
 *
 * This hook:
 * 1. Reads Claude session info from stdin
 * 2. Registers the session with the dashboard (so it appears in the UI)
 * 3. Loads and displays task context
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// Debug logging for parallel crash investigation
const debug = require('./hook-debug');
debug.log('session-start', 'load', { pid: process.pid, ppid: process.ppid });

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const TASKS_JSON = path.join(PROJECT_ROOT, '.claude/dev-docs/tasks.json');
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
      debug.log('session-start', 'stdin-timeout', {});
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
        debug.log('session-start', 'stdin-parsed', { keys: Object.keys(parsed), source: parsed.source });
        resolve(parsed);
      } catch (e) {
        debug.log('session-start', 'stdin-parse-error', { error: e.message, data: data.substring(0, 100) });
        resolve(null);
      }
    });
    process.stdin.on('error', (err) => {
      clearTimeout(timeout);
      debug.log('session-start', 'stdin-error', { error: err.message });
      resolve(null);
    });

    // Resume stdin in case it's paused
    process.stdin.resume();
  });
}

/**
 * Register session with the dashboard
 */
function registerWithDashboard(sessionInfo) {
  return new Promise((resolve) => {
    const projectName = path.basename(sessionInfo?.cwd || PROJECT_ROOT);

    // Detect session type based on source field
    // 'task' = spawned by Task tool (subagent), anything else = CLI session
    const isSubagent = sessionInfo?.source === 'task';
    const sessionType = isSubagent ? 'autonomous' : 'cli';
    debug.log('session-start', 'session-type', { source: sessionInfo?.source, isSubagent, sessionType });

    const payload = JSON.stringify({
      project: projectName,
      path: sessionInfo?.cwd || PROJECT_ROOT,
      status: 'active',
      sessionType: sessionType,
      autonomous: isSubagent,
      claudeSessionId: sessionInfo?.session_id || null
    });

    const options = {
      hostname: DASHBOARD_HOST,
      port: DASHBOARD_PORT,
      path: '/api/sessions/register',
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
          debug.log('session-start', 'register-success', { id: result.id });
          resolve({ success: true, id: result.id });
        } catch (e) {
          debug.log('session-start', 'register-parse-error', { error: e.message });
          resolve({ success: false, error: 'Parse error' });
        }
      });
    });

    req.on('error', (err) => {
      // Dashboard might not be running - that's OK
      debug.log('session-start', 'register-error', { error: err.message });
      resolve({ success: false, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      debug.log('session-start', 'register-timeout', {});
      resolve({ success: false, error: 'Timeout' });
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Load tasks context from tasks.json
 */
function loadTasksContext() {
  debug.log('session-start', 'loadTasks-start', { path: TASKS_JSON });
  try {
    if (!fs.existsSync(TASKS_JSON)) {
      debug.log('session-start', 'loadTasks-nofile', {});
      return { status: 'no_tasks', message: 'No tasks.json found' };
    }
    debug.log('session-start', 'loadTasks-reading', {});
    const data = JSON.parse(fs.readFileSync(TASKS_JSON, 'utf8'));
    const nowTasks = data.backlog?.now?.tasks || [];
    const result = {
      status: 'loaded',
      totalTasks: Object.keys(data.tasks || {}).length,
      nowQueue: nowTasks.length
    };
    debug.log('session-start', 'loadTasks-success', result);
    return result;
  } catch (error) {
    debug.log('session-start', 'loadTasks-error', { error: error.message });
    return { status: 'error', message: error.message };
  }
}

/**
 * Main entry point
 */
async function main() {
  debug.log('session-start', 'main-start', {});

  // Read session info from stdin
  const sessionInfo = await readStdin();

  // Register with dashboard (non-blocking - don't fail if dashboard isn't running)
  const registerResult = await registerWithDashboard(sessionInfo);

  // Load task context
  const context = loadTasksContext();

  // Display session info
  console.log('\n=== Session Context ===');
  console.log(`Tasks: ${context.totalTasks || 0} total, ${context.nowQueue || 0} in NOW queue`);
  if (registerResult.success) {
    console.log(`Dashboard: Session #${registerResult.id} registered`);
  }
  console.log('========================\n');

  debug.log('session-start', 'exit', { context, registerResult });
  process.exit(0);
}

main().catch((err) => {
  debug.log('session-start', 'main-error', { error: err.message });
  console.error('Session start hook error:', err.message);
  process.exit(1);
});
