# Current Plan - Dashboard Command Center Implementation

**Last Updated**: 2025-12-26 (Session 20)
**Current Phase**: IMPLEMENTATION
**Status**: DESIGN APPROVED - Ready to build
**Priority**: CRITICAL

---

## GOAL: Build Dashboard Command Center

Transform the single-session dashboard into a multi-project Command Center for monitoring all autonomous orchestrator sessions.

### Design Document
See `docs/DASHBOARD-UX-REDESIGN.md` for full wireframes and specifications.

---

## Implementation Phases

### Phase 1: Command Center Core (CRITICAL - Start Here)

**Goal**: Create the birds-eye view of all sessions + usage limit tracking

**Tasks**:
1. **Create Session Registry Service** (`session-registry.js`)
   - Track all active orchestrator sessions
   - Store session metadata (project, path, start time, current task)
   - Expose registration/deregistration API
   - Persist to memory (lost on restart is OK for v1)

2. **Create Usage Limit Tracker** (`usage-limit-tracker.js`)
   - Track 5-hour rolling window usage (messages)
   - Track daily and weekly usage limits
   - Calculate reset countdowns
   - Compute pace (messages/hour) vs safe rate
   - Project end-of-day usage at current pace

3. **Add API Endpoints** (in `global-context-manager.js`)
   ```javascript
   GET /api/sessions/summary   // Global metrics + all sessions
   GET /api/sessions/:id       // Single session detail
   POST /api/sessions/register // Orchestrator registers on start
   POST /api/sessions/:id/update // Orchestrator updates state
   GET /api/usage/limits       // 5h/daily/weekly usage with reset times
   ```

4. **Create Command Center UI** (refactor `global-dashboard.html`)
   - Global metrics bar (5 stats: active, tasks done, health, cost, alerts)
   - **Usage Limits panel** (5h window, daily, weekly with progress bars)
   - Session cards grid (context %, current task, quality, actions)
   - Recent completions table
   - Navigation to session detail view

5. **Wire Orchestrator to Dashboard**
   - Orchestrator POSTs state on startup
   - Orchestrator POSTs updates on phase/task changes
   - Handle dashboard being offline gracefully

**Acceptance Criteria**:
- [ ] All active sessions visible in grid
- [ ] Context % per session with color coding
- [ ] Current task and phase per session
- [ ] Global metrics aggregated correctly
- [ ] Auto-refresh via SSE
- [ ] **Usage Limits panel shows 5h/daily/weekly usage**
- [ ] **Reset countdowns displayed**
- [ ] **Pace indicator with warning when unsustainable**
- [ ] **Color coding at 50%/75%/90% thresholds**

---

### Phase 2: Session Detail View (HIGH)

**Goal**: Drill-down into individual session metrics

**Tasks**:
1. **Add Detail View Route**
   - URL: `/session/:id` or modal overlay
   - Back navigation to Command Center

2. **Build Detail Panels**
   - 3-column header: Context / Session / Cost
   - Current task with acceptance criteria checklist
   - Confidence gauge with 5 signals
   - Task queue table

3. **Add Session Controls**
   - Pause/Resume button
   - Skip Task button
   - End Session button

**Acceptance Criteria**:
- [ ] Click session card opens detail view
- [ ] Acceptance criteria checklist visible
- [ ] Confidence signals updating
- [ ] Controls work (pause/resume/end)

---

### Phase 3: Live Log Viewer (HIGH)

**Goal**: Stream orchestrator logs in real-time

**Tasks**:
1. **Create Log Streaming Endpoint**
   ```javascript
   GET /api/logs/:sessionId  // SSE stream
   ```
   - Use `fs.watch` for tail -f behavior
   - Stream new lines via SSE
   - Support pause/resume

2. **Build Log Viewer Component**
   - Monospace dark theme
   - Auto-scroll toggle
   - Session selector dropdown
   - Log level color coding
   - Line count in footer

3. **Integrate into Detail View**
   - Collapsible panel at bottom
   - "View Log" button in session card

**Acceptance Criteria**:
- [ ] Logs stream in real-time
- [ ] Auto-scroll follows new entries
- [ ] Pause stops stream
- [ ] Green pulsing dot when streaming
- [ ] Log level colors (INFO=blue, WARN=yellow, ERROR=red)

---

### Phase 4: Polish (MEDIUM)

**Goal**: Responsive design and refinements

**Tasks**:
1. Responsive breakpoints (tablet, mobile)
2. Keyboard navigation
3. Search in logs
4. Historical data views
5. Export capabilities

---

## Key Files to Modify/Create

| File | Action | Purpose |
|------|--------|---------|
| `session-registry.js` | CREATE | Multi-session management |
| `usage-limit-tracker.js` | CREATE | Track 5h/daily/weekly Claude usage limits |
| `log-streamer.js` | CREATE | Log file watching and SSE |
| `global-context-manager.js` | MODIFY | Add new API endpoints (sessions + usage) |
| `global-dashboard.html` | REFACTOR | Command Center UI + Usage Limits panel |
| `autonomous-orchestrator.js` | MODIFY | POST state to dashboard |

---

## API Specifications

### GET /api/usage/limits
```json
{
  "fiveHour": {
    "used": 186,
    "limit": 300,
    "percent": 62,
    "resetAt": "2025-12-26T18:45:00Z",
    "resetIn": "2h 14m",
    "pace": {
      "current": 45,
      "safe": 60,
      "status": "warning"
    }
  },
  "daily": {
    "used": 465,
    "limit": 1500,
    "percent": 31,
    "resetAt": "2025-12-27T00:00:00Z",
    "resetIn": "8h 32m",
    "projected": { "endOfDay": 720, "percentOfLimit": 48 }
  },
  "weekly": {
    "used": 1200,
    "limit": 7000,
    "percent": 17,
    "resetAt": "2025-12-30T00:00:00Z",
    "resetDay": "Monday"
  },
  "lastUpdated": "2025-12-26T16:31:00Z"
}
```

### GET /api/sessions/summary
```json
{
  "globalMetrics": {
    "activeCount": 3,
    "tasksCompletedToday": 7,
    "avgHealthScore": 89,
    "totalCostToday": 12.47,
    "alertCount": 0
  },
  "sessions": [
    {
      "id": 5,
      "project": "multi-agent-template",
      "status": "active",
      "contextPercent": 72,
      "currentTask": { "id": "...", "title": "...", "phase": "implement" },
      "qualityScore": 85,
      "tokens": 156432,
      "cost": 3.21
    }
  ],
  "recentCompletions": [...]
}
```

### GET /api/logs/:sessionId (SSE)
```
event: log
data: {"line": "14:32:05 [orchestrator] Starting...", "level": "INFO"}
```

---

## Success Metrics

1. **Command Center**: All active sessions visible at a glance
2. **Drill-Down**: Full details accessible in 1 click
3. **Live Logs**: Real-time streaming with <1s latency
4. **Multi-Project**: Works with 5+ concurrent sessions

---

## Reference Documents

- `docs/DASHBOARD-UX-REDESIGN.md` - Full wireframes and specs
- `docs/DASHBOARD-ENHANCEMENTS-DESIGN.md` - Feature requirements
- `global-dashboard.html` - Current implementation to refactor
- `global-context-manager.js` - Backend to extend
