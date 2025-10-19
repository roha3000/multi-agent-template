/**
 * Message Bus - Pub/Sub communication for multi-agent collaboration
 *
 * Provides event-driven communication between agents using the publish-subscribe pattern.
 * Enables loose coupling and asynchronous message passing.
 *
 * @module message-bus
 */

const { EventEmitter } = require('events');
const { createComponentLogger } = require('./logger');

const logger = createComponentLogger('MessageBus');

class MessageBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100); // Support many agents
    this.messageHistory = [];
    this.subscriptions = new Map(); // Track subscriptions for debugging
  }

  /**
   * Subscribe to a topic
   * @param {string} topic - Topic name
   * @param {string} subscriberId - Agent ID subscribing
   * @param {Function} handler - Message handler function
   * @returns {Function} Unsubscribe function
   */
  subscribe(topic, subscriberId, handler) {
    logger.debug('Agent subscribed to topic', { topic, subscriberId });

    // Track subscription
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
    }
    this.subscriptions.get(topic).add(subscriberId);

    // Add event listener
    this.on(topic, handler);

    // Return unsubscribe function
    return () => {
      this.off(topic, handler);
      this.subscriptions.get(topic)?.delete(subscriberId);
      logger.debug('Agent unsubscribed from topic', { topic, subscriberId });
    };
  }

  /**
   * Publish a message to a topic
   * @param {string} topic - Topic name
   * @param {Object} message - Message payload
   * @param {string} publisherId - Agent ID publishing
   */
  publish(topic, message, publisherId) {
    const messageWithMetadata = {
      ...message,
      _metadata: {
        topic,
        publisherId,
        timestamp: new Date().toISOString(),
        messageId: this._generateMessageId()
      }
    };

    // Store in history (keep last 1000 messages)
    this.messageHistory.push(messageWithMetadata);
    if (this.messageHistory.length > 1000) {
      this.messageHistory.shift();
    }

    logger.debug('Message published', {
      topic,
      publisherId,
      messageId: messageWithMetadata._metadata.messageId,
      subscriberCount: this.subscriptions.get(topic)?.size || 0
    });

    // Emit to all subscribers
    this.emit(topic, messageWithMetadata);
  }

  /**
   * Request-response pattern
   * Publishes a message and waits for responses
   * @param {string} topic - Topic name
   * @param {Object} message - Message payload
   * @param {string} requesterId - Agent ID making request
   * @param {Object} options - Options { timeout: ms, responseCount: number }
   * @returns {Promise<Array>} Array of responses
   */
  async request(topic, message, requesterId, options = {}) {
    const { timeout = 30000, responseCount = 1 } = options;
    const requestId = this._generateMessageId();
    const responseTopic = `${topic}:response:${requestId}`;

    return new Promise((resolve, reject) => {
      const responses = [];
      const timer = setTimeout(() => {
        unsubscribe();
        if (responses.length === 0) {
          reject(new Error(`Request timeout: no responses received in ${timeout}ms`));
        } else {
          resolve(responses);
        }
      }, timeout);

      const unsubscribe = this.subscribe(responseTopic, requesterId, (response) => {
        responses.push(response);

        if (responses.length >= responseCount) {
          clearTimeout(timer);
          unsubscribe();
          resolve(responses);
        }
      });

      // Publish request with response topic
      this.publish(topic, {
        ...message,
        _responseTopic: responseTopic,
        _requestId: requestId
      }, requesterId);
    });
  }

  /**
   * Reply to a request
   * @param {Object} requestMessage - Original request message
   * @param {Object} response - Response payload
   * @param {string} responderId - Agent ID responding
   */
  reply(requestMessage, response, responderId) {
    const responseTopic = requestMessage._responseTopic;
    if (!responseTopic) {
      logger.warn('Cannot reply: message has no response topic', { responderId });
      return;
    }

    this.publish(responseTopic, {
      ...response,
      _requestId: requestMessage._requestId,
      _responderId: responderId
    }, responderId);
  }

  /**
   * Get message history for a topic
   * @param {string} topic - Topic name (optional)
   * @param {number} limit - Max messages to return
   * @returns {Array} Message history
   */
  getHistory(topic = null, limit = 100) {
    let history = this.messageHistory;

    if (topic) {
      history = history.filter(msg => msg._metadata.topic === topic);
    }

    return history.slice(-limit);
  }

  /**
   * Get list of active topics
   * @returns {Array} Array of topic names
   */
  getActiveTopics() {
    return Array.from(this.subscriptions.keys());
  }

  /**
   * Get subscribers for a topic
   * @param {string} topic - Topic name
   * @returns {Array} Array of subscriber IDs
   */
  getSubscribers(topic) {
    return Array.from(this.subscriptions.get(topic) || []);
  }

  /**
   * Clear all subscriptions and history
   */
  clear() {
    this.removeAllListeners();
    this.subscriptions.clear();
    this.messageHistory = [];
    logger.info('Message bus cleared');
  }

  /**
   * Generate unique message ID
   * @private
   */
  _generateMessageId() {
    return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

module.exports = MessageBus;
