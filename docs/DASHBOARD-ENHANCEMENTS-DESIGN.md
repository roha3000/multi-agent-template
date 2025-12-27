# Dashboard Enhancements Design Document

**Created**: 2025-12-26
**Status**: PLANNING
**Priority**: CRITICAL
**Source**: User requests consolidated from conversation history

---

## Overview

This document consolidates all requested and planned dashboard enhancements that were either lost from tasks.json due to orchestrator bugs, or were marked complete without actual implementation.

**Critical bugs fixed before implementation:**
1. Bug 1: Tasks marked complete without verification (`?? true` default in line 348)
2. Bug 2: Tasks not moved to completed tier when finished

---

## Part 1: Critical Missing Features (User Requested)

### 1.0 Cross-Session Summary Dashboard (Command Center)
**Task ID**: `dashboard-command-center`
**Priority**: CRITICAL
**Estimate**: 4h

**Description**: A top-level summary view that aggregates information across ALL active sessions, showing usage, current/next tasks with status, and key metrics. Users can then drill down into specific projects/sessions for details.

**Acceptance Criteria**:
- [ ] Summary panel shows aggregated metrics across all active sessions
- [ ] Displays current task per session with status indicator
- [ ] Shows next task queued for each session
- [ ] Usage metrics: total tokens, cost, context utilization
- [ ] Key metrics: tasks completed today, success rate, avg quality score
- [ ] Click on any session row to drill down to detailed view
- [ ] Auto-refresh every 3 seconds via SSE

**Summary Panel Design**:
```
┌─────────────────────────────────────────────────────────────────────────┐
│ COMMAND CENTER                                          [Refresh] [⚙]  │
├─────────────────────────────────────────────────────────────────────────┤
│ GLOBAL METRICS                                                          │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐    │
│ │ Active: 3    │ │ Tasks: 12/18 │ │ Tokens: 2.4M │ │ Cost: $4.52  │    │
│ │ sessions     │ │ completed    │ │ today        │ │ today        │    │
│ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘    │
├─────────────────────────────────────────────────────────────────────────┤
│ ACTIVE SESSIONS                                                         │
│ ┌───────────────────────────────────────────────────────────────────┐  │
│ │ Session │ Project            │ Current Task        │ Status │ Next│  │
│ ├─────────┼────────────────────┼─────────────────────┼────────┼─────│  │
│ │ ● #5    │ multi-agent-templ  │ dashboard-log-view  │ 75% ▓▓░│ →   │  │
│ │ ● #3    │ api-gateway        │ auth-middleware     │ 40% ▓░░│ →   │  │
│ │ ○ #1    │ docs-site          │ (idle)              │ --     │ →   │  │
│ └───────────────────────────────────────────────────────────────────┘  │
│                                              [Click row to drill down]  │
├─────────────────────────────────────────────────────────────────────────┤
│ RECENT COMPLETIONS                                                      │
│  ✓ swarm-performance-testing (95/100) - 8m ago                         │
│  ✓ swarm-database-schema (92/100) - 1h ago                             │
│  ✓ swarm-feature-flags (95/100) - 2h ago                               │
└─────────────────────────────────────────────────────────────────────────┘
```

**Drill-Down View** (when clicking a session):
```
┌─────────────────────────────────────────────────────────────────────────┐
│ ← Back to Summary    SESSION #5: multi-agent-template                   │
├─────────────────────────────────────────────────────────────────────────┤
│ SESSION DETAILS                                                         │
│ ┌─────────────────────────────────────────────────────────────────────┐│
│ │ Phase: implement (iteration 2)    │ Quality: 85/100                 ││
│ │ Runtime: 12m 34s                  │ Context: 45% (90k/200k)         ││
│ │ Tokens: 156,432 in / 23,891 out   │ Cost: $1.23                     ││
│ └─────────────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────────────┤
│ CURRENT TASK                                                            │
│ ┌─────────────────────────────────────────────────────────────────────┐│
│ │ dashboard-log-viewer                                                ││
│ │ Add Real-Time Log Viewer Button to Dashboard                        ││
│ │                                                                     ││
│ │ Acceptance Criteria:                   Progress:                    ││
│ │ [✓] Dashboard shows 'View Log' button  ▓▓▓▓▓▓▓▓░░ 75%              ││
│ │ [✓] API endpoint streams via SSE                                    ││
│ │ [✓] Log viewer panel with auto-scroll                               ││
│ │ [ ] Historical session logs                                         ││
│ │ [ ] Streaming indicator                                             ││
│ └─────────────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────────────┤
│ TASK QUEUE                                                              │
│  1. dashboard-autonomous-tracking (critical) ← NEXT                     │
│  2. dashboard-live-task-refresh (high)                                  │
│  3. swarm-documentation (medium)                                        │
├─────────────────────────────────────────────────────────────────────────┤
│ [View Log] [Pause] [Skip Task] [End Session]                            │
└─────────────────────────────────────────────────────────────────────────┘
```

