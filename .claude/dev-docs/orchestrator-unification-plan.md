# Orchestrator Unification Plan

**Created**: 2025-12-27 (Session 28)
**Status**: READY FOR IMPLEMENTATION
**Author**: Research Analyst (Claude Opus 4.5)

---

## Executive Summary

This document outlines the plan to unify two orchestrator implementations into a single, robust system with proper phase progression and swarm integration. The unified orchestrator will:

1. Fix the critical phase progression bug (tasks completing after one phase)
2. Integrate all 5 swarm components from ContinuousLoopOrchestrator
3. Enable swarm features in interactive CLI mode via hooks
4. Auto-spawn tasks for each phase transition

---

## Current State Analysis

### Two Orchestrators (Never Unified)

| Component | autonomous-orchestrator.js | ContinuousLoopOrchestrator |
|-----------|---------------------------|---------------------------|
| **Lines** | 1,252 | 1,503 |
| **Entry** | `npm run autonomous` | Never used in production |
| **Task Management** | TaskManager integration | None |
| **Phase Gates** | Imports quality-gates.js | Own checkSafety() |
| **Swarm Components** | NONE | ALL 5 |
| **Feature Flags** | Not used | Fully integrated |

### Critical Bug: Phase Progression (Lines 990-997)

```javascript
// CURRENT BUG: autonomous-orchestrator.js lines 990-997
if (taskEval.complete && phaseEval.complete) {
  // Task completed successfully
  handleTaskCompletion(taskEval, phaseEval.score);  // Marks DONE
  state.phaseScores[state.currentPhase] = phaseEval.score;
  state.currentTask = null;

  // Continue to next task (don't advance phase yet)  // <-- BUG!
  console.log('[CONTINUE] Looking for next task...');
}
```

**Expected behavior**: Task should progress through ALL phases (research → design → implement → test) before completion.

**Actual behavior**: Task marked complete after ONE phase passes quality gate.

### Swarm Components (All in ContinuousLoopOrchestrator)

| Component | Purpose | Integration Point |
|-----------|---------|-------------------|
| **SecurityValidator** | Prompt injection, path traversal detection | Before each operation |
| **ConfidenceMonitor** | 5-signal confidence tracking (0-100) | During execution |
| **ComplexityAnalyzer** | Task complexity scoring | Task start |
| **CompetitivePlanner** | Generate 2-3 plan strategies | Complex tasks (>40 score) |
| **PlanEvaluator** | Compare and select best plan | After plan generation |

---

## Target Architecture

### Unified System Diagram

```
UNIFIED autonomous-orchestrator.js
├─ Task Execution Engine
│   ├─ TaskManager integration (existing)
│   ├─ Quality gates (quality-gates.js)
│   └─ Phase progression loop (NEW)
│
├─ Swarm Controller Module (NEW)
│   ├─ SecurityValidator
│   ├─ ConfidenceMonitor
│   ├─ ComplexityAnalyzer
│   ├─ CompetitivePlanner
│   └─ PlanEvaluator
│
└─ Feature Flags (feature-flags.js)
    └─ Enable/disable each component

CLI HOOKS (for interactive mode)
├─ SessionStart: Load context, initialize swarm
├─ UserPromptSubmit: Security validation
├─ PreToolUse: Safety checks
├─ PostToolUse: Confidence tracking
└─ Stop: Quality gate check
```

---

## Implementation Plan

### Phase 1: Create SwarmController Module (NEW FILE)

**File**: `.claude/core/swarm-controller.js`

**Purpose**: Single entry point for all swarm functionality, usable by both autonomous orchestrator and CLI hooks.

