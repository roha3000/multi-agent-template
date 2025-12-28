/**
 * Session Registry Service
 *
 * Tracks multiple autonomous orchestrator sessions for the Command Center.
 * Provides centralized session state management, metrics aggregation,
 * and event-driven updates.
 *
 * @module session-registry
 */

const EventEmitter = require('events');
const { createComponentLogger } = require('./logger');

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

    const session = {
      id,
      project: sessionData.project || 'unknown',
      path: sessionData.path || process.cwd(),
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
      lastUpdate: now
    };

    this.sessions.set(id, session);
    log.info('Session registered', { id, project: session.project });
    this.emit('session:registered', session);

    return id;
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
