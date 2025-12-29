/**
 * DelegationMetrics - Performance Tracking for Multi-Agent Delegation System
 *
 * Provides comprehensive metrics for tracking delegation performance including:
 * - Duration histograms (delegation time, aggregation time)
 * - Subtask count distribution
 * - Depth distribution (how deep delegations go)
 * - Success/failure counters
 * - Quality metrics
 * - Resource utilization metrics
 *
 * Part of Hierarchy Phase 4 - metrics collection for delegation optimization.
 *
 * @module delegation-metrics
 */

const EventEmitter = require('events');
const crypto = require('crypto');

// ============================================================================
// DEFAULT CONFIGURATIONS
// ============================================================================

const DEFAULT_DURATION_BUCKETS = [
  { min: 0, max: 1000, label: '0-1s' },
  { min: 1000, max: 5000, label: '1-5s' },
  { min: 5000, max: 30000, label: '5-30s' },
  { min: 30000, max: 60000, label: '30s-1m' },
  { min: 60000, max: 300000, label: '1-5m' },
  { min: 300000, max: Infinity, label: '5m+' }
];

const DEFAULT_SUBTASK_BUCKETS = [
  { min: 1, max: 2, label: '1' },
  { min: 2, max: 4, label: '2-3' },
  { min: 4, max: 8, label: '4-7' },
  { min: 8, max: 16, label: '8-15' },
  { min: 16, max: Infinity, label: '16+' }
];

const DEFAULT_DEPTH_BUCKETS = [
  { min: 0, max: 1, label: '0' },
  { min: 1, max: 2, label: '1' },
  { min: 2, max: 3, label: '2' },
  { min: 3, max: 4, label: '3' },
  { min: 4, max: Infinity, label: '4+' }
];

const DEFAULT_ROLLING_WINDOWS = {
  hour: { windowSize: 60 * 60 * 1000, bucketCount: 60, name: 'hour' },
  day: { windowSize: 24 * 60 * 60 * 1000, bucketCount: 24, name: 'day' }
};

const DEFAULT_METRICS_CONFIG = {
  histograms: {
    durationBuckets: DEFAULT_DURATION_BUCKETS,
    subtaskBuckets: DEFAULT_SUBTASK_BUCKETS,
    depthBuckets: DEFAULT_DEPTH_BUCKETS,
    maxSamples: 10000
  },
  rollingWindows: DEFAULT_ROLLING_WINDOWS,
  memory: {
    maxHistogramSamples: 10000,
    compactThreshold: 5000,
    snapshotRetention: 100
  },
  persistence: {
    enabled: false,
    interval: 60000,
    path: null
  }
};

// ============================================================================
// HISTOGRAM CLASS
// ============================================================================

class Histogram {
  constructor(name, buckets, options = {}) {
    this.name = name;
    this.buckets = buckets;
    this.maxSamples = options.maxSamples || 10000;

    this._bucketCounts = new Map();
    for (const bucket of buckets) {
      this._bucketCounts.set(bucket.label, 0);
    }

    this._samples = [];
    this._sampleIndex = 0;
    this._count = 0;
    this._sum = 0;
    this._min = Infinity;
    this._max = -Infinity;
    this._lastUpdated = 0;
  }

  record(value) {
    // Find matching bucket
    for (const bucket of this.buckets) {
      if (value >= bucket.min && value < bucket.max) {
        this._bucketCounts.set(bucket.label, this._bucketCounts.get(bucket.label) + 1);
        break;
      }
    }

    // Circular buffer for samples
    if (this._samples.length < this.maxSamples) {
      this._samples.push(value);
    } else {
      this._samples[this._sampleIndex] = value;
      this._sampleIndex = (this._sampleIndex + 1) % this.maxSamples;
    }

    // Update aggregates
    this._count++;
    this._sum += value;
    this._min = Math.min(this._min, value);
    this._max = Math.max(this._max, value);
    this._lastUpdated = Date.now();
  }

  getStats() {
    if (this._count === 0) {
      return {
        count: 0,
        sum: 0,
        min: 0,
        max: 0,
        avg: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        buckets: this.getBuckets()
      };
    }

    return {
      count: this._count,
      sum: this._sum,
      min: this._min,
      max: this._max,
      avg: this._sum / this._count,
      p50: this.getPercentile(50),
      p95: this.getPercentile(95),
      p99: this.getPercentile(99),
      buckets: this.getBuckets()
    };
  }

