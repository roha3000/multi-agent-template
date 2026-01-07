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
const { getSessionRegistry } = require('./.claude/core/session-registry');
const { getUsageLimitTracker } = require('./.claude/core/usage-limit-tracker');
const SwarmController = require('./.claude/core/swarm-controller');

// ============================================================================
// ISSUE 1.3 FIX: Set ORCHESTRATOR_SESSION env var for self-identification
// This must happen BEFORE any registration so hooks can identify us correctly
// ============================================================================
process.env.ORCHESTRATOR_SESSION = 'true';

// Delegation system - lazy loaded for performance
let _delegationExecutor = null;
function getDelegationExecutor() {
  if (!_delegationExecutor) {
    try {
      _delegationExecutor = require('./.claude/core/delegation-executor');
    } catch (error) {
      console.log('[DELEGATION] Module not available:', error.message);
      return null;
    }
  }
  return _delegationExecutor;
}

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

// Reverse mapping: orchestrator phase -> tasks.json phase names
const TASK_PHASE_MAP = {
  'research': ['research', 'planning'],
  'design': ['design'],
  'implement': ['implementation', 'implement'],
  'test': ['testing', 'test', 'validation'],
};

function normalizePhase(phase) {
  return PHASE_MAP[phase] || phase;
}

// Get all task.json phase names that match an orchestrator phase
function getTaskPhases(orchestratorPhase) {
  return TASK_PHASE_MAP[orchestratorPhase] || [orchestratorPhase];
}

