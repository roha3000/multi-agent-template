/**
 * ShadowModeMetrics - Metrics Collection for Shadow Mode Validation
 *
 * Tracks conflict counts, merge counts, divergence counts, and latency metrics
 * for validating consistency between JSON and SQLite operations during shadow mode.
 *
 * Phase 3 of Parallel Session Safety implementation.
 *
 * @module shadow-mode-metrics
 */

const EventEmitter = require('events');
const crypto = require('crypto');

/**
 * Ring buffer for latency samples with statistical calculations
 */
class LatencyRingBuffer {
  constructor(size = 100) {
    this.size = size;
    this.buffer = [];
    this.index = 0;
    this.total = 0;
    this.count = 0;
  }

  add(value) {
    if (this.buffer.length < this.size) {
      this.buffer.push(value);
      this.total += value;
    } else {
      this.total -= this.buffer[this.index];
      this.total += value;
      this.buffer[this.index] = value;
    }
    this.index = (this.index + 1) % this.size;
    this.count++;
  }

  getStats() {
    if (this.buffer.length === 0) {
      return { avg: 0, p99: 0, max: 0, samples: 0 };
    }

    const sorted = [...this.buffer].sort((a, b) => a - b);
    const avg = this.total / this.buffer.length;
    const p99Index = Math.floor(sorted.length * 0.99);
    const p99 = sorted[Math.min(p99Index, sorted.length - 1)];
    const max = sorted[sorted.length - 1];

    return {
      avg: Math.round(avg * 100) / 100,
      p99: p99,
      max: max,
      samples: this.count
    };
  }

  reset() {
    this.buffer = [];
    this.index = 0;
    this.total = 0;
    this.count = 0;
  }
}

class ShadowModeMetrics extends EventEmitter {
  /**
   * Create a new ShadowModeMetrics instance
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    super();

    this.options = {
      persistInterval: options.persistInterval || 60000, // 1 minute
      latencyBufferSize: options.latencyBufferSize || 100,
      divergenceThreshold: options.divergenceThreshold || 5,
      ...options
    };

    // Core counters (as specified in task)
    this._counters = {
      conflict_count: 0,
      merge_count: 0,
      divergence_count: 0,
      save_count: 0,
      load_count: 0,
      retry_count: 0,
      lock_acquired: 0,
      lock_failed: 0,
      lock_timeout: 0,
      hash_computed: 0,
      validation_passed: 0,
      validation_failed: 0
    };

    // Error counters by type
    this._errors = {
      sqlite: 0,
      json: 0,
      hash: 0,
      io: 0,
      other: 0
    };

    // Latency trackers
    this._latency = {
      save: new LatencyRingBuffer(this.options.latencyBufferSize),
      load: new LatencyRingBuffer(this.options.latencyBufferSize),
      hash: new LatencyRingBuffer(this.options.latencyBufferSize),
      lock: new LatencyRingBuffer(this.options.latencyBufferSize),
      validation: new LatencyRingBuffer(this.options.latencyBufferSize)
    };

    // Session state
    this._session = {
      enabled: false,
      enabledAt: null,
      sessionId: options.sessionId || crypto.randomUUID(),
      lastDivergenceAt: null,
      lastSyncAt: null,
      lastSaveAt: null
    };

    // Divergence history (bounded)
    this._divergences = [];
    this._maxDivergences = options.maxDivergences || 50;

    // Persist timer
    this._persistTimer = null;
    this._coordinationDb = null;
  }

  // ============================================================================
  // COUNTER METHODS
  // ============================================================================

  /**
   * Increment a counter
   * @param {string} name - Counter name
   * @param {number} amount - Amount to increment (default 1)
   */
  increment(name, amount = 1) {
    if (this._counters.hasOwnProperty(name)) {
      this._counters[name] += amount;
      this.emit('counter:incremented', { name, value: this._counters[name] });
    }
  }

  /**
   * Record a conflict
   */
  recordConflict() {
    this.increment('conflict_count');
    this.emit('metric:conflict', { timestamp: Date.now() });
  }

  /**
   * Record a successful merge
   */
  recordMerge() {
    this.increment('merge_count');
    this.emit('metric:merge', { timestamp: Date.now() });
  }

