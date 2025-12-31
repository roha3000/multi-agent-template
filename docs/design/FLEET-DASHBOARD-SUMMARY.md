# Fleet Management Dashboard - Design Summary

**Session**: 70
**Date**: 2025-12-30
**Status**: Design Complete, Ready for Implementation

---

## Agent Swarm Analysis

4 parallel agents analyzed the current dashboard and produced recommendations:

| Agent | Focus | Key Findings |
|-------|-------|--------------|
| Dashboard Implementation | Current structure | 3,976-line HTML, 50+ endpoints, only ~15 visualized |
| API Endpoint Analysis | 84 endpoints | Categorized into Usage, Quality, Tasks, Sessions, Agents |
| Agent Pool Research | Orchestrator architecture | No dedicated endpoint, SessionRegistry tracks hierarchy |
| Multi-Project Design | Fleet overview | Proposed 4-level information hierarchy |

---

## User Requirements

| Requirement | Selection |
|-------------|-----------|
| Primary Use | **Fleet Management** (5+ concurrent sessions) |
| Critical Alerts | **ALL**: Token Exhaustion, 5-Hour Rate Limit, Quality/Confidence Drop, Task Stuck |
| Agent Visibility | **Full Lineage** (parent-child delegation trees) |
| API Strategy | **Smart Defaults** (auto-surface relevant metrics based on context) |
| Alert Style | **Banner + Sound** (critical) + **Toast Notifications** (other) |

---

## Key Design Decisions

### 1. 4-Level Information Hierarchy

```
LEVEL 0: GLOBAL (Always Visible Header)
├── 5-Hour Countdown Timer
├── Fleet Status (active sessions/projects)
├── Alert Banner (critical alerts)
└── Account Totals

LEVEL 1: FLEET OVERVIEW (Main View)
├── Project Cards (expandable)
│   ├── Project name + health + session dots
│   ├── LIST OF PARENT TASKS (one per session)
│   │   ├── ● dashboard-ux-redesign    3/5 subtasks  session-abc
│   │   ├── ● auto-delegation-hook     1/4 subtasks  session-def
│   │   └── ● test-coverage-fix        2/2 subtasks  session-ghi
│   └── Aggregate metrics (tokens, cost, avg quality)
├── Agent Pool Status
└── Alerts Summary

LEVEL 2: PROJECT DRILL-DOWN (expand project card)
├── SESSION CARDS (one per session)
│   ├── Parent task name + progress bar
│   ├── Context % + Quality score
│   ├── SUBTASK LIST
│   │   ├── Subtask name + status (ready/in-progress/blocked)
│   │   ├── Claimed by (if delegated to child agent)
│   │   └── Progress indicator
│   └── Actions: [View Details] [Pause] [End]
└── Project-level quick actions

LEVEL 3: SESSION DETAIL
├── Full metrics
├── Task hierarchy (parent → children → grandchildren)
├── Log viewer
└── Delegation tree

LEVEL 4: METRIC DRILL-DOWNS
├── Quality → 6-dimension radar
├── Confidence → Signals breakdown
├── Tasks → D3.js dependency graph
└── Agents → Lineage tree
```

### 2. Three New API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/api/agent-pool/status` | Agent lineage + delegation metrics + hierarchy tree |
| `/api/overview` | Fleet-level aggregated view for dashboard home |
| `/ws/fleet` | WebSocket for real-time delegation/alert events |

### 3. Countdown Timers

- **5-Hour Rate Limit**: Progress bar + "2h 15m remaining" + reset time
- **Session Context**: "~45 min until auto-compact" + save button
- Data source: `/api/usage/limits` `resetIn` field (milliseconds)

### 4. Agent Lineage Visualization

```
● session-abc123 (root)
│  Task: dashboard-ux-redesign
│
├── ● agent-def456 (depth: 1, PARALLEL)
│   ├── ● agent-ghi789 (depth: 2) ✓ COMPLETED
│   └── ● agent-jkl012 (depth: 2) ... RUNNING
│
└── ● agent-mno345 (depth: 1, REVIEW)
       Status: RUNNING
```

### 5. Smart Defaults System

Auto-surface metrics based on current state:

| Condition | Surfaced Metric |
|-----------|-----------------|
| 5-hour limit > 80% | Rate limit countdown prominent |
| Session context > 75% | Context timer + save button |
| Quality < 80 | Quality breakdown drill-down |
| Confidence < 0.7 | Confidence signals visible |
| Task stuck > 10min | Stuck task alert |
| Delegation depth > 2 | Lineage tree expanded |

### 6. Alert System

| Alert Type | Level | Notification |
|------------|-------|--------------|
| Token Exhaustion | Critical | Banner + Sound |
| Rate Limit | Critical | Banner + Sound |
| Quality Drop | Warning | Toast |
| Task Stuck | Warning | Banner (no sound) |
| Session Started | Info | Toast |
| Task Completed | Info | Toast |

---

## Implementation Phases

| Phase | Focus | Estimate |
|-------|-------|----------|
| **Phase 1** | Core Infrastructure (new endpoints, WebSocket) | 3-4 days |
| **Phase 2** | Global Header + Alerts (countdown, banner, toast) | 2-3 days |
| **Phase 3** | Fleet Overview (project cards, agent pool) | 3-4 days |
| **Phase 4** | Agent Lineage (tree visualization) | 2-3 days |
| **Phase 5** | Polish + Smart Defaults | 2-3 days |

---

## Acceptance Criteria

- [ ] Fleet overview shows all projects/sessions at a glance
- [ ] 5-hour countdown timer with remaining time visible
- [ ] Session context countdown shows time until auto-compact
- [ ] Agent lineage tree shows full parent-child delegation hierarchy
- [ ] Alert banner with sound for critical alerts
- [ ] Toast notifications for other events
- [ ] Smart defaults auto-surface relevant metrics
- [ ] `/api/agent-pool/status` endpoint operational
- [ ] `/api/overview` endpoint operational
- [ ] `/ws/fleet` WebSocket channel operational
- [ ] Keyboard navigation works
- [ ] Overview loads in <500ms, drill-downs in <200ms

---

## Design Documents

| Document | Path |
|----------|------|
| Full Design Spec | `docs/design/DASHBOARD-FLEET-MANAGEMENT-DESIGN.md` |
| Original UX Design | `docs/design/DASHBOARD-UX-REDESIGN.md` |
| Validation Audit | `docs/audits/dashboard-validation-2025-12-31.md` |

---

## Next Steps

1. Begin Phase 1: Implement `/api/agent-pool/status` endpoint
2. Implement `/api/overview` endpoint
3. Add WebSocket channel `/ws/fleet`
4. Proceed to Phase 2: Header + Alerts