// Reverse map: get the preferred tasks.json phase name for an orchestrator phase
// Used when updating task phase during phase transitions
function reversePhaseMap(orchestratorPhase) {
  const REVERSE_PHASE_MAP = {
    'research': 'research',
    'design': 'design',
    'implement': 'implementation',
    'test': 'testing'
  };
  return REVERSE_PHASE_MAP[orchestratorPhase] || orchestratorPhase;
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
  model: process.env.CLAUDE_MODEL || 'claude-opus-4-5-20251101',
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
    case '--model':
      CONFIG.model = args[++i];
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
  // Phase progression tracking (for multi-phase task execution)
  taskPhaseHistory: {},     // Track which phases completed per task
  continueWithCurrentTask: false,  // Flag to continue with same task for next phase
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

// SwarmController (initialized in main)
let swarmController = null;

// Command Center Integration (Session Registry + Usage Tracking)
let sessionRegistry = null;
let usageLimitTracker = null;
let registeredSessionId = null;

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
    const criteriaEntries = Object.entries(phaseConfig.criteria);
    criteriaEntries.forEach(([criterionId, criterion], i) => {
      prompt += `    "${criterionId}": <score 0-100>${i < criteriaEntries.length - 1 ? ',' : ''}\n`;
    });
    prompt += `  },\n`;
    prompt += `  "recommendation": "proceed",\n`;
    prompt += `  "improvements": [],\n`;
    prompt += `  "evaluatedAt": "<current ISO timestamp>"\n`;
    prompt += `}\n`;
    prompt += `\`\`\`\n\n`;

    prompt += `**Scoring criteria for ${phaseConfig.name} phase**:\n`;
    criteriaEntries.forEach(([criterionId, criterion]) => {
      prompt += `- **${criterionId}** (weight: ${criterion.weight}): ${criterion.description}\n`;
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
    // CRITICAL: Default to false if no acceptance criteria provided
    // This prevents tasks from being marked complete without verification
    const acceptanceMet = completion.acceptanceMet;
    if (!acceptanceMet || !Array.isArray(acceptanceMet) || acceptanceMet.length === 0) {
      return {
        complete: false,
        reason: 'No acceptance criteria verification provided. Task must explicitly verify each acceptance criterion.'
      };
    }
    const allMet = acceptanceMet.every(m => m === true);

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
async function handleTaskCompletion(taskCompletion, qualityScore) {
  if (!taskManager || !state.currentTask) return;

  const task = state.currentTask;

  try {
    // Release claim before marking complete
    const releaseResult = taskManager.releaseTaskClaim(task.id, 'completed');
    if (releaseResult.success) {
      console.log(`[TASK] Claim released for: ${task.id}`);
    }

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

    // Log to dashboard
    logToDashboard(
      `Task completed: ${task.title} (${task.id}) - Quality: ${qualityScore}/100, Duration: ${durationHours.toFixed(1)}h`,
      'INFO',
      'task-complete'
    );

    // Record completion in Command Center
    await recordTaskCompletionToCommandCenter(task, qualityScore, 0);
    console.log(`[TASK] Duration: ${durationHours.toFixed(1)}h, Quality: ${qualityScore}/100`);

    // FIX: Update dashboard to show no current task
    await updateCommandCenter({
      currentTask: null,
      qualityScore: qualityScore,
      tasksCompleted: state.tasksCompleted
    });

    // Clear completion file for next task
    clearTaskCompletion();

  } catch (err) {
    console.error('[TASK] Error handling completion:', err.message);
    console.error('[TASK] Stack:', err.stack);
  }
}

/**
 * Get next task from TaskManager or fall back to --task argument
 * Uses claimNextTask() to properly claim the task in CoordinationDB
 * @returns {Object|null} Task object or null
 */
function getNextTaskFromManager() {
  if (!taskManager) return null;

  try {
    // Try all phase names that match the current orchestrator phase
    const taskPhases = getTaskPhases(state.currentPhase);
    let claimResult = null;

    // Try to claim a task for each matching phase
    for (const phase of taskPhases) {
      claimResult = taskManager.claimNextTask(phase, {
        agentType: 'autonomous',
        fallbackToNext: false  // Try exact phase first
      });
      if (claimResult.task) break;
    }

    // Also try without phase filter as fallback
    let usedFallback = false;
    if (!claimResult?.task) {
      claimResult = taskManager.claimNextTask(null, {
        agentType: 'autonomous',
        fallbackToNext: true
      });
      usedFallback = true;
    }

    if (claimResult?.task) {
      const task = claimResult.task;

      // FIX: If task was claimed via fallback, adjust orchestrator phase to match task
      if (usedFallback && task.phase) {
        const taskOrchestratorPhase = normalizePhase(task.phase);
        if (taskOrchestratorPhase !== state.currentPhase) {
          console.log(`[PHASE] Adjusting phase: ${state.currentPhase} → ${taskOrchestratorPhase} (to match claimed task)`);
          state.currentPhase = taskOrchestratorPhase;
          state.phaseIteration = 0; // Reset iteration count for new phase
        }
      }

      // Mark as in_progress (claim handles the coordination, this updates tasks.json status)
      taskManager.updateStatus(task.id, 'in_progress');
      console.log(`[TASK] Claimed: ${task.title} (${task.id})`);
      console.log(`[TASK] Priority: ${task.priority}, Estimate: ${task.estimate}`);
      if (claimResult.claim) {
        console.log(`[TASK] Claim expires: ${new Date(claimResult.claim.expiresAt).toISOString()}`);
      }

      // Log to dashboard
      logToDashboard(
        `Task claimed: ${task.title} (${task.id}) - Priority: ${task.priority}`,
        'INFO',
        'task-claim'
      );

      return task;
    }

    if (claimResult?.error) {
      console.log(`[TASK] No task claimed: ${claimResult.error}`);
    }

    return null;
  } catch (err) {
    console.error('[TASK] Error claiming next task:', err.message);
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

    // Log session start to dashboard
    logToDashboard(
      `Session ${state.totalSessions + 1} started: ${state.currentPhase} phase, iteration ${state.phaseIteration}`,
      'INFO',
      'session-start'
    );

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

    // Use spawn with shell for proper stdout capture on all platforms
    const args = ['-p', '--dangerously-skip-permissions', '--model', CONFIG.model];
    console.log(`[CMD] claude ${args.join(' ')} < ${promptFile}`);

    // Read prompt content and pipe via stdin
    const promptContent = fs.readFileSync(promptFile, 'utf8');

    claudeProcess = spawn('claude', args, {
      cwd: CONFIG.projectPath,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Pass parent session ID for hierarchy tracking
        PARENT_SESSION_ID: registeredSessionId ? String(registeredSessionId) : '',
        ORCHESTRATOR_SESSION: 'true'
      }
    });

    // Write prompt to stdin
    claudeProcess.stdin.write(promptContent);
    claudeProcess.stdin.end();

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

      // Log error to dashboard
      logToDashboard(
        `Session error: ${err.message}`,
        'ERROR',
        'session-error'
      );

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
// DELEGATION INTEGRATION
// ============================================================================

/**
 * Analyze task for delegation potential
 * @param {Object} task - Task to analyze
 * @returns {Object|null} Delegation plan or null if not recommended
 */
function analyzeDelegation(task) {
  const executor = getDelegationExecutor();
  if (!executor) return null;

  try {
    const result = executor.executeDelegation(task.id);

    if (!result.success) {
      console.log(`[DELEGATION] Not recommended: ${result.warning || result.error}`);
      return null;
    }

    console.log(`[DELEGATION] Recommended: ${result.decision.pattern} pattern, ${result.execution.subtaskCount} subtasks`);
    console.log(`[DELEGATION] Confidence: ${result.decision.confidence}%`);

    return result;
  } catch (error) {
    console.error('[DELEGATION] Analysis failed:', error.message);
    return null;
  }
}

/**
 * Run a single delegated subtask as a subprocess
 * @param {Object} subtask - Subtask from delegation plan
 * @param {Object} parentTask - Parent task for context
 * @param {number} index - Subtask index
 * @param {number} total - Total number of subtasks
 * @returns {Promise<Object>} Subtask result
 */
function runDelegatedSubtask(subtask, parentTask, index, total) {
  return new Promise(async (resolve) => {
    const label = `[SUBTASK ${index + 1}/${total}]`;
    console.log(`\n${label} Starting: ${subtask.parameters.description}`);

    // Generate prompt for subtask
    const prompt = subtask.parameters.prompt;

    const logPath = path.join(CONFIG.projectPath, '.claude', 'logs', `subtask-${parentTask.id}-${index + 1}.log`);
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    // Register child session with dashboard (since -p mode skips hooks)
    let childSessionId = null;
    try {
      const registerPayload = JSON.stringify({
        project: CONFIG.project,
        path: CONFIG.projectPath,
        status: 'active',
        sessionType: 'autonomous',
        autonomous: true,
        currentTask: subtask.parameters.description,
        parentSessionId: registeredSessionId
      });

      const registerRes = await fetch(`http://localhost:3033/api/sessions/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: registerPayload
      });

      if (registerRes.ok) {
        const data = await registerRes.json();
        childSessionId = data.id;
        console.log(`${label} Registered child session: ${childSessionId}`);
      }
    } catch (err) {
      console.warn(`${label} Failed to register child session:`, err.message);
    }

    const args = ['-p', '--dangerously-skip-permissions', '--model', CONFIG.model];

    const childProcess = spawn('claude', args, {
      cwd: CONFIG.projectPath,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PARENT_SESSION_ID: registeredSessionId ? String(registeredSessionId) : '',
        ORCHESTRATOR_SESSION: 'true',
        SUBTASK_INDEX: String(index + 1),
        SUBTASK_TOTAL: String(total),
        PARENT_TASK_ID: parentTask.id
      }
    });

    childProcess.stdin.write(prompt);
    childProcess.stdin.end();

    let output = '';
    childProcess.stdout.on('data', (data) => {
      output += data.toString();
      logStream.write(data);
    });

    childProcess.stderr.on('data', (data) => {
      logStream.write(data);
    });

    childProcess.on('error', async (err) => {
      console.error(`${label} Error:`, err.message);
      logStream.end();
      // Deregister child session on error
      if (childSessionId) {
        try {
          await fetch(`http://localhost:3033/api/sessions/${childSessionId}/deregister`, { method: 'POST' });
        } catch (e) { /* ignore */ }
      }
      resolve({ success: false, error: err.message, index, childSessionId });
    });

    childProcess.on('close', async (code) => {
      logStream.end();
      console.log(`${label} Completed with code ${code}`);
      // Deregister child session on completion
      if (childSessionId) {
        try {
          await fetch(`http://localhost:3033/api/sessions/${childSessionId}/deregister`, { method: 'POST' });
          console.log(`${label} Deregistered child session: ${childSessionId}`);
        } catch (e) { /* ignore */ }
      }
      resolve({
        success: code === 0,
        index,
        output: output.substring(0, 1000), // Truncate for logging
        exitCode: code,
        childSessionId
      });
    });
  });
}

/**
 * Run delegated task with multiple parallel subtasks
 * @param {Object} delegationPlan - Plan from analyzeDelegation
 * @param {Object} task - Parent task
 * @returns {Promise<Object>} Aggregated result
 */
async function runDelegatedTask(delegationPlan, task) {
  const { execution, hierarchy } = delegationPlan;
  const { pattern, subtaskCount, taskInvocations } = execution;

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`DELEGATED EXECUTION: ${task.title}`);
  console.log(`Pattern: ${pattern} | Subtasks: ${subtaskCount}`);
  console.log(`${'═'.repeat(70)}\n`);

  // Log delegation start to dashboard
  logToDashboard(
    `Delegation started: ${task.title} (${pattern} pattern, ${subtaskCount} subtasks)`,
    'INFO',
    'delegation-start'
  );

  let results = [];

  if (pattern === 'parallel') {
    // Run all subtasks in parallel
    console.log('[DELEGATION] Running subtasks in parallel...');
    const promises = taskInvocations.map((subtask, index) =>
      runDelegatedSubtask(subtask, task, index, subtaskCount)
    );
    results = await Promise.all(promises);
  } else {
    // Run subtasks sequentially
    console.log('[DELEGATION] Running subtasks sequentially...');
    for (let i = 0; i < taskInvocations.length; i++) {
      const result = await runDelegatedSubtask(taskInvocations[i], task, i, subtaskCount);
      results.push(result);

      // Stop on failure for sequential pattern
      if (!result.success && pattern === 'sequential') {
        console.log(`[DELEGATION] Sequential chain stopped at subtask ${i + 1} due to failure`);
        break;
      }
    }
  }

  // Aggregate results
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`DELEGATION COMPLETE: ${successCount}/${subtaskCount} succeeded, ${failCount} failed`);
  console.log(`${'─'.repeat(70)}\n`);

  // Log delegation completion to dashboard
  logToDashboard(
    `Delegation complete: ${task.title} - ${successCount}/${subtaskCount} succeeded`,
    successCount === subtaskCount ? 'INFO' : 'WARN',
    'delegation-complete'
  );

  return {
    delegated: true,
    pattern,
    subtaskCount,
    successCount,
    failCount,
    allSucceeded: successCount === subtaskCount,
    results
  };
}