  /**
   * Record a divergence detection
   * @param {Object} divergence - Divergence details
   */
  recordDivergence(divergence) {
    this.increment('divergence_count');
    this._session.lastDivergenceAt = Date.now();

    const record = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      type: divergence.type || 'unknown',
      severity: divergence.severity || 'warning',
      jsonHash: divergence.jsonHash,
      sqliteHash: divergence.sqliteHash,
      version: divergence.version,
      details: divergence.details || {},
      resolved: false,
      resolvedAt: null
    };

    this._divergences.unshift(record);

    // Keep bounded
    if (this._divergences.length > this._maxDivergences) {
      this._divergences = this._divergences.slice(0, this._maxDivergences);
    }

    this.emit('metric:divergence', record);
    return record;
  }

  /**
   * Record a save operation
   * @param {number} durationMs - Save duration in milliseconds
   */
  recordSave(durationMs) {
    this.increment('save_count');
    this._latency.save.add(durationMs);
    this._session.lastSaveAt = Date.now();
    this.emit('metric:save', { duration: durationMs, timestamp: Date.now() });
  }

  /**
   * Record a load operation
   * @param {number} durationMs - Load duration in milliseconds
   */
  recordLoad(durationMs) {
    this.increment('load_count');
    this._latency.load.add(durationMs);
    this.emit('metric:load', { duration: durationMs, timestamp: Date.now() });
  }

  /**
   * Record hash computation
   * @param {number} durationMs - Hash computation duration
   */
  recordHash(durationMs) {
    this.increment('hash_computed');
    this._latency.hash.add(durationMs);
  }

  /**
   * Record lock acquisition attempt
   * @param {boolean} success - Whether lock was acquired
   * @param {number} durationMs - Time spent acquiring lock
   */
  recordLock(success, durationMs) {
    if (success) {
      this.increment('lock_acquired');
    } else {
      this.increment('lock_failed');
    }
    this._latency.lock.add(durationMs);
  }

  /**
   * Record validation result
   * @param {boolean} passed - Whether validation passed
   * @param {number} durationMs - Validation duration
   */
  recordValidation(passed, durationMs) {
    if (passed) {
      this.increment('validation_passed');
      this._session.lastSyncAt = Date.now();
    } else {
      this.increment('validation_failed');
    }
    this._latency.validation.add(durationMs);
  }

  /**
   * Record an error
   * @param {string} type - Error type (sqlite, json, hash, io, other)
   */
  recordError(type) {
    if (this._errors.hasOwnProperty(type)) {
      this._errors[type]++;
    } else {
      this._errors.other++;
    }
    this.emit('metric:error', { type, timestamp: Date.now() });
  }

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================

  /**
   * Enable shadow mode metrics
   */
  enable() {
    this._session.enabled = true;
    this._session.enabledAt = Date.now();
    this.emit('shadow:enabled', { sessionId: this._session.sessionId });
  }

  /**
   * Disable shadow mode metrics
   */
  disable() {
    this._session.enabled = false;
    this.emit('shadow:disabled', { sessionId: this._session.sessionId });
  }

  /**
   * Check if shadow mode is enabled
   * @returns {boolean}
   */
  isEnabled() {
    return this._session.enabled;
  }

  /**
   * Mark a divergence as resolved
   * @param {string} divergenceId - Divergence ID
   * @param {string} resolution - Resolution method
   */
  resolveDivergence(divergenceId, resolution = 'manual') {
    const divergence = this._divergences.find(d => d.id === divergenceId);
    if (divergence) {
      divergence.resolved = true;
      divergence.resolvedAt = Date.now();
      divergence.resolution = resolution;
      this.emit('divergence:resolved', { id: divergenceId, resolution });
    }
    return divergence;
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

  /**
   * Get all counters
   * @returns {Object} Counter values
   */
  getCounters() {
    return { ...this._counters };
  }

  /**
   * Get error counts
   * @returns {Object} Error counts by type
   */
  getErrors() {
    return { ...this._errors };
  }

  /**
   * Get latency statistics
   * @returns {Object} Latency stats for each operation type
   */
  getLatencyStats() {
    return {
      save: this._latency.save.getStats(),
      load: this._latency.load.getStats(),
      hash: this._latency.hash.getStats(),
      lock: this._latency.lock.getStats(),
      validation: this._latency.validation.getStats()
    };
  }

  /**
   * Get session state
   * @returns {Object} Session state
   */
  getSessionState() {
    return { ...this._session };
  }

  /**
   * Get divergence history
   * @param {Object} options - Query options
   * @returns {Array} Divergences
   */
  getDivergences(options = {}) {
    let divergences = [...this._divergences];

    if (options.unresolvedOnly) {
      divergences = divergences.filter(d => !d.resolved);
    }

    if (options.limit) {
      divergences = divergences.slice(0, options.limit);
    }

    return divergences;
  }

  /**
   * Get complete metrics summary
   * @returns {Object} Complete metrics summary
   */
  getSummary() {
    const counters = this.getCounters();
    const latency = this.getLatencyStats();
    const session = this.getSessionState();
    const errors = this.getErrors();

    // Calculate rates
    const totalOps = counters.save_count + counters.load_count;
    const divergenceRate = totalOps > 0
      ? (counters.divergence_count / totalOps * 100).toFixed(2)
      : 0;
    const conflictRate = counters.save_count > 0
      ? (counters.conflict_count / counters.save_count * 100).toFixed(2)
      : 0;
    const validationSuccessRate = (counters.validation_passed + counters.validation_failed) > 0
      ? (counters.validation_passed / (counters.validation_passed + counters.validation_failed) * 100).toFixed(2)
      : 100;

    return {
      enabled: session.enabled,
      sessionId: session.sessionId,
      enabledAt: session.enabledAt,
      counters,
      errors,
      latency,
      rates: {
        divergence: parseFloat(divergenceRate),
        conflict: parseFloat(conflictRate),
        validationSuccess: parseFloat(validationSuccessRate)
      },
      timestamps: {
        lastDivergence: session.lastDivergenceAt,
        lastSync: session.lastSyncAt,
        lastSave: session.lastSaveAt
      },
      divergenceCount: this._divergences.filter(d => !d.resolved).length
    };
  }

  /**
   * Calculate health score (0-100)
   * @returns {Object} Health assessment
   */
  getHealth() {
    const summary = this.getSummary();
    let score = 100;
    let status = 'healthy';
    const issues = [];

    // Deduct for divergences
    if (summary.rates.divergence > 5) {
      score -= 40;
      issues.push(`High divergence rate: ${summary.rates.divergence}%`);
    } else if (summary.rates.divergence > 1) {
      score -= 20;
      issues.push(`Moderate divergence rate: ${summary.rates.divergence}%`);
    } else if (summary.rates.divergence > 0) {
      score -= 5;
    }

    // Deduct for conflicts
    if (summary.rates.conflict > 10) {
      score -= 20;
      issues.push(`High conflict rate: ${summary.rates.conflict}%`);
    } else if (summary.rates.conflict > 5) {
      score -= 10;
    }

    // Deduct for unresolved divergences
    if (summary.divergenceCount > 5) {
      score -= 15;
      issues.push(`${summary.divergenceCount} unresolved divergences`);
    } else if (summary.divergenceCount > 0) {
      score -= 5;
    }

    // Deduct for errors
    const totalErrors = Object.values(summary.errors).reduce((a, b) => a + b, 0);
    if (totalErrors > 10) {
      score -= 10;
      issues.push(`${totalErrors} errors recorded`);
    }

    // Deduct for validation failures
    if (summary.rates.validationSuccess < 90) {
      score -= 15;
      issues.push(`Low validation success: ${summary.rates.validationSuccess}%`);
    } else if (summary.rates.validationSuccess < 99) {
      score -= 5;
    }

    // Ensure score is in range
    score = Math.max(0, Math.min(100, score));

    // Determine status
    if (score >= 90) {
      status = 'healthy';
    } else if (score >= 70) {
      status = 'warning';
    } else if (score >= 50) {
      status = 'degraded';
    } else {
      status = 'critical';
    }

    return {
      score,
      status,
      issues,
      ready_for_migration: score >= 90 && summary.counters.save_count >= 100,
      metrics_since: summary.enabledAt,
      total_operations: summary.counters.save_count + summary.counters.load_count
    };
  }

  // ============================================================================
  // PERSISTENCE (Integration with CoordinationDB)
  // ============================================================================

  /**
   * Set coordination database for persistence
   * @param {CoordinationDB} db - Coordination database instance
   */
  setCoordinationDb(db) {
    this._coordinationDb = db;
    this._initPersistence();
  }

  /**
   * Initialize persistence tables
   * @private
   */
  _initPersistence() {
    if (!this._coordinationDb) return;

    // Add shadow mode metrics table via raw SQL
    try {
      this._coordinationDb.db.exec(`
        CREATE TABLE IF NOT EXISTS shadow_mode_metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          period TEXT NOT NULL DEFAULT 'session',
          counters TEXT NOT NULL,
          errors TEXT NOT NULL,
          latency TEXT NOT NULL,
          rates TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_shadow_metrics_session
          ON shadow_mode_metrics(session_id, timestamp DESC);

        CREATE TABLE IF NOT EXISTS shadow_mode_divergences (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          type TEXT NOT NULL,
          severity TEXT NOT NULL,
          json_hash TEXT,
          sqlite_hash TEXT,
          version INTEGER,
          details TEXT,
          resolved INTEGER NOT NULL DEFAULT 0,
          resolved_at INTEGER,
          resolution TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_shadow_divergences_session
          ON shadow_mode_divergences(session_id, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_shadow_divergences_resolved
          ON shadow_mode_divergences(resolved) WHERE resolved = 0;
      `);

      this._preparePersistStatements();
    } catch (error) {
      console.warn('[ShadowModeMetrics] Could not initialize persistence:', error.message);
    }
  }

  /**
   * Prepare persistence statements
   * @private
   */
  _preparePersistStatements() {
    if (!this._coordinationDb) return;

    this._persistStmts = {
      upsertMetrics: this._coordinationDb.db.prepare(`
        INSERT INTO shadow_mode_metrics (session_id, timestamp, period, counters, errors, latency, rates)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      insertDivergence: this._coordinationDb.db.prepare(`
        INSERT OR REPLACE INTO shadow_mode_divergences
        (id, session_id, timestamp, type, severity, json_hash, sqlite_hash, version, details, resolved, resolved_at, resolution)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
    };
  }

  /**
   * Persist current metrics to SQLite
   */
  persist() {
    if (!this._coordinationDb || !this._persistStmts) return;

    try {
      const summary = this.getSummary();

      this._persistStmts.upsertMetrics.run(
        this._session.sessionId,
        Date.now(),
        'session',
        JSON.stringify(summary.counters),
        JSON.stringify(summary.errors),
        JSON.stringify(summary.latency),
        JSON.stringify(summary.rates)
      );

      // Persist unsynced divergences
      for (const div of this._divergences) {
        this._persistStmts.insertDivergence.run(
          div.id,
          this._session.sessionId,
          div.timestamp,
          div.type,
          div.severity,
          div.jsonHash || null,
          div.sqliteHash || null,
          div.version || null,
          JSON.stringify(div.details),
          div.resolved ? 1 : 0,
          div.resolvedAt || null,
          div.resolution || null
        );
      }

      this.emit('metrics:persisted', { timestamp: Date.now() });
    } catch (error) {
      console.warn('[ShadowModeMetrics] Persist failed:', error.message);
    }
  }

  /**
   * Start auto-persist timer
   */
  startPersistTimer() {
    this.stopPersistTimer();

    this._persistTimer = setInterval(() => {
      this.persist();
    }, this.options.persistInterval);

    // Don't prevent process exit
    if (this._persistTimer.unref) {
      this._persistTimer.unref();
    }
  }

  /**
   * Stop auto-persist timer
   */
  stopPersistTimer() {
    if (this._persistTimer) {
      clearInterval(this._persistTimer);
      this._persistTimer = null;
    }
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  /**
   * Reset all metrics
   */
  reset() {
    for (const key of Object.keys(this._counters)) {
      this._counters[key] = 0;
    }
    for (const key of Object.keys(this._errors)) {
      this._errors[key] = 0;
    }
    for (const key of Object.keys(this._latency)) {
      this._latency[key].reset();
    }
    this._divergences = [];
    this._session.lastDivergenceAt = null;
    this._session.lastSyncAt = null;
    this._session.lastSaveAt = null;

    this.emit('metrics:reset', { timestamp: Date.now() });
  }

  /**
   * Close and cleanup
   */
  close() {
    this.stopPersistTimer();
    this.persist(); // Final persist
    this.emit('metrics:closed', { sessionId: this._session.sessionId });
  }
}

module.exports = ShadowModeMetrics;
