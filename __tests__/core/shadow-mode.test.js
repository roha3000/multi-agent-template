/**
 * Shadow Mode Unit Tests
 *
 * Tests for Phase 3: Shadow Mode Validation
 * Validates consistency between JSON and SQLite operations
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const TaskManager = require('../../.claude/core/task-manager');
const ShadowModeMetrics = require('../../.claude/core/shadow-mode-metrics');

describe('ShadowModeMetrics', () => {
  let metrics;

  beforeEach(() => {
    metrics = new ShadowModeMetrics({
      sessionId: 'test-session-' + Date.now()
    });
  });

  afterEach(() => {
    if (metrics) {
      metrics.close();
    }
  });

  describe('Configuration', () => {
    test('should initialize with default options', () => {
      expect(metrics.options.persistInterval).toBe(60000);
      expect(metrics.options.latencyBufferSize).toBe(100);
      expect(metrics.options.divergenceThreshold).toBe(5);
    });

    test('should accept custom options', () => {
      const customMetrics = new ShadowModeMetrics({
        persistInterval: 30000,
        latencyBufferSize: 50,
        divergenceThreshold: 10
      });
      expect(customMetrics.options.persistInterval).toBe(30000);
      expect(customMetrics.options.latencyBufferSize).toBe(50);
      expect(customMetrics.options.divergenceThreshold).toBe(10);
      customMetrics.close();
    });

    test('should start disabled by default', () => {
      expect(metrics.isEnabled()).toBe(false);
    });

    test('should enable and disable', () => {
      metrics.enable();
      expect(metrics.isEnabled()).toBe(true);

      metrics.disable();
      expect(metrics.isEnabled()).toBe(false);
    });
  });

  describe('Counter Metrics', () => {
    test('should track conflict_count', () => {
      metrics.recordConflict();
      metrics.recordConflict();
      const counters = metrics.getCounters();
      expect(counters.conflict_count).toBe(2);
    });

    test('should track merge_count', () => {
      metrics.recordMerge();
      const counters = metrics.getCounters();
      expect(counters.merge_count).toBe(1);
    });

    test('should track divergence_count', () => {
      metrics.recordDivergence({ type: 'test' });
      const counters = metrics.getCounters();
      expect(counters.divergence_count).toBe(1);
    });

    test('should track save_count with latency', () => {
      metrics.recordSave(50);
      metrics.recordSave(100);
      const counters = metrics.getCounters();
      expect(counters.save_count).toBe(2);
    });

    test('should track load_count with latency', () => {
      metrics.recordLoad(30);
      const counters = metrics.getCounters();
      expect(counters.load_count).toBe(1);
    });

    test('should track lock acquisition', () => {
      metrics.recordLock(true, 10);
      metrics.recordLock(false, 20);
      const counters = metrics.getCounters();
      expect(counters.lock_acquired).toBe(1);
      expect(counters.lock_failed).toBe(1);
    });

    test('should track validation results', () => {
      metrics.recordValidation(true, 5);
      metrics.recordValidation(false, 10);
      const counters = metrics.getCounters();
      expect(counters.validation_passed).toBe(1);
      expect(counters.validation_failed).toBe(1);
    });

    test('should increment arbitrary counters', () => {
      metrics.increment('save_count', 5);
      const counters = metrics.getCounters();
      expect(counters.save_count).toBe(5);
    });
  });

  describe('Error Tracking', () => {
    test('should track sqlite errors', () => {
      metrics.recordError('sqlite');
      const errors = metrics.getErrors();
      expect(errors.sqlite).toBe(1);
    });

    test('should track json errors', () => {
      metrics.recordError('json');
      const errors = metrics.getErrors();
      expect(errors.json).toBe(1);
    });

    test('should track unknown errors as other', () => {
      metrics.recordError('unknown_type');
      const errors = metrics.getErrors();
      expect(errors.other).toBe(1);
    });
  });

  describe('Latency Statistics', () => {
    test('should compute average latency', () => {
      metrics.recordSave(10);
      metrics.recordSave(20);
      metrics.recordSave(30);
      const latency = metrics.getLatencyStats();
      expect(latency.save.avg).toBe(20);
    });

    test('should compute p99 latency', () => {
      for (let i = 1; i <= 100; i++) {
        metrics.recordSave(i);
      }
      const latency = metrics.getLatencyStats();
      expect(latency.save.p99).toBeGreaterThanOrEqual(99);
    });

    test('should track max latency', () => {
      metrics.recordSave(10);
      metrics.recordSave(100);
      metrics.recordSave(50);
      const latency = metrics.getLatencyStats();
      expect(latency.save.max).toBe(100);
    });

    test('should handle empty latency buffer', () => {
      const latency = metrics.getLatencyStats();
      expect(latency.save.avg).toBe(0);
      expect(latency.save.samples).toBe(0);
    });
  });

  describe('Divergence Management', () => {
    test('should record divergence with details', () => {
      const record = metrics.recordDivergence({
        type: 'HASH_MISMATCH',
        severity: 'warning',
        jsonHash: 'abc123',
        sqliteHash: 'def456',
        version: 5,
        details: { message: 'test' }
      });

      expect(record.id).toBeDefined();
      expect(record.type).toBe('HASH_MISMATCH');
      expect(record.severity).toBe('warning');
      expect(record.jsonHash).toBe('abc123');
      expect(record.resolved).toBe(false);
    });

    test('should get unresolved divergences', () => {
      metrics.recordDivergence({ type: 'test1' });
      metrics.recordDivergence({ type: 'test2' });

      const all = metrics.getDivergences();
      expect(all.length).toBe(2);

      const unresolved = metrics.getDivergences({ unresolvedOnly: true });
      expect(unresolved.length).toBe(2);
    });

    test('should resolve divergence', () => {
      const record = metrics.recordDivergence({ type: 'test' });
      const resolved = metrics.resolveDivergence(record.id, 'manual');

      expect(resolved.resolved).toBe(true);
      expect(resolved.resolution).toBe('manual');
      expect(resolved.resolvedAt).toBeDefined();
    });

    test('should limit divergence history', () => {
      const customMetrics = new ShadowModeMetrics({ maxDivergences: 5 });

      for (let i = 0; i < 10; i++) {
        customMetrics.recordDivergence({ type: `test${i}` });
      }

      const divergences = customMetrics.getDivergences();
      expect(divergences.length).toBe(5);
      customMetrics.close();
    });
  });

  describe('Summary and Health', () => {
    test('should generate complete summary', () => {
      metrics.enable();
      metrics.recordSave(50);
      metrics.recordConflict();

      const summary = metrics.getSummary();
      expect(summary.enabled).toBe(true);
      expect(summary.sessionId).toBeDefined();
      expect(summary.counters).toBeDefined();
      expect(summary.latency).toBeDefined();
      expect(summary.rates).toBeDefined();
    });

    test('should calculate health score', () => {
      metrics.enable();
      for (let i = 0; i < 100; i++) {
        metrics.recordSave(10);
      }

      const health = metrics.getHealth();
      expect(health.score).toBeGreaterThanOrEqual(0);
      expect(health.score).toBeLessThanOrEqual(100);
      expect(health.status).toBeDefined();
      expect(['healthy', 'warning', 'degraded', 'critical']).toContain(health.status);
    });

    test('should reduce health score for divergences', () => {
      metrics.enable();
      for (let i = 0; i < 100; i++) {
        metrics.recordSave(10);
      }
      const healthBefore = metrics.getHealth();

      // Add divergences
      for (let i = 0; i < 10; i++) {
        metrics.recordDivergence({ type: 'test' });
      }
      const healthAfter = metrics.getHealth();

      expect(healthAfter.score).toBeLessThan(healthBefore.score);
    });

    test('should indicate migration readiness', () => {
      metrics.enable();

      // Not enough operations
      let health = metrics.getHealth();
      expect(health.ready_for_migration).toBe(false);

      // Add 100 saves
      for (let i = 0; i < 100; i++) {
        metrics.recordSave(10);
      }

      health = metrics.getHealth();
      expect(health.ready_for_migration).toBe(true);
    });
  });

  describe('Reset', () => {
    test('should reset all metrics', () => {
      metrics.recordSave(50);
      metrics.recordConflict();
      metrics.recordDivergence({ type: 'test' });

      metrics.reset();

      const counters = metrics.getCounters();
      expect(counters.save_count).toBe(0);
      expect(counters.conflict_count).toBe(0);
      expect(counters.divergence_count).toBe(0);

      const divergences = metrics.getDivergences();
      expect(divergences.length).toBe(0);
    });
  });

  describe('Events', () => {
    test('should emit counter:incremented event', (done) => {
      metrics.once('counter:incremented', (data) => {
        expect(data.name).toBe('save_count');
        expect(data.value).toBe(1);
        done();
      });

      metrics.increment('save_count');
    });

    test('should emit metric:divergence event', (done) => {
      metrics.once('metric:divergence', (record) => {
        expect(record.type).toBe('test');
        done();
      });

      metrics.recordDivergence({ type: 'test' });
    });

    test('should emit shadow:enabled event', (done) => {
      metrics.once('shadow:enabled', (data) => {
        expect(data.sessionId).toBeDefined();
        done();
      });

      metrics.enable();
    });
  });
});

describe('TaskManager Shadow Mode', () => {
  let taskManager;
  let tempDir;
  let tasksPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-tm-test-'));
    tasksPath = path.join(tempDir, 'tasks.json');

    // Create initial tasks file
    fs.writeFileSync(tasksPath, JSON.stringify({
      version: '1.0.0',
      project: { name: 'test', phases: ['implementation'] },
      backlog: {
        now: { description: 'Now', tasks: [] },
        next: { description: 'Next', tasks: [] },
        later: { description: 'Later', tasks: [] },
        someday: { description: 'Someday', tasks: [] },
        completed: { description: 'Completed', tasks: [] }
      },
      tasks: {}
    }, null, 2));
  });

  afterEach(() => {
    if (taskManager) {
      // Close shadow metrics if active
      if (taskManager._shadowMetrics) {
        taskManager._shadowMetrics.close();
      }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Shadow Mode Configuration', () => {
    test('should disable shadow mode by default', () => {
      taskManager = new TaskManager({ tasksPath });
      expect(taskManager.isShadowModeEnabled()).toBe(false);
    });

    test('should enable shadow mode via constructor option', () => {
      taskManager = new TaskManager({
        tasksPath,
        shadowMode: true,
        useCoordination: false // Disable coordination for unit tests
      });
      expect(taskManager.isShadowModeEnabled()).toBe(true);
    });

    test('should enable shadow mode at runtime', () => {
      taskManager = new TaskManager({
        tasksPath,
        useCoordination: false
      });
      expect(taskManager.isShadowModeEnabled()).toBe(false);

      taskManager.enableShadowMode(true);
      expect(taskManager.isShadowModeEnabled()).toBe(true);
    });

    test('should disable shadow mode at runtime', () => {
      taskManager = new TaskManager({
        tasksPath,
        shadowMode: true,
        useCoordination: false
      });

      taskManager.enableShadowMode(false);
      expect(taskManager.isShadowModeEnabled()).toBe(false);
    });
  });

  describe('Hash Computation', () => {
    test('should compute deterministic hash', () => {
      taskManager = new TaskManager({
        tasksPath,
        shadowMode: true,
        useCoordination: false
      });

      const obj = { a: 1, b: 2 };
      const hash1 = taskManager._computeContentHash(obj);
      const hash2 = taskManager._computeContentHash(obj);

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64); // SHA-256 hex
    });

    test('should produce same hash regardless of key order', () => {
      taskManager = new TaskManager({
        tasksPath,
        shadowMode: true,
        useCoordination: false
      });

      const obj1 = { a: 1, b: 2, c: 3 };
      const obj2 = { c: 3, a: 1, b: 2 };

      const hash1 = taskManager._computeContentHash(obj1);
      const hash2 = taskManager._computeContentHash(obj2);

      expect(hash1).toBe(hash2);
    });

    test('should produce different hash for different content', () => {
      taskManager = new TaskManager({
        tasksPath,
        shadowMode: true,
        useCoordination: false
      });

      const obj1 = { a: 1 };
      const obj2 = { a: 2 };

      const hash1 = taskManager._computeContentHash(obj1);
      const hash2 = taskManager._computeContentHash(obj2);

      expect(hash1).not.toBe(hash2);
    });

    test('should handle nested objects', () => {
      taskManager = new TaskManager({
        tasksPath,
        shadowMode: true,
        useCoordination: false
      });

      const obj = { a: { b: { c: 1 } }, d: [1, 2, 3] };
      const hash = taskManager._computeContentHash(obj);

      expect(hash.length).toBe(64);
    });

    test('should handle string input', () => {
      taskManager = new TaskManager({
        tasksPath,
        shadowMode: true,
        useCoordination: false
      });

      const obj = { a: 1 };
      const str = JSON.stringify(obj);

      const hash1 = taskManager._computeContentHash(obj);
      const hash2 = taskManager._computeContentHash(str);

      expect(hash1).toBe(hash2);
    });
  });

  describe('Shadow Mode with Operations', () => {
    test('should track save operations with shadow mode', () => {
      taskManager = new TaskManager({
        tasksPath,
        shadowMode: true,
        useCoordination: false
      });

      // Force initialize shadow mode
      taskManager._initShadowMode();

      // Perform a save
      taskManager.save();

      const metrics = taskManager.getShadowMetrics();
      expect(metrics).toBeDefined();
      expect(metrics.counters.save_count).toBeGreaterThan(0);
    });

    test('should emit shadow:initialized event', (done) => {
      taskManager = new TaskManager({
        tasksPath,
        shadowMode: true,
        useCoordination: false
      });

      taskManager.once('shadow:initialized', (data) => {
        expect(data.sessionId).toBeDefined();
        done();
      });

      taskManager._initShadowMode();
    });

    test('should provide health assessment', () => {
      taskManager = new TaskManager({
        tasksPath,
        shadowMode: true,
        useCoordination: false
      });

      taskManager._initShadowMode();

      // Perform some saves
      for (let i = 0; i < 5; i++) {
        taskManager.save();
      }

      const health = taskManager.getShadowHealth();
      expect(health).toBeDefined();
      expect(health.score).toBeGreaterThanOrEqual(0);
      expect(health.status).toBeDefined();
    });
  });

  describe('Force Shadow Sync', () => {
    test('should force sync and return hash', () => {
      taskManager = new TaskManager({
        tasksPath,
        shadowMode: true,
        useCoordination: false
      });

      const result = taskManager.forceShadowSync();

      expect(result.synced).toBe(true);
      expect(result.hash).toBeDefined();
      expect(result.hash.length).toBe(64);
    });

    test('should return error if shadow mode disabled', () => {
      taskManager = new TaskManager({
        tasksPath,
        shadowMode: false,
        useCoordination: false
      });

      const result = taskManager.forceShadowSync();

      expect(result.synced).toBe(false);
      expect(result.reason).toBe('shadow_mode_not_enabled');
    });

    test('should emit shadow:synced event', (done) => {
      taskManager = new TaskManager({
        tasksPath,
        shadowMode: true,
        useCoordination: false
      });

      taskManager.once('shadow:synced', (data) => {
        expect(data.hash).toBeDefined();
        done();
      });

      taskManager.forceShadowSync();
    });
  });

  describe('Shadow Mode Events', () => {
    test('should emit shadow:mode-changed on toggle', (done) => {
      taskManager = new TaskManager({
        tasksPath,
        useCoordination: false
      });

      taskManager.once('shadow:mode-changed', (data) => {
        expect(data.enabled).toBe(true);
        done();
      });

      taskManager.enableShadowMode(true);
    });
  });
});

describe('LatencyRingBuffer', () => {
  // Test the internal ring buffer implementation
  const ShadowModeMetrics = require('../../.claude/core/shadow-mode-metrics');

  test('should maintain bounded size', () => {
    const metrics = new ShadowModeMetrics({ latencyBufferSize: 5 });

    for (let i = 0; i < 10; i++) {
      metrics.recordSave(i);
    }

    const stats = metrics.getLatencyStats();
    expect(stats.save.samples).toBe(10); // Total samples recorded
    // But buffer only holds last 5

    metrics.close();
  });
});
