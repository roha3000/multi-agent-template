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

### Step 1: Analyze the Task

Read the task description and determine:
- How many independent subtasks exist
- Which pattern is most appropriate
- Whether delegation adds value (if `--dry-run`, show the plan and stop)

**If dry-run**: Display the plan to the user and stop.

**If `--force` is not set and task seems simple**: Display a warning and ask user to confirm or use `--force`.

### Step 2: Choose a Pattern and Spawn Agents

Use the native Agent tool to spawn subagents directly according to the chosen pattern:

#### For Parallel Pattern

Spawn all agents simultaneously using multiple Agent tool calls in a single message.

Example Agent parameters:
```
description: "[PARALLEL 1/3] First subtask title"
prompt: "Full subtask description and context..."
```

#### For Sequential Pattern

Execute each Agent one at a time, waiting for completion before the next:
```
description: "[SEQ 1/3] First step"
prompt: "Step 1 description..."
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

### Step 3: Aggregate Results

After all agents complete, present a summary:

```markdown
## Delegation Complete

**Task**: <task title>
**Pattern**: <pattern used>
**Agents**: <count>

### Results Summary
<aggregated output from all agents>
```

## Error Handling

### Delegation Not Recommended
```
Warning: Task appears simple — delegation may add overhead.
Use --force to delegate anyway.
```

### Task Not Found
```
Error: Task 'unknown-id' not found in tasks.json
Hint: Use a task description instead
```

## Related Commands

- `/direct` - Force direct execution (opposite of delegate)
