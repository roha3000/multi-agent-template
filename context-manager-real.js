#!/usr/bin/env node

/**
 * Context Manager (REAL DATA VERSION)
 *
 * Real-time context monitoring with checkpoint capability.
 * Uses ACTUAL token counts from Claude Code JSONL session files.
 *
 * NO MORE Math.random() - This is 100% real data!
 *
 * Features:
 * - Real-time JSONL file watching with chokidar
 * - Accurate token tracking from API responses
 * - Automatic checkpoint triggers at 70%/85%/95%
 * - Integration with dev-docs 3-file pattern for state conservation
 * - Dashboard API endpoints for real-time updates
 *
 * @module context-manager-real
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const RealTimeContextTracker = require('./.claude/core/real-time-context-tracker');
const StateManager = require('./.claude/core/state-manager');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize State Manager for dev-docs pattern integration
const stateManager = new StateManager(process.cwd());

// Initialize Real-Time Context Tracker (NO SIMULATIONS!)
const tracker = new RealTimeContextTracker({
  projectPath: process.cwd(),
  contextWindowSize: 200000,  // Claude's context window
  thresholds: {
    warning: 0.50,    // 50% - early warning (plenty of time)
    critical: 0.70,   // 70% - should clear soon
    emergency: 0.85   // 85% - MUST clear now (before 95% auto-compact)
  },
  stateManager: stateManager,
  onCheckpoint: async (checkpointData) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`CHECKPOINT TRIGGERED: ${checkpointData.level.toUpperCase()}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Context: ${checkpointData.metrics.contextUsed.toLocaleString()} / ${checkpointData.metrics.contextWindow.toLocaleString()} tokens`);
    console.log(`Usage: ${checkpointData.metrics.contextPercent.toFixed(1)}%`);
    console.log(`Session: ${checkpointData.sessionId}`);
    console.log(`${'='.repeat(60)}\n`);

    // Save checkpoint file for recovery
    const checkpointDir = path.join(process.cwd(), '.claude', 'checkpoints');
    if (!fs.existsSync(checkpointDir)) {
      fs.mkdirSync(checkpointDir, { recursive: true });
    }

    const checkpointPath = path.join(
      checkpointDir,
      `checkpoint-${checkpointData.level}-${Date.now()}.json`
    );

    fs.writeFileSync(checkpointPath, JSON.stringify({
      ...checkpointData,
      devDocsFiles: {
        projectSummary: 'PROJECT_SUMMARY.md',
        plan: '.claude/dev-docs/plan.md',
        tasks: '.claude/dev-docs/tasks.md'
      },
      recoveryInstructions: `
To recover from this checkpoint:
1. Read the 3 dev-docs files (~400 tokens total)
2. These files contain all critical context
3. Continue from where you left off
      `.trim()
    }, null, 2));

    console.log(`Checkpoint saved to: ${checkpointPath}`);
  }
});

// Session state for API responses
let sessionState = {
  sessionId: null,
  projectPath: process.cwd(),
  projectName: path.basename(process.cwd()),
  model: 'claude-opus-4-5-20251101',
  status: 'initializing',
  executionPlan: {
    current: 'Initializing real-time context tracking...',
    completed: [],
    next: []
  }
};

// ============================================================================
// EVENT HANDLERS - React to real-time tracker events
// ============================================================================

tracker.on('started', (data) => {
  console.log('\n' + '='.repeat(60));
  console.log('REAL-TIME CONTEXT TRACKER STARTED');
  console.log('='.repeat(60));
  console.log(`Project: ${data.projectPath}`);
  console.log(`Session Path: ${data.sessionPath}`);
  console.log('='.repeat(60) + '\n');

  sessionState.status = 'active';
  sessionState.executionPlan.current = 'Monitoring context usage in real-time';
});

tracker.on('usage:update', (data) => {
  const { metrics } = data;

  // Update session state with REAL data
  sessionState.sessionId = data.sessionId;
  sessionState.contextUsage = metrics.contextPercent;
  sessionState.tokensUsed = metrics.contextUsed;
  sessionState.maxTokens = metrics.contextWindow;
  sessionState.inputTokens = metrics.inputTokens;
  sessionState.outputTokens = metrics.outputTokens;
  sessionState.lastUpdate = new Date().toISOString();
  sessionState.safetyStatus = metrics.safetyStatus;

  // Log significant updates
  if (metrics.messageCount % 10 === 0 || metrics.contextPercent >= 50) {
    console.log(`Context: ${metrics.contextPercent.toFixed(1)}% (${metrics.contextUsed.toLocaleString()} tokens) - ${metrics.safetyStatus}`);
  }
});

tracker.on('checkpoint:warning', (data) => {
  sessionState.checkpointStatus = 'warning';
  sessionState.executionPlan.current = 'WARNING: Context at 50% - State auto-saved, continue working';
  console.log('\n*** WARNING: Context at 50% - State saved ***\n');
});

tracker.on('checkpoint:critical', (data) => {
  sessionState.checkpointStatus = 'critical';
  sessionState.executionPlan.current = 'CRITICAL: Context at 70% - Consider running /clear soon';
  console.log('\n*** CRITICAL: Context at 70% - Run /clear then /session-init ***\n');
});

tracker.on('checkpoint:emergency', (data) => {
  sessionState.checkpointStatus = 'emergency';
  sessionState.executionPlan.current = 'EMERGENCY: Context at 85% - Run /clear NOW!';
  console.log('\n' + '!'.repeat(60));
  console.log('!!! EMERGENCY: Context at 85% - Run /clear NOW !!!');
  console.log('!!! Then run /session-init to reload state !!!');
  console.log('!' .repeat(60) + '\n');
});

tracker.on('session:new', (data) => {
  console.log(`\nNew session detected: ${data.sessionId}`);
  sessionState.sessionId = data.sessionId;
  sessionState.status = 'active';
});

tracker.on('error', (error) => {
  console.error('Tracker error:', error);
  sessionState.status = 'error';
});

// CRITICAL: Handle compaction detection
tracker.on('compaction:detected', (data) => {
  console.log('\n' + '!'.repeat(60));
  console.log('!!! COMPACTION DETECTED !!!');
  console.log('!'.repeat(60));
  console.log(`Tokens dropped: ${data.tokenDrop.toLocaleString()} (${(data.dropPercent * 100).toFixed(1)}%)`);
  console.log(`Previous: ${data.previousTokens.toLocaleString()} -> Current: ${data.currentTokens.toLocaleString()}`);
  console.log('');
  console.log('RECOVERY ACTION REQUIRED:');
  console.log('  Run: /session-init');
  console.log('');
  console.log('This will reload context from dev-docs (~400 tokens):');
  console.log('  1. PROJECT_SUMMARY.md');
  console.log('  2. .claude/dev-docs/plan.md');
  console.log('  3. .claude/dev-docs/tasks.md');
  console.log('!'.repeat(60) + '\n');

  sessionState.status = 'compaction-detected';
  sessionState.checkpointStatus = 'needs-reload';
  sessionState.executionPlan.current = 'COMPACTION DETECTED - Run /session-init to recover';
  sessionState.lastCompaction = data;
});

// ============================================================================
// API ENDPOINTS - Serve real data to dashboard
// ============================================================================

// Get current session(s) with REAL metrics
app.get('/api/sessions', (req, res) => {
  const metrics = tracker.getMetrics();
  const currentSession = tracker.getCurrentSession();

  res.json([{
    ...sessionState,
    ...metrics,
    session: currentSession,
    // REAL data - not simulated!
    contextUsage: metrics.contextPercent,
    tokensUsed: metrics.contextUsed,
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    cacheReadTokens: metrics.cacheReadTokens,
    cacheCreationTokens: metrics.cacheCreationTokens
  }]);
});

// Get project info
app.get('/api/projects', (req, res) => {
  const metrics = tracker.getMetrics();

  res.json([{
    path: sessionState.projectPath,
    name: sessionState.projectName,
    sessions: tracker.getAllSessions(),
    metrics: metrics,
    status: sessionState.status
  }]);
});

// Get REAL metrics
app.get('/api/metrics', (req, res) => {
  const metrics = tracker.getMetrics();

  res.json({
    // REAL token counts from JSONL
    totalTokensUsed: metrics.contextUsed,
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    cacheReadTokens: metrics.cacheReadTokens,
    cacheCreationTokens: metrics.cacheCreationTokens,

    // Context tracking
    contextUsage: metrics.contextPercent,
    contextWindow: metrics.contextWindow,
    remainingTokens: metrics.remainingTokens,

    // Session info
    activeSessions: metrics.sessionCount,
    messageCount: metrics.messageCount,
    currentSessionId: metrics.currentSessionId,

    // Velocity and projections
    velocity: metrics.velocity,
    projectedExhaustion: metrics.projectedExhaustion,

    // Safety
    safetyStatus: metrics.safetyStatus,
    checkpointState: metrics.checkpointState,

    // Meta
    timestamp: new Date().toISOString(),
    dataSource: 'REAL_JSONL_DATA'  // Not simulated!
  });
});

// Manual checkpoint trigger
app.post('/api/checkpoint', async (req, res) => {
  console.log('\nManual checkpoint requested');

  const metrics = tracker.getMetrics();
  const checkpointData = {
    level: 'manual',
    timestamp: new Date().toISOString(),
    utilization: metrics.contextPercent / 100,
    metrics: metrics,
    sessionId: metrics.currentSessionId,
    reason: req.body?.reason || 'manual-trigger'
  };

  // Save checkpoint
  const checkpointDir = path.join(process.cwd(), '.claude', 'checkpoints');
  if (!fs.existsSync(checkpointDir)) {
    fs.mkdirSync(checkpointDir, { recursive: true });
  }

  const checkpointPath = path.join(
    checkpointDir,
    `checkpoint-manual-${Date.now()}.json`
  );

  fs.writeFileSync(checkpointPath, JSON.stringify(checkpointData, null, 2));

  res.json({
    success: true,
    message: 'Manual checkpoint created',
    checkpointPath,
    metrics
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

  // Send initial state
  const sendUpdate = () => {
    const metrics = tracker.getMetrics();
    const data = {
      type: 'update',
      metrics: metrics,
      session: sessionState,
      alert: metrics.safetyStatus !== 'OK' ? {
        level: metrics.safetyStatus.toLowerCase(),
        message: `Context at ${metrics.contextPercent.toFixed(1)}% - ${metrics.safetyStatus}`
      } : null,
      timestamp: new Date().toISOString(),
      dataSource: 'REAL_JSONL_DATA'
    };

    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send updates when tracker emits events
  tracker.on('usage:update', sendUpdate);

  // Also send periodic updates
  const interval = setInterval(sendUpdate, 2000);

  req.on('close', () => {
    clearInterval(interval);
    tracker.removeListener('usage:update', sendUpdate);
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: tracker.isRunning ? 'healthy' : 'starting',
    dataSource: 'REAL_JSONL_DATA',
    uptime: process.uptime(),
    tracker: {
      running: tracker.isRunning,
      sessionCount: tracker.sessions?.size || 0,
      currentSession: tracker.currentSessionId
    }
  });
});

// ============================================================================
// START SERVER AND TRACKER
// ============================================================================

const PORT = process.env.PORT || 3032;

app.listen(PORT, async () => {
  console.log('\n' + '='.repeat(60));
  console.log('REAL-TIME CONTEXT MANAGER');
  console.log('='.repeat(60));
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`Project: ${process.cwd()}`);
  console.log('');
  console.log('IMPORTANT: Using REAL data from JSONL session files');
  console.log('           NO MORE Math.random() simulations!');
  console.log('='.repeat(60));
  console.log('');
  console.log('Endpoints:');
  console.log(`  GET  /api/metrics    - Real-time token usage`);
  console.log(`  GET  /api/sessions   - Active session info`);
  console.log(`  GET  /api/events     - SSE real-time stream`);
  console.log(`  POST /api/checkpoint - Manual checkpoint trigger`);
  console.log('');
  console.log('Checkpoint Thresholds (earlier warnings!):');
  console.log('  50% - Warning (state auto-saved)');
  console.log('  70% - Critical (consider /clear)');
  console.log('  85% - Emergency (MUST /clear now!)');
  console.log('');
  console.log('Dashboard: file://' + __dirname + '/context-alert-dashboard.html');
  console.log('='.repeat(60));
  console.log('');

  // Start the tracker
  await tracker.start();
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await tracker.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down...');
  await tracker.stop();
  process.exit(0);
});
