/**
 * Tests for HookMetrics module
 *
 * Tests hook success/failure rate tracking, persistence, and aggregation.
 */

const path = require('path');
const fs = require('fs');

// Test directory for isolated persistence
const TEST_METRICS_PATH = path.join(__dirname, '..', 'fixtures', 'test-hook-metrics.json');

// Clean up test file before/after tests
function cleanupTestFile() {
  try {
    if (fs.existsSync(TEST_METRICS_PATH)) {
      fs.unlinkSync(TEST_METRICS_PATH);
    }
    const dir = path.dirname(TEST_METRICS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (e) {
    // Ignore cleanup errors
  }
}

// Import after cleanup setup
const {
  HookMetrics,
  getHookMetrics,
  resetHookMetrics,
  HOOK_TYPES,
  ERROR_CATEGORIES,
  DEFAULT_DURATION_BUCKETS
} = require('../../.claude/core/hook-metrics');

describe('HookMetrics', () => {
  let metrics;

  beforeEach(() => {
    cleanupTestFile();
    // Create fresh instance for each test
    metrics = new HookMetrics({
      persistence: {
        path: TEST_METRICS_PATH
      }
    });
  });

  afterEach(() => {
    if (metrics) {
      metrics.close();
    }
    cleanupTestFile();
  });

  describe('initialization', () => {
    test('should initialize with default configuration', () => {
      expect(metrics.metricsId).toMatch(/^hook-metrics-\d+$/);
      expect(metrics.hookCounters).toBeDefined();
      expect(Object.keys(metrics.hookCounters)).toEqual(HOOK_TYPES);
    });

    test('should have counters for all known hook types', () => {
      for (const hookType of HOOK_TYPES) {
        expect(metrics.hookCounters[hookType]).toBeDefined();
        expect(metrics.hookCounters[hookType].success).toBeDefined();
        expect(metrics.hookCounters[hookType].failure).toBeDefined();
        expect(metrics.hookCounters[hookType].timeout).toBeDefined();
        expect(metrics.hookCounters[hookType].duration).toBeDefined();
      }
    });

    test('should have error category counters', () => {
      for (const category of ERROR_CATEGORIES) {
        expect(metrics.errorCounters[category]).toBeDefined();
      }
    });

    test('should initialize rolling windows', () => {
      expect(metrics.rollingWindows.success.minute).toBeDefined();
      expect(metrics.rollingWindows.success.hour).toBeDefined();
      expect(metrics.rollingWindows.success.day).toBeDefined();
      expect(metrics.rollingWindows.failure.minute).toBeDefined();
    });
  });

  describe('recordSuccess', () => {
    test('should increment success counter for hook type', () => {
      metrics.recordSuccess('session-start', 100);

      const stats = metrics.getHookStats('session-start');
      expect(stats.successCount).toBe(1);
      expect(stats.failureCount).toBe(0);
      expect(stats.successRate).toBe(100);
    });

    test('should record duration in histogram', () => {
      metrics.recordSuccess('session-start', 75);
      metrics.recordSuccess('session-start', 150);
      metrics.recordSuccess('session-start', 250);

      const stats = metrics.getHookStats('session-start');
      expect(stats.duration.count).toBe(3);
      expect(stats.duration.avg).toBeCloseTo(158.33, 1);
    });

    test('should update total success counter', () => {
      metrics.recordSuccess('session-start', 100);
      metrics.recordSuccess('session-end', 50);
      metrics.recordSuccess('delegation-hook', 200);

      const summary = metrics.getSummary();
      expect(summary.overall.successCount).toBe(3);
    });

    test('should add to recent executions', () => {
      metrics.recordSuccess('session-start', 100, { extra: 'data' });

      const recent = metrics.getRecentExecutions(5);
      expect(recent.length).toBe(1);
      expect(recent[0].hookType).toBe('session-start');
      expect(recent[0].success).toBe(true);
      expect(recent[0].durationMs).toBe(100);
    });

    test('should update rolling windows', () => {
      metrics.recordSuccess('session-start', 100);
      metrics.recordSuccess('session-start', 100);
      metrics.recordSuccess('session-start', 100);

      const rolling = metrics.getRollingSuccessRate('minute');
      expect(rolling.successCount).toBe(3);
      expect(rolling.failureCount).toBe(0);
      expect(rolling.successRate).toBe(100);
    });
  });

  describe('recordFailure', () => {
    test('should increment failure counter for hook type', () => {
      metrics.recordFailure('session-end', 'timeout', 2000);

      const stats = metrics.getHookStats('session-end');
      expect(stats.successCount).toBe(0);
      expect(stats.failureCount).toBe(1);
      expect(stats.timeoutCount).toBe(1);
      expect(stats.successRate).toBe(0);
    });

    test('should categorize errors correctly', () => {
      metrics.recordFailure('session-start', 'timeout', 100);
      metrics.recordFailure('session-end', 'parse-error', 50);
      metrics.recordFailure('delegation-hook', 'network-error', 200);
      metrics.recordFailure('track-progress', 'unknown', 150);

      const errorStats = metrics.getErrorCategoryStats();
      expect(errorStats.counts.timeout).toBe(1);
      expect(errorStats.counts['parse-error']).toBe(1);
      expect(errorStats.counts['network-error']).toBe(1);
      expect(errorStats.counts.unknown).toBe(1);
      expect(errorStats.total).toBe(4);
    });

    test('should update total failure counter', () => {
      metrics.recordFailure('session-start', 'timeout', 100);
      metrics.recordFailure('session-end', 'network-error', 50);

      const summary = metrics.getSummary();
      expect(summary.overall.failureCount).toBe(2);
    });

    test('should record error details in recent executions', () => {
      metrics.recordFailure('session-end', 'timeout', 2000, { error: 'Request timed out' });

      const recent = metrics.getRecentExecutions(5);
      expect(recent.length).toBe(1);
      expect(recent[0].success).toBe(false);
      expect(recent[0].errorCategory).toBe('timeout');
      expect(recent[0].error).toBe('Request timed out');
    });
  });

  describe('success rate calculations', () => {
    test('should calculate correct success rate', () => {
      // 7 successes, 3 failures = 70% success rate
      for (let i = 0; i < 7; i++) {
        metrics.recordSuccess('session-start', 100);
      }
      for (let i = 0; i < 3; i++) {
        metrics.recordFailure('session-start', 'timeout', 2000);
      }

      const stats = metrics.getHookStats('session-start');
      expect(stats.totalExecutions).toBe(10);
      expect(stats.successRate).toBe(70);
    });

    test('should return 100% for hooks with no executions', () => {
      const stats = metrics.getHookStats('validate-prompt');
      expect(stats.totalExecutions).toBe(0);
      expect(stats.successRate).toBe(100);
    });

    test('should calculate overall success rate correctly', () => {
      // Session-start: 5/5 = 100%
      // Session-end: 3/5 = 60%
      // Overall: 8/10 = 80%
      for (let i = 0; i < 5; i++) {
        metrics.recordSuccess('session-start', 100);
      }
      for (let i = 0; i < 3; i++) {
        metrics.recordSuccess('session-end', 100);
      }
      for (let i = 0; i < 2; i++) {
        metrics.recordFailure('session-end', 'timeout', 2000);
      }

      const summary = metrics.getSummary();
      expect(summary.overall.totalExecutions).toBe(10);
      expect(summary.overall.successRate).toBe(80);
    });
  });

  describe('getSummary', () => {
    test('should return comprehensive summary', () => {
      metrics.recordSuccess('session-start', 100);
      metrics.recordFailure('session-end', 'timeout', 2000);

      const summary = metrics.getSummary();

      expect(summary.timestamp).toBeDefined();
      expect(summary.metricsId).toBeDefined();
      expect(summary.uptime).toBeGreaterThanOrEqual(0);

      expect(summary.overall).toBeDefined();
      expect(summary.overall.totalExecutions).toBe(2);
      expect(summary.overall.successCount).toBe(1);
      expect(summary.overall.failureCount).toBe(1);

      expect(summary.perHook).toBeDefined();
      expect(summary.perHook['session-start']).toBeDefined();
      expect(summary.perHook['session-end']).toBeDefined();

      expect(summary.errorCategories).toBeDefined();
      expect(summary.rolling).toBeDefined();
      expect(summary.recentExecutions).toBeDefined();
    });
  });

  describe('getPerHookStats', () => {
    test('should return stats for all hook types', () => {
      metrics.recordSuccess('session-start', 100);
      metrics.recordSuccess('delegation-hook', 200);

      const perHook = metrics.getPerHookStats();

      expect(Object.keys(perHook).length).toBe(HOOK_TYPES.length);
      expect(perHook['session-start'].successCount).toBe(1);
      expect(perHook['delegation-hook'].successCount).toBe(1);
      expect(perHook['session-end'].successCount).toBe(0);
    });
  });

  describe('rolling windows', () => {
    test('should track success rate within time window', () => {
      metrics.recordSuccess('session-start', 100);
      metrics.recordSuccess('session-start', 100);
      metrics.recordFailure('session-start', 'timeout', 2000);

      const rolling = metrics.getRollingSuccessRate('minute');

      expect(rolling.successCount).toBe(2);
      expect(rolling.failureCount).toBe(1);
      expect(rolling.totalExecutions).toBe(3);
      expect(rolling.successRate).toBeCloseTo(66.67, 1);
    });

    test('should return null for unknown window', () => {
      const rolling = metrics.getRollingSuccessRate('week');
      expect(rolling).toBeNull();
    });
  });

  describe('snapshots', () => {
    test('should take snapshot of current state', () => {
      metrics.recordSuccess('session-start', 100);
      metrics.recordFailure('session-end', 'timeout', 2000);

      const snapshot = metrics.takeSnapshot();

      expect(snapshot.snapshotId).toBeDefined();
      expect(snapshot.timestamp).toBeDefined();
      expect(snapshot.overall.success).toBe(1);
      expect(snapshot.overall.failure).toBe(1);
      expect(snapshot.perHook['session-start'].success).toBe(1);
      expect(snapshot.perHook['session-end'].failure).toBe(1);
    });

    test('should store and retrieve snapshots', () => {
      metrics.recordSuccess('session-start', 100);
      metrics.takeSnapshot();

      metrics.recordFailure('session-end', 'timeout', 2000);
      metrics.takeSnapshot();

      const snapshots = metrics.getSnapshots({ limit: 10 });
      expect(snapshots.length).toBe(2);
    });

    test('should filter snapshots by time', async () => {
      metrics.takeSnapshot();

      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));
      const beforeSecond = Date.now();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Small delay to ensure different timestamp
      metrics.recordSuccess('session-start', 100);
      metrics.takeSnapshot();

      const filtered = metrics.getSnapshots({ since: beforeSecond });
      expect(filtered.length).toBe(1);
    });
  });

  describe('persistence', () => {
    test('should persist metrics to disk', () => {
      metrics.recordSuccess('session-start', 100);
      metrics.recordFailure('session-end', 'timeout', 2000);

      metrics.persist();

      expect(fs.existsSync(TEST_METRICS_PATH)).toBe(true);

      const data = JSON.parse(fs.readFileSync(TEST_METRICS_PATH, 'utf8'));
      expect(data.metricsId).toBe(metrics.metricsId);
    });

    test('should load metrics from disk', () => {
      // Record some data and persist
      metrics.recordSuccess('session-start', 100);
      metrics.recordSuccess('session-start', 100);
      metrics.recordFailure('session-end', 'timeout', 2000);
      metrics.persist();

      // Create new instance that should load from disk
      const newMetrics = new HookMetrics({
        persistence: { path: TEST_METRICS_PATH }
      });

      const summary = newMetrics.getSummary();
      expect(summary.overall.successCount).toBe(2);
      expect(summary.overall.failureCount).toBe(1);

      newMetrics.close();
    });
  });

  describe('reset', () => {
    test('should reset all counters', () => {
      metrics.recordSuccess('session-start', 100);
      metrics.recordFailure('session-end', 'timeout', 2000);

      metrics.reset();

      const summary = metrics.getSummary();
      expect(summary.overall.totalExecutions).toBe(0);
      expect(summary.overall.successCount).toBe(0);
      expect(summary.overall.failureCount).toBe(0);
    });
  });

  describe('retries', () => {
    test('should track retry attempts', () => {
      metrics.recordRetry('session-end', 1);
      metrics.recordRetry('session-end', 2);

      const summary = metrics.getSummary();
      expect(summary.overall.retryCount).toBe(2);
    });
  });

  describe('serialization', () => {
    test('should serialize to JSON correctly', () => {
      metrics.recordSuccess('session-start', 100);
      metrics.recordFailure('session-end', 'timeout', 2000);

      const json = metrics.toJSON();

      expect(json.metricsId).toBeDefined();
      expect(json.hookCounters).toBeDefined();
      expect(json.errorCounters).toBeDefined();
      expect(json.totalSuccess).toBeDefined();
      expect(json.totalFailure).toBeDefined();
    });
  });
});

