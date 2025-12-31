# Dashboard Fleet Management Design Specification

**Status**: Design Phase
**Priority**: HIGH (NOW bucket)
**Created**: 2025-12-30
**Based on**: Agent Swarm Analysis + User Requirements

---

## Executive Summary

Redesign the dashboard from single-session focus to **Fleet Management** mode supporting 5+ concurrent sessions/agents with:
- Full agent lineage visibility (parent-child delegation trees)
- Smart defaults for metric surfacing based on context
- Critical alerts via banner + sound, other events via toast notifications
- Countdown timers for token limits and 5-hour rate windows

---

## User Requirements

| Requirement | Selection |
|-------------|-----------|
| Primary Use | Fleet Management (5+ concurrent sessions) |
| Critical Alerts | ALL: Token Exhaustion, 5-Hour Rate Limit, Quality/Confidence Drop, Task Stuck |
| Agent Visibility | Full Lineage (parent-child delegation trees) |
| API Strategy | Smart Defaults (auto-surface relevant metrics) |
| Alert Style | Banner + Sound (critical) + Toast Notifications (other) |

---

## Current State Analysis

### What Exists (from Agent Analysis)

| Component | Current State |
|-----------|---------------|
| Dashboard HTML | 3,976 lines, single-page app |
| API Endpoints | 84 available, only ~15 visualized |
| Real-time | SSE via `/api/events` |
| Session View | Project groups, expandable sessions |
| Agent Pool | NO dedicated endpoint |
| Hierarchy | SessionRegistry tracks parent/child but not exposed |

### Key Gaps

1. **No Fleet Overview** - Must click into each session
2. **No Agent Lineage** - Can't see delegation trees
3. **No Countdown Timers** - Usage limits shown as bars, not remaining time
4. **No Smart Surfacing** - All metrics shown equally
5. **No Alert System** - No banner, sound, or toast notifications

---

## Proposed Architecture

### Information Hierarchy (4 Levels)

```
LEVEL 0: GLOBAL (Always Visible Header)
├── 5-Hour Countdown Timer (progress bar + "2h 15m remaining")
├── Daily/Weekly Usage Summary
├── Active Sessions Count (e.g., "8 active across 3 projects")
├── Alert Banner (when critical alerts exist)
└── Account Totals ($189.42 | 1,047 sessions)

LEVEL 1: FLEET OVERVIEW (Main View)
├── Project Cards (one per project)
│   ├── Project name + health indicator
│   ├── Active sessions count
│   ├── Aggregate metrics (tokens, cost, quality avg)
│   └── Expand arrow → shows sessions
├── Agent Pool Status Card
│   ├── Active/Idle/Error agent counts
│   ├── Delegation success rate
│   └── Expand → full lineage tree
└── Alerts Summary Card
    ├── Critical/Warning/Info counts
    └── Expand → alert timeline

LEVEL 2: PROJECT DRILL-DOWN (Click project card)
├── Session List (cards or table rows)
│   ├── Session ID + status badge
│   ├── Context % (with countdown: "45min until compact")
│   ├── Current task + phase
│   ├── Quality/Confidence scores
│   └── Claim info (task owned, TTL remaining)
├── Project-Level Metrics
│   ├── Total tokens/cost for project
│   ├── Session history (sparkline)
│   └── Lessons learned count
└── Quick Actions (pause all, end all)

LEVEL 3: SESSION DETAIL (Click session)
├── Full metrics dashboard (current implementation)
├── Task queue with hierarchy
├── Log viewer (streaming)
├── Artifacts list
└── Delegation tree (if has children)

LEVEL 4: METRIC DRILL-DOWNS (Click any metric)
├── Quality Score → 6-dimension radar chart
├── Confidence → Signals breakdown
├── Usage → Historical chart + projections
├── Tasks → D3.js dependency graph
└── Agents → Full lineage tree visualization
```

---

## New Components

