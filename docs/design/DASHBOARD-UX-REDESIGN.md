# Dashboard UX Redesign Specification

**Status**: Design Phase
**Priority**: High
**Created**: 2025-12-31
**Based on**: Dashboard Validation Audit (Session 68)

---

## Executive Summary

The dashboard has 84 API endpoints with valuable data, but only ~15 are currently visualized. The current UI tries to show everything on one page, leading to information overload. This specification proposes a progressive disclosure pattern with drill-downs for detailed data.

---

## Current State Analysis

### What's Working
- Session list/detail split layout
- Real-time SSE updates
- Traffic light health indicators
- Usage limit badges

### Problems Identified
1. **Quality Score Over-emphasized** - Large card, but not immediately actionable
2. **Usage % Under-emphasized** - Most important metric is a small bar
3. **No Alerts Display** - Critical rate alerts (`128/hr`) not visible
4. **No Confidence Score** - Important metric missing entirely
5. **No Artifacts View** - Can't see session output files
6. **Information Overload** - All data attempts to fit on main page
7. **No Progressive Disclosure** - Missing drill-down pattern

---

## Proposed Design

### Design Principles

1. **Progressive Disclosure**: Show summary on main page, details in drill-downs
2. **Actionable First**: Prioritize metrics that require user action
3. **Consistent Patterns**: Same drill-down behavior across all metrics
4. **Performance**: Lazy-load drill-down data on open

### Information Hierarchy

```
LEVEL 1: Main Page (At-a-glance, always visible)
├── Global Status Bar
│   ├── Usage % (PRIMARY) - Large, color-coded
│   ├── Rate Limit Alert Banner (when critical)
│   ├── Account: $X.XX | Y sessions
│   └── Quick Actions: Settings, Classic View
│
├── Session List (Left Panel)
│   ├── Project groups (collapsible)
│   └── Session cards with health indicator
│
└── Session Detail (Right Panel)
    ├── Metrics Row
    │   ├── Usage % (gauge)
    │   ├── Phase/Iteration
    │   ├── Progress (X/Y tasks)
    │   ├── Quality Score (clickable → drill-down)
    │   └── Confidence (clickable → drill-down)
    ├── Current Task Card
    ├── Quick Actions (pause/resume/skip/end)
    └── Tabs: Queue | Hierarchy | Logs | Lessons

LEVEL 2: Drill-downs (Click to open, modal/slide-out)
├── Quality Score → 6-dimension radar/bar chart
├── Confidence → Signals breakdown
├── Usage → Historical chart + all limits + alerts
├── Tasks → D3.js dependency graph
├── Artifacts → Sortable file table
├── Alerts → Full timeline with filtering
└── Notifications → Config + stats
```

---

## Component Specifications

### 1. Global Status Bar (Redesigned)

**Current**: Small usage badge in header
**Proposed**: Prominent usage indicator + alert banner

```
┌─────────────────────────────────────────────────────────────────────┐
│ [⚠️ ALERT: Rate 128/hr - Slow down to avoid limit ] ← Dismissable  │
├─────────────────────────────────────────────────────────────────────┤
│ 🟢 Command Center                                                   │
│                                                                     │
│ USAGE          ACCOUNT                                     ACTIONS  │
│ ████████░░ 58% $189 total | 1047 sessions | 7 projects   ⚙️  📊     │
│ 5h: 58/300    Pace: OK                                             │
└─────────────────────────────────────────────────────────────────────┘
```

**Behavior**:
- Alert banner appears when `/api/usage/alerts` returns `severity: critical`
- Usage bar is large and color-coded (green → yellow → red)
- Account summary from `/api/account`
- Click usage → opens Usage Drill-down

### 2. Metrics Row (Session Detail)

**Current**: Quality score large, usage small
**Proposed**: Usage prominent, quality clickable

```
┌──────────────────────────────────────────────────────────────┐
│  USAGE       PHASE        PROGRESS      QUALITY   CONFIDENCE │
│  ████░ 52%   impl/3       12/15 tasks   91 →      healthy →  │
│  105k tokens                            (click)    (click)    │
└──────────────────────────────────────────────────────────────┘
```

