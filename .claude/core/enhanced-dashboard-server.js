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

    // Get conflict counts for dashboard badge (MUST be before :id route)
    this.app.get('/api/conflicts/counts', (req, res) => {
      const counts = this._getConflictCounts();
      res.json(counts);
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

    // ====================================================================
    // TASK CLAIMS ENDPOINTS (Session-Task Claiming Phase 3)
    // ====================================================================

    // Claim a task for a session
    this.app.post('/api/tasks/:taskId/claim', (req, res) => {
      const { taskId } = req.params;
      const { sessionId, ttlMs, metadata } = req.body;

      if (!sessionId) {
        return res.status(400).json({ error: 'SESSION_ID_REQUIRED' });
      }

      const result = this._claimTask(taskId, sessionId, { ttlMs, metadata });

      if (result.success) {
        res.json(result);
      } else if (result.error === 'TASK_ALREADY_CLAIMED') {
        res.status(409).json(result);
      } else if (result.error === 'TASK_NOT_FOUND') {
        res.status(404).json(result);
      } else {
        res.status(500).json(result);
      }
    });

    // Release a task claim
    this.app.post('/api/tasks/:taskId/release', (req, res) => {
      const { taskId } = req.params;
      const { sessionId, reason } = req.body;

      if (!sessionId) {
        return res.status(400).json({ error: 'SESSION_ID_REQUIRED' });
      }

      const result = this._releaseTaskClaim(taskId, sessionId, reason);

      if (result.success) {
        res.json(result);
      } else if (result.error === 'CLAIM_NOT_FOUND') {
        res.status(404).json(result);
      } else if (result.error === 'NOT_CLAIM_OWNER') {
        res.status(403).json(result);
      } else {
        res.status(500).json(result);
      }
    });

    // Refresh/extend claim TTL (heartbeat)
    this.app.post('/api/tasks/:taskId/claim/heartbeat', (req, res) => {
      const { taskId } = req.params;
      const { sessionId, ttlMs } = req.body;

      if (!sessionId) {
        return res.status(400).json({ error: 'SESSION_ID_REQUIRED' });
      }

      const result = this._refreshTaskClaim(taskId, sessionId, ttlMs);

      if (result.success) {
        res.json(result);
      } else if (result.error === 'CLAIM_NOT_FOUND') {
        res.status(404).json(result);
      } else if (result.error === 'NOT_CLAIM_OWNER') {
        res.status(403).json(result);
      } else {
        res.status(500).json(result);
      }
    });

    // Get all in-flight (claimed) tasks
    this.app.get('/api/tasks/in-flight', (req, res) => {
      const options = {
        sessionId: req.query.session || null,
        includeExpired: req.query.includeExpired === 'true',
        limit: parseInt(req.query.limit) || 100
      };
      const result = this._getInFlightTasks(options);
      res.json(result);
    });

    // Get current task for a session
    this.app.get('/api/sessions/:sessionId/current-task', (req, res) => {
      const { sessionId } = req.params;
      const result = this._getSessionCurrentTask(sessionId);

      if (result.error === 'SESSION_NOT_FOUND') {
        return res.status(404).json(result);
      }
      res.json(result);
    });

    // Trigger cleanup of orphaned/expired claims
    this.app.post('/api/tasks/claims/cleanup', (req, res) => {
      const { force } = req.body;
      const result = this._cleanupOrphanedClaims(force);
      res.json(result);
    });

    // Get claim statistics
    this.app.get('/api/tasks/claims/stats', (req, res) => {
      const stats = this._getClaimStats();
      res.json(stats);
    });

    // ====================================================================
    // DELEGATION HINTS ENDPOINTS (Phase 3 - Auto-Delegation)
    // ====================================================================

    // Get delegation hint for a specific task
    this.app.get('/api/delegation-hints/:taskId', (req, res) => {
      const { taskId } = req.params;
      const agentId = req.query.agent || null;
      const result = this._getDelegationHint(taskId, agentId);
      if (result.error === 'TASK_NOT_FOUND') {
        return res.status(404).json(result);
      }
      res.json(result);
    });

    // Get delegation hints for multiple tasks (batch)
    this.app.get('/api/delegation-hints/batch', (req, res) => {
      const taskIds = req.query.taskIds ? req.query.taskIds.split(',') : [];
      const agentId = req.query.agent || null;
      if (taskIds.length === 0) {
        return res.status(400).json({ error: 'TASK_IDS_REQUIRED' });
      }
      const results = this._getDelegationHintsBatch(taskIds, agentId);
      res.json(results);
    });

    // Get delegation recommendations for an agent
    this.app.get('/api/delegation-hints/agent/:agentId', (req, res) => {
      const { agentId } = req.params;
      const limit = parseInt(req.query.limit) || 10;
      const results = this._getAgentDelegationHints(agentId, limit);
      res.json(results);
    });

    // Accept delegation hint (trigger delegation)
    this.app.post('/api/delegation-hints/:taskId/accept', (req, res) => {
      const { taskId } = req.params;
      const { agentId, pattern } = req.body;
      const result = this._acceptDelegationHint(taskId, agentId, pattern);
      if (result.error) {
        return res.status(400).json(result);
      }
      res.json(result);
    });

    // Dismiss delegation hint
    this.app.post('/api/delegation-hints/:taskId/dismiss', (req, res) => {
      const { taskId } = req.params;
      const { reason } = req.body;
      const result = this._dismissDelegationHint(taskId, reason);
      res.json(result);
    });

    // Get delegation metrics
    this.app.get('/api/delegation-hints/metrics', (req, res) => {
      const metrics = this._getDelegationMetrics();
      res.json(metrics);
    });

    // ========================================================================
    // DELEGATION METRICS ENDPOINTS
    // ========================================================================

    // Get complete delegation metrics summary
    this.app.get('/api/metrics/delegation/summary', (req, res) => {
      const metricsData = this._getDelegationMetricsSummary();
      res.json(metricsData);
    });

    // Get pattern distribution
    this.app.get('/api/metrics/delegation/patterns', (req, res) => {
      const patterns = this._getDelegationPatterns();
      res.json(patterns);
    });

    // Get quality metrics
    this.app.get('/api/metrics/delegation/quality', (req, res) => {
      const quality = this._getDelegationQuality();
      res.json(quality);
    });

    // Get resource utilization
    this.app.get('/api/metrics/delegation/resources', (req, res) => {
      const resources = this._getDelegationResources();
      res.json(resources);
    });

    // Get rolling window statistics
    this.app.get('/api/metrics/delegation/rolling/:windowName', (req, res) => {
      const windowName = req.params.windowName;
      const stats = this._getDelegationRollingStats(windowName);
      if (stats) {
        res.json(stats);
      } else {
        res.status(404).json({ error: `Rolling window '${windowName}' not found` });
      }
    });

    // Get metrics trends
    this.app.get('/api/metrics/delegation/trends', (req, res) => {
      const metric = req.query.metric || 'counters.success';
      const windowMs = parseInt(req.query.window) || 300000; // 5 min default
      const trends = this._getDelegationTrends(metric, windowMs);
      res.json(trends);
    });

    // Get historical snapshots
    this.app.get('/api/metrics/delegation/snapshots', (req, res) => {
      const options = {
        since: req.query.since ? parseInt(req.query.since) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit) : undefined
      };
      const snapshots = this._getDelegationSnapshots(options);
      res.json(snapshots);
    });

    // Trigger a metrics snapshot
    this.app.post('/api/metrics/delegation/snapshot', (req, res) => {
      const snapshot = this._triggerDelegationSnapshot();
      res.json(snapshot);
    });

    // Reset delegation metrics
    this.app.post('/api/metrics/delegation/reset', (req, res) => {
      this._resetDelegationMetrics();
      res.json({ success: true, timestamp: Date.now() });
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

    // Setup conflict and change journal event listeners
    this._setupConflictEventListeners();

    // Setup task claim event listeners for SSE
    this._setupClaimEventListeners();
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
      const sessions = sessionRegistry.getAll ? sessionRegistry.getAll() : [];
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

  // ============================================================================
  // TASK CLAIMS HELPER METHODS (Session-Task Claiming Phase 3)
  // ============================================================================

  /**
   * Claim a task for a session
   * @private
   */
  _claimTask(taskId, sessionId, options = {}) {
    const db = this._getCoordinationDb();
    if (!db) {
      return { success: false, error: 'DATABASE_UNAVAILABLE' };
    }

    try {
      const result = db.claimTask(taskId, sessionId, options);

      // Transform claimed -> success for API consistency
      if (result.claimed) {
        // Broadcast claim event via SSE
        this._broadcastEvent('task:claimed', {
          taskId,
          sessionId,
          claimedAt: result.claim?.claimedAt,
          expiresAt: result.claim?.expiresAt,
          timestamp: Date.now()
        });
        return { success: true, claim: result.claim };
      }

      return { success: false, error: result.error, existingClaim: result.existingClaim };
    } catch (error) {
      this.logger.error('Failed to claim task', { taskId, sessionId, error: error.message });
      return { success: false, error: 'CLAIM_FAILED', message: error.message };
    }
  }

  /**
   * Release a task claim
   * @private
   */
  _releaseTaskClaim(taskId, sessionId, reason = 'manual') {
    const db = this._getCoordinationDb();
    if (!db) {
      return { success: false, error: 'DATABASE_UNAVAILABLE' };
    }

    try {
      const result = db.releaseClaim(taskId, sessionId, reason);

      // Transform released -> success for API consistency
      if (result.released) {
        // Broadcast release event via SSE
        this._broadcastEvent('task:released', {
          taskId,
          sessionId,
          reason,
          releasedAt: Date.now(),
          timestamp: Date.now()
        });
        return { success: true, releasedAt: Date.now() };
      }

      return { success: false, error: result.error, actualOwner: result.actualOwner };
    } catch (error) {
      this.logger.error('Failed to release task claim', { taskId, sessionId, error: error.message });
      return { success: false, error: 'RELEASE_FAILED', message: error.message };
    }
  }

  /**
   * Refresh/extend a task claim TTL (heartbeat)
   * @private
   */
  _refreshTaskClaim(taskId, sessionId, ttlMs = null) {
    const db = this._getCoordinationDb();
    if (!db) {
      return { success: false, error: 'DATABASE_UNAVAILABLE' };
    }

    try {
      const result = db.refreshClaim(taskId, sessionId, ttlMs);

      if (result.success) {
        // Broadcast heartbeat event (optional, may be too noisy for SSE)
        // Only broadcast if explicitly requested or for debugging
        if (this.options.broadcastHeartbeats) {
          this._broadcastEvent('task:claim-heartbeat', {
            taskId,
            sessionId,
            newExpiresAt: result.expiresAt,
            refreshCount: result.heartbeatCount,
            timestamp: Date.now()
          });
        }
        return {
          success: true,
          claim: {
            taskId,
            sessionId,
            expiresAt: result.expiresAt,
            refreshCount: result.heartbeatCount,
            remainingMs: result.remainingMs
          }
        };
      }

      return { success: false, error: result.error, actualOwner: result.actualOwner };
    } catch (error) {
      this.logger.error('Failed to refresh task claim', { taskId, sessionId, error: error.message });
      return { success: false, error: 'REFRESH_FAILED', message: error.message };
    }
  }

  /**
   * Get all in-flight (claimed) tasks
   * @private
   */
  _getInFlightTasks(options = {}) {
    const db = this._getCoordinationDb();
    if (!db) {
      return { claims: [], available: false };
    }

    try {
      const claims = db.getActiveClaims(options);

      // Enrich claims with task info if TaskManager available
      const tm = this._getTaskManager();
      const enrichedClaims = claims.map(claim => {
        const task = tm ? tm.getTask(claim.taskId) : null;
        return {
          ...claim,
          task: task ? {
            id: task.id,
            title: task.title,
            status: task.status,
            phase: task.phase,
            priority: task.priority
          } : null
        };
      });

      return {
        claims: enrichedClaims,
        count: enrichedClaims.length,
        available: true,
        timestamp: Date.now()
      };
    } catch (error) {
      this.logger.error('Failed to get in-flight tasks', { error: error.message });
      return { claims: [], available: true, error: error.message };
    }
  }

  /**
   * Get the current task claimed by a session
   * @private
   */
  _getSessionCurrentTask(sessionId) {
    const db = this._getCoordinationDb();
    if (!db) {
      return { currentTask: null, available: false };
    }

    try {
      // Get claims for this session
      const claims = db.getClaimsBySession(sessionId);

      if (!claims || claims.length === 0) {
        return {
          sessionId,
          currentTask: null,
          available: true,
          timestamp: Date.now()
        };
      }

      // Get the most recent active claim
      const activeClaims = claims.filter(c => !c.released && c.expiresAt > Date.now());

      if (activeClaims.length === 0) {
        return {
          sessionId,
          currentTask: null,
          available: true,
          timestamp: Date.now()
        };
      }

      // Get the claim with the most recent claimedAt timestamp
      const currentClaim = activeClaims.sort((a, b) => b.claimedAt - a.claimedAt)[0];

      // Enrich with task info
      const tm = this._getTaskManager();
      const task = tm ? tm.getTask(currentClaim.taskId) : null;

      return {
        sessionId,
        currentTask: {
          claim: currentClaim,
          task: task ? {
            id: task.id,
            title: task.title,
            description: task.description,
            status: task.status,
            phase: task.phase,
            priority: task.priority,
            estimate: task.estimate,
            acceptance: task.acceptance
          } : { id: currentClaim.taskId }
        },
        available: true,
        timestamp: Date.now()
      };
    } catch (error) {
      this.logger.error('Failed to get session current task', { sessionId, error: error.message });
      return { sessionId, currentTask: null, available: true, error: error.message };
    }
  }

  /**
   * Trigger cleanup of orphaned/expired claims
   * @private
   */
  _cleanupOrphanedClaims(force = false) {
    const db = this._getCoordinationDb();
    if (!db) {
      return { success: false, error: 'DATABASE_UNAVAILABLE' };
    }

    try {
      // Get counts before cleanup
      const statsBefore = db.getClaimStats();

      // Run cleanup
      const expiredCount = db.cleanupExpiredClaims();
      const orphanedCount = db.cleanupOrphanedClaims();

      // Get counts after cleanup
      const statsAfter = db.getClaimStats();

      const result = {
        success: true,
        cleaned: {
          expired: expiredCount,
          orphaned: orphanedCount,
          total: expiredCount + orphanedCount
        },
        statsBefore,
        statsAfter,
        timestamp: Date.now()
      };

      // Broadcast cleanup event if anything was cleaned
      if (result.cleaned.total > 0) {
        this._broadcastEvent('task:claims-cleaned', {
          expiredCount,
          orphanedCount,
          timestamp: Date.now()
        });

        // Broadcast individual orphan events for dashboard updates
        // Note: This would require tracking which claims were cleaned,
        // which the current API doesn't provide. For now, just broadcast summary.
        this._broadcastEvent('task:claim-orphaned', {
          count: orphanedCount,
          timestamp: Date.now()
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Failed to cleanup orphaned claims', { error: error.message });
      return { success: false, error: 'CLEANUP_FAILED', message: error.message };
    }
  }

  /**
   * Get claim statistics
   * @private
   */
  _getClaimStats() {
    const db = this._getCoordinationDb();
    if (!db) {
      return { available: false };
    }

    try {
      const stats = db.getClaimStats();

      return {
        ...stats,
        available: true,
        timestamp: Date.now()
      };
    } catch (error) {
      this.logger.error('Failed to get claim stats', { error: error.message });
      return { available: true, error: error.message };
    }
  }

  /**
   * Setup claim event listeners for SSE broadcasting
   * @private
   */
  _setupClaimEventListeners() {
    const db = this._getCoordinationDb();
    if (!db) return;

    // Listen for claim expiration events from cleanup timer
    db.on('claim:expired', (claim) => {
      this._broadcastEvent('task:claim-expired', {
        taskId: claim.taskId,
        sessionId: claim.sessionId,
        expiredAt: Date.now(),
        timestamp: Date.now()
      });
    });

    // Listen for orphaned claim events
    db.on('claim:orphaned', (claim) => {
      this._broadcastEvent('task:claim-orphaned', {
        taskId: claim.taskId,
        sessionId: claim.sessionId,
        reason: 'session_stale',
        timestamp: Date.now()
      });
    });
  }

  // ============================================
  // Delegation Hints Helper Methods (Phase 3)
  // ============================================

  /**
   * Get delegation hint for a task
   * @private
   */
  _getDelegationHint(taskId, agentId = null) {
    // Get DelegationDecider
    const decider = this._getDelegationDecider();
    if (!decider) {
      return { error: 'DELEGATION_DECIDER_NOT_AVAILABLE' };
    }

    // Get task from TaskManager
    const task = this._getTaskById(taskId);
    if (!task) {
      return { error: 'TASK_NOT_FOUND', taskId };
    }

    // Get agent if specified
    const agent = agentId ? this._getAgentById(agentId) : null;

    // Get decision
    const decision = decider.shouldDelegate(task, agent);

    return {
      taskId,
      agentId,
      decision,
      timestamp: Date.now()
    };
  }

  /**
   * Get delegation hints for multiple tasks (batch)
   * @private
   */
  _getDelegationHintsBatch(taskIds, agentId = null) {
    const decider = this._getDelegationDecider();
    if (!decider) {
      return { error: 'DELEGATION_DECIDER_NOT_AVAILABLE' };
    }

    const agent = agentId ? this._getAgentById(agentId) : null;
    const results = [];

    for (const taskId of taskIds) {
      const task = this._getTaskById(taskId);
      if (task) {
        const decision = decider.shouldDelegate(task, agent);
        results.push({ taskId, decision });
      } else {
        results.push({ taskId, error: 'TASK_NOT_FOUND' });
      }
    }

    return {
      results,
      agentId,
      timestamp: Date.now()
    };
  }

  /**
   * Get delegation hints for an agent's pending tasks
   * @private
   */
  _getAgentDelegationHints(agentId, limit = 10) {
    const decider = this._getDelegationDecider();
    if (!decider) {
      return { error: 'DELEGATION_DECIDER_NOT_AVAILABLE' };
    }

    const agent = this._getAgentById(agentId);

    // Get pending/ready tasks
    const tasks = this._getPendingTasks(limit);

    // Evaluate each task
    const hints = tasks.map(task => ({
      taskId: task.id,
      taskTitle: task.title,
      decision: decider.shouldDelegate(task, agent)
    }));

    // Filter to only tasks that should be delegated
    const recommended = hints.filter(h => h.decision.shouldDelegate);

    return {
      agentId,
      recommended,
      allHints: hints,
      timestamp: Date.now()
    };
  }

  /**
   * Accept a delegation hint
   * @private
   */
  _acceptDelegationHint(taskId, agentId, pattern) {
    // Record acceptance for metrics
    this._broadcastEvent('delegation:accepted', {
      taskId,
      agentId,
      pattern,
      timestamp: Date.now()
    });

    return {
      success: true,
      taskId,
      agentId,
      pattern,
      message: 'Delegation hint accepted'
    };
  }

  /**
   * Dismiss a delegation hint
   * @private
   */
  _dismissDelegationHint(taskId, reason) {
    // Record dismissal for metrics
    this._broadcastEvent('delegation:dismissed', {
      taskId,
      reason,
      timestamp: Date.now()
    });

    return {
      success: true,
      taskId,
      reason,
      message: 'Delegation hint dismissed'
    };
  }

  /**
   * Get delegation metrics
   * @private
   */
  _getDelegationMetrics() {
    const decider = this._getDelegationDecider();
    if (!decider) {
      return { error: 'DELEGATION_DECIDER_NOT_AVAILABLE' };
    }

    return {
      metrics: decider.getMetrics(),
      stats: decider.getStats(),
      timestamp: Date.now()
    };
  }

  // ============================================================================
  // DELEGATION METRICS IMPLEMENTATION METHODS
  // ============================================================================

  /**
   * Get or create DelegationMetrics instance
   * @private
   */
  _getDelegationMetricsInstance() {
    // Try to get from orchestrator
    if (this.orchestrator?.delegationMetrics) {
      return this.orchestrator.delegationMetrics;
    }

    // Create a new instance if needed
    if (!this._delegationMetricsInstance) {
      try {
        const { DelegationMetrics } = require('./delegation-metrics');
        this._delegationMetricsInstance = new DelegationMetrics();
      } catch (error) {
        this.logger?.error('Failed to create DelegationMetrics:', error);
        return null;
      }
    }

    return this._delegationMetricsInstance;
  }

  /**
   * Get complete delegation metrics summary
   * @private
   */
  _getDelegationMetricsSummary() {
    const metricsInstance = this._getDelegationMetricsInstance();
    if (!metricsInstance) {
      return { error: 'DELEGATION_METRICS_NOT_AVAILABLE', timestamp: Date.now() };
    }

    return {
      ...metricsInstance.getSummary(),
      timestamp: Date.now()
    };
  }

  /**
   * Get delegation pattern distribution
   * @private
   */
  _getDelegationPatterns() {
    const metricsInstance = this._getDelegationMetricsInstance();
    if (!metricsInstance) {
      return { error: 'DELEGATION_METRICS_NOT_AVAILABLE', timestamp: Date.now() };
    }

    return {
      ...metricsInstance.getPatternDistribution(),
      timestamp: Date.now()
    };
  }

  /**
   * Get delegation quality metrics
   * @private
   */
  _getDelegationQuality() {
    const metricsInstance = this._getDelegationMetricsInstance();
    if (!metricsInstance) {
      return { error: 'DELEGATION_METRICS_NOT_AVAILABLE', timestamp: Date.now() };
    }

    return {
      ...metricsInstance.getQualityStats(),
      timestamp: Date.now()
    };
  }

  /**
   * Get delegation resource utilization
   * @private
   */
  _getDelegationResources() {
    const metricsInstance = this._getDelegationMetricsInstance();
    if (!metricsInstance) {
      return { error: 'DELEGATION_METRICS_NOT_AVAILABLE', timestamp: Date.now() };
    }

    return {
      ...metricsInstance.getResourceStats(),
      timestamp: Date.now()
    };
  }

  /**
   * Get rolling window statistics
   * @private
   */
  _getDelegationRollingStats(windowName) {
    const metricsInstance = this._getDelegationMetricsInstance();
    if (!metricsInstance) {
      return null;
    }

    const stats = metricsInstance.getRollingStats(windowName);
    if (!stats) {
      return null;
    }

    return {
      ...stats,
      timestamp: Date.now()
    };
  }

  /**
   * Get metrics trends
   * @private
   */
  _getDelegationTrends(metric, windowMs) {
    const metricsInstance = this._getDelegationMetricsInstance();
    if (!metricsInstance) {
      return { error: 'DELEGATION_METRICS_NOT_AVAILABLE', timestamp: Date.now() };
    }

    return {
      metric,
      window: windowMs,
      ...metricsInstance.getTrend(metric, windowMs),
      timestamp: Date.now()
    };
  }

  /**
   * Get historical snapshots
   * @private
   */
  _getDelegationSnapshots(options) {
    const metricsInstance = this._getDelegationMetricsInstance();
    if (!metricsInstance) {
      return { error: 'DELEGATION_METRICS_NOT_AVAILABLE', snapshots: [], timestamp: Date.now() };
    }

    return {
      snapshots: metricsInstance.getSnapshots(options),
      timestamp: Date.now()
    };
  }

  /**
   * Trigger a metrics snapshot
   * @private
   */
  _triggerDelegationSnapshot() {
    const metricsInstance = this._getDelegationMetricsInstance();
    if (!metricsInstance) {
      return { error: 'DELEGATION_METRICS_NOT_AVAILABLE', timestamp: Date.now() };
    }

    const snapshot = metricsInstance.takeSnapshot();

    // Broadcast via SSE
    this._broadcastSSE({
      type: 'metrics:snapshot',
      snapshot,
      timestamp: Date.now()
    });

    return snapshot;
  }

  /**
   * Reset delegation metrics
   * @private
   */
  _resetDelegationMetrics() {
    const metricsInstance = this._getDelegationMetricsInstance();
    if (!metricsInstance) {
      return;
    }

    metricsInstance.reset();

    // Broadcast via SSE
    this._broadcastSSE({
      type: 'metrics:reset',
      timestamp: Date.now()
    });
  }

  /**
   * Get DelegationDecider instance
   * @private
   */
  _getDelegationDecider() {
    // Try to get from orchestrator first
    if (this.orchestrator?.delegationDecider) {
      return this.orchestrator.delegationDecider;
    }

    // Create a new instance if needed
    if (!this._delegationDecider) {
      try {
        const { DelegationDecider } = require('./delegation-decider');
        this._delegationDecider = new DelegationDecider();
      } catch (error) {
        return null;
      }
    }

    return this._delegationDecider;
  }

  /**
   * Get task by ID from TaskManager
   * @private
   */
  _getTaskById(taskId) {
    if (this.taskManager) {
      return this.taskManager.getTask(taskId);
    }
    return null;
  }

  /**
   * Get agent by ID
   * @private
   */
  _getAgentById(agentId) {
    if (this.orchestrator) {
      return this.orchestrator.getAgent(agentId);
    }
    return null;
  }

  /**
   * Get pending tasks
   * @private
   */
  _getPendingTasks(limit = 10) {
    if (this.taskManager) {
      const ready = this.taskManager.getReadyTasks().slice(0, limit);
      return ready;
    }
    return [];
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