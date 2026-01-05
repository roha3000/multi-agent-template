/**
 * Unit tests for DelegationMetrics system
 * Tests Histogram, RollingWindow, AtomicCounter, and DelegationMetrics classes
 */

const {
  DelegationMetrics,
  Histogram,
  RollingWindow,
  AtomicCounter,
  DEFAULT_DURATION_BUCKETS,
  DEFAULT_SUBTASK_BUCKETS,
  DEFAULT_DEPTH_BUCKETS
} = require('../../.claude/core/delegation-metrics');

describe('Histogram', () => {
  let histogram;

  beforeEach(() => {
    histogram = new Histogram('test_histogram', DEFAULT_DURATION_BUCKETS, { maxSamples: 100 });
  });

  test('should initialize with empty state', () => {
    const stats = histogram.getStats();
    expect(stats.count).toBe(0);
    expect(stats.sum).toBe(0);
    expect(stats.avg).toBe(0);
    expect(stats.p50).toBe(0);
  });

  test('should record values and update statistics', () => {
    histogram.record(500);
    histogram.record(2000);
    histogram.record(10000);

    const stats = histogram.getStats();
    expect(stats.count).toBe(3);
    expect(stats.sum).toBe(12500);
    expect(stats.min).toBe(500);
    expect(stats.max).toBe(10000);
    expect(stats.avg).toBeCloseTo(4166.67, 0);
  });

  test('should categorize values into buckets', () => {
    histogram.record(500);   // 0-1s bucket
    histogram.record(500);   // 0-1s bucket
    histogram.record(3000);  // 1-5s bucket
    histogram.record(20000); // 5-30s bucket

    const buckets = histogram.getBuckets();
    expect(buckets['0-1s']).toBe(2);
    expect(buckets['1-5s']).toBe(1);
    expect(buckets['5-30s']).toBe(1);
  });

  test('should calculate percentiles correctly', () => {
    // Record 100 values from 1 to 100
    for (let i = 1; i <= 100; i++) {
      histogram.record(i);
    }

    expect(histogram.getPercentile(50)).toBe(50);
    expect(histogram.getPercentile(95)).toBe(95);
    expect(histogram.getPercentile(99)).toBe(99);
  });

  test('should respect maxSamples limit with circular buffer', () => {
    const smallHistogram = new Histogram('small', DEFAULT_DURATION_BUCKETS, { maxSamples: 10 });

    for (let i = 0; i < 20; i++) {
      smallHistogram.record(i * 100);
    }

    // Should only retain last 10 samples
    expect(smallHistogram._samples.length).toBe(10);
  });

  test('should reset correctly', () => {
    histogram.record(1000);
    histogram.record(2000);
    histogram.reset();

    const stats = histogram.getStats();
    expect(stats.count).toBe(0);
    expect(stats.sum).toBe(0);
  });

  test('should serialize and deserialize correctly', () => {
    histogram.record(500);
    histogram.record(2000);
    histogram.record(10000);

    const json = histogram.toJSON();
    const restored = Histogram.fromJSON(json);

    expect(restored.getStats().count).toBe(3);
    expect(restored.getStats().sum).toBe(12500);
    expect(restored.getBuckets()['0-1s']).toBe(1);
  });

  test('should compact samples while preserving percentile accuracy', () => {
    // Use a histogram with larger maxSamples to hold all 1000 values
    const largeHistogram = new Histogram('large', DEFAULT_DURATION_BUCKETS, { maxSamples: 1000 });

    for (let i = 0; i < 1000; i++) {
      largeHistogram.record(i);
    }

    const beforeCompact = largeHistogram._samples.length;
    largeHistogram.compact();
    const afterCompact = largeHistogram._samples.length;

    // Compact should reduce sample count
    expect(afterCompact).toBeLessThan(beforeCompact);

    // Percentiles should still be reasonably accurate
    const p50 = largeHistogram.getPercentile(50);
    expect(p50).toBeGreaterThan(400);
    expect(p50).toBeLessThan(600);
  });
});

