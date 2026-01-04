---
description: Force delegation for any prompt - spawn child agents with pattern control
---

# /delegate Command

Force delegation of a task to child agents with explicit control over execution pattern, depth, and resources.

## Syntax

```
/delegate [options] <task description or task-id>
```

## Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--pattern=<type>` | `-p` | Force execution pattern: `parallel`, `sequential`, `debate`, `review` | auto-detected |
| `--depth=<n>` | `-d` | Set max delegation depth (1-3) | from config |
| `--agents=<n>` | `-a` | Set max concurrent agents (1-10) | from config |
| `--budget=<tokens>` | `-b` | Set token budget | from config |
| `--dry-run` | | Show delegation plan without executing | false |
| `--force` | `-f` | Skip delegatability check, force delegation | false |

## Examples

```bash
# Basic delegation with auto-detection
/delegate Implement user authentication

# Force parallel execution pattern
/delegate --pattern=parallel Build the test suite

# Force debate pattern for design decisions
/delegate --pattern=debate Design API architecture

# Delegate an existing task by ID
/delegate auto-delegation-phase4-execution

# Preview without executing
/delegate --dry-run Build comprehensive documentation
```

## Execution Instructions

When this skill is invoked, follow these steps:

### Step 1: Get Execution Plan

Run the delegation executor to analyze the task and generate a plan:

```bash
node .claude/core/delegation-executor.js $ARGUMENTS
```

The executor will output either:
- A **dry-run plan** (if `--dry-run` was specified)
- An **execution plan** with Task tool invocations
- An **error/warning** if delegation is not recommended

### Step 2: Handle Executor Output

**If dry-run**: Display the plan to the user and stop.

**If error/warning**: Display the message. If the user wants to proceed, re-run with `--force`.

**If execution plan**: Proceed to Step 3.

### Step 3: Execute Task Tool Invocations

The executor outputs Task tool invocations in JSON format. Execute them according to the pattern:

#### For Parallel Pattern

Spawn all agents simultaneously using multiple Task tool calls in a single message.
Each Task should have `run_in_background: true` so they execute concurrently.

Example Task parameters:
```json
{
  "description": "[PARALLEL 1/3] First subtask title",
  "prompt": "Full subtask description and context...",
  "subagent_type": "general-purpose",
  "run_in_background": true
}
```

#### For Sequential Pattern

Execute each Task one at a time, waiting for completion before the next:
```json
{
  "description": "[SEQ 1/3] First step",
  "prompt": "Step 1 description...",
  "subagent_type": "general-purpose",
  "run_in_background": false
}
```

Pass results from each step to subsequent steps.

#### For Debate Pattern

Spawn three agents:
1. **[PRO]** Advocate - argues for the best approach
2. **[CON]** Critic - identifies potential issues
3. **[SYNTH]** Synthesizer - combines perspectives (runs after PRO and CON complete)

#### For Review Pattern

Spawn two agents sequentially:
1. **[IMPL]** Implementer - creates initial solution
2. **[REVIEW]** Reviewer - critiques and suggests improvements

### Step 4: Aggregate Results

After all agents complete, use TaskOutput to collect results and present a summary:

```markdown
## Delegation Complete

**Task**: <task title>
**Pattern**: <pattern used>
**Agents**: <count>

### Results Summary
<aggregated output from all agents>
```

## Configuration

Settings in `.claude/delegation-config.json`:

```json
{
  "enabled": true,
  "minComplexityThreshold": 35,
  "minSubtaskCount": 3,
  "cacheEnabled": true,
  "useTaskDecomposer": true
}
```

## Error Handling

### Delegation Not Recommended
```
Warning: Delegation not recommended (confidence: 25%)
Reason: Task appears simple
Use --force to delegate anyway
```

### Task Not Found
```
Error: Task 'unknown-id' not found in tasks.json
Hint: Use a task description instead
```

## Integration Architecture

```
/delegate skill
    |
    v
delegation-executor.js
    |-- parseArguments()
    |-- resolveTask() --> tasks.json
    |-- getDelegationDecision() --> delegation-bridge.js
    |-- getSubtasks() --> task-decomposer.js
    |
    v
Task tool invocations
    |
    v
Child agents execute subtasks
    |
    v
Results aggregated and reported
```

## Related Commands

- `/direct` - Force direct execution (opposite of delegate)
- `/delegation-status` - View active delegations
- `/delegation-config` - Modify delegation settings
