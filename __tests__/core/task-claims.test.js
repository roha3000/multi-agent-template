/**
 * Task Claims Unit Tests
 * Comprehensive tests for Session-Task Claiming System (Phase 1)
 *
 * Test Coverage:
 * - Claim Operations (12 tests)
 * - Query Methods (8 tests)
 * - Cleanup & Lifecycle (8 tests)
 * - Concurrency (6 tests)
 * - Edge Cases (6 tests)
 *
 * Total: 40 tests
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const CoordinationDB = require('../../.claude/core/coordination-db');

describe('Task Claims', () => {
  let db;
  let testDir;
  let dbPath;
  let sessionId1;
  let sessionId2;
  let taskId1;
  let taskId2;
  let taskId3;

  beforeEach(() => {
    // Create unique temp directory for each test
    testDir = path.join(os.tmpdir(), `task-claims-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(testDir, { recursive: true });
    dbPath = path.join(testDir, 'coordination.db');
    db = new CoordinationDB(dbPath, { autoCleanup: false });

    // Register test sessions
    sessionId1 = 'session-test-001';
    sessionId2 = 'session-test-002';
    taskId1 = 'task-alpha';
    taskId2 = 'task-beta';
    taskId3 = 'task-gamma';

    db.registerSession(sessionId1, '/project/path', 'orchestrator');
    db.registerSession(sessionId2, '/project/path', 'developer');
  });

  afterEach(() => {
    if (db) {
      try {
        db.close();
      } catch (e) {
        // Ignore close errors
      }
      db = null;
    }
    // Clean up test directory
    if (testDir && fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors on Windows
      }
    }
  });

  // ============================================================================
  // CLAIM OPERATIONS (12 tests)
  // ============================================================================

  describe('Claim Operations', () => {

    describe('claimTask()', () => {

      test('should successfully claim an unclaimed task', () => {
        const result = db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });

        expect(result.claimed).toBe(true);
        expect(result.claim.taskId).toBe(taskId1);
        expect(result.claim.sessionId).toBe(sessionId1);
        expect(result.claim.claimedAt).toBeDefined();
        expect(result.claim.expiresAt).toBeDefined();
        expect(result.claim.expiresAt - result.claim.claimedAt).toBe(600000);
      });

      test('should successfully re-claim own expired task', async () => {
        // Claim with 50ms TTL
        db.claimTask(taskId1, sessionId1, { ttlMs: 50 });

        // Wait for expiration
        await new Promise(resolve => setTimeout(resolve, 100));

        // Re-claim should succeed
        const result = db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });

        expect(result.claimed).toBe(true);
        expect(result.claim.sessionId).toBe(sessionId1);
      });

      test('should fail to claim task already claimed by another session', () => {
        // Session 1 claims task
        db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });

        // Session 2 tries to claim same task
        const result = db.claimTask(taskId1, sessionId2, { ttlMs: 600000 });

        expect(result.claimed).toBe(false);
        expect(result.error).toBe('TASK_ALREADY_CLAIMED');
        expect(result.existingClaim.sessionId).toBe(sessionId1);
        expect(result.existingClaim.remainingMs).toBeGreaterThan(0);
      });

      test('should extend TTL when same session re-claims', async () => {
        // Session 1 claims task
        const first = db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });
        const originalExpiry = first.claim.expiresAt;

        // Wait a bit before re-claiming
        await new Promise(resolve => setTimeout(resolve, 10));

        // Same session re-claims
        const result = db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });

        expect(result.claimed).toBe(true);
        expect(result.extended).toBe(true);
        expect(result.claim.expiresAt).toBeGreaterThan(originalExpiry);
        expect(result.claim.heartbeatCount).toBe(1);
      });

      test('should track claim metadata', () => {
        const metadata = { priority: 'high', agentType: 'autonomous' };
        const result = db.claimTask(taskId1, sessionId1, { ttlMs: 600000, metadata });

        expect(result.claimed).toBe(true);

        const claim = db.getClaim(taskId1);
        expect(claim.metadata).toEqual(metadata);
      });

      test('should emit claim:acquired event', () => {
        const events = [];
        db.on('claim:acquired', (data) => events.push(data));

        db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });

        expect(events.length).toBe(1);
        expect(events[0].taskId).toBe(taskId1);
        expect(events[0].sessionId).toBe(sessionId1);
      });

    });

    describe('releaseClaim()', () => {

      test('should successfully release claim by owner', () => {
        db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });

        const result = db.releaseClaim(taskId1, sessionId1, 'completed');

        expect(result.released).toBe(true);
        expect(result.claim.taskId).toBe(taskId1);
        expect(result.claim.reason).toBe('completed');
        expect(result.claim.claimDuration).toBeGreaterThanOrEqual(0);

        // Verify claim is gone
        const claim = db.getClaim(taskId1);
        expect(claim).toBeNull();
      });

      test('should fail to release claim if not owner', () => {
        db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });

        const result = db.releaseClaim(taskId1, sessionId2, 'completed');

        expect(result.released).toBe(false);
        expect(result.error).toBe('NOT_CLAIM_OWNER');
        expect(result.actualOwner).toBe(sessionId1);
      });

      test('should return error for non-existent claim', () => {
        const result = db.releaseClaim('nonexistent-task', sessionId1, 'completed');

        expect(result.released).toBe(false);
        expect(result.error).toBe('CLAIM_NOT_FOUND');
      });

      test('should handle release of already expired claim', async () => {
        db.claimTask(taskId1, sessionId1, { ttlMs: 50 });

        // Wait for expiration
        await new Promise(resolve => setTimeout(resolve, 100));

        const result = db.releaseClaim(taskId1, sessionId1, 'completed');

        expect(result.released).toBe(true);
        expect(result.wasExpired).toBe(true);
      });

      test('should emit claim:released event', () => {
        const events = [];
        db.on('claim:released', (data) => events.push(data));

        db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });
        db.releaseClaim(taskId1, sessionId1, 'completed');

        expect(events.length).toBe(1);
        expect(events[0].taskId).toBe(taskId1);
        expect(events[0].reason).toBe('completed');
      });

    });

    describe('refreshClaim()', () => {

      test('should successfully extend claim TTL', async () => {
        db.claimTask(taskId1, sessionId1, { ttlMs: 1000 });
        const original = db.getClaim(taskId1);

        await new Promise(resolve => setTimeout(resolve, 100));

        const result = db.refreshClaim(taskId1, sessionId1, 600000);

        expect(result.success).toBe(true);
        expect(result.expiresAt).toBeGreaterThan(original.expiresAt);
        expect(result.heartbeatCount).toBe(1);

        const updated = db.getClaim(taskId1);
        expect(updated.lastHeartbeat).toBeGreaterThan(original.lastHeartbeat);
      });

      test('should fail to refresh claim if not owner', () => {
        db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });

        const result = db.refreshClaim(taskId1, sessionId2, 600000);

        expect(result.success).toBe(false);
        expect(result.error).toBe('NOT_CLAIM_OWNER');
      });

      test('should fail to refresh already expired claim', async () => {
        db.claimTask(taskId1, sessionId1, { ttlMs: 50 });

        // Wait for expiration
        await new Promise(resolve => setTimeout(resolve, 100));

        const result = db.refreshClaim(taskId1, sessionId1, 600000);

        expect(result.success).toBe(false);
        expect(result.error).toBe('CLAIM_EXPIRED');
      });

      test('should emit claim:refreshed event', () => {
        const events = [];
        db.on('claim:refreshed', (data) => events.push(data));

        db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });
        db.refreshClaim(taskId1, sessionId1, 600000);

        expect(events.length).toBe(1);
        expect(events[0].taskId).toBe(taskId1);
        expect(events[0].heartbeatCount).toBe(1);
      });

    });

  });

  // ============================================================================
  // QUERY METHODS (8 tests)
  // ============================================================================

  describe('Query Methods', () => {

    describe('getActiveClaims()', () => {

      test('should return only non-expired claims', async () => {
        db.claimTask(taskId1, sessionId1, { ttlMs: 600000 }); // Long TTL
        db.claimTask(taskId2, sessionId1, { ttlMs: 50 });     // Short TTL
        db.claimTask(taskId3, sessionId2, { ttlMs: 600000 }); // Long TTL

        // Wait for task2 to expire
        await new Promise(resolve => setTimeout(resolve, 100));

        const activeClaims = db.getActiveClaims();

        expect(activeClaims).toHaveLength(2);
        expect(activeClaims.map(c => c.taskId)).toContain(taskId1);
        expect(activeClaims.map(c => c.taskId)).toContain(taskId3);
        expect(activeClaims.map(c => c.taskId)).not.toContain(taskId2);
      });

      test('should filter claims by sessionId', () => {
        db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });
        db.claimTask(taskId2, sessionId1, { ttlMs: 600000 });
        db.claimTask(taskId3, sessionId2, { ttlMs: 600000 });

        const session1Claims = db.getActiveClaims({ sessionId: sessionId1 });

        expect(session1Claims).toHaveLength(2);
        expect(session1Claims.every(c => c.sessionId === sessionId1)).toBe(true);
      });

      test('should include expired claims when requested', async () => {
        db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });
        db.claimTask(taskId2, sessionId1, { ttlMs: 50 });

        await new Promise(resolve => setTimeout(resolve, 100));

        const allClaims = db.getActiveClaims({ includeExpired: true });

        expect(allClaims).toHaveLength(2);
        expect(allClaims.find(c => c.taskId === taskId2).isExpired).toBe(true);
      });

    });

    describe('getClaim()', () => {

      test('should return claim with computed fields', () => {
        db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });

        const claim = db.getClaim(taskId1);

        expect(claim).toBeDefined();
        expect(claim.taskId).toBe(taskId1);
        expect(claim.sessionId).toBe(sessionId1);
        expect(claim.remainingMs).toBeGreaterThan(0);
        expect(claim.remainingMs).toBeLessThanOrEqual(600000);
        expect(claim.healthStatus).toBe('healthy');
      });

      test('should return null for expired claim', async () => {
        db.claimTask(taskId1, sessionId1, { ttlMs: 50 });

        await new Promise(resolve => setTimeout(resolve, 100));

        const claim = db.getClaim(taskId1);

        expect(claim).toBeNull();
      });

      test('should calculate health status correctly', () => {
        // Warning: < warningThreshold (5 min) remaining
        db.claimTask(taskId1, sessionId1, { ttlMs: 3 * 60 * 1000 });
        expect(db.getClaim(taskId1).healthStatus).toBe('warning');

        // Critical: < 1 min remaining
        db.claimTask(taskId2, sessionId1, { ttlMs: 30 * 1000 });
        expect(db.getClaim(taskId2).healthStatus).toBe('critical');

        // Healthy: > warningThreshold
        db.claimTask(taskId3, sessionId1, { ttlMs: 10 * 60 * 1000 });
        expect(db.getClaim(taskId3).healthStatus).toBe('healthy');
      });

    });

    describe('getClaimsBySession()', () => {

      test('should return all claims for a session', () => {
        db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });
        db.claimTask(taskId2, sessionId1, { ttlMs: 600000 });
        db.claimTask(taskId3, sessionId2, { ttlMs: 600000 });

        const claims = db.getClaimsBySession(sessionId1);

        expect(claims).toHaveLength(2);
        expect(claims.every(c => c.sessionId === sessionId1)).toBe(true);
      });

    });

    describe('getClaimStats()', () => {

      test('should return accurate claim statistics', () => {
        db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });
        db.claimTask(taskId2, sessionId1, { ttlMs: 600000 });
        db.claimTask(taskId3, sessionId2, { ttlMs: 600000 });

        const stats = db.getClaimStats();

        expect(stats.totalActive).toBe(3);
        expect(stats.bySession[sessionId1]).toBe(2);
        expect(stats.bySession[sessionId2]).toBe(1);
      });

    });

    describe('isTaskClaimed()', () => {

      test('should return correct claim status for claimed task', () => {
        db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });

        const status = db.isTaskClaimed(taskId1);

        expect(status.claimed).toBe(true);
        expect(status.holder).toBe(sessionId1);
        expect(status.remainingMs).toBeGreaterThan(0);
      });

      test('should return claimed=false for unclaimed task', () => {
        const status = db.isTaskClaimed(taskId1);

        expect(status.claimed).toBe(false);
        expect(status.holder).toBeNull();
      });

      test('should return claimed=false for expired claim', async () => {
        db.claimTask(taskId1, sessionId1, { ttlMs: 50 });

        await new Promise(resolve => setTimeout(resolve, 100));

        const status = db.isTaskClaimed(taskId1);
        expect(status.claimed).toBe(false);
      });

    });

  });

  // ============================================================================
  // CLEANUP & LIFECYCLE (8 tests)
  // ============================================================================

  describe('Cleanup & Lifecycle', () => {

    describe('cleanupExpiredClaims()', () => {

      test('should remove only expired claims', async () => {
        db.claimTask(taskId1, sessionId1, { ttlMs: 600000 }); // Long TTL
        db.claimTask(taskId2, sessionId1, { ttlMs: 50 });     // Short TTL
        db.claimTask(taskId3, sessionId2, { ttlMs: 50 });     // Short TTL

        await new Promise(resolve => setTimeout(resolve, 100));

        const result = db.cleanupExpiredClaims();

        expect(result.count).toBe(2);
        expect(result.claims.map(c => c.taskId)).toContain(taskId2);
        expect(result.claims.map(c => c.taskId)).toContain(taskId3);

        const activeClaims = db.getActiveClaims();
        expect(activeClaims).toHaveLength(1);
        expect(activeClaims[0].taskId).toBe(taskId1);
      });

      test('should emit claim:expired events', async () => {
        db.claimTask(taskId1, sessionId1, { ttlMs: 50 });

        await new Promise(resolve => setTimeout(resolve, 100));

        const emittedEvents = [];
        db.on('claim:expired', (data) => emittedEvents.push(data));

        db.cleanupExpiredClaims();

        expect(emittedEvents).toHaveLength(1);
        expect(emittedEvents[0].taskId).toBe(taskId1);
      });

    });

    describe('cleanupOrphanedClaims()', () => {

      test('should remove claims from stale sessions', async () => {
        db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });

        // Make session stale by not updating heartbeat
        const staleTime = Date.now() - 15 * 60 * 1000; // 15 minutes ago
        db._setHeartbeatForTesting(sessionId1, staleTime);

        const result = db.cleanupOrphanedClaims();

        expect(result.count).toBe(1);
        expect(result.claims[0].taskId).toBe(taskId1);
        expect(result.claims[0].reason).toBe('session_stale');
      });

    });

    describe('releaseSessionClaims()', () => {

      test('should release all claims when session deregisters', () => {
        db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });
        db.claimTask(taskId2, sessionId1, { ttlMs: 600000 });
        db.claimTask(taskId3, sessionId2, { ttlMs: 600000 });

        const result = db.releaseSessionClaims(sessionId1, 'session_ended');

        expect(result.count).toBe(2);
        expect(result.claims.map(c => c.taskId)).toContain(taskId1);
        expect(result.claims.map(c => c.taskId)).toContain(taskId2);

        const activeClaims = db.getActiveClaims();
        expect(activeClaims).toHaveLength(1);
        expect(activeClaims[0].sessionId).toBe(sessionId2);
      });

      test('should return empty result for session with no claims', () => {
        const result = db.releaseSessionClaims('no-claims-session', 'cleanup');

        expect(result.count).toBe(0);
        expect(result.claims).toEqual([]);
      });

    });

    describe('Cascade Delete', () => {

      test('should cascade delete claims when session deleted', () => {
        db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });
        db.claimTask(taskId2, sessionId2, { ttlMs: 600000 });

        // Delete session from database
        db.deregisterSession(sessionId1);

        const activeClaims = db.getActiveClaims();
        expect(activeClaims.every(c => c.sessionId !== sessionId1)).toBe(true);
      });

    });

  });

  // ============================================================================
  // CONCURRENCY (6 tests)
  // ============================================================================

  describe('Concurrency', () => {

    describe('Atomic Claiming', () => {

      test('should handle concurrent claims - only one wins', () => {
        const results = [];

        // Simulate concurrent claims
        for (let i = 0; i < 10; i++) {
          const sessionId = `session-concurrent-${i}`;
          db.registerSession(sessionId, '/project', 'test');
          const result = db.claimTask(taskId1, sessionId, { ttlMs: 600000 });
          results.push({ sessionId, result });
        }

        // Only one should succeed
        const successful = results.filter(r => r.result.claimed);
        expect(successful).toHaveLength(1);

        // All others should fail with TASK_ALREADY_CLAIMED
        const failed = results.filter(r => !r.result.claimed);
        expect(failed).toHaveLength(9);
        expect(failed.every(r => r.result.error === 'TASK_ALREADY_CLAIMED')).toBe(true);
        expect(failed.every(r => r.result.existingClaim.sessionId === successful[0].sessionId)).toBe(true);
      });

    });

    describe('Multiple Sessions', () => {

      test('should handle multiple sessions claiming different tasks', () => {
        const sessions = [];
        for (let i = 0; i < 5; i++) {
          const sessionId = `session-multi-${i}`;
          db.registerSession(sessionId, '/project', 'test');
          sessions.push(sessionId);
        }

        const tasks = ['task-a', 'task-b', 'task-c', 'task-d', 'task-e'];

        // Each session claims a different task
        sessions.forEach((sessionId, i) => {
          const result = db.claimTask(tasks[i], sessionId, { ttlMs: 600000 });
          expect(result.claimed).toBe(true);
        });

        const activeClaims = db.getActiveClaims();
        expect(activeClaims).toHaveLength(5);
        expect(new Set(activeClaims.map(c => c.sessionId)).size).toBe(5);
      });

      test('should handle session claiming multiple tasks', () => {
        const tasks = ['task-1', 'task-2', 'task-3', 'task-4', 'task-5'];

        tasks.forEach(taskId => {
          const result = db.claimTask(taskId, sessionId1, { ttlMs: 600000 });
          expect(result.claimed).toBe(true);
        });

        const claims = db.getClaimsBySession(sessionId1);
        expect(claims).toHaveLength(5);
      });

    });

  });

  // ============================================================================
  // EDGE CASES & ERROR HANDLING
  // ============================================================================

  describe('Edge Cases', () => {

    test('should handle claim with zero TTL', async () => {
      const result = db.claimTask(taskId1, sessionId1, { ttlMs: 0 });

      expect(result.claimed).toBe(true);

      // Wait a tiny bit for expiration
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should now be expired and auto-cleaned
      const claim = db.getClaim(taskId1);
      expect(claim).toBeNull();
    });

    test('should handle claim with negative TTL', () => {
      const result = db.claimTask(taskId1, sessionId1, { ttlMs: -1000 });

      expect(result.claimed).toBe(true);

      // Should be immediately expired
      const claim = db.getClaim(taskId1);
      expect(claim).toBeNull();
    });

    test('should handle very long TTL', () => {
      const oneYear = 365 * 24 * 60 * 60 * 1000;
      const result = db.claimTask(taskId1, sessionId1, { ttlMs: oneYear });

      expect(result.claimed).toBe(true);

      const claim = db.getClaim(taskId1);
      expect(claim.remainingMs).toBeGreaterThan(oneYear - 1000);
    });

    test('should handle special characters in task and session IDs', () => {
      const specialTaskId = 'task-with-special-chars-!@#$%^&*()';
      const specialSessionId = 'session-special-test';

      db.registerSession(specialSessionId, '/project', 'test');
      const result = db.claimTask(specialTaskId, specialSessionId, { ttlMs: 600000 });

      expect(result.claimed).toBe(true);

      const claim = db.getClaim(specialTaskId);
      expect(claim.taskId).toBe(specialTaskId);
      expect(claim.sessionId).toBe(specialSessionId);
    });

    test('should handle large metadata objects', () => {
      const largeMetadata = {
        description: 'x'.repeat(10000),
        nested: {
          level1: {
            level2: {
              level3: Array(100).fill('data')
            }
          }
        }
      };

      const result = db.claimTask(taskId1, sessionId1, { ttlMs: 600000, metadata: largeMetadata });

      expect(result.claimed).toBe(true);

      const claim = db.getClaim(taskId1);
      expect(claim.metadata).toEqual(largeMetadata);
    });

    test('should handle rapid claim/release cycles', () => {
      for (let i = 0; i < 100; i++) {
        const claimResult = db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });
        expect(claimResult.claimed).toBe(true);

        const releaseResult = db.releaseClaim(taskId1, sessionId1, 'cycle');
        expect(releaseResult.released).toBe(true);
      }

      // Should end in unclaimed state
      const status = db.isTaskClaimed(taskId1);
      expect(status.claimed).toBe(false);
    });

  });

  // ============================================================================
  // HIERARCHICAL CLAIMING
  // ============================================================================

  describe('Hierarchical Claiming', () => {
    // Task hierarchy for tests:
    // parent-task
    //   ├── child-task-1
    //   │   └── grandchild-task
    //   └── child-task-2
    const parentTask = 'parent-task';
    const childTask1 = 'child-task-1';
    const childTask2 = 'child-task-2';
    const grandchildTask = 'grandchild-task';

    describe('claimTask() with ancestors', () => {

      test('should block claim when parent is claimed by another session', () => {
        // Session 1 claims parent
        const parentResult = db.claimTask(parentTask, sessionId1, { ttlMs: 600000 });
        expect(parentResult.claimed).toBe(true);

        // Session 2 tries to claim child - should be blocked
        const childResult = db.claimTask(childTask1, sessionId2, {
          ttlMs: 600000,
          ancestors: [parentTask]
        });

        expect(childResult.claimed).toBe(false);
        expect(childResult.error).toBe('ANCESTOR_CLAIMED');
        expect(childResult.blockedByAncestor.taskId).toBe(parentTask);
        expect(childResult.blockedByAncestor.sessionId).toBe(sessionId1);
      });

      test('should block claim when grandparent is claimed by another session', () => {
        // Session 1 claims parent
        db.claimTask(parentTask, sessionId1, { ttlMs: 600000 });

        // Session 2 tries to claim grandchild - should be blocked
        const grandchildResult = db.claimTask(grandchildTask, sessionId2, {
          ttlMs: 600000,
          ancestors: [childTask1, parentTask]  // child first, then parent
        });

        expect(grandchildResult.claimed).toBe(false);
        expect(grandchildResult.error).toBe('ANCESTOR_CLAIMED');
        expect(grandchildResult.blockedByAncestor.taskId).toBe(parentTask);
      });

      test('should allow claim when same session owns ancestor', () => {
        // Session 1 claims parent
        db.claimTask(parentTask, sessionId1, { ttlMs: 600000 });

        // Same session claims child - should succeed
        const childResult = db.claimTask(childTask1, sessionId1, {
          ttlMs: 600000,
          ancestors: [parentTask]
        });

        expect(childResult.claimed).toBe(true);
      });

      test('should allow claim when ancestor claim is expired', async () => {
        // Session 1 claims parent with very short TTL
        db.claimTask(parentTask, sessionId1, { ttlMs: 50 });

        // Wait for expiration
        await new Promise(resolve => setTimeout(resolve, 100));

        // Session 2 tries to claim child - should succeed (ancestor expired)
        const childResult = db.claimTask(childTask1, sessionId2, {
          ttlMs: 600000,
          ancestors: [parentTask]
        });

        expect(childResult.claimed).toBe(true);
      });

      test('should allow claim when no ancestors provided', () => {
        // Session 1 claims parent
        db.claimTask(parentTask, sessionId1, { ttlMs: 600000 });

        // Session 2 claims unrelated task (no ancestors)
        const result = db.claimTask(taskId1, sessionId2, { ttlMs: 600000 });

        expect(result.claimed).toBe(true);
      });

      test('should allow claim when ancestors list is empty', () => {
        // Session 1 claims parent
        db.claimTask(parentTask, sessionId1, { ttlMs: 600000 });

        // Session 2 claims task with empty ancestors
        const result = db.claimTask(taskId1, sessionId2, {
          ttlMs: 600000,
          ancestors: []
        });

        expect(result.claimed).toBe(true);
      });

    });

    describe('isTaskReserved()', () => {

      test('should return reserved=true when task itself is claimed', () => {
        db.claimTask(taskId1, sessionId1, { ttlMs: 600000 });

        const status = db.isTaskReserved(taskId1, []);

        expect(status.reserved).toBe(true);
        expect(status.directClaim).toBe(true);
        expect(status.holder).toBe(sessionId1);
      });

      test('should return reserved=true when ancestor is claimed', () => {
        db.claimTask(parentTask, sessionId1, { ttlMs: 600000 });

        const status = db.isTaskReserved(childTask1, [parentTask]);

        expect(status.reserved).toBe(true);
        expect(status.ancestorClaim).toBe(true);
        expect(status.ancestorTaskId).toBe(parentTask);
        expect(status.holder).toBe(sessionId1);
      });

      test('should return reserved=false when excludeSessionId matches holder', () => {
        db.claimTask(parentTask, sessionId1, { ttlMs: 600000 });

        const status = db.isTaskReserved(childTask1, [parentTask], sessionId1);

        expect(status.reserved).toBe(false);
        expect(status.ownedBySelf).toBe(true);
      });

      test('should return reserved=false when no claims exist', () => {
        const status = db.isTaskReserved(taskId1, [parentTask, childTask1]);

        expect(status.reserved).toBe(false);
        expect(status.holder).toBeNull();
      });

      test('should check direct claim before ancestor claims', () => {
        // Both task and ancestor are claimed by different sessions
        db.claimTask(parentTask, sessionId1, { ttlMs: 600000 });
        db.claimTask(childTask1, sessionId2, { ttlMs: 600000 });

        const status = db.isTaskReserved(childTask1, [parentTask]);

        // Should report direct claim, not ancestor
        expect(status.reserved).toBe(true);
        expect(status.directClaim).toBe(true);
        expect(status.holder).toBe(sessionId2);
      });

    });

    describe('Hierarchical Workflow', () => {

      test('session should be able to work on entire task tree after claiming parent', () => {
        // Session 1 claims parent task
        const parentResult = db.claimTask(parentTask, sessionId1, { ttlMs: 600000 });
        expect(parentResult.claimed).toBe(true);

        // Session 1 can claim children without issue
        const child1Result = db.claimTask(childTask1, sessionId1, {
          ttlMs: 600000,
          ancestors: [parentTask]
        });
        expect(child1Result.claimed).toBe(true);

        const child2Result = db.claimTask(childTask2, sessionId1, {
          ttlMs: 600000,
          ancestors: [parentTask]
        });
        expect(child2Result.claimed).toBe(true);

        // Session 1 can claim grandchild
        const grandchildResult = db.claimTask(grandchildTask, sessionId1, {
          ttlMs: 600000,
          ancestors: [childTask1, parentTask]
        });
        expect(grandchildResult.claimed).toBe(true);

        // Session 2 cannot claim any of them
        const blockedChild = db.claimTask(childTask1, sessionId2, {
          ttlMs: 600000,
          ancestors: [parentTask]
        });
        expect(blockedChild.claimed).toBe(false);
        expect(blockedChild.error).toBe('ANCESTOR_CLAIMED');

        const blockedGrandchild = db.claimTask(grandchildTask, sessionId2, {
          ttlMs: 600000,
          ancestors: [childTask1, parentTask]
        });
        expect(blockedGrandchild.claimed).toBe(false);
        expect(blockedGrandchild.error).toBe('ANCESTOR_CLAIMED');
      });

      test('releasing parent should allow other sessions to claim children', () => {
        // Session 1 claims parent
        db.claimTask(parentTask, sessionId1, { ttlMs: 600000 });

        // Session 2 blocked
        let childResult = db.claimTask(childTask1, sessionId2, {
          ttlMs: 600000,
          ancestors: [parentTask]
        });
        expect(childResult.claimed).toBe(false);

        // Session 1 releases parent
        db.releaseClaim(parentTask, sessionId1, 'completed');

        // Session 2 can now claim child
        childResult = db.claimTask(childTask1, sessionId2, {
          ttlMs: 600000,
          ancestors: [parentTask]
        });
        expect(childResult.claimed).toBe(true);
      });

    });

  });

});
