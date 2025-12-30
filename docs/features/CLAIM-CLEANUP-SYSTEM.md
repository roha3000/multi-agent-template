# Task Claim Cleanup System - Implementation Documentation

## Overview

The Task Claim Cleanup System provides automatic cleanup of expired and orphaned task claims in the CoordinationDB. This ensures that tasks don't remain locked by dead sessions or expired claims, allowing other sessions to claim them.

## Architecture

### Components

1. **cleanupExpiredClaims()** - Removes claims past their expiration time
2. **cleanupOrphanedClaims()** - Removes claims from dead/stale sessions
3. **releaseSessionClaims()** - Releases all claims for a specific session
4. **Automatic Timer Integration** - Runs cleanup every 5 minutes by default

### Database Schema

The cleanup system operates on the `task_claims` table:

```sql
CREATE TABLE task_claims (
  task_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_heartbeat INTEGER NOT NULL,
  task_status TEXT NOT NULL DEFAULT 'in-progress'
);

CREATE INDEX idx_task_claims_session ON task_claims(session_id);
CREATE INDEX idx_task_claims_expires ON task_claims(expires_at);
```

## Configuration

Configure claim cleanup behavior via `claimConfig` in CoordinationDB options:

```javascript
const db = new CoordinationDB(dbPath, {
  claimConfig: {
    defaultTTL: 30 * 60 * 1000,        // 30 minutes - default claim lifetime
    cleanupInterval: 5 * 60 * 1000,    // 5 minutes - how often cleanup runs
    orphanThreshold: 10 * 60 * 1000,   // 10 minutes - when session is orphaned
    warningThreshold: 5 * 60 * 1000    // 5 minutes - when to warn about expiring claims
  }
});
```

### Configuration Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `defaultTTL` | 30 minutes | Default claim expiration time |
| `cleanupInterval` | 5 minutes | Frequency of automatic cleanup |
| `orphanThreshold` | 10 minutes | Session heartbeat age before orphan detection |
| `warningThreshold` | 5 minutes | Remaining time to trigger expiration warning |

## API Methods

### cleanupExpiredClaims()

Removes claims where `expires_at < now()`.

**Returns:**
```javascript
{
  count: 2,                    // Number of claims cleaned
  claims: [
    {
      taskId: 'task-1',
      sessionId: 'session-abc',
      claimedAt: 1640000000000,
      expiresAt: 1640001800000
    },
    // ...
  ]
}
```

**Events Emitted:**
- `claim:expired` - For each expired claim
- `claims:cleanup` - Summary event with type='expired'

**Example:**
```javascript
const result = db.cleanupExpiredClaims();
console.log(`Cleaned ${result.count} expired claims`);
```

---

### cleanupOrphanedClaims(options)

Removes claims from sessions that are missing or stale.

**Parameters:**
- `options.checkPid` (boolean) - Verify process is dead via PID checking (default: false)

**Returns:**
```javascript
{
  count: 1,
  claims: [
    {
      taskId: 'task-2',
      sessionId: 'dead-session',
      claimedAt: 1640000000000,
      reason: 'session_missing',  // or 'session_stale'
      staleForMs: 600000          // How long session has been stale
    }
  ]
}
```

**Orphan Detection Logic:**
1. LEFT JOIN claims with sessions table
2. Identify claims where:
   - Session doesn't exist (`session_id IS NULL`)
   - Session heartbeat > `orphanThreshold` (session is stale)
3. Optionally verify process is dead via PID

**Events Emitted:**
- `claim:orphaned` - For each orphaned claim
- `claims:cleanup` - Summary event with type='orphaned'

**Example:**
```javascript
// Basic orphan cleanup
const result = db.cleanupOrphanedClaims();

// With PID checking for extra safety
const result = db.cleanupOrphanedClaims({ checkPid: true });
console.log(`Cleaned ${result.count} orphaned claims`);
```

---

### releaseSessionClaims(sessionId, reason)

Releases all claims for a specific session. Called automatically when session deregisters.

**Parameters:**
- `sessionId` (string) - Session ID to release claims for
- `reason` (string) - Reason for release (default: 'session_ended')

**Returns:**
```javascript
{
  count: 3,
  sessionId: 'session-abc',
  reason: 'session_ended',
  claims: [
    {
      taskId: 'task-1',
      claimedAt: 1640000000000,
      expiresAt: 1640001800000,
      heldForMs: 300000  // How long claim was held
    },
    // ...
  ]
}
```

**Events Emitted:**
- `claim:released` - For each released claim
- `claims:session_cleanup` - Summary event with session details

**Example:**
```javascript
// Manual release
const result = db.releaseSessionClaims('session-123', 'manual');

// Automatic during deregistration
db.deregisterSession('session-123');  // Calls releaseSessionClaims internally
```

