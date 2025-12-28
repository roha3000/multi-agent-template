/**
 * Agent - Base class for all agents in the multi-agent system
 *
 * Provides core agent functionality including:
 * - Message passing via MessageBus
 * - Task execution interface
 * - State management
 * - Error handling
 * - Hierarchy support (parent-child relationships, delegation)
 *
 * @module agent
 */

const { createComponentLogger } = require('./logger');
const { getHierarchyRegistry, DelegationStatus } = require('./hierarchy-registry');

/**
 * Default resource quotas for agents
 */
const DEFAULT_QUOTAS = {
  maxTokens: 100000,     // Maximum tokens agent can use
  maxTime: 300000,       // Maximum execution time in ms (5 min)
  maxChildren: 10        // Maximum child agents that can be spawned
};

class Agent {
  /**
   * Create an agent
   * @param {string} id - Unique agent identifier
   * @param {string} role - Agent role/specialty (e.g., 'Researcher', 'Developer')
   * @param {MessageBus} messageBus - Message bus instance
   * @param {Object} config - Agent configuration
   * @param {Object} config.hierarchy - Hierarchy configuration
   * @param {string} config.hierarchy.parentAgentId - Parent agent ID (null for root)
   * @param {number} config.hierarchy.maxDepth - Max delegation depth (default: 3)
   * @param {Object} config.quotas - Resource quotas
   */
  constructor(id, role, messageBus, config = {}) {
    this.id = id;
    this.role = role;
    this.messageBus = messageBus;
    this.config = {
      timeout: 60000, // Default 60s timeout
      retries: 3,
      ...config
    };

    this.logger = createComponentLogger(`Agent:${id}`);
    this.state = 'idle'; // idle, working, completed, failed
    this.subscriptions = [];
    this.executionHistory = [];

    // Initialize hierarchy info
    const hierarchyConfig = config.hierarchy || {};
    this.hierarchyInfo = {
      parentAgentId: hierarchyConfig.parentAgentId || null,
      childAgentIds: [],
      delegationChain: [],
      depth: 0,
      isRoot: !hierarchyConfig.parentAgentId,
      maxDepth: hierarchyConfig.maxDepth || 3
    };

    // Initialize resource quotas
    this.quotas = {
      ...DEFAULT_QUOTAS,
      ...(config.quotas || {})
    };

    // Resource usage tracking
    this.resourceUsage = {
      tokensUsed: 0,
      timeUsed: 0,
      childrenSpawned: 0,
      startTime: null
    };

    // Register in hierarchy if parent is specified
    this._initializeHierarchy(hierarchyConfig);
  }

  /**
   * Initialize hierarchy registration
   * @private
   */
  _initializeHierarchy(hierarchyConfig) {
    try {
      const registry = getHierarchyRegistry();

      // Register this agent in the hierarchy
      const metadata = {
        agentType: this.role,
        taskId: this.config.taskId || null,
        delegationId: hierarchyConfig.delegationId || null
      };

      const node = registry.registerHierarchy(
        this.hierarchyInfo.parentAgentId,
        this.id,
        metadata
      );

      // Update hierarchy info from registry
      this.hierarchyInfo.depth = node.depth;
      this.hierarchyInfo.delegationChain = registry.getDelegationChain(this.id);

      // Subscribe to hierarchy events for this agent
      if (this.messageBus) {
        this._subscribeToHierarchyEvents();
      }

      this.logger.debug('Agent registered in hierarchy', {
        agentId: this.id,
        parentId: this.hierarchyInfo.parentAgentId,
        depth: this.hierarchyInfo.depth
      });

    } catch (error) {
      // Log but don't fail - hierarchy is optional for backward compatibility
      this.logger.debug('Hierarchy registration skipped', {
        agentId: this.id,
        reason: error.message
      });
    }
  }

  /**
   * Subscribe to hierarchy-related events
   * @private
   */
  _subscribeToHierarchyEvents() {
    // Listen for child agent reports
    this.subscribe(`agent:${this.id}:child-report`, (message) => {
      this._handleChildReport(message);
    });

    // Listen for parent commands
    if (this.hierarchyInfo.parentAgentId) {
      this.subscribe(`agent:${this.id}:parent-command`, (message) => {
        this._handleParentCommand(message);
      });
    }
  }

  /**
   * Handle reports from child agents
   * @private
   */
  _handleChildReport(message) {
    const { childAgentId, type, data } = message;

    this.logger.debug('Received child report', { childAgentId, type });

    // Emit event for orchestrator/custom handling
    this.messageBus.publish(`agent:${this.id}:child-update`, {
      parentAgentId: this.id,
      childAgentId,
      type,
      data,
      timestamp: Date.now()
    }, this.id);
  }

