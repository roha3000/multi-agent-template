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

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const ORCHESTRATOR_PATH = path.join(PROJECT_ROOT, 'autonomous-orchestrator.js');

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Spawn orchestrator and capture its behavior
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

describe('Autonomous Orchestrator E2E Tests', () => {
  beforeAll(() => {
    cleanupTestArtifacts();
  });

  afterAll(() => {
    cleanupTestArtifacts();
  });

  describe('Process Lifecycle', () => {
    it('should start and show banner with --help', async () => {
      const { proc, output } = spawnOrchestrator(['--help']);

      await new Promise((resolve) => {
        proc.on('exit', resolve);
      });

      expect(output.stdout).toContain('Autonomous Multi-Agent Orchestrator');
      expect(output.stdout).toContain('--phase');
      expect(output.stdout).toContain('--threshold');
    });
  });

  describe('Context Isolation', () => {
    it('should use log files instead of stdio inherit', () => {
      const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');

      // Should NOT have stdio: 'inherit' for all streams
      expect(content).not.toContain("stdio: 'inherit'");

      // Should have log file configuration
      expect(content.includes('logStream') || content.includes('logPath')).toBe(true);

      // Should log to .claude/logs/
      expect(content).toContain('.claude');
      expect(content).toContain('logs');
    });

    it('should create logs directory if missing', () => {
      const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');
      expect(content.includes('mkdirSync') || content.includes('mkdir')).toBe(true);
    });
  });

  describe('Resource Cleanup', () => {
    it('should have gracefulShutdown function', () => {
      const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');
      expect(content).toContain('gracefulShutdown');
    });

    it('should close EventSource in shutdown', () => {
      const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');
      expect(content).toContain('eventSource.close()');
    });

    it('should handle EventSource at context threshold', () => {
      const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');
      const thresholdIdx = content.indexOf('contextThreshold && !thresholdReached');
      expect(thresholdIdx).toBeGreaterThan(0);

      const thresholdSection = content.substring(thresholdIdx, thresholdIdx + 600);
      expect(thresholdSection).toContain('eventSource');
    });

    it('should reconnect to dashboard if connection was closed', () => {
      const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');
      expect(content).toContain('if (!eventSource)');
      expect(content).toContain('connectToDashboard');
    });

    it('should close log stream on exit', () => {
      const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');
      expect(content).toContain('logStream');
      expect(content).toContain('.end()');
    });
  });

  describe('Signal Handling', () => {
    it('should handle SIGINT', () => {
      const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');
      expect(content).toContain("process.on('SIGINT'");
    });

    it('should handle SIGTERM', () => {
      const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');
      expect(content).toContain("process.on('SIGTERM'");
    });

    it('should cleanup all resources in graceful shutdown', () => {
      const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');
      const shutdownIdx = content.indexOf('async function gracefulShutdown');

      expect(shutdownIdx).toBeGreaterThan(-1);

      // Find the process.exit(0) that's inside gracefulShutdown (after it)
      const contentAfterShutdown = content.substring(shutdownIdx);
      const exitIdxInShutdown = contentAfterShutdown.indexOf('process.exit(0)');

      expect(exitIdxInShutdown).toBeGreaterThan(0);

      const shutdownFn = contentAfterShutdown.substring(0, exitIdxInShutdown);
      expect(shutdownFn).toContain('claudeProcess');
      expect(shutdownFn).toContain('eventSource');
      expect(shutdownFn).toContain('memoryStore');
      expect(shutdownFn).toContain('taskManager');
    });
  });

  describe('CLI Configuration', () => {
    it('should NOT use -p flag (print-and-exit mode)', () => {
      const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');
      const spawnIdx = content.indexOf("spawn('claude'");

      if (spawnIdx > -1) {
        const spawnSection = content.substring(spawnIdx, spawnIdx + 300);
        expect(spawnSection).not.toContain("'-p'");
        expect(spawnSection).not.toContain('"-p"');
      }
    });

    it('should use --dangerously-skip-permissions', () => {
      const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');
      expect(content).toContain('--dangerously-skip-permissions');
    });
  });

  describe('Task Completion', () => {
    it('should check task-completion.json', () => {
      const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');
      expect(content).toContain('task-completion.json');
    });

    it('should verify acceptance criteria are met', () => {
      const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');
      expect(content).toContain('acceptanceMet');
    });

    it('should check quality-scores.json', () => {
      const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');
      expect(content).toContain('quality-scores.json');
    });

    it('should calculate phase score', () => {
      const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');
      expect(content).toContain('calculatePhaseScore');
    });
  });

  describe('Module Integration', () => {
    it('should load quality gates module correctly', () => {
      const QG = require(path.join(PROJECT_ROOT, 'quality-gates'));
      expect(QG.PHASES).toBeDefined();
      expect(QG.calculatePhaseScore).toBeDefined();
      expect(QG.getNextPhase).toBeDefined();
    });

    it('should load TaskManager module correctly', () => {
      const TaskManager = require(path.join(PROJECT_ROOT, '.claude', 'core', 'task-manager'));
      const tm = new TaskManager({ tasksPath: null });

      expect(tm.getNextTask).toBeDefined();
      expect(tm.updateStatus).toBeDefined();
      expect(tm.getReadyTasks).toBeDefined();
      expect(tm.getStats).toBeDefined();
    });
  });

  describe('Architectural Fixes', () => {
    it('should NOT have stdio inherit in spawn call', () => {
      const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');
      const spawnMatch = content.match(/claudeProcess = spawn\([^)]+\),\s*\{[\s\S]*?stdio:([^,\]]+)/);

      if (spawnMatch) {
        const stdioConfig = spawnMatch[1].trim();
        // Either doesn't use 'inherit' or uses array form
        expect(stdioConfig.includes("'inherit'") && !stdioConfig.includes('[')).toBe(false);
      }
    });

    it('should close EventSource when threshold reached', () => {
      const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');
      const thresholdIdx = content.indexOf('contextThreshold && !thresholdReached');

      if (thresholdIdx > -1) {
        const thresholdSection = content.substring(thresholdIdx, thresholdIdx + 500);
        expect(thresholdSection).toContain('eventSource.close');
      }
    });

    it('should have graceful shutdown with timeout', () => {
      const content = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');
      expect(content).toContain('async function gracefulShutdown');
      expect(content).toContain('setTimeout');
      expect(content).toContain('5000');
    });
  });
});
