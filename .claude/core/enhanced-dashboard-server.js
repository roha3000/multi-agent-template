/**
 * Enhanced Dashboard Server
 *
 * Complete dashboard server that:
 * - Serves the enhanced multi-session UI
 * - Integrates OTLP metrics from multiple sessions
 * - Tracks execution plans per session/project
 * - Provides real-time updates via SSE
 * - Supports session-specific and project-specific views
 *
 * @module enhanced-dashboard-server
 */

const express = require('express');
const http = require('http');
const path = require('path');
const { createComponentLogger } = require('./logger');
const { getSessionRegistry } = require('./session-registry');
const { getHierarchyRegistry } = require('./hierarchy-registry');

class EnhancedDashboardServer {
  constructor(components, options = {}) {
    this.logger = createComponentLogger('EnhancedDashboardServer');

    // Components
    this.dashboardManager = components.dashboardManager;
    this.sessionProcessor = components.sessionProcessor;
    this.otlpBridge = components.otlpBridge;
    this.orchestrator = components.orchestrator;
    this.usageTracker = components.usageTracker;

    // Configuration
    this.options = {
      port: options.port || 3030,
      updateInterval: options.updateInterval || 1000,
      ...options
    };

    // State tracking for sessions and projects
    this.sessionPlans = new Map();     // sessionId -> execution plan
    this.projectPlans = new Map();     // projectId -> aggregated plans
    this.sessionProjects = new Map();  // sessionId -> projectId
    this.sseClients = new Set();       // SSE connections

    // Initialize Express app
    this.app = express();
    this.server = null;

    this._setupRoutes();
    this._setupEventListeners();
  }

