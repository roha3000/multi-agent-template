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

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files (dashboard)
app.use(express.static(__dirname));

// Initialize Global Context Tracker
const tracker = new GlobalContextTracker({
  thresholds: {
    warning: 0.50,    // 50% - early warning
    critical: 0.65,   // 65% - should clear soon
    emergency: 0.75   // 75% - MUST clear now (before 77.5% auto-compact)
  }
});

// Store recent alerts for dashboard
const recentAlerts = [];
const MAX_ALERTS = 50;

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

tracker.on('alert:warning', (data) => {
  console.log('\n' + '*'.repeat(70));
  console.log(`*** WARNING: ${data.projectName} at ${(data.utilization * 100).toFixed(1)}% ***`);
  console.log('*'.repeat(70) + '\n');
  addAlert({
    level: 'warning',
    project: data.projectName,
    path: data.projectPath,
    message: `Context at ${(data.utilization * 100).toFixed(1)}% - State auto-saved`
  });
});

tracker.on('alert:critical', (data) => {
  console.log('\n' + '!'.repeat(70));
  console.log(`!!! CRITICAL: ${data.projectName} at ${(data.utilization * 100).toFixed(1)}% !!!`);
  console.log(`!!! Path: ${data.projectPath}`);
  console.log(`!!! Action: Consider running /clear soon`);
  console.log('!'.repeat(70) + '\n');
  addAlert({
    level: 'critical',
    project: data.projectName,
    path: data.projectPath,
    message: `Context at ${(data.utilization * 100).toFixed(1)}% - Run /clear soon!`
  });
});