// ============================================================================
// DASHBOARD INTEGRATION
// ============================================================================

let dashboardConnectionLost = false;

function connectToDashboard() {
  console.log('[DASHBOARD] Connecting to SSE...');

  eventSource = new EventSource(CONFIG.dashboardUrl);

  eventSource.onopen = async () => {
    console.log('[DASHBOARD] Connected.\n');

    // Re-register if connection was previously lost (dashboard restarted)
    if (dashboardConnectionLost) {
      console.log('[DASHBOARD] Reconnected after disconnect - re-registering session...');
      dashboardConnectionLost = false;
      try {
        await initializeCommandCenter();
        console.log('[DASHBOARD] Session re-registered successfully.');
      } catch (err) {
        console.error('[DASHBOARD] Failed to re-register session:', err.message);
      }
    }
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
    if (!dashboardConnectionLost) {
      console.error('[DASHBOARD] Connection error. Will re-register when dashboard reconnects.');
      dashboardConnectionLost = true;
    }
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

  // Update Command Center with context percent
  updateCommandCenter({ contextPercent: contextUsed });

  if (contextUsed >= CONFIG.contextThreshold && !thresholdReached && claudeProcess) {
    thresholdReached = true;
    console.log(`\n[ORCHESTRATOR] Context threshold reached: ${contextUsed.toFixed(1)}%`);

    // CRITICAL FIX: Close EventSource before killing process to prevent
    // it from continuing to accumulate events during session transition
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    // Use SIGINT instead of SIGTERM - CLI handles Ctrl+C more gracefully
    // and avoids stack overflow in exit handler during file writes
    console.log('[ORCHESTRATOR] Sending SIGINT to gracefully end session...');
    claudeProcess.kill('SIGINT');

    // Give it time to clean up, then force kill if still running
    setTimeout(() => {
      if (claudeProcess && !claudeProcess.killed) {
        console.log('[ORCHESTRATOR] Force killing after timeout...');
        claudeProcess.kill('SIGKILL');
      }
    }, 5000);
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
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve({ success: true, ...parsed });
          } catch {
            resolve({ success: res.statusCode === 200 });
          }
        });
      });

      req.on('error', (err) => {
        // Log connection errors (dashboard may not be running)
        if (process.env.DEBUG_LOGS === 'true') {
          console.error(`[DASHBOARD] POST ${endpoint} failed: ${err.message}`);
        }
        resolve({ success: false, error: err.message });
      });
      req.write(postData);
      req.end();
    } catch (err) {
      if (process.env.DEBUG_LOGS === 'true') {
        console.error(`[DASHBOARD] POST ${endpoint} error: ${err.message}`);
      }
      resolve({ success: false, error: err.message });
    }
  });
}

