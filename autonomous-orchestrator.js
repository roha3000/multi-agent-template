#!/usr/bin/env node

/**
 * Autonomous Orchestrator
 *
 * Runs Claude Code in a continuous loop with:
 * - Phase-based execution (research → design → implement → test)
 * - Quality gates with scoring thresholds
 * - Multi-agent validation (reviewers, critics checking work)
 * - Automatic session cycling at context threshold
 * - Full autonomous execution with --dangerously-skip-permissions
 *
 * @module autonomous-orchestrator
 */

const { spawn, exec } = require('child_process');
const { EventSource } = require('eventsource');
const path = require('path');
const fs = require('fs');
const http = require('http');
const {
  PHASES,
  AGENT_ROLES,
  calculatePhaseScore,
  isPhaseComplete,
  getNextPhase,
  generateScoringPrompt,
  generateImprovementGuidance,
} = require('./quality-gates');
const TaskManager = require('./.claude/core/task-manager');
const MemoryStore = require('./.claude/core/memory-store');
const NotificationService = require('./.claude/core/notification-service');

// Phase name mapping (tasks.json uses longer names, quality-gates uses shorter)
const PHASE_MAP = {
  'research': 'research',
  'planning': 'research',  // Map planning to research phase
  'design': 'design',
  'implementation': 'implement',
  'implement': 'implement',
  'testing': 'test',
  'test': 'test',
  'validation': 'test',  // Map validation to test phase
};

function normalizePhase(phase) {
  return PHASE_MAP[phase] || phase;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  dashboardUrl: process.env.DASHBOARD_URL || 'http://localhost:3033/api/events',
  contextThreshold: parseInt(process.env.CONTEXT_THRESHOLD) || 65,
  sessionDelay: parseInt(process.env.SESSION_DELAY) || 5000,
  maxSessions: parseInt(process.env.MAX_SESSIONS) || 0,
  maxIterationsPerPhase: parseInt(process.env.MAX_ITERATIONS_PER_PHASE) || 10,
  projectPath: process.env.PROJECT_PATH || process.cwd(),
  startPhase: 'research',
  task: null,
};

// Parse command line arguments
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--phase':
      CONFIG.startPhase = args[++i];
      break;
    case '--threshold':
      CONFIG.contextThreshold = parseInt(args[++i]);
      break;
    case '--max-sessions':
      CONFIG.maxSessions = parseInt(args[++i]);
      break;
    case '--max-iterations':
      CONFIG.maxIterationsPerPhase = parseInt(args[++i]);
      break;
    case '--task':
      CONFIG.task = args[++i];
      break;
    case '--delay':
      CONFIG.sessionDelay = parseInt(args[++i]);
      break;
    case '--help':
    case '-h':
      printHelp();
      process.exit(0);
  }
}

// ============================================================================
// STATE
// ============================================================================

const state = {
  currentPhase: CONFIG.startPhase,
  phaseIteration: 0,
  totalSessions: 0,
  phaseScores: {},
  sessionHistory: [],
  startTime: new Date(),
  task: CONFIG.task,
  currentTask: null,        // Current task from TaskManager
  tasksCompleted: 0,        // Tasks completed this session
  taskIterations: {},       // Track iterations per task
};

let claudeProcess = null;
let eventSource = null;
let shouldContinue = true;
let thresholdReached = false;
let currentSessionData = null;

// Task Management instances (initialized in main)
let taskManager = null;
let memoryStore = null;

// Notification Service (initialized in main)
let notificationService = null;

// ============================================================================
// PROMPT GENERATION
// ============================================================================