---

## Event System

The cleanup system emits detailed events for monitoring and debugging.

### Individual Claim Events

#### claim:expired
```javascript
db.on('claim:expired', (event) => {
  console.log(`Task ${event.taskId} claim expired`);
  console.log(`- Session: ${event.sessionId}`);
  console.log(`- Age: ${event.ageMs}ms`);
  console.log(`- Expired at: ${new Date(event.expiredAt)}`);
});
```

#### claim:orphaned
```javascript
db.on('claim:orphaned', (event) => {
  console.log(`Task ${event.taskId} claim orphaned`);
  console.log(`- Session: ${event.sessionId}`);
  console.log(`- Reason: ${event.reason}`);  // 'session_missing' or 'session_stale'
  console.log(`- Stale for: ${event.staleForMs}ms`);
});
```

#### claim:released
```javascript
db.on('claim:released', (event) => {
  console.log(`Task ${event.taskId} claim released`);
  console.log(`- Session: ${event.sessionId}`);
  console.log(`- Reason: ${event.reason}`);
  console.log(`- Held for: ${event.heldForMs}ms`);
});
```

### Summary Events

#### claims:cleanup
```javascript
db.on('claims:cleanup', (event) => {
  console.log(`Cleanup: ${event.type} - ${event.count} claims cleaned`);
  // event.type is either 'expired' or 'orphaned'
});
```

#### claims:session_cleanup
```javascript
db.on('claims:session_cleanup', (event) => {
  console.log(`Session ${event.sessionId} cleanup: ${event.count} claims released`);
  console.log(`- Reason: ${event.reason}`);
});
```

---

## Integration Points

### Automatic Cleanup Timer

The cleanup timer is integrated into `_startCleanupTimer()` and runs automatically:

```javascript
_startCleanupTimer() {
  this._cleanupTimer = setInterval(() => {
    this.cleanupExpiredLocks();       // Existing
    this.cleanupStaleSessions();      // Existing
    this.pruneOldChanges();           // Existing
    this.cleanupExpiredClaims();      // NEW - Claim cleanup
    this.cleanupOrphanedClaims();     // NEW - Orphan cleanup
  }, this.options.cleanupInterval);
}
```

### Session Deregistration

Claims are automatically released when sessions deregister:

```javascript
deregisterSession(sessionId) {
  // Release all locks
  const locks = this._stmts.getLocksBySession.all(sessionId);
  this._stmts.deleteAllSessionLocks.run(sessionId);

  // Release all task claims (NEW)
  const claimResult = this.releaseSessionClaims(sessionId, 'session_deregistered');

  // Remove session
  const result = this._stmts.deleteSession.run(sessionId);

  this.emit('session:deregistered', {
    sessionId: sid,
    locksReleased: locks.length,
    claimsReleased: claimResult.count  // NEW
  });

  return {
    sessionId: sid,
    deregistered: result.changes > 0,
    locksReleased: locks.length,
    claimsReleased: claimResult.count  // NEW
  };
}
```

### Statistics

Claim statistics are included in `getStats()`:

```javascript
const stats = db.getStats();
console.log(stats.claims);
// {
//   total: 5,      // Total claims in database
//   active: 4,     // Claims not yet expired
//   expiring: 1    // Claims expiring within warningThreshold
// }
```

---

## Implementation Patterns

### Orphan Detection Pattern

The orphan detection uses a LEFT JOIN to identify claims with missing or stale sessions:

```sql
SELECT
  tc.task_id,
  tc.session_id,
  tc.claimed_at,
  tc.expires_at,
  tc.last_heartbeat,
  s.last_heartbeat as session_heartbeat,
  s.pid
FROM task_claims tc
LEFT JOIN sessions s ON tc.session_id = s.id
WHERE
  s.id IS NULL                              -- Session doesn't exist
  OR s.last_heartbeat < ?                   -- Session is stale
```

### PID Checking (Optional)

For additional safety, the system can verify processes are actually dead:

```javascript
_isProcessAlive(pid) {
  if (!pid) return false;

  try {
    // Signal 0 doesn't kill, just checks if process exists
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH means no such process
    // EPERM means process exists but we don't have permission (still alive)
    return err.code === 'EPERM';
  }
}
```

### Database Closure Safety

All cleanup methods check if the database is closed before executing:

```javascript
cleanupExpiredClaims() {
  // Skip if database is closed
  if (!this.db) return { count: 0, claims: [] };

  // ... rest of implementation
}
```

This prevents errors when the cleanup timer fires after database closure.

---

## Testing

The implementation includes 25 comprehensive unit tests covering:

- **Expired Claim Cleanup (7 tests)**
  - Empty database
  - Active vs expired claim distinction
  - Single and multiple claim cleanup
  - Event emission

