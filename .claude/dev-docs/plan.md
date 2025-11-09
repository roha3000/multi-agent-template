# Current Task Plan

**Last Updated**: 2025-11-09
**Current Task**: Implement Critical Workflow Automation Features (Phase 3)
**Status**: In Progress

---

## Overview

Implementing the 6 pending critical features from the integration plan to complete Phase 3 (Critical Workflow Automation) and Phase 4 (Agent Library Expansion) of the Multi-Agent Framework enhancement.

**Goal**: Add daily workflow automation that makes the framework practical for daily use

---

## Current Task Breakdown

### Task 1: Dev-Docs 3-File Pattern ✅ IN PROGRESS
**Effort**: 4 hours
**Priority**: Highest ROI ⭐⭐⭐⭐⭐
**Status**: In Progress (creating plan.md and tasks.md)

**What We're Building**:
- `plan.md` - Current task breakdown and implementation plan
- `tasks.md` - Active todo list with progress tracking
- Integration with existing PROJECT_SUMMARY.md

**Why It Matters**:
- Prevents context drift on long tasks (>30 min)
- Claude always knows what it was doing
- User doesn't need to re-explain task state

**Implementation Steps**:
1. ✅ Create `.claude/dev-docs/` directory
2. ✅ Create `plan.md` with current task structure
3. ✅ Create `tasks.md` with todo list format
4. ⏳ Update session initialization to read all 3 files
5. ⏳ Add hooks to auto-update these files after task completion

---

### Task 2: Skills Auto-Activation Hook
**Effort**: 8 hours
**Priority**: Critical ⭐⭐⭐⭐⭐
**Status**: Pending

**What We're Building**:
- Hook that analyzes user prompts
- Automatically activates relevant skills from `.claude/skills/`
- No more manual skill activation needed

**Why It Matters**:
- Solves "Claude ignores docs" problem
- Saves time every session
- Skills stay synchronized with usage

**Implementation Steps**:
1. Create `.claude/hooks/` directory structure
2. Implement `user-prompt-submit.js` hook
3. Add skill discovery and relevance scoring
4. Integrate with existing LifecycleHooks system
5. Test with various prompt types

**Technical Design**:
```javascript
// .claude/hooks/user-prompt-submit.js
async function analyzeAndActivateSkills(prompt) {
  const skills = await discoverSkills('.claude/skills/');
  const relevantSkills = await scoreRelevance(prompt, skills);
  return {
    skills: relevantSkills.filter(s => s.score > 0.7),
    instruction: `Activate skills: ${relevantSkills.map(s => s.name).join(', ')}`
  };
}
```

---

### Task 3: Build Checking Hook
**Effort**: 6 hours
**Priority**: High ⭐⭐⭐⭐
**Status**: Pending

**What We're Building**:
- Hook that runs after code changes
- Executes build/test commands
- Halts execution if errors detected

**Why It Matters**:
- Catches errors immediately
- Prevents debugging old code
- Saves hours on complex bugs

**Implementation Steps**:
1. Create `after-code-change.js` hook
2. Detect file changes (use file watcher or Git status)
3. Run build command (`npm run build` or configured)
4. Parse output for errors
5. Halt with error context if build fails

**Technical Design**:
```javascript
// .claude/hooks/after-code-change.js
async function runBuildCheck(changedFiles) {
  const buildResult = await runBuild();
  if (buildResult.errors.length > 0) {
    throw new Error(`Build failed: ${buildResult.errors.join('\n')}`);
  }
}
```

---

### Task 4: Error Context Injection
**Effort**: 8 hours
**Priority**: High ⭐⭐⭐⭐
**Status**: Pending (components exist, need integration)

**What We're Building**:
- Error parser (TypeScript, Jest, runtime errors)
- Similarity search integration with VectorStore
- Auto-injection hook that provides solutions

**Why It Matters**:
- Learns from past errors
- Auto-resolves similar problems
- Gets smarter over time

**What We Have**:
- ✅ VectorStore (Chroma + FTS5)
- ✅ MemoryStore (SQLite)
- ✅ ContextRetriever

**What's Missing**:
- ❌ Error parser
- ❌ Similarity search integration
- ❌ Auto-injection hook

**Implementation Steps**:
1. Create `.claude/core/error-parser.js`
   - Parse TypeScript errors: `error TS2345: Argument of type...`
   - Parse Jest errors: `FAIL __tests__/...`
   - Parse runtime errors: `TypeError: Cannot read property...`
2. Enhance existing `afterExecution` hook in MemoryIntegration
3. Add error similarity search using VectorStore
4. Inject solutions from past similar errors
5. Test with various error types

**Technical Design**:
```javascript
// .claude/core/error-parser.js
function parseErrors(output) {
  const patterns = [
    { type: 'typescript', regex: /error TS(\d+): (.+)/ },
    { type: 'jest', regex: /FAIL (.+)\n(.+)/ },
    { type: 'runtime', regex: /(TypeError|ReferenceError): (.+)/ }
  ];
  // Extract errors from output
}

// Enhance .claude/core/memory-integration.js
async function injectErrorContext(result) {
  const errors = parseErrors(result.output);
  if (errors.length > 0) {
    const similar = await vectorStore.searchSimilar(errors[0].message, {
      limit: 5,
      threshold: 0.7
    });
    // Return solutions from similar past errors
  }
}
```

