/**
 * Unit tests for CoordinationDB task claim cleanup system
 */

const CoordinationDB = require('../../.claude/core/coordination-db');
const fs = require('fs');
const path = require('path');

describe('CoordinationDB - Task Claim Cleanup', () => {
  let db;
  let testDbPath;

  beforeEach(() => {
    // Create a unique test database for each test
    const testId = Math.random().toString(36).substring(7);
    testDbPath = path.join(__dirname, `test-claim-cleanup-${testId}.db`);

    db = new CoordinationDB(testDbPath, {
      autoCleanup: false, // Disable auto-cleanup for testing
      claimConfig: {
        defaultTTL: 30 * 60 * 1000, // 30 minutes
        cleanupInterval: 5 * 60 * 1000, // 5 minutes
        orphanThreshold: 10 * 60 * 1000, // 10 minutes
        warningThreshold: 5 * 60 * 1000 // 5 minutes
      }
    });

    // Create task_claims table for testing
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS task_claims (
        task_id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL,
        claimed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        expires_at INTEGER NOT NULL,
        last_heartbeat INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        task_status TEXT NOT NULL DEFAULT 'in-progress'
      );

      CREATE INDEX IF NOT EXISTS idx_task_claims_session ON task_claims(session_id);
      CREATE INDEX IF NOT EXISTS idx_task_claims_expires ON task_claims(expires_at);
    `);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }

    // Clean up test database files
    const files = [
      testDbPath,
      `${testDbPath}-shm`,
      `${testDbPath}-wal`
    ];

    files.forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  });

  // ============================================================================
  // EXPIRED CLAIM CLEANUP TESTS
  // ============================================================================

  describe('cleanupExpiredClaims()', () => {
    test('should return zero when no claims exist', () => {
      const result = db.cleanupExpiredClaims();

      expect(result.count).toBe(0);
      expect(result.claims).toEqual([]);
    });

    test('should not remove active claims', () => {
      const now = Date.now();
      const session = db.registerSession('test-session', '/test', 'test');

      // Insert active claim (expires in future)
      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-1', session.sessionId, now, now + 10 * 60 * 1000, now);

      const result = db.cleanupExpiredClaims();

      expect(result.count).toBe(0);
      expect(result.claims).toEqual([]);

      // Verify claim still exists
      const remaining = db.db.prepare('SELECT COUNT(*) as count FROM task_claims').get();
      expect(remaining.count).toBe(1);
    });

    test('should remove single expired claim', () => {
      const now = Date.now();
      const past = now - 60 * 1000; // 1 minute ago
      const session = db.registerSession('test-session', '/test', 'test');

      // Insert expired claim
      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-1', session.sessionId, past, past + 1000, now);

      const result = db.cleanupExpiredClaims();

      expect(result.count).toBe(1);
      expect(result.claims).toHaveLength(1);
      expect(result.claims[0].taskId).toBe('task-1');
      expect(result.claims[0].sessionId).toBe(session.sessionId);

      // Verify claim was deleted
      const remaining = db.db.prepare('SELECT COUNT(*) as count FROM task_claims').get();
      expect(remaining.count).toBe(0);
    });

    test('should remove multiple expired claims', () => {
      const now = Date.now();
      const past = now - 60 * 1000;
      const session = db.registerSession('test-session', '/test', 'test');

      // Insert 3 expired claims
      for (let i = 1; i <= 3; i++) {
        db.db.prepare(`
          INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
          VALUES (?, ?, ?, ?, ?)
        `).run(`task-${i}`, session.sessionId, past, past + 1000, now);
      }

      const result = db.cleanupExpiredClaims();

      expect(result.count).toBe(3);
      expect(result.claims).toHaveLength(3);

      // Verify all claims deleted
      const remaining = db.db.prepare('SELECT COUNT(*) as count FROM task_claims').get();
      expect(remaining.count).toBe(0);
    });

    test('should only remove expired claims, not active ones', () => {
      const now = Date.now();
      const past = now - 60 * 1000;
      const session = db.registerSession('test-session', '/test', 'test');

      // Insert 2 expired claims
      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-expired-1', session.sessionId, past, past + 1000, now);

      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-expired-2', session.sessionId, past, past + 1000, now);

      // Insert 2 active claims
      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-active-1', session.sessionId, now, now + 10 * 60 * 1000, now);

      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-active-2', session.sessionId, now, now + 10 * 60 * 1000, now);

      const result = db.cleanupExpiredClaims();

      expect(result.count).toBe(2);
      expect(result.claims).toHaveLength(2);

      // Verify only active claims remain
      const remaining = db.db.prepare('SELECT COUNT(*) as count FROM task_claims').get();
      expect(remaining.count).toBe(2);
    });

    test('should emit claim:expired event for each expired claim', (done) => {
      const now = Date.now();
      const past = now - 60 * 1000;
      const session = db.registerSession('test-session', '/test', 'test');

      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-1', session.sessionId, past, past + 1000, now);

      const events = [];
      db.on('claim:expired', (event) => {
        events.push(event);
        if (events.length === 1) {
          expect(event.taskId).toBe('task-1');
          expect(event.sessionId).toBe(session.sessionId);
          expect(event.expiredAt).toBeGreaterThan(0);
          expect(event.ageMs).toBeGreaterThan(0);
          done();
        }
      });

      db.cleanupExpiredClaims();
    });

    test('should emit claims:cleanup summary event', (done) => {
      const now = Date.now();
      const past = now - 60 * 1000;
      const session = db.registerSession('test-session', '/test', 'test');

      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-1', session.sessionId, past, past + 1000, now);

      db.on('claims:cleanup', (event) => {
        expect(event.type).toBe('expired');
        expect(event.count).toBe(1);
        expect(event.timestamp).toBeGreaterThan(0);
        done();
      });

      db.cleanupExpiredClaims();
    });
  });

  // ============================================================================
  // ORPHANED CLAIM CLEANUP TESTS
  // ============================================================================

  describe('cleanupOrphanedClaims()', () => {
    test('should return zero when no orphaned claims exist', () => {
      const now = Date.now();
      const session = db.registerSession('test-session', '/test', 'test');

      // Insert active claim with valid session
      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-1', session.sessionId, now, now + 10 * 60 * 1000, now);

      const result = db.cleanupOrphanedClaims();

      expect(result.count).toBe(0);
      expect(result.claims).toEqual([]);
    });

    test('should remove claims with missing session', () => {
      const now = Date.now();

      // Temporarily disable FK to insert orphan record
      db.db.exec('PRAGMA foreign_keys = OFF');
      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-orphan', 'missing-session', now, now + 10 * 60 * 1000, now);
      db.db.exec('PRAGMA foreign_keys = ON');

      const result = db.cleanupOrphanedClaims();

      expect(result.count).toBe(1);
      expect(result.claims).toHaveLength(1);
      expect(result.claims[0].taskId).toBe('task-orphan');
      expect(result.claims[0].reason).toBe('session_missing');

      // Verify claim was deleted
      const remaining = db.db.prepare('SELECT COUNT(*) as count FROM task_claims').get();
      expect(remaining.count).toBe(0);
    });

    test('should remove claims with stale session', () => {
      const now = Date.now();
      const staleTime = now - 15 * 60 * 1000; // 15 minutes ago (exceeds orphanThreshold)

      // Register session and make it stale
      const session = db.registerSession('stale-session', '/test', 'test');
      db._setHeartbeatForTesting(session.sessionId, staleTime);

      // Insert claim
      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-stale', session.sessionId, now, now + 10 * 60 * 1000, now);

      const result = db.cleanupOrphanedClaims();

      expect(result.count).toBe(1);
      expect(result.claims).toHaveLength(1);
      expect(result.claims[0].taskId).toBe('task-stale');
      expect(result.claims[0].reason).toBe('session_stale');
      expect(result.claims[0].staleForMs).toBeGreaterThan(0);

      // Verify claim was deleted
      const remaining = db.db.prepare('SELECT COUNT(*) as count FROM task_claims').get();
      expect(remaining.count).toBe(0);
    });

    test('should keep claims with active session', () => {
      const now = Date.now();
      const session = db.registerSession('active-session', '/test', 'test');

      // Insert claim with active session
      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-active', session.sessionId, now, now + 10 * 60 * 1000, now);

      const result = db.cleanupOrphanedClaims();

      expect(result.count).toBe(0);

      // Verify claim still exists
      const remaining = db.db.prepare('SELECT COUNT(*) as count FROM task_claims').get();
      expect(remaining.count).toBe(1);
    });

    test('should remove multiple orphaned claims at once', () => {
      const now = Date.now();

      // Temporarily disable FK to insert orphan records
      db.db.exec('PRAGMA foreign_keys = OFF');
      // Insert 3 claims with missing sessions
      for (let i = 1; i <= 3; i++) {
        db.db.prepare(`
          INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
          VALUES (?, ?, ?, ?, ?)
        `).run(`task-${i}`, `missing-session-${i}`, now, now + 10 * 60 * 1000, now);
      }
      db.db.exec('PRAGMA foreign_keys = ON');

      const result = db.cleanupOrphanedClaims();

      expect(result.count).toBe(3);
      expect(result.claims).toHaveLength(3);

      // Verify all claims deleted
      const remaining = db.db.prepare('SELECT COUNT(*) as count FROM task_claims').get();
      expect(remaining.count).toBe(0);
    });

    test('should emit claim:orphaned event for each orphaned claim', (done) => {
      const now = Date.now();

      // Temporarily disable FK to insert orphan record
      db.db.exec('PRAGMA foreign_keys = OFF');
      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-orphan', 'missing-session', now, now + 10 * 60 * 1000, now);
      db.db.exec('PRAGMA foreign_keys = ON');

      const events = [];
      db.on('claim:orphaned', (event) => {
        events.push(event);
        if (events.length === 1) {
          expect(event.taskId).toBe('task-orphan');
          expect(event.sessionId).toBe('missing-session');
          expect(event.reason).toBe('session_missing');
          expect(event.cleanedAt).toBeGreaterThan(0);
          done();
        }
      });

      db.cleanupOrphanedClaims();
    });

    test('should emit claims:cleanup summary event', (done) => {
      const now = Date.now();

      // Temporarily disable FK to insert orphan record
      db.db.exec('PRAGMA foreign_keys = OFF');
      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-orphan', 'missing-session', now, now + 10 * 60 * 1000, now);
      db.db.exec('PRAGMA foreign_keys = ON');

      db.on('claims:cleanup', (event) => {
        expect(event.type).toBe('orphaned');
        expect(event.count).toBe(1);
        expect(event.timestamp).toBeGreaterThan(0);
        done();
      });

      db.cleanupOrphanedClaims();
    });
  });

  // ============================================================================
  // RELEASE SESSION CLAIMS TESTS
  // ============================================================================

  describe('releaseSessionClaims()', () => {
    test('should return zero when session has no claims', () => {
      const session = db.registerSession('test-session', '/test', 'test');

      const result = db.releaseSessionClaims(session.sessionId, 'test');

      expect(result.count).toBe(0);
      expect(result.sessionId).toBe(session.sessionId);
      expect(result.reason).toBe('test');
      expect(result.claims).toEqual([]);
    });

    test('should release single claim for session', () => {
      const now = Date.now();
      const session = db.registerSession('test-session', '/test', 'test');

      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-1', session.sessionId, now, now + 10 * 60 * 1000, now);

      const result = db.releaseSessionClaims(session.sessionId, 'manual');

      expect(result.count).toBe(1);
      expect(result.sessionId).toBe(session.sessionId);
      expect(result.reason).toBe('manual');
      expect(result.claims).toHaveLength(1);
      expect(result.claims[0].taskId).toBe('task-1');
      expect(result.claims[0].heldForMs).toBeGreaterThanOrEqual(0);

      // Verify claim was deleted
      const remaining = db.db.prepare('SELECT COUNT(*) as count FROM task_claims').get();
      expect(remaining.count).toBe(0);
    });

    test('should release multiple claims for session', () => {
      const now = Date.now();
      const session = db.registerSession('test-session', '/test', 'test');

      for (let i = 1; i <= 3; i++) {
        db.db.prepare(`
          INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
          VALUES (?, ?, ?, ?, ?)
        `).run(`task-${i}`, session.sessionId, now, now + 10 * 60 * 1000, now);
      }

      const result = db.releaseSessionClaims(session.sessionId, 'cleanup');

      expect(result.count).toBe(3);
      expect(result.claims).toHaveLength(3);

      // Verify all claims deleted
      const remaining = db.db.prepare('SELECT COUNT(*) as count FROM task_claims').get();
      expect(remaining.count).toBe(0);
    });

    test('should only release claims for specified session', () => {
      const now = Date.now();
      const session1 = db.registerSession('session-1', '/test', 'test');
      const session2 = db.registerSession('session-2', '/test', 'test');

      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-1', session1.sessionId, now, now + 10 * 60 * 1000, now);

      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-2', session2.sessionId, now, now + 10 * 60 * 1000, now);

      const result = db.releaseSessionClaims(session1.sessionId, 'test');

      expect(result.count).toBe(1);
      expect(result.claims[0].taskId).toBe('task-1');

      // Verify session2 claim still exists
      const remaining = db.db.prepare('SELECT COUNT(*) as count FROM task_claims').get();
      expect(remaining.count).toBe(1);
    });

    test('should emit claim:released event for each released claim', (done) => {
      const now = Date.now();
      const session = db.registerSession('test-session', '/test', 'test');

      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-1', session.sessionId, now, now + 10 * 60 * 1000, now);

      const events = [];
      db.on('claim:released', (event) => {
        events.push(event);
        if (events.length === 1) {
          expect(event.taskId).toBe('task-1');
          expect(event.sessionId).toBe(session.sessionId);
          expect(event.reason).toBe('manual');
          expect(event.releasedAt).toBeGreaterThan(0);
          expect(event.heldForMs).toBeGreaterThanOrEqual(0);
          done();
        }
      });

      db.releaseSessionClaims(session.sessionId, 'manual');
    });

    test('should emit claims:session_cleanup summary event', (done) => {
      const now = Date.now();
      const session = db.registerSession('test-session', '/test', 'test');

      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-1', session.sessionId, now, now + 10 * 60 * 1000, now);

      db.on('claims:session_cleanup', (event) => {
        expect(event.sessionId).toBe(session.sessionId);
        expect(event.count).toBe(1);
        expect(event.reason).toBe('manual');
        expect(event.timestamp).toBeGreaterThan(0);
        done();
      });

      db.releaseSessionClaims(session.sessionId, 'manual');
    });

    test('should use default reason when not specified', () => {
      const now = Date.now();
      const session = db.registerSession('test-session', '/test', 'test');

      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-1', session.sessionId, now, now + 10 * 60 * 1000, now);

      const result = db.releaseSessionClaims(session.sessionId);

      expect(result.reason).toBe('session_ended');
    });
  });

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================

  describe('Integration with session deregistration', () => {
    test('deregisterSession should release all claims', () => {
      const now = Date.now();
      const session = db.registerSession('test-session', '/test', 'test');

      // Create 2 claims
      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-1', session.sessionId, now, now + 10 * 60 * 1000, now);

      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-2', session.sessionId, now, now + 10 * 60 * 1000, now);

      const result = db.deregisterSession(session.sessionId);

      expect(result.claimsReleased).toBe(2);

      // Verify claims deleted
      const remaining = db.db.prepare('SELECT COUNT(*) as count FROM task_claims').get();
      expect(remaining.count).toBe(0);
    });

    test('cleanup timer should include claim cleanup', (done) => {
      // This test verifies that _startCleanupTimer calls claim cleanup methods
      // We verify this by checking the implementation indirectly
      const timerDbPath = testDbPath + '-timer';
      const timerDb = new CoordinationDB(timerDbPath, {
        autoCleanup: true,
        cleanupInterval: 100 // 100ms for testing
      });

      // Register a session first (table is created by CoordinationDB._initDatabase)
      const session = timerDb.registerSession('test-session', '/test/project', 'test');

      const now = Date.now();
      const past = now - 60 * 1000;

      // Insert expired claim using the registered session
      timerDb.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-expired', session.sessionId, past, past + 1000, now);

      timerDb.on('claims:cleanup', (event) => {
        expect(event.type).toBe('expired');
        expect(event.count).toBe(1);

        // Close and cleanup
        timerDb.close();

        // Clean up timer database files
        const timerFiles = [
          timerDbPath,
          `${timerDbPath}-shm`,
          `${timerDbPath}-wal`
        ];

        timerFiles.forEach(file => {
          if (fs.existsSync(file)) {
            try {
              fs.unlinkSync(file);
            } catch (err) {
              // Ignore cleanup errors
            }
          }
        });

        done();
      });
    }, 5000); // Increase timeout to 5 seconds
  });

  // ============================================================================
  // STATS INTEGRATION TESTS
  // ============================================================================

  describe('getStats() with claims', () => {
    test('should include claim statistics', () => {
      const now = Date.now();
      const session = db.registerSession('test-session', '/test', 'test');

      // Insert active claim
      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-active', session.sessionId, now, now + 10 * 60 * 1000, now);

      // Insert expiring claim (< warningThreshold)
      db.db.prepare(`
        INSERT INTO task_claims (task_id, session_id, claimed_at, expires_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
      `).run('task-expiring', session.sessionId, now, now + 2 * 60 * 1000, now);

      const stats = db.getStats();

      expect(stats.claims).toBeDefined();
      expect(stats.claims.total).toBe(2);
      expect(stats.claims.active).toBe(2);
      expect(stats.claims.expiring).toBe(1);
    });

    test('should handle missing task_claims table gracefully', () => {
      // Drop the table
      db.db.exec('DROP TABLE IF EXISTS task_claims');

      const stats = db.getStats();

      expect(stats.claims).toBeDefined();
      expect(stats.claims.total).toBe(0);
      expect(stats.claims.active).toBe(0);
      expect(stats.claims.expiring).toBe(0);
    });
  });
});
