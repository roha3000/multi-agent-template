# Auto-Delegation UX Design

**Created**: 2025-12-29
**Status**: Draft
**Author**: UX/Developer Experience Expert

---

## Executive Summary

This document defines the user experience flow for automatic task delegation. The design prioritizes:
1. **Transparency**: Users always understand why delegation happened
2. **Control**: Users can override, customize, and limit delegation behavior
3. **Seamlessness**: Delegation feels natural, not intrusive
4. **Visibility**: Real-time progress monitoring at all levels

---

## User Journey Maps

### Journey 1: Ad-Hoc Task Delegation

**Scenario**: User prompts "Implement user authentication"

```
+------------------------------------------------------------------------+
| USER JOURNEY: Ad-Hoc Task Auto-Delegation                              |
+------------------------------------------------------------------------+

1. USER INPUT
   +------------------------------------------+
   | > Implement user authentication          |
   +------------------------------------------+
                    |
                    v
2. DELEGATION ANALYSIS (< 500ms)
   +------------------------------------------+
   | [ANALYZING] Evaluating task complexity...  |
   |                                          |
   | Complexity:      78/100 (HIGH)           |
   | Subtasks:        5 decomposable          |
   | Context Usage:   42%                     |
   | Recommended:     PARALLEL delegation     |
   +------------------------------------------+
                    |
                    v
3. DELEGATION PROPOSAL (user sees inline suggestion)
   +------------------------------------------+
   | [DELEGATION SUGGESTED]                    |
   |                                          |
   | This task benefits from delegation:       |
   | - High complexity (78/100)               |
   | - 5 independent subtasks identified      |
   |                                          |
   | Proposed subtasks:                       |
   |   1. Design auth schema                  |
   |   2. Implement JWT token service         |
   |   3. Create login/register endpoints     |
   |   4. Add password hashing               |
   |   5. Write authentication tests          |
   |                                          |
   | [Accept] [Modify] [Skip & Execute Direct] |
   +------------------------------------------+
                    |
        +-----------+-----------+
        |           |           |
        v           v           v
    ACCEPTED    MODIFIED   SKIPPED
        |           |           |
        v           v           v
4a. AUTO-DELEGATE     4b. USER-MODIFIED    4c. DIRECT EXECUTION
   (parallel)              DELEGATION           (no delegation)
```

#### Inline Notification States

**Compact Mode** (default when delegation score < 75):
```
[INFO] Task may benefit from delegation (score: 62). [View Details]
```

**Expanded Mode** (when delegation score >= 75):
```
+------------------------------------------+
| DELEGATION RECOMMENDED                    |
|                                          |
| Score: 78/100 | Pattern: parallel        |
|                                          |
| 5 subtasks identified:                   |
| [x] Auth schema design                   |
| [x] JWT service                          |
| [x] API endpoints                        |
| [ ] Password hashing (optional)          |
| [ ] Tests (optional)                     |
|                                          |
| [Delegate 5] [Delegate 3] [Skip]         |
+------------------------------------------+
```

---

### Journey 2: Tasks.json Task Delegation

**Scenario**: User prompts "Work on task audit-cleanup-phase1"

```
+------------------------------------------------------------------------+
| USER JOURNEY: Tasks.json Task Delegation                               |
+------------------------------------------------------------------------+

1. TASK REFERENCE
   +------------------------------------------+
   | > Work on task audit-cleanup-phase1     |
   +------------------------------------------+
                    |
                    v
2. TASK LOADED + CONTEXT ENRICHED
   +------------------------------------------+
   | [TASK LOADED]                            |
   |                                          |
   | audit-cleanup-phase1                     |
   | "Audit Cleanup Phase 1 - Dead Code"      |
   |                                          |
   | Phase: implementation | Priority: high   |
   | Estimate: 4h | Subtasks: 7              |
   |                                          |
   | Dependencies:                            |
   | - (none)                                |
   |                                          |
   | Acceptance Criteria: 7                   |
   +------------------------------------------+
                    |
                    v
3. DELEGATION DECISION (based on task metadata)
   +------------------------------------------+
   | [DELEGATION ANALYSIS]                    |
   |                                          |
   | Factors:                                |
   | - Complexity: 72/100                    |
   | - Acceptance criteria: 7                |
   | - Estimate: 4h (above threshold)        |
   | - Phase: implementation                 |
   |                                          |
   | Recommendation: SEQUENTIAL delegation    |
   | (Ordered acceptance criteria)            |
   +------------------------------------------+
                    |
                    v
4. DELEGATION PROPOSAL WITH TASK CONTEXT
   +------------------------------------------+
   | [DELEGATION RECOMMENDED]                 |
   |                                          |
   | Based on acceptance criteria, suggest:   |
   |                                          |
   | 1. Delete orphaned modules (37 files)    |
   | 2. Remove test databases (4 files)       |
   | 3. Remove npm dependencies (4 deps)      |
   | 4. Fix broken doc links (32 links)       |
   | 5. Archive stale docs (15 docs)          |
   | 6. Run test validation                   |
   | 7. Update PROJECT_SUMMARY.md            |
   |                                          |
   | Order: Sequential (deps between steps)   |
   |                                          |
   | [Delegate All] [Select Steps] [Direct]   |
   +------------------------------------------+
                    |
                    v
5. PROGRESS TRACKING (linked to task in tasks.json)
   +------------------------------------------+
   | [DELEGATED] audit-cleanup-phase1         |
   |                                          |
   | Progress: 3/7 steps complete             |
   | Active: Step 4 (Fix broken doc links)    |
   |                                          |
   | Sub-agent status:                        |
   | - cleanup-agent-1: Step 4 [running]      |
   | - cleanup-agent-2: idle (queued)         |
   |                                          |
   | [View Details] [Pause] [Cancel]          |
   +------------------------------------------+
```