  /**
   * Handle commands from parent agent
   * @private
   */
  _handleParentCommand(message) {
    const { command, data } = message;

    this.logger.debug('Received parent command', { command });

    switch (command) {
      case 'cancel':
        this.setState('cancelled');
        break;
      case 'pause':
        this.setState('paused');
        break;
      case 'resume':
        if (this.state === 'paused') {
          this.setState('working');
        }
        break;
      default:
        this.logger.warn('Unknown parent command', { command });
    }
  }

  /**
   * Execute a task (must be implemented by subclasses)
   * @param {Object} task - Task to execute
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async execute(task, context = {}) {
    throw new Error(`Agent ${this.id} must implement execute() method`);
  }

  // ============================================
  // HIERARCHY METHODS
  // ============================================

  /**
   * Check if this agent can delegate to sub-agents
   * @returns {Object} Delegation capability info
   */
  canDelegate() {
    // Check local constraints first
    if (this.hierarchyInfo.depth >= this.hierarchyInfo.maxDepth) {
      return {
        canDelegate: false,
        reason: 'Maximum hierarchy depth reached',
        depth: this.hierarchyInfo.depth,
        maxDepth: this.hierarchyInfo.maxDepth
      };
    }

    if (this.resourceUsage.childrenSpawned >= this.quotas.maxChildren) {
      return {
        canDelegate: false,
        reason: 'Maximum children quota reached',
        childrenSpawned: this.resourceUsage.childrenSpawned,
        maxChildren: this.quotas.maxChildren
      };
    }

    // Check registry for additional constraints
    try {
      const registry = getHierarchyRegistry();
      const registryCheck = registry.canDelegate(this.id);

      if (!registryCheck.canDelegate) {
        return registryCheck;
      }

      return {
        canDelegate: true,
        remainingDepth: this.hierarchyInfo.maxDepth - this.hierarchyInfo.depth,
        remainingChildren: this.quotas.maxChildren - this.resourceUsage.childrenSpawned,
        currentDepth: this.hierarchyInfo.depth
      };

    } catch (error) {
      // If registry not available, use local constraints only
      return {
        canDelegate: true,
        remainingDepth: this.hierarchyInfo.maxDepth - this.hierarchyInfo.depth,
        remainingChildren: this.quotas.maxChildren - this.resourceUsage.childrenSpawned,
        currentDepth: this.hierarchyInfo.depth
      };
    }
  }

  /**
   * Get parent agent info from hierarchy registry
   * @returns {Object|null} Parent agent node info or null if root
   */
  getParent() {
    if (!this.hierarchyInfo.parentAgentId) {
      return null;
    }

    try {
      const registry = getHierarchyRegistry();
      return registry.getNode(this.hierarchyInfo.parentAgentId);
    } catch (error) {
      this.logger.debug('Could not get parent from registry', {
        parentId: this.hierarchyInfo.parentAgentId,
        reason: error.message
      });
      return null;
    }
  }

  /**
   * Get all child agents from hierarchy registry
   * @returns {Array<Object>} Array of child agent node info
   */
  getChildren() {
    try {
      const registry = getHierarchyRegistry();
      const childIds = registry.getChildren(this.id);

      return childIds.map(childId => registry.getNode(childId)).filter(Boolean);
    } catch (error) {
      this.logger.debug('Could not get children from registry', {
        agentId: this.id,
        reason: error.message
      });
      return [];
    }
  }

  /**
   * Get the full delegation chain from root to this agent
   * @returns {Array<Object>} Array of agent nodes from root to this agent
   */
  getDelegationChain() {
    try {
      const registry = getHierarchyRegistry();
      return registry.getDelegationChain(this.id);
    } catch (error) {
      return this.hierarchyInfo.delegationChain || [];
    }
  }

  /**
   * Report progress/status to parent agent
   * @param {Object} report - Report data
   * @param {string} report.type - Report type ('progress', 'result', 'error', 'status')
   * @param {*} report.data - Report payload
   * @returns {boolean} Whether report was sent successfully
   */
  reportToParent(report) {
    if (!this.hierarchyInfo.parentAgentId) {
      this.logger.debug('No parent to report to (root agent)');
      return false;
    }

    if (!this.messageBus) {
      this.logger.warn('Cannot report to parent - no message bus');
      return false;
    }

    const reportMessage = {
      childAgentId: this.id,
      type: report.type || 'progress',
      data: report.data,
      depth: this.hierarchyInfo.depth,
      timestamp: Date.now()
    };

    // Publish to parent's child-report topic
    const topic = `agent:${this.hierarchyInfo.parentAgentId}:child-report`;
    this.messageBus.publish(topic, reportMessage, this.id);

    this.logger.debug('Reported to parent', {
      parentId: this.hierarchyInfo.parentAgentId,
      type: report.type
    });

    return true;
  }