  getPercentile(percentile) {
    if (this._samples.length === 0) return 0;

    const sorted = [...this._samples].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  getBuckets() {
    const result = {};
    for (const [label, count] of this._bucketCounts) {
      result[label] = count;
    }
    return result;
  }

  reset() {
    for (const bucket of this.buckets) {
      this._bucketCounts.set(bucket.label, 0);
    }
    this._samples = [];
    this._sampleIndex = 0;
    this._count = 0;
    this._sum = 0;
    this._min = Infinity;
    this._max = -Infinity;
    this._lastUpdated = 0;
  }

  compact() {
    // Keep only enough samples for accurate percentiles
    if (this._samples.length > this.maxSamples / 2) {
      const sorted = [...this._samples].sort((a, b) => a - b);
      const step = Math.ceil(sorted.length / (this.maxSamples / 4));
      this._samples = sorted.filter((_, i) => i % step === 0);
      this._sampleIndex = 0;
    }
  }

  toJSON() {
    return {
      name: this.name,
      buckets: this.buckets,
      maxSamples: this.maxSamples,
      bucketCounts: Object.fromEntries(this._bucketCounts),
      samples: this._samples,
      sampleIndex: this._sampleIndex,
      count: this._count,
      sum: this._sum,
      min: this._min === Infinity ? null : this._min,
      max: this._max === -Infinity ? null : this._max,
      lastUpdated: this._lastUpdated
    };
  }

  static fromJSON(data) {
    const histogram = new Histogram(data.name, data.buckets, { maxSamples: data.maxSamples });
    histogram._bucketCounts = new Map(Object.entries(data.bucketCounts));
    histogram._samples = data.samples || [];
    histogram._sampleIndex = data.sampleIndex || 0;
    histogram._count = data.count || 0;
    histogram._sum = data.sum || 0;
    histogram._min = data.min === null ? Infinity : data.min;
    histogram._max = data.max === null ? -Infinity : data.max;
    histogram._lastUpdated = data.lastUpdated || 0;
    return histogram;
  }
}

// ============================================================================
// ROLLING WINDOW CLASS
// ============================================================================

class RollingWindow {
  constructor(config) {
    this.name = config.name;
    this.windowSize = config.windowSize;
    this.bucketCount = config.bucketCount;
    this.bucketSize = this.windowSize / this.bucketCount;

    this._buckets = new Array(this.bucketCount).fill(0);
    this._currentBucket = 0;
    this._lastBucketTime = Date.now();
    this._total = 0;
  }

  record(value = 1) {
    this._advanceBuckets();
    this._buckets[this._currentBucket] += value;
    this._total += value;
  }

  getTotal() {
    this._advanceBuckets();
    return this._buckets.reduce((sum, v) => sum + v, 0);
  }

  getRate() {
    const total = this.getTotal();
    return total / (this.windowSize / 1000); // per second
  }

  getBuckets() {
    this._advanceBuckets();
    return [...this._buckets];
  }

  _advanceBuckets() {
    const now = Date.now();
    const elapsed = now - this._lastBucketTime;
    const bucketsToAdvance = Math.floor(elapsed / this.bucketSize);

    if (bucketsToAdvance > 0) {
      const advanceCount = Math.min(bucketsToAdvance, this.bucketCount);

      for (let i = 0; i < advanceCount; i++) {
        this._currentBucket = (this._currentBucket + 1) % this.bucketCount;
        this._total -= this._buckets[this._currentBucket];
        this._buckets[this._currentBucket] = 0;
      }

      this._lastBucketTime = now - (elapsed % this.bucketSize);
    }
  }

  reset() {
    this._buckets = new Array(this.bucketCount).fill(0);
    this._currentBucket = 0;
    this._lastBucketTime = Date.now();
    this._total = 0;
  }

  toJSON() {
    return {
      name: this.name,
      windowSize: this.windowSize,
      bucketCount: this.bucketCount,
      buckets: this._buckets,
      currentBucket: this._currentBucket,
      lastBucketTime: this._lastBucketTime,
      total: this._total
    };
  }