function generatePhasePrompt(phase, iteration, previousScore = null, improvements = null, task = null) {
  const normalizedPhase = normalizePhase(phase);
  const phaseConfig = PHASES[normalizedPhase];
  if (!phaseConfig) throw new Error(`Unknown phase: ${phase} (normalized: ${normalizedPhase})`);

  let prompt = '';

  if (task) {
    prompt += `# Task: ${task.title}\n\n`;
    prompt += `**Task ID**: ${task.id}\n`;
    prompt += `**Phase**: ${phase}\n`;
    prompt += `**Iteration**: ${iteration}\n\n`;

    if (task.description) {
      prompt += `## Description\n${task.description}\n\n`;
    }

    if (task.acceptance && task.acceptance.length > 0) {
      prompt += `## Acceptance Criteria\n`;
      task.acceptance.forEach((criterion, i) => {
        prompt += `${i + 1}. ${criterion}\n`;
      });
      prompt += `\n`;
    }

    // Previous score feedback
    if (previousScore !== null && previousScore > 0) {
      prompt += `## Previous Attempt\n`;
      prompt += `Score: ${previousScore}/100 (minimum required: ${phaseConfig.minScore})\n`;
      if (improvements && improvements.length > 0) {
        prompt += `Improvements needed:\n`;
        improvements.forEach((imp, i) => {
          prompt += `- ${imp}\n`;
        });
      }
      prompt += `\n`;
    }

    prompt += `## Instructions\n`;
    prompt += `1. Read PROJECT_SUMMARY.md to understand the project context\n`;
    prompt += `2. Work through each acceptance criterion\n`;
    prompt += `3. Implement or verify each requirement\n`;
    prompt += `4. When complete, write the completion files as specified below\n\n`;

    // CRITICAL: Tell Claude how to signal completion
    prompt += `## IMPORTANT: Completion Protocol\n\n`;
    prompt += `When you have completed (or verified) ALL acceptance criteria, you MUST write TWO files:\n\n`;

    prompt += `### 1. Task Completion File\n`;
    prompt += `Write to \`.claude/dev-docs/task-completion.json\`:\n`;
    prompt += `\`\`\`json\n`;
    prompt += `{\n`;
    prompt += `  "taskId": "${task.id}",\n`;
    prompt += `  "status": "completed",\n`;
    prompt += `  "acceptanceMet": [${task.acceptance.map(() => 'true').join(', ')}],\n`;
    prompt += `  "deliverables": ["list of files created/modified"],\n`;
    prompt += `  "notes": "brief summary of what was done",\n`;
    prompt += `  "completedAt": "<current ISO timestamp>"\n`;
    prompt += `}\n`;
    prompt += `\`\`\`\n\n`;

    prompt += `### 2. Quality Scores File\n`;
    prompt += `Write to \`.claude/dev-docs/quality-scores.json\`:\n`;
    prompt += `\`\`\`json\n`;
    prompt += `{\n`;
    prompt += `  "phase": "${phase}",\n`;
    prompt += `  "taskId": "${task.id}",\n`;
    prompt += `  "scores": {\n`;
    phaseConfig.criteria.forEach((criterion, i) => {
      prompt += `    "${criterion.id}": <score 0-100>${i < phaseConfig.criteria.length - 1 ? ',' : ''}\n`;
    });
    prompt += `  },\n`;
    prompt += `  "recommendation": "proceed",\n`;
    prompt += `  "improvements": [],\n`;
    prompt += `  "evaluatedAt": "<current ISO timestamp>"\n`;
    prompt += `}\n`;
    prompt += `\`\`\`\n\n`;

    prompt += `**Scoring criteria for ${phaseConfig.name} phase**:\n`;
    phaseConfig.criteria.forEach(criterion => {
      prompt += `- **${criterion.id}** (weight: ${criterion.weight}): ${criterion.description}\n`;
    });
    prompt += `\nMinimum score to proceed: ${phaseConfig.minScore}/100\n`;

  } else if (state.task) {
    // Fallback for --task CLI argument (no structured task)
    prompt += `Execute this task: ${state.task}\n\n`;
    prompt += `Start by reading PROJECT_SUMMARY.md to understand the project context.\n\n`;
    prompt += `When complete, write a summary of what was accomplished.`;
  }

  return prompt;
}

function generateValidationPrompt(phase) {
  const phaseConfig = PHASES[phase];

  let prompt = `# VALIDATION SESSION: Review ${phaseConfig.name} Phase\n\n`;

  prompt += `## Your Role: Quality Reviewer + Technical Critic\n\n`;

  prompt += `You are validating work completed by another agent. Be thorough and critical.\n\n`;

  prompt += `## Instructions\n\n`;
  prompt += `1. Run \`/session-init\` to load context\n`;
  prompt += `2. Review all deliverables for the ${phase} phase\n`;
  prompt += `3. Score each criterion objectively:\n\n`;

  prompt += generateScoringPrompt(phase);

  prompt += `\n## Validation Mindset\n\n`;
  prompt += `- Assume nothing is correct until verified\n`;
  prompt += `- Look for gaps, inconsistencies, and oversights\n`;
  prompt += `- Consider security, performance, and edge cases\n`;
  prompt += `- Provide specific, actionable feedback\n`;
  prompt += `- Be honest - a low score now prevents problems later\n`;

  return prompt;
}

