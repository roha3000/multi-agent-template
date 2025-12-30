# Session-Task Claiming Design

**Created**: 2025-12-28
**Status**: Approved
**Author**: Expert Agent Swarm (5 agents)

## Problem Statement

The dashboard shows the same "current task" for all sessions because:
1. Tasks in `tasks.json` have no field tracking which session claimed them
2. The `assignee` field exists but is never enforced or updated
3. Dashboard pulls from project-level `tasks.json` - all sessions see the same queue
4. `session.taskQueue` is a disconnected copy, not linked to source of truth

**Impact**: Users cannot see which session is working on which task, making multi-session coordination impossible.

---

## Solution Overview

Implement atomic task claiming with session binding:

1. **CoordinationDB**: Add `task_claims` table for cross-process atomic claiming
2. **tasks.json**: Add `claim` object to track current session ownership
3. **SessionRegistry**: Add `currentTaskId` for quick session-to-task lookup
4. **Dashboard API**: Add 7 new endpoints for claim management
5. **SSE Events**: Broadcast claim/release events for real-time updates

---

## Data Model

### 1. Task Schema Extension

Add `claim` field to task objects in `tasks.json`:

```javascript
{
  "id": "hierarchy-phase4-metrics",
  "title": "Phase 4: Delegation Metrics",
  "status": "in_progress",

  // NEW: Claim tracking
  "claim": {
    "sessionId": "session-abc-123",      // Session that claimed this task
    "claimedAt": "2025-12-28T12:00:00Z", // When claimed
    "expiresAt": "2025-12-28T12:30:00Z", // Auto-release if no heartbeat
    "lastHeartbeat": "2025-12-28T12:25:00Z", // Last activity
    "agentType": "autonomous"            // "autonomous" | "cli"
  }
}
```

### 2. Session Schema Extension

Add fields to SessionRegistry session objects:

```javascript
{
  // ... existing fields ...

  // NEW: Current task binding
  "currentTaskId": "hierarchy-phase4-metrics",
  "currentTaskClaimedAt": "2025-12-28T12:00:00Z",

  // NEW: Claim history (last 10)
  "claimHistory": [
    {
      "taskId": "hierarchy-phase3-auto-delegation",
      "claimedAt": "2025-12-28T10:00:00Z",
      "releasedAt": "2025-12-28T11:45:00Z",
      "releaseReason": "completed",
      "duration": 6300000
    }
  ]
}
```

### 3. CoordinationDB Schema

Add `task_claims` table:

```sql
CREATE TABLE IF NOT EXISTS task_claims (
  task_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  expires_at INTEGER NOT NULL,
  last_heartbeat INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  agent_type TEXT,
  metadata TEXT,

  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_claims_session ON task_claims(session_id);
CREATE INDEX IF NOT EXISTS idx_task_claims_expires ON task_claims(expires_at);
```

---

## API Specification

### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tasks/:taskId/claim` | POST | Claim task for session |
| `/api/tasks/:taskId/release` | POST | Release claimed task |
| `/api/tasks/:taskId/claim/heartbeat` | POST | Extend claim TTL |
| `/api/tasks/in-flight` | GET | Get all claimed tasks |
| `/api/sessions/:sessionId/current-task` | GET | Get session's current task |
| `/api/tasks/claims/cleanup` | POST | Clean orphaned claims |
| `/api/tasks/claims/stats` | GET | Claim statistics |

### POST `/api/tasks/:taskId/claim`

**Request:**
```json
{
  "sessionId": "session-abc-123",
  "ttlMs": 1800000,
  "agentType": "autonomous"
}
```

**Response (200 Success):**
```json
{
  "success": true,
  "claim": {
    "taskId": "hierarchy-phase4-metrics",
    "sessionId": "session-abc-123",
    "claimedAt": "2025-12-28T12:00:00Z",
    "expiresAt": "2025-12-28T12:30:00Z"
  }
}
```

