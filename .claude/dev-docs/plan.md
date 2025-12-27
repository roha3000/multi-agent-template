# Current Plan - Dashboard Command Center Implementation

**Last Updated**: 2025-12-26 (Session 22)
**Current Phase**: IMPLEMENTATION
**Status**: PHASE 1 & 2 COMPLETE - Ready for Phase 3
**Priority**: HIGH

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