  static fromJSON(data) {
    const window = new RollingWindow({
      name: data.name,
      windowSize: data.windowSize,
      bucketCount: data.bucketCount
    });
    window._buckets = data.buckets || new Array(data.bucketCount).fill(0);
    window._currentBucket = data.currentBucket || 0;
    window._lastBucketTime = data.lastBucketTime || Date.now();
    window._total = data.total || 0;
    return window;
  }
}

// ============================================================================
// ATOMIC COUNTER CLASS
// ============================================================================

class AtomicCounter {
  constructor(name, options = {}) {
    this.name = name;
    this._value = 0;
    this._lastUpdated = 0;
    this._rateWindowMs = options.rateWindowMs || 60000;
    this._rateHistory = []; // [{timestamp, amount}]
  }

  increment(amount = 1) {
    this._value += amount;
    this._lastUpdated = Date.now();
    this._rateHistory.push({ timestamp: this._lastUpdated, amount });
    this._pruneRateHistory();
    return this._value;
  }

  decrement(amount = 1) {
    this._value = Math.max(0, this._value - amount);
    this._lastUpdated = Date.now();
    return this._value;
  }

  get() {
    return this._value;
  }

  getRate() {
    this._pruneRateHistory();
    const sum = this._rateHistory.reduce((acc, entry) => acc + entry.amount, 0);
    return sum / (this._rateWindowMs / 60000); // per minute
  }

  reset() {
    this._value = 0;
    this._lastUpdated = 0;
    this._rateHistory = [];
  }

  getWithMetadata() {
    return {
      value: this._value,
      lastUpdated: this._lastUpdated,
      rate: this.getRate()
    };
  }

  _pruneRateHistory() {
    const cutoff = Date.now() - this._rateWindowMs;
    this._rateHistory = this._rateHistory.filter(entry => entry.timestamp > cutoff);
  }

  toJSON() {
    return {
      name: this.name,
      value: this._value,
      lastUpdated: this._lastUpdated,
      rateWindowMs: this._rateWindowMs,
      rateHistory: this._rateHistory.slice(-100) // Keep last 100 entries
    };
  }

