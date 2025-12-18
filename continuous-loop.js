#!/usr/bin/env node

/**
 * Continuous Loop Orchestrator
 *
 * Automatically cycles Claude CLI sessions when context threshold is reached.
 * Enables unlimited-length automated tasks by leveraging external state management.
 *
 * How it works:
 * 1. Spawns Claude CLI with visible output (stdio: inherit)
 * 2. Monitors context usage via dashboard SSE
 * 3. At threshold (default 65%), gracefully terminates session
 * 4. Spawns new session that picks up state via /session-init
 *
 * State persistence:
 * - State lives in dev-docs files (PROJECT_SUMMARY.md, plan.md, tasks.md)
 * - Each new session runs /session-init to load ~400 tokens of context
 * - No prompt injection needed - Claude reads its own state
 *
 * Usage:
 *   npm run loop                    # Start with default settings
 *   npm run loop -- --threshold 60  # Custom threshold (60%)
 *   npm run loop -- --max-sessions 5 # Limit to 5 sessions
 *
 * @module continuous-loop
 */

const { spawn } = require('child_process');
const EventSource = require('eventsource');
const path = require('path');
const http = require('http');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Dashboard SSE endpoint
  dashboardUrl: process.env.DASHBOARD_URL || 'http://localhost:3033/api/events',

  // Context threshold to trigger session cycling (percentage USED)
  // 65% used = 35% remaining (before 77.5% auto-compact)
  contextThreshold: parseInt(process.env.CONTEXT_THRESHOLD) || 65,

  // Delay between sessions (ms)
  sessionDelay: parseInt(process.env.SESSION_DELAY) || 3000,

  // Maximum sessions (0 = unlimited)
  maxSessions: parseInt(process.env.MAX_SESSIONS) || 0,

  // Project path to monitor (current directory by default)
  projectPath: process.env.PROJECT_PATH || process.cwd(),

  // Initial prompt for new sessions
  initialPrompt: process.env.INITIAL_PROMPT || 'Run /session-init and continue the current task. Save progress frequently using TodoWrite.',

  // Grace period after threshold before forcing termination (ms)
  gracePeriod: parseInt(process.env.GRACE_PERIOD) || 30000,
};

// Parse command line arguments
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--threshold' && args[i + 1]) {
    CONFIG.contextThreshold = parseInt(args[i + 1]);
    i++;
  } else if (args[i] === '--max-sessions' && args[i + 1]) {
    CONFIG.maxSessions = parseInt(args[i + 1]);
    i++;
  } else if (args[i] === '--delay' && args[i + 1]) {
    CONFIG.sessionDelay = parseInt(args[i + 1]);
    i++;
  } else if (args[i] === '--prompt' && args[i + 1]) {
    CONFIG.initialPrompt = args[i + 1];
    i++;
  } else if (args[i] === '--help' || args[i] === '-h') {
    printHelp();
    process.exit(0);
  }
}

// ============================================================================
// SESSION SERIES TRACKING
// ============================================================================

const sessionSeries = {
  seriesId: Date.now(),
  startTime: new Date(),
  sessions: [],
  totalTokens: 0,
  totalCost: 0,
  currentSession: 0,
};

function recordSession(sessionData) {
  sessionSeries.sessions.push({
    sessionNumber: sessionSeries.currentSession,
    startTime: sessionData.startTime,
    endTime: new Date(),
    duration: Date.now() - sessionData.startTime.getTime(),
    exitReason: sessionData.exitReason,
    peakContext: sessionData.peakContext,
    tokens: sessionData.tokens || 0,
    cost: sessionData.cost || 0,
  });
  sessionSeries.totalTokens += sessionData.tokens || 0;
  sessionSeries.totalCost += sessionData.cost || 0;
}

function printSeriesStatus() {
  console.log('\n' + '─'.repeat(70));
  console.log('SESSION SERIES STATUS');
  console.log('─'.repeat(70));
  console.log(`Series ID: ${sessionSeries.seriesId}`);
  console.log(`Sessions completed: ${sessionSeries.sessions.length}`);
  console.log(`Total runtime: ${formatDuration(Date.now() - sessionSeries.startTime.getTime())}`);
  console.log(`Total cost: $${sessionSeries.totalCost.toFixed(4)}`);
  console.log('─'.repeat(70));

  if (sessionSeries.sessions.length > 0) {
    console.log('\nSession History:');
    sessionSeries.sessions.forEach((s, i) => {
      console.log(`  ${i + 1}. ${formatDuration(s.duration)} | Peak: ${s.peakContext.toFixed(1)}% | Exit: ${s.exitReason}`);
    });
  }
  console.log('');
}

