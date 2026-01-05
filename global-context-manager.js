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

// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const EventEmitter = require('events');
const GlobalContextTracker = require('./.claude/core/global-context-tracker');
const PredictiveAnalytics = require('./.claude/core/predictive-analytics');
const TaskManager = require('./.claude/core/task-manager');
const TaskGraph = require('./.claude/core/task-graph');
const NotificationService = require('./.claude/core/notification-service');
const { getSessionRegistry } = require('./.claude/core/session-registry');
const { getUsageLimitTracker } = require('./.claude/core/usage-limit-tracker');
const { getLogStreamer } = require('./.claude/core/log-streamer');
const CoordinationDB = require('./.claude/core/coordination-db');
const HumanInLoopDetector = require('./.claude/core/human-in-loop-detector');
const ArtifactSummarizer = require('./.claude/core/artifact-summarizer');
const WebSocket = require('ws');

// ============================================================================
// CRITICAL: Process-level error handlers to prevent silent crashes
// ============================================================================

// Handle uncaught exceptions - log and exit gracefully
process.on('uncaughtException', (err, origin) => {
  console.error('\n[FATAL] Uncaught exception:', err.message);
  console.error('Origin:', origin);
  console.error('Stack:', err.stack);
  console.error('\nShutting down due to uncaught exception...');
  // Note: TaskManager cleanup happens in SIGTERM/SIGINT handlers
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('\n[ERROR] Unhandled Promise rejection:', reason);
  if (reason instanceof Error) {
    console.error('Stack:', reason.stack);
  }
  // Don't exit for unhandled rejections, but log them prominently
  // This allows the server to continue running for non-critical async errors
});

// ============================================================================

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

// Initialize CoordinationDB for task claims (lazy-loaded)
// CANONICAL PATH: .claude/dev-docs/.coordination/tasks.db (per ARCHITECTURE.md)
let coordinationDb = null;
function getCoordinationDb() {
  if (!coordinationDb) {
    try {
      const coordDbPath = path.join(__dirname, '.claude', 'dev-docs', '.coordination', 'tasks.db');
      // Ensure directory exists
      const coordDir = path.dirname(coordDbPath);
      if (!fs.existsSync(coordDir)) {
        fs.mkdirSync(coordDir, { recursive: true });
      }
      coordinationDb = new CoordinationDB(coordDbPath, { autoCleanup: false });
    } catch (error) {
      console.warn('[COORDINATION] Could not initialize CoordinationDB:', error.message);
    }
  }
  return coordinationDb;
}

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

// Initialize Human-in-Loop Detector (per-project Map)
const humanInLoopMap = new Map();

/**
 * Get or create HumanInLoopDetector for a project
 * @param {string} projectPath - Project directory path
 * @returns {HumanInLoopDetector} Detector instance
 */
function getHumanInLoopDetector(projectPath) {
  const normalizedPath = normalizeProjectPath(projectPath || defaultProjectPath);

  if (humanInLoopMap.has(normalizedPath)) {
    return humanInLoopMap.get(normalizedPath);
  }

  // Create new detector (no memoryStore dependency for now)
  const detector = new HumanInLoopDetector({}, {
    enabled: true,
    confidenceThreshold: 0.7,
    adaptiveThresholds: true
  });

  humanInLoopMap.set(normalizedPath, detector);
  console.log(`[HUMAN-IN-LOOP] Detector initialized for: ${path.basename(projectPath || defaultProjectPath)}`);

  return detector;
}

// Initialize Artifact Summarizer (per-project Map)
const artifactSummarizerMap = new Map();

/**
 * Get or create ArtifactSummarizer for a project
 * @param {string} projectPath - Project directory path
 * @returns {ArtifactSummarizer} Summarizer instance
 */
function getArtifactSummarizer(projectPath) {
  const normalizedPath = normalizeProjectPath(projectPath || defaultProjectPath);

  if (artifactSummarizerMap.has(normalizedPath)) {
    return artifactSummarizerMap.get(normalizedPath);
  }

  const summarizer = new ArtifactSummarizer(projectPath || defaultProjectPath);
  artifactSummarizerMap.set(normalizedPath, summarizer);
  console.log(`[ARTIFACTS] Summarizer initialized for: ${path.basename(projectPath || defaultProjectPath)}`);

  return summarizer;
}

// ============================================================================
// OTLP Integration (Optional - enable with ENABLE_OTLP=true)
// ============================================================================

let otlpReceiver = null;
const OTLP_PORT = parseInt(process.env.OTLP_PORT || '4318', 10);
const ENABLE_OTLP = process.env.ENABLE_OTLP === 'true';

if (ENABLE_OTLP) {
  try {
    const OTLPReceiver = require('./.claude/core/otlp-receiver');
    otlpReceiver = new OTLPReceiver({
      port: OTLP_PORT,
      host: '0.0.0.0'
    });

    // Wire OTLP metrics to GlobalContextTracker AND UsageLimitTracker
    otlpReceiver.on('metrics', (metrics) => {
      for (const metric of metrics) {
        // Extract project folder from attributes if available
        const projectFolder = metric.attributes?.['project.folder'] ||
                             metric.attributes?.project_folder ||
                             null;
        tracker.processOTLPMetric(metric, projectFolder);

        // Also update UsageLimitTracker for dashboard usage display
        // OTLP token metrics indicate a Claude API call occurred
        if (metric.name === 'claude_code.token.usage' ||
            metric.name === 'claude_code.request.count') {
          usageLimitTracker.recordMessage();
        }
      }
    });

    // Forward OTLP events to dashboard alerts
    otlpReceiver.on('metrics:received', (data) => {
      console.log(`[OTLP] Received ${data.count} metrics`);
    });

    console.log(`[OTLP] Integration enabled on port ${OTLP_PORT}`);
  } catch (err) {
    console.warn('[OTLP] Failed to initialize OTLPReceiver:', err.message);
    otlpReceiver = null;
  }
}

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

// ============================================================================
// PER-PROJECT TASK MANAGER AND EXECUTION STATE (Multi-Project Isolation)
// ============================================================================

// Map of project path -> TaskManager instance
const taskManagerMap = new Map();
// Map of project path -> TaskGraph instance
const taskGraphMap = new Map();
// Map of project path -> execution state object
const executionStateMap = new Map();

// Default project path (this dashboard's own project)
const defaultProjectPath = __dirname;

/**
 * Normalize project path for consistent Map keys
 * @param {string} projectPath - Raw project path
 * @returns {string} Normalized path (lowercase, forward slashes)
 */
function normalizeProjectPath(projectPath) {
  if (!projectPath) return normalizeProjectPath(defaultProjectPath);
  return projectPath.replace(/\\/g, '/').toLowerCase();
}

/**
 * Get or create TaskManager for a specific project
 * @param {string} projectPath - Project directory path
 * @returns {TaskManager|null} TaskManager instance or null if not available
 */
function getTaskManagerForProject(projectPath) {
  const normalizedPath = normalizeProjectPath(projectPath || defaultProjectPath);

  if (taskManagerMap.has(normalizedPath)) {
    return taskManagerMap.get(normalizedPath);
  }

  // Try to create a new TaskManager for this project
  const tasksJsonPath = path.join(projectPath || defaultProjectPath, '.claude', 'dev-docs', 'tasks.json');

  try {
    if (fs.existsSync(tasksJsonPath)) {
      const tm = new TaskManager({ persistPath: tasksJsonPath });
      const tg = new TaskGraph(tm);
      taskManagerMap.set(normalizedPath, tm);
      taskGraphMap.set(normalizedPath, tg);
      console.log(`[TASKS] TaskManager initialized for project: ${path.basename(projectPath || defaultProjectPath)}`);
      return tm;
    }
  } catch (err) {
    console.log(`[TASKS] TaskManager not available for ${projectPath}: ${err.message}`);
  }

  return null;
}

/**
 * Get TaskGraph for a specific project
 * @param {string} projectPath - Project directory path
 * @returns {TaskGraph|null} TaskGraph instance or null
 */
function getTaskGraphForProject(projectPath) {
  const normalizedPath = normalizeProjectPath(projectPath || defaultProjectPath);

  // Ensure TaskManager is initialized (which also creates TaskGraph)
  getTaskManagerForProject(projectPath);

  return taskGraphMap.get(normalizedPath) || null;
}

/**
 * Create default execution state object
 * @returns {Object} Fresh execution state
 */
function createDefaultExecutionState() {
  return {
    currentPhase: null,
    phaseIteration: 0,
    qualityScores: null,
    phaseHistory: [],
    todos: [],
    plan: null,
    lastUpdate: null,
    taskPhaseHistory: {},
    currentTaskId: null,
  };
}

/**
 * Get or create execution state for a specific project
 * @param {string} projectPath - Project directory path
 * @returns {Object} Execution state object
 */
function getExecutionStateForProject(projectPath) {
  const normalizedPath = normalizeProjectPath(projectPath || defaultProjectPath);

  if (!executionStateMap.has(normalizedPath)) {
    executionStateMap.set(normalizedPath, createDefaultExecutionState());
  }

  return executionStateMap.get(normalizedPath);
}

// Initialize default project's TaskManager (backward compatibility)
const defaultTaskManager = getTaskManagerForProject(defaultProjectPath);
const defaultTaskGraph = getTaskGraphForProject(defaultProjectPath);

// Legacy references for backward compatibility (deprecated, will use per-project)
let taskManager = defaultTaskManager;
let taskGraph = defaultTaskGraph;

// Initialize Session Registry and Usage Limit Tracker
const sessionRegistry = getSessionRegistry();
const usageLimitTracker = getUsageLimitTracker();
const logStreamer = getLogStreamer();
console.log('[COMMAND CENTER] Session Registry, Usage Limit Tracker, and Log Streamer initialized');

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

// Execution state tracking - Now uses per-project Map (executionStateMap above)
// Legacy reference for backward compatibility (deprecated)
let executionState = getExecutionStateForProject(defaultProjectPath);

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

// Event emitter for task changes (used to trigger SSE broadcasts)
const taskEvents = new EventEmitter();

// SSE clients for claim events
const sseClaimClients = new Set();

/**
 * Broadcast an event to all connected SSE clients
 * @param {Object} event - Event data to broadcast
 */
function broadcastSSE(event) {
  const data = JSON.stringify(event);
  for (const client of sseClaimClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch (error) {
      // Client disconnected, remove from set
      sseClaimClients.delete(client);
    }
  }
}

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