### 1. Global Header (Redesigned)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [ALERT BANNER: Token limit critical - 15min remaining] [Dismiss] [Mute] │
├─────────────────────────────────────────────────────────────────────────┤
│ FLEET COMMAND CENTER                                                     │
│                                                                          │
│ 5-HOUR LIMIT          FLEET STATUS           ACCOUNT                     │
│ ██████████░░ 58%      8 sessions active      $189.42 total              │
│ 2h 15m remaining      3 projects             1,047 sessions             │
│ Pace: 42 tok/min      2 alerts (1 critical)  7 projects                 │
│                                                                          │
│ [Alerts] [Settings] [Refresh] [Collapse]                                │
└─────────────────────────────────────────────────────────────────────────┘
```

**Data Sources**:
- `/api/usage/limits` → 5-hour countdown (`resetIn` field)
- `/api/sessions/summary` → active count, project count
- `/api/account` → totals
- `/api/usage/alerts` → alert banner

### 2. Fleet Overview Cards

```
┌──────────────────────────────────────────────────────────────────┐
│ PROJECT CARDS                                           [+ -]   │
├──────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ multi-agent-template                              ●●●○      │ │
│ │                                                             │ │
│ │ ACTIVE TASKS: 3 sessions working on 3 parent tasks         │ │
│ │ ┌─────────────────────────────────────────────────────────┐ │ │
│ │ │ ● dashboard-ux-redesign    3/5 subtasks  session-abc    │ │ │
│ │ │ ● auto-delegation-hook     1/4 subtasks  session-def    │ │ │
│ │ │ ● test-coverage-fix        2/2 subtasks  session-ghi    │ │ │
│ │ └─────────────────────────────────────────────────────────┘ │ │
│ │                                                             │ │
│ │ 45k tokens | $2.34 | Avg Quality: 87                       │ │
│ │ [▼ Show Sessions & Subtasks]                               │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ research-project                                  ●○○○      │ │
│ │                                                             │ │
│ │ ACTIVE TASKS: 1 session working on 1 parent task           │ │
│ │ ┌─────────────────────────────────────────────────────────┐ │ │
│ │ │ ● api-integration          1/6 subtasks  session-jkl    │ │ │
│ │ └─────────────────────────────────────────────────────────┘ │ │
│ │                                                             │ │
│ │ 12k tokens | $0.89 | Quality: 91                           │ │
│ │ [▼ Show Sessions & Subtasks]                               │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌─────────────────────┐  ┌─────────────────────┐                │
│ │ AGENT POOL          │  │ ALERTS              │                │
│ │ Active: 4 | Idle: 2 │  │ ● 1 Critical        │                │
│ │ Delegation: 94% ✓   │  │ ● 2 Warnings        │                │
│ │ [▼ View Lineage]    │  │ [▼ View All]        │                │
│ └─────────────────────┘  └─────────────────────┘                │
└──────────────────────────────────────────────────────────────────┘
```

### 2b. Project Card Drill-Down (Sessions & Subtasks)

```
┌─────────────────────────────────────────────────────────────────┐
│ multi-agent-template                                    [▲ Hide]│
├─────────────────────────────────────────────────────────────────┤
│ SESSION 1: session-abc123                                       │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ PARENT TASK: dashboard-ux-redesign     Context: 52%        │ │
│ │ Progress: ████████░░ 3/5 subtasks      Quality: 87         │ │
│ │                                                             │ │
│ │ SUBTASKS:                                                   │ │
│ │   ✓ implement-api-endpoints      Completed    (agent-def)  │ │
│ │   ✓ design-alert-system          Completed    (agent-ghi)  │ │
│ │   ✓ create-countdown-timers      Completed    (root)       │ │
│ │   ● implement-fleet-overview     In Progress  (agent-jkl)  │ │
│ │   ○ add-smart-defaults           Ready        (unclaimed)  │ │
│ │                                                             │ │
│ │ [View Details] [Pause] [End]                               │ │
│ └─────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│ SESSION 2: session-def456                                       │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ PARENT TASK: auto-delegation-hook      Context: 31%        │ │
│ │ Progress: ██░░░░░░░░ 1/4 subtasks      Quality: 92         │ │
│ │                                                             │ │
│ │ SUBTASKS:                                                   │ │
│ │   ✓ research-hook-patterns       Completed    (root)       │ │
│ │   ● implement-hook-handler       In Progress  (agent-mno)  │ │
│ │   ○ add-delegation-logic         Ready        (unclaimed)  │ │
│ │   ○ write-tests                  Ready        (unclaimed)  │ │
│ │                                                             │ │
│ │ [View Details] [Pause] [End]                               │ │
│ └─────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│ SESSION 3: session-ghi789                                       │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ PARENT TASK: test-coverage-fix         Context: 78%  ⚠     │ │
│ │ Progress: ██████████ 2/2 subtasks ✓    Quality: 88         │ │
│ │                                                             │ │
│ │ SUBTASKS:                                                   │ │
│ │   ✓ fix-failing-tests            Completed    (root)       │ │
│ │   ✓ add-missing-coverage         Completed    (root)       │ │
│ │                                                             │ │
│ │ [View Details] [Pause] [End]                               │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Agent Lineage Tree (Full Visibility)

