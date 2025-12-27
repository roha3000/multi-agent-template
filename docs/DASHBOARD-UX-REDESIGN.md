# Dashboard UX Redesign: Command Center for Multi-Session Orchestration

**Version**: 2.0
**Created**: 2025-12-26
**Status**: DESIGN APPROVED
**Authors**: UX Research Team (Claude Agents)

---

## Executive Summary

This document presents a comprehensive UX redesign for the Multi-Agent Template dashboard, transforming it from a single-session context monitor into a **Command Center** for monitoring all autonomous orchestration sessions across projects. The redesign prioritizes:

1. **Birds-eye view** of all active sessions with key metrics
2. **Progressive disclosure** for drilling into session details
3. **Real-time monitoring** with live log streaming
4. **Clear information hierarchy** with critical metrics above the fold

---

## Part 1: Current State Analysis

### Current Implementation Inventory

| Component | File | Current State |
|-----------|------|---------------|
| Main Dashboard | `global-dashboard.html` | 2186 lines, single-page monolith |
| Backend | `global-context-manager.js` | SSE streaming, 3-second interval |
| Dashboard Manager | `.claude/core/dashboard-manager.js` | Session tracking, metrics aggregation |
| Session Tracker | `.claude/core/claude-session-tracker.js` | Token usage tracking |

### Current Features (Working)

| Feature | Status | Notes |
|---------|--------|-------|
| Context % remaining | Working | Large prominent display |
| Alert banners | Working | Emergency/Critical/Warning states |
| Session series panel | Working | Continuous loop metrics |
| Execution state (phase/scores) | Working | Phase badge, quality gauge |
| Todo progress | Working | Checkbox list with progress bar |
| Backlog tasks | Working | In-progress and ready tasks |
| Confidence gauge | Working | 5-signal circular gauge |
| Competitive planning | Working | 3-strategy comparison cards |
| Complexity indicator | Working | 5-star rating with tooltip |

### Current Gaps & UX Issues

| Issue | Impact | Priority |
|-------|--------|----------|
| No cross-project summary view | Users must switch browser tabs per project | CRITICAL |
| No session drill-down | Can't see details without context switching | CRITICAL |
| No live log viewer | Users run `tail -f` in separate terminal | HIGH |
| Single-session focus | Dashboard shows one project at a time | HIGH |
| Panel ordering not optimal | Context % is buried below series panel | MEDIUM |
| No navigation | Flat layout, no hierarchy | MEDIUM |
| Information overload | All panels visible, no progressive disclosure | MEDIUM |

---

## Part 2: User Requirements Analysis

### Primary User Persona
**Power User**: Developer running 2-5 autonomous orchestrator sessions across different projects simultaneously, needs to monitor health and progress without context switching.

### Key User Stories

1. **As a user**, I want to see all active sessions at a glance so I can identify which needs attention
2. **As a user**, I want to drill into any session for detailed metrics without losing context
3. **As a user**, I want to monitor live orchestrator logs to debug issues in real-time
4. **As a user**, I want to see token usage and cost across all sessions
5. **As a user**, I want visual alerts when any session needs intervention

### Critical Metrics (Must be visible at top level)

| Metric | Why Critical | Display Format |
|--------|-------------|----------------|
| Active session count | Immediate awareness | Large number with status indicator |
| Context % per session | Prevent auto-compaction | Progress bar with color coding |
| **Usage limits (5h/daily/weekly)** | **Prevent rate limiting** | **3 progress bars with time remaining** |
| Current task per session | Know what's happening | Task title with phase badge |
| Quality score | Task completion likelihood | Gauge or number |
| Total cost today | Budget awareness | Currency with trend |
| Errors/Alerts | Immediate action needed | Red badge or banner |

---

## Part 3: Information Architecture

### Proposed Hierarchy (3-Level)

```
Level 1: Command Center (Global Summary)
├── Global Metrics Bar (always visible)
├── Active Sessions Grid (clickable cards)
├── Recent Completions Feed
└── Alert Banner (when needed)

Level 2: Session Detail View (Project Focus)
├── Session Header (project name, status, actions)
├── Current Task Panel (expanded view)
├── Task Queue Panel
├── Metrics Dashboard (context, tokens, cost)
├── Live Log Viewer (collapsible)
└── Confidence & Quality Gauges

Level 3: Component Deep-Dives (Modal/Expandable)
├── Full Task History
├── Quality Score Breakdown
├── Plan Comparison Details
└── Full Log Archive
```

