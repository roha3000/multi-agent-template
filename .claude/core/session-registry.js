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
 *
 * @module session-registry
 */

const EventEmitter = require('events');
const { createComponentLogger } = require('./logger');
const { getHierarchyRegistry, DelegationStatus } = require('./hierarchy-registry');

const log = createComponentLogger('SessionRegistry');

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

    this._startCleanupTimer();

    log.info('Session registry initialized');
  }

  /**
   * Register a new session.
   * @param {Object} sessionData - Initial session data
   * @returns {number} The assigned session ID
   */
  register(sessionData) {
    const id = this.nextId++;
    const now = new Date().toISOString();

    // Process hierarchy configuration
    const hierarchyData = sessionData.hierarchy || {};

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
   * @param {number} id - Session ID
   * @returns {Object|null} Deregistered session or null
   */
  deregister(id) {
    const session = this.sessions.get(id);
    if (!session) return null;

    session.status = 'ended';
    session.lastUpdate = new Date().toISOString();

    if (session.startTime) {
      session.runtime = Math.floor((Date.now() - new Date(session.startTime).getTime()) / 1000);
    }

    log.info('Session deregistered', { id, project: session.project });
    this.emit('session:deregistered', session);
    this.sessions.delete(id);
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

  shutdown() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    log.info('Session registry shutdown');
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

    // Remove from active if completed/failed
    if (status === DelegationStatus.COMPLETED || status === DelegationStatus.FAILED || status === DelegationStatus.CANCELLED) {
      session.activeDelegations = session.activeDelegations.filter(d => d.delegationId !== delegationId);
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

module.exports = { SessionRegistry, getSessionRegistry, resetSessionRegistry };
