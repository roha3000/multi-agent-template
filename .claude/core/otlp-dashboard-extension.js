/**
 * OTLP Dashboard Extension - Enhanced dashboard for OTLP metrics
 *
 * Extends the DashboardManager to properly display:
 * - Multiple Claude Code sessions in parallel
 * - Per-session context utilization
 * - Project-based metric aggregation
 * - Real-time OTLP metric updates
 * - Session lifecycle events
 * - Checkpoint and compaction events
 *
 * @module otlp-dashboard-extension
 */

const { createComponentLogger } = require('./logger');
const EventEmitter = require('events');
const express = require('express');
const path = require('path');

class OTLPDashboardExtension extends EventEmitter {
  /**
   * Create an OTLP dashboard extension
   *
   * @param {Object} components - System components
   * @param {DashboardManager} components.dashboardManager - Original dashboard
   * @param {SessionAwareMetricProcessor} components.sessionProcessor - Session processor
   * @param {OTLPCheckpointBridge} components.otlpBridge - OTLP bridge
   * @param {Object} options - Configuration
   */
  constructor(components, options = {}) {
    super();

    this.logger = createComponentLogger('OTLPDashboardExtension');

    // Components
    this.dashboardManager = components.dashboardManager;
    this.sessionProcessor = components.sessionProcessor;
    this.otlpBridge = components.otlpBridge;

    // Configuration
    this.options = {
      refreshInterval: 1000,     // 1 second refresh
      maxSessionsDisplay: 10,    // Max sessions to show
      maxMetricHistory: 100,     // Keep last 100 metrics per session
      ...options
    };

    // Extended dashboard state for OTLP
    this.otlpState = {
      sessions: new Map(),       // sessionId -> session display data
      projects: new Map(),       // projectId -> project summary
      globalMetrics: {
        totalSessions: 0,
        activeSessions: 0,
        totalTokens: 0,
        totalOperations: 0,
        checkpointsCreated: 0,
        compactionsSaved: 0
      },
      alerts: [],
      recentEvents: []
    };

    // Initialize
    this._setupEventListeners();
    this._extendDashboard();

    this.logger.info('OTLP Dashboard Extension initialized');
  }

  /**
   * Setup event listeners for OTLP components
   * @private
   */
  _setupEventListeners() {
    // Listen to session processor events
    if (this.sessionProcessor) {
      this.sessionProcessor.on('metrics:processed', (data) => {
        this._updateSessionMetrics(data);
      });

      this.sessionProcessor.on('session:created', (data) => {
        this._handleSessionCreated(data);
      });

      this.sessionProcessor.on('session:removed', (data) => {
        this._handleSessionRemoved(data);
      });

      this.sessionProcessor.on('pattern:parallel-sessions', (data) => {
        this._addEvent('warning', `Parallel sessions detected for ${data.projectId}`, data);
      });

      this.sessionProcessor.on('pattern:high-velocity', (data) => {
        this._addAlert('warning', 'High token velocity detected', data);
      });
    }

    // Listen to OTLP bridge events
    if (this.otlpBridge) {
      this.otlpBridge.on('context:status', (status) => {
        this._updateContextStatus(status);
      });

      this.otlpBridge.on('checkpoint:recommended', (data) => {
        this._addEvent('info', 'Checkpoint recommended', data);
      });

      this.otlpBridge.on('emergency:compaction', (data) => {
        this._addAlert('critical', 'Emergency compaction prevention triggered', data);
        this.otlpState.globalMetrics.compactionsSaved++;
      });

      this.otlpBridge.on('context:cleared', (data) => {
        this._addEvent('info', 'Context cleared', data);
      });

      this.otlpBridge.on('context:reloaded', (data) => {
        this._addEvent('success', 'Context reloaded', data);
      });
    }
  }

  /**
   * Extend the original dashboard with OTLP data
   * @private
   */
  _extendDashboard() {
    if (!this.dashboardManager) return;

    // Override the update method
    const originalUpdate = this.dashboardManager._updateDashboardState.bind(this.dashboardManager);

    this.dashboardManager._updateDashboardState = () => {
      // Call original update
      originalUpdate();

      // Add OTLP data
      this._injectOTLPData();
    };

    // Extend web dashboard routes
    if (this.dashboardManager.webServer) {
      this._extendWebRoutes();
    }

    // Start refresh timer
    this.refreshTimer = setInterval(() => {
      this._refreshOTLPMetrics();
    }, this.options.refreshInterval);
  }