```javascript
/**
 * SwarmController - Unified interface for swarm components
 *
 * Used by:
 * - autonomous-orchestrator.js (autonomous mode)
 * - CLI hooks (interactive mode)
 */

const featureFlags = require('./feature-flags');

class SwarmController {
  constructor(options = {}) {
    this.memoryStore = options.memoryStore;
    this._initializeComponents();
  }

  _initializeComponents() {
    // Initialize only if feature flag enabled
    if (featureFlags.isEnabled('securityValidation')) {
      const SecurityValidator = require('./security-validator');
      this.securityValidator = new SecurityValidator({
        mode: this.options?.securityMode || 'audit'
      });
    }

    if (featureFlags.isEnabled('confidenceMonitoring')) {
      const ConfidenceMonitor = require('./confidence-monitor');
      this.confidenceMonitor = new ConfidenceMonitor();
    }

    if (featureFlags.isEnabled('complexityDetection')) {
      const ComplexityAnalyzer = require('./complexity-analyzer');
      this.complexityAnalyzer = new ComplexityAnalyzer({
        memoryStore: this.memoryStore
      });
    }

    if (featureFlags.isEnabled('competitivePlanning')) {
      const CompetitivePlanner = require('./competitive-planner');
      const { PlanEvaluator } = require('./plan-evaluator');
      this.planEvaluator = new PlanEvaluator();
      this.competitivePlanner = new CompetitivePlanner({
        complexityAnalyzer: this.complexityAnalyzer,
        planEvaluator: this.planEvaluator
      });
    }
  }

  // === Main API ===

  async checkSafety(operation) {
    const results = { safe: true, checks: {} };

    // Security validation
    if (this.securityValidator) {
      const secResult = this.securityValidator.validate(
        operation.task,
        'description'
      );
      results.checks.security = secResult;
      if (!secResult.valid) results.safe = false;
    }

    // Confidence check
    if (this.confidenceMonitor) {
      const confState = this.confidenceMonitor.getState();
      results.checks.confidence = confState;
      if (confState.thresholdState === 'emergency') {
        results.safe = false;
        results.action = 'HALT_IMMEDIATELY';
      }
    }

    return results;
  }

  async analyzeComplexity(task) {
    if (!this.complexityAnalyzer) return { score: 50, strategy: 'standard' };
    return this.complexityAnalyzer.analyze(task);
  }

  async generatePlans(task, options = {}) {
    if (!this.competitivePlanner) return { plans: [], winner: null };
    return this.competitivePlanner.generatePlans(task, options);
  }

  trackProgress(progress) {
    if (!this.confidenceMonitor) return;

    if (progress.qualityScore !== undefined) {
      this.confidenceMonitor.update('qualityScore', progress.qualityScore);
    }
    if (progress.iteration !== undefined) {
      this.confidenceMonitor.trackIteration(progress.iteration);
    }
  }

  getStatus() {
    return {
      security: this.securityValidator?.getStats() || null,
      confidence: this.confidenceMonitor?.getState() || null,
      complexity: this.complexityAnalyzer?.getCacheStats() || null,
      planning: !!this.competitivePlanner
    };
  }
}

module.exports = SwarmController;
```

**Effort**: 2 hours

---

### Phase 2: Fix Phase Progression in autonomous-orchestrator.js

**Problem**: Lines 990-997 mark task complete after ONE phase.

**Solution**: Keep task active, advance phase, only complete when all phases done.

#### 2.1 Add Phase Tracking per Task

```javascript
// Add to state object (around line 113)
const state = {
  // ... existing
  currentTask: null,
  currentTaskPhase: null,     // NEW: Current phase for this task
  taskPhaseHistory: {},       // NEW: Track which phases completed per task
};
```

#### 2.2 Replace Bug Code (Lines 990-1016)

