/**
 * Tests for HierarchyRegistry
 */

const {
  HierarchyRegistry,
  HierarchyError,
  DelegationStatus,
  getHierarchyRegistry,
  resetHierarchyRegistry
} = require('../../.claude/core/hierarchy-registry');

describe('HierarchyError', () => {
  it('creates error with properties', () => {
    const error = new HierarchyError('Test error', {
      agentId: 'agent-1',
      parentId: 'parent-1',
      code: 'TEST_ERROR'
    });

    expect(error.message).toBe('Test error');
    expect(error.name).toBe('HierarchyError');
    expect(error.agentId).toBe('agent-1');
    expect(error.parentId).toBe('parent-1');
    expect(error.code).toBe('TEST_ERROR');
  });

  it('has default code', () => {
    const error = new HierarchyError('Test error');
    expect(error.code).toBe('HIERARCHY_ERROR');
  });
});

describe('DelegationStatus', () => {
  it('has expected statuses', () => {
    expect(DelegationStatus.PENDING).toBe('pending');
    expect(DelegationStatus.ACTIVE).toBe('active');
    expect(DelegationStatus.COMPLETED).toBe('completed');
    expect(DelegationStatus.FAILED).toBe('failed');
    expect(DelegationStatus.CANCELLED).toBe('cancelled');
  });
});