  /**
   * Inject OTLP data into dashboard state
   * @private
   */
  _injectOTLPData() {
    const dashboardState = this.dashboardManager.state;

    // Add OTLP sessions data
    dashboardState.otlpSessions = this._getSessionsDisplay();

    // Add OTLP projects data
    dashboardState.otlpProjects = this._getProjectsDisplay();

    // Add global OTLP metrics
    dashboardState.otlpGlobalMetrics = this.otlpState.globalMetrics;

    // Add recent alerts
    dashboardState.otlpAlerts = this.otlpState.alerts.slice(0, 10);

    // Add recent events
    dashboardState.otlpEvents = this.otlpState.recentEvents.slice(0, 20);

    // Update context from OTLP if available
    if (this.otlpBridge) {
      const bridgeStatus = this.otlpBridge.getStatus();
      dashboardState.context.current = bridgeStatus.currentTokens || 0;
      dashboardState.context.percentage = (bridgeStatus.utilization || 0) * 100;
      dashboardState.context.status = this._getContextStatusLevel(bridgeStatus.utilization);
      dashboardState.context.velocity = bridgeStatus.tokenVelocity || 0;
      dashboardState.context.projectedExhaustion = bridgeStatus.projectedExhaustion;
    }
  }

  /**
   * Update session metrics from OTLP
   * @private
   */
  _updateSessionMetrics(data) {
    const { sessionId, projectId, metrics, session } = data;

    if (!this.otlpState.sessions.has(sessionId)) {
      this.otlpState.sessions.set(sessionId, {
        id: sessionId,
        projectId: projectId,
        startTime: Date.now(),
        lastUpdate: Date.now(),
        metrics: {
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          operations: 0,
          checkpoints: 0,
          errors: 0
        },
        context: {
          current: 0,
          max: 200000,
          utilization: 0,
          velocity: 0
        },
        status: 'active',
        history: []
      });
    }

    const sessionData = this.otlpState.sessions.get(sessionId);

    // Update metrics
    if (session) {
      sessionData.metrics = { ...session.metrics };
      sessionData.context.current = session.contextUtilization * session.contextWindow?.max || 0;
      sessionData.context.utilization = session.contextUtilization || 0;
      sessionData.context.max = session.contextWindow?.max || 200000;
    }

    // Update from processed metrics
    if (metrics && metrics.metrics) {
      metrics.metrics.forEach(metric => {
        if (metric.name.includes('token')) {
          // Token metrics already handled by session summary
        } else if (metric.name.includes('checkpoint')) {
          sessionData.metrics.checkpoints++;
        } else if (metric.name.includes('error')) {
          sessionData.metrics.errors++;
        }
      });
    }

    sessionData.lastUpdate = Date.now();

    // Add to history
    sessionData.history.push({
      timestamp: Date.now(),
      tokens: sessionData.context.current,
      utilization: sessionData.context.utilization
    });

    // Limit history
    if (sessionData.history.length > this.options.maxMetricHistory) {
      sessionData.history.shift();
    }

    // Update project
    this._updateProjectMetrics(projectId, sessionData);

    // Update global metrics
    this._updateGlobalMetrics();
  }

  /**
   * Handle session created
   * @private
   */
  _handleSessionCreated(data) {
    const { sessionId, projectId } = data;

    this._addEvent('info', `New session created: ${sessionId}`, { projectId });

    // Initialize session display
    if (!this.otlpState.sessions.has(sessionId)) {
      this.otlpState.sessions.set(sessionId, {
        id: sessionId,
        projectId: projectId,
        startTime: Date.now(),
        lastUpdate: Date.now(),
        metrics: {
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          operations: 0,
          checkpoints: 0,
          errors: 0
        },
        context: {
          current: 0,
          max: 200000,
          utilization: 0,
          velocity: 0
        },
        status: 'active',
        history: []
      });
    }
  }

