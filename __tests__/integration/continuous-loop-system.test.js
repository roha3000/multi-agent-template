/**
 * Continuous Loop System - Integration Tests
 *
 * Tests for the full continuous loop orchestration with all components integrated
 */

const ContinuousLoopOrchestrator = require('../../.claude/core/continuous-loop-orchestrator');
const MemoryStore = require('../../.claude/core/memory-store');
const TokenCounter = require('../../.claude/core/token-counter');
const UsageTracker = require('../../.claude/core/usage-tracker');
const path = require('path');
const fs = require('fs');

describe('ContinuousLoopOrchestrator - Integration', () => {
  let memoryStore;
  let tokenCounter;
  let usageTracker;
  let orchestrator;
  let testDbPath;

  beforeEach(() => {
    // Create unique test database
    testDbPath = path.join(__dirname, `test-integration-${Date.now()}.db`);
    memoryStore = new MemoryStore(testDbPath);

    tokenCounter = new TokenCounter({
      model: 'claude-sonnet-4-20250514',
      memoryStore: memoryStore
    });

    usageTracker = new UsageTracker(memoryStore, {
      sessionId: `test-session-${Date.now()}`
    });

    orchestrator = new ContinuousLoopOrchestrator(
      {
        memoryStore,
        tokenCounter,
        usageTracker
      },
      {
        enabled: true,

        contextMonitoring: {
          enabled: true,
          contextWindowSize: 200000,
          checkpointThreshold: 0.75,
          bufferTokens: 10000,
          adaptiveLearning: true
        },

        apiLimitTracking: {
          enabled: true,
          plan: 'Pro'
        },

        costBudgets: {
          enabled: true,
          budgets: {
            session: 5.00,
            daily: 25.00
          }
        },

        humanInLoop: {
          enabled: true,
          confidenceThreshold: 0.70,
          learningEnabled: true
        },

        dashboard: {
          enabled: false // Disable dashboard for tests
        }
      }
    );
  });

  afterEach(() => {
    // Clean up
    if (memoryStore) {
      memoryStore.close();
    }

    // Remove test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('initialization', () => {
    test('should initialize all components', () => {
      expect(orchestrator.options.enabled).toBe(true);
      expect(orchestrator.optimizer).toBeDefined();
      expect(orchestrator.limitTracker).toBeDefined();
      expect(orchestrator.hilDetector).toBeDefined();
    });

    test('should load configuration correctly', () => {
      expect(orchestrator.options.contextMonitoring.enabled).toBe(true);
      expect(orchestrator.options.apiLimitTracking.enabled).toBe(true);
      expect(orchestrator.options.costBudgets.enabled).toBe(true);
      expect(orchestrator.options.humanInLoop.enabled).toBe(true);
    });

    test('should initialize session state', () => {
      expect(orchestrator.state.sessionId).toBeDefined();
      expect(orchestrator.state.startTime).toBeGreaterThan(0);
      expect(orchestrator.state.operations).toBe(0);
    });
  });

  describe('checkSafety', () => {
    test('should pass safety check for normal operation', async () => {
      const result = await orchestrator.checkSafety({
        type: 'code-generation',
        task: 'Write unit tests',
        phase: 'testing',
        estimatedTokens: 3000
      });

      expect(result.safe).toBe(true);
      expect(result.action).toBe('PROCEED');
      expect(result.checks).toBeDefined();
    });

    test('should trigger checkpoint at threshold', async () => {
      // Simulate high token usage
      for (let i = 0; i < 75; i++) {
        usageTracker.trackTokens({
          inputTokens: 1500,
          outputTokens: 500,
          model: 'claude-sonnet-4-20250514'
        });
      }

      const result = await orchestrator.checkSafety({
        type: 'code-generation',
        task: 'Continue implementation',
        phase: 'implementation',
        estimatedTokens: 5000
      });

      expect(result.action).toContain('CHECKPOINT');
    });

    test('should detect human review requirement', async () => {
      const result = await orchestrator.checkSafety({
        type: 'infrastructure',
        task: 'Deploy application to production',
        phase: 'deployment',
        estimatedTokens: 2000
      });

      expect(result.checks.humanReview.requiresHuman).toBe(true);
      expect(result.action).toBe('WAIT_FOR_APPROVAL');
    });

    test('should detect API limit warning', async () => {
      // Record many calls to approach limit
      for (let i = 0; i < 4; i++) {
        orchestrator.limitTracker.recordCall(1000);
      }

      const result = await orchestrator.checkSafety({
        type: 'code-generation',
        task: 'Generate code',
        phase: 'implementation',
        estimatedTokens: 1000
      });

      expect(result.checks.apiLimits.level).toBe('WARNING');
    });

    test('should aggregate multiple safety issues', async () => {
      // Create multiple safety concerns
      // 1. High token usage (checkpoint needed)
      for (let i = 0; i < 150; i++) {
        usageTracker.trackTokens({
          inputTokens: 800,
          outputTokens: 200,
          model: 'claude-sonnet-4-20250514'
        });
      }

      // 2. High-risk task (human review)
      const result = await orchestrator.checkSafety({
        type: 'infrastructure',
        task: 'Deploy to production',
        phase: 'deployment',
        estimatedTokens: 2000
      });

      // Should prioritize human review
      expect(result.action).toBe('WAIT_FOR_APPROVAL');
      expect(result.checks.context.safe).toBeDefined();
      expect(result.checks.humanReview.requiresHuman).toBe(true);
    });

    test('should track operation count', async () => {
      const initialOps = orchestrator.state.operations;

      await orchestrator.checkSafety({
        type: 'testing',
        task: 'Run tests',
        phase: 'testing',
        estimatedTokens: 1000
      });

      expect(orchestrator.state.operations).toBe(initialOps + 1);
    });
  });

  describe('checkpoint', () => {
    test('should create checkpoint successfully', async () => {
      const result = await orchestrator.checkpoint({
        reason: 'test-checkpoint',
        taskType: 'testing'
      });

      expect(result.success).toBe(true);
      expect(result.checkpointId).toBeDefined();
      expect(result.checkpoint).toBeDefined();
    });

    test('should record checkpoint in database', async () => {
      const result = await orchestrator.checkpoint({
        reason: 'test-checkpoint',
        taskType: 'testing'
      });

      const stmt = memoryStore.db.prepare('SELECT * FROM checkpoints WHERE id = ?');
      const record = stmt.get(result.checkpointId);

      expect(record).toBeDefined();
      expect(record.reason).toBe('test-checkpoint');
    });

    test('should update state after checkpoint', async () => {
      const initialCheckpoints = orchestrator.state.checkpoints;

      await orchestrator.checkpoint({
        reason: 'test-checkpoint'
      });

      expect(orchestrator.state.checkpoints).toBe(initialCheckpoints + 1);
    });

    test('should include context tokens in checkpoint', async () => {
      // Track some token usage
      usageTracker.trackTokens({
        inputTokens: 5000,
        outputTokens: 3000,
        model: 'claude-sonnet-4-20250514'
      });

      const result = await orchestrator.checkpoint({
        reason: 'test-checkpoint'
      });

      expect(result.checkpoint.contextTokens).toBeGreaterThan(0);
    });
  });

  describe('wrapUp', () => {
    test('should wrap up session gracefully', async () => {
      const result = await orchestrator.wrapUp({
        reason: 'test-complete'
      });

      expect(result.success).toBe(true);
      expect(result.summary).toBeDefined();
    });

    test('should create final checkpoint on wrap up', async () => {
      const result = await orchestrator.wrapUp({
        reason: 'test-complete'
      });

      expect(result.summary.checkpointsCreated).toBeGreaterThan(0);
    });

    test('should generate session summary', async () => {
      // Perform some operations
      await orchestrator.checkSafety({
        type: 'testing',
        task: 'Test 1',
        phase: 'testing',
        estimatedTokens: 1000
      });

      await orchestrator.checkSafety({
        type: 'testing',
        task: 'Test 2',
        phase: 'testing',
        estimatedTokens: 1500
      });

      const result = await orchestrator.wrapUp({
        reason: 'test-complete'
      });

      expect(result.summary.operationsCompleted).toBe(2);
      expect(result.summary.durationMs).toBeGreaterThan(0);
    });

    test('should include learning statistics in summary', async () => {
      const result = await orchestrator.wrapUp({
        reason: 'test-complete'
      });

      expect(result.summary.learningStats).toBeDefined();
      expect(result.summary.learningStats.checkpointOptimizer).toBeDefined();
      expect(result.summary.learningStats.humanInLoop).toBeDefined();
    });
  });

  describe('recordHumanFeedback', () => {
    let reviewId;

    beforeEach(async () => {
      const result = await orchestrator.checkSafety({
        type: 'infrastructure',
        task: 'Deploy to production',
        phase: 'deployment',
        estimatedTokens: 2000
      });

      reviewId = result.reviewId;
    });

    test('should record feedback successfully', async () => {
      const result = await orchestrator.recordHumanFeedback(reviewId, {
        approved: true,
        wasCorrect: true,
        actualNeed: 'yes',
        comment: 'Correct detection'
      });

      expect(result.success).toBe(true);
    });

    test('should update learning system', async () => {
      await orchestrator.recordHumanFeedback(reviewId, {
        approved: true,
        wasCorrect: true,
        actualNeed: 'yes'
      });

      const stats = orchestrator.getStatus();

      expect(stats.humanInLoop.totalDetections).toBe(1);
    });

    test('should handle approval', async () => {
      const result = await orchestrator.recordHumanFeedback(reviewId, {
        approved: true,
        wasCorrect: true,
        actualNeed: 'yes'
      });

      expect(result.approved).toBe(true);
    });

    test('should handle rejection', async () => {
      const result = await orchestrator.recordHumanFeedback(reviewId, {
        approved: false,
        wasCorrect: false,
        actualNeed: 'no',
        comment: 'False positive'
      });

      expect(result.approved).toBe(false);
    });
  });

  describe('getStatus', () => {
    test('should return comprehensive status', () => {
      const status = orchestrator.getStatus();

      expect(status.sessionId).toBeDefined();
      expect(status.operations).toBeDefined();
      expect(status.checkpoints).toBeDefined();
      expect(status.checkpointOptimizer).toBeDefined();
      expect(status.humanInLoop).toBeDefined();
      expect(status.apiLimits).toBeDefined();
    });

    test('should include uptime', () => {
      const status = orchestrator.getStatus();

      expect(status.uptimeMs).toBeGreaterThan(0);
    });

    test('should include cost information', () => {
      usageTracker.trackTokens({
        inputTokens: 10000,
        outputTokens: 5000,
        model: 'claude-sonnet-4-20250514'
      });

      const status = orchestrator.getStatus();

      expect(status.costs).toBeDefined();
      expect(status.costs.sessionCost).toBeGreaterThan(0);
    });
  });

  describe('learning and adaptation', () => {
    test('should learn optimal checkpoint timing', async () => {
      const initialThreshold = orchestrator.optimizer.thresholds.context;

      // Simulate successful checkpoints
      for (let i = 0; i < 10; i++) {
        await orchestrator.checkpoint({
          reason: 'learning-test',
          taskType: 'testing'
        });
      }

      // Threshold might increase with successful checkpoints
      const stats = orchestrator.getStatus();
      expect(stats.checkpointOptimizer.successRate).toBeGreaterThan(0);
    });

    test('should detect and adapt to compaction', async () => {
      const initialThreshold = orchestrator.optimizer.thresholds.context;

      // Simulate compaction
      orchestrator.optimizer.lastContextSize = 180000;
      orchestrator.optimizer.detectCompaction(100000);

      // Threshold should decrease
      expect(orchestrator.optimizer.thresholds.context).toBeLessThan(initialThreshold);
    });

    test('should learn from human feedback', async () => {
      // Trigger multiple human reviews
      for (let i = 0; i < 3; i++) {
        const result = await orchestrator.checkSafety({
          type: 'infrastructure',
          task: 'Deploy to production',
          phase: 'deployment',
          estimatedTokens: 2000
        });

        await orchestrator.recordHumanFeedback(result.reviewId, {
          approved: true,
          wasCorrect: true,
          actualNeed: 'yes'
        });
      }

      const stats = orchestrator.getStatus();

      expect(stats.humanInLoop.totalDetections).toBe(3);
      expect(stats.humanInLoop.precision).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    test('should handle disabled system gracefully', async () => {
      orchestrator.options.enabled = false;

      const result = await orchestrator.checkSafety({
        type: 'testing',
        task: 'Test',
        phase: 'testing',
        estimatedTokens: 1000
      });

      expect(result.safe).toBe(true);
      expect(result.reason).toContain('disabled');
    });

    test('should handle missing dependencies', async () => {
      // Create orchestrator without some components
      const minimalOrchestrator = new ContinuousLoopOrchestrator(
        {
          memoryStore: null,
          tokenCounter: null,
          usageTracker: null
        },
        {
          enabled: true,
          dashboard: { enabled: false }
        }
      );

      await minimalOrchestrator.initialize();

      const result = await minimalOrchestrator.checkSafety({
        type: 'testing',
        task: 'Test',
        phase: 'testing',
        estimatedTokens: 1000
      });

      expect(result).toBeDefined();
    });

    test('should handle database errors gracefully', async () => {
      memoryStore.close();

      const result = await orchestrator.checkpoint({
        reason: 'test-checkpoint'
      });

      // Should handle error without throwing
      expect(result).toBeDefined();
    });

    test('should handle invalid feedback gracefully', async () => {
      const result = await orchestrator.recordHumanFeedback('invalid-id', {
        approved: true
      });

      expect(result).toBeDefined();
    });
  });

  describe('concurrent operations', () => {
    test('should handle concurrent safety checks', async () => {
      const tasks = [
        { type: 'testing', task: 'Test 1', phase: 'testing', estimatedTokens: 1000 },
        { type: 'testing', task: 'Test 2', phase: 'testing', estimatedTokens: 1500 },
        { type: 'testing', task: 'Test 3', phase: 'testing', estimatedTokens: 2000 },
        { type: 'testing', task: 'Test 4', phase: 'testing', estimatedTokens: 1200 },
        { type: 'testing', task: 'Test 5', phase: 'testing', estimatedTokens: 1800 }
      ];

      const promises = tasks.map(task => orchestrator.checkSafety(task));
      const results = await Promise.all(promises);

      expect(results.length).toBe(5);
      results.forEach(r => expect(r.safe).toBeDefined());
    });

    test('should handle concurrent checkpoints', async () => {
      const promises = [
        orchestrator.checkpoint({ reason: 'cp-1' }),
        orchestrator.checkpoint({ reason: 'cp-2' }),
        orchestrator.checkpoint({ reason: 'cp-3' })
      ];

      const results = await Promise.all(promises);

      expect(results.length).toBe(3);
      expect(orchestrator.state.checkpoints).toBeGreaterThanOrEqual(3);
    });
  });

  describe('real-world scenarios', () => {
    test('scenario: safe development workflow', async () => {
      const workflow = [
        { type: 'research', task: 'Research libraries', phase: 'research', estimatedTokens: 2000 },
        { type: 'design', task: 'Design API', phase: 'design', estimatedTokens: 3000 },
        { type: 'code-generation', task: 'Implement API', phase: 'implementation', estimatedTokens: 5000 },
        { type: 'testing', task: 'Write tests', phase: 'testing', estimatedTokens: 3000 }
      ];

      for (const task of workflow) {
        const result = await orchestrator.checkSafety(task);
        expect(result.safe).toBe(true);
        expect(result.action).toMatch(/PROCEED/);
      }

      expect(orchestrator.state.operations).toBe(4);
    });

    test('scenario: production deployment workflow', async () => {
      // Safe tasks first
      await orchestrator.checkSafety({
        type: 'testing',
        task: 'Run tests',
        phase: 'testing',
        estimatedTokens: 2000
      });

      await orchestrator.checkSafety({
        type: 'testing',
        task: 'Verify build',
        phase: 'testing',
        estimatedTokens: 1000
      });

      // Should trigger human review for production deploy
      const deployResult = await orchestrator.checkSafety({
        type: 'infrastructure',
        task: 'Deploy to production',
        phase: 'deployment',
        estimatedTokens: 2000
      });

      expect(deployResult.action).toBe('WAIT_FOR_APPROVAL');
      expect(deployResult.checks.humanReview.requiresHuman).toBe(true);
    });

    test('scenario: approaching context limit', async () => {
      // Simulate high token usage
      for (let i = 0; i < 150; i++) {
        usageTracker.trackTokens({
          inputTokens: 900,
          outputTokens: 100,
          model: 'claude-sonnet-4-20250514'
        });
      }

      const result = await orchestrator.checkSafety({
        type: 'code-generation',
        task: 'Continue work',
        phase: 'implementation',
        estimatedTokens: 5000
      });

      expect(result.action).toMatch(/CHECKPOINT|WRAP/);
    });

    test('scenario: learning from false positives', async () => {
      // Trigger detection
      const result1 = await orchestrator.checkSafety({
        type: 'testing',
        task: 'Write unit tests for payment processing',
        phase: 'testing',
        estimatedTokens: 3000
      });

      if (result1.checks.humanReview.requiresHuman) {
        // User marks as false positive
        await orchestrator.recordHumanFeedback(result1.reviewId, {
          approved: true,
          wasCorrect: false,
          actualNeed: 'no',
          comment: 'Just writing tests, not touching payment code'
        });

        // System should learn
        const stats = orchestrator.getStatus();
        expect(stats.humanInLoop.totalDetections).toBeGreaterThan(0);
      }
    });
  });
});