---

## Feedback Mechanisms

### 1. Delegation Decision Feedback

#### Inline Status Bar
```
+------------------------------------------------------------------------+
| DELEGATION STATUS                                                       |
+------------------------------------------------------------------------+
| Mode: Auto | Score: 78 | Pattern: parallel | Depth: 1/3 | Children: 2/5 |
+------------------------------------------------------------------------+
```

#### Expandable Reasoning Panel
```
+------------------------------------------------------------------------+
| WHY DELEGATION? [collapse]                                              |
+------------------------------------------------------------------------+
|                                                                         |
| DECISION FACTORS                    CONTRIBUTION                        |
| +----------------------------------+-------------------+                |
| | Complexity (78/100)              | +23.4 points     |                |
| | Context Utilization (42%)        | +11.2 points     |                |
| | Subtask Count (5)                | +15.0 points     |                |
| | Agent Confidence (65%)           | +8.8 points      |                |
| | Agent Load (20%)                 | +2.0 points      |                |
| | Depth Remaining (3)              | +10.0 points     |                |
| +----------------------------------+-------------------+                |
| | TOTAL SCORE                      | 70.4/100         |                |
| +----------------------------------+-------------------+                |
|                                                                         |
| THRESHOLDS                                                              |
| - Delegation threshold: 60                                              |
| - Current score: 70.4 (ABOVE THRESHOLD)                                 |
|                                                                         |
| PATTERN SELECTION: parallel                                             |
| - Independent subtasks detected                                         |
| - No sequential dependencies                                            |
| - Parallelization will reduce time by ~60%                              |
|                                                                         |
+------------------------------------------------------------------------+
```

### 2. Sub-Agent Progress Monitoring

#### Compact Progress View
```
[DELEGATED] 3 agents | 4/7 complete | ETA: 12m | [Expand]
```

#### Expanded Progress Tree
```
+------------------------------------------------------------------------+
| DELEGATION HIERARCHY                                                    |
+------------------------------------------------------------------------+
|                                                                         |
| audit-cleanup-phase1 (PARENT)                                           |
| |                                                                       |
| +-- [DONE] Step 1: Delete orphaned modules                              |
| |   Agent: cleanup-1 | Duration: 2m 34s | Files: 37                    |
| |                                                                       |
| +-- [DONE] Step 2: Remove test databases                                |
| |   Agent: cleanup-2 | Duration: 45s | Files: 4                        |
| |                                                                       |
| +-- [DONE] Step 3: Remove npm dependencies                              |
| |   Agent: cleanup-1 | Duration: 1m 12s | Deps: 4                      |
| |                                                                       |
| +-- [RUNNING] Step 4: Fix broken doc links                              |
| |   Agent: cleanup-2 | Progress: 18/32 links | ETA: 4m                 |
| |   |                                                                   |
| |   +-- Last action: Updated CLAUDE.md line 234                        |
| |   +-- Next: docs/AGENT-VERIFICATION-PROTOCOL.md                      |
| |                                                                       |
| +-- [QUEUED] Step 5: Archive stale docs                                 |
| +-- [QUEUED] Step 6: Run test validation                                |
| +-- [QUEUED] Step 7: Update PROJECT_SUMMARY.md                          |
|                                                                         |
+------------------------------------------------------------------------+
| Tokens: 12.4K/50K | Cost: $0.42 | Quality: 87/100                      |
+------------------------------------------------------------------------+
```

