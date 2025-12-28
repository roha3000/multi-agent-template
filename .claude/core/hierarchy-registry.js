/**
 * Hierarchy Registry - Centralized tracking of agent hierarchies
 *
 * Provides:
 * - Parent-child agent relationship tracking
 * - Delegation chain management
 * - Quick lookup indexes (byParent, byDepth, byStatus)
 * - Hierarchy traversal and pruning
 * - Integration with SupervisionTree and HierarchicalStateManager
 *
 * @module hierarchy-registry
 */

const EventEmitter = require('events');
const { createComponentLogger } = require('./logger');

const logger = createComponentLogger('HierarchyRegistry');

/**
 * Delegation status values
 */
const DelegationStatus = {
  PENDING: 'pending',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

/**
 * Error for hierarchy-related operations
 */
class HierarchyError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'HierarchyError';
    this.agentId = options.agentId || null;
    this.parentId = options.parentId || null;
    this.code = options.code || 'HIERARCHY_ERROR';
  }
}

/**
 * Hierarchy Registry for centralized agent hierarchy tracking
 * @extends EventEmitter
 */
class HierarchyRegistry extends EventEmitter {
  /**
   * Create a hierarchy registry
   * @param {Object} options - Configuration options
   * @param {number} options.maxDepth - Maximum allowed hierarchy depth (default: 3)
   * @param {number} options.maxChildren - Maximum children per agent (default: 10)
   */
  constructor(options = {}) {
    super();
    this.maxDepth = options.maxDepth || 3;
    this.maxChildren = options.maxChildren || 10;

    // Core storage
    this.nodes = new Map();       // agentId -> HierarchyNode
    this.roots = new Set();       // Root agent IDs (no parent)
    this.delegations = new Map(); // delegationId -> DelegationRecord

    // Quick lookup indexes
    this.byParent = new Map();    // parentId -> Set<childId>
    this.byDepth = new Map();     // depth -> Set<agentId>
    this.byStatus = new Map();    // status -> Set<agentId>

    // Initialize depth buckets
    for (let i = 0; i <= this.maxDepth; i++) {
      this.byDepth.set(i, new Set());
    }

    // Initialize status buckets
    Object.values(DelegationStatus).forEach(status => {
      this.byStatus.set(status, new Set());
    });

    logger.info('HierarchyRegistry initialized', {
      maxDepth: this.maxDepth,
      maxChildren: this.maxChildren
    });
  }

