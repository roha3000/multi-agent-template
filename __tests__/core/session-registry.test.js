/**
 * Unit tests for SessionRegistry
 *
 * Tests session type tracking, autonomous flags, orchestrator info,
 * and logSessionId functionality.
 */

const { SessionRegistry, resetSessionRegistry } = require('../../.claude/core/session-registry');

describe('SessionRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new SessionRegistry({
      staleTimeout: 60000,
      cleanupInterval: 300000 // Long interval to avoid interference
    });
  });

  afterEach(() => {
    registry.shutdown();
  });

  describe('register()', () => {
    it('should assign incrementing IDs', () => {
      const id1 = registry.register({ project: 'test1' });
      const id2 = registry.register({ project: 'test2' });

      expect(id1).toBe(1);
      expect(id2).toBe(2);
    });

    it('should store sessionType field', () => {
      const id = registry.register({
        project: 'test-project',
        sessionType: 'autonomous'
      });

      const session = registry.get(id);
      expect(session.sessionType).toBe('autonomous');
    });

    it('should default sessionType to "cli" when not provided', () => {
      const id = registry.register({ project: 'test-project' });

      const session = registry.get(id);
      expect(session.sessionType).toBe('cli');
    });

    it('should store autonomous flag when explicitly set', () => {
      const id = registry.register({
        project: 'test-project',
        autonomous: true
      });

      const session = registry.get(id);
      expect(session.autonomous).toBe(true);
    });

    it('should derive autonomous flag from sessionType="autonomous"', () => {
      const id = registry.register({
        project: 'test-project',
        sessionType: 'autonomous'
      });

      const session = registry.get(id);
      expect(session.autonomous).toBe(true);
    });

    it('should NOT set autonomous flag for sessionType="cli"', () => {
      const id = registry.register({
        project: 'test-project',
        sessionType: 'cli'
      });

      const session = registry.get(id);
      expect(session.autonomous).toBe(false);
    });

    it('should store orchestratorInfo object', () => {
      const orchestratorInfo = {
        version: '1.0.0',
        startTime: new Date().toISOString(),
        mode: 'autonomous'
      };

      const id = registry.register({
        project: 'test-project',
        orchestratorInfo
      });

      const session = registry.get(id);
      expect(session.orchestratorInfo).toEqual(orchestratorInfo);
    });

    it('should default orchestratorInfo to null', () => {
      const id = registry.register({ project: 'test-project' });

      const session = registry.get(id);
      expect(session.orchestratorInfo).toBeNull();
    });

    it('should store logSessionId', () => {
      const id = registry.register({
        project: 'test-project',
        logSessionId: 5
      });

      const session = registry.get(id);
      expect(session.logSessionId).toBe(5);
    });

    it('should default logSessionId to null', () => {
      const id = registry.register({ project: 'test-project' });

      const session = registry.get(id);
      expect(session.logSessionId).toBeNull();
    });

    it('should emit session:registered event', () => {
      const handler = jest.fn();
      registry.on('session:registered', handler);

      const id = registry.register({
        project: 'test-project',
        sessionType: 'autonomous'
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id,
          project: 'test-project',
          sessionType: 'autonomous'
        })
      );
    });
  });

  describe('update()', () => {
    it('should preserve sessionType on update', () => {
      const id = registry.register({
        project: 'test-project',
        sessionType: 'autonomous'
      });

      registry.update(id, { status: 'active' });

      const session = registry.get(id);
      expect(session.sessionType).toBe('autonomous');
      expect(session.status).toBe('active');
    });

    it('should allow updating sessionType', () => {
      const id = registry.register({
        project: 'test-project',
        sessionType: 'cli'
      });

      registry.update(id, { sessionType: 'loop' });

      const session = registry.get(id);
      expect(session.sessionType).toBe('loop');
    });

    it('should preserve logSessionId on update', () => {
      const id = registry.register({
        project: 'test-project',
        logSessionId: 3
      });

      registry.update(id, { phase: 'implementation' });

      const session = registry.get(id);
      expect(session.logSessionId).toBe(3);
    });

    it('should emit session:updated event with changes', () => {
      const handler = jest.fn();
      registry.on('session:updated', handler);

      const id = registry.register({ project: 'test-project' });
      registry.update(id, { phase: 'testing', qualityScore: 85 });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          session: expect.objectContaining({
            id,
            phase: 'testing',
            qualityScore: 85
          }),
          changes: expect.objectContaining({ phase: 'testing', qualityScore: 85 })
        })
      );
    });
  });

  describe('getSummary()', () => {
    it('should include sessionType in session list', () => {
      registry.register({
        project: 'autonomous-project',
        sessionType: 'autonomous',
        status: 'active'
      });

      registry.register({
        project: 'cli-project',
        sessionType: 'cli',
        status: 'idle'
      });

      const summary = registry.getSummary();

      expect(summary.sessions).toHaveLength(2);
      expect(summary.sessions[0].sessionType).toBe('autonomous');
      expect(summary.sessions[1].sessionType).toBe('cli');
    });

    it('should include autonomous flag in session list', () => {
      registry.register({
        project: 'autonomous-project',
        sessionType: 'autonomous',
        status: 'active'
      });

      const summary = registry.getSummary();

      expect(summary.sessions[0].autonomous).toBe(true);
    });

    it('should include logSessionId in session list', () => {
      registry.register({
        project: 'test-project',
        logSessionId: 7
      });

      const summary = registry.getSummary();

      expect(summary.sessions[0].logSessionId).toBe(7);
    });

    it('should include orchestratorInfo in session list', () => {
      const orchestratorInfo = {
        version: '2.0.0',
        mode: 'continuous'
      };

      registry.register({
        project: 'test-project',
        orchestratorInfo
      });

      const summary = registry.getSummary();

      expect(summary.sessions[0].orchestratorInfo).toEqual(orchestratorInfo);
    });

    it('should calculate correct globalMetrics', () => {
      registry.register({
        project: 'project1',
        sessionType: 'autonomous',
        status: 'active',
        qualityScore: 80,
        confidenceScore: 90
      });

      registry.register({
        project: 'project2',
        sessionType: 'cli',
        status: 'active',
        qualityScore: 70,
        confidenceScore: 80
      });

      const summary = registry.getSummary();

      expect(summary.metrics.activeCount).toBe(2);
    });
  });

  describe('deregister()', () => {
    it('should remove session and return it', () => {
      const id = registry.register({
        project: 'test-project',
        sessionType: 'autonomous'
      });

      const session = registry.deregister(id);

      expect(session).not.toBeNull();
      expect(session.sessionType).toBe('autonomous');
      expect(session.status).toBe('ended');
      expect(registry.get(id)).toBeNull();
    });

    it('should emit session:deregistered event', () => {
      const handler = jest.fn();
      registry.on('session:deregistered', handler);

      const id = registry.register({
        project: 'test-project',
        sessionType: 'autonomous'
      });

      registry.deregister(id);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id,
          sessionType: 'autonomous',
          status: 'ended'
        })
      );
    });
  });

  describe('getActive()', () => {
    it('should only return non-ended sessions', () => {
      const id1 = registry.register({ project: 'p1', status: 'active' });
      const id2 = registry.register({ project: 'p2', status: 'idle' });
      registry.register({ project: 'p3', status: 'ended' });

      const active = registry.getActive();

      expect(active).toHaveLength(2);
      expect(active.map(s => s.id)).toContain(id1);
      expect(active.map(s => s.id)).toContain(id2);
    });
  });

  describe('session type combinations', () => {
    it('should handle CLI session correctly', () => {
      const id = registry.register({
        project: 'cli-project',
        sessionType: 'cli',
        path: '/path/to/project'
      });

      const session = registry.get(id);

      expect(session.sessionType).toBe('cli');
      expect(session.autonomous).toBe(false);
      expect(session.orchestratorInfo).toBeNull();
      expect(session.logSessionId).toBeNull();
    });

    it('should handle autonomous session correctly', () => {
      const id = registry.register({
        project: 'autonomous-project',
        sessionType: 'autonomous',
        path: '/path/to/project',
        logSessionId: 1,
        orchestratorInfo: {
          version: '1.0.0',
          startTime: '2025-01-01T00:00:00.000Z',
          mode: 'autonomous'
        }
      });

      const session = registry.get(id);

      expect(session.sessionType).toBe('autonomous');
      expect(session.autonomous).toBe(true);
      expect(session.orchestratorInfo).not.toBeNull();
      expect(session.logSessionId).toBe(1);
    });

    it('should handle loop session correctly', () => {
      const id = registry.register({
        project: 'loop-project',
        sessionType: 'loop',
        autonomous: true,
        logSessionId: 2
      });

      const session = registry.get(id);

      expect(session.sessionType).toBe('loop');
      expect(session.autonomous).toBe(true);
    });
  });

  // ============================================
  // HIERARCHY TESTS
  // ============================================

  describe('Hierarchy Extension', () => {
    describe('register() with hierarchy', () => {
      it('should initialize hierarchyInfo for root session', () => {
        const id = registry.register({ project: 'root-project' });

        const session = registry.get(id);

        expect(session.hierarchyInfo).toBeDefined();
        expect(session.hierarchyInfo.isRoot).toBe(true);
        expect(session.hierarchyInfo.parentSessionId).toBeNull();
        expect(session.hierarchyInfo.childSessionIds).toEqual([]);
        expect(session.hierarchyInfo.delegationDepth).toBe(0);
      });

      it('should initialize with parent session ID', () => {
        const parentId = registry.register({ project: 'parent-project' });
        const childId = registry.register({
          project: 'child-project',
          hierarchy: { parentSessionId: parentId }
        });

        const child = registry.get(childId);

        expect(child.hierarchyInfo.isRoot).toBe(false);
        expect(child.hierarchyInfo.parentSessionId).toBe(parentId);
      });

      it('should register child in parent childSessionIds', () => {
        const parentId = registry.register({ project: 'parent-project' });
        const childId = registry.register({
          project: 'child-project',
          hierarchy: { parentSessionId: parentId }
        });

        const parent = registry.get(parentId);

        expect(parent.hierarchyInfo.childSessionIds).toContain(childId);
        expect(parent.rollupMetrics.childSessionCount).toBe(1);
      });

      it('should initialize activeDelegations as empty array', () => {
        const id = registry.register({ project: 'test-project' });

        const session = registry.get(id);

        expect(session.activeDelegations).toEqual([]);
      });

      it('should initialize rollupMetrics', () => {
        const id = registry.register({ project: 'test-project' });

        const session = registry.get(id);

        expect(session.rollupMetrics).toBeDefined();
        expect(session.rollupMetrics.totalTokens).toBe(0);
        expect(session.rollupMetrics.totalCost).toBe(0);
        expect(session.rollupMetrics.avgQuality).toBe(0);
      });

      it('should emit session:childAdded event', () => {
        const handler = jest.fn();
        registry.on('session:childAdded', handler);

        const parentId = registry.register({ project: 'parent-project' });
        const childId = registry.register({
          project: 'child-project',
          hierarchy: { parentSessionId: parentId }
        });

        expect(handler).toHaveBeenCalledWith({
          parentSessionId: parentId,
          childSessionId: childId
        });
      });
    });

    describe('addDelegation()', () => {
      it('should add delegation to session', () => {
        const id = registry.register({ project: 'test-project' });

        const delegation = registry.addDelegation(id, {
          targetAgentId: 'agent-1',
          taskId: 'task-123'
        });

        expect(delegation).toBeDefined();
        expect(delegation.delegationId).toBeDefined();
        expect(delegation.targetAgentId).toBe('agent-1');
        expect(delegation.taskId).toBe('task-123');
        expect(delegation.status).toBe('pending');
      });

      it('should return null for non-existent session', () => {
        const result = registry.addDelegation(999, { targetAgentId: 'agent-1' });
        expect(result).toBeNull();
      });

      it('should emit delegation:added event', () => {
        const handler = jest.fn();
        registry.on('delegation:added', handler);

        const id = registry.register({ project: 'test-project' });
        registry.addDelegation(id, { targetAgentId: 'agent-1', taskId: 'task-1' });

        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            sessionId: id,
            delegation: expect.objectContaining({
              targetAgentId: 'agent-1',
              taskId: 'task-1'
            })
          })
        );
      });
    });

    describe('updateDelegation()', () => {
      it('should update delegation status', () => {
        const id = registry.register({ project: 'test-project' });
        const delegation = registry.addDelegation(id, { targetAgentId: 'agent-1' });

        const updated = registry.updateDelegation(id, delegation.delegationId, 'active');

        expect(updated.status).toBe('active');
      });

      it('should remove delegation when completed', () => {
        const id = registry.register({ project: 'test-project' });
        const delegation = registry.addDelegation(id, { targetAgentId: 'agent-1' });

        registry.updateDelegation(id, delegation.delegationId, 'completed', { result: 'success' });

        const session = registry.get(id);
        expect(session.activeDelegations).toHaveLength(0);
      });

      it('should emit delegation:updated event', () => {
        const handler = jest.fn();
        registry.on('delegation:updated', handler);

        const id = registry.register({ project: 'test-project' });
        const delegation = registry.addDelegation(id, { targetAgentId: 'agent-1' });

        registry.updateDelegation(id, delegation.delegationId, 'active');

        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            sessionId: id,
            delegationId: delegation.delegationId,
            oldStatus: 'pending',
            status: 'active'
          })
        );
      });

      it('should move completed delegation to completedDelegations', () => {
        const id = registry.register({ project: 'test-project' });
        const delegation = registry.addDelegation(id, { targetAgentId: 'agent-1', taskId: 'task-1' });

        registry.updateDelegation(id, delegation.delegationId, 'completed', { result: 'success' });

        const session = registry.get(id);
        expect(session.activeDelegations).toHaveLength(0);
        expect(session.completedDelegations).toHaveLength(1);
        expect(session.completedDelegations[0].delegationId).toBe(delegation.delegationId);
        expect(session.completedDelegations[0].status).toBe('completed');
        expect(session.completedDelegations[0].completedAt).toBeDefined();
      });

      it('should move failed delegation to completedDelegations', () => {
        const id = registry.register({ project: 'test-project' });
        const delegation = registry.addDelegation(id, { targetAgentId: 'agent-1' });

        registry.updateDelegation(id, delegation.delegationId, 'failed', { error: 'Something went wrong' });

        const session = registry.get(id);
        expect(session.activeDelegations).toHaveLength(0);
        expect(session.completedDelegations).toHaveLength(1);
        expect(session.completedDelegations[0].status).toBe('failed');
        expect(session.completedDelegations[0].error).toBe('Something went wrong');
      });

      it('should prune completedDelegations to last 50', () => {
        const id = registry.register({ project: 'test-project' });

        // Add and complete 55 delegations
        for (let i = 0; i < 55; i++) {
          const delegation = registry.addDelegation(id, { targetAgentId: `agent-${i}`, taskId: `task-${i}` });
          registry.updateDelegation(id, delegation.delegationId, 'completed');
        }

        const session = registry.get(id);
        expect(session.completedDelegations).toHaveLength(50);
        // Should keep the most recent 50 (tasks 5-54)
        expect(session.completedDelegations[0].taskId).toBe('task-5');
        expect(session.completedDelegations[49].taskId).toBe('task-54');
      });
    });

    describe('getCompletedDelegations()', () => {
      it('should return completed delegations in reverse order (most recent first)', () => {
        const id = registry.register({ project: 'test-project' });

        const del1 = registry.addDelegation(id, { targetAgentId: 'agent-1', taskId: 'task-1' });
        registry.updateDelegation(id, del1.delegationId, 'completed');

        const del2 = registry.addDelegation(id, { targetAgentId: 'agent-2', taskId: 'task-2' });
        registry.updateDelegation(id, del2.delegationId, 'completed');

        const completed = registry.getCompletedDelegations(id);
        expect(completed).toHaveLength(2);
        expect(completed[0].taskId).toBe('task-2'); // Most recent first
        expect(completed[1].taskId).toBe('task-1');
      });

      it('should respect limit parameter', () => {
        const id = registry.register({ project: 'test-project' });

        for (let i = 0; i < 10; i++) {
          const delegation = registry.addDelegation(id, { targetAgentId: `agent-${i}` });
          registry.updateDelegation(id, delegation.delegationId, 'completed');
        }

        const completed = registry.getCompletedDelegations(id, 5);
        expect(completed).toHaveLength(5);
      });

      it('should return empty array for non-existent session', () => {
        const completed = registry.getCompletedDelegations(999);
        expect(completed).toEqual([]);
      });
    });

    describe('getAllDelegations()', () => {
      it('should return both active and completed delegations', () => {
        const id = registry.register({ project: 'test-project' });

        const del1 = registry.addDelegation(id, { targetAgentId: 'agent-1', taskId: 'task-1' });
        registry.updateDelegation(id, del1.delegationId, 'completed');

        const del2 = registry.addDelegation(id, { targetAgentId: 'agent-2', taskId: 'task-2' });
        registry.updateDelegation(id, del2.delegationId, 'active');

        const all = registry.getAllDelegations(id);
        expect(all.active).toHaveLength(1);
        expect(all.completed).toHaveLength(1);
        expect(all.active[0].taskId).toBe('task-2');
        expect(all.completed[0].taskId).toBe('task-1');
      });

      it('should return empty arrays for non-existent session', () => {
        const all = registry.getAllDelegations(999);
        expect(all).toEqual({ active: [], completed: [] });
      });
    });

    describe('getRollupMetrics()', () => {
      it('should return metrics for single session', () => {
        const id = registry.register({
          project: 'test-project',
          tokens: 1000,
          cost: 0.05,
          qualityScore: 90
        });

        const rollup = registry.getRollupMetrics(id);

        expect(rollup.totalTokens).toBe(1000);
        expect(rollup.totalCost).toBe(0.05);
        expect(rollup.avgQuality).toBe(90);
        expect(rollup.totalAgentCount).toBe(1);
      });

      it('should aggregate metrics from child sessions', () => {
        const parentId = registry.register({
          project: 'parent-project',
          tokens: 1000,
          cost: 0.05,
          qualityScore: 80
        });

        const childId = registry.register({
          project: 'child-project',
          tokens: 500,
          cost: 0.02,
          qualityScore: 90,
          hierarchy: { parentSessionId: parentId }
        });

        const rollup = registry.getRollupMetrics(parentId);

        expect(rollup.totalTokens).toBe(1500);
        expect(rollup.totalCost).toBe(0.07);
        expect(rollup.avgQuality).toBe(85); // Average of 80 and 90
        expect(rollup.totalAgentCount).toBe(2);
      });

      it('should return null for non-existent session', () => {
        const result = registry.getRollupMetrics(999);
        expect(result).toBeNull();
      });
    });

    describe('getSessionWithHierarchy()', () => {
      it('should return session with hierarchy tree', () => {
        const parentId = registry.register({ project: 'parent-project' });
        const childId = registry.register({
          project: 'child-project',
          hierarchy: { parentSessionId: parentId }
        });

        const result = registry.getSessionWithHierarchy(parentId);

        expect(result).toBeDefined();
        expect(result.hierarchy).toBeDefined();
        expect(result.hierarchy.sessionId).toBe(parentId);
        expect(result.hierarchy.children).toHaveLength(1);
        expect(result.hierarchy.children[0].sessionId).toBe(childId);
        expect(result.rollupMetrics).toBeDefined();
      });

      it('should return null for non-existent session', () => {
        const result = registry.getSessionWithHierarchy(999);
        expect(result).toBeNull();
      });
    });

    describe('getHierarchy()', () => {
      it('should return hierarchy tree', () => {
        const rootId = registry.register({ project: 'root' });
        const level1Id = registry.register({
          project: 'level1',
          hierarchy: { parentSessionId: rootId }
        });
        const level2Id = registry.register({
          project: 'level2',
          hierarchy: { parentSessionId: level1Id }
        });

        const hierarchy = registry.getHierarchy(rootId);

        expect(hierarchy.sessionId).toBe(rootId);
        expect(hierarchy.children).toHaveLength(1);
        expect(hierarchy.children[0].sessionId).toBe(level1Id);
        expect(hierarchy.children[0].children).toHaveLength(1);
        expect(hierarchy.children[0].children[0].sessionId).toBe(level2Id);
      });
    });

    describe('getRootSessions()', () => {
      it('should return only root sessions', () => {
        const root1Id = registry.register({ project: 'root1', status: 'active' });
        const root2Id = registry.register({ project: 'root2', status: 'active' });
        registry.register({
          project: 'child',
          hierarchy: { parentSessionId: root1Id }
        });

        const roots = registry.getRootSessions();

        expect(roots).toHaveLength(2);
        expect(roots.map(s => s.id)).toContain(root1Id);
        expect(roots.map(s => s.id)).toContain(root2Id);
      });

      it('should exclude ended root sessions', () => {
        const activeId = registry.register({ project: 'active', status: 'active' });
        registry.register({ project: 'ended', status: 'ended' });

        const roots = registry.getRootSessions();

        expect(roots).toHaveLength(1);
        expect(roots[0].id).toBe(activeId);
      });
    });

    describe('getParentSession()', () => {
      it('should return parent session', () => {
        const parentId = registry.register({ project: 'parent' });
        const childId = registry.register({
          project: 'child',
          hierarchy: { parentSessionId: parentId }
        });

        const parent = registry.getParentSession(childId);

        expect(parent).toBeDefined();
        expect(parent.id).toBe(parentId);
      });

      it('should return null for root session', () => {
        const rootId = registry.register({ project: 'root' });

        const parent = registry.getParentSession(rootId);

        expect(parent).toBeNull();
      });
    });

    describe('getChildSessions()', () => {
      it('should return child sessions', () => {
        const parentId = registry.register({ project: 'parent' });
        const child1Id = registry.register({
          project: 'child1',
          hierarchy: { parentSessionId: parentId }
        });
        const child2Id = registry.register({
          project: 'child2',
          hierarchy: { parentSessionId: parentId }
        });

        const children = registry.getChildSessions(parentId);

        expect(children).toHaveLength(2);
        expect(children.map(s => s.id)).toContain(child1Id);
        expect(children.map(s => s.id)).toContain(child2Id);
      });

      it('should return empty array for session without children', () => {
        const id = registry.register({ project: 'no-children' });

        const children = registry.getChildSessions(id);

        expect(children).toEqual([]);
      });
    });

    describe('getDescendants()', () => {
      it('should return all descendants', () => {
        const rootId = registry.register({ project: 'root' });
        const level1Id = registry.register({
          project: 'level1',
          hierarchy: { parentSessionId: rootId }
        });
        const level2aId = registry.register({
          project: 'level2a',
          hierarchy: { parentSessionId: level1Id }
        });
        const level2bId = registry.register({
          project: 'level2b',
          hierarchy: { parentSessionId: level1Id }
        });

        const descendants = registry.getDescendants(rootId);

        expect(descendants).toHaveLength(3);
        expect(descendants.map(s => s.id)).toContain(level1Id);
        expect(descendants.map(s => s.id)).toContain(level2aId);
        expect(descendants.map(s => s.id)).toContain(level2bId);
      });
    });

    describe('getSummaryWithHierarchy()', () => {
      it('should include hierarchy metrics', () => {
        const root1Id = registry.register({ project: 'root1' });
        registry.register({
          project: 'child1',
          hierarchy: { parentSessionId: root1Id }
        });

        const summary = registry.getSummaryWithHierarchy();

        expect(summary.hierarchyMetrics).toBeDefined();
        expect(summary.hierarchyMetrics.rootSessionCount).toBe(1);
        expect(summary.hierarchyMetrics.sessionsWithChildren).toBe(1);
        expect(summary.rootSessions).toHaveLength(1);
        expect(summary.rootSessions[0].id).toBe(root1Id);
        expect(summary.rootSessions[0].childCount).toBe(1);
      });
    });

    describe('propagateMetricUpdate()', () => {
      it('should emit rollupUpdated events up the hierarchy', () => {
        const handler = jest.fn();
        registry.on('session:rollupUpdated', handler);

        const parentId = registry.register({ project: 'parent' });
        const childId = registry.register({
          project: 'child',
          hierarchy: { parentSessionId: parentId }
        });

        registry.propagateMetricUpdate(childId, 'tokens', 100);

        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            sessionId: parentId,
            sourceSessionId: childId,
            metricType: 'tokens'
          })
        );
      });
    });
  });
});
