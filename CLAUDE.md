# CLAUDE.md — Multi-Agent Development System

**Read this file at the start of every session.**

## Project Overview
Multi-agent development system that combines specialized AI agent personas with strategic model selection for optimal development workflows.

## Session Initialization (Read This First!)

**At the start of every session**, automatically load project context by reading these files:

```
1. PROJECT_SUMMARY.md           # High-level project state and context
2. .claude/dev-docs/plan.md     # Current task breakdown and implementation plan
3. .claude/dev-docs/tasks.json  # Structured task data with dependencies and status
```

**Why these files?** This is the **Dev-Docs Pattern** that prevents context drift:
- `PROJECT_SUMMARY.md` - What we've built (project history, architecture, quality scores)
- `plan.md` - What we're building (current task breakdown, implementation steps)
- `tasks.json` - Structured tasks with backlog tiers, dependencies, and status tracking

**Token cost**: ~1,500 tokens total (target, see Token Efficiency Rules below)

**No scripts required.** Run `/session-init` to detect phase and load context from dev-docs files.

**Important**:
- If PROJECT_SUMMARY.md doesn't exist, the project is new. Proceed with research phase.
- If dev-docs files don't exist, create them from current task state.

## Worktrees + Dev-Docs: Parallel Development

Git worktrees and the dev-docs pattern solve different problems and work best together.

| | Git Worktrees | Dev-Docs |
|---|---|---|
| **Solves** | Parallel filesystem isolation — multiple branches active simultaneously | Session context continuity — Claude knows what was done last session |
| **Scope** | Per-branch | Per-session |

**How to combine them:**
- `PROJECT_SUMMARY.md` lives at the repo root — overall project history, referenced by all branches
- Each worktree has its own `.claude/dev-docs/plan.md` + `tasks.json` tracking that branch's specific work
- Separate Claude sessions per worktree = zero context contamination between parallel features
- Before merging a feature branch, run `/codex:review --base main` for a targeted branch diff review

**Use worktrees when:**
- Building 2+ independent features simultaneously
- Isolating a risky refactor from main until it's validated
- Running Codex investigation in one worktree while continuing work in another

See `/worktree` for the full workflow with setup commands.

## Token Efficiency Rules

The dev-docs pattern must stay token-efficient. **Target: ~1,500 tokens total** for all 3 files.

### File Size Limits

| File | Target | Max Lines | Content Rules |
|------|--------|-----------|---------------|
| `tasks.json` | ~1,000 tokens | 300 lines | 5 completed tasks max, rest archived |
| `PROJECT_SUMMARY.md` | ~350 tokens | 80 lines | Current session (full) + 1 prior (slimmed) |
| `plan.md` | ~150 tokens | 30 lines | Current plan only, no history |

### Archival

Archive tasks manually: move completed tasks out of `tasks.json` to keep it under the token target. Completed tasks can be deleted or summarized inline — there is no automated archival layer.

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

### Preventing Drift

If context load exceeds 5,000 tokens:
1. Manually trim PROJECT_SUMMARY.md to 2 sessions
2. Trim plan.md to current plan only
3. Remove old completed tasks from tasks.json

## Multi-Agent Multi-Model Strategy

### Core Philosophy
- **Specialized Agents**: Each agent persona brings unique expertise
- **Optimal Models**: Match AI models to task complexity and requirements
- **Collaborative Validation**: Agents review each other's work across models
- **Iterative Improvement**: Continuous refinement through agent feedback loops

## Agent Personas & Model Assignments

### 🔍 Research Phase
**Agent**: Research Analyst — see `.claude/agents/research/research-analyst.md`
- Deep technology research, competitive analysis, requirement gathering

### 📊 Planning Phase
**Agent**: Strategic Planner — see `.claude/agents/planning/strategic-planner.md`
- Project roadmap, resource allocation, timeline estimation
- **Validation**: Logic Reviewer — see `.claude/agents/planning/logic-reviewer.md`

### 🏗️ Design Phase
**Agent**: System Architect — see `.claude/agents/design/system-architect.md`
- High-level system design, technology selection
- **Detail**: Technical Designer — see `.claude/agents/design/technical-designer.md`

### 🧪 Testing Phase
**Agent**: Test Engineer — see `.claude/agents/testing/test-engineer.md`
- Write tests first (TDD), then hand off to implementation

### ⚡ Implementation Phase
**Agent**: Senior Developer — see `.claude/agents/development/senior-developer.md`
- Business logic, algorithms, complex integrations

### ✅ Validation Phase
**Agent**: Review Orchestrator — see `.claude/agents/validation/review-orchestrator.md`
- Cross-agent validation, quality gate enforcement
- Minimum 85/100 quality score + Codex clean to proceed

### 🔄 Iteration Phase
**Agent**: Innovation Lead — see `.claude/agents/iteration/innovation-lead.md`
- Strategic improvements, refactoring, optimizations

All agents are invoked via the native Claude Code Agent tool. Persona definitions live in `.claude/agents/`.

## Model Selection Rules

Use Claude for all phases. Specialist agents are defined in `.claude/agents/` and invoked via the native Agent tool.

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

## Claude + Codex Division of Labor

This project uses both Claude Code and Codex for quality assurance:

| Tool | Strengths | When to Use |
|------|-----------|-------------|
| **Claude** | Architecture, context-aware reasoning, cross-file refactoring, multi-step planning | Design, implementation, complex debugging, planning |
| **Codex** | Static analysis, security patterns, style enforcement, dependency audit | Code review, pre-merge checks, security audits |

### Workflow Integration

- After implementation: `/codex-review` to catch common issues
- Before production: `/codex-adversarial` for security-sensitive features
- Quality gate: Codex clean + Claude quality score ≥ 90/100 = ship-ready

See `WORKFLOW.md` for the complete cheat sheet and four workflow modes.

## Development Commands

Adapt these to your project's actual build system:
- Build: `npm run build` or `make build`
- Test: `npm test` or `pytest`
- Lint: `npm run lint`
- Deploy: `npm run deploy`

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

Remember: This system prioritizes quality and thorough analysis over speed. Each phase builds upon validated work from previous phases.