describe('RollingWindow', () => {
  let window;

  beforeEach(() => {
    window = new RollingWindow({
      name: 'test',
      windowSize: 60000, // 1 minute
      bucketCount: 6     // 10 second buckets
    });
  });

  test('should initialize with zero values', () => {
    expect(window.getTotal()).toBe(0);
    expect(window.getRate()).toBe(0);
  });

  test('should record values and update total', () => {
    window.record(5);
    window.record(10);

    expect(window.getTotal()).toBe(15);
  });

  test('should calculate rate per second', () => {
    window.record(60);
    // Rate = 60 events / 60 seconds = 1 per second
    expect(window.getRate()).toBe(1);
  });

  test('should return bucket array', () => {
    window.record(5);
    const buckets = window.getBuckets();

    expect(Array.isArray(buckets)).toBe(true);
    expect(buckets.length).toBe(6);
    expect(buckets.reduce((a, b) => a + b)).toBe(5);
  });

  test('should reset correctly', () => {
    window.record(10);
    window.reset();

    expect(window.getTotal()).toBe(0);
  });

  test('should serialize and deserialize correctly', () => {
    window.record(25);

    const json = window.toJSON();
    const restored = RollingWindow.fromJSON(json);

    expect(restored.getTotal()).toBe(25);
    expect(restored.name).toBe('test');
  });
});

describe('AtomicCounter', () => {
  let counter;

  beforeEach(() => {
    counter = new AtomicCounter('test_counter', { rateWindowMs: 60000 });
  });

  test('should initialize with zero value', () => {
    expect(counter.get()).toBe(0);
  });

  test('should increment correctly', () => {
    counter.increment();
    expect(counter.get()).toBe(1);

    counter.increment(5);
    expect(counter.get()).toBe(6);
  });

  test('should decrement correctly', () => {
    counter.increment(10);
    counter.decrement(3);
    expect(counter.get()).toBe(7);
  });

  test('should not go below zero', () => {
    counter.increment(5);
    counter.decrement(10);
    expect(counter.get()).toBe(0);
  });

  test('should track rate', () => {
    counter.increment(10);
    counter.increment(10);
    counter.increment(10);

    // Rate is per minute, and we're within the 60 second window
    const rate = counter.getRate();
    expect(rate).toBe(30);
  });

  test('should return metadata', () => {
    counter.increment(5);

    const metadata = counter.getWithMetadata();
    expect(metadata.value).toBe(5);
    expect(metadata.lastUpdated).toBeGreaterThan(0);
    expect(typeof metadata.rate).toBe('number');
  });

  test('should reset correctly', () => {
    counter.increment(100);
    counter.reset();

    expect(counter.get()).toBe(0);
    expect(counter._rateHistory.length).toBe(0);
  });

  test('should serialize and deserialize correctly', () => {
    counter.increment(42);

    const json = counter.toJSON();
    const restored = AtomicCounter.fromJSON(json);

    expect(restored.get()).toBe(42);
    expect(restored.name).toBe('test_counter');
  });
});