- **Orphaned Claim Cleanup (7 tests)**
  - Missing session detection
  - Stale session detection
  - Active session preservation
  - Multiple orphan cleanup
  - Event emission

- **Session Claim Release (7 tests)**
  - Empty session handling
  - Single and multiple claim release
  - Session isolation
  - Event emission
  - Default reason handling

- **Integration Tests (2 tests)**
  - Session deregistration integration
  - Cleanup timer integration

- **Statistics Tests (2 tests)**
  - Claim statistics in getStats()
  - Graceful handling of missing table

**Run tests:**
```bash
npm test -- __tests__/core/claim-cleanup.test.js
```

---

## Performance Considerations

### Index Usage

The cleanup queries leverage indexes for performance:
- `idx_task_claims_expires` - Used by cleanupExpiredClaims()
- `idx_task_claims_session` - Used by releaseSessionClaims()

### Query Efficiency

- **Expired Claims**: Single query with index scan on `expires_at`
- **Orphaned Claims**: LEFT JOIN with index scan on `session_id`
- **Session Release**: Single query with index lookup on `session_id`

### Event Overhead

Events are emitted for each claim to enable detailed monitoring. For high-volume cleanup:
- Consider batching individual events
- Use summary events only for dashboards
- Disable detailed events in production if not needed

---

## Best Practices

### 1. Configure TTL Based on Task Duration

Match `defaultTTL` to your typical task duration:
```javascript
claimConfig: {
  defaultTTL: 3600000  // 1 hour for long-running tasks
}
```

### 2. Adjust Orphan Threshold for Network Latency

In high-latency environments, increase `orphanThreshold`:
```javascript
claimConfig: {
  orphanThreshold: 20 * 60 * 1000  // 20 minutes
}
```

### 3. Monitor Cleanup Events

Track cleanup frequency to identify issues:
```javascript
let cleanupCount = 0;
db.on('claims:cleanup', (event) => {
  cleanupCount += event.count;
  if (cleanupCount > 100) {
    console.warn('High claim cleanup rate - investigate session stability');
  }
});
```

### 4. Use PID Checking Sparingly

Enable PID checking only when needed:
```javascript
// Only in critical cleanup scenarios
db.cleanupOrphanedClaims({ checkPid: true });
```

### 5. Handle Cleanup Results

Always check cleanup results for monitoring:
```javascript
const result = db.cleanupExpiredClaims();
if (result.count > 0) {
  logger.info(`Cleaned ${result.count} expired claims`, {
    taskIds: result.claims.map(c => c.taskId)
  });
}
```

---

## Troubleshooting

### High Expired Claim Rate

**Symptom:** Many claims expiring before completion

**Causes:**
- TTL too short for task duration
- Tasks taking longer than expected
- Sessions not refreshing claims

**Solutions:**
1. Increase `defaultTTL`
2. Implement claim heartbeat refresh
3. Monitor task execution time

### Orphaned Claims

**Symptom:** Regular orphaned claim cleanup

**Causes:**
- Sessions crashing without deregistration
- Network issues preventing heartbeats
- Process kills without cleanup

**Solutions:**
1. Improve session stability
2. Increase heartbeat frequency
3. Add session crash recovery
4. Implement graceful shutdown handlers

### Claim Leaks

**Symptom:** Claims not being cleaned up

**Causes:**
- Cleanup timer disabled
- Database queries failing
- Table schema issues

**Solutions:**
1. Verify `autoCleanup: true`
2. Check database logs for errors
3. Verify `task_claims` table exists
4. Run manual cleanup to test

---

## Future Enhancements

### Potential Improvements

1. **Claim Heartbeat Refresh**
   - Allow sessions to extend claim TTL
   - Prevent premature expiration of long tasks

2. **Claim Priority Queue**
   - Prioritize cleanup of high-priority task claims
   - Optimize cleanup order

3. **Metrics Dashboard**
   - Real-time claim cleanup statistics
   - Visualize orphan detection patterns

4. **Configurable Event Batching**
   - Batch individual claim events
   - Reduce event overhead

5. **Claim Resurrection**
   - Optionally restore claims for interrupted tasks
   - Support task resume after crash

---

## Summary

The Task Claim Cleanup System provides robust, automatic cleanup of expired and orphaned claims with:

- **Expired Claim Cleanup** - Time-based expiration with configurable TTL
- **Orphaned Claim Detection** - Session-based orphan detection with optional PID verification
- **Session Integration** - Automatic cleanup on session deregistration
- **Event System** - Detailed events for monitoring and debugging
- **Statistics** - Real-time claim metrics via getStats()
- **25 Unit Tests** - Comprehensive test coverage

The system ensures tasks are never permanently locked by dead sessions or expired claims, maintaining system availability and task throughput.