```javascript
// FIXED VERSION - Replace lines 990-1016
if (currentSessionData.exitReason === 'complete') {
  const phaseEval = evaluatePhaseCompletion();
  console.log(`\n[EVALUATION] Phase: ${state.currentPhase}, Score: ${phaseEval.score}`);

  if (currentTask && taskManagementEnabled) {
    const taskEval = evaluateTaskCompletion();

    if (taskEval.complete && phaseEval.complete) {
      // Phase passed for this task - record it
      state.phaseScores[state.currentPhase] = phaseEval.score;

      // Track phase completion for this task
      if (!state.taskPhaseHistory[currentTask.id]) {
        state.taskPhaseHistory[currentTask.id] = [];
      }
      state.taskPhaseHistory[currentTask.id].push(state.currentPhase);

      // Check if task has more phases to complete
      const nextPhase = getNextPhase(state.currentPhase);

      if (nextPhase && nextPhase !== 'complete') {
        // MORE PHASES TO DO - advance phase, keep same task
        console.log(`[PHASE COMPLETE] ${state.currentPhase} → ${nextPhase}`);

        // SECURITY CHECK before phase transition
        if (swarmController) {
          const transitionCheck = await swarmController.checkSafety({
            task: currentTask.title,
            phase: nextPhase,
            type: 'phase-transition',
            fromPhase: state.currentPhase
          });
          if (!transitionCheck.safe) {
            console.log(`[BLOCKED] Phase transition blocked: ${transitionCheck.action}`);
            continue; // Stay in current phase, don't transition
          }
        }

        state.currentPhase = nextPhase;
        state.phaseIteration = 0;

        // Spawn next phase task (auto-create in tasks.json)
        await spawnPhaseTask(currentTask, nextPhase);

        // Keep currentTask - don't clear it
        // Continue loop will pick up next phase
      } else {
        // ALL PHASES COMPLETE - now mark task done
        console.log(`[TASK COMPLETE] All phases done for ${currentTask.id}`);
        handleTaskCompletion(taskEval, phaseEval.score);
        state.currentTask = null;
        state.currentPhase = 'research'; // Reset for next task
      }

      // Clear completion file for next iteration
      clearTaskCompletion();
    } else if (taskEval.complete && !phaseEval.complete) {
      console.log(`[ITERATE] Task done but quality ${phaseEval.score} below threshold.`);
    } else {
      console.log(`[ITERATE] Task not complete: ${taskEval.reason}`);
    }
  }
  // ... legacy mode unchanged
}
```

#### 2.3 Add spawnPhaseTask Function

```javascript
/**
 * Auto-spawn a task for the next phase
 * Creates a new task entry in tasks.json for the next development phase
 *
 * @param {Object} parentTask - The original task being developed
 * @param {string} nextPhase - The phase to spawn (design, implement, test)
 */
async function spawnPhaseTask(parentTask, nextPhase) {
  if (!taskManager) return;

  const phaseTaskId = `${parentTask.id}-${nextPhase}`;

  // Check if phase task already exists
  const existing = taskManager.getTask(phaseTaskId);
  if (existing) {
    console.log(`[SPAWN] Phase task ${phaseTaskId} already exists`);
    return existing;
  }

  // Map phase to task.json phase name
  const phaseNameMap = {
    'design': 'design',
    'implement': 'implementation',
    'test': 'testing'
  };

  const phaseDescriptions = {
    'design': `Design phase for: ${parentTask.title}`,
    'implement': `Implementation phase for: ${parentTask.title}`,
    'test': `Testing phase for: ${parentTask.title}`
  };

  const phaseAcceptance = {
    'design': [
      'Architecture documented with diagrams',
      'API contracts defined with schemas',
      'Data models complete with relationships',
      'Security design documented',
      'Testing strategy defined'
    ],
    'implement': [
      'All designed features implemented',
      'Code follows best practices',
      'Error handling comprehensive',
      'Code documented',
      'Security measures implemented'
    ],
    'test': [
      'Unit tests with >80% coverage',
      'Integration tests for critical paths',
      'Edge cases tested',
      'Security testing performed',
      'Documentation reviewed'
    ]
  };

  const newTask = taskManager.createTask({
    id: phaseTaskId,
    title: `[${nextPhase.toUpperCase()}] ${parentTask.title}`,
    description: phaseDescriptions[nextPhase] || `${nextPhase} phase for: ${parentTask.title}`,
    phase: phaseNameMap[nextPhase] || nextPhase,
    priority: parentTask.priority || 'high',
    estimate: parentTask.estimate || '2h',
    tags: [...(parentTask.tags || []), 'auto-spawned', `phase-${nextPhase}`],
    depends: {
      blocks: [],
      requires: [parentTask.id], // Depends on parent task's previous phase
      related: [parentTask.id]
    },
    acceptance: phaseAcceptance[nextPhase] || [],
    backlogTier: 'now' // Add to NOW queue immediately
  });

  console.log(`[SPAWN] Created phase task: ${newTask.id}`);

  // Emit event for dashboard tracking
  if (notificationService) {
    await notificationService.alertPhaseCompletion({
      phase: state.currentPhase,
      score: state.phaseScores[state.currentPhase],
      nextPhase,
      spawnedTask: newTask.id
    });
  }

  return newTask;
}
```