describe('getHookMetrics singleton', () => {
  beforeEach(() => {
    resetHookMetrics();
    // Clean up any persisted data file that might interfere
    const defaultPath = path.join(__dirname, '../../.claude/data/hook-metrics.json');
    if (fs.existsSync(defaultPath)) {
      try { fs.unlinkSync(defaultPath); } catch (e) { /* ignore */ }
    }
  });

  afterEach(() => {
    resetHookMetrics();
  });

  test('should return same instance', () => {
    const instance1 = getHookMetrics();
    const instance2 = getHookMetrics();

    expect(instance1).toBe(instance2);
  });

  test('should reset singleton correctly', () => {
    const instance1 = getHookMetrics();
    const initialCount = instance1.getSummary().overall.successCount;

    instance1.recordSuccess('session-start', 100);
    const afterRecord = instance1.getSummary().overall.successCount;
    expect(afterRecord).toBe(initialCount + 1);

    resetHookMetrics();

    const instance2 = getHookMetrics();
    instance2.reset(); // Ensure clean state

    const summary = instance2.getSummary();
    expect(summary.overall.successCount).toBe(0);
  });
});

describe('HOOK_TYPES constant', () => {
  test('should include all expected hook types', () => {
    expect(HOOK_TYPES).toContain('session-start');
    expect(HOOK_TYPES).toContain('session-end');
    expect(HOOK_TYPES).toContain('user-prompt-submit');
    expect(HOOK_TYPES).toContain('delegation-hook');
    expect(HOOK_TYPES).toContain('track-progress');
    expect(HOOK_TYPES).toContain('track-usage');
    expect(HOOK_TYPES).toContain('after-execution');
    expect(HOOK_TYPES).toContain('after-code-change');
  });
});

describe('ERROR_CATEGORIES constant', () => {
  test('should include all expected error categories', () => {
    expect(ERROR_CATEGORIES).toContain('timeout');
    expect(ERROR_CATEGORIES).toContain('parse-error');
    expect(ERROR_CATEGORIES).toContain('network-error');
    expect(ERROR_CATEGORIES).toContain('file-error');
    expect(ERROR_CATEGORIES).toContain('validation-error');
    expect(ERROR_CATEGORIES).toContain('unknown');
  });
});