/**
 * Log a message to the dashboard Logs tab
 * @param {string} message - Log message
 * @param {string} level - Log level (INFO, WARN, ERROR)
 * @param {string} source - Source identifier (phase, task, session)
 * @returns {Promise<boolean>} Success status
 */
async function logToDashboard(message, level = 'INFO', source = 'orchestrator') {
  if (!registeredSessionId) {
    // Debug: Log forwarding skipped - no session registered
    if (process.env.DEBUG_LOGS === 'true') {
      console.log('[LOG] Skipped - no registeredSessionId');
    }
    return false;
  }

  try {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
      sessionNumber: state.totalSessions,
      phase: state.currentPhase,
      taskId: state.currentTask?.id || null
    };

    const result = await postToDashboard(
      `/api/logs/${registeredSessionId}/write`,
      logEntry
    );

    if (!result.success && process.env.DEBUG_LOGS === 'true') {
      console.log(`[LOG] Failed to forward: ${JSON.stringify(result)}`);
    }

    return result.success;
  } catch (err) {
    // Debug: Log error details
    if (process.env.DEBUG_LOGS === 'true') {
      console.log(`[LOG] Error forwarding: ${err.message}`);
    }
    return false;
  }
}

// ============================================================================
// COMMAND CENTER INTEGRATION (Session Registry + Usage Tracking)
// ============================================================================

