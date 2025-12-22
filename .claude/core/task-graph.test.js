/**
 * Tests for Task Dependency Graph Generator
 */

const TaskGraph = require('./task-graph');

// Mock TaskManager
class MockTaskManager {
  constructor(tasks = []) {
    this.tasks = tasks;
  }

  getAllTasks() {
    return this.tasks;
  }
}

describe('TaskGraph', () => {
  describe('generateGraphData', () => {
    it('should generate nodes from tasks', () => {
      const tasks = [
        { id: 'task-1', title: 'Task 1', status: 'ready', priority: 'high', phase: 'research' },
        { id: 'task-2', title: 'Task 2', status: 'blocked', priority: 'medium', phase: 'design' },
      ];

      const graph = new TaskGraph(new MockTaskManager(tasks));
      const data = graph.generateGraphData();

      expect(data.nodes).toHaveLength(2);
      expect(data.nodes[0].id).toBe('task-1');
      expect(data.nodes[1].id).toBe('task-2');
    });

    it('should generate links from requires dependencies', () => {
      const tasks = [
        { id: 'task-1', title: 'Task 1', status: 'completed', depends: { blocks: ['task-2'] } },
        { id: 'task-2', title: 'Task 2', status: 'ready', depends: { requires: ['task-1'] } },
      ];

      const graph = new TaskGraph(new MockTaskManager(tasks));
      const data = graph.generateGraphData();

      expect(data.links.length).toBeGreaterThan(0);
      const requiresLink = data.links.find(l => l.type === 'requires');
      expect(requiresLink).toBeDefined();
      expect(requiresLink.source).toBe('task-1');
      expect(requiresLink.target).toBe('task-2');
    });

    it('should generate links from blocks dependencies', () => {
      const tasks = [
        { id: 'task-1', title: 'Task 1', status: 'in_progress', depends: { blocks: ['task-2'] } },
        { id: 'task-2', title: 'Task 2', status: 'blocked' },
      ];

      const graph = new TaskGraph(new MockTaskManager(tasks));
      const data = graph.generateGraphData();

      const blocksLink = data.links.find(l => l.type === 'blocks');
      expect(blocksLink).toBeDefined();
      expect(blocksLink.source).toBe('task-1');
      expect(blocksLink.target).toBe('task-2');
    });

    it('should handle related links without duplicates', () => {
      const tasks = [
        { id: 'task-1', title: 'Task 1', depends: { related: ['task-2'] } },
        { id: 'task-2', title: 'Task 2', depends: { related: ['task-1'] } },
      ];

      const graph = new TaskGraph(new MockTaskManager(tasks));
      const data = graph.generateGraphData();

      const relatedLinks = data.links.filter(l => l.type === 'related');
      expect(relatedLinks).toHaveLength(1);
    });

    it('should set node colors based on status', () => {
      const tasks = [
        { id: 'task-1', status: 'completed' },
        { id: 'task-2', status: 'blocked' },
        { id: 'task-3', status: 'ready' },
        { id: 'task-4', status: 'in_progress' },
      ];

      const graph = new TaskGraph(new MockTaskManager(tasks));
      const data = graph.generateGraphData();

      expect(data.nodes[0].color).toBe('#22c55e'); // Green
      expect(data.nodes[1].color).toBe('#ef4444'); // Red
      expect(data.nodes[2].color).toBe('#f59e0b'); // Amber
      expect(data.nodes[3].color).toBe('#3b82f6'); // Blue
    });

    it('should set node radius based on priority', () => {
      const tasks = [
        { id: 'task-1', priority: 'high' },
        { id: 'task-2', priority: 'medium' },
        { id: 'task-3', priority: 'low' },
      ];

      const graph = new TaskGraph(new MockTaskManager(tasks));
      const data = graph.generateGraphData();

      expect(data.nodes[0].radius).toBe(20);
      expect(data.nodes[1].radius).toBe(15);
      expect(data.nodes[2].radius).toBe(10);
    });
  });

  describe('generateTreeData', () => {
    it('should create tree with root tasks', () => {
      const tasks = [
        { id: 'task-1', title: 'Root Task' },
        { id: 'task-2', title: 'Child Task', depends: { requires: ['task-1'] } },
      ];

      const graph = new TaskGraph(new MockTaskManager(tasks));
      const tree = graph.generateTreeData();

      expect(tree.id).toBe('root');
      expect(tree.children).toHaveLength(1);
      expect(tree.children[0].id).toBe('task-1');
    });
  });

  describe('getStatistics', () => {
    it('should return correct statistics', () => {
      const tasks = [
        { id: 'task-1', status: 'completed', phase: 'research', depends: { blocks: ['task-2'] } },
        { id: 'task-2', status: 'ready', phase: 'design', depends: { requires: ['task-1'] } },
        { id: 'task-3', status: 'blocked', phase: 'design' },
      ];

      const graph = new TaskGraph(new MockTaskManager(tasks));
      const stats = graph.getStatistics();

      expect(stats.totalNodes).toBe(3);
      expect(stats.statusCounts.completed).toBe(1);
      expect(stats.statusCounts.ready).toBe(1);
      expect(stats.statusCounts.blocked).toBe(1);
      expect(stats.phaseCounts.research).toBe(1);
      expect(stats.phaseCounts.design).toBe(2);
    });

    it('should find critical path', () => {
      const tasks = [
        { id: 'task-1', title: 'Start', depends: { blocks: ['task-2'] } },
        { id: 'task-2', title: 'Middle', depends: { requires: ['task-1'], blocks: ['task-3'] } },
        { id: 'task-3', title: 'End', depends: { requires: ['task-2'] } },
      ];

      const graph = new TaskGraph(new MockTaskManager(tasks));
      const stats = graph.getStatistics();

      expect(stats.criticalPath).toHaveLength(3);
      expect(stats.criticalPath).toContain('Start');
      expect(stats.criticalPath).toContain('Middle');
      expect(stats.criticalPath).toContain('End');
    });
  });

  describe('toDOT', () => {
    it('should generate valid DOT format', () => {
      const tasks = [
        { id: 'task-1', title: 'Task 1', status: 'completed' },
        { id: 'task-2', title: 'Task 2', status: 'ready', depends: { requires: ['task-1'] } },
      ];

      const graph = new TaskGraph(new MockTaskManager(tasks));
      const dot = graph.toDOT();

      expect(dot).toContain('digraph TaskGraph');
      expect(dot).toContain('"task-1"');
      expect(dot).toContain('"task-2"');
      expect(dot).toContain('->');
    });
  });

  describe('edge cases', () => {
    it('should handle empty task list', () => {
      const graph = new TaskGraph(new MockTaskManager([]));
      const data = graph.generateGraphData();

      expect(data.nodes).toHaveLength(0);
      expect(data.links).toHaveLength(0);
    });

    it('should handle missing dependency targets', () => {
      const tasks = [
        { id: 'task-1', depends: { requires: ['non-existent'] } },
      ];

      const graph = new TaskGraph(new MockTaskManager(tasks));
      const data = graph.generateGraphData();

      expect(data.nodes).toHaveLength(1);
      expect(data.links).toHaveLength(0); // Link should be skipped
    });

    it('should handle tasks without depends property', () => {
      const tasks = [
        { id: 'task-1', title: 'Standalone Task' },
      ];

      const graph = new TaskGraph(new MockTaskManager(tasks));
      const data = graph.generateGraphData();

      expect(data.nodes).toHaveLength(1);
      expect(data.links).toHaveLength(0);
    });
  });
});
