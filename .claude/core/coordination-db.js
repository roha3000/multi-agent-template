/**
 * CoordinationDB - SQLite-based Cross-Process Coordination
 *
 * Provides distributed locking, session tracking, and change journaling
 * for concurrent multi-session access to tasks.json.
 *
 * Phase 2 of Parallel Session Safety implementation.
 *
 * Features:
 * - Cross-process resource locking with TTL-based expiration
 * - Session heartbeat tracking with stale detection
 * - Change journal for audit trail
 * - Automatic cleanup of stale locks and sessions
 *
 * @module coordination-db
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const crypto = require('crypto');

class CoordinationDB extends EventEmitter {
  /**
   * Create a new CoordinationDB instance
   * @param {string} dbPath - Path to SQLite database file
   * @param {Object} options - Configuration options
   */
  constructor(dbPath, options = {}) {
    super();

    this.dbPath = dbPath || path.join(process.cwd(), '.claude', 'dev-docs', '.coordination', 'tasks.db');
    this.options = {
      defaultLockTTL: options.defaultLockTTL || 60000, // 60 seconds
      staleSessionThreshold: options.staleSessionThreshold || 5 * 60 * 1000, // 5 minutes
      heartbeatInterval: options.heartbeatInterval || 30000, // 30 seconds
      cleanupInterval: options.cleanupInterval || 60000, // 1 minute
      autoCleanup: options.autoCleanup !== false,
      journalRetention: options.journalRetention || 7 * 24 * 60 * 60 * 1000, // 7 days
      // Claim configuration
      claimConfig: {
        defaultTTL: (options.claimConfig && options.claimConfig.defaultTTL) || 30 * 60 * 1000, // 30 minutes
        cleanupInterval: (options.claimConfig && options.claimConfig.cleanupInterval) || 5 * 60 * 1000, // 5 minutes
        orphanThreshold: (options.claimConfig && options.claimConfig.orphanThreshold) || 10 * 60 * 1000, // 10 minutes
        warningThreshold: (options.claimConfig && options.claimConfig.warningThreshold) || 5 * 60 * 1000, // 5 minutes remaining
        ...(options.claimConfig || {})
      },
      ...options
    };

    // Internal state
    this._heartbeatTimer = null;
    this._cleanupTimer = null;
    this._currentSessionId = null;

    // Initialize database
    this._ensureDirectory();
    this._initDatabase();

    // Start auto-cleanup if enabled
    if (this.options.autoCleanup) {
      this._startCleanupTimer();
    }
  }

  // ============================================================================
  // DATABASE INITIALIZATION
  // ============================================================================

  /**
   * Ensure database directory exists
   * @private
   */
  _ensureDirectory() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Initialize SQLite database with schema
   * @private
   */
  _initDatabase() {
    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrent access
    this.db.pragma('journal_mode = WAL');

    // Create tables
    this.db.exec(`
      -- Sessions table: Track active CLI/agent sessions
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY NOT NULL,
        project_path TEXT NOT NULL,
        agent_type TEXT,
        started_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        last_heartbeat INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        metadata TEXT,
        pid INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_project_path ON sessions(project_path);
      CREATE INDEX IF NOT EXISTS idx_sessions_last_heartbeat ON sessions(last_heartbeat);

      -- Locks table: Cross-process resource locking
      CREATE TABLE IF NOT EXISTS locks (
        resource TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL,
        acquired_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        expires_at INTEGER NOT NULL,
        lock_type TEXT NOT NULL DEFAULT 'exclusive',
        refresh_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_locks_session_id ON locks(session_id);
      CREATE INDEX IF NOT EXISTS idx_locks_expires_at ON locks(expires_at);

      -- Change journal: Audit trail of all changes
      CREATE TABLE IF NOT EXISTS change_journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        resource TEXT NOT NULL,
        operation TEXT NOT NULL,
        change_data TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        applied INTEGER NOT NULL DEFAULT 0,
        checksum TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_change_journal_resource ON change_journal(resource, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_change_journal_session ON change_journal(session_id);
      CREATE INDEX IF NOT EXISTS idx_change_journal_applied ON change_journal(applied) WHERE applied = 0;

      -- Conflicts table: Track detected conflicts for dashboard visibility
      CREATE TABLE IF NOT EXISTS conflicts (
        id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('VERSION_CONFLICT', 'CONCURRENT_EDIT', 'STALE_LOCK', 'MERGE_FAILURE')),
        resource TEXT NOT NULL,
        detected_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        severity TEXT NOT NULL DEFAULT 'warning' CHECK(severity IN ('info', 'warning', 'critical')),

        -- Session A (the session that detected the conflict)
        session_a_id TEXT NOT NULL,
        session_a_data TEXT,
        session_a_version INTEGER,
        session_a_timestamp INTEGER,

        -- Session B (the conflicting session)
        session_b_id TEXT,
        session_b_data TEXT,
        session_b_version INTEGER,
        session_b_timestamp INTEGER,

        -- Conflict details
        affected_task_ids TEXT,
        field_conflicts TEXT,
        description TEXT,

        -- Resolution tracking
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'resolved', 'auto-resolved', 'escalated')),
        resolution TEXT CHECK(resolution IN (NULL, 'version_a', 'version_b', 'merged', 'manual', 'discarded')),
        resolution_data TEXT,
        resolved_at INTEGER,
        resolved_by TEXT,
        resolution_notes TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_conflicts_status ON conflicts(status) WHERE status = 'pending';
      CREATE INDEX IF NOT EXISTS idx_conflicts_resource ON conflicts(resource, detected_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conflicts_session_a ON conflicts(session_a_id);
      CREATE INDEX IF NOT EXISTS idx_conflicts_detected_at ON conflicts(detected_at DESC);

      -- Delegation metrics table: Track aggregated delegation performance metrics
      CREATE TABLE IF NOT EXISTS delegation_metrics (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT,
        metrics_type TEXT NOT NULL DEFAULT 'delegation',

        -- Counters
        total_delegations INTEGER NOT NULL DEFAULT 0,
        successful_delegations INTEGER NOT NULL DEFAULT 0,
        failed_delegations INTEGER NOT NULL DEFAULT 0,
        retries INTEGER NOT NULL DEFAULT 0,
        timeouts INTEGER NOT NULL DEFAULT 0,

        -- Duration stats (in milliseconds)
        avg_duration_ms REAL NOT NULL DEFAULT 0,
        min_duration_ms REAL,
        max_duration_ms REAL,
        p50_duration_ms REAL,
        p95_duration_ms REAL,
        p99_duration_ms REAL,

        -- Quality metrics (0-100)
        avg_quality_score REAL NOT NULL DEFAULT 0,
        min_quality_score REAL,
        max_quality_score REAL,

        -- Pattern distribution (JSON object)
        pattern_distribution TEXT,

        -- Resource utilization
        peak_concurrent_children INTEGER NOT NULL DEFAULT 0,
        total_tokens_consumed INTEGER NOT NULL DEFAULT 0,

        -- Timestamps
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),

        -- Full metrics data (JSON blob for complete state)
        metrics_data TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_delegation_metrics_session ON delegation_metrics(session_id);
      CREATE INDEX IF NOT EXISTS idx_delegation_metrics_type ON delegation_metrics(metrics_type);
      CREATE INDEX IF NOT EXISTS idx_delegation_metrics_updated ON delegation_metrics(updated_at DESC);

      -- Delegation snapshots table: Historical point-in-time metrics captures
      CREATE TABLE IF NOT EXISTS delegation_snapshots (
        id TEXT PRIMARY KEY NOT NULL,
        metrics_id TEXT NOT NULL,
        session_id TEXT,

        -- Snapshot timestamp
        snapshot_time INTEGER NOT NULL,

        -- Counters at snapshot time
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        retry_count INTEGER NOT NULL DEFAULT 0,
        timeout_count INTEGER NOT NULL DEFAULT 0,

        -- Duration histogram summary (JSON)
        duration_histogram TEXT,

        -- Quality metrics at snapshot
        avg_quality REAL,

        -- Pattern distribution at snapshot (JSON)
        pattern_snapshot TEXT,

        -- Resource state at snapshot
        active_children INTEGER NOT NULL DEFAULT 0,

        -- Full snapshot data (JSON blob)
        snapshot_data TEXT,

        -- Created timestamp
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_delegation_snapshots_metrics ON delegation_snapshots(metrics_id);
      CREATE INDEX IF NOT EXISTS idx_delegation_snapshots_session ON delegation_snapshots(session_id);
      CREATE INDEX IF NOT EXISTS idx_delegation_snapshots_time ON delegation_snapshots(snapshot_time DESC);

      -- Task Claims table: Atomic cross-process task claiming with session binding
      -- Purpose: Prevent multiple sessions from working on the same task simultaneously
      CREATE TABLE IF NOT EXISTS task_claims (
        task_id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL,
        claimed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        expires_at INTEGER NOT NULL,
        last_heartbeat INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        heartbeat_count INTEGER NOT NULL DEFAULT 0,
        agent_type TEXT CHECK(agent_type IN ('cli', 'autonomous', 'unknown')),
        release_reason TEXT CHECK(release_reason IN (NULL, 'completed', 'failed', 'manual', 'expired', 'session_dead', 'timeout')),
        metadata TEXT,

        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_task_claims_session ON task_claims(session_id);
      CREATE INDEX IF NOT EXISTS idx_task_claims_expires ON task_claims(expires_at);
      CREATE INDEX IF NOT EXISTS idx_task_claims_heartbeat ON task_claims(last_heartbeat);
    `);

    // Prepare commonly used statements
    this._prepareStatements();
  }

  /**
   * Prepare SQL statements for better performance
   * @private
   */
  _prepareStatements() {
    this._stmts = {
      // Session statements
      registerSession: this.db.prepare(`
        INSERT OR REPLACE INTO sessions (id, project_path, agent_type, started_at, last_heartbeat, metadata, pid)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      updateHeartbeat: this.db.prepare(`
        UPDATE sessions SET last_heartbeat = ? WHERE id = ?
      `),
      getSession: this.db.prepare(`
        SELECT * FROM sessions WHERE id = ?
      `),
      getStaleSessions: this.db.prepare(`
        SELECT * FROM sessions WHERE last_heartbeat < ?
      `),
      deleteSession: this.db.prepare(`
        DELETE FROM sessions WHERE id = ?
      `),
      getSessionsByProject: this.db.prepare(`
        SELECT * FROM sessions WHERE project_path = ? AND last_heartbeat >= ?
      `),
      getAllActiveSessions: this.db.prepare(`
        SELECT * FROM sessions WHERE last_heartbeat >= ?
      `),

      // Lock statements
      getLock: this.db.prepare(`
        SELECT * FROM locks WHERE resource = ?
      `),
      insertLock: this.db.prepare(`
        INSERT INTO locks (resource, session_id, acquired_at, expires_at, lock_type, refresh_count)
        VALUES (?, ?, ?, ?, ?, 0)
      `),
      updateLock: this.db.prepare(`
        UPDATE locks SET expires_at = ?, refresh_count = refresh_count + 1 WHERE resource = ? AND session_id = ?
      `),
      deleteLock: this.db.prepare(`
        DELETE FROM locks WHERE resource = ? AND session_id = ?
      `),
      deleteExpiredLocks: this.db.prepare(`
        DELETE FROM locks WHERE expires_at < ?
      `),
      getLocksBySession: this.db.prepare(`
        SELECT * FROM locks WHERE session_id = ?
      `),
      deleteAllSessionLocks: this.db.prepare(`
        DELETE FROM locks WHERE session_id = ?
      `),

      // Journal statements
      insertChange: this.db.prepare(`
        INSERT INTO change_journal (session_id, resource, operation, change_data, created_at, applied, checksum)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      getRecentChanges: this.db.prepare(`
        SELECT * FROM change_journal ORDER BY created_at DESC LIMIT ?
      `),
      getChangesBySession: this.db.prepare(`
        SELECT * FROM change_journal WHERE session_id = ? ORDER BY created_at DESC
      `),
      getChangesByResource: this.db.prepare(`
        SELECT * FROM change_journal WHERE resource = ? ORDER BY created_at DESC
      `),
      getChange: this.db.prepare(`
        SELECT * FROM change_journal WHERE id = ?
      `),
      markChangeApplied: this.db.prepare(`
        UPDATE change_journal SET applied = 1 WHERE id = ?
      `),
      deleteOldChanges: this.db.prepare(`
        DELETE FROM change_journal WHERE created_at < ? AND applied = 1
      `),

      // Conflict statements
      insertConflict: this.db.prepare(`
        INSERT INTO conflicts (id, type, resource, detected_at, severity, session_a_id, session_a_data,
          session_a_version, session_a_timestamp, session_b_id, session_b_data, session_b_version,
          session_b_timestamp, affected_task_ids, field_conflicts, description, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `),
      getConflict: this.db.prepare(`
        SELECT * FROM conflicts WHERE id = ?
      `),
      getPendingConflicts: this.db.prepare(`
        SELECT * FROM conflicts WHERE status = 'pending' ORDER BY detected_at DESC
      `),
      getConflictsByStatus: this.db.prepare(`
        SELECT * FROM conflicts WHERE status = ? ORDER BY detected_at DESC LIMIT ?
      `),
      getConflictsByResource: this.db.prepare(`
        SELECT * FROM conflicts WHERE resource = ? ORDER BY detected_at DESC LIMIT ?
      `),
      getAllConflicts: this.db.prepare(`
        SELECT * FROM conflicts ORDER BY detected_at DESC LIMIT ? OFFSET ?
      `),
      resolveConflict: this.db.prepare(`
        UPDATE conflicts SET status = ?, resolution = ?, resolution_data = ?,
          resolved_at = ?, resolved_by = ?, resolution_notes = ?
        WHERE id = ? AND status = 'pending'
      `),
      getConflictCount: this.db.prepare(`
        SELECT status, COUNT(*) as count FROM conflicts GROUP BY status
      `),
      deleteOldConflicts: this.db.prepare(`
        DELETE FROM conflicts WHERE resolved_at < ? AND status IN ('resolved', 'auto-resolved')
      `),

      // Delegation metrics statements
      upsertDelegationMetrics: this.db.prepare(`
        INSERT INTO delegation_metrics (id, session_id, metrics_type, total_delegations, successful_delegations,
          failed_delegations, retries, timeouts, avg_duration_ms, min_duration_ms, max_duration_ms,
          p50_duration_ms, p95_duration_ms, p99_duration_ms, avg_quality_score, min_quality_score,
          max_quality_score, pattern_distribution, peak_concurrent_children, total_tokens_consumed,
          created_at, updated_at, metrics_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          total_delegations = excluded.total_delegations,
          successful_delegations = excluded.successful_delegations,
          failed_delegations = excluded.failed_delegations,
          retries = excluded.retries,
          timeouts = excluded.timeouts,
          avg_duration_ms = excluded.avg_duration_ms,
          min_duration_ms = excluded.min_duration_ms,
          max_duration_ms = excluded.max_duration_ms,
          p50_duration_ms = excluded.p50_duration_ms,
          p95_duration_ms = excluded.p95_duration_ms,
          p99_duration_ms = excluded.p99_duration_ms,
          avg_quality_score = excluded.avg_quality_score,
          min_quality_score = excluded.min_quality_score,
          max_quality_score = excluded.max_quality_score,
          pattern_distribution = excluded.pattern_distribution,
          peak_concurrent_children = excluded.peak_concurrent_children,
          total_tokens_consumed = excluded.total_tokens_consumed,
          updated_at = excluded.updated_at,
          metrics_data = excluded.metrics_data
      `),
      getDelegationMetrics: this.db.prepare(`
        SELECT * FROM delegation_metrics WHERE id = ?
      `),
      getDelegationMetricsBySession: this.db.prepare(`
        SELECT * FROM delegation_metrics WHERE session_id = ? ORDER BY updated_at DESC
      `),
      getAllDelegationMetrics: this.db.prepare(`
        SELECT * FROM delegation_metrics ORDER BY updated_at DESC LIMIT ?
      `),
      deleteDelegationMetrics: this.db.prepare(`
        DELETE FROM delegation_metrics WHERE id = ?
      `),

      // Delegation snapshots statements
      insertDelegationSnapshot: this.db.prepare(`
        INSERT INTO delegation_snapshots (id, metrics_id, session_id, snapshot_time, success_count,
          failure_count, retry_count, timeout_count, duration_histogram, avg_quality,
          pattern_snapshot, active_children, snapshot_data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getDelegationSnapshot: this.db.prepare(`
        SELECT * FROM delegation_snapshots WHERE id = ?
      `),
      getDelegationSnapshotsByMetrics: this.db.prepare(`
        SELECT * FROM delegation_snapshots WHERE metrics_id = ? ORDER BY snapshot_time DESC LIMIT ?
      `),
      getDelegationSnapshotsSince: this.db.prepare(`
        SELECT * FROM delegation_snapshots WHERE metrics_id = ? AND snapshot_time > ? ORDER BY snapshot_time DESC
      `),
      getRecentDelegationSnapshots: this.db.prepare(`
        SELECT * FROM delegation_snapshots ORDER BY snapshot_time DESC LIMIT ?
      `),
      deleteOldDelegationSnapshots: this.db.prepare(`
        DELETE FROM delegation_snapshots WHERE created_at < ?
      `),

      // Task claim statements
      getTaskClaim: this.db.prepare(`
        SELECT * FROM task_claims WHERE task_id = ?
      `),
      insertTaskClaim: this.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat, heartbeat_count, agent_type, metadata)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?)
      `),
      updateTaskClaimHeartbeat: this.db.prepare(`
        UPDATE task_claims
        SET expires_at = ?, last_heartbeat = ?, heartbeat_count = heartbeat_count + 1
        WHERE task_id = ? AND session_id = ?
      `),
      deleteTaskClaim: this.db.prepare(`
        DELETE FROM task_claims WHERE task_id = ? AND session_id = ?
      `),
      deleteTaskClaimByTaskId: this.db.prepare(`
        DELETE FROM task_claims WHERE task_id = ?
      `),
      getClaimsBySession: this.db.prepare(`
        SELECT * FROM task_claims WHERE session_id = ?
      `),
      getActiveTaskClaims: this.db.prepare(`
        SELECT * FROM task_claims WHERE expires_at > ?
      `),
      deleteExpiredTaskClaims: this.db.prepare(`
        DELETE FROM task_claims WHERE expires_at < ?
      `),
      deleteAllSessionClaims: this.db.prepare(`
        DELETE FROM task_claims WHERE session_id = ?
      `),
      getExpiredTaskClaims: this.db.prepare(`
        SELECT * FROM task_claims WHERE expires_at < ?
      `)
    };
  }

  // ============================================================================
  // SESSION MANAGEMENT
  // ============================================================================

  /**
   * Register a new session
   * @param {string} sessionId - Unique session identifier
   * @param {string} projectPath - Project path this session is working on
   * @param {string} agentType - Type of agent (orchestrator, developer, etc.)
   * @param {Object} metadata - Additional session metadata
   * @returns {Object} Session registration details
   */
  registerSession(sessionId, projectPath, agentType = 'unknown', metadata = {}) {
    const now = Date.now();

    // Check if session already exists
    const existing = this._stmts.getSession.get(sessionId);

    this._stmts.registerSession.run(
      sessionId,
      projectPath,
      agentType,
      existing ? existing.started_at : now,
      now,
      JSON.stringify(metadata),
      process.pid
    );

    this._currentSessionId = sessionId;

    this.emit('session:registered', { sessionId, projectPath, agentType });

    return {
      sessionId,
      projectPath,
      agentType,
      createdAt: existing ? existing.started_at : now,
      lastHeartbeat: now,
      wasReregistration: !!existing
    };
  }

  /**
   * Update session heartbeat
   * @param {string} sessionId - Session ID to update
   * @returns {boolean} True if session was found and updated
   */
  updateHeartbeat(sessionId = null) {
    const sid = sessionId || this._currentSessionId;
    if (!sid) return false;

    const now = Date.now();
    const result = this._stmts.updateHeartbeat.run(now, sid);

    if (result.changes > 0) {
      this.emit('session:heartbeat', { sessionId: sid, timestamp: now });
      return true;
    }

    return false;
  }

  /**
   * Deregister session and release all its locks and claims
   * @param {string} sessionId - Session ID to deregister
   * @returns {Object} Deregistration result
   */
  deregisterSession(sessionId = null) {
    const sid = sessionId || this._currentSessionId;
    if (!sid) return { deregistered: false, locksReleased: 0, claimsReleased: 0 };

    // Release all locks held by this session
    const locks = this._stmts.getLocksBySession.all(sid);
    this._stmts.deleteAllSessionLocks.run(sid);

    // Release all task claims held by this session
    const claimResult = this.releaseSessionClaims(sid, 'session_deregistered');

    // Remove session
    const result = this._stmts.deleteSession.run(sid);

    if (sid === this._currentSessionId) {
      this._currentSessionId = null;
    }

    this.emit('session:deregistered', {
      sessionId: sid,
      locksReleased: locks.length,
      claimsReleased: claimResult.count
    });

    return {
      sessionId: sid,
      deregistered: result.changes > 0,
      locksReleased: locks.length,
      claimsReleased: claimResult.count
    };
  }

  /**
   * Get session by ID
   * @param {string} sessionId - Session ID
   * @returns {Object|null} Session details or null
   */
  getSession(sessionId) {
    const row = this._stmts.getSession.get(sessionId);
    if (!row) return null;

    return {
      sessionId: row.id,
      projectPath: row.project_path,
      agentType: row.agent_type,
      startedAt: row.started_at,
      lastHeartbeat: row.last_heartbeat,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      pid: row.pid
    };
  }

  /**
   * Get all sessions for a project
   * @param {string} projectPath - Project path
   * @returns {Array} Active sessions
   */
  getSessionsByProject(projectPath) {
    const threshold = Date.now() - this.options.staleSessionThreshold;
    const rows = this._stmts.getSessionsByProject.all(projectPath, threshold);

    return rows.map(row => ({
      sessionId: row.id,
      projectPath: row.project_path,
      agentType: row.agent_type,
      startedAt: row.started_at,
      lastHeartbeat: row.last_heartbeat,
      ageMs: Date.now() - row.last_heartbeat
    }));
  }

  /**
   * Get all active (non-stale) sessions
   * @returns {Array} Active sessions
   */
  getActiveSessions() {
    const threshold = Date.now() - this.options.staleSessionThreshold;
    const rows = this._stmts.getAllActiveSessions.all(threshold);

    return rows.map(row => ({
      sessionId: row.id,
      projectPath: row.project_path,
      agentType: row.agent_type,
      startedAt: row.started_at,
      lastHeartbeat: row.last_heartbeat,
      ageMs: Date.now() - row.last_heartbeat
    }));
  }

  /**
   * Get stale sessions (no heartbeat within threshold)
   * @param {number} thresholdMs - Override threshold in milliseconds
   * @returns {Array} Stale sessions
   */
  getStaleSessions(thresholdMs = null) {
    const threshold = Date.now() - (thresholdMs || this.options.staleSessionThreshold);
    const rows = this._stmts.getStaleSessions.all(threshold);

    return rows.map(row => ({
      sessionId: row.id,
      projectPath: row.project_path,
      agentType: row.agent_type,
      lastHeartbeat: row.last_heartbeat,
      staleForMs: Date.now() - row.last_heartbeat
    }));
  }

  /**
   * Cleanup stale sessions and their locks
   * @param {number} thresholdMs - Override threshold in milliseconds
   * @returns {Array} IDs of cleaned up sessions
   */
  cleanupStaleSessions(thresholdMs = null) {
    const staleSessions = this.getStaleSessions(thresholdMs);
    const cleanedIds = [];

    for (const session of staleSessions) {
      const result = this.deregisterSession(session.sessionId);
      if (result.deregistered) {
        cleanedIds.push(session.sessionId);
      }
    }

    if (cleanedIds.length > 0) {
      this.emit('sessions:cleanup', {
        count: cleanedIds.length,
        sessionIds: cleanedIds
      });
    }

    return cleanedIds;
  }

  // ============================================================================
  // LOCK MANAGEMENT
  // ============================================================================

  /**
   * Acquire a lock on a resource
   * @param {string} resource - Resource to lock (e.g., 'tasks.json')
   * @param {string} sessionId - Session requesting the lock
   * @param {number} ttlMs - Lock TTL in milliseconds
   * @returns {Object} Lock acquisition result
   */
  acquireLock(resource, sessionId, ttlMs = null) {
    const now = Date.now();
    const ttl = ttlMs || this.options.defaultLockTTL;
    const expiresAt = now + ttl;

    // First, clean up any expired locks on this resource
    const existing = this._stmts.getLock.get(resource);

    if (existing) {
      // Lock exists - check if expired
      if (existing.expires_at < now) {
        // Lock expired - delete and proceed
        this._stmts.deleteLock.run(resource, existing.session_id);
        this.emit('lock:expired', { resource, previousHolder: existing.session_id });
      } else if (existing.session_id === sessionId) {
        // Same session - extend the lock
        this._stmts.updateLock.run(expiresAt, resource, sessionId);
        this.emit('lock:extended', { resource, sessionId, expiresAt });
        return {
          acquired: true,
          extended: true,
          holder: sessionId,
          expiresAt,
          refreshCount: existing.refresh_count + 1
        };
      } else {
        // Different session holds the lock
        return {
          acquired: false,
          holder: existing.session_id,
          expiresAt: existing.expires_at,
          remainingMs: existing.expires_at - now
        };
      }
    }

    // Acquire the lock
    try {
      this._stmts.insertLock.run(resource, sessionId, now, expiresAt, 'exclusive');
      this.emit('lock:acquired', { resource, sessionId, expiresAt });
      return {
        acquired: true,
        holder: sessionId,
        expiresAt
      };
    } catch (error) {
      // Race condition - another session acquired it first
      const current = this._stmts.getLock.get(resource);
      return {
        acquired: false,
        holder: current?.session_id || null,
        expiresAt: current?.expires_at || null,
        error: error.message
      };
    }
  }

  /**
   * Release a lock
   * @param {string} resource - Resource to unlock
   * @param {string} sessionId - Session releasing the lock
   * @returns {boolean} True if lock was released
   */
  releaseLock(resource, sessionId) {
    const existing = this._stmts.getLock.get(resource);

    if (!existing) {
      return true; // No lock exists
    }

    if (existing.expires_at < Date.now()) {
      // Lock expired - clean it up
      this._stmts.deleteLock.run(resource, existing.session_id);
      return true;
    }

    if (existing.session_id !== sessionId) {
      // Different session holds the lock
      return false;
    }

    // Release the lock
    const result = this._stmts.deleteLock.run(resource, sessionId);

    if (result.changes > 0) {
      this.emit('lock:released', { resource, sessionId });
      return true;
    }

    return false;
  }

  /**
   * Refresh (extend) a lock TTL
   * @param {string} resource - Resource with lock
   * @param {string} sessionId - Session holding the lock
   * @param {number} ttlMs - New TTL in milliseconds
   * @returns {Object} Refresh result
   */
  refreshLock(resource, sessionId, ttlMs = null) {
    const existing = this._stmts.getLock.get(resource);
    const now = Date.now();
    const ttl = ttlMs || this.options.defaultLockTTL;

    if (!existing) {
      return { success: false, error: 'Lock does not exist' };
    }

    if (existing.expires_at < now) {
      this._stmts.deleteLock.run(resource, existing.session_id);
      return { success: false, error: 'Lock expired' };
    }

    if (existing.session_id !== sessionId) {
      return { success: false, error: 'Lock held by different session' };
    }

    const expiresAt = now + ttl;
    this._stmts.updateLock.run(expiresAt, resource, sessionId);

    this.emit('lock:refreshed', { resource, sessionId, expiresAt });

    return {
      success: true,
      expiresAt,
      refreshCount: existing.refresh_count + 1
    };
  }

  /**
   * Check if a resource is locked
   * @param {string} resource - Resource to check
   * @returns {Object} Lock status
   */
  isLockHeld(resource) {
    const existing = this._stmts.getLock.get(resource);
    const now = Date.now();

    if (!existing) {
      return { locked: false, holder: null, expiresAt: null };
    }

    if (existing.expires_at < now) {
      // Expired - clean up
      this._stmts.deleteLock.run(resource, existing.session_id);
      return { locked: false, holder: null, expiresAt: null };
    }

    return {
      locked: true,
      holder: existing.session_id,
      expiresAt: existing.expires_at,
      remainingMs: existing.expires_at - now
    };
  }

  /**
   * Clean up all expired locks
   * @returns {number} Number of locks cleaned up
   */
  cleanupExpiredLocks() {
    const now = Date.now();
    const result = this._stmts.deleteExpiredLocks.run(now);

    if (result.changes > 0) {
      this.emit('locks:cleanup', { count: result.changes });
    }

    return result.changes;
  }

  /**
   * Execute a function with a lock
   * @param {string} resource - Resource to lock
   * @param {string} sessionId - Session ID
   * @param {Function} fn - Function to execute
   * @param {Object} options - Lock options
   * @returns {Promise<Object>} Result with success status and function result
   */
  async withLock(resource, sessionId, fn, options = {}) {
    const { ttl, timeout = 0, retryInterval = 100 } = options;
    const startTime = Date.now();

    // Try to acquire lock
    let lockResult = this.acquireLock(resource, sessionId, ttl);

    // If not acquired and timeout specified, retry
    while (!lockResult.acquired && timeout > 0) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeout) {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, Math.min(retryInterval, timeout - elapsed)));
      lockResult = this.acquireLock(resource, sessionId, ttl);
    }

    if (!lockResult.acquired) {
      throw new Error(`Could not acquire lock on ${resource}. Held by: ${lockResult.holder}`);
    }

    try {
      const result = await fn(lockResult);
      return result;
    } finally {
      this.releaseLock(resource, sessionId);
    }
  }

  // ============================================================================
  // TASK CLAIM CLEANUP
  // ============================================================================

  /**
   * Clean up expired task claims
   * Removes claims where expires_at < now and emits events for each
   * @returns {Object} Cleanup result with count and expired claim details
   */
  cleanupExpiredClaims() {
    // Skip if database is closed
    if (!this.db) return { count: 0, claims: [] };

    const now = Date.now();

    // Get all expired claims before deleting for event emission
    const expiredClaims = this.db.prepare(`
      SELECT task_id, session_id, claimed_at, expires_at
      FROM task_claims
      WHERE expires_at < ?
    `).all(now);

    if (expiredClaims.length === 0) {
      return { count: 0, claims: [] };
    }

    // Delete expired claims
    const result = this.db.prepare(`
      DELETE FROM task_claims WHERE expires_at < ?
    `).run(now);

    // Emit events for each expired claim
    for (const claim of expiredClaims) {
      this.emit('claim:expired', {
        taskId: claim.task_id,
        sessionId: claim.session_id,
        claimedAt: claim.claimed_at,
        expiresAt: claim.expires_at,
        expiredAt: now,
        ageMs: now - claim.claimed_at
      });
    }

    // Emit summary event
    if (result.changes > 0) {
      this.emit('claims:cleanup', {
        type: 'expired',
        count: result.changes,
        timestamp: now
      });
    }

    return {
      count: result.changes,
      claims: expiredClaims.map(c => ({
        taskId: c.task_id,
        sessionId: c.session_id,
        claimedAt: c.claimed_at,
        expiresAt: c.expires_at
      }))
    };
  }

  /**
   * Clean up orphaned task claims from dead/stale sessions
   * Identifies claims where the session is missing or stale, then releases them
   * @param {Object} options - Cleanup options
   * @param {boolean} options.checkPid - Whether to verify process is dead via PID (default: false)
   * @returns {Object} Cleanup result with count and orphaned claim details
   */
  cleanupOrphanedClaims(options = {}) {
    // Skip if database is closed
    if (!this.db) return { count: 0, claims: [] };

    const { checkPid = false } = options;
    const now = Date.now();
    const staleThreshold = now - this.options.claimConfig.orphanThreshold;

    // Find claims with missing or stale sessions
    const orphanedClaims = this.db.prepare(`
      SELECT
        tc.task_id,
        tc.session_id,
        tc.claimed_at,
        tc.expires_at,
        tc.last_heartbeat,
        s.last_heartbeat as session_heartbeat,
        s.pid
      FROM task_claims tc
      LEFT JOIN sessions s ON tc.session_id = s.id
      WHERE
        s.id IS NULL                              -- Session doesn't exist
        OR s.last_heartbeat < ?                   -- Session is stale
    `).all(staleThreshold);

    if (orphanedClaims.length === 0) {
      return { count: 0, claims: [] };
    }

    // Optional PID checking for additional validation
    const confirmedOrphans = [];
    if (checkPid) {
      for (const claim of orphanedClaims) {
        if (claim.pid && this._isProcessAlive(claim.pid)) {
          // Process is still alive, skip this one
          continue;
        }
        confirmedOrphans.push(claim);
      }
    } else {
      confirmedOrphans.push(...orphanedClaims);
    }

    if (confirmedOrphans.length === 0) {
      return { count: 0, claims: [] };
    }

    // Delete orphaned claims
    const taskIds = confirmedOrphans.map(c => c.task_id);
    const placeholders = taskIds.map(() => '?').join(',');
    const result = this.db.prepare(`
      DELETE FROM task_claims WHERE task_id IN (${placeholders})
    `).run(...taskIds);

    // Emit events for each orphaned claim
    for (const claim of confirmedOrphans) {
      this.emit('claim:orphaned', {
        taskId: claim.task_id,
        sessionId: claim.session_id,
        claimedAt: claim.claimed_at,
        expiresAt: claim.expires_at,
        lastHeartbeat: claim.last_heartbeat,
        sessionHeartbeat: claim.session_heartbeat,
        staleForMs: claim.session_heartbeat ? now - claim.session_heartbeat : null,
        reason: claim.session_heartbeat === null ? 'session_missing' : 'session_stale',
        cleanedAt: now
      });
    }

    // Emit summary event
    if (result.changes > 0) {
      this.emit('claims:cleanup', {
        type: 'orphaned',
        count: result.changes,
        timestamp: now
      });
    }

    return {
      count: result.changes,
      claims: confirmedOrphans.map(c => ({
        taskId: c.task_id,
        sessionId: c.session_id,
        claimedAt: c.claimed_at,
        reason: c.session_heartbeat === null ? 'session_missing' : 'session_stale',
        staleForMs: c.session_heartbeat ? now - c.session_heartbeat : null
      }))
    };
  }

  /**
   * Release all task claims for a specific session
   * Called when session deregisters or during session cleanup
   * @param {string} sessionId - Session ID to release claims for
   * @param {string} reason - Reason for release (e.g., 'session_ended', 'cleanup', 'manual')
   * @returns {Object} Release result with count and released claim details
   */
  releaseSessionClaims(sessionId, reason = 'session_ended') {
    const now = Date.now();

    // Get all claims for this session before deleting
    const claims = this.db.prepare(`
      SELECT task_id, claimed_at, expires_at, last_heartbeat
      FROM task_claims
      WHERE session_id = ?
    `).all(sessionId);

    if (claims.length === 0) {
      return { count: 0, sessionId, reason, claims: [] };
    }

    // Delete all claims for this session
    const result = this.db.prepare(`
      DELETE FROM task_claims WHERE session_id = ?
    `).run(sessionId);

    // Emit events for each released claim
    for (const claim of claims) {
      this.emit('claim:released', {
        taskId: claim.task_id,
        sessionId,
        claimedAt: claim.claimed_at,
        expiresAt: claim.expires_at,
        lastHeartbeat: claim.last_heartbeat,
        releasedAt: now,
        reason,
        heldForMs: now - claim.claimed_at
      });
    }

    // Emit summary event
    if (result.changes > 0) {
      this.emit('claims:session_cleanup', {
        sessionId,
        count: result.changes,
        reason,
        timestamp: now
      });
    }

    return {
      count: result.changes,
      sessionId,
      reason,
      claims: claims.map(c => ({
        taskId: c.task_id,
        claimedAt: c.claimed_at,
        expiresAt: c.expires_at,
        heldForMs: now - c.claimed_at
      }))
    };
  }

  /**
   * Check if a process is alive (for PID validation)
   * @param {number} pid - Process ID to check
   * @returns {boolean} True if process is alive
   * @private
   */
  _isProcessAlive(pid) {
    if (!pid) return false;

    try {
      // Signal 0 doesn't kill, just checks if process exists
      // Throws if process doesn't exist or we don't have permission
      process.kill(pid, 0);
      return true;
    } catch (err) {
      // ESRCH means no such process
      // EPERM means process exists but we don't have permission (still alive)
      return err.code === 'EPERM';
    }
  }

  // ============================================================================
  // TASK CLAIM OPERATIONS
  // ============================================================================

  /**
   * Claim a task for exclusive execution by a session
   * Uses atomic transaction to prevent race conditions
   * @param {string} taskId - Task ID to claim
   * @param {string} sessionId - Session claiming the task
   * @param {Object} options - Claim options
   * @param {number} options.ttlMs - Claim TTL in milliseconds (default: 30 min)
   * @param {string} options.agentType - Type of agent claiming (cli/autonomous)
   * @param {Object} options.metadata - Additional claim metadata
   * @param {boolean} options.force - Force claim even if held by same session
   * @returns {Object} Claim result { claimed, claim?, error?, existingClaim? }
   */
  claimTask(taskId, sessionId, options = {}) {
    const now = Date.now();
    const {
      ttlMs = this.options.claimConfig.defaultTTL,
      agentType = 'unknown',
      metadata = {},
      force = false
    } = options;

    const expiresAt = now + ttlMs;

    // Use transaction for atomicity
    const txn = this.db.transaction(() => {
      // Check for existing claim
      const existing = this._stmts.getTaskClaim.get(taskId);

      if (existing) {
        const isExpired = existing.expires_at < now;
        const isSameSession = existing.session_id === sessionId;

        if (!isExpired && !isSameSession) {
          // Task claimed by different session
          return {
            claimed: false,
            error: 'TASK_ALREADY_CLAIMED',
            existingClaim: {
              sessionId: existing.session_id,
              claimedAt: existing.claimed_at,
              expiresAt: existing.expires_at,
              remainingMs: existing.expires_at - now,
              agentType: existing.agent_type
            }
          };
        }

        if (isSameSession && !force) {
          // Same session re-claiming - extend TTL
          this._stmts.updateTaskClaimHeartbeat.run(expiresAt, now, taskId, sessionId);
          this.emit('claim:extended', { taskId, sessionId, expiresAt });

          return {
            claimed: true,
            extended: true,
            claim: {
              taskId,
              sessionId,
              claimedAt: existing.claimed_at,
              expiresAt,
              heartbeatCount: existing.heartbeat_count + 1
            }
          };
        }

        // Expired or forced - delete old claim
        this._stmts.deleteTaskClaimByTaskId.run(taskId);
        if (isExpired) {
          this.emit('claim:expired', { taskId, previousHolder: existing.session_id });
        }
      }

      // Create new claim
      try {
        this._stmts.insertTaskClaim.run(
          taskId,
          sessionId,
          now,
          expiresAt,
          now,
          agentType,
          JSON.stringify(metadata)
        );

        this.emit('claim:acquired', { taskId, sessionId, expiresAt, agentType });

        return {
          claimed: true,
          claim: {
            taskId,
            sessionId,
            claimedAt: now,
            expiresAt,
            agentType
          }
        };
      } catch (error) {
        // Race condition - another session claimed it
        const current = this._stmts.getTaskClaim.get(taskId);
        return {
          claimed: false,
          error: 'RACE_CONDITION',
          existingClaim: current ? {
            sessionId: current.session_id,
            claimedAt: current.claimed_at,
            expiresAt: current.expires_at
          } : null
        };
      }
    });

    // Execute transaction with immediate locking
    return txn.immediate();
  }

  /**
   * Release a task claim
   * @param {string} taskId - Task ID to release
   * @param {string} sessionId - Session releasing the task
   * @param {string} reason - Release reason (completed, failed, manual, timeout)
   * @returns {Object} Release result { released, claim?, error?, actualOwner? }
   */
  releaseClaim(taskId, sessionId, reason = 'manual') {
    const now = Date.now();
    const existing = this._stmts.getTaskClaim.get(taskId);

    if (!existing) {
      return {
        released: false,
        error: 'CLAIM_NOT_FOUND'
      };
    }

    if (existing.expires_at < now) {
      // Claim already expired - clean it up
      this._stmts.deleteTaskClaimByTaskId.run(taskId);
      return {
        released: true,
        wasExpired: true,
        error: 'CLAIM_EXPIRED'
      };
    }

    if (existing.session_id !== sessionId) {
      // Different session trying to release
      return {
        released: false,
        error: 'NOT_CLAIM_OWNER',
        actualOwner: existing.session_id
      };
    }

    // Release the claim
    const result = this._stmts.deleteTaskClaim.run(taskId, sessionId);

    if (result.changes > 0) {
      const claimDuration = now - existing.claimed_at;

      this.emit('claim:released', {
        taskId,
        sessionId,
        reason,
        claimDuration,
        heartbeatCount: existing.heartbeat_count
      });

      return {
        released: true,
        claim: {
          taskId,
          sessionId,
          claimedAt: existing.claimed_at,
          releasedAt: now,
          claimDuration,
          heartbeatCount: existing.heartbeat_count,
          reason
        }
      };
    }

    return {
      released: false,
      error: 'RELEASE_FAILED'
    };
  }

  /**
   * Refresh (extend) a task claim TTL via heartbeat
   * @param {string} taskId - Task ID
   * @param {string} sessionId - Session holding the claim
   * @param {number} extendMs - Additional time to extend (optional)
   * @returns {Object} Refresh result { success, expiresAt?, heartbeatCount?, error? }
   */
  refreshClaim(taskId, sessionId, extendMs = null) {
    const now = Date.now();
    const existing = this._stmts.getTaskClaim.get(taskId);

    if (!existing) {
      return {
        success: false,
        error: 'CLAIM_NOT_FOUND'
      };
    }

    if (existing.expires_at < now) {
      // Claim expired
      this._stmts.deleteTaskClaimByTaskId.run(taskId);
      return {
        success: false,
        error: 'CLAIM_EXPIRED'
      };
    }

    if (existing.session_id !== sessionId) {
      return {
        success: false,
        error: 'NOT_CLAIM_OWNER',
        actualOwner: existing.session_id
      };
    }

    // Calculate new expiry
    const extension = extendMs !== null ? extendMs : this.options.claimConfig.defaultTTL;
    const newExpiresAt = now + extension;

    // Update claim
    const result = this._stmts.updateTaskClaimHeartbeat.run(newExpiresAt, now, taskId, sessionId);

    if (result.changes > 0) {
      this.emit('claim:refreshed', {
        taskId,
        sessionId,
        expiresAt: newExpiresAt,
        heartbeatCount: existing.heartbeat_count + 1
      });

      return {
        success: true,
        expiresAt: newExpiresAt,
        heartbeatCount: existing.heartbeat_count + 1,
        remainingMs: newExpiresAt - now
      };
    }

    return {
      success: false,
      error: 'REFRESH_FAILED'
    };
  }

  /**
   * Get all active (non-expired) task claims
   * @param {Object} options - Query options
   * @param {string} options.sessionId - Filter by session
   * @param {string} options.agentType - Filter by agent type
   * @param {boolean} options.includeExpired - Include expired claims
   * @param {number} options.limit - Limit results
   * @returns {Array} Active claims with computed fields
   */
  getActiveClaims(options = {}) {
    const {
      sessionId = null,
      agentType = null,
      includeExpired = false,
      limit = null
    } = options;

    const now = Date.now();

    let rows;
    if (sessionId) {
      rows = this._stmts.getClaimsBySession.all(sessionId);
    } else if (includeExpired) {
      rows = this.db.prepare('SELECT * FROM task_claims ORDER BY claimed_at DESC').all();
    } else {
      rows = this._stmts.getActiveTaskClaims.all(now);
    }

    // Filter by agent type if specified
    if (agentType) {
      rows = rows.filter(row => row.agent_type === agentType);
    }

    // Filter out expired if not including them
    if (!includeExpired) {
      rows = rows.filter(row => row.expires_at > now);
    }

    // Apply limit
    if (limit) {
      rows = rows.slice(0, limit);
    }

    return rows.map(row => this._formatTaskClaimRow(row, now));
  }

  /**
   * Get claim for a specific task
   * @param {string} taskId - Task ID
   * @returns {Object|null} Claim details or null if no active claim
   */
  getClaim(taskId) {
    const row = this._stmts.getTaskClaim.get(taskId);
    if (!row) return null;

    const now = Date.now();

    // Check if expired
    if (row.expires_at < now) {
      // Clean up expired claim
      this._stmts.deleteTaskClaimByTaskId.run(taskId);
      return null;
    }

    return this._formatTaskClaimRow(row, now);
  }

  /**
   * Get all claims for a specific session
   * @param {string} sessionId - Session ID
   * @returns {Array} Claims owned by this session
   */
  getClaimsBySession(sessionId) {
    const now = Date.now();
    const rows = this._stmts.getClaimsBySession.all(sessionId);

    // Filter out expired claims and format
    return rows
      .filter(row => row.expires_at > now)
      .map(row => this._formatTaskClaimRow(row, now));
  }

  /**
   * Check if a task has an active claim
   * @param {string} taskId - Task ID
   * @returns {Object} Claim status { claimed, holder?, remainingMs? }
   */
  isTaskClaimed(taskId) {
    const claim = this.getClaim(taskId);

    if (!claim) {
      return {
        claimed: false,
        holder: null,
        remainingMs: null
      };
    }

    return {
      claimed: true,
      holder: claim.sessionId,
      remainingMs: claim.remainingMs,
      claimedAt: claim.claimedAt,
      expiresAt: claim.expiresAt
    };
  }

  /**
   * Get claim statistics for dashboard
   * @returns {Object} Aggregate claim statistics
   */
  getClaimStats() {
    const now = Date.now();

    // Get all active claims
    const activeClaims = this.getActiveClaims();

    // Count by agent type
    const byAgentType = {};
    const bySession = {};
    let expiringCount = 0;
    let staleCount = 0;

    const EXPIRING_THRESHOLD = this.options.claimConfig.warningThreshold;
    const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes since last heartbeat

    for (const claim of activeClaims) {
      // Count by agent type
      const type = claim.agentType || 'unknown';
      byAgentType[type] = (byAgentType[type] || 0) + 1;

      // Count by session
      bySession[claim.sessionId] = (bySession[claim.sessionId] || 0) + 1;

      // Count expiring soon
      if (claim.remainingMs < EXPIRING_THRESHOLD) {
        expiringCount++;
      }

      // Count stale (no heartbeat)
      const timeSinceHeartbeat = now - claim.lastHeartbeat;
      if (timeSinceHeartbeat > STALE_THRESHOLD) {
        staleCount++;
      }
    }

    return {
      totalActive: activeClaims.length,
      byAgentType,
      bySession,
      expiringSoon: expiringCount,
      stale: staleCount,
      timestamp: now
    };
  }

  /**
   * Format a task claim row with computed fields
   * @private
   * @param {Object} row - Database row
   * @param {number} now - Current timestamp
   * @returns {Object} Formatted claim object
   */
  _formatTaskClaimRow(row, now = Date.now()) {
    const EXPIRING_THRESHOLD = this.options.claimConfig.warningThreshold;
    const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes since last heartbeat

    const remainingMs = row.expires_at - now;
    const timeSinceHeartbeat = now - row.last_heartbeat;

    // Calculate health status
    let healthStatus = 'healthy';
    if (remainingMs <= 0) {
      healthStatus = 'expired';
    } else if (timeSinceHeartbeat > STALE_THRESHOLD) {
      healthStatus = 'stale';
    } else if (remainingMs < 60000) {
      healthStatus = 'critical'; // <1 min
    } else if (remainingMs < EXPIRING_THRESHOLD) {
      healthStatus = 'warning';
    }

    return {
      taskId: row.task_id,
      sessionId: row.session_id,
      claimedAt: row.claimed_at,
      expiresAt: row.expires_at,
      lastHeartbeat: row.last_heartbeat,
      heartbeatCount: row.heartbeat_count,
      agentType: row.agent_type,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,

      // Computed fields
      remainingMs: Math.max(0, remainingMs),
      remainingSeconds: Math.max(0, Math.round(remainingMs / 1000)),
      isExpired: remainingMs <= 0,
      isExpiring: remainingMs > 0 && remainingMs < EXPIRING_THRESHOLD,
      isStale: timeSinceHeartbeat > STALE_THRESHOLD,
      timeSinceHeartbeatMs: timeSinceHeartbeat,
      healthStatus
    };
  }

  // ============================================================================
  // CHANGE JOURNAL
  // ============================================================================

  /**
   * Record a change in the journal
   * @param {string} sessionId - Session making the change
   * @param {string} resource - Resource being changed
   * @param {string} operation - Type of operation (CREATE, UPDATE, DELETE, etc.)
   * @param {Object} changeData - Details of the change
   * @returns {number} Change ID
   */
  recordChange(sessionId, resource, operation, changeData = {}) {
    const now = Date.now();
    const dataStr = JSON.stringify(changeData);
    const checksum = crypto.createHash('md5').update(dataStr).digest('hex');

    const result = this._stmts.insertChange.run(
      sessionId,
      resource,
      operation,
      dataStr,
      now,
      0,
      checksum
    );

    this.emit('change:recorded', {
      id: result.lastInsertRowid,
      sessionId,
      resource,
      operation
    });

    return result.lastInsertRowid;
  }

  /**
   * Get recent changes
   * @param {number} limit - Maximum number of changes to return
   * @returns {Array} Recent changes
   */
  getRecentChanges(limit = 50) {
    const rows = this._stmts.getRecentChanges.all(limit);
    return rows.map(row => this._formatChangeRow(row));
  }

  /**
   * Get changes by session
   * @param {string} sessionId - Session ID
   * @returns {Array} Changes made by session
   */
  getChangesBySession(sessionId) {
    const rows = this._stmts.getChangesBySession.all(sessionId);
    return rows.map(row => this._formatChangeRow(row));
  }

  /**
   * Get changes by resource
   * @param {string} resource - Resource path
   * @returns {Array} Changes to resource
   */
  getChangesByResource(resource) {
    const rows = this._stmts.getChangesByResource.all(resource);
    return rows.map(row => this._formatChangeRow(row));
  }

  /**
   * Get a single change by ID
   * @param {number} changeId - Change ID
   * @returns {Object|null} Change details
   */
  getChange(changeId) {
    const row = this._stmts.getChange.get(changeId);
    return row ? this._formatChangeRow(row) : null;
  }

  /**
   * Mark a change as applied
   * @param {number} changeId - Change ID
   */
  markChangeApplied(changeId) {
    this._stmts.markChangeApplied.run(changeId);
    this.emit('change:applied', { id: changeId });
  }

  /**
   * Prune old changes from journal
   * @param {number} retentionMs - How long to keep changes
   * @returns {number} Number of changes pruned
   */
  pruneOldChanges(retentionMs = null) {
    const threshold = Date.now() - (retentionMs || this.options.journalRetention);
    const result = this._stmts.deleteOldChanges.run(threshold);

    if (result.changes > 0) {
      this.emit('journal:pruned', { count: result.changes });
    }

    return result.changes;
  }

  /**
   * Format a change journal row
   * @private
   */
  _formatChangeRow(row) {
    return {
      id: row.id,
      sessionId: row.session_id,
      resource: row.resource,
      operation: row.operation,
      changeData: row.change_data ? JSON.parse(row.change_data) : null,
      createdAt: row.created_at,
      applied: !!row.applied,
      checksum: row.checksum
    };
  }

  // ============================================================================
  // CONFLICT MANAGEMENT
  // ============================================================================

  /**
   * Record a conflict
   * @param {Object} conflictData - Conflict details
   * @returns {Object} Created conflict record
   */
  recordConflict(conflictData) {
    const id = conflictData.id || crypto.randomUUID();
    const now = Date.now();

    this._stmts.insertConflict.run(
      id,
      conflictData.type,
      conflictData.resource || 'tasks.json',
      now,
      conflictData.severity || 'warning',
      conflictData.sessionAId,
      conflictData.sessionAData ? JSON.stringify(conflictData.sessionAData) : null,
      conflictData.sessionAVersion || null,
      conflictData.sessionATimestamp || now,
      conflictData.sessionBId || null,
      conflictData.sessionBData ? JSON.stringify(conflictData.sessionBData) : null,
      conflictData.sessionBVersion || null,
      conflictData.sessionBTimestamp || null,
      conflictData.affectedTaskIds ? JSON.stringify(conflictData.affectedTaskIds) : null,
      conflictData.fieldConflicts ? JSON.stringify(conflictData.fieldConflicts) : null,
      conflictData.description || null
    );

    const conflict = {
      id,
      type: conflictData.type,
      resource: conflictData.resource || 'tasks.json',
      detectedAt: now,
      severity: conflictData.severity || 'warning',
      sessionAId: conflictData.sessionAId,
      sessionBId: conflictData.sessionBId,
      affectedTaskIds: conflictData.affectedTaskIds || [],
      status: 'pending'
    };

    this.emit('conflict:detected', conflict);
    return conflict;
  }

  /**
   * Get a conflict by ID
   * @param {string} conflictId - Conflict ID
   * @returns {Object|null} Conflict details
   */
  getConflict(conflictId) {
    const row = this._stmts.getConflict.get(conflictId);
    return row ? this._formatConflictRow(row) : null;
  }

  /**
   * Get pending (unresolved) conflicts
   * @returns {Array} Pending conflicts
   */
  getPendingConflicts() {
    const rows = this._stmts.getPendingConflicts.all();
    return rows.map(row => this._formatConflictRow(row));
  }

  /**
   * Get conflicts with pagination and filters
   * @param {Object} options - Query options
   * @returns {Object} Conflicts and pagination info
   */
  getConflicts(options = {}) {
    const {
      status = null,
      resource = null,
      limit = 50,
      offset = 0,
      includeResolved = false
    } = options;

    let rows;
    if (status) {
      rows = this._stmts.getConflictsByStatus.all(status, limit);
    } else if (resource) {
      rows = this._stmts.getConflictsByResource.all(resource, limit);
    } else {
      rows = this._stmts.getAllConflicts.all(limit, offset);
    }

    const conflicts = rows.map(row => this._formatConflictRow(row));

    // Filter out resolved if needed
    const filtered = includeResolved
      ? conflicts
      : conflicts.filter(c => c.status === 'pending');

    // Get counts
    const countRows = this._stmts.getConflictCount.all();
    const counts = { pending: 0, resolved: 0, 'auto-resolved': 0, escalated: 0 };
    for (const row of countRows) {
      counts[row.status] = row.count;
    }

    return {
      conflicts: filtered,
      pagination: {
        total: Object.values(counts).reduce((a, b) => a + b, 0),
        limit,
        offset,
        hasMore: filtered.length === limit
      },
      summary: {
        pending: counts.pending,
        resolved: counts.resolved + counts['auto-resolved'],
        total: Object.values(counts).reduce((a, b) => a + b, 0)
      }
    };
  }

  /**
   * Resolve a conflict
   * @param {string} conflictId - Conflict ID
   * @param {string} resolution - Resolution type (version_a, version_b, merged, manual, discarded)
   * @param {Object} options - Resolution options
   * @returns {Object} Resolution result
   */
  resolveConflict(conflictId, resolution, options = {}) {
    const conflict = this.getConflict(conflictId);
    if (!conflict) {
      return { success: false, error: 'CONFLICT_NOT_FOUND' };
    }

    if (conflict.status !== 'pending') {
      return { success: false, error: 'ALREADY_RESOLVED', existingResolution: conflict.resolution };
    }

    const now = Date.now();
    const status = options.autoResolved ? 'auto-resolved' : 'resolved';

    const result = this._stmts.resolveConflict.run(
      status,
      resolution,
      options.resolutionData ? JSON.stringify(options.resolutionData) : null,
      now,
      options.resolvedBy || this._currentSessionId,
      options.notes || null,
      conflictId
    );

    if (result.changes === 0) {
      return { success: false, error: 'UPDATE_FAILED' };
    }

    const resolvedConflict = {
      ...conflict,
      status,
      resolution,
      resolvedAt: now,
      resolvedBy: options.resolvedBy || this._currentSessionId
    };

    this.emit('conflict:resolved', resolvedConflict);

    return {
      success: true,
      conflict: resolvedConflict
    };
  }

  /**
   * Get conflict counts for dashboard
   * @returns {Object} Conflict counts by status
   */
  getConflictCounts() {
    const countRows = this._stmts.getConflictCount.all();
    const counts = { pending: 0, resolved: 0, autoResolved: 0, escalated: 0, total: 0 };

    for (const row of countRows) {
      if (row.status === 'auto-resolved') {
        counts.autoResolved = row.count;
      } else {
        counts[row.status] = row.count;
      }
      counts.total += row.count;
    }

    return counts;
  }

  /**
   * Prune old resolved conflicts
   * @param {number} retentionMs - How long to keep resolved conflicts
   * @returns {number} Number of conflicts pruned
   */
  pruneOldConflicts(retentionMs = null) {
    const threshold = Date.now() - (retentionMs || this.options.journalRetention);
    const result = this._stmts.deleteOldConflicts.run(threshold);

    if (result.changes > 0) {
      this.emit('conflicts:pruned', { count: result.changes });
    }

    return result.changes;
  }

  /**
   * Format a conflict row
   * @private
   */
  _formatConflictRow(row) {
    return {
      id: row.id,
      type: row.type,
      resource: row.resource,
      detectedAt: row.detected_at,
      severity: row.severity,
      sessionAId: row.session_a_id,
      sessionAData: row.session_a_data ? JSON.parse(row.session_a_data) : null,
      sessionAVersion: row.session_a_version,
      sessionATimestamp: row.session_a_timestamp,
      sessionBId: row.session_b_id,
      sessionBData: row.session_b_data ? JSON.parse(row.session_b_data) : null,
      sessionBVersion: row.session_b_version,
      sessionBTimestamp: row.session_b_timestamp,
      affectedTaskIds: row.affected_task_ids ? JSON.parse(row.affected_task_ids) : [],
      fieldConflicts: row.field_conflicts ? JSON.parse(row.field_conflicts) : [],
      description: row.description,
      status: row.status,
      resolution: row.resolution,
      resolutionData: row.resolution_data ? JSON.parse(row.resolution_data) : null,
      resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by,
      resolutionNotes: row.resolution_notes
    };
  }

  // ============================================================================
  // HEARTBEAT TIMER
  // ============================================================================

  /**
   * Start automatic heartbeat timer for current session
   * @param {string} sessionId - Session ID
   * @param {string} projectPath - Project path
   * @param {string} agentType - Agent type
   */
  startHeartbeatTimer(sessionId, projectPath, agentType = 'unknown') {
    this.stopHeartbeatTimer();

    // Register session first
    this.registerSession(sessionId, projectPath, agentType);

    // Send initial heartbeat
    this.updateHeartbeat(sessionId);

    // Start timer
    this._heartbeatTimer = setInterval(() => {
      this.updateHeartbeat(sessionId);
    }, this.options.heartbeatInterval);

    // Don't prevent process exit
    if (this._heartbeatTimer.unref) {
      this._heartbeatTimer.unref();
    }

    return sessionId;
  }

  /**
   * Stop heartbeat timer
   */
  stopHeartbeatTimer() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  // ============================================================================
  // CLEANUP TIMER
  // ============================================================================

  /**
   * Start automatic cleanup timer
   * @private
   */
  _startCleanupTimer() {
    this._cleanupTimer = setInterval(() => {
      this.cleanupExpiredLocks();
      this.cleanupStaleSessions();
      this.pruneOldChanges();
      this.cleanupExpiredClaims();
      this.cleanupOrphanedClaims();
    }, this.options.cleanupInterval);

    // Don't prevent process exit
    if (this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }

  /**
   * Stop cleanup timer
   */
  stopCleanupTimer() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }

  // ============================================================================
  // DIAGNOSTICS & TESTING
  // ============================================================================

  /**
   * Get database statistics
   * @returns {Object} Stats
   */
  getStats() {
    const sessionCount = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
    const activeSessionCount = this.getActiveSessions().length;
    const lockCount = this.db.prepare('SELECT COUNT(*) as count FROM locks').get().count;
    const changeCount = this.db.prepare('SELECT COUNT(*) as count FROM change_journal').get().count;

    // Get claim statistics if table exists
    let claimStats = { total: 0, active: 0, expiring: 0 };
    try {
      const now = Date.now();
      const warningThreshold = now + this.options.claimConfig.warningThreshold;

      const claimCount = this.db.prepare('SELECT COUNT(*) as count FROM task_claims').get();
      const activeCount = this.db.prepare('SELECT COUNT(*) as count FROM task_claims WHERE expires_at > ?').get(now);
      const expiringCount = this.db.prepare('SELECT COUNT(*) as count FROM task_claims WHERE expires_at > ? AND expires_at <= ?').get(now, warningThreshold);

      claimStats = {
        total: claimCount?.count || 0,
        active: activeCount?.count || 0,
        expiring: expiringCount?.count || 0
      };
    } catch (err) {
      // Table might not exist yet, ignore
    }

    return {
      sessions: {
        total: sessionCount,
        active: activeSessionCount,
        stale: sessionCount - activeSessionCount
      },
      locks: {
        total: lockCount
      },
      claims: claimStats,
      changes: {
        total: changeCount
      },
      currentSession: this._currentSessionId,
      options: this.options
    };
  }

  /**
   * Testing helper - set heartbeat timestamp directly
   * @param {string} sessionId - Session ID
   * @param {number} timestamp - Timestamp to set
   */
  _setHeartbeatForTesting(sessionId, timestamp) {
    this.db.prepare('UPDATE sessions SET last_heartbeat = ? WHERE id = ?').run(timestamp, sessionId);
  }

  /**
   * Testing helper - set change timestamp directly
   * @param {number} changeId - Change ID
   * @param {number} timestamp - Timestamp to set
   */
  _setChangeTimestampForTesting(changeId, timestamp) {
    this.db.prepare('UPDATE change_journal SET created_at = ? WHERE id = ?').run(timestamp, changeId);
  }

  // ============================================================================
  // DELEGATION METRICS STORAGE
  // ============================================================================

  /**
   * Save or update delegation metrics
   * @param {Object} metricsData - DelegationMetrics data object
   * @returns {Object} Saved metrics info
   */
  saveDelegationMetrics(metricsData) {
    const now = Date.now();
    const id = metricsData.metricsId || `dm-${now}-${Math.random().toString(36).substr(2, 9)}`;
    const sessionId = metricsData.sessionId || this._currentSessionId;

    const summary = metricsData.summary || {};
    const durationStats = summary.duration || {};
    const qualityStats = summary.quality || {};
    const patterns = metricsData.patternDistribution || {};
    const resources = summary.resources || {};

    this._stmts.upsertDelegationMetrics.run(
      id,
      sessionId,
      'delegation',
      summary.totalDelegations || 0,
      summary.successfulDelegations || 0,
      summary.failedDelegations || 0,
      summary.retries || 0,
      summary.timeouts || 0,
      durationStats.avg || 0,
      durationStats.min || null,
      durationStats.max || null,
      durationStats.p50 || null,
      durationStats.p95 || null,
      durationStats.p99 || null,
      qualityStats.avgQuality || 0,
      qualityStats.minQuality || null,
      qualityStats.maxQuality || null,
      JSON.stringify(patterns),
      resources.peakChildCount || 0,
      resources.totalTokensConsumed || 0,
      metricsData.createdAt || now,
      now,
      JSON.stringify(metricsData)
    );

    this.emit('metrics:saved', { id, sessionId, timestamp: now });

    return { id, sessionId, savedAt: now };
  }

  /**
   * Get delegation metrics by ID
   * @param {string} metricsId - Metrics ID
   * @returns {Object|null} Metrics data or null if not found
   */
  getDelegationMetrics(metricsId) {
    const row = this._stmts.getDelegationMetrics.get(metricsId);
    if (!row) return null;
    return this._parseDelegationMetricsRow(row);
  }

  /**
   * Get delegation metrics by session
   * @param {string} sessionId - Session ID
   * @returns {Array} Array of metrics records
   */
  getDelegationMetricsBySession(sessionId) {
    const rows = this._stmts.getDelegationMetricsBySession.all(sessionId);
    return rows.map(row => this._parseDelegationMetricsRow(row));
  }

  /**
   * Get all delegation metrics
   * @param {number} limit - Maximum records to return
   * @returns {Array} Array of metrics records
   */
  getAllDelegationMetrics(limit = 100) {
    const rows = this._stmts.getAllDelegationMetrics.all(limit);
    return rows.map(row => this._parseDelegationMetricsRow(row));
  }

  /**
   * Delete delegation metrics
   * @param {string} metricsId - Metrics ID to delete
   * @returns {boolean} True if deleted
   */
  deleteDelegationMetrics(metricsId) {
    const result = this._stmts.deleteDelegationMetrics.run(metricsId);
    return result.changes > 0;
  }

  /**
   * Parse a delegation metrics row from the database
   * @private
   */
  _parseDelegationMetricsRow(row) {
    return {
      id: row.id,
      sessionId: row.session_id,
      metricsType: row.metrics_type,
      counters: {
        total: row.total_delegations,
        successful: row.successful_delegations,
        failed: row.failed_delegations,
        retries: row.retries,
        timeouts: row.timeouts
      },
      duration: {
        avg: row.avg_duration_ms,
        min: row.min_duration_ms,
        max: row.max_duration_ms,
        p50: row.p50_duration_ms,
        p95: row.p95_duration_ms,
        p99: row.p99_duration_ms
      },
      quality: {
        avg: row.avg_quality_score,
        min: row.min_quality_score,
        max: row.max_quality_score
      },
      patternDistribution: row.pattern_distribution ? JSON.parse(row.pattern_distribution) : {},
      resources: {
        peakChildren: row.peak_concurrent_children,
        totalTokens: row.total_tokens_consumed
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      fullData: row.metrics_data ? JSON.parse(row.metrics_data) : null
    };
  }

  /**
   * Save a delegation metrics snapshot
   * @param {string} metricsId - Parent metrics ID
   * @param {Object} snapshotData - Snapshot data
   * @returns {Object} Saved snapshot info
   */
  saveDelegationSnapshot(metricsId, snapshotData) {
    const now = Date.now();
    const id = snapshotData.snapshotId || `snap-${now}-${Math.random().toString(36).substr(2, 9)}`;
    const sessionId = snapshotData.sessionId || this._currentSessionId;

    const counters = snapshotData.counters || {};
    const histograms = snapshotData.histograms || {};
    const quality = snapshotData.quality || {};

    this._stmts.insertDelegationSnapshot.run(
      id,
      metricsId,
      sessionId,
      snapshotData.timestamp || now,
      counters.success || 0,
      counters.failure || 0,
      counters.retries || 0,
      counters.timeouts || 0,
      JSON.stringify(histograms.delegationDuration || {}),
      quality.avgQuality || null,
      JSON.stringify(snapshotData.patterns || {}),
      snapshotData.activeChildren || 0,
      JSON.stringify(snapshotData),
      now
    );

    this.emit('snapshot:saved', { id, metricsId, timestamp: now });

    return { id, metricsId, savedAt: now };
  }

  /**
   * Get delegation snapshots by metrics ID
   * @param {string} metricsId - Parent metrics ID
   * @param {Object} options - Query options
   * @returns {Array} Array of snapshots
   */
  getDelegationSnapshots(metricsId, options = {}) {
    const { since, limit = 100 } = options;

    let rows;
    if (since) {
      rows = this._stmts.getDelegationSnapshotsSince.all(metricsId, since);
    } else {
      rows = this._stmts.getDelegationSnapshotsByMetrics.all(metricsId, limit);
    }

    return rows.map(row => this._parseDelegationSnapshotRow(row));
  }

  /**
   * Get recent delegation snapshots across all metrics
   * @param {number} limit - Maximum records to return
   * @returns {Array} Array of snapshots
   */
  getRecentDelegationSnapshots(limit = 50) {
    const rows = this._stmts.getRecentDelegationSnapshots.all(limit);
    return rows.map(row => this._parseDelegationSnapshotRow(row));
  }

  /**
   * Clean up old delegation snapshots
   * @param {number} olderThanMs - Delete snapshots older than this timestamp
   * @returns {number} Number of deleted records
   */
  cleanupOldDelegationSnapshots(olderThanMs) {
    const result = this._stmts.deleteOldDelegationSnapshots.run(olderThanMs);
    return result.changes;
  }

  /**
   * Parse a delegation snapshot row from the database
   * @private
   */
  _parseDelegationSnapshotRow(row) {
    return {
      id: row.id,
      metricsId: row.metrics_id,
      sessionId: row.session_id,
      snapshotTime: row.snapshot_time,
      counters: {
        success: row.success_count,
        failure: row.failure_count,
        retries: row.retry_count,
        timeouts: row.timeout_count
      },
      durationHistogram: row.duration_histogram ? JSON.parse(row.duration_histogram) : null,
      avgQuality: row.avg_quality,
      patternSnapshot: row.pattern_snapshot ? JSON.parse(row.pattern_snapshot) : null,
      activeChildren: row.active_children,
      fullData: row.snapshot_data ? JSON.parse(row.snapshot_data) : null,
      createdAt: row.created_at
    };
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  /**
   * Close database connection and cleanup
   */
  close() {
    this.stopHeartbeatTimer();
    this.stopCleanupTimer();

    // Deregister current session if any
    if (this._currentSessionId) {
      this.deregisterSession(this._currentSessionId);
    }

    if (this.db) {
      this.db.close();
      this.db = null;
    }

    this.emit('db:closed');
  }

  /**
   * Get current session ID
   * @returns {string|null} Current session ID
   */
  getSessionId() {
    return this._currentSessionId;
  }
}

module.exports = CoordinationDB;