```
┌──────────────────────────────────────────────────────────────────┐
│ AGENT DELEGATION TREE                                    [Close] │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ ● session-abc123 (root) - multi-agent-template                  │
│ │  Phase: implementation | Quality: 87 | Context: 52%           │
│ │  Task: dashboard-ux-redesign                                  │
│ │                                                                │
│ ├── ● agent-def456 (child, depth: 1)                            │
│ │   │  Pattern: PARALLEL | Duration: 2m 34s                     │
│ │   │  Task: review-dashboard-implementation                    │
│ │   │                                                           │
│ │   ├── ● agent-ghi789 (grandchild, depth: 2)                   │
│ │   │      Pattern: SEQUENTIAL | Duration: 45s                  │
│ │   │      Task: analyze-api-endpoints                          │
│ │   │      Status: COMPLETED ✓                                  │
│ │   │                                                           │
│ │   └── ● agent-jkl012 (grandchild, depth: 2)                   │
│ │          Pattern: SEQUENTIAL | Duration: 1m 12s               │
│ │          Task: research-agent-pool-monitoring                 │
│ │          Status: RUNNING...                                   │
│ │                                                                │
│ └── ● agent-mno345 (child, depth: 1)                            │
│        Pattern: REVIEW | Duration: 3m 01s                       │
│        Task: design-multi-project-view                          │
│        Status: RUNNING...                                        │
│                                                                  │
│ Legend: ● Active  ○ Idle  ✕ Error  ✓ Completed                  │
│                                                                  │
│ Metrics: 5 agents | Max depth: 2 | Success rate: 94%            │
└──────────────────────────────────────────────────────────────────┘
```

### 4. Countdown Timers

**5-Hour Window Timer**:
```
┌─────────────────────────────────────┐
│ 5-HOUR LIMIT                        │
│ ████████████████░░░░ 58%            │
│                                     │
│ ⏱ 2h 15m remaining                 │
│ Reset: 4:45 PM                      │
│                                     │
│ Pace: 42 tok/min (safe: 55)        │
│ Projected: OK ✓                     │
└─────────────────────────────────────┘
```

**Session Context Timer**:
```
┌─────────────────────────────────────┐
│ SESSION CONTEXT                     │
│ ████████████████████░ 85%           │
│                                     │
│ ⚠ ~45 min until auto-compact       │
│ 170k / 200k tokens                  │
│                                     │
│ [Save State Now] [View History]     │
└─────────────────────────────────────┘
```

### 5. Alert System

**Banner (Critical Alerts)**:
```
┌─────────────────────────────────────────────────────────────────────────┐
│ ⚠ CRITICAL: Session abc123 context at 95% - auto-compact in 10min     │
│ [Save State] [View Session] [Dismiss] [🔇 Mute Sound]                   │
└─────────────────────────────────────────────────────────────────────────┘
```

**Toast Notifications (Other Events)**:
```
┌────────────────────────────┐
│ ✓ Task claimed: design-x   │  ← Slides in from right
│   by session-abc123        │
│   [View] [Dismiss]         │
└────────────────────────────┘
     ↓ Auto-dismiss after 5s
```

**Audio Alerts**:
- Critical: Distinct alert tone (configurable)
- Warning: Softer notification sound
- Can be muted per-session or globally

---

## New API Endpoints Required

### 1. `/api/agent-pool/status` (NEW)

