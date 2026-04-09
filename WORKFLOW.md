# WORKFLOW.md — Claude + Codex Cheat Sheet

## The Four Modes

### Mode 1: Build
Standard development from research to implementation.

```
/research-phase "what to research"
/planning-phase
/design-phase
/test-first-phase
/implement-phase
/quality-gate
/save
```

Use `/delegate --pattern=parallel` when a task has 3+ independent subtasks.

---

### Mode 2: Review
Post-implementation quality check.

```
/codex-review          # Codex static analysis + Claude triage
/quality-gate          # Claude quality scoring
/save                  # Update dev-docs, commit
```

Run before every PR merge.

---

### Mode 3: Adversarial
Pre-production security review.

```
/codex-adversarial [target]    # Surface scan + attacker/defender agents
/quality-gate --phase=validation
/save
```

Run before auth, payments, or data access features ship.

---

### Mode 4: Parallel Delegation
Decompose a large task across specialist subagents.

```
/delegate --pattern=parallel "Build the feature"
/quality-gate
/save
```

Patterns: `parallel`, `sequential`, `debate`, `review`

---

## Claude + Codex Division of Labor

| Tool | Use for |
|------|--------|
| **Claude** | Architecture, planning, multi-file refactors, complex debugging |
| **Codex** | Code review, security scanning, adversarial testing |

---

## Dev-Docs Pattern

Three files maintain context across sessions:

| File | Purpose | Target size |
|------|---------|------------|
| `PROJECT_SUMMARY.md` | What was built, project history | ~350 tokens |
| `.claude/dev-docs/plan.md` | Current tasks and next steps | ~150 tokens |
| `.claude/dev-docs/tasks.json` | Structured task data | ~1,000 tokens |

Run `/save` at end of each session to update dev-docs and commit.

---

## Quality Gate Thresholds

| Phase | Minimum Score |
|-------|--------------|
| Research | 80/100 |
| Planning | 85/100 |
| Design | 85/100 |
| Testing | 90/100 |
| Implementation | 90/100 |
| Validation | 90/100 + Codex clean |

---

## Key Commands

| Command | Purpose |
|---------|---------|
| `/session-init` | Load context, detect current phase |
| `/research-phase` | Start research with specialist agents |
| `/planning-phase` | Strategic planning |
| `/design-phase` | Architecture and technical design |
| `/implement-phase` | Implementation with senior dev agent |
| `/test-first-phase` | TDD test writing |
| `/quality-gate` | Score phase quality |
| `/delegate` | Spawn parallel specialist subagents |
| `/direct` | Execute without agent delegation |
| `/codex-review` | Post-implementation Codex review |
| `/codex-adversarial` | Security red-team review |
| `/audit` | Full codebase audit (6 parallel agents) |
| `/save` | Update dev-docs and commit |
| `/agent-handoff` | Document handoff between agents |
