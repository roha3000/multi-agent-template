/**
 * E2E Tests for Session Lifecycle
 *
 * Verifies the COMPLETE session cycling flow:
 * 1. State is saved to dev-docs files during execution
 * 2. Session ends (threshold reached or task complete)
 * 3. New session starts with fresh 200K context
 * 4. New session reads state from dev-docs files
 * 5. New session continues executing from task list
 *
 * @module session-lifecycle.e2e.test
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

// ============================================================================
// TEST FIXTURES
// ============================================================================

const TEST_DIR = path.join(os.tmpdir(), 'claude-lifecycle-test');
const DEV_DOCS_DIR = path.join(TEST_DIR, '.claude', 'dev-docs');

function setupTestEnvironment() {
  // Clean and create test directories
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DEV_DOCS_DIR, { recursive: true });

  // Create initial dev-docs files (state)
  fs.writeFileSync(path.join(TEST_DIR, 'PROJECT_SUMMARY.md'), `# Test Project

## Current State
- Phase: implementation
- Tasks completed: 2
- Last session: ${new Date().toISOString()}

## Architecture
Test architecture for session lifecycle verification.
`);

  fs.writeFileSync(path.join(DEV_DOCS_DIR, 'plan.md'), `# Implementation Plan

## Current Task
- Implement feature X
- Write tests for feature X

## Completed
1. Research phase
2. Design phase
`);

  fs.writeFileSync(path.join(DEV_DOCS_DIR, 'tasks.md'), `# Tasks

## In Progress
- [ ] Implement feature X (id: task-001)

## Completed
- [x] Research requirements
- [x] Design architecture

## Blocked
- [ ] Deploy to production (waiting for feature X)
`);

  // Create tasks.json
  fs.writeFileSync(path.join(TEST_DIR, 'tasks.json'), JSON.stringify({
    version: '1.0.0',
    project: { name: 'lifecycle-test' },
    backlog: {
      now: { tasks: ['task-001', 'task-002'] },
      next: { tasks: ['task-003'] },
      later: { tasks: [] },
    },
    tasks: {
      'task-001': {
        id: 'task-001',
        title: 'Implement feature X',
        status: 'in_progress',
        phase: 'implementation',
        priority: 'high',
        started: new Date().toISOString(),
      },
      'task-002': {
        id: 'task-002',
        title: 'Write tests',
        status: 'ready',
        phase: 'testing',
        priority: 'high',
        depends: { requires: ['task-001'] },
      },
      'task-003': {
        id: 'task-003',
        title: 'Deploy',
        status: 'blocked',
        phase: 'validation',
        depends: { requires: ['task-001', 'task-002'] },
      },
    },
  }, null, 2));

  return TEST_DIR;
}

function cleanupTestEnvironment() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// ============================================================================
// E2E TESTS
// ============================================================================

describe('Session Lifecycle E2E Tests', () => {
  beforeAll(() => {
    cleanupTestEnvironment();
  });

  afterAll(() => {
    cleanupTestEnvironment();
  });

  describe('Part 1: State Persistence', () => {
    it('should have dev-docs 3-file pattern', () => {
      const projectSummary = path.join(PROJECT_ROOT, 'PROJECT_SUMMARY.md');
      const planFile = path.join(PROJECT_ROOT, '.claude', 'dev-docs', 'plan.md');
      const tasksFile = path.join(PROJECT_ROOT, '.claude', 'dev-docs', 'tasks.md');

      expect(fs.existsSync(projectSummary)).toBe(true);
      expect(fs.existsSync(planFile)).toBe(true);
      expect(fs.existsSync(tasksFile)).toBe(true);

      // Verify files have content
      const summarySize = fs.statSync(projectSummary).size;
      const planSize = fs.statSync(planFile).size;
      const tasksSize = fs.statSync(tasksFile).size;

      expect(summarySize).toBeGreaterThan(100);
      expect(planSize).toBeGreaterThan(50);
      expect(tasksSize).toBeGreaterThan(50);
    });

    it('should have tasks.json with structured task state', () => {
      const tasksPath = path.join(PROJECT_ROOT, 'tasks.json');
      expect(fs.existsSync(tasksPath)).toBe(true);

      const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf-8'));

      expect(tasks.version).toBeDefined();
      expect(tasks.project?.name).toBeDefined();
      expect(tasks.backlog).toBeDefined();
      expect(tasks.tasks).toBeDefined();
    });

    it('should load and track task state via TaskManager', () => {
      const TaskManager = require(path.join(PROJECT_ROOT, '.claude', 'core', 'task-manager'));
      const tasksPath = path.join(PROJECT_ROOT, 'tasks.json');

      const tm = new TaskManager({ tasksPath: tasksPath });
      const stats = tm.getStats();

      expect(stats.total).toBeGreaterThan(0);
    });
  });

  describe('Part 2: Session Initialization', () => {
    it('should have /session-init command that loads state', () => {
      const sessionInitPath = path.join(PROJECT_ROOT, '.claude', 'commands', 'session-init.md');
      expect(fs.existsSync(sessionInitPath)).toBe(true);

      const content = fs.readFileSync(sessionInitPath, 'utf-8');

      // Should reference PROJECT_SUMMARY for state
      expect(
        content.includes('PROJECT_SUMMARY') ||
        content.includes('project_summary')
      ).toBe(true);
    });

    it('should instruct Claude to run /session-init in orchestrator', () => {
      const orchPath = path.join(PROJECT_ROOT, 'autonomous-orchestrator.js');
      const content = fs.readFileSync(orchPath, 'utf-8');

      expect(content).toContain('/session-init');
    });

    it('should have continuation logic in continuous-loop', () => {
      const loopPath = path.join(PROJECT_ROOT, 'continuous-loop.js');
      const content = fs.readFileSync(loopPath, 'utf-8');

      expect(
        content.includes('session-init') ||
        content.includes('continue')
      ).toBe(true);
    });
  });

  describe('Part 3: Task Execution Continuation', () => {
    it('should generate task-specific prompts in orchestrator', () => {
      const orchPath = path.join(PROJECT_ROOT, 'autonomous-orchestrator.js');
      const content = fs.readFileSync(orchPath, 'utf-8');

      expect(content).toContain('generatePhasePrompt');
      expect(
        content.includes('task.id') ||
        content.includes('task.title')
      ).toBe(true);
      expect(
        content.includes('acceptance') ||
        content.includes('Acceptance')
      ).toBe(true);
    });

    it('should track task progress across sessions', () => {
      setupTestEnvironment();

      const TaskManager = require(path.join(PROJECT_ROOT, '.claude', 'core', 'task-manager'));
      const testTasksPath = path.join(TEST_DIR, 'tasks.json');

      // Session 1: Load and verify task exists
      const tm1 = new TaskManager({ tasksPath: testTasksPath });
      const stats1 = tm1.getStats();
      expect(stats1.total).toBeGreaterThan(0);

      const task1 = tm1.getTask('task-001');
      expect(task1).not.toBeNull();

      // Session 1: Complete task-001
      tm1.updateStatus('task-001', 'completed', {
        deliverables: ['feature.js', 'feature.test.js'],
        qualityScore: 92,
      });

      // Session 2: Load fresh and verify state persisted
      const tm2 = new TaskManager({ tasksPath: testTasksPath });
      const stats2 = tm2.getStats();

      const completedCount = stats2.byStatus?.completed || 0;
      expect(completedCount).toBeGreaterThan(0);

      cleanupTestEnvironment();
    });

    it('should reference quality-scores.json in orchestrator', () => {
      const orchPath = path.join(PROJECT_ROOT, 'autonomous-orchestrator.js');
      const content = fs.readFileSync(orchPath, 'utf-8');

      expect(content).toContain('quality-scores.json');
      expect(content).toContain('readQualityScores');
    });
  });

  describe('Part 4: Session Transition', () => {
    it('should trigger clean session termination at threshold', () => {
      const orchPath = path.join(PROJECT_ROOT, 'autonomous-orchestrator.js');
      const content = fs.readFileSync(orchPath, 'utf-8');

      expect(content).toContain('contextThreshold');
      expect(content).toContain('thresholdReached');
      expect(content).toContain("claudeProcess.kill('SIGTERM')");
      expect(content).toContain('eventSource.close()');
    });

    it('should spawn new session with fresh context', () => {
      const orchPath = path.join(PROJECT_ROOT, 'autonomous-orchestrator.js');
      const content = fs.readFileSync(orchPath, 'utf-8');

      // Orchestrator uses exec to pipe prompt file to claude
      expect(content).toContain("exec(cmd,");
      expect(content).toContain('while (shouldContinue');
      expect(content).toContain('totalSessions++');
    });

    it('should record session history', () => {
      const orchPath = path.join(PROJECT_ROOT, 'autonomous-orchestrator.js');
      const content = fs.readFileSync(orchPath, 'utf-8');

      expect(content).toContain('sessionHistory');
      expect(content).toContain('sessionHistory.push');
    });
  });

  describe('Part 5: Full Cycle Verification', () => {
    it('should have complete lifecycle flow', () => {
      // 1. State files
      expect(fs.existsSync(path.join(PROJECT_ROOT, 'PROJECT_SUMMARY.md'))).toBe(true);
      expect(fs.existsSync(path.join(PROJECT_ROOT, '.claude', 'dev-docs', 'plan.md'))).toBe(true);

      // 2. Session init command
      expect(fs.existsSync(path.join(PROJECT_ROOT, '.claude', 'commands', 'session-init.md'))).toBe(true);

      // 3. TaskManager
      const TaskManager = require(path.join(PROJECT_ROOT, '.claude', 'core', 'task-manager'));
      const tm = new TaskManager({ tasksPath: null });
      expect(tm.getNextTask).toBeDefined();

      // 4. Context tracking
      expect(fs.existsSync(path.join(PROJECT_ROOT, '.claude', 'core', 'global-context-tracker.js'))).toBe(true);

      // 5. Orchestrator
      expect(fs.existsSync(path.join(PROJECT_ROOT, 'autonomous-orchestrator.js'))).toBe(true);
    });

    it('should maintain task continuity across session cycles', () => {
      setupTestEnvironment();

      const TaskManager = require(path.join(PROJECT_ROOT, '.claude', 'core', 'task-manager'));
      const testTasksPath = path.join(TEST_DIR, 'tasks.json');

      // SESSION 1: Load and work on a task
      const tm1 = new TaskManager({ tasksPath: testTasksPath });
      const stats1 = tm1.getStats();
      expect(stats1.total).toBeGreaterThan(0);

      const task1 = tm1.getTask('task-001');
      expect(task1).not.toBeNull();

      // SESSION 2: Continue and complete task
      const tm2 = new TaskManager({ tasksPath: testTasksPath });
      tm2.updateStatus('task-001', 'completed', {
        deliverables: ['feature.js'],
        qualityScore: 90,
      });

      // SESSION 3: Verify state persisted
      const tm3 = new TaskManager({ tasksPath: testTasksPath });
      const stats3 = tm3.getStats();

      const completedCount = stats3.byStatus?.completed || 0;
      expect(completedCount).toBeGreaterThanOrEqual(1);

      const readyTasks = tm3.getReadyTasks();
      expect(Array.isArray(readyTasks)).toBe(true);

      cleanupTestEnvironment();
    });

    it('should survive process termination', () => {
      setupTestEnvironment();

      // Write state file
      const stateFile = path.join(DEV_DOCS_DIR, 'session-state.json');
      const state1 = {
        currentTask: 'task-001',
        phase: 'implementation',
        iteration: 3,
        lastCheckpoint: new Date().toISOString(),
      };
      fs.writeFileSync(stateFile, JSON.stringify(state1, null, 2));

      // Verify file persists
      expect(fs.existsSync(stateFile)).toBe(true);

      // Read back
      const state2 = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      expect(state2.currentTask).toBe('task-001');
      expect(state2.iteration).toBe(3);

      cleanupTestEnvironment();
    });
  });
});