**API Endpoints Required**:
```javascript
// Get summary across all sessions
GET /api/sessions/summary
Response: {
  activeCount: 3,
  totalTokensToday: 2400000,
  totalCostToday: 4.52,
  tasksCompletedToday: 12,
  tasksTotal: 18,
  avgQualityScore: 91,
  sessions: [
    {
      id: 5,
      project: "multi-agent-template",
      currentTask: { id: "dashboard-log-viewer", title: "...", progress: 75 },
      nextTask: { id: "dashboard-autonomous-tracking", title: "..." },
      status: "running",
      phase: "implement",
      contextUsage: 0.45
    },
    ...
  ],
  recentCompletions: [
    { task: "swarm-performance-testing", score: 95, completedAt: "..." },
    ...
  ]
}

// Get detailed session info
GET /api/sessions/:id
Response: {
  id: 5,
  project: "multi-agent-template",
  phase: "implement",
  iteration: 2,
  runtime: 754, // seconds
  qualityScore: 85,
  context: { used: 90000, total: 200000 },
  tokens: { input: 156432, output: 23891 },
  cost: 1.23,
  currentTask: { ...full task details with acceptance criteria... },
  taskQueue: [ ...ordered list of upcoming tasks... ],
  history: [ ...completed tasks in this session... ]
}
```

**Data Sources**:
- `tasks.json` - Task definitions and status
- `MemoryStore` - Session history, quality scores
- `autonomous-orchestrator.js` state - Current phase, iteration
- Token/cost tracking from existing infrastructure

**Implementation Notes**:
1. Add session registry in `global-context-manager.js`
2. Orchestrator registers itself on startup, updates on state changes
3. Summary view polls `/api/sessions/summary` or uses SSE
4. Drill-down fetches `/api/sessions/:id` on click
5. Store session state in memory (lost on restart) or MemoryStore (persisted)

### 1.1 Real-Time Log Viewer
**Task ID**: `dashboard-log-viewer`
**Priority**: HIGH
**Estimate**: 2h

**Description**: Add a button to the dashboard that opens a real-time tail view of the session log file so users can monitor orchestrator output live.

**Acceptance Criteria**:
- [ ] Dashboard shows 'View Log' button for active/recent sessions
- [ ] API endpoint `/api/logs/:session` streams log file content via SSE (tail -f behavior)
- [ ] Log viewer panel shows real-time updates with auto-scroll
- [ ] Supports viewing historical session logs from `.claude/logs/session-N.log`
- [ ] Clear visual indicator when log is actively streaming (green pulsing dot)

**Implementation Details**:
```javascript
// In global-context-manager.js
app.get('/api/logs/:session', (req, res) => {
  const logPath = path.join(__dirname, '.claude/logs', `session-${req.params.session}.log`);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');

  // Use fs.watch for tail -f behavior
  const watcher = fs.watch(logPath, (eventType) => {
    if (eventType === 'change') {
      // Read new content and send via SSE
    }
  });
});
```

**UI Components**:
- Log viewer modal/panel (dark theme, monospace font)
- Session selector dropdown
- Auto-scroll toggle
- Clear/pause buttons
- Line count indicator

---

### 1.2 Autonomous Session Tracking
**Task ID**: `dashboard-autonomous-tracking`
**Priority**: CRITICAL
**Estimate**: 3h

**Description**: The dashboard should display real-time status of autonomous orchestrator sessions including current phase, active task, iteration count, quality scores, and session progress.

**Current Gap**: Dashboard only shows Claude Code windows, not orchestrator sessions.

**Acceptance Criteria**:
- [ ] Orchestrator POSTs execution state to `/api/execution-state` on phase/task changes
- [ ] Dashboard shows dedicated "Autonomous Sessions" panel
- [ ] Panel displays: current task, phase, iteration, quality score
- [ ] Real-time updates via SSE when orchestrator state changes
- [ ] Visual distinction between autonomous and interactive Claude sessions
- [ ] Session history shows completed autonomous tasks with scores

