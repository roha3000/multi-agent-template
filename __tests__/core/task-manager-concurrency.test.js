/**
 * TaskManager Optimistic Locking Tests
 *
 * Tests for the _concurrency field and version conflict detection/resolution
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const TaskManager = require('../../.claude/core/task-manager');

describe('TaskManager Optimistic Locking', () => {
  let tempDir;
  let tasksPath;
  let manager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskmanager-concurrency-'));
    tasksPath = path.join(tempDir, 'tasks.json');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('Session ID tracking', () => {
    test('should use provided sessionId', () => {
      manager = new TaskManager({
        tasksPath,
        sessionId: 'custom-session-123'
      });

      expect(manager.sessionId).toBe('custom-session-123');
    });

    test('should auto-generate sessionId if not provided', () => {
      manager = new TaskManager({ tasksPath });

      expect(manager.sessionId).toBeDefined();
      expect(typeof manager.sessionId).toBe('string');
      expect(manager.sessionId.length).toBeGreaterThan(0);
    });

    test('should track sessionId in concurrency field on save', () => {
      manager = new TaskManager({
        tasksPath,
        sessionId: 'test-session'
      });

      const content = fs.readFileSync(tasksPath, 'utf8');
      const data = JSON.parse(content);

      expect(data._concurrency.lastModifiedBy).toBe('test-session');
    });
  });

  describe('_concurrency field initialization', () => {
    test('should initialize _concurrency on new file', () => {
      manager = new TaskManager({ tasksPath, sessionId: 'init-session' });

      const content = fs.readFileSync(tasksPath, 'utf8');
      const data = JSON.parse(content);

      expect(data._concurrency).toBeDefined();
      expect(data._concurrency.version).toBeGreaterThanOrEqual(1);
      expect(data._concurrency.lastModifiedBy).toBe('init-session');
      expect(data._concurrency.lastModifiedAt).toBeDefined();
    });

    test('should initialize _concurrency on legacy file without it', () => {
      // Create a legacy tasks.json without _concurrency
      const legacyData = {
        version: '1.1.0',
        project: { name: 'test' },
        backlog: { now: { tasks: [] }, next: { tasks: [] }, later: { tasks: [] }, someday: { tasks: [] }, completed: { tasks: [] } },
        tasks: {}
      };
      fs.writeFileSync(tasksPath, JSON.stringify(legacyData, null, 2));

      manager = new TaskManager({ tasksPath, sessionId: 'upgrade-session' });

      expect(manager.tasks._concurrency).toBeDefined();
      expect(manager.tasks._concurrency.version).toBe(1);
    });
  });

  describe('Version increment on save', () => {
    test('should increment version on each save', () => {
      manager = new TaskManager({ tasksPath, sessionId: 'version-test' });

      const initialVersion = manager.tasks._concurrency.version;

      // Create a task to trigger save
      manager.createTask({
        title: 'Task 1',
        phase: 'implementation',
        backlogTier: 'now'
      });

      expect(manager.tasks._concurrency.version).toBe(initialVersion + 1);
    });

    test('should update lastModifiedAt on each save', () => {
      manager = new TaskManager({ tasksPath, sessionId: 'time-test' });

      const initialTime = manager.tasks._concurrency.lastModifiedAt;

      // Small delay to ensure time difference
      const startTime = Date.now();
      while (Date.now() - startTime < 10) {
        // Busy wait for 10ms
      }

      manager.createTask({
        title: 'Task 1',
        phase: 'implementation',
        backlogTier: 'now'
      });

      expect(new Date(manager.tasks._concurrency.lastModifiedAt).getTime())
        .toBeGreaterThanOrEqual(new Date(initialTime).getTime());
    });
  });

  describe('Version conflict detection', () => {
    test('should detect version conflict when disk version is higher', () => {
      manager = new TaskManager({ tasksPath, sessionId: 'session-1' });

      // Simulate external modification with higher version
      const content = fs.readFileSync(tasksPath, 'utf8');
      const diskData = JSON.parse(content);
      diskData._concurrency.version = 999;

      const conflictInfo = manager._checkVersionConflict(diskData);

      expect(conflictInfo.conflict).toBe(true);
      expect(conflictInfo.diskVersion).toBe(999);
    });

    test('should not detect conflict when memory version matches disk', () => {
      manager = new TaskManager({ tasksPath, sessionId: 'session-1' });

      const content = fs.readFileSync(tasksPath, 'utf8');
      const diskData = JSON.parse(content);

      const conflictInfo = manager._checkVersionConflict(diskData);

      expect(conflictInfo.conflict).toBe(false);
    });
  });

  describe('Conflict resolution with merge', () => {
    test('should emit version-conflict event on conflict', () => {
      manager = new TaskManager({ tasksPath, sessionId: 'session-1' });
      manager.createTask({
        title: 'Task 1',
        phase: 'implementation',
        backlogTier: 'now'
      });

      const events = [];
      manager.on('tasks:version-conflict', (data) => {
        events.push(data);
      });

      // Simulate external modification with higher version
      const content = fs.readFileSync(tasksPath, 'utf8');
      const diskData = JSON.parse(content);
      diskData._concurrency.version = 999;
      diskData.tasks['external-task'] = {
        id: 'external-task',
        title: 'External Task',
        status: 'ready',
        phase: 'implementation'
      };
      fs.writeFileSync(tasksPath, JSON.stringify(diskData, null, 2));

      // Force a save which should detect and resolve conflict
      manager.createTask({
        title: 'Task 2',
        phase: 'implementation',
        backlogTier: 'now'
      });

      // Should have emitted conflict events
      expect(events.length).toBeGreaterThan(0);
    });

    test('should merge external task additions', () => {
      manager = new TaskManager({ tasksPath, sessionId: 'session-1' });
      manager.createTask({
        title: 'Task 1',
        phase: 'implementation',
        backlogTier: 'now'
      });

      // Simulate external modification
      const content = fs.readFileSync(tasksPath, 'utf8');
      const diskData = JSON.parse(content);
      diskData._concurrency.version = 999;
      diskData.tasks['external-task'] = {
        id: 'external-task',
        title: 'External Task',
        status: 'ready',
        phase: 'implementation'
      };
      fs.writeFileSync(tasksPath, JSON.stringify(diskData, null, 2));

      // Create another task to trigger merge
      manager.createTask({
        title: 'Task 2',
        phase: 'implementation',
        backlogTier: 'now'
      });

      // Should have merged external task
      expect(manager.tasks.tasks['external-task']).toBeDefined();
      expect(manager.tasks.tasks['external-task'].title).toBe('External Task');
    });
  });

  describe('Multi-session simulation', () => {
    test('should handle two sessions modifying same file', () => {
      // Session 1 creates initial state
      const session1 = new TaskManager({ tasksPath, sessionId: 'session-1' });
      session1.createTask({
        title: 'Session 1 Task',
        phase: 'implementation',
        backlogTier: 'now'
      });

      // Session 2 loads the file
      const session2 = new TaskManager({ tasksPath, sessionId: 'session-2' });

      // Session 1 adds another task
      session1.createTask({
        title: 'Session 1 Task 2',
        phase: 'implementation',
        backlogTier: 'now'
      });

      // Session 2 tries to add a task (should merge)
      session2.createTask({
        title: 'Session 2 Task',
        phase: 'implementation',
        backlogTier: 'now'
      });

      // Reload session 1 to see merged state
      session1.reload();

      // Both sessions' tasks should exist
      const allTasks = Object.values(session1.tasks.tasks);
      const titles = allTasks.map(t => t.title);

      expect(titles).toContain('Session 1 Task');
      expect(titles).toContain('Session 1 Task 2');
      expect(titles).toContain('Session 2 Task');
    });
  });

  describe('Backward compatibility', () => {
    test('should work with legacy file without _concurrency', () => {
      // Create a legacy tasks.json
      const legacyData = {
        version: '1.1.0',
        project: {
          name: 'test',
          phases: ['research', 'planning', 'design', 'implementation', 'testing', 'validation']
        },
        backlog: {
          now: { tasks: ['task-1'], description: 'Now' },
          next: { tasks: [], description: 'Next' },
          later: { tasks: [], description: 'Later' },
          someday: { tasks: [], description: 'Someday' },
          completed: { tasks: [], description: 'Completed' }
        },
        tasks: {
          'task-1': {
            id: 'task-1',
            title: 'Legacy Task',
            status: 'ready',
            phase: 'implementation',
            priority: 'medium',
            depends: { blocks: [], requires: [], related: [] },
            tags: [],
            acceptance: [],
            created: new Date().toISOString(),
            updated: new Date().toISOString()
          }
        }
      };
      fs.writeFileSync(tasksPath, JSON.stringify(legacyData, null, 2));

      // Load and verify
      manager = new TaskManager({ tasksPath, sessionId: 'upgrade-session' });

      // Should have initialized _concurrency
      expect(manager.tasks._concurrency).toBeDefined();
      expect(manager.tasks._concurrency.version).toBe(1);

      // Should preserve existing tasks
      expect(manager.tasks.tasks['task-1']).toBeDefined();
      expect(manager.tasks.tasks['task-1'].title).toBe('Legacy Task');

      // Should be able to create new tasks
      manager.createTask({
        title: 'New Task',
        phase: 'implementation',
        backlogTier: 'now'
      });
      expect(manager.tasks._concurrency.version).toBe(2);
    });
  });
});