### Navigation Pattern

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [Logo] Command Center          [Session 1] [Session 2] [+] [Settings] [?]  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Breadcrumb: Command Center > Session #5: multi-agent-template             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 4: Wireframes & Visual Design

### 4.1 Command Center (Level 1) - Birds Eye View

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ COMMAND CENTER                                     [Auto-refresh: 3s] [Settings]    │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │
│ │   3         │ │   7 / 12    │ │   89%       │ │  $12.47     │ │   0         │   │
│ │  Active     │ │  Tasks Done │ │  Avg Health │ │  Today      │ │  Alerts     │   │
│ │  Sessions   │ │  Today      │ │  Score      │ │  (↑ $2.30)  │ │             │   │
│ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │
│                                                                                     │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ USAGE LIMITS                                                    [Refresh: 1m]      │
│                                                                                     │
│ ┌───────────────────────────────┐ ┌───────────────────────────────┐ ┌─────────────┐│
│ │ 5-HOUR WINDOW                 │ │ DAILY LIMIT                   │ │ WEEKLY      ││
│ │ ████████████░░░░░░░░ 62%      │ │ ██████░░░░░░░░░░░░░░ 31%      │ │ ██░░░░ 18%  ││
│ │ 186 / 300 messages            │ │ 465 / 1500 messages           │ │ 1.2K / 7K   ││
│ │ Resets in: 2h 14m             │ │ Resets in: 8h 32m             │ │ Resets: Mon ││
│ │                               │ │                               │ │             ││
│ │ ⚠ Pace: ~45/hr (safe: 60/hr) │ │ Projected: 720 (48% of limit) │ │             ││
│ └───────────────────────────────┘ └───────────────────────────────┘ └─────────────┘│
│                                                                                     │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ ACTIVE SESSIONS                                                   [View: Grid ▼]   │
│                                                                                     │
│ ┌─────────────────────────────────────────┐ ┌─────────────────────────────────────┐│
│ │ multi-agent-template           ● ACTIVE │ │ api-gateway               ● ACTIVE  ││
│ │                                         │ │                                     ││
│ │ Context: ████████████░░░░ 72%  [WARN]   │ │ Context: ██████░░░░░░░░░░ 38%  [OK] ││
│ │                                         │ │                                     ││
│ │ Current: dashboard-log-viewer           │ │ Current: auth-middleware            ││
│ │ Phase: implement • Quality: 85/100      │ │ Phase: test • Quality: 92/100       ││
│ │                                         │ │                                     ││
│ │ Next: dashboard-autonomous-tracking     │ │ Next: rate-limiter                  ││
│ │                                         │ │                                     ││
│ │ ┌─────────────────────────────────────┐ │ │ ┌─────────────────────────────────┐ ││
│ │ │ Tokens: 156K  Cost: $3.21  Run: 12m │ │ │ │ Tokens: 89K   Cost: $1.87  Run: 8m│││
│ │ └─────────────────────────────────────┘ │ │ └─────────────────────────────────┘ ││
│ │                                         │ │                                     ││
│ │ [View Details]  [View Log]  [Pause]     │ │ [View Details]  [View Log]  [Pause] ││
│ └─────────────────────────────────────────┘ └─────────────────────────────────────┘│
│                                                                                     │
│ ┌─────────────────────────────────────────┐                                        │
│ │ docs-site                      ○ IDLE   │                                        │
│ │                                         │                                        │
│ │ Context: ████░░░░░░░░░░░░ 22%  [OK]     │                                        │
│ │                                         │                                        │
│ │ Last: content-migration (completed)     │                                        │
│ │ Quality: 94/100 • Completed: 2h ago     │                                        │
│ │                                         │                                        │
│ │ [Resume]  [View History]                │                                        │
│ └─────────────────────────────────────────┘                                        │
│                                                                                     │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ RECENT COMPLETIONS                                              [View All History] │
│                                                                                     │
│ ┌───────────┬─────────────────────────────┬───────┬──────────┬────────────────────┐│
│ │ Project   │ Task                        │ Score │ Cost     │ Completed          ││
│ ├───────────┼─────────────────────────────┼───────┼──────────┼────────────────────┤│
│ │ template  │ swarm-performance-testing   │ 95    │ $0.89    │ 8 minutes ago      ││
│ │ template  │ swarm-database-schema       │ 92    │ $1.23    │ 1 hour ago         ││
│ │ api-gw    │ database-connection-pool    │ 88    │ $0.67    │ 2 hours ago        ││
│ └───────────┴─────────────────────────────┴───────┴──────────┴────────────────────┘│
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Design Rationale - Command Center