/**
 * Initialize Command Center integration
 * Registers session via HTTP API to dashboard
 */
async function initializeCommandCenter() {
  try {
    // Build registration payload
    const registrationPayload = {
      project: path.basename(CONFIG.projectPath),
      path: CONFIG.projectPath,
      status: 'active',
      sessionType: 'autonomous',
      autonomous: true,
      orchestratorInfo: {
        version: '1.0.0',
        startTime: new Date().toISOString(),
        mode: 'autonomous'
      },
      logSessionId: state.totalSessions,
      currentTask: state.currentTask ? {
        id: state.currentTask.id,
        title: state.currentTask.title,
        phase: state.currentPhase,
      } : null,
      nextTask: null,
      contextPercent: 0,
      qualityScore: 0,
      confidenceScore: 100,
      tokens: 0,
      cost: 0,
      iteration: state.phaseIteration,
    };

    // If we already have a registered session ID (reconnecting after disconnect),
    // pass it to preserve the ID and maintain claim ownership
    if (registeredSessionId) {
      registrationPayload.existingSessionId = registeredSessionId;
    }

    // Register this orchestrator session via HTTP API
    const response = await postToDashboard('/api/sessions/register', registrationPayload);

    if (response.success && response.id) {
      registeredSessionId = response.id;
      console.log(`[COMMAND CENTER] Session registered: ${registeredSessionId} 🤖`);

      // Sync session ID to TaskManager for task claiming
      if (taskManager) {
        taskManager.sessionId = registeredSessionId;
        console.log(`[COMMAND CENTER] TaskManager sessionId synced for task claiming`);
      }

      return true;
    } else {
      console.log('[COMMAND CENTER] Registration failed - dashboard may not be running');
      return false;
    }
  } catch (err) {
    console.error('[COMMAND CENTER] Failed to initialize:', err.message);
    return false;
  }
}

/**
 * Update Command Center with current session state
 */
async function updateCommandCenter(updates = {}) {
  if (!registeredSessionId) return;

  try {
    const sessionUpdates = {
      status: 'active',
      logSessionId: state.totalSessions,
      currentTask: state.currentTask ? {
        id: state.currentTask.id,
        title: state.currentTask.title,
        phase: state.currentPhase,
      } : null,
      iteration: state.phaseIteration,
      phase: state.currentPhase,
      ...updates,
    };

    await postToDashboard(`/api/sessions/${registeredSessionId}/update`, sessionUpdates);
  } catch (err) {
    // Log errors but don't fail - dashboard integration is non-critical
    console.error('[COMMAND CENTER] Update failed:', err.message);
  }
}

/**
 * Record message usage for limit tracking
 */
function recordMessageUsage() {
  if (!usageLimitTracker) return null;

  try {
    const status = usageLimitTracker.recordMessage();

    // Check for usage alerts
    const alerts = usageLimitTracker.getAlerts();
    if (alerts.length > 0) {
      console.log('[USAGE] Limit alerts:', alerts.map(a => a.message).join(', '));
    }

    return status;
  } catch (err) {
    return null;
  }
}

/**
 * Record task completion in Command Center
 */
async function recordTaskCompletionToCommandCenter(task, score, cost = 0) {
  try {
    const result = await postToDashboard('/api/sessions/completion', {
      project: path.basename(CONFIG.projectPath),
      task: { id: task.id, title: task.title },
      score,
      cost
    });
    if (!result.success) {
      console.error('[COMMAND CENTER] Task completion record failed');
    }
  } catch (err) {
    console.error('[COMMAND CENTER] Task completion error:', err.message);
  }
}

/**
 * Deregister session from Command Center
 */
async function deregisterFromCommandCenter() {
  if (!registeredSessionId) {
    console.log('[COMMAND CENTER] No session to deregister');
    return;
  }

  try {
    const result = await postToDashboard(`/api/sessions/${registeredSessionId}/end`, {});
    if (result.success) {
      console.log(`[COMMAND CENTER] Session deregistered: ${registeredSessionId}`);
    } else {
      console.error(`[COMMAND CENTER] Deregistration failed for: ${registeredSessionId}`);
    }
    registeredSessionId = null;
  } catch (err) {
    console.error('[COMMAND CENTER] Deregistration error:', err.message);
    registeredSessionId = null; // Clear anyway to prevent retries
  }
}

