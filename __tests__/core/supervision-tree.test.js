/**
 * Tests for SupervisionTree and HierarchicalError
 */

const {
  SupervisionTree,
  HierarchicalError,
  RestartStrategy
} = require('../../.claude/core/supervision-tree');

describe('HierarchicalError', () => {
  describe('Constructor', () => {
    it('creates error with basic properties', () => {
      const error = new HierarchicalError('Test error', {
        agentId: 'agent-1',
        parentId: 'parent-1'
      });

      expect(error.message).toBe('Test error');
      expect(error.name).toBe('HierarchicalError');
      expect(error.agentId).toBe('agent-1');
      expect(error.parentId).toBe('parent-1');
      expect(error.recoverable).toBe(true);
      expect(error.timestamp).toBeDefined();
    });

    it('stores partial results', () => {
      const partialResults = { data: [1, 2, 3], progress: 0.5 };
      const error = new HierarchicalError('Failed mid-execution', {
        agentId: 'agent-1',
        partialResults
      });

      expect(error.partialResults).toEqual(partialResults);
    });

    it('builds error chain from child errors', () => {
      const childError1 = new HierarchicalError('Child 1 failed', {
        agentId: 'child-1'
      });
      const childError2 = new HierarchicalError('Child 2 failed', {
        agentId: 'child-2'
      });

      const parentError = new HierarchicalError('Parent failed', {
        agentId: 'parent-1',
        childErrors: [childError1, childError2]
      });

      expect(parentError.errorChain.length).toBe(3);
      expect(parentError.errorChain[0].agentId).toBe('parent-1');
      expect(parentError.errorChain[1].agentId).toBe('child-1');
      expect(parentError.errorChain[2].agentId).toBe('child-2');
    });
  });

  describe('getAllPartialResults', () => {
    it('aggregates partial results from hierarchy', () => {
      const childError = new HierarchicalError('Child failed', {
        agentId: 'child-1',
        partialResults: { childData: 'data1' }
      });

      const parentError = new HierarchicalError('Parent failed', {
        agentId: 'parent-1',
        partialResults: { parentData: 'data2' },
        childErrors: [childError]
      });

      const results = parentError.getAllPartialResults();

      expect(results['parent-1']).toEqual({ parentData: 'data2' });
      expect(results['child-1']).toEqual({ childData: 'data1' });
    });
  });

  describe('isPartiallyRecoverable', () => {
    it('returns true if any error is recoverable', () => {
      const childError = new HierarchicalError('Child failed', {
        agentId: 'child-1',
        recoverable: true
      });

      const parentError = new HierarchicalError('Parent failed', {
        agentId: 'parent-1',
        recoverable: false,
        childErrors: [childError]
      });

      expect(parentError.isPartiallyRecoverable()).toBe(true);
    });

    it('returns false if all errors are unrecoverable', () => {
      const error = new HierarchicalError('Failed', {
        agentId: 'agent-1',
        recoverable: false
      });

      expect(error.isPartiallyRecoverable()).toBe(false);
    });
  });

  describe('toSummary', () => {
    it('creates summary object', () => {
      const error = new HierarchicalError('Test error', {
        agentId: 'agent-1',
        parentId: 'parent-1',
        childErrors: [new Error('child')],
        partialResults: { data: 1 }
      });

      const summary = error.toSummary();

      expect(summary.agentId).toBe('agent-1');
      expect(summary.parentId).toBe('parent-1');
      expect(summary.childErrorCount).toBe(1);
      expect(summary.hasPartialResults).toBe(true);
    });
  });
});