```javascript
GET /api/agent-pool/status

Response:
{
  "timestamp": "2025-12-30T15:30:00Z",
  "summary": {
    "totalAgents": 6,
    "activeAgents": 4,
    "idleAgents": 2,
    "errorAgents": 0,
    "byPhase": {
      "research": 1,
      "design": 2,
      "implementation": 1
    }
  },
  "delegations": {
    "activeCount": 3,
    "byPattern": {
      "parallel": 2,
      "sequential": 1,
      "debate": 0,
      "review": 0
    },
    "successRate": 0.94,
    "avgDurationMs": 45000,
    "peakConcurrentChildren": 4
  },
  "hierarchy": [
    {
      "sessionId": "abc123",
      "project": "multi-agent-template",
      "isRoot": true,
      "depth": 0,
      "children": [
        {
          "sessionId": "def456",
          "pattern": "PARALLEL",
          "task": "review-dashboard",
          "status": "running",
          "depth": 1,
          "children": [...]
        }
      ]
    }
  ],
  "health": {
    "status": "healthy",
    "warnings": [],
    "claimHealth": {
      "active": 3,
      "expiringSoon": 1,
      "stale": 0
    }
  }
}
```

### 2. `/api/overview` (NEW)

```javascript
GET /api/overview

Response:
{
  "global": {
    "fiveHourLimit": {
      "used": 5800,
      "limit": 10000,
      "percent": 58,
      "resetIn": 8100000,  // 2h 15m in ms
      "resetAt": "2025-12-30T17:45:00Z",
      "pace": 42,
      "safePace": 55
    },
    "dailyLimit": {...},
    "weeklyLimit": {...},
    "activeSessionCount": 8,
    "activeProjectCount": 3,
    "alertCount": { "critical": 1, "warning": 2, "info": 5 }
  },
  "account": {
    "totalCost": 189.42,
    "sessionCount": 1047,
    "projectCount": 7
  },
  "projects": [
    {
      "name": "multi-agent-template",
      "path": "/path/to/project",
      "sessionCount": 3,
      "activeSessionCount": 3,
      "metrics": {
        "totalTokens": 45000,
        "totalCost": 2.34,
        "avgQuality": 87,
        "avgConfidence": 0.82
      },
      "health": "healthy",
      // Each session has its own parent task and subtasks
      "sessions": [
        {
          "id": "session-abc123",
          "isRoot": true,
          "contextPercent": 52,
          "qualityScore": 87,
          "parentTask": {
            "id": "dashboard-ux-redesign",
            "title": "Dashboard Fleet Management Redesign",
            "status": "in_progress"
          },
          "subtaskProgress": { "completed": 3, "total": 5, "percent": 60 },
          "subtasks": [
            { "id": "implement-api-endpoints", "title": "Implement API Endpoints", "status": "completed", "claimedBy": "agent-def" },
            { "id": "design-alert-system", "title": "Design Alert System", "status": "completed", "claimedBy": "agent-ghi" },
            { "id": "create-countdown-timers", "title": "Create Countdown Timers", "status": "completed", "claimedBy": null },
            { "id": "implement-fleet-overview", "title": "Implement Fleet Overview", "status": "in_progress", "claimedBy": "agent-jkl" },
            { "id": "add-smart-defaults", "title": "Add Smart Defaults", "status": "ready", "claimedBy": null }
          ]
        },
        {
          "id": "session-def456",
          "isRoot": true,
          "contextPercent": 31,
          "qualityScore": 92,
          "parentTask": {
            "id": "auto-delegation-hook",
            "title": "Auto-Delegation Hook Implementation",
            "status": "in_progress"
          },
          "subtaskProgress": { "completed": 1, "total": 4, "percent": 25 },
          "subtasks": [
            { "id": "research-hook-patterns", "title": "Research Hook Patterns", "status": "completed", "claimedBy": null },
            { "id": "implement-hook-handler", "title": "Implement Hook Handler", "status": "in_progress", "claimedBy": "agent-mno" },
            { "id": "add-delegation-logic", "title": "Add Delegation Logic", "status": "ready", "claimedBy": null },
            { "id": "write-tests", "title": "Write Tests", "status": "ready", "claimedBy": null }
          ]
        },
        {
          "id": "session-ghi789",
          "isRoot": true,
          "contextPercent": 78,
          "qualityScore": 88,
          "parentTask": {
            "id": "test-coverage-fix",
            "title": "Fix Test Coverage",
            "status": "completed"
          },
          "subtaskProgress": { "completed": 2, "total": 2, "percent": 100 },
          "subtasks": [
            { "id": "fix-failing-tests", "title": "Fix Failing Tests", "status": "completed", "claimedBy": null },
            { "id": "add-missing-coverage", "title": "Add Missing Coverage", "status": "completed", "claimedBy": null }
          ]
        }
      ]
    }
  ],
  "agentPool": {
    "active": 4,
    "idle": 2,
    "delegationSuccessRate": 0.94
  },
  "alerts": [
    {
      "id": "alert-1",
      "level": "critical",
      "type": "token_exhaustion",
      "message": "Session abc123 context at 95%",
      "sessionId": "abc123",
      "timestamp": "2025-12-30T15:28:00Z",
      "actions": ["save_state", "view_session"]
    }
  ]
}
```

