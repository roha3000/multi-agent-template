---
description: Force direct execution (skip delegation)
---

# Direct Execution Command

## Purpose

Force the current agent to execute a task directly, without spawning subagents. Use this when you want to handle a task yourself regardless of its complexity.

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

### 2. Acknowledge the Override

```
Direct execution mode enabled. Skipping delegation.
Task: <parsed task>
```

### 3. Execute Task Directly

Proceed with the task using the current agent's capabilities:
- Do NOT spawn subagents via the Agent tool
- Do NOT run complexity scoring or delegation analysis
- Handle all aspects of the task in the current session

### 4. Report Completion

After completing the task, summarize what was done.

## When to Use

**Good use cases:**
- Quick fixes that don't warrant delegation overhead
- Tasks where you have specific context that subagents would lack
- Debugging delegation behavior by comparing direct vs delegated execution
- Time-sensitive tasks where delegation latency is unacceptable
- Tasks requiring interactive user clarification throughout

**Consider delegation instead when:**
- Task has multiple independent sub-components
- Task spans multiple specialist domains (frontend + backend + testing)
- Task benefits from parallel execution

## Error Handling

If the task fails during direct execution:
- Report the failure with full error details
- Do NOT auto-retry with delegation (user explicitly chose direct)
- Ask user if they want to try with delegation instead

```
Direct execution failed: <error>
Would you like to retry with delegation? (This may spawn specialist agents)
```