---

### Task 5: Research-Driven Development
**Effort**: 16 hours
**Priority**: High 🟡
**Status**: Pending

**What We're Building**:
- Parallel research workflow commands
- Research synthesis agent
- Automated comparison and analysis

**Why It Matters**:
- 5x speedup on research tasks
- Multiple approaches tested simultaneously
- Better decision-making with comprehensive data

**Implementation Steps**:
1. Create research workflow commands in `.claude/commands/research/`
2. Implement parallel hypothesis testing
3. Create research synthesis agent
4. Add comparison and reporting
5. Integrate with existing AgentOrchestrator

**Example Use Case**:
```
Research Question: "Best state management library for React 2025"

Traditional (Serial): 90 minutes
- Research Redux → 30 min
- Research Zustand → 30 min
- Research Jotai → 30 min

Research-Driven (Parallel): 20 minutes
- Spawn 3 agents simultaneously
- Each researches one library
- Synthesize findings → 5x faster
```

---

### Task 6: Port 80+ Agents from orchestr8
**Effort**: 20 hours
**Priority**: High (infrastructure ready) 🟡
**Status**: Pending

**What We're Building**:
- Port 80+ specialized agents from orchestr8 library
- Organized by category (research, planning, design, testing, implementation, validation)
- All agents in YAML format

**Why It Matters**:
- Massive capability expansion
- Specialized expertise for every domain
- Productivity multiplier

**Current State**:
- ✅ AgentLoader infrastructure complete
- ✅ 22 agents operational (15 migrated + 7 diet103)
- ✅ Ready for scale (supports 100+ agents)

**Categories to Port**:
1. Research agents (15): competitive-analyst, tech-evaluator, market-researcher
2. Planning agents (12): roadmap-planner, estimator, risk-analyst
3. Design agents (18): api-designer, data-modeler, security-architect
4. Testing agents (14): e2e-tester, performance-tester, security-tester
5. Implementation agents (16): backend-specialist, frontend-specialist, devops-engineer
6. Validation agents (5): code-reviewer, security-auditor, compliance-checker

**Implementation Steps**:
1. Set up import script to convert orchestr8 format → YAML
2. Port high-value agents first (research, testing, implementation)
3. Validate agent configurations
4. Test agent discovery and loading
5. Update agent statistics and documentation

---

## Dependencies

**Task Dependencies**:
- Task 1 (Dev-Docs) → Independent, can start immediately ✅
- Task 2 (Skills) → Depends on hooks directory structure
- Task 3 (Build Check) → Depends on hooks directory structure
- Task 4 (Error Context) → Depends on existing VectorStore, MemoryStore
- Task 5 (Research) → Depends on AgentOrchestrator, AgentLoader
- Task 6 (Agent Port) → Depends on AgentLoader (already complete)

**Recommended Order**:
1. ✅ Task 1 (Dev-Docs) - Lowest effort, immediate value
2. Task 2 (Skills Auto-Activation) - Critical daily workflow
3. Task 4 (Error Context) - Leverages existing components
4. Task 3 (Build Check) - Quick implementation
5. Task 6 (Agent Port) - Infrastructure ready, high value
6. Task 5 (Research Workflows) - Most complex, requires other tasks

---

## Success Criteria

### Task 1 Complete When:
- ✅ `plan.md` created with task breakdown
- ✅ `tasks.md` created with todo list format
- ⏳ Session init reads all 3 dev-docs files
- ⏳ Hooks auto-update files after task completion

### Task 2 Complete When:
- Skills auto-activate on relevant prompts
- No manual skill activation needed
- Zero false positives (irrelevant skills)
- Tests pass for various prompt types

### Task 3 Complete When:
- Build runs after every code change
- Errors halt execution with context
- User sees clear error messages
- Build time is reasonable (<30s)

### Task 4 Complete When:
- All error types parsed correctly
- Similar errors found via vector search
- Solutions auto-injected in context
- System learns from every error

### Task 5 Complete When:
- Research workflows parallelized
- Synthesis agent produces reports
- 5x speedup demonstrated
- Works with existing agents

### Task 6 Complete When:
- 80+ agents ported successfully
- All agents discoverable via AgentLoader
- Agent statistics updated
- Documentation reflects new agents

---

## Timeline

**Phase 3 (Critical Workflow Automation)**: 26 hours
- Task 1: 4 hours (in progress)
- Task 2: 8 hours
- Task 3: 6 hours
- Task 4: 8 hours

**Phase 4 (Agent Library Expansion)**: 20 hours
- Task 6: 20 hours

**Phase 5 (Research Workflows)**: 16 hours
- Task 5: 16 hours

**Total Estimated Time**: 62 hours (~6-7 weeks @ 10h/week)

---

## Notes

- Focus on immediate daily workflow improvements first (Tasks 1-4)
- Agent library expansion (Task 6) provides long-term value
- Research workflows (Task 5) are most complex, implement last
- All tasks leverage existing architecture (no major rewrites needed)
- Quality gates maintained throughout (85/100 minimum)

---

## Current Focus

**Active Task**: Task 1 - Dev-Docs 3-File Pattern
**Next Step**: Create `tasks.md` and update session initialization
**Blockers**: None
**ETA**: End of current session
