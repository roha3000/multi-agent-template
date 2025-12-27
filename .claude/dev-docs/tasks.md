# Active Tasks - Dashboard Command Center

**Last Updated**: 2025-12-26 (Session 23)
**Current Focus**: Phase 3 COMPLETE - Live Log Viewer
**Design Doc**: `docs/DASHBOARD-UX-REDESIGN.md`

---

## NOW (Current Sprint)

### Phase 1: Command Center Core ✅ COMPLETE

| Task | Status | Priority | Description |
|------|--------|----------|-------------|
| Create session-registry.js | ✅ done | critical | Multi-session tracking service |
| Create usage-limit-tracker.js | ✅ done | critical | Track 5h/daily/weekly Claude limits |
| Add /api/sessions/* endpoints | ✅ done | critical | Summary, detail, register APIs |
| Add /api/usage/limits endpoint | ✅ done | critical | Return usage limits with reset times |
| Refactor dashboard to Command Center | ✅ done | critical | Grid view of all sessions |
| Add Usage Limits panel to dashboard | ✅ done | critical | 3-column layout with progress bars |
| Wire orchestrator to dashboard | ✅ done | high | POST state on phase/task changes |

### Phase 2: Session Detail View ✅ COMPLETE

| Task | Status | Priority | Description |
|------|--------|----------|-------------|
| Add detail view navigation | ✅ done | high | Click card → detail page |
| Build 3-column metrics header | ✅ done | high | Context/Session/Cost metrics |
| Build acceptance criteria panel | ✅ done | high | Checklist with progress bar |
| Add confidence gauge with signals | ✅ done | high | Mini gauge with 5 signal bars |
| Build task queue table | ✅ done | high | Priority-sorted with NEXT indicator |
| Add session controls | ✅ done | high | Pause/Resume/End buttons |
| Enhance session registry | ✅ done | medium | Added taskQueue, acceptanceCriteria, confidenceSignals |

### Phase 3: Live Log Viewer ✅ COMPLETE

| Task | Status | Priority | Description |
|------|--------|----------|-------------|
| Create log-streamer.js service | ✅ done | critical | File watching + SSE streaming |
| Add /api/logs/:id endpoints | ✅ done | high | SSE stream, history, stats, pause/resume |
| Build log viewer component | ✅ done | high | Auto-scroll, level filter, pause |
| Integrate into detail view | ✅ done | medium | Collapsible panel with controls |

---

## Acceptance Criteria Checklist

### Command Center (Phase 1) ✅ COMPLETE
- [x] Shows all active sessions in grid layout
- [x] Displays 5 global metrics above the fold (active, tasks done, health, cost, alerts)
- [x] Context % progress bar with color coding per session
- [x] Current and next task visible per session
- [x] Click session card navigates to detail view
- [x] Auto-refresh every 3 seconds via SSE
- [x] Recent completions table at bottom

### Usage Limits Panel (Phase 1) ✅ COMPLETE
- [x] 5-hour window: shows used/limit with progress bar and reset countdown
- [x] 5-hour window: shows current pace vs safe pace with warning indicator
- [x] Daily limit: shows used/limit with projected end-of-day usage
- [x] Weekly limit: shows used/limit with reset day
- [x] Color coding at 50%/75%/90% thresholds (green/yellow/orange/red)
- [x] Alert banner when any limit exceeds 90%
- [x] Updates every 1 minute

### Session Detail (Phase 2) ✅ COMPLETE
- [x] Back navigation to Command Center
- [x] 3-column metrics header (Context/Session/Cost)
- [x] Acceptance criteria checklist with progress
- [x] Confidence gauge with 5 signals
- [x] Task queue table with priorities
- [x] Pause/Resume/End session controls work

### Live Log Viewer (Phase 3) ✅ COMPLETE
- [x] Streams log file via SSE in real-time
- [x] Auto-scroll toggle works
- [x] Pause/Resume button stops/resumes stream
- [x] Log level filter dropdown (All, Errors, Warnings+, Info+, Debug+)
- [x] Log level color coding (INFO=blue, WARN=yellow, ERROR=red)
- [x] Green pulsing dot when streaming
- [x] Line count + error/warn counts in footer

---

## Files to Create/Modify

| File | Action | Status | Notes |
|------|--------|--------|-------|
| `.claude/core/session-registry.js` | CREATE | ✅ done | Track active sessions |
| `.claude/core/usage-limit-tracker.js` | CREATE | ✅ done | Track 5h/daily/weekly Claude limits |
| `.claude/core/log-streamer.js` | CREATE | ✅ done | fs.watchFile + SSE streaming |
| `global-context-manager.js` | MODIFY | ✅ done | +15 API endpoints (sessions + usage + logs) |
| `global-dashboard.html` | REFACTOR | ✅ done | Command Center + Live Log Viewer |
| `autonomous-orchestrator.js` | MODIFY | ✅ done | Add dashboard integration |
| `__tests__/core/log-streamer.test.js` | CREATE | ✅ done | 25 tests for log streamer |

---

## Quick Start for New Session

```bash
# 1. Read the design doc
Read docs/DASHBOARD-UX-REDESIGN.md

# 2. Start with session-registry.js
Create .claude/core/session-registry.js

# 3. Add API endpoints to global-context-manager.js
# 4. Refactor global-dashboard.html to Command Center layout
# 5. Wire orchestrator to POST state to dashboard
```

---

## Completed (Session 23 - Phase 3 COMPLETE)

| Task | Notes |
|------|-------|
| Create log-streamer.js service | File watching with fs.watchFile, SSE streaming, pause/resume |
| Add /api/logs/* endpoints | 7 endpoints: list, stream, history, stats, pause, resume, write |
| Build log viewer UI component | Auto-scroll, level filter, pause button, line counts |
| Integrate into session detail | Collapsible panel with streaming dot indicator |
| Add log-streamer tests | 25 passing tests for all log-streamer functionality |

## Completed (Session 22 - Phase 2 COMPLETE)

| Task | Notes |
|------|-------|
| Add Session Detail View | Full-page overlay with back navigation |
| Build 3-column metrics header | Context %, Session runtime, Cost with progress bars |
| Create acceptance criteria panel | Checklist with progress bar and met/unmet styling |
| Add confidence gauge | Mini circular gauge with 5 signal breakdown bars |
| Build task queue table | Priority badges, NEXT indicator, estimate column |
| Add session controls | Pause/Resume toggle, End Session button |
| Enhance session registry | Added taskQueue, acceptanceCriteria, confidenceSignals fields |
| Add View Details button to cards | Links projects to session detail view |

## Completed (Session 21 - Phase 1 COMPLETE)

| Task | Notes |
|------|-------|
| Create session-registry.js | Multi-session tracking service with EventEmitter |
| Create usage-limit-tracker.js | Track 5h/daily/weekly Claude limits with persistence |
| Add /api/sessions/* endpoints | register, update, pause, resume, end, summary |
| Add /api/usage/limits endpoint | Return usage limits with reset times + alerts |
| Refactor dashboard to Command Center | Grid view + global metrics bar |
| Add Usage Limits panel | 3-column with progress bars + pace indicator |
| Wire orchestrator to dashboard | POST state on phase/task changes, deregister on shutdown |

## Completed (Session 20)

| Task | Notes |
|------|-------|
| Fix orchestrator completion bug | `?? true` → explicit validation |
| Fix task tier movement bug | Added `_moveToCompletedTier()` |
| Create UX design document | `docs/DASHBOARD-UX-REDESIGN.md` |
| Research dashboard patterns | Grafana, Datadog patterns analyzed |

---

## Blocked

| Task | Blocker | Notes |
|------|---------|-------|
| add-model-pricing | Waiting for GPT-5.2/Gemini 3 pricing | Low priority |