describe('HierarchyRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new HierarchyRegistry({ maxDepth: 3, maxChildren: 5 });
  });

  afterEach(() => {
    registry.clear();
  });

  describe('Constructor', () => {
    it('initializes with default options', () => {
      const defaultRegistry = new HierarchyRegistry();
      expect(defaultRegistry.maxDepth).toBe(3);
      expect(defaultRegistry.maxChildren).toBe(10);
    });

    it('initializes with custom options', () => {
      expect(registry.maxDepth).toBe(3);
      expect(registry.maxChildren).toBe(5);
    });

    it('initializes empty storage structures', () => {
      expect(registry.nodes.size).toBe(0);
      expect(registry.roots.size).toBe(0);
      expect(registry.delegations.size).toBe(0);
    });
  });

  describe('registerHierarchy', () => {
    it('registers root node (no parent)', () => {
      const node = registry.registerHierarchy(null, 'root-1', { agentType: 'orchestrator' });

      expect(node.agentId).toBe('root-1');
      expect(node.parentId).toBeNull();
      expect(node.depth).toBe(0);
      expect(node.status).toBe(DelegationStatus.ACTIVE);
      expect(node.metadata.agentType).toBe('orchestrator');
      expect(registry.roots.has('root-1')).toBe(true);
    });

    it('registers child node under parent', () => {
      registry.registerHierarchy(null, 'root-1');
      const child = registry.registerHierarchy('root-1', 'child-1', { taskId: 'task-123' });

      expect(child.agentId).toBe('child-1');
      expect(child.parentId).toBe('root-1');
      expect(child.depth).toBe(1);
      expect(child.metadata.taskId).toBe('task-123');
    });

    it('calculates depth correctly for nested hierarchy', () => {
      registry.registerHierarchy(null, 'root');
      registry.registerHierarchy('root', 'level1');
      registry.registerHierarchy('level1', 'level2');
      const level3 = registry.registerHierarchy('level2', 'level3');

      expect(level3.depth).toBe(3);
    });

    it('throws error for duplicate agent registration', () => {
      registry.registerHierarchy(null, 'agent-1');

      expect(() => {
        registry.registerHierarchy(null, 'agent-1');
      }).toThrow(HierarchyError);
      expect(() => {
        registry.registerHierarchy(null, 'agent-1');
      }).toThrow('already registered');
    });

    it('throws error for non-existent parent', () => {
      expect(() => {
        registry.registerHierarchy('non-existent', 'child-1');
      }).toThrow(HierarchyError);
      expect(() => {
        registry.registerHierarchy('non-existent', 'child-1');
      }).toThrow('Parent agent');
    });

    it('throws error when exceeding max depth', () => {
      registry.registerHierarchy(null, 'level0');
      registry.registerHierarchy('level0', 'level1');
      registry.registerHierarchy('level1', 'level2');
      registry.registerHierarchy('level2', 'level3');

      expect(() => {
        registry.registerHierarchy('level3', 'level4');
      }).toThrow('Maximum hierarchy depth');
    });

    it('throws error when exceeding max children', () => {
      registry.registerHierarchy(null, 'parent');

      for (let i = 0; i < 5; i++) {
        registry.registerHierarchy('parent', `child-${i}`);
      }

      expect(() => {
        registry.registerHierarchy('parent', 'child-5');
      }).toThrow('Maximum children');
    });

    it('emits hierarchy:registered event', () => {
      const handler = jest.fn();
      registry.on('hierarchy:registered', handler);

      registry.registerHierarchy(null, 'root-1');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          parentId: null,
          childId: 'root-1',
          depth: 0
        })
      );
    });

    it('updates byParent index', () => {
      registry.registerHierarchy(null, 'parent');
      registry.registerHierarchy('parent', 'child-1');
      registry.registerHierarchy('parent', 'child-2');

      const children = registry.getChildren('parent');
      expect(children).toContain('child-1');
      expect(children).toContain('child-2');
      expect(children.length).toBe(2);
    });

    it('updates byDepth index', () => {
      registry.registerHierarchy(null, 'root');
      registry.registerHierarchy('root', 'level1-a');
      registry.registerHierarchy('root', 'level1-b');
      registry.registerHierarchy('level1-a', 'level2');

      expect(registry.getByDepth(0)).toContain('root');
      expect(registry.getByDepth(1)).toContain('level1-a');
      expect(registry.getByDepth(1)).toContain('level1-b');
      expect(registry.getByDepth(2)).toContain('level2');
    });

    it('updates byStatus index', () => {
      registry.registerHierarchy(null, 'agent-1');
      registry.registerHierarchy(null, 'agent-2');

      const activeAgents = registry.getByStatus(DelegationStatus.ACTIVE);
      expect(activeAgents).toContain('agent-1');
      expect(activeAgents).toContain('agent-2');
    });
  });

  describe('Cycle Detection', () => {
    it('prevents self-referential registration', () => {
      expect(() => {
        registry.registerHierarchy('agent-1', 'agent-1');
      }).toThrow(); // Will throw because parent doesn't exist first
    });

    it('prevents cycle through ancestor chain', () => {
      registry.registerHierarchy(null, 'a');
      registry.registerHierarchy('a', 'b');
      registry.registerHierarchy('b', 'c');

      // Manually test cycle detection method
      expect(registry._wouldCreateCycle('c', 'a')).toBe(true);
      expect(registry._wouldCreateCycle('c', 'b')).toBe(true);
      expect(registry._wouldCreateCycle('c', 'd')).toBe(false);
    });
  });

  describe('registerDelegation', () => {
    it('creates delegation record', () => {
      const delegation = registry.registerDelegation('del-1', {
        parentAgentId: 'parent',
        childAgentId: 'child',
        taskId: 'task-123'
      });

      expect(delegation.delegationId).toBe('del-1');
      expect(delegation.parentAgentId).toBe('parent');
      expect(delegation.childAgentId).toBe('child');
      expect(delegation.taskId).toBe('task-123');
      expect(delegation.status).toBe(DelegationStatus.PENDING);
    });

    it('throws error for duplicate delegation', () => {
      registry.registerDelegation('del-1', {
        parentAgentId: 'parent',
        childAgentId: 'child'
      });

      expect(() => {
        registry.registerDelegation('del-1', {
          parentAgentId: 'parent2',
          childAgentId: 'child2'
        });
      }).toThrow('already exists');
    });

    it('emits delegation:registered event', () => {
      const handler = jest.fn();
      registry.on('delegation:registered', handler);

      registry.registerDelegation('del-1', { parentAgentId: 'p', childAgentId: 'c' });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ delegationId: 'del-1' })
      );
    });
  });

  describe('updateDelegationStatus', () => {
    beforeEach(() => {
      registry.registerDelegation('del-1', {
        parentAgentId: 'parent',
        childAgentId: 'child'
      });
    });

    it('updates delegation status', () => {
      const updated = registry.updateDelegationStatus('del-1', DelegationStatus.ACTIVE);

      expect(updated.status).toBe(DelegationStatus.ACTIVE);
    });

    it('sets completedAt on completion', () => {
      const updated = registry.updateDelegationStatus('del-1', DelegationStatus.COMPLETED, {
        result: { success: true }
      });

      expect(updated.completedAt).toBeDefined();
      expect(updated.result).toEqual({ success: true });
    });

    it('sets error on failure', () => {
      const updated = registry.updateDelegationStatus('del-1', DelegationStatus.FAILED, {
        error: 'Something went wrong'
      });

      expect(updated.status).toBe(DelegationStatus.FAILED);
      expect(updated.error).toBe('Something went wrong');
    });

    it('throws error for non-existent delegation', () => {
      expect(() => {
        registry.updateDelegationStatus('non-existent', DelegationStatus.ACTIVE);
      }).toThrow('not found');
    });

    it('emits delegation:updated event', () => {
      const handler = jest.fn();
      registry.on('delegation:updated', handler);

      registry.updateDelegationStatus('del-1', DelegationStatus.ACTIVE);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          delegationId: 'del-1',
          oldStatus: DelegationStatus.PENDING,
          status: DelegationStatus.ACTIVE
        })
      );
    });
  });

  describe('updateNodeStatus', () => {
    beforeEach(() => {
      registry.registerHierarchy(null, 'agent-1');
    });

    it('updates node status', () => {
      registry.updateNodeStatus('agent-1', DelegationStatus.COMPLETED);

      const node = registry.getNode('agent-1');
      expect(node.status).toBe(DelegationStatus.COMPLETED);
    });

    it('updates byStatus index', () => {
      registry.updateNodeStatus('agent-1', DelegationStatus.COMPLETED);

      expect(registry.getByStatus(DelegationStatus.ACTIVE)).not.toContain('agent-1');
      expect(registry.getByStatus(DelegationStatus.COMPLETED)).toContain('agent-1');
    });

    it('emits node:statusChanged event', () => {
      const handler = jest.fn();
      registry.on('node:statusChanged', handler);

      registry.updateNodeStatus('agent-1', DelegationStatus.COMPLETED);

      expect(handler).toHaveBeenCalledWith({
        agentId: 'agent-1',
        oldStatus: DelegationStatus.ACTIVE,
        status: DelegationStatus.COMPLETED
      });
    });

    it('handles non-existent node gracefully', () => {
      // Should not throw
      registry.updateNodeStatus('non-existent', DelegationStatus.COMPLETED);
    });
  });

  describe('getHierarchy', () => {
    beforeEach(() => {
      registry.registerHierarchy(null, 'root');
      registry.registerHierarchy('root', 'child-1');
      registry.registerHierarchy('root', 'child-2');
      registry.registerHierarchy('child-1', 'grandchild-1');
    });

    it('returns full hierarchy tree', () => {
      const tree = registry.getHierarchy('root');

      expect(tree.agentId).toBe('root');
      expect(tree.children.length).toBe(2);
      expect(tree.children[0].agentId).toBe('child-1');
      expect(tree.children[0].children.length).toBe(1);
      expect(tree.children[0].children[0].agentId).toBe('grandchild-1');
    });

    it('returns subtree from mid-level', () => {
      const subtree = registry.getHierarchy('child-1');

      expect(subtree.agentId).toBe('child-1');
      expect(subtree.depth).toBe(1);
      expect(subtree.children.length).toBe(1);
    });

    it('returns null for non-existent agent', () => {
      const result = registry.getHierarchy('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('getDelegationChain', () => {
    beforeEach(() => {
      registry.registerHierarchy(null, 'root', { delegationId: 'del-root' });
      registry.registerHierarchy('root', 'level1', { delegationId: 'del-1' });
      registry.registerHierarchy('level1', 'level2', { delegationId: 'del-2' });
    });

    it('returns chain from root to target', () => {
      const chain = registry.getDelegationChain('level2');

      expect(chain.length).toBe(3);
      expect(chain[0].agentId).toBe('root');
      expect(chain[1].agentId).toBe('level1');
      expect(chain[2].agentId).toBe('level2');
    });

    it('returns single element for root', () => {
      const chain = registry.getDelegationChain('root');

      expect(chain.length).toBe(1);
      expect(chain[0].agentId).toBe('root');
    });

    it('returns empty array for non-existent agent', () => {
      const chain = registry.getDelegationChain('non-existent');
      expect(chain.length).toBe(0);
    });

    it('includes delegation IDs in chain', () => {
      const chain = registry.getDelegationChain('level2');

      expect(chain[0].delegationId).toBe('del-root');
      expect(chain[1].delegationId).toBe('del-1');
      expect(chain[2].delegationId).toBe('del-2');
    });
  });

  describe('getAncestors', () => {
    beforeEach(() => {
      registry.registerHierarchy(null, 'root');
      registry.registerHierarchy('root', 'level1');
      registry.registerHierarchy('level1', 'level2');
    });

    it('returns all ancestors', () => {
      const ancestors = registry.getAncestors('level2');

      expect(ancestors.length).toBe(2);
      expect(ancestors[0]).toBe('level1');
      expect(ancestors[1]).toBe('root');
    });

    it('returns empty for root', () => {
      const ancestors = registry.getAncestors('root');
      expect(ancestors.length).toBe(0);
    });
  });

  describe('getDescendants', () => {
    beforeEach(() => {
      registry.registerHierarchy(null, 'root');
      registry.registerHierarchy('root', 'child-1');
      registry.registerHierarchy('root', 'child-2');
      registry.registerHierarchy('child-1', 'grandchild-1');
      registry.registerHierarchy('child-1', 'grandchild-2');
    });

    it('returns all descendants', () => {
      const descendants = registry.getDescendants('root');

      expect(descendants.length).toBe(4);
      expect(descendants).toContain('child-1');
      expect(descendants).toContain('child-2');
      expect(descendants).toContain('grandchild-1');
      expect(descendants).toContain('grandchild-2');
    });

    it('returns empty for leaf node', () => {
      const descendants = registry.getDescendants('grandchild-1');
      expect(descendants.length).toBe(0);
    });
  });

  describe('pruneHierarchy', () => {
    beforeEach(() => {
      registry.registerHierarchy(null, 'root');
      registry.registerHierarchy('root', 'child-1');
      registry.registerHierarchy('root', 'child-2');
      registry.registerHierarchy('child-1', 'grandchild');
    });

    it('removes node and all descendants', () => {
      const result = registry.pruneHierarchy('child-1');

      expect(result.pruned).toBe(true);
      expect(result.removedNodes).toContain('child-1');
      expect(result.removedNodes).toContain('grandchild');
      expect(registry.getNode('child-1')).toBeNull();
      expect(registry.getNode('grandchild')).toBeNull();
    });

    it('updates parent children list', () => {
      registry.pruneHierarchy('child-1');

      const rootNode = registry.getNode('root');
      expect(rootNode.children).not.toContain('child-1');
      expect(rootNode.children).toContain('child-2');
    });

    it('cleans up indexes', () => {
      registry.pruneHierarchy('child-1');

      expect(registry.getByDepth(1)).not.toContain('child-1');
      expect(registry.getByDepth(2)).not.toContain('grandchild');
      expect(registry.getByStatus(DelegationStatus.ACTIVE)).not.toContain('child-1');
    });

    it('emits hierarchy:pruned event', () => {
      const handler = jest.fn();
      registry.on('hierarchy:pruned', handler);

      registry.pruneHierarchy('child-1');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          rootId: 'child-1',
          removedNodes: expect.arrayContaining(['child-1', 'grandchild'])
        })
      );
    });

    it('returns false for non-existent node', () => {
      const result = registry.pruneHierarchy('non-existent');
      expect(result.pruned).toBe(false);
      expect(result.removedNodes.length).toBe(0);
    });

    it('removes root from roots set', () => {
      registry.pruneHierarchy('root');

      expect(registry.roots.has('root')).toBe(false);
      expect(registry.nodes.size).toBe(0);
    });
  });

  describe('canDelegate', () => {
    it('returns true for node within limits', () => {
      registry.registerHierarchy(null, 'root');

      const result = registry.canDelegate('root');

      expect(result.canDelegate).toBe(true);
      expect(result.remainingDepth).toBe(3);
      expect(result.remainingChildren).toBe(5);
    });

    it('returns false at max depth', () => {
      registry.registerHierarchy(null, 'level0');
      registry.registerHierarchy('level0', 'level1');
      registry.registerHierarchy('level1', 'level2');
      registry.registerHierarchy('level2', 'level3');

      const result = registry.canDelegate('level3');

      expect(result.canDelegate).toBe(false);
      expect(result.reason).toBe('Maximum depth reached');
    });

    it('returns false at max children', () => {
      registry.registerHierarchy(null, 'parent');
      for (let i = 0; i < 5; i++) {
        registry.registerHierarchy('parent', `child-${i}`);
      }

      const result = registry.canDelegate('parent');

      expect(result.canDelegate).toBe(false);
      expect(result.reason).toBe('Maximum children reached');
    });

    it('returns false for non-existent agent', () => {
      const result = registry.canDelegate('non-existent');

      expect(result.canDelegate).toBe(false);
      expect(result.reason).toBe('Agent not found in hierarchy');
    });
  });

  describe('findCommonAncestor', () => {
    beforeEach(() => {
      registry.registerHierarchy(null, 'root');
      registry.registerHierarchy('root', 'a');
      registry.registerHierarchy('root', 'b');
      registry.registerHierarchy('a', 'a1');
      registry.registerHierarchy('a', 'a2');
      registry.registerHierarchy('b', 'b1');
    });

    it('finds common ancestor', () => {
      const ancestor = registry.findCommonAncestor('a1', 'a2');
      expect(ancestor).toBe('a');
    });

    it('finds root as common ancestor for cousins', () => {
      const ancestor = registry.findCommonAncestor('a1', 'b1');
      expect(ancestor).toBe('root');
    });

    it('finds parent as common ancestor with child', () => {
      const ancestor = registry.findCommonAncestor('a', 'a1');
      expect(ancestor).toBe('a');
    });

    it('returns null for unrelated nodes', () => {
      registry.registerHierarchy(null, 'other-root');
      const ancestor = registry.findCommonAncestor('a1', 'other-root');
      expect(ancestor).toBeNull();
    });
  });

  describe('getStats', () => {
    it('returns accurate statistics', () => {
      registry.registerHierarchy(null, 'root');
      registry.registerHierarchy('root', 'child-1');
      registry.registerHierarchy('root', 'child-2');
      registry.registerDelegation('del-1', { parentAgentId: 'root', childAgentId: 'child-1' });

      const stats = registry.getStats();

      expect(stats.totalNodes).toBe(3);
      expect(stats.rootCount).toBe(1);
      expect(stats.totalDelegations).toBe(1);
      expect(stats.statusCounts[DelegationStatus.ACTIVE]).toBe(3);
      expect(stats.depthCounts[0]).toBe(1);
      expect(stats.depthCounts[1]).toBe(2);
    });
  });

  describe('getActiveDelegations', () => {
    it('returns only active and pending delegations', () => {
      registry.registerDelegation('del-1', { parentAgentId: 'p1', childAgentId: 'c1' });
      registry.registerDelegation('del-2', { parentAgentId: 'p2', childAgentId: 'c2' });
      registry.updateDelegationStatus('del-1', DelegationStatus.ACTIVE);
      registry.updateDelegationStatus('del-2', DelegationStatus.COMPLETED);

      const active = registry.getActiveDelegations();

      expect(active.length).toBe(1);
      expect(active[0].delegationId).toBe('del-1');
    });
  });

  describe('clear', () => {
    it('clears all data', () => {
      registry.registerHierarchy(null, 'root');
      registry.registerDelegation('del-1', { parentAgentId: 'root', childAgentId: 'child' });

      registry.clear();

      expect(registry.nodes.size).toBe(0);
      expect(registry.roots.size).toBe(0);
      expect(registry.delegations.size).toBe(0);
    });

    it('emits registry:cleared event', () => {
      const handler = jest.fn();
      registry.on('registry:cleared', handler);

      registry.clear();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('exportState / importState', () => {
    it('exports and imports state correctly', () => {
      registry.registerHierarchy(null, 'root');
      registry.registerHierarchy('root', 'child');
      registry.registerDelegation('del-1', { parentAgentId: 'root', childAgentId: 'child' });

      const exported = registry.exportState();

      registry.clear();
      expect(registry.nodes.size).toBe(0);

      registry.importState(exported);

      expect(registry.nodes.size).toBe(2);
      expect(registry.getNode('root')).toBeDefined();
      expect(registry.getNode('child')).toBeDefined();
      expect(registry.getDelegation('del-1')).toBeDefined();
    });

    it('rebuilds indexes on import', () => {
      registry.registerHierarchy(null, 'root');
      registry.registerHierarchy('root', 'child');

      const exported = registry.exportState();
      registry.clear();
      registry.importState(exported);

      expect(registry.getByDepth(0)).toContain('root');
      expect(registry.getByDepth(1)).toContain('child');
      expect(registry.getChildren('root')).toContain('child');
    });
  });
});

describe('Singleton Pattern', () => {
  afterEach(() => {
    resetHierarchyRegistry();
  });

  it('returns same instance', () => {
    const instance1 = getHierarchyRegistry();
    const instance2 = getHierarchyRegistry();

    expect(instance1).toBe(instance2);
  });

  it('uses options only on first call', () => {
    const instance1 = getHierarchyRegistry({ maxDepth: 5 });
    const instance2 = getHierarchyRegistry({ maxDepth: 10 });

    expect(instance1.maxDepth).toBe(5);
    expect(instance2.maxDepth).toBe(5);
  });

  it('resetHierarchyRegistry creates new instance', () => {
    const instance1 = getHierarchyRegistry();
    instance1.registerHierarchy(null, 'test');

    resetHierarchyRegistry();

    const instance2 = getHierarchyRegistry();
    expect(instance2.nodes.size).toBe(0);
    expect(instance1).not.toBe(instance2);
  });
});

describe('Event Emitter', () => {
  let registry;

  beforeEach(() => {
    registry = new HierarchyRegistry();
  });

  afterEach(() => {
    registry.clear();
    registry.removeAllListeners();
  });

  it('supports multiple event listeners', () => {
    const handler1 = jest.fn();
    const handler2 = jest.fn();

    registry.on('hierarchy:registered', handler1);
    registry.on('hierarchy:registered', handler2);

    registry.registerHierarchy(null, 'test');

    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it('supports once listeners', () => {
    const handler = jest.fn();
    registry.once('hierarchy:registered', handler);

    registry.registerHierarchy(null, 'test1');
    registry.registerHierarchy(null, 'test2');

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