  static fromJSON(data) {
    const counter = new AtomicCounter(data.name, { rateWindowMs: data.rateWindowMs });
    counter._value = data.value || 0;
    counter._lastUpdated = data.lastUpdated || 0;
    counter._rateHistory = data.rateHistory || [];
    return counter;
  }
}

// ============================================================================
// DELEGATION METRICS CLASS
// ============================================================================

class DelegationMetrics extends EventEmitter {
  constructor(options = {}) {
    super();

    this.metricsId = `metrics-${crypto.randomUUID()}`;
    this.config = this._mergeConfig(DEFAULT_METRICS_CONFIG, options);

    // Duration Histograms
    this.delegationDuration = new Histogram(
      'delegation_duration',
      this.config.histograms.durationBuckets,
      { maxSamples: this.config.memory.maxHistogramSamples }
    );

    this.aggregationDuration = new Histogram(
      'aggregation_duration',
      this.config.histograms.durationBuckets,
      { maxSamples: this.config.memory.maxHistogramSamples }
    );

    this.childExecutionDuration = new Histogram(
      'child_execution_duration',
      this.config.histograms.durationBuckets,
      { maxSamples: this.config.memory.maxHistogramSamples }
    );

    // Distribution Histograms
    this.subtaskCountDistribution = new Histogram(
      'subtask_count_distribution',
      this.config.histograms.subtaskBuckets,
      { maxSamples: this.config.memory.maxHistogramSamples }
    );

    this.depthDistribution = new Histogram(
      'depth_distribution',
      this.config.histograms.depthBuckets,
      { maxSamples: this.config.memory.maxHistogramSamples }
    );

    // Success/Failure Counters
    this.delegationSuccess = new AtomicCounter('delegation_success');
    this.delegationFailure = new AtomicCounter('delegation_failure');
    this.retryCount = new AtomicCounter('retry_count');
    this.timeoutCount = new AtomicCounter('timeout_count');
    this.partialSuccess = new AtomicCounter('partial_success');

    // Pattern Counters
    this.patternCounters = {
      parallel: new AtomicCounter('pattern_parallel'),
      sequential: new AtomicCounter('pattern_sequential'),
      debate: new AtomicCounter('pattern_debate'),
      review: new AtomicCounter('pattern_review'),
      ensemble: new AtomicCounter('pattern_ensemble'),
      direct: new AtomicCounter('pattern_direct')
    };

    // Quality Histograms
    this.subAgentQualityScore = new Histogram(
      'sub_agent_quality_score',
      [
        { min: 0, max: 60, label: 'low' },
        { min: 60, max: 80, label: 'medium' },
        { min: 80, max: 90, label: 'high' },
        { min: 90, max: 100, label: 'excellent' },
        { min: 100, max: Infinity, label: 'perfect' }
      ],
      { maxSamples: this.config.memory.maxHistogramSamples }
    );

    this.aggregationQuality = new Histogram(
      'aggregation_quality',
      [
        { min: 0, max: 60, label: 'low' },
        { min: 60, max: 80, label: 'medium' },
        { min: 80, max: 90, label: 'high' },
        { min: 90, max: 100, label: 'excellent' },
        { min: 100, max: Infinity, label: 'perfect' }
      ],
      { maxSamples: this.config.memory.maxHistogramSamples }
    );

    // Resource Histograms
    this.tokenBudgetUsed = new Histogram(
      'token_budget_used',
      [
        { min: 0, max: 25, label: '0-25%' },
        { min: 25, max: 50, label: '25-50%' },
        { min: 50, max: 75, label: '50-75%' },
        { min: 75, max: 90, label: '75-90%' },
        { min: 90, max: 100, label: '90-100%' },
        { min: 100, max: Infinity, label: 'exceeded' }
      ],
      { maxSamples: this.config.memory.maxHistogramSamples }
    );

    this.timeBudgetUsed = new Histogram(
      'time_budget_used',
      [
        { min: 0, max: 25, label: '0-25%' },
        { min: 25, max: 50, label: '25-50%' },
        { min: 50, max: 75, label: '50-75%' },
        { min: 75, max: 90, label: '75-90%' },
        { min: 90, max: 100, label: '90-100%' },
        { min: 100, max: Infinity, label: 'exceeded' }
      ],
      { maxSamples: this.config.memory.maxHistogramSamples }
    );

    // Resource gauges
    this._activeChildCount = 0;
    this._peakChildCount = 0;
    this._totalTokensConsumed = 0;
    this._totalTokensAllocated = 0;

    // Rolling Windows
    this.rollingWindows = {};
    for (const [name, config] of Object.entries(this.config.rollingWindows)) {
      this.rollingWindows[name] = new RollingWindow({ ...config, name });
    }

    // Snapshot History
    this._snapshots = [];
    this._maxSnapshots = this.config.memory.snapshotRetention;

    // Active delegation tracking
    this._activeDelegations = new Map();

    // Persistence
    this._persistTimer = null;
    this._createdAt = Date.now();
    this._lastResetAt = Date.now();
  }

  // ============================================================================
  // RECORDING METHODS
  // ============================================================================

  recordDelegationStart(delegation) {
    const handle = {
      delegationId: delegation.delegationId || `del-${Date.now()}`,
      parentAgentId: delegation.parentAgentId,
      pattern: delegation.pattern || 'direct',
      depth: delegation.depth || 0,
      subtaskCount: delegation.subtaskCount || 0,
      tokenBudget: delegation.tokenBudget || 0,
      timeBudget: delegation.timeBudget || 0,
      startTime: Date.now()
    };

    // Track active delegation
    this._activeDelegations.set(handle.delegationId, handle);

    // Increment active child count
    this._activeChildCount++;
    this._peakChildCount = Math.max(this._peakChildCount, this._activeChildCount);

    // Record pattern
    if (this.patternCounters[handle.pattern]) {
      this.patternCounters[handle.pattern].increment();
    }

    // Record depth and subtask distributions
    this.depthDistribution.record(handle.depth);
    if (handle.subtaskCount > 0) {
      this.subtaskCountDistribution.record(handle.subtaskCount);
    }

    // Track token allocation
    this._totalTokensAllocated += handle.tokenBudget;

    // Record in rolling windows
    for (const window of Object.values(this.rollingWindows)) {
      window.record(1);
    }

    this.emit('delegation:started', handle);
    return handle;
  }