describe('SupervisionTree', () => {
  let tree;

  beforeEach(() => {
    tree = new SupervisionTree({
      strategy: RestartStrategy.ONE_FOR_ONE,
      maxRestarts: 3,
      restartWindow: 60000,
      maxDepth: 3
    });
  });

  afterEach(() => {
    tree.clear();
  });

  describe('Constructor', () => {
    it('creates with default options', () => {
      const defaultTree = new SupervisionTree();
      expect(defaultTree.strategy).toBe(RestartStrategy.ONE_FOR_ONE);
      expect(defaultTree.maxRestarts).toBe(3);
      expect(defaultTree.maxDepth).toBe(3);
    });

    it('accepts custom options', () => {
      const customTree = new SupervisionTree({
        strategy: RestartStrategy.ALL_FOR_ONE,
        maxRestarts: 5,
        maxDepth: 4
      });

      expect(customTree.strategy).toBe(RestartStrategy.ALL_FOR_ONE);
      expect(customTree.maxRestarts).toBe(5);
      expect(customTree.maxDepth).toBe(4);
    });
  });

  describe('register', () => {
    it('registers root agent', () => {
      const node = tree.register('agent-1');

      expect(node.agentId).toBe('agent-1');
      expect(node.parentId).toBeNull();
      expect(node.depth).toBe(0);
      expect(node.status).toBe('active');
      expect(tree.roots.has('agent-1')).toBe(true);
    });

    it('registers child agent with parent', () => {
      tree.register('parent-1');
      const child = tree.register('child-1', { parentId: 'parent-1' });

      expect(child.parentId).toBe('parent-1');
      expect(child.depth).toBe(1);

      const parent = tree.nodes.get('parent-1');
      expect(parent.children).toContain('child-1');
    });

    it('throws when exceeding max depth', () => {
      tree.register('level-0');
      tree.register('level-1', { parentId: 'level-0' });
      tree.register('level-2', { parentId: 'level-1' });
      tree.register('level-3', { parentId: 'level-2' });

      expect(() => {
        tree.register('level-4', { parentId: 'level-3' });
      }).toThrow(/Maximum hierarchy depth/);
    });

    it('throws when parent does not exist', () => {
      expect(() => {
        tree.register('child-1', { parentId: 'nonexistent' });
      }).toThrow(/not registered/);
    });

    it('accepts custom restart policy', () => {
      const node = tree.register('agent-1', {
        restartPolicy: RestartStrategy.ALL_FOR_ONE
      });

      expect(node.restartPolicy).toBe(RestartStrategy.ALL_FOR_ONE);
    });
  });

  describe('unregister', () => {
    it('unregisters agent and cleans up', () => {
      tree.register('agent-1');
      tree.unregister('agent-1');

      expect(tree.nodes.has('agent-1')).toBe(false);
      expect(tree.roots.has('agent-1')).toBe(false);
    });

    it('unregisters children by default', () => {
      tree.register('parent-1');
      tree.register('child-1', { parentId: 'parent-1' });
      tree.register('child-2', { parentId: 'parent-1' });

      tree.unregister('parent-1');

      expect(tree.nodes.has('parent-1')).toBe(false);
      expect(tree.nodes.has('child-1')).toBe(false);
      expect(tree.nodes.has('child-2')).toBe(false);
    });

    it('updates parent children list when child unregistered', () => {
      tree.register('parent-1');
      tree.register('child-1', { parentId: 'parent-1' });
      tree.register('child-2', { parentId: 'parent-1' });

      tree.unregister('child-1', { cleanupChildren: false });

      const parent = tree.nodes.get('parent-1');
      expect(parent.children).not.toContain('child-1');
      expect(parent.children).toContain('child-2');
    });
  });

  describe('handleFailure', () => {
    it('handles failure with one-for-one strategy', async () => {
      let restartCalled = false;

      tree.register('agent-1', {
        onRestart: () => { restartCalled = true; }
      });

      const result = await tree.handleFailure('agent-1', new Error('Test error'));

      expect(result.handled).toBe(true);
      expect(result.action).toBe('restarted');
      expect(restartCalled).toBe(true);
    });

    it('saves checkpoint when partial results provided', async () => {
      tree.register('agent-1', { onRestart: () => {} });

      const partialResults = { progress: 0.7, items: [1, 2, 3] };
      await tree.handleFailure('agent-1', new Error('Test'), {
        partialResults
      });

      const checkpoint = tree.getCheckpoint('agent-1');
      expect(checkpoint).toEqual(partialResults);
    });

    it('escalates after max restarts exceeded', async () => {
      tree.maxRestarts = 2;
      tree.restartWindow = 60000;

      tree.register('agent-1', { onRestart: () => {} });

      // Simulate multiple failures
      await tree.handleFailure('agent-1', new Error('Error 1'));
      await tree.handleFailure('agent-1', new Error('Error 2'));

      // This should exceed max restarts
      const result = await tree.handleFailure('agent-1', new Error('Error 3'));

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('max-restarts-exceeded');
    });

    it('handles unknown agent gracefully', async () => {
      const result = await tree.handleFailure('unknown', new Error('Test'));

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('unknown-agent');
    });
  });

  describe('handleFailure with all-for-one strategy', () => {
    it('restarts all siblings', async () => {
      const restartedAgents = [];

      tree.register('parent-1');
      tree.register('child-1', {
        parentId: 'parent-1',
        restartPolicy: RestartStrategy.ALL_FOR_ONE,
        onRestart: (id) => restartedAgents.push(id)
      });
      tree.register('child-2', {
        parentId: 'parent-1',
        onRestart: (id) => restartedAgents.push(id)
      });
      tree.register('child-3', {
        parentId: 'parent-1',
        onRestart: (id) => restartedAgents.push(id)
      });

      const result = await tree.handleFailure('child-1', new Error('Test'));

      expect(result.handled).toBe(true);
      expect(result.action).toBe('all-restarted');
      expect(restartedAgents).toContain('child-1');
      expect(restartedAgents).toContain('child-2');
      expect(restartedAgents).toContain('child-3');
    });
  });

  describe('handleFailure with rest-for-one strategy', () => {
    it('restarts failed agent and those started after', async () => {
      const restartedAgents = [];

      tree.register('parent-1');
      tree.register('child-1', {
        parentId: 'parent-1',
        onRestart: (id) => restartedAgents.push(id)
      });
      tree.register('child-2', {
        parentId: 'parent-1',
        restartPolicy: RestartStrategy.REST_FOR_ONE,
        onRestart: (id) => restartedAgents.push(id)
      });
      tree.register('child-3', {
        parentId: 'parent-1',
        onRestart: (id) => restartedAgents.push(id)
      });

      const result = await tree.handleFailure('child-2', new Error('Test'));

      expect(result.handled).toBe(true);
      expect(result.action).toBe('rest-restarted');
      expect(restartedAgents).not.toContain('child-1'); // Started before
      expect(restartedAgents).toContain('child-2');
      expect(restartedAgents).toContain('child-3');
    });
  });

  describe('terminate', () => {
    it('terminates agent and children', async () => {
      const terminated = [];

      tree.register('parent-1', {
        onTerminate: (id) => terminated.push(id)
      });
      tree.register('child-1', {
        parentId: 'parent-1',
        onTerminate: (id) => terminated.push(id)
      });
      tree.register('child-2', {
        parentId: 'parent-1',
        onTerminate: (id) => terminated.push(id)
      });

      await tree.terminate('parent-1');

      expect(terminated).toContain('parent-1');
      expect(terminated).toContain('child-1');
      expect(terminated).toContain('child-2');

      const parent = tree.nodes.get('parent-1');
      expect(parent.status).toBe('terminated');
    });
  });

  describe('detectOrphans', () => {
    it('detects orphaned agents', async () => {
      tree.register('parent-1');
      tree.register('child-1', { parentId: 'parent-1' });
      tree.register('child-2', { parentId: 'parent-1' });

      // Terminate parent without cascade
      const parent = tree.nodes.get('parent-1');
      parent.status = 'terminated';

      const orphans = tree.detectOrphans();

      expect(orphans).toContain('child-1');
      expect(orphans).toContain('child-2');
    });
  });

  describe('cleanupOrphans', () => {
    it('cleans up orphaned agents', async () => {
      tree.register('parent-1');
      tree.register('child-1', { parentId: 'parent-1' });

      const parent = tree.nodes.get('parent-1');
      parent.status = 'failed';

      const count = await tree.cleanupOrphans();

      expect(count).toBe(1);
      expect(tree.nodes.has('child-1')).toBe(false);
    });
  });

  describe('getHierarchy', () => {
    it('returns hierarchy tree', () => {
      tree.register('root');
      tree.register('child-1', { parentId: 'root' });
      tree.register('child-2', { parentId: 'root' });
      tree.register('grandchild-1', { parentId: 'child-1' });

      const hierarchy = tree.getHierarchy('root');

      expect(hierarchy.agentId).toBe('root');
      expect(hierarchy.children.length).toBe(2);
      expect(hierarchy.children[0].agentId).toBe('child-1');
      expect(hierarchy.children[0].children.length).toBe(1);
      expect(hierarchy.children[0].children[0].agentId).toBe('grandchild-1');
    });

    it('returns null for unknown agent', () => {
      expect(tree.getHierarchy('unknown')).toBeNull();
    });
  });

  describe('getAgentsAtDepth', () => {
    it('returns agents at specified depth', () => {
      tree.register('root');
      tree.register('child-1', { parentId: 'root' });
      tree.register('child-2', { parentId: 'root' });
      tree.register('grandchild-1', { parentId: 'child-1' });

      expect(tree.getAgentsAtDepth(0)).toEqual(['root']);
      expect(tree.getAgentsAtDepth(1).sort()).toEqual(['child-1', 'child-2']);
      expect(tree.getAgentsAtDepth(2)).toEqual(['grandchild-1']);
    });
  });

  describe('checkpoints', () => {
    it('saves and retrieves checkpoints', () => {
      tree.register('agent-1');

      tree.saveCheckpoint('agent-1', { data: 'test', progress: 0.5 });

      const checkpoint = tree.getCheckpoint('agent-1');
      expect(checkpoint).toEqual({ data: 'test', progress: 0.5 });
    });

    it('returns null for missing checkpoint', () => {
      expect(tree.getCheckpoint('unknown')).toBeNull();
    });
  });

  describe('getStats', () => {
    it('returns statistics', () => {
      tree.register('root');
      tree.register('child-1', { parentId: 'root' });
      tree.nodes.get('child-1').status = 'failed';

      tree.saveCheckpoint('root', { data: 'test' });

      const stats = tree.getStats();

      expect(stats.totalNodes).toBe(2);
      expect(stats.rootCount).toBe(1);
      expect(stats.maxDepth).toBe(1);
      expect(stats.statusCounts.active).toBe(1);
      expect(stats.statusCounts.failed).toBe(1);
      expect(stats.checkpointCount).toBe(1);
    });
  });

  describe('Events', () => {
    it('emits node:registered event', (done) => {
      tree.on('node:registered', (data) => {
        expect(data.agentId).toBe('agent-1');
        done();
      });

      tree.register('agent-1');
    });

    it('emits node:unregistered event', (done) => {
      tree.register('agent-1');

      tree.on('node:unregistered', (data) => {
        expect(data.agentId).toBe('agent-1');
        done();
      });

      tree.unregister('agent-1');
    });

    it('emits failure:handled event', async () => {
      const events = [];
      tree.on('failure:handled', (data) => events.push(data));

      tree.register('agent-1', { onRestart: () => {} });
      await tree.handleFailure('agent-1', new Error('Test'));

      expect(events.length).toBe(1);
      expect(events[0].agentId).toBe('agent-1');
    });
  });
});
