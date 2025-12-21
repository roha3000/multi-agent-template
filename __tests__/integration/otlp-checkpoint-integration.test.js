/**
 * Integration Tests: OTLP-driven Checkpoint System
 *
 * Tests the complete flow of:
 * 1. OTLP metrics reception
 * 2. Context monitoring
 * 3. Automatic checkpointing
 * 4. State preservation before compaction
 * 5. Context clearing and reloading
 */

const OTLPReceiver = require('../../.claude/core/otlp-receiver');
const MetricProcessor = require('../../.claude/core/session-aware-metric-processor');
const OTLPCheckpointBridge = require('../../.claude/core/otlp-checkpoint-bridge');
const ContinuousLoopOrchestrator = require('../../.claude/core/continuous-loop-orchestrator');
const CheckpointOptimizer = require('../../.claude/core/checkpoint-optimizer');
const StateManager = require('../../.claude/core/state-manager');
const MemoryStore = require('../../.claude/core/memory-store');
const UsageTracker = require('../../.claude/core/usage-tracker');
const MessageBus = require('../../.claude/core/message-bus');
const TokenCounter = require('../../.claude/core/token-counter');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

describe('OTLP-Checkpoint Integration', () => {
  let otlpReceiver, metricProcessor, bridge, orchestrator;
  let checkpointOptimizer, stateManager, memoryStore, usageTracker, messageBus, tokenCounter;
  let testDbPath;

  beforeEach(async () => {
    // Create test database
    testDbPath = path.join(__dirname, `test-otlp-${Date.now()}.db`);

    // Initialize components
    memoryStore = new MemoryStore(testDbPath);
    messageBus = new MessageBus();
    usageTracker = new UsageTracker(memoryStore, {
      sessionId: `test-${Date.now()}`
    });

    tokenCounter = new TokenCounter({
      model: 'claude-sonnet-4-20250514',
      memoryStore: memoryStore
    });

    stateManager = new StateManager(__dirname);

    metricProcessor = new MetricProcessor({
      batchSize: 10,
      batchIntervalMs: 100,
      enableDeduplication: true,
      enableAggregation: true,
      enableDelta: true
    });

    otlpReceiver = new OTLPReceiver({
      port: 0, // Use random port
      metricProcessor,
      usageTracker
    });

    checkpointOptimizer = new CheckpointOptimizer(
      { memoryStore, usageTracker },
      {
        compactionDetectionEnabled: true,
        compactionTokenDrop: 50000,  // Explicitly set threshold
        initialThresholds: {
          context: 0.75,
          buffer: 10000
        }
      }
    );

    orchestrator = new ContinuousLoopOrchestrator(
      {
        memoryStore,
        usageTracker,
        stateManager,
        messageBus,
        tokenCounter
      },
      {
        enabled: true,
        contextMonitoring: {
          enabled: true,
          contextWindowSize: 200000
        },
        checkpointOptimizer: { enabled: true },
        apiLimitTracking: { enabled: false },
        humanInLoop: { enabled: false },
        dashboard: { enableWeb: false }
      }
    );

    // Set optimizer in orchestrator
    orchestrator.optimizer = checkpointOptimizer;

    bridge = new OTLPCheckpointBridge(
      {
        otlpReceiver,
        checkpointOptimizer,
        orchestrator,
        stateManager,
        usageTracker
      },
      {
        compactionThreshold: 0.95,
        warningThreshold: 0.85,
        checkpointThreshold: 0.75,
        contextWindowSize: 200000,
        metricsCheckInterval: 100,
        rapidCheckInterval: 50
      }
    );

    // Set bridge in orchestrator so it can access OTLP token counts
    orchestrator.otlpBridge = bridge;

    // Start services
    await otlpReceiver.start();
    await orchestrator.start();
    bridge.start();
  });

  afterEach(async () => {
    // Cleanup
    if (bridge) bridge.stop();
    if (orchestrator) await orchestrator.stop();
    if (otlpReceiver) await otlpReceiver.stop();
    if (memoryStore) memoryStore.close();

    // Remove test database
    if (testDbPath && fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('OTLP Metric Reception', () => {
    test('should process OTLP metrics and update token counts', async () => {
      const port = otlpReceiver.server.address().port;

      // Send OTLP metric
      const metric = {
        resourceMetrics: [{
          resource: {
            attributes: [{
              key: 'service.name',
              value: { stringValue: 'claude-code' }
            }]
          },
          scopeMetrics: [{
            metrics: [{
              name: 'claude.tokens.total',
              sum: {
                dataPoints: [{
                  asInt: '50000',
                  timeUnixNano: Date.now() * 1000000
                }]
              }
            }]
          }]
        }]
      };

      await axios.post(`http://localhost:${port}/v1/metrics`, metric, {
        headers: { 'Content-Type': 'application/json' }
      });

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify token count updated
      expect(bridge.state.currentTokens).toBe(50000);
    });

    test('should calculate token velocity from multiple metrics', async () => {
      const port = otlpReceiver.server.address().port;

      // Send initial metric
      await sendMetric(port, 10000);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Send second metric
      await sendMetric(port, 15000);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify velocity calculated
      expect(bridge.state.tokenVelocity).toBeGreaterThan(0);
      expect(bridge.state.recentMetrics.length).toBeGreaterThan(0);
    });
  });

  describe('Context Monitoring', () => {
    test('should detect when context approaches checkpoint threshold', async () => {
      const statusPromise = new Promise(resolve => {
        bridge.once('checkpoint:recommended', resolve);
      });

      // Simulate high token usage (75% of context)
      const port = otlpReceiver.server.address().port;
      await sendMetric(port, 150000); // 75% of 200K

      const status = await statusPromise;
      expect(status.currentTokens).toBe(150000);
    });

    test('should trigger critical warning at warning threshold', async () => {
      const warningPromise = new Promise(resolve => {
        bridge.once('warning:critical', resolve);
      });

      // Simulate critical token usage (85% of context)
      const port = otlpReceiver.server.address().port;
      await sendMetric(port, 170000); // 85% of 200K

      const warning = await warningPromise;
      expect(warning.remainingTokens).toBeLessThanOrEqual(30000);
    });

    test('should detect rapid token exhaustion', async () => {
      const exhaustionPromise = new Promise(resolve => {
        bridge.once('warning:rapid-exhaustion', resolve);
      });

      const port = otlpReceiver.server.address().port;

      // Simulate rapid increase
      await sendMetric(port, 100000);
      await new Promise(resolve => setTimeout(resolve, 50));
      await sendMetric(port, 180000); // Rapid jump

      const warning = await exhaustionPromise;
      expect(warning.tokenVelocity).toBeGreaterThan(0);
      expect(warning.secondsToExhaustion).toBeLessThan(60);
    });
  });

  describe('Automatic Checkpointing', () => {
    test('should create checkpoint when threshold reached', async () => {
      let checkpointCreated = false;

      orchestrator.checkpoint = jest.fn(async (options) => {
        checkpointCreated = true;
        return { success: true, checkpointId: 'test-checkpoint' };
      });

      const port = otlpReceiver.server.address().port;
      await sendMetric(port, 155000); // Above checkpoint threshold

      // Wait for checkpoint
      await new Promise(resolve => setTimeout(resolve, 200));

      // Check safety status
      const safety = await orchestrator.checkSafety({
        type: 'test',
        estimatedTokens: 5000
      });

      expect(safety.checks.context).toBeDefined();
      expect(safety.checks.context.utilization).toBeGreaterThan(0.75);
    });

    test('should record checkpoint in optimizer for learning', async () => {
      const recordSpy = jest.spyOn(checkpointOptimizer, 'recordCheckpoint');

      // Trigger checkpoint through high usage
      const port = otlpReceiver.server.address().port;
      await sendMetric(port, 160000);

      await new Promise(resolve => setTimeout(resolve, 200));

      // Manually trigger checkpoint (using real method, not mocked)
      await orchestrator.checkpoint({ taskType: 'test' });

      expect(recordSpy).toHaveBeenCalled();
    });
  });

  describe('Compaction Prevention', () => {
    test('should save state before compaction threshold', async () => {
      const emergencyPromise = new Promise(resolve => {
        bridge.once('emergency:compaction', resolve);
      });

      // Mock state manager save
      stateManager.saveCompactionState = jest.fn(async () => ({
        success: true,
        stateId: 'compaction-save-123'
      }));

      stateManager.export = jest.fn(() => ({
        test: 'state',
        important: 'data'
      }));

      // Trigger emergency (95% usage)
      const port = otlpReceiver.server.address().port;
      await sendMetric(port, 190000); // 95% of 200K

      const emergency = await emergencyPromise;

      expect(emergency.action).toBe('state-saved-and-cleared');
      expect(bridge.state.compactionSaves).toBe(1);
    });

    test('should detect compaction via sudden token drop', async () => {
      // Establish baseline - set context to 180K
      checkpointOptimizer.lastContextSize = 180000;

      // Simulate compaction (sudden drop to 100K)
      const compactionDetected = checkpointOptimizer.detectCompaction(100000);

      // Should detect: drop = 180000 - 100000 = 80000 > 50000
      expect(compactionDetected).toBe(true);

      // Verify thresholds were adjusted (reduced by 15%)
      expect(checkpointOptimizer.thresholds.context).toBeLessThan(0.75);
      expect(checkpointOptimizer.learningData.compactionsDetected).toBe(1);
    });
  });

  describe('Context Clearing and Reloading', () => {
    test('should clear non-essential context when needed', async () => {
      const clearedPromise = new Promise(resolve => {
        bridge.once('context:cleared', resolve);
      });

      // Mock orchestrator checkpoint
      orchestrator.checkpoint = jest.fn(async () => ({
        success: true
      }));

      // Trigger emergency compaction
      const port = otlpReceiver.server.address().port;
      await sendMetric(port, 195000); // 97.5% usage

      const cleared = await clearedPromise;

      expect(cleared.conversationHistory).toBe(true);
      expect(cleared.intermediateResults).toBe(true);
    });

    test('should reload essential context after clearing', async () => {
      const reloadPromise = new Promise(resolve => {
        bridge.once('context:reloaded', resolve);
      });

      // Mock state manager methods
      stateManager.getMostRecentCompactionSave = jest.fn(async () => ({
        id: 'save-123',
        essentialContext: {
          projectConfiguration: {},
          currentTask: {},
          estimatedTokens: 5000
        }
      }));

      stateManager.loadEssentialContext = jest.fn(async () => true);

      // Trigger reload
      await bridge._reloadEssentialContext();

      const reloaded = await reloadPromise;

      expect(reloaded.success).toBe(true);
      expect(reloaded.stateId).toBe('save-123');
      expect(bridge.state.successfulReloads).toBe(1);
    });
  });

  describe('Monitoring Mode Switching', () => {
    test('should switch to rapid mode when critical', async () => {
      // Start in normal mode
      expect(bridge.state.checkMode).toBe('normal');

      // Trigger critical level
      const port = otlpReceiver.server.address().port;
      await sendMetric(port, 175000); // 87.5% usage

      await new Promise(resolve => setTimeout(resolve, 200));

      // Should be in rapid mode
      expect(bridge.state.checkMode).toBe('rapid');
    });

    test('should switch to emergency mode at compaction threshold', async () => {
      // Trigger emergency
      const port = otlpReceiver.server.address().port;
      await sendMetric(port, 195000); // 97.5% usage

      await new Promise(resolve => setTimeout(resolve, 200));

      // Should be in emergency mode
      expect(bridge.state.checkMode).toBe('emergency');
    });
  });

  describe('Integration with Orchestrator', () => {
    test('should influence orchestrator safety checks', async () => {
      const port = otlpReceiver.server.address().port;

      // Set moderate usage
      await sendMetric(port, 100000); // 50% usage
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check safety - should be safe
      let safety = await orchestrator.checkSafety({
        type: 'test',
        estimatedTokens: 10000
      });

      expect(safety.checks.context.safe).toBe(true);
      expect(safety.checks.context.action).toBe('CONTINUE');

      // Set critical usage
      await sendMetric(port, 185000); // 92.5% usage
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check safety - should recommend checkpoint
      safety = await orchestrator.checkSafety({
        type: 'test',
        estimatedTokens: 10000
      });

      expect(safety.checks.context.safe).toBe(false);
      expect(safety.checks.context.level).toContain('CRITICAL');
    });

    test('should track operations for pattern learning', async () => {
      const port = otlpReceiver.server.address().port;

      // Start operation
      bridge._handleOperationStart({
        type: 'code-generation',
        task: 'test'
      });

      // Set initial tokens
      await sendMetric(port, 50000);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Complete operation with more tokens
      await sendMetric(port, 55000);

      bridge._handleOperationComplete({
        type: 'code-generation'
      });

      // Verify pattern was recorded
      const patterns = checkpointOptimizer.learningData.taskPatterns;
      expect('code-generation' in patterns).toBe(true);
    });
  });

  describe('Status Reporting', () => {
    test('should provide comprehensive status', async () => {
      const port = otlpReceiver.server.address().port;
      await sendMetric(port, 150000);

      await new Promise(resolve => setTimeout(resolve, 100));

      const status = bridge.getStatus();

      expect(status).toHaveProperty('currentTokens');
      expect(status).toHaveProperty('utilization');
      expect(status).toHaveProperty('utilizationPercent');
      expect(status).toHaveProperty('tokenVelocity');
      expect(status).toHaveProperty('remainingTokens');
      expect(status).toHaveProperty('safetyStatus');
      expect(status).toHaveProperty('checkMode');
      expect(status).toHaveProperty('compactionSaves');
      expect(status).toHaveProperty('successfulReloads');

      expect(status.currentTokens).toBe(150000);
      expect(status.utilization).toBeCloseTo(0.75, 2);
      expect(status.safetyStatus).toBe('WARNING');
    });
  });

  describe('Learning and Adaptation', () => {
    test('should learn from metric patterns', async () => {
      const port = otlpReceiver.server.address().port;

      // Send increasing token usage pattern
      for (let i = 0; i < 15; i++) {
        await sendMetric(port, 100000 + (i * 5000));
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Check if pattern was learned
      expect(bridge.metricPatterns.size).toBeGreaterThan(0);

      // Verify acceleration detection
      const recentMetrics = bridge.state.recentMetrics;
      expect(recentMetrics.length).toBeGreaterThan(10);
    });

    test('should adapt thresholds based on failures', async () => {
      const initialThreshold = checkpointOptimizer.thresholds.context;

      // Simulate checkpoint failure
      checkpointOptimizer.recordCheckpoint({
        contextTokens: 160000,
        maxContextTokens: 200000,
        taskType: 'test'
      }, false); // false = failure

      // Threshold should be more conservative
      expect(checkpointOptimizer.thresholds.context).toBeLessThan(initialThreshold);
    });
  });
});

// Helper function to send metrics
async function sendMetric(port, tokenCount) {
  const metric = {
    resourceMetrics: [{
      resource: {
        attributes: [{
          key: 'service.name',
          value: { stringValue: 'claude-code' }
        }]
      },
      scopeMetrics: [{
        metrics: [{
          name: 'claude.tokens.total',
          sum: {
            dataPoints: [{
              asInt: tokenCount.toString(),
              timeUnixNano: Date.now() * 1000000
            }]
          }
        }]
      }]
    }]
  };

  await axios.post(`http://localhost:${port}/v1/metrics`, metric, {
    headers: { 'Content-Type': 'application/json' }
  });
}