tracker.on('alert:emergency', (data) => {
  console.log('\n' + '!'.repeat(70));
  console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.log(`!!! EMERGENCY: ${data.projectName} at ${(data.utilization * 100).toFixed(1)}% !!!`);
  console.log(`!!! Path: ${data.projectPath}`);
  console.log(`!!! Action: Run /clear NOW, then /session-init`);
  console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  console.log('!'.repeat(70) + '\n');
  addAlert({
    level: 'emergency',
    project: data.projectName,
    path: data.projectPath,
    message: `Context at ${(data.utilization * 100).toFixed(1)}% - Run /clear NOW!`
  });
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

// Generate stable task ID from text using hash
function generateTaskId(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'task_' + Math.abs(hash).toString(16);
}

// Extract priority from emoji in task text
function extractPriority(text) {
  if (text.includes('🔴')) return 'critical';
  if (text.includes('🟡')) return 'high';
  if (text.includes('🟢')) return 'medium';
  if (text.includes('⚪')) return 'low';
  return null;
}

// Extract phase from task text [PHASE] format
function extractPhase(text) {
  const phaseMatch = text.match(/\[([A-Z]+)\]/i);
  return phaseMatch ? phaseMatch[1].toLowerCase() : null;
}

// Determine category from section header
function determineCategory(sectionHeader) {
  if (!sectionHeader) return 'backlog';
  const lower = sectionHeader.toLowerCase();
  if (lower.includes('current') || lower.includes('in progress') || lower.includes('active')) return 'current';
  if (lower.includes('completed') || lower.includes('done')) return 'completed';
  if (lower.includes('backlog') || lower.includes('next') || lower.includes('option')) return 'backlog';
  return 'backlog';
}

function parseTasksMarkdown(content) {
  const todos = [];
  let currentPhase = null;
  let currentSection = '';

  // Extract current phase from header
  const phaseMatch = content.match(/Current Session[:\s]+([^\n]+)/i);
  if (phaseMatch) {
    currentPhase = phaseMatch[1].trim();
  }

  // Extract status
  const statusMatch = content.match(/Status[:\s]+([^\n]+)/i);
  const status = statusMatch ? statusMatch[1].trim() : null;

  // Parse line by line to track sections
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track section headers
    if (line.startsWith('##')) {
      currentSection = line;
      continue;
    }

    // Parse checkbox items
    const taskMatch = line.match(/^[\s-]*\[([x ])\]\s*\*?\*?([^*\n]+)\*?\*?$/i);
    if (taskMatch) {
      const text = taskMatch[2].trim();
      todos.push({
        id: generateTaskId(text),
        completed: taskMatch[1].toLowerCase() === 'x',
        text: text,
        priority: extractPriority(text),
        phase: extractPhase(text),
        category: determineCategory(currentSection),
        lineNumber: i
      });
    }
  }

  return { todos, phase: currentPhase, status, rawContent: content };
}

// Write tasks back to tasks.md preserving structure
function writeTasksFile(updates) {
  const tasksPath = path.join(__dirname, '.claude', 'dev-docs', 'tasks.md');
  try {
    let content = fs.existsSync(tasksPath) ? fs.readFileSync(tasksPath, 'utf-8') : '';
    const lines = content.split('\n');

    // Process updates (array of {id, completed, text} or single update)
    const updateList = Array.isArray(updates) ? updates : [updates];
    const updateMap = new Map(updateList.map(u => [u.id, u]));

    // Update matching lines
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const taskMatch = line.match(/^([\s-]*)\[([x ])\]\s*\*?\*?([^*\n]+)\*?\*?$/i);

      if (taskMatch) {
        const text = taskMatch[3].trim();
        const taskId = generateTaskId(text);
        const update = updateMap.get(taskId);

        if (update) {
          const indent = taskMatch[1];
          const checkbox = update.completed ? '[x]' : '[ ]';
          const newText = update.text || text;
          lines[i] = `${indent}${checkbox} ${newText}`;
          updateMap.delete(taskId);
        }
      }
    }

    // Add new tasks if any remain (append to end of first ## section)
    if (updateMap.size > 0) {
      const newTasks = Array.from(updateMap.values());
      const insertLines = newTasks.map(t => {
        const checkbox = t.completed ? '[x]' : '[ ]';
        return `- ${checkbox} ${t.text}`;
      });

      // Find a good insertion point (after first ## header)
      let insertIndex = lines.findIndex(l => l.startsWith('## '));
      if (insertIndex !== -1) {
        // Find next section or end
        let endIndex = lines.findIndex((l, idx) => idx > insertIndex && l.startsWith('## '));
        if (endIndex === -1) endIndex = lines.length;
        lines.splice(endIndex, 0, '', ...insertLines);
      } else {
        lines.push('', ...insertLines);
      }
    }

    fs.writeFileSync(tasksPath, lines.join('\n'), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error writing tasks file:', err);
    return false;
  }
}

// Delete a task by ID from tasks.md
function deleteTaskFromFile(taskId) {
  const tasksPath = path.join(__dirname, '.claude', 'dev-docs', 'tasks.md');
  try {
    const content = fs.readFileSync(tasksPath, 'utf-8');
    const lines = content.split('\n');

    const filteredLines = lines.filter(line => {
      const taskMatch = line.match(/^[\s-]*\[([x ])\]\s*\*?\*?([^*\n]+)\*?\*?$/i);
      if (taskMatch) {
        const text = taskMatch[2].trim();
        return generateTaskId(text) !== taskId;
      }
      return true;
    });

    fs.writeFileSync(tasksPath, filteredLines.join('\n'), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error deleting task:', err);
    return false;
  }
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: tracker.isRunning ? 'healthy' : 'starting',
    projectCount: tracker.projects.size,
    uptime: process.uptime()
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

// Get todos from tasks.md (legacy endpoint)
app.get('/api/execution/todos', (req, res) => {
  const tasks = readTasksFile();
  res.json(tasks);
});

// ============================================================================
// TASK MANAGEMENT API ENDPOINTS
// ============================================================================

// GET /api/todos - Get all tasks with filtering
app.get('/api/todos', (req, res) => {
  try {
    const { status, phase, priority, category } = req.query;
    let { todos } = readTasksFile();

    // Apply filters
    if (status) {
      const statuses = status.split(',');
      todos = todos.filter(task => {
        if (statuses.includes('pending') && !task.completed) return true;
        if (statuses.includes('completed') && task.completed) return true;
        return false;
      });
    }

    if (phase) {
      todos = todos.filter(task => task.phase === phase.toLowerCase());
    }

    if (priority) {
      todos = todos.filter(task => task.priority === priority.toLowerCase());
    }

    if (category) {
      todos = todos.filter(task => task.category === category.toLowerCase());
    }

    res.json({ success: true, count: todos.length, tasks: todos });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/todos/backlog - Get backlog tasks only
app.get('/api/todos/backlog', (req, res) => {
  try {
    const { todos } = readTasksFile();
    const backlogTasks = todos.filter(task =>
      task.category === 'backlog' && !task.completed
    );
    res.json({ success: true, count: backlogTasks.length, tasks: backlogTasks });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/todos - Create new task
app.post('/api/todos', (req, res) => {
  try {
    const { text, priority, phase, category } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Task text is required' });
    }

    // Build task text with metadata
    let taskText = text.trim();

    // Add priority emoji if specified
    if (priority) {
      const priorityEmoji = { critical: '🔴', high: '🟡', medium: '🟢', low: '⚪' };
      const emoji = priorityEmoji[priority.toLowerCase()];
      if (emoji && !taskText.includes(emoji)) {
        taskText = `${emoji} ${taskText}`;
      }
    }

    // Add phase tag if specified
    if (phase && !taskText.match(/\[[A-Z]+\]/i)) {
      taskText = `[${phase.toUpperCase()}] ${taskText}`;
    }

    const newTask = {
      id: generateTaskId(taskText),
      text: taskText,
      completed: false,
      priority: extractPriority(taskText),
      phase: extractPhase(taskText),
      category: category || 'backlog'
    };

    // Write to file
    const success = writeTasksFile(newTask);
    if (success) {
      updateExecutionState(); // Refresh state
      res.status(201).json({ success: true, task: newTask });
    } else {
      res.status(500).json({ success: false, error: 'Failed to write task' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/todos/:id/status - Toggle task completion
app.patch('/api/todos/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    const { todos } = readTasksFile();
    const task = todos.find(t => t.id === id);

    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const updatedTask = { ...task, completed: !task.completed };
    const success = writeTasksFile(updatedTask);

    if (success) {
      updateExecutionState(); // Refresh state
      res.json({ success: true, task: updatedTask });
    } else {
      res.status(500).json({ success: false, error: 'Failed to update task' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/todos/:id - Update task
app.put('/api/todos/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { text, priority, phase } = req.body;
    const { todos } = readTasksFile();
    const task = todos.find(t => t.id === id);

    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    let newText = text ? text.trim() : task.text;

    // Update priority emoji
    if (priority) {
      const priorityEmoji = { critical: '🔴', high: '🟡', medium: '🟢', low: '⚪' };
      newText = newText.replace(/[🔴🟡🟢⚪]\s*/g, ''); // Remove existing
      const emoji = priorityEmoji[priority.toLowerCase()];
      if (emoji) newText = `${emoji} ${newText}`;
    }

    // Update phase tag
    if (phase) {
      newText = newText.replace(/\[[A-Z]+\]\s*/gi, ''); // Remove existing
      newText = `[${phase.toUpperCase()}] ${newText}`;
    }

    const updatedTask = {
      ...task,
      id: generateTaskId(newText), // New ID based on new text
      text: newText,
      priority: extractPriority(newText),
      phase: extractPhase(newText)
    };

    // Delete old and write new (since ID changed)
    deleteTaskFromFile(id);
    const success = writeTasksFile(updatedTask);

    if (success) {
      updateExecutionState();
      res.json({ success: true, task: updatedTask });
    } else {
      res.status(500).json({ success: false, error: 'Failed to update task' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/todos/:id - Delete task
app.delete('/api/todos/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { todos } = readTasksFile();
    const task = todos.find(t => t.id === id);

    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const success = deleteTaskFromFile(id);

    if (success) {
      updateExecutionState();
      res.json({ success: true, message: 'Task deleted', deletedTask: task });
    } else {
      res.status(500).json({ success: false, error: 'Failed to delete task' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
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