  /**
   * Handle session removed
   * @private
   */
  _handleSessionRemoved(data) {
    const { sessionId } = data;

    this._addEvent('info', `Session removed: ${sessionId}`);

    const sessionData = this.otlpState.sessions.get(sessionId);
    if (sessionData) {
      sessionData.status = 'closed';
      // Keep for a while for history
      setTimeout(() => {
        this.otlpState.sessions.delete(sessionId);
      }, 300000); // Remove after 5 minutes
    }
  }

  /**
   * Update project metrics
   * @private
   */
  _updateProjectMetrics(projectId, sessionData) {
    if (!projectId) return;

    if (!this.otlpState.projects.has(projectId)) {
      this.otlpState.projects.set(projectId, {
        id: projectId,
        sessions: new Set(),
        totalTokens: 0,
        totalOperations: 0,
        activeSessions: 0
      });
    }

    const project = this.otlpState.projects.get(projectId);
    project.sessions.add(sessionData.id);

    // Recalculate project totals
    project.totalTokens = 0;
    project.totalOperations = 0;
    project.activeSessions = 0;

    for (const sid of project.sessions) {
      const session = this.otlpState.sessions.get(sid);
      if (session) {
        project.totalTokens += session.metrics.totalTokens || 0;
        project.totalOperations += session.metrics.operations || 0;
        if (session.status === 'active') {
          project.activeSessions++;
        }
      }
    }
  }

  /**
   * Update global metrics
   * @private
   */
  _updateGlobalMetrics() {
    const global = this.otlpState.globalMetrics;

    global.totalSessions = this.otlpState.sessions.size;
    global.activeSessions = 0;
    global.totalTokens = 0;
    global.totalOperations = 0;

    for (const session of this.otlpState.sessions.values()) {
      if (session.status === 'active') {
        global.activeSessions++;
      }
      global.totalTokens += session.metrics.totalTokens || 0;
      global.totalOperations += session.metrics.operations || 0;
    }
  }

  /**
   * Update context status
   * @private
   */
  _updateContextStatus(status) {
    // Update dashboard context
    if (this.dashboardManager) {
      this.dashboardManager.state.context.current = status.currentTokens || 0;
      this.dashboardManager.state.context.percentage = (status.utilization || 0) * 100;
      this.dashboardManager.state.context.velocity = status.tokenVelocity || 0;
      this.dashboardManager.state.context.checkMode = status.checkMode || 'normal';
    }
  }

  /**
   * Get sessions display data
   * @private
   */
  _getSessionsDisplay() {
    const sessions = [];

    for (const [id, session] of this.otlpState.sessions.entries()) {
      if (session.status === 'active') {
        sessions.push({
          id: session.id,
          projectId: session.projectId,
          duration: Date.now() - session.startTime,
          totalTokens: session.metrics.totalTokens,
          operations: session.metrics.operations,
          contextUtilization: (session.context.utilization * 100).toFixed(1) + '%',
          contextVelocity: session.context.velocity,
          status: this._getSessionStatus(session),
          lastUpdate: session.lastUpdate
        });
      }
    }

    // Sort by last update
    sessions.sort((a, b) => b.lastUpdate - a.lastUpdate);

    return sessions.slice(0, this.options.maxSessionsDisplay);
  }

  /**
   * Get projects display data
   * @private
   */
  _getProjectsDisplay() {
    const projects = [];

    for (const [id, project] of this.otlpState.projects.entries()) {
      if (project.activeSessions > 0) {
        projects.push({
          id: project.id,
          activeSessions: project.activeSessions,
          totalSessions: project.sessions.size,
          totalTokens: project.totalTokens,
          totalOperations: project.totalOperations
        });
      }
    }

    return projects;
  }

  /**
   * Get session status
   * @private
   */
  _getSessionStatus(session) {
    const utilization = session.context.utilization;

    if (utilization >= 0.95) return 'emergency';
    if (utilization >= 0.85) return 'critical';
    if (utilization >= 0.75) return 'warning';
    return 'ok';
  }

  /**
   * Get context status level
   * @private
   */
  _getContextStatusLevel(utilization) {
    if (utilization >= 0.95) return 'emergency';
    if (utilization >= 0.85) return 'critical';
    if (utilization >= 0.75) return 'warning';
    return 'ok';
  }

