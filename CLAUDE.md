# CLAUDE.md - Unified Multi-Agent Multi-Model Development System

## ⚠️ CRITICAL SAFETY RULES (READ FIRST)

**NEVER kill all Node.js processes!** Claude Code itself runs on Node.js.

```bash
# ❌ FORBIDDEN - These will crash Claude Code:
taskkill //F //IM node.exe
pkill node
killall node

# ✅ SAFE - Kill by specific PID or port:
taskkill //F //PID <specific_pid>
npx kill-port 3033
netstat -aon | grep :3033  # Find PID first, then kill that PID
```

**When restarting servers:**
1. Find the specific PID using `netstat -aon | grep :<port>`
2. Kill only that PID with `taskkill //F //PID <pid>`
3. Start the new server

---

## Project Overview
Multi-agent development system that combines specialized AI agent personas with strategic model selection for optimal development workflows.

## Session Initialization (Read This First!)

**At the start of every session**, automatically load project context by reading these files:

```
1. PROJECT_SUMMARY.md           # High-level project state and context
2. .claude/dev-docs/plan.md     # Current task breakdown and implementation plan
3. .claude/dev-docs/tasks.json  # Structured task data with dependencies and status
4. .claude/ARCHITECTURE.md      # Canonical components (check BEFORE designing new features)
```

**Why these files?** This is the **Dev-Docs Pattern** that prevents context drift and architectural violations:
- `PROJECT_SUMMARY.md` - What we've built (project history, architecture, quality scores)
- `plan.md` - What we're building (current task breakdown, implementation steps)
- `tasks.json` - Structured tasks with backlog tiers, dependencies, and status tracking
- `ARCHITECTURE.md` - Singleton components that MUST NOT be duplicated

**Token cost**: ~1,500 tokens total (target, see Token Efficiency Rules below)

**When you need fresh context or phase inference**:
- User can run `/session-init [task description]` to regenerate context with intelligent phase detection
- This is optional - The 3 dev-docs files provide sufficient context for most work

**Important**:
- If PROJECT_SUMMARY.md doesn't exist, the project is new. Proceed with research phase.
- If dev-docs files don't exist, create them from current task state.

## Token Efficiency Rules

The dev-docs pattern must stay token-efficient. **Target: ~1,500 tokens total** for all 3 files.

### File Size Limits

| File | Target | Max Lines | Content Rules |
|------|--------|-----------|---------------|
| `tasks.json` | ~1,000 tokens | 300 lines | 5 completed tasks max, rest archived |
| `PROJECT_SUMMARY.md` | ~350 tokens | 80 lines | Current session (full) + 1 prior (slimmed) |
| `plan.md` | ~150 tokens | 30 lines | Current plan only, no history |

### Automatic Archival

**TaskManager** auto-archives completed tasks when `archival.autoArchive: true` in tasks.json:
- Keeps last 5 completed tasks by completion date
- Archives older tasks to `.claude/dev-docs/archives/tasks-archive.json`
- Removes archived task definitions from active file (keeps IDs only)

**Configuration** (in tasks.json):
```json
"archival": {
  "maxCompleted": 5,
  "autoArchive": true,
  "archivePath": ".claude/dev-docs/archives/tasks-archive.json"
}
```

### PROJECT_SUMMARY.md Format

**Current session** gets full detail:
```markdown
## Session N: Title (CURRENT)
### Work Completed
[table]
### Implementation Details
[full details]
### Files Modified
[table]
```

**Prior session** gets slimmed to 5 lines:
```markdown
## Session N-1: Title ✅
- **Tasks**: task-id-1, task-id-2
- **Key changes**: Brief summary of what changed
- **Files**: file1.js, file2.js
```

### plan.md Format

Current plan only - no session history:
```markdown
# Current Plan
**Phase**: [phase]
**Status**: [status]

## Active Tasks (NOW)
[table]

## Next Steps
[numbered list]
```

### Archive Location

All archives stored in `.claude/dev-docs/archives/`:
- `tasks-archive.json` - Completed tasks with full definitions
- `sessions-archive.md` - Full session details before slimming

### Preventing Drift

If context load exceeds 5,000 tokens:
1. Run `node scripts/archive-completed-tasks.js` to archive old tasks
2. Manually trim PROJECT_SUMMARY.md to 2 sessions
3. Trim plan.md to current plan only