#### 2.4 Update printSummary() to Show Phase History per Task

The session summary should display which phases each task completed.

```javascript
// Update printSummary() function (around line 1100)
function printSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('AUTONOMOUS ORCHESTRATION SUMMARY');
  console.log('='.repeat(60));

  // ... existing summary code ...

  // NEW: Show phase history per task
  if (Object.keys(state.taskPhaseHistory).length > 0) {
    console.log('\n--- Task Phase History ---');
    for (const [taskId, phases] of Object.entries(state.taskPhaseHistory)) {
      const phaseChain = phases.join(' → ');
      const complete = phases.includes('test') ? '✓' : '...';
      console.log(`  ${taskId}: ${phaseChain} ${complete}`);
    }
  }

  // Show phase scores
  console.log('\n--- Phase Scores ---');
  for (const [phase, score] of Object.entries(state.phaseScores)) {
    const status = score >= PHASES[phase]?.minScore ? '✓' : '✗';
    console.log(`  ${phase}: ${score}/100 ${status}`);
  }

  // ... rest of existing summary ...
}
```

**Effort**: 3 hours (total for Phase 2)

---

### Phase 3: Integrate SwarmController into autonomous-orchestrator.js

#### 3.1 Add Imports and Initialization

```javascript
// Add to imports (around line 30)
const SwarmController = require('./.claude/core/swarm-controller');

// Add to state initialization (around line 130)
let swarmController = null;

// Add to main() after taskManagement init (around line 835)
try {
  swarmController = new SwarmController({
    memoryStore,
    securityMode: process.env.SECURITY_MODE || 'audit'
  });
  console.log('[SWARM] SwarmController initialized');
  console.log('[SWARM] Components:', swarmController.getStatus());
} catch (err) {
  console.warn('[SWARM] Failed to initialize:', err.message);
}
```

#### 3.2 Add Safety Checks Before Each Session

```javascript
// Add before runSession() call (around line 955)
if (swarmController) {
  const safetyCheck = await swarmController.checkSafety({
    task: currentTask?.title || state.task,
    phase: state.currentPhase,
    type: 'session'
  });

  if (!safetyCheck.safe) {
    console.log(`[SAFETY] Blocked: ${safetyCheck.action}`);

    if (safetyCheck.action === 'HALT_IMMEDIATELY') {
      console.log('[EMERGENCY] Halting execution');
      shouldContinue = false;
      break;
    }

    // Wait for intervention if critical
    if (safetyCheck.checks.confidence?.thresholdState === 'critical') {
      console.log('[WAITING] Low confidence - pausing for review');
      await new Promise(r => setTimeout(r, 30000)); // 30s pause
    }
  }

  // Analyze complexity on task start
  if (currentTask && state.taskIterations[currentTask.id] === 1) {
    const complexity = await swarmController.analyzeComplexity(currentTask);
    console.log(`[COMPLEXITY] Task ${currentTask.id}: ${complexity.score}/100`);

    // Generate competing plans for complex tasks
    if (complexity.score >= 70) {
      const plans = await swarmController.generatePlans(currentTask, {
        complexity: complexity.score
      });
      console.log(`[PLANS] Generated ${plans.plans.length} strategies`);
      // TODO: Present plans to user or select winner
    }
  }
}
```

#### 3.3 Track Progress After Each Session

```javascript
// Add after session completion evaluation (around line 1010)
if (swarmController) {
  swarmController.trackProgress({
    qualityScore: phaseEval.score,
    iteration: currentTask ? state.taskIterations[currentTask.id] : state.phaseIteration,
    completed: taskEval.complete ? 1 : 0,
    total: currentTask?.acceptance?.length || 1
  });
}
```

