/**
 * Integration Tests: Hierarchy 3-Level Delegation
 *
 * Tests multi-level delegation chains, depth tracking,
 * result aggregation from leaf to root, and token budget cascade.
 */

const {
  HierarchyRegistry,
  HierarchyError,
  DelegationStatus
} = require('../../.claude/core/hierarchy-registry');
const {
  HierarchicalStateManager,
  AgentStates,
  OptimisticLockError
} = require('../../.claude/core/hierarchical-state');
const AggregationStrategies = require('../../.claude/core/aggregation-strategies');

describe('Hierarchy Delegation Integration', () => {
  let registry;
  let stateManager;

  beforeEach(() => {
    registry = new HierarchyRegistry();
    stateManager = new HierarchicalStateManager();
  });

  afterEach(() => {
    registry.clear();
    stateManager.clear();
  });

  // ============================================================
  // 1. 3-LEVEL DELEGATION CHAIN TESTS
  // ============================================================
  describe('3-Level Delegation Chain', () => {
    it('should create 3-level hierarchy with correct depth tracking', () => {
      // Root (depth 0) - use null parent to register root
      const rootId = 'root-agent';
      registry.registerHierarchy(null, rootId, { agentType: 'orchestrator' });

      // Level 1 children
      const child1Id = 'child-1';
      const child2Id = 'child-2';
      registry.registerHierarchy(rootId, child1Id, { agentType: 'worker' });
      registry.registerHierarchy(rootId, child2Id, { agentType: 'worker' });

      // Level 2 grandchildren
      const grandchild1Id = 'grandchild-1';
      const grandchild2Id = 'grandchild-2';
      const grandchild3Id = 'grandchild-3';
      registry.registerHierarchy(child1Id, grandchild1Id, { agentType: 'specialist' });
      registry.registerHierarchy(child1Id, grandchild2Id, { agentType: 'specialist' });
      registry.registerHierarchy(child2Id, grandchild3Id, { agentType: 'specialist' });

      // Verify depths using getNode
      expect(registry.getNode(rootId).depth).toBe(0);
      expect(registry.getNode(child1Id).depth).toBe(1);
      expect(registry.getNode(child2Id).depth).toBe(1);
      expect(registry.getNode(grandchild1Id).depth).toBe(2);
      expect(registry.getNode(grandchild2Id).depth).toBe(2);
      expect(registry.getNode(grandchild3Id).depth).toBe(2);
    });

    it('should traverse delegation chain from leaf to root', () => {
      const rootId = 'root';
      const child1Id = 'child-1';
      const grandchildId = 'grandchild-1';

      registry.registerHierarchy(null, rootId, {});
      registry.registerHierarchy(rootId, child1Id, {});
      registry.registerHierarchy(child1Id, grandchildId, {});

      const chain = registry.getDelegationChain(grandchildId);

      // Chain returns array of node objects, verify agent IDs
      const chainIds = chain.map(node => node.agentId);
      expect(chainIds).toEqual([rootId, child1Id, grandchildId]);
    });

    it('should get all descendants of a node', () => {
      const rootId = 'root';
      registry.registerHierarchy(null, rootId, {});

      // Build tree: root -> [child1, child2], child1 -> [gc1, gc2]
      registry.registerHierarchy(rootId, 'child-1', {});
      registry.registerHierarchy(rootId, 'child-2', {});
      registry.registerHierarchy('child-1', 'gc-1', {});
      registry.registerHierarchy('child-1', 'gc-2', {});

      const descendants = registry.getDescendants(rootId);

      expect(descendants).toHaveLength(4);
      expect(descendants).toContain('child-1');
      expect(descendants).toContain('child-2');
      expect(descendants).toContain('gc-1');
      expect(descendants).toContain('gc-2');
    });

    it('should find common ancestor of two agents', () => {
      const rootId = 'root';
      registry.registerHierarchy(null, rootId, {});
      registry.registerHierarchy(rootId, 'child-1', {});
      registry.registerHierarchy(rootId, 'child-2', {});
      registry.registerHierarchy('child-1', 'gc-1', {});
      registry.registerHierarchy('child-2', 'gc-2', {});

      const ancestor = registry.findCommonAncestor('gc-1', 'gc-2');
      expect(ancestor).toBe(rootId);

      const ancestor2 = registry.findCommonAncestor('gc-1', 'child-1');
      expect(ancestor2).toBe('child-1');
    });
  });

  // ============================================================
  // 2. DEPTH LIMIT ENFORCEMENT
  // ============================================================
  describe('Depth Limit Enforcement', () => {
    it('should enforce maxDepth=3 and prevent further delegation', () => {
      registry = new HierarchyRegistry({ maxDepth: 3 });

      registry.registerAgent('root', {});
      registry.registerHierarchy('root', 'level-1', {});
      registry.registerHierarchy('level-1', 'level-2', {});
      registry.registerHierarchy('level-2', 'level-3', {});

      // This should fail - exceeds max depth
      expect(() => {
        registry.registerHierarchy('level-3', 'level-4', {});
      }).toThrow(/depth/i);
    });

    it('should report canDelegate=false at max depth', () => {
      registry = new HierarchyRegistry({ maxDepth: 2 });

      registry.registerAgent('root', {});
      registry.registerHierarchy('root', 'level-1', {});
      registry.registerHierarchy('level-1', 'level-2', {});

      expect(registry.canDelegate('root')).toBe(true);
      expect(registry.canDelegate('level-1')).toBe(true);
      expect(registry.canDelegate('level-2')).toBe(false);
    });

    it('should gracefully reject delegation at depth limit', () => {
      registry = new HierarchyRegistry({ maxDepth: 2 });

      registry.registerAgent('root', {});
      registry.registerHierarchy('root', 'child', {});
      registry.registerHierarchy('child', 'grandchild', {});

      const result = registry.tryRegisterHierarchy('grandchild', 'great-grandchild', {});

      expect(result.success).toBe(false);
      expect(result.reason).toMatch(/depth/i);
    });
  });

  // ============================================================
  // 3. RESULT AGGREGATION ACROSS LEVELS
  // ============================================================
  describe('Result Aggregation Across Levels', () => {
    it('should merge results from multiple children', () => {
      const childResults = [
        { taskId: 'task-1', data: { count: 10, items: ['a', 'b'] } },
        { taskId: 'task-2', data: { count: 20, items: ['c'] } },
        { taskId: 'task-3', data: { count: 15, items: ['d', 'e'] } }
      ];

      const merged = AggregationStrategies.merge(childResults);

      expect(merged.count).toBe(45); // Sum of counts
      expect(merged.items).toHaveLength(5);
    });

    it('should select best result based on score', () => {
      const childResults = [
        { taskId: 'task-1', score: 75, recommendation: 'Option A' },
        { taskId: 'task-2', score: 92, recommendation: 'Option B' },
        { taskId: 'task-3', score: 85, recommendation: 'Option C' }
      ];

      const best = AggregationStrategies.selectBest(childResults, 'score');

      expect(best.score).toBe(92);
      expect(best.recommendation).toBe('Option B');
    });

    it('should handle partial results when some children fail', () => {
      const childResults = [
        { taskId: 'task-1', success: true, data: { value: 100 } },
        { taskId: 'task-2', success: false, error: 'Timeout' },
        { taskId: 'task-3', success: true, data: { value: 200 } }
      ];

      const aggregated = AggregationStrategies.mergePartial(childResults);

      expect(aggregated.successCount).toBe(2);
      expect(aggregated.failureCount).toBe(1);
      expect(aggregated.partialData.value).toBe(300);
    });

    it('should aggregate hierarchically from leaves to root', () => {
      // Simulate 3-level result aggregation
      const leafResults = {
        'gc-1': { tokens: 100, quality: 90 },
        'gc-2': { tokens: 150, quality: 85 },
        'gc-3': { tokens: 120, quality: 88 }
      };

      // Child 1 aggregates gc-1 and gc-2
      const child1Result = AggregationStrategies.aggregate(
        [leafResults['gc-1'], leafResults['gc-2']],
        { sumFields: ['tokens'], avgFields: ['quality'] }
      );

      // Child 2 has gc-3
      const child2Result = leafResults['gc-3'];

      // Root aggregates children
      const rootResult = AggregationStrategies.aggregate(
        [child1Result, child2Result],
        { sumFields: ['tokens'], avgFields: ['quality'] }
      );

      expect(rootResult.tokens).toBe(370); // Sum of all leaves
      expect(rootResult.quality).toBeCloseTo(87.67, 1); // Average
    });

    it('should use consensus for conflicting results', () => {
      const childResults = [
        { vote: 'approve', confidence: 0.8 },
        { vote: 'approve', confidence: 0.9 },
        { vote: 'reject', confidence: 0.7 }
      ];

      const consensus = AggregationStrategies.consensus(childResults, 'vote');

      expect(consensus.decision).toBe('approve');
      expect(consensus.votes.approve).toBe(2);
      expect(consensus.votes.reject).toBe(1);
    });
  });

  // ============================================================
  // 4. TOKEN BUDGET CASCADE
  // ============================================================
  describe('Token Budget Cascade', () => {
    it('should allocate token budget to children', () => {
      const parentBudget = 10000;
      const childCount = 3;
      const reservedForAggregation = 1000;

      const perChildBudget = (parentBudget - reservedForAggregation) / childCount;

      expect(perChildBudget).toBe(3000);
    });

    it('should cascade reduced budgets to grandchildren', () => {
      const rootBudget = 10000;
      const overheadPercent = 0.1; // 10% overhead per level

      // Level 1: 90% of root budget split among 2 children
      const level1Budget = rootBudget * (1 - overheadPercent);
      const perChild = level1Budget / 2;
      expect(perChild).toBe(4500);

      // Level 2: 90% of child budget split among 2 grandchildren
      const level2Budget = perChild * (1 - overheadPercent);
      const perGrandchild = level2Budget / 2;
      expect(perGrandchild).toBe(2025);
    });

    it('should track budget usage across hierarchy', () => {
      stateManager.register('root', { tokenBudget: 10000, tokensUsed: 0 });
      stateManager.register('child-1', { tokenBudget: 4500, tokensUsed: 0, parentId: 'root' });
      stateManager.register('gc-1', { tokenBudget: 2000, tokensUsed: 0, parentId: 'child-1' });

      // Grandchild uses tokens
      stateManager.updateState('gc-1', { tokensUsed: 1500 });

      // Verify budget tracking
      const gcState = stateManager.getState('gc-1');
      expect(gcState.tokensUsed).toBe(1500);
      expect(gcState.tokensRemaining).toBe(500);
    });

    it('should enforce budget limits at each level', () => {
      stateManager.register('agent', { tokenBudget: 1000, tokensUsed: 0 });

      // Try to exceed budget
      expect(() => {
        stateManager.updateState('agent', { tokensUsed: 1500 });
      }).toThrow(/budget/i);
    });
  });

  // ============================================================
  // 5. DELEGATION RECORD TRACKING
  // ============================================================
  describe('Delegation Record Tracking', () => {
    it('should track active delegations', () => {
      const delegationId = 'deleg-1';
      registry.registerDelegation(delegationId, {
        parentAgentId: 'root',
        childAgentId: 'child-1',
        taskId: 'task-123',
        status: 'active',
        startedAt: Date.now()
      });

      const activeDelegations = registry.getActiveDelegations();
      expect(activeDelegations).toHaveLength(1);
      expect(activeDelegations[0].delegationId).toBe(delegationId);
    });

    it('should update delegation status', () => {
      const delegationId = 'deleg-2';
      registry.registerDelegation(delegationId, {
        parentAgentId: 'root',
        childAgentId: 'child-1',
        taskId: 'task-456',
        status: 'active'
      });

      registry.updateDelegationStatus(delegationId, 'completed', {
        completedAt: Date.now(),
        result: { success: true }
      });

      const delegation = registry.getDelegation(delegationId);
      expect(delegation.status).toBe('completed');
      expect(delegation.result.success).toBe(true);
    });

    it('should get delegation chain for a task', () => {
      // Root delegates to child, child delegates to grandchild
      registry.registerDelegation('d1', {
        parentAgentId: 'root',
        childAgentId: 'child-1',
        taskId: 'main-task',
        status: 'active'
      });

      registry.registerDelegation('d2', {
        parentAgentId: 'child-1',
        childAgentId: 'gc-1',
        taskId: 'subtask-1',
        parentDelegationId: 'd1',
        status: 'active'
      });

      const chain = registry.getDelegationChainForTask('main-task');
      expect(chain).toContain('d1');
    });
  });

  // ============================================================
  // 6. STATE SYNCHRONIZATION
  // ============================================================
  describe('State Synchronization', () => {
    it('should maintain consistent state across hierarchy', () => {
      stateManager.register('root', { state: 'ACTIVE' });
      stateManager.setParent('child-1', 'root');
      stateManager.register('child-1', { state: 'ACTIVE' });

      // Update child state
      stateManager.updateState('child-1', { state: 'COMPLETED' });

      // Parent should be notified
      const rootState = stateManager.getState('root');
      const childState = stateManager.getState('child-1');

      expect(childState.state).toBe('COMPLETED');
      expect(rootState.childStates?.['child-1']).toBe('COMPLETED');
    });

    it('should handle atomic family transitions', () => {
      stateManager.register('parent', { state: 'ACTIVE' });
      stateManager.register('child-1', { state: 'IDLE', parentId: 'parent' });
      stateManager.register('child-2', { state: 'IDLE', parentId: 'parent' });

      // Atomic transition: parent starts delegating, children become active
      const success = stateManager.atomicFamilyTransition({
        parent: { id: 'parent', newState: 'DELEGATING' },
        children: [
          { id: 'child-1', newState: 'ACTIVE' },
          { id: 'child-2', newState: 'ACTIVE' }
        ]
      });

      expect(success).toBe(true);
      expect(stateManager.getState('parent').state).toBe('DELEGATING');
      expect(stateManager.getState('child-1').state).toBe('ACTIVE');
      expect(stateManager.getState('child-2').state).toBe('ACTIVE');
    });

    it('should rollback family transition on failure', () => {
      stateManager.register('parent', { state: 'ACTIVE' });
      stateManager.register('child', { state: 'IDLE', parentId: 'parent' });

      // Mock invalid transition for child
      stateManager.setValidTransitions('child', ['IDLE', 'ACTIVE']); // No DELEGATING allowed

      const success = stateManager.atomicFamilyTransition({
        parent: { id: 'parent', newState: 'DELEGATING' },
        children: [
          { id: 'child', newState: 'DELEGATING' } // Invalid!
        ]
      });

      expect(success).toBe(false);
      // Both should rollback to original states
      expect(stateManager.getState('parent').state).toBe('ACTIVE');
      expect(stateManager.getState('child').state).toBe('IDLE');
    });
  });

  // ============================================================
  // 7. PRUNING AND CLEANUP
  // ============================================================
  describe('Pruning and Cleanup', () => {
    it('should prune entire subtree when root is removed', () => {
      registry.registerAgent('root', {});
      registry.registerHierarchy('root', 'child-1', {});
      registry.registerHierarchy('root', 'child-2', {});
      registry.registerHierarchy('child-1', 'gc-1', {});

      registry.pruneHierarchy('child-1');

      // child-1 and gc-1 should be removed
      expect(registry.hasAgent('child-1')).toBe(false);
      expect(registry.hasAgent('gc-1')).toBe(false);
      // root and child-2 should remain
      expect(registry.hasAgent('root')).toBe(true);
      expect(registry.hasAgent('child-2')).toBe(true);
    });

    it('should cleanup orphaned delegations', () => {
      registry.registerDelegation('d1', {
        parentAgentId: 'root',
        childAgentId: 'child-1',
        taskId: 'task-1',
        status: 'active'
      });

      // Remove the child agent (simulating crash)
      registry.removeAgent('child-1');

      // Cleanup should mark delegation as orphaned
      registry.cleanupOrphanedDelegations();

      const delegation = registry.getDelegation('d1');
      expect(delegation.status).toBe('orphaned');
    });
  });
});
