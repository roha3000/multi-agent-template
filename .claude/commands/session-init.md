---
description: Initialize session with intelligent phase detection and context loading
---

# Session Initialization

Load project context and detect the appropriate development phase.

## Usage

```
/session-init [optional: task description]
```

## Examples

```
/session-init Implement user authentication
/session-init Plan the next sprint
/session-init Research database options
/session-init
```

## What This Does

1. Reads the three dev-docs files to load current project context
2. Detects the appropriate phase based on the task description (if provided)
3. Summarizes active tasks, current plan, and recommended next actions

## Steps

1. Read `PROJECT_SUMMARY.md` — project history and current state
2. Read `.claude/dev-docs/plan.md` — current task breakdown
3. Read `.claude/dev-docs/tasks.json` — structured task data

Then provide a phase summary:
- **Target Phase**: Recommended phase (research/planning/design/implementation/testing/validation/iteration)
- **Active Tasks**: What's in progress
- **Next Actions**: Concrete next steps

## When to Use

Use `/session-init` when:
- Starting work on a new task that might need a different phase
- You want explicit phase inference and reasoning
- Beginning a major new feature or refactoring

Skip `/session-init` when:
- Continuing work in current phase
- PROJECT_SUMMARY.md already has what you need
- Making small incremental changes

## Phase Detection

The system uses keyword analysis to detect phases:

| Keywords | Detected Phase |
|----------|----------------|
| research, analyze, investigate, evaluate | research |
| plan, roadmap, timeline, estimate | planning |
| design, architecture, schema, api | design |
| implement, code, build, develop | implementation |
| test, verify, validate, coverage | testing |
| review, quality gate, approve | validation |
| improve, refactor, optimize, fix | iteration |

### Transition Validation

Before recommending a phase change, check:
- Is the transition valid? (forward requires quality gate pass)
- Are quality gates met for current phase?
- Are there blockers preventing transition?

If transition is invalid, warn:
```
Cannot proceed to testing. Current quality: 75/100.
Required: 90/100

Complete these tasks first:
- All tests must pass
- Security review needed
```

---

**Pro tip**: You rarely need to run `/session-init` manually. PROJECT_SUMMARY.md (auto-loaded at session start) provides sufficient context for most work. Use `/session-init` when starting significant new tasks or when you want explicit phase guidance.
