/**
 * Tests for HierarchicalStateManager
 */

const {
  HierarchicalStateManager,
  AgentStates,
  StateTransitions,
  OptimisticLockError,
  InvalidTransitionError
} = require('../../.claude/core/hierarchical-state');

describe('HierarchicalStateManager', () => {
  let manager;

  beforeEach(() => {
    manager = new HierarchicalStateManager({
      maxEventLogSize: 100,
      staleTimeout: 300000
    });
  });

  afterEach(() => {
    manager.clear();
  });

  describe('Constructor', () => {
    it('creates with default options', () => {
      const defaultManager = new HierarchicalStateManager();
      expect(defaultManager.staleTimeout).toBe(300000);
      expect(defaultManager.maxEventLogSize).toBe(100);
    });

    it('accepts custom options', () => {
      const customManager = new HierarchicalStateManager({
        staleTimeout: 60000,
        maxEventLogSize: 50
      });
      expect(customManager.staleTimeout).toBe(60000);
      expect(customManager.maxEventLogSize).toBe(50);
    });
  });

  describe('register', () => {
    it('registers agent with initial state', () => {
      const entry = manager.register('agent-1');

      expect(entry.agentId).toBe('agent-1');
      expect(entry.state).toBe(AgentStates.IDLE);
      expect(entry.version).toBe(1);
      expect(entry.parentId).toBeNull();
    });

    it('registers with parent', () => {
      manager.register('parent-1');
      const child = manager.register('child-1', { parentId: 'parent-1' });

      expect(child.parentId).toBe('parent-1');

      const children = manager.getChildren('parent-1');
      expect(children.map(c => c.agentId)).toContain('child-1');
    });

    it('stores metadata', () => {
      const entry = manager.register('agent-1', {
        metadata: { role: 'researcher', priority: 'high' }
      });

      expect(entry.metadata.role).toBe('researcher');
      expect(entry.metadata.priority).toBe('high');
    });

    it('throws on duplicate registration', () => {
      manager.register('agent-1');

      expect(() => {
        manager.register('agent-1');
      }).toThrow(/already registered/);
    });

    it('logs registration event', () => {
      manager.register('agent-1');

      const events = manager.getEventLog('agent-1');
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('registered');
    });
  });

  describe('getState', () => {
    it('returns state for registered agent', () => {
      manager.register('agent-1');

      const state = manager.getState('agent-1');
      expect(state).not.toBeNull();
      expect(state.agentId).toBe('agent-1');
    });

    it('returns null for unknown agent', () => {
      expect(manager.getState('unknown')).toBeNull();
    });
  });

  describe('updateState', () => {
    it('updates state with valid transition', () => {
      manager.register('agent-1');

      const updated = manager.updateState('agent-1', AgentStates.INITIALIZING);

      expect(updated.state).toBe(AgentStates.INITIALIZING);
      expect(updated.version).toBe(2);
    });

    it('increments version on each update', () => {
      manager.register('agent-1');

      manager.updateState('agent-1', AgentStates.INITIALIZING);
      manager.updateState('agent-1', AgentStates.ACTIVE);
      const final = manager.updateState('agent-1', AgentStates.COMPLETING);

      expect(final.version).toBe(4);
    });

    it('merges metadata on update', () => {
      manager.register('agent-1', { metadata: { a: 1 } });

      manager.updateState('agent-1', AgentStates.INITIALIZING, {
        metadata: { b: 2 }
      });

      const state = manager.getState('agent-1');
      expect(state.metadata.a).toBe(1);
      expect(state.metadata.b).toBe(2);
    });

    it('throws on invalid transition', () => {
      manager.register('agent-1');

      expect(() => {
        manager.updateState('agent-1', AgentStates.COMPLETED);
      }).toThrow(InvalidTransitionError);
    });

    it('throws on optimistic lock failure', () => {
      manager.register('agent-1');
      manager.updateState('agent-1', AgentStates.INITIALIZING);

      expect(() => {
        manager.updateState('agent-1', AgentStates.ACTIVE, {
          expectedVersion: 1 // Wrong version, should be 2
        });
      }).toThrow(OptimisticLockError);
    });

    it('succeeds with correct version', () => {
      manager.register('agent-1');

      const updated = manager.updateState('agent-1', AgentStates.INITIALIZING, {
        expectedVersion: 1
      });

      expect(updated.state).toBe(AgentStates.INITIALIZING);
      expect(updated.version).toBe(2);
    });

    it('logs state-change event', () => {
      manager.register('agent-1');
      manager.updateState('agent-1', AgentStates.INITIALIZING);

      const events = manager.getEventLog('agent-1');
      expect(events.some(e => e.type === 'state-change')).toBe(true);
    });

    it('maintains state history', () => {
      manager.register('agent-1');
      manager.updateState('agent-1', AgentStates.INITIALIZING);
      manager.updateState('agent-1', AgentStates.ACTIVE);

      const state = manager.getState('agent-1');
      expect(state.stateHistory.length).toBe(3);
      expect(state.stateHistory[0].state).toBe(AgentStates.IDLE);
      expect(state.stateHistory[1].state).toBe(AgentStates.INITIALIZING);
      expect(state.stateHistory[2].state).toBe(AgentStates.ACTIVE);
    });
  });

  describe('atomicFamilyTransition', () => {
    it('updates parent and all children atomically', async () => {
      manager.register('parent-1');
      manager.register('child-1', { parentId: 'parent-1' });
      manager.register('child-2', { parentId: 'parent-1' });

      // Move parent to INITIALIZING first
      manager.updateState('parent-1', AgentStates.INITIALIZING);
      manager.updateState('parent-1', AgentStates.ACTIVE);
      manager.updateState('child-1', AgentStates.INITIALIZING);
      manager.updateState('child-1', AgentStates.ACTIVE);
      manager.updateState('child-2', AgentStates.INITIALIZING);
      manager.updateState('child-2', AgentStates.ACTIVE);

      const result = await manager.atomicFamilyTransition(
        'parent-1',
        AgentStates.COMPLETING,
        AgentStates.COMPLETING
      );

      expect(result.parent.state).toBe(AgentStates.COMPLETING);
      expect(result.children.length).toBe(2);
      expect(result.children.every(c => c.state === AgentStates.COMPLETING)).toBe(true);
    });

    it('throws if any transition is invalid', async () => {
      manager.register('parent-1');
      manager.register('child-1', { parentId: 'parent-1' });

      await expect(
        manager.atomicFamilyTransition('parent-1', AgentStates.COMPLETED, AgentStates.COMPLETED)
      ).rejects.toThrow(InvalidTransitionError);
    });

    it('logs atomic transition event', async () => {
      manager.register('parent-1');
      manager.updateState('parent-1', AgentStates.INITIALIZING);
      manager.updateState('parent-1', AgentStates.ACTIVE);

      await manager.atomicFamilyTransition('parent-1', AgentStates.COMPLETING, AgentStates.COMPLETING);

      const events = manager.getEventLog('parent-1');
      expect(events.some(e => e.type === 'atomic-family-transition')).toBe(true);
    });
  });

  describe('getAggregateState', () => {
    it('aggregates state for hierarchy', () => {
      manager.register('parent-1');
      manager.register('child-1', { parentId: 'parent-1' });
      manager.register('child-2', { parentId: 'parent-1' });
      manager.register('grandchild-1', { parentId: 'child-1' });

      // Set various states
      manager.updateState('parent-1', AgentStates.INITIALIZING);
      manager.updateState('parent-1', AgentStates.ACTIVE);
      manager.updateState('child-1', AgentStates.INITIALIZING);
      manager.updateState('child-1', AgentStates.ACTIVE);
      manager.updateState('child-2', AgentStates.INITIALIZING);
      manager.updateState('child-2', AgentStates.FAILED);

      const aggregate = manager.getAggregateState('parent-1');

      expect(aggregate.descendantCount).toBe(3);
      expect(aggregate.stateCounts[AgentStates.ACTIVE]).toBe(2);
      expect(aggregate.stateCounts[AgentStates.FAILED]).toBe(1);
      expect(aggregate.stateCounts[AgentStates.IDLE]).toBe(1);
      expect(aggregate.hasFailures).toBe(true);
      expect(aggregate.isFullyComplete).toBe(false);
    });

    it('returns null for unknown agent', () => {
      expect(manager.getAggregateState('unknown')).toBeNull();
    });

    it('counts active agents correctly', () => {
      manager.register('parent-1');
      manager.register('child-1', { parentId: 'parent-1' });
      manager.register('child-2', { parentId: 'parent-1' });

      manager.updateState('parent-1', AgentStates.INITIALIZING);
      manager.updateState('parent-1', AgentStates.ACTIVE);
      manager.updateState('child-1', AgentStates.INITIALIZING);
      manager.updateState('child-1', AgentStates.ACTIVE);
      manager.updateState('child-1', AgentStates.DELEGATING); // ACTIVE -> DELEGATING is valid

      const aggregate = manager.getAggregateState('parent-1');

      expect(aggregate.activeCount).toBe(2); // ACTIVE + DELEGATING
    });
  });

  describe('getChildren and getParent', () => {
    it('returns children for parent', () => {
      manager.register('parent-1');
      manager.register('child-1', { parentId: 'parent-1' });
      manager.register('child-2', { parentId: 'parent-1' });

      const children = manager.getChildren('parent-1');

      expect(children.length).toBe(2);
      expect(children.map(c => c.agentId).sort()).toEqual(['child-1', 'child-2']);
    });

    it('returns empty array for childless agent', () => {
      manager.register('agent-1');

      expect(manager.getChildren('agent-1')).toEqual([]);
    });

    it('returns parent for child', () => {
      manager.register('parent-1');
      manager.register('child-1', { parentId: 'parent-1' });

      const parent = manager.getParent('child-1');

      expect(parent.agentId).toBe('parent-1');
    });

    it('returns null for root agent', () => {
      manager.register('root-1');

      expect(manager.getParent('root-1')).toBeNull();
    });
  });

  describe('unregister', () => {
    it('unregisters agent', () => {
      manager.register('agent-1');
      manager.unregister('agent-1');

      expect(manager.getState('agent-1')).toBeNull();
    });

    it('cascades to children by default', () => {
      manager.register('parent-1');
      manager.register('child-1', { parentId: 'parent-1' });
      manager.register('grandchild-1', { parentId: 'child-1' });

      manager.unregister('parent-1');

      expect(manager.getState('parent-1')).toBeNull();
      expect(manager.getState('child-1')).toBeNull();
      expect(manager.getState('grandchild-1')).toBeNull();
    });

    it('does not cascade when cascade=false', () => {
      manager.register('parent-1');
      manager.register('child-1', { parentId: 'parent-1' });

      manager.unregister('parent-1', { cascade: false });

      expect(manager.getState('parent-1')).toBeNull();
      expect(manager.getState('child-1')).not.toBeNull(); // Still exists
    });

    it('updates parent children list when child unregistered', () => {
      manager.register('parent-1');
      manager.register('child-1', { parentId: 'parent-1' });
      manager.register('child-2', { parentId: 'parent-1' });

      manager.unregister('child-1', { cascade: false });

      const children = manager.getChildren('parent-1');
      expect(children.map(c => c.agentId)).toEqual(['child-2']);
    });
  });

  describe('cleanupStale', () => {
    it('cleans up stale inactive agents', () => {
      manager.staleTimeout = 0; // Immediate timeout for testing

      manager.register('agent-1');

      // Force updatedAt to be in the past
      const entry = manager.states.get('agent-1');
      entry.updatedAt = Date.now() - 1000;

      const cleaned = manager.cleanupStale();

      expect(cleaned).toContain('agent-1');
      expect(manager.getState('agent-1')).toBeNull();
    });

    it('does not clean up active agents', () => {
      manager.staleTimeout = 0;

      manager.register('agent-1');
      manager.updateState('agent-1', AgentStates.INITIALIZING);
      manager.updateState('agent-1', AgentStates.ACTIVE);

      const entry = manager.states.get('agent-1');
      entry.updatedAt = Date.now() - 1000;

      const cleaned = manager.cleanupStale();

      expect(cleaned).not.toContain('agent-1');
    });

    it('cascades cleanup to children', () => {
      manager.staleTimeout = 0;

      manager.register('parent-1');
      manager.register('child-1', { parentId: 'parent-1' });

      const parent = manager.states.get('parent-1');
      parent.updatedAt = Date.now() - 1000;

      manager.cleanupStale();

      expect(manager.getState('parent-1')).toBeNull();
      expect(manager.getState('child-1')).toBeNull();
    });
  });

  describe('Event logging', () => {
    it('retrieves event log for agent', () => {
      manager.register('agent-1');
      manager.updateState('agent-1', AgentStates.INITIALIZING);

      const events = manager.getEventLog('agent-1');

      expect(events.length).toBe(2);
      expect(events[0].type).toBe('registered');
      expect(events[1].type).toBe('state-change');
    });

    it('returns empty array for unknown agent', () => {
      expect(manager.getEventLog('unknown')).toEqual([]);
    });

    it('gets all events filtered by time', () => {
      const startTime = Date.now();

      manager.register('agent-1');
      manager.register('agent-2');

      const events = manager.getAllEvents({ since: startTime - 1 });

      expect(events.length).toBeGreaterThanOrEqual(2);
    });

    it('gets all events filtered by type', () => {
      manager.register('agent-1');
      manager.updateState('agent-1', AgentStates.INITIALIZING);

      const events = manager.getAllEvents({ eventType: 'state-change' });

      expect(events.every(e => e.type === 'state-change')).toBe(true);
    });

    it('bounds event log size', () => {
      manager.maxEventLogSize = 5;
      manager.register('agent-1');

      // Generate many state changes
      manager.updateState('agent-1', AgentStates.INITIALIZING);
      manager.updateState('agent-1', AgentStates.ACTIVE);
      manager.updateState('agent-1', AgentStates.DELEGATING);
      manager.updateState('agent-1', AgentStates.ACTIVE);
      manager.updateState('agent-1', AgentStates.WAITING);
      manager.updateState('agent-1', AgentStates.ACTIVE);

      const events = manager.getEventLog('agent-1');

      expect(events.length).toBeLessThanOrEqual(5);
    });
  });

  describe('getStats', () => {
    it('returns statistics', () => {
      manager.register('parent-1');
      manager.register('child-1', { parentId: 'parent-1' });
      manager.updateState('parent-1', AgentStates.INITIALIZING);
      manager.updateState('parent-1', AgentStates.ACTIVE);

      const stats = manager.getStats();

      expect(stats.totalAgents).toBe(2);
      expect(stats.stateCounts[AgentStates.ACTIVE]).toBe(1);
      expect(stats.stateCounts[AgentStates.IDLE]).toBe(1);
      expect(stats.hierarchyCount).toBe(1);
      expect(stats.totalEvents).toBeGreaterThan(0);
    });
  });

  describe('Events', () => {
    it('emits agent:registered event', (done) => {
      manager.on('agent:registered', (data) => {
        expect(data.agentId).toBe('agent-1');
        done();
      });

      manager.register('agent-1');
    });

    it('emits state:changed event', (done) => {
      manager.register('agent-1');

      manager.on('state:changed', (data) => {
        expect(data.agentId).toBe('agent-1');
        expect(data.from).toBe(AgentStates.IDLE);
        expect(data.to).toBe(AgentStates.INITIALIZING);
        done();
      });

      manager.updateState('agent-1', AgentStates.INITIALIZING);
    });

    it('emits agent:unregistered event', (done) => {
      manager.register('agent-1');

      manager.on('agent:unregistered', (data) => {
        expect(data.agentId).toBe('agent-1');
        done();
      });

      manager.unregister('agent-1');
    });
  });
});