### 3. Real-Time SSE Updates

#### Event Types for UI Updates
```javascript
// Delegation started
{ type: "delegation:started", data: {
    taskId: "audit-cleanup-phase1",
    pattern: "sequential",
    subtaskCount: 7,
    estimatedDuration: 1200000
}}

// Subtask progress
{ type: "delegation:subtask-progress", data: {
    parentTaskId: "audit-cleanup-phase1",
    subtaskIndex: 3,
    subtaskId: "cleanup-step-4",
    status: "running",
    progress: { current: 18, total: 32 },
    agentId: "cleanup-2"
}}

// Subtask completed
{ type: "delegation:subtask-complete", data: {
    parentTaskId: "audit-cleanup-phase1",
    subtaskIndex: 3,
    duration: 180000,
    quality: 92
}}

// Delegation completed
{ type: "delegation:complete", data: {
    taskId: "audit-cleanup-phase1",
    duration: 720000,
    quality: 87,
    subtasksCompleted: 7,
    tokensUsed: 12400,
    cost: 0.42
}}
```

---

## Control Mechanisms

### 1. Global Delegation Settings

#### Configuration Interface
```
+------------------------------------------------------------------------+
| DELEGATION SETTINGS                                                     |
+------------------------------------------------------------------------+
|                                                                         |
| MODE                                                                    |
| ( ) Disabled       - Never auto-delegate                                |
| (o) Suggest Only   - Show suggestions, require approval                 |
| ( ) Auto-Accept    - Accept all recommendations                         |
| ( ) Smart          - Auto-accept high-confidence, suggest others        |
|                                                                         |
+------------------------------------------------------------------------+
| THRESHOLDS                                                              |
+------------------------------------------------------------------------+
|                                                                         |
| Delegation Score Threshold:    [====60====|--------] 60/100             |
| Auto-Accept Confidence Floor:  [========85|--------] 85/100             |
| Complexity Trigger:            [====50====|--------] 50/100             |
|                                                                         |
+------------------------------------------------------------------------+
| LIMITS                                                                  |
+------------------------------------------------------------------------+
|                                                                         |
| Max Delegation Depth:          [1] [2] [3*] [4] [5]                     |
| Max Concurrent Sub-Agents:     [3] [5*] [7] [10]                        |
| Token Budget per Child:        [500] [1000*] [2000] [5000]              |
|                                                                         |
+------------------------------------------------------------------------+
| PER-PROMPT OVERRIDE                                                     |
+------------------------------------------------------------------------+
|                                                                         |
| [x] Allow /delegate command to force delegation                         |
| [x] Allow /direct command to force direct execution                     |
| [x] Allow /depth=N to set max depth for this prompt                     |
|                                                                         |
+------------------------------------------------------------------------+
```

### 2. Per-Prompt Commands

#### Force Delegation
```
> /delegate Implement user authentication

[FORCED DELEGATION]
Delegating regardless of score (score was: 45)
Pattern: auto-selected (parallel)
Subtasks: 5 generated
```

#### Force Direct Execution
```
> /direct Implement user authentication

[DIRECT EXECUTION]
Skipping delegation analysis
Executing in current context
```

#### Limit Delegation Depth
```
> /depth=1 Implement user authentication

[DEPTH LIMITED]
Max delegation depth: 1 (for this prompt only)
Global default: 3
```

#### Specify Pattern
```
> /pattern=debate Design the API architecture

[PATTERN OVERRIDE]
Using debate pattern (forced)
Will spawn 3 agents for debate
```

### 3. Per-Task Override (in tasks.json)

```json
{
  "id": "audit-cleanup-phase1",
  "title": "Audit Cleanup Phase 1",

  "delegationConfig": {
    "mode": "suggest",           // "disabled" | "suggest" | "auto" | "inherit"
    "maxDepth": 2,               // Override global depth for this task
    "pattern": "sequential",     // Force specific pattern
    "subtaskApproval": true,     // Require approval for generated subtasks
    "tokenBudget": 20000,        // Total tokens for this task tree
    "qualityThreshold": 80,      // Minimum quality score to proceed
    "rollbackOnFailure": true    // Rollback changes if subtask fails
  }
}
```

### 4. Interactive Approval Flow