  /**
   * Register a child agent in this agent's hierarchy
   * @param {string} childAgentId - Child agent ID
   * @returns {boolean} Whether registration was successful
   */
  registerChild(childAgentId) {
    if (!this.canDelegate().canDelegate) {
      this.logger.warn('Cannot register child - delegation not allowed');
      return false;
    }

    // Add to local tracking
    if (!this.hierarchyInfo.childAgentIds.includes(childAgentId)) {
      this.hierarchyInfo.childAgentIds.push(childAgentId);
      this.resourceUsage.childrenSpawned++;
    }

    this.logger.debug('Child agent registered', {
      parentId: this.id,
      childId: childAgentId,
      totalChildren: this.hierarchyInfo.childAgentIds.length
    });

    return true;
  }

  /**
   * Unregister a child agent from this agent's hierarchy
   * @param {string} childAgentId - Child agent ID
   * @returns {boolean} Whether unregistration was successful
   */
  unregisterChild(childAgentId) {
    const index = this.hierarchyInfo.childAgentIds.indexOf(childAgentId);
    if (index === -1) {
      return false;
    }

    this.hierarchyInfo.childAgentIds.splice(index, 1);

    this.logger.debug('Child agent unregistered', {
      parentId: this.id,
      childId: childAgentId,
      remainingChildren: this.hierarchyInfo.childAgentIds.length
    });

    return true;
  }

  /**
   * Send a command to a child agent
   * @param {string} childAgentId - Child agent ID
   * @param {string} command - Command name ('cancel', 'pause', 'resume')
   * @param {Object} data - Optional command data
   */
  sendCommandToChild(childAgentId, command, data = {}) {
    if (!this.hierarchyInfo.childAgentIds.includes(childAgentId)) {
      this.logger.warn('Cannot send command to non-child agent', { childAgentId });
      return;
    }

    if (!this.messageBus) {
      this.logger.warn('Cannot send command - no message bus');
      return;
    }

    const topic = `agent:${childAgentId}:parent-command`;
    this.messageBus.publish(topic, { command, data }, this.id);

    this.logger.debug('Command sent to child', { childAgentId, command });
  }

  /**
   * Update resource usage tracking
   * @param {Object} usage - Usage update
   * @param {number} usage.tokens - Tokens used
   * @param {number} usage.time - Time used in ms
   */
  updateResourceUsage(usage = {}) {
    if (usage.tokens) {
      this.resourceUsage.tokensUsed += usage.tokens;
    }
    if (usage.time) {
      this.resourceUsage.timeUsed += usage.time;
    }

    // Check quota warnings
    if (this.resourceUsage.tokensUsed > this.quotas.maxTokens * 0.9) {
      this.logger.warn('Approaching token quota limit', {
        used: this.resourceUsage.tokensUsed,
        max: this.quotas.maxTokens
      });
    }
  }

  /**
   * Get remaining resource quotas
   * @returns {Object} Remaining quotas
   */
  getRemainingQuotas() {
    return {
      tokens: Math.max(0, this.quotas.maxTokens - this.resourceUsage.tokensUsed),
      time: Math.max(0, this.quotas.maxTime - this.resourceUsage.timeUsed),
      children: Math.max(0, this.quotas.maxChildren - this.resourceUsage.childrenSpawned)
    };
  }

  /**
   * Check if agent has exceeded any quota
   * @returns {Object} Quota status
   */
  checkQuotas() {
    const remaining = this.getRemainingQuotas();
    return {
      withinQuotas: remaining.tokens > 0 && remaining.time > 0,
      tokensExceeded: remaining.tokens <= 0,
      timeExceeded: remaining.time <= 0,
      childrenExceeded: remaining.children <= 0,
      remaining
    };
  }

  // ============================================
  // MESSAGING METHODS
  // ============================================

