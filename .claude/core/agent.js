/**
 * Agent - Base class for all agents in the multi-agent system
 *
 * Provides core agent functionality including:
 * - Message passing via MessageBus
 * - Task execution interface
 * - State management
 * - Error handling
 *
 * @module agent
 */

const { createComponentLogger } = require('./logger');

class Agent {
  /**
   * Create an agent
   * @param {string} id - Unique agent identifier
   * @param {string} role - Agent role/specialty (e.g., 'Researcher', 'Developer')
   * @param {MessageBus} messageBus - Message bus instance
   * @param {Object} config - Agent configuration
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
      subscriptionCount: this.subscriptions.length
    };
  }

  /**
   * Cleanup agent resources
   */
  destroy() {
    // Unsubscribe from all topics
    this.subscriptions.forEach(unsubscribe => unsubscribe());
    this.subscriptions = [];

    this.setState('destroyed');
    this.logger.info('Agent destroyed', { agentId: this.id });
  }
}

module.exports = Agent;
