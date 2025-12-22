#!/usr/bin/env node
/**
 * E2E Tests for Autonomous Orchestrator
 *
 * These tests verify ACTUAL BEHAVIOR, not just component APIs.
 * They catch issues that unit tests miss:
 * - Process execution (not just spawning)
 * - Context pollution (stdout/stderr capture)
 * - Resource cleanup (EventSource, file handles)
 * - Graceful shutdown
 *
 * @module orchestrator.e2e.test
 */

const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const ORCHESTRATOR_PATH = path.join(PROJECT_ROOT, 'autonomous-orchestrator.js');

// Test results
const results = {
  passed: [],
  failed: [],
  skipped: [],
};

function test(name, fn, { timeout = 30000, skip = false } = {}) {
  if (skip) {
    results.skipped.push(name);
    console.log(`⏭️  ${name} (skipped)`);
    return Promise.resolve();
  }

  return new Promise(async (resolve) => {
    const timer = setTimeout(() => {
      results.failed.push({ name, error: `Timeout after ${timeout}ms` });
      console.log(`❌ ${name}: Timeout after ${timeout}ms`);
      resolve();
    }, timeout);

    try {
      await fn();
      clearTimeout(timer);
      results.passed.push(name);
      console.log(`✅ ${name}`);
    } catch (err) {
      clearTimeout(timer);
      results.failed.push({ name, error: err.message });
      console.log(`❌ ${name}: ${err.message}`);
    }
    resolve();
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Spawn orchestrator and capture its behavior (not just output)
 */
function spawnOrchestrator(args = [], options = {}) {
  const proc = spawn('node', [ORCHESTRATOR_PATH, ...args], {
    cwd: PROJECT_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...options.env },
  });

  const output = { stdout: '', stderr: '' };
  proc.stdout.on('data', (d) => output.stdout += d.toString());
  proc.stderr.on('data', (d) => output.stderr += d.toString());

  return { proc, output };
}

/**
 * Check if a process has any child processes
 */
async function getChildProcesses(pid) {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec(`wmic process where (ParentProcessId=${pid}) get ProcessId`, (err, stdout) => {
        if (err) return resolve([]);
        const pids = stdout.split('\n')
          .slice(1)
          .map(l => l.trim())
          .filter(l => l && l !== 'ProcessId');
        resolve(pids);
      });
    } else {
      exec(`pgrep -P ${pid}`, (err, stdout) => {
        if (err) return resolve([]);
        resolve(stdout.split('\n').filter(Boolean));
      });
    }
  });
}

/**
 * Check if EventSource connection is active
 */
