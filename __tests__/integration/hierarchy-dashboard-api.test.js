/**
 * Integration tests for Hierarchy Dashboard API Endpoints
 * Tests: /api/hierarchy/:agentId, /api/delegations/active,
 *        /api/delegations/:id/chain, /api/sessions/:id/agents, /api/metrics/hierarchy
 */

const { getHierarchyRegistry, resetHierarchyRegistry } = require('../../.claude/core/hierarchy-registry');
const { getSessionRegistry, resetSessionRegistry } = require('../../.claude/core/session-registry');

describe('Hierarchy Dashboard API Endpoints', () => {
  let hierarchyRegistry;
  let sessionRegistry;

  beforeEach(() => {
    resetHierarchyRegistry();
    resetSessionRegistry();
    hierarchyRegistry = getHierarchyRegistry();
    sessionRegistry = getSessionRegistry();
  });

  afterEach(() => {
    resetHierarchyRegistry();
    resetSessionRegistry();
  });

  describe('GET /api/hierarchy/:agentId', () => {
    test('returns hierarchy tree for registered agent', () => {
      // Setup: Register a parent with children
      hierarchyRegistry.registerHierarchy(null, 'parent-agent', { agentType: 'orchestrator' });
      hierarchyRegistry.registerHierarchy('parent-agent', 'child-1', { agentType: 'worker' });
      hierarchyRegistry.registerHierarchy('parent-agent', 'child-2', { agentType: 'worker' });

      const hierarchy = hierarchyRegistry.getHierarchy('parent-agent');

      expect(hierarchy).not.toBeNull();
      expect(hierarchy.agentId).toBe('parent-agent');
      expect(hierarchy.children).toHaveLength(2);
      expect(hierarchy.children.map(c => c.agentId)).toContain('child-1');
      expect(hierarchy.children.map(c => c.agentId)).toContain('child-2');
    });

    test('returns null for unknown agent', () => {
      const hierarchy = hierarchyRegistry.getHierarchy('non-existent');
      expect(hierarchy).toBeNull();
    });

    test('includes metadata in hierarchy', () => {
      hierarchyRegistry.registerHierarchy(null, 'test-agent', {
        agentType: 'specialist',
        taskId: 'task-123'
      });

      const hierarchy = hierarchyRegistry.getHierarchy('test-agent');

      expect(hierarchy.metadata.agentType).toBe('specialist');
      expect(hierarchy.metadata.taskId).toBe('task-123');
    });

    test('returns nested hierarchy correctly', () => {
      hierarchyRegistry.registerHierarchy(null, 'root', {});
      hierarchyRegistry.registerHierarchy('root', 'level-1', {});
      hierarchyRegistry.registerHierarchy('level-1', 'level-2', {});
      hierarchyRegistry.registerHierarchy('level-2', 'level-3', {});

      const hierarchy = hierarchyRegistry.getHierarchy('root');

      expect(hierarchy.children).toHaveLength(1);
      expect(hierarchy.children[0].children).toHaveLength(1);
      expect(hierarchy.children[0].children[0].children).toHaveLength(1);
    });
  });

  describe('GET /api/delegations/active', () => {
    test('returns empty array when no delegations', () => {
      const delegations = hierarchyRegistry.getActiveDelegations();
      expect(delegations).toEqual([]);
    });

    test('returns active and pending delegations', () => {
      hierarchyRegistry.registerHierarchy(null, 'parent', {});
      hierarchyRegistry.registerHierarchy('parent', 'child', {});

      hierarchyRegistry.registerDelegation('del-1', {
        parentAgentId: 'parent',
        childAgentId: 'child',
        taskId: 'task-1'
      });

      const delegations = hierarchyRegistry.getActiveDelegations();
      expect(delegations.length).toBeGreaterThanOrEqual(1);
      expect(delegations.some(d => d.delegationId === 'del-1')).toBe(true);
    });

    test('excludes completed delegations', () => {
      hierarchyRegistry.registerHierarchy(null, 'parent', {});
      hierarchyRegistry.registerHierarchy('parent', 'child', {});

      hierarchyRegistry.registerDelegation('del-1', {
        parentAgentId: 'parent',
        childAgentId: 'child',
        taskId: 'task-1'
      });

      // Complete the delegation
      hierarchyRegistry.updateDelegationStatus('del-1', 'completed', { result: 'success' });

      const delegations = hierarchyRegistry.getActiveDelegations();
      expect(delegations.some(d => d.delegationId === 'del-1')).toBe(false);
    });

    test('returns delegation with correct structure', () => {
      hierarchyRegistry.registerHierarchy(null, 'orchestrator', {});
      hierarchyRegistry.registerHierarchy('orchestrator', 'worker', {});

      hierarchyRegistry.registerDelegation('del-test', {
        parentAgentId: 'orchestrator',
        childAgentId: 'worker',
        taskId: 'task-xyz',
        metadata: { priority: 'high' }
      });

      const delegations = hierarchyRegistry.getActiveDelegations();
      const delegation = delegations.find(d => d.delegationId === 'del-test');

      expect(delegation).toBeDefined();
      expect(delegation.parentAgentId).toBe('orchestrator');
      expect(delegation.childAgentId).toBe('worker');
      expect(delegation.taskId).toBe('task-xyz');
      expect(delegation.status).toMatch(/pending|active/);
    });
  });

  describe('GET /api/delegations/:delegationId/chain', () => {
    test('returns null for non-existent delegation', () => {
      const delegation = hierarchyRegistry.getDelegation('non-existent');
      expect(delegation).toBeNull();
    });

    test('returns delegation chain for nested delegations', () => {
      // Setup hierarchy: root -> mid -> leaf
      hierarchyRegistry.registerHierarchy(null, 'root', {});
      hierarchyRegistry.registerHierarchy('root', 'mid', { delegationId: 'del-1' });
      hierarchyRegistry.registerHierarchy('mid', 'leaf', { delegationId: 'del-2' });

      const chain = hierarchyRegistry.getDelegationChain('leaf');

      expect(chain).toHaveLength(3);
      expect(chain[0].agentId).toBe('root');
      expect(chain[1].agentId).toBe('mid');
      expect(chain[2].agentId).toBe('leaf');
    });

    test('returns single-element chain for root agent', () => {
      hierarchyRegistry.registerHierarchy(null, 'root-agent', {});

      const chain = hierarchyRegistry.getDelegationChain('root-agent');

      expect(chain).toHaveLength(1);
      expect(chain[0].agentId).toBe('root-agent');
    });

    test('includes depth information in chain', () => {
      hierarchyRegistry.registerHierarchy(null, 'root', {});
      hierarchyRegistry.registerHierarchy('root', 'child', {});
      hierarchyRegistry.registerHierarchy('child', 'grandchild', {});

      const chain = hierarchyRegistry.getDelegationChain('grandchild');

      expect(chain[0].depth).toBe(0);
      expect(chain[1].depth).toBe(1);
      expect(chain[2].depth).toBe(2);
    });
  });

  describe('GET /api/sessions/:id/agents (via session integration)', () => {
    test('session hierarchy integration works', () => {
      // register() returns the session ID (number)
      const sessionId = sessionRegistry.register({
        project: 'test-project',
        status: 'active'
      });

      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('number');

      const session = sessionRegistry.get(sessionId);
      expect(session).toBeDefined();
      expect(session.project).toBe('test-project');
    });

    test('agents can be associated with sessions via activeDelegations', () => {
      const sessionId = sessionRegistry.register({
        project: 'test',
        status: 'active'
      });

      // Add delegation to session using addDelegation method
      sessionRegistry.addDelegation(sessionId, {
        delegationId: 'del-1',
        targetAgentId: 'worker-1',
        taskId: 'task-1',
        status: 'active'
      });

      const session = sessionRegistry.get(sessionId);
      expect(session.activeDelegations).toHaveLength(1);
      expect(session.activeDelegations[0].targetAgentId).toBe('worker-1');
    });
  });

  describe('GET /api/metrics/hierarchy', () => {
    test('returns zero metrics when empty', () => {
      const stats = hierarchyRegistry.getStats();

      expect(stats.totalNodes).toBe(0);
      expect(stats.rootCount).toBe(0);
      expect(stats.totalDelegations).toBe(0);
    });

    test('returns accurate node count', () => {
      hierarchyRegistry.registerHierarchy(null, 'node-1', {});
      hierarchyRegistry.registerHierarchy(null, 'node-2', {});
      hierarchyRegistry.registerHierarchy('node-1', 'node-3', {});

      const stats = hierarchyRegistry.getStats();

      expect(stats.totalNodes).toBe(3);
      expect(stats.rootCount).toBe(2);
    });

    test('returns accurate delegation count', () => {
      hierarchyRegistry.registerHierarchy(null, 'parent', {});
      hierarchyRegistry.registerHierarchy('parent', 'child', {});

      hierarchyRegistry.registerDelegation('del-1', {
        parentAgentId: 'parent',
        childAgentId: 'child',
        taskId: 't1'
      });
      hierarchyRegistry.registerDelegation('del-2', {
        parentAgentId: 'parent',
        childAgentId: 'child',
        taskId: 't2'
      });

      const stats = hierarchyRegistry.getStats();

      expect(stats.totalDelegations).toBe(2);
    });

    test('tracks active vs completed delegations', () => {
      hierarchyRegistry.registerHierarchy(null, 'parent', {});
      hierarchyRegistry.registerHierarchy('parent', 'child', {});

      hierarchyRegistry.registerDelegation('del-1', {
        parentAgentId: 'parent',
        childAgentId: 'child',
        taskId: 't1'
      });
      hierarchyRegistry.registerDelegation('del-2', {
        parentAgentId: 'parent',
        childAgentId: 'child',
        taskId: 't2'
      });

      hierarchyRegistry.updateDelegationStatus('del-1', 'completed');

      const active = hierarchyRegistry.getActiveDelegations();
      expect(active.length).toBe(1);
    });

    test('returns depth statistics', () => {
      hierarchyRegistry.registerHierarchy(null, 'root', {});
      hierarchyRegistry.registerHierarchy('root', 'level-1', {});
      hierarchyRegistry.registerHierarchy('level-1', 'level-2', {});
      hierarchyRegistry.registerHierarchy('level-2', 'level-3', {});

      const stats = hierarchyRegistry.getStats();

      // Should track nodes at each depth
      expect(stats.depthCounts[0]).toBe(1); // root
      expect(stats.depthCounts[1]).toBe(1); // level-1
      expect(stats.depthCounts[2]).toBe(1); // level-2
      expect(stats.depthCounts[3]).toBe(1); // level-3
    });

    test('returns status statistics', () => {
      hierarchyRegistry.registerHierarchy(null, 'agent-1', {});
      hierarchyRegistry.registerHierarchy(null, 'agent-2', {});
      hierarchyRegistry.registerHierarchy(null, 'agent-3', {});

      hierarchyRegistry.updateNodeStatus('agent-2', 'completed');
      hierarchyRegistry.updateNodeStatus('agent-3', 'failed');

      const stats = hierarchyRegistry.getStats();

      expect(stats.statusCounts.active).toBe(1);
      expect(stats.statusCounts.completed).toBe(1);
      expect(stats.statusCounts.failed).toBe(1);
    });
  });

  describe('SSE hierarchy:update events', () => {
    test('emits hierarchy:registered event on registration', (done) => {
      hierarchyRegistry.once('hierarchy:registered', (data) => {
        expect(data.parentId).toBeNull();
        expect(data.childId).toBe('new-agent');
        expect(data.depth).toBe(0);
        done();
      });

      hierarchyRegistry.registerHierarchy(null, 'new-agent', {});
    });

    test('emits hierarchy:pruned event on pruning', (done) => {
      hierarchyRegistry.registerHierarchy(null, 'prune-root', {});
      hierarchyRegistry.registerHierarchy('prune-root', 'prune-child', {});

      let eventCount = 0;
      const prunedNodes = [];

      hierarchyRegistry.on('hierarchy:pruned', (data) => {
        eventCount++;
        prunedNodes.push(data.rootId);

        // Pruning emits an event for each node removed (post-order)
        if (eventCount >= 2) {
          expect(prunedNodes).toContain('prune-root');
          expect(prunedNodes).toContain('prune-child');
          done();
        }
      });

      hierarchyRegistry.pruneHierarchy('prune-root');
    });

    test('emits delegation:registered event', (done) => {
      hierarchyRegistry.registerHierarchy(null, 'parent', {});
      hierarchyRegistry.registerHierarchy('parent', 'child', {});

      hierarchyRegistry.once('delegation:registered', (data) => {
        expect(data.delegationId).toBe('test-del');
        expect(data.parentAgentId).toBe('parent');
        done();
      });

      hierarchyRegistry.registerDelegation('test-del', {
        parentAgentId: 'parent',
        childAgentId: 'child',
        taskId: 'task-1'
      });
    });

    test('emits delegation:updated event on status change', (done) => {
      hierarchyRegistry.registerHierarchy(null, 'parent', {});
      hierarchyRegistry.registerHierarchy('parent', 'child', {});
      hierarchyRegistry.registerDelegation('del-update', {
        parentAgentId: 'parent',
        childAgentId: 'child',
        taskId: 'task-1'
      });

      hierarchyRegistry.once('delegation:updated', (data) => {
        expect(data.delegationId).toBe('del-update');
        expect(data.status).toBe('completed');
        done();
      });

      hierarchyRegistry.updateDelegationStatus('del-update', 'completed');
    });

    test('emits node:statusChanged event', (done) => {
      hierarchyRegistry.registerHierarchy(null, 'status-agent', {});

      hierarchyRegistry.once('node:statusChanged', (data) => {
        expect(data.agentId).toBe('status-agent');
        expect(data.oldStatus).toBe('active');
        expect(data.status).toBe('completed');
        done();
      });

      hierarchyRegistry.updateNodeStatus('status-agent', 'completed');
    });
  });

  describe('Cross-component integration', () => {
    test('session and hierarchy registries work together', () => {
      // Create a session (register returns session ID)
      const sessionId = sessionRegistry.register({
        project: 'integration-test',
        status: 'active'
      });

      // Register agents in hierarchy
      hierarchyRegistry.registerHierarchy(null, 'main-orchestrator', {
        agentType: 'orchestrator'
      });
      hierarchyRegistry.registerHierarchy('main-orchestrator', 'worker-1', {
        agentType: 'worker'
      });
      hierarchyRegistry.registerHierarchy('main-orchestrator', 'worker-2', {
        agentType: 'worker'
      });

      // Verify hierarchy
      const hierarchy = hierarchyRegistry.getHierarchy('main-orchestrator');
      expect(hierarchy.children).toHaveLength(2);

      // Verify session exists
      const session = sessionRegistry.get(sessionId);
      expect(session).toBeDefined();
      expect(session.project).toBe('integration-test');
    });

    test('delegation chain traverses correctly', () => {
      // Setup 3-level hierarchy with delegations
      hierarchyRegistry.registerHierarchy(null, 'orchestrator', {});
      hierarchyRegistry.registerHierarchy('orchestrator', 'specialist', {
        delegationId: 'del-1'
      });
      hierarchyRegistry.registerHierarchy('specialist', 'worker', {
        delegationId: 'del-2'
      });

      hierarchyRegistry.registerDelegation('del-1', {
        parentAgentId: 'orchestrator',
        childAgentId: 'specialist',
        taskId: 'main-task'
      });
      hierarchyRegistry.registerDelegation('del-2', {
        parentAgentId: 'specialist',
        childAgentId: 'worker',
        taskId: 'sub-task'
      });

      // Get chain from worker
      const chain = hierarchyRegistry.getDelegationChain('worker');
      expect(chain).toHaveLength(3);

      // Verify delegations are active
      const active = hierarchyRegistry.getActiveDelegations();
      expect(active).toHaveLength(2);
    });
  });
});
