#!/usr/bin/env node

/**
 * Handoff to Autonomous Loop
 *
 * Run this from within a Claude CLI session to hand off control to the
 * autonomous orchestrator. This script:
 *
 * 1. Ensures state is saved to dev-docs
 * 2. Starts the dashboard if not running
 * 3. Starts the autonomous orchestrator in background
 * 4. Exits the current session
 *
 * The orchestrator will spawn a new Claude session that picks up
 * from where you left off via /session-init.
 *
 * Usage (from within Claude CLI):
 *   node handoff-to-loop.js
 *   node handoff-to-loop.js --phase design
 *   node handoff-to-loop.js --threshold 60
 *
 * @module handoff-to-loop
 */

const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  phase: 'research',
  threshold: 65,
  maxSessions: 0,
  task: null,
};

// Parse arguments
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--phase' && args[i + 1]) {
    CONFIG.phase = args[i + 1];
    i++;
  } else if (args[i] === '--threshold' && args[i + 1]) {
    CONFIG.threshold = parseInt(args[i + 1]);
    i++;
  } else if (args[i] === '--max-sessions' && args[i + 1]) {
    CONFIG.maxSessions = parseInt(args[i + 1]);
    i++;
  } else if (args[i] === '--task' && args[i + 1]) {
    CONFIG.task = args[i + 1];
    i++;
  } else if (args[i] === '--help' || args[i] === '-h') {
    printHelp();
    process.exit(0);
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

function printHelp() {
  console.log(`
Handoff to Autonomous Loop

Hands off control from the current Claude session to the autonomous orchestrator.
The orchestrator will spawn new sessions that continue from your dev-docs state.

Usage:
  node handoff-to-loop.js [options]

Options:
  --phase <phase>        Starting phase (research, design, implement, test)
  --threshold <percent>  Context threshold for session cycling (default: 65)
  --max-sessions <n>     Maximum sessions to run (default: unlimited)
  --task <description>   Task description to pass to orchestrator
  --help, -h             Show this help

Examples:
  node handoff-to-loop.js
  node handoff-to-loop.js --phase design
  node handoff-to-loop.js --threshold 60 --max-sessions 10
`);
}

function checkPort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/health`, (res) => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function startDashboard() {
  console.log('[DASHBOARD] Starting dashboard server...');

  const dashboard = spawn('node', ['global-context-manager.js'], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
  });
  dashboard.unref();

  // Wait for it to be ready
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await checkPort(3033)) {
      console.log('[DASHBOARD] Dashboard ready on port 3033');
      return true;
    }
  }

  console.log('[DASHBOARD] Warning: Dashboard may not have started properly');
  return false;
}

function startOrchestrator() {
  const orchestratorArgs = [
    'autonomous-orchestrator.js',
    '--phase', CONFIG.phase,
    '--threshold', CONFIG.threshold.toString(),
  ];

  if (CONFIG.maxSessions > 0) {
    orchestratorArgs.push('--max-sessions', CONFIG.maxSessions.toString());
  }

  if (CONFIG.task) {
    orchestratorArgs.push('--task', CONFIG.task);
  }

  console.log(`[ORCHESTRATOR] Starting with args: ${orchestratorArgs.join(' ')}`);

  // Start orchestrator detached so it survives this process exiting
  const orchestrator = spawn('node', orchestratorArgs, {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
    // On Windows, we need shell: true for detached to work properly
    shell: process.platform === 'win32',
  });
  orchestrator.unref();

  return orchestrator.pid;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('HANDOFF TO AUTONOMOUS LOOP');
  console.log('═'.repeat(70));
  console.log(`Phase: ${CONFIG.phase}`);
  console.log(`Threshold: ${CONFIG.threshold}%`);
  console.log(`Max Sessions: ${CONFIG.maxSessions || 'unlimited'}`);
  if (CONFIG.task) console.log(`Task: ${CONFIG.task}`);
  console.log('═'.repeat(70) + '\n');

  // Step 1: Check if dev-docs files exist (state should already be saved)
  const devDocsPath = path.join(process.cwd(), '.claude', 'dev-docs');
  const planPath = path.join(devDocsPath, 'plan.md');
  const tasksPath = path.join(devDocsPath, 'tasks.md');

  if (fs.existsSync(planPath) && fs.existsSync(tasksPath)) {
    console.log('[STATE] Dev-docs files found - state is preserved');
  } else {
    console.log('[STATE] Warning: Dev-docs files not found. State may not be preserved.');
    console.log('[STATE] Make sure to save your progress before handoff.');
  }

  // Step 2: Check/start dashboard
  console.log('\n[DASHBOARD] Checking if dashboard is running...');
  const dashboardRunning = await checkPort(3033);

  if (dashboardRunning) {
    console.log('[DASHBOARD] Dashboard already running');
  } else {
    await startDashboard();
  }

  // Step 3: Start orchestrator
  console.log('\n[ORCHESTRATOR] Starting autonomous orchestrator...');
  const pid = startOrchestrator();
  console.log(`[ORCHESTRATOR] Started with PID (or spawned)`);

  // Step 4: Give orchestrator time to initialize
  console.log('\n[HANDOFF] Waiting for orchestrator to initialize...');
  await new Promise(r => setTimeout(r, 2000));

  // Step 5: Exit
  console.log('\n' + '═'.repeat(70));
  console.log('HANDOFF COMPLETE');
  console.log('═'.repeat(70));
  console.log('');
  console.log('The autonomous orchestrator is now running in the background.');
  console.log('It will spawn a new Claude session in a few seconds.');
  console.log('');
  console.log('Monitor progress at: http://localhost:3033/global-dashboard.html');
  console.log('');
  console.log('This session will now exit.');
  console.log('═'.repeat(70) + '\n');

  // Exit after a brief delay
  setTimeout(() => {
    process.exit(0);
  }, 1000);
}

main().catch(err => {
  console.error('Handoff error:', err);
  process.exit(1);
});