// ============================================================================
// MAIN LOOP
// ============================================================================

/**
 * Initialize TaskManager and MemoryStore
 */
function initializeTaskManagement() {
  const tasksPath = path.join(CONFIG.projectPath, '.claude', 'dev-docs', 'tasks.json');

  // Check if tasks.json exists
  if (!fs.existsSync(tasksPath)) {
    console.log('[TASK] No .claude/dev-docs/tasks.json found - using --task argument mode');
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

    // Initialize SwarmController for safety checks and complexity analysis
    try {
      swarmController = new SwarmController({
        verbose: false,
        memoryStore: memoryStore
      });
      const swarmStatus = swarmController.getStatus();
      console.log(`[SWARM] SwarmController initialized: ${swarmStatus.enabledCount} components enabled`);
    } catch (swarmErr) {
      console.warn(`[SWARM] SwarmController initialization warning: ${swarmErr.message}`);
      // Continue without swarm - non-critical
    }

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

  // Initialize Command Center (Session Registry + Usage Tracking)
  const commandCenterEnabled = initializeCommandCenter();
  if (commandCenterEnabled) {
    console.log('[COMMAND CENTER] Enabled - session tracking active\n');
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
      // Check if we should continue with current task for next phase
      if (state.continueWithCurrentTask && state.currentTask) {
        const taskToContinue = state.currentTask;
        state.continueWithCurrentTask = false;

        // FIX: Verify and extend claim before continuing with same task
        // This prevents claim expiration during phase transitions
        let claimValid = false;

        if (taskManager) {
          // First, try to extend the existing claim
          const extendResult = taskManager.extendClaim(taskToContinue.id);

          if (extendResult.success) {
            claimValid = true;
            console.log(`[PHASE] Claim extended for task "${taskToContinue.title}" - continuing in ${state.currentPhase} phase`);

            // Update task's phase in tasks.json to match current orchestrator phase
            const taskPhase = reversePhaseMap(state.currentPhase);
            if (taskPhase && taskToContinue.phase !== taskPhase) {
              taskManager.updateTask(taskToContinue.id, { phase: taskPhase });
              console.log(`[PHASE] Updated task phase: ${taskToContinue.phase} → ${taskPhase}`);
            }

            // Log claim extension to dashboard
            logToDashboard(
              `Task claim extended for phase transition: ${taskToContinue.title} → ${state.currentPhase}`,
              'INFO',
              'task-claim'
            );
          } else {
            // Claim expired or lost - try to re-claim the same task
            console.log(`[PHASE] Claim lost for "${taskToContinue.title}": ${extendResult.error}`);
            console.log(`[PHASE] Attempting to re-claim same task...`);

            const reclaimResult = taskManager.claimSpecificTask(taskToContinue.id, {
              agentType: 'autonomous',
              ttlMs: TaskManager.CLAIM_CONFIG?.defaultTTL || 1800000
            });

            if (reclaimResult.success) {
              claimValid = true;
              console.log(`[PHASE] Successfully re-claimed task "${taskToContinue.title}"`);

              // Update task's phase after re-claim
              const taskPhase = reversePhaseMap(state.currentPhase);
              if (taskPhase && taskToContinue.phase !== taskPhase) {
                taskManager.updateTask(taskToContinue.id, { phase: taskPhase });
                console.log(`[PHASE] Updated task phase: ${taskToContinue.phase} → ${taskPhase}`);
              }

              logToDashboard(
                `Task re-claimed after phase transition: ${taskToContinue.title}`,
                'INFO',
                'task-claim'
              );
            } else {
              console.log(`[PHASE] Failed to re-claim task: ${reclaimResult.error}`);
              console.log(`[PHASE] Task may have been claimed by another session`);
              logToDashboard(
                `Failed to re-claim task after phase transition: ${taskToContinue.title} - ${reclaimResult.error}`,
                'WARN',
                'task-claim'
              );
            }
          }
        } else {
          // No taskManager - just continue (legacy mode)
          claimValid = true;
        }

        if (claimValid) {
          currentTask = taskToContinue;
          console.log(`[PHASE] Continuing task "${currentTask.title}" in ${state.currentPhase} phase`);
        } else {
          // Claim lost and couldn't re-claim - fall through to get next task
          console.log(`[PHASE] Will attempt to claim a different task...`);
          state.currentTask = null;
          currentTask = getNextTaskFromManager();
        }
      } else {
        // Get next task from TaskManager
        currentTask = getNextTaskFromManager();
      }

      if (!currentTask) {
        // No more tasks in current phase - check if we should advance
        console.log(`\n[PHASE] No ready tasks for ${state.currentPhase} phase`);

        // Check if there are blocked tasks that might unblock later
        // Use getTaskPhases to match both short and full phase names
        const taskPhases = getTaskPhases(state.currentPhase);
        const blockedTasks = taskManager.getBlockedTasks().filter(t => taskPhases.includes(t.phase));
        const readyTasks = taskManager.getReadyTasks().filter(t => taskPhases.includes(t.phase));
        const inProgressTasks = taskManager.getInProgressTasks ?
          taskManager.getInProgressTasks().filter(t => taskPhases.includes(t.phase)) : [];

        if (blockedTasks.length > 0 || inProgressTasks.length > 0) {
          // Tasks exist but are blocked or in-progress by other sessions
          console.log(`[WAITING] ${blockedTasks.length} blocked, ${inProgressTasks.length} in-progress by other sessions`);
          console.log(`[WAITING] Waiting ${CONFIG.sessionDelay / 1000}s before retry...`);
          await new Promise(r => setTimeout(r, CONFIG.sessionDelay));
          continue; // Retry claiming in same phase
        }

        if (readyTasks.length > 0) {
          // Ready tasks exist but couldn't be claimed (race condition or claim failure)
          console.log(`[RETRY] ${readyTasks.length} ready tasks exist but couldn't claim - retrying...`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        // No tasks at all in this phase - check if we completed work before advancing
        if (state.tasksCompleted === 0 && state.totalSessions === 0) {
          console.log(`[EXIT] No tasks available and no work completed - exiting`);
          shouldContinue = false;
          break;
        }

        // Advance to next phase only if we actually completed work
        await advancePhase();
        continue;
      }

      state.currentTask = currentTask;

      // Update Command Center with current task
      updateCommandCenter({
        currentTask: {
          id: currentTask.id,
          title: currentTask.title,
          phase: state.currentPhase,
        },
      });

      // Post task phase start to dashboard
      await postToDashboard('/api/execution/taskPhases', {
        taskId: currentTask.id,
        taskTitle: currentTask.title,
        phase: state.currentPhase,
        action: 'start'
      });

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
    // SWARM SAFETY CHECK
    // ====================================================================

    if (swarmController && currentTask) {
      const safetyResult = swarmController.checkSafety({
        taskId: currentTask.id,
        description: currentTask.description || '',
        phase: state.currentPhase
      });

      if (!safetyResult.safe) {
        console.log(`[SWARM] Safety check failed: ${safetyResult.errors.join(', ')}`);

        // Log safety failure to dashboard
        logToDashboard(
          `Safety check failed: ${safetyResult.errors.join(', ')}`,
          'WARN',
          'swarm-safety'
        );

        if (safetyResult.action === 'HALT_IMMEDIATELY') {
          console.log('[SWARM] HALTING due to critical safety concern');

          // Log critical halt to dashboard
          logToDashboard(
            `CRITICAL: Halting due to safety concern - ${safetyResult.errors[0]}`,
            'ERROR',
            'swarm-halt'
          );

          shouldContinue = false;
          break;
        }
        // Block task and continue to next
        if (taskManagementEnabled && currentTask) {
          taskManager.updateStatus(currentTask.id, 'blocked');
        }
        continue;
      }

      if (safetyResult.warnings && safetyResult.warnings.length > 0) {
        console.log(`[SWARM] Warnings: ${safetyResult.warnings.join(', ')}`);
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

    // Record message usage for limit tracking
    const usageStatus = recordMessageUsage();
    if (usageStatus) {
      updateCommandCenter({
        fiveHourUsage: usageStatus.fiveHour.percent,
        dailyUsage: usageStatus.daily.percent,
      });
    }

    // CRITICAL FIX: Reconnect to dashboard if connection was closed
    // (happens when context threshold was reached in previous session)
    if (!eventSource) {
      connectToDashboard();
    }

    // ====================================================================
    // DELEGATION CHECK - analyze task before execution
    // ====================================================================

    let delegationResult = null;

    if (currentTask && taskManagementEnabled) {
      // Check if task should be delegated
      const delegationPlan = analyzeDelegation(currentTask);

      if (delegationPlan) {
        // Run delegated execution instead of single session
        delegationResult = await runDelegatedTask(delegationPlan, currentTask);

        // Set session data based on delegation result
        currentSessionData.exitReason = delegationResult.allSucceeded ? 'complete' : 'partial';
        currentSessionData.delegated = true;
        currentSessionData.delegationPattern = delegationResult.pattern;
        currentSessionData.delegationSubtasks = delegationResult.subtaskCount;
      }
    }

    // Only run single session if delegation was not used
    if (!delegationResult) {
      await runSession(prompt);
    }

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

    // Track progress with SwarmController for confidence monitoring
    if (swarmController) {
      swarmController.trackProgress({
        iteration: currentTask ? state.taskIterations[currentTask.id] : state.phaseIteration,
        phase: state.currentPhase,
        taskId: currentTask?.id || null,
        exitReason: currentSessionData.exitReason
      });
    }

    // ====================================================================
    // COMPLETION EVALUATION (enhanced for tasks)
    // ====================================================================

    if (currentSessionData.exitReason === 'complete') {
      const phaseEval = evaluatePhaseCompletion();
      console.log(`\n[EVALUATION] Phase: ${state.currentPhase}, Score: ${phaseEval.score}`);

      // Update dashboard with quality score
      updateCommandCenter({ qualityScore: phaseEval.score });

      if (currentTask && taskManagementEnabled) {
        // Check task-specific completion
        const taskEval = evaluateTaskCompletion();

        if (taskEval.complete && phaseEval.complete) {
          // Phase passed quality gate - check if there's a next phase
          state.phaseScores[state.currentPhase] = phaseEval.score;

          const nextPhase = getNextPhase(state.currentPhase);
          if (nextPhase) {
            // Task needs to progress to next phase
            console.log(`[PHASE] Task "${currentTask.title}" advancing: ${state.currentPhase} → ${nextPhase}`);

            // Track phase completion for this task
            if (!state.taskPhaseHistory) state.taskPhaseHistory = {};
            if (!state.taskPhaseHistory[currentTask.id]) state.taskPhaseHistory[currentTask.id] = [];
            state.taskPhaseHistory[currentTask.id].push(state.currentPhase);

            // Post phase completion to dashboard
            await postToDashboard('/api/execution/taskPhases', {
              taskId: currentTask.id,
              taskTitle: currentTask.title,
              phase: state.currentPhase,
              score: phaseEval.score,
              action: 'complete'
            });

            // Advance to next phase (keep same task)
            state.currentPhase = nextPhase;
            state.phaseIteration = 0;
            state.continueWithCurrentTask = true;

            console.log(`[CONTINUE] Continuing with same task in ${nextPhase} phase...`);
          } else {
            // Final phase complete - task is done
            console.log(`[COMPLETE] Task "${currentTask.title}" finished all phases!`);

            // Post final phase completion to dashboard
            await postToDashboard('/api/execution/taskPhases', {
              taskId: currentTask.id,
              taskTitle: currentTask.title,
              phase: state.currentPhase,
              score: phaseEval.score,
              action: 'complete'
            });

            // Post task finished to dashboard
            await postToDashboard('/api/execution/taskPhases', {
              taskId: currentTask.id,
              taskTitle: currentTask.title,
              action: 'finish'
            });

            await handleTaskCompletion(taskEval, phaseEval.score);
            state.currentTask = null;
            state.continueWithCurrentTask = false;

            console.log('[CONTINUE] Looking for next task...');
          }
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

  // Log phase transition to dashboard
  logToDashboard(
    `Phase transition: ${completedPhase} → ${nextPhase || 'COMPLETE'} (Score: ${score}/100, Iterations: ${iterations})`,
    'INFO',
    'phase-transition'
  );

  // FIX: Update Command Center with new phase immediately
  await updateCommandCenter({
    phase: nextPhase || 'complete',
    qualityScore: score,
    phaseHistory: state.sessionHistory.filter(s => s.phase === completedPhase).map(s => ({
      session: s.session,
      iteration: s.iteration,
      exitReason: s.exitReason,
      peakContext: s.peakContext
    }))
  });

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
  --model <model>          Claude model to use (default: claude-opus-4-5-20251101)
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

  // 5. Deregister from Command Center (await to ensure it completes)
  console.log('[SHUTDOWN] Deregistering from Command Center...');
  await deregisterFromCommandCenter();

  // 6. Wait for pending HTTP requests
  console.log('[SHUTDOWN] Waiting for pending requests...');
  await new Promise(r => setTimeout(r, 1000));

  // 7. Print final summary
  printSummary();

  console.log('[SHUTDOWN] Cleanup complete.');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ============================================================================
// RUN
// ============================================================================

main().catch(async err => {
  console.error('Orchestrator error:', err.message);
  console.error('Stack:', err.stack);

  // Log error to dashboard before exiting
  await logToDashboard(
    `Orchestrator fatal error: ${err.message}`,
    'ERROR',
    'orchestrator-crash'
  );

  // Deregister session on error exit
  await deregisterFromCommandCenter();

  process.exit(1);
});