**Effort**: 2 hours

---

### Phase 4: CLI Hooks for Interactive Mode

Create hooks that enable swarm features when using Claude Code interactively (without autonomous orchestrator).

#### 4.1 Hook Configuration

**File**: `.claude/settings.local.json` (add hooks section)

```json
{
  "permissions": { /* existing */ },
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/session-start.js",
            "timeout": 10
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/validate-prompt.js",
            "timeout": 5
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/pre-tool-check.js",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/track-progress.js",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

#### 4.2 Session Start Hook

**File**: `.claude/hooks/session-start.js`

```javascript
#!/usr/bin/env node
/**
 * SessionStart Hook - Initialize swarm context for CLI sessions
 */

const fs = require('fs');
const path = require('path');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Read input from stdin
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('readable', () => {
  let chunk;
  while ((chunk = process.stdin.read()) !== null) {
    input += chunk;
  }
});

process.stdin.on('end', () => {
  try {
    // Load project context
    const tasksPath = path.join(projectDir, '.claude/dev-docs/tasks.json');
    const summaryPath = path.join(projectDir, 'PROJECT_SUMMARY.md');

    let context = '';

    // Load current task queue
    if (fs.existsSync(tasksPath)) {
      const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf-8'));
      const nowTasks = tasks.backlog?.now?.tasks || [];
      const readyTasks = nowTasks
        .map(id => tasks.tasks[id])
        .filter(t => t && t.status === 'ready')
        .slice(0, 3);

      if (readyTasks.length > 0) {
        context += '\n## Ready Tasks (NOW queue)\n';
        readyTasks.forEach(t => {
          context += `- [${t.priority}] ${t.title} (${t.phase})\n`;
        });
      }
    }

    // Initialize swarm components
    try {
      const SwarmController = require(path.join(projectDir, '.claude/core/swarm-controller'));
      const swarm = new SwarmController();
      const status = swarm.getStatus();

      context += '\n## Swarm Status\n';
      context += `- Security: ${status.security ? 'Active' : 'Disabled'}\n`;
      context += `- Confidence: ${status.confidence?.confidence || 100}%\n`;
      context += `- Planning: ${status.planning ? 'Enabled' : 'Disabled'}\n`;
    } catch (e) {
      // Swarm not available - OK for CLI sessions
    }

    console.log(context);
    process.exit(0);

  } catch (err) {
    console.error(`Session init error: ${err.message}`);
    process.exit(0); // Don't block on errors
  }
});
```

#### 4.3 Prompt Validation Hook

**File**: `.claude/hooks/validate-prompt.js`

```javascript
#!/usr/bin/env node
/**
 * UserPromptSubmit Hook - Security validation for prompts
 */

const fs = require('fs');
const path = require('path');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => input += chunk);

process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const prompt = data.prompt || '';

    // Load SecurityValidator
    const SecurityValidator = require(path.join(projectDir, '.claude/core/security-validator'));
    const validator = new SecurityValidator({ mode: 'audit' });

    const result = validator.validate(prompt, 'description');

    if (!result.valid) {
      // Log threats but don't block in audit mode
      const threats = result.threats.map(t => t.type).join(', ');
      console.error(`[SECURITY] Potential threats detected: ${threats}`);
    }

    process.exit(0);

  } catch (err) {
    // Don't block on errors
    process.exit(0);
  }
});
```

#### 4.4 Pre-Tool Check Hook

**File**: `.claude/hooks/pre-tool-check.js`

```javascript
#!/usr/bin/env node
/**
 * PreToolUse Hook - Safety checks before tool execution
 */

const fs = require('fs');
const path = require('path');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => input += chunk);

