/**
 * Hierarchical State Management - State management for agent hierarchies
 *
 * Provides:
 * - Optimistic locking with version numbers
 * - Atomic parent-child state transitions
 * - Aggregate state queries
 * - State machine enforcement
 * - Event logging for audit trail
 *
 * @module hierarchical-state
 */

const EventEmitter = require('events');
const { createComponentLogger } = require('./logger');

const logger = createComponentLogger('HierarchicalState');

/**
 * Valid agent states and their allowed transitions
 */
const AgentStates = {
  IDLE: 'idle',
  INITIALIZING: 'initializing',
  ACTIVE: 'active',
  DELEGATING: 'delegating',
  WAITING: 'waiting',
  COMPLETING: 'completing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  TERMINATED: 'terminated'
};

/**
 * State transition rules (from -> allowed to states)
 */
const StateTransitions = {
  [AgentStates.IDLE]: [AgentStates.INITIALIZING, AgentStates.TERMINATED],
  [AgentStates.INITIALIZING]: [AgentStates.ACTIVE, AgentStates.FAILED, AgentStates.TERMINATED],
  [AgentStates.ACTIVE]: [AgentStates.DELEGATING, AgentStates.WAITING, AgentStates.COMPLETING, AgentStates.FAILED, AgentStates.TERMINATED],
  [AgentStates.DELEGATING]: [AgentStates.WAITING, AgentStates.ACTIVE, AgentStates.FAILED, AgentStates.TERMINATED],
  [AgentStates.WAITING]: [AgentStates.ACTIVE, AgentStates.COMPLETING, AgentStates.FAILED, AgentStates.TERMINATED],
  [AgentStates.COMPLETING]: [AgentStates.COMPLETED, AgentStates.FAILED],
  [AgentStates.COMPLETED]: [AgentStates.IDLE, AgentStates.TERMINATED], // Can be recycled
  [AgentStates.FAILED]: [AgentStates.IDLE, AgentStates.TERMINATED], // Can be restarted
  [AgentStates.TERMINATED]: [] // Terminal state
};

/**
 * Optimistic locking error
 */