### 3. WebSocket Channel `/ws/fleet` (NEW)

```javascript
// Real-time events pushed to dashboard

// Delegation events
{ "type": "delegation:started", "sessionId": "abc123", "childId": "def456", "pattern": "PARALLEL" }
{ "type": "delegation:completed", "sessionId": "def456", "duration": 45000, "quality": 91 }
{ "type": "delegation:failed", "sessionId": "def456", "error": "timeout" }

// Alert events (trigger banner + sound)
{ "type": "alert:critical", "id": "alert-1", "message": "Token limit critical", "sessionId": "abc123" }
{ "type": "alert:warning", "id": "alert-2", "message": "Quality dropped to 75", "sessionId": "def456" }

// Session events (trigger toast)
{ "type": "session:started", "sessionId": "abc123", "project": "multi-agent-template" }
{ "type": "session:completed", "sessionId": "abc123", "duration": 3600000, "tokensUsed": 45000 }

// Task events (trigger toast)
{ "type": "task:claimed", "taskId": "design-x", "sessionId": "abc123" }
{ "type": "task:stuck", "taskId": "design-x", "sessionId": "abc123", "stuckDuration": 600000 }
```

---

## Smart Defaults System

### Context-Aware Metric Surfacing

The dashboard auto-surfaces relevant metrics based on current state:

| Context | Surfaced Metrics | Reason |
|---------|------------------|--------|
| 5-hour limit > 80% | Rate limit countdown prominent | Prevent rate limiting |
| Session context > 75% | Session context timer, save button | Prevent auto-compact |
| Quality < 80 | Quality breakdown drill-down | Investigate issues |
| Confidence < 0.7 | Confidence signals visible | Understand uncertainty |
| Task stuck > 10min | Stuck task alert | Unblock progress |
| Delegation depth > 2 | Lineage tree expanded | Monitor deep hierarchies |
| Error rate > 5% | Error log prominent | Debug failures |

### Implementation

```javascript
function getSmartDefaults(state) {
  const surfaced = [];

  // Usage urgency
  if (state.fiveHourLimit.percent > 80) {
    surfaced.push({ metric: 'rate_limit', prominence: 'high', reason: 'approaching_limit' });
  }

  // Session health
  state.sessions.forEach(session => {
    if (session.contextPercent > 75) {
      surfaced.push({ metric: 'context_timer', sessionId: session.id, prominence: 'high' });
    }
    if (session.qualityScore < 80) {
      surfaced.push({ metric: 'quality_breakdown', sessionId: session.id, prominence: 'medium' });
    }
  });

  // Agent pool health
  if (state.agentPool.errorAgents > 0) {
    surfaced.push({ metric: 'agent_errors', prominence: 'high' });
  }

  return surfaced;
}
```

---

## UI/UX Patterns

### Progressive Disclosure

1. **Collapsed by Default**: Project cards, agent pool, alerts
2. **Expand on Click**: Reveal session list, lineage tree, alert timeline
3. **Drill-down Modals**: Quality breakdown, dependency graph, artifacts
4. **Hover Previews**: Quick stats without clicking