process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name;
    const toolInput = data.tool_input;

    // Load SecurityValidator for path validation
    try {
      const SecurityValidator = require(path.join(projectDir, '.claude/core/security-validator'));
      const validator = new SecurityValidator({ mode: 'enforce' });

      // Check for dangerous commands
      if (toolName === 'Bash' && toolInput.command) {
        const result = validator.validate(toolInput.command, 'command');

        if (!result.valid) {
          console.error(`Blocked: ${result.threats.map(t => t.reason).join(', ')}`);
          process.exit(2); // Block the tool call
        }
      }

      // Check for path traversal
      if (toolInput.file_path || toolInput.path) {
        const pathToCheck = toolInput.file_path || toolInput.path;
        const result = validator.validate(pathToCheck, 'path');

        if (!result.valid) {
          console.error(`Blocked: ${result.threats.map(t => t.reason).join(', ')}`);
          process.exit(2);
        }
      }
    } catch (e) {
      // SecurityValidator not available - allow
    }

    process.exit(0);

  } catch (err) {
    process.exit(0);
  }
});
```

#### 4.5 Progress Tracking Hook

**File**: `.claude/hooks/track-progress.js`

```javascript
#!/usr/bin/env node
/**
 * PostToolUse Hook - Track progress for confidence monitoring
 */

const fs = require('fs');
const path = require('path');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => input += chunk);