## Architectural Constraints (MUST CHECK BEFORE DESIGNING)

**Reference**: `.claude/ARCHITECTURE.md` contains the full registry of canonical components.

### Singleton Components - NEVER Create Parallels

| Component | Canonical File | Rule |
|-----------|---------------|------|
| Dashboard | `global-context-manager.js` | ALL dashboard features go here (port 3033) |
| Orchestrator | `autonomous-orchestrator.js` | ALL task orchestration goes here |
| Context Tracker | `.claude/core/global-context-tracker.js` | ALL context tracking goes here |
| Database | `.claude/data/memory.db` | ALL MemoryStore consumers use this path |
| Safety/Validation | `.claude/core/swarm-controller.js` | ALL safety checks go here |

### Design Phase Requirement

**BEFORE designing any new component:**
1. Check `.claude/ARCHITECTURE.md` for existing implementations
2. Search codebase for similar functionality
3. If similar exists → **EXTEND** the existing component
4. If truly new → Update ARCHITECTURE.md with justification

### Why This Matters

Without these constraints, parallel implementations get created (as discovered in audit 2025-12-29):
- 3 context trackers instead of 1
- 2 dashboard servers instead of 1
- 2 orchestrators instead of 1
- 4 database paths instead of 1

**Cost**: ~5,500 lines of duplicate code requiring consolidation.

---

## Multi-Agent Multi-Model Strategy

### Core Philosophy
- **Specialized Agents**: Each agent persona brings unique expertise
- **Optimal Models**: Match AI models to task complexity and requirements
- **Collaborative Validation**: Agents review each other's work across models
- **Iterative Improvement**: Continuous refinement through agent feedback loops

## Agent Personas & Model Assignments

### 🔍 Research Phase
**Primary Agent**: Research Analyst (Claude Opus 4.5)
- **Role**: Deep technology research, competitive analysis, requirement gathering
- **Strengths**: Comprehensive analysis, nuanced understanding
- **Secondary Agent**: Trend Analyst (GPT-4o)
- **Role**: Recent developments, alternative perspectives, community insights
- **Handoff**: Research Analyst provides foundation, Trend Analyst adds current context

### 📊 Planning Phase  
**Primary Agent**: Strategic Planner (Claude Opus 4.5)
- **Role**: Project roadmap, resource allocation, timeline estimation
- **Strengths**: Strategic thinking, complex project coordination
- **Validation Agent**: Logic Reviewer (o1-preview)
- **Role**: Plan validation, dependency analysis, edge case identification
- **Handoff**: Planner creates strategy, Logic Reviewer validates feasibility

### 🏗️ Design Phase
**FIRST**: Check `.claude/ARCHITECTURE.md` for existing canonical components before designing anything new.

**Architecture Agent**: System Architect (Claude Opus 4.5)
- **Role**: High-level system design, technology selection, scalability planning
- **Strengths**: Architectural vision, technology assessment
- **CRITICAL**: Before designing new components, verify they don't duplicate existing singletons (dashboard, orchestrator, tracker, database)
- **Implementation Agent**: Technical Designer (Claude Sonnet 4)
- **Role**: Detailed specifications, API contracts, data models
- **Handoff**: Architect provides vision, Designer creates specifications

### 🧪 Testing Phase
**Primary Agent**: Test Engineer (Claude Sonnet 4)
- **Role**: Test implementation, automation, debugging strategies
- **Strengths**: Code generation, test pattern implementation
- **Validation Agent**: Quality Analyst (GPT-4o)
- **Role**: Edge case identification, test completeness review
- **Handoff**: Engineer writes tests, Analyst validates coverage

### ⚡ Implementation Phase
**Core Agent**: Senior Developer (Claude Sonnet 4)
- **Role**: Business logic, algorithms, complex integrations
- **Strengths**: Code generation, debugging, optimization
- **Support Agent**: Code Assistant (Cursor/Copilot)
- **Role**: Boilerplate, UI components, repetitive tasks
- **Handoff**: Developer handles core logic, Assistant supports with scaffolding

### ✅ Validation Phase
**Quality Gate Coordinator**: Review Orchestrator (Claude Opus 4.5)
- **Role**: Cross-agent validation, quality gate enforcement
- **Review Agents**: All previous agents in specialized review capacity
- **Process**: Each agent validates their domain expertise
- **Standards**: Minimum 85/100 quality score to proceed

