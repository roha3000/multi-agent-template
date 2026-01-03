/**
 * TaskManager Hierarchy Tests
 *
 * Tests for parent-child task relationships, subtask creation,
 * hierarchy traversal, decomposition tracking, and integrity validation.
 *
 * Tests the following hierarchy features:
 * - Task hierarchy fields (parentTaskId, childTaskIds, delegatedTo, delegationDepth)
 * - Subtask creation and linking
 * - Hierarchy traversal methods
 * - Task decomposition metadata
 * - Hierarchy integrity validation and repair
 * - Parent progress aggregation
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const TaskManager = require('../../.claude/core/task-manager');

describe('TaskManager Hierarchy', () => {
  let tempDir;
  let tasksPath;
  let manager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskmanager-hierarchy-'));
    tasksPath = path.join(tempDir, 'tasks.json');
    manager = new TaskManager({
      tasksPath,
      sessionId: 'hierarchy-test-session',
      useCoordination: false
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  // ============================================================
  // TASK HIERARCHY FIELDS
  // ============================================================

  describe('Task Hierarchy Fields', () => {
    describe('parentTaskId', () => {
      test('should be null for root tasks', () => {
        const task = manager.createTask({
          title: 'Root Task',
          phase: 'implementation',
          backlogTier: 'now'
        });

        expect(task.parentTaskId).toBeNull();
      });

      test('should reference parent after subtask creation', () => {
        const parent = manager.createTask({
          title: 'Parent Task',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const subtask = manager.createSubtask(parent.id, {
          title: 'Subtask 1',
          description: 'First subtask'
        });

        expect(subtask.parentTaskId).toBe(parent.id);
      });
    });

    describe('childTaskIds', () => {
      test('should be empty array initially after subtask creation on parent', () => {
        const parent = manager.createTask({
          title: 'Parent Task',
          phase: 'implementation',
          backlogTier: 'now'
        });

        // childTaskIds is initialized as empty array
        expect(parent.childTaskIds).toEqual([]);
      });

      test('should contain subtask IDs after creation', () => {
        const parent = manager.createTask({
          title: 'Parent Task',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const subtask1 = manager.createSubtask(parent.id, { title: 'Subtask 1' });
        const subtask2 = manager.createSubtask(parent.id, { title: 'Subtask 2' });

        const updatedParent = manager.getTask(parent.id);
        expect(updatedParent.childTaskIds).toContain(subtask1.id);
        expect(updatedParent.childTaskIds).toContain(subtask2.id);
        expect(updatedParent.childTaskIds).toHaveLength(2);
      });
    });

    describe('delegatedTo', () => {
      test('should be null for non-delegated tasks', () => {
        const task = manager.createTask({
          title: 'Regular Task',
          phase: 'implementation',
          backlogTier: 'now'
        });

        expect(task.delegatedTo).toBeNull();
      });

      test('should store delegation info via delegateToAgent', () => {
        const task = manager.createTask({
          title: 'Task to Delegate',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const delegationInfo = {
          agentId: 'agent-123',
          sessionId: 'session-456'
        };

        manager.delegateToAgent(task.id, delegationInfo);

        const updated = manager.getTask(task.id);
        expect(updated.delegatedTo).toBeDefined();
        expect(updated.delegatedTo.agentId).toBe('agent-123');
        expect(updated.delegatedTo.sessionId).toBe('session-456');
        expect(updated.delegatedTo.delegatedAt).toBeDefined();
      });

      test('should emit task:delegated event', () => {
        const task = manager.createTask({
          title: 'Delegatable Task',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const events = [];
        manager.on('task:delegated', (data) => events.push(data));

        manager.delegateToAgent(task.id, { agentId: 'agent-x' });

        expect(events).toHaveLength(1);
        expect(events[0].delegationInfo.agentId).toBe('agent-x');
      });
    });

    describe('delegationDepth', () => {
      test('should be 0 for root tasks (undefined initially)', () => {
        const task = manager.createTask({
          title: 'Root Task',
          phase: 'implementation',
          backlogTier: 'now'
        });

        expect(task.delegationDepth).toBe(0);
      });

      test('should increment for each level of subtask', () => {
        const root = manager.createTask({
          title: 'Root',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const level1 = manager.createSubtask(root.id, { title: 'Level 1' });
        expect(level1.delegationDepth).toBe(1);

        const level2 = manager.createSubtask(level1.id, { title: 'Level 2' });
        expect(level2.delegationDepth).toBe(2);

        const level3 = manager.createSubtask(level2.id, { title: 'Level 3' });
        expect(level3.delegationDepth).toBe(3);
      });
    });

    describe('decomposition object', () => {
      test('should be null for non-decomposed tasks', () => {
        const task = manager.createTask({
          title: 'Simple Task',
          phase: 'implementation',
          backlogTier: 'now'
        });

        expect(task.decomposition).toBeNull();
      });

      test('should be initialized when subtask is created', () => {
        const parent = manager.createTask({
          title: 'Parent Task',
          phase: 'implementation',
          backlogTier: 'now'
        });

        manager.createSubtask(parent.id, { title: 'Subtask 1' });

        const updated = manager.getTask(parent.id);
        expect(updated.decomposition).toBeDefined();
        expect(updated.decomposition.strategy).toBe('manual');
        expect(updated.decomposition.completedSubtasks).toBe(0);
        expect(updated.decomposition.aggregationRule).toBe('average');
      });

      test('should be settable via setDecomposition', () => {
        const task = manager.createTask({
          title: 'Decomposable Task',
          phase: 'implementation',
          backlogTier: 'now'
        });

        manager.setDecomposition(task.id, {
          strategy: 'parallel',
          estimatedSubtasks: 5,
          aggregationRule: 'all'
        });

        const updated = manager.getTask(task.id);
        expect(updated.decomposition.strategy).toBe('parallel');
        expect(updated.decomposition.estimatedSubtasks).toBe(5);
        expect(updated.decomposition.aggregationRule).toBe('all');
      });
    });
  });

  // ============================================================
  // SUBTASK CREATION
  // ============================================================

  describe('Subtask Creation', () => {
    test('should create subtask linked to parent', () => {
      const parent = manager.createTask({
        title: 'Parent Task',
        phase: 'implementation',
        backlogTier: 'now'
      });

      const subtask = manager.createSubtask(parent.id, {
        title: 'Subtask',
        description: 'Test subtask'
      });

      expect(subtask.id).toBeDefined();
      expect(subtask.title).toBe('Subtask');
      expect(subtask.parentTaskId).toBe(parent.id);
    });

    test('should add subtask ID to parent childTaskIds', () => {
      const parent = manager.createTask({
        title: 'Parent Task',
        phase: 'implementation',
        backlogTier: 'now'
      });

      const subtask = manager.createSubtask(parent.id, { title: 'Subtask' });

      const updatedParent = manager.getTask(parent.id);
      expect(updatedParent.childTaskIds).toContain(subtask.id);
    });

    test('should set proper delegation depth', () => {
      const parent = manager.createTask({
        title: 'Parent Task',
        phase: 'implementation',
        backlogTier: 'now'
      });

      const subtask = manager.createSubtask(parent.id, { title: 'Subtask' });

      expect(subtask.delegationDepth).toBe(1);
    });

    test('should inherit phase from parent if not specified', () => {
      const parent = manager.createTask({
        title: 'Parent Task',
        phase: 'testing',
        backlogTier: 'now'
      });

      const subtask = manager.createSubtask(parent.id, { title: 'Subtask' });

      expect(subtask.phase).toBe('testing');
    });

    test('should inherit priority from parent if not specified', () => {
      const parent = manager.createTask({
        title: 'Parent Task',
        phase: 'implementation',
        priority: 'high',
        backlogTier: 'now'
      });

      const subtask = manager.createSubtask(parent.id, { title: 'Subtask' });

      expect(subtask.priority).toBe('high');
    });

    test('should inherit tags from parent', () => {
      const parent = manager.createTask({
        title: 'Parent Task',
        phase: 'implementation',
        tags: ['feature', 'urgent'],
        backlogTier: 'now'
      });

      const subtask = manager.createSubtask(parent.id, { title: 'Subtask' });

      expect(subtask.tags).toContain('feature');
      expect(subtask.tags).toContain('urgent');
    });

    test('should add subtask to same backlog tier as parent', () => {
      const parent = manager.createTask({
        title: 'Parent Task',
        phase: 'implementation',
        backlogTier: 'next'
      });

      const subtask = manager.createSubtask(parent.id, { title: 'Subtask' });

      expect(manager.tasks.backlog.next.tasks).toContain(subtask.id);
    });

    test('should throw error if parent not found', () => {
      expect(() => {
        manager.createSubtask('nonexistent-parent', { title: 'Orphan' });
      }).toThrow('Parent task not found');
    });

    test('should emit task:subtask-created event', () => {
      const parent = manager.createTask({
        title: 'Parent Task',
        phase: 'implementation',
        backlogTier: 'now'
      });

      const events = [];
      manager.on('task:subtask-created', (data) => events.push(data));

      const subtask = manager.createSubtask(parent.id, { title: 'Subtask' });

      expect(events).toHaveLength(1);
      expect(events[0].parent.id).toBe(parent.id);
      expect(events[0].subtask.id).toBe(subtask.id);
    });

    test('should allow custom subtask properties', () => {
      const parent = manager.createTask({
        title: 'Parent Task',
        phase: 'implementation',
        backlogTier: 'now'
      });

      const subtask = manager.createSubtask(parent.id, {
        title: 'Custom Subtask',
        phase: 'testing',
        priority: 'critical',
        estimate: '4h',
        delegatedTo: { agentId: 'test-agent' }
      });

      expect(subtask.phase).toBe('testing');
      expect(subtask.priority).toBe('critical');
      expect(subtask.estimate).toBe('4h');
      expect(subtask.delegatedTo.agentId).toBe('test-agent');
    });
  });

  // ============================================================
  // HIERARCHY TRAVERSAL
  // ============================================================

  describe('Hierarchy Traversal', () => {
    let root, child1, child2, grandchild1, grandchild2;

    beforeEach(() => {
      // Create a hierarchy:
      //       root
      //      /    \
      //   child1  child2
      //     |
      // grandchild1  grandchild2

      root = manager.createTask({
        title: 'Root',
        phase: 'implementation',
        backlogTier: 'now'
      });

      child1 = manager.createSubtask(root.id, { title: 'Child 1' });
      child2 = manager.createSubtask(root.id, { title: 'Child 2' });
      grandchild1 = manager.createSubtask(child1.id, { title: 'Grandchild 1' });
      grandchild2 = manager.createSubtask(child1.id, { title: 'Grandchild 2' });
    });

    describe('getTaskHierarchy', () => {
      test('should return full tree structure', () => {
        const hierarchy = manager.getTaskHierarchy(root.id);

        expect(hierarchy.id).toBe(root.id);
        expect(hierarchy.children).toHaveLength(2);

        const child1Node = hierarchy.children.find(c => c.id === child1.id);
        expect(child1Node.children).toHaveLength(2);
      });

      test('should return null for nonexistent task', () => {
        const hierarchy = manager.getTaskHierarchy('nonexistent');
        expect(hierarchy).toBeNull();
      });

      test('should return empty children array for leaf tasks', () => {
        const hierarchy = manager.getTaskHierarchy(grandchild1.id);
        expect(hierarchy.children).toEqual([]);
      });
    });

    describe('getRootTask', () => {
      test('should return self for root task', () => {
        const result = manager.getRootTask(root.id);
        expect(result.id).toBe(root.id);
      });

      test('should find root from child', () => {
        const result = manager.getRootTask(child1.id);
        expect(result.id).toBe(root.id);
      });

      test('should find root from grandchild', () => {
        const result = manager.getRootTask(grandchild1.id);
        expect(result.id).toBe(root.id);
      });

      test('should return null for nonexistent task', () => {
        const result = manager.getRootTask('nonexistent');
        expect(result).toBeNull();
      });
    });

    describe('getHierarchyAncestors', () => {
      test('should return empty array for root task', () => {
        const ancestors = manager.getHierarchyAncestors(root.id);
        expect(ancestors).toEqual([]);
      });

      test('should return parent for child task', () => {
        const ancestors = manager.getHierarchyAncestors(child1.id);
        expect(ancestors).toHaveLength(1);
        expect(ancestors[0].id).toBe(root.id);
      });

      test('should return all ancestors for grandchild', () => {
        const ancestors = manager.getHierarchyAncestors(grandchild1.id);
        expect(ancestors).toHaveLength(2);
        expect(ancestors[0].id).toBe(child1.id);
        expect(ancestors[1].id).toBe(root.id);
      });

      test('should return empty array for nonexistent task', () => {
        const ancestors = manager.getHierarchyAncestors('nonexistent');
        expect(ancestors).toEqual([]);
      });
    });

    describe('getHierarchyDescendants', () => {
      test('should return empty array for leaf task', () => {
        const descendants = manager.getHierarchyDescendants(grandchild1.id);
        expect(descendants).toEqual([]);
      });

      test('should return children for parent task', () => {
        const descendants = manager.getHierarchyDescendants(child1.id);
        expect(descendants).toHaveLength(2);
        expect(descendants.map(d => d.id)).toContain(grandchild1.id);
        expect(descendants.map(d => d.id)).toContain(grandchild2.id);
      });

      test('should return all descendants for root', () => {
        const descendants = manager.getHierarchyDescendants(root.id);
        expect(descendants).toHaveLength(4);
      });

      test('should return empty array for nonexistent task', () => {
        const descendants = manager.getHierarchyDescendants('nonexistent');
        expect(descendants).toEqual([]);
      });
    });

    describe('getSiblings', () => {
      test('should return empty array for root task', () => {
        const siblings = manager.getSiblings(root.id);
        expect(siblings).toEqual([]);
      });

      test('should return sibling tasks', () => {
        const siblings = manager.getSiblings(child1.id);
        expect(siblings).toHaveLength(1);
        expect(siblings[0].id).toBe(child2.id);
      });

      test('should return all siblings for grandchild', () => {
        const siblings = manager.getSiblings(grandchild1.id);
        expect(siblings).toHaveLength(1);
        expect(siblings[0].id).toBe(grandchild2.id);
      });
    });
  });

  // ============================================================
  // TASK DECOMPOSITION
  // ============================================================

  describe('Task Decomposition', () => {
    describe('decomposition.strategy', () => {
      test('should default to manual when subtask created', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        manager.createSubtask(parent.id, { title: 'Subtask' });

        const updated = manager.getTask(parent.id);
        expect(updated.decomposition.strategy).toBe('manual');
      });

      test('should accept custom strategies via setDecomposition', () => {
        const task = manager.createTask({
          title: 'Task',
          phase: 'implementation',
          backlogTier: 'now'
        });

        manager.setDecomposition(task.id, { strategy: 'parallel' });
        expect(manager.getTask(task.id).decomposition.strategy).toBe('parallel');

        manager.setDecomposition(task.id, { strategy: 'sequential' });
        expect(manager.getTask(task.id).decomposition.strategy).toBe('sequential');

        manager.setDecomposition(task.id, { strategy: 'hybrid' });
        expect(manager.getTask(task.id).decomposition.strategy).toBe('hybrid');
      });
    });

    describe('decomposition.estimatedSubtasks', () => {
      test('should be null initially', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        manager.createSubtask(parent.id, { title: 'Subtask' });

        const updated = manager.getTask(parent.id);
        expect(updated.decomposition.estimatedSubtasks).toBeNull();
      });

      test('should be settable via setDecomposition', () => {
        const task = manager.createTask({
          title: 'Task',
          phase: 'implementation',
          backlogTier: 'now'
        });

        manager.setDecomposition(task.id, { estimatedSubtasks: 5 });

        const updated = manager.getTask(task.id);
        expect(updated.decomposition.estimatedSubtasks).toBe(5);
      });
    });

    describe('decomposition.completedSubtasks', () => {
      test('should start at 0', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        manager.createSubtask(parent.id, { title: 'Subtask' });

        const updated = manager.getTask(parent.id);
        expect(updated.decomposition.completedSubtasks).toBe(0);
      });

      test('should increment when subtask is completed', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const subtask1 = manager.createSubtask(parent.id, { title: 'Subtask 1' });
        const subtask2 = manager.createSubtask(parent.id, { title: 'Subtask 2' });

        manager.updateStatus(subtask1.id, 'completed');

        const updatedParent = manager.getTask(parent.id);
        expect(updatedParent.decomposition.completedSubtasks).toBe(1);

        manager.updateStatus(subtask2.id, 'completed');

        const finalParent = manager.getTask(parent.id);
        expect(finalParent.decomposition.completedSubtasks).toBe(2);
      });
    });

    describe('decomposition.aggregationRule', () => {
      test('should default to average', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        manager.createSubtask(parent.id, { title: 'Subtask' });

        const updated = manager.getTask(parent.id);
        expect(updated.decomposition.aggregationRule).toBe('average');
      });

      test('should accept all aggregation rules', () => {
        const task = manager.createTask({
          title: 'Task',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const rules = ['average', 'all', 'any', 'weighted'];

        for (const rule of rules) {
          manager.setDecomposition(task.id, { aggregationRule: rule });
          expect(manager.getTask(task.id).decomposition.aggregationRule).toBe(rule);
        }
      });
    });
  });

  // ============================================================
  // HIERARCHY INTEGRITY
  // ============================================================

  describe('Hierarchy Integrity', () => {
    describe('Parent progress updates', () => {
      test('should update parent progress when subtask completed', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const subtask1 = manager.createSubtask(parent.id, { title: 'Subtask 1' });
        manager.createSubtask(parent.id, { title: 'Subtask 2' });

        manager.updateStatus(subtask1.id, 'completed');

        const updated = manager.getTask(parent.id);
        expect(updated.progress).toBe(50);
      });

      test('should calculate progress with average aggregation', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        manager.setDecomposition(parent.id, { aggregationRule: 'average' });

        const sub1 = manager.createSubtask(parent.id, { title: 'Sub 1' });
        const sub2 = manager.createSubtask(parent.id, { title: 'Sub 2' });
        const sub3 = manager.createSubtask(parent.id, { title: 'Sub 3' });

        manager.updateStatus(sub1.id, 'completed');
        expect(manager.getTask(parent.id).progress).toBe(33);

        manager.updateStatus(sub2.id, 'completed');
        expect(manager.getTask(parent.id).progress).toBe(66);

        manager.updateStatus(sub3.id, 'completed');
        expect(manager.getTask(parent.id).progress).toBe(100);
      });

      test('should calculate progress with all aggregation', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        manager.setDecomposition(parent.id, { aggregationRule: 'all' });

        const sub1 = manager.createSubtask(parent.id, { title: 'Sub 1' });
        const sub2 = manager.createSubtask(parent.id, { title: 'Sub 2' });

        manager.updateStatus(sub1.id, 'completed');
        expect(manager.getTask(parent.id).progress).toBe(50);

        manager.updateStatus(sub2.id, 'completed');
        expect(manager.getTask(parent.id).progress).toBe(100);
      });

      test('should calculate progress with any aggregation', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        manager.setDecomposition(parent.id, { aggregationRule: 'any' });

        const sub1 = manager.createSubtask(parent.id, { title: 'Sub 1' });
        manager.createSubtask(parent.id, { title: 'Sub 2' });

        // Before any completion
        expect(manager.getTask(parent.id).progress).toBeUndefined();

        manager.updateStatus(sub1.id, 'completed');
        expect(manager.getTask(parent.id).progress).toBe(100);
      });

      test('should emit task:hierarchy-progress event', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const events = [];
        manager.on('task:hierarchy-progress', (data) => events.push(data));

        const subtask = manager.createSubtask(parent.id, { title: 'Subtask' });
        manager.updateStatus(subtask.id, 'completed');

        expect(events).toHaveLength(1);
        expect(events[0].parent.id).toBe(parent.id);
        expect(events[0].progress).toBe(100);
        expect(events[0].completedCount).toBe(1);
      });

      test('should cascade progress updates to grandparent', () => {
        const grandparent = manager.createTask({
          title: 'Grandparent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const parent = manager.createSubtask(grandparent.id, { title: 'Parent' });
        const subtask = manager.createSubtask(parent.id, { title: 'Subtask' });

        manager.updateStatus(subtask.id, 'completed');

        const updatedGrandparent = manager.getTask(grandparent.id);
        // Grandparent has 1 child (parent), parent has 1 subtask completed
        // Parent's progress = 100, grandparent sees parent's count
        expect(updatedGrandparent.progress).toBeDefined();
      });
    });

    describe('Orphan subtask handling', () => {
      test('should detect orphan subtasks via validateHierarchy', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const subtask = manager.createSubtask(parent.id, { title: 'Subtask' });

        // Manually corrupt the data - remove parent but keep subtask reference
        delete manager.tasks.tasks[parent.id];
        manager.tasks.backlog.now.tasks = manager.tasks.backlog.now.tasks
          .filter(id => id !== parent.id);

        const validation = manager.validateHierarchy();

        expect(validation.valid).toBe(false);
        expect(validation.issues.some(i => i.type === 'orphan')).toBe(true);
      });

      test('should repair orphan subtasks', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const subtask = manager.createSubtask(parent.id, { title: 'Subtask' });

        // Manually corrupt
        delete manager.tasks.tasks[parent.id];
        manager.tasks.backlog.now.tasks = manager.tasks.backlog.now.tasks
          .filter(id => id !== parent.id);

        const repairResult = manager.repairHierarchy();

        expect(repairResult.repairsPerformed).toBeGreaterThan(0);

        const updatedSubtask = manager.getTask(subtask.id);
        expect(updatedSubtask.parentTaskId).toBeNull();
        expect(updatedSubtask.delegationDepth).toBe(0);
      });
    });

    describe('validateHierarchy', () => {
      test('should return valid for correct hierarchy', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        manager.createSubtask(parent.id, { title: 'Subtask 1' });
        manager.createSubtask(parent.id, { title: 'Subtask 2' });

        const validation = manager.validateHierarchy();

        expect(validation.valid).toBe(true);
        expect(validation.issueCount).toBe(0);
        expect(validation.issues).toEqual([]);
      });

      test('should detect missing child references', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const subtask = manager.createSubtask(parent.id, { title: 'Subtask' });

        // Corrupt: remove child from parent's childTaskIds
        manager.tasks.tasks[parent.id].childTaskIds = [];

        const validation = manager.validateHierarchy();

        expect(validation.valid).toBe(false);
        expect(validation.issues.some(i => i.type === 'missing-child-ref')).toBe(true);
      });

      test('should detect missing child tasks', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const subtask = manager.createSubtask(parent.id, { title: 'Subtask' });

        // Corrupt: delete child but keep reference
        delete manager.tasks.tasks[subtask.id];
        manager.tasks.backlog.now.tasks = manager.tasks.backlog.now.tasks
          .filter(id => id !== subtask.id);

        const validation = manager.validateHierarchy();

        expect(validation.valid).toBe(false);
        expect(validation.issues.some(i => i.type === 'missing-child')).toBe(true);
      });

      test('should detect depth mismatches', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const subtask = manager.createSubtask(parent.id, { title: 'Subtask' });

        // Corrupt depth
        manager.tasks.tasks[subtask.id].delegationDepth = 5;

        const validation = manager.validateHierarchy();

        expect(validation.valid).toBe(false);
        expect(validation.issues.some(i => i.type === 'depth-mismatch')).toBe(true);
      });

      test('should detect wrong parent references', () => {
        const parent1 = manager.createTask({
          title: 'Parent 1',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const parent2 = manager.createTask({
          title: 'Parent 2',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const subtask = manager.createSubtask(parent1.id, { title: 'Subtask' });

        // Corrupt: point subtask to different parent
        manager.tasks.tasks[subtask.id].parentTaskId = parent2.id;

        const validation = manager.validateHierarchy();

        expect(validation.valid).toBe(false);
        expect(validation.issues.some(i => i.type === 'wrong-parent-ref')).toBe(true);
      });
    });

    describe('repairHierarchy', () => {
      test('should fix missing child references', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const subtask = manager.createSubtask(parent.id, { title: 'Subtask' });

        // Corrupt
        manager.tasks.tasks[parent.id].childTaskIds = [];

        const result = manager.repairHierarchy();

        expect(result.repairsPerformed).toBeGreaterThan(0);

        const repairedParent = manager.getTask(parent.id);
        expect(repairedParent.childTaskIds).toContain(subtask.id);
      });

      test('should fix missing children', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const subtask = manager.createSubtask(parent.id, { title: 'Subtask' });

        // Corrupt: delete child but keep reference
        delete manager.tasks.tasks[subtask.id];
        manager.tasks.backlog.now.tasks = manager.tasks.backlog.now.tasks
          .filter(id => id !== subtask.id);

        const result = manager.repairHierarchy();

        expect(result.repairsPerformed).toBeGreaterThan(0);

        const repairedParent = manager.getTask(parent.id);
        expect(repairedParent.childTaskIds).not.toContain(subtask.id);
      });

      test('should fix depth mismatches', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const subtask = manager.createSubtask(parent.id, { title: 'Subtask' });

        // Corrupt depth
        manager.tasks.tasks[subtask.id].delegationDepth = 999;

        const result = manager.repairHierarchy();

        expect(result.repairsPerformed).toBeGreaterThan(0);

        const repairedSubtask = manager.getTask(subtask.id);
        expect(repairedSubtask.delegationDepth).toBe(1);
      });

      test('should save after repairs', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const subtask = manager.createSubtask(parent.id, { title: 'Subtask' });

        // Corrupt depth
        manager.tasks.tasks[subtask.id].delegationDepth = 999;

        manager.repairHierarchy();

        // Reload from disk to verify save
        const newManager = new TaskManager({
          tasksPath,
          sessionId: 'reload-session',
          useCoordination: false
        });

        const reloaded = newManager.getTask(subtask.id);
        expect(reloaded.delegationDepth).toBe(1);
      });
    });
  });

  // ============================================================
  // HIERARCHY STATISTICS
  // ============================================================

  describe('Hierarchy Statistics', () => {
    test('should return correct stats for empty task list', () => {
      const stats = manager.getHierarchyStats();

      expect(stats.rootTasks).toBe(0);
      expect(stats.parentTasks).toBe(0);
      expect(stats.childTasks).toBe(0);
      expect(stats.maxDepth).toBe(0);
      expect(stats.avgChildrenPerParent).toBe(0);
    });

    test('should count root tasks', () => {
      manager.createTask({ title: 'Root 1', phase: 'implementation', backlogTier: 'now' });
      manager.createTask({ title: 'Root 2', phase: 'implementation', backlogTier: 'now' });
      manager.createTask({ title: 'Root 3', phase: 'implementation', backlogTier: 'now' });

      const stats = manager.getHierarchyStats();

      expect(stats.rootTasks).toBe(3);
    });

    test('should count parent and child tasks', () => {
      const root = manager.createTask({
        title: 'Root',
        phase: 'implementation',
        backlogTier: 'now'
      });

      manager.createSubtask(root.id, { title: 'Child 1' });
      manager.createSubtask(root.id, { title: 'Child 2' });

      const stats = manager.getHierarchyStats();

      expect(stats.parentTasks).toBe(1);
      expect(stats.childTasks).toBe(2);
    });

    test('should calculate max depth', () => {
      const root = manager.createTask({
        title: 'Root',
        phase: 'implementation',
        backlogTier: 'now'
      });

      const level1 = manager.createSubtask(root.id, { title: 'Level 1' });
      const level2 = manager.createSubtask(level1.id, { title: 'Level 2' });
      manager.createSubtask(level2.id, { title: 'Level 3' });

      const stats = manager.getHierarchyStats();

      expect(stats.maxDepth).toBe(3);
    });

    test('should calculate average children per parent', () => {
      const root1 = manager.createTask({
        title: 'Root 1',
        phase: 'implementation',
        backlogTier: 'now'
      });

      const root2 = manager.createTask({
        title: 'Root 2',
        phase: 'implementation',
        backlogTier: 'now'
      });

      // Root 1 has 4 children
      manager.createSubtask(root1.id, { title: 'C1' });
      manager.createSubtask(root1.id, { title: 'C2' });
      manager.createSubtask(root1.id, { title: 'C3' });
      manager.createSubtask(root1.id, { title: 'C4' });

      // Root 2 has 2 children
      manager.createSubtask(root2.id, { title: 'C5' });
      manager.createSubtask(root2.id, { title: 'C6' });

      const stats = manager.getHierarchyStats();

      // (4 + 2) / 2 parents = 3
      expect(stats.avgChildrenPerParent).toBe(3);
    });
  });

  // ============================================================
  // CASCADE OPERATIONS
  // ============================================================

  describe('Cascade Operations', () => {
    describe('completeTaskWithCascade', () => {
      test('should complete task without cascade', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const subtask = manager.createSubtask(parent.id, { title: 'Subtask' });

        manager.completeTaskWithCascade(parent.id, { cascadeComplete: false });

        const updatedParent = manager.getTask(parent.id);
        const updatedSubtask = manager.getTask(subtask.id);

        expect(updatedParent.status).toBe('completed');
        expect(updatedSubtask.status).toBe('ready');
      });

      test('should complete task with cascade', () => {
        const parent = manager.createTask({
          title: 'Parent',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const subtask1 = manager.createSubtask(parent.id, { title: 'Subtask 1' });
        const subtask2 = manager.createSubtask(parent.id, { title: 'Subtask 2' });

        manager.completeTaskWithCascade(parent.id, { cascadeComplete: true });

        expect(manager.getTask(parent.id).status).toBe('completed');
        expect(manager.getTask(subtask1.id).status).toBe('completed');
        expect(manager.getTask(subtask2.id).status).toBe('completed');
      });

      test('should cascade through multiple levels', () => {
        const root = manager.createTask({
          title: 'Root',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const child = manager.createSubtask(root.id, { title: 'Child' });
        const grandchild = manager.createSubtask(child.id, { title: 'Grandchild' });

        manager.completeTaskWithCascade(root.id, { cascadeComplete: true });

        expect(manager.getTask(root.id).status).toBe('completed');
        expect(manager.getTask(child.id).status).toBe('completed');
        expect(manager.getTask(grandchild.id).status).toBe('completed');
      });
    });

    describe('deleteTaskWithDescendants', () => {
      test('should delete single task with no descendants', () => {
        const task = manager.createTask({
          title: 'Single Task',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const deletedCount = manager.deleteTaskWithDescendants(task.id);

        expect(deletedCount).toBe(1);
        expect(manager.getTask(task.id)).toBeNull();
      });

      test('should delete task and all descendants', () => {
        const root = manager.createTask({
          title: 'Root',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const child1 = manager.createSubtask(root.id, { title: 'Child 1' });
        const child2 = manager.createSubtask(root.id, { title: 'Child 2' });
        const grandchild = manager.createSubtask(child1.id, { title: 'Grandchild' });

        const deletedCount = manager.deleteTaskWithDescendants(root.id);

        expect(deletedCount).toBe(4);
        expect(manager.getTask(root.id)).toBeNull();
        expect(manager.getTask(child1.id)).toBeNull();
        expect(manager.getTask(child2.id)).toBeNull();
        expect(manager.getTask(grandchild.id)).toBeNull();
      });

      test('should return 0 for nonexistent task', () => {
        const deletedCount = manager.deleteTaskWithDescendants('nonexistent');

        expect(deletedCount).toBe(0);
      });

      test('should delete deepest nodes first', () => {
        const root = manager.createTask({
          title: 'Root',
          phase: 'implementation',
          backlogTier: 'now'
        });

        const child = manager.createSubtask(root.id, { title: 'Child' });
        const grandchild = manager.createSubtask(child.id, { title: 'Grandchild' });

        // Verify all exist before deletion
        expect(manager.getTask(root.id)).not.toBeNull();
        expect(manager.getTask(child.id)).not.toBeNull();
        expect(manager.getTask(grandchild.id)).not.toBeNull();

        manager.deleteTaskWithDescendants(root.id);

        // Verify all deleted
        expect(manager.getTask(root.id)).toBeNull();
        expect(manager.getTask(child.id)).toBeNull();
        expect(manager.getTask(grandchild.id)).toBeNull();
      });
    });
  });

  // ============================================================
  // EDGE CASES
  // ============================================================

  describe('Edge Cases', () => {
    test('should handle deeply nested hierarchies', () => {
      let current = manager.createTask({
        title: 'Root',
        phase: 'implementation',
        backlogTier: 'now'
      });

      // Create 10 levels of nesting
      for (let i = 1; i <= 10; i++) {
        current = manager.createSubtask(current.id, { title: `Level ${i}` });
        expect(current.delegationDepth).toBe(i);
      }

      const stats = manager.getHierarchyStats();
      expect(stats.maxDepth).toBe(10);

      const root = manager.getRootTask(current.id);
      expect(root.title).toBe('Root');
    });

    test('should handle task with many children', () => {
      const parent = manager.createTask({
        title: 'Parent',
        phase: 'implementation',
        backlogTier: 'now'
      });

      const childCount = 50;
      for (let i = 0; i < childCount; i++) {
        manager.createSubtask(parent.id, { title: `Child ${i}` });
      }

      const updatedParent = manager.getTask(parent.id);
      expect(updatedParent.childTaskIds).toHaveLength(childCount);

      const hierarchy = manager.getTaskHierarchy(parent.id);
      expect(hierarchy.children).toHaveLength(childCount);
    });

    test('should handle getTask returning null gracefully', () => {
      const hierarchy = manager.getTaskHierarchy('nonexistent');
      expect(hierarchy).toBeNull();

      const root = manager.getRootTask('nonexistent');
      expect(root).toBeNull();

      const ancestors = manager.getHierarchyAncestors('nonexistent');
      expect(ancestors).toEqual([]);

      const descendants = manager.getHierarchyDescendants('nonexistent');
      expect(descendants).toEqual([]);

      const siblings = manager.getSiblings('nonexistent');
      expect(siblings).toEqual([]);
    });

    test('should handle setDecomposition on nonexistent task', () => {
      const result = manager.setDecomposition('nonexistent', { strategy: 'parallel' });
      expect(result).toBeNull();
    });

    test('should handle delegateToAgent on nonexistent task', () => {
      const result = manager.delegateToAgent('nonexistent', { agentId: 'agent-1' });
      expect(result).toBeNull();
    });

    test('should handle completeTaskWithCascade on nonexistent task', () => {
      const result = manager.completeTaskWithCascade('nonexistent', { cascadeComplete: true });
      expect(result).toBeNull();
    });

    test('should persist hierarchy through save/load cycle', () => {
      const root = manager.createTask({
        title: 'Root',
        phase: 'implementation',
        backlogTier: 'now'
      });

      const child = manager.createSubtask(root.id, { title: 'Child' });
      const grandchild = manager.createSubtask(child.id, { title: 'Grandchild' });

      manager.setDecomposition(root.id, {
        strategy: 'sequential',
        estimatedSubtasks: 3
      });

      manager.delegateToAgent(child.id, { agentId: 'test-agent' });

      // Create new manager instance to reload from disk
      const newManager = new TaskManager({
        tasksPath,
        sessionId: 'new-session',
        useCoordination: false
      });

      const loadedRoot = newManager.getTask(root.id);
      const loadedChild = newManager.getTask(child.id);
      const loadedGrandchild = newManager.getTask(grandchild.id);

      expect(loadedRoot.childTaskIds).toContain(child.id);
      expect(loadedRoot.decomposition.strategy).toBe('sequential');

      expect(loadedChild.parentTaskId).toBe(root.id);
      expect(loadedChild.delegatedTo.agentId).toBe('test-agent');
      expect(loadedChild.childTaskIds).toContain(grandchild.id);

      expect(loadedGrandchild.parentTaskId).toBe(child.id);
      expect(loadedGrandchild.delegationDepth).toBe(2);
    });
  });
});
