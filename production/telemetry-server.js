/**
 * Production Telemetry Server for Claude Sessions
 * Simplified version that works with existing dependencies
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

class TelemetryServer {
  constructor(config) {
    this.config = config;
    this.app = express();
    this.wss = null;
    this.activeSessions = new Map();
    this.sessionsData = [];
    this.metricsData = [];
    this.alertsData = [];
    this.sessionTodos = new Map();  // Map of sessionId -> todos array
    this.projectPlans = new Map();  // Map of projectId -> plan object

    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Enable CORS
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      next();
    });
  }

  async initialize() {
    // Setup routes
    this.setupRoutes();

    // Start WebSocket server
    this.startWebSocket();

    // Start HTTP server
    this.start();

    console.log('✓ Telemetry server initialized');
  }

  setupRoutes() {
    // Health check
    this.app.get(this.config.telemetry.healthPath, (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: Date.now(),
        activeSessions: this.activeSessions.size
      });
    });

    // Session management
    this.app.post('/api/sessions/start', this.handleSessionStart.bind(this));
    this.app.post('/api/sessions/:sessionId/pause', this.handleSessionPause.bind(this));
    this.app.post('/api/sessions/:sessionId/resume', this.handleSessionResume.bind(this));
    this.app.post('/api/sessions/:sessionId/end', this.handleSessionEnd.bind(this));

    // Metrics ingestion
    this.app.post('/api/metrics', this.handleMetricsIngestion.bind(this));
    this.app.post('/api/sessions/:sessionId/metrics', this.handleSessionMetrics.bind(this));

    // Checkpoint management
    this.app.post('/api/sessions/:sessionId/checkpoint', this.handleCheckpoint.bind(this));
    this.app.get('/api/sessions/:sessionId/checkpoints', this.getCheckpoints.bind(this));

    // Query endpoints
    this.app.get('/api/sessions', this.getSessions.bind(this));
    this.app.get('/api/sessions/:sessionId', this.getSession.bind(this));
    this.app.get('/api/sessions/:sessionId/metrics', this.getSessionMetrics.bind(this));
    this.app.get('/api/alerts', this.getAlerts.bind(this));

    // Analytics
    this.app.get('/api/analytics/overview', this.getAnalyticsOverview.bind(this));
    this.app.get('/api/analytics/trends', this.getAnalyticsTrends.bind(this));

    // Projects
    this.app.get('/api/projects', this.getProjects.bind(this));
    this.app.get('/api/projects/detailed', this.getProjectsDetailed.bind(this));

    // Todo/Plan Management
    this.app.post('/api/sessions/:sessionId/todos', this.updateSessionTodos.bind(this));
    this.app.get('/api/sessions/:sessionId/todos', this.getSessionTodos.bind(this));
    this.app.post('/api/projects/:projectId/plan', this.updateProjectPlan.bind(this));
    this.app.get('/api/projects/:projectId/plan', this.getProjectPlan.bind(this));

    // Context Controls
    this.app.post('/api/context/compact', this.handleContextCompact.bind(this));
    this.app.get('/api/context/status', this.getContextStatus.bind(this));

    // Export
    this.app.get('/api/sessions/:sessionId/export', this.exportSession.bind(this));
  }

  startWebSocket() {
    try {
      this.wss = new WebSocket.Server({ port: this.config.dashboard.wsPort });

      this.wss.on('connection', (ws) => {
        console.log('WebSocket client connected');

      // Send initial state
      ws.send(JSON.stringify({
        type: 'initial_state',
        data: {
          activeSessions: Array.from(this.activeSessions.values()),
          timestamp: Date.now()
        }
      }));

      ws.on('error', console.error);
    });

      this.wss.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`❌ WebSocket port ${this.config.dashboard.wsPort} is already in use`);
          console.log('💡 Another instance may be running. Check with: netstat -an | findstr', this.config.dashboard.wsPort);
        } else {
          console.error('WebSocket server error:', error);
        }
      });

      console.log(`✓ WebSocket server listening on port ${this.config.dashboard.wsPort}`);
    } catch (error) {
      console.error('❌ Failed to start WebSocket server:', error.message);
      throw error;
    }
  }

  async handleSessionStart(req, res) {
    try {
      const {
        sessionId,
        projectId,
        agentPersona,
        modelName,
        metadata = {}
      } = req.body;

      if (!sessionId || !modelName) {
        return res.status(400).json({ error: 'sessionId and modelName required' });
      }

      const now = Math.floor(Date.now() / 1000);

      const session = {
        id: sessionId,
        project_id: projectId,
        agent_persona: agentPersona,
        model_name: modelName,
        start_time: now,
        status: 'active',
        total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        context_percentage: 0,
        total_cost: 0,
        metadata: JSON.stringify(metadata)
      };

      this.sessionsData.push(session);
      this.activeSessions.set(sessionId, session);
      this.broadcast({ type: 'session_started', data: session });

      res.json({ success: true, session });
    } catch (error) {
      console.error('Error starting session:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async handleSessionPause(req, res) {
    try {
      const { sessionId } = req.params;

      const session = this.activeSessions.get(sessionId);
      if (session) {
        session.status = 'paused';
        this.broadcast({ type: 'session_paused', data: { sessionId } });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error pausing session:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async handleSessionResume(req, res) {
    try {
      const { sessionId } = req.params;

      const session = this.activeSessions.get(sessionId);
      if (session) {
        session.status = 'active';
        this.broadcast({ type: 'session_resumed', data: { sessionId } });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error resuming session:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async handleSessionEnd(req, res) {
    try {
      const { sessionId } = req.params;
      const now = Math.floor(Date.now() / 1000);

      const session = this.activeSessions.get(sessionId);
      if (session) {
        session.status = 'completed';
        session.end_time = now;
      }

      this.activeSessions.delete(sessionId);
      this.broadcast({ type: 'session_ended', data: { sessionId } });

      res.json({ success: true });
    } catch (error) {
      console.error('Error ending session:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async handleMetricsIngestion(req, res) {
    try {
      const {
        sessionId,
        inputTokens,
        outputTokens,
        cacheCreationTokens = 0,
        cacheReadTokens = 0,
        contextPercentage,
        operationType = 'unknown',
        responseTime
      } = req.body;

      if (!sessionId) {
        return res.status(400).json({ error: 'sessionId required' });
      }

      const totalTokens = (inputTokens || 0) + (outputTokens || 0);

      // Find session
      const session = this.activeSessions.get(sessionId) ||
                     this.sessionsData.find(s => s.id === sessionId);

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Calculate cost
      const costs = this.config.tokenCosts[session.model_name] || this.config.tokenCosts['claude-sonnet-4-20250514'];
      const cost = this.calculateCost(
        inputTokens || 0,
        outputTokens || 0,
        cacheCreationTokens,
        cacheReadTokens,
        costs
      );

      // Update session
      session.total_tokens = (session.total_tokens || 0) + totalTokens;
      session.input_tokens = (session.input_tokens || 0) + (inputTokens || 0);
      session.output_tokens = (session.output_tokens || 0) + (outputTokens || 0);
      session.context_percentage = contextPercentage || session.context_percentage;
      session.total_cost = (session.total_cost || 0) + cost;

      // Store metrics
      this.metricsData.push({
        session_id: sessionId,
        timestamp: Math.floor(Date.now() / 1000),
        token_count: totalTokens,
        context_percentage: contextPercentage,
        operation_type: operationType,
        response_time_ms: responseTime
      });

      // Check for alerts
      this.checkThresholds(sessionId, contextPercentage, session.total_tokens, session.total_cost);

      // Broadcast update
      this.broadcast({
        type: 'metrics_updated',
        data: {
          sessionId,
          totalTokens: session.total_tokens,
          contextPercentage,
          cost
        }
      });

      res.json({ success: true, cost });
    } catch (error) {
      console.error('Error ingesting metrics:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async handleSessionMetrics(req, res) {
    try {
      const { sessionId } = req.params;
      const metrics = req.body;

      // Delegate to main metrics handler
      req.body.sessionId = sessionId;
      await this.handleMetricsIngestion(req, res);
    } catch (error) {
      console.error('Error handling session metrics:', error);
      res.status(500).json({ error: error.message });
    }
  }

  calculateCost(inputTokens, outputTokens, cacheCreation, cacheRead, costs) {
    return (
      (inputTokens / 1000000) * costs.input +
      (outputTokens / 1000000) * costs.output +
      (cacheCreation / 1000000) * costs.cacheCreation +
      (cacheRead / 1000000) * costs.cacheRead
    );
  }

  checkThresholds(sessionId, contextPercentage, totalTokens, totalCost) {
    const alerts = [];

    // Context percentage alerts
    if (contextPercentage >= this.config.thresholds.contextCritical) {
      alerts.push({
        session_id: sessionId,
        alert_type: 'context_critical',
        severity: 'critical',
        message: `Context usage critical: ${(contextPercentage * 100).toFixed(1)}%`,
        threshold_value: this.config.thresholds.contextCritical,
        actual_value: contextPercentage,
        created_at: Math.floor(Date.now() / 1000),
        acknowledged: 0
      });
    } else if (contextPercentage >= this.config.thresholds.contextAlert) {
      alerts.push({
        session_id: sessionId,
        alert_type: 'context_alert',
        severity: 'warning',
        message: `Context usage high: ${(contextPercentage * 100).toFixed(1)}%`,
        threshold_value: this.config.thresholds.contextAlert,
        actual_value: contextPercentage,
        created_at: Math.floor(Date.now() / 1000),
        acknowledged: 0
      });
    }

    // Save alerts
    for (const alert of alerts) {
      this.alertsData.push(alert);
      this.broadcast({
        type: 'alert_created',
        data: { sessionId, ...alert }
      });
    }

    // Auto-checkpoint trigger
    if (this.config.checkpoints.autoTrigger &&
        contextPercentage >= this.config.checkpoints.contextThreshold) {
      this.triggerAutoCheckpoint(sessionId, contextPercentage, totalTokens);
    }
  }

  triggerAutoCheckpoint(sessionId, contextPercentage, totalTokens) {
    const checkpoint = {
      session_id: sessionId,
      checkpoint_time: Math.floor(Date.now() / 1000),
      trigger_type: 'auto',
      context_percentage: contextPercentage,
      total_tokens: totalTokens,
      notes: `Auto-checkpoint triggered at ${(contextPercentage * 100).toFixed(1)}% context usage`
    };

    // Save checkpoint (in memory for now)
    if (!this.checkpoints) this.checkpoints = [];
    this.checkpoints.push(checkpoint);

    this.broadcast({
      type: 'checkpoint_triggered',
      data: {
        sessionId,
        type: 'auto',
        contextPercentage,
        totalTokens
      }
    });
  }

  async handleCheckpoint(req, res) {
    try {
      const { sessionId } = req.params;
      const { notes, stateSnapshot } = req.body;

      const session = this.activeSessions.get(sessionId) ||
                     this.sessionsData.find(s => s.id === sessionId);

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const checkpoint = {
        session_id: sessionId,
        checkpoint_time: Math.floor(Date.now() / 1000),
        trigger_type: 'manual',
        context_percentage: session.context_percentage,
        total_tokens: session.total_tokens,
        state_snapshot: JSON.stringify(stateSnapshot || {}),
        notes: notes || 'Manual checkpoint'
      };

      if (!this.checkpoints) this.checkpoints = [];
      this.checkpoints.push(checkpoint);

      this.broadcast({
        type: 'checkpoint_created',
        data: { sessionId, type: 'manual' }
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Error creating checkpoint:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getCheckpoints(req, res) {
    try {
      const { sessionId } = req.params;

      const checkpoints = (this.checkpoints || [])
        .filter(c => c.session_id === sessionId)
        .sort((a, b) => b.checkpoint_time - a.checkpoint_time);

      res.json({ checkpoints });
    } catch (error) {
      console.error('Error getting checkpoints:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getSessions(req, res) {
    try {
      const { status, projectId, limit = 50, offset = 0 } = req.query;

      let sessions = [...this.sessionsData];

      if (status) {
        sessions = sessions.filter(s => s.status === status);
      }
      if (projectId) {
        sessions = sessions.filter(s => s.project_id === projectId);
      }

      sessions = sessions
        .sort((a, b) => b.start_time - a.start_time)
        .slice(parseInt(offset), parseInt(offset) + parseInt(limit));

      res.json({ sessions });
    } catch (error) {
      console.error('Error getting sessions:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getSession(req, res) {
    try {
      const { sessionId } = req.params;

      const session = this.activeSessions.get(sessionId) ||
                     this.sessionsData.find(s => s.id === sessionId);

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json({ session });
    } catch (error) {
      console.error('Error getting session:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getSessionMetrics(req, res) {
    try {
      const { sessionId } = req.params;
      const { limit = 100 } = req.query;

      const metrics = this.metricsData
        .filter(m => m.session_id === sessionId)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, parseInt(limit));

      res.json({ metrics });
    } catch (error) {
      console.error('Error getting session metrics:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getAlerts(req, res) {
    try {
      const { sessionId, acknowledged, severity, limit = 50 } = req.query;

      let alerts = [...this.alertsData];

      if (sessionId) {
        alerts = alerts.filter(a => a.session_id === sessionId);
      }
      if (acknowledged !== undefined) {
        alerts = alerts.filter(a => a.acknowledged === (acknowledged === 'true' ? 1 : 0));
      }
      if (severity) {
        alerts = alerts.filter(a => a.severity === severity);
      }

      alerts = alerts
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, parseInt(limit));

      res.json({ alerts });
    } catch (error) {
      console.error('Error getting alerts:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getAnalyticsOverview(req, res) {
    try {
      const activeCount = this.activeSessions.size;
      const totalSessions = this.sessionsData.length;
      const totalTokens = this.sessionsData.reduce((sum, s) => sum + (s.total_tokens || 0), 0);
      const totalCost = this.sessionsData.reduce((sum, s) => sum + (s.total_cost || 0), 0);
      const avgContext = totalSessions > 0 ?
        this.sessionsData.reduce((sum, s) => sum + (s.context_percentage || 0), 0) / totalSessions : 0;

      const stats = {
        active_sessions: activeCount,
        total_sessions: totalSessions,
        total_tokens: totalTokens,
        total_cost: totalCost,
        avg_context: avgContext
      };

      const recentAlerts = this.alertsData
        .filter(a => a.acknowledged === 0)
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, 10);

      res.json({ stats, recentAlerts });
    } catch (error) {
      console.error('Error getting analytics overview:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getProjects(req, res) {
    try {
      // Get unique projects from sessions
      const projectsMap = new Map();

      for (const session of this.sessionsData) {
        if (session.project_id) {
          if (!projectsMap.has(session.project_id)) {
            projectsMap.set(session.project_id, {
              id: session.project_id,
              name: session.project_id,
              sessions: [],
              total_tokens: 0,
              total_cost: 0,
              active_sessions: 0,
              last_activity: session.start_time
            });
          }

          const project = projectsMap.get(session.project_id);
          project.sessions.push(session.id);
          project.total_tokens += session.total_tokens || 0;
          project.total_cost += session.total_cost || 0;
          if (session.status === 'active') {
            project.active_sessions++;
          }
          if (session.start_time > project.last_activity) {
            project.last_activity = session.start_time;
          }
        }
      }

      const projects = Array.from(projectsMap.values())
        .sort((a, b) => b.last_activity - a.last_activity);

      res.json({ projects });
    } catch (error) {
      console.error('Error getting projects:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getAnalyticsTrends(req, res) {
    try {
      const { period = '24h' } = req.query;

      // Simple trend data for now
      const trends = [];
      const now = Math.floor(Date.now() / 1000);
      const points = 10;

      for (let i = 0; i < points; i++) {
        trends.push({
          timestamp: now - (i * 3600),
          avg_tokens: Math.random() * 1000,
          avg_context: Math.random() * 0.5,
          avg_cache_hit: Math.random(),
          avg_response_time: Math.random() * 3000
        });
      }

      res.json({ trends: trends.reverse() });
    } catch (error) {
      console.error('Error getting analytics trends:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async handleContextCompact(req, res) {
    try {
      const { sessionId } = req.body;
      const session = this.activeSessions.get(sessionId);

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Simulate context compaction
      const originalContext = session.context_percentage || 0;
      session.context_percentage = 0.15; // Reset to 15% after compaction

      // Create checkpoint
      const checkpoint = {
        session_id: sessionId,
        checkpoint_time: Math.floor(Date.now() / 1000),
        trigger_type: 'compact',
        context_percentage: originalContext,
        total_tokens: session.total_tokens,
        state_snapshot: JSON.stringify({
          reason: 'Manual context compaction',
          original_context: originalContext
        }),
        notes: 'Context compacted from ' + (originalContext * 100).toFixed(1) + '% to 15%'
      };

      if (!this.checkpoints) this.checkpoints = [];
      this.checkpoints.push(checkpoint);

      this.broadcast({
        type: 'context_compacted',
        data: {
          sessionId,
          originalContext,
          newContext: 0.15
        }
      });

      res.json({
        success: true,
        message: 'Context compacted',
        originalContext,
        newContext: 0.15
      });
    } catch (error) {
      console.error('Error compacting context:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getContextStatus(req, res) {
    try {
      const contextStatus = [];

      for (const [sessionId, session] of this.activeSessions) {
        contextStatus.push({
          sessionId,
          projectId: session.project_id,
          contextPercentage: session.context_percentage || 0,
          totalTokens: session.total_tokens || 0,
          status: session.status,
          canCompact: (session.context_percentage || 0) > 0.3
        });
      }

      res.json({
        contextStatus,
        compactionThreshold: 0.8,
        checkpointThreshold: 0.95
      });
    } catch (error) {
      console.error('Error getting context status:', error);
      res.status(500).json({ error: error.message });
    }
  }

  // Todo/Plan Management Methods
  async updateSessionTodos(req, res) {
    try {
      const { sessionId } = req.params;
      const { todos } = req.body;

      if (!Array.isArray(todos)) {
        return res.status(400).json({ error: 'Todos must be an array' });
      }

      this.sessionTodos.set(sessionId, todos);

      this.broadcast({
        type: 'todos_updated',
        data: { sessionId, todos }
      });

      res.json({ success: true, todos });
    } catch (error) {
      console.error('Error updating session todos:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getSessionTodos(req, res) {
    try {
      const { sessionId } = req.params;
      const todos = this.sessionTodos.get(sessionId) || [];
      res.json({ todos });
    } catch (error) {
      console.error('Error getting session todos:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async updateProjectPlan(req, res) {
    try {
      const { projectId } = req.params;
      const { plan } = req.body;

      this.projectPlans.set(projectId, {
        ...plan,
        updatedAt: new Date().toISOString()
      });

      this.broadcast({
        type: 'plan_updated',
        data: { projectId, plan }
      });

      res.json({ success: true, plan });
    } catch (error) {
      console.error('Error updating project plan:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getProjectPlan(req, res) {
    try {
      const { projectId } = req.params;
      const plan = this.projectPlans.get(projectId) || null;
      res.json({ plan });
    } catch (error) {
      console.error('Error getting project plan:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async getProjectsDetailed(req, res) {
    try {
      // Get unique projects with their sessions
      const projectsMap = new Map();

      for (const session of this.sessionsData) {
        const projectId = session.project_id || 'unassigned';

        if (!projectsMap.has(projectId)) {
          projectsMap.set(projectId, {
            id: projectId,
            name: projectId,
            sessions: [],
            total_tokens: 0,
            total_cost: 0,
            active_sessions: 0,
            last_activity: session.start_time,
            plan: this.projectPlans.get(projectId) || null
          });
        }

        const project = projectsMap.get(projectId);

        // Add session details with todos
        const sessionWithTodos = {
          ...session,
          todos: this.sessionTodos.get(session.id) || []
        };

        project.sessions.push(sessionWithTodos);
        project.total_tokens += session.total_tokens || 0;
        project.total_cost += session.total_cost || 0;

        if (session.status === 'active') {
          project.active_sessions++;
        }

        if (session.start_time > project.last_activity) {
          project.last_activity = session.start_time;
        }
      }

      const projects = Array.from(projectsMap.values())
        .sort((a, b) => b.last_activity - a.last_activity);

      res.json({ projects });
    } catch (error) {
      console.error('Error getting detailed projects:', error);
      res.status(500).json({ error: error.message });
    }
  }

  async exportSession(req, res) {
    try {
      const { sessionId } = req.params;
      const { format = 'json' } = req.query;

      const session = this.activeSessions.get(sessionId) ||
                     this.sessionsData.find(s => s.id === sessionId);

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const metrics = this.metricsData.filter(m => m.session_id === sessionId);
      const checkpoints = (this.checkpoints || []).filter(c => c.session_id === sessionId);
      const alerts = this.alertsData.filter(a => a.session_id === sessionId);

      const exportData = {
        session,
        metrics,
        checkpoints,
        alerts,
        exportedAt: Date.now()
      };

      if (format === 'csv') {
        // Simple CSV export
        const csv = this.convertToCSV(exportData);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=session-${sessionId}.csv`);
        res.send(csv);
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=session-${sessionId}.json`);
        res.json(exportData);
      }
    } catch (error) {
      console.error('Error exporting session:', error);
      res.status(500).json({ error: error.message });
    }
  }

  convertToCSV(data) {
    // Simple CSV conversion for metrics
    const rows = [
      ['Timestamp', 'Token Count', 'Context %', 'Response Time']
    ];

    data.metrics.forEach(m => {
      rows.push([
        m.timestamp,
        m.token_count,
        m.context_percentage,
        m.response_time_ms
      ]);
    });

    return rows.map(row => row.join(',')).join('\n');
  }

  broadcast(message) {
    if (!this.wss) return;

    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }

  start() {
    this.app.listen(this.config.telemetry.port, this.config.telemetry.host, () => {
      console.log(`✓ Telemetry server listening on ${this.config.telemetry.host}:${this.config.telemetry.port}`);
    });
  }
}

// Start server if run directly
if (require.main === module) {
  const config = require('./config/production.json');
  const server = new TelemetryServer(config);
  server.initialize().catch(console.error);
}

module.exports = TelemetryServer;