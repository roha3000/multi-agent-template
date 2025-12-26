#!/usr/bin/env node

/**
 * Global Context Manager
 *
 * Monitors ALL Claude Code projects simultaneously.
 * Provides unified dashboard for context usage and account totals.
 *
 * Features:
 * - Multi-project monitoring
 * - Account-level usage tracking
 * - Per-project alerts
 * - Real-time SSE updates
 * - Estimated cost tracking
 *
 * @module global-context-manager
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const GlobalContextTracker = require('./.claude/core/global-context-tracker');
const PredictiveAnalytics = require('./.claude/core/predictive-analytics');
const TaskManager = require('./.claude/core/task-manager');
const TaskGraph = require('./.claude/core/task-graph');
const NotificationService = require('./.claude/core/notification-service');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files (dashboard)
app.use(express.static(__dirname));

// Initialize Global Context Tracker with thresholds from env
const tracker = new GlobalContextTracker({
  thresholds: {
    warning: parseFloat(process.env.CONTEXT_ALERT_THRESHOLD_WARNING || 70) / 100,
    critical: parseFloat(process.env.CONTEXT_ALERT_THRESHOLD_CRITICAL || 85) / 100,
    emergency: parseFloat(process.env.CONTEXT_ALERT_THRESHOLD_EMERGENCY || 95) / 100
  }
});

// Store recent alerts for dashboard
const recentAlerts = [];
const MAX_ALERTS = 50;

// Initialize Notification Service for SMS/Email alerts
const notificationService = new NotificationService();
let notificationStatus = { sms: { available: false }, email: { available: false } };

// Initialize notification service asynchronously
(async () => {
  try {
    notificationStatus = await notificationService.initialize();
    console.log('[NOTIFICATIONS] Initialized:', {
      sms: notificationStatus.sms.available ? 'Available' : `Unavailable (${notificationStatus.sms.error})`,
      email: notificationStatus.email.available ? 'Available' : `Unavailable (${notificationStatus.email.error})`
    });

    // Set up notification preferences from environment
    if (process.env.NOTIFICATIONS_ENABLED === 'true') {
      notificationService.savePreferences({
        enabled: true,
        channels: {
          sms: {
            enabled: !!process.env.NOTIFICATION_PHONE_NUMBER,
            phoneNumber: process.env.NOTIFICATION_PHONE_NUMBER || ''
          },
          email: {
            enabled: !!process.env.NOTIFICATION_EMAIL_ADDRESS,
            address: process.env.NOTIFICATION_EMAIL_ADDRESS || ''
          }
        }
      });
    }
  } catch (err) {
    console.error('[NOTIFICATIONS] Failed to initialize:', err.message);
  }
})();

// Initialize Predictive Analytics
const analytics = new PredictiveAnalytics({
  globalTracker: tracker,
  historyWindow: 30,
  predictionHorizon: 10,
});

// Forward exhaustion warnings to alerts
analytics.on('exhaustion-warning', (data) => {
  recentAlerts.unshift({
    timestamp: Date.now(),
    level: 'EXHAUSTION_WARNING',
    project: data.projectId,
    message: `Context exhaustion in ~${data.minutesToExhaustion} minutes`,
    data,
  });
  if (recentAlerts.length > MAX_ALERTS) recentAlerts.pop();
});

// Initialize TaskManager and TaskGraph for visualization
const tasksPath = path.join(__dirname, 'tasks.json');
let taskManager = null;
let taskGraph = null;

try {
  if (fs.existsSync(tasksPath)) {
    taskManager = new TaskManager({ persistPath: tasksPath });
    taskGraph = new TaskGraph(taskManager);
    console.log('[TASKS] TaskManager initialized for graph visualization');
  }
} catch (err) {
  console.log('[TASKS] TaskManager not available:', err.message);
}

// Session series tracking for continuous loop
let sessionSeries = {
  active: false,
  seriesId: null,
  startTime: null,
  sessions: [],
  currentSession: 0,
  totalTokens: 0,
  totalCost: 0,
};

// Execution state tracking (phases, quality scores, todos)
let executionState = {
  currentPhase: null,
  phaseIteration: 0,
  qualityScores: null,
  phaseHistory: [],
  todos: [],
  plan: null,
  lastUpdate: null,
};

// Confidence monitoring state (from ConfidenceMonitor)
let confidenceState = {
  confidence: null,
  level: 'healthy',
  signals: {
    qualityScore: 0,
    velocity: 0,
    iterations: 0,
    errorRate: 0,
    historical: 0
  },
  lastUpdate: null
};

// Competitive planning state (from CompetitivePlanner + PlanEvaluator)
let planComparison = {
  plans: [],
  winner: null,
  lastUpdate: null
};

// Task complexity state (from ComplexityAnalyzer)
let complexity = {
  score: null,
  strategy: null,
  dimensions: {},
  lastUpdate: null
};

// File watchers for dev-docs
let devDocsWatcher = null;

// ============================================================================
// EVENT HANDLERS
// ============================================================================

tracker.on('started', (data) => {
  console.log('\n' + '='.repeat(70));
  console.log('GLOBAL CONTEXT TRACKER STARTED');
  console.log('='.repeat(70));
  console.log(`Monitoring: ${data.claudeProjectsPath}`);
  console.log(`Projects discovered: ${data.projectCount}`);
  console.log('='.repeat(70) + '\n');
});

tracker.on('session:new', (data) => {
  console.log(`[NEW SESSION] ${data.projectName}: ${data.sessionId}`);
  addAlert({
    level: 'info',
    project: data.projectName,
    message: `New session started: ${data.sessionId.substring(0, 8)}...`
  });
});

tracker.on('usage:update', (data) => {
  const percent = data.metrics.contextPercent.toFixed(1);
  // Only log significant updates
  if (data.metrics.messageCount % 5 === 0 || data.metrics.contextPercent >= 50) {
    console.log(`[${data.projectName}] Context: ${percent}% | Messages: ${data.metrics.messageCount} | Cost: $${data.metrics.cost.toFixed(4)}`);
  }
});

tracker.on('alert:warning', async (data) => {
  const contextPercent = (data.utilization * 100);
  console.log('\n' + '*'.repeat(70));
  console.log(`*** WARNING: ${data.projectName} at ${contextPercent.toFixed(1)}% ***`);
  console.log('*'.repeat(70) + '\n');
  addAlert({
    level: 'warning',
    project: data.projectName,
    path: data.projectPath,
    message: `Context at ${contextPercent.toFixed(1)}% - State auto-saved`
  });

  // Send SMS/Email notification for 70% threshold
  try {
    await notificationService.alertContextThreshold({
      projectId: data.projectPath,
      projectName: data.projectName,
      contextPercent,
      threshold: 70
    });
  } catch (err) {
    console.error('[NOTIFICATION] Failed to send warning alert:', err.message);
  }
});

tracker.on('alert:critical', async (data) => {
  const contextPercent = (data.utilization * 100);
  console.log('\n' + '!'.repeat(70));
  console.log(`!!! CRITICAL: ${data.projectName} at ${contextPercent.toFixed(1)}% !!!`);
  console.log(`!!! Path: ${data.projectPath}`);
  console.log(`!!! Action: Consider running /clear soon`);
  console.log('!'.repeat(70) + '\n');
  addAlert({
    level: 'critical',
    project: data.projectName,
    path: data.projectPath,
    message: `Context at ${contextPercent.toFixed(1)}% - Run /clear soon!`
  });

  // Send SMS/Email notification for 85% threshold
  try {
    await notificationService.alertContextThreshold({
      projectId: data.projectPath,
      projectName: data.projectName,
      contextPercent,
      threshold: 85
    });
  } catch (err) {
    console.error('[NOTIFICATION] Failed to send critical alert:', err.message);
  }
});

tracker.on('alert:emergency', async (data) => {
  const contextPercent = (data.utilization * 100);
  console.log('\n' + '!'.repeat(70));
  console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.log(`!!! EMERGENCY: ${data.projectName} at ${contextPercent.toFixed(1)}% !!!`);
  console.log(`!!! Path: ${data.projectPath}`);
  console.log(`!!! Action: Run /clear NOW, then /session-init`);
  console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.log('!'.repeat(70) + '\n');
  addAlert({
    level: 'emergency',
    project: data.projectName,
    path: data.projectPath,
    message: `Context at ${contextPercent.toFixed(1)}% - Run /clear NOW!`
  });

  // Send SMS/Email notification for 95% threshold (emergency bypasses quiet hours)
  try {
    await notificationService.alertContextThreshold({
      projectId: data.projectPath,
      projectName: data.projectName,
      contextPercent,
      threshold: 95
    });
  } catch (err) {
    console.error('[NOTIFICATION] Failed to send emergency alert:', err.message);
  }
});

tracker.on('error', (error) => {
  console.error('[ERROR]', error);
});

function addAlert(alert) {
  recentAlerts.unshift({
    ...alert,
    timestamp: new Date().toISOString()
  });
  if (recentAlerts.length > MAX_ALERTS) {
    recentAlerts.pop();
  }
}

// ============================================================================
// DEV-DOCS FILE WATCHING
// ============================================================================

function readQualityScores() {
  const scoresPath = path.join(__dirname, '.claude', 'dev-docs', 'quality-scores.json');
  try {
    if (fs.existsSync(scoresPath)) {
      const content = fs.readFileSync(scoresPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    // Ignore parse errors
  }
  return null;
}

function readTasksFile() {
  const tasksPath = path.join(__dirname, '.claude', 'dev-docs', 'tasks.md');
  try {
    if (fs.existsSync(tasksPath)) {
      const content = fs.readFileSync(tasksPath, 'utf-8');
      return parseTasksMarkdown(content);
    }
  } catch (err) {
    // Ignore read errors
  }
  return { todos: [], phase: null };
}

function parseTasksMarkdown(content) {
  const todos = [];
  let currentPhase = null;

  // Extract current phase from header
  const phaseMatch = content.match(/Current Session[:\s]+([^\n]+)/i);
  if (phaseMatch) {
    currentPhase = phaseMatch[1].trim();
  }

  // Extract status
  const statusMatch = content.match(/Status[:\s]+([^\n]+)/i);
  const status = statusMatch ? statusMatch[1].trim() : null;

  // Parse checkbox items
  const checkboxPattern = /- \[([ xX])\] \*?\*?([^*\n]+)\*?\*?/g;
  let match;
  while ((match = checkboxPattern.exec(content)) !== null) {
    todos.push({
      completed: match[1].toLowerCase() === 'x',
      text: match[2].trim(),
    });
  }

  return { todos, phase: currentPhase, status };
}

function readPlanFile() {
  const planPath = path.join(__dirname, '.claude', 'dev-docs', 'plan.md');
  try {
    if (fs.existsSync(planPath)) {
      const content = fs.readFileSync(planPath, 'utf-8');
      return parsePlanMarkdown(content);
    }
  } catch (err) {
    // Ignore read errors
  }
  return null;
}

function parsePlanMarkdown(content) {
  // Extract phase from header
  const phaseMatch = content.match(/Current Phase[:\s]+([^\n]+)/i);
  const phase = phaseMatch ? phaseMatch[1].trim() : null;

  // Extract status
  const statusMatch = content.match(/Status[:\s]+([^\n]+)/i);
  const status = statusMatch ? statusMatch[1].trim() : null;

  // Extract success criteria checkboxes
  const criteria = [];
  const criteriaSection = content.match(/### Success Criteria[\s\S]*?(?=###|$)/i);
  if (criteriaSection) {
    const checkboxPattern = /- \[([ xX])\] ([^\n]+)/g;
    let match;
    while ((match = checkboxPattern.exec(criteriaSection[0])) !== null) {
      criteria.push({
        completed: match[1].toLowerCase() === 'x',
        text: match[2].trim(),
      });
    }
  }

  return { phase, status, criteria };
}

function updateExecutionState() {
  const scores = readQualityScores();
  const tasks = readTasksFile();
  const plan = readPlanFile();

  executionState.qualityScores = scores;
  executionState.todos = tasks.todos;
  executionState.plan = plan;
  executionState.lastUpdate = new Date().toISOString();

  // Update current phase from quality scores or tasks
  if (scores?.phase) {
    executionState.currentPhase = scores.phase;
    executionState.phaseIteration = scores.iteration || 1;
  } else if (tasks.phase) {
    executionState.currentPhase = tasks.phase;
  }

  // Record phase history if score changed
  if (scores && (!executionState.phaseHistory.length ||
      executionState.phaseHistory[executionState.phaseHistory.length - 1]?.totalScore !== scores.totalScore)) {
    executionState.phaseHistory.push({
      phase: scores.phase,
      iteration: scores.iteration,
      totalScore: scores.totalScore,
      timestamp: new Date().toISOString(),
    });
    // Keep last 20 entries
    if (executionState.phaseHistory.length > 20) {
      executionState.phaseHistory.shift();
    }
  }
}

function startDevDocsWatcher() {
  const devDocsPath = path.join(__dirname, '.claude', 'dev-docs');

  // Create directory if it doesn't exist
  if (!fs.existsSync(devDocsPath)) {
    fs.mkdirSync(devDocsPath, { recursive: true });
  }

  // Initial read
  updateExecutionState();

  // Watch for changes
  devDocsWatcher = chokidar.watch(devDocsPath, {
    persistent: true,
    ignoreInitial: true,
    usePolling: true,
    interval: 1000,
  });

  devDocsWatcher.on('change', (filePath) => {
    console.log(`[DEV-DOCS] File changed: ${path.basename(filePath)}`);
    updateExecutionState();
  });

  devDocsWatcher.on('add', (filePath) => {
    console.log(`[DEV-DOCS] File added: ${path.basename(filePath)}`);
    updateExecutionState();
  });

  console.log('[DEV-DOCS] Watching for changes in:', devDocsPath);
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

// Get all projects
app.get('/api/projects', (req, res) => {
  res.json({
    projects: tracker.getAllProjects(),
    accountTotals: tracker.getAccountTotals()
  });
});

// Get specific project
app.get('/api/projects/:folder', (req, res) => {
  const project = tracker.getProject(req.params.folder);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json(project);
});

// Get account totals
app.get('/api/account', (req, res) => {
  res.json(tracker.getAccountTotals());
});

// Get recent alerts
app.get('/api/alerts', (req, res) => {
  res.json({ alerts: recentAlerts });
});

// Reset checkpoints for a project
app.post('/api/projects/:folder/reset', (req, res) => {
  tracker.resetProjectCheckpoints(req.params.folder);
  res.json({ success: true });
});

// Health check endpoint
// Returns comprehensive system status including uptime, active projects, notification service, and memory usage
app.get('/api/health', (req, res) => {
  const memoryUsage = process.memoryUsage();

  res.json({
    status: tracker.isRunning ? 'healthy' : 'starting',
    uptime: process.uptime(),
    activeProjectsCount: tracker.projects.size,
    notificationService: {
      sms: notificationStatus.sms?.available || false,
      email: notificationStatus.email?.available || false,
      initialized: notificationService ? true : false
    },
    memory: {
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal,
      rss: memoryUsage.rss,
      external: memoryUsage.external
    },
    timestamp: new Date().toISOString()
  });
});

// ============================================================================
// SESSION SERIES API (for continuous loop orchestrator)
// ============================================================================

// Start a new session series
app.post('/api/series/start', (req, res) => {
  sessionSeries = {
    active: true,
    seriesId: Date.now(),
    startTime: new Date().toISOString(),
    sessions: [],
    currentSession: 0,
    totalTokens: 0,
    totalCost: 0,
  };
  console.log(`[SERIES] Started new session series: ${sessionSeries.seriesId}`);
  res.json({ success: true, seriesId: sessionSeries.seriesId });
});

// Record a completed session
app.post('/api/series/session', (req, res) => {
  const { sessionNumber, duration, exitReason, peakContext, tokens, cost } = req.body;

  sessionSeries.currentSession = sessionNumber;
  sessionSeries.sessions.push({
    sessionNumber,
    duration,
    exitReason,
    peakContext,
    tokens: tokens || 0,
    cost: cost || 0,
    timestamp: new Date().toISOString(),
  });
  sessionSeries.totalTokens += tokens || 0;
  sessionSeries.totalCost += cost || 0;

  console.log(`[SERIES] Session ${sessionNumber} completed: ${exitReason} (peak: ${peakContext?.toFixed(1)}%)`);
  res.json({ success: true });
});

// End the session series
app.post('/api/series/end', (req, res) => {
  sessionSeries.active = false;
  console.log(`[SERIES] Series ${sessionSeries.seriesId} ended. ${sessionSeries.sessions.length} sessions completed.`);
  res.json({ success: true, series: sessionSeries });
});

// Get current session series status
app.get('/api/series', (req, res) => {
  res.json(sessionSeries);
});

// ============================================================================
// EXECUTION STATE API
// ============================================================================

// Get current execution state (phase, scores, todos)
app.get('/api/execution', (req, res) => {
  updateExecutionState(); // Refresh before sending
  res.json(executionState);
});

// Update execution state (called by orchestrator)
app.post('/api/execution/phase', (req, res) => {
  const { phase, iteration } = req.body;
  executionState.currentPhase = phase;
  executionState.phaseIteration = iteration || 1;
  executionState.lastUpdate = new Date().toISOString();
  console.log(`[EXECUTION] Phase updated: ${phase} (iteration ${iteration})`);
  res.json({ success: true });
});

// Get quality scores
app.get('/api/execution/scores', (req, res) => {
  const scores = readQualityScores();
  res.json(scores || { phase: null, scores: {}, totalScore: 0 });
});

// Get todos from tasks.md
app.get('/api/execution/todos', (req, res) => {
  const tasks = readTasksFile();
  res.json(tasks);
});

// ============================================================================
// SWARM INTEGRATION ENDPOINTS (Confidence, Planning, Complexity)
// ============================================================================

// Get confidence state
app.get('/api/confidence', (req, res) => {
  res.json(confidenceState);
});

// Update confidence state (called by ConfidenceMonitor)
app.post('/api/confidence', (req, res) => {
  const { confidence, level, signals } = req.body;

  if (confidence !== undefined) confidenceState.confidence = confidence;
  if (level) confidenceState.level = level;
  if (signals) {
    confidenceState.signals = {
      ...confidenceState.signals,
      ...signals
    };
  }
  confidenceState.lastUpdate = new Date().toISOString();

  console.log(`[CONFIDENCE] Updated: ${confidence}% (${level})`);
  res.json({ success: true, confidenceState });
});

// Get plan comparison state
app.get('/api/plans', (req, res) => {
  res.json(planComparison);
});

// Update plan comparison (called by CompetitivePlanner + PlanEvaluator)
app.post('/api/plans', (req, res) => {
  const { plans, winner } = req.body;

  if (plans) planComparison.plans = plans;
  if (winner) planComparison.winner = winner;
  planComparison.lastUpdate = new Date().toISOString();

  console.log(`[PLANNING] Updated: ${plans?.length || 0} plans, winner: ${winner?.strategy || 'none'}`);
  res.json({ success: true, planComparison });
});

// Get complexity state
app.get('/api/complexity', (req, res) => {
  res.json(complexity);
});

// Update complexity state (called by ComplexityAnalyzer)
app.post('/api/complexity', (req, res) => {
  const { score, strategy, dimensions } = req.body;

  if (score !== undefined) complexity.score = score;
  if (strategy) complexity.strategy = strategy;
  if (dimensions) complexity.dimensions = dimensions;
  complexity.lastUpdate = new Date().toISOString();

  console.log(`[COMPLEXITY] Updated: ${score}/100 (${strategy})`);
  res.json({ success: true, complexity });
});

// Bulk update all swarm states (convenience endpoint)
app.post('/api/swarm/state', (req, res) => {
  const { confidence: confData, plans: planData, complexity: compData } = req.body;

  if (confData) {
    if (confData.confidence !== undefined) confidenceState.confidence = confData.confidence;
    if (confData.level) confidenceState.level = confData.level;
    if (confData.signals) confidenceState.signals = { ...confidenceState.signals, ...confData.signals };
    confidenceState.lastUpdate = new Date().toISOString();
  }

  if (planData) {
    if (planData.plans) planComparison.plans = planData.plans;
    if (planData.winner) planComparison.winner = planData.winner;
    planComparison.lastUpdate = new Date().toISOString();
  }

  if (compData) {
    if (compData.score !== undefined) complexity.score = compData.score;
    if (compData.strategy) complexity.strategy = compData.strategy;
    if (compData.dimensions) complexity.dimensions = compData.dimensions;
    complexity.lastUpdate = new Date().toISOString();
  }

  console.log(`[SWARM] Bulk state update received`);
  res.json({ success: true, confidenceState, planComparison, complexity });
});

// ============================================================================
// PREDICTIVE ANALYTICS ENDPOINTS
// ============================================================================

// Get all predictions
app.get('/api/predictions', (req, res) => {
  res.json(analytics.getSummary());
});

// Get prediction for specific project
app.get('/api/predictions/:projectId', (req, res) => {
  const prediction = analytics.getPrediction(req.params.projectId);
  const patterns = analytics.analyzePatterns(req.params.projectId);
  res.json({ prediction, patterns });
});

// Get cost recommendations
app.get('/api/recommendations', (req, res) => {
  res.json(analytics.getCostRecommendations());
});

// Get pattern analysis for project
app.get('/api/patterns/:projectId', (req, res) => {
  res.json(analytics.analyzePatterns(req.params.projectId));
});

// ============================================================================
// TASK GRAPH ENDPOINTS
// ============================================================================

// Get graph data for D3.js visualization
app.get('/api/tasks/graph', (req, res) => {
  if (!taskGraph) {
    return res.status(503).json({ error: 'TaskGraph not initialized' });
  }
  res.json({
    graph: taskGraph.generateGraphData(),
    statistics: taskGraph.getStatistics(),
  });
});

// Get task tree structure
app.get('/api/tasks/tree', (req, res) => {
  if (!taskGraph) {
    return res.status(503).json({ error: 'TaskGraph not initialized' });
  }
  res.json(taskGraph.generateTreeData());
});

// Get graph in DOT format (for Graphviz)
app.get('/api/tasks/dot', (req, res) => {
  if (!taskGraph) {
    return res.status(503).json({ error: 'TaskGraph not initialized' });
  }
  res.type('text/plain').send(taskGraph.toDOT());
});

// Get all tasks
app.get('/api/tasks', (req, res) => {
  if (!taskManager) {
    return res.status(503).json({ error: 'TaskManager not initialized' });
  }
  res.json({
    tasks: taskManager.getReadyTasks({ backlog: 'all' }),
    stats: taskManager.getStats(),
  });
});

// Update task status
app.post('/api/tasks/:id/status', (req, res) => {
  if (!taskManager) {
    return res.status(503).json({ error: 'TaskManager not initialized' });
  }
  const { status } = req.body;
  try {
    taskManager.updateStatus(req.params.id, status);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// SSE for real-time updates
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const sendUpdate = () => {
    const data = {
      type: 'update',
      projects: tracker.getAllProjects(),
      accountTotals: tracker.getAccountTotals(),
      alerts: recentAlerts.slice(0, 10),
      sessionSeries: sessionSeries,
      executionState: executionState,
      confidenceState: confidenceState,
      planComparison: planComparison,
      complexity: complexity,
      timestamp: new Date().toISOString()
    };
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send initial data
  sendUpdate();

  // Send updates on events
  const onUpdate = () => sendUpdate();
  tracker.on('usage:update', onUpdate);
  tracker.on('alert', onUpdate);
  tracker.on('session:new', onUpdate);

  // Also send periodic updates
  const interval = setInterval(sendUpdate, 3000);

  req.on('close', () => {
    clearInterval(interval);
    tracker.removeListener('usage:update', onUpdate);
    tracker.removeListener('alert', onUpdate);
    tracker.removeListener('session:new', onUpdate);
  });
});

// Serve the dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'global-dashboard.html'));
});

// ============================================================================
// NOTIFICATION API ENDPOINTS
// ============================================================================

// Get notification service status
app.get('/api/notifications/status', (req, res) => {
  res.json(notificationService.getStatus());
});

// Get notification preferences
app.get('/api/notifications/preferences', (req, res) => {
  res.json(notificationService.getPreferences());
});

// Update notification preferences
app.post('/api/notifications/preferences', (req, res) => {
  try {
    const updated = notificationService.savePreferences(req.body);
    res.json({ success: true, preferences: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get notification statistics
app.get('/api/notifications/stats', (req, res) => {
  res.json(notificationService.getStats());
});

// Send test notification
app.post('/api/notifications/test', async (req, res) => {
  const { channel } = req.body; // 'sms', 'email', or 'both'

  const testNotification = {
    type: 'test',
    title: 'Test Notification',
    message: 'This is a test notification from the Multi-Agent System.',
    level: 'info',
    data: { test: true, timestamp: new Date().toISOString() }
  };

  try {
    // Temporarily enable the service for testing
    const prefs = notificationService.getPreferences();
    const originalEnabled = prefs.enabled;

    if (!originalEnabled) {
      notificationService.savePreferences({ enabled: true });
    }

    const result = await notificationService.notify(testNotification);

    // Restore original enabled state
    if (!originalEnabled) {
      notificationService.savePreferences({ enabled: originalEnabled });
    }

    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger a context threshold alert manually (for testing)
app.post('/api/notifications/alert/context', async (req, res) => {
  const { projectName, contextPercent, threshold } = req.body;

  try {
    const result = await notificationService.alertContextThreshold({
      projectId: 'manual-test',
      projectName: projectName || 'Test Project',
      contextPercent: contextPercent || 85,
      threshold: threshold || 85
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger a phase completion alert manually (for testing/integration)
app.post('/api/notifications/alert/phase', async (req, res) => {
  const { phase, score, iterations, nextPhase } = req.body;

  try {
    const result = await notificationService.alertPhaseCompletion({
      phase: phase || 'research',
      score: score || 85,
      iterations: iterations || 1,
      nextPhase: nextPhase || 'design'
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger a task group completion alert (for testing/integration)
app.post('/api/notifications/alert/taskgroup', async (req, res) => {
  const { groupName, tasksCompleted, totalTasks, averageScore } = req.body;

  try {
    const result = await notificationService.alertTaskGroupCompletion({
      groupName: groupName || 'Sprint 1',
      tasksCompleted: tasksCompleted || 5,
      totalTasks: totalTasks || 5,
      averageScore: averageScore || 92
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// START SERVER
// ============================================================================

const PORT = process.env.PORT || 3033;

app.listen(PORT, async () => {
  console.log('\n' + '='.repeat(70));
  console.log('GLOBAL CONTEXT MANAGER');
  console.log('='.repeat(70));
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/global-dashboard.html`);
  console.log('');
  console.log('Endpoints:');
  console.log(`  GET  /api/projects     - All projects with metrics`);
  console.log(`  GET  /api/account      - Account-level totals`);
  console.log(`  GET  /api/alerts       - Recent alerts`);
  console.log(`  GET  /api/events       - SSE real-time stream`);
  console.log(`  GET  /api/health       - System health (uptime, projects, notifications, memory)`);
  console.log('');
  console.log('Predictive Analytics:');
  console.log(`  GET  /api/predictions      - All predictions + recommendations`);
  console.log(`  GET  /api/predictions/:id  - Prediction for specific project`);
  console.log(`  GET  /api/recommendations  - Cost optimization recommendations`);
  console.log(`  GET  /api/patterns/:id     - Pattern analysis for project`);
  console.log('');
  console.log('Task Graph (D3.js visualization):');
  console.log(`  GET  /api/tasks/graph      - Graph data for D3.js`);
  console.log(`  GET  /api/tasks/tree       - Tree structure`);
  console.log(`  GET  /api/tasks/dot        - DOT format (Graphviz)`);
  console.log(`  GET  /api/tasks            - All tasks with stats`);
  console.log(`  POST /api/tasks/:id/status - Update task status`);
  console.log(`  VIEW /task-graph.html      - Interactive graph UI`);
  console.log('');
  console.log('Thresholds:');
  console.log('  50% - Warning (state auto-saved)');
  console.log('  65% - Critical (consider /clear)');
  console.log('  75% - Emergency (MUST /clear now, before 77.5% auto-compact!)');
  console.log('');
  console.log('Execution State:');
  console.log('  GET  /api/execution     - Current phase, scores, todos');
  console.log('  GET  /api/execution/scores - Quality scores only');
  console.log('  GET  /api/execution/todos  - Todo list only');
  console.log('');
  console.log('Notifications (SMS/Email):');
  console.log('  GET  /api/notifications/status      - Service status');
  console.log('  GET  /api/notifications/preferences - Get preferences');
  console.log('  POST /api/notifications/preferences - Update preferences');
  console.log('  GET  /api/notifications/stats       - Send statistics');
  console.log('  POST /api/notifications/test        - Send test notification');
  console.log('  POST /api/notifications/alert/*     - Trigger alerts');
  console.log('  VIEW /notification-preferences.html - Preferences UI');
  console.log('='.repeat(70) + '\n');

  // Start dev-docs file watcher
  startDevDocsWatcher();

  // Start tracking
  await tracker.start();
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  if (devDocsWatcher) await devDocsWatcher.close();
  await tracker.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down...');
  if (devDocsWatcher) await devDocsWatcher.close();
  await tracker.stop();
  process.exit(0);
});
