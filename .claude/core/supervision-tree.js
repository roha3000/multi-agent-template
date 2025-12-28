/**
 * Supervision Tree - Hierarchical error handling for agent hierarchies
 *
 * Implements Erlang-style supervision patterns:
 * - one-for-one: Only restart failed child
 * - all-for-one: Restart all children if one fails
 * - rest-for-one: Restart failed child and all started after it
 *
 * @module supervision-tree
 */

const EventEmitter = require('events');
const { createComponentLogger } = require('./logger');

const logger = createComponentLogger('SupervisionTree');

/**
 * Restart strategies for supervision trees
 */
const RestartStrategy = {
  ONE_FOR_ONE: 'one-for-one',
  ALL_FOR_ONE: 'all-for-one',
  REST_FOR_ONE: 'rest-for-one'
};

/**
 * Error class for hierarchical agent errors
 * Preserves error chain and partial results from children
 */
class HierarchicalError extends Error {
  /**
   * Create a hierarchical error
   * @param {string} message - Error message
   * @param {Object} options - Error options
   * @param {string} options.agentId - ID of agent that failed
   * @param {string} options.parentId - ID of parent agent (if any)
   * @param {Array<HierarchicalError>} options.childErrors - Errors from child agents
   * @param {Object} options.partialResults - Any partial results before failure
   * @param {string} options.phase - Phase during which error occurred
   * @param {boolean} options.recoverable - Whether error is recoverable
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'HierarchicalError';
    this.agentId = options.agentId || null;
    this.parentId = options.parentId || null;
    this.childErrors = options.childErrors || [];
    this.partialResults = options.partialResults || null;
    this.phase = options.phase || null;
    this.recoverable = options.recoverable !== false;
    this.timestamp = new Date().toISOString();
    this.errorChain = this._buildErrorChain();

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HierarchicalError);
    }
  }

  /**
   * Build error chain from child errors
   * @private
   */
  _buildErrorChain() {
    const chain = [{
      agentId: this.agentId,
      message: this.message,
      timestamp: this.timestamp
    }];

    for (const childError of this.childErrors) {
      if (childError instanceof HierarchicalError) {
        chain.push(...childError.errorChain);
      } else {
        chain.push({
          agentId: 'unknown',
          message: childError.message || String(childError),
          timestamp: this.timestamp
        });
      }
    }

    return chain;
  }

  /**
   * Get all partial results from this error and children
   * @returns {Object} Aggregated partial results
   */
  getAllPartialResults() {
    const results = {};

    if (this.partialResults && this.agentId) {
      results[this.agentId] = this.partialResults;
    }

    for (const childError of this.childErrors) {
      if (childError instanceof HierarchicalError) {
        Object.assign(results, childError.getAllPartialResults());
      }
    }

    return results;
  }

  /**
   * Check if any part of the hierarchy is recoverable
   * @returns {boolean}
   */
  isPartiallyRecoverable() {
    if (this.recoverable) return true;
    return this.childErrors.some(e =>
      e instanceof HierarchicalError && e.isPartiallyRecoverable()
    );
  }

  /**
   * Get error summary for logging
   * @returns {Object}
   */
  toSummary() {
    return {
      agentId: this.agentId,
      parentId: this.parentId,
      message: this.message,
      childErrorCount: this.childErrors.length,
      hasPartialResults: !!this.partialResults,
      recoverable: this.recoverable,
      timestamp: this.timestamp
    };
  }
}

/**
 * Supervision Tree for managing agent hierarchies
 */
class SupervisionTree extends EventEmitter {
  /**
   * Create a supervision tree
   * @param {Object} options - Configuration options
   * @param {string} options.strategy - Restart strategy
   * @param {number} options.maxRestarts - Maximum restarts within window
   * @param {number} options.restartWindow - Time window for restart limit (ms)
   * @param {number} options.maxDepth - Maximum hierarchy depth (default: 3)
   */
  constructor(options = {}) {
    super();
    this.strategy = options.strategy || RestartStrategy.ONE_FOR_ONE;
    this.maxRestarts = options.maxRestarts || 3;
    this.restartWindow = options.restartWindow || 60000; // 1 minute
    this.maxDepth = options.maxDepth || 3;

    // Node tracking
    this.nodes = new Map(); // agentId -> NodeInfo
    this.roots = new Set(); // Root agent IDs
    this.restartHistory = new Map(); // agentId -> restart timestamps

    // Checkpoint storage for partial result recovery
    this.checkpoints = new Map(); // agentId -> checkpoint data

    logger.info('SupervisionTree initialized', {
      strategy: this.strategy,
      maxRestarts: this.maxRestarts,
      maxDepth: this.maxDepth
    });
  }

