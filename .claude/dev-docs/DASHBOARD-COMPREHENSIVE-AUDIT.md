# Dashboard Comprehensive Audit Report

**Date**: 2026-01-06
**Session**: 96 (Initial), 97 (Verification)
**Audit Method**: 6 Parallel Expert Agent Swarm (Code Review + Verification)
**Status**: ✅ VERIFICATION COMPLETE
**Verification Date**: 2026-01-06

> **Session 97 Verification Summary**: A 6-agent parallel swarm verified all audit findings through deep code inspection. Results: **15 of 18 issues CONFIRMED**, 2 NOT FOUND (issues working correctly), 1 PARTIALLY CONFIRMED.

---

## Verification Results Summary

| Area | Issues | Confirmed | Not Found | Partial |
|------|--------|-----------|-----------|---------|
| Session Type Classification | 4 | 4 | 0 | 0 |
| Duplicate Sessions | 3 | 3 | 0 | 0 |
| Logs Display | 3 | 3 | 0 | 0 |
| SSE Real-time Updates | 3 | 1 | 1 | 1 |
| Multi-Project Handling | 3 | 3 | 0 | 0 |
| Hierarchy Display | 3 | 1 | 2 | 0 |
| **TOTAL** | **19** | **15** | **3** | **1** |

### Key Corrections from Verification

1. **Issue 4.1 INVALID**: `session:deregistered` IS properly broadcast (code at line 3664 confirms listener exists)
2. **Issue 6.1 INVALID**: `hierarchyInfo` IS correctly populated during registration
3. **Issue 6.3 INVALID**: `getChildSessions()` works correctly when hierarchy is properly linked
4. **Issue 6.2 ROOT CAUSE FOUND**: `session:childAdded` event is emitted but NOT broadcast to SSE clients

---

## Executive Summary

A comprehensive audit of the Fleet Dashboard revealed **23 critical/high-priority issues** across 6 areas:

| Area | Critical | High | Medium | Low |
|------|----------|------|--------|-----|
| Session Type Classification | 2 | 2 | 2 | 1 |
| Duplicate Sessions | 1 | 2 | 2 | 1 |
| Logs Display | 2 | 1 | 1 | 0 |
| SSE Real-time Updates | 1 | 2 | 2 | 2 |
| Multi-Project Handling | 2 | 1 | 2 | 2 |
| Hierarchy Display | 1 | 1 | 1 | 0 |
| **TOTAL** | **9** | **9** | **10** | **6** |

**Root Causes Identified**:
1. **Async registration not awaited** - orchestrator starts logging before session ID is set
2. **SSE event format mismatch** - log-streamer sends events dashboard doesn't handle
3. **Race conditions in registration** - parallel requests create duplicates
4. **Missing event emissions** - state changes don't trigger SSE updates
5. **Project key system mismatch** - GlobalContextTracker vs SessionRegistry use different keys

---

## Issue 1: Session Type Classification Failures

### Problem
CLI sessions appearing as autonomous, and autonomous sessions appearing as CLI.

### Root Causes

#### 1.1 CRITICAL: Double Registration Without claudeSessionId Deduplication
**Location**: `global-context-manager.js:2200-2326`

When the orchestrator registers without `claudeSessionId`:
1. Hook registers with original sessionType
2. Orchestrator registers separately
3. If no recent CLI session found, **new duplicate session created**

```javascript
// Line 2201 - Falls through to create new session
if (sessionType === 'autonomous' && !claudeSessionId && projectPath) {
  // Searches for recent CLI sessions to upgrade...
  // If none found, CREATES NEW SESSION instead of upgrading
}
```

#### 1.2 CRITICAL: Async Registration Not Awaited
**Location**: `autonomous-orchestrator.js:1312`

```javascript
// WRONG - returns Promise, not boolean
const commandCenterEnabled = initializeCommandCenter();
// Should be: const commandCenterEnabled = await initializeCommandCenter();
```

This means `registeredSessionId` is null when logs are written, causing silent failures.

#### 1.3 HIGH: Environment Variable Timing Issue
**Location**: `session-start.js:72-74`, `autonomous-orchestrator.js:612-614`