### Keyboard Navigation

| Key | Action |
|-----|--------|
| `↑↓` | Navigate sessions/projects |
| `Enter` | Expand/select |
| `Esc` | Collapse/close modal |
| `1-9` | Jump to project by number |
| `a` | Toggle agent pool view |
| `l` | Toggle log viewer |
| `m` | Mute/unmute sounds |

### Responsive Behavior

- **Desktop (>1200px)**: Full 3-column layout
- **Tablet (768-1200px)**: 2-column, collapsible sidebar
- **Mobile (<768px)**: Single column, bottom sheet drill-downs

---

## Implementation Phases

### Phase 1: Core Infrastructure (3-4 days)
- [ ] Add `/api/agent-pool/status` endpoint
- [ ] Add `/api/overview` endpoint
- [ ] Implement WebSocket channel `/ws/fleet`
- [ ] Add smart defaults calculation

### Phase 2: Global Header + Alerts (2-3 days)
- [ ] Redesign header with countdown timers
- [ ] Implement alert banner component
- [ ] Add toast notification system
- [ ] Add audio alert support

### Phase 3: Fleet Overview (3-4 days)
- [ ] Create project cards component
- [ ] Create agent pool status card
- [ ] Create alerts summary card
- [ ] Implement expand/collapse behavior

### Phase 4: Agent Lineage (2-3 days)
- [ ] Create lineage tree visualization
- [ ] Add real-time updates via WebSocket
- [ ] Add drill-down to session detail

### Phase 5: Polish + Smart Defaults (2-3 days)
- [ ] Implement smart defaults surfacing
- [ ] Add keyboard navigation
- [ ] Performance optimization
- [ ] Responsive design

---

## Technical Considerations

### Performance

- **Lazy Loading**: Only fetch session details when expanded
- **Virtual Scrolling**: For large session lists (50+)
- **WebSocket Batching**: Group updates, debounce renders
- **Caching**: Cache overview data for 5 seconds

### Data Sources

| Metric | Primary Endpoint | Refresh |
|--------|-----------------|---------|
| 5-hour countdown | `/api/usage/limits` | Real-time via SSE |
| Session list | `/api/sessions/summary` | Real-time via SSE |
| Agent pool | `/api/agent-pool/status` | 10s polling or WebSocket |
| Lineage tree | `/api/agent-pool/status` hierarchy | WebSocket events |
| Alerts | `/api/usage/alerts` + `/api/alerts` | Real-time via WebSocket |
| Quality scores | `/api/execution/scores` | On-demand (drill-down) |

### Architecture Compliance

Per `.claude/ARCHITECTURE.md`:
- ALL changes go in `global-context-manager.js` (port 3033)
- ALL UI changes go in `global-dashboard.html`
- NO new dashboard servers or alternative ports
- Extend existing SSE with new event types

---

## Success Metrics

1. **Fleet Visibility**: See all 5+ sessions at a glance without clicking
2. **Alert Response**: Critical alerts visible and audible within 3 seconds
3. **Lineage Clarity**: Full delegation tree visible with one click
4. **Countdown Accuracy**: Time remaining shown for limits and context
5. **Smart Surfacing**: Relevant metrics auto-appear based on context
6. **Performance**: Overview loads in <500ms, drill-downs in <200ms

---

## Appendix: Alert Types

| Alert Type | Level | Trigger | Sound | Banner |
|------------|-------|---------|-------|--------|
| Token Exhaustion | Critical | Context > 90% | Yes | Yes |
| Rate Limit | Critical | 5-hour > 95% or severity=critical | Yes | Yes |
| Quality Drop | Warning | Quality < 75 | No | No (toast) |
| Confidence Drop | Warning | Confidence < 0.5 | No | No (toast) |
| Task Stuck | Warning | No progress > 10min | No | Yes |
| Delegation Failed | Warning | Child agent error | No | No (toast) |
| Session Started | Info | New session | No | No (toast) |
| Task Completed | Info | Task done | No | No (toast) |

---

**Next Steps**:
1. Review this design with stakeholders
2. Create detailed wireframes/mockups
3. Begin Phase 1 implementation