// ============================================================================
// SCORE PARSING & TASK COMPLETION
// ============================================================================

function readQualityScores() {
  const scoresPath = path.join(CONFIG.projectPath, '.claude', 'dev-docs', 'quality-scores.json');

  try {
    if (fs.existsSync(scoresPath)) {
      const content = fs.readFileSync(scoresPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.log('[SCORES] Could not read quality scores:', err.message);
  }

  return null;
}

function readTaskCompletion() {
  const completionPath = path.join(CONFIG.projectPath, '.claude', 'dev-docs', 'task-completion.json');

  try {
    if (fs.existsSync(completionPath)) {
      const content = fs.readFileSync(completionPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.log('[TASK] Could not read task completion:', err.message);
  }

  return null;
}

function clearTaskCompletion() {
  const completionPath = path.join(CONFIG.projectPath, '.claude', 'dev-docs', 'task-completion.json');
  try {
    if (fs.existsSync(completionPath)) {
      fs.unlinkSync(completionPath);
    }
  } catch (err) {
    // Ignore errors
  }
}

function evaluatePhaseCompletion() {
  const scores = readQualityScores();
  const normalizedPhase = normalizePhase(state.currentPhase);

  if (!scores || (scores.phase !== state.currentPhase && scores.phase !== normalizedPhase)) {
    return { complete: false, score: 0, reason: 'No scores found for current phase' };
  }

  const calculatedScore = calculatePhaseScore(normalizedPhase, scores.scores || {});
  const minScore = PHASES[normalizedPhase]?.minScore || 80;

  if (calculatedScore >= minScore && scores.recommendation === 'proceed') {
    return { complete: true, score: calculatedScore, reason: 'Quality gate passed' };
  }

  return {
    complete: false,
    score: calculatedScore,
    reason: `Score ${calculatedScore} < ${minScore} or recommendation is not "proceed"`,
    improvements: scores.improvements || [],
  };
}

/**
 * Evaluate task completion from task-completion.json
 * @returns {Object} { complete, taskId, deliverables, notes }
 */
function evaluateTaskCompletion() {
  const completion = readTaskCompletion();

  if (!completion) {
    return { complete: false, reason: 'No task completion file found' };
  }

  // Check if it matches current task
  if (state.currentTask && completion.taskId !== state.currentTask.id) {
    return { complete: false, reason: `Task ID mismatch: expected ${state.currentTask.id}, got ${completion.taskId}` };
  }

  if (completion.status === 'completed') {
    // Check if all acceptance criteria are met
    const allMet = completion.acceptanceMet?.every(m => m === true) ?? true;

    if (allMet) {
      return {
        complete: true,
        taskId: completion.taskId,
        deliverables: completion.deliverables || [],
        notes: completion.notes || '',
      };
    } else {
      return {
        complete: false,
        reason: 'Not all acceptance criteria met',
        acceptanceMet: completion.acceptanceMet,
      };
    }
  }

  return { complete: false, reason: `Task status is ${completion.status}` };
}

/**
 * Handle task completion - update TaskManager and MemoryStore
 */
function handleTaskCompletion(taskCompletion, qualityScore) {
  if (!taskManager || !state.currentTask) return;

  const task = state.currentTask;

  try {
    // Calculate duration
    const started = task.started || new Date().toISOString();
    const completed = new Date().toISOString();
    const durationMs = new Date(completed) - new Date(started);
    const durationHours = durationMs / (1000 * 60 * 60);

    // Update task status in TaskManager
    taskManager.updateStatus(task.id, 'completed', {
      deliverables: taskCompletion.deliverables,
      notes: taskCompletion.notes,
      qualityScore,
      actualDuration: `${durationHours.toFixed(1)}h`,
    });

    state.tasksCompleted++;
    console.log(`[TASK] Completed: ${task.title} (${task.id})`);
    console.log(`[TASK] Duration: ${durationHours.toFixed(1)}h, Quality: ${qualityScore}/100`);

    // Clear completion file for next task
    clearTaskCompletion();

  } catch (err) {
    console.error('[TASK] Error handling completion:', err.message);
  }
}

/**
 * Get next task from TaskManager or fall back to --task argument
 * @returns {Object|null} Task object or null
 */
function getNextTaskFromManager() {
  if (!taskManager) return null;

  try {
    const nextTask = taskManager.getNextTask(state.currentPhase);

    if (nextTask) {
      // Mark as in_progress
      taskManager.updateStatus(nextTask.id, 'in_progress');
      console.log(`[TASK] Selected: ${nextTask.title} (${nextTask.id})`);
      console.log(`[TASK] Priority: ${nextTask.priority}, Estimate: ${nextTask.estimate}`);
      return nextTask;
    }

    return null;
  } catch (err) {
    console.error('[TASK] Error getting next task:', err.message);
    return null;
  }
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

function runSession(prompt) {
  return new Promise((resolve) => {
    console.log('\n' + '─'.repeat(70));
    console.log(`SESSION ${state.totalSessions + 1}: ${state.currentPhase} phase (iteration ${state.phaseIteration})`);
    console.log('─'.repeat(70));
    console.log('\nPrompt preview (first 500 chars):');
    console.log(prompt.substring(0, 500) + '...\n');
    console.log('─'.repeat(70) + '\n');

    // Spawn Claude with dangerous skip permissions for autonomous execution
    // Pass prompt as argument (without -p flag which is print-and-exit mode)
    // The prompt is passed as the last argument for interactive mode
    //
    // Output handling options:
    // - 'inherit': Shows output in terminal (good for debugging, but pollutes context if nested)
    // - 'pipe': Captures output for logging to file
    //
    // We use 'pipe' and manually stream to both console and log file
    const logPath = path.join(CONFIG.projectPath, '.claude', 'logs', `session-${state.totalSessions}.log`);
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    console.log(`[LOG] Session output being written to: ${logPath}`);
    console.log(`[PROMPT] ${prompt.length} chars`);

    // Write prompt to temp file (avoids all escaping issues)
    const promptFile = path.join(CONFIG.projectPath, '.claude', 'logs', `prompt-${state.totalSessions}.txt`);
    fs.writeFileSync(promptFile, prompt, 'utf8');

    // Use input redirection on Windows, cat pipe on Unix
    const cmd = process.platform === 'win32'
      ? `claude -p --dangerously-skip-permissions < "${promptFile}"`
      : `cat "${promptFile}" | claude -p --dangerously-skip-permissions`;
    console.log(`[CMD] ${cmd}`);

    claudeProcess = exec(cmd, {
      cwd: CONFIG.projectPath,
      maxBuffer: 50 * 1024 * 1024,
    });

    // Stream stdout to console and log
    claudeProcess.stdout.on('data', (data) => {
      process.stdout.write(data);
      logStream.write(data);
    });

    // Stream stderr to console and log
    claudeProcess.stderr.on('data', (data) => {
      process.stderr.write(data);
      logStream.write(data);
    });

    claudeProcess.on('error', (err) => {
      console.error('[ERROR]', err.message);
      logStream.end();
      currentSessionData.exitReason = 'error';
      resolve(1);
    });

    claudeProcess.on('close', (code) => {
      logStream.end();
      currentSessionData.exitReason = code === 0 ? 'complete' : 'error';
      claudeProcess = null;
      resolve(code || 0);
    });
  });
}

// ============================================================================
// DASHBOARD INTEGRATION
// ============================================================================

function connectToDashboard() {
  console.log('[DASHBOARD] Connecting to SSE...');

  eventSource = new EventSource(CONFIG.dashboardUrl);

  eventSource.onopen = () => {
    console.log('[DASHBOARD] Connected.\n');
  };

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleDashboardUpdate(data);
    } catch (err) {
      // Ignore parse errors
    }
  };

  eventSource.onerror = () => {
    console.error('[DASHBOARD] Connection error. Ensure dashboard is running:');
    console.error('  npm run monitor:global\n');
  };
}

function handleDashboardUpdate(data) {
  if (!data.projects || !claudeProcess) return;

  const projectName = path.basename(CONFIG.projectPath);
  const project = data.projects.find(p =>
    p.name === projectName || p.path?.includes(projectName)
  );

  if (!project) return;

  const contextUsed = project.contextPercent || project.metrics?.contextPercent || 0;

  if (currentSessionData) {
    if (contextUsed > currentSessionData.peakContext) {
      currentSessionData.peakContext = contextUsed;
    }
  }

  if (contextUsed >= CONFIG.contextThreshold && !thresholdReached && claudeProcess) {
    thresholdReached = true;
    console.log(`\n[ORCHESTRATOR] Context threshold reached: ${contextUsed.toFixed(1)}%`);

    // CRITICAL FIX: Close EventSource before killing process to prevent
    // it from continuing to accumulate events during session transition
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    claudeProcess.kill('SIGTERM');
  }
}

function postToDashboard(endpoint, data) {
  return new Promise((resolve) => {
    try {
      const url = new URL(CONFIG.dashboardUrl);
      const postData = JSON.stringify(data);

      const options = {
        hostname: url.hostname,
        port: url.port || 3033,
        path: endpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => resolve({ success: true }));
      });

      req.on('error', () => resolve({ success: false }));
      req.write(postData);
      req.end();
    } catch {
      resolve({ success: false });
    }
  });
}

// ============================================================================
// MAIN LOOP
// ============================================================================

/**
 * Initialize TaskManager and MemoryStore
 */
function initializeTaskManagement() {
  const tasksPath = path.join(CONFIG.projectPath, 'tasks.json');

  // Check if tasks.json exists
  if (!fs.existsSync(tasksPath)) {
    console.log('[TASK] No tasks.json found - using --task argument mode');
    return false;
  }

  try {
    // Initialize MemoryStore first (for historical learning)
    const dbPath = path.join(CONFIG.projectPath, '.claude', 'data', 'memory.db');
    memoryStore = new MemoryStore(dbPath);

    // Initialize TaskManager with MemoryStore
    taskManager = new TaskManager({
      tasksPath,
      memoryStore,
    });

    // Set up event listeners
    taskManager.on('task:completed', ({ task }) => {
      console.log(`[EVENT] Task completed: ${task.title}`);
    });

    taskManager.on('task:unblocked', ({ task, unblockedBy }) => {
      console.log(`[EVENT] Task unblocked: ${task.title} (by ${unblockedBy})`);
    });

    taskManager.on('task:promoted', ({ task, from, to }) => {
      console.log(`[EVENT] Task promoted: ${task.title} (${from} → ${to})`);
    });

    const stats = taskManager.getStats();
    console.log(`[TASK] TaskManager initialized: ${stats.total} tasks`);
    console.log(`[TASK] Ready: ${stats.byStatus.ready || 0}, In Progress: ${stats.byStatus.in_progress || 0}, Blocked: ${stats.byStatus.blocked || 0}`);

    return true;
  } catch (err) {
    console.error('[TASK] Failed to initialize TaskManager:', err.message);
    return false;
  }
}

async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('AUTONOMOUS MULTI-AGENT ORCHESTRATOR');
  console.log('═'.repeat(70));
  console.log(`Phase: ${CONFIG.startPhase}`);
  console.log(`Context Threshold: ${CONFIG.contextThreshold}%`);
  console.log(`Max Sessions: ${CONFIG.maxSessions || 'unlimited'}`);
  console.log(`Max Iterations/Phase: ${CONFIG.maxIterationsPerPhase}`);
  if (CONFIG.task) console.log(`Task (CLI): ${CONFIG.task}`);
  console.log('═'.repeat(70) + '\n');

  // Initialize TaskManager (optional - falls back to --task mode)
  const taskManagementEnabled = initializeTaskManagement();
  if (taskManagementEnabled) {
    console.log('[MODE] Task-driven execution (using tasks.json)\n');
  } else {
    console.log('[MODE] Phase-driven execution (using --task argument)\n');
  }

  // Initialize Notification Service for phase completion alerts
  try {
    notificationService = new NotificationService();
    const notifStatus = await notificationService.initialize();
    console.log('[NOTIFICATIONS] Initialized:', {
      sms: notifStatus.sms.available ? 'Available' : 'Unavailable',
      email: notifStatus.email.available ? 'Available' : 'Unavailable'
    });
  } catch (err) {
    console.log('[NOTIFICATIONS] Not configured:', err.message);
    notificationService = null;
  }

  connectToDashboard();
  await postToDashboard('/api/series/start', {});

  while (shouldContinue && state.currentPhase !== 'complete') {
    state.phaseIteration++;
    state.totalSessions++;

    // Check limits
    if (CONFIG.maxSessions > 0 && state.totalSessions > CONFIG.maxSessions) {
      console.log('\n[LIMIT] Max sessions reached.');
      break;
    }

    // ====================================================================
    // TASK SELECTION (new integration)
    // ====================================================================

    let currentTask = null;

    if (taskManagementEnabled) {
      // Get next task from TaskManager
      currentTask = getNextTaskFromManager();

      if (!currentTask) {
        // No more tasks in current phase - check if we should advance
        console.log(`\n[PHASE] No ready tasks for ${state.currentPhase} phase`);

        // Check if there are blocked tasks that might unblock later
        const blockedTasks = taskManager.getBlockedTasks().filter(t => t.phase === state.currentPhase);
        if (blockedTasks.length > 0) {
          console.log(`[BLOCKED] ${blockedTasks.length} task(s) blocked - waiting for dependencies`);
          // Could add logic to work on other phases or wait
        }

        // Advance to next phase
        await advancePhase();
        continue;
      }

      state.currentTask = currentTask;

      // Track iterations per task (not just per phase)
      const taskId = currentTask.id;
      state.taskIterations[taskId] = (state.taskIterations[taskId] || 0) + 1;

      if (state.taskIterations[taskId] > CONFIG.maxIterationsPerPhase) {
        console.log(`\n[LIMIT] Max iterations for task ${taskId} reached.`);
        console.log('[SKIPPING] Moving to next task...');
        // Mark as blocked or skip
        taskManager.updateStatus(taskId, 'blocked');
        state.currentTask = null;
        continue;
      }
    } else {
      // Legacy mode: check phase iteration limit
      if (state.phaseIteration > CONFIG.maxIterationsPerPhase) {
        console.log(`\n[LIMIT] Max iterations for ${state.currentPhase} phase reached.`);
        console.log('[ADVANCING] Moving to next phase despite score...');
        await advancePhase();
        continue;
      }
    }

    // ====================================================================
    // PROMPT GENERATION
    // ====================================================================

    // Get previous evaluation
    const prevEval = evaluatePhaseCompletion();
    let improvements = null;

    if (prevEval.score > 0 && !prevEval.complete) {
      improvements = generateImprovementGuidance(state.currentPhase, readQualityScores()?.scores || {});
    }

    // Generate prompt with task details
    const prompt = generatePhasePrompt(
      state.currentPhase,
      currentTask ? state.taskIterations[currentTask.id] : state.phaseIteration,
      prevEval.score > 0 ? prevEval.score : null,
      improvements,
      currentTask  // Pass task to prompt generator
    );

    // Reset session state
    thresholdReached = false;
    currentSessionData = {
      startTime: new Date(),
      peakContext: 0,
      exitReason: 'unknown',
      taskId: currentTask?.id || null,
    };

    // CRITICAL FIX: Reconnect to dashboard if connection was closed
    // (happens when context threshold was reached in previous session)
    if (!eventSource) {
      connectToDashboard();
    }

    // Run session
    await runSession(prompt);

    // Record session
    state.sessionHistory.push({
      session: state.totalSessions,
      phase: state.currentPhase,
      iteration: currentTask ? state.taskIterations[currentTask.id] : state.phaseIteration,
      taskId: currentTask?.id || null,
      exitReason: currentSessionData.exitReason,
      peakContext: currentSessionData.peakContext,
    });

    await postToDashboard('/api/series/session', {
      sessionNumber: state.totalSessions,
      phase: state.currentPhase,
      iteration: currentTask ? state.taskIterations[currentTask.id] : state.phaseIteration,
      taskId: currentTask?.id || null,
      exitReason: currentSessionData.exitReason,
      peakContext: currentSessionData.peakContext,
    });

    // ====================================================================
    // COMPLETION EVALUATION (enhanced for tasks)
    // ====================================================================

    if (currentSessionData.exitReason === 'complete') {
      const phaseEval = evaluatePhaseCompletion();
      console.log(`\n[EVALUATION] Phase: ${state.currentPhase}, Score: ${phaseEval.score}`);

      if (currentTask && taskManagementEnabled) {
        // Check task-specific completion
        const taskEval = evaluateTaskCompletion();

        if (taskEval.complete && phaseEval.complete) {
          // Task completed successfully
          handleTaskCompletion(taskEval, phaseEval.score);
          state.phaseScores[state.currentPhase] = phaseEval.score;
          state.currentTask = null;

          // Continue to next task (don't advance phase yet)
          console.log('[CONTINUE] Looking for next task...');
        } else if (taskEval.complete && !phaseEval.complete) {
          // Task done but quality not met - iterate
          console.log(`[ITERATE] Task done but quality ${phaseEval.score} below threshold.`);
          console.log(`[REASON] ${phaseEval.reason}`);
        } else {
          // Task not complete
          console.log(`[ITERATE] Task not complete: ${taskEval.reason}`);
        }
      } else {
        // Legacy phase-based evaluation
        if (phaseEval.complete) {
          console.log(`[SUCCESS] ${state.currentPhase} phase complete!`);
          state.phaseScores[state.currentPhase] = phaseEval.score;
          await advancePhase();
        } else {
          console.log(`[ITERATE] Score ${phaseEval.score} below threshold. Will iterate.`);
          console.log(`[REASON] ${phaseEval.reason}`);
        }
      }
    }

    // Delay before next session
    if (shouldContinue && state.currentPhase !== 'complete') {
      console.log(`\n[WAITING] ${CONFIG.sessionDelay / 1000}s before next session...`);
      await new Promise(r => setTimeout(r, CONFIG.sessionDelay));
    }
  }

  // Cleanup
  if (eventSource) eventSource.close();
  await postToDashboard('/api/series/end', {});

  printSummary();
}