// Sync context data from GlobalContextTracker to SessionRegistry
// This links the two tracking systems so dashboard shows real context usage
// FIX: Use per-session metrics instead of project-level metrics to avoid duplicate context display
tracker.on('usage:update', (data) => {
  if (!data.metrics) return;

  const projectFolder = data.projectFolder;
  const projectName = data.projectName;
  const sessionId = data.sessionId; // Claude session ID that triggered this update

  // Get the specific session data from tracker (per-session metrics)
  const trackerProject = tracker.getProject(projectFolder);
  if (!trackerProject) return;

  // Find the specific session in tracker that matches this update
  const trackerSession = trackerProject.sessions?.find(s => s.id === sessionId);

  // Find matching registry session by claudeSessionId (exact match)
  // This ensures each registry session gets its own context data
  const registrySession = sessionRegistry.getByClaudeSessionId(sessionId);

  if (registrySession && trackerSession) {
    // Use per-session context data (not project-level aggregated metrics)
    const sessionTokens = (trackerSession.inputTokens || 0) + (trackerSession.outputTokens || 0) +
                          (trackerSession.cacheCreationTokens || 0) + (trackerSession.cacheReadTokens || 0);

    sessionRegistry.update(registrySession.id, {
      contextPercent: Math.round((trackerSession.contextPercent || 0) * 10) / 10,
      tokens: sessionTokens,
      inputTokens: trackerSession.inputTokens || 0,
      outputTokens: trackerSession.outputTokens || 0,
      cost: trackerSession.cost || 0,
      messages: trackerSession.messageCount || 0
    });
  } else if (registrySession) {
    // Fallback: If session not in tracker yet, use project metrics for this one session only
    const metrics = data.metrics;
    const totalTokens = (metrics.inputTokens || 0) + (metrics.outputTokens || 0) +
                        (metrics.cacheCreationTokens || 0) + (metrics.cacheReadTokens || 0);

    sessionRegistry.update(registrySession.id, {
      contextPercent: Math.round((metrics.contextPercent || 0) * 10) / 10,
      tokens: totalTokens,
      inputTokens: metrics.inputTokens || 0,
      outputTokens: metrics.outputTokens || 0,
      cost: metrics.cost || 0,
      messages: metrics.messageCount || 0
    });
  }
  // Note: Sessions without claudeSessionId won't be updated here
  // They can still get initial metrics during registration
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

/**
 * Read quality scores from a project's dev-docs
 * @param {string} [projectPath] - Project directory path (defaults to this project)
 * @returns {Object|null} Quality scores or null if not found
 */
function readQualityScores(projectPath) {
  const basePath = projectPath || defaultProjectPath;
  const scoresPath = path.join(basePath, '.claude', 'dev-docs', 'quality-scores.json');
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

/**
 * Read tasks from a project's tasks.json
 * @param {string} [projectPath] - Project directory path (defaults to this project)
 * @returns {Object} Parsed tasks with todos, phase, and status
 */
function readTasksFile(projectPath) {
  const basePath = projectPath || defaultProjectPath;
  const tasksJsonPath = path.join(basePath, '.claude', 'dev-docs', 'tasks.json');
  try {
    if (fs.existsSync(tasksJsonPath)) {
      const content = fs.readFileSync(tasksJsonPath, 'utf-8');
      return parseTasksJson(content);
    }
  } catch (err) {
    // Ignore read errors
  }
  return { todos: [], phase: null };
}

function parseTasksJson(content) {
  const todos = [];
  let currentPhase = null;
  let status = null;

  try {
    const data = JSON.parse(content);

    // Get tasks from the 'now' backlog tier
    const nowTasks = data.backlog?.now?.tasks || [];
    const allTasks = data.tasks || {};

    // Convert tasks to todo format
    for (const taskId of nowTasks) {
      const task = allTasks[taskId];
      if (task) {
        todos.push({
          completed: task.status === 'completed',
          text: task.title || taskId,
          phase: task.phase,
          priority: task.priority,
        });
        // Use first in-progress task's phase as current phase
        if (!currentPhase && task.status === 'in_progress') {
          currentPhase = task.phase;
        }
      }
    }

    // Determine overall status
    const completedCount = todos.filter(t => t.completed).length;
    if (completedCount === todos.length && todos.length > 0) {
      status = 'All tasks complete';
    } else if (completedCount > 0) {
      status = `${completedCount}/${todos.length} tasks complete`;
    } else {
      status = 'In progress';
    }
  } catch (err) {
    // JSON parse error
  }

  return { todos, phase: currentPhase, status };
}

/**
 * Read plan from a project's dev-docs
 * @param {string} [projectPath] - Project directory path (defaults to this project)
 * @returns {Object|null} Parsed plan or null if not found
 */
function readPlanFile(projectPath) {
  const basePath = projectPath || defaultProjectPath;
  const planPath = path.join(basePath, '.claude', 'dev-docs', 'plan.md');
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

/**
 * Update execution state for a specific project (or default)
 * @param {string} [projectPath] - Project directory path
 * @returns {Object} Updated execution state for the project
 */
function updateExecutionState(projectPath) {
  const state = getExecutionStateForProject(projectPath);
  const scores = readQualityScores(projectPath);
  const tasks = readTasksFile(projectPath);
  const plan = readPlanFile(projectPath);

  state.qualityScores = scores;
  state.todos = tasks.todos;
  state.plan = plan;
  state.lastUpdate = new Date().toISOString();

  // Update current phase from quality scores or tasks
  if (scores?.phase) {
    state.currentPhase = scores.phase;
    state.phaseIteration = scores.iteration || 1;
  } else if (tasks.phase) {
    state.currentPhase = tasks.phase;
  }

  // Record phase history if score changed
  if (scores && (!state.phaseHistory.length ||
      state.phaseHistory[state.phaseHistory.length - 1]?.totalScore !== scores.totalScore)) {
    state.phaseHistory.push({
      phase: scores.phase,
      iteration: scores.iteration,
      totalScore: scores.totalScore,
      timestamp: new Date().toISOString(),
    });
    // Keep last 20 entries
    if (state.phaseHistory.length > 20) {
      state.phaseHistory.shift();
    }
  }

  // Update legacy reference for backward compatibility
  if (!projectPath || normalizeProjectPath(projectPath) === normalizeProjectPath(defaultProjectPath)) {
    executionState = state;
  }

  return state;
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
    const fileName = path.basename(filePath);
    console.log(`[DEV-DOCS] File changed: ${fileName}`);
    updateExecutionState();

    // Emit task change event when tasks.json is modified
    if (fileName === 'tasks.json') {
      console.log('[TASKS] tasks.json changed - broadcasting update');
      // Reload taskManager to get fresh data
      if (taskManager) {
        try {
          taskManager.load();
        } catch (err) {
          // Ignore reload errors
        }
      }
      taskEvents.emit('tasks:changed');
    }
  });

  devDocsWatcher.on('add', (filePath) => {
    const fileName = path.basename(filePath);
    console.log(`[DEV-DOCS] File added: ${fileName}`);
    updateExecutionState();

    // Emit task change event when tasks.json is added
    if (fileName === 'tasks.json') {
      console.log('[TASKS] tasks.json added - broadcasting update');
      taskEvents.emit('tasks:changed');
    }
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
// SESSION LAUNCHER API (Dashboard v4)
// ============================================================================

// Launch a new Claude Code CLI session
app.post('/api/sessions/launch', (req, res) => {
  const { projectPath } = req.body;

  // Validate projectPath is provided
  if (!projectPath) {
    return res.status(400).json({
      success: false,
      message: 'Project path is required'
    });
  }

  // Validate path exists
  const fs = require('fs');
  if (!fs.existsSync(projectPath)) {
    return res.status(400).json({
      success: false,
      message: `Project path does not exist: ${projectPath}`
    });
  }

  // Launch CLI in new terminal window (Windows)
  const { exec } = require('child_process');
  const command = process.platform === 'win32'
    ? `start cmd /k "cd /d ${projectPath} && claude --dangerously-skip-permissions"`
    : `osascript -e 'tell app "Terminal" to do script "cd ${projectPath} && claude --dangerously-skip-permissions"'`;

  exec(command, (error) => {
    if (error) {
      console.error('[Dashboard] Failed to launch session:', error.message);
      return res.status(500).json({
        success: false,
        message: `Failed to launch session: ${error.message}`
      });
    }

    console.log(`[Dashboard] Launched new session in: ${projectPath}`);
    res.json({
      success: true,
      message: `Session launched in ${projectPath}`
    });
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
// Supports ?projectPath= query param for per-project isolation
app.get('/api/execution', (req, res) => {
  const projectPath = req.query.projectPath;
  const state = updateExecutionState(projectPath);
  res.json(state);
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

// Get quality scores - supports ?projectPath= query param
app.get('/api/execution/scores', (req, res) => {
  const projectPath = req.query.projectPath;
  const scores = readQualityScores(projectPath);
  res.json(scores || { phase: null, scores: {}, totalScore: 0 });
});

// Get todos from tasks.json - supports ?projectPath= query param
app.get('/api/execution/todos', (req, res) => {
  const projectPath = req.query.projectPath;
  const tasks = readTasksFile(projectPath);
  res.json(tasks);
});

// ============================================================================
// TASK PHASE TRACKING ENDPOINTS
// ============================================================================

// Get task phase history for all tasks
app.get('/api/execution/taskPhases', (req, res) => {
  res.json({
    taskPhaseHistory: executionState.taskPhaseHistory,
    currentTaskId: executionState.currentTaskId,
    currentPhase: executionState.currentPhase
  });
});

// Get phase history for a specific task
app.get('/api/execution/taskPhases/:taskId', (req, res) => {
  const { taskId } = req.params;
  const taskPhases = executionState.taskPhaseHistory[taskId] || {
    phases: [],
    currentPhase: null,
    scores: {}
  };
  res.json(taskPhases);
});

// Update task phase progress (called by autonomous-orchestrator)
app.post('/api/execution/taskPhases', (req, res) => {
  const { taskId, taskTitle, phase, score, action } = req.body;

  if (!taskId) {
    return res.status(400).json({ error: 'taskId is required' });
  }

  // Initialize task entry if needed
  if (!executionState.taskPhaseHistory[taskId]) {
    executionState.taskPhaseHistory[taskId] = {
      title: taskTitle || taskId,
      phases: [],
      currentPhase: null,
      scores: {},
      startTime: new Date().toISOString()
    };
  }

  const taskEntry = executionState.taskPhaseHistory[taskId];

  if (action === 'start') {
    // Starting a new phase
    taskEntry.currentPhase = phase;
    executionState.currentTaskId = taskId;
    executionState.currentPhase = phase;
    console.log(`[TASK-PHASE] Task "${taskTitle || taskId}" starting ${phase} phase`);
  } else if (action === 'complete') {
    // Completing a phase
    if (phase && !taskEntry.phases.includes(phase)) {
      taskEntry.phases.push(phase);
    }
    if (score !== undefined) {
      taskEntry.scores[phase] = score;
    }
    console.log(`[TASK-PHASE] Task "${taskTitle || taskId}" completed ${phase} (score: ${score || 'N/A'})`);
  } else if (action === 'finish') {
    // Task fully complete (all phases done)
    taskEntry.currentPhase = null;
    taskEntry.completedTime = new Date().toISOString();
    executionState.currentTaskId = null;
    console.log(`[TASK-PHASE] Task "${taskTitle || taskId}" finished all phases`);
  }

  taskEntry.lastUpdate = new Date().toISOString();
  executionState.lastUpdate = new Date().toISOString();

  // Emit event for SSE broadcast
  taskEvents.emit('taskPhaseUpdate', { taskId, taskEntry });

  res.json({ success: true, taskEntry });
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

// Get all tasks - supports ?projectPath= query param for per-project isolation
app.get('/api/tasks', (req, res) => {
  const projectPath = req.query.projectPath;
  const tm = projectPath ? getTaskManagerForProject(projectPath) : taskManager;

  if (!tm) {
    // If no TaskManager, return empty data instead of error (more graceful)
    return res.json({
      tasks: [],
      stats: { total: 0, now: 0, next: 0, later: 0, completed: 0, ready: 0, inProgress: 0 },
      projectPath: projectPath || defaultProjectPath
    });
  }
  res.json({
    tasks: tm.getReadyTasks({ backlog: 'all' }),
    stats: tm.getStats(),
    projectPath: projectPath || defaultProjectPath
  });
});

// Reload tasks from disk (useful after external edits to tasks.json)
app.post('/api/tasks/reload', (req, res) => {
  if (!taskManager) {
    return res.status(503).json({ error: 'TaskManager not initialized' });
  }
  try {
    taskManager.reload();
    console.log('[TASK MANAGER] Tasks reloaded from disk');
    res.json({ success: true, stats: taskManager.getStats() });
  } catch (err) {
    console.error('[TASK MANAGER] Reload error:', err);
    res.status(500).json({ error: err.message });
  }
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

// ====================================================================
// TASK CLAIMS ENDPOINTS (Session-Task Claiming)
// ====================================================================

// Claim a task for a session
app.post('/api/tasks/:taskId/claim', (req, res) => {
  const { taskId } = req.params;
  const { sessionId, ttlMs, metadata, projectPath, agentType } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'SESSION_ID_REQUIRED', message: 'sessionId is required' });
  }

  const db = getCoordinationDb();
  if (!db) {
    return res.status(503).json({ error: 'COORDINATION_DB_UNAVAILABLE' });
  }

  try {
    // Auto-register session if it doesn't exist in CoordinationDB
    const existingSession = db._stmts && db._stmts.getSession ? db._stmts.getSession.get(sessionId) : null;
    if (!existingSession) {
      db.registerSession(sessionId, projectPath || process.cwd(), agentType || 'unknown');
    }

    const result = db.claimTask(taskId, sessionId, { ttlMs, metadata, agentType });
    if (result.claimed) {
      // Broadcast SSE event
      broadcastSSE({ type: 'task:claimed', taskId, sessionId, claim: result.claim });
      res.json(result);
    } else if (result.error === 'TASK_ALREADY_CLAIMED') {
      res.status(409).json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('[CLAIM] Error claiming task:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
  }
});

// Release a task claim
app.post('/api/tasks/:taskId/release', (req, res) => {
  const { taskId } = req.params;
  const { sessionId, reason } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'SESSION_ID_REQUIRED', message: 'sessionId is required' });
  }

  const db = getCoordinationDb();
  if (!db) {
    return res.status(503).json({ error: 'COORDINATION_DB_UNAVAILABLE' });
  }

  try {
    const result = db.releaseClaim(taskId, sessionId, reason || 'manual_release');
    if (result.success) {
      // Broadcast SSE event
      broadcastSSE({ type: 'task:released', taskId, sessionId, reason: reason || 'manual_release' });
      res.json(result);
    } else if (result.error === 'CLAIM_NOT_FOUND') {
      res.status(404).json(result);
    } else if (result.error === 'NOT_CLAIM_OWNER') {
      res.status(403).json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('[CLAIM] Error releasing claim:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
  }
});

// Refresh/extend claim TTL (heartbeat)
app.post('/api/tasks/:taskId/claim/heartbeat', (req, res) => {
  const { taskId } = req.params;
  const { sessionId, ttlMs } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'SESSION_ID_REQUIRED', message: 'sessionId is required' });
  }

  const db = getCoordinationDb();
  if (!db) {
    return res.status(503).json({ error: 'COORDINATION_DB_UNAVAILABLE' });
  }

  try {
    const result = db.refreshClaim(taskId, sessionId, ttlMs);
    if (result.success) {
      res.json(result);
    } else if (result.error === 'CLAIM_NOT_FOUND') {
      res.status(404).json(result);
    } else if (result.error === 'NOT_CLAIM_OWNER') {
      res.status(403).json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('[CLAIM] Error refreshing claim:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
  }
});

// Get all in-flight (claimed) tasks
app.get('/api/tasks/in-flight', (req, res) => {
  const db = getCoordinationDb();
  if (!db) {
    return res.status(503).json({ error: 'COORDINATION_DB_UNAVAILABLE' });
  }

  try {
    const sessionId = req.query.session || null;
    const includeExpired = req.query.includeExpired === 'true';
    const limit = parseInt(req.query.limit) || 100;

    let claims;
    if (sessionId) {
      claims = db.getClaimsBySession(sessionId);
    } else {
      claims = db.getActiveClaims();
    }

    // Filter expired if needed
    if (!includeExpired) {
      const now = Date.now();
      claims = claims.filter(c => c.expiresAt > now);
    }

    // Apply limit
    claims = claims.slice(0, limit);

    res.json({
      success: true,
      claims,
      count: claims.length
    });
  } catch (error) {
    console.error('[CLAIM] Error getting in-flight tasks:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
  }
});

// Get current task for a session
app.get('/api/sessions/:sessionId/current-task', (req, res) => {
  const { sessionId } = req.params;
  const db = getCoordinationDb();
  if (!db) {
    return res.status(503).json({ error: 'COORDINATION_DB_UNAVAILABLE' });
  }

  try {
    const claims = db.getClaimsBySession(sessionId);
    const now = Date.now();
    const activeClaims = claims.filter(c => c.expiresAt > now);

    if (activeClaims.length === 0) {
      return res.json({ sessionId, currentTask: null });
    }

    // Return most recent claim
    const currentClaim = activeClaims.sort((a, b) => b.claimedAt - a.claimedAt)[0];

    // Get task details if TaskManager available
    let taskDetails = null;
    if (taskManager) {
      try {
        taskDetails = taskManager.getTask(currentClaim.taskId);
      } catch (e) {
        // Ignore - task might not exist
      }
    }

    res.json({
      sessionId,
      currentTask: {
        taskId: currentClaim.taskId,
        claimedAt: currentClaim.claimedAt,
        expiresAt: currentClaim.expiresAt,
        lastHeartbeat: currentClaim.lastHeartbeat,
        metadata: currentClaim.metadata,
        task: taskDetails
      }
    });
  } catch (error) {
    console.error('[CLAIM] Error getting current task:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
  }
});

// Trigger cleanup of orphaned/expired claims
app.post('/api/tasks/claims/cleanup', (req, res) => {
  const db = getCoordinationDb();
  if (!db) {
    return res.status(503).json({ error: 'COORDINATION_DB_UNAVAILABLE' });
  }

  try {
    const expiredResult = db.cleanupExpiredClaims();
    const orphanedResult = db.cleanupOrphanedClaims();

    const totalCleaned = (expiredResult.cleaned || 0) + (orphanedResult.cleaned || 0);

    if (totalCleaned > 0) {
      broadcastSSE({ type: 'claims:cleanup', cleaned: totalCleaned });
    }

    res.json({
      success: true,
      expired: expiredResult,
      orphaned: orphanedResult,
      totalCleaned
    });
  } catch (error) {
    console.error('[CLAIM] Error cleaning up claims:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
  }
});

// Get claim statistics
app.get('/api/tasks/claims/stats', (req, res) => {
  const db = getCoordinationDb();
  if (!db) {
    return res.status(503).json({ error: 'COORDINATION_DB_UNAVAILABLE' });
  }

  try {
    const stats = db.getClaimStats();
    res.json(stats);
  } catch (error) {
    console.error('[CLAIM] Error getting claim stats:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
  }
});

// ====================================================================

// SSE for claim events real-time updates
app.get('/api/sse/claims', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  // Add client to broadcast set
  sseClaimClients.add(res);

  // Send initial claim state
  const db = getCoordinationDb();
  if (db) {
    try {
      const claims = db.getActiveClaims();
      const stats = db.getClaimStats();
      res.write(`data: ${JSON.stringify({ type: 'claims:initial', claims, stats })}\n\n`);
    } catch (error) {
      console.error('[SSE/CLAIMS] Error sending initial state:', error);
    }
  }

  // Remove client on disconnect
  req.on('close', () => {
    sseClaimClients.delete(res);
  });
});

// SSE for real-time updates
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  // Also add to claim clients for claim events
  sseClaimClients.add(res);

  const sendUpdate = () => {
    // Get fresh task data from tasks.json
    let taskData = null;
    try {
      if (taskManager) {
        taskData = {
          inProgress: taskManager.getReadyTasks({ backlog: 'now' }).filter(t => t.status === 'in_progress'),
          ready: taskManager.getReadyTasks({ backlog: 'now' }).filter(t => t.status === 'ready'),
          stats: taskManager.getStats()
        };
      }
    } catch (err) {
      // Ignore errors, taskData will be null
    }

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
      taskData: taskData,
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

  // Also listen for task changes (when tasks.json is modified)
  taskEvents.on('tasks:changed', onUpdate);

  // Listen for task phase updates
  taskEvents.on('taskPhaseUpdate', onUpdate);

  // Also send periodic updates
  const interval = setInterval(sendUpdate, 3000);

  req.on('close', () => {
    clearInterval(interval);
    tracker.removeListener('usage:update', onUpdate);
    tracker.removeListener('alert', onUpdate);
    tracker.removeListener('session:new', onUpdate);
    taskEvents.removeListener('tasks:changed', onUpdate);
    // Also remove from claim clients
    sseClaimClients.delete(res);
  });
});

// Serve the dashboard (v2 is now the default, renamed to global-dashboard.html)
app.get('/', (req, res) => {
  // Set no-cache headers to ensure fresh content
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
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
// COMMAND CENTER API ENDPOINTS (Session Registry + Usage Limits)
// ============================================================================

// Get all sessions summary (Command Center main data)
app.get('/api/sessions/summary', (req, res) => {
  const summary = sessionRegistry.getSummary();

  // Get claimed tasks for each session from CoordinationDB
  const db = getCoordinationDb();
  const sessionClaimsMap = new Map();

  if (db) {
    try {
      // Get all active claims and map by session
      const activeClaims = db.getActiveClaims();
      for (const claim of activeClaims) {
        if (!sessionClaimsMap.has(claim.sessionId)) {
          sessionClaimsMap.set(claim.sessionId, []);
        }
        sessionClaimsMap.get(claim.sessionId).push(claim);
      }
    } catch (error) {
      console.warn('[SESSIONS/SUMMARY] Could not get claims:', error.message);
    }
  }

  res.json({
    globalMetrics: {
      activeCount: summary.metrics.activeCount,
      tasksCompletedToday: summary.metrics.tasksCompletedToday,
      avgHealthScore: summary.metrics.avgHealthScore,
      totalCostToday: summary.metrics.totalCostToday,
      alertCount: summary.metrics.alertCount
    },
    sessions: summary.sessions.map(s => {
      // Find claimed task for this session (convert to string for CoordinationDB compatibility)
      const claims = sessionClaimsMap.get(String(s.id)) || [];
      const currentClaim = claims.length > 0
        ? claims.sort((a, b) => b.claimedAt - a.claimedAt)[0]
        : null;

      return {
        id: s.id,
        project: s.project,
        path: s.path,
        status: s.status,
        contextPercent: s.contextPercent,
        currentTask: s.currentTask,
        nextTask: s.nextTask,
        qualityScore: s.qualityScore,
        confidenceScore: s.confidenceScore,
        tokens: s.tokens,
        // Include individual token counts and messages for dashboard display
        inputTokens: s.inputTokens || 0,
        outputTokens: s.outputTokens || 0,
        messages: s.messages || 0,
        cost: s.cost,
        runtime: s.runtime,
        iteration: s.iteration,
        phase: s.phase,
        // Timing for dashboard activity filtering
        startTime: s.startTime,
        lastUpdate: s.lastUpdate,
        endedAt: s.endedAt || null,
        // Session type tracking
        sessionType: s.sessionType,
        autonomous: s.autonomous,
        orchestratorInfo: s.orchestratorInfo,
        logSessionId: s.logSessionId,
        claudeSessionId: s.claudeSessionId,
        // Hierarchy info for parent-child relationships
        hierarchyInfo: s.hierarchyInfo || null,
        // Task claim tracking (Phase 3)
        currentTaskId: currentClaim?.taskId || null,
        claimInfo: currentClaim ? {
          taskId: currentClaim.taskId,
          claimedAt: currentClaim.claimedAt,
          expiresAt: currentClaim.expiresAt,
          lastHeartbeat: currentClaim.lastHeartbeat
        } : null
      };
    }),
    recentCompletions: summary.recentCompletions
  });
});

// Get single session detail
app.get('/api/sessions/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const session = sessionRegistry.get(id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json(session);
});

// Get session hierarchy tree (for lineage visualization)
app.get('/api/sessions/:id/hierarchy', (req, res) => {
  const sessionId = req.params.id;

  // Try to find the session
  const numericId = parseInt(sessionId, 10);
  const session = !isNaN(numericId) ? sessionRegistry.get(numericId) : null;

  if (!session) {
    return res.status(404).json({ error: 'Session not found', sessionId });
  }

  // Get delegation data from session registry
  const allDelegations = sessionRegistry.getAllDelegations ? sessionRegistry.getAllDelegations(session.id) : { active: [], completed: [] };
  const childSessions = sessionRegistry.getChildSessions ? sessionRegistry.getChildSessions(session.id) : [];

  // Return hierarchy structure with actual delegation data
  res.json({
    sessionId: session.id,
    project: session.project,
    sessionType: session.sessionType,
    parentId: session.hierarchyInfo?.parentSessionId || session.parentId || null,
    children: childSessions.map(child => ({
      id: child.id,
      project: child.project,
      sessionType: child.sessionType,
      status: child.status
    })),
    delegations: allDelegations.active || [],
    completedDelegations: allDelegations.completed || [],
    depth: session.depth || 0
  });
});

// Register a new session (called by orchestrator on startup or SessionStart hook)
app.post('/api/sessions/register', (req, res) => {
  const { project, path: projectPath, currentTask, status, sessionType, autonomous, orchestratorInfo, logSessionId, claudeSessionId, parentSessionId } = req.body;

  // Deduplication logic to prevent duplicate sessions
  // 1. By claudeSessionId - prevents hook from overwriting orchestrator session
  // 2. By project path for autonomous - orchestrator upgrades existing CLI session

  // Check by claudeSessionId first
  if (claudeSessionId) {
    const existingSession = sessionRegistry.getByClaudeSessionId(claudeSessionId);
    if (existingSession) {
      // Session already exists - don't create duplicate
      // Never downgrade sessionType (autonomous should stay autonomous)
      const updates = {
        status: status || existingSession.status,
        currentTask: currentTask || existingSession.currentTask
      };

      // Upgrade to autonomous if requested
      if (sessionType === 'autonomous' && existingSession.sessionType !== 'autonomous') {
        updates.sessionType = 'autonomous';
        updates.autonomous = true;
        updates.orchestratorInfo = orchestratorInfo || existingSession.orchestratorInfo;
      }

      sessionRegistry.update(existingSession.id, updates);
      console.log(`[COMMAND CENTER] Session dedupe (claudeSessionId): ${existingSession.id} (${project}) [${existingSession.sessionType}] - ignored ${sessionType}`);
      return res.json({ success: true, id: existingSession.id, deduplicated: true });
    }
  }

  // For autonomous registrations without claudeSessionId, check for existing sessions to reuse
  if (sessionType === 'autonomous' && !claudeSessionId && projectPath) {
    const allSessions = sessionRegistry.getAll();
    const normalizedPath = projectPath.replace(/\\/g, '/').toLowerCase();

    // Helper to match project paths
    const pathMatches = (sessionPath) => {
      const normalized = (sessionPath || '').replace(/\\/g, '/').toLowerCase();
      return normalized === normalizedPath ||
             normalized.includes(normalizedPath) ||
             normalizedPath.includes(normalized);
    };

    // Priority 1: Find existing autonomous sessions for same project and END them (stale cleanup)
    // This prevents ghost sessions from accumulating when orchestrator crashes
    const staleAutonomousSessions = allSessions.filter(s =>
      pathMatches(s.path) &&
      s.sessionType === 'autonomous' &&
      s.status !== 'ended'
    );

    if (staleAutonomousSessions.length > 0) {
      console.log(`[COMMAND CENTER] Cleaning up ${staleAutonomousSessions.length} stale autonomous session(s) for ${project}`);
      staleAutonomousSessions.forEach(s => {
        sessionRegistry.deregister(s.id);
        console.log(`[COMMAND CENTER] Ended stale session: ${s.id}`);
      });
    }

    // Priority 2: Check for recent CLI session to upgrade (within 5 minutes)
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    const recentCliSession = allSessions
      .filter(s => {
        const isMatch = pathMatches(s.path);
        const isRecent = new Date(s.startTime).getTime() > fiveMinutesAgo;
        const isCli = s.sessionType === 'cli';
        const notEnded = s.status !== 'ended';
        return isMatch && isRecent && isCli && notEnded;
      })
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))[0];

    if (recentCliSession) {
      // Upgrade the CLI session to autonomous
      const updates = {
        sessionType: 'autonomous',
        autonomous: true,
        status: status || recentCliSession.status,
        currentTask: currentTask || recentCliSession.currentTask,
        orchestratorInfo: orchestratorInfo || null,
        logSessionId: logSessionId || recentCliSession.logSessionId
      };

      sessionRegistry.update(recentCliSession.id, updates);
      console.log(`[COMMAND CENTER] Session upgraded: ${recentCliSession.id} (${project}) cli -> autonomous`);
      return res.json({ success: true, id: recentCliSession.id, upgraded: true });
    }
  }

  // Try to get initial context data from tracker
  // FIX: Use per-session metrics when claudeSessionId is available
  // Field names must match what dashboard expects
  let initialMetrics = {
    contextPercent: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    messages: 0
  };

  try {
    const trackerProjects = tracker.getAllProjects();
    const projectName = project || 'unknown';
    const normalizedPath = (projectPath || '').replace(/\\/g, '/').toLowerCase();

    for (const proj of trackerProjects) {
      const trackerPath = (proj.path || '').replace(/\\/g, '/').toLowerCase();
      const pathMatch = normalizedPath && trackerPath && (
        normalizedPath.includes(trackerPath) || trackerPath.includes(normalizedPath)
      );
      const nameMatch = proj.name?.toLowerCase() === projectName.toLowerCase();

      if (pathMatch || nameMatch) {
        // FIX: Look for per-session data first if claudeSessionId provided
        if (claudeSessionId && proj.sessions) {
          const sessionData = proj.sessions.find(s => s.id === claudeSessionId);
          if (sessionData) {
            // Use per-session metrics (not project-level aggregated)
            initialMetrics = {
              contextPercent: sessionData.contextPercent || 0,
              tokens: (sessionData.inputTokens || 0) + (sessionData.outputTokens || 0) +
                      (sessionData.cacheCreationTokens || 0) + (sessionData.cacheReadTokens || 0),
              inputTokens: sessionData.inputTokens || 0,
              outputTokens: sessionData.outputTokens || 0,
              cost: sessionData.cost || 0,
              messages: sessionData.messageCount || 0
            };
            break;
          }
        }
        // Fallback: For new sessions without tracker data, start with zeros
        // This prevents sharing project-level metrics across sessions
        // The usage:update event will populate correct per-session metrics
        break;
      }
    }
  } catch (e) {
    // Tracker might not have data yet - that's OK
  }

  const id = sessionRegistry.register({
    project: project || 'unknown',
    path: projectPath || process.cwd(),
    status: status || 'active',
    currentTask: currentTask || null,
    sessionType: sessionType || 'cli',
    autonomous: autonomous || sessionType === 'autonomous',
    orchestratorInfo: orchestratorInfo || null,
    logSessionId: logSessionId || null,
    claudeSessionId: claudeSessionId || null,
    parentSessionId: parentSessionId || null,
    ...initialMetrics
  });

  console.log(`[COMMAND CENTER] Session registered: ${id} (${project}) [${sessionType || 'cli'}]${claudeSessionId ? ` (Claude: ${claudeSessionId.substring(0, 8)}...)` : ''}${initialMetrics.contextPercent > 0 ? ` (context: ${initialMetrics.contextPercent.toFixed(1)}%)` : ''}`);
  res.json({ success: true, id });
});

// Update session state (called by orchestrator on phase/task changes)
app.post('/api/sessions/:id/update', (req, res) => {
  const id = parseInt(req.params.id);
  const updates = req.body;

  const session = sessionRegistry.update(id, updates);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  console.log(`[COMMAND CENTER] Session ${id} updated`);
  res.json({ success: true, session });
});

// Pause session
app.post('/api/sessions/:id/pause', (req, res) => {
  const id = parseInt(req.params.id);
  const session = sessionRegistry.update(id, { status: 'paused' });

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  console.log(`[COMMAND CENTER] Session ${id} paused`);
  res.json({ success: true });
});

// Resume session
app.post('/api/sessions/:id/resume', (req, res) => {
  const id = parseInt(req.params.id);
  const session = sessionRegistry.update(id, { status: 'active' });

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  console.log(`[COMMAND CENTER] Session ${id} resumed`);
  res.json({ success: true });
});

// End session
app.post('/api/sessions/:id/end', (req, res) => {
  const id = parseInt(req.params.id);
  const session = sessionRegistry.deregister(id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  console.log(`[COMMAND CENTER] Session ${id} ended`);
  res.json({ success: true, session });
});

// Skip current task and move to next in queue
app.post('/api/sessions/:id/skip-task', (req, res) => {
  const id = parseInt(req.params.id);
  const session = sessionRegistry.get(id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Move current task to skipped, advance to next in queue
  const skippedTask = session.currentTask;
  const taskQueue = session.taskQueue || [];
  const nextTask = taskQueue.length > 0 ? taskQueue.shift() : null;

  const updates = {
    currentTask: nextTask,
    taskQueue: taskQueue,
    skippedTasks: [...(session.skippedTasks || []), skippedTask].filter(Boolean)
  };

  sessionRegistry.update(id, updates);

  console.log(`[COMMAND CENTER] Session ${id} skipped task: ${skippedTask?.title || 'none'}, next: ${nextTask?.title || 'none'}`);
  res.json({ success: true, skippedTask, nextTask });
});

// End session by Claude Code session ID (used by SessionEnd hook)
app.post('/api/sessions/end-by-claude-id', (req, res) => {
  const { claudeSessionId, reason } = req.body;

  if (!claudeSessionId) {
    return res.status(400).json({ error: 'claudeSessionId is required' });
  }

  const session = sessionRegistry.deregisterByClaudeSessionId(claudeSessionId);

  if (!session) {
    // Session may not exist if it was never registered or already ended
    console.log(`[COMMAND CENTER] Session end request for unknown Claude session: ${claudeSessionId} (reason: ${reason || 'unknown'})`);
    return res.json({ success: true, found: false, message: 'Session not found or already ended' });
  }

  console.log(`[COMMAND CENTER] Session ${session.id} ended (Claude ID: ${claudeSessionId}, reason: ${reason || 'unknown'})`);
  res.json({ success: true, found: true, session });
});

// Record task completion
app.post('/api/sessions/completion', (req, res) => {
  const { project, task, score, cost } = req.body;

  const completion = sessionRegistry.recordCompletion(project, task, score, cost);

  // Also record a message in usage tracker
  usageLimitTracker.recordMessage();

  res.json({ success: true, completion });
});

// ============================================================================
// DELEGATION API ENDPOINTS (Phase 5)
// ============================================================================

// Get delegation history across all sessions
app.get('/api/delegations/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const status = req.query.status; // Optional filter: completed, failed, active
    const sessionId = req.query.sessionId ? parseInt(req.query.sessionId) : null;

    // Collect delegations from all sessions
    const allDelegations = [];
    const sessions = sessionRegistry.getAll();

    for (const session of sessions) {
      const delegations = sessionRegistry.getAllDelegations(session.id);

      // Add active delegations
      for (const d of delegations.active) {
        if (!status || status === 'active') {
          allDelegations.push({
            ...d,
            sessionId: session.id,
            sessionProject: session.project,
            isActive: true
          });
        }
      }

      // Add completed delegations
      for (const d of delegations.completed) {
        if (!status || d.status?.toLowerCase() === status.toLowerCase()) {
          allDelegations.push({
            ...d,
            sessionId: session.id,
            sessionProject: session.project,
            isActive: false
          });
        }
      }
    }

    // Filter by session if requested
    let filtered = sessionId
      ? allDelegations.filter(d => d.sessionId === sessionId)
      : allDelegations;

    // Sort by most recent first
    filtered.sort((a, b) => {
      const dateA = new Date(a.completedAt || a.updatedAt || a.createdAt);
      const dateB = new Date(b.completedAt || b.updatedAt || b.createdAt);
      return dateB - dateA;
    });

    // Apply limit
    const result = filtered.slice(0, limit);

    res.json({
      delegations: result,
      total: filtered.length,
      limit,
      filters: { status, sessionId }
    });
  } catch (error) {
    console.error('[DELEGATION API] Error getting history:', error);
    res.status(500).json({ error: 'Failed to get delegation history', message: error.message });
  }
});

// Get delegation statistics
app.get('/api/delegations/stats', (req, res) => {
  try {
    const sessions = sessionRegistry.getAll();
    let totalActive = 0;
    let totalCompleted = 0;
    let totalFailed = 0;
    let totalCancelled = 0;
    const patternCounts = {};

    for (const session of sessions) {
      const delegations = sessionRegistry.getAllDelegations(session.id);

      totalActive += delegations.active.length;

      for (const d of delegations.completed) {
        if (d.status === 'completed' || d.status === 'COMPLETED') totalCompleted++;
        else if (d.status === 'failed' || d.status === 'FAILED') totalFailed++;
        else if (d.status === 'cancelled' || d.status === 'CANCELLED') totalCancelled++;

        // Track patterns
        const pattern = d.metadata?.pattern || 'unknown';
        patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
      }
    }

    res.json({
      active: totalActive,
      completed: totalCompleted,
      failed: totalFailed,
      cancelled: totalCancelled,
      total: totalActive + totalCompleted + totalFailed + totalCancelled,
      patterns: patternCounts,
      sessionsWithDelegations: sessions.filter(s =>
        s.activeDelegations?.length > 0 || s.completedDelegations?.length > 0
      ).length
    });
  } catch (error) {
    console.error('[DELEGATION API] Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get delegation stats', message: error.message });
  }
});

// Get delegation configuration
app.get('/api/delegations/config', (req, res) => {
  try {
    const configPath = path.join(__dirname, '.claude', 'delegation-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      res.json({ success: true, config });
    } else {
      // Return default config
      res.json({
        success: true,
        config: {
          enabled: true,
          showHints: true,
          minComplexityThreshold: 35,
          minSubtaskCount: 3,
          quickAnalysisOnly: false,
          useTaskDecomposer: true,
          cacheEnabled: true,
          cacheMaxAge: 60000,
          debugMode: false
        },
        isDefault: true
      });
    }
  } catch (error) {
    console.error('[DELEGATION API] Error getting config:', error);
    res.status(500).json({ error: 'Failed to get delegation config', message: error.message });
  }
});

// Update delegation configuration
app.put('/api/delegations/config', (req, res) => {
  try {
    const configPath = path.join(__dirname, '.claude', 'delegation-config.json');
    const updates = req.body;

    // Load existing config or defaults
    let config = {
      enabled: true,
      showHints: true,
      minComplexityThreshold: 35,
      minSubtaskCount: 3,
      quickAnalysisOnly: false,
      useTaskDecomposer: true,
      cacheEnabled: true,
      cacheMaxAge: 60000,
      debugMode: false
    };

    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }

    // Apply updates (only allow known keys)
    const allowedKeys = ['enabled', 'showHints', 'minComplexityThreshold', 'minSubtaskCount',
                         'quickAnalysisOnly', 'useTaskDecomposer', 'cacheEnabled', 'cacheMaxAge', 'debugMode'];

    for (const key of allowedKeys) {
      if (updates[key] !== undefined) {
        config[key] = updates[key];
      }
    }

    // Ensure directory exists
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Write updated config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Broadcast config change via WebSocket
    broadcastFleetEvent({
      type: 'delegation:configUpdated',
      config,
      timestamp: new Date().toISOString()
    });

    console.log('[DELEGATION API] Config updated:', Object.keys(updates).join(', '));
    res.json({ success: true, config });
  } catch (error) {
    console.error('[DELEGATION API] Error updating config:', error);
    res.status(500).json({ error: 'Failed to update delegation config', message: error.message });
  }
});

// Register a delegation for a session (called by delegation-executor when spawning agents)
app.post('/api/sessions/:id/delegations', (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    const { delegationId, taskId, pattern, subtaskCount, childAgentIds, metadata } = req.body;

    if (!sessionId || isNaN(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }

    const delegation = sessionRegistry.addDelegation(sessionId, {
      delegationId: delegationId || `del-${Date.now()}`,
      targetAgentId: childAgentIds?.[0] || null,
      taskId: taskId || 'unknown',
      metadata: {
        pattern: pattern || 'sequential',
        subtaskCount: subtaskCount || 0,
        childAgentIds: childAgentIds || [],
        ...metadata
      }
    });

    if (!delegation) {
      return res.status(404).json({ error: 'Session not found', sessionId });
    }

    // Broadcast delegation event via SSE
    broadcastFleetEvent({
      type: 'delegation:added',
      sessionId,
      delegation,
      timestamp: new Date().toISOString()
    });

    console.log(`[DELEGATION API] Delegation registered for session ${sessionId}:`, delegationId);
    res.json({ success: true, delegation });
  } catch (error) {
    console.error('[DELEGATION API] Error registering delegation:', error);
    res.status(500).json({ error: 'Failed to register delegation', message: error.message });
  }
});

// Update delegation status (called when child agents complete)
app.put('/api/sessions/:id/delegations/:delegationId', (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    const { delegationId } = req.params;
    const { status, result, error: errorMsg } = req.body;

    if (!sessionId || isNaN(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }

    const updated = sessionRegistry.updateDelegation(sessionId, delegationId, status, result);

    if (!updated) {
      return res.status(404).json({ error: 'Delegation not found', sessionId, delegationId });
    }

    // Broadcast delegation update via SSE
    broadcastFleetEvent({
      type: 'delegation:updated',
      sessionId,
      delegationId,
      status,
      timestamp: new Date().toISOString()
    });

    console.log(`[DELEGATION API] Delegation ${delegationId} updated to ${status}`);
    res.json({ success: true, delegation: updated });
  } catch (error) {
    console.error('[DELEGATION API] Error updating delegation:', error);
    res.status(500).json({ error: 'Failed to update delegation', message: error.message });
  }
});

// ============================================================================
// USAGE LIMITS API ENDPOINTS
// ============================================================================

// Get usage limits status
app.get('/api/usage/limits', (req, res) => {
  const status = usageLimitTracker.getStatus();

  res.json({
    fiveHour: {
      used: status.fiveHour.used,
      limit: status.fiveHour.limit,
      percent: status.fiveHour.percent,
      resetAt: status.fiveHour.resetAt,
      resetIn: status.fiveHour.resetIn,
      pace: status.fiveHour.pace
    },
    daily: {
      used: status.daily.used,
      limit: status.daily.limit,
      percent: status.daily.percent,
      resetAt: status.daily.resetAt,
      resetIn: status.daily.resetIn,
      projected: status.daily.projected
    },
    weekly: {
      used: status.weekly.used,
      limit: status.weekly.limit,
      percent: status.weekly.percent,
      resetAt: status.weekly.resetAt,
      resetDay: status.weekly.resetDay
    },
    lastUpdated: status.lastUpdated
  });
});

// Get usage alerts
app.get('/api/usage/alerts', (req, res) => {
  res.json({
    alerts: usageLimitTracker.getAlerts(),
    nearLimit: usageLimitTracker.isNearLimit(70)
  });
});

// Record a message (for manual tracking)
app.post('/api/usage/record', (req, res) => {
  const status = usageLimitTracker.recordMessage();
  res.json({ success: true, status });
});

// Set usage limits (for configuration)
app.post('/api/usage/limits', (req, res) => {
  const { fiveHour, daily, weekly } = req.body;
  usageLimitTracker.setLimits(fiveHour, daily, weekly);
  res.json({ success: true, limits: { fiveHour, daily, weekly } });
});

// Reset usage window (for testing)
app.post('/api/usage/reset', (req, res) => {
  const { window } = req.body;
  usageLimitTracker.reset(window || 'all');
  res.json({ success: true });
});

// ============================================================================
// FLEET MANAGEMENT API ENDPOINTS (Dashboard Redesign)
// ============================================================================

/**
 * Calculate smart defaults - auto-surface relevant metrics based on context
 * @param {Object} state - Current system state
 * @returns {Array} Array of surfaced metrics with prominence
 */
function calculateSmartDefaults(state) {
  const surfaced = [];

  // Usage urgency - 5-hour limit
  if (state.fiveHourLimit && state.fiveHourLimit.percent > 80) {
    surfaced.push({
      metric: 'rate_limit',
      prominence: state.fiveHourLimit.percent > 95 ? 'critical' : 'high',
      reason: 'approaching_limit',
      value: state.fiveHourLimit.percent
    });
  }

  // Session health checks
  if (state.sessions) {
    for (const session of state.sessions) {
      // Context exhaustion
      if (session.contextPercent > 75) {
        surfaced.push({
          metric: 'context_timer',
          sessionId: session.id,
          prominence: session.contextPercent > 90 ? 'critical' : 'high',
          reason: 'context_high',
          value: session.contextPercent
        });
      }

      // Quality drop
      if (session.qualityScore < 80 && session.qualityScore > 0) {
        surfaced.push({
          metric: 'quality_breakdown',
          sessionId: session.id,
          prominence: session.qualityScore < 60 ? 'high' : 'medium',
          reason: 'quality_low',
          value: session.qualityScore
        });
      }

      // Confidence drop
      if (session.confidenceScore < 70 && session.confidenceScore > 0) {
        surfaced.push({
          metric: 'confidence_signals',
          sessionId: session.id,
          prominence: session.confidenceScore < 50 ? 'high' : 'medium',
          reason: 'confidence_low',
          value: session.confidenceScore
        });
      }
    }
  }

  // Agent pool health
  if (state.agentPool && state.agentPool.errorAgents > 0) {
    surfaced.push({
      metric: 'agent_errors',
      prominence: 'high',
      reason: 'agents_in_error',
      value: state.agentPool.errorAgents
    });
  }

  // Deep delegation warning
  if (state.hierarchyMetrics && state.hierarchyMetrics.maxDelegationDepth > 2) {
    surfaced.push({
      metric: 'delegation_depth',
      prominence: 'medium',
      reason: 'deep_hierarchy',
      value: state.hierarchyMetrics.maxDelegationDepth
    });
  }

  return surfaced;
}

/**
 * Build hierarchy tree for agent lineage visualization
 * @param {Object} session - Root session
 * @param {Object} sessionRegistry - Session registry instance
 * @param {number} depth - Current depth
 * @returns {Object} Hierarchy tree node
 */
function buildAgentHierarchyTree(session, registry, depth = 0) {
  const children = registry.getChildSessions(session.id);

  return {
    sessionId: session.id,
    project: session.project,
    isRoot: session.hierarchyInfo.isRoot,
    depth,
    status: session.status,
    phase: session.phase,
    currentTask: session.currentTask,
    contextPercent: session.contextPercent,
    qualityScore: session.qualityScore,
    activeDelegations: session.activeDelegations.map(d => ({
      delegationId: d.delegationId,
      pattern: d.metadata?.pattern || 'SEQUENTIAL',
      task: d.taskId,
      status: d.status,
      duration: d.createdAt ? Date.now() - new Date(d.createdAt).getTime() : 0
    })),
    children: children.map(child => buildAgentHierarchyTree(child, registry, depth + 1))
  };
}

// Fleet Overview - aggregated view of all projects and sessions
// Query params: ?activeOnly=true to filter out inactive sessions/projects
app.get('/api/overview', (req, res) => {
  try {
    // Filter mode: only show active sessions (updated within last 5 minutes)
    const activeOnly = req.query.activeOnly !== 'false'; // Default to true

    // Get data from all sources
    const summaryWithHierarchy = sessionRegistry.getSummaryWithHierarchy();
    const usageLimits = usageLimitTracker.getStatus();
    // Note: usageLimitTracker.getAlerts() disabled - tracks internal events, not real Claude usage

    // Get projects from globalTracker (Claude Code project discovery)
    const trackerProjects = tracker.getAllProjects();

    // Get task data for each session
    const db = getCoordinationDb();
    const taskManager = getTaskManagerForProject(defaultProjectPath);
    const allTasks = taskManager ? taskManager.getAllTasks() : [];

    // Build project-grouped data - start with globalTracker projects
    const projectMap = new Map();

    // Add projects from globalTracker (filter inactive if activeOnly=true)
    for (const proj of trackerProjects) {
      // Filter sessions - only include active ones by default
      const sessions = (proj.sessions || [])
        .filter(s => !activeOnly || s.isActive)
        .map(s => ({
          id: s.id,
          isRoot: true,
          status: s.isActive ? 'active' : 'inactive',
          contextPercent: s.contextPercent || 0,
          qualityScore: 0,
          confidenceScore: 0,
          tokens: (s.inputTokens || 0) + (s.outputTokens || 0) + (s.cacheCreationTokens || 0) + (s.cacheReadTokens || 0),
          cost: s.cost || 0,
          phase: null,
          currentTask: null,
          subtasks: [],
          model: s.model
        }));

      // Skip projects with no active sessions when filtering
      if (activeOnly && sessions.length === 0) continue;

      projectMap.set(proj.name, {
        name: proj.name,
        path: proj.path,
        sessions,
        metrics: {
          totalTokens: proj.metrics?.inputTokens + proj.metrics?.outputTokens + proj.metrics?.cacheCreationTokens + proj.metrics?.cacheReadTokens || 0,
          totalCost: proj.metrics?.cost || 0,
          avgQuality: 0,
          avgConfidence: 0
        },
        health: proj.safetyStatus === 'OK' ? 'healthy' :
                proj.safetyStatus === 'WARNING' ? 'warning' : 'critical'
      });
    }

    // Filter registry sessions - skip ended sessions when activeOnly is true
    const registrySessions = activeOnly
      ? summaryWithHierarchy.sessions.filter(s => s.status !== 'ended')
      : summaryWithHierarchy.sessions;

    for (const session of registrySessions) {
      const projectName = session.project || 'unknown';

      if (!projectMap.has(projectName)) {
        projectMap.set(projectName, {
          name: projectName,
          path: session.path,
          sessions: [],
          metrics: {
            totalTokens: 0,
            totalCost: 0,
            avgQuality: 0,
            avgConfidence: 0
          },
          health: 'healthy'
        });
      }

      const project = projectMap.get(projectName);

      // Find parent task for this session (claimed task)
      let parentTask = null;
      let subtasks = [];

      if (db) {
        try {
          const claims = db.getClaimsBySession(String(session.id));
          if (claims.length > 0) {
            const taskId = claims[0].taskId;
            const task = allTasks.find(t => t.id === taskId);
            if (task) {
              parentTask = {
                id: task.id,
                title: task.title,
                status: task.status
              };

              // Get subtasks (child tasks)
              subtasks = allTasks
                .filter(t => t.parentTaskId === task.id)
                .map(t => ({
                  id: t.id,
                  title: t.title,
                  status: t.status,
                  claimedBy: null // Would need additional lookup
                }));
            }
          }
        } catch (e) {
          // Ignore claim lookup errors
        }
      }

      const sessionData = {
        id: session.id,
        isRoot: session.hierarchyInfo?.isRoot ?? true,
        status: session.status,
        contextPercent: session.contextPercent,
        qualityScore: session.qualityScore,
        confidenceScore: session.confidenceScore,
        tokens: session.tokens,
        cost: session.cost,
        phase: session.phase,
        parentTask,
        subtaskProgress: {
          completed: subtasks.filter(s => s.status === 'completed').length,
          total: subtasks.length,
          percent: subtasks.length > 0
            ? Math.round(subtasks.filter(s => s.status === 'completed').length / subtasks.length * 100)
            : 0
        },
        subtasks
      };

      project.sessions.push(sessionData);
      project.metrics.totalTokens += session.tokens || 0;
      project.metrics.totalCost += session.cost || 0;
    }

    // Calculate averages and health for each project
    for (const project of projectMap.values()) {
      if (project.sessions.length > 0) {
        const activeSessions = project.sessions.filter(s => s.status === 'active');
        if (activeSessions.length > 0) {
          project.metrics.avgQuality = Math.round(
            activeSessions.reduce((sum, s) => sum + (s.qualityScore || 0), 0) / activeSessions.length
          );
          project.metrics.avgConfidence = Math.round(
            activeSessions.reduce((sum, s) => sum + (s.confidenceScore || 0), 0) / activeSessions.length
          );
        }

        // Determine health based on context and quality
        const criticalSessions = project.sessions.filter(s => s.contextPercent > 90 || s.qualityScore < 60);
        const warningSessions = project.sessions.filter(s => s.contextPercent > 75 || s.qualityScore < 80);

        if (criticalSessions.length > 0) {
          project.health = 'critical';
        } else if (warningSessions.length > 0) {
          project.health = 'warning';
        }
      }
    }

    // Build agent pool summary
    const agentPool = {
      active: summaryWithHierarchy.sessions.filter(s => s.status === 'active').length,
      idle: summaryWithHierarchy.sessions.filter(s => s.status === 'idle').length,
      error: summaryWithHierarchy.sessions.filter(s => s.status === 'error').length,
      delegationSuccessRate: 0.94, // TODO: Calculate from actual delegation history
      activeDelegations: summaryWithHierarchy.hierarchyMetrics?.activeDelegationCount || 0
    };

    // Build alerts array from usage alerts and session alerts
    const alerts = [];

    // Note: usageAlerts from usageLimitTracker are disabled because they track
    // internal dashboard events, not actual Claude API usage. Real usage data
    // comes from globalTracker which parses session JSONL files.

    // Add session context alerts
    for (const session of summaryWithHierarchy.sessions) {
      if (session.contextPercent > 90) {
        alerts.push({
          id: `context-${session.id}-${Date.now()}`,
          level: 'critical',
          type: 'token_exhaustion',
          message: `Session ${session.id} context at ${session.contextPercent}%`,
          sessionId: session.id,
          timestamp: new Date().toISOString(),
          actions: ['save_state', 'view_session']
        });
      }
    }

    // Calculate smart defaults
    const smartDefaults = calculateSmartDefaults({
      fiveHourLimit: usageLimits.fiveHour,
      sessions: summaryWithHierarchy.sessions,
      agentPool,
      hierarchyMetrics: summaryWithHierarchy.hierarchyMetrics
    });

    // Build response
    const response = {
      global: {
        fiveHourLimit: {
          used: usageLimits.fiveHour.used,
          limit: usageLimits.fiveHour.limit,
          percent: usageLimits.fiveHour.percent,
          resetIn: usageLimits.fiveHour.resetIn,
          resetAt: usageLimits.fiveHour.resetAt,
          pace: usageLimits.fiveHour.pace
        },
        dailyLimit: {
          used: usageLimits.daily.used,
          limit: usageLimits.daily.limit,
          percent: usageLimits.daily.percent,
          resetIn: usageLimits.daily.resetIn,
          resetAt: usageLimits.daily.resetAt
        },
        weeklyLimit: {
          used: usageLimits.weekly.used,
          limit: usageLimits.weekly.limit,
          percent: usageLimits.weekly.percent,
          resetAt: usageLimits.weekly.resetAt
        },
        activeSessionCount: summaryWithHierarchy.metrics.activeCount +
          trackerProjects.reduce((sum, p) => sum + (p.sessions?.filter(s => s.isActive).length || 0), 0),
        activeProjectCount: trackerProjects.filter(p => p.status === 'active').length || projectMap.size,
        alertCount: {
          critical: alerts.filter(a => a.level === 'critical').length,
          warning: alerts.filter(a => a.level === 'warning').length,
          info: alerts.filter(a => a.level === 'info').length
        }
      },
      account: {
        totalCost: summaryWithHierarchy.metrics.totalCostToday,
        sessionCount: summaryWithHierarchy.sessions.length,
        projectCount: projectMap.size
      },
      projects: Array.from(projectMap.values()).map(p => ({
        name: p.name,
        path: p.path,
        sessionCount: p.sessions.length,
        activeSessionCount: p.sessions.filter(s => s.status === 'active').length,
        metrics: p.metrics,
        health: p.health,
        sessions: p.sessions
      })),
      agentPool,
      alerts,
      smartDefaults,
      hierarchyMetrics: summaryWithHierarchy.hierarchyMetrics
    };

    res.json(response);
  } catch (error) {
    console.error('[OVERVIEW] Error building overview:', error);
    res.status(500).json({ error: error.message });
  }
});

// Agent Pool Status - detailed agent hierarchy and delegation metrics
app.get('/api/agent-pool/status', (req, res) => {
  try {
    const summaryWithHierarchy = sessionRegistry.getSummaryWithHierarchy();
    const sessions = summaryWithHierarchy.sessions;

    // Calculate summary stats
    const summary = {
      totalAgents: sessions.length,
      activeAgents: sessions.filter(s => s.status === 'active').length,
      idleAgents: sessions.filter(s => s.status === 'idle').length,
      errorAgents: sessions.filter(s => s.status === 'error').length,
      byPhase: {}
    };

    // Count by phase
    for (const session of sessions) {
      const phase = session.phase || 'unknown';
      summary.byPhase[phase] = (summary.byPhase[phase] || 0) + 1;
    }

    // Calculate delegation stats
    const allDelegations = sessions.flatMap(s => s.activeDelegations || []);
    const delegationsByPattern = {};

    for (const del of allDelegations) {
      const pattern = del.metadata?.pattern || 'sequential';
      delegationsByPattern[pattern] = (delegationsByPattern[pattern] || 0) + 1;
    }

    const delegations = {
      activeCount: allDelegations.length,
      byPattern: {
        parallel: delegationsByPattern.parallel || delegationsByPattern.PARALLEL || 0,
        sequential: delegationsByPattern.sequential || delegationsByPattern.SEQUENTIAL || 0,
        debate: delegationsByPattern.debate || delegationsByPattern.DEBATE || 0,
        review: delegationsByPattern.review || delegationsByPattern.REVIEW || 0
      },
      successRate: 0.94, // TODO: Calculate from delegation history
      avgDurationMs: 45000, // TODO: Calculate from delegation history
      peakConcurrentChildren: summaryWithHierarchy.hierarchyMetrics?.maxDelegationDepth || 0
    };

    // Build hierarchy trees for root sessions
    const rootSessions = sessions.filter(s => s.hierarchyInfo?.isRoot);
    const hierarchy = rootSessions.map(session =>
      buildAgentHierarchyTree(session, sessionRegistry)
    );

    // Calculate claim health
    const db = getCoordinationDb();
    let claimHealth = { active: 0, expiringSoon: 0, stale: 0 };

    if (db) {
      try {
        const claims = db.getActiveClaims();
        const now = Date.now();
        const fiveMinutes = 5 * 60 * 1000;

        claimHealth = {
          active: claims.length,
          expiringSoon: claims.filter(c => c.expiresAt && (c.expiresAt - now) < fiveMinutes).length,
          stale: claims.filter(c => c.lastHeartbeat && (now - c.lastHeartbeat) > fiveMinutes).length
        };
      } catch (e) {
        // Ignore claim lookup errors
      }
    }

    const response = {
      timestamp: new Date().toISOString(),
      summary,
      delegations,
      hierarchy,
      health: {
        status: summary.errorAgents > 0 ? 'degraded' : 'healthy',
        warnings: summary.errorAgents > 0 ? [`${summary.errorAgents} agents in error state`] : [],
        claimHealth
      }
    };

    res.json(response);
  } catch (error) {
    console.error('[AGENT-POOL] Error building agent pool status:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// LOG STREAMING API ENDPOINTS
// ============================================================================

// List available log files
app.get('/api/logs', (req, res) => {
  const logs = logStreamer.getAvailableLogs();
  res.json({ logs });
});

// Get log statistics for a session
app.get('/api/logs/:sessionId/stats', async (req, res) => {
  const stats = await logStreamer.getStats(req.params.sessionId);
  res.json(stats);
});

// Get historical logs for a session (with pagination support)
app.get('/api/logs/:sessionId/history', async (req, res) => {
  const options = {
    lines: parseInt(req.query.lines) || 100,
    offset: parseInt(req.query.offset) || 0,
    before: req.query.before || null  // ISO timestamp
  };

  const result = await logStreamer.getHistoricalLogs(req.params.sessionId, options);
  res.json({
    entries: result.entries || result,  // Handle both old and new return format
    count: result.entries?.length || result.length || 0,
    total: result.total || 0,
    hasMore: result.hasMore || false
  });
});

// Stream logs via SSE (main log streaming endpoint)
app.get('/api/logs/:sessionId/stream', (req, res) => {
  const sessionId = req.params.sessionId;
  const control = logStreamer.startStream(sessionId, res);

  console.log(`[LOG STREAM] Client connected to session ${sessionId}`);

  req.on('close', () => {
    control.stop();
    console.log(`[LOG STREAM] Client disconnected from session ${sessionId}`);
  });
});

// Pause log streaming for a session
app.post('/api/logs/:sessionId/pause', (req, res) => {
  logStreamer.pauseStream(req.params.sessionId);
  res.json({ success: true, paused: true });
});

// Resume log streaming for a session
app.post('/api/logs/:sessionId/resume', (req, res) => {
  logStreamer.resumeStream(req.params.sessionId);
  res.json({ success: true, paused: false });
});

// Write a log entry (for testing/integration)
app.post('/api/logs/:sessionId/write', (req, res) => {
  const { message, level, source } = req.body;
  logStreamer.writeLog(req.params.sessionId, message, level || 'INFO', source || 'api');
  res.json({ success: true });
});

// Clear log file for a session
app.delete('/api/logs/:sessionId', (req, res) => {
  logStreamer.clearLog(req.params.sessionId);
  res.json({ success: true });
});

// Debug endpoint for tool audit logs
app.get('/api/logs/debug/activity', (req, res) => {
  const auditLogPath = path.join(process.cwd(), '.claude', 'logs', 'tool-audit.jsonl');
  const exists = fs.existsSync(auditLogPath);
  let content = null;
  let lines = [];
  if (exists) {
    content = fs.readFileSync(auditLogPath, 'utf8');
    lines = content.trim().split('\n').filter(Boolean);
  }
  res.json({ path: auditLogPath, exists, lineCount: lines.length, lines: lines.slice(0, 10) });
});

// Get CLI session activity logs from tool-audit.jsonl
app.get('/api/logs/:sessionId/activity', async (req, res) => {
  const sessionId = req.params.sessionId;
  const limit = parseInt(req.query.limit) || 100;
  const offset = parseInt(req.query.offset) || 0;

  const auditLogPath = path.join(process.cwd(), '.claude', 'logs', 'tool-audit.jsonl');
  console.log('[ACTIVITY LOG] Requested sessionId:', sessionId, 'Path:', auditLogPath);

  try {
    if (!fs.existsSync(auditLogPath)) {
      console.log('[ACTIVITY LOG] File does not exist');
      return res.json({ entries: [], count: 0, total: 0, sessionId, debug: { path: auditLogPath, exists: false } });
    }

    const content = fs.readFileSync(auditLogPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    console.log('[ACTIVITY LOG] File has', lines.length, 'lines');

    // Parse and filter by sessionId
    const allEntries = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        console.log('[ACTIVITY LOG] Entry sessionId:', entry.sessionId, 'Match:', entry.sessionId === sessionId);
        // Match by sessionId or by project path (cwd)
        if (entry.sessionId === sessionId ||
            (entry.cwd && entry.cwd.includes(sessionId))) {
          allEntries.push(entry);
        }
      } catch (parseErr) {
        // Skip malformed lines
      }
    }
    console.log('[ACTIVITY LOG] Matched entries:', allEntries.length);

    // Sort by timestamp descending (newest first)
    allEntries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Apply pagination
    const entries = allEntries.slice(offset, offset + limit);

    res.json({
      entries,
      count: entries.length,
      total: allEntries.length,
      sessionId,
      hasMore: offset + limit < allEntries.length
    });
  } catch (err) {
    console.error('[ACTIVITY LOG] Error reading tool audit log:', err);
    res.status(500).json({ error: 'Failed to read activity logs', message: err.message });
  }
});

// SSE stream for CLI session activity logs (real-time updates)
app.get('/api/logs/:sessionId/activity/stream', (req, res) => {
  const sessionId = req.params.sessionId;
  const auditLogPath = path.join(process.cwd(), '.claude', 'logs', 'tool-audit.jsonl');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', sessionId })}\n\n`);

  let lastSize = 0;
  let watcher = null;

  // Initialize lastSize
  try {
    if (fs.existsSync(auditLogPath)) {
      lastSize = fs.statSync(auditLogPath).size;
    }
  } catch (e) {
    // Ignore
  }

  // Function to check for new entries
  const checkForNewEntries = () => {
    try {
      if (!fs.existsSync(auditLogPath)) return;

      const stats = fs.statSync(auditLogPath);
      if (stats.size > lastSize) {
        // Read new content
        const fd = fs.openSync(auditLogPath, 'r');
        const buffer = Buffer.alloc(stats.size - lastSize);
        fs.readSync(fd, buffer, 0, buffer.length, lastSize);
        fs.closeSync(fd);

        const newContent = buffer.toString('utf8');
        const newLines = newContent.trim().split('\n').filter(Boolean);

        for (const line of newLines) {
          try {
            const entry = JSON.parse(line);
            // Only send entries for this session
            if (entry.sessionId === sessionId ||
                (entry.cwd && entry.cwd.includes(sessionId))) {
              res.write(`data: ${JSON.stringify({ type: 'activity', entry })}\n\n`);
            }
          } catch (parseErr) {
            // Skip malformed lines
          }
        }

        lastSize = stats.size;
      }
    } catch (err) {
      console.error('[ACTIVITY STREAM] Error checking for new entries:', err.message);
    }
  };

  // Watch file for changes
  try {
    const logsDir = path.dirname(auditLogPath);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    watcher = fs.watch(logsDir, (eventType, filename) => {
      if (filename === 'tool-audit.jsonl') {
        checkForNewEntries();
      }
    });
  } catch (err) {
    console.error('[ACTIVITY STREAM] Failed to watch file:', err.message);
  }

  // Send heartbeat every 30 seconds
  const heartbeat = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`);
  }, 30000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    if (watcher) watcher.close();
    console.log(`[ACTIVITY STREAM] Client disconnected from session ${sessionId}`);
  });

  console.log(`[ACTIVITY STREAM] Client connected to session ${sessionId}`);
});

// SSE for Command Center real-time updates
app.get('/api/sse/command-center', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const sendFullUpdate = () => {
    const summary = sessionRegistry.getSummary();
    const limits = usageLimitTracker.getStatus();

    const data = {
      type: 'full',
      sessions: summary.sessions,
      metrics: {
        activeSessions: summary.metrics.activeCount,
        tasksDone: summary.metrics.tasksCompletedToday,
        tasksTotal: summary.sessions.length * 5, // Estimate
        avgHealth: summary.metrics.avgHealthScore,
        costToday: summary.metrics.totalCostToday,
        costChange: 0,
        alerts: summary.metrics.alertCount
      },
      limits: {
        fiveHour: {
          used: limits.fiveHour.used,
          limit: limits.fiveHour.limit,
          resetIn: Math.floor((new Date(limits.fiveHour.resetAt) - Date.now()) / 1000),
          pace: limits.fiveHour.pace.current,
          safeLimit: limits.fiveHour.pace.safe
        },
        daily: {
          used: limits.daily.used,
          limit: limits.daily.limit,
          resetIn: Math.floor((new Date(limits.daily.resetAt) - Date.now()) / 1000),
          projected: limits.daily.projected.endOfDay
        },
        weekly: {
          used: limits.weekly.used,
          limit: limits.weekly.limit,
          resetDay: limits.weekly.resetDay
        }
      },
      completions: summary.recentCompletions.map(c => ({
        project: c.project,
        task: c.taskTitle,
        score: c.score,
        cost: c.cost,
        completed: formatTimeAgo(c.completedAt)
      })),
      timestamp: new Date().toISOString()
    };

    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send initial data
  sendFullUpdate();

  // Send updates periodically (every 3 seconds for sessions, every 60 seconds for limits)
  const sessionInterval = setInterval(sendFullUpdate, 3000);

  // Listen for session registry events
  const onSessionChange = () => sendFullUpdate();
  sessionRegistry.on('session:registered', onSessionChange);
  sessionRegistry.on('session:updated', onSessionChange);
  sessionRegistry.on('session:deregistered', onSessionChange);
  sessionRegistry.on('task:completed', onSessionChange);

  req.on('close', () => {
    clearInterval(sessionInterval);
    sessionRegistry.removeListener('session:registered', onSessionChange);
    sessionRegistry.removeListener('session:updated', onSessionChange);
    sessionRegistry.removeListener('session:deregistered', onSessionChange);
    sessionRegistry.removeListener('task:completed', onSessionChange);
  });
});

// Helper function for time ago formatting
function formatTimeAgo(isoString) {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

// ============================================================================
// LESSONS LEARNED API ENDPOINTS
// ============================================================================

// In-memory store for lessons learned per project
// Each lesson: { id, taskId, text, type, timestamp, tags }
const lessonsStore = new Map();

// Helper to get lessons for a project
function getLessonsForProject(project) {
  if (!lessonsStore.has(project)) {
    lessonsStore.set(project, []);
  }
  return lessonsStore.get(project);
}

// Helper to extract lessons from task notes in tasks.json
function extractLessonsFromTasks(project) {
  const lessons = [];

  try {
    // Read tasks.json and extract notes from completed tasks
    const tasksJsonPath = path.join(__dirname, '.claude', 'dev-docs', 'tasks.json');
    if (fs.existsSync(tasksJsonPath)) {
      const content = fs.readFileSync(tasksJsonPath, 'utf-8');
      const data = JSON.parse(content);

      const allTasks = data.tasks || {};

      // Get notes from completed tasks
      for (const [taskId, task] of Object.entries(allTasks)) {
        if (task.notes && task.status === 'completed') {
          lessons.push({
            id: `task-note-${taskId}`,
            taskId: taskId,
            text: task.notes,
            type: task.qualityScore >= 90 ? 'success' : task.qualityScore >= 75 ? 'warning' : 'error',
            timestamp: task.completed || task.updated || new Date().toISOString(),
            tags: task.tags || []
          });
        }
      }
    }
  } catch (err) {
    console.error('[LESSONS] Failed to extract from tasks.json:', err.message);
  }

  return lessons;
}

// GET /api/lessons/:project - Get all lessons for a project
app.get('/api/lessons/:project', (req, res) => {
  const project = req.params.project;

  // Get stored lessons
  const storedLessons = getLessonsForProject(project);

  // Also extract lessons from task notes
  const taskLessons = extractLessonsFromTasks(project);

  // Combine and sort by timestamp (newest first)
  const allLessons = [...storedLessons, ...taskLessons].sort((a, b) => {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  // Deduplicate by id
  const seen = new Set();
  const uniqueLessons = allLessons.filter(lesson => {
    if (seen.has(lesson.id)) return false;
    seen.add(lesson.id);
    return true;
  });

  res.json({
    projectId: project,
    lessons: uniqueLessons,
    count: uniqueLessons.length
  });
});

// POST /api/lessons/:project - Add a new lesson
app.post('/api/lessons/:project', (req, res) => {
  const project = req.params.project;
  const { taskId, text, type, tags } = req.body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'Lesson text is required' });
  }

  const lesson = {
    id: `lesson-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    taskId: taskId || null,
    text: text.trim(),
    type: ['success', 'warning', 'error', 'info'].includes(type) ? type : 'info',
    timestamp: new Date().toISOString(),
    tags: Array.isArray(tags) ? tags : []
  };

  const lessons = getLessonsForProject(project);
  lessons.unshift(lesson); // Add to beginning (newest first)

  // Keep only last 100 lessons per project in memory
  if (lessons.length > 100) {
    lessons.pop();
  }

  console.log(`[LESSONS] Added lesson for ${project}: "${text.substring(0, 50)}..."`);
  res.json({ success: true, lesson });
});

// DELETE /api/lessons/:project/:id - Delete a lesson
app.delete('/api/lessons/:project/:id', (req, res) => {
  const project = req.params.project;
  const lessonId = req.params.id;

  const lessons = getLessonsForProject(project);
  const index = lessons.findIndex(l => l.id === lessonId);

  if (index === -1) {
    return res.status(404).json({ error: 'Lesson not found' });
  }

  const removed = lessons.splice(index, 1);
  console.log(`[LESSONS] Deleted lesson ${lessonId} from ${project}`);
  res.json({ success: true, deleted: removed[0] });
});

// GET /api/lessons - Get lessons across all projects (summary)
app.get('/api/lessons', (req, res) => {
  const summary = {};
  for (const [project, lessons] of lessonsStore.entries()) {
    summary[project] = {
      count: lessons.length,
      recentCount: lessons.filter(l => {
        const age = Date.now() - new Date(l.timestamp).getTime();
        return age < 24 * 60 * 60 * 1000; // Last 24 hours
      }).length
    };
  }
  res.json(summary);
});

// ============================================================================
// HUMAN-IN-LOOP DETECTOR APIs
// ============================================================================

// GET /api/human-review - Get pending human review items
app.get('/api/human-review', (req, res) => {
  const projectPath = req.query.project || defaultProjectPath;

  try {
    const detector = getHumanInLoopDetector(projectPath);
    const stats = detector.getStatistics();

    // Get recent detections that required human review
    const pendingItems = stats.recentFeedback
      ? stats.recentFeedback.filter(f => !f.wasCorrect).slice(0, 10)
      : [];

    res.json({
      project: path.basename(projectPath),
      enabled: stats.enabled,
      pendingCount: pendingItems.length,
      pending: pendingItems,
      patterns: stats.patterns,
      statistics: stats.statistics
    });
  } catch (error) {
    console.error('[HUMAN-REVIEW] Error getting review items:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/human-review/stats - Get detection statistics
app.get('/api/human-review/stats', (req, res) => {
  const projectPath = req.query.project || defaultProjectPath;

  try {
    const detector = getHumanInLoopDetector(projectPath);
    const stats = detector.getStatistics();

    res.json({
      project: path.basename(projectPath),
      ...stats
    });
  } catch (error) {
    console.error('[HUMAN-REVIEW] Error getting stats:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/human-review/analyze - Analyze a task for human review needs
app.post('/api/human-review/analyze', async (req, res) => {
  const { task, phase, type, metadata, project } = req.body;
  const projectPath = project || defaultProjectPath;

  try {
    const detector = getHumanInLoopDetector(projectPath);
    const result = await detector.analyze({
      task: task || '',
      phase: phase || 'unknown',
      type: type || 'unknown',
      metadata: metadata || {}
    });

    res.json({
      project: path.basename(projectPath),
      ...result
    });
  } catch (error) {
    console.error('[HUMAN-REVIEW] Error analyzing task:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/human-review/:detectionId/feedback - Submit feedback on a detection
app.post('/api/human-review/:detectionId/feedback', async (req, res) => {
  const { detectionId } = req.params;
  const { wasCorrect, actualNeed, comment, project } = req.body;
  const projectPath = project || defaultProjectPath;

  try {
    const detector = getHumanInLoopDetector(projectPath);
    const result = await detector.recordFeedback(detectionId, {
      wasCorrect: wasCorrect === true || wasCorrect === 'true',
      actualNeed: actualNeed || 'unsure',
      comment: comment || ''
    });

    res.json({
      project: path.basename(projectPath),
      detectionId,
      ...result
    });
  } catch (error) {
    console.error('[HUMAN-REVIEW] Error recording feedback:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// ARTIFACT TRACKING APIs
// ============================================================================

// GET /api/artifacts - Get artifact summaries for a project
app.get('/api/artifacts', (req, res) => {
  const projectPath = req.query.project || defaultProjectPath;
  const limit = parseInt(req.query.limit || '20', 10);

  try {
    const summarizer = getArtifactSummarizer(projectPath);
    const cacheDir = path.join(projectPath, '.claude', 'state', 'summaries');

    // Read all cached summaries
    const artifacts = [];
    if (fs.existsSync(cacheDir)) {
      const files = fs.readdirSync(cacheDir)
        .filter(f => f.endsWith('.json'))
        .slice(0, limit);

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(cacheDir, file), 'utf8');
          const summary = JSON.parse(content);
          artifacts.push(summary);
        } catch (e) {
          // Skip invalid cache files
        }
      }
    }

    // Sort by timestamp (newest first)
    artifacts.sort((a, b) => (b.generatedAt || 0) - (a.generatedAt || 0));

    res.json({
      project: path.basename(projectPath),
      count: artifacts.length,
      artifacts
    });
  } catch (error) {
    console.error('[ARTIFACTS] Error getting artifacts:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/artifacts/summarize - Generate artifact summary
app.post('/api/artifacts/summarize', (req, res) => {
  const { artifactPath, forceFresh, project } = req.body;
  const projectPath = project || defaultProjectPath;

  if (!artifactPath) {
    return res.status(400).json({ error: 'artifactPath is required' });
  }

  try {
    const summarizer = getArtifactSummarizer(projectPath);
    const summary = summarizer.summarize(artifactPath, { forceFresh: forceFresh === true });

    res.json({
      project: path.basename(projectPath),
      ...summary
    });
  } catch (error) {
    console.error('[ARTIFACTS] Error summarizing artifact:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/artifacts/:artifactPath - Get summary for specific artifact
app.get('/api/artifacts/*artifactPath', (req, res) => {
  const artifactPath = req.params.artifactPath;
  const projectPath = req.query.project || defaultProjectPath;

  try {
    const summarizer = getArtifactSummarizer(projectPath);
    const summary = summarizer.summarize(artifactPath);

    res.json({
      project: path.basename(projectPath),
      ...summary
    });
  } catch (error) {
    console.error('[ARTIFACTS] Error getting artifact summary:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// START SERVER
// ============================================================================

const PORT = process.env.PORT || 3033;

// ============================================================================
// FLEET WEBSOCKET SERVER (/ws/fleet)
// ============================================================================

let wss = null;
const wsClients = new Set();

/**
 * Broadcast a message to all connected WebSocket clients
 * @param {Object} message - Message to broadcast
 */
function broadcastFleetEvent(message) {
  const data = JSON.stringify(message);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(data);
      } catch (err) {
        console.error('[WS/FLEET] Error sending to client:', err.message);
      }
    }
  }
}

/**
 * Initialize WebSocket server for fleet events
 * @param {http.Server} httpServer - HTTP server instance
 */
function initFleetWebSocket(httpServer) {
  wss = new WebSocket.Server({
    server: httpServer,
    path: '/ws/fleet'
  });

  wss.on('connection', (ws, req) => {
    console.log('[WS/FLEET] Client connected');
    wsClients.add(ws);

    // Send initial state on connection
    try {
      const summaryWithHierarchy = sessionRegistry.getSummaryWithHierarchy();
      const usageLimits = usageLimitTracker.getStatus();

      ws.send(JSON.stringify({
        type: 'init',
        timestamp: new Date().toISOString(),
        sessions: summaryWithHierarchy.sessions.length,
        activeSessions: summaryWithHierarchy.metrics.activeCount,
        fiveHourPercent: usageLimits.fiveHour.percent,
        hierarchyMetrics: summaryWithHierarchy.hierarchyMetrics
      }));
    } catch (err) {
      console.error('[WS/FLEET] Error sending init state:', err.message);
    }

    ws.on('close', () => {
      console.log('[WS/FLEET] Client disconnected');
      wsClients.delete(ws);
    });

    ws.on('error', (err) => {
      console.error('[WS/FLEET] Client error:', err.message);
      wsClients.delete(ws);
    });

    // Handle ping/pong for keep-alive
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  });

  // Heartbeat to detect stale connections
  const heartbeatInterval = setInterval(() => {
    for (const ws of wsClients) {
      if (ws.isAlive === false) {
        wsClients.delete(ws);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  // Wire up session registry events to WebSocket broadcasts
  sessionRegistry.on('session:registered', (session) => {
    broadcastFleetEvent({
      type: 'session:started',
      sessionId: session.id,
      project: session.project,
      timestamp: new Date().toISOString()
    });
  });

  sessionRegistry.on('session:updated', (session) => {
    broadcastFleetEvent({
      type: 'session:updated',
      sessionId: session.id,
      status: session.status,
      contextPercent: session.contextPercent,
      qualityScore: session.qualityScore,
      phase: session.phase,
      timestamp: new Date().toISOString()
    });
  });

  sessionRegistry.on('session:expired', (session) => {
    broadcastFleetEvent({
      type: 'session:completed',
      sessionId: session.id,
      project: session.project,
      duration: session.runtime * 1000,
      tokensUsed: session.tokens,
      timestamp: new Date().toISOString()
    });
  });

  sessionRegistry.on('delegation:added', ({ sessionId, delegation }) => {
    broadcastFleetEvent({
      type: 'delegation:started',
      sessionId,
      delegationId: delegation.delegationId,
      pattern: delegation.metadata?.pattern || 'SEQUENTIAL',
      taskId: delegation.taskId,
      timestamp: new Date().toISOString()
    });
  });

  sessionRegistry.on('delegation:updated', ({ sessionId, delegationId, status, delegation }) => {
    if (status === 'completed') {
      broadcastFleetEvent({
        type: 'delegation:completed',
        sessionId,
        delegationId,
        duration: delegation.createdAt ? Date.now() - new Date(delegation.createdAt).getTime() : 0,
        quality: delegation.result?.quality || null,
        timestamp: new Date().toISOString()
      });
    } else if (status === 'failed') {
      broadcastFleetEvent({
        type: 'delegation:failed',
        sessionId,
        delegationId,
        error: delegation.error || 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  sessionRegistry.on('task:completed', (completion) => {
    broadcastFleetEvent({
      type: 'task:completed',
      taskId: completion.taskId,
      project: completion.project,
      score: completion.score,
      timestamp: new Date().toISOString()
    });
  });

  // Wire up usage limit tracker for alerts
  const originalGetStatus = usageLimitTracker.getStatus.bind(usageLimitTracker);
  let lastAlertState = { fiveHour: false, daily: false };

  usageLimitTracker.getStatus = function() {
    const status = originalGetStatus();

    // Check for new critical alerts
    if (status.fiveHour.percent >= 90 && !lastAlertState.fiveHour) {
      lastAlertState.fiveHour = true;
      broadcastFleetEvent({
        type: 'alert:critical',
        id: `rate-limit-${Date.now()}`,
        alertType: 'rate_limit',
        message: `5-hour limit at ${status.fiveHour.percent}% - ${status.fiveHour.resetIn} remaining`,
        timestamp: new Date().toISOString()
      });
    } else if (status.fiveHour.percent < 90) {
      lastAlertState.fiveHour = false;
    }

    if (status.daily.percent >= 90 && !lastAlertState.daily) {
      lastAlertState.daily = true;
      broadcastFleetEvent({
        type: 'alert:warning',
        id: `daily-limit-${Date.now()}`,
        alertType: 'daily_limit',
        message: `Daily limit at ${status.daily.percent}%`,
        timestamp: new Date().toISOString()
      });
    } else if (status.daily.percent < 90) {
      lastAlertState.daily = false;
    }

    return status;
  };

  console.log('[WS/FLEET] WebSocket server initialized on /ws/fleet');
}

const server = app.listen(PORT, async () => {
  console.log('\n' + '='.repeat(70));
  console.log('GLOBAL CONTEXT MANAGER');
  console.log('='.repeat(70));
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/ (v2)`);
  console.log(`  Classic: http://localhost:${PORT}/global-dashboard-classic.html`);
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
  console.log('');
  console.log('Log Streaming:');
  console.log('  GET  /api/logs                      - List available log files');
  console.log('  GET  /api/logs/:id/stream           - SSE stream for session logs');
  console.log('  GET  /api/logs/:id/history          - Get historical logs');
  console.log('  GET  /api/logs/:id/stats            - Log file statistics');
  console.log('  POST /api/logs/:id/pause            - Pause log stream');
  console.log('  POST /api/logs/:id/resume           - Resume log stream');
  console.log('  POST /api/logs/:id/write            - Write log entry');
  console.log('');
  console.log('Lessons Learned:');
  console.log('  GET  /api/lessons/:project          - Get lessons for a project');
  console.log('  POST /api/lessons/:project          - Add a new lesson');
  console.log('  DELETE /api/lessons/:project/:id    - Delete a lesson');
  console.log('  GET  /api/lessons                   - Summary across all projects');
  console.log('');
  console.log('Human-in-Loop Review:');
  console.log('  GET  /api/human-review              - Get pending review items');
  console.log('  GET  /api/human-review/stats        - Detection statistics');
  console.log('  POST /api/human-review/analyze      - Analyze task for review needs');
  console.log('  POST /api/human-review/:id/feedback - Submit feedback on detection');
  console.log('');
  console.log('Artifact Tracking:');
  console.log('  GET  /api/artifacts                 - Get artifact summaries');
  console.log('  POST /api/artifacts/summarize       - Generate artifact summary');
  console.log('  GET  /api/artifacts/:path           - Get specific artifact summary');
  console.log('='.repeat(70) + '\n');

  // Start dev-docs file watcher
  startDevDocsWatcher();

  // Start tracking
  await tracker.start();

  // Start OTLP receiver if enabled
  if (otlpReceiver) {
    try {
      await otlpReceiver.start();
      console.log(`[OTLP] Receiver started on port ${OTLP_PORT}`);
      console.log('');
      console.log('OTLP Integration:');
      console.log(`  POST http://localhost:${OTLP_PORT}/v1/metrics - Receive OTLP metrics`);
      console.log(`  GET  http://localhost:${OTLP_PORT}/health     - OTLP receiver health`);
      console.log('');
    } catch (err) {
      console.warn('[OTLP] Failed to start receiver:', err.message);
    }
  }

  // Initialize Fleet WebSocket server
  initFleetWebSocket(server);
  console.log('');
  console.log('Fleet Management (NEW):');
  console.log(`  GET  /api/overview              - Fleet-level aggregated view`);
  console.log(`  GET  /api/agent-pool/status     - Agent lineage + delegation metrics`);
  console.log(`  WS   ws://localhost:${PORT}/ws/fleet - Real-time fleet events`);
  console.log('');
});

// CRITICAL: Handle server port binding errors (e.g., EADDRINUSE when another session is running)
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[ERROR] Port ${PORT} is already in use.`);
    console.error('Another session may be running. Options:');
    console.error('  1. Stop the other session first');
    console.error('  2. Use a different port: PORT=3034 node global-context-manager.js');
    console.error('');
    process.exit(1);
  }
  console.error('[ERROR] Server error:', err.message);
  process.exit(1);
});

// Graceful shutdown helper - closes all TaskManagers to release locks and claims
async function cleanupTaskManagers() {
  console.log('[SHUTDOWN] Closing TaskManagers to release locks and claims...');
  for (const [projectPath, tm] of taskManagerMap.entries()) {
    try {
      if (tm && typeof tm.close === 'function') {
        tm.close();
        console.log(`[SHUTDOWN] TaskManager closed for: ${path.basename(projectPath)}`);
      }
    } catch (error) {
      console.error(`[SHUTDOWN] Error closing TaskManager for ${projectPath}:`, error.message);
    }
  }
  taskManagerMap.clear();
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await cleanupTaskManagers(); // CRITICAL: Release locks and claims before exit
  if (devDocsWatcher) await devDocsWatcher.close();
  logStreamer.shutdown();
  if (otlpReceiver) {
    console.log('[OTLP] Stopping receiver...');
    await otlpReceiver.stop();
  }
  await tracker.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down...');
  await cleanupTaskManagers(); // CRITICAL: Release locks and claims before exit
  if (devDocsWatcher) await devDocsWatcher.close();
  logStreamer.shutdown();
  if (otlpReceiver) {
    await otlpReceiver.stop();
  }
  await tracker.stop();
  process.exit(0);
});
