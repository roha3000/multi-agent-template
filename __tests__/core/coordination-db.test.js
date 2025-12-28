/**
 * CoordinationDB Unit Tests
 * Tests for SQLite-based cross-process coordination (Phase 2)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const CoordinationDB = require('../../.claude/core/coordination-db');

describe('CoordinationDB', () => {
  let db;
  let testDir;
  let dbPath;

  beforeEach(() => {
    // Create unique temp directory for each test
    testDir = path.join(os.tmpdir(), `coord-db-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(testDir, { recursive: true });
    dbPath = path.join(testDir, 'coordination.db');
    db = new CoordinationDB(dbPath, { autoCleanup: false });
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
  // SESSION MANAGEMENT TESTS
  // ============================================================================

  describe('Session Management', () => {

    describe('registerSession', () => {

      test('should register a new session', () => {
        const result = db.registerSession('session-001', '/project/path', 'orchestrator');

        expect(result.sessionId).toBe('session-001');
        expect(result.projectPath).toBe('/project/path');
        expect(result.agentType).toBe('orchestrator');
        expect(result.wasReregistration).toBe(false);
        expect(result.createdAt).toBeDefined();
        expect(result.lastHeartbeat).toBeDefined();
      });

      test('should update existing session on re-register', () => {
        db.registerSession('session-001', '/project/path', 'orchestrator');
        const result = db.registerSession('session-001', '/project/path', 'developer');

        expect(result.wasReregistration).toBe(true);
        expect(result.agentType).toBe('developer');
      });

      test('should track multiple sessions on same project', () => {
        db.registerSession('session-001', '/project', 'orchestrator');
        db.registerSession('session-002', '/project', 'developer');
        db.registerSession('session-003', '/project', 'tester');

        const sessions = db.getSessionsByProject('/project');
        expect(sessions).toHaveLength(3);
      });

      test('should track sessions on different projects', () => {
        db.registerSession('session-001', '/project-a', 'orchestrator');
        db.registerSession('session-002', '/project-b', 'orchestrator');

        const sessionsA = db.getSessionsByProject('/project-a');
        const sessionsB = db.getSessionsByProject('/project-b');

        expect(sessionsA).toHaveLength(1);
        expect(sessionsB).toHaveLength(1);
      });

    });

    describe('updateHeartbeat', () => {

      test('should update session heartbeat timestamp', async () => {
        db.registerSession('session-001', '/project', 'orchestrator');
        const original = db.getSession('session-001');

        await new Promise(resolve => setTimeout(resolve, 50));
        db.updateHeartbeat('session-001');

        const updated = db.getSession('session-001');
        expect(updated.lastHeartbeat).toBeGreaterThan(original.lastHeartbeat);
      });

      test('should return false for non-existent session', () => {
        const result = db.updateHeartbeat('nonexistent-session');
        expect(result).toBe(false);
      });

    });

    describe('deregisterSession', () => {

      test('should remove session and release its locks', () => {
        db.registerSession('session-001', '/project', 'orchestrator');
        db.acquireLock('resource-1', 'session-001');
        db.acquireLock('resource-2', 'session-001');

        const result = db.deregisterSession('session-001');

        expect(result.deregistered).toBe(true);
        expect(result.locksReleased).toBe(2);
        expect(db.getSession('session-001')).toBeNull();

        // Verify locks are released
        const lock1 = db.acquireLock('resource-1', 'other-session');
        expect(lock1.acquired).toBe(true);
      });

      test('should handle deregistering non-existent session', () => {
        const result = db.deregisterSession('nonexistent');
        expect(result.deregistered).toBe(false);
      });

    });

    describe('stale session detection', () => {

      test('should detect stale sessions', () => {
        db.registerSession('session-001', '/project', 'orchestrator');

        // Make session stale
        db._setHeartbeatForTesting('session-001', Date.now() - (6 * 60 * 1000));

        const staleSessions = db.getStaleSessions(5 * 60 * 1000);
        expect(staleSessions).toHaveLength(1);
        expect(staleSessions[0].sessionId).toBe('session-001');
      });

      test('should not flag active sessions as stale', () => {
        db.registerSession('session-001', '/project', 'orchestrator');
        db.updateHeartbeat('session-001');

        const staleSessions = db.getStaleSessions(5 * 60 * 1000);
        expect(staleSessions).toHaveLength(0);
      });

      test('should cleanup stale sessions and their locks', () => {
        db.registerSession('stale-session', '/project', 'orchestrator');
        db.registerSession('active-session', '/project', 'developer');

        db.acquireLock('stale-resource', 'stale-session');
        db.acquireLock('active-resource', 'active-session');

        // Make one session stale
        db._setHeartbeatForTesting('stale-session', Date.now() - (10 * 60 * 1000));

        const cleaned = db.cleanupStaleSessions(5 * 60 * 1000);

        expect(cleaned).toContain('stale-session');
        expect(cleaned).not.toContain('active-session');

        // Stale session's lock should be released
        const staleLock = db.acquireLock('stale-resource', 'new-session');
        expect(staleLock.acquired).toBe(true);

        // Active session's lock should still be held
        const activeLock = db.acquireLock('active-resource', 'new-session');
        expect(activeLock.acquired).toBe(false);
      });

    });

  });

  // ============================================================================
  // LOCK MANAGEMENT TESTS
  // ============================================================================

  describe('Lock Management', () => {

    describe('acquireLock', () => {

      test('should acquire lock on free resource', () => {
        const result = db.acquireLock('tasks.json', 'session-001');

        expect(result.acquired).toBe(true);
        expect(result.holder).toBe('session-001');
        expect(result.expiresAt).toBeGreaterThan(Date.now());
      });

      test('should extend lock when same session re-acquires', () => {
        db.acquireLock('tasks.json', 'session-001');
        const result = db.acquireLock('tasks.json', 'session-001', 60000);

        expect(result.acquired).toBe(true);
        expect(result.extended).toBe(true);
        expect(result.holder).toBe('session-001');
      });

      test('should fail when lock held by different session', () => {
        db.acquireLock('tasks.json', 'session-001');
        const result = db.acquireLock('tasks.json', 'session-002');

        expect(result.acquired).toBe(false);
        expect(result.holder).toBe('session-001');
        expect(result.remainingMs).toBeGreaterThan(0);
      });

      test('should acquire lock after TTL expires', async () => {
        db.acquireLock('tasks.json', 'session-001', 50); // 50ms TTL

        await new Promise(resolve => setTimeout(resolve, 100));

        const result = db.acquireLock('tasks.json', 'session-002');
        expect(result.acquired).toBe(true);
        expect(result.holder).toBe('session-002');
      });

      test('should handle concurrent lock acquisition (first wins)', () => {
        const results = [
          db.acquireLock('shared-resource', 'session-001'),
          db.acquireLock('shared-resource', 'session-002'),
          db.acquireLock('shared-resource', 'session-003')
        ];

        expect(results[0].acquired).toBe(true);
        expect(results[1].acquired).toBe(false);
        expect(results[2].acquired).toBe(false);
        expect(results[1].holder).toBe('session-001');
      });

      test('should use default TTL when not specified', () => {
        const result = db.acquireLock('tasks.json', 'session-001');
        const expectedMinExpiry = Date.now() + 55000; // Default is 60s, allow 5s buffer

        expect(result.expiresAt).toBeGreaterThan(expectedMinExpiry);
      });

    });

    describe('releaseLock', () => {

      test('should release lock by owner', () => {
        db.acquireLock('tasks.json', 'session-001');
        const released = db.releaseLock('tasks.json', 'session-001');

        expect(released).toBe(true);

        // Verify lock is released
        const newResult = db.acquireLock('tasks.json', 'session-002');
        expect(newResult.acquired).toBe(true);
      });

      test('should fail to release lock by non-owner', () => {
        db.acquireLock('tasks.json', 'session-001');
        const released = db.releaseLock('tasks.json', 'session-002');

        expect(released).toBe(false);

        // Verify lock is still held
        const result = db.acquireLock('tasks.json', 'session-002');
        expect(result.acquired).toBe(false);
      });

      test('should return true when releasing non-existent lock', () => {
        const released = db.releaseLock('nonexistent-resource', 'session-001');
        expect(released).toBe(true);
      });

    });

    describe('refreshLock', () => {

      test('should extend lock expiration', () => {
        db.acquireLock('tasks.json', 'session-001', 30000);
        const result = db.refreshLock('tasks.json', 'session-001', 60000);

        expect(result.success).toBe(true);
        expect(result.expiresAt).toBeGreaterThan(Date.now() + 55000);
      });

      test('should fail to refresh non-existent lock', () => {
        const result = db.refreshLock('tasks.json', 'session-001');
        expect(result.success).toBe(false);
      });

      test('should fail to refresh lock owned by different session', () => {
        db.acquireLock('tasks.json', 'session-001');
        const result = db.refreshLock('tasks.json', 'session-002');

        expect(result.success).toBe(false);
      });

    });

    describe('isLockHeld', () => {

      test('should return lock status for held lock', () => {
        db.acquireLock('tasks.json', 'session-001');
        const status = db.isLockHeld('tasks.json');

        expect(status.locked).toBe(true);
        expect(status.holder).toBe('session-001');
        expect(status.remainingMs).toBeGreaterThan(0);
      });

      test('should return unlocked status for free resource', () => {
        const status = db.isLockHeld('tasks.json');

        expect(status.locked).toBe(false);
        expect(status.holder).toBeNull();
      });

      test('should clean up expired lock on status check', async () => {
        db.acquireLock('tasks.json', 'session-001', 50);

        await new Promise(resolve => setTimeout(resolve, 100));

        const status = db.isLockHeld('tasks.json');
        expect(status.locked).toBe(false);
      });

    });

    describe('withLock helper', () => {

      test('should execute callback and release lock on success', async () => {
        let callbackExecuted = false;

        const result = await db.withLock('tasks.json', 'session-001', async () => {
          callbackExecuted = true;
          return 'success-result';
        });

        expect(callbackExecuted).toBe(true);
        expect(result).toBe('success-result');

        // Verify lock is released
        const lockResult = db.acquireLock('tasks.json', 'other-session');
        expect(lockResult.acquired).toBe(true);
      });

      test('should release lock even when callback throws', async () => {
        await expect(
          db.withLock('tasks.json', 'session-001', async () => {
            throw new Error('Callback failed');
          })
        ).rejects.toThrow('Callback failed');

        // Verify lock is released
        const lockResult = db.acquireLock('tasks.json', 'other-session');
        expect(lockResult.acquired).toBe(true);
      });

      test('should throw when lock cannot be acquired', async () => {
        db.acquireLock('tasks.json', 'holder-session');

        await expect(
          db.withLock('tasks.json', 'requester-session', async () => {
            return 'should not reach here';
          })
        ).rejects.toThrow(/Could not acquire lock/);
      });

    });

    describe('cleanupExpiredLocks', () => {

      test('should remove expired locks', async () => {
        db.acquireLock('resource-1', 'session-001', 50);
        db.acquireLock('resource-2', 'session-002', 50);

        await new Promise(resolve => setTimeout(resolve, 100));

        const cleaned = db.cleanupExpiredLocks();
        expect(cleaned).toBe(2);
      });

      test('should not remove active locks', () => {
        db.acquireLock('resource-1', 'session-001', 60000);
        const cleaned = db.cleanupExpiredLocks();
        expect(cleaned).toBe(0);
      });

    });

  });

  // ============================================================================
  // CHANGE JOURNAL TESTS
  // ============================================================================

  describe('Change Journal', () => {

    describe('recordChange', () => {

      test('should record a change entry', () => {
        const changeId = db.recordChange('session-001', 'tasks.json', 'UPDATE', { taskId: 'task-001' });

        expect(changeId).toBeDefined();
        expect(typeof changeId).toBe('number');
      });

      test('should record multiple changes with unique IDs', () => {
        const id1 = db.recordChange('session-001', 'tasks.json', 'CREATE', { taskId: 'task-001' });
        const id2 = db.recordChange('session-001', 'tasks.json', 'UPDATE', { taskId: 'task-001' });
        const id3 = db.recordChange('session-002', 'tasks.json', 'DELETE', { taskId: 'task-002' });

        expect(id1).not.toBe(id2);
        expect(id2).not.toBe(id3);
      });

    });

    describe('query methods', () => {

      test('should query recent changes', () => {
        db.recordChange('session-001', 'tasks.json', 'CREATE', { taskId: 'task-001' });
        db.recordChange('session-001', 'tasks.json', 'UPDATE', { taskId: 'task-001' });
        db.recordChange('session-002', 'config.json', 'UPDATE', { key: 'setting' });

        const changes = db.getRecentChanges(10);
        expect(changes).toHaveLength(3);
      });

      test('should query changes by session', () => {
        db.recordChange('session-001', 'tasks.json', 'CREATE', {});
        db.recordChange('session-001', 'tasks.json', 'UPDATE', {});
        db.recordChange('session-002', 'tasks.json', 'DELETE', {});

        const changes = db.getChangesBySession('session-001');
        expect(changes).toHaveLength(2);
        expect(changes.every(c => c.sessionId === 'session-001')).toBe(true);
      });

      test('should query changes by resource', () => {
        db.recordChange('session-001', 'tasks.json', 'CREATE', {});
        db.recordChange('session-001', 'config.json', 'UPDATE', {});
        db.recordChange('session-002', 'tasks.json', 'DELETE', {});

        const changes = db.getChangesByResource('tasks.json');
        expect(changes).toHaveLength(2);
        expect(changes.every(c => c.resource === 'tasks.json')).toBe(true);
      });

      test('should return empty array for no matching changes', () => {
        const changes = db.getChangesBySession('nonexistent-session');
        expect(changes).toEqual([]);
      });

    });

    describe('markChangeApplied', () => {

      test('should mark change as applied', () => {
        const changeId = db.recordChange('session-001', 'tasks.json', 'UPDATE', {});
        db.markChangeApplied(changeId);

        const change = db.getChange(changeId);
        expect(change.applied).toBe(true);
      });

      test('should not affect other changes', () => {
        const id1 = db.recordChange('session-001', 'tasks.json', 'CREATE', {});
        const id2 = db.recordChange('session-001', 'tasks.json', 'UPDATE', {});

        db.markChangeApplied(id1);

        const change1 = db.getChange(id1);
        const change2 = db.getChange(id2);
        expect(change1.applied).toBe(true);
        expect(change2.applied).toBe(false);
      });

    });

    describe('journal pruning', () => {

      test('should prune old applied entries', () => {
        db.recordChange('session-001', 'tasks.json', 'CREATE', {});
        db.recordChange('session-001', 'tasks.json', 'UPDATE', {});

        // Set old timestamp and mark as applied
        db._setChangeTimestampForTesting(1, Date.now() - (8 * 24 * 60 * 60 * 1000));
        db.markChangeApplied(1);

        const pruned = db.pruneOldChanges(7 * 24 * 60 * 60 * 1000);

        expect(pruned).toBe(1);
        expect(db.getRecentChanges(100)).toHaveLength(1);
      });

      test('should not prune recent entries', () => {
        db.recordChange('session-001', 'tasks.json', 'CREATE', {});
        db.recordChange('session-001', 'tasks.json', 'UPDATE', {});

        const pruned = db.pruneOldChanges(7 * 24 * 60 * 60 * 1000);

        expect(pruned).toBe(0);
        expect(db.getRecentChanges(100)).toHaveLength(2);
      });

    });

  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {

    describe('database initialization', () => {

      test('should create database file if it does not exist', () => {
        const newDbPath = path.join(testDir, 'new-subdir', 'new-coordination.db');
        const newDb = new CoordinationDB(newDbPath, { autoCleanup: false });

        expect(fs.existsSync(newDbPath)).toBe(true);

        newDb.close();
      });

      test('should work with existing database file', () => {
        // Register session with a different ID than current session
        // to avoid it being deregistered on close
        db.registerSession('persist-session', '/project', 'orchestrator');

        // Close without triggering auto-deregister by setting _currentSessionId to null
        db._currentSessionId = null;
        db.stopHeartbeatTimer();
        db.stopCleanupTimer();
        db.db.close();
        db.db = null;

        const reopenedDb = new CoordinationDB(dbPath, { autoCleanup: false });
        const session = reopenedDb.getSession('persist-session');

        expect(session).toBeDefined();
        expect(session.sessionId).toBe('persist-session');

        reopenedDb.close();
        db = null;
      });

    });

    describe('special characters and long values', () => {

      test('should handle very long session IDs', () => {
        const longSessionId = 'session-' + 'x'.repeat(500);
        db.registerSession(longSessionId, '/project', 'orchestrator');

        const session = db.getSession(longSessionId);
        expect(session.sessionId).toBe(longSessionId);
      });

      test('should handle special characters in identifiers', () => {
        const specialSession = 'session-with-special-chars_123.test@domain';
        const specialResource = 'path/to/file with spaces & symbols!.json';

        db.registerSession(specialSession, '/project', 'orchestrator');
        const result = db.acquireLock(specialResource, specialSession);

        expect(result.acquired).toBe(true);
        expect(db.getSession(specialSession)).toBeDefined();
      });

      test('should handle unicode in change data', () => {
        const changeData = {
          message: '日本語テスト 🚀 émojis and ñ special chars',
          value: 42
        };

        const changeId = db.recordChange('session-001', 'tasks.json', 'UPDATE', changeData);
        const change = db.getChange(changeId);

        expect(change.changeData).toEqual(changeData);
      });

    });

    describe('concurrent operations', () => {

      test('should handle rapid sequential operations', () => {
        const results = [];
        for (let i = 0; i < 50; i++) {
          db.registerSession(`session-${i}`, '/project', 'agent');
          db.acquireLock(`resource-${i}`, `session-${i}`);
          db.recordChange(`session-${i}`, `resource-${i}`, 'UPDATE', { i });
          results.push(db.releaseLock(`resource-${i}`, `session-${i}`));
        }

        expect(results.every(r => r === true)).toBe(true);
        expect(db.getRecentChanges(100)).toHaveLength(50);
      });

      test('should maintain consistency with interleaved operations', () => {
        db.registerSession('session-001', '/project', 'agent1');
        const lock1 = db.acquireLock('shared-resource', 'session-001');
        db.registerSession('session-002', '/project', 'agent2');
        const lock2 = db.acquireLock('shared-resource', 'session-002');
        db.recordChange('session-001', 'shared-resource', 'UPDATE', { by: 'session1' });
        db.releaseLock('shared-resource', 'session-001');
        const lock3 = db.acquireLock('shared-resource', 'session-002');

        expect(lock1.acquired).toBe(true);
        expect(lock2.acquired).toBe(false);
        expect(lock3.acquired).toBe(true);
      });

    });

    describe('getStats', () => {

      test('should return database statistics', () => {
        db.registerSession('session-001', '/project', 'orchestrator');
        db.registerSession('session-002', '/project', 'developer');
        db.acquireLock('resource-1', 'session-001');
        db.recordChange('session-001', 'resource-1', 'UPDATE', {});

        const stats = db.getStats();

        expect(stats.sessions.total).toBe(2);
        expect(stats.sessions.active).toBe(2);
        expect(stats.locks.total).toBe(1);
        expect(stats.changes.total).toBe(1);
      });

    });

  });

});
