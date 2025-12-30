# Dashboard V3 Implementation Plan

## Executive Summary

This plan breaks down Dashboard V3 into 4 phases with 20 discrete tasks. Each phase delivers incremental value and can be paused/resumed independently.

**Total Scope**: ~5,000 lines of code across ~30 files
**Recommended Approach**: Phase 1 first (foundation), then choose Phase 2 or 3 based on priority

---

## Phase Overview

```
Phase 1: Foundation          Phase 2: Visualization       Phase 3: Components         Phase 4: Polish
─────────────────────        ──────────────────────       ───────────────────         ──────────────
[SSE Server]                 [uPlot Integration]          [Hierarchy Viewer]          [Virtual Scroll]
[SQLite Schema]              [D3.js Tree]                 [Context Tracker]           [RAF Batching]
[REST API Base]              [Chart.js Gauges]            [Sessions Panel]            [Responsive]
[In-Memory Cache]            [Sparkline Component]        [Projects Panel]            [Keyboard Nav]
[State Manager]                                           [Task Queue Panel]          [Performance]
                                                          [Performance Panel]
                                                          [Alert System]

     ▼                            ▼                            ▼                           ▼
 Enables streaming           Enables charts              Full dashboard              Production-ready
 + basic API                 + tree views                functionality               + optimized
```

---

## Phase 1: Foundation (Core Infrastructure)

**Goal**: Establish streaming, storage, and API foundation
**Prerequisite**: None
**Enables**: All subsequent phases

### Task 1.1: SQLite Schema Migration

| Attribute | Value |
|-----------|-------|
| **Files** | `src/storage/dashboard-v3-schema.js` |
| **Scope** | 12 new tables, indexes, migrations |
| **Effort** | Small |

**Deliverables**:
- Create `projects` table
- Create `sessions` table (enhanced)
- Create `agents` table
- Create `tasks` table (enhanced)
- Create `alerts` table
- Create `metrics_raw`, `metrics_hourly`, `metrics_daily` tables
- Create `delegation_events` table
- Create `hierarchy_snapshots` table
- Create `auto_compact_events` table
- Migration script from existing schema

**Acceptance Criteria**:
- [ ] All tables created with proper indexes
- [ ] Migration runs without data loss
- [ ] Existing dashboard still functions

---

### Task 1.2: In-Memory Cache Layer

| Attribute | Value |
|-----------|-------|
| **Files** | `src/cache/dashboard-cache.js` |
| **Scope** | LRU cache with 5-minute TTL |
| **Effort** | Small |

**Deliverables**:
- LRU cache implementation with configurable max size
- TTL-based expiration
- Cache invalidation on writes
- Methods: `get`, `set`, `delete`, `clear`, `stats`

**Acceptance Criteria**:
- [ ] Cache hit rate > 80% for repeated queries
- [ ] Memory usage < 10MB under normal load
- [ ] Automatic cleanup of expired entries

---

### Task 1.3: SSE Server Implementation

| Attribute | Value |
|-----------|-------|
| **Files** | `src/streaming/sse-server.js`, `src/streaming/event-aggregator.js` |
| **Scope** | EventSource server with batching |
| **Effort** | Medium |

**Deliverables**:
- SSE endpoint at `/api/v3/stream`
- Client subscription management
- Event filtering by type and session
- Automatic reconnection support (Last-Event-ID)
- 100ms event batching
- Heartbeat every 30 seconds
- Connection cleanup on disconnect

**Event Types**:
```javascript
const EVENT_TYPES = [
  'session.status',    // Session state changes
  'session.metrics',   // Periodic metrics update
  'task.created',      // New task added
  'task.claimed',      // Task claimed by agent
  'task.completed',    // Task finished
  'hierarchy.update',  // Agent tree changed
  'context.usage',     // Context percentage update
  'alert.triggered',   // New alert
  'batch'              // Batched updates
];
```