**Behavior**:
- Quality Score: Click opens radar chart drill-down
- Confidence: Click opens signals breakdown
- Both show just number/status on main page

### 3. Quality Score Drill-down

**Trigger**: Click quality score card
**Data Source**: `/api/execution/scores`

```
┌─────────────────────────────────────────────────────┐
│ Quality Score Breakdown                         ✕   │
├─────────────────────────────────────────────────────┤
│                                                     │
│    Architecture ████████████████████ 95            │
│    API Contracts ██████████████████ 90             │
│    Data Models ████████████████░░ 88               │
│    Security ███████████████████ 92                 │
│    Testability ████████████████████ 95             │
│    Scalability █████████████████ 85                │
│                                                     │
│    ─────────────────────────────────               │
│    Total: 91/100 | Recommendation: PROCEED         │
│                                                     │
│    Improvements:                                    │
│    • Add pre-commit hook for verification          │
│    • Add dashboard widget for status               │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 4. Confidence Drill-down (NEW)

**Trigger**: Click confidence indicator
**Data Source**: `/api/confidence`

```
┌─────────────────────────────────────────────────────┐
│ Confidence Analysis                             ✕   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Level: HEALTHY                                     │
│                                                     │
│  Signals:                                           │
│    Quality Score    ████████░░ 80%                 │
│    Velocity         ██████░░░░ 60%                 │
│    Iterations       ████░░░░░░ 40%                 │
│    Error Rate       █░░░░░░░░░ 10% (good)          │
│    Historical       ███████░░░ 70%                 │
│                                                     │
│  Last Update: 2 minutes ago                         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 5. Tasks Drill-down (Dependency Graph)

**Trigger**: Click tasks card or "View Graph" button
**Data Source**: `/api/tasks/graph`

```
┌─────────────────────────────────────────────────────┐
│ Task Dependency Graph                           ✕   │
├─────────────────────────────────────────────────────┤
│                                                     │
│     [research]                                      │
│        │                                            │
│        ▼                                            │
│     [design] ────────► [implementation]             │
│                              │                      │
│                              ▼                      │
│                         [testing]                   │
│                              │                      │
│                              ▼                      │
│                        [validation]                 │
│                                                     │
│  Legend: ● Ready  ● In Progress  ● Completed        │
│          ● Blocked  ── Requires  --- Related        │
│                                                     │
│  Critical Path: 5 tasks                             │
│  [Export DOT] [Open Full Screen]                    │
└─────────────────────────────────────────────────────┘
```

**Implementation**: Use D3.js force-directed graph with existing `/api/tasks/graph` data.

### 6. Artifacts Drill-down (NEW)

**Trigger**: Click "Artifacts" tab or card
**Data Source**: `/api/artifacts`

```
┌─────────────────────────────────────────────────────┐
│ Session Artifacts (12 files)                    ✕   │
├─────────────────────────────────────────────────────┤
│ [Filter: All ▼] [Sort: Recent ▼]                    │
├─────────────────────────────────────────────────────┤
│ Type │ Name                    │ Phase │ Actions    │
├──────┼─────────────────────────┼───────┼────────────┤
│ 📄   │ task-manager.js         │ impl  │ 👁️ 🚀      │
│ 📄   │ dashboard.html          │ impl  │ 👁️ 🚀      │
│ 📊   │ audit-report.md         │ valid │ 👁️ 🚀      │
│ 🧪   │ test-results.json       │ test  │ 👁️ 🚀      │
└─────────────────────────────────────────────────────┘
```

### 7. Alerts Panel (NEW)

**Trigger**: Click alert banner or alerts icon
**Data Source**: `/api/alerts`, `/api/usage/alerts`

