/**
 * Lifecycle Hooks System
 *
 * Provides guaranteed execution points for critical operations.
 * Hooks run sequentially with predictable ordering, unlike events.
 *
 * Use hooks for:
 * - Memory operations that MUST complete
 * - Critical path operations requiring strict ordering
 * - Synchronous results needed immediately
 *
 * Use MessageBus events for:
 * - Optional notifications
 * - Asynchronous processing
 * - Multiple independent subscribers
 *
 * @module lifecycle-hooks
 */

const { createComponentLogger } = require('./logger');

class LifecycleHooks {
  constructor() {
    this.logger = createComponentLogger('LifecycleHooks');

    /**
     * Hook registry organized by lifecycle phase
     * Each hook is an array of handlers that execute sequentially
     */
    this.hooks = {
      // Pre-execution hooks: prepare context, load memory
      beforeExecution: [],

      // Post-execution hooks: save results, update stats
      afterExecution: [],

      // Error hooks: handle failures, log errors
      onError: [],

      // Agent lifecycle hooks
      beforeAgentExecution: [],
      afterAgentExecution: [],

      // Pattern-specific hooks
      beforePatternSelection: [],
      afterPatternSelection: []
    };

    this.hookMetrics = {
      executions: {},
      failures: {},
      totalDuration: {}
    };
  }

