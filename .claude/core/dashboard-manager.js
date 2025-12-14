/**
 * Dashboard Manager - Real-time monitoring and control center
 *
 * Aggregates data from multiple sources and provides real-time updates:
 * - Context window usage
 * - API rate limits
 * - Token usage and costs
 * - Execution plans and progress
 * - Session state
 *
 * Supports multiple output formats:
 * - Terminal UI (blessed/ink)
 * - Web dashboard (Express + SSE)
 * - JSON API
 *
 * @module dashboard-manager
 */

const { createComponentLogger } = require('./logger');
const EventEmitter = require('events');

class DashboardManager extends EventEmitter {
  /**
   * Create a dashboard manager
   *
   * @param {Object} components - System components
   * @param {UsageTracker} components.usageTracker - Usage tracker instance
   * @param {ClaudeLimitTracker} components.limitTracker - API limit tracker
   * @param {StateManager} components.stateManager - State manager
   * @param {SessionInitializer} components.sessionInit - Session initializer
   * @param {MessageBus} components.messageBus - Message bus for events
   * @param {ClaudeCodeUsageParser} components.claudeCodeParser - Claude Code usage parser
   * @param {Object} options - Configuration
   */
  constructor(components, options = {}) {
    super();

    this.logger = createComponentLogger('DashboardManager');

    // System components
    this.usageTracker = components.usageTracker;
    this.limitTracker = components.limitTracker;
    this.stateManager = components.stateManager;
    this.sessionInit = components.sessionInit;
    this.messageBus = components.messageBus;
    this.claudeCodeParser = components.claudeCodeParser;

    // Configuration
    this.options = {
      updateInterval: options.updateInterval || 2000, // 2 seconds
      enableWebDashboard: options.enableWebDashboard !== false,
      webPort: options.webPort || 3030,
      enableTerminalDashboard: options.enableTerminalDashboard !== false,
      contextWindowSize: options.contextWindowSize || 200000,
      ...options
    };

    // Dashboard state
    this.state = {
      session: {
        id: `session-${Date.now()}`,
        startTime: Date.now(),
        status: 'idle', // idle, running, paused, wrapping-up, stopped
        loopEnabled: false,
        autoResume: false
      },
      context: {
        current: 0,
        limit: this.options.contextWindowSize,
        percentage: 0,
        status: 'ok', // ok, warning, critical, emergency
        nextCheckpoint: 0
      },
      apiLimits: null,
      usage: null,
      claudeCodeUsage: null,  // Usage from Claude Code sessions
      execution: {
        phase: null,
        agent: null,
        task: null,
        progress: 0,
        duration: 0,
        estimatedCompletion: null
      },
      plan: {
        tasks: [],
        currentTaskIndex: -1,
        totalTasks: 0,
        completedTasks: 0
      },
      artifacts: [],  // NEW: Track created artifacts
      config: {       // NEW: Current configuration
        loopEnabled: options.loopEnabled !== false,
        contextMonitoring: options.contextMonitoring || {},
        apiLimitTracking: options.apiLimitTracking || {},
        costBudgets: options.costBudgets || {},
        checkpointOptimizer: options.checkpointOptimizer || {},
        humanInLoop: options.humanInLoop || {},
        dashboard: options.dashboard || {}
      },
      humanReview: {  // NEW: Human review queue
        pending: [],
        history: []
      },
      events: [],
      metrics: {
        totalOperations: 0,
        successfulOperations: 0,
        failedOperations: 0,
        checkpoints: 0,
        wrapUps: 0
      }
    };

    // Configuration file path
    this.configPath = options.configPath || './.claude/settings.local.json';

    // Update timer
    this.updateTimer = null;
    this.isRunning = false;

    // Event subscriptions
    this._setupEventSubscriptions();

    this.logger.info('DashboardManager initialized', {
      updateInterval: this.options.updateInterval,
      webDashboard: this.options.enableWebDashboard,
      terminalDashboard: this.options.enableTerminalDashboard
    });
  }