  /**
   * Register an agent in the supervision tree
   * @param {string} agentId - Agent ID
   * @param {Object} options - Node options
   * @param {string} options.parentId - Parent agent ID (null for root)
   * @param {string} options.restartPolicy - Override restart policy
   * @param {Function} options.onRestart - Restart callback
   * @param {Function} options.onTerminate - Terminate callback
   * @returns {Object} Node info
   */
  register(agentId, options = {}) {
    const parentId = options.parentId || null;

    // Validate depth
    const depth = parentId ? this._getDepth(parentId) + 1 : 0;
    if (depth > this.maxDepth) {
      throw new Error(`Maximum hierarchy depth (${this.maxDepth}) exceeded for agent ${agentId}`);
    }

    // Validate parent exists
    if (parentId && !this.nodes.has(parentId)) {
      throw new Error(`Parent agent ${parentId} not registered`);
    }

    const nodeInfo = {
      agentId,
      parentId,
      children: [],
      status: 'active',
      depth,
      restartPolicy: options.restartPolicy || this.strategy,
      onRestart: options.onRestart || null,
      onTerminate: options.onTerminate || null,
      registeredAt: Date.now(),
      startOrder: this.nodes.size // For rest-for-one ordering
    };

    this.nodes.set(agentId, nodeInfo);

    // Update parent's children list
    if (parentId) {
      const parent = this.nodes.get(parentId);
      parent.children.push(agentId);
    } else {
      this.roots.add(agentId);
    }

    logger.debug('Agent registered in supervision tree', {
      agentId,
      parentId,
      depth,
      strategy: nodeInfo.restartPolicy
    });

    this.emit('node:registered', { agentId, parentId, depth });

    return nodeInfo;
  }

  /**
   * Unregister an agent and its subtree
   * @param {string} agentId - Agent ID
   * @param {Object} options - Options
   * @param {boolean} options.cleanupChildren - Also remove children (default: true)
   */
  unregister(agentId, options = {}) {
    const cleanupChildren = options.cleanupChildren !== false;
    const node = this.nodes.get(agentId);

    if (!node) {
      logger.warn('Attempted to unregister unknown agent', { agentId });
      return;
    }

    // Recursively unregister children first
    if (cleanupChildren) {
      for (const childId of [...node.children]) {
        this.unregister(childId, { cleanupChildren: true });
      }
    }

    // Remove from parent's children list
    if (node.parentId) {
      const parent = this.nodes.get(node.parentId);
      if (parent) {
        parent.children = parent.children.filter(id => id !== agentId);
      }
    } else {
      this.roots.delete(agentId);
    }

    // Cleanup node data
    this.nodes.delete(agentId);
    this.restartHistory.delete(agentId);
    this.checkpoints.delete(agentId);

    logger.debug('Agent unregistered from supervision tree', { agentId });
    this.emit('node:unregistered', { agentId });
  }

  /**
   * Handle agent failure
   * @param {string} agentId - Failed agent ID
   * @param {Error} error - The error that caused failure
   * @param {Object} options - Options
   * @param {Object} options.partialResults - Any partial results to preserve
   * @returns {Object} Handling result
   */
  async handleFailure(agentId, error, options = {}) {
    const node = this.nodes.get(agentId);

    if (!node) {
      logger.warn('Failure reported for unknown agent', { agentId });
      return { handled: false, reason: 'unknown-agent' };
    }

    logger.warn('Agent failure detected', {
      agentId,
      error: error.message,
      strategy: node.restartPolicy
    });

    // Save checkpoint if partial results provided
    if (options.partialResults) {
      this.saveCheckpoint(agentId, options.partialResults);
    }

    // Mark as failed
    node.status = 'failed';
    node.lastError = error;
    node.failedAt = Date.now();

    // Create hierarchical error
    const hierarchicalError = new HierarchicalError(error.message, {
      agentId,
      parentId: node.parentId,
      partialResults: options.partialResults,
      recoverable: this._canRestart(agentId)
    });

    // Apply restart strategy
    const result = await this._applyRestartStrategy(node, hierarchicalError);

    this.emit('failure:handled', {
      agentId,
      error: hierarchicalError.toSummary(),
      result
    });

    return result;
  }