**Acceptance Criteria**:
- [ ] Supports 10+ concurrent connections
- [ ] Automatic reconnection works
- [ ] Events batched within 100ms window
- [ ] Memory stable under load

---

### Task 1.4: REST API Endpoints (Base)

| Attribute | Value |
|-----------|-------|
| **Files** | `src/api/dashboard-v3-routes.js` |
| **Scope** | 15 REST endpoints |
| **Effort** | Medium |

**Endpoints**:
```
GET  /api/v3/projects              List projects with aggregates
GET  /api/v3/projects/:id          Project details
GET  /api/v3/sessions              List sessions (filterable)
GET  /api/v3/sessions/:id          Session details
GET  /api/v3/sessions/:id/hierarchy Full agent tree
GET  /api/v3/sessions/:id/metrics  Time-series metrics
GET  /api/v3/tasks                 List tasks (filterable)
GET  /api/v3/tasks/:id             Task details
GET  /api/v3/tasks/queue           Current queue
GET  /api/v3/alerts                List alerts
POST /api/v3/alerts/:id/acknowledge Acknowledge alert
GET  /api/v3/metrics/realtime      Current metrics
GET  /api/v3/metrics/historical    Historical with time range
GET  /api/v3/stream                SSE endpoint (from 1.3)
```

**Acceptance Criteria**:
- [ ] All endpoints return valid JSON
- [ ] Filtering works (status, project, time range)
- [ ] Response times < 50ms for point queries
- [ ] Proper error handling (400, 404, 500)

---

### Task 1.5: Client State Manager

| Attribute | Value |
|-----------|-------|
| **Files** | `public/dashboard-v3/state/store.js`, `state/actions.js`, `state/selectors.js` |
| **Scope** | Zustand-like state management |
| **Effort** | Small-Medium |

**Deliverables**:
- Central state store (no external dependencies)
- Immutable state updates
- Subscription system for components
- Selectors for derived state
- SSE event handlers that update state

**State Shape**:
```javascript
const initialState = {
  projects: {},
  sessions: {},
  tasks: {},
  agents: {},
  alerts: [],
  metrics: {
    realtime: {},
    cache: new Map()
  },
  ui: {
    selectedSession: null,
    selectedAgent: null,
    filters: {},
    timeRange: '1h'
  }
};
```

**Acceptance Criteria**:
- [ ] State updates trigger component re-renders
- [ ] No memory leaks from subscriptions
- [ ] SSE events correctly update state

---

### Phase 1 Summary

| Metric | Value |
|--------|-------|
| **Tasks** | 5 |
| **New Files** | ~8 |
| **Lines of Code** | ~1,200 |
| **Dependencies** | None (uses existing Express) |

**Phase 1 Exit Criteria**:
- [ ] SSE streaming works end-to-end
- [ ] All 15 API endpoints functional
- [ ] State manager receives and stores SSE events
- [ ] Existing dashboard unaffected

---

## Phase 2: Visualization (Chart Libraries)

**Goal**: Integrate visualization libraries for charts and trees
**Prerequisite**: Phase 1 complete
**Enables**: Phase 3 components

### Task 2.1: uPlot Time-Series Integration

| Attribute | Value |
|-----------|-------|
| **Files** | `public/dashboard-v3/charts/TokenTimeline.js` |
| **Scope** | Wrapper component for uPlot |
| **Effort** | Medium |

**Deliverables**:
- uPlot wrapper as Web Component
- Real-time data streaming support
- Configurable time ranges (1h, 6h, 24h)
- Multiple series support (input, output, total)
- Zoom and pan interactions
- Responsive sizing

**Acceptance Criteria**:
- [ ] Renders 10K+ points at 60fps
- [ ] Smooth updates from SSE stream
- [ ] Time range selector works
- [ ] Responsive to container resize

---

### Task 2.2: D3.js Hierarchy Tree

| Attribute | Value |
|-----------|-------|
| **Files** | `public/dashboard-v3/hierarchy/TreeView.js`, `TreeNode.js` |
| **Scope** | Collapsible tree visualization |
| **Effort** | Medium-High |