The hook checks `ORCHESTRATOR_SESSION` env var, but orchestrator sets it only for child processes. Initial orchestrator process doesn't have it set.

### Recommended Fixes
1. **CRITICAL**: Make hook ALWAYS pass `claudeSessionId` to registration
2. **CRITICAL**: Add `await` to `initializeCommandCenter()` call
3. **HIGH**: Set `ORCHESTRATOR_SESSION` before spawning any processes
4. **MEDIUM**: Make `autonomous` and `sessionType` update together atomically

---

## Issue 2: Duplicate CLI Sessions

### Problem
Multiple sessions appearing for the same Claude session.

### Root Causes

#### 2.1 CRITICAL: Unserialized claudeSessionId Registration
**Location**: `global-context-manager.js:2177-2322`

No atomic check-and-create operation. Between `getByClaudeSessionId()` check and `register()` call, another request can create a duplicate.

```
Timeline (Race Condition):
T0: Request A calls getByClaudeSessionId(id) → returns null
T0: Request B calls getByClaudeSessionId(id) → returns null (same race)
T1: Request A creates session ID 42
T2: Request B creates session ID 43 (DUPLICATE!)
```

#### 2.2 HIGH: existingSessionId Becomes Invalid After Cleanup
**Location**: `session-registry.js:1080`

Sessions are deleted entirely after 30-minute stale threshold. If orchestrator reconnects after cleanup, creates new session instead of resuming.

#### 2.3 HIGH: SSE Reconnection Creates Duplicates
**Location**: `global-context-manager.js:2154-2170`

If stale cleanup runs between disconnect and reconnect, `existingSessionId` lookup fails and new session is created.

### Recommended Fixes
1. **CRITICAL**: Add mutex/lock around claudeSessionId registration
2. **HIGH**: Mark sessions as 'stale' instead of deleting (5-minute grace period)
3. **HIGH**: Use orchestrator PID or claim token to prevent duplicate sessions

---

## Issue 3: Logs Blank for Autonomous Sessions

### Problem
Autonomous orchestrator sessions show empty logs in dashboard.

### Root Causes

#### 3.1 CRITICAL: SSE Event Format Mismatch
**Location**: `log-streamer.js:316,333` vs `global-dashboard.html:5929`

**Log-streamer sends:**
```javascript
event: log
data: {"line": "...", "level": "INFO", ...}
```

**Dashboard expects:**
```javascript
// onmessage handler expects:
{type: 'log', entry: {...}}
// But receives raw entry object - MISMATCH!
```

Dashboard only listens to `onmessage` (default event), not named `log` events.

#### 3.2 CRITICAL: Async Registration Causes Silent Log Failures
**Location**: `autonomous-orchestrator.js:1020-1026`

```javascript
async function logToDashboard(message, level, source) {
  if (!registeredSessionId) {
    // Only logs if DEBUG_LOGS === 'true', otherwise SILENT
    return false;  // Logs silently discarded!
  }
}
```

Because `initializeCommandCenter()` isn't awaited, `registeredSessionId` is null when `logToDashboard()` is called.

#### 3.3 HIGH: Missing Event Listener for 'log' Events
**Location**: `global-dashboard.html:5924-5962`

Dashboard only has `onmessage` handler, no explicit `log` event listener:
```javascript
logStreamEventSource = new EventSource(`/api/logs/${sessionId}/stream`);
logStreamEventSource.onmessage = (event) => { ... };
// MISSING: logStreamEventSource.addEventListener('log', ...)
```

### Recommended Fixes
1. **CRITICAL**: Add `addEventListener('log', ...)` to dashboard
2. **CRITICAL**: Add `await` to `initializeCommandCenter()`
3. **HIGH**: Add error logging when `registeredSessionId` is null

---

## Issue 4: SSE Real-time Updates Incomplete

### Problem
Dashboard not updating in real-time for all state changes.

### Root Causes

#### 4.1 CRITICAL: Session Deregistration Missing from Fleet Broadcasting
**Location**: `global-context-manager.js:3664` vs `4128`

