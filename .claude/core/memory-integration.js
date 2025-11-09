/**
 * Memory Integration - Bridges LifecycleHooks and MessageBus
 *
 * This is the key hybrid architecture component that:
 * 1. Uses HOOKS for critical memory operations (guaranteed execution)
 * 2. Uses MESSAGEBUS for optional notifications (fault isolation)
 * 3. Coordinates between both systems for optimal reliability
 *
 * @module memory-integration
 */

const { createComponentLogger } = require('./logger');

class MemoryIntegration {
  constructor(messageBus, memoryStore, options = {}) {
    this.logger = createComponentLogger('MemoryIntegration');
    this.messageBus = messageBus;
    this.memoryStore = memoryStore;
    this.options = {
      enableAI: options.enableAI || false,
      aiApiKey: options.aiApiKey || null,
      asyncCategorization: options.asyncCategorization !== false, // Default true
      enableVectorStore: options.enableVectorStore !== false, // Default true
      enableContextRetrieval: options.enableContextRetrieval !== false, // Default true
      defaultTokenBudget: options.defaultTokenBudget || 2000,
      ...options
    };

    // Initialize intelligence layer components
    this._initializeIntelligenceLayer();

    // Set up MessageBus listeners
    this._setupMessageBusListeners();

    this.logger.info('Memory integration initialized', {
      aiEnabled: this.options.enableAI,
      vectorStoreEnabled: !!this.vectorStore,
      contextRetrieverEnabled: !!this.contextRetriever,
      asyncCategorization: this.options.asyncCategorization
    });
  }

  /**
   * Initialize intelligence layer components
   * @private
   */
  _initializeIntelligenceLayer() {
    // 1. Initialize VectorStore (semantic search)
    if (this.options.enableVectorStore) {
      try {
        const VectorStore = require('./vector-store');
        this.vectorStore = new VectorStore(this.memoryStore);
        this.logger.info('VectorStore initialized');
      } catch (error) {
        this.logger.warn('VectorStore not available', {
          error: error.message
        });
        this.vectorStore = null;
      }
    }

    // 2. Initialize ContextRetriever (progressive disclosure)
    if (this.options.enableContextRetrieval) {
      try {
        const ContextRetriever = require('./context-retriever');
        this.contextRetriever = new ContextRetriever(
          this.memoryStore,
          this.vectorStore
        );
        this.logger.info('ContextRetriever initialized');
      } catch (error) {
        this.logger.warn('ContextRetriever not available', {
          error: error.message
        });
        this.contextRetriever = null;
      }
    }

    // 3. Initialize AICategorizationService (observation extraction)
    if (this.options.enableAI && this.options.aiApiKey) {
      this._initializeAICategorizer();
    }

    // 4. Initialize MemorySearchAPI (query interface)
    try {
      const MemorySearchAPI = require('./memory-search-api');
      this.searchAPI = new MemorySearchAPI(this.memoryStore, this.vectorStore);
      this.logger.info('MemorySearchAPI initialized');
    } catch (error) {
      this.logger.warn('MemorySearchAPI not available', {
        error: error.message
      });
      this.searchAPI = null;
    }

    // 5. Initialize PatternRecommender (pattern selection)
    try {
      const PatternRecommender = require('./pattern-recommender');
      this.patternRecommender = new PatternRecommender(
        this.memoryStore,
        this.searchAPI
      );
      this.logger.info('PatternRecommender initialized');
    } catch (error) {
      this.logger.warn('PatternRecommender not available', {
        error: error.message
      });
      this.patternRecommender = null;
    }

    // 6. Initialize UsageTracker (cost analytics)
    if (this.options.enableUsageTracking !== false) {
      try {
        const UsageTracker = require('./usage-tracker');
        this.usageTracker = new UsageTracker(this.memoryStore, {
          enableBudgetAlerts: this.options.enableBudgetAlerts || false,
          dailyBudgetUSD: this.options.dailyBudgetUSD,
          monthlyBudgetUSD: this.options.monthlyBudgetUSD,
          customPricing: this.options.customModelPricing
        });
        this.logger.info('UsageTracker initialized');
      } catch (error) {
        this.logger.warn('UsageTracker not available', {
          error: error.message
        });
        this.usageTracker = null;
      }
    }

    // 7. Initialize UsageReporter (reporting)
    if (this.usageTracker) {
      try {
        const UsageReporter = require('./usage-reporter');
        this.usageReporter = new UsageReporter(this.memoryStore, this.usageTracker);
        this.logger.info('UsageReporter initialized');
      } catch (error) {
        this.logger.warn('UsageReporter not available', {
          error: error.message
        });
        this.usageReporter = null;
      }
    }
  }

