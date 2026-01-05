---
description: Update dev-docs, archive old content, commit and push
---

# Save Session State

Update dev-docs, archive old content, commit all changes, and push to remote.

## Instructions

### Step 1: Archive Old Sessions (if needed)

Check PROJECT_SUMMARY.md - if there are more than 2 detailed sessions:

1. **Move sessions older than 2** to `.claude/dev-docs/archives/sessions-archive.md`
   - Copy the full session details (tables, implementation details, files modified)
   - Add `**Archived**: YYYY-MM-DD` header
   - Keep chronological order (newest at top)

2. **Slim the moved sessions** in PROJECT_SUMMARY.md to 3 bullet points:
   ```markdown
   ## Session N: Title ✅
   - **Tasks**: task-id-1, task-id-2
   - **Key changes**: Brief summary
   - **Files**: file1.js, file2.js
   ```

### Step 2: Archive Completed Tasks (if needed)

Check `.claude/dev-docs/tasks.json` - if there are more than 5 completed tasks:

1. **Move older completed tasks** to `.claude/dev-docs/archives/tasks-archive.json`
2. **Keep only 5 most recent** completed tasks in active file
3. Preserve task definitions in archive (full details)

### Step 3: Update PROJECT_SUMMARY.md

- Update session number and date
- Add summary of work completed this session
- Update test counts and project health
- Update NOW/NEXT queues

### Step 4: Update .claude/dev-docs/plan.md

- Update status to reflect current state
- Add session summary table with completed tasks
- Keep NOW/NEXT queues current
- Remove old session summaries (keep only current)

### Step 5: Commit and Push

1. **Stage all changes**:
   ```bash
   git add .
   ```

2. **Create commit** with format:
   ```
   [TYPE] Brief description of main change

   - Bullet points for key changes
   - Include test counts if tests were added

   🤖 Generated with [Claude Code](https://claude.com/claude-code)

   Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
   ```

   TYPE options: FIX, FEAT, DOCS, REFACTOR, TEST, CHORE

3. **Push to remote**:
   ```bash
   git push
   ```

4. **Report** the commit hash and summary of what was saved/archived.

## Token Budget Targets

| File | Target | Max |
|------|--------|-----|
| PROJECT_SUMMARY.md | ~350 tokens | 80 lines |
| plan.md | ~150 tokens | 30 lines |
| tasks.json | ~1,000 tokens | 300 lines |

## Optional Argument

If a commit message is provided as $ARGUMENTS, use it as the commit description instead of generating one.
