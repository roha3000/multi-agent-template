/**
 * Session Registry Service
 *
 * Tracks multiple autonomous orchestrator sessions for the Command Center.
 * Provides centralized session state management, metrics aggregation,
 * hierarchy tracking, and event-driven updates.
 *
 * Features:
 * - Session lifecycle management (register, update, deregister)
 * - Hierarchy tracking (parent-child session relationships)
 * - Rollup metrics aggregation from child sessions
 * - Active delegation tracking
 * - Real-time event emission for dashboard updates
 * - Persistent nextId across restarts (stored in memory.db)
 *
 * @module session-registry
 */

const EventEmitter = require('events');
const path = require('path');
const { createComponentLogger } = require('./logger');
const { getHierarchyRegistry, DelegationStatus } = require('./hierarchy-registry');

const log = createComponentLogger('SessionRegistry');

// Canonical database path per ARCHITECTURE.md
const MEMORY_DB_PATH = path.join(__dirname, '..', 'data', 'memory.db');
const NEXT_ID_KEY = 'session_registry_next_id';

// Fallback reasons for diagnostics
const FallbackReason = {
  NONE: 'none',
  MODULE_NOT_FOUND: 'better-sqlite3_not_installed',
  DIR_CREATE_FAILED: 'directory_creation_failed',
  DB_OPEN_FAILED: 'database_open_failed',
  DB_INIT_FAILED: 'database_initialization_failed',
  DB_LOCKED: 'database_locked',
  DB_CORRUPT: 'database_corrupt',
  DISK_FULL: 'disk_full',
  PERMISSION_DENIED: 'permission_denied',
  UNKNOWN: 'unknown_error'
};

// Recovery strategies for different fallback reasons
const RecoveryStrategy = {
  // Recoverable with retry (transient errors)
  RETRY: 'retry',
  // Recoverable with user action
  USER_ACTION: 'user_action',
  // Not recoverable automatically
  MANUAL: 'manual',
  // No recovery needed
  NONE: 'none'
};

// Map fallback reasons to recovery strategies
const RECOVERY_MAP = {
  [FallbackReason.NONE]: RecoveryStrategy.NONE,
  [FallbackReason.MODULE_NOT_FOUND]: RecoveryStrategy.USER_ACTION,
  [FallbackReason.DIR_CREATE_FAILED]: RecoveryStrategy.USER_ACTION,
  [FallbackReason.DB_OPEN_FAILED]: RecoveryStrategy.RETRY,
  [FallbackReason.DB_INIT_FAILED]: RecoveryStrategy.RETRY,
  [FallbackReason.DB_LOCKED]: RecoveryStrategy.RETRY,
  [FallbackReason.DB_CORRUPT]: RecoveryStrategy.MANUAL,
  [FallbackReason.DISK_FULL]: RecoveryStrategy.USER_ACTION,
  [FallbackReason.PERMISSION_DENIED]: RecoveryStrategy.USER_ACTION,
  [FallbackReason.UNKNOWN]: RecoveryStrategy.RETRY
};

/**
 * Session Registry for tracking autonomous orchestrator sessions.
 * @extends EventEmitter
 */
class SessionRegistry extends EventEmitter {
  constructor(options = {}) {
    super();

    this.sessions = new Map();
    this.completions = [];
    this.nextId = 1;
    this.staleTimeout = options.staleTimeout || 30 * 60 * 1000;
    this.cleanupInterval = options.cleanupInterval || 60 * 1000;
    this.cleanupTimer = null;
    this.alerts = new Map();

    // Database connection for nextId persistence
    this.db = null;
    this.dbPath = options.dbPath || MEMORY_DB_PATH;
    this.persistenceEnabled = options.persistenceEnabled !== false;
    this.fallbackReason = FallbackReason.NONE;
    this.fallbackActive = false;
    this.dbRetryCount = 0;
    this.maxDbRetries = options.maxDbRetries || 3;

    // Enhanced fallback tracking
    this.fallbackMetrics = {
      totalFallbacks: 0,
      lastFallbackAt: null,
      consecutiveFallbacks: 0,
      recoveryAttempts: 0,
      successfulRecoveries: 0,
      fallbackHistory: [] // Last 10 fallback events
    };

    // Automatic recovery configuration
    this.autoRecoveryEnabled = options.autoRecoveryEnabled !== false;
    this.recoveryInterval = options.recoveryInterval || 60000; // 1 minute default
    this.maxRecoveryAttempts = options.maxRecoveryAttempts || 5;
    this.recoveryBackoffMultiplier = options.recoveryBackoffMultiplier || 2;
    this.recoveryTimer = null;
    this.currentRecoveryDelay = this.recoveryInterval;

    // Health check configuration
    this.healthCheckEnabled = options.healthCheckEnabled !== false;
    this.healthCheckInterval = options.healthCheckInterval || 30000; // 30 seconds
    this.healthCheckTimer = null;
    this.lastHealthCheck = null;
    this.healthStatus = 'unknown';

    // Load persisted nextId from database
    if (this.persistenceEnabled) {
      this._initializeDatabase();
      this._loadNextIdFromDb();
      // Start health check if persistence is active
      if (this.healthCheckEnabled && this.db) {
        this._startHealthCheckTimer();
      }
    }

    this._startCleanupTimer();

    log.info('Session registry initialized', {
      nextId: this.nextId,
      persistenceEnabled: this.persistenceEnabled,
      autoRecoveryEnabled: this.autoRecoveryEnabled,
      healthCheckEnabled: this.healthCheckEnabled
    });
  }