  /**
   * Subscribe to system events
   * @private
   */
  _setupEventSubscriptions() {
    if (!this.messageBus) {
      this.logger.warn('MessageBus not available, events disabled');
      return;
    }

    // Listen for orchestration events
    this.messageBus.subscribe(
      'orchestrator:execution:start',
      'dashboard',
      (event) => this._handleExecutionStart(event)
    );

    this.messageBus.subscribe(
      'orchestrator:execution:complete',
      'dashboard',
      (event) => this._handleExecutionComplete(event)
    );

    this.messageBus.subscribe(
      'orchestrator:execution:error',
      'dashboard',
      (event) => this._handleExecutionError(event)
    );

    // Listen for checkpoint events
    this.messageBus.subscribe(
      'loop:checkpoint:created',
      'dashboard',
      (event) => this._handleCheckpoint(event)
    );

    // Listen for wrap-up events
    this.messageBus.subscribe(
      'loop:wrapup:started',
      'dashboard',
      (event) => this._handleWrapUpStart(event)
    );

    this.messageBus.subscribe(
      'loop:wrapup:completed',
      'dashboard',
      (event) => this._handleWrapUpComplete(event)
    );

    this.logger.debug('Event subscriptions registered');
  }

  /**
   * Start the dashboard
   */
  async start() {
    if (this.isRunning) {
      this.logger.warn('Dashboard already running');
      return;
    }

    this.isRunning = true;
    this.state.session.status = 'running';

    // Start update loop
    this._startUpdateLoop();

    // Start web dashboard if enabled
    if (this.options.enableWebDashboard) {
      await this._startWebDashboard();
    }

    this.logger.info('Dashboard started');
    this.emit('started');
  }

  /**
   * Stop the dashboard
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.state.session.status = 'stopped';

    // Stop update loop
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }

    // Stop web dashboard
    if (this.webServer) {
      await new Promise((resolve) => {
        this.webServer.close(() => resolve());
      });
      this.webServer = null;
    }

    this.logger.info('Dashboard stopped');
    this.emit('stopped');
  }

  /**
   * Get current dashboard state
   * @returns {Object} Current state snapshot
   */
  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * Update execution plan
   * @param {Array} tasks - List of tasks
   * @param {number} currentIndex - Current task index
   */
  updateExecutionPlan(tasks, currentIndex = 0) {
    this.state.plan.tasks = tasks.map((task, index) => ({
      id: task.id || `task-${index}`,
      content: task.content || task.name || task,
      status: task.status || (index < currentIndex ? 'completed' : index === currentIndex ? 'in_progress' : 'pending'),
      activeForm: task.activeForm,
      progress: task.progress || (task.status === 'completed' ? 100 : task.status === 'in_progress' ? 50 : 0)
    }));

    this.state.plan.currentTaskIndex = currentIndex;
    this.state.plan.totalTasks = tasks.length;
    this.state.plan.completedTasks = tasks.filter(t => t.status === 'completed').length;

    this._addEvent('info', 'Execution plan updated', {
      totalTasks: tasks.length,
      currentTask: currentIndex
    });

    this.emit('plan:updated', this.state.plan);
  }

  /**
   * Track artifact creation
   * @param {Object} artifact - Artifact details
   */
  addArtifact(artifact) {
    const artifactRecord = {
      id: artifact.id || `artifact-${Date.now()}`,
      type: artifact.type || 'file',
      name: artifact.name || artifact.path,
      path: artifact.path,
      size: artifact.size,
      created: artifact.created || Date.now(),
      phase: artifact.phase || this.state.execution.phase,
      description: artifact.description
    };

    this.state.artifacts.unshift(artifactRecord);

    // Keep only last 100 artifacts
    if (this.state.artifacts.length > 100) {
      this.state.artifacts = this.state.artifacts.slice(0, 100);
    }

    this._addEvent('info', 'Artifact created', {
      name: artifactRecord.name,
      type: artifactRecord.type
    });

    this.emit('artifact:added', artifactRecord);
  }

  /**
   * Update configuration setting
   * @param {string} path - Config path (e.g., 'apiLimitTracking.enabled')
   * @param {any} value - New value
   */
  async updateConfig(path, value) {
    try {
      const fs = require('fs');
      const configData = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));

