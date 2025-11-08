/**
 * Intelligent Orchestrator - Automatically selects and executes orchestration patterns
 *
 * Combines PatternSelector with AgentOrchestrator to intelligently route tasks
 * to the most appropriate orchestration pattern based on user intent.
 *
 * @module intelligent-orchestrator
 */

const AgentOrchestrator = require('./agent-orchestrator');
const PatternSelector = require('./pattern-selector');
const { createComponentLogger } = require('./logger');

const logger = createComponentLogger('IntelligentOrchestrator');

class IntelligentOrchestrator {
  /**
   * Creates an IntelligentOrchestrator instance
   * @param {MessageBus} messageBus - Message bus instance
   * @param {Object} options - Configuration options
   */
  constructor(messageBus, options = {}) {
    this.orchestrator = new AgentOrchestrator(messageBus);
    this.patternSelector = new PatternSelector();
    this.options = {
      autoSelect: true, // Automatically select pattern
      requireConfidence: 0.6, // Minimum confidence to auto-select
      logDecisions: true, // Log pattern selection decisions
      ...options
    };

    logger.info('IntelligentOrchestrator initialized', {
      autoSelect: this.options.autoSelect,
      minConfidence: this.options.requireConfidence
    });
  }

  /**
   * Register an agent with the orchestrator
   * @param {Agent} agent - Agent instance
   */
  registerAgent(agent) {
    this.orchestrator.registerAgent(agent);
  }

  /**
   * Unregister an agent
   * @param {string} agentId - Agent ID
   */
  unregisterAgent(agentId) {
    this.orchestrator.unregisterAgent(agentId);
  }

  /**
   * Get agent by ID
   * @param {string} agentId - Agent ID
   * @returns {Agent|null} Agent instance
   */
  getAgent(agentId) {
    return this.orchestrator.getAgent(agentId);
  }