async function advancePhase() {
  const completedPhase = state.currentPhase;
  const nextPhase = getNextPhase(state.currentPhase);
  const score = state.phaseScores[completedPhase] || 0;
  const iterations = state.phaseIteration;

  console.log(`\n[PHASE] Advancing: ${completedPhase} → ${nextPhase || 'COMPLETE'}`);

  // Send phase completion notification
  if (notificationService) {
    try {
      await notificationService.alertPhaseCompletion({
        phase: completedPhase,
        score,
        iterations,
        nextPhase: nextPhase || null
      });
      console.log(`[NOTIFICATION] Phase completion alert sent for: ${completedPhase}`);
    } catch (err) {
      console.error(`[NOTIFICATION] Failed to send phase completion alert:`, err.message);
    }
  }

  state.currentPhase = nextPhase || 'complete';
  state.phaseIteration = 0;
}

function printSummary() {
  console.log('\n' + '═'.repeat(70));
  console.log('EXECUTION SUMMARY');
  console.log('═'.repeat(70));
  console.log(`Total Sessions: ${state.totalSessions}`);
  console.log(`Total Runtime: ${formatDuration(Date.now() - state.startTime.getTime())}`);
  console.log(`Final Phase: ${state.currentPhase}`);

  // Task statistics (if using TaskManager)
  if (taskManager) {
    console.log(`\nTask Statistics:`);
    console.log(`  Tasks Completed: ${state.tasksCompleted}`);
    const stats = taskManager.getStats();
    console.log(`  Remaining: ${stats.byStatus.ready || 0} ready, ${stats.byStatus.blocked || 0} blocked`);
  }

  console.log('\nPhase Scores:');
  for (const [phase, score] of Object.entries(state.phaseScores)) {
    console.log(`  ${phase}: ${score}/100`);
  }

  console.log('\nSession History:');
  state.sessionHistory.forEach(s => {
    const taskInfo = s.taskId ? ` [${s.taskId}]` : '';
    console.log(`  ${s.session}. ${s.phase} (iter ${s.iteration})${taskInfo}: ${s.exitReason} @ ${s.peakContext.toFixed(1)}%`);
  });
  console.log('═'.repeat(70) + '\n');
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function printHelp() {
  console.log(`
Autonomous Multi-Agent Orchestrator

Runs Claude Code autonomously through development phases with quality gates.
Supports both task-driven (tasks.json) and phase-driven (--task) execution modes.

Usage:
  node autonomous-orchestrator.js [options]

Options:
  --phase <phase>          Starting phase (research, design, implement, test)
  --threshold <percent>    Context threshold for session cycling (default: 65)
  --max-sessions <n>       Maximum total sessions (default: unlimited)
  --max-iterations <n>     Max iterations per task/phase (default: 10)
  --task <description>     Task description (fallback if no tasks.json)
  --delay <ms>             Delay between sessions (default: 5000)
  --help, -h               Show this help

Execution Modes:

  1. Task-Driven (Recommended)
     - Create tasks.json with task definitions
     - Orchestrator uses TaskManager to select highest-priority ready tasks
     - Supports dependencies, auto-unblocking, and historical learning
     - Example: npm run autonomous --phase implement

  2. Phase-Driven (Legacy)
     - Use --task argument for simple task description
     - No dependency tracking or task management
     - Example: node autonomous-orchestrator.js --task "Build auth system"

Phases:
  research    Requirements, analysis, risk assessment (min: 80)
  design      Architecture, APIs, data models (min: 85)
  implement   Code implementation (min: 90)
  test        Testing and validation (min: 90)

Task Management:
  The orchestrator integrates with TaskManager when tasks.json exists:
  - Selects tasks by phase, priority, and dependency status
  - Tracks iterations per task (not just per phase)
  - Auto-unblocks dependent tasks when dependencies complete
  - Records completion data for historical learning

Examples:
  # Task-driven (with tasks.json)
  node autonomous-orchestrator.js --phase implement

  # Phase-driven (fallback)
  node autonomous-orchestrator.js --task "Build user auth system"

  # With custom settings
  node autonomous-orchestrator.js --phase design --max-iterations 5 --threshold 70
`);
}

// ============================================================================
// SIGNAL HANDLERS & GRACEFUL SHUTDOWN
// ============================================================================

/**
 * Graceful shutdown handler - cleans up ALL resources properly
 * CRITICAL FIX: Original handlers only killed claudeProcess but left
 * EventSource, database connections, and HTTP requests open.
 */
async function gracefulShutdown(signal) {
  console.log(`\n[SHUTDOWN] Graceful shutdown initiated (${signal})...`);
  shouldContinue = false;

  // 1. Kill child process with timeout
  if (claudeProcess) {
    console.log('[SHUTDOWN] Terminating Claude process...');
    claudeProcess.kill('SIGTERM');

    // Wait up to 5 seconds for graceful exit
    await new Promise(resolve => {
      const timeout = setTimeout(() => {
        if (claudeProcess && !claudeProcess.killed) {
          console.log('[SHUTDOWN] Force killing Claude process...');
          claudeProcess.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      if (claudeProcess) {
        claudeProcess.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      } else {
        clearTimeout(timeout);
        resolve();
      }
    });
    claudeProcess = null;
  }

  // 2. Close EventSource connection
  if (eventSource) {
    console.log('[SHUTDOWN] Closing EventSource connection...');
    eventSource.close();
    eventSource = null;
  }

  // 3. Close database connections
  if (memoryStore) {
    console.log('[SHUTDOWN] Closing MemoryStore...');
    try {
      if (typeof memoryStore.close === 'function') {
        memoryStore.close();
      }
    } catch (err) {
      console.error('[SHUTDOWN] Error closing MemoryStore:', err.message);
    }
    memoryStore = null;
  }

  // 4. Save TaskManager state
  if (taskManager) {
    console.log('[SHUTDOWN] Saving TaskManager state...');
    try {
      // TaskManager auto-saves on operations, but ensure final state is saved
      taskManager = null;
    } catch (err) {
      console.error('[SHUTDOWN] Error saving TaskManager:', err.message);
    }
  }

  // 5. Wait for pending HTTP requests
  console.log('[SHUTDOWN] Waiting for pending requests...');
  await new Promise(r => setTimeout(r, 1000));

  // 6. Print final summary
  printSummary();

  console.log('[SHUTDOWN] Cleanup complete.');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ============================================================================
// RUN
// ============================================================================

main().catch(err => {
  console.error('Orchestrator error:', err);
  process.exit(1);
});