### 🔄 Iteration Phase
**Strategy Agent**: Innovation Lead (Claude Opus 4.5)
- **Role**: Strategic improvements, architectural changes
- **Execution Agent**: Implementation Specialist (Claude Sonnet 4)
- **Role**: Code improvements, bug fixes, optimizations
- **Cycle**: Strategy guides direction, Specialist executes changes

## Model Selection Rules

### Automatic Model Selection
```bash
# ALL Tasks - Use Opus 4.5 for Everything
if [task_type == "any"]; then
    model = "claude-opus-4-5-20251101"
fi

# Fallback only if Opus 4.5 unavailable
if [opus_unavailable == true]; then
    model = "claude-opus-4-5-20251101"  # Try anyway, it's the best
fi

# No other models needed - Opus 4.5 handles everything
# Previous: Used different models for different tasks
# Now: Opus 4.5 for all scenarios
```

### Cost Optimization Strategy
- **Only Model**: Claude Opus 4.5 for everything (best performance, worth the cost)
- **No Secondary Models**: Opus 4.5 handles all tasks
- **Token Limits**: Generous limits since we're using the best model
- **No Fallback Needed**: Opus 4.5 is always the answer

## Auto-Delegation Rule

When you see a `[Delegation Analysis]` message injected by the hook system, follow these rules:

### When to Auto-Delegate

**Automatically delegate (no confirmation needed) when ALL conditions are met:**
- Decision confidence ≥ 70%
- Task matches a known task from tasks.json
- Suggested pattern is `parallel`, `sequential`, `debate`, or `review`

### How to Auto-Delegate

1. **Parse the hint** to extract task ID, pattern, and subtask count
2. **Use the Task tool** to spawn child agents following the suggested pattern:
   - `parallel`: Launch all subtasks simultaneously with `run_in_background: true`
   - `sequential`: Execute subtasks one at a time, passing results forward
   - `debate`: Spawn PRO and CON agents, then a SYNTH agent to reconcile
   - `review`: Spawn IMPL agent, then REVIEW agent to critique
3. **Track progress** using TodoWrite to show subtask status
4. **Aggregate results** when all child agents complete

### Example Auto-Delegation Response

When you see:
```
[Delegation Analysis]
Matches task: dashboard-blocked-tasks-view (dashboard-blocked-tasks-view)
Decision confidence: 75% | Decomposable into ~4 subtasks | Suggested pattern: parallel
```

Immediately respond with Task tool calls:
```
I'll delegate this task using the parallel pattern with 4 agents.

[Task tool call 1: Backend API for blocked tasks]
[Task tool call 2: Frontend UI component]
[Task tool call 3: Dependency graph visualization]
[Task tool call 4: Integration tests]
```

### When NOT to Auto-Delegate

- Confidence < 70% → Ask user: "Delegation suggested but confidence is low. Proceed?"
- No matched task → Execute directly unless task is clearly complex
- Pattern is `direct` → Execute without delegation
- User used `/direct` → Skip delegation entirely

### Delegation Tracking

All delegations are tracked in the dashboard (port 3033):
- Parent-child hierarchy visible in Fleet Lineage panel
- Real-time progress via SSE updates
- Use `/delegation-status` to check active delegations

---

## Agent Collaboration Protocols

### 1. Handoff Documentation
Every agent transition requires:
- Work completed summary
- Key decisions and rationale  
- Issues identified and resolution status
- Specific recommendations for next agent
- Files modified with brief descriptions

### 2. Cross-Agent Validation
Before proceeding to next phase:
- Primary agent completes work
- Secondary agent reviews for blind spots
- Quality gate agent validates standards
- Documentation agent updates records

### 3. Conflict Resolution
When agents disagree:
- Lead Architect (Opus 4.5) makes final architectural decisions
- Senior Developer (Opus 4.5) makes implementation decisions
- All Agents (Opus 4.5) reach consensus through superior reasoning

### 4. Task Verification Protocol (MANDATORY)
**Before marking ANY task complete, agents MUST:**

1. **Run Tests**: Execute `npm test -- [pattern]` and show actual output
2. **Show Output**: Demonstrate working functionality with real results
3. **Verify Integration**: Confirm components work together in situ