  recordDelegationComplete(handle, result) {
    const endTime = Date.now();
    const duration = endTime - handle.startTime;

    // Remove from active tracking
    this._activeDelegations.delete(handle.delegationId);

    // Decrement active count
    this._activeChildCount = Math.max(0, this._activeChildCount - 1);

    // Record duration
    this.delegationDuration.record(duration);

    // Update success/failure counters
    if (result.success) {
      this.delegationSuccess.increment();
    } else {
      this.delegationFailure.increment();
    }

    // Record resource usage
    if (result.tokensUsed) {
      this._totalTokensConsumed += result.tokensUsed;
      if (handle.tokenBudget > 0) {
        const utilization = (result.tokensUsed / handle.tokenBudget) * 100;
        this.tokenBudgetUsed.record(utilization);
      }
    }

    // Record time budget usage
    if (handle.timeBudget > 0) {
      const timeUtilization = (duration / handle.timeBudget) * 100;
      this.timeBudgetUsed.record(timeUtilization);
    }

    // Record quality if provided
    if (typeof result.qualityScore === 'number') {
      this.subAgentQualityScore.record(result.qualityScore);
    }

    // Record retries
    if (result.retries && result.retries > 0) {
      this.retryCount.increment(result.retries);
    }

    this.emit('delegation:completed', {
      ...handle,
      endTime,
      duration,
      ...result
    });
  }

  recordAggregation(durationMs, resultCount, qualityScore) {
    this.aggregationDuration.record(durationMs);

    if (typeof qualityScore === 'number') {
      this.aggregationQuality.record(qualityScore);
    }
  }

  recordRetry(delegationId, reason) {
    this.retryCount.increment();
    this.emit('delegation:retry', { delegationId, reason, timestamp: Date.now() });
  }

  recordTimeout(delegationId, elapsedMs) {
    this.timeoutCount.increment();
    this.delegationDuration.record(elapsedMs);
    this.emit('delegation:timeout', { delegationId, elapsedMs, timestamp: Date.now() });
  }

  recordChildSpawn() {
    this._activeChildCount++;
    this._peakChildCount = Math.max(this._peakChildCount, this._activeChildCount);
  }

