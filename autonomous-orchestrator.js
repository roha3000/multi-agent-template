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

const { spawn } = require('child_process');
const EventSource = require('eventsource');
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
  currentTaskId: null, // Track current task being worked on
};

let claudeProcess = null;
let eventSource = null;
let shouldContinue = true;
let thresholdReached = false;
let currentSessionData = null;

// Initialize TaskManager and MemoryStore
const memoryStore = new MemoryStore({
  dbPath: path.join(CONFIG.projectPath, '.claude', 'memory', 'orchestrations.db')
});
const taskManager = new TaskManager({
  tasksPath: path.join(CONFIG.projectPath, 'tasks.json'),
  memoryStore
});

// ============================================================================
// PROMPT GENERATION
// ============================================================================

function generatePhasePrompt(phase, iteration, previousScore = null, improvements = null) {
  const phaseConfig = PHASES[phase];
  if (!phaseConfig) throw new Error(`Unknown phase: ${phase}`);

  const agentRole = Object.values(AGENT_ROLES).find(a => a.phases.includes(phase) && a.name !== 'Quality Reviewer' && a.name !== 'Technical Critic');

  let prompt = `# AUTONOMOUS EXECUTION: ${phaseConfig.name} Phase\n\n`;

  // Get next task from TaskManager
  const nextTask = taskManager.getNextTask(phase);

  if (nextTask) {
    state.currentTaskId = nextTask.id;

    prompt += `## 🎯 Current Task\n\n`;
    prompt += `**${nextTask.title}**\n\n`;
    prompt += `- **ID**: ${nextTask.id}\n`;
    prompt += `- **Phase**: ${nextTask.phase}\n`;
    prompt += `- **Priority**: ${nextTask.priority}\n`;
    if (nextTask.estimate) {
      prompt += `- **Estimate**: ${nextTask.estimate}\n`;
    }
    if (nextTask.tags && nextTask.tags.length > 0) {
      prompt += `- **Tags**: ${nextTask.tags.join(', ')}\n`;
    }

    if (nextTask.description) {
      prompt += `\n**Description**:\n${nextTask.description}\n`;
    }

    if (nextTask.acceptance && nextTask.acceptance.length > 0) {
      prompt += `\n**Acceptance Criteria**:\n`;
      nextTask.acceptance.forEach(criterion => {
        prompt += `- ${criterion}\n`;
      });
    }

    if (nextTask.context) {
      prompt += `\n**Context**: ${nextTask.context}\n`;
    }

    prompt += `\n`;
  } else {
    state.currentTaskId = null;
    prompt += `## 📝 Note\n\nNo specific task assigned for this phase. Proceed with general ${phase} phase objectives.\n\n`;
  }

  // Legacy task context (for backwards compatibility)
  if (state.task) {
    prompt += `## Additional Context\n${state.task}\n\n`;
  }

  prompt += `## Session Context\n`;
  prompt += `- Phase: ${phase} (iteration ${iteration}/${CONFIG.maxIterationsPerPhase})\n`;
  prompt += `- Minimum Score to Proceed: ${phaseConfig.minScore}/100\n`;
  if (previousScore !== null) {
    prompt += `- Previous Score: ${previousScore}/100\n`;
  }
  prompt += `\n`;

  // Role assignment
  prompt += `## Your Role: ${agentRole?.name || 'Developer'}\n`;
  prompt += `Responsibilities:\n`;
  (agentRole?.responsibilities || ['Complete the assigned work']).forEach(r => {
    prompt += `- ${r}\n`;
  });
  prompt += `\n`;

  // Phase-specific instructions
  prompt += `## Phase Objectives\n`;
  prompt += `${phaseConfig.description}\n\n`;

  prompt += `## Quality Criteria\n`;
  for (const [criterion, config] of Object.entries(phaseConfig.criteria)) {
    prompt += `- **${criterion}** (${config.weight}%): ${config.description}\n`;
  }
  prompt += `\n`;

  // Improvement guidance if needed
  if (improvements) {
    prompt += `## Required Improvements\n`;
    prompt += `The previous iteration did not meet quality standards. Focus on:\n\n`;
    prompt += improvements;
    prompt += `\n`;
  }

  // Execution instructions
  prompt += `## Execution Instructions\n\n`;
  prompt += `1. **First**: Run \`/session-init\` to load project context\n`;
  prompt += `2. **Then**: Work on the ${phase} phase objectives\n`;
  prompt += `3. **Use TodoWrite**: Track your progress with todo items\n`;
  prompt += `4. **Save Progress**: Update dev-docs files regularly\n`;
  prompt += `5. **Quality Focus**: Ensure all criteria are addressed\n\n`;

  // Multi-agent validation
  prompt += `## Multi-Agent Validation\n\n`;
  prompt += `Before considering your work complete, mentally assume these roles:\n\n`;
  prompt += `### As Quality Reviewer:\n`;
  prompt += `- Does the work meet all quality criteria?\n`;
  prompt += `- Are there any gaps in the deliverables?\n`;
  prompt += `- Score each criterion honestly\n\n`;

  prompt += `### As Technical Critic:\n`;
  prompt += `- Challenge your own assumptions\n`;
  prompt += `- Identify weaknesses or oversights\n`;
  prompt += `- Consider edge cases and risks\n\n`;

  // Exit criteria
  prompt += `## Exit Criteria\n\n`;
  prompt += `When you believe the phase is complete:\n\n`;
  prompt += `1. Create/update \`.claude/dev-docs/quality-scores.json\` with:\n`;
  prompt += `\`\`\`json\n{\n`;
  prompt += `  "phase": "${phase}",\n`;
  prompt += `  "iteration": ${iteration},\n`;
  prompt += `  "scores": {\n`;

  const criteria = Object.keys(phaseConfig.criteria);
  criteria.forEach((c, i) => {
    prompt += `    "${c}": <your honest score 0-100>${i < criteria.length - 1 ? ',' : ''}\n`;
  });

  prompt += `  },\n`;
  prompt += `  "totalScore": <calculated weighted score>,\n`;
  prompt += `  "improvements": ["list of any remaining gaps"],\n`;
  prompt += `  "recommendation": "proceed" | "iterate"\n`;
  prompt += `}\n\`\`\`\n\n`;

  prompt += `2. If totalScore >= ${phaseConfig.minScore} and recommendation is "proceed":\n`;
  prompt += `   - Update tasks.md with completion status\n`;
  prompt += `   - The orchestrator will automatically advance to the next phase\n\n`;

  prompt += `3. If totalScore < ${phaseConfig.minScore}:\n`;
  prompt += `   - List specific improvements needed\n`;
  prompt += `   - The orchestrator will run another iteration\n\n`;

  prompt += `**Remember**: Be honest in your self-assessment. Quality over speed.\n`;

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
// SCORE PARSING
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

function evaluatePhaseCompletion() {
  const scores = readQualityScores();

  if (!scores || scores.phase !== state.currentPhase) {
    return { complete: false, score: 0, reason: 'No scores found for current phase' };
  }

  const calculatedScore = calculatePhaseScore(state.currentPhase, scores.scores || {});
  const minScore = PHASES[state.currentPhase]?.minScore || 80;

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

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

function runSession(prompt) {
  return new Promise((resolve) => {
    console.log('\n' + '─'.repeat(70));
    console.log(`SESSION ${state.totalSessions + 1}: ${state.currentPhase} phase (iteration ${state.phaseIteration})`);
    console.log('─'.repeat(70));

    // Mark task as in_progress when starting
    if (state.currentTaskId) {
      try {
        taskManager.updateStatus(state.currentTaskId, 'in_progress', {
          started: new Date().toISOString(),
          phase: state.currentPhase,
          iteration: state.phaseIteration
        });
        console.log(`[TASK] Marked task ${state.currentTaskId} as in_progress`);
      } catch (err) {
        console.log(`[TASK] Warning: Could not update task status: ${err.message}`);
      }
    }

    console.log('\nPrompt preview (first 500 chars):');
    console.log(prompt.substring(0, 500) + '...\n');
    console.log('─'.repeat(70) + '\n');

    // Spawn Claude with dangerous skip permissions for autonomous execution
    claudeProcess = spawn('claude', [
      '--dangerously-skip-permissions',
      '--print',
      prompt,
    ], {
      stdio: 'inherit',
      cwd: CONFIG.projectPath,
      shell: true,
    });

    claudeProcess.on('error', (err) => {
      console.error('\n[ERROR] Failed to start Claude:', err.message);
      currentSessionData.exitReason = 'error';
      resolve(1);
    });

    claudeProcess.on('exit', (code, signal) => {
      if (signal === 'SIGTERM') {
        currentSessionData.exitReason = 'threshold';
        console.log('\n[ORCHESTRATOR] Session terminated due to context threshold.');
      } else if (code === 0) {
        currentSessionData.exitReason = thresholdReached ? 'threshold' : 'complete';
      } else {
        currentSessionData.exitReason = 'error';
      }

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

async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('AUTONOMOUS MULTI-AGENT ORCHESTRATOR');
  console.log('═'.repeat(70));
  console.log(`Phase: ${CONFIG.startPhase}`);
  console.log(`Context Threshold: ${CONFIG.contextThreshold}%`);
  console.log(`Max Sessions: ${CONFIG.maxSessions || 'unlimited'}`);
  console.log(`Max Iterations/Phase: ${CONFIG.maxIterationsPerPhase}`);
  if (CONFIG.task) console.log(`Task: ${CONFIG.task}`);
  console.log('═'.repeat(70) + '\n');

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

    if (state.phaseIteration > CONFIG.maxIterationsPerPhase) {
      console.log(`\n[LIMIT] Max iterations for ${state.currentPhase} phase reached.`);
      console.log('[ADVANCING] Moving to next phase despite score...');
      advancePhase();
      continue;
    }

    // Get previous evaluation
    const prevEval = evaluatePhaseCompletion();
    let improvements = null;

    if (prevEval.score > 0 && !prevEval.complete) {
      improvements = generateImprovementGuidance(state.currentPhase, readQualityScores()?.scores || {});
    }

    // Generate prompt
    const prompt = generatePhasePrompt(
      state.currentPhase,
      state.phaseIteration,
      prevEval.score > 0 ? prevEval.score : null,
      improvements
    );

    // Reset session state
    thresholdReached = false;
    currentSessionData = {
      startTime: new Date(),
      peakContext: 0,
      exitReason: 'unknown',
    };

    // Run session
    await runSession(prompt);

    // Record session
    state.sessionHistory.push({
      session: state.totalSessions,
      phase: state.currentPhase,
      iteration: state.phaseIteration,
      exitReason: currentSessionData.exitReason,
      peakContext: currentSessionData.peakContext,
    });

    await postToDashboard('/api/series/session', {
      sessionNumber: state.totalSessions,
      phase: state.currentPhase,
      iteration: state.phaseIteration,
      exitReason: currentSessionData.exitReason,
      peakContext: currentSessionData.peakContext,
    });

    // Evaluate completion
    if (currentSessionData.exitReason === 'complete') {
      const evaluation = evaluatePhaseCompletion();
      console.log(`\n[EVALUATION] Phase: ${state.currentPhase}, Score: ${evaluation.score}`);

      if (evaluation.complete) {
        console.log(`[SUCCESS] ${state.currentPhase} phase complete!`);
        state.phaseScores[state.currentPhase] = evaluation.score;

        // Mark task as completed
        if (state.currentTaskId) {
          try {
            taskManager.updateStatus(state.currentTaskId, 'completed', {
              completed: new Date().toISOString(),
              phase: state.currentPhase,
              score: evaluation.score,
              iterations: state.phaseIteration
            });
            console.log(`[TASK] Marked task ${state.currentTaskId} as completed`);

            // Record in MemoryStore for historical learning
            const task = taskManager.getTask(state.currentTaskId);
            if (task && memoryStore) {
              memoryStore.recordTaskCompletion(task);
              console.log(`[TASK] Recorded task completion for historical learning`);
            }

            state.currentTaskId = null;
          } catch (err) {
            console.log(`[TASK] Warning: Could not complete task: ${err.message}`);
          }
        }

        advancePhase();
      } else {
        console.log(`[ITERATE] Score ${evaluation.score} below threshold. Will iterate.`);
        console.log(`[REASON] ${evaluation.reason}`);
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

function advancePhase() {
  const nextPhase = getNextPhase(state.currentPhase);
  console.log(`\n[PHASE] Advancing: ${state.currentPhase} → ${nextPhase || 'COMPLETE'}`);
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
  console.log('\nPhase Scores:');
  for (const [phase, score] of Object.entries(state.phaseScores)) {
    console.log(`  ${phase}: ${score}/100`);
  }
  console.log('\nSession History:');
  state.sessionHistory.forEach(s => {
    console.log(`  ${s.session}. ${s.phase} (iter ${s.iteration}): ${s.exitReason} @ ${s.peakContext.toFixed(1)}%`);
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

Usage:
  node autonomous-orchestrator.js [options]

Options:
  --phase <phase>          Starting phase (research, design, implement, test)
  --threshold <percent>    Context threshold for session cycling (default: 65)
  --max-sessions <n>       Maximum total sessions (default: unlimited)
  --max-iterations <n>     Max iterations per phase (default: 10)
  --task <description>     Task description
  --delay <ms>             Delay between sessions (default: 5000)
  --help, -h               Show this help

Phases:
  research    Requirements, analysis, risk assessment (min: 80)
  design      Architecture, APIs, data models (min: 85)
  implement   Code implementation (min: 90)
  test        Testing and validation (min: 90)

Examples:
  node autonomous-orchestrator.js --task "Build user auth system"
  node autonomous-orchestrator.js --phase design --max-iterations 5
`);
}

// ============================================================================
// SIGNAL HANDLERS
// ============================================================================

process.on('SIGINT', () => {
  console.log('\n[STOPPING] Received interrupt...');
  shouldContinue = false;
  if (claudeProcess) claudeProcess.kill('SIGTERM');
});

process.on('SIGTERM', () => {
  console.log('\n[STOPPING] Received terminate...');
  shouldContinue = false;
  if (claudeProcess) claudeProcess.kill('SIGTERM');
});

// ============================================================================
// RUN
// ============================================================================

main().catch(err => {
  console.error('Orchestrator error:', err);
  process.exit(1);
});