// ============================================================================
// ORCHESTRATOR
// ============================================================================

let claudeProcess = null;
let eventSource = null;
let shouldContinue = true;
let currentSessionData = null;
let thresholdReached = false;
let forceTerminateTimer = null;

async function startOrchestrator() {
  console.log('\n' + '═'.repeat(70));
  console.log('CONTINUOUS LOOP ORCHESTRATOR');
  console.log('═'.repeat(70));
  console.log(`Dashboard: ${CONFIG.dashboardUrl}`);
  console.log(`Threshold: ${CONFIG.contextThreshold}% context used`);
  console.log(`Max sessions: ${CONFIG.maxSessions || 'unlimited'}`);
  console.log(`Project: ${CONFIG.projectPath}`);
  console.log('═'.repeat(70) + '\n');

  // Connect to dashboard SSE
  connectToDashboard();

  // Report series start to dashboard
  await reportSeriesStart();

  // Main loop
  while (shouldContinue) {
    sessionSeries.currentSession++;

    // Check max sessions
    if (CONFIG.maxSessions > 0 && sessionSeries.currentSession > CONFIG.maxSessions) {
      console.log(`\nMax sessions (${CONFIG.maxSessions}) reached. Stopping.`);
      break;
    }

    console.log('\n' + '─'.repeat(70));
    console.log(`STARTING SESSION ${sessionSeries.currentSession}`);
    console.log('─'.repeat(70) + '\n');

    // Reset state for new session
    thresholdReached = false;
    currentSessionData = {
      startTime: new Date(),
      peakContext: 0,
      tokens: 0,
      cost: 0,
      exitReason: 'unknown',
    };

    // Run the session
    const exitCode = await runSession();

    // Record session
    recordSession(currentSessionData);

    // Report to dashboard
    await reportSessionComplete({
      sessionNumber: sessionSeries.currentSession,
      duration: Date.now() - currentSessionData.startTime.getTime(),
      exitReason: currentSessionData.exitReason,
      peakContext: currentSessionData.peakContext,
      tokens: currentSessionData.tokens,
      cost: currentSessionData.cost,
    });

    printSeriesStatus();

    // Check if we should continue
    if (exitCode === 0 && currentSessionData.exitReason === 'complete') {
      console.log('\nTask marked complete. Stopping loop.');
      break;
    }

    if (!shouldContinue) {
      console.log('\nLoop stopped by user.');
      break;
    }

    // Delay before next session
    console.log(`\nStarting next session in ${CONFIG.sessionDelay / 1000} seconds...`);
    await sleep(CONFIG.sessionDelay);
  }

  // Cleanup
  if (eventSource) {
    eventSource.close();
  }

  // Report series end to dashboard
  await reportSeriesEnd();

  console.log('\n' + '═'.repeat(70));
  console.log('CONTINUOUS LOOP COMPLETE');
  console.log('═'.repeat(70));
  printSeriesStatus();
}

function runSession() {
  return new Promise((resolve) => {
    // Build the prompt for Claude
    const prompt = sessionSeries.currentSession === 1
      ? CONFIG.initialPrompt
      : 'Run /session-init and continue from where the previous session left off. The context threshold was reached, so pick up the task and continue working.';

    console.log(`Prompt: ${prompt}\n`);
    console.log('─'.repeat(70) + '\n');

    // Spawn Claude CLI with visible output
    claudeProcess = spawn('claude', ['--print', prompt], {
      stdio: 'inherit',
      cwd: CONFIG.projectPath,
      shell: true,
    });

    claudeProcess.on('error', (err) => {
      console.error('\nFailed to start Claude:', err.message);
      currentSessionData.exitReason = 'error';
      resolve(1);
    });

    claudeProcess.on('exit', (code, signal) => {
      // Clear any force terminate timer
      if (forceTerminateTimer) {
        clearTimeout(forceTerminateTimer);
        forceTerminateTimer = null;
      }

      if (signal === 'SIGTERM') {
        currentSessionData.exitReason = 'threshold';
        console.log('\n[Orchestrator] Session terminated due to context threshold.');
      } else if (code === 0) {
        if (!thresholdReached) {
          currentSessionData.exitReason = 'complete';
        }
      } else {
        currentSessionData.exitReason = 'error';
      }

      claudeProcess = null;
      resolve(code || 0);
    });
  });
}

