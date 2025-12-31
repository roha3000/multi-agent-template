# Dashboard Validation Audit - 2025-12-31

## Summary

- **Total API Endpoints**: 84
- **Endpoints Used in Dashboard**: ~15 (18%)
- **Critical Gaps Found**: 10+ high-value endpoints not visualized
- **Bug Fixed**: `/api/tasks/graph` (missing `getAllTasks` method)

---

## Endpoints Currently Used by Dashboard

| Endpoint | Purpose | Status |
|----------|---------|--------|
| `/api/projects` | Project list with sessions | ✅ Working |
| `/api/sessions/summary` | Session summary metrics | ✅ Working |
| `/api/tasks` | Task list | ✅ Working |
| `/api/execution` | Current phase/execution state | ✅ Working |
| `/api/usage/limits` | 5h/daily/weekly limits | ✅ Working |
| `/api/predictions` | Predictive analytics | ✅ Working |
| `/api/tasks/in-flight` | Active task claims | ✅ Working |
| `/api/tasks/claims/stats` | Claim statistics | ✅ Working |
| `/api/sessions/:id/pause` | Pause session | ✅ Working |
| `/api/sessions/:id/resume` | Resume session | ✅ Working |
| `/api/sessions/:id/end` | End session | ✅ Working |
| `/api/logs/:id/history` | Log history | ✅ Working |
| `/api/lessons/:project` | Lessons learned | ✅ Working |
| `/api/events` (SSE) | Real-time updates | ✅ Working |

---

## HIGH PRIORITY GAPS - Should Add to Dashboard

### 1. `/api/account` - Account Totals Panel
**Data Available**:
```json
{
  "totalInputTokens": 477745,
  "totalOutputTokens": 470958,
  "totalCacheCreationTokens": 15972930,
  "totalCacheReadTokens": 212194279,
  "totalCost": 188.94,
  "sessionCount": 1047,
  "activeProjects": 1,
  "projectCount": 7
}
```
**Recommendation**: Add an "Account Summary" card showing total cost, session count, and cache efficiency metrics.

### 2. `/api/alerts` - Alerts Panel
**Data Available**:
```json
{
  "alerts": [
    {"level": "info", "project": "research", "message": "New session started"},
    {"level": "warning", "project": "research", "message": "Context at 80.6%"}
  ]
}
```
**Recommendation**: Add an alerts panel/notification area showing recent warnings and critical events.

### 3. `/api/usage/alerts` - Rate Limit Warnings
**Data Available**:
```json
{
  "alerts": [{"window": "fiveHour", "severity": "critical", "message": "Rate too high: 128/hr"}],
  "nearLimit": false
}
```
**Recommendation**: Display rate limit alerts prominently when `severity: critical`. Currently usage bars exist but don't show alert state.

### 4. `/api/execution/scores` - Quality Score Breakdown
**Data Available**:
```json
{
  "phase": "design",
  "scores": {
    "architectureComplete": 95,
    "apiContracts": 90,
    "dataModels": 88,
    "securityDesign": 92,
    "testabilityDesign": 95,
    "scalabilityPlan": 85
  },
  "totalScore": 91,
  "recommendation": "proceed"
}
```
**Recommendation**: Add a quality score breakdown visualization (radar chart or bar chart) showing individual dimension scores.

### 5. `/api/tasks/graph` - Task Dependency Graph
**Data Available** (FIXED):
```json
{
  "graph": {
    "nodes": [...],
    "links": [...]
  },
  "statistics": {
    "totalNodes": 5,
    "totalLinks": 2,
    "criticalPath": ["Task Name"]
  }
}
```
**Recommendation**: Add a D3.js force-directed graph visualization for task dependencies. Link to existing `task-graph.html` or embed.

### 6. `/api/confidence` - Confidence Metrics
**Data Available**:
```json
{
  "confidence": null,
  "level": "healthy",
  "signals": {"qualityScore": 0, "velocity": 0, "iterations": 0, "errorRate": 0}
}
```
**Recommendation**: Add confidence gauge/meter showing current system confidence level.

### 7. `/api/complexity` - Complexity Analysis
**Data Available**:
```json
{
  "score": null,
  "strategy": null,
  "dimensions": {}
}
```
**Recommendation**: When populated, show complexity score and recommended strategy.

### 8. `/api/human-review` - Human-in-Loop Detections
**Data Available**:
```json
{
  "enabled": true,
  "pendingCount": 0,
  "patterns": {"builtin": 7, "learned": 0, "total": 7},
  "statistics": {"totalDetections": 0, "precision": 0, "recall": 0}
}
```
**Recommendation**: Add panel showing pending human review items with action buttons.

### 9. `/api/artifacts` - Session Artifacts
**Data Available**:
```json
{
  "project": "multi-agent-template",
  "count": 0,
  "artifacts": []
}
```
**Recommendation**: Add artifacts list in session detail view (file links, view buttons).

### 10. `/api/notifications/status` - Notification Configuration
**Data Available**:
```json
{
  "enabled": false,
  "sms": {"available": false},
  "email": {"available": false},
  "stats": {"smsSent": 0, "emailsSent": 0}
}
```
**Recommendation**: Add notification settings panel in settings modal.

---

## MEDIUM PRIORITY GAPS

| Endpoint | Data | Recommendation |
|----------|------|----------------|
| `/api/series` | Series tracking for grouped sessions | Show active series with session count |
| `/api/plans` | Competing plans array | Show plan comparison when multiple exist |
| `/api/patterns/:projectId` | Pattern analysis | Show learned patterns in session detail |
| `/api/recommendations` | System recommendations | Display when non-empty |
| `/api/execution/taskPhases` | Task phase history | Add to session timeline |
| `/api/execution/todos` | Claude's internal todos | Display in task panel |

