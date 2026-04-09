---
description: Create and manage git worktrees for parallel feature development with isolated dev-docs
---

# Worktree — Parallel Development

Combine git worktrees with the dev-docs pattern for true parallel development: multiple features in progress simultaneously, each with its own isolated filesystem, branch, and Claude context.

## When to Use

- Building 2+ independent features at the same time
- Risky refactor that shouldn't touch main until complete
- Running a Codex rescue investigation while continuing feature work
- A/B implementation: build two approaches, compare, keep the best

## How It Works

```
main worktree          feature-a worktree       feature-b worktree
──────────────         ──────────────────       ──────────────────
PROJECT_SUMMARY.md     plan.md (feature-a)      plan.md (feature-b)
(overall project)      tasks.json               tasks.json
                       (this branch only)       (this branch only)
```

- `PROJECT_SUMMARY.md` lives at the repo root and tracks overall project state
- Each worktree has its own `.claude/dev-docs/plan.md` and `tasks.json` tracking that branch's specific work
- Claude uses `EnterWorktree`/`ExitWorktree` to switch between them natively

## Step 1: Create a Worktree

```bash
# Create worktree for a new feature branch
git worktree add ../my-project-feature-a -b feature/feature-a

# Create worktree from an existing branch
git worktree add ../my-project-hotfix hotfix/critical-fix

# List active worktrees
git worktree list
```

## Step 2: Initialize Dev-Docs in the New Worktree

In the new worktree directory, create branch-specific context:

```bash
# plan.md — what this branch is doing
cat > .claude/dev-docs/plan.md << 'EOF'
# Current Plan
**Phase**: implementation
**Branch**: feature/feature-a
**Status**: in progress

## Active Tasks (NOW)
- [ ] Task description

## Next Steps
1. First step
EOF

# tasks.json — tasks specific to this branch
```

Or simply run `/session-init "feature description"` after entering the worktree — Claude will create the dev-docs from scratch.

## Step 3: Work in Parallel

**Option A — Switch between worktrees in one session:**
Use Claude's native `EnterWorktree` and `ExitWorktree` tools to move between branches without leaving your session.

**Option B — Separate Claude sessions per worktree:**
Open a new Claude Code session in each worktree directory. Each session has its own context from that worktree's dev-docs.

**Option C — Background Codex in one, Claude in another:**
```bash
# In worktree A, kick off Codex in background
/codex:rescue --background "investigate the failing integration tests"

# Switch to main worktree, keep building
# Check Codex results later: /codex:result
```

## Step 4: Codex Branch Review Before Merge

When a feature branch is ready:

```bash
# Review everything added in this branch vs main
/codex:review --base main

# Or adversarial review for security-sensitive branches
/codex:adversarial-review --base main
```

This is more targeted than reviewing uncommitted changes — it shows the full diff of everything that will merge.

## Step 5: Merge and Clean Up

```bash
# From main worktree
git merge --no-ff feature/feature-a

# Remove the worktree
git worktree remove ../my-project-feature-a

# Delete the branch if done
git branch -d feature/feature-a
```

Update `PROJECT_SUMMARY.md` to record the merged feature, then run `/save`.

## Dev-Docs Strategy by Worktree

| Worktree | PROJECT_SUMMARY.md | plan.md | tasks.json |
|----------|-------------------|---------|-----------|
| main | ✅ Lives here — overall project history | Current main branch work | Main branch tasks |
| feature/x | ❌ Read from main (symlink or ignore) | ✅ Feature-specific plan | ✅ Feature tasks only |
| hotfix/y | ❌ Read from main | ✅ Hotfix scope | ✅ Hotfix tasks |

**Tip:** Keep `PROJECT_SUMMARY.md` only in the main worktree. Feature worktrees use their own `plan.md` + `tasks.json` and read the main summary for overall context when needed.

## Parallel Pattern: Two Agents, Two Worktrees

For maximum parallelism on a large feature set:

1. Create two worktrees: `feature-a` and `feature-b`
2. Open Claude Code in each (separate sessions or use `EnterWorktree`)
3. Each Claude session reads its own dev-docs — zero context contamination
4. When both complete: Codex reviews each branch, then merge in sequence
5. Update `PROJECT_SUMMARY.md` once, capturing both features

## Cleanup Reminder

Worktrees accumulate. Run periodically:
```bash
git worktree list          # See all worktrees
git worktree prune         # Remove stale refs for deleted worktrees
```