**Response (409 Conflict - Already Claimed):**
```json
{
  "success": false,
  "error": "TASK_ALREADY_CLAIMED",
  "claim": {
    "sessionId": "session-xyz-789",
    "claimedAt": "2025-12-28T11:45:00Z",
    "remainingMs": 900000
  }
}
```

### POST `/api/tasks/:taskId/release`

**Request:**
```json
{
  "sessionId": "session-abc-123",
  "reason": "completed"
}
```

**Response:**
```json
{
  "success": true,
  "released": {
    "taskId": "hierarchy-phase4-metrics",
    "reason": "completed",
    "claimDuration": 1800000
  }
}
```

### POST `/api/tasks/:taskId/claim/heartbeat`

**Request:**
```json
{
  "sessionId": "session-abc-123",
  "extendMs": 1800000
}
```

**Response:**
```json
{
  "success": true,
  "claim": {
    "expiresAt": "2025-12-28T13:00:00Z",
    "heartbeatCount": 3
  }
}
```

### GET `/api/tasks/in-flight`

**Query Parameters:**
- `sessionId` (optional): Filter by session
- `includeExpired` (optional): Include expired claims

**Response:**
```json
{
  "inFlight": [
    {
      "taskId": "hierarchy-phase4-metrics",
      "task": {
        "title": "Phase 4: Delegation Metrics",
        "phase": "implementation",
        "priority": "medium"
      },
      "claim": {
        "sessionId": "session-abc-123",
        "claimedAt": "2025-12-28T12:00:00Z",
        "expiresAt": "2025-12-28T12:30:00Z",
        "agentType": "autonomous",
        "healthStatus": "healthy"
      }
    }
  ],
  "summary": {
    "total": 3,
    "bySession": { "session-abc-123": 2, "session-xyz-789": 1 }
  }
}
```

### GET `/api/sessions/:sessionId/current-task`

**Response:**
```json
{
  "sessionId": "session-abc-123",
  "currentTask": {
    "taskId": "hierarchy-phase4-metrics",
    "title": "Phase 4: Delegation Metrics",
    "claim": {
      "claimedAt": "2025-12-28T12:00:00Z",
      "remainingMs": 240000
    }
  }
}
```

---

## SSE Events

```javascript
// Task claimed
{ "type": "task:claimed", "data": { "taskId": "...", "sessionId": "..." } }

// Task released
{ "type": "task:released", "data": { "taskId": "...", "reason": "completed" } }

// Claim expired (auto-released)
{ "type": "task:claim-expired", "data": { "taskId": "...", "sessionId": "..." } }

// Orphaned claim cleaned up
{ "type": "task:claim-orphaned", "data": { "taskId": "...", "reason": "session_dead" } }
```

---

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `TASK_NOT_FOUND` | 404 | Task ID does not exist |
| `SESSION_NOT_FOUND` | 404 | Session ID does not exist |
| `TASK_ALREADY_CLAIMED` | 409 | Task claimed by another session |
| `TASK_NOT_CLAIMED` | 404 | Task has no active claim |
| `TASK_NOT_CLAIMABLE` | 400 | Task blocked or completed |
| `NOT_CLAIM_OWNER` | 403 | Session doesn't own the claim |
| `CLAIM_EXPIRED` | 410 | Claim TTL expired |

---

## Concurrency Safety

### Atomic Claiming

Uses SQLite transactions to prevent race conditions:

```javascript
claimTask(taskId, sessionId, ttlMs = 600000) {
  const txn = this.db.transaction(() => {
    // Check existing claim
    const existing = this.db.prepare(`
      SELECT * FROM task_claims
      WHERE task_id = ? AND expires_at > ?
    `).get(taskId, Date.now());

    if (existing && existing.session_id !== sessionId) {
      return { claimed: false, holder: existing.session_id };
    }

    // Create/update claim
    this.db.prepare(`
      INSERT OR REPLACE INTO task_claims
      (task_id, session_id, claimed_at, expires_at, last_heartbeat)
      VALUES (?, ?, ?, ?, ?)
    `).run(taskId, sessionId, Date.now(), Date.now() + ttlMs, Date.now());

    return { claimed: true };
  });

  return txn.immediate();
}
```

