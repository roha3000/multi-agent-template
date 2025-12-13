/**
 * CheckpointOptimizer Tests
 *
 * Tests for adaptive checkpoint learning, compaction detection, and threshold optimization
 */

const CheckpointOptimizer = require('../../.claude/core/checkpoint-optimizer');
const MemoryStore = require('../../.claude/core/memory-store');
const path = require('path');
const fs = require('fs');

describe('CheckpointOptimizer', () => {
  let memoryStore;
  let optimizer;
  let testDbPath;

  beforeEach(() => {
    // Create unique test database for each test
    testDbPath = path.join(__dirname, `test-checkpoint-${Date.now()}.db`);
    memoryStore = new MemoryStore(testDbPath);

    optimizer = new CheckpointOptimizer({
      memoryStore: memoryStore
    }, {
      initialThreshold: 0.75,
      minThreshold: 0.50,
      maxThreshold: 0.90,
      bufferTokens: 10000,
      learningRate: 0.05,
      targetSuccessRate: 0.95
    });
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

  describe('constructor', () => {
    test('should initialize with default options', () => {
      expect(optimizer.options.initialThreshold).toBe(0.75);
      expect(optimizer.options.minThreshold).toBe(0.50);
      expect(optimizer.options.maxThreshold).toBe(0.90);
      expect(optimizer.thresholds.context).toBe(0.75);
    });

    test('should accept custom options', () => {
      const customOptimizer = new CheckpointOptimizer({
        memoryStore: memoryStore
      }, {
        initialThreshold: 0.60,
        learningRate: 0.10
      });

      expect(customOptimizer.options.initialThreshold).toBe(0.60);
      expect(customOptimizer.options.learningRate).toBe(0.10);
    });

    test('should load learning data from database on init', () => {
      // Create first optimizer and record some data
      const opt1 = new CheckpointOptimizer({ memoryStore }, { initialThreshold: 0.75 });

      opt1.recordCheckpoint({
        contextTokens: 150000,
        maxContextTokens: 200000,
        taskType: 'test'
      }, true);

      // Create second optimizer - should load previous learning data
      const opt2 = new CheckpointOptimizer({ memoryStore }, { initialThreshold: 0.75 });

      expect(opt2.learningData.totalCheckpoints).toBe(1);
    });
  });

  describe('shouldCheckpoint', () => {
    test('should recommend checkpoint when threshold exceeded', () => {
      const result = optimizer.shouldCheckpoint(160000, 200000, 'code-generation');

      expect(result.should).toBe(true);
      expect(result.reason).toContain('threshold');
      expect(result.utilizationPercent).toBeGreaterThan(75);
    });

    test('should not recommend checkpoint below threshold', () => {
      const result = optimizer.shouldCheckpoint(100000, 200000, 'code-generation');

      expect(result.should).toBe(false);
      expect(result.utilizationPercent).toBeLessThan(75);
    });

    test('should include buffer in calculation', () => {
      const result = optimizer.shouldCheckpoint(190000, 200000, 'code-generation');

      expect(result.should).toBe(true);
      expect(result.reason).toContain('buffer');
    });

    test('should use task-specific predictions when available', () => {
      // Record pattern
      optimizer.learningData.taskPatterns['code-generation'] = {
        samples: 10,
        avgTokens: 5000,
        maxTokens: 8000,
        stdDev: 1000
      };

      const result = optimizer.shouldCheckpoint(180000, 200000, 'code-generation');

      expect(result.should).toBe(true);
      expect(result.predictedNext).toBeDefined();
    });

    test('should return false when disabled', () => {
      optimizer.options.enabled = false;
      const result = optimizer.shouldCheckpoint(180000, 200000, 'test');

      expect(result.should).toBe(false);
      expect(result.reason).toContain('disabled');
    });
  });

  describe('recordCheckpoint', () => {
    test('should record successful checkpoint', () => {
      const checkpoint = {
        id: 'cp-1',
        contextTokens: 150000,
        maxContextTokens: 200000,
        taskType: 'code-generation'
      };

      optimizer.recordCheckpoint(checkpoint, true);

      expect(optimizer.learningData.totalCheckpoints).toBe(1);
      expect(optimizer.learningData.successfulCheckpoints).toBe(1);
      expect(optimizer.learningData.checkpointHistory).toHaveLength(1);
    });

    test('should record failed checkpoint', () => {
      const checkpoint = {
        id: 'cp-1',
        contextTokens: 190000,
        maxContextTokens: 200000,
        taskType: 'code-generation'
      };

      optimizer.recordCheckpoint(checkpoint, false);

      expect(optimizer.learningData.totalCheckpoints).toBe(1);
      expect(optimizer.learningData.successfulCheckpoints).toBe(0);
      expect(optimizer.learningData.failedCheckpoints).toBe(1);
    });

    test('should trigger adaptation after minimum samples', () => {
      // Record enough checkpoints to trigger adaptation
      for (let i = 0; i < 6; i++) {
        optimizer.recordCheckpoint({
          contextTokens: 150000,
          maxContextTokens: 200000,
          taskType: 'test'
        }, true);
      }

      // Success rate is 100%, should increase threshold
      const initialThreshold = 0.75;
      expect(optimizer.thresholds.context).toBeGreaterThan(initialThreshold);
    });

    test('should learn task patterns', () => {
      optimizer.recordTaskPattern({
        taskType: 'testing',
        estimatedTokens: 3000,
        actualTokens: 3200
      });

      expect(optimizer.learningData.taskPatterns['testing']).toBeDefined();
      expect(optimizer.learningData.taskPatterns['testing'].samples).toBe(1);
    });

    test('should limit checkpoint history length', () => {
      // Record more than max history
      for (let i = 0; i < 150; i++) {
        optimizer.recordCheckpoint({
          contextTokens: 150000,
          maxContextTokens: 200000,
          taskType: 'test'
        }, true);
      }

      expect(optimizer.learningData.checkpointHistory.length).toBeLessThanOrEqual(100);
    });
  });

  describe('detectCompaction', () => {
    test('should detect compaction when tokens drop significantly', () => {
      optimizer.lastContextSize = 180000;

      const detected = optimizer.detectCompaction(120000);

      expect(detected).toBe(true);
      expect(optimizer.learningData.compactionsDetected).toBe(1);
    });

    test('should not detect compaction on normal decrease', () => {
      optimizer.lastContextSize = 150000;

      const detected = optimizer.detectCompaction(140000);

      expect(detected).toBe(false);
    });

    test('should adjust threshold aggressively on compaction', () => {
      optimizer.lastContextSize = 180000;
      optimizer.thresholds.context = 0.75;

      optimizer.detectCompaction(120000);

      // Threshold should reduce by ~15%
      expect(optimizer.thresholds.context).toBeLessThan(0.70);
    });

    test('should increase buffer on compaction', () => {
      optimizer.lastContextSize = 180000;
      const initialBuffer = optimizer.thresholds.buffer;

      optimizer.detectCompaction(120000);

      expect(optimizer.thresholds.buffer).toBeGreaterThan(initialBuffer);
    });

    test('should not detect compaction on first call', () => {
      optimizer.lastContextSize = 0;

      const detected = optimizer.detectCompaction(150000);

      expect(detected).toBe(false);
    });

    test('should update lastContextSize', () => {
      optimizer.detectCompaction(150000);
      expect(optimizer.lastContextSize).toBe(150000);

      optimizer.detectCompaction(160000);
      expect(optimizer.lastContextSize).toBe(160000);
    });
  });

  describe('adaptThresholds', () => {
    test('should increase threshold on high success rate', () => {
      // Record many successful checkpoints
      for (let i = 0; i < 10; i++) {
        optimizer.learningData.successfulCheckpoints++;
        optimizer.learningData.totalCheckpoints++;
      }

      const initialThreshold = optimizer.thresholds.context;
      optimizer._adaptThresholds();

      expect(optimizer.thresholds.context).toBeGreaterThan(initialThreshold);
    });

    test('should decrease threshold on low success rate', () => {
      // Record many failed checkpoints
      optimizer.learningData.totalCheckpoints = 10;
      optimizer.learningData.successfulCheckpoints = 5; // 50% success rate

      const initialThreshold = optimizer.thresholds.context;
      optimizer._adaptThresholds();

      expect(optimizer.thresholds.context).toBeLessThan(initialThreshold);
    });

    test('should respect minimum threshold', () => {
      optimizer.thresholds.context = 0.51;
      optimizer.learningData.totalCheckpoints = 10;
      optimizer.learningData.successfulCheckpoints = 0; // 0% success

      optimizer._adaptThresholds();

      expect(optimizer.thresholds.context).toBeGreaterThanOrEqual(optimizer.options.minThreshold);
    });

    test('should respect maximum threshold', () => {
      optimizer.thresholds.context = 0.89;
      optimizer.learningData.totalCheckpoints = 10;
      optimizer.learningData.successfulCheckpoints = 10; // 100% success

      optimizer._adaptThresholds();

      expect(optimizer.thresholds.context).toBeLessThanOrEqual(optimizer.options.maxThreshold);
    });

    test('should not adapt with insufficient data', () => {
      optimizer.learningData.totalCheckpoints = 2; // Less than minSessionsForLearning

      const initialThreshold = optimizer.thresholds.context;
      optimizer._adaptThresholds();

      expect(optimizer.thresholds.context).toBe(initialThreshold);
    });
  });

  describe('predictNextTaskTokens', () => {
    test('should predict based on task pattern', () => {
      optimizer.learningData.taskPatterns['testing'] = {
        samples: 10,
        avgTokens: 3000,
        maxTokens: 5000,
        stdDev: 500
      };

      const prediction = optimizer.predictNextTaskTokens('testing');

      expect(prediction.estimated).toBe(3000);
      expect(prediction.conservative).toBeGreaterThan(3000);
      expect(prediction.confidence).toBeGreaterThan(0);
    });

    test('should use fallback for unknown task types', () => {
      const prediction = optimizer.predictNextTaskTokens('unknown-task');

      expect(prediction.estimated).toBe(optimizer.options.fallbackTaskTokens || 5000);
      expect(prediction.confidence).toBe(0);
    });

    test('should increase confidence with more samples', () => {
      optimizer.learningData.taskPatterns['testing'] = {
        samples: 3,
        avgTokens: 3000,
        maxTokens: 5000,
        stdDev: 500
      };

      const lowConfidence = optimizer.predictNextTaskTokens('testing');

      optimizer.learningData.taskPatterns['testing'].samples = 20;
      const highConfidence = optimizer.predictNextTaskTokens('testing');

      expect(highConfidence.confidence).toBeGreaterThan(lowConfidence.confidence);
    });
  });

  describe('getStatistics', () => {
    test('should return current statistics', () => {
      optimizer.recordCheckpoint({
        contextTokens: 150000,
        maxContextTokens: 200000,
        taskType: 'test'
      }, true);

      const stats = optimizer.getStatistics();

      expect(stats.totalCheckpoints).toBe(1);
      expect(stats.successfulCheckpoints).toBe(1);
      expect(stats.successRate).toBe(1.0);
      expect(stats.currentThreshold).toBe(0.75);
    });

    test('should calculate success rate correctly', () => {
      optimizer.learningData.totalCheckpoints = 10;
      optimizer.learningData.successfulCheckpoints = 8;

      const stats = optimizer.getStatistics();

      expect(stats.successRate).toBe(0.8);
    });

    test('should include task patterns', () => {
      optimizer.learningData.taskPatterns['testing'] = {
        samples: 5,
        avgTokens: 3000
      };

      const stats = optimizer.getStatistics();

      expect(stats.taskPatterns).toBeDefined();
      expect(stats.taskPatterns['testing']).toBeDefined();
    });

    test('should include compaction stats', () => {
      optimizer.learningData.compactionsDetected = 2;

      const stats = optimizer.getStatistics();

      expect(stats.compactionsDetected).toBe(2);
    });
  });

  describe('persistence', () => {
    test('should save learning data to database', async () => {
      optimizer.recordCheckpoint({
        contextTokens: 150000,
        maxContextTokens: 200000,
        taskType: 'test'
      }, true);

      // Verify data was saved
      const stmt = memoryStore.db.prepare('SELECT * FROM checkpoint_learning');
      const rows = stmt.all();

      expect(rows.length).toBeGreaterThan(0);
    });

    test('should load learning data from database', async () => {
      // Save data with first optimizer
      optimizer.recordCheckpoint({
        contextTokens: 150000,
        maxContextTokens: 200000,
        taskType: 'test'
      }, true);

      // Create new optimizer - should load data
      const newOptimizer = new CheckpointOptimizer({ memoryStore }, {});
      await newOptimizer.initialize();

      expect(newOptimizer.learningData.totalCheckpoints).toBe(1);
    });

    test('should handle missing database gracefully', async () => {
      memoryStore.close();

      const newOptimizer = new CheckpointOptimizer({ memoryStore: null }, {});
      await newOptimizer.initialize();

      expect(newOptimizer.learningData.totalCheckpoints).toBe(0);
    });
  });

  describe('edge cases', () => {
    test('should handle zero context size', () => {
      const result = optimizer.shouldCheckpoint(0, 200000, 'test');

      expect(result.should).toBe(false);
      expect(result.utilizationPercent).toBe(0);
    });

    test('should handle context size exceeding max', () => {
      const result = optimizer.shouldCheckpoint(250000, 200000, 'test');

      expect(result.should).toBe(true);
      expect(result.utilizationPercent).toBeGreaterThan(100);
    });

    test('should handle negative token values', () => {
      const result = optimizer.shouldCheckpoint(-1000, 200000, 'test');

      expect(result.should).toBe(false);
    });

    test('should handle very small task patterns', () => {
      optimizer.learningData.taskPatterns['tiny'] = {
        samples: 1,
        avgTokens: 10,
        maxTokens: 20,
        stdDev: 5
      };

      const prediction = optimizer.predictNextTaskTokens('tiny');

      expect(prediction.estimated).toBeGreaterThan(0);
    });

    test('should handle concurrent checkpoint recording', () => {
      // Simulate concurrent calls
      const checkpoints = Array(10).fill(null).map((_, i) => ({
        id: `cp-${i}`,
        contextTokens: 150000,
        maxContextTokens: 200000,
        taskType: 'test'
      }));

      checkpoints.forEach(cp => optimizer.recordCheckpoint(cp, true));

      expect(optimizer.learningData.totalCheckpoints).toBe(10);
    });
  });

  describe('learning scenarios', () => {
    test('should adapt to consistent compaction pattern', () => {
      const initialThreshold = optimizer.thresholds.context;

      // Simulate compaction at 85% repeatedly
      for (let i = 0; i < 3; i++) {
        optimizer.lastContextSize = 170000; // 85%
        optimizer.detectCompaction(100000); // Sudden drop
      }

      expect(optimizer.thresholds.context).toBeLessThan(initialThreshold * 0.7);
    });

    test('should increase confidence with successful checkpoints', () => {
      // Record 20 successful checkpoints
      for (let i = 0; i < 20; i++) {
        optimizer.recordCheckpoint({
          contextTokens: 150000,
          maxContextTokens: 200000,
          taskType: 'test'
        }, true);
      }

      const stats = optimizer.getStatistics();

      expect(stats.successRate).toBe(1.0);
      expect(stats.currentThreshold).toBeGreaterThan(0.75);
    });

    test('should learn optimal threshold over time', () => {
      // Start at 75%
      expect(optimizer.thresholds.context).toBe(0.75);

      // Simulate successful checkpoints at higher utilization
      for (let i = 0; i < 10; i++) {
        optimizer.recordCheckpoint({
          contextTokens: 160000, // 80%
          maxContextTokens: 200000,
          taskType: 'test'
        }, true);
      }

      // Threshold should increase
      expect(optimizer.thresholds.context).toBeGreaterThan(0.75);

      // Simulate failures at even higher utilization
      for (let i = 0; i < 5; i++) {
        optimizer.recordCheckpoint({
          contextTokens: 190000, // 95%
          maxContextTokens: 200000,
          taskType: 'test'
        }, false);
      }

      // Threshold should stabilize or decrease slightly
      const finalStats = optimizer.getStatistics();
      expect(finalStats.successRate).toBeGreaterThan(0.6);
    });
  });
});
