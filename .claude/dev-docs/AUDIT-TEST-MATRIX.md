# COMPREHENSIVE DASHBOARD AUDIT TEST MATRIX

**Date**: 2026-01-06
**Purpose**: Detailed test specification for all 23 issues identified in dashboard audit
**Target Audience**: Playwright test agents and QA engineers
**Status**: Ready for E2E test implementation

---

## SECTION 1: ISSUE SUMMARIES & ROOT CAUSES

### CRITICAL ISSUES (9 total)

#### **Issue 1.1: Double Registration Without claudeSessionId Deduplication**
- **Severity**: CRITICAL
- **Category**: Session Type Classification
- **File**: `global-context-manager.js` (lines 2200-2326)
- **Root Cause**: When orchestrator registers without `claudeSessionId`, the system searches for recent CLI sessions but creates a NEW session if none found (should upgrade existing)
- **Testable**: YES - Can reproduce by launching orchestrator without passing CLI sessionId

#### **Issue 1.2: Async Registration Not Awaited**
- **Severity**: CRITICAL
- **Category**: Session Type Classification
- **File**: `autonomous-orchestrator.js` (line 1312)
- **Root Cause**: `initializeCommandCenter()` returns Promise but not awaited; `registeredSessionId` is null when logs written
- **Testable**: YES - Direct code path issue (deterministic)

#### **Issue 2.1: Unserialized claudeSessionId Registration (Race Condition)**
- **Severity**: CRITICAL
- **Category**: Duplicate Sessions
- **File**: `global-context-manager.js` (lines 2177-2322)
- **Root Cause**: No atomic check-and-create. Between `getByClaudeSessionId()` and `register()`, another request creates duplicate
- **Testable**: YES - Requires parallel requests (timing-dependent but reproducible)

#### **Issue 3.1: SSE Event Format Mismatch**
- **Severity**: CRITICAL
- **Category**: Logs Display
- **File**: `log-streamer.js` (line 316, 333) vs `global-dashboard.html` (line 5929)
- **Root Cause**: Log-streamer sends `event: log` named events, dashboard only listens to `onmessage` (unnamed events)
- **Testable**: YES - Direct code path (no race condition)

#### **Issue 3.2: Silent Log Failures**
- **Severity**: CRITICAL
- **Category**: Logs Display
- **File**: `autonomous-orchestrator.js` (lines 1020-1026)
- **Root Cause**: `logToDashboard()` checks `if (!registeredSessionId)` and returns silently if null
- **Testable**: YES - Same root cause as 1.2

#### **Issue 4.1: Session Deregistration Missing from Fleet Broadcasting**
- **Severity**: CRITICAL
- **Category**: SSE Real-time Updates
- **File**: `global-context-manager.js` (lines 3664 vs 4128)
- **Root Cause**: `session:deregistered` event triggers Command Center update but NOT WebSocket broadcast
- **Testable**: YES - Direct code path (observable via UI)

#### **Issue 5.1: OTLP Metric Project Resolution Unreliable**
- **Severity**: CRITICAL
- **Category**: Multi-Project Handling
- **File**: `GlobalContextTracker.processOTLPMetric()` (lines 1338-1512)
- **Root Cause**: If session ID not found, falls back to "most recently active" project (wrong assignment)
- **Testable**: YES - Requires concurrent multi-project activity

#### **Issue 5.2: Project Key System Mismatch**
- **Severity**: CRITICAL
- **Category**: Multi-Project Handling
- **File**: Multiple files (GlobalContextTracker vs SessionRegistry)
- **Root Cause**: Two different project key encoding systems don't interoperate
- **Testable**: YES - Can trigger with multi-project scenario

#### **Issue 6.1: hierarchyInfo Not Set During Registration**
- **Severity**: CRITICAL
- **Category**: Hierarchy Display
- **File**: `global-context-manager.js` (lines 2148-2330)
- **Root Cause**: When child sessions register, `hierarchyInfo` field often empty/null
- **Testable**: YES - Observable in hierarchy display

---

### HIGH-PRIORITY ISSUES (9 total)

| ID | Issue | File | Root Cause |
|----|-------|------|------------|
| 1.3 | Environment variable timing | session-start.js:72-74 | ORCHESTRATOR_SESSION only set for child processes |
| 2.2 | existingSessionId invalid after cleanup | session-registry.js:1080 | Sessions deleted at 30-min threshold |
| 2.3 | SSE reconnection creates duplicates | global-context-manager.js:2154-2170 | Cleanup runs between disconnect/reconnect |
| 3.3 | Missing 'log' event listener | global-dashboard.html:5924-5962 | Only `onmessage` handler, no `addEventListener('log')` |
| 4.2 | State changes don't trigger events | Multiple | 3-second polling instead of SSE |
| 4.3 | No stale connection detection | Multiple | No heartbeat for idle SSE connections |
| 5.3 | Cleanup not project-scoped | GlobalContextTracker:1705-1776 | Global 10-min threshold for all projects |
| 6.2 | No SSE event for hierarchy updates | Multiple | Hierarchy changes don't emit SSE events |

---

## SECTION 2: TEST SCENARIOS

### TEST GROUP 1: Session Type Classification (5 tests)