`session:deregistered` event triggers Command Center update but NOT WebSocket broadcast. Fleet dashboard never learns when sessions end.

#### 4.2 HIGH: State Changes Don't Trigger Events
**Location**: Multiple

| State Change | SSE Event | Impact |
|--------------|-----------|--------|
| Phase transition | NO | 3s lag |
| Quality score | NO | 3s lag |
| Confidence update | NO | 3s lag |
| Plan comparison | NO | 3s lag |

All rely on 3-second polling instead of event-driven updates.

#### 4.3 HIGH: No Stale Connection Detection
- No server-side timeout for idle SSE connections
- No heartbeat from `/api/events` or `/api/sse/claims`
- Dead connections accumulate without cleanup

### Recommended Fixes
1. **CRITICAL**: Add `session:deregistered` to WebSocket broadcast
2. **HIGH**: Emit SSE events for all state changes
3. **HIGH**: Add heartbeat (30s) to SSE endpoints

---

## Issue 5: Multi-Project Session Issues

### Problem
Sessions from different projects interfering; wrong project assigned.

### Root Causes

#### 5.1 CRITICAL: OTLP Metric Project Resolution Unreliable
**Location**: `GlobalContextTracker.processOTLPMetric()` lines 1338-1512

If session ID not found, falls back to "most recently active" project:
```javascript
const resolvedProjectFolder = projectFolder || this._resolveProjectFolder(sessionId);
// Falls back to: mostRecentFolder (line 1507) - WRONG PROJECT!
```

#### 5.2 CRITICAL: Project Key System Mismatch
- **GlobalContextTracker**: Uses `projectFolder` (encoded: "C--Users-roha3-...")
- **SessionRegistry**: Uses `projectKey` (normalized: "c:/users/roha3/...")
- **NO mapping between the two systems!**

Dashboard tries to use both but they don't interoperate.

#### 5.3 HIGH: Session Cleanup Not Project-Scoped
**Location**: `GlobalContextTracker` lines 1705-1776

All projects use same `inactiveThresholdMs` (10 minutes). Can't have different retention policies per project.

