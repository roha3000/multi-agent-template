---
description: Force direct execution (skip delegation)
---

# Direct Execution Command

## Purpose

Force the current agent to execute a task directly, bypassing the auto-delegation system. Use this when you want to handle a task yourself regardless of its complexity score.

## Usage

```
/direct <task description or task-id>
```

## Examples

```
/direct Fix the typo in README.md
/direct task-auth-001
/direct Implement entire authentication system
/direct Refactor the database layer to use connection pooling
```

## Behavior

When this command is invoked:

### 1. Parse Arguments

Extract the task from the command arguments:
- If argument matches pattern `task-*` or exists in `tasks.json`, treat as task-id
- Otherwise, treat the entire argument string as a task description

### 2. Set Direct Execution Flag

Create or update the session state file to signal direct execution mode:

```bash
# Create/update the direct execution flag
echo '{"directExecution": true, "task": "<task>", "timestamp": "<ISO-timestamp>", "reason": "user-requested"}' > .claude/state/direct-execution.json
```

### 3. Skip Delegation Analysis

When the delegation hook (`.claude/hooks/delegation-hook.js`) runs, it should check for this flag:
- If `.claude/state/direct-execution.json` exists and `directExecution: true`, skip complexity analysis
- Clear the flag after processing to prevent affecting subsequent prompts

### 4. Execute Task Directly

Proceed with the task execution using the current agent's capabilities:
- Do NOT spawn sub-agents via `claude --print` or Task.create()
- Do NOT run complexity scoring
- Handle all aspects of the task in the current session

### 5. Log the Override

Append to the delegation audit log for tracking:

```bash
# Log the direct execution override
echo "[$(date -Iseconds)] DIRECT_EXECUTION: <task> (user-requested skip)" >> .claude/logs/delegation-audit.log
```

## Implementation Steps

When you receive `/direct <args>`:

1. **Acknowledge the override**:
   ```
   Direct execution mode enabled. Skipping delegation analysis.
   Task: <parsed task>
   ```

2. **Create the state flag**:
   ```javascript
   // .claude/state/direct-execution.json
   {
     "directExecution": true,
     "task": "<task description or id>",
     "timestamp": "2025-01-03T...",
     "reason": "user-requested",
     "originalComplexity": null  // Not calculated due to skip
   }
   ```

3. **Ensure state directory exists**:
   ```bash
   mkdir -p .claude/state
   mkdir -p .claude/logs
   ```

4. **Log the action**:
   ```bash
   echo "[timestamp] DIRECT_EXECUTION_REQUESTED: task='<task>'" >> .claude/logs/delegation-audit.log
   ```

5. **Execute the task** immediately after setup, using full agent capabilities

6. **Clean up** after task completion:
   ```bash
   rm -f .claude/state/direct-execution.json
   ```

## When to Use

**Good use cases:**
- Quick fixes that don't warrant delegation overhead
- Tasks where you have specific context the orchestrator lacks
- Debugging delegation behavior by comparing direct vs delegated execution
- Time-sensitive tasks where delegation latency is unacceptable
- Tasks requiring interactive user clarification throughout

**Consider delegation instead when:**
- Task has multiple independent sub-components
- Task spans multiple specialist domains (frontend + backend + testing)
- Task complexity score would be HIGH and benefits from parallel execution

## Integration with Delegation Hook

The delegation hook at `.claude/hooks/delegation-hook.js` should include this check early:

```javascript
// Check for direct execution override
const directExecPath = '.claude/state/direct-execution.json';
if (fs.existsSync(directExecPath)) {
  const state = JSON.parse(fs.readFileSync(directExecPath, 'utf8'));
  if (state.directExecution) {
    console.log('[Delegation] Skipped - direct execution requested');
    // Clear the flag
    fs.unlinkSync(directExecPath);
    return; // Skip all delegation logic
  }
}
```

## Session State Schema

```json
{
  "directExecution": true,
  "task": "string - task description or task-id",
  "timestamp": "ISO-8601 timestamp",
  "reason": "user-requested | emergency | debug",
  "originalComplexity": null,
  "agentId": "current agent identifier if available"
}
```

## Audit Log Format

Each direct execution creates a log entry:

```
[2025-01-03T10:30:00Z] DIRECT_EXECUTION_REQUESTED: task='Fix typo in README.md' agent='backend-specialist' reason='user-requested'
[2025-01-03T10:30:05Z] DIRECT_EXECUTION_COMPLETED: task='Fix typo in README.md' duration='5s' status='success'
```

## Error Handling

If the task fails during direct execution:
- Log the failure with full error details
- Do NOT auto-retry with delegation (user explicitly chose direct)
- Report the failure and ask user if they want to try with delegation

```
Direct execution failed: <error>
Would you like to retry with auto-delegation enabled? (This may spawn specialist agents)
```