  /**
   * Setup Express routes
   * @private
   */
  _setupRoutes() {
    // Middleware
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));

    // Serve the enhanced dashboard UI
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'web-dashboard-ui.html'));
    });

    // Main dashboard API endpoint (backward compatible)
    this.app.get('/api/dashboard', (req, res) => {
      res.json(this._getCompleteDashboardData());
    });

    // OTLP-specific endpoints
    this.app.get('/api/otlp/sessions', (req, res) => {
      res.json(this._getSessionsData());
    });

    this.app.get('/api/otlp/projects', (req, res) => {
      res.json(this._getProjectsData());
    });

    this.app.get('/api/otlp/metrics', (req, res) => {
      res.json(this._getGlobalMetrics());
    });

    this.app.get('/api/otlp/alerts', (req, res) => {
      res.json(this._getAlerts());
    });

    this.app.get('/api/otlp/events', (req, res) => {
      res.json(this._getRecentEvents());
    });

    // Session-specific endpoints
    this.app.get('/api/otlp/session/:id', (req, res) => {
      const sessionData = this._getSessionDetails(req.params.id);
      if (sessionData) {
        res.json(sessionData);
      } else {
        res.status(404).json({ error: 'Session not found' });
      }
    });

    this.app.get('/api/otlp/session/:id/plan', (req, res) => {
      const plan = this.sessionPlans.get(req.params.id);
      if (plan) {
        res.json(plan);
      } else {
        res.status(404).json({ error: 'No execution plan for session' });
      }
    });

    // ========================================
    // HIERARCHY API ENDPOINTS
    // ========================================

    // Get session hierarchy tree
    this.app.get('/api/sessions/:id/hierarchy', (req, res) => {
      const sessionId = parseInt(req.params.id, 10);
      const hierarchy = this._getSessionHierarchy(sessionId);
      if (hierarchy) {
        res.json(hierarchy);
      } else {
        res.status(404).json({ error: 'Session not found' });
      }
    });

    // Get session rollup metrics (aggregated from children)
    this.app.get('/api/sessions/:id/rollup', (req, res) => {
      const sessionId = parseInt(req.params.id, 10);
      const rollup = this._getSessionRollup(sessionId);
      if (rollup) {
        res.json(rollup);
      } else {
        res.status(404).json({ error: 'Session not found' });
      }
    });

    // Get session with full hierarchy data
    this.app.get('/api/sessions/:id/full', (req, res) => {
      const sessionId = parseInt(req.params.id, 10);
      const sessionWithHierarchy = this._getSessionWithHierarchy(sessionId);
      if (sessionWithHierarchy) {
        res.json(sessionWithHierarchy);
      } else {
        res.status(404).json({ error: 'Session not found' });
      }
    });

    // Get child sessions
    this.app.get('/api/sessions/:id/children', (req, res) => {
      const sessionId = parseInt(req.params.id, 10);
      const children = this._getChildSessions(sessionId);
      res.json(children);
    });

    // Get active delegations for a session
    this.app.get('/api/sessions/:id/delegations', (req, res) => {
      const sessionId = parseInt(req.params.id, 10);
      const delegations = this._getSessionDelegations(sessionId);
      if (delegations !== null) {
        res.json(delegations);
      } else {
        res.status(404).json({ error: 'Session not found' });
      }
    });

    // Get all root sessions with rollup
    this.app.get('/api/sessions/roots', (req, res) => {
      const rootSessions = this._getRootSessions();
      res.json(rootSessions);
    });

    // Get summary with hierarchy metrics
    this.app.get('/api/sessions/summary/hierarchy', (req, res) => {
      const summary = this._getSummaryWithHierarchy();
      res.json(summary);
    });

    // Get all agents for a session (including sub-agents)
    this.app.get('/api/sessions/:id/agents', (req, res) => {
      const sessionId = parseInt(req.params.id, 10);
      const agents = this._getSessionAgents(sessionId);
      if (agents !== null) {
        res.json(agents);
      } else {
        res.status(404).json({ error: 'Session not found' });
      }
    });

    // Get agent hierarchy tree
    this.app.get('/api/hierarchy/:agentId', (req, res) => {
      const hierarchy = this._getAgentHierarchy(req.params.agentId);
      if (hierarchy) {
        res.json(hierarchy);
      } else {
        res.status(404).json({ error: 'Agent not found in hierarchy' });
      }
    });

    // Get all active delegations
    this.app.get('/api/delegations/active', (req, res) => {
      const delegations = this._getActiveDelegations();
      res.json(delegations);
    });

    // Get delegation chain for a specific delegation
    this.app.get('/api/delegations/:delegationId/chain', (req, res) => {
      const chain = this._getDelegationChain(req.params.delegationId);
      if (chain !== null) {
        res.json(chain);
      } else {
        res.status(404).json({ error: 'Delegation not found' });
      }
    });

    // Get aggregate hierarchy metrics
    this.app.get('/api/metrics/hierarchy', (req, res) => {
      const metrics = this._getHierarchyMetrics();
      res.json(metrics);
    });

    // ====================================================================
    // SHADOW MODE ENDPOINTS (Phase 3)
    // ====================================================================

    // Get shadow mode status and metrics
    this.app.get('/api/shadow-mode', (req, res) => {
      const status = this._getShadowModeStatus();
      res.json(status);
    });

    // Get shadow mode metrics only
    this.app.get('/api/shadow-mode/metrics', (req, res) => {
      const metrics = this._getShadowModeMetrics();
      res.json(metrics);
    });

    // Get shadow mode health assessment
    this.app.get('/api/shadow-mode/health', (req, res) => {
      const health = this._getShadowModeHealth();
      res.json(health);
    });

    // Get divergence history
    this.app.get('/api/shadow-mode/divergences', (req, res) => {
      const unresolvedOnly = req.query.unresolved === 'true';
      const limit = parseInt(req.query.limit) || 50;
      const divergences = this._getShadowDivergences({ unresolvedOnly, limit });
      res.json(divergences);
    });

    // Toggle shadow mode
    this.app.post('/api/shadow-mode/toggle', (req, res) => {
      const { enabled } = req.body;
      const result = this._toggleShadowMode(enabled);
      res.json(result);
    });

    // Resolve a divergence
    this.app.post('/api/shadow-mode/divergences/:id/resolve', (req, res) => {
      const { resolution } = req.body;
      const result = this._resolveDivergence(req.params.id, resolution);
      if (result) {
        res.json({ success: true, divergence: result });
      } else {
        res.status(404).json({ error: 'Divergence not found' });
      }
    });

    // Force shadow sync
    this.app.post('/api/shadow-mode/sync', (req, res) => {
      const result = this._forceShadowSync();
      res.json(result);
    });

    // ====================================================================
    // CONFLICT MANAGEMENT ENDPOINTS (Phase 4)
    // ====================================================================

    // Get all conflicts with optional filters
    this.app.get('/api/conflicts', (req, res) => {
      const options = {
        status: req.query.status || null,
        resource: req.query.resource || null,
        limit: parseInt(req.query.limit) || 50,
        offset: parseInt(req.query.offset) || 0,
        includeResolved: req.query.includeResolved === 'true'
      };
      const result = this._getConflicts(options);
      res.json(result);
    });

    // Get specific conflict by ID
    this.app.get('/api/conflicts/:id', (req, res) => {
      const conflict = this._getConflict(req.params.id);
      if (conflict) {
        res.json(conflict);
      } else {
        res.status(404).json({ error: 'CONFLICT_NOT_FOUND' });
      }
    });

    // Resolve a conflict
    this.app.post('/api/conflicts/:id/resolve', (req, res) => {
      const { resolution, resolutionData, notes } = req.body;

      if (!resolution || !['version_a', 'version_b', 'merged', 'manual', 'discarded'].includes(resolution)) {
        return res.status(400).json({ error: 'INVALID_RESOLUTION', validOptions: ['version_a', 'version_b', 'merged', 'manual', 'discarded'] });
      }

      if (resolution === 'merged' && !resolutionData) {
        return res.status(400).json({ error: 'MERGE_DATA_REQUIRED' });
      }

      const result = this._resolveConflict(req.params.id, resolution, { resolutionData, notes });

      if (result.success) {
        res.json(result);
      } else if (result.error === 'CONFLICT_NOT_FOUND') {
        res.status(404).json(result);
      } else if (result.error === 'ALREADY_RESOLVED') {
        res.status(400).json(result);
      } else {
        res.status(500).json(result);
      }
    });

    // Get conflict counts for dashboard badge
    this.app.get('/api/conflicts/counts', (req, res) => {
      const counts = this._getConflictCounts();
      res.json(counts);
    });

    // ====================================================================
    // CHANGE JOURNAL ENDPOINTS (Phase 4)
    // ====================================================================

    // Get change journal with filters
    this.app.get('/api/change-journal', (req, res) => {
      const options = {
        sessionId: req.query.session || null,
        resource: req.query.resource || null,
        operation: req.query.operation || null,
        limit: parseInt(req.query.limit) || 50,
        since: req.query.since ? parseInt(req.query.since) : null
      };
      const result = this._getChangeJournal(options);
      res.json(result);
    });

    // Get changes for a specific session
    this.app.get('/api/change-journal/session/:sessionId', (req, res) => {
      const limit = parseInt(req.query.limit) || 100;
      const changes = this._getChangesBySession(req.params.sessionId, limit);
      res.json(changes);
    });

    // Project-specific endpoints
    this.app.get('/api/otlp/project/:id', (req, res) => {
      const projectData = this._getProjectDetails(req.params.id);
      if (projectData) {
        res.json(projectData);
      } else {
        res.status(404).json({ error: 'Project not found' });
      }
    });

    this.app.get('/api/otlp/project/:id/plans', (req, res) => {
      const plans = this._getProjectPlans(req.params.id);
      res.json(plans);
    });

    // Server-Sent Events for real-time updates
    this.app.get('/api/events', (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no' // Disable Nginx buffering
      });

      // Send initial data
      res.write(`data: ${JSON.stringify({
        type: 'connected',
        timestamp: Date.now()
      })}\n\n`);

      // Add client to SSE list
      this.sseClients.add(res);

      // Remove on disconnect
      req.on('close', () => {
        this.sseClients.delete(res);
      });
    });

    // Update execution plan endpoint
    this.app.post('/api/otlp/session/:id/plan', (req, res) => {
      const { tasks, currentIndex } = req.body;
      this._updateSessionPlan(req.params.id, tasks, currentIndex);
      res.json({ success: true });
    });

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        uptime: process.uptime(),
        sessions: this.sessionPlans.size,
        projects: this.projectPlans.size,
        sseClients: this.sseClients.size
      });
    });
  }

  /**
   * Setup event listeners
   * @private
   */
  _setupEventListeners() {
    // Listen to session processor events
    if (this.sessionProcessor) {
      this.sessionProcessor.on('metrics:processed', (data) => {
        this._handleMetricsUpdate(data);
      });

      this.sessionProcessor.on('session:created', (data) => {
        this._handleSessionCreated(data);
      });

      this.sessionProcessor.on('session:removed', (data) => {
        this._handleSessionRemoved(data);
      });
    }

    // Listen to dashboard manager events
    if (this.dashboardManager) {
      this.dashboardManager.on('plan:updated', (plan) => {
        // This might be a global plan, associate with active session
        this._handlePlanUpdate(plan);
      });
    }

    // Listen to orchestrator events
    if (this.orchestrator) {
      this.orchestrator.on('checkpoint:created', (data) => {
        this._broadcastEvent('checkpoint', data);
      });
    }

    // Listen to OTLP bridge events
    if (this.otlpBridge) {
      this.otlpBridge.on('emergency:compaction', (data) => {
        this._broadcastEvent('alert', {
          severity: 'critical',
          message: 'Emergency compaction prevention triggered',
          data
        });
      });
    }

    // Listen to hierarchy registry events for SSE updates
    try {
      const hierarchyRegistry = getHierarchyRegistry();
      hierarchyRegistry.on('hierarchy:registered', (data) => {
        this._broadcastHierarchyUpdate(data.childId, 'registered', data);
      });
      hierarchyRegistry.on('hierarchy:pruned', (data) => {
        this._broadcastHierarchyUpdate(data.rootId, 'pruned', data);
      });
      hierarchyRegistry.on('delegation:registered', (data) => {
        this._broadcastHierarchyUpdate(null, 'delegation:registered', data);
      });
      hierarchyRegistry.on('delegation:updated', (data) => {
        this._broadcastHierarchyUpdate(null, 'delegation:updated', data);
      });
      hierarchyRegistry.on('node:statusChanged', (data) => {
        this._broadcastHierarchyUpdate(data.agentId, 'status:changed', data);
      });
    } catch (error) {
      this.logger.debug('Could not setup hierarchy event listeners', { error: error.message });
    }
  }

  /**
   * Start the server
   */
  async start() {
    return new Promise((resolve) => {
      this.server = http.createServer(this.app);

      this.server.listen(this.options.port, () => {
        this.logger.info(`Enhanced dashboard server started on port ${this.options.port}`);

        // Start update timer
        this.updateTimer = setInterval(() => {
          this._broadcastUpdate();
        }, this.options.updateInterval);

        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  async stop() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }

    // Close all SSE connections
    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients.clear();

    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this.logger.info('Enhanced dashboard server stopped');
          resolve();
        });
      });
    }
  }

  /**
   * Get complete dashboard data
   * @private
   */
  _getCompleteDashboardData() {
    const baseData = this.dashboardManager ? this.dashboardManager.getState() : {};

    // Enhance with OTLP data
    const sessions = this._getSessionsDisplay();
    const projects = this._getProjectsDisplay();
    const globalMetrics = this._getGlobalMetrics();

    return {
      ...baseData,
      otlpSessions: sessions,
      otlpProjects: projects,
      otlpGlobalMetrics: globalMetrics,
      otlpAlerts: this._getAlerts(),
      otlpEvents: this._getRecentEvents()
    };
  }

  /**
   * Get sessions display data
   * @private
   */
  _getSessionsDisplay() {
    if (!this.sessionProcessor) {
      return [];
    }

    const activeSessions = this.sessionProcessor.getActiveSessions();

    // Enhance with execution plans
    return activeSessions.map(session => {
      const plan = this.sessionPlans.get(session.id);
      const projectId = this.sessionProjects.get(session.id) || session.projectId;

      return {
        ...session,
        projectId,
        executionPlan: plan,
        contextUtilization: ((session.contextUtilization || 0) * 100).toFixed(1) + '%',
        status: this._getSessionStatus(session)
      };
    });
  }

  /**
   * Get projects display data
   * @private
   */
  _getProjectsDisplay() {
    const projects = [];
    const projectMap = new Map();

    // Aggregate sessions by project
    if (this.sessionProcessor) {
      const activeSessions = this.sessionProcessor.getActiveSessions();

      for (const session of activeSessions) {
        const projectId = session.projectId || 'default';

        if (!projectMap.has(projectId)) {
          projectMap.set(projectId, {
            id: projectId,
            sessions: [],
            totalTokens: 0,
            totalOperations: 0,
            activeSessions: 0
          });
        }

        const project = projectMap.get(projectId);
        project.sessions.push(session.id);
        project.totalTokens += session.metrics?.totalTokens || 0;
        project.totalOperations += session.metrics?.operations || 0;
        project.activeSessions++;
      }
    }

    // Include project plans
    for (const [projectId, project] of projectMap) {
      const plans = this._getProjectPlans(projectId);
      projects.push({
        ...project,
        plansCount: plans.length,
        activePlans: plans.filter(p => p.status === 'in_progress').length
      });
    }

    return projects;
  }

  /**
   * Get sessions data
   * @private
   */
  _getSessionsData() {
    const sessions = this._getSessionsDisplay();

    return {
      sessions,
      total: sessions.length,
      active: sessions.filter(s => s.status === 'active' || s.status === 'ok').length
    };
  }

  /**
   * Get projects data
   * @private
   */
  _getProjectsData() {
    const projects = this._getProjectsDisplay();

    return {
      projects,
      total: projects.length
    };
  }

  /**
   * Get global metrics
   * @private
   */
  _getGlobalMetrics() {
    const metrics = {
      totalSessions: 0,
      activeSessions: 0,
      totalTokens: 0,
      totalOperations: 0,
      checkpointsCreated: 0,
      compactionsSaved: 0
    };

    // Get from session processor
    if (this.sessionProcessor) {
      const globalMetrics = this.sessionProcessor.getGlobalMetrics();
      Object.assign(metrics, globalMetrics);
    }

    // Get from OTLP bridge
    if (this.otlpBridge) {
      const bridgeStatus = this.otlpBridge.getStatus();
      metrics.compactionsSaved = bridgeStatus.compactionSaves || 0;
    }

    // Get from orchestrator
    if (this.orchestrator && this.orchestrator.state) {
      metrics.checkpointsCreated = this.orchestrator.state.checkpointCount || 0;
    }

    return metrics;
  }

  /**
   * Get alerts
   * @private
   */
  _getAlerts() {
    // Would integrate with alert system
    return this.alerts || [];
  }

  /**
   * Get recent events
   * @private
   */
  _getRecentEvents() {
    // Would integrate with event system
    return this.events || [];
  }

  /**
   * Get session details
   * @private
   */
  _getSessionDetails(sessionId) {
    if (!this.sessionProcessor) {
      return null;
    }

    const sessionMetrics = this.sessionProcessor.getSessionMetrics(sessionId);
    if (!sessionMetrics) {
      return null;
    }

    const plan = this.sessionPlans.get(sessionId);

    return {
      ...sessionMetrics,
      executionPlan: plan
    };
  }

  /**
   * Get project details
   * @private
   */
  _getProjectDetails(projectId) {
    if (!this.sessionProcessor) {
      return null;
    }

    const projectMetrics = this.sessionProcessor.getProjectMetrics(projectId);
    if (!projectMetrics) {
      return null;
    }

    const plans = this._getProjectPlans(projectId);

    return {
      ...projectMetrics,
      executionPlans: plans
    };
  }

  /**
   * Get project plans
   * @private
   */
  _getProjectPlans(projectId) {
    const plans = [];

    // Find all sessions for this project
    for (const [sessionId, sessionProjectId] of this.sessionProjects) {
      if (sessionProjectId === projectId) {
        const plan = this.sessionPlans.get(sessionId);
        if (plan) {
          plans.push({
            sessionId,
            ...plan
          });
        }
      }
    }

    // Include aggregated project plan if exists
    const projectPlan = this.projectPlans.get(projectId);
    if (projectPlan) {
      plans.push({
        projectId,
        aggregated: true,
        ...projectPlan
      });
    }

    return plans;
  }

  /**
   * Get session status
   * @private
   */
  _getSessionStatus(session) {
    const utilization = session.contextUtilization || 0;

    if (utilization >= 0.95) return 'emergency';
    if (utilization >= 0.85) return 'critical';
    if (utilization >= 0.75) return 'warning';
    return 'ok';
  }

  /**
   * Handle metrics update
   * @private
   */
  _handleMetricsUpdate(data) {
    const { sessionId, projectId } = data;

    // Track session-project relationship
    if (sessionId && projectId) {
      this.sessionProjects.set(sessionId, projectId);
    }

    // Broadcast update
    this._broadcastUpdate();
  }

  /**
   * Handle session created
   * @private
   */
  _handleSessionCreated(data) {
    const { sessionId, projectId } = data;

    // Initialize session plan
    this.sessionPlans.set(sessionId, {
      tasks: [],
      currentTaskIndex: -1,
      totalTasks: 0,
      completedTasks: 0,
      status: 'pending'
    });

    // Track session-project relationship
    if (projectId) {
      this.sessionProjects.set(sessionId, projectId);
    }

    this._broadcastEvent('session:created', data);
  }

  /**
   * Handle session removed
   * @private
   */
  _handleSessionRemoved(data) {
    const { sessionId } = data;

    // Clean up session data
    this.sessionPlans.delete(sessionId);
    this.sessionProjects.delete(sessionId);

    this._broadcastEvent('session:removed', data);
  }

  /**
   * Handle plan update
   * @private
   */
  _handlePlanUpdate(plan) {
    // Try to associate with current active session
    // In production, this would be more sophisticated
    if (this.sessionProcessor) {
      const activeSessions = this.sessionProcessor.getActiveSessions();
      if (activeSessions.length > 0) {
        // Update the most recent session's plan
        const session = activeSessions[0];
        this._updateSessionPlan(session.id, plan.tasks, plan.currentTaskIndex);
      }
    }
  }

  /**
   * Update session plan
   * @private
   */
  _updateSessionPlan(sessionId, tasks, currentIndex = 0) {
    const plan = {
      tasks: tasks.map((task, index) => ({
        id: task.id || `task-${index}`,
        content: task.content || task.name || task,
        status: task.status || (index < currentIndex ? 'completed' : index === currentIndex ? 'in_progress' : 'pending'),
        activeForm: task.activeForm,
        progress: task.progress || (task.status === 'completed' ? 100 : task.status === 'in_progress' ? 50 : 0)
      })),
      currentTaskIndex: currentIndex,
      totalTasks: tasks.length,
      completedTasks: tasks.filter(t => t.status === 'completed').length,
      status: currentIndex >= 0 ? 'in_progress' : 'pending'
    };

    this.sessionPlans.set(sessionId, plan);

    // Update project plan
    const projectId = this.sessionProjects.get(sessionId);
    if (projectId) {
      this._updateProjectPlan(projectId);
    }

    this._broadcastEvent('plan:updated', { sessionId, plan });
  }

  /**
   * Update project plan (aggregate from sessions)
   * @private
   */
  _updateProjectPlan(projectId) {
    const allTasks = [];
    let totalCompleted = 0;
    let totalTasks = 0;

    // Aggregate tasks from all project sessions
    for (const [sessionId, sessionProjectId] of this.sessionProjects) {
      if (sessionProjectId === projectId) {
        const plan = this.sessionPlans.get(sessionId);
        if (plan) {
          allTasks.push(...plan.tasks.map(t => ({
            ...t,
            sessionId
          })));
          totalCompleted += plan.completedTasks;
          totalTasks += plan.totalTasks;
        }
      }
    }

    if (allTasks.length > 0) {
      this.projectPlans.set(projectId, {
        tasks: allTasks,
        totalTasks,
        completedTasks: totalCompleted,
        status: totalCompleted === totalTasks ? 'completed' : 'in_progress'
      });
    }
  }

  /**
   * Broadcast update to SSE clients
   * @private
   */
  _broadcastUpdate() {
    if (this.sseClients.size === 0) return;

    const data = {
      type: 'dashboard:update',
      timestamp: Date.now(),
      sessions: this._getSessionsDisplay(),
      projects: this._getProjectsDisplay(),
      metrics: this._getGlobalMetrics()
    };

    const message = `data: ${JSON.stringify(data)}\n\n`;

    for (const client of this.sseClients) {
      try {
        client.write(message);
      } catch (err) {
        // Client disconnected
        this.sseClients.delete(client);
      }
    }
  }

  /**
   * Broadcast event to SSE clients
   * @private
   */
  _broadcastEvent(type, data) {
    if (this.sseClients.size === 0) return;

    const event = {
      type,
      timestamp: Date.now(),
      data
    };

    const message = `data: ${JSON.stringify(event)}\n\n`;

    for (const client of this.sseClients) {
      try {
        client.write(message);
      } catch (err) {
        this.sseClients.delete(client);
      }
    }
  }

  // ============================================
  // HIERARCHY HELPER METHODS
  // ============================================

  /**
   * Get session hierarchy tree
   * @private
   */
  _getSessionHierarchy(sessionId) {
    try {
      const registry = getSessionRegistry();
      return registry.getHierarchy(sessionId);
    } catch (error) {
      this.logger.debug('Could not get session hierarchy', { sessionId, error: error.message });
      return null;
    }
  }

  /**
   * Get session rollup metrics
   * @private
   */
  _getSessionRollup(sessionId) {
    try {
      const registry = getSessionRegistry();
      return registry.getRollupMetrics(sessionId);
    } catch (error) {
      this.logger.debug('Could not get session rollup', { sessionId, error: error.message });
      return null;
    }
  }

  /**
   * Get session with full hierarchy data
   * @private
   */
  _getSessionWithHierarchy(sessionId) {
    try {
      const registry = getSessionRegistry();
      return registry.getSessionWithHierarchy(sessionId);
    } catch (error) {
      this.logger.debug('Could not get session with hierarchy', { sessionId, error: error.message });
      return null;
    }
  }

  /**
   * Get child sessions
   * @private
   */
  _getChildSessions(sessionId) {
    try {
      const registry = getSessionRegistry();
      return registry.getChildSessions(sessionId);
    } catch (error) {
      this.logger.debug('Could not get child sessions', { sessionId, error: error.message });
      return [];
    }
  }

  /**
   * Get session delegations
   * @private
   */
  _getSessionDelegations(sessionId) {
    try {
      const registry = getSessionRegistry();
      const session = registry.get(sessionId);
      if (!session) return null;
      return session.activeDelegations || [];
    } catch (error) {
      this.logger.debug('Could not get session delegations', { sessionId, error: error.message });
      return null;
    }
  }

  /**
   * Get root sessions with rollup metrics
   * @private
   */
  _getRootSessions() {
    try {
      const registry = getSessionRegistry();
      const rootSessions = registry.getRootSessions();

      return rootSessions.map(session => ({
        id: session.id,
        project: session.project,
        status: session.status,
        childCount: session.hierarchyInfo.childSessionIds.length,
        activeDelegationCount: session.activeDelegations.length,
        rollupMetrics: registry.getRollupMetrics(session.id)
      }));
    } catch (error) {
      this.logger.debug('Could not get root sessions', { error: error.message });
      return [];
    }
  }

  /**
   * Get summary with hierarchy metrics
   * @private
   */
  _getSummaryWithHierarchy() {
    try {
      const registry = getSessionRegistry();
      return registry.getSummaryWithHierarchy();
    } catch (error) {
      this.logger.debug('Could not get summary with hierarchy', { error: error.message });
      return { hierarchyMetrics: {}, rootSessions: [] };
    }
  }

  /**
   * Get all agents for a session (including sub-agents in hierarchy)
   * @private
   */
  _getSessionAgents(sessionId) {
    try {
      const sessionRegistry = getSessionRegistry();
      const session = sessionRegistry.get(sessionId);
      if (!session) return null;

      const hierarchyRegistry = getHierarchyRegistry();
      const agents = [];

      // Get agents from session's activeDelegations
      if (session.activeDelegations) {
        for (const delegation of session.activeDelegations) {
          if (delegation.targetAgentId) {
            const node = hierarchyRegistry.getNode(delegation.targetAgentId);
            if (node) {
              agents.push({
                agentId: node.agentId,
                parentId: node.parentId,
                depth: node.depth,
                status: node.status,
                delegationId: delegation.delegationId,
                taskId: delegation.taskId
              });
              // Also get descendants
              const descendants = hierarchyRegistry.getDescendants(delegation.targetAgentId);
              for (const descId of descendants) {
                const descNode = hierarchyRegistry.getNode(descId);
                if (descNode) {
                  agents.push({
                    agentId: descNode.agentId,
                    parentId: descNode.parentId,
                    depth: descNode.depth,
                    status: descNode.status
                  });
                }
              }
            }
          }
        }
      }

      return agents;
    } catch (error) {
      this.logger.debug('Could not get session agents', { sessionId, error: error.message });
      return null;
    }
  }

  /**
   * Get agent hierarchy tree
   * @private
   */
  _getAgentHierarchy(agentId) {
    try {
      const hierarchyRegistry = getHierarchyRegistry();
      return hierarchyRegistry.getHierarchy(agentId);
    } catch (error) {
      this.logger.debug('Could not get agent hierarchy', { agentId, error: error.message });
      return null;
    }
  }

  /**
   * Get all active delegations
   * @private
   */
  _getActiveDelegations() {
    try {
      const hierarchyRegistry = getHierarchyRegistry();
      return hierarchyRegistry.getActiveDelegations();
    } catch (error) {
      this.logger.debug('Could not get active delegations', { error: error.message });
      return [];
    }
  }

  /**
   * Get delegation chain for a specific delegation
   * @private
   */
  _getDelegationChain(delegationId) {
    try {
      const hierarchyRegistry = getHierarchyRegistry();
      const delegation = hierarchyRegistry.getDelegation(delegationId);
      if (!delegation) return null;

      return hierarchyRegistry.getDelegationChain(delegation.childAgentId);
    } catch (error) {
      this.logger.debug('Could not get delegation chain', { delegationId, error: error.message });
      return null;
    }
  }

  /**
   * Get aggregate hierarchy metrics
   * @private
   */
  _getHierarchyMetrics() {
    try {
      const hierarchyRegistry = getHierarchyRegistry();
      const stats = hierarchyRegistry.getStats();

      const sessionRegistry = getSessionRegistry();
      let sessionsWithHierarchy = 0;
      let totalDelegationsInProgress = 0;
      let totalDepth = 0;
      let depthCount = 0;

      // Get all sessions and count those with hierarchy
      const sessions = sessionRegistry.getAllSessions ? sessionRegistry.getAllSessions() : [];
      for (const session of sessions) {
        if (session.hierarchyInfo &&
            (session.hierarchyInfo.childSessionIds?.length > 0 || session.hierarchyInfo.parentSessionId)) {
          sessionsWithHierarchy++;
        }
        if (session.activeDelegations?.length > 0) {
          totalDelegationsInProgress += session.activeDelegations.filter(d => d.status === 'active').length;
        }
        if (session.hierarchyInfo?.delegationDepth > 0) {
          totalDepth += session.hierarchyInfo.delegationDepth;
          depthCount++;
        }
      }

      return {
        timestamp: Date.now(),
        registryStats: stats,
        sessionsWithHierarchy,
        delegationsInProgress: totalDelegationsInProgress,
        avgDelegationDepth: depthCount > 0 ? Math.round((totalDepth / depthCount) * 100) / 100 : 0,
        totalNodes: stats.totalNodes || 0,
        rootCount: stats.rootCount || 0,
        maxDepth: stats.maxDepth || 0
      };
    } catch (error) {
      this.logger.debug('Could not get hierarchy metrics', { error: error.message });
      return {
        timestamp: Date.now(),
        registryStats: {},
        sessionsWithHierarchy: 0,
        delegationsInProgress: 0,
        avgDelegationDepth: 0,
        totalNodes: 0,
        rootCount: 0,
        maxDepth: 0
      };
    }
  }

  /**
   * Broadcast hierarchy update to SSE clients
   * @private
   */
  _broadcastHierarchyUpdate(sessionId, eventType, data) {
    this._broadcastEvent(`hierarchy:${eventType}`, {
      sessionId,
      ...data,
      timestamp: Date.now()
    });
  }

  // ====================================================================
  // SHADOW MODE HELPER METHODS (Phase 3)
  // ====================================================================

  /**
   * Get TaskManager instance (lazy load)
   * @private
   */
  _getTaskManager() {
    if (!this._taskManager) {
      try {
        const TaskManager = require('./task-manager');
        const path = require('path');
        const tasksPath = path.join(this.projectPath || process.cwd(), '.claude', 'dev-docs', 'tasks.json');
        this._taskManager = new TaskManager({ tasksPath, shadowMode: true });
      } catch (error) {
        this.logger.debug('Could not initialize TaskManager for shadow mode', { error: error.message });
        return null;
      }
    }
    return this._taskManager;
  }

  /**
   * Get shadow mode status and metrics
   * @private
   */
  _getShadowModeStatus() {
    const tm = this._getTaskManager();
    if (!tm) {
      return {
        available: false,
        enabled: false,
        reason: 'TaskManager not available'
      };
    }

    return {
      available: true,
      enabled: tm.isShadowModeEnabled(),
      metrics: tm.getShadowMetrics(),
      health: tm.getShadowHealth(),
      timestamp: Date.now()
    };
  }

  /**
   * Get shadow mode metrics only
   * @private
   */
  _getShadowModeMetrics() {
    const tm = this._getTaskManager();
    if (!tm) {
      return { available: false };
    }

    const metrics = tm.getShadowMetrics();
    return metrics || { available: true, enabled: false };
  }

  /**
   * Get shadow mode health assessment
   * @private
   */
  _getShadowModeHealth() {
    const tm = this._getTaskManager();
    if (!tm) {
      return { available: false, status: 'unknown' };
    }

    const health = tm.getShadowHealth();
    return health || { available: true, enabled: false, status: 'off' };
  }

  /**
   * Get shadow divergences
   * @private
   */
  _getShadowDivergences(options = {}) {
    const tm = this._getTaskManager();
    if (!tm || !tm._shadowMetrics) {
      return [];
    }

    return tm._shadowMetrics.getDivergences(options);
  }

  /**
   * Toggle shadow mode
   * @private
   */
  _toggleShadowMode(enabled) {
    const tm = this._getTaskManager();
    if (!tm) {
      return { success: false, reason: 'TaskManager not available' };
    }

    tm.enableShadowMode(enabled);

    // Broadcast status change
    this._broadcastEvent('shadow:mode-changed', {
      enabled,
      timestamp: Date.now()
    });

    return {
      success: true,
      enabled: tm.isShadowModeEnabled()
    };
  }

  /**
   * Resolve a divergence
   * @private
   */
  _resolveDivergence(divergenceId, resolution = 'manual') {
    const tm = this._getTaskManager();
    if (!tm || !tm._shadowMetrics) {
      return null;
    }

    const result = tm._shadowMetrics.resolveDivergence(divergenceId, resolution);

    if (result) {
      // Broadcast resolution
      this._broadcastEvent('shadow:divergence-resolved', {
        divergenceId,
        resolution,
        timestamp: Date.now()
      });
    }

    return result;
  }

  /**
   * Force shadow sync
   * @private
   */
  _forceShadowSync() {
    const tm = this._getTaskManager();
    if (!tm) {
      return { synced: false, reason: 'TaskManager not available' };
    }

    const result = tm.forceShadowSync();

    if (result.synced) {
      // Broadcast sync event
      this._broadcastEvent('shadow:synced', {
        hash: result.hash,
        version: result.version,
        timestamp: Date.now()
      });
    }

    return result;
  }

  // ============================================================================
  // CONFLICT MANAGEMENT HELPERS (Phase 4)
  // ============================================================================

  /**
   * Get CoordinationDB instance from TaskManager
   * @private
   */
  _getCoordinationDb() {
    const tm = this._getTaskManager();
    return tm?._coordinationDb || null;
  }

  /**
   * Get conflicts with optional filters
   * @private
   */
  _getConflicts(options = {}) {
    const db = this._getCoordinationDb();
    if (!db) {
      return {
        conflicts: [],
        pagination: { total: 0, limit: options.limit || 50, offset: 0, hasMore: false },
        summary: { pending: 0, resolved: 0, total: 0 },
        available: false
      };
    }

    const result = db.getConflicts(options);
    return { ...result, available: true };
  }

  /**
   * Get a specific conflict by ID
   * @private
   */
  _getConflict(conflictId) {
    const db = this._getCoordinationDb();
    if (!db) return null;

    return db.getConflict(conflictId);
  }

  /**
   * Resolve a conflict
   * @private
   */
  _resolveConflict(conflictId, resolution, options = {}) {
    const db = this._getCoordinationDb();
    if (!db) {
      return { success: false, error: 'DATABASE_UNAVAILABLE' };
    }

    const result = db.resolveConflict(conflictId, resolution, options);

    if (result.success) {
      // Broadcast conflict resolution
      this._broadcastEvent('conflict:resolved', {
        conflictId,
        resolution,
        resolvedBy: result.conflict?.resolvedBy,
        timestamp: Date.now()
      });
    }

    return result;
  }

  /**
   * Get conflict counts for dashboard badge
   * @private
   */
  _getConflictCounts() {
    const db = this._getCoordinationDb();
    if (!db) {
      return { pending: 0, resolved: 0, autoResolved: 0, total: 0, available: false };
    }

    const counts = db.getConflictCounts();
    return { ...counts, available: true };
  }

  /**
   * Get change journal with filters
   * @private
   */
  _getChangeJournal(options = {}) {
    const db = this._getCoordinationDb();
    if (!db) {
      return { entries: [], available: false };
    }

    const { sessionId, resource, limit = 50 } = options;

    let entries;
    if (sessionId) {
      entries = db.getChangesBySession(sessionId);
    } else if (resource) {
      entries = db.getChangesByResource(resource);
    } else {
      entries = db.getRecentChanges(limit);
    }

    // Get unique sessions for filter dropdown
    const sessionsSet = new Set(entries.map(e => e.sessionId));
    const sessions = Array.from(sessionsSet).map(sid => {
      const session = db.getSession(sid);
      return {
        id: sid,
        agentType: session?.agentType || 'unknown',
        active: session ? (Date.now() - session.lastHeartbeat < db.options.staleSessionThreshold) : false
      };
    });

    return {
      entries: entries.slice(0, limit),
      sessions,
      available: true,
      timestamp: Date.now()
    };
  }

  /**
   * Get changes for a specific session
   * @private
   */
  _getChangesBySession(sessionId, limit = 100) {
    const db = this._getCoordinationDb();
    if (!db) {
      return { entries: [], available: false };
    }

    const entries = db.getChangesBySession(sessionId);
    const session = db.getSession(sessionId);

    return {
      sessionId,
      session: session ? {
        agentType: session.agentType,
        projectPath: session.projectPath,
        startedAt: session.startedAt,
        lastHeartbeat: session.lastHeartbeat,
        status: (Date.now() - session.lastHeartbeat < db.options.staleSessionThreshold) ? 'active' : 'stale'
      } : null,
      entries: entries.slice(0, limit),
      available: true
    };
  }

  /**
   * Setup conflict event listeners for SSE broadcasting
   * Call this after CoordinationDB is available
   * @private
   */
  _setupConflictEventListeners() {
    const db = this._getCoordinationDb();
    if (!db) return;

    // Listen for conflict events and broadcast via SSE
    db.on('conflict:detected', (conflict) => {
      this._broadcastEvent('conflict:detected', {
        ...conflict,
        timestamp: Date.now()
      });
    });

    db.on('conflict:resolved', (conflict) => {
      this._broadcastEvent('conflict:resolved', {
        conflictId: conflict.id,
        resolution: conflict.resolution,
        resolvedBy: conflict.resolvedBy,
        timestamp: Date.now()
      });
    });

    db.on('change:recorded', (change) => {
      this._broadcastEvent('journal:entry', {
        entryId: change.id,
        sessionId: change.sessionId,
        operation: change.operation,
        resource: change.resource,
        timestamp: Date.now()
      });
    });
  }
}

module.exports = EnhancedDashboardServer;