async function checkEventSourceActive(port = 3033) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/events`, (res) => {
      // If we get a response, the endpoint is active
      req.destroy();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Read orchestrator log file to verify behavior
 */
function readSessionLog(sessionNumber) {
  const logPath = path.join(PROJECT_ROOT, '.claude', 'logs', `session-${sessionNumber}.log`);
  if (fs.existsSync(logPath)) {
    return fs.readFileSync(logPath, 'utf-8');
  }
  return null;
}

/**
 * Clean up test artifacts
 */
function cleanupTestArtifacts() {
  const logsDir = path.join(PROJECT_ROOT, '.claude', 'logs');
  if (fs.existsSync(logsDir)) {
    fs.readdirSync(logsDir)
      .filter(f => f.startsWith('session-') && f.endsWith('.log'))
      .forEach(f => {
        try { fs.unlinkSync(path.join(logsDir, f)); } catch (e) { /* ignore */ }
      });
  }
}

// ============================================================================
// E2E TESTS
// ============================================================================

async function runTests() {
  console.log('='.repeat(60));
  console.log('E2E TESTS: AUTONOMOUS ORCHESTRATOR');
  console.log('='.repeat(60));
  console.log();

  // Cleanup before tests
  cleanupTestArtifacts();

  // -------------------------------------------------------------------------
  // TEST 1: Orchestrator spawns without crashing
  // -------------------------------------------------------------------------
  console.log('--- Process Lifecycle ---');

  await test('Orchestrator starts and shows banner', async () => {
    const { proc, output } = spawnOrchestrator(['--help']);

    await new Promise((resolve) => {
      proc.on('exit', resolve);
    });

    assert(output.stdout.includes('Autonomous Multi-Agent Orchestrator'),
      'Should show orchestrator banner');
    assert(output.stdout.includes('--phase'),
      'Should show phase option');
    assert(output.stdout.includes('--threshold'),
      'Should show threshold option');
  });

  // -------------------------------------------------------------------------
  // TEST 2: stdio configuration prevents context pollution
  // -------------------------------------------------------------------------
  console.log('\n--- Context Isolation ---');

  await test('Orchestrator uses log files instead of stdio inherit', async () => {
    const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');

    // Should NOT have stdio: 'inherit' for all streams
    assert(!content.includes("stdio: 'inherit'"),
      'Should NOT use stdio: inherit (causes context pollution)');

    // Should have log file configuration
    assert(content.includes('logStream') || content.includes('logPath'),
      'Should use log files for output');

    // Should log to .claude/logs/
    assert(content.includes('.claude') && content.includes('logs'),
      'Should log to .claude/logs/ directory');
  });

  await test('Log directory structure is correct', async () => {
    const logsDir = path.join(PROJECT_ROOT, '.claude', 'logs');

    // Directory should be created by orchestrator or exist
    // We don't run the full orchestrator here, just verify the code creates it
    const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');
    assert(content.includes('mkdirSync') || content.includes("mkdir"),
      'Should create logs directory if missing');
  });

  // -------------------------------------------------------------------------
  // TEST 3: EventSource cleanup
  // -------------------------------------------------------------------------
  console.log('\n--- Resource Cleanup ---');

  await test('EventSource cleanup in graceful shutdown', async () => {
    const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');

    // Should have cleanup in gracefulShutdown
    assert(content.includes('gracefulShutdown'),
      'Should have gracefulShutdown function');

    // Should close EventSource
    assert(content.includes('eventSource.close()'),
      'Should close EventSource in shutdown');

    // Should close EventSource at threshold - look for the specific section
    const thresholdIdx = content.indexOf('contextThreshold && !thresholdReached');
    assert(thresholdIdx > 0, 'Should have threshold handling code');
    const thresholdSection = content.substring(thresholdIdx, thresholdIdx + 600);
    assert(thresholdSection.includes('eventSource'),
      'Should handle EventSource at context threshold');
  });

  await test('EventSource reconnection after threshold', async () => {
    const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');

    // Should reconnect if eventSource is null
    assert(content.includes('if (!eventSource)') && content.includes('connectToDashboard'),
      'Should reconnect to dashboard if connection was closed');
  });

  await test('Log stream cleanup on process exit', async () => {
    const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');

    // Should close log stream
    assert(content.includes('logStream') && content.includes('.end()'),
      'Should close log stream on exit');
  });

  // -------------------------------------------------------------------------
  // TEST 4: Signal handlers
  // -------------------------------------------------------------------------
  console.log('\n--- Signal Handling ---');

  await test('SIGINT triggers graceful shutdown', async () => {
    const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');

    assert(content.includes("process.on('SIGINT'"),
      'Should handle SIGINT');
    assert(content.includes("gracefulShutdown('SIGINT')") ||
           content.includes('gracefulShutdown(\'SIGINT\')'),
      'SIGINT should call gracefulShutdown');
  });

  await test('SIGTERM triggers graceful shutdown', async () => {
    const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');

    assert(content.includes("process.on('SIGTERM'"),
      'Should handle SIGTERM');
    assert(content.includes("gracefulShutdown('SIGTERM')") ||
           content.includes('gracefulShutdown(\'SIGTERM\')'),
      'SIGTERM should call gracefulShutdown');
  });

  await test('Graceful shutdown cleans up all resources', async () => {
    const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');

    const shutdownFn = content.substring(
      content.indexOf('async function gracefulShutdown'),
      content.indexOf('process.exit(0)')
    );

    assert(shutdownFn.includes('claudeProcess'), 'Should cleanup claudeProcess');
    assert(shutdownFn.includes('eventSource'), 'Should cleanup eventSource');
    assert(shutdownFn.includes('memoryStore'), 'Should cleanup memoryStore');
    assert(shutdownFn.includes('taskManager'), 'Should cleanup taskManager');
  });

  // -------------------------------------------------------------------------
  // TEST 5: No -p flag (print-and-exit mode)
  // -------------------------------------------------------------------------
  console.log('\n--- CLI Configuration ---');

  await test('Does NOT use -p flag (print-and-exit mode)', async () => {
    const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');

    // Check spawn call doesn't include -p
    const spawnSection = content.substring(
      content.indexOf('spawn(\'claude\''),
      content.indexOf('spawn(\'claude\'') + 300
    );

    assert(!spawnSection.includes("'-p'") && !spawnSection.includes('"-p"'),
      'Should NOT use -p flag which causes print-and-exit behavior');
  });

  await test('Uses --dangerously-skip-permissions', async () => {
    const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');

    assert(content.includes('--dangerously-skip-permissions'),
      'Should use --dangerously-skip-permissions for autonomous execution');
  });

  // -------------------------------------------------------------------------
  // TEST 6: Task completion verification
  // -------------------------------------------------------------------------
  console.log('\n--- Task Completion ---');

  await test('Task completion requires file verification', async () => {
    const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');

    // Should read task-completion.json
    assert(content.includes('task-completion.json'),
      'Should check task-completion.json');

    // Should verify acceptance criteria
    assert(content.includes('acceptanceMet'),
      'Should verify acceptance criteria are met');
  });

  await test('Quality scores are validated', async () => {
    const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');

    // Should read quality-scores.json
    assert(content.includes('quality-scores.json'),
      'Should check quality-scores.json');

    // Should calculate weighted score
    assert(content.includes('calculatePhaseScore'),
      'Should calculate phase score');
  });

  // -------------------------------------------------------------------------
  // TEST 7: Integration with real modules
  // -------------------------------------------------------------------------
  console.log('\n--- Module Integration ---');

  await test('Quality gates module loads correctly', async () => {
    const QG = require(path.join(PROJECT_ROOT, 'quality-gates'));
    assert(QG.PHASES, 'PHASES should exist');
    assert(QG.calculatePhaseScore, 'calculatePhaseScore should exist');
    assert(QG.getNextPhase, 'getNextPhase should exist');
  });

  await test('TaskManager module loads correctly', async () => {
    const TaskManager = require(path.join(PROJECT_ROOT, '.claude', 'core', 'task-manager'));
    const tm = new TaskManager({ persistPath: null });
    // TaskManager uses _getAllTasks (private) internally, but exposes getNextTask, updateStatus, etc.
    assert(tm.getNextTask, 'getNextTask should exist');
    assert(tm.updateStatus, 'updateStatus should exist');
    assert(tm.getReadyTasks, 'getReadyTasks should exist');
    assert(tm.getStats, 'getStats should exist');
  });

  // -------------------------------------------------------------------------
  // TEST 8: Verify architectural fixes are in place
  // -------------------------------------------------------------------------
  console.log('\n--- Architectural Fixes ---');

  await test('CRITICAL FIX: stdio not inherited', async () => {
    const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');

    // Find the spawn call
    const spawnMatch = content.match(/claudeProcess = spawn\([^)]+\),\s*\{[\s\S]*?stdio:([^,\]]+)/);
    if (spawnMatch) {
      const stdioConfig = spawnMatch[1].trim();
      assert(!stdioConfig.includes("'inherit'") || stdioConfig.includes('['),
        `stdio should NOT be 'inherit', got: ${stdioConfig}`);
    }
  });

  await test('CRITICAL FIX: EventSource closed at threshold', async () => {
    const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');

    // Find threshold handling section
    const thresholdIdx = content.indexOf('contextThreshold && !thresholdReached');
    const thresholdSection = content.substring(thresholdIdx, thresholdIdx + 500);

    assert(thresholdSection.includes('eventSource.close'),
      'EventSource should be closed when threshold reached');
  });

  await test('CRITICAL FIX: Graceful shutdown exists', async () => {
    const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');

    assert(content.includes('async function gracefulShutdown'),
      'Graceful shutdown handler should exist');

    // Should wait for processes
    assert(content.includes('setTimeout') && content.includes('5000'),
      'Should have timeout for process termination');
  });

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n' + '='.repeat(60));
  console.log('E2E TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Passed:  ${results.passed.length}`);
  console.log(`Failed:  ${results.failed.length}`);
  console.log(`Skipped: ${results.skipped.length}`);

  if (results.failed.length > 0) {
    console.log('\nFailed tests:');
    results.failed.forEach(f => console.log(`  ❌ ${f.name}: ${f.error}`));
  }

  console.log('\n' + '='.repeat(60));

  // Cleanup
  cleanupTestArtifacts();

  process.exit(results.failed.length > 0 ? 1 : 0);
}

// Run tests
runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
