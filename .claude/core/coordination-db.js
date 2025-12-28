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
   * Deregister session and release all its locks
   * @param {string} sessionId - Session ID to deregister
   * @returns {Object} Deregistration result
   */
  deregisterSession(sessionId = null) {
    const sid = sessionId || this._currentSessionId;
    if (!sid) return { deregistered: false, locksReleased: 0 };

    // Release all locks held by this session
    const locks = this._stmts.getLocksBySession.all(sid);
    this._stmts.deleteAllSessionLocks.run(sid);

    // Remove session
    const result = this._stmts.deleteSession.run(sid);

    if (sid === this._currentSessionId) {
      this._currentSessionId = null;
    }

    this.emit('session:deregistered', {
      sessionId: sid,
      locksReleased: locks.length
    });

    return {
      sessionId: sid,
      deregistered: result.changes > 0,
      locksReleased: locks.length
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

    return {
      sessions: {
        total: sessionCount,
        active: activeSessionCount,
        stale: sessionCount - activeSessionCount
      },
      locks: {
        total: lockCount
      },
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