describe('StateTransitions', () => {
  it('defines valid transitions for all states', () => {
    const allStates = Object.values(AgentStates);

    for (const state of allStates) {
      expect(StateTransitions[state]).toBeDefined();
      expect(Array.isArray(StateTransitions[state])).toBe(true);
    }
  });

  it('TERMINATED has no valid transitions', () => {
    expect(StateTransitions[AgentStates.TERMINATED]).toEqual([]);
  });

  it('IDLE can transition to INITIALIZING or TERMINATED', () => {
    expect(StateTransitions[AgentStates.IDLE]).toContain(AgentStates.INITIALIZING);
    expect(StateTransitions[AgentStates.IDLE]).toContain(AgentStates.TERMINATED);
  });

  it('ACTIVE can transition to multiple states', () => {
    const transitions = StateTransitions[AgentStates.ACTIVE];
    expect(transitions).toContain(AgentStates.DELEGATING);
    expect(transitions).toContain(AgentStates.WAITING);
    expect(transitions).toContain(AgentStates.COMPLETING);
    expect(transitions).toContain(AgentStates.FAILED);
  });
});

describe('OptimisticLockError', () => {
  it('contains version information', () => {
    const error = new OptimisticLockError('agent-1', 5, 7);

    expect(error.name).toBe('OptimisticLockError');
    expect(error.agentId).toBe('agent-1');
    expect(error.expectedVersion).toBe(5);
    expect(error.actualVersion).toBe(7);
    expect(error.message).toContain('agent-1');
    expect(error.message).toContain('5');
    expect(error.message).toContain('7');
  });
});

describe('InvalidTransitionError', () => {
  it('contains transition information', () => {
    const error = new InvalidTransitionError('agent-1', AgentStates.IDLE, AgentStates.COMPLETED);

    expect(error.name).toBe('InvalidTransitionError');
    expect(error.agentId).toBe('agent-1');
    expect(error.fromState).toBe(AgentStates.IDLE);
    expect(error.toState).toBe(AgentStates.COMPLETED);
    expect(error.allowedTransitions).toEqual(StateTransitions[AgentStates.IDLE]);
  });
});