process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name;
    const toolResponse = data.tool_response;

    // Log to audit file
    const auditPath = path.join(projectDir, '.claude/logs/tool-audit.jsonl');
    const auditDir = path.dirname(auditPath);

    if (!fs.existsSync(auditDir)) {
      fs.mkdirSync(auditDir, { recursive: true });
    }

    const entry = {
      timestamp: new Date().toISOString(),
      session_id: data.session_id,
      tool: toolName,
      success: !toolResponse?.error
    };

    fs.appendFileSync(auditPath, JSON.stringify(entry) + '\n');

    // Update confidence if errors
    if (toolResponse?.error) {
      try {
        const SwarmController = require(path.join(projectDir, '.claude/core/swarm-controller'));
        const swarm = new SwarmController();
        swarm.trackProgress({ errors: 1 });
      } catch (e) {
        // Swarm not available
      }
    }

    process.exit(0);

  } catch (err) {
    process.exit(0);
  }
});
```

**Effort**: 3 hours

---

### Phase 5: Deprecate ContinuousLoopOrchestrator

After the unified system is working:

1. **Mark as deprecated** in code comments
2. **Update imports** - anything using it should use SwarmController instead
3. **Archive file** - move to `.claude/core/deprecated/`
4. **Update documentation** - remove references

**File changes**:
- Move `.claude/core/continuous-loop-orchestrator.js` to `.claude/core/deprecated/`
- Update any tests that import it directly

**Effort**: 30 minutes

---

## File Summary

### Files to CREATE

| File | Purpose | Lines (est) |
|------|---------|-------------|
| `.claude/core/swarm-controller.js` | Unified swarm interface | ~200 |
| `.claude/hooks/session-start.js` | CLI session init | ~60 |
| `.claude/hooks/validate-prompt.js` | Prompt security | ~50 |
| `.claude/hooks/pre-tool-check.js` | Tool safety | ~70 |
| `.claude/hooks/track-progress.js` | Progress tracking | ~60 |

### Files to MODIFY

| File | Changes |
|------|---------|
| `autonomous-orchestrator.js` | Fix phase progression, add swarm integration, add spawnPhaseTask |
| `.claude/settings.local.json` | Add hooks configuration |

### Files to DEPRECATE

| File | Action |
|------|--------|
| `.claude/core/continuous-loop-orchestrator.js` | Move to deprecated folder |

---

## Breaking Changes

### 1. Task Completion Behavior

**Before**: Task completes after ONE phase (research only)
**After**: Task progresses through ALL phases before completion

**Impact**: Tasks will take longer but will be properly implemented

### 2. Auto-Spawned Phase Tasks

**Before**: Single task for entire feature
**After**: Child tasks auto-created for each phase

**Impact**: More tasks in tasks.json, clearer tracking

**Migration**: No action needed - existing completed tasks unaffected

### 3. CLI Hooks

**Before**: No swarm features in interactive mode
**After**: Security validation, progress tracking active

**Impact**: Some prompts may trigger security warnings

**Migration**: Set `SECURITY_MODE=audit` to start (non-blocking)

---

## Testing Plan

### Unit Tests

1. **SwarmController**
   - Test each component initialization with feature flags
   - Test checkSafety() aggregation
   - Test analyzeComplexity() delegation
   - Test generatePlans() flow

2. **Phase Progression**
   - Test task stays active across phases
   - Test spawnPhaseTask creates correct child tasks
   - Test all phases complete before task completion
   - Test phase history tracking

3. **CLI Hooks**
   - Test each hook script standalone
   - Test hook JSON input/output format
   - Test exit codes for blocking behavior

### E2E Tests

1. **Full Task Lifecycle**
   - Create task in research phase
   - Verify progresses through design, implement, test
   - Verify child tasks created
   - Verify final completion only after all phases

2. **Swarm Integration**
   - Test security blocking in enforce mode
   - Test confidence warnings trigger pause
   - Test complexity analysis for complex tasks
   - Test plan generation for high-complexity tasks

---

## Implementation Order

| Order | Task | Depends On | Effort |
|-------|------|------------|--------|
| 1 | Create SwarmController module | - | 2h |
| 2 | Fix phase progression bug | - | 3h |
| 3 | Add spawnPhaseTask function | #2 | 1h |
| 4 | Integrate SwarmController | #1, #2 | 2h |
| 5 | Create CLI hooks | #1 | 3h |
| 6 | Update settings.local.json | #5 | 15m |
| 7 | Write tests | #1-6 | 2h |
| 8 | Deprecate ContinuousLoopOrchestrator | #4 | 30m |

**Total Estimated Effort**: ~14 hours

---

## Acceptance Criteria

### Phase Progression (from orchestrator-phase-progression-fix)
- [ ] USE quality-gates.js: getNextPhase(), PHASES[].minScore, calculatePhaseScore()
- [ ] Tasks progress through ALL phases (research → design → implement → test → complete)
- [ ] handleTaskCompletion() only called when getNextPhase() returns null or 'complete'
- [ ] state.currentTask preserved across phase transitions
- [ ] spawnPhaseTask() creates child tasks in tasks.json for each phase
- [ ] Child tasks have proper dependencies (requires parent's previous phase)
- [ ] Session history (printSummary) shows all phases per task

### Swarm Integration (from orchestrator-phase-progression-fix)
- [ ] USE swarm components: SecurityValidator, ConfidenceMonitor, ComplexityAnalyzer, CompetitivePlanner, PlanEvaluator
- [ ] Wire in checkSafety() pattern from ContinuousLoopOrchestrator
- [ ] SwarmController provides unified interface for all 5 components
- [ ] SecurityValidator.validate() called before each phase transition
- [ ] ConfidenceMonitor.getState() checked - block if emergency threshold
- [ ] ComplexityAnalyzer.analyze() called on task start
- [ ] CompetitivePlanner generates plans for complex tasks (>70 score)
- [ ] Feature flags (feature-flags.js) respected for enabling/disabling components

### CLI Hooks
- [ ] CLI hooks enable swarm features in interactive mode
- [ ] SessionStart hook loads context and initializes swarm
- [ ] UserPromptSubmit hook validates security
- [ ] PreToolUse hook checks safety
- [ ] PostToolUse hook tracks progress

### Cleanup
- [ ] ContinuousLoopOrchestrator deprecated and archived
- [ ] No new logic invented - reuse existing infrastructure

---

## References

- `autonomous-orchestrator.js` - Current task execution (1,252 lines)
- `.claude/core/continuous-loop-orchestrator.js` - Swarm integration (1,503 lines)
- `quality-gates.js` - Phase definitions and scoring (437 lines)
- `.claude/core/feature-flags.js` - Feature toggle system (194 lines)
- `.claude/core/task-manager.js` - Task CRUD and dependencies (726 lines)
- Swarm components:
  - `.claude/core/security-validator.js`
  - `.claude/core/confidence-monitor.js`
  - `.claude/core/complexity-analyzer.js`
  - `.claude/core/competitive-planner.js`
  - `.claude/core/plan-evaluator.js`
