/**
 * HookMetrics - Performance and Reliability Tracking for Claude Code Hooks
 *
 * Provides comprehensive metrics for tracking hook execution including:
 * - Success/failure counters per hook type
 * - Duration histograms
 * - Rolling window success rates
 * - Retry tracking
 * - Error categorization
 *
 * Integrates with hook-debug.js for data collection and exposes metrics
 * via the dashboard API.
 *
 * @module hook-metrics
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

// Import shared classes from delegation-metrics if available
let Histogram, RollingWindow, AtomicCounter;
try {
  const delegationMetrics = require('./delegation-metrics');
  Histogram = delegationMetrics.Histogram;
  RollingWindow = delegationMetrics.RollingWindow;
  AtomicCounter = delegationMetrics.AtomicCounter;
} catch (e) {
  // Inline implementations if delegation-metrics not available
  Histogram = null;
  RollingWindow = null;
  AtomicCounter = null;
}

// ============================================================================
// DEFAULT CONFIGURATIONS
// ============================================================================

const DEFAULT_DURATION_BUCKETS = [
  { min: 0, max: 50, label: '0-50ms' },
  { min: 50, max: 100, label: '50-100ms' },
  { min: 100, max: 200, label: '100-200ms' },
  { min: 200, max: 500, label: '200-500ms' },
  { min: 500, max: 1000, label: '500ms-1s' },
  { min: 1000, max: 2000, label: '1-2s' },
  { min: 2000, max: Infinity, label: '2s+' }
];

const HOOK_TYPES = [
  'session-start',
  'session-end',
  'user-prompt-submit',
  'delegation-hook',
  'track-progress',
  'track-usage',
  'after-execution',
  'after-code-change',
  'pre-tool-check',
  'validate-prompt'
];

const ERROR_CATEGORIES = [
  'timeout',
  'parse-error',
  'network-error',
  'file-error',
  'validation-error',
  'unknown'
];

const DEFAULT_METRICS_CONFIG = {
  histograms: {
    durationBuckets: DEFAULT_DURATION_BUCKETS,
    maxSamples: 10000
  },
  rollingWindows: {
    minute: { windowSize: 60 * 1000, bucketCount: 60, name: 'minute' },
    hour: { windowSize: 60 * 60 * 1000, bucketCount: 60, name: 'hour' },
    day: { windowSize: 24 * 60 * 60 * 1000, bucketCount: 24, name: 'day' }
  },
  persistence: {
    enabled: true,
    interval: 60000, // Persist every minute
    path: null // Set dynamically
  },
  memory: {
    maxSamples: 10000,
    snapshotRetention: 100
  }
};

// ============================================================================
// INLINE IMPLEMENTATIONS (fallback if delegation-metrics unavailable)
// ============================================================================

if (!Histogram) {
  Histogram = class Histogram {
    constructor(name, buckets, options = {}) {
      this.name = name;
      this.buckets = buckets;
      this.maxSamples = options.maxSamples || 10000;
      this._bucketCounts = new Map();
      for (const bucket of buckets) {
        this._bucketCounts.set(bucket.label, 0);
      }
      this._samples = [];
      this._count = 0;
      this._sum = 0;
      this._min = Infinity;
      this._max = -Infinity;
    }

    record(value) {
      for (const bucket of this.buckets) {
        if (value >= bucket.min && value < bucket.max) {
          this._bucketCounts.set(bucket.label, this._bucketCounts.get(bucket.label) + 1);
          break;
        }
      }
      if (this._samples.length < this.maxSamples) {
        this._samples.push(value);
      }
      this._count++;
      this._sum += value;
      this._min = Math.min(this._min, value);
      this._max = Math.max(this._max, value);
    }

    getStats() {
      if (this._count === 0) {
        return { count: 0, sum: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0, buckets: this.getBuckets() };
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
      this._count = 0;
      this._sum = 0;
      this._min = Infinity;
      this._max = -Infinity;
    }

    toJSON() {
      return {
        name: this.name,
        buckets: this.getBuckets(),
        count: this._count,
        sum: this._sum,
        min: this._min === Infinity ? null : this._min,
        max: this._max === -Infinity ? null : this._max
      };
    }

    static fromJSON(data) {
      const histogram = new Histogram(data.name, DEFAULT_DURATION_BUCKETS);
      histogram._bucketCounts = new Map(Object.entries(data.buckets || {}));
      histogram._count = data.count || 0;
      histogram._sum = data.sum || 0;
      histogram._min = data.min === null ? Infinity : data.min;
      histogram._max = data.max === null ? -Infinity : data.max;
      return histogram;
    }
  };
}

if (!RollingWindow) {
  RollingWindow = class RollingWindow {
    constructor(config) {
      this.name = config.name;
      this.windowSize = config.windowSize;
      this.bucketCount = config.bucketCount;
      this.bucketSize = this.windowSize / this.bucketCount;
      this._buckets = new Array(this.bucketCount).fill(0);
      this._currentBucket = 0;
      this._lastBucketTime = Date.now();
    }

    record(value = 1) {
      this._advanceBuckets();
      this._buckets[this._currentBucket] += value;
    }

    getTotal() {
      this._advanceBuckets();
      return this._buckets.reduce((sum, v) => sum + v, 0);
    }

    getRate() {
      return this.getTotal() / (this.windowSize / 1000);
    }

    _advanceBuckets() {
      const now = Date.now();
      const elapsed = now - this._lastBucketTime;
      const bucketsToAdvance = Math.floor(elapsed / this.bucketSize);
      if (bucketsToAdvance > 0) {
        const advanceCount = Math.min(bucketsToAdvance, this.bucketCount);
        for (let i = 0; i < advanceCount; i++) {
          this._currentBucket = (this._currentBucket + 1) % this.bucketCount;
          this._buckets[this._currentBucket] = 0;
        }
        this._lastBucketTime = now - (elapsed % this.bucketSize);
      }
    }

    reset() {
      this._buckets = new Array(this.bucketCount).fill(0);
      this._currentBucket = 0;
      this._lastBucketTime = Date.now();
    }

    toJSON() {
      return { name: this.name, windowSize: this.windowSize, bucketCount: this.bucketCount, buckets: this._buckets };
    }

    static fromJSON(data) {
      const window = new RollingWindow({ name: data.name, windowSize: data.windowSize, bucketCount: data.bucketCount });
      window._buckets = data.buckets || new Array(data.bucketCount).fill(0);
      return window;
    }
  };
}

if (!AtomicCounter) {
  AtomicCounter = class AtomicCounter {
    constructor(name) {
      this.name = name;
      this._value = 0;
      this._lastUpdated = 0;
    }

    increment(amount = 1) {
      this._value += amount;
      this._lastUpdated = Date.now();
      return this._value;
    }

    get() {
      return this._value;
    }

    reset() {
      this._value = 0;
      this._lastUpdated = 0;
    }

    toJSON() {
      return { name: this.name, value: this._value, lastUpdated: this._lastUpdated };
    }

    static fromJSON(data) {
      const counter = new AtomicCounter(data.name);
      counter._value = data.value || 0;
      counter._lastUpdated = data.lastUpdated || 0;
      return counter;
    }
  };
}

// ============================================================================
// HOOK METRICS CLASS
// ============================================================================

class HookMetrics extends EventEmitter {
  constructor(options = {}) {
    super();

    this.metricsId = `hook-metrics-${Date.now()}`;
    this.config = this._mergeConfig(DEFAULT_METRICS_CONFIG, options);

    // Set default persistence path
    if (!this.config.persistence.path) {
      this.config.persistence.path = path.join(__dirname, '..', 'data', 'hook-metrics.json');
    }

    // Per-hook counters
    this.hookCounters = {};
    for (const hookType of HOOK_TYPES) {
      this.hookCounters[hookType] = {
        success: new AtomicCounter(`${hookType}_success`),
        failure: new AtomicCounter(`${hookType}_failure`),
        timeout: new AtomicCounter(`${hookType}_timeout`),
        duration: new Histogram(`${hookType}_duration`, this.config.histograms.durationBuckets, {
          maxSamples: this.config.memory.maxSamples
        })
      };
    }

    // Error category counters
    this.errorCounters = {};
    for (const category of ERROR_CATEGORIES) {
      this.errorCounters[category] = new AtomicCounter(`error_${category}`);
    }

    // Global counters
    this.totalSuccess = new AtomicCounter('total_success');
    this.totalFailure = new AtomicCounter('total_failure');
    this.totalRetries = new AtomicCounter('total_retries');

    // Rolling windows for recent success rates
    this.rollingWindows = {
      success: {},
      failure: {}
    };
    for (const [name, config] of Object.entries(this.config.rollingWindows)) {
      this.rollingWindows.success[name] = new RollingWindow({ ...config, name: `success_${name}` });
      this.rollingWindows.failure[name] = new RollingWindow({ ...config, name: `failure_${name}` });
    }

    // Recent executions log (for debugging)
    this._recentExecutions = [];
    this._maxRecentExecutions = 100;

    // Snapshots for trend analysis
    this._snapshots = [];
    this._maxSnapshots = this.config.memory.snapshotRetention;

    // Lifecycle
    this._createdAt = Date.now();
    this._lastResetAt = Date.now();
    this._persistTimer = null;

    // Load persisted data
    this._loadFromDisk();
  }

  // ============================================================================
  // RECORDING METHODS
  // ============================================================================

  /**
   * Record a successful hook execution
   * @param {string} hookType - Type of hook (e.g., 'session-start')
   * @param {number} durationMs - Execution duration in milliseconds
   * @param {Object} metadata - Additional metadata
   */
  recordSuccess(hookType, durationMs, metadata = {}) {
    const normalizedType = this._normalizeHookType(hookType);

    if (this.hookCounters[normalizedType]) {
      this.hookCounters[normalizedType].success.increment();
      this.hookCounters[normalizedType].duration.record(durationMs);
    }

    this.totalSuccess.increment();

    // Record in rolling windows
    for (const window of Object.values(this.rollingWindows.success)) {
      window.record(1);
    }

    // Add to recent executions
    this._addRecentExecution({
      hookType: normalizedType,
      success: true,
      durationMs,
      timestamp: Date.now(),
      ...metadata
    });

    this.emit('hook:success', { hookType: normalizedType, durationMs, metadata });
  }

  /**
   * Record a failed hook execution
   * @param {string} hookType - Type of hook
   * @param {string} errorCategory - Category of error (e.g., 'timeout', 'parse-error')
   * @param {number} durationMs - Execution duration before failure
   * @param {Object} metadata - Additional metadata including error details
   */
  recordFailure(hookType, errorCategory, durationMs, metadata = {}) {
    const normalizedType = this._normalizeHookType(hookType);
    const normalizedCategory = this._normalizeErrorCategory(errorCategory);

    if (this.hookCounters[normalizedType]) {
      this.hookCounters[normalizedType].failure.increment();
      if (normalizedCategory === 'timeout') {
        this.hookCounters[normalizedType].timeout.increment();
      }
      this.hookCounters[normalizedType].duration.record(durationMs);
    }

    if (this.errorCounters[normalizedCategory]) {
      this.errorCounters[normalizedCategory].increment();
    }

    this.totalFailure.increment();

    // Record in rolling windows
    for (const window of Object.values(this.rollingWindows.failure)) {
      window.record(1);
    }

    // Add to recent executions
    this._addRecentExecution({
      hookType: normalizedType,
      success: false,
      errorCategory: normalizedCategory,
      durationMs,
      timestamp: Date.now(),
      error: metadata.error,
      ...metadata
    });

    this.emit('hook:failure', { hookType: normalizedType, errorCategory: normalizedCategory, durationMs, metadata });
  }

  /**
   * Record a hook retry attempt
   * @param {string} hookType - Type of hook
   * @param {number} attemptNumber - Current attempt number
   */
  recordRetry(hookType, attemptNumber) {
    this.totalRetries.increment();
    this.emit('hook:retry', { hookType, attemptNumber, timestamp: Date.now() });
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

  /**
   * Get overall hook reliability summary
   * @returns {Object} Summary statistics
   */
  getSummary() {
    const totalSuccess = this.totalSuccess.get();
    const totalFailure = this.totalFailure.get();
    const totalExecutions = totalSuccess + totalFailure;
    const overallSuccessRate = totalExecutions > 0 ? (totalSuccess / totalExecutions) * 100 : 100;

    return {
      timestamp: Date.now(),
      metricsId: this.metricsId,
      uptime: Date.now() - this._createdAt,

      overall: {
        totalExecutions,
        successCount: totalSuccess,
        failureCount: totalFailure,
        successRate: overallSuccessRate,
        retryCount: this.totalRetries.get()
      },

      perHook: this.getPerHookStats(),

      errorCategories: this.getErrorCategoryStats(),

      rolling: {
        minute: this.getRollingSuccessRate('minute'),
        hour: this.getRollingSuccessRate('hour'),
        day: this.getRollingSuccessRate('day')
      },

      recentExecutions: this._recentExecutions.slice(-10)
    };
  }

  /**
   * Get per-hook statistics
   * @returns {Object} Stats organized by hook type
   */
  getPerHookStats() {
    const stats = {};

    for (const [hookType, counters] of Object.entries(this.hookCounters)) {
      const success = counters.success.get();
      const failure = counters.failure.get();
      const total = success + failure;
      const successRate = total > 0 ? (success / total) * 100 : 100;

      stats[hookType] = {
        totalExecutions: total,
        successCount: success,
        failureCount: failure,
        timeoutCount: counters.timeout.get(),
        successRate,
        duration: counters.duration.getStats()
      };
    }

    return stats;
  }

  /**
   * Get error category breakdown
   * @returns {Object} Error counts by category
   */
  getErrorCategoryStats() {
    const stats = {};
    let total = 0;

    for (const [category, counter] of Object.entries(this.errorCounters)) {
      const count = counter.get();
      stats[category] = count;
      total += count;
    }

    // Add percentages
    const result = { counts: stats, total, percentages: {} };
    for (const [category, count] of Object.entries(stats)) {
      result.percentages[category] = total > 0 ? (count / total) * 100 : 0;
    }

    return result;
  }

  /**
   * Get rolling success rate for a time window
   * @param {string} windowName - Name of window ('minute', 'hour', 'day')
   * @returns {Object} Success rate data
   */
  getRollingSuccessRate(windowName) {
    const successWindow = this.rollingWindows.success[windowName];
    const failureWindow = this.rollingWindows.failure[windowName];

    if (!successWindow || !failureWindow) {
      return null;
    }

    const successCount = successWindow.getTotal();
    const failureCount = failureWindow.getTotal();
    const total = successCount + failureCount;

    return {
      windowName,
      windowSize: successWindow.windowSize,
      successCount,
      failureCount,
      totalExecutions: total,
      successRate: total > 0 ? (successCount / total) * 100 : 100,
      executionsPerSecond: (successCount + failureCount) / (successWindow.windowSize / 1000)
    };
  }

  /**
   * Get statistics for a specific hook type
   * @param {string} hookType - Hook type to query
   * @returns {Object|null} Hook stats or null if not found
   */
  getHookStats(hookType) {
    const normalizedType = this._normalizeHookType(hookType);
    const counters = this.hookCounters[normalizedType];

    if (!counters) {
      return null;
    }

    const success = counters.success.get();
    const failure = counters.failure.get();
    const total = success + failure;

    return {
      hookType: normalizedType,
      totalExecutions: total,
      successCount: success,
      failureCount: failure,
      timeoutCount: counters.timeout.get(),
      successRate: total > 0 ? (success / total) * 100 : 100,
      duration: counters.duration.getStats()
    };
  }

  /**
   * Get recent execution history
   * @param {number} limit - Max number of executions to return
   * @returns {Array} Recent executions
   */
  getRecentExecutions(limit = 20) {
    return this._recentExecutions.slice(-limit);
  }

  // ============================================================================
  // SNAPSHOT METHODS
  // ============================================================================

  /**
   * Take a snapshot of current metrics state
   * @returns {Object} Snapshot data
   */
  takeSnapshot() {
    const snapshot = {
      snapshotId: `snap-${Date.now()}`,
      timestamp: Date.now(),
      overall: {
        success: this.totalSuccess.get(),
        failure: this.totalFailure.get(),
        retries: this.totalRetries.get()
      },
      perHook: {},
      errorCategories: {}
    };

    for (const [hookType, counters] of Object.entries(this.hookCounters)) {
      snapshot.perHook[hookType] = {
        success: counters.success.get(),
        failure: counters.failure.get(),
        timeout: counters.timeout.get()
      };
    }

    for (const [category, counter] of Object.entries(this.errorCounters)) {
      snapshot.errorCategories[category] = counter.get();
    }

    this._snapshots.push(snapshot);
    if (this._snapshots.length > this._maxSnapshots) {
      this._snapshots.shift();
    }

    this.emit('metrics:snapshot', snapshot);
    return snapshot;
  }

  /**
   * Get snapshots for trend analysis
   * @param {Object} options - Filter options
   * @returns {Array} Matching snapshots
   */
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

  // ============================================================================
  // PERSISTENCE METHODS
  // ============================================================================

  /**
   * Start automatic persistence
   * @param {number} intervalMs - Persistence interval
   */
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

  /**
   * Stop automatic persistence
   */
  stopPersistence() {
    if (this._persistTimer) {
      clearInterval(this._persistTimer);
      this._persistTimer = null;
    }
  }

  /**
   * Persist current metrics to disk
   * @returns {Object} Persisted data
   */
  persist() {
    try {
      const data = this.toJSON();
      const dir = path.dirname(this.config.persistence.path);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.config.persistence.path, JSON.stringify(data, null, 2));
      this.emit('metrics:persisted', { path: this.config.persistence.path, timestamp: Date.now() });
      return data;
    } catch (error) {
      this.emit('metrics:persist-error', { error: error.message });
      return null;
    }
  }

  /**
   * Load metrics from disk
   * @private
   */
  _loadFromDisk() {
    try {
      if (fs.existsSync(this.config.persistence.path)) {
        const data = JSON.parse(fs.readFileSync(this.config.persistence.path, 'utf8'));
        this._restoreFromJSON(data);
        this.emit('metrics:loaded', { path: this.config.persistence.path });
      }
    } catch (error) {
      // Silent fail on load - start fresh
      this.emit('metrics:load-error', { error: error.message });
    }
  }

  // ============================================================================
  // LIFECYCLE METHODS
  // ============================================================================

  /**
   * Reset all metrics
   */
  reset() {
    for (const counters of Object.values(this.hookCounters)) {
      counters.success.reset();
      counters.failure.reset();
      counters.timeout.reset();
      counters.duration.reset();
    }

    for (const counter of Object.values(this.errorCounters)) {
      counter.reset();
    }

    this.totalSuccess.reset();
    this.totalFailure.reset();
    this.totalRetries.reset();

    for (const windowSet of Object.values(this.rollingWindows)) {
      for (const window of Object.values(windowSet)) {
        window.reset();
      }
    }

    this._recentExecutions = [];
    this._snapshots = [];
    this._lastResetAt = Date.now();

    this.emit('metrics:reset', { timestamp: this._lastResetAt });
  }

  /**
   * Close metrics (stop persistence, cleanup)
   */
  close() {
    this.stopPersistence();
    this.persist(); // Final persist
    this.emit('metrics:closed', { timestamp: Date.now() });
  }

  // ============================================================================
  // SERIALIZATION
  // ============================================================================

  /**
   * Serialize metrics to JSON
   * @returns {Object} JSON-serializable data
   */
  toJSON() {
    return {
      metricsId: this.metricsId,
      createdAt: this._createdAt,
      lastResetAt: this._lastResetAt,
      persistedAt: Date.now(),

      hookCounters: Object.fromEntries(
        Object.entries(this.hookCounters).map(([hookType, counters]) => [
          hookType,
          {
            success: counters.success.toJSON(),
            failure: counters.failure.toJSON(),
            timeout: counters.timeout.toJSON(),
            duration: counters.duration.toJSON()
          }
        ])
      ),

      errorCounters: Object.fromEntries(
        Object.entries(this.errorCounters).map(([cat, counter]) => [cat, counter.toJSON()])
      ),

      totalSuccess: this.totalSuccess.toJSON(),
      totalFailure: this.totalFailure.toJSON(),
      totalRetries: this.totalRetries.toJSON(),

      recentExecutions: this._recentExecutions.slice(-50),
      snapshots: this._snapshots.slice(-20)
    };
  }

  /**
   * Restore state from JSON data
   * @param {Object} data - Previously persisted data
   * @private
   */
  _restoreFromJSON(data) {
    if (data.hookCounters) {
      for (const [hookType, counters] of Object.entries(data.hookCounters)) {
        if (this.hookCounters[hookType]) {
          this.hookCounters[hookType].success = AtomicCounter.fromJSON(counters.success);
          this.hookCounters[hookType].failure = AtomicCounter.fromJSON(counters.failure);
          this.hookCounters[hookType].timeout = AtomicCounter.fromJSON(counters.timeout);
          if (counters.duration) {
            this.hookCounters[hookType].duration = Histogram.fromJSON(counters.duration);
          }
        }
      }
    }

    if (data.errorCounters) {
      for (const [category, counterData] of Object.entries(data.errorCounters)) {
        if (this.errorCounters[category]) {
          this.errorCounters[category] = AtomicCounter.fromJSON(counterData);
        }
      }
    }

    if (data.totalSuccess) this.totalSuccess = AtomicCounter.fromJSON(data.totalSuccess);
    if (data.totalFailure) this.totalFailure = AtomicCounter.fromJSON(data.totalFailure);
    if (data.totalRetries) this.totalRetries = AtomicCounter.fromJSON(data.totalRetries);

    this._recentExecutions = data.recentExecutions || [];
    this._snapshots = data.snapshots || [];
    this._createdAt = data.createdAt || this._createdAt;
    this._lastResetAt = data.lastResetAt || this._lastResetAt;
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Add execution to recent history
   * @param {Object} execution - Execution record
   * @private
   */
  _addRecentExecution(execution) {
    this._recentExecutions.push(execution);
    if (this._recentExecutions.length > this._maxRecentExecutions) {
      this._recentExecutions.shift();
    }
  }

  /**
   * Normalize hook type to known type
   * @param {string} hookType - Raw hook type
   * @returns {string} Normalized type
   * @private
   */
  _normalizeHookType(hookType) {
    const normalized = hookType.toLowerCase().replace(/_/g, '-');
    return HOOK_TYPES.includes(normalized) ? normalized : 'session-start'; // Default fallback
  }

  /**
   * Normalize error category
   * @param {string} category - Raw category
   * @returns {string} Normalized category
   * @private
   */
  _normalizeErrorCategory(category) {
    if (!category) return 'unknown';
    const normalized = category.toLowerCase().replace(/_/g, '-');
    return ERROR_CATEGORIES.includes(normalized) ? normalized : 'unknown';
  }

  /**
   * Merge configuration with defaults
   * @param {Object} defaults - Default config
   * @param {Object} overrides - User overrides
   * @returns {Object} Merged config
   * @private
   */
  _mergeConfig(defaults, overrides) {
    const merged = { ...defaults };
    if (!overrides || typeof overrides !== 'object') return merged;

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
// SINGLETON INSTANCE
// ============================================================================

let _instance = null;

/**
 * Get singleton HookMetrics instance
 * @param {Object} options - Configuration options
 * @returns {HookMetrics} Singleton instance
 */
function getHookMetrics(options = {}) {
  if (!_instance) {
    _instance = new HookMetrics(options);
  }
  return _instance;
}

/**
 * Reset singleton instance (for testing)
 */
function resetHookMetrics() {
  if (_instance) {
    _instance.close();
    _instance = null;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  HookMetrics,
  getHookMetrics,
  resetHookMetrics,
  HOOK_TYPES,
  ERROR_CATEGORIES,
  DEFAULT_DURATION_BUCKETS,
  DEFAULT_METRICS_CONFIG
};