### Orphan Detection

- **Heartbeat expiration**: Claims expire after 30 min without heartbeat
- **Session death**: Claims released when session deregisters
- **PID checking**: Detect crashed processes via `process.kill(pid, 0)`
- **Cleanup timer**: Runs every 5 min to find orphaned claims

---

## Dashboard UI Changes

### Session Card

Show claimed task per session:

```
+--------------------------------------------------+
| [CLI] multi-agent-template               [  92 ] |
|       (*) implement-dashboard-api  [IMPL]        |
|       #abc123 | 67% ctx | 5/12 tasks | 1m ago    |
+--------------------------------------------------+

| [AUTO] multi-agent-template              [  78 ] |
|       (*) add-validation-tests  [TEST]           |
|       #def456 | 34% ctx | 3/12 tasks | 30s ago   |
+--------------------------------------------------+
```

### Task Queue Panel

Show claim status per task:

```
+---------------------------------------------------------------+
| #  | Task                        | Priority   | Claimed By     |
+---------------------------------------------------------------+
| 1  | implement-dashboard-api     | HIGH       | [*] Session #3 |
|    |                             |            |     CLI 2m ago |
+---------------------------------------------------------------+
| 2  | add-validation-tests        | MEDIUM     | [*] Session #7 |
|    |                             |            |     AUTO 45s   |
+---------------------------------------------------------------+
| 3  | update-docs                 | LOW        | --             |
+---------------------------------------------------------------+

Legend:
[*] = In-flight (claimed)
[!] = Stale claim (>5 min no heartbeat)
--  = Available
```

---

## Implementation Phases

### Phase 1: Core Infrastructure (3h)
- Add `task_claims` table to CoordinationDB
- Implement `claimTask()`, `releaseClaim()`, `refreshClaim()`
- Add claim cleanup timer
- Unit tests for claim operations

### Phase 2: TaskManager Integration (2h)
- Add `claim` field to task schema
- Implement `claimNextTask()` atomic operation
- Add heartbeat refresh during operations
- Handle orphaned claims on session cleanup

### Phase 3: Dashboard API (2h)
- Add 7 claim API endpoints
- Add SSE events for claim changes
- Update `/api/sessions/summary` to include current tasks

### Phase 4: Dashboard UI (2h)
- Update session cards to show per-session tasks
- Add claim badges to task queue
- Add stale claim indicators
- Handle SSE events for real-time updates

---

## Configuration

```javascript
const claimConfig = {
  defaultTTL: 1800000,        // 30 minutes
  maxTTL: 7200000,            // 2 hours max
  minTTL: 60000,              // 1 minute min
  heartbeatInterval: 60000,   // Heartbeat every 1 min
  cleanupInterval: 300000,    // Cleanup every 5 min
  orphanThreshold: 600000,    // 10 min = orphan
  warningThreshold: 300000,   // 5 min remaining = warning
  expiringThreshold: 60000    // 1 min remaining = expiring
};
```

---

## Testing Strategy

1. **Unit Tests**: Atomic claim/release, expiration, heartbeat
2. **Concurrency Tests**: Multiple sessions claiming same task
3. **Integration Tests**: TaskManager + CoordinationDB + Dashboard
4. **Stress Tests**: 10+ concurrent claim attempts
5. **Recovery Tests**: Session crash with active claim

---

## References

- CoordinationDB: `.claude/core/coordination-db.js`
- TaskManager: `.claude/core/task-manager.js`
- SessionRegistry: `.claude/core/session-registry.js`
- Dashboard Server: `.claude/core/enhanced-dashboard-server.js`
- Dashboard UI: `public/global-dashboard.html`