  /**
   * Register a hook handler
   *
   * @param {string} hookName - Name of the hook point
   * @param {Function} handler - Async function to execute
   * @param {Object} options - Configuration options
   * @param {number} options.priority - Execution priority (lower = earlier, default 50)
   * @param {string} options.id - Unique identifier for this handler
   * @returns {Function} Unregister function
   */
  registerHook(hookName, handler, options = {}) {
    if (!this.hooks[hookName]) {
      throw new Error(`Unknown hook: ${hookName}. Available hooks: ${Object.keys(this.hooks).join(', ')}`);
    }

    if (typeof handler !== 'function') {
      throw new Error('Hook handler must be a function');
    }

    const hookEntry = {
      handler,
      priority: options.priority || 50,
      id: options.id || `hook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: options.name || handler.name || 'anonymous',
      enabled: true
    };

    this.hooks[hookName].push(hookEntry);

    // Sort by priority (lower priority executes first)
    this.hooks[hookName].sort((a, b) => a.priority - b.priority);

    this.logger.info('Hook registered', {
      hookName,
      handlerName: hookEntry.name,
      priority: hookEntry.priority,
      id: hookEntry.id
    });

    // Return unregister function
    return () => this.unregisterHook(hookName, hookEntry.id);
  }

  /**
   * Unregister a hook handler by ID
   *
   * @param {string} hookName - Name of the hook point
   * @param {string} handlerId - ID of the handler to remove
   */
  unregisterHook(hookName, handlerId) {
    if (!this.hooks[hookName]) {
      return;
    }

    const initialLength = this.hooks[hookName].length;
    this.hooks[hookName] = this.hooks[hookName].filter(h => h.id !== handlerId);

    if (this.hooks[hookName].length < initialLength) {
      this.logger.info('Hook unregistered', { hookName, handlerId });
    }
  }

  /**
   * Execute all handlers for a hook point sequentially
   *
   * Each handler receives the output of the previous handler.
   * This creates a transformation pipeline with guaranteed ordering.
   *
   * @param {string} hookName - Name of the hook point
   * @param {...any} args - Arguments passed to first handler
   * @returns {Promise<any>} Result from final handler
   */
  async executeHook(hookName, ...args) {
    if (!this.hooks[hookName]) {
      throw new Error(`Unknown hook: ${hookName}`);
    }

    const handlers = this.hooks[hookName].filter(h => h.enabled);

    if (handlers.length === 0) {
      this.logger.debug('No handlers registered', { hookName });
      // Return first argument unchanged if no handlers
      return args[0];
    }

    this.logger.debug('Executing hook', {
      hookName,
      handlerCount: handlers.length
    });

    const startTime = Date.now();
    let result = args[0];

    // Execute handlers sequentially
    for (let i = 0; i < handlers.length; i++) {
      const hookEntry = handlers[i];

      try {
        const handlerStartTime = Date.now();

        // Each handler receives result from previous handler
        result = await hookEntry.handler(result, ...args.slice(1));

        const handlerDuration = Date.now() - handlerStartTime;

        this.logger.debug('Hook handler completed', {
          hookName,
          handlerName: hookEntry.name,
          handlerId: hookEntry.id,
          duration: handlerDuration
        });

        // Track metrics
        this._recordMetric(hookName, hookEntry.id, handlerDuration, true);

      } catch (error) {
        this.logger.error('Hook handler failed', {
          hookName,
          handlerName: hookEntry.name,
          handlerId: hookEntry.id,
          error: error.message,
          stack: error.stack
        });

        // Track failure
        this._recordMetric(hookName, hookEntry.id, 0, false);

        // Execute error hooks
        if (hookName !== 'onError') {
          await this.executeHook('onError', {
            hookName,
            handlerId: hookEntry.id,
            error,
            context: result
          });
        }

        // Re-throw error to stop pipeline
        throw error;
      }
    }

    const totalDuration = Date.now() - startTime;

    this.logger.debug('Hook execution complete', {
      hookName,
      handlersExecuted: handlers.length,
      totalDuration
    });

    return result;
  }

  /**
   * Execute hook with error isolation
   *
   * Handlers that fail won't stop subsequent handlers.
   * Useful for non-critical hooks like logging or metrics.
   *
   * @param {string} hookName - Name of the hook point
   * @param {...any} args - Arguments passed to handlers
   * @returns {Promise<Array>} Array of results (or errors)
   */
  async executeHookIsolated(hookName, ...args) {
    if (!this.hooks[hookName]) {
      throw new Error(`Unknown hook: ${hookName}`);
    }

    const handlers = this.hooks[hookName].filter(h => h.enabled);
    const results = [];

    for (const hookEntry of handlers) {
      try {
        const result = await hookEntry.handler(...args);
        results.push({ success: true, result, handlerId: hookEntry.id });
        this._recordMetric(hookName, hookEntry.id, 0, true);
      } catch (error) {
        this.logger.warn('Hook handler failed (isolated)', {
          hookName,
          handlerName: hookEntry.name,
          error: error.message
        });

        results.push({
          success: false,
          error,
          handlerId: hookEntry.id
        });

        this._recordMetric(hookName, hookEntry.id, 0, false);
      }
    }

    return results;
  }

  /**
   * Enable or disable a specific handler
   *
   * @param {string} hookName - Name of the hook point
   * @param {string} handlerId - ID of the handler
   * @param {boolean} enabled - Whether to enable or disable
   */
  setHandlerEnabled(hookName, handlerId, enabled) {
    if (!this.hooks[hookName]) {
      return;
    }

    const handler = this.hooks[hookName].find(h => h.id === handlerId);
    if (handler) {
      handler.enabled = enabled;
      this.logger.info('Hook handler toggled', {
        hookName,
        handlerId,
        enabled
      });
    }
  }

  /**
   * Get all handlers for a hook point
   *
   * @param {string} hookName - Name of the hook point
   * @returns {Array} Array of handler entries
   */
  getHandlers(hookName) {
    return this.hooks[hookName] || [];
  }

  /**
   * Get metrics for hook executions
   *
   * @returns {Object} Metrics object
   */
  getMetrics() {
    return {
      executions: { ...this.hookMetrics.executions },
      failures: { ...this.hookMetrics.failures },
      totalDuration: { ...this.hookMetrics.totalDuration },
      successRate: this._calculateSuccessRates()
    };
  }

  /**
   * Reset all metrics
   */
  resetMetrics() {
    this.hookMetrics = {
      executions: {},
      failures: {},
      totalDuration: {}
    };
  }

  /**
   * Clear all handlers for a hook (or all hooks)
   *
   * @param {string} [hookName] - Specific hook to clear, or all if omitted
   */
  clearHooks(hookName) {
    if (hookName) {
      if (this.hooks[hookName]) {
        this.hooks[hookName] = [];
        this.logger.info('Hook cleared', { hookName });
      }
    } else {
      // Clear all hooks
      Object.keys(this.hooks).forEach(name => {
        this.hooks[name] = [];
      });
      this.logger.info('All hooks cleared');
    }
  }

  /**
   * Record execution metric
   * @private
   */
  _recordMetric(hookName, handlerId, duration, success) {
    const key = `${hookName}:${handlerId}`;

    this.hookMetrics.executions[key] = (this.hookMetrics.executions[key] || 0) + 1;

    if (!success) {
      this.hookMetrics.failures[key] = (this.hookMetrics.failures[key] || 0) + 1;
    }

    if (duration > 0) {
      this.hookMetrics.totalDuration[key] = (this.hookMetrics.totalDuration[key] || 0) + duration;
    }
  }

  /**
   * Calculate success rates for all hooks
   * @private
   */
  _calculateSuccessRates() {
    const rates = {};

    Object.keys(this.hookMetrics.executions).forEach(key => {
      const executions = this.hookMetrics.executions[key];
      const failures = this.hookMetrics.failures[key] || 0;
      rates[key] = executions > 0 ? (executions - failures) / executions : 0;
    });

    return rates;
  }
}

module.exports = LifecycleHooks;