      // Navigate to the config path and update
      const parts = path.split('.');
      let current = configData.continuousLoop;

      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) {
          current[parts[i]] = {};
        }
        current = current[parts[i]];
      }

      const oldValue = current[parts[parts.length - 1]];
      current[parts[parts.length - 1]] = value;

      // Save config file
      fs.writeFileSync(
        this.configPath,
        JSON.stringify(configData, null, 2),
        'utf8'
      );

      // Update local state
      this._updateLocalConfig(path, value);

      this._addEvent('info', 'Configuration updated', {
        setting: path,
        oldValue,
        newValue: value
      });

      this.logger.info('Config updated', { path, value });

      this.emit('config:changed', { path, value, oldValue });

      return { success: true, path, value, oldValue };

    } catch (error) {
      this.logger.error('Failed to update config', {
        error: error.message,
        path,
        value
      });

      return { success: false, error: error.message };
    }
  }

  /**
   * Update local config state
   * @private
   */
  _updateLocalConfig(path, value) {
    const parts = path.split('.');
    let current = this.state.config;

    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }

    current[parts[parts.length - 1]] = value;
  }

  /**
   * Add human review request
   * @param {Object} review - Review details
   */
  addHumanReview(review) {
    const reviewRecord = {
      id: review.id || `review-${Date.now()}`,
      timestamp: Date.now(),
      task: review.task,
      reason: review.reason,
      confidence: review.confidence,
      pattern: review.pattern,
      context: review.context,
      status: 'pending', // pending, approved, rejected
      response: null
    };

    this.state.humanReview.pending.unshift(reviewRecord);

    this._addEvent('warning', 'Human review required', {
      task: review.task?.substring(0, 50),
      reason: review.reason
    });

    this.emit('review:requested', reviewRecord);

    return reviewRecord.id;
  }

  /**
   * Respond to human review request
   * @param {string} reviewId - Review ID
   * @param {Object} response - User response
   */
  async respondToReview(reviewId, response) {
    const reviewIndex = this.state.humanReview.pending.findIndex(r => r.id === reviewId);

    if (reviewIndex === -1) {
      return { success: false, error: 'Review not found' };
    }

    const review = this.state.humanReview.pending[reviewIndex];

    review.status = response.approved ? 'approved' : 'rejected';
    review.response = {
      approved: response.approved,
      feedback: response.feedback || '',
      timestamp: Date.now()
    };

    // Move to history
    this.state.humanReview.history.unshift(review);
    this.state.humanReview.pending.splice(reviewIndex, 1);

    this._addEvent('info', `Review ${review.status}`, {
      task: review.task?.substring(0, 50)
    });

    this.emit('review:responded', { reviewId, response: review.response });

    return { success: true, review };
  }

  /**
   * Update current execution info
   * @param {Object} execution - Execution details
   */
  updateExecution(execution) {
    this.state.execution = {
      ...this.state.execution,
      ...execution,
      duration: execution.startTime
        ? Date.now() - execution.startTime
        : this.state.execution.duration
    };

    this.emit('execution:updated', this.state.execution);
  }

  /**
   * Update loop configuration
   * @param {Object} config - Loop configuration
   */
  updateLoopConfig(config) {
    this.state.session.loopEnabled = config.enabled !== false;
    this.state.session.autoResume = config.autoResume !== false;

    this.emit('config:updated', config);
  }

  /**
   * Start periodic updates
   * @private
   */
  _startUpdateLoop() {
    this.updateTimer = setInterval(() => {
      this._updateMetrics();
    }, this.options.updateInterval);

    this.logger.debug('Update loop started', {
      interval: this.options.updateInterval
    });
  }

  /**
   * Update all metrics
   * @private
   */
  async _updateMetrics() {
    try {
      // Update usage metrics
      if (this.usageTracker) {
        this.state.usage = this.usageTracker.getSessionUsage();
      }

      // Update Claude Code usage metrics
      if (this.claudeCodeParser) {
        this.state.claudeCodeUsage = await this.claudeCodeParser.getClaudeCodeSummary('all');
      }

      // Update API limits
      if (this.limitTracker) {
        this.state.apiLimits = this.limitTracker.getStatus();
      }

      // Update context window (estimate based on usage)
      if (this.state.usage) {
        this.state.context.current = this.state.usage.totalTokens || 0;
        this.state.context.percentage =
          (this.state.context.current / this.state.context.limit) * 100;

        // Update status based on percentage
        if (this.state.context.percentage >= 95) {
          this.state.context.status = 'emergency';
        } else if (this.state.context.percentage >= 85) {
          this.state.context.status = 'critical';
        } else if (this.state.context.percentage >= 80) {
          this.state.context.status = 'warning';
        } else {
          this.state.context.status = 'ok';
        }

        // Calculate next checkpoint
        this.state.context.nextCheckpoint = Math.max(
          0,
          (this.state.context.limit * 0.85) - this.state.context.current
        );
      }

      // Update execution duration
      if (this.state.execution.startTime) {
        this.state.execution.duration = Date.now() - this.state.execution.startTime;
      }

      // Emit update event
      this.emit('metrics:updated', {
        context: this.state.context,
        apiLimits: this.state.apiLimits,
        usage: this.state.usage
      });

    } catch (error) {
      this.logger.error('Failed to update metrics', {
        error: error.message
      });
    }
  }

  /**
   * Handle execution start event
   * @private
   */
  _handleExecutionStart(event) {
    this.state.execution = {
      phase: event.phase || this.state.execution.phase,
      agent: event.agent || event.agentIds?.[0],
      task: event.task,
      progress: 0,
      startTime: Date.now(),
      duration: 0
    };

    this.state.metrics.totalOperations++;

    this._addEvent('start', 'Execution started', {
      agent: this.state.execution.agent,
      task: typeof event.task === 'string'
        ? event.task.substring(0, 50)
        : 'Task'
    });

    this.emit('execution:started', this.state.execution);
  }

  /**
   * Handle execution complete event
   * @private
   */
  _handleExecutionComplete(event) {
    this.state.metrics.successfulOperations++;

    this._addEvent('success', 'Execution completed', {
      agent: this.state.execution.agent,
      duration: this.state.execution.duration
    });

    this.emit('execution:completed', event);
  }

  /**
   * Handle execution error event
   * @private
   */
  _handleExecutionError(event) {
    this.state.metrics.failedOperations++;

    this._addEvent('error', 'Execution failed', {
      error: event.error?.message || 'Unknown error'
    });

    this.emit('execution:error', event);
  }

  /**
   * Handle checkpoint event
   * @private
   */
  _handleCheckpoint(event) {
    this.state.metrics.checkpoints++;

    this._addEvent('checkpoint', 'Checkpoint saved', {
      id: event.checkpointId || 'unknown'
    });

    this.emit('checkpoint:created', event);
  }

  /**
   * Handle wrap-up start event
   * @private
   */
  _handleWrapUpStart(event) {
    this.state.session.status = 'wrapping-up';

    this._addEvent('warning', 'Wrap-up initiated', {
      reason: event.reason
    });

    this.emit('wrapup:started', event);
  }

  /**
   * Handle wrap-up complete event
   * @private
   */
  _handleWrapUpComplete(event) {
    this.state.metrics.wrapUps++;
    this.state.session.status = 'stopped';

    this._addEvent('info', 'Wrap-up completed');

    this.emit('wrapup:completed', event);
  }

  /**
   * Add event to timeline
   * @private
   */
  _addEvent(type, message, data = {}) {
    const event = {
      timestamp: Date.now(),
      type, // start, success, error, warning, info, checkpoint
      message,
      data
    };

    this.state.events.unshift(event);

    // Keep only last 50 events
    if (this.state.events.length > 50) {
      this.state.events = this.state.events.slice(0, 50);
    }

    this.emit('event:added', event);
  }

  /**
   * Start web dashboard server
   * @private
   */
  async _startWebDashboard() {
    try {
      const express = require('express');
      const app = express();

      // Middleware for JSON parsing
      app.use(express.json());

      // Serve static dashboard HTML
      app.get('/', (req, res) => {
        res.send(this._getWebDashboardHTML());
      });

      // SSE endpoint for real-time updates
      app.get('/events', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Send current state immediately
        res.write(`data: ${JSON.stringify(this.state)}\n\n`);

        // Send updates on changes
        const updateHandler = () => {
          res.write(`data: ${JSON.stringify(this.state)}\n\n`);
        };

        this.on('metrics:updated', updateHandler);
        this.on('plan:updated', updateHandler);
        this.on('execution:updated', updateHandler);
        this.on('event:added', updateHandler);
        this.on('artifact:added', updateHandler);
        this.on('config:changed', updateHandler);

        // Clean up on disconnect
        req.on('close', () => {
          this.off('metrics:updated', updateHandler);
          this.off('plan:updated', updateHandler);
          this.off('execution:updated', updateHandler);
          this.off('event:added', updateHandler);
          this.off('artifact:added', updateHandler);
          this.off('config:changed', updateHandler);
        });
      });

      // API endpoint for current state
      app.get('/api/state', (req, res) => {
        res.json(this.state);
      });

      // API endpoint for metrics
      app.get('/api/metrics', (req, res) => {
        res.json({
          context: this.state.context,
          apiLimits: this.state.apiLimits,
          usage: this.state.usage,
          metrics: this.state.metrics
        });
      });

      // API endpoint for artifacts
      app.get('/api/artifacts', (req, res) => {
        res.json(this.state.artifacts);
      });

      // API endpoint to read file content
      app.get('/api/file', (req, res) => {
        try {
          const fs = require('fs');
          const path = require('path');
          const { filePath } = req.query;

          if (!filePath) {
            return res.status(400).json({ error: 'filePath parameter required' });
          }

          // Security: Only allow reading from project directory
          const absolutePath = path.resolve(filePath);
          const projectRoot = process.cwd();

          if (!absolutePath.startsWith(projectRoot)) {
            return res.status(403).json({ error: 'Access denied: Outside project directory' });
          }

          if (!fs.existsSync(absolutePath)) {
            return res.status(404).json({ error: 'File not found' });
          }

          const stats = fs.statSync(absolutePath);
          const content = fs.readFileSync(absolutePath, 'utf8');

          res.json({
            path: filePath,
            absolutePath,
            content,
            size: stats.size,
            modified: stats.mtime
          });

        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      });

      // API endpoint to update configuration
      app.post('/api/config', async (req, res) => {
        try {
          const { path, value } = req.body;

          if (!path) {
            return res.status(400).json({ error: 'path parameter required' });
          }

          const result = await this.updateConfig(path, value);
          res.json(result);

        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      });

      // API endpoint for human review queue
      app.get('/api/reviews', (req, res) => {
        res.json({
          pending: this.state.humanReview.pending,
          history: this.state.humanReview.history.slice(0, 20)
        });
      });

      // API endpoint to respond to review
      app.post('/api/review/:reviewId', async (req, res) => {
        try {
          const { reviewId } = req.params;
          const { approved, feedback, wasCorrect } = req.body;

          const result = await this.respondToReview(reviewId, {
            approved,
            feedback,
            wasCorrect
          });

          res.json(result);

        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      });

      this.webServer = app.listen(this.options.webPort, () => {
        this.logger.info('Web dashboard started', {
          url: `http://localhost:${this.options.webPort}`
        });
        console.log(`\n🌐 Dashboard available at: http://localhost:${this.options.webPort}\n`);
      });

    } catch (error) {
      this.logger.error('Failed to start web dashboard', {
        error: error.message
      });
    }
  }

  /**
   * Get web dashboard HTML
   * @private
   */
  _getWebDashboardHTML() {
    const { getDashboardHTML } = require('./dashboard-html');
    return getDashboardHTML();
  }

  /**
   * OLD HTML (REPLACED - keeping for reference)
   * @private
   */
  _getOldWebDashboardHTML() {
    return `
<!DOCTYPE html>
<html>
<head>
  <title>Claude Continuous Loop Monitor</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 30px;
      border-radius: 12px;
      margin-bottom: 20px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    }
    .header h1 { font-size: 32px; margin-bottom: 10px; }
    .header .session-id { opacity: 0.8; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; }
    .card {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    .card h2 {
      font-size: 18px;
      margin-bottom: 16px;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .progress-bar {
      background: #2a2a2a;
      height: 24px;
      border-radius: 12px;
      overflow: hidden;
      margin: 10px 0;
      position: relative;
    }
    .progress-fill {
      height: 100%;
      transition: width 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: bold;
    }
    .progress-fill.ok { background: linear-gradient(90deg, #10b981, #059669); }
    .progress-fill.warning { background: linear-gradient(90deg, #f59e0b, #d97706); }
    .progress-fill.critical { background: linear-gradient(90deg, #ef4444, #dc2626); }
    .progress-fill.emergency { background: linear-gradient(90deg, #991b1b, #7f1d1d); }
    .metric {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #2a2a2a;
    }
    .metric:last-child { border-bottom: none; }
    .metric-label { color: #9ca3af; }
    .metric-value { font-weight: 600; }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .status-badge.ok { background: #10b981; color: white; }
    .status-badge.warning { background: #f59e0b; color: white; }
    .status-badge.critical { background: #ef4444; color: white; }
    .status-badge.emergency { background: #991b1b; color: white; }
    .task-list { list-style: none; }
    .task-item {
      padding: 12px;
      margin: 8px 0;
      background: #2a2a2a;
      border-radius: 8px;
      border-left: 4px solid #666;
    }
    .task-item.completed { border-left-color: #10b981; opacity: 0.7; }
    .task-item.in_progress { border-left-color: #3b82f6; }
    .task-item.pending { border-left-color: #6b7280; }
    .event-list { list-style: none; max-height: 300px; overflow-y: auto; }
    .event-item {
      padding: 8px 12px;
      margin: 4px 0;
      background: #2a2a2a;
      border-radius: 6px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .event-time { color: #6b7280; font-size: 11px; min-width: 60px; }
    .event-icon { font-size: 16px; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .pulse { animation: pulse 2s ease-in-out infinite; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🤖 Claude Continuous Loop Monitor</h1>
      <div class="session-id">Session: <span id="sessionId">Loading...</span></div>
    </div>

    <div class="grid">
      <!-- Context Window -->
      <div class="card">
        <h2>📊 Context Window</h2>
        <div id="contextStatus"></div>
      </div>

      <!-- API Limits -->
      <div class="card">
        <h2>🌐 API Limits</h2>
        <div id="apiLimits"></div>
      </div>

      <!-- Token Usage -->
      <div class="card">
        <h2>💰 Token Usage</h2>
        <div id="tokenUsage"></div>
      </div>

      <!-- Current Execution -->
      <div class="card">
        <h2>⚙️ Current Execution</h2>
        <div id="currentExecution"></div>
      </div>

      <!-- Execution Plan -->
      <div class="card" style="grid-column: span 2;">
        <h2>📋 Execution Plan</h2>
        <ul id="executionPlan" class="task-list"></ul>
      </div>

      <!-- Recent Events -->
      <div class="card" style="grid-column: span 2;">
        <h2>🔔 Recent Events</h2>
        <ul id="recentEvents" class="event-list"></ul>
      </div>
    </div>
  </div>

  <script>
    const eventSource = new EventSource('/events');

    eventSource.onmessage = (event) => {
      const state = JSON.parse(event.data);
      updateDashboard(state);
    };

    function updateDashboard(state) {
      // Update session ID
      document.getElementById('sessionId').textContent = state.session.id;

      // Update context window
      const ctx = state.context;
      document.getElementById('contextStatus').innerHTML = \`
        <div class="metric">
          <span class="metric-label">Status</span>
          <span class="status-badge \${ctx.status}">\${ctx.status.toUpperCase()}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill \${ctx.status}" style="width: \${ctx.percentage}%">
            \${Math.round(ctx.percentage)}%
          </div>
        </div>
        <div class="metric">
          <span class="metric-label">Usage</span>
          <span class="metric-value">\${ctx.current.toLocaleString()} / \${ctx.limit.toLocaleString()} tokens</span>
        </div>
        <div class="metric">
          <span class="metric-label">Next Checkpoint</span>
          <span class="metric-value">\${Math.round(ctx.nextCheckpoint).toLocaleString()} tokens</span>
        </div>
      \`;

      // Update API limits
      if (state.apiLimits && state.apiLimits.enabled) {
        const limits = state.apiLimits.windows;
        document.getElementById('apiLimits').innerHTML = \`
          <div class="metric">
            <span class="metric-label">Plan</span>
            <span class="metric-value">\${state.apiLimits.plan.toUpperCase()}</span>
          </div>
          <div style="margin: 10px 0;">
            <div style="margin-bottom: 5px; color: #9ca3af; font-size: 12px;">Requests/min</div>
            <div class="progress-bar" style="height: 16px;">
              <div class="progress-fill ok" style="width: \${limits.minute.callsUtilization * 100}%"></div>
            </div>
            <div style="margin-top: 2px; font-size: 12px;">\${limits.minute.calls} / \${limits.minute.callsLimit}</div>
          </div>
          <div style="margin: 10px 0;">
            <div style="margin-bottom: 5px; color: #9ca3af; font-size: 12px;">Requests/day</div>
            <div class="progress-bar" style="height: 16px;">
              <div class="progress-fill ok" style="width: \${limits.day.callsUtilization * 100}%"></div>
            </div>
            <div style="margin-top: 2px; font-size: 12px;">\${limits.day.calls} / \${limits.day.callsLimit}</div>
          </div>
        \`;
      } else {
        document.getElementById('apiLimits').innerHTML = '<div class="metric"><span class="metric-label">Disabled</span></div>';
      }

      // Update token usage
      if (state.usage) {
        const usage = state.usage;
        document.getElementById('tokenUsage').innerHTML = \`
          <div class="metric">
            <span class="metric-label">Input Tokens</span>
            <span class="metric-value">\${usage.inputTokens?.toLocaleString() || 0}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Output Tokens</span>
            <span class="metric-value">\${usage.outputTokens?.toLocaleString() || 0}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Total Cost</span>
            <span class="metric-value">$\${(usage.totalCost || 0).toFixed(2)}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Cache Savings</span>
            <span class="metric-value">$\${(usage.cacheSavings || 0).toFixed(2)}</span>
          </div>
        \`;
      }

      // Update current execution
      const exec = state.execution;
      if (exec.task) {
        const duration = Math.floor(exec.duration / 1000);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        document.getElementById('currentExecution').innerHTML = \`
          <div class="metric">
            <span class="metric-label">Phase</span>
            <span class="metric-value">\${exec.phase || 'N/A'}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Agent</span>
            <span class="metric-value">\${exec.agent || 'N/A'}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Task</span>
            <span class="metric-value">\${typeof exec.task === 'string' ? exec.task.substring(0, 50) : 'Active'}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Duration</span>
            <span class="metric-value">\${minutes}m \${seconds}s</span>
          </div>
        \`;
      } else {
        document.getElementById('currentExecution').innerHTML = '<div class="metric"><span class="metric-label">Idle</span></div>';
      }

      // Update execution plan
      const planHTML = state.plan.tasks.map(task => \`
        <li class="task-item \${task.status}">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span>\${task.status === 'completed' ? '✅' : task.status === 'in_progress' ? '🔄' : '⏳'}</span>
            <span>\${task.content}</span>
          </div>
        </li>
      \`).join('');
      document.getElementById('executionPlan').innerHTML = planHTML || '<li class="task-item">No plan loaded</li>';

      // Update events
      const eventsHTML = state.events.slice(0, 10).map(event => {
        const time = new Date(event.timestamp).toLocaleTimeString();
        const icons = {
          start: '▶️',
          success: '✅',
          error: '❌',
          warning: '⚠️',
          info: 'ℹ️',
          checkpoint: '💾'
        };
        return \`
          <li class="event-item">
            <span class="event-time">\${time}</span>
            <span class="event-icon">\${icons[event.type] || 'ℹ️'}</span>
            <span>\${event.message}</span>
          </li>
        \`;
      }).join('');
      document.getElementById('recentEvents').innerHTML = eventsHTML || '<li class="event-item">No events</li>';
    }
  </script>
</body>
</html>
    `;
  }
}

module.exports = DashboardManager;