---

## SSE Enhancement Opportunity

Currently uses: `/api/events`
Available but unused: `/api/sse/command-center`

The command-center SSE provides richer data:
- Real-time limit updates with reset times
- Completion events
- Pacing metrics

**Recommendation**: Switch to or augment with `/api/sse/command-center` for better real-time data.

---

## Bugs Fixed

### `/api/tasks/graph` - TypeError: getAllTasks is not a function

**Root Cause**: `TaskManager` had only a private `_getAllTasks()` method but `TaskGraph` expected public `getAllTasks()`.

**Fix Applied**: Added public wrapper in `task-manager.js`:
```javascript
getAllTasks() {
  return this._getAllTasks();
}
```

---

## Interactive Features Tested

| Feature | Status | Notes |
|---------|--------|-------|
| Settings toggle | ✅ Works | Opens modal |
| Usage dropdown | ✅ Works | Shows 5h/daily/weekly |
| Session pause/resume | ✅ Works | API calls succeed |
| Session end | ✅ Works | API calls succeed |
| Skip task | ✅ Works | API calls succeed |
| Queue filters | ✅ Works | All/Available/Claimed/Mine |
| Hierarchy expand/collapse | ✅ Works | Tree view controls |
| Lessons toggle | ✅ Works | Shows/hides lessons |
| Traffic light clicks | ✅ Works | Selects session |

---

## Priority Recommendations

### Immediate (High Value, Low Effort)
1. Add account summary card with total cost/sessions
2. Display usage alerts when severity is critical
3. Show quality score breakdown when available

### Short-term (High Value, Medium Effort)
4. Add alerts panel for warnings/errors
5. Integrate task dependency graph visualization
6. Add human-review pending items panel

### Medium-term (Medium Value, Higher Effort)
7. Add notifications settings to settings modal
8. Switch SSE to command-center endpoint
9. Add artifacts viewer in session details

---

## Test Commands

```bash
# Health check
curl http://localhost:3033/api/health

# Account totals
curl http://localhost:3033/api/account

# Alerts
curl http://localhost:3033/api/alerts

# Quality scores
curl http://localhost:3033/api/execution/scores

# Usage alerts
curl http://localhost:3033/api/usage/alerts

# Task graph
curl http://localhost:3033/api/tasks/graph
```

---

---

## UX Design Recommendations

### Current Problems

1. **Information Overload Risk**: 84 endpoints with valuable data - not all should be on main page
2. **Quality Score Over-emphasized**: Currently prominent but usage % is more actionable
3. **Missing Drill-down Pattern**: All data tries to fit on one page vs progressive disclosure
4. **Confidence Score Missing**: Important metric not displayed anywhere

### Proposed Information Architecture

```
MAIN PAGE (At-a-glance)
├── Header
│   ├── Usage % (PRIMARY - more prominent than today)
│   ├── Rate Limit Status (alerts if critical)
│   └── Account Summary (total cost, sessions)
├── Session List (left panel - keep current)
├── Session Detail (right panel)
│   ├── Key Metrics Row (usage, phase, progress)
│   ├── Current Task
│   └── Quick Actions (pause/resume/end)

DRILL-DOWN PANELS (click to expand/modal)
├── Quality Score → Breakdown Chart (6 dimensions)
├── Confidence → Signals breakdown
├── Usage → Rate limit details + historical
├── Tasks → Dependency Graph visualization
├── Artifacts → File table with view/launch
├── Alerts → Full alert history
└── Settings → Notifications config
```

### Specific Changes Needed

| Current | Problem | Proposed |
|---------|---------|----------|
| Quality score prominent | Not immediately actionable | Move to drill-down, show only score number |
| Usage bars small | Most important metric buried | Make usage % the primary status indicator |
| No alerts display | Critical rate alerts hidden | Add alerts banner when severity=critical |
| No confidence | Missing important signal | Add confidence indicator next to quality |
| No artifacts | Can't see session output | Add artifacts table in drill-down |
| All on one page | Cluttered, hard to scan | Progressive disclosure with drill-downs |

### Drill-down Design Pattern

Each drill-down should:
1. Open on click of metric/card
2. Show detailed visualization (chart, table, graph)
3. Provide actions where relevant
4. Close easily (ESC, click outside, X button)

Example implementations:
- **Quality Score Drill-down**: Radar chart or bar chart with 6 dimensions
- **Tasks Drill-down**: D3.js force-directed dependency graph
- **Artifacts Drill-down**: Sortable table with type, path, phase, actions
- **Alerts Drill-down**: Timeline of alerts with severity filtering

### Priority Metrics (Main Page)

| Metric | Position | Size | Reason |
|--------|----------|------|--------|
| Usage % | Header, left | Large | Most actionable - affects work pace |
| Rate Limit Alert | Header, banner | Full width when critical | Prevents rate limit issues |
| Phase | Session detail | Medium | Shows current state |
| Task Progress | Session detail | Medium | Shows completion status |
| Quality Score | Session detail | Small (clickable) | Click for breakdown |
| Confidence | Session detail | Small | New, next to quality |

### Next Steps

1. **UX Designer Review**: Create wireframes for new layout
2. **Prototype**: Build interactive prototype for user testing
3. **Incremental Implementation**:
   - Phase 1: Add alerts banner + usage prominence
   - Phase 2: Add drill-down infrastructure
   - Phase 3: Implement individual drill-downs
   - Phase 4: Polish and responsive design

---

**Audit Completed**: 2025-12-31
**Dashboard Version**: 2.1.0
**Auditor**: Claude Code (Session 68)