  recordChildTerminate() {
    this._activeChildCount = Math.max(0, this._activeChildCount - 1);
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

  getSummary() {
    const successCount = this.delegationSuccess.get();
    const failureCount = this.delegationFailure.get();
    const totalDelegations = successCount + failureCount;
    const successRate = totalDelegations > 0 ? (successCount / totalDelegations) * 100 : 100;

    return {
      timestamp: Date.now(),
      metricsId: this.metricsId,
      uptime: Date.now() - this._createdAt,

      counters: {
        delegationSuccess: this.delegationSuccess.getWithMetadata(),
        delegationFailure: this.delegationFailure.getWithMetadata(),
        retryCount: this.retryCount.getWithMetadata(),
        timeoutCount: this.timeoutCount.getWithMetadata(),
        partialSuccess: this.partialSuccess.getWithMetadata()
      },

      rates: {
        successRate,
        delegationsPerMinute: this.delegationSuccess.getRate() + this.delegationFailure.getRate(),
        retriesPerMinute: this.retryCount.getRate()
      },

      histograms: {
        delegationDuration: this.delegationDuration.getStats(),
        aggregationDuration: this.aggregationDuration.getStats(),
        subtaskCount: this.subtaskCountDistribution.getStats(),
        depthDistribution: this.depthDistribution.getStats()
      },

      patterns: this.getPatternDistribution(),

      quality: this.getQualityStats(),

      resources: this.getResourceStats(),

      active: {
        delegations: this._activeDelegations.size,
        childCount: this._activeChildCount,
        peakChildCount: this._peakChildCount
      }
    };
  }

  getDurationStats() {
    return {
      delegation: this.delegationDuration.getStats(),
      aggregation: this.aggregationDuration.getStats(),
      childExecution: this.childExecutionDuration.getStats()
    };
  }

  getSuccessStats() {
    const successCount = this.delegationSuccess.get();
    const failureCount = this.delegationFailure.get();
    const totalDelegations = successCount + failureCount;

    return {
      totalDelegations,
      successCount,
      failureCount,
      successRate: totalDelegations > 0 ? (successCount / totalDelegations) * 100 : 100,
      retryCount: this.retryCount.get(),
      timeoutCount: this.timeoutCount.get(),
      partialSuccessCount: this.partialSuccess.get()
    };
  }

  getQualityStats() {
    const subAgentStats = this.subAgentQualityScore.getStats();
    const aggregationStats = this.aggregationQuality.getStats();

    return {
      subAgentQualityScore: subAgentStats.avg,
      aggregationQuality: aggregationStats.avg,
      sampleCount: subAgentStats.count + aggregationStats.count,
      subAgentDistribution: subAgentStats.buckets,
      aggregationDistribution: aggregationStats.buckets
    };
  }

  getResourceStats() {
    return {
      tokenBudgetUsed: this._totalTokensConsumed,
      tokenBudgetAllocated: this._totalTokensAllocated,
      tokenEfficiency: this._totalTokensAllocated > 0
        ? (this._totalTokensConsumed / this._totalTokensAllocated) * 100
        : 0,
      activeChildCount: this._activeChildCount,
      maxChildCount: this._peakChildCount,
      tokenUtilizationDistribution: this.tokenBudgetUsed.getStats().buckets,
      timeUtilizationDistribution: this.timeBudgetUsed.getStats().buckets
    };
  }

  getPatternDistribution() {
    const distribution = {};
    let total = 0;

    for (const [pattern, counter] of Object.entries(this.patternCounters)) {
      const count = counter.get();
      distribution[pattern] = count;
      total += count;
    }

    const percentages = {};
    for (const [pattern, count] of Object.entries(distribution)) {
      percentages[pattern] = total > 0 ? (count / total) * 100 : 0;
    }

    return {
      counts: distribution,
      percentages,
      total
    };
  }

  getRollingStats(windowName) {
    const window = this.rollingWindows[windowName];
    if (!window) {
      return null;
    }

    return {
      name: window.name,
      windowSize: window.windowSize,
      total: window.getTotal(),
      rate: window.getRate(),
      buckets: window.getBuckets()
    };
  }

  getActiveChildCount() {
    return this._activeChildCount;
  }

  // ============================================================================
  // SNAPSHOT METHODS
  // ============================================================================

  takeSnapshot() {
    const snapshot = {
      snapshotId: `snap-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      counters: {
        success: this.delegationSuccess.get(),
        failure: this.delegationFailure.get(),
        retries: this.retryCount.get(),
        timeouts: this.timeoutCount.get()
      },
      histograms: {
        delegationDuration: this.delegationDuration.getStats(),
        subtaskCount: this.subtaskCountDistribution.getStats(),
        depth: this.depthDistribution.getStats()
      },
      quality: this.getQualityStats(),
      resources: this.getResourceStats(),
      rolling: {}
    };

    for (const [name, window] of Object.entries(this.rollingWindows)) {
      snapshot.rolling[name] = {
        total: window.getTotal(),
        rate: window.getRate()
      };
    }

    // Store snapshot (bounded)
    this._snapshots.push(snapshot);
    if (this._snapshots.length > this._maxSnapshots) {
      this._snapshots.shift();
    }

    this.emit('metrics:snapshot', snapshot);
    return snapshot;
  }

  getSnapshots(options = {}) {
    let snapshots = [...this._snapshots];

    if (options.since) {
      snapshots = snapshots.filter(s => s.timestamp > options.since);
    }

    if (options.limit) {
      snapshots = snapshots.slice(-options.limit);
    }

    return snapshots;
  }

  getTrend(metric, windowMs) {
    const now = Date.now();
    const cutoff = now - windowMs;
    const relevantSnapshots = this._snapshots.filter(s => s.timestamp > cutoff);

    if (relevantSnapshots.length < 2) {
      return { direction: 'stable', change: 0, samples: relevantSnapshots.length };
    }

    const first = relevantSnapshots[0];
    const last = relevantSnapshots[relevantSnapshots.length - 1];

    // Extract metric value using dot notation
    const getValue = (obj, path) => {
      return path.split('.').reduce((o, k) => o?.[k], obj);
    };

    const firstValue = getValue(first, metric) || 0;
    const lastValue = getValue(last, metric) || 0;
    const change = lastValue - firstValue;
    const percentChange = firstValue !== 0 ? (change / firstValue) * 100 : 0;

    return {
      direction: change > 0 ? 'up' : change < 0 ? 'down' : 'stable',
      change,
      percentChange,
      firstValue,
      lastValue,
      samples: relevantSnapshots.length
    };
  }

  // ============================================================================
  // LIFECYCLE METHODS
  // ============================================================================

  reset() {
    // Reset histograms
    this.delegationDuration.reset();
    this.aggregationDuration.reset();
    this.childExecutionDuration.reset();
    this.subtaskCountDistribution.reset();
    this.depthDistribution.reset();
    this.subAgentQualityScore.reset();
    this.aggregationQuality.reset();
    this.tokenBudgetUsed.reset();
    this.timeBudgetUsed.reset();

    // Reset counters
    this.delegationSuccess.reset();
    this.delegationFailure.reset();
    this.retryCount.reset();
    this.timeoutCount.reset();
    this.partialSuccess.reset();

    for (const counter of Object.values(this.patternCounters)) {
      counter.reset();
    }

    // Reset rolling windows
    for (const window of Object.values(this.rollingWindows)) {
      window.reset();
    }

    // Reset gauges
    this._activeChildCount = 0;
    this._peakChildCount = 0;
    this._totalTokensConsumed = 0;
    this._totalTokensAllocated = 0;

    // Clear tracking
    this._activeDelegations.clear();
    this._snapshots = [];

    this._lastResetAt = Date.now();
    this.emit('metrics:reset', { timestamp: this._lastResetAt });
  }

  compact() {
    this.delegationDuration.compact();
    this.aggregationDuration.compact();
    this.childExecutionDuration.compact();
    this.subtaskCountDistribution.compact();
    this.depthDistribution.compact();
    this.subAgentQualityScore.compact();
    this.aggregationQuality.compact();
    this.tokenBudgetUsed.compact();
    this.timeBudgetUsed.compact();
  }

  startPersistence(intervalMs) {
    const interval = intervalMs || this.config.persistence.interval;

    if (this._persistTimer) {
      clearInterval(this._persistTimer);
    }

    this._persistTimer = setInterval(() => this.persist(), interval);
    if (this._persistTimer.unref) {
      this._persistTimer.unref();
    }
  }

  stopPersistence() {
    if (this._persistTimer) {
      clearInterval(this._persistTimer);
      this._persistTimer = null;
    }
  }

  async persist() {
    // Persistence would integrate with CoordinationDB
    // For now, emit event for external handlers
    const data = this.toJSON();
    this.emit('metrics:persist', data);
    return data;
  }

  async load() {
    // Would load from CoordinationDB
    this.emit('metrics:load', { timestamp: Date.now() });
  }

  close() {
    this.stopPersistence();
    this._activeDelegations.clear();
    this.emit('metrics:closed', { timestamp: Date.now() });
  }

  // ============================================================================
  // SERIALIZATION
  // ============================================================================

  toJSON() {
    return {
      metricsId: this.metricsId,
      config: this.config,
      createdAt: this._createdAt,
      lastResetAt: this._lastResetAt,

      histograms: {
        delegationDuration: this.delegationDuration.toJSON(),
        aggregationDuration: this.aggregationDuration.toJSON(),
        childExecutionDuration: this.childExecutionDuration.toJSON(),
        subtaskCountDistribution: this.subtaskCountDistribution.toJSON(),
        depthDistribution: this.depthDistribution.toJSON(),
        subAgentQualityScore: this.subAgentQualityScore.toJSON(),
        aggregationQuality: this.aggregationQuality.toJSON(),
        tokenBudgetUsed: this.tokenBudgetUsed.toJSON(),
        timeBudgetUsed: this.timeBudgetUsed.toJSON()
      },

      counters: {
        delegationSuccess: this.delegationSuccess.toJSON(),
        delegationFailure: this.delegationFailure.toJSON(),
        retryCount: this.retryCount.toJSON(),
        timeoutCount: this.timeoutCount.toJSON(),
        partialSuccess: this.partialSuccess.toJSON(),
        patterns: Object.fromEntries(
          Object.entries(this.patternCounters).map(([k, v]) => [k, v.toJSON()])
        )
      },

      rollingWindows: Object.fromEntries(
        Object.entries(this.rollingWindows).map(([k, v]) => [k, v.toJSON()])
      ),

      resources: {
        activeChildCount: this._activeChildCount,
        peakChildCount: this._peakChildCount,
        totalTokensConsumed: this._totalTokensConsumed,
        totalTokensAllocated: this._totalTokensAllocated
      },

      snapshots: this._snapshots
    };
  }

  static fromJSON(data) {
    const metrics = new DelegationMetrics(data.config);

    metrics.metricsId = data.metricsId;
    metrics._createdAt = data.createdAt;
    metrics._lastResetAt = data.lastResetAt;

    // Restore histograms
    if (data.histograms) {
      metrics.delegationDuration = Histogram.fromJSON(data.histograms.delegationDuration);
      metrics.aggregationDuration = Histogram.fromJSON(data.histograms.aggregationDuration);
      metrics.childExecutionDuration = Histogram.fromJSON(data.histograms.childExecutionDuration);
      metrics.subtaskCountDistribution = Histogram.fromJSON(data.histograms.subtaskCountDistribution);
      metrics.depthDistribution = Histogram.fromJSON(data.histograms.depthDistribution);
      metrics.subAgentQualityScore = Histogram.fromJSON(data.histograms.subAgentQualityScore);
      metrics.aggregationQuality = Histogram.fromJSON(data.histograms.aggregationQuality);
      metrics.tokenBudgetUsed = Histogram.fromJSON(data.histograms.tokenBudgetUsed);
      metrics.timeBudgetUsed = Histogram.fromJSON(data.histograms.timeBudgetUsed);
    }

    // Restore counters
    if (data.counters) {
      metrics.delegationSuccess = AtomicCounter.fromJSON(data.counters.delegationSuccess);
      metrics.delegationFailure = AtomicCounter.fromJSON(data.counters.delegationFailure);
      metrics.retryCount = AtomicCounter.fromJSON(data.counters.retryCount);
      metrics.timeoutCount = AtomicCounter.fromJSON(data.counters.timeoutCount);
      metrics.partialSuccess = AtomicCounter.fromJSON(data.counters.partialSuccess);

      if (data.counters.patterns) {
        for (const [name, counterData] of Object.entries(data.counters.patterns)) {
          if (metrics.patternCounters[name]) {
            metrics.patternCounters[name] = AtomicCounter.fromJSON(counterData);
          }
        }
      }
    }

    // Restore rolling windows
    if (data.rollingWindows) {
      for (const [name, windowData] of Object.entries(data.rollingWindows)) {
        metrics.rollingWindows[name] = RollingWindow.fromJSON(windowData);
      }
    }

    // Restore resources
    if (data.resources) {
      metrics._activeChildCount = data.resources.activeChildCount || 0;
      metrics._peakChildCount = data.resources.peakChildCount || 0;
      metrics._totalTokensConsumed = data.resources.totalTokensConsumed || 0;
      metrics._totalTokensAllocated = data.resources.totalTokensAllocated || 0;
    }

    // Restore snapshots
    metrics._snapshots = data.snapshots || [];

    return metrics;
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  _mergeConfig(defaults, overrides) {
    const merged = { ...defaults };
    if (!overrides || typeof overrides !== 'object') {
      return merged;
    }
    for (const key of Object.keys(overrides)) {
      if (overrides[key] !== undefined) {
        if (typeof overrides[key] === 'object' && !Array.isArray(overrides[key]) && overrides[key] !== null) {
          merged[key] = this._mergeConfig(defaults[key] || {}, overrides[key]);
        } else {
          merged[key] = overrides[key];
        }
      }
    }
    return merged;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  DelegationMetrics,
  Histogram,
  RollingWindow,
  AtomicCounter,
  DEFAULT_DURATION_BUCKETS,
  DEFAULT_SUBTASK_BUCKETS,
  DEFAULT_DEPTH_BUCKETS,
  DEFAULT_ROLLING_WINDOWS,
  DEFAULT_METRICS_CONFIG
};