  /**
   * Execute task with intelligent pattern selection
   * @param {string} prompt - User's prompt/instruction
   * @param {Array<string>} agentIds - Agent IDs to use
   * @param {Object} task - Task object to execute
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Execution result
   */
  async execute(prompt, agentIds, task, options = {}) {
    const {
      forcePattern = null, // Force specific pattern
      patternOptions = {}, // Pattern-specific options
      taskType = null, // Hint about task type
      timeout = 60000
    } = options;

    logger.info('Intelligent execution requested', {
      agentCount: agentIds.length,
      forcePattern: forcePattern || 'auto',
      taskType: taskType
    });

    // Step 1: Select pattern (or use forced pattern)
    let selectedPattern;
    let confidence;

    if (forcePattern) {
      selectedPattern = forcePattern;
      confidence = 1.0;
      logger.info('Pattern forced by user', { pattern: forcePattern });
    } else {
      const selection = this.patternSelector.select(prompt, {
        agentCount: agentIds.length,
        taskType: taskType
      });

      if (this.options.logDecisions) {
        logger.info('Pattern selection complete', {
          pattern: selection.pattern,
          confidence: selection.confidence.toFixed(2),
          reasoning: selection.reasoning
        });
      }

      // Check confidence threshold
      if (selection.confidence < this.options.requireConfidence) {
        logger.warn('Low confidence in pattern selection', {
          confidence: selection.confidence,
          threshold: this.options.requireConfidence,
          suggestions: selection.suggestions.map(s => s.pattern)
        });

        // Return selection for user confirmation
        return {
          success: false,
          needsConfirmation: true,
          selection: selection,
          message: `Low confidence (${(selection.confidence * 100).toFixed(0)}%). Please confirm pattern or choose from suggestions.`
        };
      }

      selectedPattern = selection.pattern;
      confidence = selection.confidence;

      // Merge recommended config with user options
      if (selection.recommendedConfig) {
        Object.keys(selection.recommendedConfig).forEach(key => {
          if (!(key in patternOptions)) {
            patternOptions[key] = selection.recommendedConfig[key];
          }
        });
      }
    }

    // Step 2: Execute with selected pattern
    const startTime = Date.now();
    let result;

    try {
      switch (selectedPattern) {
        case 'parallel':
          result = await this._executeParallel(agentIds, task, patternOptions, timeout);
          break;

        case 'consensus':
          result = await this._executeConsensus(agentIds, task, patternOptions, timeout);
          break;

        case 'debate':
          result = await this._executeDebate(agentIds, task, patternOptions, timeout);
          break;

        case 'review':
          result = await this._executeReview(agentIds, task, patternOptions, timeout);
          break;

        case 'ensemble':
          result = await this._executeEnsemble(agentIds, task, patternOptions, timeout);
          break;

        default:
          throw new Error(`Unknown pattern: ${selectedPattern}`);
      }

      const duration = Date.now() - startTime;

      logger.info('Intelligent execution complete', {
        pattern: selectedPattern,
        success: result.success,
        duration: duration
      });

      // Enrich result with selection metadata
      return {
        ...result,
        pattern: selectedPattern,
        patternConfidence: confidence,
        totalDuration: duration,
        intelligentSelection: !forcePattern
      };

    } catch (error) {
      logger.error('Intelligent execution failed', {
        pattern: selectedPattern,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Execute parallel pattern
   * @private
   */
  async _executeParallel(agentIds, task, options, timeout) {
    const { synthesizer } = options;

    // Don't pass synthesizer if it's just a string descriptor
    const execOptions = { timeout: timeout };
    if (synthesizer && typeof synthesizer === 'function') {
      execOptions.synthesizer = synthesizer;
    }

    return await this.orchestrator.executeParallel(agentIds, task, execOptions);
  }

  /**
   * Execute consensus pattern
   * @private
   */
  async _executeConsensus(agentIds, task, options, timeout) {
    const {
      strategy = 'majority',
      threshold = 0.5,
      weights = {}
    } = options;

    return await this.orchestrator.executeWithConsensus(agentIds, task, {
      strategy: strategy,
      threshold: threshold,
      weights: weights,
      timeout: timeout
    });
  }

  /**
   * Execute debate pattern
   * @private
   */
  async _executeDebate(agentIds, task, options, timeout) {
    const { rounds = 3 } = options;

    return await this.orchestrator.executeDebate(agentIds, task, rounds, {
      timeout: timeout
    });
  }

  /**
   * Execute review pattern
   * @private
   */
  async _executeReview(agentIds, task, options, timeout) {
    const { revisionRounds = 2 } = options;

    // Review pattern needs creator + reviewers
    if (agentIds.length < 2) {
      throw new Error('Review pattern requires at least 2 agents (1 creator + 1 reviewer)');
    }

    const creatorId = agentIds[0];
    const reviewerIds = agentIds.slice(1);

    return await this.orchestrator.executeReview(creatorId, reviewerIds, task, {
      timeout: timeout,
      revisionRounds: revisionRounds
    });
  }

  /**
   * Execute ensemble pattern
   * @private
   */
  async _executeEnsemble(agentIds, task, options, timeout) {
    const {
      strategy = 'best-of',
      selector = null
    } = options;

    return await this.orchestrator.executeEnsemble(agentIds, task, {
      strategy: strategy,
      selector: selector,
      timeout: timeout
    });
  }

  /**
   * Get pattern suggestions for a prompt without executing
   * @param {string} prompt - User's prompt
   * @param {Object} options - Selection options
   * @returns {Object} Pattern selection result
   */
  suggestPattern(prompt, options = {}) {
    const {
      agentCount = null,
      taskType = null
    } = options;

    return this.patternSelector.select(prompt, {
      agentCount: agentCount,
      taskType: taskType
    });
  }

  /**
   * List all available orchestration patterns
   * @returns {Array} Pattern information
   */
  listPatterns() {
    return this.patternSelector.listPatterns();
  }

  /**
   * Get detailed information about a specific pattern
   * @param {string} patternName - Pattern name
   * @returns {Object} Pattern details
   */
  getPatternInfo(patternName) {
    return this.patternSelector.getPatternInfo(patternName);
  }

  /**
   * Get orchestrator statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return this.orchestrator.getStats();
  }

  /**
   * Cleanup orchestrator
   */
  destroy() {
    this.orchestrator.destroy();
    logger.info('IntelligentOrchestrator destroyed');
  }
}

module.exports = IntelligentOrchestrator;