### Recommended Fixes
1. **CRITICAL**: Require OTLP metrics to include project ID (don't guess)
2. **CRITICAL**: Unify project key system (single encoding method)
3. **HIGH**: Add per-project cleanup configuration

---

## Issue 6: Hierarchy Not Displaying

### Problem
Parent-child relationships not showing when agents are operating.

### Root Causes

#### 6.1 CRITICAL: hierarchyInfo Not Set During Registration
When sessions register, `hierarchyInfo` field may not be populated:
- Child agents don't always pass `parentSessionId`
- `hierarchyInfo.isRoot` not consistently set

#### 6.2 HIGH: No SSE Event for Hierarchy Updates
**Location**: Multiple

Hierarchy changes don't emit dedicated SSE events:
- `delegation:added` events exist but not connected to hierarchy display
- Dashboard polls for hierarchy data instead of receiving updates

#### 6.3 MEDIUM: Hierarchy API Returns Empty Children
**Location**: `global-context-manager.js:2112-2145`

`getChildSessions()` may return empty if parent-child relationships aren't registered:
```javascript
const childSessions = sessionRegistry.getChildSessions(session.id);
// Returns [] if hierarchyInfo not properly linked
```

### Recommended Fixes
1. **CRITICAL**: Always set `hierarchyInfo` when registering child sessions
2. **HIGH**: Emit SSE events when hierarchy changes
3. **MEDIUM**: Add fallback hierarchy resolution by project path

---

## Complete Issue Matrix (Post-Verification)

| ID | Issue | Severity | File | Lines | Verified | Status |
|----|-------|----------|------|-------|----------|--------|
| 1.1 | Double registration without claudeSessionId | CRITICAL | global-context-manager.js | 2200-2326 | ✅ CONFIRMED | Open |
| 1.2 | Async registration not awaited | CRITICAL | autonomous-orchestrator.js | 1312 | ✅ CONFIRMED | Open |
| 1.3 | Environment variable timing | HIGH | session-start.js | 72-74 | ✅ CONFIRMED | Open |
| 1.4 | sessionType/autonomous field inconsistency | LOW | session-registry.js | 645-646 | ✅ CONFIRMED (low risk) | Open |
| 2.1 | Unserialized claudeSessionId registration | CRITICAL | global-context-manager.js | 2177-2322 | ✅ CONFIRMED | Open |
| 2.2 | existingSessionId invalid after cleanup | HIGH | session-registry.js | 1080 | ✅ CONFIRMED | Open |
| 2.3 | SSE reconnection creates duplicates | HIGH | global-context-manager.js | 2154-2170 | ✅ CONFIRMED | Open |
| 3.1 | SSE event format mismatch | CRITICAL | log-streamer.js, dashboard | 316, 5929 | ✅ CONFIRMED | Open |
| 3.2 | Silent log failures | CRITICAL | autonomous-orchestrator.js | 1020-1026 | ✅ CONFIRMED | Open |
| 3.3 | Missing 'log' event listener | CRITICAL | global-dashboard.html | 5924-5962 | ✅ CONFIRMED (most critical) | Open |
| 4.1 | Session deregistration missing from broadcast | ~~CRITICAL~~ | global-context-manager.js | 3664 | ❌ NOT FOUND | Closed |
| 4.2 | State changes don't trigger events | HIGH | global-context-manager.js | Multiple | ✅ CONFIRMED | Open |
| 4.3 | No stale connection detection | HIGH | global-context-manager.js | Multiple | ⚠️ PARTIAL (1/4 endpoints have heartbeat) | Open |
| 5.1 | OTLP project resolution unreliable | CRITICAL | global-context-tracker.js | 1338-1512 | ✅ CONFIRMED | Open |
| 5.2 | Project key system mismatch | CRITICAL | Multiple | Multiple | ✅ CONFIRMED (no translation layer) | Open |
| 5.3 | Cleanup not project-scoped | HIGH | global-context-tracker.js | 1705-1776 | ✅ CONFIRMED | Open |
| 6.1 | hierarchyInfo not set during registration | ~~CRITICAL~~ | global-context-manager.js | 2148-2330 | ❌ NOT FOUND | Closed |
| 6.2 | No SSE broadcast for session:childAdded | HIGH | global-context-manager.js | 744 (session-registry) | ✅ CONFIRMED (root cause found) | Open |
| 6.3 | Hierarchy API returns empty children | ~~MEDIUM~~ | global-context-manager.js | 2112-2145 | ❌ NOT FOUND | Closed |

---

## Priority Fix Order (Updated Post-Verification)

### Immediate (Critical Path - 3 fixes unlock logs display)
1. **Add `await` to `initializeCommandCenter()`** - autonomous-orchestrator.js:1312
   - Fixes: Session type, log failures, registeredSessionId race
   - Impact: HIGH - single line fix unlocks multiple issues

2. **Add `addEventListener('log', ...)` to dashboard** - global-dashboard.html:5924
   - Fixes: Named SSE events not being received
   - Impact: CRITICAL - without this, logs NEVER display for autonomous sessions

3. **Add `session:childAdded` SSE broadcast** - global-context-manager.js (new listener)
   - Fixes: Hierarchy not updating in real-time
   - Impact: HIGH - hierarchy works but doesn't update without page refresh

### Short-Term (Race Conditions & Duplicates)
4. Add mutex/lock around claudeSessionId registration - Fixes duplicates
5. Mark sessions 'stale' instead of deleting - Fixes reconnection race
6. Emit SSE events for phase/quality/confidence changes - Fixes 3s polling lag

### Medium-Term (Multi-Project & Cleanup)
7. Unify project key system (GlobalContextTracker ↔ SessionRegistry)
8. Require OTLP metrics to include project ID
9. Add per-project cleanup configuration
10. Add heartbeat to remaining 3 SSE endpoints

### Closed (Verified Working)
- ~~Add `session:deregistered` to WebSocket broadcast~~ - Already implemented correctly
- ~~Always set `hierarchyInfo` on child session registration~~ - Already implemented correctly
- ~~Fix Hierarchy API returns empty children~~ - Works when hierarchy is linked

---

## Test Coverage Gaps Identified

The following scenarios need E2E tests:

1. **Parallel simultaneous session registrations** (race condition)
2. **SSE reconnection during stale cleanup** (timing)
3. **Orchestrator without claudeSessionId race conditions**
4. **OTLP metric assignment under concurrent multi-project**
5. **Log streaming with named events** (event: log)
6. **Hierarchy display with active child agents**
7. **Session type upgrade from CLI to autonomous**

---

## Audit Methodology

### Session 96: Initial Code Review (6 Agents)

| Agent | Focus Area | Status |
|-------|------------|--------|
| Session Type Classification | CLI vs Autonomous detection | Complete |
| Duplicate Session Investigation | Deduplication logic | Complete |
| Logs Display Investigation | Log streaming for autonomous | Complete |
| SSE Event Flow Validation | Real-time updates | Complete |
| Multi-Project Session Validation | Cross-project isolation | Complete |
| Hierarchy Display Validation | Parent-child relationships | Complete |

### Session 97: Verification Swarm (6 Agents)

| Agent | Focus Area | Issues Checked | Result |
|-------|------------|----------------|--------|
| Session Type Verifier | Issues 1.1-1.4 | 4 | 4 CONFIRMED |
| Duplicate Session Verifier | Issues 2.1-2.3 | 3 | 3 CONFIRMED |
| Logs Display Verifier | Issues 3.1-3.3 | 3 | 3 CONFIRMED |
| SSE Updates Verifier | Issues 4.1-4.3 | 3 | 1 NOT FOUND, 1 PARTIAL, 1 CONFIRMED |
| Multi-Project Verifier | Issues 5.1-5.3 | 3 | 3 CONFIRMED |
| Hierarchy Display Verifier | Issues 6.1-6.3 | 3 | 2 NOT FOUND, 1 CONFIRMED (root cause found) |

### Tools Used
- 12 parallel expert agents total (Explore subagent type)
- Deep code path analysis with line-number verification
- Cross-file dependency tracing

---

## Conclusion

### Post-Verification Assessment

The 6-agent verification swarm **confirmed 15 of 18 original findings** and corrected 3 false positives:

**Root Causes (Verified)**:
1. **Async timing** - `await` missing at autonomous-orchestrator.js:1312 (CRITICAL)
2. **SSE event handling** - Dashboard uses `onmessage` but log-streamer sends named `event: log` (CRITICAL)
3. **Race conditions** - TOCTOU in claudeSessionId registration (CRITICAL)
4. **Missing SSE broadcast** - `session:childAdded` emitted but not broadcast to clients (HIGH)
5. **Project key mismatch** - No translation between encoded/normalized formats (CRITICAL)

**Corrections Made**:
- Issue 4.1 closed: `session:deregistered` IS properly broadcast
- Issue 6.1 closed: `hierarchyInfo` IS correctly populated
- Issue 6.3 closed: `getChildSessions()` works correctly
- Issue 6.2 root cause identified: `session:childAdded` not broadcast (was misdiagnosed as "no SSE event")

### Critical Path to Fix Logs Display

Three fixes are needed to make autonomous session logs work:

```
1. autonomous-orchestrator.js:1312
   - const commandCenterEnabled = await initializeCommandCenter();
                                  ^^^^^

2. global-dashboard.html:5924
   + logStreamEventSource.addEventListener('log', (event) => {
   +   const entry = JSON.parse(event.data);
   +   // Handle entry.line, entry.level, entry.timestamp
   + });

3. global-context-manager.js (add listener ~line 4148)
   + sessionRegistry.on('session:childAdded', ({ parentSessionId, childSessionId }) => {
   +   broadcastFleetEvent({ type: 'hierarchy:childAdded', parentSessionId, childSessionId });
   + });
```

**Estimated effort**:
- Immediate fixes (3 items): ~2 hours
- Short-term fixes (race conditions): ~8 hours
- Full resolution: ~2 weeks