**Deliverables**:
- D3.js tree layout with smooth transitions
- Expand/collapse on click
- Node component with status, tokens, quality
- Animated status changes
- Connector lines with parent-inherited colors
- Search/filter functionality

**Node Design**:
```
[▼] [*] 🤖 Agent Name          [Tokens] [Qual] [Time]
```

**Acceptance Criteria**:
- [ ] Handles 50+ nodes without lag
- [ ] Expand/collapse animations smooth
- [ ] Real-time status updates work
- [ ] Filter by status works

---

### Task 2.3: Chart.js Gauge Components

| Attribute | Value |
|-----------|-------|
| **Files** | `public/dashboard-v3/charts/ContextGauge.js`, `QualityGauge.js` |
| **Scope** | Circular gauges with zones |
| **Effort** | Small-Medium |

**Deliverables**:
- Circular gauge with configurable zones
- Animated needle transitions
- Center value display
- Zone color coding (OK, Warning, Critical, Emergency)
- Threshold markers

**Acceptance Criteria**:
- [ ] Smooth value transitions
- [ ] Zone colors correct
- [ ] Works at multiple sizes

---

### Task 2.4: Sparkline Component

| Attribute | Value |
|-----------|-------|
| **Files** | `public/dashboard-v3/charts/Sparkline.js` |
| **Scope** | Inline mini-charts |
| **Effort** | Small |

**Deliverables**:
- SVG-based sparkline (no dependencies)
- Configurable width/height
- Line and area variants
- Trend indicator (up/down/stable)
- Tooltip on hover

**Acceptance Criteria**:
- [ ] Renders in < 5ms
- [ ] Works in table cells
- [ ] Trend indicator accurate

---

### Phase 2 Summary

| Metric | Value |
|--------|-------|
| **Tasks** | 4 |
| **New Files** | ~6 |
| **Lines of Code** | ~1,000 |
| **Dependencies** | uPlot (~47KB), D3.js subset (~60KB), Chart.js (~11KB) |

**Phase 2 Exit Criteria**:
- [ ] uPlot renders real-time token data
- [ ] D3 tree shows agent hierarchy
- [ ] Gauges display context/quality
- [ ] Sparklines work inline

---

## Phase 3: Components (Dashboard Panels)

**Goal**: Build all 9 dashboard panel components
**Prerequisite**: Phase 1 complete, Phase 2 recommended
**Enables**: Full dashboard functionality

### Task 3.1: Base Component System

| Attribute | Value |
|-----------|-------|
| **Files** | `public/dashboard-v3/components/BaseComponent.js`, `StateConnector.js` |
| **Scope** | Web Component foundation |
| **Effort** | Small |

**Deliverables**:
- Base class for all components
- State subscription mixin
- Lifecycle management
- Event emission helpers

---

### Task 3.2: Projects Panel

| Attribute | Value |
|-----------|-------|
| **Files** | `public/dashboard-v3/panels/ProjectsPanel.js`, `ProjectCard.js` |
| **Scope** | Grid of project cards |
| **Effort** | Small-Medium |

**Features**:
- 2x2 grid layout
- Session count badges
- Activity sparkline (24h)
- Quality score indicator
- Click to filter sessions

---

### Task 3.3: Sessions Panel

| Attribute | Value |
|-----------|-------|
| **Files** | `public/dashboard-v3/panels/SessionsPanel.js`, `SessionCard.js` |
| **Scope** | Scrollable session list |
| **Effort** | Medium |

**Features**:
- Session cards with context bar
- Status badge with pulse animation
- Quality/confidence display
- Current task preview
- Expand for details
- Filter by status/project

---

### Task 3.4: Context Tracker Panel

| Attribute | Value |
|-----------|-------|
| **Files** | `public/dashboard-v3/panels/ContextTracker.js` |
| **Scope** | Large gauge + trend |
| **Effort** | Small-Medium |