  /**
   * Send a direct message to another agent
   * @param {string} targetAgentId - Target agent ID
   * @param {Object} message - Message payload
   * @returns {Promise<Object>} Response from target agent
   */
  async send(targetAgentId, message) {
    const topic = `agent:${targetAgentId}:direct`;

    this.logger.debug('Sending direct message', { targetAgentId, topic });

    try {
      const responses = await this.messageBus.request(
        topic,
        message,
        this.id,
        { timeout: this.config.timeout, responseCount: 1 }
      );

      return responses[0] || null;

    } catch (error) {
      this.logger.error('Direct message failed', {
        targetAgentId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Broadcast a message to all agents
   * @param {Object} message - Message payload
   */
  broadcast(message) {
    const topic = 'agent:broadcast';

    this.logger.debug('Broadcasting message', { topic });

    this.messageBus.publish(topic, message, this.id);
  }

  /**
   * Subscribe to a topic
   * @param {string} topic - Topic name
   * @param {Function} handler - Message handler
   * @returns {Function} Unsubscribe function
   */
  subscribe(topic, handler) {
    const unsubscribe = this.messageBus.subscribe(topic, this.id, handler);
    this.subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  /**
   * Handle direct messages (subscribe to agent's direct topic)
   * @param {Function} handler - Message handler that receives message and returns response
   */
  handleDirectMessages(handler) {
    const topic = `agent:${this.id}:direct`;

    this.subscribe(topic, async (message) => {
      try {
        this.logger.debug('Received direct message', {
          from: message._metadata.publisherId
        });

        const response = await handler(message);

        // Send response back
        this.messageBus.reply(message, response, this.id);

      } catch (error) {
        this.logger.error('Error handling direct message', {
          error: error.message
        });

        this.messageBus.reply(message, {
          error: error.message,
          success: false
        }, this.id);
      }
    });
  }

  /**
   * Handle broadcast messages
   * @param {Function} handler - Message handler
   */
  handleBroadcasts(handler) {
    this.subscribe('agent:broadcast', async (message) => {
      // Ignore own broadcasts
      if (message._metadata.publisherId === this.id) {
        return;
      }

      try {
        await handler(message);
      } catch (error) {
        this.logger.error('Error handling broadcast', {
          error: error.message
        });
      }
    });
  }

  /**
   * Update agent state
   * @param {string} newState - New state (idle, working, completed, failed)
   */
  setState(newState) {
    const oldState = this.state;
    this.state = newState;

    this.logger.debug('State changed', { oldState, newState });

    // Publish state change event
    this.messageBus.publish('agent:state-change', {
      agentId: this.id,
      role: this.role,
      oldState,
      newState
    }, this.id);
  }

  /**
   * Record task execution
   * @param {Object} task - Task that was executed
   * @param {Object} result - Execution result
   * @param {number} duration - Execution time in ms
   * @private
   */
  _recordExecution(task, result, duration) {
    const record = {
      timestamp: new Date().toISOString(),
      task,
      result: {
        success: result.success !== false,
        error: result.error || null
      },
      duration
    };

    this.executionHistory.push(record);

    // Keep last 100 executions
    if (this.executionHistory.length > 100) {
      this.executionHistory.shift();
    }
  }

  /**
   * Get agent statistics
   * @returns {Object} Agent statistics
   */
  getStats() {
    const totalExecutions = this.executionHistory.length;
    const successfulExecutions = this.executionHistory.filter(r => r.result.success).length;
    const failedExecutions = totalExecutions - successfulExecutions;

    const avgDuration = totalExecutions > 0
      ? this.executionHistory.reduce((sum, r) => sum + r.duration, 0) / totalExecutions
      : 0;

    return {
      agentId: this.id,
      role: this.role,
      state: this.state,
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      successRate: totalExecutions > 0 ? (successfulExecutions / totalExecutions * 100).toFixed(1) : 0,
      avgDuration: Math.round(avgDuration),
      subscriptionCount: this.subscriptions.length,
      // Hierarchy info
      hierarchy: {
        parentAgentId: this.hierarchyInfo.parentAgentId,
        childCount: this.hierarchyInfo.childAgentIds.length,
        depth: this.hierarchyInfo.depth,
        isRoot: this.hierarchyInfo.isRoot
      },
      // Resource usage
      resources: {
        tokensUsed: this.resourceUsage.tokensUsed,
        timeUsed: this.resourceUsage.timeUsed,
        childrenSpawned: this.resourceUsage.childrenSpawned,
        remaining: this.getRemainingQuotas()
      }
    };
  }

  /**
   * Cleanup agent resources
   */
  destroy() {
    // Report completion to parent if applicable
    if (this.hierarchyInfo.parentAgentId && this.messageBus) {
      this.reportToParent({
        type: 'status',
        data: { status: 'destroyed', finalState: this.state }
      });
    }

    // Prune from hierarchy registry
    try {
      const registry = getHierarchyRegistry();
      registry.pruneHierarchy(this.id);
    } catch (error) {
      this.logger.debug('Could not prune from hierarchy registry', {
        reason: error.message
      });
    }

    // Unsubscribe from all topics
    this.subscriptions.forEach(unsubscribe => unsubscribe());
    this.subscriptions = [];

    // Clear hierarchy state
    this.hierarchyInfo.childAgentIds = [];

    this.setState('destroyed');
    this.logger.info('Agent destroyed', { agentId: this.id });
  }
}

// Export DEFAULT_QUOTAS for external use
Agent.DEFAULT_QUOTAS = DEFAULT_QUOTAS;

module.exports = Agent;