  /**
   * Register a hierarchy relationship between parent and child agent
   * @param {string} parentId - Parent agent ID (null for root)
   * @param {string} childId - Child agent ID
   * @param {Object} metadata - Additional metadata
   * @param {string} metadata.delegationId - Associated delegation ID
   * @param {string} metadata.taskId - Associated task ID
   * @param {string} metadata.agentType - Type of child agent
   * @returns {Object} Created hierarchy node
   */
  registerHierarchy(parentId, childId, metadata = {}) {
    // Validate child doesn't already exist
    if (this.nodes.has(childId)) {
      throw new HierarchyError(`Agent ${childId} already registered in hierarchy`, {
        agentId: childId,
        code: 'ALREADY_REGISTERED'
      });
    }

    // Calculate depth
    let depth = 0;
    if (parentId) {
      const parentNode = this.nodes.get(parentId);
      if (!parentNode) {
        throw new HierarchyError(`Parent agent ${parentId} not found in hierarchy`, {
          agentId: childId,
          parentId,
          code: 'PARENT_NOT_FOUND'
        });
      }
      depth = parentNode.depth + 1;

      // Validate depth limit
      if (depth > this.maxDepth) {
        throw new HierarchyError(
          `Maximum hierarchy depth (${this.maxDepth}) exceeded`,
          { agentId: childId, parentId, code: 'MAX_DEPTH_EXCEEDED' }
        );
      }

      // Validate children limit
      const siblings = this.byParent.get(parentId) || new Set();
      if (siblings.size >= this.maxChildren) {
        throw new HierarchyError(
          `Maximum children (${this.maxChildren}) exceeded for parent ${parentId}`,
          { agentId: childId, parentId, code: 'MAX_CHILDREN_EXCEEDED' }
        );
      }
    }

    // Detect cycles
    if (this._wouldCreateCycle(parentId, childId)) {
      throw new HierarchyError(
        `Registering ${childId} under ${parentId} would create a cycle`,
        { agentId: childId, parentId, code: 'CYCLE_DETECTED' }
      );
    }

    // Create node
    const node = {
      agentId: childId,
      parentId: parentId || null,
      children: [],
      depth,
      status: DelegationStatus.ACTIVE,
      metadata: {
        delegationId: metadata.delegationId || null,
        taskId: metadata.taskId || null,
        agentType: metadata.agentType || 'generic',
        ...metadata
      },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // Store node
    this.nodes.set(childId, node);

    // Update indexes
    this._updateIndexes(childId, node, 'add');

    // Update parent's children list
    if (parentId) {
      const parentNode = this.nodes.get(parentId);
      parentNode.children.push(childId);

      if (!this.byParent.has(parentId)) {
        this.byParent.set(parentId, new Set());
      }
      this.byParent.get(parentId).add(childId);
    } else {
      // Root node
      this.roots.add(childId);
    }

    logger.debug('Hierarchy registered', { parentId, childId, depth });
    this.emit('hierarchy:registered', { parentId, childId, depth, metadata });

    return node;
  }

  /**
   * Register a delegation record
   * @param {string} delegationId - Unique delegation ID
   * @param {Object} record - Delegation record data
   * @returns {Object} Created delegation record
   */
  registerDelegation(delegationId, record) {
    if (this.delegations.has(delegationId)) {
      throw new HierarchyError(`Delegation ${delegationId} already exists`, {
        code: 'DELEGATION_EXISTS'
      });
    }

    const delegation = {
      delegationId,
      parentAgentId: record.parentAgentId,
      childAgentId: record.childAgentId,
      taskId: record.taskId,
      status: DelegationStatus.PENDING,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: null,
      result: null,
      error: null,
      metadata: record.metadata || {}
    };

    this.delegations.set(delegationId, delegation);

    logger.debug('Delegation registered', { delegationId, parentAgentId: record.parentAgentId });
    this.emit('delegation:registered', delegation);

    return delegation;
  }

  /**
   * Update delegation status
   * @param {string} delegationId - Delegation ID
   * @param {string} status - New status
   * @param {Object} data - Additional data (result, error)
   * @returns {Object} Updated delegation record
   */
  updateDelegationStatus(delegationId, status, data = {}) {
    const delegation = this.delegations.get(delegationId);
    if (!delegation) {
      throw new HierarchyError(`Delegation ${delegationId} not found`, {
        code: 'DELEGATION_NOT_FOUND'
      });
    }

    const oldStatus = delegation.status;
    delegation.status = status;
    delegation.updatedAt = Date.now();

    if (status === DelegationStatus.COMPLETED || status === DelegationStatus.FAILED) {
      delegation.completedAt = Date.now();
    }

    if (data.result !== undefined) delegation.result = data.result;
    if (data.error !== undefined) delegation.error = data.error;

    // Update associated agent node status
    if (delegation.childAgentId && this.nodes.has(delegation.childAgentId)) {
      this.updateNodeStatus(delegation.childAgentId, status);
    }

    logger.debug('Delegation status updated', { delegationId, oldStatus, status });
    this.emit('delegation:updated', { delegationId, oldStatus, status, delegation });

    return delegation;
  }

  /**
   * Update node status
   * @param {string} agentId - Agent ID
   * @param {string} status - New status
   */
  updateNodeStatus(agentId, status) {
    const node = this.nodes.get(agentId);
    if (!node) return;

    const oldStatus = node.status;

    // Remove from old status index
    const oldStatusSet = this.byStatus.get(oldStatus);
    if (oldStatusSet) oldStatusSet.delete(agentId);

    // Update status
    node.status = status;
    node.updatedAt = Date.now();

    // Add to new status index
    if (!this.byStatus.has(status)) {
      this.byStatus.set(status, new Set());
    }
    this.byStatus.get(status).add(agentId);

    this.emit('node:statusChanged', { agentId, oldStatus, status });
  }

  /**
   * Get hierarchy tree starting from an agent
   * @param {string} agentId - Root agent ID for the subtree
   * @returns {Object|null} Hierarchy tree or null if not found
   */
  getHierarchy(agentId) {
    const node = this.nodes.get(agentId);
    if (!node) return null;

    return {
      agentId: node.agentId,
      parentId: node.parentId,
      depth: node.depth,
      status: node.status,
      metadata: node.metadata,
      createdAt: node.createdAt,
      children: node.children
        .map(childId => this.getHierarchy(childId))
        .filter(Boolean)
    };
  }

  /**
   * Get delegation chain from root to a specific agent
   * @param {string} agentId - Target agent ID
   * @returns {Array<Object>} Array of nodes from root to agent
   */
  getDelegationChain(agentId) {
    const chain = [];
    let currentId = agentId;

    while (currentId) {
      const node = this.nodes.get(currentId);
      if (!node) break;

      chain.unshift({
        agentId: node.agentId,
        parentId: node.parentId,
        depth: node.depth,
        status: node.status,
        delegationId: node.metadata.delegationId
      });

      currentId = node.parentId;
    }

    return chain;
  }

  /**
   * Get all ancestors of an agent
   * @param {string} agentId - Agent ID
   * @returns {Array<string>} Array of ancestor agent IDs (from parent to root)
   */
  getAncestors(agentId) {
    const ancestors = [];
    let currentId = this.nodes.get(agentId)?.parentId;

    while (currentId) {
      ancestors.push(currentId);
      currentId = this.nodes.get(currentId)?.parentId;
    }

    return ancestors;
  }

  /**
   * Get all descendants of an agent
   * @param {string} agentId - Agent ID
   * @returns {Array<string>} Array of all descendant agent IDs
   */
  getDescendants(agentId) {
    const descendants = [];
    const node = this.nodes.get(agentId);
    if (!node) return descendants;

    for (const childId of node.children) {
      descendants.push(childId);
      descendants.push(...this.getDescendants(childId));
    }

    return descendants;
  }

  /**
   * Prune hierarchy - remove agent and all its descendants
   * @param {string} rootId - Root of subtree to prune
   * @returns {Object} Pruning result with removed nodes
   */
  pruneHierarchy(rootId) {
    const node = this.nodes.get(rootId);
    if (!node) {
      return { pruned: false, removedNodes: [] };
    }

    const removedNodes = [];

    // Recursively prune children first (post-order)
    for (const childId of [...node.children]) {
      const childResult = this.pruneHierarchy(childId);
      removedNodes.push(...childResult.removedNodes);
    }

    // Remove this node from indexes
    this._updateIndexes(rootId, node, 'remove');

    // Remove from parent's children list
    if (node.parentId) {
      const parentNode = this.nodes.get(node.parentId);
      if (parentNode) {
        parentNode.children = parentNode.children.filter(id => id !== rootId);
      }
      const parentChildren = this.byParent.get(node.parentId);
      if (parentChildren) parentChildren.delete(rootId);
    } else {
      this.roots.delete(rootId);
    }

    // Remove node
    this.nodes.delete(rootId);
    removedNodes.push(rootId);

    // Clean up associated delegations
    for (const [delegationId, delegation] of this.delegations) {
      if (delegation.childAgentId === rootId || delegation.parentAgentId === rootId) {
        this.delegations.delete(delegationId);
      }
    }

    logger.debug('Hierarchy pruned', { rootId, removedCount: removedNodes.length });
    this.emit('hierarchy:pruned', { rootId, removedNodes });

    return { pruned: true, removedNodes };
  }

  /**
   * Get node by agent ID
   * @param {string} agentId - Agent ID
   * @returns {Object|null} Node or null
   */
  getNode(agentId) {
    return this.nodes.get(agentId) || null;
  }

  /**
   * Get delegation by ID
   * @param {string} delegationId - Delegation ID
   * @returns {Object|null} Delegation record or null
   */
  getDelegation(delegationId) {
    return this.delegations.get(delegationId) || null;
  }

  /**
   * Get all agents by status
   * @param {string} status - Status to filter by
   * @returns {Array<string>} Agent IDs with that status
   */
  getByStatus(status) {
    const statusSet = this.byStatus.get(status);
    return statusSet ? Array.from(statusSet) : [];
  }

  /**
   * Get all agents at a specific depth
   * @param {number} depth - Depth level
   * @returns {Array<string>} Agent IDs at that depth
   */
  getByDepth(depth) {
    const depthSet = this.byDepth.get(depth);
    return depthSet ? Array.from(depthSet) : [];
  }

  /**
   * Get all children of a parent
   * @param {string} parentId - Parent agent ID
   * @returns {Array<string>} Child agent IDs
   */
  getChildren(parentId) {
    const childSet = this.byParent.get(parentId);
    return childSet ? Array.from(childSet) : [];
  }

  /**
   * Get all root agents (no parent)
   * @returns {Array<string>} Root agent IDs
   */
  getRoots() {
    return Array.from(this.roots);
  }

  /**
   * Get all active delegations
   * @returns {Array<Object>} Active delegation records
   */
  getActiveDelegations() {
    return Array.from(this.delegations.values())
      .filter(d => d.status === DelegationStatus.ACTIVE || d.status === DelegationStatus.PENDING);
  }

  /**
   * Check if agent can delegate (within depth limit and children limit)
   * @param {string} agentId - Agent ID
   * @returns {Object} Delegation capability info
   */
  canDelegate(agentId) {
    const node = this.nodes.get(agentId);
    if (!node) {
      return { canDelegate: false, reason: 'Agent not found in hierarchy' };
    }

    if (node.depth >= this.maxDepth) {
      return { canDelegate: false, reason: 'Maximum depth reached' };
    }

    if (node.children.length >= this.maxChildren) {
      return { canDelegate: false, reason: 'Maximum children reached' };
    }

    return {
      canDelegate: true,
      remainingDepth: this.maxDepth - node.depth,
      remainingChildren: this.maxChildren - node.children.length
    };
  }

  /**
   * Find common ancestor of two agents
   * @param {string} agentId1 - First agent ID
   * @param {string} agentId2 - Second agent ID
   * @returns {string|null} Common ancestor ID or null
   */
  findCommonAncestor(agentId1, agentId2) {
    const ancestors1 = new Set([agentId1, ...this.getAncestors(agentId1)]);

    let currentId = agentId2;
    while (currentId) {
      if (ancestors1.has(currentId)) {
        return currentId;
      }
      currentId = this.nodes.get(currentId)?.parentId;
    }

    return null;
  }

  /**
   * Get registry statistics
   * @returns {Object} Statistics
   */
  getStats() {
    const statusCounts = {};
    const depthCounts = {};

    for (const node of this.nodes.values()) {
      statusCounts[node.status] = (statusCounts[node.status] || 0) + 1;
      depthCounts[node.depth] = (depthCounts[node.depth] || 0) + 1;
    }

    return {
      totalNodes: this.nodes.size,
      rootCount: this.roots.size,
      totalDelegations: this.delegations.size,
      activeDelegations: this.getActiveDelegations().length,
      statusCounts,
      depthCounts,
      maxDepth: this.maxDepth,
      maxChildren: this.maxChildren
    };
  }

  /**
   * Clear all registry data
   */
  clear() {
    this.nodes.clear();
    this.roots.clear();
    this.delegations.clear();
    this.byParent.clear();

    // Reset depth buckets
    for (let i = 0; i <= this.maxDepth; i++) {
      this.byDepth.set(i, new Set());
    }

    // Reset status buckets
    Object.values(DelegationStatus).forEach(status => {
      this.byStatus.set(status, new Set());
    });

    logger.info('HierarchyRegistry cleared');
    this.emit('registry:cleared');
  }

  /**
   * Export registry state for persistence
   * @returns {Object} Serializable state
   */
  exportState() {
    return {
      nodes: Array.from(this.nodes.entries()),
      roots: Array.from(this.roots),
      delegations: Array.from(this.delegations.entries()),
      exportedAt: Date.now()
    };
  }

  /**
   * Import registry state
   * @param {Object} state - Previously exported state
   */
  importState(state) {
    this.clear();

    // Restore nodes
    for (const [agentId, node] of state.nodes) {
      this.nodes.set(agentId, node);
      this._updateIndexes(agentId, node, 'add');
    }

    // Restore roots
    for (const rootId of state.roots) {
      this.roots.add(rootId);
    }

    // Restore delegations
    for (const [delegationId, delegation] of state.delegations) {
      this.delegations.set(delegationId, delegation);
    }

    // Rebuild byParent index
    for (const [agentId, node] of this.nodes) {
      if (node.parentId) {
        if (!this.byParent.has(node.parentId)) {
          this.byParent.set(node.parentId, new Set());
        }
        this.byParent.get(node.parentId).add(agentId);
      }
    }

    logger.info('HierarchyRegistry state imported', { nodeCount: this.nodes.size });
  }

  /**
   * Update indexes when adding/removing a node
   * @private
   */
  _updateIndexes(agentId, node, operation) {
    if (operation === 'add') {
      // Add to depth index
      if (!this.byDepth.has(node.depth)) {
        this.byDepth.set(node.depth, new Set());
      }
      this.byDepth.get(node.depth).add(agentId);

      // Add to status index
      if (!this.byStatus.has(node.status)) {
        this.byStatus.set(node.status, new Set());
      }
      this.byStatus.get(node.status).add(agentId);

    } else if (operation === 'remove') {
      // Remove from depth index
      const depthSet = this.byDepth.get(node.depth);
      if (depthSet) depthSet.delete(agentId);

      // Remove from status index
      const statusSet = this.byStatus.get(node.status);
      if (statusSet) statusSet.delete(agentId);

      // Remove from byParent index
      if (node.parentId) {
        const parentChildren = this.byParent.get(node.parentId);
        if (parentChildren) parentChildren.delete(agentId);
      }
    }
  }

  /**
   * Check if adding a child would create a cycle
   * @private
   */
  _wouldCreateCycle(parentId, childId) {
    if (!parentId) return false;
    if (parentId === childId) return true;

    // Check if childId is an ancestor of parentId
    let currentId = parentId;
    while (currentId) {
      if (currentId === childId) return true;
      currentId = this.nodes.get(currentId)?.parentId;
    }

    return false;
  }
}

// Singleton instance
let instance = null;

/**
 * Get the singleton HierarchyRegistry instance
 * @param {Object} options - Options for initialization (only used on first call)
 * @returns {HierarchyRegistry}
 */
function getHierarchyRegistry(options = {}) {
  if (!instance) {
    instance = new HierarchyRegistry(options);
  }
  return instance;
}

/**
 * Reset the singleton instance (mainly for testing)
 */
function resetHierarchyRegistry() {
  if (instance) {
    instance.clear();
    instance.removeAllListeners();
    instance = null;
  }
}

module.exports = {
  HierarchyRegistry,
  HierarchyError,
  DelegationStatus,
  getHierarchyRegistry,
  resetHierarchyRegistry
};