**Features**:
- Large circular gauge
- Token trend sparkline (5 min)
- Per-agent breakdown bars
- Threshold alerts
- Auto-compact prediction

---

### Task 3.5: Task Queue Panel

| Attribute | Value |
|-----------|-------|
| **Files** | `public/dashboard-v3/panels/TaskQueuePanel.js`, `TaskCard.js` |
| **Scope** | Current task + queue |
| **Effort** | Medium |

**Features**:
- Current task prominent
- Queue list with priorities
- Claim status badges
- Dependency indicators
- Filter buttons (All/Available/Claimed/Blocked)

---

### Task 3.6: Hierarchy Viewer Panel

| Attribute | Value |
|-----------|-------|
| **Files** | `public/dashboard-v3/panels/HierarchyPanel.js`, `NodeDetail.js` |
| **Scope** | Full hierarchy with detail |
| **Effort** | Medium |

**Features**:
- D3 tree from Phase 2
- Control bar (expand/collapse/filter)
- Search box
- Node detail slide-in panel
- Summary stats footer

---

### Task 3.7: Performance Charts Panel

| Attribute | Value |
|-----------|-------|
| **Files** | `public/dashboard-v3/panels/PerformancePanel.js` |
| **Scope** | Metrics dashboard |
| **Effort** | Medium |

**Features**:
- Token usage timeline (uPlot)
- Quality score trend
- Delegation metrics gauges
- Efficiency cards

---

### Task 3.8: Alert System

| Attribute | Value |
|-----------|-------|
| **Files** | `public/dashboard-v3/alerts/AlertBanner.js`, `AlertManager.js` |
| **Scope** | Alert display and management |
| **Effort** | Small-Medium |

**Features**:
- Severity-colored banners
- Auto-dismiss for info
- Acknowledge action
- Alert history view

---

### Task 3.9: Main Dashboard Layout

| Attribute | Value |
|-----------|-------|
| **Files** | `public/dashboard-v3/index.html`, `DashboardApp.js` |
| **Scope** | Layout and routing |
| **Effort** | Medium |

**Features**:
- Header with project selector
- Time range picker
- Main grid layout
- Panel arrangement
- Alert overlay

---

### Phase 3 Summary

| Metric | Value |
|--------|-------|
| **Tasks** | 9 |
| **New Files** | ~15 |
| **Lines of Code** | ~2,000 |
| **Dependencies** | None (uses Phase 2 charts) |

**Phase 3 Exit Criteria**:
- [ ] All 9 panels render correctly
- [ ] Real-time updates from SSE work
- [ ] Interactions (click, filter) work
- [ ] Layout responsive to screen size

---

## Phase 4: Polish (Production Ready)

**Goal**: Optimize performance and UX
**Prerequisite**: Phases 1-3 complete
**Enables**: Production deployment

### Task 4.1: Virtual Scrolling

| Attribute | Value |
|-----------|-------|
| **Files** | `public/dashboard-v3/utils/VirtualList.js` |
| **Scope** | Virtualized lists for large data |
| **Effort** | Medium |

**Deliverables**:
- Virtual scrolling for session list
- Virtual scrolling for task queue
- Maintains scroll position on updates

---

### Task 4.2: RAF Update Batching

| Attribute | Value |
|-----------|-------|
| **Files** | `public/dashboard-v3/utils/UpdateBatcher.js` |
| **Scope** | Batch DOM updates |
| **Effort** | Small |

**Deliverables**:
- requestAnimationFrame batching
- Coalesce multiple state updates
- Prevent layout thrashing

---

### Task 4.3: Responsive Design

| Attribute | Value |
|-----------|-------|
| **Files** | `public/dashboard-v3/styles/responsive.css` |
| **Scope** | Mobile/tablet layouts |
| **Effort** | Small-Medium |

**Breakpoints**:
- Desktop (> 1200px): 3-column
- Tablet (768-1200px): 2-column
- Mobile (< 768px): Single column + tabs