  /**
   * Add alert
   * @private
   */
  _addAlert(severity, message, data) {
    const alert = {
      id: `alert-${Date.now()}`,
      timestamp: Date.now(),
      severity,
      message,
      data
    };

    this.otlpState.alerts.unshift(alert);

    // Keep only last 100 alerts
    if (this.otlpState.alerts.length > 100) {
      this.otlpState.alerts = this.otlpState.alerts.slice(0, 100);
    }

    this.emit('alert', alert);
  }

  /**
   * Add event
   * @private
   */
  _addEvent(type, message, data) {
    const event = {
      timestamp: Date.now(),
      type,
      message,
      data
    };

    this.otlpState.recentEvents.unshift(event);

    // Keep only last 200 events
    if (this.otlpState.recentEvents.length > 200) {
      this.otlpState.recentEvents = this.otlpState.recentEvents.slice(0, 200);
    }
  }

  /**
   * Refresh OTLP metrics
   * @private
   */
  _refreshOTLPMetrics() {
    // Get latest metrics from session processor
    if (this.sessionProcessor) {
      const globalMetrics = this.sessionProcessor.getGlobalMetrics();
      Object.assign(this.otlpState.globalMetrics, globalMetrics);

      // Update active sessions
      const activeSessions = this.sessionProcessor.getActiveSessions();
      for (const session of activeSessions) {
        this._updateSessionDisplay(session);
      }
    }

    // Get latest bridge status
    if (this.otlpBridge) {
      const bridgeStatus = this.otlpBridge.getStatus();
      this.otlpState.globalMetrics.compactionsSaved = bridgeStatus.compactionSaves || 0;
      this.otlpState.globalMetrics.checkpointsCreated = bridgeStatus.checkpoints || 0;
    }
  }

  /**
   * Update session display
   * @private
   */
  _updateSessionDisplay(sessionSummary) {
    const sessionData = this.otlpState.sessions.get(sessionSummary.id);
    if (sessionData) {
      sessionData.metrics = { ...sessionSummary.metrics };
      sessionData.context.current = sessionSummary.contextRemaining
        ? sessionSummary.contextWindow?.max - sessionSummary.contextRemaining
        : 0;
      sessionData.context.utilization = sessionSummary.contextUtilization || 0;
      sessionData.lastUpdate = sessionSummary.lastActivity || Date.now();
    }
  }

  /**
   * Extend web routes for OTLP data
   * @private
   */
  _extendWebRoutes() {
    const app = this.dashboardManager.app;
    if (!app) return;

    // OTLP sessions endpoint
    app.get('/api/otlp/sessions', (req, res) => {
      res.json({
        sessions: this._getSessionsDisplay(),
        total: this.otlpState.sessions.size,
        active: this.otlpState.globalMetrics.activeSessions
      });
    });

    // OTLP projects endpoint
    app.get('/api/otlp/projects', (req, res) => {
      res.json({
        projects: this._getProjectsDisplay(),
        total: this.otlpState.projects.size
      });
    });

    // OTLP metrics endpoint
    app.get('/api/otlp/metrics', (req, res) => {
      res.json(this.otlpState.globalMetrics);
    });

    // OTLP alerts endpoint
    app.get('/api/otlp/alerts', (req, res) => {
      res.json(this.otlpState.alerts.slice(0, 50));
    });

    // OTLP events endpoint
    app.get('/api/otlp/events', (req, res) => {
      res.json(this.otlpState.recentEvents.slice(0, 100));
    });

    // Session details endpoint
    app.get('/api/otlp/session/:id', (req, res) => {
      const session = this.otlpState.sessions.get(req.params.id);
      if (session) {
        res.json(session);
      } else {
        res.status(404).json({ error: 'Session not found' });
      }
    });

    this.logger.info('Extended web routes for OTLP data');
  }

  /**
   * Get OTLP dashboard state
   */
  getOTLPState() {
    return {
      sessions: this._getSessionsDisplay(),
      projects: this._getProjectsDisplay(),
      globalMetrics: this.otlpState.globalMetrics,
      alerts: this.otlpState.alerts.slice(0, 10),
      events: this.otlpState.recentEvents.slice(0, 20)
    };
  }

  /**
   * Stop the extension
   */
  stop() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    this.logger.info('OTLP Dashboard Extension stopped');
  }
}

module.exports = OTLPDashboardExtension;