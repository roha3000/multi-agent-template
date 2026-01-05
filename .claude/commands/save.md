# Save Session State

Update dev-docs, commit all changes, and push to remote.

## Instructions

1. **Update PROJECT_SUMMARY.md**:
   - Update the session number and date
   - Add a summary of work completed this session
   - Slim previous session to 3 bullet points
   - Update test counts and project health

2. **Update .claude/dev-docs/plan.md**:
   - Update status to reflect current state
   - Add session summary table with completed tasks
   - Keep NOW/NEXT queues current

3. **Stage all changes**:
   ```bash
   git add .
   ```

4. **Create commit** with format:
   ```
   [TYPE] Brief description of main change

   - Bullet points for key changes
   - Include test counts if tests were added

   🤖 Generated with [Claude Code](https://claude.com/claude-code)

   Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
   ```

   TYPE options: FIX, FEAT, DOCS, REFACTOR, TEST, CHORE

5. **Push to remote**:
   ```bash
   git push
   ```

6. **Report** the commit hash and summary of what was saved.

## Optional Argument

If a commit message is provided as $ARGUMENTS, use it as the commit description instead of generating one.