function connectToDashboard() {
  console.log('Connecting to dashboard SSE...');

  eventSource = new EventSource(CONFIG.dashboardUrl);

  eventSource.onopen = () => {
    console.log('Connected to dashboard SSE.\n');
  };

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleDashboardUpdate(data);
    } catch (err) {
      // Ignore parse errors
    }
  };

  eventSource.onerror = (err) => {
    console.error('Dashboard SSE error. Make sure the dashboard is running:');
    console.error('  npm run monitor:global');
    console.error('\nWill retry connection...\n');
  };
}

function handleDashboardUpdate(data) {
  if (!data.projects || !claudeProcess) return;

  // Find our project in the data
  const projectName = path.basename(CONFIG.projectPath);
  const project = data.projects.find(p =>
    p.name === projectName ||
    p.path?.includes(projectName) ||
    p.folder?.includes(projectName)
  );

  if (!project) return;

  // Get context percentage (this is context USED, not remaining)
  const contextUsed = project.contextPercent || project.metrics?.contextPercent || 0;

  // Track peak context
  if (contextUsed > currentSessionData.peakContext) {
    currentSessionData.peakContext = contextUsed;
  }

  // Track tokens and cost
  if (project.metrics) {
    currentSessionData.tokens = project.metrics.totalTokens || 0;
    currentSessionData.cost = project.metrics.cost || 0;
  }

  // Check threshold
  if (contextUsed >= CONFIG.contextThreshold && !thresholdReached) {
    thresholdReached = true;
    console.log(`\n[Orchestrator] Context threshold reached: ${contextUsed.toFixed(1)}% >= ${CONFIG.contextThreshold}%`);
    console.log('[Orchestrator] Sending SIGTERM to Claude process...');

    // Send graceful termination signal
    if (claudeProcess) {
      claudeProcess.kill('SIGTERM');

      // Set force terminate timer
      forceTerminateTimer = setTimeout(() => {
        if (claudeProcess) {
          console.log('[Orchestrator] Grace period expired, forcing termination...');
          claudeProcess.kill('SIGKILL');
        }
      }, CONFIG.gracePeriod);
    }
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// ============================================================================
// DASHBOARD API INTEGRATION
// ============================================================================

function postToDashboard(endpoint, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(CONFIG.dashboardUrl);
    const postData = JSON.stringify(data);

    const options = {
      hostname: url.hostname,
      port: url.port || 3033,
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({ success: true });
        }
      });
    });

    req.on('error', (err) => {
      // Silently fail - dashboard might not be running
      resolve({ success: false, error: err.message });
    });

    req.write(postData);
    req.end();
  });
}

async function reportSeriesStart() {
  return postToDashboard('/api/series/start', {});
}

async function reportSessionComplete(sessionData) {
  return postToDashboard('/api/series/session', {
    sessionNumber: sessionData.sessionNumber,
    duration: sessionData.duration,
    exitReason: sessionData.exitReason,
    peakContext: sessionData.peakContext,
    tokens: sessionData.tokens,
    cost: sessionData.cost,
  });
}

async function reportSeriesEnd() {
  return postToDashboard('/api/series/end', {});
}

function printHelp() {
  console.log(`
Continuous Loop Orchestrator

Automatically cycles Claude CLI sessions when context threshold is reached.

Usage:
  node continuous-loop.js [options]
  npm run loop [-- options]

Options:
  --threshold <percent>  Context threshold to trigger cycling (default: 65)
  --max-sessions <n>     Maximum sessions to run (default: unlimited)
  --delay <ms>           Delay between sessions in ms (default: 3000)
  --prompt <text>        Initial prompt for first session
  --help, -h             Show this help

Examples:
  npm run loop                        # Default settings
  npm run loop -- --threshold 60      # Cycle at 60% context
  npm run loop -- --max-sessions 10   # Limit to 10 sessions

Requirements:
  - Dashboard must be running: npm run monitor:global
  - Claude CLI must be authenticated
`);
}

// ============================================================================
// SIGNAL HANDLERS
// ============================================================================

process.on('SIGINT', () => {
  console.log('\n\n[Orchestrator] Received SIGINT, stopping...');
  shouldContinue = false;
  if (claudeProcess) {
    claudeProcess.kill('SIGTERM');
  }
});

process.on('SIGTERM', () => {
  console.log('\n\n[Orchestrator] Received SIGTERM, stopping...');
  shouldContinue = false;
  if (claudeProcess) {
    claudeProcess.kill('SIGTERM');
  }
});

// ============================================================================
// MAIN
// ============================================================================

startOrchestrator().catch(err => {
  console.error('Orchestrator error:', err);
  process.exit(1);
});