class OptimisticLockError extends Error {
  constructor(agentId, expectedVersion, actualVersion) {
    super(`Optimistic lock failed for agent ${agentId}: expected version ${expectedVersion}, got ${actualVersion}`);
    this.name = 'OptimisticLockError';
    this.agentId = agentId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

/**
 * Invalid state transition error
 */
class InvalidTransitionError extends Error {
  constructor(agentId, fromState, toState) {
    super(`Invalid state transition for agent ${agentId}: ${fromState} -> ${toState}`);
    this.name = 'InvalidTransitionError';
    this.agentId = agentId;
    this.fromState = fromState;
    this.toState = toState;
    this.allowedTransitions = StateTransitions[fromState] || [];
  }
}

/**
 * Hierarchical State Manager
 */
class HierarchicalStateManager extends EventEmitter {
  /**
   * Create a hierarchical state manager
   * @param {Object} options - Configuration options
   * @param {number} options.maxEventLogSize - Maximum event log entries per agent
   * @param {number} options.staleTimeout - Time after which inactive agents are considered stale (ms)
   */
  constructor(options = {}) {
    super();
    this.maxEventLogSize = options.maxEventLogSize || 100;
    this.staleTimeout = options.staleTimeout || 300000; // 5 minutes

    // Agent state storage
    this.states = new Map(); // agentId -> AgentStateEntry

    // Hierarchy tracking
    this.parentChildMap = new Map(); // parentId -> Set<childId>
    this.childParentMap = new Map(); // childId -> parentId

    // Event log for audit trail
    this.eventLog = new Map(); // agentId -> Array<StateEvent>

    // Lock management for atomic operations
    this.locks = new Map(); // agentId -> lockInfo

    logger.info('HierarchicalStateManager initialized', {
      staleTimeout: this.staleTimeout
    });
  }

  /**
   * Register an agent with initial state
   * @param {string} agentId - Agent ID
   * @param {Object} options - Registration options
   * @param {string} options.parentId - Parent agent ID
   * @param {Object} options.metadata - Additional metadata
   * @returns {Object} Initial state entry
   */
  register(agentId, options = {}) {
    if (this.states.has(agentId)) {
      throw new Error(`Agent ${agentId} already registered`);
    }

    const entry = {
      agentId,
      state: AgentStates.IDLE,
      version: 1,
      parentId: options.parentId || null,
      metadata: options.metadata || {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stateHistory: [{ state: AgentStates.IDLE, timestamp: Date.now() }]
    };

    this.states.set(agentId, entry);
    this.eventLog.set(agentId, []);

    // Track hierarchy
    if (options.parentId) {
      this.childParentMap.set(agentId, options.parentId);
      if (!this.parentChildMap.has(options.parentId)) {
        this.parentChildMap.set(options.parentId, new Set());
      }
      this.parentChildMap.get(options.parentId).add(agentId);
    }

    this._logEvent(agentId, 'registered', { parentId: options.parentId });

    logger.debug('Agent registered', { agentId, parentId: options.parentId });
    this.emit('agent:registered', { agentId, parentId: options.parentId });

    return entry;
  }

  /**
   * Get current state for an agent
   * @param {string} agentId - Agent ID
   * @returns {Object|null} State entry or null if not found
   */
  getState(agentId) {
    return this.states.get(agentId) || null;
  }

  /**
   * Update agent state with optimistic locking
   * @param {string} agentId - Agent ID
   * @param {string} newState - New state
   * @param {Object} options - Update options
   * @param {number} options.expectedVersion - Expected version for optimistic locking
   * @param {Object} options.metadata - Additional metadata to merge
   * @returns {Object} Updated state entry
   */
  updateState(agentId, newState, options = {}) {
    const entry = this.states.get(agentId);
    if (!entry) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // Optimistic locking check
    if (options.expectedVersion !== undefined && options.expectedVersion !== entry.version) {
      throw new OptimisticLockError(agentId, options.expectedVersion, entry.version);
    }

    // State transition validation
    const oldState = entry.state;
    if (!this._isValidTransition(oldState, newState)) {
      throw new InvalidTransitionError(agentId, oldState, newState);
    }

    // Update state
    entry.state = newState;
    entry.version += 1;
    entry.updatedAt = Date.now();
    entry.stateHistory.push({ state: newState, timestamp: Date.now() });

    // Merge metadata if provided
    if (options.metadata) {
      entry.metadata = { ...entry.metadata, ...options.metadata };
    }

    // Keep state history bounded
    if (entry.stateHistory.length > 50) {
      entry.stateHistory = entry.stateHistory.slice(-50);
    }

    this._logEvent(agentId, 'state-change', {
      from: oldState,
      to: newState,
      version: entry.version
    });

    logger.debug('Agent state updated', { agentId, from: oldState, to: newState, version: entry.version });
    this.emit('state:changed', { agentId, from: oldState, to: newState, version: entry.version });

    return entry;
  }

  /**
   * Atomic parent-child state transition
   * Updates parent and all children atomically
   * @param {string} parentId - Parent agent ID
   * @param {string} parentState - New parent state
   * @param {string} childState - New state for all children
   * @param {Object} options - Options
   * @returns {Object} Result with parent and children updates
   */
  async atomicFamilyTransition(parentId, parentState, childState, options = {}) {
    const lockId = `family-${parentId}-${Date.now()}`;

    try {
      // Acquire locks on parent and all children
      await this._acquireFamilyLock(parentId, lockId);

      const parent = this.states.get(parentId);
      if (!parent) {
        throw new Error(`Parent ${parentId} not found`);
      }

      const children = this.parentChildMap.get(parentId) || new Set();
      const results = { parent: null, children: [] };

      // Validate all transitions first
      if (!this._isValidTransition(parent.state, parentState)) {
        throw new InvalidTransitionError(parentId, parent.state, parentState);
      }

      for (const childId of children) {
        const child = this.states.get(childId);
        if (child && !this._isValidTransition(child.state, childState)) {
          throw new InvalidTransitionError(childId, child.state, childState);
        }
      }

      // Apply parent transition
      results.parent = this.updateState(parentId, parentState, {
        expectedVersion: parent.version,
        metadata: options.parentMetadata
      });

      // Apply child transitions
      for (const childId of children) {
        const child = this.states.get(childId);
        if (child) {
          const updated = this.updateState(childId, childState, {
            expectedVersion: child.version,
            metadata: options.childMetadata
          });
          results.children.push(updated);
        }
      }

      this._logEvent(parentId, 'atomic-family-transition', {
        parentState,
        childState,
        childCount: results.children.length
      });

      return results;

    } finally {
      this._releaseFamilyLock(parentId, lockId);
    }
  }

  /**
   * Get aggregate state for a parent and all descendants
   * @param {string} agentId - Root agent ID
   * @returns {Object} Aggregate state information
   */
  getAggregateState(agentId) {
    const entry = this.states.get(agentId);
    if (!entry) return null;

    const descendants = this._getAllDescendants(agentId);
    const stateCounts = {};

    // Count self
    stateCounts[entry.state] = (stateCounts[entry.state] || 0) + 1;

    // Count descendants
    for (const descId of descendants) {
      const desc = this.states.get(descId);
      if (desc) {
        stateCounts[desc.state] = (stateCounts[desc.state] || 0) + 1;
      }
    }

    return {
      agentId,
      state: entry.state,
      version: entry.version,
      descendantCount: descendants.length,
      stateCounts,
      isFullyComplete: Object.keys(stateCounts).every(s =>
        s === AgentStates.COMPLETED || s === AgentStates.TERMINATED
      ),
      hasFailures: stateCounts[AgentStates.FAILED] > 0,
      activeCount: (stateCounts[AgentStates.ACTIVE] || 0) +
                   (stateCounts[AgentStates.DELEGATING] || 0) +
                   (stateCounts[AgentStates.WAITING] || 0)
    };
  }

  /**
   * Get all children of a parent
   * @param {string} parentId - Parent agent ID
   * @returns {Array<Object>} Child state entries
   */
  getChildren(parentId) {
    const childIds = this.parentChildMap.get(parentId) || new Set();
    return Array.from(childIds)
      .map(id => this.states.get(id))
      .filter(Boolean);
  }

  /**
   * Get parent of a child
   * @param {string} childId - Child agent ID
   * @returns {Object|null} Parent state entry or null
   */
  getParent(childId) {
    const parentId = this.childParentMap.get(childId);
    return parentId ? this.states.get(parentId) : null;
  }

  /**
   * Unregister an agent and optionally cascade to children
   * @param {string} agentId - Agent ID
   * @param {Object} options - Options
   * @param {boolean} options.cascade - Also unregister children (default: true)
   */
  unregister(agentId, options = {}) {
    const cascade = options.cascade !== false;
    const entry = this.states.get(agentId);

    if (!entry) return;

    // Cascade to children first
    if (cascade) {
      const children = this.parentChildMap.get(agentId) || new Set();
      for (const childId of [...children]) {
        this.unregister(childId, { cascade: true });
      }
    }

    // Remove from parent's children
    if (entry.parentId) {
      const siblings = this.parentChildMap.get(entry.parentId);
      if (siblings) {
        siblings.delete(agentId);
      }
      this.childParentMap.delete(agentId);
    }

    // Clean up
    this.states.delete(agentId);
    this.parentChildMap.delete(agentId);
    this.eventLog.delete(agentId);
    this.locks.delete(agentId);

    this.emit('agent:unregistered', { agentId });
    logger.debug('Agent unregistered', { agentId });
  }

  /**
   * Detect and clean up stale sessions
   * Respects hierarchy - cleaning parent also cleans children
   * @returns {Array<string>} IDs of cleaned up agents
   */
  cleanupStale() {
    const now = Date.now();
    const stale = [];

    // Find stale root agents (parents of stale subtrees)
    for (const [agentId, entry] of this.states) {
      // Only check roots or orphans
      if (!entry.parentId && now - entry.updatedAt > this.staleTimeout) {
        if (entry.state !== AgentStates.ACTIVE &&
            entry.state !== AgentStates.DELEGATING &&
            entry.state !== AgentStates.WAITING) {
          stale.push(agentId);
        }
      }
    }

    // Unregister stale trees (cascade handles children)
    for (const agentId of stale) {
      this.unregister(agentId, { cascade: true });
    }

    if (stale.length > 0) {
      logger.info('Cleaned up stale agents', { count: stale.length });
    }

    return stale;
  }

  /**
   * Get event log for an agent
   * @param {string} agentId - Agent ID
   * @returns {Array<Object>} Event log entries
   */
  getEventLog(agentId) {
    return this.eventLog.get(agentId) || [];
  }

  /**
   * Get all event logs merged and sorted
   * @param {Object} options - Filter options
   * @param {number} options.since - Only events after this timestamp
   * @param {string} options.eventType - Filter by event type
   * @returns {Array<Object>} Merged event log
   */
  getAllEvents(options = {}) {
    const allEvents = [];

    for (const [agentId, events] of this.eventLog) {
      for (const event of events) {
        if (options.since && event.timestamp < options.since) continue;
        if (options.eventType && event.type !== options.eventType) continue;
        allEvents.push({ ...event, agentId });
      }
    }

    return allEvents.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Check if a state transition is valid
   * @private
   */
  _isValidTransition(fromState, toState) {
    const allowed = StateTransitions[fromState];
    return allowed && allowed.includes(toState);
  }

  /**
   * Get all descendants of an agent
   * @private
   */
  _getAllDescendants(agentId) {
    const descendants = [];
    const children = this.parentChildMap.get(agentId) || new Set();

    for (const childId of children) {
      descendants.push(childId);
      descendants.push(...this._getAllDescendants(childId));
    }

    return descendants;
  }

  /**
   * Log an event for an agent
   * @private
   */
  _logEvent(agentId, type, data = {}) {
    if (!this.eventLog.has(agentId)) {
      this.eventLog.set(agentId, []);
    }

    const events = this.eventLog.get(agentId);
    events.push({
      type,
      timestamp: Date.now(),
      data
    });

    // Bound event log size
    if (events.length > this.maxEventLogSize) {
      events.shift();
    }
  }

  /**
   * Acquire lock for family (parent + children) operations
   * @private
   */
  async _acquireFamilyLock(parentId, lockId) {
    // Simple lock implementation - in production, use proper mutex
    const maxWait = 5000;
    const start = Date.now();

    while (this.locks.has(parentId)) {
      if (Date.now() - start > maxWait) {
        throw new Error(`Lock timeout for agent ${parentId}`);
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    this.locks.set(parentId, { lockId, acquiredAt: Date.now() });
  }

  /**
   * Release family lock
   * @private
   */
  _releaseFamilyLock(parentId, lockId) {
    const lock = this.locks.get(parentId);
    if (lock && lock.lockId === lockId) {
      this.locks.delete(parentId);
    }
  }

  /**
   * Get statistics about state management
   * @returns {Object} Statistics
   */
  getStats() {
    const stateCounts = {};
    let totalVersions = 0;

    for (const entry of this.states.values()) {
      stateCounts[entry.state] = (stateCounts[entry.state] || 0) + 1;
      totalVersions += entry.version;
    }

    return {
      totalAgents: this.states.size,
      stateCounts,
      avgVersion: this.states.size > 0 ? (totalVersions / this.states.size).toFixed(1) : 0,
      hierarchyCount: this.parentChildMap.size,
      totalEvents: Array.from(this.eventLog.values()).reduce((sum, e) => sum + e.length, 0),
      activeLocks: this.locks.size
    };
  }

  /**
   * Clear all state
   */
  clear() {
    this.states.clear();
    this.parentChildMap.clear();
    this.childParentMap.clear();
    this.eventLog.clear();
    this.locks.clear();

    logger.info('Hierarchical state manager cleared');
  }
}

module.exports = {
  HierarchicalStateManager,
  AgentStates,
  StateTransitions,
  OptimisticLockError,
  InvalidTransitionError
};
