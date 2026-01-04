---
description: Show active delegations, history, and get delegation hints
---

# Delegation Status Command

Display status of the auto-delegation system, including active delegations, decision history, and task analysis.

## Syntax

```
/delegation-status                      # Full status dashboard
/delegation-status history [--limit=N]  # View delegation history
/delegation-status hint <task>          # Analyze task without executing
/delegation-status cache                # Show cache statistics
```

## Default Output (No Arguments)

Show full delegation status dashboard:

```markdown
## Delegation Status Dashboard

### Configuration
| Setting | Value |
|---------|-------|
| Enabled | Yes |
| Mode | Supervised |
| Threshold | 35 |
| Cache | Enabled (60s TTL) |

### Active Delegations
| ID | Task | Pattern | Progress | Started |
|----|------|---------|----------|---------|
| del-001 | Implement auth | sequential | 3/5 | 2m ago |

(No active delegations)

### Recent Decisions
| Task | Delegate? | Confidence | Pattern |
|------|-----------|------------|---------|
| "Implement OAuth" | Yes | 82% | sequential |
| "Fix typo" | No | 15% | - |

### Cache Stats
- Cached: 5 decisions
- TTL: 60 seconds
```

## Subcommand: history

View delegation decision history.

```
/delegation-status history           # Last 10 entries
/delegation-status history --limit=20  # Last 20 entries
```

Output:
```markdown
## Delegation History

| Time | Task | Decision | Pattern | Duration |
|------|------|----------|---------|----------|
| 5m ago | Implement auth | Delegated | sequential | 8m |
| 15m ago | Fix bug | Direct | - | 2m |

Summary: 12 delegations, 8 completed (67%)
```

## Subcommand: hint

Analyze a task for delegation without executing:

```
/delegation-status hint "implement user authentication"
```

Output:
```markdown
## Delegation Hint

**Task**: "implement user authentication"

### Analysis
| Metric | Value |
|--------|-------|
| Should Delegate | Yes |
| Confidence | 82% |
| Pattern | sequential |
| Subtasks | 4 |

### Reasoning
Task contains complex operations. Matches backend specialist domain.
Identified 4 potential subtasks.

### Suggested Breakdown
1. Design auth schema
2. Implement backend logic
3. Add frontend components
4. Write tests

To execute: /delegate "implement user authentication"
```

## Subcommand: cache

Show decision cache statistics:

```
/delegation-status cache
```

Output:
```markdown
## Decision Cache

| Metric | Value |
|--------|-------|
| Entries | 5 |
| Valid | 3 |
| Expired | 2 |
| TTL | 60s |

Cache auto-clears on threshold changes.
```

## Implementation

Uses DelegationBridge API:

```javascript
const {
  getQuickHint,
  getCacheStats,
  loadConfig
} = require('.claude/core/delegation-bridge.js');

// Get hint
const hint = getQuickHint(taskDescription);

// Get cache stats
const stats = getCacheStats();

// Get config
const config = loadConfig();
```

## Error Handling

### Missing Task for Hint
```
Error: Please provide a task description.
Usage: /delegation-status hint "<task>"
```

### No History
```
No delegation history found.
Start with: /delegation-status hint "<task>"
```

## Related Commands

- `/delegate` - Force delegation
- `/direct` - Force direct execution
- `/delegation-config` - Modify settings