#### Subtask Approval Modal
```
+------------------------------------------------------------------------+
| APPROVE SUBTASKS                                                        |
+------------------------------------------------------------------------+
|                                                                         |
| Task: Implement user authentication                                     |
| Pattern: parallel | Depth: 1                                           |
|                                                                         |
| PROPOSED SUBTASKS                                                       |
| +------------------------------------------------------------------+   |
| | [x] 1. Design auth schema                                        |   |
| |     Complexity: 45 | Est: 15m | Agent: design-agent              |   |
| +------------------------------------------------------------------+   |
| | [x] 2. Implement JWT token service                               |   |
| |     Complexity: 62 | Est: 25m | Agent: impl-agent-1              |   |
| +------------------------------------------------------------------+   |
| | [x] 3. Create login/register endpoints                           |   |
| |     Complexity: 58 | Est: 20m | Agent: impl-agent-2              |   |
| +------------------------------------------------------------------+   |
| | [ ] 4. Add password hashing (OPTIONAL)                           |   |
| |     Complexity: 35 | Est: 10m | Agent: impl-agent-1              |   |
| +------------------------------------------------------------------+   |
| | [x] 5. Write authentication tests                                |   |
| |     Complexity: 55 | Est: 20m | Agent: test-agent                |   |
| +------------------------------------------------------------------+   |
|                                                                         |
| Estimated Total: 1h 30m | Tokens: ~25K | Cost: ~$0.85                  |
|                                                                         |
| [Approve Selected (4)] [Approve All (5)] [Edit Subtasks] [Cancel]       |
|                                                                         |
+------------------------------------------------------------------------+
```

---

## Dashboard Integration

### 1. Delegation Summary Panel

```
+------------------------------------------------------------------------+
| DELEGATION OVERVIEW                                                     |
+------------------------------------------------------------------------+
|                                                                         |
| ACTIVE DELEGATIONS           METRICS                                    |
| +------------------------+   +--------------------------------------+   |
| | Task           Agents  |   | Total Delegations Today:      12    |   |
| +------------------------+   | Average Speedup:              2.4x   |   |
| | auth-impl         3    |   | Tokens Saved:              45.2K    |   |
| | db-migrate        2    |   | Quality Improvement:        +8%     |   |
| | test-suite        5    |   +--------------------------------------+   |
| +------------------------+                                              |
|                                                                         |
+------------------------------------------------------------------------+
```

### 2. Hierarchy Visualization in Dashboard

```
+------------------------------------------------------------------------+
| SESSION: multi-agent-template                                           |
+------------------------------------------------------------------------+
|                                                                         |
| HIERARCHY VIEW                                                          |
|                                                                         |
|  [ROOT] main-agent                                                      |
|    |                                                                    |
|    +-- [PARALLEL]                                                       |
|    |     |                                                              |
|    |     +-- cleanup-1 [RUNNING] Step 1: Delete modules                 |
|    |     |   Progress: 28/37 files | ETA: 2m                           |
|    |     |                                                              |
|    |     +-- cleanup-2 [IDLE] Waiting for Step 2                        |
|    |                                                                    |
|    +-- [SEQUENTIAL]                                                     |
|          |                                                              |
|          +-- doc-fixer [RUNNING] Step 4: Fix links                      |
|              Progress: 18/32 | ETA: 4m                                 |
|                                                                         |
+------------------------------------------------------------------------+
| ROLLUP METRICS                                                          |
+------------------------------------------------------------------------+
| Agents: 4 | Tokens: 8.2K/50K | Quality: 85 | Progress: 45%              |
+------------------------------------------------------------------------+
```

### 3. Delegation History Panel

```
+------------------------------------------------------------------------+
| DELEGATION HISTORY                                                      |
+------------------------------------------------------------------------+
|                                                                         |
| TIME         TASK                    PATTERN   AGENTS   RESULT         |
| +----------------------------------------------------------------------+|
| | 10:45      auth-impl              parallel    3      SUCCESS (92)  ||
| | 10:32      db-migration           sequential  2      SUCCESS (88)  ||
| | 10:15      api-tests              parallel    5      PARTIAL (75)  ||
| | 09:58      config-refactor        direct      1      SUCCESS (95)  ||
| +----------------------------------------------------------------------+|
|                                                                         |
| [Show All] [Filter by Pattern] [Export]                                 |
|                                                                         |
+------------------------------------------------------------------------+
```

---

## Notification System

### 1. Toast Notifications

```
+------------------------------------------+
|  DELEGATION STARTED                      |
|                                          |
|  audit-cleanup-phase1                    |
|  Pattern: sequential | Agents: 2         |
|                                          |
|  [View Progress] [Dismiss]               |
+------------------------------------------+
```

### 2. Status Bar Integration