**Orchestrator Changes** (autonomous-orchestrator.js):
```javascript
// Add after each state change
async function updateDashboard(state) {
  try {
    await fetch('http://localhost:3033/api/execution-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'autonomous',
        phase: state.currentPhase,
        task: state.currentTask,
        iteration: state.phaseIterations,
        sessionNumber: state.sessionNumber,
        qualityScore: state.lastScore,
        status: 'running'
      })
    });
  } catch (e) { /* Dashboard may not be running */ }
}
```

**Dashboard Panel Design**:
```
┌─────────────────────────────────────────────────┐
│ AUTONOMOUS SESSIONS                    [Refresh] │
├─────────────────────────────────────────────────┤
│ ● RUNNING - Session 5                           │
│   Task: swarm-performance-testing               │
│   Phase: implement (iteration 2)                │
│   Score: 85/100                                 │
│   Duration: 12m 34s                             │
├─────────────────────────────────────────────────┤
│ History:                                        │
│   ✓ Session 4: swarm-database-schema (95/100)   │
│   ✓ Session 3: swarm-feature-flags (92/100)     │
└─────────────────────────────────────────────────┘
```

---

### 1.3 Live Task Refresh
**Task ID**: `dashboard-live-task-refresh`
**Priority**: HIGH
**Estimate**: 1h

**Description**: The backlog tasks panel should automatically refresh when tasks.json changes or when task status updates occur.

**Current Gap**: Task list doesn't update in real-time.

**Acceptance Criteria**:
- [ ] Task list updates within 1 second of tasks.json change
- [ ] SSE events include fresh taskData on every broadcast
- [ ] Dashboard re-renders backlog panel on taskData change
- [ ] File watcher monitors tasks.json for external changes
- [ ] In-progress/ready/completed counts update live

**Implementation**:
```javascript
// In global-context-manager.js
const chokidar = require('chokidar');

const tasksWatcher = chokidar.watch('./tasks.json', { persistent: true });
tasksWatcher.on('change', () => {
  // Reload TaskManager and broadcast via SSE
  taskManager.load();
  broadcastUpdate({ type: 'taskData', data: taskManager.getBacklogSummary() });
});
```

---

## Part 2: Planned Dashboard Enhancements

These features were documented in `docs/ENHANCEMENTS-DASHBOARD-SYSTEM.md` but not yet implemented.

### 2.1 Auto-Launch Dashboard System
**Status**: PLANNED
**Estimate**: 2h

**Description**: Dashboard auto-displays on Claude Code session start.

**Implementation Options**:
1. Hook-based launcher (`user-prompt-submit` hook)
2. CLAUDE.md instruction to run `/dashboard` on session start
3. Configuration file setting in `.claude/config.json`

**Acceptance Criteria**:
- [ ] Dashboard opens automatically when Claude Code starts
- [ ] Configurable enable/disable in settings
- [ ] Refresh command: `/dashboard refresh`

---

### 2.2 Project Overview Dashboard (Home Screen)
**Status**: PROPOSED
**Estimate**: 4h

**Description**: A summary dashboard showing project health at a glance.

**Components**:
- Sessions this week summary
- Total orchestrations count
- Success rate percentage
- Total cost and budget usage
- Skills status (active, recommended, coverage%)
- Agent performance summary
- Learnings & insights
- Framework backlog preview
- Alerts & actions section

---

### 2.3 Skills Dashboard
**Status**: PROPOSED
**Estimate**: 3h

**Description**: Skill coverage and usage analytics.

**Components**:
- Skill coverage percentage
- Active skills list with activations, relevance, last used
- Recommended skills by priority (HIGH/MED/LOW)
- 30-day trends (skills created, activation rate, coverage growth)
- User satisfaction rating

---

### 2.4 Agent Performance Dashboard
**Status**: PROPOSED
**Estimate**: 4h

**Description**: Analytics on agent effectiveness.

**Components**:
- Overall agent health percentage
- Top performers (success rate > 90%)
- Agents needing attention (success rate < 75%)
- Agent utilization metrics (7-day view)
- Best collaborations (agent pairs)
- Common failure categories with recommendations

---

### 2.5 Usage & Cost Analytics Dashboard
**Status**: PROPOSED
**Estimate**: 3h