---

### Task 4.4: Keyboard Navigation

| Attribute | Value |
|-----------|-------|
| **Files** | `public/dashboard-v3/utils/KeyboardNav.js` |
| **Scope** | Keyboard shortcuts |
| **Effort** | Small |

**Shortcuts**:
- `j/k` - Navigate sessions
- `Enter` - Select/expand
- `Esc` - Close detail panels
- `?` - Show help

---

### Task 4.5: Performance Monitoring

| Attribute | Value |
|-----------|-------|
| **Files** | `public/dashboard-v3/utils/PerfMonitor.js` |
| **Scope** | Dashboard performance tracking |
| **Effort** | Small |

**Metrics**:
- Frame rate monitoring
- SSE latency tracking
- Memory usage alerts
- Render time logging

---

### Phase 4 Summary

| Metric | Value |
|--------|-------|
| **Tasks** | 5 |
| **New Files** | ~5 |
| **Lines of Code** | ~800 |
| **Dependencies** | None |

**Phase 4 Exit Criteria**:
- [ ] 60fps sustained with 1000+ items
- [ ] Works on tablet/mobile
- [ ] Keyboard navigation complete
- [ ] Performance metrics captured

---

## Implementation Recommendations

### Option A: Full Sequential (Lowest Risk)

```
Phase 1 → Phase 2 → Phase 3 → Phase 4
```

- Complete each phase before starting next
- Easier to pause/resume
- Lower integration risk

### Option B: Parallel Tracks (Faster)

```
Phase 1 ──────────────────────────────▶
         Phase 2 ────────────────────▶
                   Phase 3 ──────────▶
                              Phase 4▶
```

- Start Phase 2 after Task 1.3 (SSE)
- Start Phase 3 after Task 2.2 (D3 tree)
- Requires coordination

### Option C: MVP First (Incremental Value)

```
Phase 1 (1.1-1.3 only) → Task 3.3 (Sessions) → Task 3.6 (Hierarchy)
```

- Get streaming + 2 key panels working first
- Add components incrementally
- Fastest to visible value

---

## Task Dependency Graph

```
1.1 Schema ──┬──▶ 1.4 API ──────┬──▶ 3.2 Projects
             │                   │
1.2 Cache ───┤                   ├──▶ 3.3 Sessions
             │                   │
1.3 SSE ─────┴──▶ 1.5 State ────┼──▶ 3.4 Context
                        │        │
                        │        ├──▶ 3.5 Tasks
                        │        │
2.1 uPlot ──────────────┼───────┼──▶ 3.7 Performance
                        │        │
2.2 D3 Tree ────────────┼───────┴──▶ 3.6 Hierarchy
                        │
2.3 Gauges ─────────────┴──────────▶ 3.4 Context

2.4 Sparklines ────────────────────▶ 3.2 Projects, 3.3 Sessions

3.1 Base ──────────────────────────▶ All 3.x tasks

3.8 Alerts ────────────────────────▶ 3.9 Layout

4.x Polish ────────────────────────▶ (after Phase 3)
```

---

## Quick Start: Minimum Viable Dashboard

If you want the fastest path to a working V3 dashboard:

1. **Task 1.1** - Schema (enables data storage)
2. **Task 1.3** - SSE Server (enables streaming)
3. **Task 1.4** - API Base (enables data access)
4. **Task 1.5** - State Manager (enables reactivity)
5. **Task 3.3** - Sessions Panel (most valuable panel)
6. **Task 2.2** - D3 Tree (enables hierarchy)
7. **Task 3.6** - Hierarchy Panel (key differentiator)

This gives you: **SSE streaming + Sessions + Hierarchy** in ~7 tasks.

---

*Implementation Plan Version: 1.0*
*Based on: DASHBOARD-V3-ARCHITECTURE.md, DASHBOARD-V3-WIREFRAMES.md*
*Created: December 2025*