| Test ID | Title | Issues | Reproducibility |
|---------|-------|--------|-----------------|
| 1.1.1 | Orchestrator registration without claudeSessionId | 1.1 | 100% |
| 1.2.1 | Orchestrator logs appear after initialization | 1.2, 3.2 | 100% |
| 1.3.1 | Environment variable timing | 1.3 | 100% |
| 1.4.1 | Session type and autonomous field consistency | 1.4 | 100% |
| 1.5.1 | CLI to autonomous session upgrade path | 1.1, 1.2, 1.3 | 100% |

### TEST GROUP 2: Duplicate Session Prevention (4 tests)

| Test ID | Title | Issues | Difficulty |
|---------|-------|--------|------------|
| 2.1.1 | Concurrent claudeSessionId registration (race) | 2.1 | High |
| 2.2.1 | Session reconnection after stale cleanup | 2.2, 2.3 | High |
| 2.3.1 | SSE reconnection during stale cleanup | 2.3 | High |
| 2.4.1 | Session conflict detection & resolution | 2.1 | Medium |

### TEST GROUP 3: Logs Display (3 tests)

| Test ID | Title | Issues | Reproducibility |
|---------|-------|--------|-----------------|
| 3.1.1 | SSE named log events received | 3.1 | 100% |
| 3.2.1 | Log listener registered for named events | 3.3 | 100% |
| 3.3.1 | Autonomous session logs visible in dashboard | 3.1, 3.2, 3.3 | 100% |

### TEST GROUP 4: SSE Real-time Updates (4 tests)

| Test ID | Title | Issues | Difficulty |
|---------|-------|--------|------------|
| 4.1.1 | Session deregistration broadcasts to fleet | 4.1 | High |
| 4.2.1 | State change events trigger real-time updates | 4.2 | Medium |
| 4.3.1 | SSE heartbeat keeps connections alive | 4.3 | Medium |
| 4.4.1 | No stale connection accumulation | 4.3 | High |

### TEST GROUP 5: Multi-Project Handling (3 tests)

| Test ID | Title | Issues | Difficulty |
|---------|-------|--------|------------|
| 5.1.1 | OTLP metric project resolution fails safely | 5.1 | Medium |
| 5.2.1 | Unified project key system | 5.2 | Medium |
| 5.3.1 | Per-project cleanup configuration | 5.3 | Medium |

### TEST GROUP 6: Hierarchy Display (3 tests)

| Test ID | Title | Issues | Difficulty |
|---------|-------|--------|------------|
| 6.1.1 | Hierarchy info set on child registration | 6.1 | Medium |
| 6.2.1 | Hierarchy updates broadcast via SSE | 6.2 | High |
| 6.3.1 | Hierarchy API returns child sessions | 6.3 | Low |

---

## SECTION 3: TEST COVERAGE GAPS (7 Advanced Scenarios)

1. **Parallel simultaneous session registrations** - Race condition in 2.1
2. **SSE reconnection during stale cleanup** - Timing coordination required
3. **Orchestrator without claudeSessionId race conditions** - CLI-to-orchestrator handoff
4. **OTLP metric assignment under concurrent multi-project** - Cross-project metrics
5. **Log streaming with named events** - Named SSE events ignored
6. **Hierarchy display with active child agents** - Real-time hierarchy updates
7. **Session type upgrade from CLI to autonomous** - State preservation

---

## SECTION 4: PRIORITY RANKING

| Priority | Issue ID | Test | Reproducibility | Impact |
|----------|----------|------|-----------------|--------|
| P1 | 1.2, 3.2 | Test 1.2.1 | 100% | Critical (no logs) |
| P1 | 3.1, 3.3 | Test 3.3.1 | 100% | Critical (blank logs) |
| P1 | 4.1 | Test 4.1.1 | 95% | High (stale sessions) |
| P2 | 2.1 | Test 2.1.1 | 50% | High (duplicates) |
| P2 | 1.1 | Test 1.1.1 | 100% | High (type wrong) |
| P2 | 6.1 | Test 6.1.1 | 100% | High (empty tree) |
| P3 | 4.2 | Test 4.2.1 | 100% | Medium (3s lag) |
| P3 | 5.2 | Test 5.2.1 | 100% | High (wrong project) |

---

## SECTION 5: IMMEDIATE FIX RECOMMENDATIONS

### Phase 1 (High-Impact Fixes)
- [ ] Issue 1.2: Add `await` to initializeCommandCenter()
- [ ] Issue 3.3: Add addEventListener('log', ...) to dashboard
- [ ] Issue 4.1: Broadcast session:deregistered to WebSocket
- [ ] Issue 6.1: Always set hierarchyInfo on child registration

**Expected Impact**: Fixes ~80% of visible dashboard issues

### Phase 2 (Race Condition Fixes)
- [ ] Issue 2.1: Add mutex around claudeSessionId registration
- [ ] Issue 2.3: Preserve existingSessionId on reconnect

### Phase 3 (Real-time Updates & Multi-Project)
- [ ] Issue 4.2: Emit SSE events for state changes
- [ ] Issue 5.2: Unify project key system

---

## SECTION 6: TEST FILE STRUCTURE

```
tests/e2e/
├── session-registration-race.playwright.js      (Group 2)
├── sse-logs-validation.playwright.js            (Group 3 & 4)
├── hierarchy-display-validation.playwright.js   (Group 6)
├── multi-project-isolation.playwright.js        (Group 5)
└── dashboard-ui-validation.playwright.js        (Existing)
```

---

**Total Tests**: 22 scenarios across 6 groups
**Estimated Fix Time**: 16-27 hours for all 23 issues