| Element | Design Choice | Rationale |
|---------|--------------|-----------|
| Global Metrics Bar | 5 large stat cards | Instant awareness of overall health |
| **Usage Limits Panel** | 3-column with progress bars | **Prevent rate limiting, show reset times** |
| Session Cards | Grid layout | Compare sessions side-by-side |
| Context Progress Bar | Inline with color | Most critical metric, visible at glance |
| Current/Next Task | Text with phase badge | Know exactly what's happening |
| Action Buttons | Bottom of card | Progressive disclosure, don't clutter |
| Recent Completions | Table at bottom | Historical reference, lower priority |

### Usage Limits Panel Details

| Element | Content | Rationale |
|---------|---------|-----------|
| 5-Hour Window | Current/max messages, reset countdown | Primary rate limit users hit |
| Daily Limit | Current/max, projected usage | Plan workload across day |
| Weekly Limit | Current/max, reset day | Strategic capacity planning |
| Pace Indicator | Messages/hour vs safe rate | Early warning for throttling |
| Projection | Estimated daily usage at current pace | Avoid hitting limits |

#### Color Coding for Usage Limits

| Usage % | Color | State |
|---------|-------|-------|
| 0-50% | Green (#3fb950) | Safe - plenty of capacity |
| 50-75% | Yellow (#d29922) | Caution - moderate usage |
| 75-90% | Orange (#f0883e) | Warning - approaching limit |
| 90-100% | Red (#f85149) | Critical - near/at limit |

### 4.2 Session Detail View (Level 2) - Drill Down

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ ← Back to Command Center                                        [Pause] [End]      │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│ multi-agent-template                                                  ● RUNNING    │
│ C:\Users\roha3\Claude\multi-agent-template                                          │
│                                                                                     │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│ ┌─────────────────────────┐ ┌─────────────────────────┐ ┌─────────────────────────┐│
│ │ CONTEXT                 │ │ SESSION                 │ │ COST                    ││
│ │ ████████████░░░░ 72%    │ │ Runtime: 12m 34s        │ │ $3.21 / $10.00 budget   ││
│ │ 144K / 200K tokens      │ │ Iteration: 2 of 10      │ │ ███████░░░ 32%          ││
│ │ ~56K until compact      │ │ Phase: implement        │ │ Tokens: 156K in / 24K out││
│ └─────────────────────────┘ └─────────────────────────┘ └─────────────────────────┘│
│                                                                                     │
├────────────────────────────────────────────┬────────────────────────────────────────┤
│ CURRENT TASK                               │ QUALITY & CONFIDENCE                   │
│                                            │                                        │
│ dashboard-log-viewer                       │        ┌─────┐                         │
│ Add Real-Time Log Viewer to Dashboard      │        │ 85  │ Quality Score           │
│                                            │        └─────┘                         │
│ Phase: implement                           │                                        │
│ Priority: high • Estimate: 2h              │ ┌──────────┐  Confidence: 78%          │
│                                            │ │    ◐     │  Status: Healthy          │
│ ACCEPTANCE CRITERIA           Progress     │ └──────────┘                           │
│ ┌─────────────────────────────────────┐   │                                        │
│ │ [✓] Dashboard shows 'View Log' btn  │   │ Signals:                               │
│ │ [✓] API endpoint streams via SSE    │   │ • Quality:    ████████░░ 85%           │
│ │ [✓] Log viewer with auto-scroll     │   │ • Velocity:   ██████░░░░ 62%           │
│ │ [ ] Historical session logs         │   │ • Iterations: ███████░░░ 70%           │
│ │ [ ] Streaming indicator             │   │ • Error Rate: █░░░░░░░░░ 8%            │
│ │                                     │   │ • Historical: ████████░░ 82%           │
│ │ ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░ 60%           │   │                                        │
│ └─────────────────────────────────────┘   │                                        │
│                                            │                                        │
├────────────────────────────────────────────┴────────────────────────────────────────┤
│ TASK QUEUE                                                        [Manage Queue]   │
│                                                                                     │
│ ┌────┬─────────────────────────────────────┬──────────┬──────────┬─────────────────┐│
│ │ #  │ Task                                │ Priority │ Phase    │ Estimate        ││
│ ├────┼─────────────────────────────────────┼──────────┼──────────┼─────────────────┤│
│ │ 1  │ dashboard-autonomous-tracking       │ critical │ implement│ 3h         NEXT ││
│ │ 2  │ dashboard-live-task-refresh         │ high     │ implement│ 1h              ││
│ │ 3  │ dashboard-command-center            │ critical │ implement│ 4h              ││
│ │ 4  │ swarm-telemetry-integration         │ medium   │ design   │ 3h              ││
│ └────┴─────────────────────────────────────┴──────────┴──────────┴─────────────────┘│
│                                                                                     │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ LIVE LOG VIEWER                                        [Auto-scroll ✓] [Pause]     │
│ ┌─────────────────────────────────────────────────────────────────────────────────┐│
│ │ 14:32:05 [orchestrator] Starting task: dashboard-log-viewer                     ││
│ │ 14:32:06 [orchestrator] Phase: implement, Iteration: 2                          ││
│ │ 14:32:08 [agent] Analyzing acceptance criteria...                               ││
│ │ 14:32:12 [agent] Reading file: global-context-manager.js                        ││
│ │ 14:32:15 [agent] Creating SSE endpoint for log streaming                        ││
│ │ 14:32:18 [agent] Writing file: global-context-manager.js                        ││
│ │ 14:32:22 [orchestrator] Quality check: 82/100 (threshold: 80)                   ││
│ │ 14:32:23 [orchestrator] Acceptance: 3/5 criteria met                            ││
│ │ ● Streaming...                                                                  ││
│ └─────────────────────────────────────────────────────────────────────────────────┘│
│ Lines: 1,247 • Session: 5 • Log: .claude/logs/session-5.log                        │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Design Rationale - Session Detail

| Element | Design Choice | Rationale |
|---------|--------------|-----------|
| Back button | Top left | Clear navigation, standard pattern |
| 3-column metrics | Context/Session/Cost | Most critical info at top |
| Split panel | Task + Quality side-by-side | Both important, avoid scrolling |
| Acceptance checklist | Checkboxes with progress | Visual completion tracking |
| Task Queue | Table with next indicator | Clear priority order |
| Live Log | Bottom, collapsible | Available but not overwhelming |
| Log controls | Auto-scroll, pause | User control over streaming |

### 4.3 Live Log Viewer (Expanded Modal)

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ LIVE LOG - Session 5: multi-agent-template                              [X Close]  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ [Session 5 ▼] [Filter: All ▼] [Search: ___________] [Auto-scroll ✓] [Pause] [Clear]│
├─────────────────────────────────────────────────────────────────────────────────────┤
│ │                                                                                 │ │
│ │ 14:32:01 [INFO ] [orchestrator] Session 5 started                               │ │
│ │ 14:32:02 [INFO ] [orchestrator] Loading task: dashboard-log-viewer              │ │
│ │ 14:32:03 [INFO ] [orchestrator] Phase: implement, Quality threshold: 90         │ │
│ │ 14:32:04 [DEBUG] [task-manager] Task status: in_progress                        │ │
│ │ 14:32:05 [INFO ] [agent] Executing implementation plan...                       │ │
│ │ 14:32:06 [DEBUG] [agent] Tool call: Read global-context-manager.js              │ │
│ │ 14:32:08 [INFO ] [agent] Found existing SSE endpoint at /api/events             │ │
│ │ 14:32:10 [DEBUG] [agent] Analyzing file structure...                            │ │
│ │ 14:32:12 [INFO ] [agent] Creating new endpoint: /api/logs/:session              │ │
│ │ 14:32:14 [DEBUG] [agent] Tool call: Edit global-context-manager.js              │ │
│ │ 14:32:18 [INFO ] [agent] Added fs.watch for tail -f behavior                    │ │
│ │ 14:32:20 [WARN ] [security] Path validation triggered for log access            │ │
│ │ 14:32:22 [INFO ] [agent] Security check passed                                  │ │
│ │ 14:32:25 [INFO ] [quality] Running quality gate check...                        │ │
│ │ 14:32:28 [INFO ] [quality] Score: 82/100 (completeness: 75, tests: 80)          │ │
│ │ 14:32:30 [INFO ] [orchestrator] Iteration 2 complete, continuing...             │ │
│ │ ● Live - streaming new entries...                                               │ │
│ │                                                                                 │ │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ Lines: 1,247 │ Errors: 0 │ Warnings: 1 │ Log size: 245 KB                          │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Log Viewer Features

| Feature | Implementation | Rationale |
|---------|---------------|-----------|
| Session selector | Dropdown | Quick switch between session logs |
| Filter | Log level dropdown | Focus on errors or specific types |
| Search | Text input | Find specific entries |
| Auto-scroll | Toggle checkbox | Follow live updates or review history |
| Pause | Button | Freeze stream for investigation |
| Color coding | By log level | Visual severity at a glance |
| Line count | Footer stat | Know log size |
| Error/Warning count | Footer badges | Quick health check |

---

## Part 5: Key Metrics & Data Sources

### Metrics Hierarchy

#### Tier 1: Always Visible (Global Metrics Bar + Usage Limits)

| Metric | Source | Update Frequency |
|--------|--------|------------------|
| Active sessions | Session registry | Real-time (SSE) |
| Tasks completed today | TaskManager | Real-time |
| Average health score | ConfidenceMonitor | 3 seconds |
| Total cost today | UsageTracker | Real-time |
| Active alerts | Alert system | Real-time |
| **5-hour window usage** | **UsageLimitTracker** | **1 minute** |
| **Daily limit usage** | **UsageLimitTracker** | **1 minute** |
| **Weekly limit usage** | **UsageLimitTracker** | **1 minute** |
| **Reset countdowns** | **Computed from timestamps** | **1 minute** |
| **Usage pace/projection** | **Computed from history** | **1 minute** |

#### Tier 2: Session Card Level

| Metric | Source | Update Frequency |
|--------|--------|------------------|
| Context % | global-context-manager | 3 seconds |
| Current task | TaskManager | Real-time |
| Task phase | autonomous-orchestrator | Real-time |
| Quality score | QualityGates | On iteration |
| Next task | TaskManager | Real-time |
| Session cost | UsageTracker | Real-time |
| Run time | Session start time | Computed |

#### Tier 3: Detail View Only

| Metric | Source | Update Frequency |
|--------|--------|------------------|
| Acceptance criteria | TaskManager | On change |
| Confidence signals | ConfidenceMonitor | 3 seconds |
| Full task queue | TaskManager | Real-time |
| Token breakdown | UsageTracker | Real-time |
| Log stream | Session log file | Real-time |
| Phase history | State file | On phase change |
| Error details | Logger | Real-time |

### Data Flow Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Orchestrator    │────▶│ Dashboard API    │────▶│ SSE Stream      │
│ (per session)   │     │ /api/sessions/*  │     │ /api/events     │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                       │                        │
        │  POST state           │  GET summary           │  broadcast
        ▼                       ▼                        ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Session         │     │ Session          │     │ Dashboard UI    │
│ Registry        │────▶│ Aggregator       │────▶│ (JavaScript)    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                                                │
        │                                                │
        ▼                                                ▼
┌─────────────────┐                              ┌─────────────────┐
│ Log Watcher     │─────────────────────────────▶│ Log Viewer      │
│ (fs.watch)      │      SSE: /api/logs/:id      │ Component       │
└─────────────────┘                              └─────────────────┘
```

---

## Part 6: Color System & Visual Language

### Status Colors

| Status | Color | Hex | Usage |
|--------|-------|-----|-------|
| Healthy/OK | Green | #3fb950 | Normal operation |
| Warning | Yellow | #d29922 | Approaching threshold |
| Critical | Red | #f85149 | Needs attention soon |
| Emergency | Bright Red | #ff6b6b | Immediate action |
| Info/Active | Blue | #58a6ff | Running, in progress |
| Idle | Gray | #8b949e | Inactive, completed |

### Progress Bar States

```css
/* Context usage thresholds */
.progress-ok      { background: #3fb950; }  /* 0-50% used */
.progress-warning { background: #d29922; }  /* 50-65% used */
.progress-critical{ background: #f85149; }  /* 65-75% used */
.progress-emergency{ background: #ff6b6b; } /* 75%+ used */
```

### Iconography

| Icon | Meaning | Context |
|------|---------|---------|
| ● (filled dot) | Active/Running | Session status |
| ○ (empty dot) | Idle/Paused | Session status |
| ▓ | Progress fill | Progress bars |
| ✓ | Complete | Checkboxes, tasks |
| ⚠ | Warning | Alerts |
| ✕ | Error/Close | Alerts, modals |
| → | Next | Navigation, queues |
| ← | Back | Navigation |

---

## Part 7: Responsive Behavior

### Breakpoints

| Breakpoint | Width | Layout Changes |
|------------|-------|----------------|
| Desktop | >1200px | Full 3-column grid |
| Tablet | 768-1200px | 2-column grid |
| Mobile | <768px | Single column, stacked |

### Mobile Adaptations

1. **Global metrics**: Horizontal scroll carousel
2. **Session cards**: Full width, stacked vertically
3. **Log viewer**: Full screen modal
4. **Navigation**: Hamburger menu with session list

---

## Part 8: API Specifications

### New Endpoints Required

```javascript
// Get Claude usage limits (account-level)
GET /api/usage/limits
Response: {
  fiveHour: {
    used: 186,
    limit: 300,
    percent: 62,
    resetAt: "2025-12-26T18:45:00Z",
    resetIn: "2h 14m",
    pace: {
      current: 45,           // messages/hour at current rate
      safe: 60,              // max sustainable rate
      status: "warning"      // ok | warning | critical
    }
  },
  daily: {
    used: 465,
    limit: 1500,
    percent: 31,
    resetAt: "2025-12-27T00:00:00Z",
    resetIn: "8h 32m",
    projected: {
      endOfDay: 720,         // projected usage at current pace
      percentOfLimit: 48
    }
  },
  weekly: {
    used: 1200,
    limit: 7000,
    percent: 17,
    resetAt: "2025-12-30T00:00:00Z",
    resetDay: "Monday"
  },
  lastUpdated: "2025-12-26T16:31:00Z"
}

// Get all sessions summary (Command Center)
GET /api/sessions/summary
Response: {
  globalMetrics: {
    activeCount: 3,
    tasksCompletedToday: 7,
    avgHealthScore: 89,
    totalCostToday: 12.47,
    alertCount: 0
  },
  sessions: [
    {
      id: 5,
      project: "multi-agent-template",
      path: "C:\\Users\\roha3\\Claude\\multi-agent-template",
      status: "active",
      contextPercent: 72,
      currentTask: { id: "dashboard-log-viewer", title: "...", phase: "implement" },
      nextTask: { id: "dashboard-autonomous-tracking", title: "..." },
      qualityScore: 85,
      confidenceScore: 78,
      tokens: 156432,
      cost: 3.21,
      runtime: 754
    }
  ],
  recentCompletions: [
    { project: "template", task: "swarm-performance-testing", score: 95, cost: 0.89, completedAt: "..." }
  ]
}

// Get single session detail
GET /api/sessions/:id
Response: {
  ...full session data...,
  acceptanceCriteria: [ { text: "...", met: true }, ... ],
  taskQueue: [ { id: "...", priority: "critical", phase: "implement", estimate: "3h" } ],
  confidenceSignals: { quality: 85, velocity: 62, iterations: 70, errorRate: 8, historical: 82 },
  phaseHistory: [ { phase: "research", score: 82 }, { phase: "design", score: 88 } ]
}

// Stream session logs
GET /api/logs/:sessionId (SSE)
Event: { type: "log", line: "14:32:05 [orchestrator] Starting task...", level: "INFO" }

// Session control
POST /api/sessions/:id/pause
POST /api/sessions/:id/resume
POST /api/sessions/:id/skip-task
POST /api/sessions/:id/end
```

---

## Part 9: Implementation Phases

### Phase 1: Command Center Core (Priority: CRITICAL)
- [ ] Session registry service
- [ ] Global metrics aggregation
- [ ] Session cards grid
- [ ] Basic navigation (back button)
- [ ] SSE updates for multi-session
- [ ] **Usage limits tracking service**
- [ ] **Usage limits API endpoint**
- [ ] **Usage limits UI panel**

### Phase 2: Session Detail View (Priority: HIGH)
- [ ] Drill-down navigation
- [ ] Full task details panel
- [ ] Confidence/Quality gauges
- [ ] Task queue table
- [ ] Session controls (pause/resume)

### Phase 3: Live Log Viewer (Priority: HIGH)
- [ ] Log streaming endpoint
- [ ] Log viewer component
- [ ] Auto-scroll/pause controls
- [ ] Session selector
- [ ] Log level filtering

### Phase 4: Polish & Enhancement (Priority: MEDIUM)
- [ ] Responsive design
- [ ] Keyboard navigation
- [ ] Search functionality
- [ ] Historical data views
- [ ] Export capabilities

---

## Part 10: Acceptance Criteria

### Command Center
- [ ] Shows all active sessions in grid layout
- [ ] Displays 5 global metrics above the fold
- [ ] Context % progress bar with color coding per session
- [ ] Current and next task visible per session
- [ ] Click session card navigates to detail view
- [ ] Auto-refresh every 3 seconds
- [ ] Recent completions table at bottom

### Usage Limits Panel
- [ ] 5-hour window: shows used/limit messages with progress bar
- [ ] 5-hour window: displays countdown to reset
- [ ] 5-hour window: shows current pace vs safe pace
- [ ] Daily limit: shows used/limit with progress bar
- [ ] Daily limit: displays projected end-of-day usage
- [ ] Weekly limit: shows used/limit with reset day
- [ ] Color coding changes at 50%, 75%, 90% thresholds
- [ ] Alert banner when any limit exceeds 90%
- [ ] Updates every 1 minute (not 3 seconds, to reduce API calls)

### Session Detail
- [ ] Back navigation to Command Center
- [ ] 3-column metrics header (Context/Session/Cost)
- [ ] Acceptance criteria checklist with progress
- [ ] Confidence gauge with 5 signals
- [ ] Task queue table with priorities
- [ ] Pause/Resume/End session controls

### Live Log Viewer
- [ ] Streams log file via SSE
- [ ] Auto-scroll toggle
- [ ] Pause/Resume button
- [ ] Session selector dropdown
- [ ] Log level color coding
- [ ] Line count in footer
- [ ] Green pulsing dot when streaming

---

## Appendix A: Component Specifications

### SessionCard Component

```html
<div class="session-card {status}">
  <header>
    <h3>{project}</h3>
    <span class="status-badge">{status}</span>
  </header>

  <div class="context-bar">
    <div class="progress" style="width: {contextPercent}%"></div>
    <span class="label">{contextPercent}% used</span>
  </div>

  <div class="current-task">
    <span class="phase-badge">{phase}</span>
    <span class="task-title">{currentTask}</span>
  </div>

  <div class="metrics-row">
    <span>Tokens: {tokens}</span>
    <span>Cost: ${cost}</span>
    <span>Run: {runtime}</span>
  </div>

  <footer>
    <button onclick="viewDetails(id)">View Details</button>
    <button onclick="viewLog(id)">View Log</button>
    <button onclick="pause(id)">Pause</button>
  </footer>
</div>
```

### LogViewer Component

```html
<div class="log-viewer">
  <header>
    <select id="session-select">{sessions}</select>
    <select id="level-filter">{levels}</select>
    <input type="search" placeholder="Search..." />
    <label><input type="checkbox" checked /> Auto-scroll</label>
    <button id="pause-btn">Pause</button>
  </header>

  <div class="log-content" id="log-output">
    <!-- Log lines injected here -->
  </div>

  <footer>
    <span>Lines: {lineCount}</span>
    <span class="error-badge">Errors: {errorCount}</span>
    <span class="warn-badge">Warnings: {warnCount}</span>
  </footer>
</div>
```

---

## Appendix B: File Changes Required

| File | Change Type | Description |
|------|-------------|-------------|
| `global-dashboard.html` | Major Refactor | Restructure as Command Center |
| `global-context-manager.js` | Add Endpoints | /api/sessions/*, /api/logs/*, /api/usage/* |
| `.claude/core/dashboard-manager.js` | Enhance | Session registry, aggregation |
| `autonomous-orchestrator.js` | Add Integration | POST state to dashboard |
| NEW: `session-registry.js` | Create | Multi-session management |
| NEW: `log-streamer.js` | Create | Log file watching and SSE |
| NEW: `usage-limit-tracker.js` | Create | Track 5h/daily/weekly Claude limits |

---

## Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2025-12-26 | 2.0 | UX Team | Complete redesign with wireframes |

---

**Next Steps**: Review and approve this design, then proceed to implementation phase with the task breakdown in `tasks.json`.