  /**
   * Apply restart strategy based on node configuration
   * @private
   */
  async _applyRestartStrategy(node, error) {
    const strategy = node.restartPolicy;

    switch (strategy) {
      case RestartStrategy.ONE_FOR_ONE:
        return await this._restartOneForOne(node, error);

      case RestartStrategy.ALL_FOR_ONE:
        return await this._restartAllForOne(node, error);

      case RestartStrategy.REST_FOR_ONE:
        return await this._restartRestForOne(node, error);

      default:
        logger.error('Unknown restart strategy', { strategy });
        return { handled: false, reason: 'unknown-strategy' };
    }
  }

  /**
   * One-for-one: Only restart the failed child
   * @private
   */
  async _restartOneForOne(node, error) {
    const agentId = node.agentId;

    if (!this._canRestart(agentId)) {
      return await this._escalateToParent(node, error);
    }

    this._recordRestart(agentId);
    node.status = 'restarting';

    logger.info('Restarting agent (one-for-one)', { agentId });

    try {
      if (node.onRestart) {
        await node.onRestart(agentId, error);
      }
      node.status = 'active';
      return { handled: true, action: 'restarted', agentId };
    } catch (restartError) {
      return await this._escalateToParent(node, error);
    }
  }

  /**
   * All-for-one: Restart all siblings when one fails
   * @private
   */
  async _restartAllForOne(node, error) {
    const agentId = node.agentId;
    const parent = node.parentId ? this.nodes.get(node.parentId) : null;
    const siblings = parent ? parent.children : [agentId];

    if (!this._canRestart(agentId)) {
      return await this._escalateToParent(node, error);
    }

    this._recordRestart(agentId);

    logger.info('Restarting all siblings (all-for-one)', {
      agentId,
      siblingCount: siblings.length
    });

    const restartResults = [];

    for (const siblingId of siblings) {
      const sibling = this.nodes.get(siblingId);
      if (sibling) {
        sibling.status = 'restarting';
        try {
          if (sibling.onRestart) {
            await sibling.onRestart(siblingId, siblingId === agentId ? error : null);
          }
          sibling.status = 'active';
          restartResults.push({ agentId: siblingId, success: true });
        } catch (restartError) {
          restartResults.push({ agentId: siblingId, success: false, error: restartError.message });
        }
      }
    }

    const allSucceeded = restartResults.every(r => r.success);
    if (allSucceeded) {
      return { handled: true, action: 'all-restarted', agents: siblings };
    } else {
      return await this._escalateToParent(node, error);
    }
  }

  /**
   * Rest-for-one: Restart failed child and all started after it
   * @private
   */
  async _restartRestForOne(node, error) {
    const agentId = node.agentId;
    const parent = node.parentId ? this.nodes.get(node.parentId) : null;

    if (!this._canRestart(agentId)) {
      return await this._escalateToParent(node, error);
    }

    this._recordRestart(agentId);

    // Get siblings started after this one
    const siblings = parent ? parent.children : [agentId];
    const toRestart = siblings.filter(sibId => {
      const sib = this.nodes.get(sibId);
      return sib && sib.startOrder >= node.startOrder;
    });

    logger.info('Restarting rest (rest-for-one)', {
      agentId,
      restartCount: toRestart.length
    });

    // Restart in order
    for (const restartId of toRestart) {
      const restartNode = this.nodes.get(restartId);
      if (restartNode) {
        restartNode.status = 'restarting';
        try {
          if (restartNode.onRestart) {
            await restartNode.onRestart(restartId, restartId === agentId ? error : null);
          }
          restartNode.status = 'active';
        } catch (restartError) {
          return await this._escalateToParent(node, error);
        }
      }
    }

    return { handled: true, action: 'rest-restarted', agents: toRestart };
  }

  /**
   * Escalate failure to parent supervisor
   * @private
   */
  async _escalateToParent(node, error) {
    logger.warn('Escalating failure to parent', {
      agentId: node.agentId,
      parentId: node.parentId
    });

    // Terminate this agent and children
    await this.terminate(node.agentId);

    if (node.parentId) {
      // Propagate error up
      const parentError = new HierarchicalError(
        `Child agent ${node.agentId} failed: ${error.message}`,
        {
          agentId: node.parentId,
          parentId: this.nodes.get(node.parentId)?.parentId,
          childErrors: [error]
        }
      );

      return await this.handleFailure(node.parentId, parentError);
    }

    // Reached root, emit fatal error
    this.emit('failure:fatal', {
      agentId: node.agentId,
      error: error.toSummary()
    });

    return { handled: false, reason: 'max-restarts-exceeded', fatal: true };
  }