```
+------------------------------------------------------------------------+
| [o] DELEGATING: audit-cleanup-phase1 | 3/7 complete | 2 agents active  |
+------------------------------------------------------------------------+
```

### 3. Sound/Visual Alerts (Optional)

- Subtle sound on delegation complete
- Screen flash on delegation failure
- Badge counter for active delegations

---

## Error Handling UX

### 1. Delegation Failure

```
+------------------------------------------------------------------------+
| DELEGATION FAILED                                                       |
+------------------------------------------------------------------------+
|                                                                         |
|  Step 4 "Fix broken doc links" failed                                  |
|                                                                         |
|  Error: File not found: docs/old-readme.md                             |
|                                                                         |
|  RECOVERY OPTIONS                                                       |
|  [Retry Step]    - Retry with fresh context                            |
|  [Skip Step]     - Continue with remaining steps                       |
|  [Rollback]      - Undo completed steps and cancel                     |
|  [Manual Fix]    - Open file for manual editing                        |
|                                                                         |
|  Completed Steps (can rollback):                                        |
|  - Step 1: Delete orphaned modules (37 files)                          |
|  - Step 2: Remove test databases (4 files)                             |
|  - Step 3: Remove npm dependencies (4 deps)                            |
|                                                                         |
+------------------------------------------------------------------------+
```

### 2. Partial Success

```
+------------------------------------------------------------------------+
| DELEGATION PARTIAL SUCCESS                                              |
+------------------------------------------------------------------------+
|                                                                         |
|  audit-cleanup-phase1                                                   |
|                                                                         |
|  Completed: 5/7 steps                                                   |
|  Failed: 2 steps                                                        |
|                                                                         |
|  FAILED STEPS                                                           |
|  +------------------------------------------------------------------+  |
|  | Step 4: Fix broken doc links                                      |  |
|  | Error: 3 files not found                                          |  |
|  | [Retry] [Skip] [Details]                                          |  |
|  +------------------------------------------------------------------+  |
|  | Step 6: Run test validation                                       |  |
|  | Error: 2 tests failing                                            |  |
|  | [Retry] [Skip] [Details]                                          |  |
|  +------------------------------------------------------------------+  |
|                                                                         |
|  [Mark Complete Anyway] [Retry Failed Steps] [Rollback All]             |
|                                                                         |
+------------------------------------------------------------------------+
```

---

## Accessibility Considerations

1. **Keyboard Navigation**
   - `Ctrl+D` toggle delegation mode
   - `Ctrl+Shift+D` force delegate current task
   - Arrow keys navigate subtask tree
   - Enter to expand/collapse

2. **Screen Reader Support**
   - ARIA labels for all delegation states
   - Progress announcements for long operations
   - Error state announcements

3. **Reduced Motion Mode**
   - Disable animations in progress tree
   - Static progress bars instead of animated
   - No blinking indicators

---

## Configuration Persistence

### User Preferences (stored in .claude/config.json)

```json
{
  "delegation": {
    "mode": "suggest",
    "thresholds": {
      "delegationScore": 60,
      "autoAcceptConfidence": 85,
      "complexityTrigger": 50
    },
    "limits": {
      "maxDepth": 3,
      "maxConcurrentAgents": 5,
      "tokenBudgetPerChild": 1000
    },
    "ui": {
      "showReasoningPanel": true,
      "expandProgressTree": false,
      "notificationSound": false,
      "compactMode": false
    }
  }
}
```

---

## API Endpoints for Delegation Control

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/delegation/settings` | GET/PUT | Get/update global settings |
| `/api/delegation/decision` | POST | Get delegation decision for task |
| `/api/delegation/start` | POST | Start delegation for task |
| `/api/delegation/cancel/:id` | POST | Cancel active delegation |
| `/api/delegation/pause/:id` | POST | Pause delegation |
| `/api/delegation/resume/:id` | POST | Resume paused delegation |
| `/api/delegation/history` | GET | Get delegation history |
| `/api/delegation/active` | GET | Get all active delegations |

---

## Summary

The auto-delegation UX is designed to be:

1. **Transparent**: Full visibility into why decisions are made
2. **Controllable**: Global settings, per-prompt commands, per-task overrides
3. **Non-intrusive**: Suggestions appear inline, not as blocking modals
4. **Informative**: Real-time progress with detailed metrics
5. **Recoverable**: Clear error handling with multiple recovery options
6. **Integrated**: Seamless dashboard integration for monitoring
7. **Accessible**: Full keyboard support and screen reader compatibility

The design balances automation with user control, ensuring users always feel in command while benefiting from intelligent delegation recommendations.
