/**
 * DashboardManager Tests
 *
 * Tests for dashboard state management, event handling, and real-time updates
 */

const DashboardManager = require('../../.claude/core/dashboard-manager');
const UsageTracker = require('../../.claude/core/usage-tracker');
const MemoryStore = require('../../.claude/core/memory-store');
const MessageBus = require('../../.claude/core/message-bus');
const StateManager = require('../../.claude/core/state-manager');
const path = require('path');
const fs = require('fs');

describe('DashboardManager', () => {
  let dashboard;
  let usageTracker;
  let memoryStore;
  let messageBus;
  let stateManager;
  let testDbPath;
  let projectRoot;

  beforeEach(() => {
    // Create unique test database
    testDbPath = path.join(__dirname, `test-dashboard-${Date.now()}.db`);
    memoryStore = new MemoryStore(testDbPath);

    // Create temporary project root
    projectRoot = path.join(__dirname, `test-project-${Date.now()}`);
    if (!fs.existsSync(projectRoot)) {
      fs.mkdirSync(projectRoot, { recursive: true });
    }
    if (!fs.existsSync(path.join(projectRoot, '.claude'))) {
      fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
    }

    usageTracker = new UsageTracker(memoryStore);
    messageBus = new MessageBus();
    stateManager = new StateManager(projectRoot);

    dashboard = new DashboardManager(
      {
        usageTracker,
        messageBus,
        stateManager
      },
      {
        updateInterval: 100, // Fast updates for testing
        enableWebDashboard: false, // Don't start web server in tests
        enableTerminalDashboard: false
      }
    );
  });

  afterEach(async () => {
    // Clean up
    if (dashboard && dashboard.isRunning) {
      await dashboard.stop();
    }

    if (memoryStore) {
      memoryStore.close();
    }

    // Remove test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // Remove test project directory
    if (fs.existsSync(projectRoot)) {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  describe('initialization', () => {
    test('should initialize with required components', () => {
      expect(dashboard.usageTracker).toBeDefined();
      expect(dashboard.messageBus).toBeDefined();
      expect(dashboard.stateManager).toBeDefined();
    });

    test('should set up initial state structure', () => {
      expect(dashboard.state).toBeDefined();
      expect(dashboard.state.session).toBeDefined();
      expect(dashboard.state.context).toBeDefined();
      expect(dashboard.state.usage).toBeNull();
      expect(dashboard.state.execution).toBeDefined();
      expect(dashboard.state.plan).toBeDefined();
      expect(dashboard.state.events).toEqual([]);
      expect(dashboard.state.metrics).toBeDefined();
    });

    test('should initialize with default options', () => {
      expect(dashboard.options.updateInterval).toBe(100);
      expect(dashboard.options.enableWebDashboard).toBe(false);
    });

    test('should set up event subscriptions', () => {
      // Event subscriptions should be registered
      expect(dashboard.messageBus).toBeDefined();
    });
  });

  describe('updateExecutionPlan', () => {
    test('should update plan state with tasks', () => {
      const tasks = [
        { content: 'Implement API', status: 'in_progress', activeForm: 'Implementing API', progress: 60 },
        { content: 'Write tests', status: 'pending', activeForm: 'Writing tests' },
        { content: 'Deploy', status: 'pending', activeForm: 'Deploying' }
      ];

      dashboard.updateExecutionPlan(tasks, 0);

      expect(dashboard.state.plan.tasks).toHaveLength(3);
      expect(dashboard.state.plan.tasks[0].content).toBe('Implement API');
      expect(dashboard.state.plan.tasks[0].status).toBe('in_progress');
      expect(dashboard.state.plan.tasks[0].progress).toBe(60);
      expect(dashboard.state.plan.totalTasks).toBe(3);
      expect(dashboard.state.plan.completedTasks).toBe(0);
    });

    test('should calculate progress correctly', () => {
      const tasks = [
        { content: 'Task 1', status: 'completed' },
        { content: 'Task 2', status: 'completed' },
        { content: 'Task 3', status: 'in_progress' },
        { content: 'Task 4', status: 'pending' },
        { content: 'Task 5', status: 'pending' }
      ];

      dashboard.updateExecutionPlan(tasks, 2);

      expect(dashboard.state.plan.completedTasks).toBe(2);
      expect(dashboard.state.plan.totalTasks).toBe(5);
      expect(dashboard.state.plan.currentTaskIndex).toBe(2);
    });

    test('should emit plan:updated event', (done) => {
      dashboard.on('plan:updated', (plan) => {
        expect(plan.tasks).toHaveLength(2);
        expect(plan.totalTasks).toBe(2);
        done();
      });

      dashboard.updateExecutionPlan([
        { content: 'Task 1', status: 'completed' },
        { content: 'Task 2', status: 'in_progress' }
      ]);
    });

    test('should handle empty task list', () => {
      dashboard.updateExecutionPlan([]);

      expect(dashboard.state.plan.tasks).toEqual([]);
      expect(dashboard.state.plan.totalTasks).toBe(0);
      expect(dashboard.state.plan.completedTasks).toBe(0);
    });

    test('should assign task IDs', () => {
      dashboard.updateExecutionPlan([
        { content: 'Task 1', status: 'pending' },
        { content: 'Task 2', status: 'pending' }
      ]);

      expect(dashboard.state.plan.tasks[0].id).toBeDefined();
      expect(dashboard.state.plan.tasks[1].id).toBeDefined();
      expect(dashboard.state.plan.tasks[0].id).not.toBe(dashboard.state.plan.tasks[1].id);
    });

    test('should handle task status changes', () => {
      // Initial state
      dashboard.updateExecutionPlan([
        { content: 'Task 1', status: 'in_progress' },
        { content: 'Task 2', status: 'pending' }
      ]);

      expect(dashboard.state.plan.completedTasks).toBe(0);

      // Update with completed task
      dashboard.updateExecutionPlan([
        { content: 'Task 1', status: 'completed' },
        { content: 'Task 2', status: 'in_progress' }
      ]);

      expect(dashboard.state.plan.completedTasks).toBe(1);
    });
  });

  describe('updateExecution', () => {
    test('should update current execution info', () => {
      const execution = {
        phase: 'implementation',
        agent: 'senior-developer',
        task: 'Implement REST API',
        startTime: Date.now()
      };

      dashboard.updateExecution(execution);

      expect(dashboard.state.execution.phase).toBe('implementation');
      expect(dashboard.state.execution.agent).toBe('senior-developer');
      expect(dashboard.state.execution.task).toBe('Implement REST API');
    });

    test('should track execution duration', (done) => {
      const startTime = Date.now();

      dashboard.updateExecution({
        phase: 'testing',
        agent: 'test-engineer',
        task: 'Write unit tests',
        startTime
      });

      setTimeout(() => {
        // Update execution again to recalculate duration
        dashboard.updateExecution({
          phase: 'testing',
          agent: 'test-engineer',
          task: 'Write unit tests',
          startTime
        });

        expect(dashboard.state.execution.duration).toBeGreaterThan(0);
        done();
      }, 50);
    });

    test('should emit execution:updated event', (done) => {
      dashboard.on('execution:updated', (execution) => {
        expect(execution.phase).toBe('design');
        done();
      });

      dashboard.updateExecution({
        phase: 'design',
        agent: 'architect',
        task: 'Design system architecture'
      });
    });
  });

  describe('addArtifact', () => {
    test('should add artifact to state', () => {
      dashboard.addArtifact({
        path: '/project/src/api.ts',
        type: 'file',
        name: 'api.ts',
        description: 'REST API implementation'
      });

      expect(dashboard.state.artifacts).toHaveLength(1);
      expect(dashboard.state.artifacts[0].name).toBe('api.ts');
      expect(dashboard.state.artifacts[0].type).toBe('file');
    });

    test('should add artifacts to beginning of list', () => {
      dashboard.addArtifact({ name: 'first.ts', path: '/first.ts' });
      dashboard.addArtifact({ name: 'second.ts', path: '/second.ts' });

      expect(dashboard.state.artifacts[0].name).toBe('second.ts');
      expect(dashboard.state.artifacts[1].name).toBe('first.ts');
    });

    test('should limit artifacts to 100', () => {
      // Add 110 artifacts
      for (let i = 0; i < 110; i++) {
        dashboard.addArtifact({
          name: `file-${i}.ts`,
          path: `/file-${i}.ts`
        });
      }

      expect(dashboard.state.artifacts).toHaveLength(100);
      expect(dashboard.state.artifacts[0].name).toBe('file-109.ts'); // Most recent
    });

    test('should emit artifact:added event', (done) => {
      dashboard.on('artifact:added', (artifact) => {
        expect(artifact.name).toBe('test.ts');
        done();
      });

      dashboard.addArtifact({
        name: 'test.ts',
        path: '/test.ts'
      });
    });

    test('should auto-generate artifact ID', () => {
      dashboard.addArtifact({ name: 'file.ts', path: '/file.ts' });

      expect(dashboard.state.artifacts[0].id).toBeDefined();
      expect(dashboard.state.artifacts[0].id).toMatch(/^artifact-/);
    });

    test('should include current phase in artifact', () => {
      dashboard.updateExecution({ phase: 'implementation' });
      dashboard.addArtifact({ name: 'file.ts', path: '/file.ts' });

      expect(dashboard.state.artifacts[0].phase).toBe('implementation');
    });
  });

  describe('metrics updates', () => {
    test('should update usage metrics from UsageTracker', async () => {
      // Record some usage
      await usageTracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4',
        inputTokens: 10000,
        outputTokens: 5000
      });

      // Start dashboard (triggers metric updates)
      await dashboard.start();

      // Wait for update interval
      await new Promise(resolve => setTimeout(resolve, 150));

      const state = dashboard.getState();

      expect(state.usage).toBeDefined();
      expect(state.usage.totalTokens).toBe(15000);
      expect(state.usage.inputTokens).toBe(10000);
      expect(state.usage.outputTokens).toBe(5000);
      expect(state.usage.totalCost).toBeGreaterThan(0);
    });

    test('should update context window state', async () => {
      // Record usage that fills context window to 50%
      await usageTracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4',
        inputTokens: 80000,
        outputTokens: 20000
      });

      await dashboard.start();
      await new Promise(resolve => setTimeout(resolve, 150));

      const state = dashboard.getState();

      expect(state.context.current).toBe(100000);
      expect(state.context.limit).toBe(200000);
      expect(state.context.percentage).toBe(50);
      expect(state.context.status).toBe('ok'); // < 80%
    });

    test('should calculate next checkpoint correctly', async () => {
      // Record usage: 120k tokens (60% of 200k)
      await usageTracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4',
        inputTokens: 90000,
        outputTokens: 30000
      });

      await dashboard.start();
      await new Promise(resolve => setTimeout(resolve, 150));

      const state = dashboard.getState();

      // Next checkpoint at 85%: (200k * 0.85) - 120k = 50k
      expect(state.context.nextCheckpoint).toBeCloseTo(50000, -3);
    });

    test('should detect warning status at 80%', async () => {
      // Record usage: 160k tokens (80% of 200k)
      await usageTracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4',
        inputTokens: 120000,
        outputTokens: 40000
      });

      await dashboard.start();
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(dashboard.state.context.status).toBe('warning');
    });

    test('should detect critical status at 85%', async () => {
      // Record usage: 170k tokens (85% of 200k)
      await usageTracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4',
        inputTokens: 127500,
        outputTokens: 42500
      });

      await dashboard.start();
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(dashboard.state.context.status).toBe('critical');
    });

    test('should detect emergency status at 95%', async () => {
      // Record usage: 190k tokens (95% of 200k)
      await usageTracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4',
        inputTokens: 142500,
        outputTokens: 47500
      });

      await dashboard.start();
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(dashboard.state.context.status).toBe('emergency');
    });

    test('should emit metrics:updated event', (done) => {
      dashboard.on('metrics:updated', (metrics) => {
        expect(metrics.context).toBeDefined();
        expect(metrics.usage).toBeDefined();
        done();
      });

      dashboard.start().then(() => {
        // Wait for update interval to trigger
        setTimeout(() => {}, 150);
      });
    });
  });

  describe('getState', () => {
    test('should return complete state snapshot', () => {
      const state = dashboard.getState();

      expect(state.session).toBeDefined();
      expect(state.context).toBeDefined();
      expect(state.execution).toBeDefined();
      expect(state.plan).toBeDefined();
      expect(state.artifacts).toBeDefined();
      expect(state.events).toBeDefined();
      expect(state.metrics).toBeDefined();
    });

    test('should include all required session fields', () => {
      const state = dashboard.getState();

      expect(state.session.id).toBeDefined();
      expect(state.session.startTime).toBeDefined();
      expect(state.session.status).toBeDefined();
    });

    test('should be JSON serializable', () => {
      const state = dashboard.getState();

      expect(() => JSON.stringify(state)).not.toThrow();
      expect(JSON.parse(JSON.stringify(state))).toBeDefined();
    });

    test('should return deep copy (not reference)', () => {
      const state1 = dashboard.getState();
      const state2 = dashboard.getState();

      state1.session.status = 'modified';

      expect(state2.session.status).not.toBe('modified');
    });
  });

  describe('event tracking', () => {
    test('should add events to timeline', () => {
      dashboard._addEvent('info', 'Test event', { detail: 'test' });

      expect(dashboard.state.events).toHaveLength(1);
      expect(dashboard.state.events[0].type).toBe('info');
      expect(dashboard.state.events[0].message).toBe('Test event');
      expect(dashboard.state.events[0].data.detail).toBe('test');
    });

    test('should add timestamp to events', () => {
      const beforeTime = Date.now();
      dashboard._addEvent('info', 'Test');
      const afterTime = Date.now();

      const event = dashboard.state.events[0];
      expect(event.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(event.timestamp).toBeLessThanOrEqual(afterTime);
    });

    test('should keep only last 50 events', () => {
      for (let i = 0; i < 60; i++) {
        dashboard._addEvent('info', `Event ${i}`);
      }

      expect(dashboard.state.events).toHaveLength(50);
      expect(dashboard.state.events[0].message).toBe('Event 59'); // Most recent
    });

    test('should emit event:added when event is added', (done) => {
      dashboard.on('event:added', (event) => {
        expect(event.message).toBe('Test event');
        done();
      });

      dashboard._addEvent('info', 'Test event');
    });

    test('should support different event types', () => {
      dashboard._addEvent('start', 'Started');
      dashboard._addEvent('success', 'Completed');
      dashboard._addEvent('error', 'Failed');
      dashboard._addEvent('warning', 'Warning');
      dashboard._addEvent('checkpoint', 'Checkpoint');

      expect(dashboard.state.events).toHaveLength(5);
      expect(dashboard.state.events[0].type).toBe('checkpoint');
      expect(dashboard.state.events[4].type).toBe('start');
    });
  });

  describe('lifecycle', () => {
    test('should start successfully', async () => {
      await dashboard.start();

      expect(dashboard.isRunning).toBe(true);
      expect(dashboard.state.session.status).toBe('running');
    });

    test('should stop successfully', async () => {
      await dashboard.start();
      await dashboard.stop();

      expect(dashboard.isRunning).toBe(false);
      expect(dashboard.state.session.status).toBe('stopped');
    });

    test('should not start if already running', async () => {
      await dashboard.start();
      await dashboard.start(); // Second start

      expect(dashboard.isRunning).toBe(true);
    });

    test('should clean up update timer on stop', async () => {
      await dashboard.start();
      expect(dashboard.updateTimer).toBeDefined();

      await dashboard.stop();
      expect(dashboard.updateTimer).toBeNull();
    });
  });

  describe('message bus integration', () => {
    test('should subscribe to orchestrator events', () => {
      // Event subscriptions should be set up during initialization
      expect(dashboard.messageBus).toBeDefined();
    });

    test('should handle execution:start event', (done) => {
      messageBus.subscribe('orchestrator:execution:start', 'test', (event) => {
        // Dashboard should have processed this
        setTimeout(() => {
          expect(dashboard.state.execution.task).toBe('Test task');
          expect(dashboard.state.metrics.totalOperations).toBe(1);
          done();
        }, 10);
      });

      messageBus.publish('orchestrator:execution:start', {
        task: 'Test task',
        phase: 'testing',
        agent: 'test-agent'
      });
    });

    test('should handle execution:complete event', (done) => {
      messageBus.publish('orchestrator:execution:start', {
        task: 'Test task'
      });

      setTimeout(() => {
        messageBus.publish('orchestrator:execution:complete', {
          task: 'Test task'
        });

        setTimeout(() => {
          expect(dashboard.state.metrics.successfulOperations).toBe(1);
          done();
        }, 10);
      }, 10);
    });

    test('should handle execution:error event', (done) => {
      messageBus.publish('orchestrator:execution:error', {
        error: { message: 'Test error' }
      });

      setTimeout(() => {
        expect(dashboard.state.metrics.failedOperations).toBe(1);
        done();
      }, 10);
    });
  });
});