  /**
   * Initialize database connection for nextId persistence.
   * Uses the canonical memory.db path per ARCHITECTURE.md.
   * Gracefully falls back to memory-only mode if database is unavailable.
   * @private
   */
  _initializeDatabase() {
    let Database;

    // Step 1: Try to load better-sqlite3 module
    try {
      Database = require('better-sqlite3');
    } catch (error) {
      this._activateFallback(FallbackReason.MODULE_NOT_FOUND, error, {
        suggestion: 'Run: npm install better-sqlite3'
      });
      return;
    }

    const fs = require('fs');

    // Step 2: Ensure directory exists
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (error) {
      const reason = this._classifyError(error);
      this._activateFallback(reason, error, { path: this.dbPath });
      return;
    }

    // Step 3: Open database connection
    try {
      this.db = new Database(this.dbPath);
    } catch (error) {
      const reason = this._classifyError(error);
      this._activateFallback(reason, error, { path: this.dbPath });
      return;
    }

    // Step 4: Configure database and create schema
    try {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('busy_timeout = 5000');

      // Ensure system_info table exists (idempotent)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS system_info (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
      `);

      log.debug('Database initialized for nextId persistence', { path: this.dbPath });
    } catch (error) {
      // Close partial connection before falling back
      this._safeCloseDb();
      const reason = this._classifyError(error);
      this._activateFallback(reason, error, { path: this.dbPath });
    }
  }

  /**
   * Classify database errors into fallback reasons.
   * @private
   * @param {Error} error - The error to classify
   * @returns {string} FallbackReason constant
   */
  _classifyError(error) {
    const message = error.message || '';
    const code = error.code || '';

    // Check for specific SQLite error patterns
    if (message.includes('SQLITE_BUSY') || message.includes('database is locked')) {
      return FallbackReason.DB_LOCKED;
    }
    if (message.includes('SQLITE_CORRUPT') || message.includes('database disk image is malformed')) {
      return FallbackReason.DB_CORRUPT;
    }
    if (message.includes('SQLITE_FULL') || message.includes('disk full') || code === 'ENOSPC') {
      return FallbackReason.DISK_FULL;
    }
    if (code === 'EACCES' || code === 'EPERM' || message.includes('permission denied')) {
      return FallbackReason.PERMISSION_DENIED;
    }
    if (code === 'ENOENT' && message.includes('mkdir')) {
      return FallbackReason.DIR_CREATE_FAILED;
    }
    if (message.includes('unable to open database')) {
      return FallbackReason.DB_OPEN_FAILED;
    }

    return FallbackReason.UNKNOWN;
  }

  /**
   * Activate fallback mode with proper logging, metrics tracking, and auto-recovery.
   * @private
   * @param {string} reason - FallbackReason constant
   * @param {Error} error - The original error
   * @param {Object} context - Additional context for logging
   */
  _activateFallback(reason, error, context = {}) {
    this.db = null;
    this.persistenceEnabled = false;
    this.fallbackActive = true;
    this.fallbackReason = reason;

    // Update fallback metrics
    const now = new Date().toISOString();
    this.fallbackMetrics.totalFallbacks++;
    this.fallbackMetrics.lastFallbackAt = now;
    this.fallbackMetrics.consecutiveFallbacks++;

    // Add to fallback history (keep last 10)
    this.fallbackMetrics.fallbackHistory.push({
      reason,
      error: error.message,
      timestamp: now,
      context
    });
    if (this.fallbackMetrics.fallbackHistory.length > 10) {
      this.fallbackMetrics.fallbackHistory.shift();
    }

    // Determine recovery strategy
    const recoveryStrategy = RECOVERY_MAP[reason] || RecoveryStrategy.RETRY;

    log.warn('Database unavailable, using memory-only mode (IDs will reset on restart)', {
      reason,
      error: error.message,
      recoveryStrategy,
      consecutiveFallbacks: this.fallbackMetrics.consecutiveFallbacks,
      ...context
    });

    // Emit event for monitoring/alerting with enhanced data
    this.emit('persistence:fallback', {
      reason,
      error: error.message,
      timestamp: now,
      recoveryStrategy,
      metrics: {
        totalFallbacks: this.fallbackMetrics.totalFallbacks,
        consecutiveFallbacks: this.fallbackMetrics.consecutiveFallbacks
      },
      ...context
    });

    // Schedule automatic recovery for recoverable errors
    if (this.autoRecoveryEnabled && recoveryStrategy === RecoveryStrategy.RETRY) {
      this._scheduleRecovery();
    }

    // Stop health check timer since we're in fallback mode
    this._stopHealthCheckTimer();
  }

  /**
   * Schedule an automatic recovery attempt with exponential backoff.
   * @private
   */
  _scheduleRecovery() {
    // Don't schedule if already scheduled or max attempts reached
    if (this.recoveryTimer) {
      return;
    }

    if (this.fallbackMetrics.recoveryAttempts >= this.maxRecoveryAttempts) {
      log.warn('Max recovery attempts reached, automatic recovery disabled', {
        attempts: this.fallbackMetrics.recoveryAttempts,
        maxAttempts: this.maxRecoveryAttempts
      });
      this.emit('persistence:recoveryExhausted', {
        attempts: this.fallbackMetrics.recoveryAttempts,
        timestamp: new Date().toISOString()
      });
      return;
    }

    log.info('Scheduling automatic recovery attempt', {
      delay: this.currentRecoveryDelay,
      attempt: this.fallbackMetrics.recoveryAttempts + 1,
      maxAttempts: this.maxRecoveryAttempts
    });

    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      this._attemptAutoRecovery();
    }, this.currentRecoveryDelay);

    // Prevent timer from blocking process exit
    if (this.recoveryTimer.unref) {
      this.recoveryTimer.unref();
    }
  }

  /**
   * Attempt automatic recovery from fallback mode.
   * @private
   */
  _attemptAutoRecovery() {
    this.fallbackMetrics.recoveryAttempts++;

    log.info('Attempting automatic database recovery', {
      attempt: this.fallbackMetrics.recoveryAttempts,
      maxAttempts: this.maxRecoveryAttempts,
      previousReason: this.fallbackReason
    });

    this.emit('persistence:recoveryAttempt', {
      attempt: this.fallbackMetrics.recoveryAttempts,
      timestamp: new Date().toISOString()
    });

    const success = this.attemptReconnect();

    if (success) {
      // Reset recovery state on success
      this.fallbackMetrics.successfulRecoveries++;
      this.fallbackMetrics.consecutiveFallbacks = 0;
      this.currentRecoveryDelay = this.recoveryInterval;

      log.info('Automatic recovery successful', {
        successfulRecoveries: this.fallbackMetrics.successfulRecoveries,
        nextId: this.nextId
      });

      // Restart health check
      if (this.healthCheckEnabled) {
        this._startHealthCheckTimer();
      }
    } else {
      // Apply exponential backoff
      this.currentRecoveryDelay = Math.min(
        this.currentRecoveryDelay * this.recoveryBackoffMultiplier,
        300000 // Max 5 minutes
      );

      log.warn('Automatic recovery failed, scheduling retry', {
        nextDelay: this.currentRecoveryDelay,
        attempt: this.fallbackMetrics.recoveryAttempts
      });

      // Schedule next attempt
      this._scheduleRecovery();
    }
  }

  /**
   * Start the health check timer to monitor database health.
   * @private
   */
  _startHealthCheckTimer() {
    if (this.healthCheckTimer) {
      return; // Already running
    }

    this.healthCheckTimer = setInterval(() => {
      this._performHealthCheck();
    }, this.healthCheckInterval);

    // Prevent timer from blocking process exit
    if (this.healthCheckTimer.unref) {
      this.healthCheckTimer.unref();
    }

    log.debug('Health check timer started', { interval: this.healthCheckInterval });
  }

  /**
   * Stop the health check timer.
   * @private
   */
  _stopHealthCheckTimer() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
      log.debug('Health check timer stopped');
    }
  }

  /**
   * Perform a health check on the database connection.
   * @private
   */
  _performHealthCheck() {
    this.lastHealthCheck = new Date().toISOString();

    if (!this.db) {
      this.healthStatus = 'disconnected';
      return;
    }

    try {
      // Simple query to verify database is responsive
      const stmt = this.db.prepare('SELECT 1 as health');
      stmt.get();
      this.healthStatus = 'healthy';
    } catch (error) {
      const previousStatus = this.healthStatus;
      this.healthStatus = 'unhealthy';

      log.warn('Database health check failed', {
        error: error.message,
        previousStatus
      });

      // Proactively activate fallback if health check fails
      if (previousStatus === 'healthy') {
        const reason = this._classifyError(error);
        this._activateFallback(reason, error, {
          detectedBy: 'healthCheck',
          previousStatus
        });
      }
    }
  }

  /**
   * Get current health check status.
   * @returns {Object} Health status information
   */
  getHealthStatus() {
    return {
      status: this.healthStatus,
      lastCheck: this.lastHealthCheck,
      checkInterval: this.healthCheckInterval,
      enabled: this.healthCheckEnabled
    };
  }

  /**
   * Safely close database connection.
   * @private
   */
  _safeCloseDb() {
    if (this.db) {
      try {
        this.db.close();
      } catch (closeError) {
        log.debug('Error closing database during fallback', { error: closeError.message });
      }
      this.db = null;
    }
  }

  /**
   * Load persisted nextId from database.
   * Falls back to 1 if no value exists or on error.
   * @private
   */
  _loadNextIdFromDb() {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare('SELECT value FROM system_info WHERE key = ?');
      const row = stmt.get(NEXT_ID_KEY);

      if (row && row.value) {
        const persistedId = parseInt(row.value, 10);
        if (!isNaN(persistedId) && persistedId > 0) {
          this.nextId = persistedId;
          log.info('Loaded persisted nextId from database', { nextId: this.nextId });
        }
      } else {
        // No persisted value, start fresh but persist initial value
        this._persistNextId();
        log.debug('No persisted nextId found, starting at 1');
      }
    } catch (error) {
      // Check if this is a recoverable error
      const reason = this._classifyError(error);
      if (reason === FallbackReason.DB_CORRUPT || reason === FallbackReason.DB_LOCKED) {
        // These might be recoverable with retry or database isn't usable
        this._activateFallback(reason, error, {
          operation: 'loadNextId',
          path: this.dbPath
        });
      } else {
        // Log but continue with default - might still be able to write
        log.warn('Failed to load nextId from database, using default', {
          error: error.message,
          defaultNextId: this.nextId
        });
      }
    }
  }

  /**
   * Persist current nextId to database.
   * Called after each ID allocation.
   * Implements retry logic for transient failures.
   * @private
   */
  _persistNextId() {
    if (!this.db) return;

    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO system_info (key, value, updated_at)
          VALUES (?, ?, strftime('%s', 'now'))
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = strftime('%s', 'now')
        `);
        stmt.run(NEXT_ID_KEY, String(this.nextId));
        log.debug('Persisted nextId to database', { nextId: this.nextId });
        return; // Success - exit
      } catch (error) {
        lastError = error;
        const reason = this._classifyError(error);

        // Only retry for transient errors (locked database)
        if (reason === FallbackReason.DB_LOCKED && attempt < maxRetries) {
          log.debug('Database locked, retrying persist operation', {
            attempt,
            maxRetries
          });
          // Brief pause before retry (synchronous for better-sqlite3)
          const start = Date.now();
          while (Date.now() - start < 50 * attempt) {
            // Busy wait - not ideal but better-sqlite3 is synchronous
          }
          continue;
        }

        // Non-recoverable or max retries reached
        if (reason === FallbackReason.DB_CORRUPT || reason === FallbackReason.DISK_FULL) {
          // Activate fallback for severe errors
          this._activateFallback(reason, error, {
            operation: 'persistNextId',
            nextId: this.nextId
          });
          return;
        }

        // Log warning but continue - IDs are still unique within this session
        log.warn('Failed to persist nextId to database', {
          error: error.message,
          attempt,
          nextId: this.nextId
        });
        return;
      }
    }

    // All retries exhausted
    if (lastError) {
      log.warn('Failed to persist nextId after all retries', {
        error: lastError.message,
        attempts: maxRetries,
        nextId: this.nextId
      });
    }
  }

  /**
   * Register a new session.
   * @param {Object} sessionData - Initial session data
   * @returns {number} The assigned session ID
   */
  register(sessionData) {
    const id = this.nextId++;
    // Persist the incremented nextId immediately after allocation
    this._persistNextId();
    const now = new Date().toISOString();

    // Process hierarchy configuration
    // Accept parentSessionId either directly or inside hierarchy object
    const hierarchyData = sessionData.hierarchy || {};
    if (sessionData.parentSessionId && !hierarchyData.parentSessionId) {
      hierarchyData.parentSessionId = sessionData.parentSessionId;
    }

    const session = {
      id,
      // Claude Code session ID (from hooks) - used for session lifecycle tracking
      claudeSessionId: sessionData.claudeSessionId || null,
      project: sessionData.project || 'unknown',
      path: sessionData.path || process.cwd(),
      // Add projectKey for multi-project isolation (normalized path)
      projectKey: sessionData.projectKey || this._normalizeProjectKey(sessionData.path || process.cwd()),
      status: sessionData.status || 'idle',
      startTime: now,
      currentTask: sessionData.currentTask || null,
      nextTask: sessionData.nextTask || null,
      contextPercent: sessionData.contextPercent || 0,
      qualityScore: sessionData.qualityScore || 0,
      confidenceScore: sessionData.confidenceScore || 100,
      tokens: sessionData.tokens || 0,
      tokensIn: sessionData.tokensIn || 0,
      tokensOut: sessionData.tokensOut || 0,
      cost: sessionData.cost || 0,
      runtime: 0,
      iteration: sessionData.iteration || 0,
      phase: sessionData.phase || 'idle',
      // Session type tracking
      sessionType: sessionData.sessionType || 'cli', // 'cli' | 'autonomous' | 'loop'
      autonomous: sessionData.autonomous || sessionData.sessionType === 'autonomous',
      orchestratorInfo: sessionData.orchestratorInfo || null,
      // Log session ID - maps to the actual log file (session-N.log)
      // This may differ from the registry ID when multiple orchestrators run
      logSessionId: sessionData.logSessionId || null,
      // Detail view fields
      acceptanceCriteria: sessionData.acceptanceCriteria || [],
      taskQueue: sessionData.taskQueue || [],
      confidenceSignals: sessionData.confidenceSignals || {
        quality: 0,
        velocity: 50,
        iterations: 50,
        errorRate: 0,
        historical: 70
      },
      phaseHistory: sessionData.phaseHistory || [],
      lastUpdate: now,

      // ========================================
      // HIERARCHY TRACKING
      // ========================================
      hierarchyInfo: {
        isRoot: !hierarchyData.parentSessionId,
        parentSessionId: hierarchyData.parentSessionId || null,
        childSessionIds: [],
        delegationDepth: hierarchyData.delegationDepth || 0,
        rootSessionId: hierarchyData.rootSessionId || id  // Self if root
      },

      // Active delegations from this session
      activeDelegations: [],

      // Completed delegations history (for audit trail)
      completedDelegations: [],

      // Aggregated metrics from child sessions (rollup)
      rollupMetrics: {
        totalTokens: 0,
        totalCost: 0,
        avgQuality: 0,
        activeAgentCount: 0,
        totalAgentCount: 0,
        maxDelegationDepth: 0,
        childSessionCount: 0
      }
    };

    // If this session has a parent, register the relationship
    if (hierarchyData.parentSessionId) {
      this._registerChildSession(hierarchyData.parentSessionId, id);
    }

    this.sessions.set(id, session);
    log.info('Session registered', {
      id,
      project: session.project,
      isRoot: session.hierarchyInfo.isRoot,
      parentSessionId: session.hierarchyInfo.parentSessionId
    });
    this.emit('session:registered', session);

    return id;
  }

  /**
   * Normalize project path to a consistent key
   * @private
   */
  _normalizeProjectKey(projectPath) {
    if (!projectPath) return 'unknown';
    // Normalize path separators and lowercase for Windows compatibility
    return projectPath.replace(/\\/g, '/').toLowerCase();
  }

  /**
   * Register a child session under a parent
   * @private
   */
  _registerChildSession(parentSessionId, childSessionId) {
    const parentSession = this.sessions.get(parentSessionId);
    if (!parentSession) {
      log.warn('Parent session not found for child registration', {
        parentSessionId,
        childSessionId
      });
      return false;
    }

    if (!parentSession.hierarchyInfo.childSessionIds.includes(childSessionId)) {
      parentSession.hierarchyInfo.childSessionIds.push(childSessionId);
      parentSession.rollupMetrics.childSessionCount++;

      log.debug('Child session registered', {
        parentSessionId,
        childSessionId,
        totalChildren: parentSession.hierarchyInfo.childSessionIds.length
      });

      this.emit('session:childAdded', {
        parentSessionId,
        childSessionId
      });
    }

    return true;
  }

  /**
   * Update an existing session.
   * @param {number} id - Session ID
   * @param {Object} updates - Fields to update
   * @returns {Object|null} Updated session or null
   */
  update(id, updates) {
    const session = this.sessions.get(id);
    if (!session) {
      log.warn('Attempted to update non-existent session', { id });
      return null;
    }

    if (session.startTime) {
      const startMs = new Date(session.startTime).getTime();
      updates.runtime = Math.floor((Date.now() - startMs) / 1000);
    }

    const updatedSession = {
      ...session,
      ...updates,
      lastUpdate: new Date().toISOString()
    };

    this.sessions.set(id, updatedSession);
    log.debug('Session updated', { id });
    this.emit('session:updated', { session: updatedSession, changes: updates });
    this._checkAlerts(updatedSession);

    return updatedSession;
  }

  /**
   * Deregister a session.
   * Sessions are marked as 'ended' but kept in registry for hierarchy visibility.
   * They'll be cleaned up by the stale session cleanup timer.
   * @param {number} id - Session ID
   * @returns {Object|null} Deregistered session or null
   */
  deregister(id) {
    const session = this.sessions.get(id);
    if (!session) return null;

    session.status = 'ended';
    session.endedAt = new Date().toISOString();
    session.lastUpdate = session.endedAt;

    if (session.startTime) {
      session.runtime = Math.floor((Date.now() - new Date(session.startTime).getTime()) / 1000);
    }

    log.info('Session deregistered', { id, project: session.project, hasParent: !!session.hierarchyInfo?.parentSessionId });
    this.emit('session:deregistered', session);

    // Keep session in registry for hierarchy visibility (don't delete)
    // Child sessions will be visible in parent's hierarchy until stale cleanup
    // Only delete alerts
    this.alerts.delete(id);

    return session;
  }

  get(id) {
    return this.sessions.get(id) || null;
  }

  /**
   * Find a session by Claude Code session ID.
   * @param {string} claudeSessionId - The Claude Code session ID
   * @returns {Object|null} Session or null
   */
  getByClaudeSessionId(claudeSessionId) {
    if (!claudeSessionId) return null;
    for (const session of this.sessions.values()) {
      if (session.claudeSessionId === claudeSessionId) {
        return session;
      }
    }
    return null;
  }

  /**
   * Deregister a session by Claude Code session ID.
   * @param {string} claudeSessionId - The Claude Code session ID
   * @returns {Object|null} Deregistered session or null
   */
  deregisterByClaudeSessionId(claudeSessionId) {
    const session = this.getByClaudeSessionId(claudeSessionId);
    if (!session) return null;
    return this.deregister(session.id);
  }

  getAll() {
    return Array.from(this.sessions.values());
  }

  getActive() {
    return Array.from(this.sessions.values()).filter(s => s.status !== 'ended');
  }

  /**
   * Get registry summary for Command Center.
   * @returns {Object} Summary with metrics, sessions, and completions
   */
  getSummary() {
    const sessions = this.getAll();
    const activeSessions = sessions.filter(s => s.status === 'active');
    const today = new Date().toISOString().split('T')[0];

    return {
      metrics: {
        activeCount: activeSessions.length,
        tasksCompletedToday: this.completions.filter(c => c.completedAt.startsWith(today)).length,
        avgHealthScore: this._calculateAvgHealthScore(activeSessions),
        totalCostToday: this._calculateTodayCost(),
        alertCount: this.alerts.size
      },
      sessions,
      recentCompletions: this.getRecentCompletions(10)
    };
  }

  /**
   * Record a task completion.
   */
  recordCompletion(project, task, score, cost) {
    const completion = {
      project,
      taskId: task.id || 'unknown',
      taskTitle: task.title || 'Unknown Task',
      score,
      cost,
      completedAt: new Date().toISOString()
    };

    this.completions.push(completion);
    log.info('Task completion recorded', { project, taskId: completion.taskId, score });
    this.emit('task:completed', completion);
    this._pruneCompletions();

    return completion;
  }

  getRecentCompletions(limit = 10) {
    return this.completions.slice(-limit).reverse();
  }

  /**
   * Get persistence/fallback status for monitoring.
   * @returns {Object} Status information
   */
  getPersistenceStatus() {
    return {
      enabled: this.persistenceEnabled,
      fallbackActive: this.fallbackActive,
      fallbackReason: this.fallbackReason,
      recoveryStrategy: this.fallbackActive ? RECOVERY_MAP[this.fallbackReason] : null,
      dbPath: this.dbPath,
      dbConnected: this.db !== null,
      nextId: this.nextId,
      metrics: {
        ...this.fallbackMetrics,
        // Don't include full history in status (can be retrieved separately)
        fallbackHistory: this.fallbackMetrics.fallbackHistory.length
      },
      recovery: {
        autoRecoveryEnabled: this.autoRecoveryEnabled,
        recoveryScheduled: this.recoveryTimer !== null,
        currentDelay: this.currentRecoveryDelay,
        maxAttempts: this.maxRecoveryAttempts
      },
      health: this.getHealthStatus()
    };
  }

  /**
   * Get detailed fallback history for debugging.
   * @returns {Array} Array of fallback events
   */
  getFallbackHistory() {
    return [...this.fallbackMetrics.fallbackHistory];
  }

  /**
   * Reset fallback metrics (useful for testing or after manual intervention).
   */
  resetFallbackMetrics() {
    this.fallbackMetrics = {
      totalFallbacks: 0,
      lastFallbackAt: null,
      consecutiveFallbacks: 0,
      recoveryAttempts: 0,
      successfulRecoveries: 0,
      fallbackHistory: []
    };
    this.currentRecoveryDelay = this.recoveryInterval;
    log.info('Fallback metrics reset');
  }

  /**
   * Cancel any pending recovery attempts.
   */
  cancelRecovery() {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
      log.info('Pending recovery attempt cancelled');
    }
  }

  /**
   * Force immediate recovery attempt (bypasses scheduled timing).
   * @returns {boolean} True if recovery succeeded
   */
  forceRecovery() {
    // Cancel any pending scheduled recovery
    this.cancelRecovery();

    // Reset recovery attempts counter to allow fresh attempts
    const previousAttempts = this.fallbackMetrics.recoveryAttempts;
    this.fallbackMetrics.recoveryAttempts = 0;
    this.currentRecoveryDelay = this.recoveryInterval;

    log.info('Forcing immediate recovery attempt', {
      previousAttempts,
      wasInFallback: this.fallbackActive
    });

    const success = this.attemptReconnect();

    if (success) {
      this.fallbackMetrics.successfulRecoveries++;
      this.fallbackMetrics.consecutiveFallbacks = 0;
      if (this.healthCheckEnabled) {
        this._startHealthCheckTimer();
      }
    }

    return success;
  }

  /**
   * Attempt to reconnect to the database after a fallback.
   * Useful for recovery after transient failures.
   * @returns {boolean} True if reconnection succeeded
   */
  attemptReconnect() {
    if (!this.fallbackActive) {
      log.debug('No reconnection needed, persistence is active');
      return true;
    }

    log.info('Attempting database reconnection', {
      previousReason: this.fallbackReason,
      path: this.dbPath
    });

    // Reset fallback state
    this.fallbackActive = false;
    this.fallbackReason = FallbackReason.NONE;
    this.persistenceEnabled = true;

    // Try to reinitialize
    this._initializeDatabase();

    if (this.db) {
      // Try to load any existing value
      this._loadNextIdFromDb();
      log.info('Database reconnection successful', { nextId: this.nextId });
      this.emit('persistence:reconnected', {
        timestamp: new Date().toISOString(),
        nextId: this.nextId
      });
      return true;
    }

    return false;
  }

  shutdown() {
    // Stop cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Stop health check timer
    this._stopHealthCheckTimer();

    // Cancel any pending recovery attempts
    this.cancelRecovery();

    // Close database connection if open
    if (this.db) {
      try {
        this.db.close();
        this.db = null;
        log.debug('Database connection closed');
      } catch (error) {
        log.warn('Error closing database connection', { error: error.message });
      }
    }

    log.info('Session registry shutdown', {
      fallbackMetrics: {
        totalFallbacks: this.fallbackMetrics.totalFallbacks,
        successfulRecoveries: this.fallbackMetrics.successfulRecoveries
      }
    });
  }

  _startCleanupTimer() {
    this.cleanupTimer = setInterval(() => this._cleanupStaleSessions(), this.cleanupInterval);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  _cleanupStaleSessions() {
    const now = Date.now();
    const staleThreshold = now - this.staleTimeout;

    for (const [id, session] of this.sessions) {
      if (session.status === 'ended') continue;
      const lastUpdateMs = new Date(session.lastUpdate).getTime();
      if (lastUpdateMs < staleThreshold) {
        log.warn('Expiring stale session', { id, project: session.project });
        session.status = 'ended';
        this.emit('session:expired', session);
        this.sessions.delete(id);
        this.alerts.delete(id);
      }
    }
  }

  _calculateAvgHealthScore(activeSessions) {
    if (activeSessions.length === 0) return 100;
    const scores = activeSessions.map(s => {
      const contextHealth = Math.max(0, 100 - s.contextPercent);
      return s.qualityScore * 0.4 + s.confidenceScore * 0.3 + contextHealth * 0.3;
    });
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }

  _calculateTodayCost() {
    const today = new Date().toISOString().split('T')[0];
    const completionCost = this.completions
      .filter(c => c.completedAt.startsWith(today))
      .reduce((sum, c) => sum + c.cost, 0);
    const sessionCost = Array.from(this.sessions.values()).reduce((sum, s) => sum + s.cost, 0);
    return Math.round((completionCost + sessionCost) * 100) / 100;
  }

  _checkAlerts(session) {
    const alerts = [];
    if (session.contextPercent > 80) {
      alerts.push({ type: 'context_high', severity: session.contextPercent > 90 ? 'critical' : 'warning' });
    }
    if (session.confidenceScore < 60) {
      alerts.push({ type: 'confidence_low', severity: session.confidenceScore < 40 ? 'critical' : 'warning' });
    }
    if (alerts.length > 0) this.alerts.set(session.id, alerts);
    else this.alerts.delete(session.id);
  }

  _pruneCompletions() {
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
    this.completions = this.completions.filter(c => new Date(c.completedAt).getTime() > cutoff);
  }

  // ============================================
  // HIERARCHY METHODS
  // ============================================

  /**
   * Add a delegation to a session
   * @param {number} sessionId - Session ID
   * @param {Object} delegation - Delegation data
   * @returns {Object|null} Created delegation or null
   */
  addDelegation(sessionId, delegation) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      log.warn('Session not found for delegation', { sessionId });
      return null;
    }

    const delegationRecord = {
      delegationId: delegation.delegationId || `del-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      targetAgentId: delegation.targetAgentId,
      taskId: delegation.taskId,
      status: DelegationStatus.PENDING,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: delegation.metadata || {}
    };

    session.activeDelegations.push(delegationRecord);
    session.lastUpdate = new Date().toISOString();

    log.debug('Delegation added to session', {
      sessionId,
      delegationId: delegationRecord.delegationId,
      targetAgentId: delegation.targetAgentId
    });

    this.emit('delegation:added', {
      sessionId,
      delegation: delegationRecord
    });

    return delegationRecord;
  }

  /**
   * Update a delegation status
   * @param {number} sessionId - Session ID
   * @param {string} delegationId - Delegation ID
   * @param {string} status - New status
   * @param {Object} data - Additional data (result, error)
   * @returns {Object|null} Updated delegation or null
   */
  updateDelegation(sessionId, delegationId, status, data = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const delegation = session.activeDelegations.find(d => d.delegationId === delegationId);
    if (!delegation) return null;

    const oldStatus = delegation.status;
    delegation.status = status;
    delegation.updatedAt = new Date().toISOString();

    if (data.result !== undefined) delegation.result = data.result;
    if (data.error !== undefined) delegation.error = data.error;

    // Move to completed history if finished (instead of deleting)
    if (status === DelegationStatus.COMPLETED || status === DelegationStatus.FAILED || status === DelegationStatus.CANCELLED) {
      delegation.completedAt = new Date().toISOString();

      // Move to completedDelegations for history
      session.completedDelegations.push({ ...delegation });

      // Remove from active
      session.activeDelegations = session.activeDelegations.filter(d => d.delegationId !== delegationId);

      // Prune old completed delegations (keep last 50)
      if (session.completedDelegations.length > 50) {
        session.completedDelegations = session.completedDelegations.slice(-50);
      }

      log.info('Delegation completed and moved to history', {
        sessionId,
        delegationId,
        status,
        completedCount: session.completedDelegations.length
      });
    }

    session.lastUpdate = new Date().toISOString();

    log.debug('Delegation updated', {
      sessionId,
      delegationId,
      oldStatus,
      status
    });

    this.emit('delegation:updated', {
      sessionId,
      delegationId,
      oldStatus,
      status,
      delegation
    });

    return delegation;
  }

  /**
   * Get completed delegations for a session
   * @param {number} sessionId - Session ID
   * @param {number} limit - Max number to return (default 20)
   * @returns {Array} Completed delegations (most recent first)
   */
  getCompletedDelegations(sessionId, limit = 20) {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    return session.completedDelegations
      .slice(-limit)
      .reverse(); // Most recent first
  }

  /**
   * Get all delegations (active + completed) for a session
   * @param {number} sessionId - Session ID
   * @returns {Object} { active: [], completed: [] }
   */
  getAllDelegations(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return { active: [], completed: [] };

    return {
      active: session.activeDelegations,
      completed: session.completedDelegations
    };
  }

  /**
   * Get rollup metrics aggregated from child sessions
   * @param {number} sessionId - Session ID
   * @returns {Object|null} Rollup metrics or null
   */
  getRollupMetrics(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Calculate fresh rollup from all descendants
    const rollup = this._calculateRollup(sessionId);

    // Update stored rollup metrics
    session.rollupMetrics = rollup;

    return rollup;
  }

  /**
   * Calculate rollup metrics recursively from descendants
   * @private
   */
  _calculateRollup(sessionId, visited = new Set()) {
    // Prevent cycles
    if (visited.has(sessionId)) {
      return {
        totalTokens: 0,
        totalCost: 0,
        avgQuality: 0,
        activeAgentCount: 0,
        totalAgentCount: 0,
        maxDelegationDepth: 0,
        childSessionCount: 0
      };
    }
    visited.add(sessionId);

    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        totalTokens: 0,
        totalCost: 0,
        avgQuality: 0,
        activeAgentCount: 0,
        totalAgentCount: 0,
        maxDelegationDepth: 0,
        childSessionCount: 0
      };
    }

    // Start with this session's metrics
    let rollup = {
      totalTokens: session.tokens || 0,
      totalCost: session.cost || 0,
      qualitySum: (session.qualityScore || 0) * 1, // Weight by 1 session
      qualityCount: 1,
      activeAgentCount: session.status === 'active' ? 1 : 0,
      totalAgentCount: 1,
      maxDelegationDepth: session.hierarchyInfo.delegationDepth,
      childSessionCount: session.hierarchyInfo.childSessionIds.length
    };

    // Aggregate from children
    for (const childId of session.hierarchyInfo.childSessionIds) {
      const childRollup = this._calculateRollup(childId, visited);

      rollup.totalTokens += childRollup.totalTokens;
      rollup.totalCost += childRollup.totalCost;
      rollup.qualitySum += childRollup.avgQuality * childRollup.totalAgentCount;
      rollup.qualityCount += childRollup.totalAgentCount;
      rollup.activeAgentCount += childRollup.activeAgentCount;
      rollup.totalAgentCount += childRollup.totalAgentCount;
      rollup.maxDelegationDepth = Math.max(rollup.maxDelegationDepth, childRollup.maxDelegationDepth);
      rollup.childSessionCount += childRollup.childSessionCount;
    }

    // Calculate average quality
    rollup.avgQuality = rollup.qualityCount > 0
      ? Math.round(rollup.qualitySum / rollup.qualityCount)
      : 0;

    // Clean up intermediate fields
    delete rollup.qualitySum;
    delete rollup.qualityCount;

    // Round cost for display
    rollup.totalCost = Math.round(rollup.totalCost * 100) / 100;

    return rollup;
  }

  /**
   * Get session with full hierarchy tree
   * @param {number} sessionId - Session ID
   * @returns {Object|null} Session with hierarchy tree or null
   */
  getSessionWithHierarchy(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      ...session,
      hierarchy: this._buildHierarchyTree(sessionId),
      rollupMetrics: this.getRollupMetrics(sessionId)
    };
  }

  /**
   * Build hierarchy tree for a session
   * @private
   */
  _buildHierarchyTree(sessionId, visited = new Set()) {
    if (visited.has(sessionId)) return null;
    visited.add(sessionId);

    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      sessionId: session.id,
      project: session.project,
      status: session.status,
      depth: session.hierarchyInfo.delegationDepth,
      isRoot: session.hierarchyInfo.isRoot,
      activeDelegationCount: session.activeDelegations.length,
      metrics: {
        tokens: session.tokens,
        cost: session.cost,
        quality: session.qualityScore,
        context: session.contextPercent
      },
      children: session.hierarchyInfo.childSessionIds
        .map(childId => this._buildHierarchyTree(childId, visited))
        .filter(Boolean)
    };
  }

  /**
   * Get hierarchy for a session (just the tree structure)
   * @param {number} sessionId - Session ID
   * @returns {Object|null} Hierarchy tree or null
   */
  getHierarchy(sessionId) {
    return this._buildHierarchyTree(sessionId);
  }

  /**
   * Get all root sessions (no parent)
   * @returns {Array<Object>} Array of root sessions
   */
  getRootSessions() {
    return Array.from(this.sessions.values())
      .filter(s => s.hierarchyInfo.isRoot && s.status !== 'ended');
  }

  /**
   * Get parent session
   * @param {number} sessionId - Session ID
   * @returns {Object|null} Parent session or null
   */
  getParentSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.hierarchyInfo.parentSessionId) return null;
    return this.sessions.get(session.hierarchyInfo.parentSessionId) || null;
  }

  /**
   * Get child sessions
   * @param {number} sessionId - Session ID
   * @returns {Array<Object>} Array of child sessions
   */
  getChildSessions(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    return session.hierarchyInfo.childSessionIds
      .map(id => this.sessions.get(id))
      .filter(Boolean);
  }

  /**
   * Get all descendants of a session
   * @param {number} sessionId - Session ID
   * @returns {Array<Object>} Array of all descendant sessions
   */
  getDescendants(sessionId) {
    const descendants = [];
    const visited = new Set();

    const collect = (id) => {
      if (visited.has(id)) return;
      visited.add(id);

      const session = this.sessions.get(id);
      if (!session) return;

      for (const childId of session.hierarchyInfo.childSessionIds) {
        const child = this.sessions.get(childId);
        if (child) {
          descendants.push(child);
          collect(childId);
        }
      }
    };

    collect(sessionId);
    return descendants;
  }

  /**
   * Propagate a metric update up the hierarchy
   * @param {number} sessionId - Session ID where update occurred
   * @param {string} metricType - Type of metric ('tokens', 'cost', 'quality')
   * @param {number} delta - Change in metric value
   */
  propagateMetricUpdate(sessionId, metricType, delta) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Walk up to root, updating rollup metrics
    let currentId = session.hierarchyInfo.parentSessionId;
    while (currentId) {
      const parent = this.sessions.get(currentId);
      if (!parent) break;

      // Trigger recalculation of rollup
      this.getRollupMetrics(currentId);

      // Emit update event for SSE
      this.emit('session:rollupUpdated', {
        sessionId: currentId,
        sourceSessionId: sessionId,
        metricType,
        delta,
        rollupMetrics: parent.rollupMetrics
      });

      currentId = parent.hierarchyInfo.parentSessionId;
    }
  }

  /**
   * Get summary with hierarchy information
   * @returns {Object} Enhanced summary with hierarchy data
   */
  getSummaryWithHierarchy() {
    const baseSummary = this.getSummary();

    // Add hierarchy-specific metrics
    const rootSessions = this.getRootSessions();
    const totalHierarchyDepth = Math.max(
      0,
      ...Array.from(this.sessions.values()).map(s => s.hierarchyInfo.delegationDepth)
    );

    const activeDelegationCount = Array.from(this.sessions.values())
      .reduce((sum, s) => sum + s.activeDelegations.length, 0);

    return {
      ...baseSummary,
      hierarchyMetrics: {
        rootSessionCount: rootSessions.length,
        maxDelegationDepth: totalHierarchyDepth,
        activeDelegationCount,
        sessionsWithChildren: Array.from(this.sessions.values())
          .filter(s => s.hierarchyInfo.childSessionIds.length > 0).length
      },
      rootSessions: rootSessions.map(s => ({
        id: s.id,
        project: s.project,
        status: s.status,
        childCount: s.hierarchyInfo.childSessionIds.length,
        rollupMetrics: this.getRollupMetrics(s.id)
      }))
    };
  }
}

let instance = null;

function getSessionRegistry(options = {}) {
  if (!instance) instance = new SessionRegistry(options);
  return instance;
}

function resetSessionRegistry() {
  if (instance) {
    instance.shutdown();
    instance = null;
  }
}

module.exports = {
  SessionRegistry,
  getSessionRegistry,
  resetSessionRegistry,
  FallbackReason,
  RecoveryStrategy,
  RECOVERY_MAP
};
