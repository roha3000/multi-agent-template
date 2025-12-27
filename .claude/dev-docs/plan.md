# Current Plan - Dashboard Command Center Implementation

**Last Updated**: 2025-12-27 (Session 24)
**Current Phase**: COMPLETE
**Status**: ALL PHASES COMPLETE (1-4)
**Priority**: DONE

---

## GOAL: Build Dashboard Command Center

Transform the single-session dashboard into a multi-project Command Center for monitoring all autonomous orchestrator sessions.

### Design Document
See `docs/DASHBOARD-UX-REDESIGN.md` for full wireframes and specifications.

---

## Implementation Phases

### Phase 1: Command Center Core ✅ COMPLETE (Session 21)

**Goal**: Create the birds-eye view of all sessions + usage limit tracking

**Completed**:
- ✅ Session Registry Service (`session-registry.js`)
- ✅ Usage Limit Tracker (`usage-limit-tracker.js`)
- ✅ 10+ API endpoints for sessions and usage
- ✅ Command Center UI with grid view
- ✅ Usage Limits panel (5h/daily/weekly)
- ✅ Orchestrator integration

**Acceptance Criteria**: ✅ ALL MET
- [x] All active sessions visible in grid
- [x] Context % per session with color coding
- [x] Current task and phase per session
- [x] Global metrics aggregated correctly
- [x] Auto-refresh via SSE
- [x] Usage Limits panel shows 5h/daily/weekly usage
- [x] Reset countdowns displayed
- [x] Pace indicator with warning when unsustainable
- [x] Color coding at 50%/75%/90% thresholds

---

### Phase 2: Session Detail View ✅ COMPLETE (Session 22)

**Goal**: Drill-down into individual session metrics

**Completed**:
- ✅ Full-page detail overlay with back navigation
- ✅ 3-column metrics header (Context/Session/Cost)
- ✅ Acceptance criteria checklist with progress bar
- ✅ Confidence gauge with 5 signal bars
- ✅ Task queue table with priorities
- ✅ Session controls (Pause/Resume/End)
- ✅ View Details button on all project cards

**Acceptance Criteria**: ✅ ALL MET
- [x] Click session card opens detail view
- [x] Acceptance criteria checklist visible
- [x] Confidence signals updating
- [x] Controls work (pause/resume/end)

---

### Phase 3: Live Log Viewer ✅ COMPLETE

**Goal**: Stream orchestrator logs in real-time

**Completed** (Session 23):
- Log Streamer service with fs.watchFile
- 8 API endpoints for logs
- Log viewer UI with auto-scroll, pause, level filter
- SSE streaming to browser

---

### Phase 4: Polish ✅ COMPLETE

**Goal**: Responsive design and refinements

**Completed** (Session 24):
1. ✅ Enhanced responsive breakpoints (1200px, 900px, 768px, 480px)
2. ✅ Keyboard navigation (j/k/Enter, ?, Esc, /, p, c, a)
3. ✅ Search in logs (real-time filter, highlighting, match count)
4. ✅ Historical data views (date picker, pagination, jump to time)

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
