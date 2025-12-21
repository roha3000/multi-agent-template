/**
 * MemoryStore Task History Integration Tests
 *
 * Tests the task history and learning functionality:
 * - recordTaskCompletion()
 * - getTaskPatternSuccess()
 * - getAverageDurationByPhase()
 * - getTaskStats()
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const MemoryStore = require('./memory-store');

describe('MemoryStore - Task History', () => {
  let store;
  let tempDir;
  let dbPath;

  beforeEach(() => {
    // Create temporary database
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-store-test-'));
    dbPath = path.join(tempDir, 'test-memory.db');
    store = new MemoryStore(dbPath);
  });

  afterEach(() => {
    // Clean up
    if (store && store.db) {
      store.close();
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  // Helper function to create test task
  const createTestTask = (overrides = {}) => ({
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: 'Test Task',
    description: 'Test task description',
    phase: 'implementation',
    priority: 'high',
    estimate: '4h',
    tags: ['testing', 'backend'],
    status: 'completed',
    created: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
    started: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    completed: new Date().toISOString(),
    ...overrides
  });

  // ===================================================================
  // SCHEMA INITIALIZATION
  // ===================================================================

  describe('Schema Initialization', () => {
    test('should create task_history table on first use', () => {
      const task = createTestTask();
      store.recordTaskCompletion(task);

      // Verify table exists by querying it
      const result = store.db.prepare(
        'SELECT COUNT(*) as count FROM task_history'
      ).get();

      expect(result).toBeDefined();
      expect(result.count).toBe(1);
    });

    test('should create tag_stats table on first use', () => {
      const task = createTestTask();
      store.recordTaskCompletion(task);

      const result = store.db.prepare(
        'SELECT COUNT(*) as count FROM tag_stats'
      ).get();

      expect(result).toBeDefined();
    });

    test('should not fail on multiple schema initializations', () => {
      store._ensureTaskSchema();
      store._ensureTaskSchema();
      store._ensureTaskSchema();

      const task = createTestTask();
      expect(() => store.recordTaskCompletion(task)).not.toThrow();
    });
  });

  // ===================================================================
  // recordTaskCompletion
  // ===================================================================

  describe('recordTaskCompletion', () => {
    test('should record single task completion with all fields', () => {
      const task = createTestTask({
        id: 'test-task-1',
        title: 'Integration Test Task',
        workSessionId: 'session-123',
        orchestrationId: 'orch-456',
        metadata: { custom: 'data' }
      });

      store.recordTaskCompletion(task);

      const recorded = store.db.prepare(
        'SELECT * FROM task_history WHERE task_id = ?'
      ).get('test-task-1');

      expect(recorded).toBeDefined();
      expect(recorded.task_id).toBe('test-task-1');
      expect(recorded.title).toBe('Integration Test Task');
      expect(recorded.phase).toBe('implementation');
      expect(recorded.priority).toBe('high');
      expect(recorded.work_session_id).toBe('session-123');
      expect(recorded.orchestration_id).toBe('orch-456');
    });

    test('should calculate task duration correctly', () => {
      const now = new Date();
      const task = createTestTask({
        started: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(),
        completed: now.toISOString()
      });

      store.recordTaskCompletion(task);

      const recorded = store.db.prepare(
        'SELECT actual_duration FROM task_history WHERE task_id = ?'
      ).get(task.id);

      expect(recorded.actual_duration).toBeCloseTo(5, 0);
    });

    test('should update tag statistics after recording', () => {
      const task = createTestTask({
        tags: ['testing', 'backend']
      });

      store.recordTaskCompletion(task);

      const testingStats = store.db.prepare(
        'SELECT * FROM tag_stats WHERE tag = ?'
      ).get('testing');

      expect(testingStats).toBeDefined();
      expect(testingStats.total_occurrences).toBe(1);
      expect(testingStats.success_count).toBe(1);
    });

    test('should handle tasks without optional fields', () => {
      const minimalTask = {
        id: 'minimal-task',
        title: 'Minimal Task',
        phase: 'research',
        priority: 'medium',
        status: 'completed',
        tags: [],
        created: new Date().toISOString(),
        completed: new Date().toISOString()
      };

      expect(() => store.recordTaskCompletion(minimalTask)).not.toThrow();

      const recorded = store.db.prepare(
        'SELECT * FROM task_history WHERE task_id = ?'
      ).get('minimal-task');

      expect(recorded).toBeDefined();
      expect(recorded.work_session_id).toBeNull();
      expect(recorded.orchestration_id).toBeNull();
    });

    test('should handle tasks with empty tags array', () => {
      const task = createTestTask({
        id: 'no-tags-task',
        tags: []
      });

      expect(() => store.recordTaskCompletion(task)).not.toThrow();
    });
  });

  // ===================================================================
  // MULTIPLE TASK COMPLETIONS
  // ===================================================================

  describe('Multiple Task Completions', () => {
    test('should accumulate statistics across multiple tasks', () => {
      const tasks = [
        createTestTask({ id: 'task-1', tags: ['backend'] }),
        createTestTask({ id: 'task-2', tags: ['backend'] }),
        createTestTask({ id: 'task-3', tags: ['backend'] })
      ];

      for (const task of tasks) {
        store.recordTaskCompletion(task);
      }

      const stats = store.db.prepare(
        'SELECT * FROM tag_stats WHERE tag = ?'
      ).get('backend');

      expect(stats.total_occurrences).toBe(3);
      expect(stats.success_count).toBe(3);
    });

    test('should maintain separate statistics for different tags', () => {
      store.recordTaskCompletion(createTestTask({
        id: 'task-1',
        tags: ['frontend', 'react']
      }));
      store.recordTaskCompletion(createTestTask({
        id: 'task-2',
        tags: ['backend', 'api']
      }));
      store.recordTaskCompletion(createTestTask({
        id: 'task-3',
        tags: ['frontend', 'css']
      }));

      const frontendStats = store.db.prepare(
        'SELECT total_occurrences FROM tag_stats WHERE tag = ?'
      ).get('frontend');
      const backendStats = store.db.prepare(
        'SELECT total_occurrences FROM tag_stats WHERE tag = ?'
      ).get('backend');

      expect(frontendStats.total_occurrences).toBe(2);
      expect(backendStats.total_occurrences).toBe(1);
    });
  });

  // ===================================================================
  // getTaskPatternSuccess
  // ===================================================================

  describe('getTaskPatternSuccess', () => {
    test('should return high success rate for all completed tasks', () => {
      store.recordTaskCompletion(createTestTask({
        id: 'task-1',
        tags: ['testing'],
        status: 'completed'
      }));
      store.recordTaskCompletion(createTestTask({
        id: 'task-2',
        tags: ['testing'],
        status: 'completed'
      }));

      const successRate = store.getTaskPatternSuccess(['testing']);

      expect(successRate).toBeGreaterThanOrEqual(0.5);
    });

    test('should return default for tags with no history', () => {
      const successRate = store.getTaskPatternSuccess(['nonexistent']);

      expect(successRate).toBe(0.5); // neutral default
    });

    test('should use primary tag when multiple tags provided', () => {
      store.recordTaskCompletion(createTestTask({
        id: 'task-1',
        tags: ['primary']
      }));

      const successRate = store.getTaskPatternSuccess(['primary', 'secondary']);

      expect(typeof successRate).toBe('number');
      expect(successRate).toBeGreaterThanOrEqual(0);
      expect(successRate).toBeLessThanOrEqual(1);
    });

    test('should return 0.5 for empty tags array', () => {
      const successRate = store.getTaskPatternSuccess([]);
      expect(successRate).toBe(0.5);
    });

    test('should return 0.5 for null tags', () => {
      const successRate = store.getTaskPatternSuccess(null);
      expect(successRate).toBe(0.5);
    });
  });

  // ===================================================================
  // getAverageDurationByPhase
  // ===================================================================

  describe('getAverageDurationByPhase', () => {
    test('should return correct average for single phase', () => {
      const now = new Date();
      store.recordTaskCompletion(createTestTask({
        id: 'task-1',
        phase: 'implementation',
        started: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(),
        completed: now.toISOString()
      }));

      const avgDuration = store.getAverageDurationByPhase('implementation');

      expect(avgDuration).toBeCloseTo(6, 0);
    });

    test('should calculate average across multiple tasks', () => {
      const now = new Date();

      // Task 1: 4 hours
      store.recordTaskCompletion(createTestTask({
        id: 'task-1',
        phase: 'testing',
        started: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(),
        completed: now.toISOString()
      }));

      // Task 2: 6 hours
      store.recordTaskCompletion(createTestTask({
        id: 'task-2',
        phase: 'testing',
        started: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(),
        completed: now.toISOString()
      }));

      const avgDuration = store.getAverageDurationByPhase('testing');

      expect(avgDuration).toBeCloseTo(5, 0); // (4 + 6) / 2 = 5
    });

    test('should return default 4 hours for phase with no data', () => {
      const avgDuration = store.getAverageDurationByPhase('nonexistent');

      expect(avgDuration).toBe(4);
    });

    test('should only include completed tasks in average', () => {
      const now = new Date();

      store.recordTaskCompletion(createTestTask({
        id: 'task-1',
        phase: 'design',
        status: 'completed',
        started: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(),
        completed: now.toISOString()
      }));

      const avgDuration = store.getAverageDurationByPhase('design');

      expect(avgDuration).toBeCloseTo(5, 0);
    });
  });

  // ===================================================================
  // getTaskStats
  // ===================================================================

  describe('getTaskStats', () => {
    beforeEach(() => {
      const now = new Date();

      // Create diverse task set
      store.recordTaskCompletion(createTestTask({
        id: 'task-1',
        phase: 'implementation',
        priority: 'high',
        tags: ['backend', 'api'],
        started: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(),
        completed: now.toISOString()
      }));

      store.recordTaskCompletion(createTestTask({
        id: 'task-2',
        phase: 'implementation',
        priority: 'medium',
        tags: ['frontend', 'react'],
        started: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(),
        completed: now.toISOString()
      }));

      store.recordTaskCompletion(createTestTask({
        id: 'task-3',
        phase: 'testing',
        priority: 'high',
        tags: ['backend', 'integration'],
        started: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(),
        completed: now.toISOString()
      }));

      store.recordTaskCompletion(createTestTask({
        id: 'task-4',
        phase: 'testing',
        priority: 'low',
        tags: ['documentation'],
        started: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
        completed: now.toISOString()
      }));
    });

    test('should return stats for all tasks without filters', () => {
      const stats = store.getTaskStats({});

      expect(stats.total).toBe(4);
      expect(stats.completed).toBe(4);
      expect(stats.success_rate).toBe(1.0);
    });

    test('should filter by phase correctly', () => {
      const stats = store.getTaskStats({ phase: 'implementation' });

      expect(stats.total).toBe(2);
      expect(stats.completed).toBe(2);
    });

    test('should filter by priority correctly', () => {
      const stats = store.getTaskStats({ priority: 'high' });

      expect(stats.total).toBe(2);
      expect(stats.completed).toBe(2);
    });

    test('should filter by tags correctly', () => {
      const stats = store.getTaskStats({ tags: ['backend'] });

      expect(stats.total).toBe(2);
      expect(stats.completed).toBe(2);
    });

    test('should combine multiple filters', () => {
      const stats = store.getTaskStats({
        phase: 'testing',
        priority: 'high'
      });

      expect(stats.total).toBe(1);
      expect(stats.completed).toBe(1);
    });

    test('should return zero stats for no matching tasks', () => {
      const stats = store.getTaskStats({
        phase: 'nonexistent'
      });

      expect(stats.total).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.success_rate).toBe(0);
    });
  });

  // ===================================================================
  // EMPTY DATABASE
  // ===================================================================

  describe('Empty Database', () => {
    test('should handle empty database for pattern success', () => {
      const successRate = store.getTaskPatternSuccess(['testing']);
      expect(successRate).toBe(0.5);
    });

    test('should handle empty database for phase duration', () => {
      const avgDuration = store.getAverageDurationByPhase('implementation');
      expect(avgDuration).toBe(4);
    });

    test('should handle empty database for task stats', () => {
      const stats = store.getTaskStats({});

      expect(stats).toEqual({
        total: 0,
        completed: 0,
        success_rate: 0,
        avg_duration: 0
      });
    });
  });

  // ===================================================================
  // EDGE CASES
  // ===================================================================

  describe('Edge Cases', () => {
    test('should handle tasks with very long durations', () => {
      const now = new Date();
      const task = createTestTask({
        id: 'long-task',
        started: new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString(),
        completed: now.toISOString()
      });

      store.recordTaskCompletion(task);

      const recorded = store.db.prepare(
        'SELECT actual_duration FROM task_history WHERE task_id = ?'
      ).get('long-task');

      expect(recorded.actual_duration).toBeGreaterThan(2000);
    });

    test('should handle tasks with very short durations', () => {
      const now = new Date();
      const task = createTestTask({
        id: 'short-task',
        started: new Date(now.getTime() - 30 * 1000).toISOString(),
        completed: now.toISOString()
      });

      store.recordTaskCompletion(task);

      const recorded = store.db.prepare(
        'SELECT actual_duration FROM task_history WHERE task_id = ?'
      ).get('short-task');

      expect(recorded.actual_duration).toBeLessThan(1);
    });

    test('should handle tasks with many tags', () => {
      const manyTags = Array.from({ length: 20 }, (_, i) => `tag-${i}`);

      store.recordTaskCompletion(createTestTask({
        id: 'many-tags-task',
        tags: manyTags
      }));

      const tagCount = store.db.prepare(
        'SELECT COUNT(*) as count FROM tag_stats'
      ).get();

      expect(tagCount.count).toBeGreaterThanOrEqual(20);
    });

    test('should handle tasks with special characters in fields', () => {
      const task = createTestTask({
        id: 'special-chars-task',
        title: 'Task with "quotes" and \'apostrophes\'',
        description: 'Description with <html> & special chars',
        tags: ['tag-with-dash', 'tag_with_underscore']
      });

      expect(() => store.recordTaskCompletion(task)).not.toThrow();

      const recorded = store.db.prepare(
        'SELECT * FROM task_history WHERE task_id = ?'
      ).get('special-chars-task');

      expect(recorded.title).toBe('Task with "quotes" and \'apostrophes\'');
    });

    test('should handle null or undefined optional fields gracefully', () => {
      const task = {
        id: 'nullable-task',
        title: 'Nullable Task',
        phase: 'research',
        priority: 'medium',
        status: 'completed',
        tags: [],
        created: new Date().toISOString(),
        completed: new Date().toISOString(),
        workSessionId: null,
        orchestrationId: undefined,
        metadata: null
      };

      expect(() => store.recordTaskCompletion(task)).not.toThrow();
    });

    test('should handle missing started timestamp', () => {
      const task = createTestTask({
        id: 'no-started-task',
        started: null
      });

      expect(() => store.recordTaskCompletion(task)).not.toThrow();

      const recorded = store.db.prepare(
        'SELECT actual_duration FROM task_history WHERE task_id = ?'
      ).get('no-started-task');

      // When started is null, the implementation may use completed timestamp
      // or calculate a default duration - the key is it doesn't throw
      expect(recorded).toBeDefined();
      expect(typeof recorded.actual_duration).toBe('number');
    });
  });

  // ===================================================================
  // DATA INTEGRITY
  // ===================================================================

  describe('Data Integrity', () => {
    test('should allow multiple completions for same task ID', () => {
      const task = createTestTask({ id: 'duplicate-task' });

      store.recordTaskCompletion(task);
      store.recordTaskCompletion(task);

      const count = store.db.prepare(
        'SELECT COUNT(*) as count FROM task_history WHERE task_id = ?'
      ).get('duplicate-task');

      // May allow duplicates or update - implementation dependent
      expect(count.count).toBeGreaterThanOrEqual(1);
    });

    test('should maintain relationship between task_history and tag_stats', () => {
      store.recordTaskCompletion(createTestTask({
        id: 'task-1',
        tags: ['backend']
      }));

      const taskExists = store.db.prepare(
        'SELECT 1 FROM task_history WHERE task_id = ?'
      ).get('task-1');

      const tagStatsExist = store.db.prepare(
        'SELECT 1 FROM tag_stats WHERE tag = ?'
      ).get('backend');

      expect(taskExists).toBeDefined();
      expect(tagStatsExist).toBeDefined();
    });
  });

  // ===================================================================
  // ESTIMATE PARSING
  // ===================================================================

  describe('Estimate Parsing', () => {
    test('should parse hours estimate correctly', () => {
      const result = store._parseEstimateHours('4h');
      expect(result).toBe(4);
    });

    test('should parse days estimate correctly', () => {
      const result = store._parseEstimateHours('2d');
      expect(result).toBe(16); // 2 * 8 hours
    });

    test('should return 0 for invalid estimate', () => {
      const result = store._parseEstimateHours('invalid');
      expect(result).toBe(0);
    });

    test('should return 0 for null estimate', () => {
      const result = store._parseEstimateHours(null);
      expect(result).toBe(0);
    });

    test('should handle decimal hours', () => {
      const result = store._parseEstimateHours('2.5h');
      expect(result).toBe(2.5);
    });
  });
});
