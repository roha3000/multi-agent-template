/**
 * Conflict Management Tests
 *
 * Tests for Phase 4: Dashboard Conflicts functionality
 * - CoordinationDB conflict table and methods
 * - Conflict detection and resolution
 * - Change journal integration
 *
 * @module tests/conflict-management
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const CoordinationDB = require('../../.claude/core/coordination-db');

describe('Conflict Management', () => {
  let db;
  let testDir;
  let dbPath;

  beforeEach(() => {
    // Create unique test directory
    testDir = path.join(os.tmpdir(), `conflict-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(testDir, { recursive: true });
    dbPath = path.join(testDir, 'coordination.db');

    db = new CoordinationDB(dbPath, {
      autoCleanup: false,
      defaultLockTTL: 5000,
      staleSessionThreshold: 60000
    });
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // CONFLICT TABLE SCHEMA
  // ============================================================================

  describe('Conflict Table Schema', () => {
    test('should create conflicts table on initialization', () => {
      const tables = db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conflicts'").get();
      expect(tables).toBeDefined();
      expect(tables.name).toBe('conflicts');
    });

    test('should have correct columns in conflicts table', () => {
      const columns = db.db.prepare("PRAGMA table_info(conflicts)").all();
      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('type');
      expect(columnNames).toContain('resource');
      expect(columnNames).toContain('detected_at');
      expect(columnNames).toContain('severity');
      expect(columnNames).toContain('session_a_id');
      expect(columnNames).toContain('session_b_id');
      expect(columnNames).toContain('status');
      expect(columnNames).toContain('resolution');
      expect(columnNames).toContain('resolved_at');
    });

    test('should have indexes for efficient querying', () => {
      const indexes = db.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='conflicts'").all();
      const indexNames = indexes.map(i => i.name);

      expect(indexNames).toContain('idx_conflicts_status');
      expect(indexNames).toContain('idx_conflicts_resource');
      expect(indexNames).toContain('idx_conflicts_detected_at');
    });
  });

  // ============================================================================
  // RECORD CONFLICT
  // ============================================================================

  describe('recordConflict()', () => {
    test('should record a VERSION_CONFLICT', () => {
      const conflict = db.recordConflict({
        type: 'VERSION_CONFLICT',
        resource: 'tasks.json',
        sessionAId: 'session-001',
        sessionAVersion: 5,
        sessionBId: 'session-002',
        sessionBVersion: 7,
        severity: 'warning'
      });

      expect(conflict).toBeDefined();
      expect(conflict.id).toBeDefined();
      expect(conflict.type).toBe('VERSION_CONFLICT');
      expect(conflict.status).toBe('pending');
    });

    test('should record a CONCURRENT_EDIT conflict', () => {
      const conflict = db.recordConflict({
        type: 'CONCURRENT_EDIT',
        resource: 'tasks.json',
        sessionAId: 'session-001',
        sessionBId: 'session-002',
        affectedTaskIds: ['task-001', 'task-002'],
        severity: 'warning'
      });

      expect(conflict.type).toBe('CONCURRENT_EDIT');
      expect(conflict.affectedTaskIds).toContain('task-001');
    });

    test('should record a MERGE_FAILURE conflict', () => {
      const conflict = db.recordConflict({
        type: 'MERGE_FAILURE',
        resource: 'tasks.json',
        sessionAId: 'session-001',
        sessionAData: { status: 'completed' },
        sessionBData: { status: 'in_progress' },
        fieldConflicts: [{ field: 'status', valueA: 'completed', valueB: 'in_progress' }],
        severity: 'critical'
      });

      expect(conflict.type).toBe('MERGE_FAILURE');
      expect(conflict.severity).toBe('critical');
    });

    test('should emit conflict:detected event', (done) => {
      db.on('conflict:detected', (conflict) => {
        expect(conflict.type).toBe('VERSION_CONFLICT');
        done();
      });

      db.recordConflict({
        type: 'VERSION_CONFLICT',
        resource: 'tasks.json',
        sessionAId: 'session-001'
      });
    });

    test('should auto-generate UUID for conflict ID', () => {
      const conflict1 = db.recordConflict({
        type: 'VERSION_CONFLICT',
        sessionAId: 'session-001'
      });
      const conflict2 = db.recordConflict({
        type: 'VERSION_CONFLICT',
        sessionAId: 'session-002'
      });

      expect(conflict1.id).not.toBe(conflict2.id);
      expect(conflict1.id.length).toBeGreaterThan(10);
    });

    test('should use provided conflict ID if given', () => {
      const conflict = db.recordConflict({
        id: 'custom-conflict-id',
        type: 'VERSION_CONFLICT',
        sessionAId: 'session-001'
      });

      expect(conflict.id).toBe('custom-conflict-id');
    });

    test('should store session data as JSON', () => {
      const sessionData = { tasks: { 'task-001': { status: 'completed' } } };

      db.recordConflict({
        type: 'VERSION_CONFLICT',
        sessionAId: 'session-001',
        sessionAData: sessionData
      });

      const conflicts = db.getPendingConflicts();
      expect(conflicts[0].sessionAData).toEqual(sessionData);
    });
  });

  // ============================================================================
  // GET CONFLICTS
  // ============================================================================

  describe('getConflict() and getPendingConflicts()', () => {
    beforeEach(() => {
      // Create multiple conflicts
      db.recordConflict({ type: 'VERSION_CONFLICT', sessionAId: 'session-001', severity: 'warning' });
      db.recordConflict({ type: 'CONCURRENT_EDIT', sessionAId: 'session-002', severity: 'warning' });
      db.recordConflict({ type: 'MERGE_FAILURE', sessionAId: 'session-003', severity: 'critical' });
    });

    test('should retrieve a specific conflict by ID', () => {
      const created = db.recordConflict({
        type: 'VERSION_CONFLICT',
        sessionAId: 'session-test'
      });

      const retrieved = db.getConflict(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.sessionAId).toBe('session-test');
    });

    test('should return null for non-existent conflict', () => {
      const conflict = db.getConflict('non-existent-id');
      expect(conflict).toBeNull();
    });

    test('should get all pending conflicts', () => {
      const pending = db.getPendingConflicts();
      expect(pending.length).toBe(3);
      pending.forEach(c => expect(c.status).toBe('pending'));
    });

    test('should return pending conflicts ordered by detected_at DESC', () => {
      const pending = db.getPendingConflicts();
      for (let i = 1; i < pending.length; i++) {
        expect(pending[i - 1].detectedAt).toBeGreaterThanOrEqual(pending[i].detectedAt);
      }
    });
  });

  describe('getConflicts() with filters', () => {
    beforeEach(() => {
      db.recordConflict({ type: 'VERSION_CONFLICT', resource: 'tasks.json', sessionAId: 's1' });
      db.recordConflict({ type: 'CONCURRENT_EDIT', resource: 'tasks.json', sessionAId: 's2' });
      db.recordConflict({ type: 'VERSION_CONFLICT', resource: 'other.json', sessionAId: 's3' });
    });

    test('should paginate results with limit and offset', () => {
      const page1 = db.getConflicts({ limit: 2, offset: 0 });
      expect(page1.conflicts.length).toBeLessThanOrEqual(2);
      expect(page1.pagination.limit).toBe(2);
      expect(page1.pagination.offset).toBe(0);
    });

    test('should filter by resource', () => {
      const result = db.getConflicts({ resource: 'tasks.json', limit: 50 });
      result.conflicts.forEach(c => expect(c.resource).toBe('tasks.json'));
    });

    test('should return summary with counts', () => {
      const result = db.getConflicts({});
      expect(result.summary).toBeDefined();
      expect(result.summary.pending).toBeGreaterThan(0);
      expect(result.summary.total).toBeGreaterThan(0);
    });

    test('should include resolved conflicts when requested', () => {
      // Resolve one conflict
      const pending = db.getPendingConflicts();
      db.resolveConflict(pending[0].id, 'manual');

      // Without includeResolved
      const withoutResolved = db.getConflicts({ includeResolved: false });
      expect(withoutResolved.conflicts.every(c => c.status === 'pending')).toBe(true);
    });
  });

  // ============================================================================
  // RESOLVE CONFLICT
  // ============================================================================

  describe('resolveConflict()', () => {
    let conflictId;

    beforeEach(() => {
      const conflict = db.recordConflict({
        type: 'VERSION_CONFLICT',
        sessionAId: 'session-001',
        sessionAVersion: 5,
        sessionBVersion: 7
      });
      conflictId = conflict.id;
    });

    test('should resolve conflict with version_a', () => {
      const result = db.resolveConflict(conflictId, 'version_a');

      expect(result.success).toBe(true);
      expect(result.conflict.status).toBe('resolved');
      expect(result.conflict.resolution).toBe('version_a');
    });

    test('should resolve conflict with version_b', () => {
      const result = db.resolveConflict(conflictId, 'version_b');

      expect(result.success).toBe(true);
      expect(result.conflict.resolution).toBe('version_b');
    });

    test('should resolve conflict with merged data', () => {
      const mergedData = { tasks: { 'task-001': { status: 'completed' } } };
      const result = db.resolveConflict(conflictId, 'merged', {
        resolutionData: mergedData
      });

      expect(result.success).toBe(true);
      expect(result.conflict.resolution).toBe('merged');

      const retrieved = db.getConflict(conflictId);
      expect(retrieved.resolutionData).toEqual(mergedData);
    });

    test('should set resolvedAt timestamp', () => {
      const before = Date.now();
      const result = db.resolveConflict(conflictId, 'manual');
      const after = Date.now();

      expect(result.conflict.resolvedAt).toBeGreaterThanOrEqual(before);
      expect(result.conflict.resolvedAt).toBeLessThanOrEqual(after);
    });

    test('should set resolvedBy from current session', () => {
      db.registerSession('resolver-session', '/project', 'resolver');
      const result = db.resolveConflict(conflictId, 'manual');

      expect(result.conflict.resolvedBy).toBe('resolver-session');
    });

    test('should allow custom resolvedBy', () => {
      const result = db.resolveConflict(conflictId, 'manual', {
        resolvedBy: 'admin-user'
      });

      expect(result.conflict.resolvedBy).toBe('admin-user');
    });

    test('should store resolution notes', () => {
      const result = db.resolveConflict(conflictId, 'version_b', {
        notes: 'Chose version B because it has the latest changes'
      });

      expect(result.success).toBe(true);

      const retrieved = db.getConflict(conflictId);
      expect(retrieved.resolutionNotes).toBe('Chose version B because it has the latest changes');
    });

    test('should emit conflict:resolved event', (done) => {
      db.on('conflict:resolved', (conflict) => {
        expect(conflict.id).toBe(conflictId);
        expect(conflict.resolution).toBe('manual');
        done();
      });

      db.resolveConflict(conflictId, 'manual');
    });

    test('should return error for non-existent conflict', () => {
      const result = db.resolveConflict('non-existent', 'manual');
      expect(result.success).toBe(false);
      expect(result.error).toBe('CONFLICT_NOT_FOUND');
    });

    test('should return error for already resolved conflict', () => {
      db.resolveConflict(conflictId, 'manual');
      const result = db.resolveConflict(conflictId, 'version_a');

      expect(result.success).toBe(false);
      expect(result.error).toBe('ALREADY_RESOLVED');
      expect(result.existingResolution).toBe('manual');
    });

    test('should support auto-resolved status', () => {
      const result = db.resolveConflict(conflictId, 'merged', {
        autoResolved: true
      });

      expect(result.success).toBe(true);
      expect(result.conflict.status).toBe('auto-resolved');
    });
  });

  // ============================================================================
  // CONFLICT COUNTS
  // ============================================================================

  describe('getConflictCounts()', () => {
    test('should return zero counts when no conflicts', () => {
      const counts = db.getConflictCounts();
      expect(counts.pending).toBe(0);
      expect(counts.resolved).toBe(0);
      expect(counts.total).toBe(0);
    });

    test('should count pending conflicts', () => {
      db.recordConflict({ type: 'VERSION_CONFLICT', sessionAId: 's1' });
      db.recordConflict({ type: 'CONCURRENT_EDIT', sessionAId: 's2' });

      const counts = db.getConflictCounts();
      expect(counts.pending).toBe(2);
      expect(counts.total).toBe(2);
    });

    test('should count resolved conflicts separately', () => {
      const c1 = db.recordConflict({ type: 'VERSION_CONFLICT', sessionAId: 's1' });
      db.recordConflict({ type: 'CONCURRENT_EDIT', sessionAId: 's2' });

      db.resolveConflict(c1.id, 'manual');

      const counts = db.getConflictCounts();
      expect(counts.pending).toBe(1);
      expect(counts.resolved).toBe(1);
      expect(counts.total).toBe(2);
    });

    test('should count auto-resolved separately', () => {
      const c1 = db.recordConflict({ type: 'VERSION_CONFLICT', sessionAId: 's1' });
      db.resolveConflict(c1.id, 'merged', { autoResolved: true });

      const counts = db.getConflictCounts();
      expect(counts.autoResolved).toBe(1);
    });
  });

  // ============================================================================
  // CONFLICT PRUNING
  // ============================================================================

  describe('pruneOldConflicts()', () => {
    test('should prune old resolved conflicts', () => {
      const c1 = db.recordConflict({ type: 'VERSION_CONFLICT', sessionAId: 's1' });
      db.resolveConflict(c1.id, 'manual');

      // Set resolved_at to old timestamp
      db.db.prepare('UPDATE conflicts SET resolved_at = ? WHERE id = ?').run(Date.now() - 8 * 24 * 60 * 60 * 1000, c1.id);

      const pruned = db.pruneOldConflicts(7 * 24 * 60 * 60 * 1000);
      expect(pruned).toBe(1);

      const retrieved = db.getConflict(c1.id);
      expect(retrieved).toBeNull();
    });

    test('should not prune pending conflicts', () => {
      const c1 = db.recordConflict({ type: 'VERSION_CONFLICT', sessionAId: 's1' });

      // Set detected_at to old timestamp
      db.db.prepare('UPDATE conflicts SET detected_at = ? WHERE id = ?').run(Date.now() - 8 * 24 * 60 * 60 * 1000, c1.id);

      const pruned = db.pruneOldConflicts(7 * 24 * 60 * 60 * 1000);
      expect(pruned).toBe(0);

      const retrieved = db.getConflict(c1.id);
      expect(retrieved).not.toBeNull();
    });

    test('should emit conflicts:pruned event', (done) => {
      const c1 = db.recordConflict({ type: 'VERSION_CONFLICT', sessionAId: 's1' });
      db.resolveConflict(c1.id, 'manual');
      db.db.prepare('UPDATE conflicts SET resolved_at = ? WHERE id = ?').run(Date.now() - 8 * 24 * 60 * 60 * 1000, c1.id);

      db.on('conflicts:pruned', (data) => {
        expect(data.count).toBe(1);
        done();
      });

      db.pruneOldConflicts(7 * 24 * 60 * 60 * 1000);
    });
  });

  // ============================================================================
  // INTEGRATION WITH CHANGE JOURNAL
  // ============================================================================

  describe('Integration with Change Journal', () => {
    test('should be able to correlate conflicts with journal entries', () => {
      // Record changes
      db.registerSession('session-001', '/project', 'developer');
      const changeId1 = db.recordChange('session-001', 'tasks.json', 'UPDATE', { taskId: 'task-001', status: 'completed' });

      db.registerSession('session-002', '/project', 'developer');
      const changeId2 = db.recordChange('session-002', 'tasks.json', 'UPDATE', { taskId: 'task-001', status: 'in_progress' });

      // Record conflict
      const conflict = db.recordConflict({
        type: 'CONCURRENT_EDIT',
        resource: 'tasks.json',
        sessionAId: 'session-001',
        sessionBId: 'session-002',
        affectedTaskIds: ['task-001']
      });

      // Verify we can retrieve related changes
      const session1Changes = db.getChangesBySession('session-001');
      const session2Changes = db.getChangesBySession('session-002');

      expect(session1Changes.length).toBeGreaterThan(0);
      expect(session2Changes.length).toBeGreaterThan(0);

      // Both sessions modified the same task
      expect(session1Changes[0].changeData.taskId).toBe('task-001');
      expect(session2Changes[0].changeData.taskId).toBe('task-001');
    });
  });

  // ============================================================================
  // CONFLICT TYPE VALIDATION
  // ============================================================================

  describe('Conflict Type Validation', () => {
    test('should only allow valid conflict types', () => {
      // Valid types should work
      expect(() => {
        db.recordConflict({ type: 'VERSION_CONFLICT', sessionAId: 's1' });
      }).not.toThrow();

      expect(() => {
        db.recordConflict({ type: 'CONCURRENT_EDIT', sessionAId: 's2' });
      }).not.toThrow();

      expect(() => {
        db.recordConflict({ type: 'STALE_LOCK', sessionAId: 's3' });
      }).not.toThrow();

      expect(() => {
        db.recordConflict({ type: 'MERGE_FAILURE', sessionAId: 's4' });
      }).not.toThrow();

      // Invalid type should throw (SQLite constraint)
      expect(() => {
        db.recordConflict({ type: 'INVALID_TYPE', sessionAId: 's5' });
      }).toThrow();
    });

    test('should only allow valid severity levels', () => {
      expect(() => {
        db.recordConflict({ type: 'VERSION_CONFLICT', sessionAId: 's1', severity: 'info' });
      }).not.toThrow();

      expect(() => {
        db.recordConflict({ type: 'VERSION_CONFLICT', sessionAId: 's2', severity: 'warning' });
      }).not.toThrow();

      expect(() => {
        db.recordConflict({ type: 'VERSION_CONFLICT', sessionAId: 's3', severity: 'critical' });
      }).not.toThrow();

      expect(() => {
        db.recordConflict({ type: 'VERSION_CONFLICT', sessionAId: 's4', severity: 'invalid' });
      }).toThrow();
    });
  });
});