**Forbidden completion patterns:**
- "Tests should pass" (speculative)
- "This will work" (assumption)
- "The API returns..." (hypothetical)

**See `docs/guides/AGENT-VERIFICATION-PROTOCOL.md` for full requirements.**

## Quality Gates & Standards

### Research Phase Gate
- Comprehensive technology analysis ✓
- Risk assessment completed ✓
- Resource requirements identified ✓
- Alternative approaches evaluated ✓
- Score: ≥ 80/100 to proceed

### Planning Phase Gate  
- Timeline and milestones defined ✓
- Dependencies mapped ✓
- Logic validation passed ✓
- Resource allocation confirmed ✓
- Score: ≥ 85/100 to proceed

### Design Phase Gate
- **ARCHITECTURE.md checked** - No duplicate components ✓
- Architecture approved by Architect Agent ✓
- Implementation details validated ✓
- Security considerations addressed ✓
- Testability confirmed ✓
- Score: ≥ 85/100 to proceed

### Implementation Phase Gate
- All tests passing ✓
- Code quality standards met ✓
- Security review completed ✓
- Documentation updated ✓
- Score: ≥ 90/100 to proceed

## Development Commands & Environment

### Model Environment Variables
```bash
# ALL Models - Use Opus 4.5 for Everything
RESEARCH_MODEL=claude-opus-4-5-20251101
PLANNING_MODEL=claude-opus-4-5-20251101
DESIGN_ARCHITECTURE_MODEL=claude-opus-4-5-20251101
DESIGN_IMPLEMENTATION_MODEL=claude-opus-4-5-20251101
TESTING_MODEL=claude-opus-4-5-20251101
IMPLEMENTATION_MODEL=claude-opus-4-5-20251101
VALIDATION_MODEL=claude-opus-4-5-20251101
ITERATION_STRATEGY_MODEL=claude-opus-4-5-20251101
ITERATION_EXECUTION_MODEL=claude-opus-4-5-20251101

# Secondary Models - Also Opus 4.5
RESEARCH_SECONDARY_MODEL=claude-opus-4-5-20251101
PLANNING_VALIDATION_MODEL=claude-opus-4-5-20251101
TESTING_EDGE_CASE_MODEL=claude-opus-4-5-20251101

# Token Limits
MAX_TOKENS_RESEARCH=8000
MAX_TOKENS_PLANNING=6000
MAX_TOKENS_DESIGN=4000
MAX_TOKENS_IMPLEMENTATION=3000
MAX_TOKENS_TESTING=2000
```

### Important Project Commands
- Build: `npm run build` or `make build`
- Test: `npm test` or `pytest`
- Lint: `npm run lint` or `flake8`
- Deploy: `npm run deploy` or `./deploy.sh`

### Agent Communication Patterns
- Start each phase with `/clear` to avoid token contamination
- Use agent-specific prompts for role clarity
- Document agent decisions for handoff continuity
- Validate work through cross-agent review

## Workflow Integration Points

### IDE Integration
- VS Code with Claude Code extension for primary development
- Cursor for rapid coding and boilerplate generation
- Multiple terminal windows for parallel agent workflows

### Version Control Integration  
- Git branches for parallel agent work using worktrees
- Structured commit messages identifying agent and phase
- Pull request templates requiring multi-agent sign-off

### CI/CD Integration
- Automated testing triggered by agent implementations
- Quality gate enforcement in pipeline
- Multi-model validation in staging environment

## Emergency Protocols

### Model Unavailability
1. **Opus 4.5 Unavailable**: Fall back to Sonnet 4 for research, extend analysis phase
2. **Sonnet 4 Unavailable**: Use GPT-4o for implementation, increase review cycles
3. **External Models Unavailable**: Continue with Claude models only, document limitations

### Agent Conflicts
1. **Technical Conflicts**: Lead Architect (Opus 4.5) makes binding decisions
2. **Timeline Conflicts**: Prioritize critical path, defer non-essential features
3. **Quality Conflicts**: Never compromise below minimum quality gates

### Quality Gate Failures
1. **Research Gate Failure**: Extend research phase, bring in additional models
2. **Design Gate Failure**: Redesign with simplified architecture
3. **Implementation Gate Failure**: Refactor with Test Engineer and Quality Analyst

Remember: This system prioritizes quality and thorough analysis over speed. Each phase builds upon validated work from previous phases.