**Description**: Cost tracking and budget management.

**Components**:
- Total spend summary (weekly, with budget comparison)
- Daily breakdown chart
- Cost by agent breakdown (top 5)
- Token usage: input, output, cache hits percentage
- Budget alerts (daily average, projected weekly/monthly)
- Cost efficiency trend

---

### 2.6 Knowledge & Learnings Dashboard
**Status**: PROPOSED
**Estimate**: 3h

**Description**: Track knowledge base and learning metrics.

**Components**:
- Knowledge base status (total entries, error solutions, research reports)
- Error resolution learning (auto-resolution rate)
- Top error categories with solution rates
- Research findings (recent research, reuse count)
- Knowledge reuse rate
- Pattern recognition accuracy

---

## Part 3: Currently Implemented Features (Reference)

The following features exist in `global-dashboard.html`:

| Feature | Status | Notes |
|---------|--------|-------|
| Real-time context monitoring | LIVE | Token usage, thresholds |
| Session series tracking | LIVE | Continuous loop metrics |
| Execution state (phase/score/todos) | LIVE | Phase display, quality gates |
| Backlog tasks display | LIVE | From tasks.json |
| Confidence gauge | LIVE | 5-signal breakdown |
| Competitive planning panel | LIVE | Plan comparison |
| Task complexity indicator | LIVE | 5-star system |
| SSE streaming | LIVE | 3-second interval |
| Multi-project monitoring | LIVE | Multiple sessions |

---

## Part 4: Swarm Data Integration Gaps

Dashboard UI elements exist but data doesn't flow from swarm components:

### Gap Analysis

| Component | UI Exists | Data Flows | Issue |
|-----------|-----------|------------|-------|
| ConfidenceMonitor | YES | NO | Not posting to /api/confidence |
| CompetitivePlanner | YES | NO | Not posting to /api/plans |
| ComplexityAnalyzer | YES | NO | Not posting to /api/complexity |

**Required Fixes**:
1. Swarm components must POST data to dashboard endpoints
2. Or orchestrator must forward swarm state on each iteration

---

## Part 5: Testing Gaps

**Current Coverage**: 0% for dashboard functionality

| Area | Estimated Effort |
|------|------------------|
| DashboardManager core functionality | 4h |
| Real-time SSE updates | 3h |
| Web dashboard endpoints | 2h |
| Orchestrator ↔ Dashboard integration | 3h |

---

## Implementation Priority Order

1. **CRITICAL** - Fix orchestrator bugs (DONE)
   - [x] Task completion verification
   - [x] Task tier movement on completion

2. **CRITICAL** - Autonomous session tracking
   - Dashboard must show orchestrator activity

3. **HIGH** - Live task refresh
   - File watcher for tasks.json
   - SSE broadcast on change

4. **HIGH** - Real-time log viewer
   - Tail -f via SSE
   - Session log panel

5. **MEDIUM** - Swarm data integration
   - Wire components to dashboard APIs

6. **LOW** - Extended dashboards
   - Skills, performance, cost analytics

---

## Files Affected

| File | Changes Needed |
|------|----------------|
| `global-dashboard.html` | Log viewer panel, autonomous sessions panel |
| `global-context-manager.js` | `/api/logs/:session`, file watcher, execution state endpoint |
| `autonomous-orchestrator.js` | POST execution state on changes |
| `swarm/*.js` | POST data to dashboard endpoints |

---

## Task Definitions for tasks.json

```json
{
  "dashboard-log-viewer": {
    "id": "dashboard-log-viewer",
    "title": "Add Real-Time Log Viewer Button to Dashboard",
    "phase": "implementation",
    "priority": "high",
    "estimate": "2h",
    "status": "ready"
  },
  "dashboard-autonomous-tracking": {
    "id": "dashboard-autonomous-tracking",
    "title": "Track Autonomous Orchestrator Sessions in Dashboard",
    "phase": "implementation",
    "priority": "critical",
    "estimate": "3h",
    "status": "ready"
  },
  "dashboard-live-task-refresh": {
    "id": "dashboard-live-task-refresh",
    "title": "Fix Dashboard Task List Live Refresh",
    "phase": "implementation",
    "priority": "high",
    "estimate": "1h",
    "status": "ready"
  }
}
```

---

## Revision History

| Date | Author | Changes |
|------|--------|---------|
| 2025-12-26 | Claude | Initial creation from conversation history |