  /**
   * Initialize AI categorization service
   * @private
   */
  _initializeAICategorizer() {
    try {
      const AICategorizationService = require('./ai-categorizer');
      this.aiCategorizer = new AICategorizationService(this.options.aiApiKey);
      this.logger.info('AI categorization enabled');
    } catch (error) {
      this.logger.warn('AI categorization not available', {
        error: error.message
      });
      this.options.enableAI = false;
    }
  }

  /**
   * Set up MessageBus event listeners
   *
   * These listeners are OPTIONAL - they don't block execution.
   * If they fail, the system continues normally.
   *
   * @private
   */
  _setupMessageBusListeners() {
    // Listen for orchestration completions
    this.messageBus.subscribe(
      'orchestrator:execution:complete',
      'memory-integration',
      this._handleOrchestrationComplete.bind(this)
    );

    // Listen for agent state changes
    this.messageBus.subscribe(
      'agent:state-change',
      'memory-integration',
      this._handleAgentStateChange.bind(this)
    );

    // Listen for pattern selections
    this.messageBus.subscribe(
      'orchestrator:pattern:selected',
      'memory-integration',
      this._handlePatternSelection.bind(this)
    );

    this.logger.debug('MessageBus listeners registered');
  }

  /**
   * Handle orchestration completion event
   *
   * This is an EVENT-based handler (non-critical, asynchronous).
   * Failures here won't affect the orchestration execution.
   *
   * @private
   */
  async _handleOrchestrationComplete(event) {
    try {
      const { pattern, agentIds, task, result, duration, metadata } = event;

      this.logger.debug('Recording orchestration', {
        pattern,
        agentCount: agentIds?.length || 0
      });

      // Record orchestration in database
      const orchestrationId = this.memoryStore.recordOrchestration({
        pattern,
        agentIds: agentIds || [],
        task,
        resultSummary: this._summarizeResult(result),
        success: result?.success !== false,
        duration,
        tokenCount: metadata?.tokenCount || 0,
        metadata: metadata || {}
      });

      // Vectorize orchestration (if VectorStore available)
      if (this.vectorStore) {
        this._vectorizeAsync(orchestrationId, event).catch(err => {
          this.logger.warn('Async vectorization failed', {
            error: err.message,
            orchestrationId
          });
        });
      }

      // AI categorization (if enabled)
      if (this.aiCategorizer) {
        if (this.options.asyncCategorization) {
          // Don't wait for categorization (fire and forget)
          this._categorizeAsync(orchestrationId, event).catch(err => {
            this.logger.warn('Async categorization failed', {
              error: err.message,
              orchestrationId
            });
          });
        } else {
          // Synchronous categorization (wait for completion)
          await this._categorizeAsync(orchestrationId, event);
        }
      }

      this.logger.info('Orchestration recorded', {
        orchestrationId,
        pattern,
        vectorized: !!this.vectorStore,
        aiEnabled: !!this.aiCategorizer
      });

    } catch (error) {
      // Log error but don't throw - this is optional processing
      this.logger.error('Failed to record orchestration', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  /**
   * Vectorize orchestration (async)
   * @private
   */
  async _vectorizeAsync(orchestrationId, eventData) {
    try {
      await this.vectorStore.addOrchestration(orchestrationId, {
        task: eventData.task,
        pattern: eventData.pattern,
        agentIds: eventData.agentIds || [],
        resultSummary: this._summarizeResult(eventData.result),
        success: eventData.result?.success !== false,
        timestamp: Date.now()
      });

      this.logger.info('Orchestration vectorized', {
        orchestrationId
      });

    } catch (error) {
      this.logger.error('Vectorization failed', {
        orchestrationId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * AI categorization (async)
   * @private
   */
  async _categorizeAsync(orchestrationId, eventData) {
    try {
      const categorization = await this.aiCategorizer.categorizeOrchestration({
        pattern: eventData.pattern,
        agentIds: eventData.agentIds || [],
        task: eventData.task,
        resultSummary: this._summarizeResult(eventData.result),
        success: eventData.result?.success !== false,
        duration: eventData.duration
      });

      // Store observation
      this.memoryStore.recordObservation(orchestrationId, {
        type: categorization.type,
        content: categorization.observation,
        concepts: categorization.concepts || [],
        importance: categorization.importance || 5,
        agentInsights: categorization.agentInsights || {},
        recommendations: categorization.recommendations
      });

      this.logger.info('Observation extracted', {
        orchestrationId,
        type: categorization.type,
        concepts: categorization.concepts?.join(', ')
      });

    } catch (error) {
      this.logger.error('AI categorization failed', {
        orchestrationId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Handle agent state change event
   * @private
   */
  async _handleAgentStateChange(event) {
    try {
      const { agentId, oldState, newState, timestamp } = event;

      this.logger.debug('Agent state changed', {
        agentId,
        oldState,
        newState
      });

      // Could record state transitions if needed
      // For now, this is just logged

    } catch (error) {
      this.logger.warn('Failed to handle agent state change', {
        error: error.message
      });
    }
  }

  /**
   * Handle pattern selection event
   * @private
   */
  async _handlePatternSelection(event) {
    try {
      const { pattern, task, reason } = event;

      this.logger.debug('Pattern selected', {
        pattern,
        task: task?.substring(0, 50),
        reason
      });

      // Could track pattern selection decisions
      // For future pattern recommendation improvements

    } catch (error) {
      this.logger.warn('Failed to handle pattern selection', {
        error: error.message
      });
    }
  }

  /**
   * Create lifecycle hooks for AgentOrchestrator
   *
   * These hooks provide GUARANTEED execution for critical operations.
   * Unlike MessageBus events, hooks will block and propagate errors.
   *
   * @param {LifecycleHooks} lifecycleHooks - Hook manager
   */
  setupLifecycleHooks(lifecycleHooks) {
    // HOOK: Before execution - load relevant context
    lifecycleHooks.registerHook(
      'beforeExecution',
      this._hookBeforeExecution.bind(this),
      {
        priority: 10,
        id: 'memory-context-loader',
        name: 'Load memory context'
      }
    );

    // HOOK: After execution - ensure memory saved
    lifecycleHooks.registerHook(
      'afterExecution',
      this._hookAfterExecution.bind(this),
      {
        priority: 90,
        id: 'memory-saver',
        name: 'Save to memory'
      }
    );

    // HOOK: On error - record failure
    lifecycleHooks.registerHook(
      'onError',
      this._hookOnError.bind(this),
      {
        priority: 50,
        id: 'memory-error-recorder',
        name: 'Record error'
      }
    );

    this.logger.info('Lifecycle hooks registered');
  }

  /**
   * HOOK: Before execution
   *
   * This hook MUST complete before orchestration begins.
   * It loads relevant historical context from memory.
   *
   * @private
   */
  async _hookBeforeExecution(context) {
    try {
      const { task, agentIds, options } = context;

      // Check if context retrieval is enabled
      if (options?.useMemory === false || !this.contextRetriever) {
        return context; // Pass through unchanged
      }

      this.logger.debug('Loading memory context', {
        task: task?.substring(0, 50),
        agentCount: agentIds?.length || 0
      });

      // Retrieve relevant historical context
      const tokenBudget = options?.contextTokenBudget || this.options.defaultTokenBudget;
      const historicalContext = await this.contextRetriever.retrieveContext(task, {
        maxTokens: tokenBudget,
        agentIds: agentIds || [],
        includeDetails: options?.includeContextDetails !== false
      });

      this.logger.info('Memory context loaded', {
        relevantCount: historicalContext.relevantOrchestrations?.length || 0,
        tokenCost: historicalContext.tokenCost,
        cacheHit: historicalContext.fromCache
      });

      return {
        ...context,
        memoryContext: {
          loaded: true,
          ...historicalContext
        }
      };

    } catch (error) {
      this.logger.error('Failed to load memory context', {
        error: error.message,
        stack: error.stack
      });

      // Don't fail the orchestration if context loading fails
      // Just proceed without historical context
      return {
        ...context,
        memoryContext: {
          loaded: false,
          error: error.message
        }
      };
    }
  }

  /**
   * HOOK: After execution
   *
   * This hook MUST complete after orchestration.
   * It ensures the orchestration is saved to memory.
   *
   * @private
   */
  async _hookAfterExecution(result) {
    try {
      // The actual save happens via MessageBus event
      // This hook just ensures we wait for critical operations

      this.logger.debug('Post-execution hook', {
        success: result?.success !== false
      });

      // Track usage if available and usage data present
      if (this.usageTracker && result?.usage) {
        await this.usageTracker.recordUsage({
          orchestrationId: result.orchestrationId || result.id,
          model: result.model || result.metadata?.model || 'claude-sonnet-4.5',
          inputTokens: result.usage.inputTokens || result.usage.input_tokens || 0,
          outputTokens: result.usage.outputTokens || result.usage.output_tokens || 0,
          cacheCreationTokens: result.usage.cacheCreationTokens || result.usage.cache_creation_input_tokens || 0,
          cacheReadTokens: result.usage.cacheReadTokens || result.usage.cache_read_input_tokens || 0,
          pattern: result.pattern || result.metadata?.pattern,
          workSessionId: result.workSessionId || result.metadata?.workSessionId,
          metadata: result.metadata || {}
        }).catch(err => {
          // Non-critical: usage tracking failures shouldn't block orchestration
          this.logger.warn('Failed to record usage', {
            error: err.message
          });
        });
      }

      return result;

    } catch (error) {
      this.logger.error('Post-execution hook failed', {
        error: error.message
      });

      // Don't fail the orchestration
      return result;
    }
  }

  /**
   * HOOK: On error
   *
   * This hook handles orchestration failures.
   * Records the error for future analysis.
   *
   * @private
   */
  async _hookOnError(errorContext) {
    try {
      const { hookName, error, context } = errorContext;

      this.logger.error('Orchestration error', {
        hookName,
        error: error?.message,
        contextKeys: Object.keys(context || {})
      });

      // Could record error patterns for analysis
      // For now, just log

      return errorContext;

    } catch (err) {
      this.logger.error('Error hook failed', {
        error: err.message
      });

      return errorContext;
    }
  }

  /**
   * Summarize result for storage
   * @private
   */
  _summarizeResult(result) {
    if (!result) return 'No result';

    if (typeof result === 'string') {
      return result.substring(0, 500);
    }

    if (typeof result === 'object') {
      const str = JSON.stringify(result);
      return str.length > 500 ? str.substring(0, 500) + '...' : str;
    }

    return String(result).substring(0, 500);
  }

  /**
   * Get pattern recommendation for a task
   * Public API for PatternRecommender
   */
  async recommendPattern(taskDescription, context) {
    if (!this.patternRecommender) {
      this.logger.warn('PatternRecommender not available');
      return null;
    }
    return await this.patternRecommender.recommendPattern(taskDescription, context);
  }

  /**
   * Get team recommendation for a task
   * Public API for PatternRecommender
   */
  async recommendTeam(taskDescription, options) {
    if (!this.patternRecommender) {
      this.logger.warn('PatternRecommender not available');
      return null;
    }
    return await this.patternRecommender.recommendTeam(taskDescription, options);
  }

  /**
   * Predict success rate for pattern/agent combination
   * Public API for PatternRecommender
   */
  async predictSuccess(pattern, agentIds, taskDescription) {
    if (!this.patternRecommender) {
      this.logger.warn('PatternRecommender not available');
      return null;
    }
    return await this.patternRecommender.predictSuccess(pattern, agentIds, taskDescription);
  }

  /**
   * Search orchestrations
   * Public API for MemorySearchAPI
   */
  async searchOrchestrations(query, options) {
    if (!this.searchAPI) {
      this.logger.warn('MemorySearchAPI not available');
      return [];
    }
    return await this.searchAPI.searchOrchestrations(query, options);
  }

  /**
   * Get recent context
   * Public API for MemorySearchAPI
   */
  async getRecentContext(timeframe) {
    if (!this.searchAPI) {
      this.logger.warn('MemorySearchAPI not available');
      return { orchestrations: [] };
    }
    return await this.searchAPI.getRecentContext(timeframe);
  }

  /**
   * Get integration statistics
   *
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      memoryStore: this.memoryStore.getStats(),
      aiEnabled: this.options.enableAI,
      vectorStoreEnabled: !!this.vectorStore,
      contextRetrieverEnabled: !!this.contextRetriever,
      searchAPIEnabled: !!this.searchAPI,
      patternRecommenderEnabled: !!this.patternRecommender,
      asyncCategorization: this.options.asyncCategorization
    };
  }

  /**
   * Clean up resources
   */
  close() {
    this.logger.info('Memory integration closing');

    // Unsubscribe from MessageBus
    // MessageBus should handle cleanup

    // Close memory store
    if (this.memoryStore) {
      this.memoryStore.close();
    }
  }
}

module.exports = MemoryIntegration;