  /**
   * Terminate an agent and clean up orphans
   * @param {string} agentId - Agent to terminate
   */
  async terminate(agentId) {
    const node = this.nodes.get(agentId);
    if (!node) return;

    logger.info('Terminating agent', { agentId, childCount: node.children.length });

    // Terminate children first (orphan cleanup)
    for (const childId of [...node.children]) {
      await this.terminate(childId);
    }

    node.status = 'terminated';

    // Call terminate callback
    if (node.onTerminate) {
      try {
        await node.onTerminate(agentId);
      } catch (error) {
        logger.warn('Terminate callback failed', { agentId, error: error.message });
      }
    }

    this.emit('node:terminated', { agentId });
  }

  /**
   * Check if agent can be restarted
   * @private
   */
  _canRestart(agentId) {
    const history = this.restartHistory.get(agentId) || [];
    const windowStart = Date.now() - this.restartWindow;
    const recentRestarts = history.filter(t => t > windowStart);

    return recentRestarts.length < this.maxRestarts;
  }

  /**
   * Record a restart timestamp
   * @private
   */
  _recordRestart(agentId) {
    if (!this.restartHistory.has(agentId)) {
      this.restartHistory.set(agentId, []);
    }
    this.restartHistory.get(agentId).push(Date.now());
  }

  /**
   * Get depth of an agent in the tree
   * @private
   */
  _getDepth(agentId) {
    const node = this.nodes.get(agentId);
    return node ? node.depth : -1;
  }

  /**
   * Save checkpoint for partial result recovery
   * @param {string} agentId - Agent ID
   * @param {Object} data - Checkpoint data
   */
  saveCheckpoint(agentId, data) {
    this.checkpoints.set(agentId, {
      data,
      timestamp: Date.now()
    });

    logger.debug('Checkpoint saved', { agentId });
  }

  /**
   * Get checkpoint for an agent
   * @param {string} agentId - Agent ID
   * @returns {Object|null} Checkpoint data
   */
  getCheckpoint(agentId) {
    const checkpoint = this.checkpoints.get(agentId);
    return checkpoint ? checkpoint.data : null;
  }

  /**
   * Detect orphaned agents (agents whose parent is terminated/failed)
   * @returns {Array<string>} Orphaned agent IDs
   */
  detectOrphans() {
    const orphans = [];

    for (const [agentId, node] of this.nodes) {
      if (node.parentId) {
        const parent = this.nodes.get(node.parentId);
        if (!parent || parent.status === 'terminated' || parent.status === 'failed') {
          orphans.push(agentId);
        }
      }
    }

    return orphans;
  }

  /**
   * Clean up orphaned agents
   * @returns {number} Number of orphans cleaned
   */
  async cleanupOrphans() {
    const orphans = this.detectOrphans();

    logger.info('Cleaning up orphans', { count: orphans.length });

    for (const orphanId of orphans) {
      await this.terminate(orphanId);
      this.unregister(orphanId);
    }

    return orphans.length;
  }

  /**
   * Get hierarchy tree starting from an agent
   * @param {string} agentId - Root agent ID
   * @returns {Object} Tree structure
   */
  getHierarchy(agentId) {
    const node = this.nodes.get(agentId);
    if (!node) return null;

    return {
      agentId: node.agentId,
      status: node.status,
      depth: node.depth,
      children: node.children.map(childId => this.getHierarchy(childId)).filter(Boolean)
    };
  }

  /**
   * Get all agents at a specific depth
   * @param {number} depth - Depth level
   * @returns {Array<string>} Agent IDs at that depth
   */
  getAgentsAtDepth(depth) {
    const agents = [];
    for (const [agentId, node] of this.nodes) {
      if (node.depth === depth) {
        agents.push(agentId);
      }
    }
    return agents;
  }

  /**
   * Get supervision tree statistics
   * @returns {Object} Statistics
   */
  getStats() {
    const statusCounts = { active: 0, failed: 0, restarting: 0, terminated: 0 };

    for (const node of this.nodes.values()) {
      statusCounts[node.status] = (statusCounts[node.status] || 0) + 1;
    }

    return {
      totalNodes: this.nodes.size,
      rootCount: this.roots.size,
      maxDepth: Math.max(0, ...Array.from(this.nodes.values()).map(n => n.depth)),
      statusCounts,
      checkpointCount: this.checkpoints.size,
      strategy: this.strategy
    };
  }

  /**
   * Clear all nodes and reset tree
   */
  clear() {
    this.nodes.clear();
    this.roots.clear();
    this.restartHistory.clear();
    this.checkpoints.clear();

    logger.info('Supervision tree cleared');
  }
}

module.exports = {
  SupervisionTree,
  HierarchicalError,
  RestartStrategy
};