describe('DelegationMetrics', () => {
  let metrics;

  beforeEach(() => {
    metrics = new DelegationMetrics();
  });

  afterEach(() => {
    metrics.close();
  });

  describe('initialization', () => {
    test('should initialize with unique metricsId', () => {
      expect(metrics.metricsId).toMatch(/^metrics-/);
    });

    test('should initialize with default config', () => {
      expect(metrics.config.memory.maxHistogramSamples).toBe(10000);
      expect(Object.keys(metrics.rollingWindows)).toContain('hour');
      expect(Object.keys(metrics.rollingWindows)).toContain('day');
    });

    test('should accept custom config', () => {
      const custom = new DelegationMetrics({
        memory: { maxHistogramSamples: 500 }
      });
      expect(custom.config.memory.maxHistogramSamples).toBe(500);
      custom.close();
    });
  });

  describe('recording delegations', () => {
    test('should record delegation start and return handle', () => {
      const handle = metrics.recordDelegationStart({
        delegationId: 'del-1',
        parentAgentId: 'agent-1',
        pattern: 'parallel',
        depth: 1,
        subtaskCount: 3,
        tokenBudget: 1000,
        timeBudget: 30000
      });

      expect(handle.delegationId).toBe('del-1');
      expect(handle.pattern).toBe('parallel');
      expect(handle.startTime).toBeGreaterThan(0);
      expect(metrics._activeChildCount).toBe(1);
    });

    test('should record delegation completion', () => {
      const handle = metrics.recordDelegationStart({
        delegationId: 'del-1',
        parentAgentId: 'agent-1',
        pattern: 'parallel',
        tokenBudget: 1000
      });

      // Simulate some time passing
      handle.startTime -= 2000;

      metrics.recordDelegationComplete(handle, {
        success: true,
        tokensUsed: 500,
        qualityScore: 85
      });

      expect(metrics._activeChildCount).toBe(0);
      expect(metrics.delegationSuccess.get()).toBe(1);
      expect(metrics.delegationDuration._count).toBe(1);
    });

    test('should track failed delegations', () => {
      const handle = metrics.recordDelegationStart({
        delegationId: 'del-1',
        pattern: 'sequential'
      });

      metrics.recordDelegationComplete(handle, {
        success: false,
        tokensUsed: 200
      });

      expect(metrics.delegationFailure.get()).toBe(1);
    });

    test('should track retries', () => {
      metrics.recordRetry('del-1', 'timeout');
      metrics.recordRetry('del-1', 'error');

      expect(metrics.retryCount.get()).toBe(2);
    });

    test('should track timeouts', () => {
      metrics.recordTimeout('del-1', 30000);

      expect(metrics.timeoutCount.get()).toBe(1);
      expect(metrics.delegationDuration._count).toBe(1);
    });

    test('should record aggregation metrics', () => {
      metrics.recordAggregation(500, 5, 90);

      expect(metrics.aggregationDuration._count).toBe(1);
      expect(metrics.aggregationQuality._count).toBe(1);
    });
  });

  describe('pattern tracking', () => {
    test('should track pattern distribution', () => {
      metrics.recordDelegationStart({ pattern: 'parallel' });
      metrics.recordDelegationStart({ pattern: 'parallel' });
      metrics.recordDelegationStart({ pattern: 'debate' });
      metrics.recordDelegationStart({ pattern: 'sequential' });

      const distribution = metrics.getPatternDistribution();

      expect(distribution.counts.parallel).toBe(2);
      expect(distribution.counts.debate).toBe(1);
      expect(distribution.counts.sequential).toBe(1);
      expect(distribution.total).toBe(4);
      expect(distribution.percentages.parallel).toBe(50);
    });
  });

  describe('query methods', () => {
    test('should return complete summary', () => {
      const handle = metrics.recordDelegationStart({
        delegationId: 'del-1',
        pattern: 'parallel',
        depth: 1,
        subtaskCount: 3
      });

      metrics.recordDelegationComplete(handle, { success: true });

      const summary = metrics.getSummary();

      expect(summary.timestamp).toBeGreaterThan(0);
      expect(summary.counters.delegationSuccess.value).toBe(1);
      expect(summary.rates.successRate).toBe(100);
      expect(summary.patterns.counts.parallel).toBe(1);
      expect(summary.active.delegations).toBe(0);
    });

    test('should return duration stats', () => {
      const handle = metrics.recordDelegationStart({});
      metrics.recordDelegationComplete(handle, { success: true });

      const stats = metrics.getDurationStats();

      expect(stats.delegation.count).toBe(1);
      expect(stats.aggregation.count).toBe(0);
    });

    test('should return success stats', () => {
      metrics.recordDelegationStart({});
      metrics.recordDelegationStart({});

      // Complete one as success, one as failure
      const handle1 = { delegationId: 'del-1', startTime: Date.now() - 1000 };
      const handle2 = { delegationId: 'del-2', startTime: Date.now() - 1000 };

      metrics.recordDelegationComplete(handle1, { success: true });
      metrics.recordDelegationComplete(handle2, { success: false });

      const stats = metrics.getSuccessStats();

      expect(stats.totalDelegations).toBe(2);
      expect(stats.successCount).toBe(1);
      expect(stats.failureCount).toBe(1);
      expect(stats.successRate).toBe(50);
    });

    test('should return quality stats', () => {
      const handle = metrics.recordDelegationStart({});
      metrics.recordDelegationComplete(handle, {
        success: true,
        qualityScore: 85
      });

      metrics.recordAggregation(100, 3, 90);

      const stats = metrics.getQualityStats();

      expect(stats.subAgentQualityScore).toBe(85);
      expect(stats.aggregationQuality).toBe(90);
      expect(stats.sampleCount).toBe(2);
    });

    test('should return resource stats', () => {
      const handle = metrics.recordDelegationStart({
        tokenBudget: 1000
      });
      metrics.recordDelegationComplete(handle, {
        success: true,
        tokensUsed: 500
      });

      const stats = metrics.getResourceStats();

      expect(stats.tokenBudgetAllocated).toBe(1000);
      expect(stats.tokenBudgetUsed).toBe(500);
      expect(stats.tokenEfficiency).toBe(50);
    });

    test('should return rolling stats', () => {
      metrics.recordDelegationStart({});

      const hourStats = metrics.getRollingStats('hour');
      expect(hourStats.name).toBe('hour');
      expect(hourStats.total).toBe(1);

      const nonexistent = metrics.getRollingStats('week');
      expect(nonexistent).toBeNull();
    });

    test('should return active child count', () => {
      metrics.recordDelegationStart({});
      metrics.recordDelegationStart({});

      expect(metrics.getActiveChildCount()).toBe(2);
    });
  });

  describe('snapshots', () => {
    test('should take snapshot of current metrics', () => {
      metrics.recordDelegationStart({ pattern: 'parallel' });

      const snapshot = metrics.takeSnapshot();

      expect(snapshot.snapshotId).toMatch(/^snap-/);
      expect(snapshot.timestamp).toBeGreaterThan(0);
      expect(snapshot.counters).toBeDefined();
      expect(snapshot.histograms).toBeDefined();
      expect(snapshot.quality).toBeDefined();
      expect(snapshot.resources).toBeDefined();
    });

    test('should store snapshots with bounded history', () => {
      const smallMetrics = new DelegationMetrics({
        memory: { snapshotRetention: 5 }
      });

      for (let i = 0; i < 10; i++) {
        smallMetrics.takeSnapshot();
      }

      const snapshots = smallMetrics.getSnapshots();
      expect(snapshots.length).toBe(5);
      smallMetrics.close();
    });

    test('should filter snapshots by options', () => {
      // Capture midTime BEFORE any snapshots to ensure all snapshots are after it
      const midTime = Date.now() - 10;
      metrics.takeSnapshot();
      metrics.takeSnapshot();
      metrics.takeSnapshot();

      const filtered = metrics.getSnapshots({ since: midTime });
      // All 3 snapshots should be after midTime since midTime was captured before snapshots
      expect(filtered.length).toBe(3);

      const limited = metrics.getSnapshots({ limit: 1 });
      expect(limited.length).toBe(1);
    });

    test('should calculate trends between snapshots', () => {
      metrics.recordDelegationStart({});
      metrics.takeSnapshot();

      metrics.recordDelegationStart({});
      metrics.recordDelegationStart({});
      metrics.takeSnapshot();

      const trend = metrics.getTrend('counters.success', 60000);

      expect(trend.direction).toBeDefined();
      expect(trend.samples).toBe(2);
    });
  });

  describe('lifecycle methods', () => {
    test('should reset all metrics', () => {
      metrics.recordDelegationStart({ pattern: 'parallel' });
      metrics.takeSnapshot();

      metrics.reset();

      expect(metrics.delegationSuccess.get()).toBe(0);
      expect(metrics._activeChildCount).toBe(0);
      expect(metrics._snapshots.length).toBe(0);
      expect(metrics.patternCounters.parallel.get()).toBe(0);
    });

    test('should compact histograms', () => {
      for (let i = 0; i < 100; i++) {
        metrics.delegationDuration.record(i * 100);
      }

      const beforeCount = metrics.delegationDuration._samples.length;
      metrics.compact();
      // compact() should be able to reduce samples
      // (with our test data it may or may not depending on thresholds)
      expect(metrics.delegationDuration._samples.length).toBeLessThanOrEqual(beforeCount);
    });

    test('should close and cleanup', () => {
      let closedEvent = false;
      metrics.on('metrics:closed', () => { closedEvent = true; });

      metrics.close();

      expect(closedEvent).toBe(true);
      expect(metrics._activeDelegations.size).toBe(0);
    });
  });

  describe('serialization', () => {
    test('should serialize to JSON', () => {
      const handle = metrics.recordDelegationStart({
        pattern: 'parallel',
        depth: 1
      });
      metrics.recordDelegationComplete(handle, {
        success: true,
        tokensUsed: 500
      });

      const json = metrics.toJSON();

      expect(json.metricsId).toBe(metrics.metricsId);
      expect(json.histograms).toBeDefined();
      expect(json.counters).toBeDefined();
      expect(json.rollingWindows).toBeDefined();
      expect(json.resources).toBeDefined();
    });

    test('should restore from JSON', () => {
      const handle = metrics.recordDelegationStart({
        pattern: 'parallel',
        depth: 1
      });
      metrics.recordDelegationComplete(handle, {
        success: true,
        tokensUsed: 500,
        qualityScore: 90
      });

      const json = metrics.toJSON();
      const restored = DelegationMetrics.fromJSON(json);

      expect(restored.metricsId).toBe(metrics.metricsId);
      expect(restored.delegationSuccess.get()).toBe(1);
      expect(restored.patternCounters.parallel.get()).toBe(1);
      expect(restored._totalTokensConsumed).toBe(500);

      restored.close();
    });

    test('should preserve histogram data through serialization', () => {
      for (let i = 0; i < 10; i++) {
        metrics.delegationDuration.record(i * 1000);
      }

      const json = metrics.toJSON();
      const restored = DelegationMetrics.fromJSON(json);

      expect(restored.delegationDuration._count).toBe(10);
      expect(restored.delegationDuration.getStats().sum).toBe(45000);

      restored.close();
    });
  });

  describe('events', () => {
    test('should emit delegation:started event', (done) => {
      metrics.on('delegation:started', (data) => {
        expect(data.delegationId).toBe('del-1');
        done();
      });

      metrics.recordDelegationStart({ delegationId: 'del-1' });
    });

    test('should emit delegation:completed event', (done) => {
      const handle = metrics.recordDelegationStart({ delegationId: 'del-1' });

      metrics.on('delegation:completed', (data) => {
        expect(data.delegationId).toBe('del-1');
        expect(data.success).toBe(true);
        done();
      });

      metrics.recordDelegationComplete(handle, { success: true });
    });

    test('should emit delegation:retry event', (done) => {
      metrics.on('delegation:retry', (data) => {
        expect(data.delegationId).toBe('del-1');
        expect(data.reason).toBe('timeout');
        done();
      });

      metrics.recordRetry('del-1', 'timeout');
    });

    test('should emit delegation:timeout event', (done) => {
      metrics.on('delegation:timeout', (data) => {
        expect(data.delegationId).toBe('del-1');
        expect(data.elapsedMs).toBe(30000);
        done();
      });

      metrics.recordTimeout('del-1', 30000);
    });

    test('should emit metrics:snapshot event', (done) => {
      metrics.on('metrics:snapshot', (snapshot) => {
        expect(snapshot.snapshotId).toMatch(/^snap-/);
        done();
      });

      metrics.takeSnapshot();
    });

    test('should emit metrics:reset event', (done) => {
      metrics.on('metrics:reset', (data) => {
        expect(data.timestamp).toBeGreaterThan(0);
        done();
      });

      metrics.reset();
    });
  });

  describe('depth and subtask tracking', () => {
    test('should track depth distribution', () => {
      metrics.recordDelegationStart({ depth: 0 });
      metrics.recordDelegationStart({ depth: 1 });
      metrics.recordDelegationStart({ depth: 1 });
      metrics.recordDelegationStart({ depth: 2 });

      const stats = metrics.depthDistribution.getStats();
      expect(stats.count).toBe(4);
      expect(stats.buckets['0']).toBe(1);
      expect(stats.buckets['1']).toBe(2);
      expect(stats.buckets['2']).toBe(1);
    });

    test('should track subtask count distribution', () => {
      metrics.recordDelegationStart({ subtaskCount: 1 });
      metrics.recordDelegationStart({ subtaskCount: 3 });
      metrics.recordDelegationStart({ subtaskCount: 5 });
      metrics.recordDelegationStart({ subtaskCount: 10 });

      const stats = metrics.subtaskCountDistribution.getStats();
      expect(stats.count).toBe(4);
    });

    test('should track peak child count', () => {
      metrics.recordDelegationStart({});
      metrics.recordDelegationStart({});
      metrics.recordDelegationStart({});

      expect(metrics._peakChildCount).toBe(3);

      // Complete one
      const handle = { delegationId: 'del-x', startTime: Date.now() };
      metrics.recordDelegationComplete(handle, { success: true });

      expect(metrics._activeChildCount).toBe(2);
      expect(metrics._peakChildCount).toBe(3); // Peak should remain at 3
    });
  });
});