```
┌─────────────────────────────────────────────────────┐
│ Alerts & Notifications                          ✕   │
├─────────────────────────────────────────────────────┤
│ [All] [Critical] [Warning] [Info]                   │
├─────────────────────────────────────────────────────┤
│ 🔴 CRITICAL  Rate too high: 128/hr       2m ago    │
│ 🟡 WARNING   Context at 80.6%            5m ago    │
│ 🔵 INFO      New session started         10m ago   │
│ 🟡 WARNING   Approaching daily limit     1h ago    │
└─────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Alert Banner + Usage Prominence (1-2 days)
- [ ] Add alert banner component
- [ ] Fetch `/api/usage/alerts` and display when critical
- [ ] Resize usage indicator in status bar
- [ ] Add account summary from `/api/account`

### Phase 2: Drill-down Infrastructure (2-3 days)
- [ ] Create reusable drill-down/modal component
- [ ] Add click handlers to quality score, usage
- [ ] Implement slide-out or modal behavior
- [ ] Handle keyboard (ESC to close)

### Phase 3: Implement Drill-downs (3-5 days)
- [ ] Quality Score drill-down with bar chart
- [ ] Confidence drill-down (new)
- [ ] Usage drill-down with historical
- [ ] Tasks drill-down with D3.js graph
- [ ] Artifacts drill-down with table

### Phase 4: Polish (2-3 days)
- [ ] Responsive design for mobile
- [ ] Animation/transitions
- [ ] Accessibility audit
- [ ] Performance optimization (lazy loading)

---

## Technical Requirements

### New API Integrations
| Endpoint | Component | Lazy Load? |
|----------|-----------|------------|
| `/api/account` | Status bar | No (always load) |
| `/api/usage/alerts` | Alert banner | No (always load) |
| `/api/confidence` | Confidence drill-down | Yes |
| `/api/execution/scores` | Quality drill-down | Yes |
| `/api/tasks/graph` | Tasks drill-down | Yes |
| `/api/artifacts` | Artifacts drill-down | Yes |
| `/api/alerts` | Alerts panel | Yes |

### Libraries to Add
- **D3.js**: For task dependency graph (already in task-graph.html)
- **Chart.js**: For quality score bar chart (optional, can use CSS)

### Performance Considerations
- Lazy-load drill-down data only when opened
- Cache drill-down data for 30 seconds
- Use CSS animations vs JavaScript for transitions
- Virtual scrolling for large artifact lists

---

## Accessibility Requirements

- [ ] All drill-downs keyboard accessible
- [ ] ARIA labels for interactive elements
- [ ] Focus trap in modals
- [ ] Color contrast for alerts
- [ ] Screen reader announcements for status changes

---

## Success Metrics

1. **Usability**: User can find any metric in <3 clicks
2. **Clarity**: Critical alerts visible immediately
3. **Performance**: Drill-downs open in <200ms
4. **Coverage**: All 10 high-priority endpoints visualized

---

## Appendix: API Data Shapes

### `/api/account`
```json
{
  "totalInputTokens": 477745,
  "totalOutputTokens": 470958,
  "totalCost": 188.94,
  "sessionCount": 1047,
  "projectCount": 7
}
```

### `/api/usage/alerts`
```json
{
  "alerts": [{"window": "fiveHour", "severity": "critical", "message": "Rate too high: 128/hr"}],
  "nearLimit": false
}
```

### `/api/confidence`
```json
{
  "confidence": 0.85,
  "level": "healthy",
  "signals": {"qualityScore": 80, "velocity": 60, "iterations": 40, "errorRate": 10, "historical": 70}
}
```

### `/api/execution/scores`
```json
{
  "phase": "design",
  "scores": {"architectureComplete": 95, "apiContracts": 90, "dataModels": 88, "securityDesign": 92, "testabilityDesign": 95, "scalabilityPlan": 85},
  "totalScore": 91,
  "recommendation": "proceed"
}
```

### `/api/tasks/graph`
```json
{
  "graph": {"nodes": [...], "links": [...]},
  "statistics": {"totalNodes": 5, "totalLinks": 2, "criticalPath": ["Task Name"]}
}
```

### `/api/artifacts`
```json
{
  "project": "multi-agent-template",
  "count": 12,
  "artifacts": [{"id": "...", "name": "file.js", "type": "code", "phase": "impl"}]
}
```
