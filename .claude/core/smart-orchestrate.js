/**
 * Smart Orchestration - Context-aware orchestration that chooses between
 * manual pattern selection (precise) and intelligent selection (convenient)
 *
 * Decision logic:
 * - Explicit pattern specified → Use manual AgentOrchestrator
 * - Natural language prompt provided → Use IntelligentOrchestrator
 * - Structured task object only → Use manual with best-guess pattern
 *
 * @module smart-orchestrate
 */

const AgentOrchestrator = require('./agent-orchestrator');
const IntelligentOrchestrator = require('./intelligent-orchestrator');
const { createComponentLogger } = require('./logger');

const logger = createComponentLogger('SmartOrchestrate');

/**
 * Smart orchestration modes
 */
const MODES = {
  MANUAL: 'manual',      // Explicit pattern specified
  INTELLIGENT: 'intelligent',  // Natural language prompt
  AUTO: 'auto'          // Best guess from context
};

/**
 * Pattern inference from task structure
 * Used when no explicit pattern or prompt is provided
 */
function inferPatternFromTask(task, agentCount) {
  // Check task type first
  if (task.type) {
    const type = task.type.toLowerCase();

    // Decision/voting tasks → consensus
    if (/decide|vote|choose|select|approve/.test(type)) {
      return 'consensus';
    }

    // Creation with review → review pattern
    if (/create.*review|implement.*review|develop.*review/.test(type)) {
      return 'review';
    }

    // Refinement tasks → debate
    if (/refine|debate|improve|iterate/.test(type)) {
      return 'debate';
    }

    // Combination tasks → ensemble
    if (/combine|merge|aggregate|best-of/.test(type)) {
      return 'ensemble';
    }

    // Research/analysis tasks → parallel
    if (/research|analyze|investigate|explore/.test(type)) {
      return 'parallel';
    }
  }

  // Check for phase indicators
  if (task.phase) {
    const phase = task.phase.toLowerCase();

    if (phase === 'review') {
      return 'review';
    }
    if (phase === 'create' || phase === 'implement') {
      return 'review'; // Assume creation will need review
    }
  }

  // Default based on agent count
  if (agentCount === 1) {
    return null; // Single agent doesn't need orchestration
  }

  if (agentCount >= 3) {
    return 'parallel'; // Multiple agents → parallel by default
  }

  return 'parallel'; // Safe default
}

/**
 * Smart orchestration wrapper
 */
class SmartOrchestrator {
  /**
   * Creates a SmartOrchestrator instance
   * @param {MessageBus} messageBus - Message bus instance
   * @param {Object} options - Configuration options
   */
  constructor(messageBus, options = {}) {
    this.messageBus = messageBus;
    this.manualOrchestrator = new AgentOrchestrator(messageBus);
    this.intelligentOrchestrator = new IntelligentOrchestrator(messageBus, options.intelligent || {});

    this.options = {
      preferIntelligent: true, // Prefer intelligent when ambiguous
      logDecisions: true,
      ...options
    };

    logger.info('SmartOrchestrator initialized', {
      preferIntelligent: this.options.preferIntelligent
    });
  }

  /**
   * Register an agent
   * @param {Agent} agent - Agent instance
   */
  registerAgent(agent) {
    this.manualOrchestrator.registerAgent(agent);
    this.intelligentOrchestrator.registerAgent(agent);
  }

  /**
   * Unregister an agent
   * @param {string} agentId - Agent ID
   */
  unregisterAgent(agentId) {
    this.manualOrchestrator.unregisterAgent(agentId);
    this.intelligentOrchestrator.unregisterAgent(agentId);
  }

  /**
   * Get agent by ID
   * @param {string} agentId - Agent ID
   * @returns {Agent|null} Agent instance
   */
  getAgent(agentId) {
    return this.manualOrchestrator.getAgent(agentId);
  }

  /**
   * Smart orchestration - automatically chooses best approach
   *
   * Usage patterns:
   *
   * 1. Explicit pattern (manual):
   *    orchestrate(agentIds, task, { pattern: 'parallel' })
   *
   * 2. Natural language prompt (intelligent):
   *    orchestrate(agentIds, task, { prompt: 'Have agents vote on best option' })
   *
   * 3. Auto-detect from task (smart):
   *    orchestrate(agentIds, { type: 'research', topic: 'HIPAA' })
   *
   * @param {Array<string>} agentIds - Agent IDs to use
   * @param {Object} task - Task object
   * @param {Object} options - Orchestration options
   * @returns {Promise<Object>} Execution result with metadata
   */
  async orchestrate(agentIds, task, options = {}) {
    const {
      pattern = null,      // Explicit pattern
      prompt = null,       // Natural language prompt
      patternOptions = {}, // Pattern-specific options
      timeout = 60000
    } = options;

    // Determine orchestration mode
    let mode;
    let selectedPattern;
    let orchestrator;

    // Mode 1: Explicit pattern specified → Manual
    if (pattern) {
      mode = MODES.MANUAL;
      selectedPattern = pattern;
      orchestrator = this.manualOrchestrator;

      if (this.options.logDecisions) {
        logger.info('Using manual orchestration', {
          pattern: selectedPattern,
          reason: 'Explicit pattern specified'
        });
      }
    }

    // Mode 2: Natural language prompt → Intelligent
    else if (prompt && typeof prompt === 'string' && prompt.length > 0) {
      mode = MODES.INTELLIGENT;
      orchestrator = this.intelligentOrchestrator;

      if (this.options.logDecisions) {
        logger.info('Using intelligent orchestration', {
          prompt: prompt.slice(0, 50) + '...',
          reason: 'Natural language prompt provided'
        });
      }

      // Let intelligent orchestrator handle execution
      const result = await orchestrator.execute(prompt, agentIds, task, {
        patternOptions: patternOptions,
        timeout: timeout
      });

      // Add orchestration mode metadata
      return {
        ...result,
        orchestrationMode: mode
      };
    }

    // Mode 3: Auto-detect from task structure
    else {
      mode = MODES.AUTO;
      selectedPattern = inferPatternFromTask(task, agentIds.length);

      if (!selectedPattern) {
        throw new Error('Cannot determine orchestration pattern. Provide explicit pattern or prompt.');
      }

      if (this.options.preferIntelligent && task.description) {
        // Try intelligent with task description
        mode = MODES.INTELLIGENT;
        orchestrator = this.intelligentOrchestrator;

        if (this.options.logDecisions) {
          logger.info('Using intelligent orchestration', {
            description: task.description.slice(0, 50) + '...',
            reason: 'Task description available, prefer intelligent'
          });
        }

        const result = await orchestrator.execute(task.description, agentIds, task, {
          patternOptions: patternOptions,
          timeout: timeout
        });

        // Add orchestration mode metadata
        return {
          ...result,
          orchestrationMode: mode
        };
      } else {
        // Use inferred pattern with manual orchestrator
        orchestrator = this.manualOrchestrator;

        if (this.options.logDecisions) {
          logger.info('Using manual orchestration', {
            pattern: selectedPattern,
            reason: 'Inferred from task structure'
          });
        }
      }
    }

    // Execute with manual orchestrator
    const startTime = Date.now();
    let result;

    try {
      switch (selectedPattern) {
        case 'parallel':
          result = await orchestrator.executeParallel(agentIds, task, {
            timeout: timeout,
            ...patternOptions
          });
          break;

        case 'consensus':
          result = await orchestrator.executeWithConsensus(agentIds, task, {
            timeout: timeout,
            ...patternOptions
          });
          break;

        case 'debate':
          result = await orchestrator.executeDebate(
            agentIds,
            task,
            patternOptions.rounds || 3,
            { timeout: timeout }
          );
          break;

        case 'review':
          if (agentIds.length < 2) {
            throw new Error('Review pattern requires at least 2 agents');
          }
          result = await orchestrator.executeReview(
            agentIds[0],
            agentIds.slice(1),
            task,
            {
              timeout: timeout,
              revisionRounds: patternOptions.revisionRounds || 2
            }
          );
          break;

        case 'ensemble':
          result = await orchestrator.executeEnsemble(agentIds, task, {
            timeout: timeout,
            strategy: patternOptions.strategy || 'best-of',
            ...patternOptions
          });
          break;

        default:
          throw new Error(`Unknown pattern: ${selectedPattern}`);
      }

      const duration = Date.now() - startTime;

      // Enrich result with metadata
      return {
        ...result,
        orchestrationMode: mode,
        pattern: selectedPattern,
        totalDuration: duration,
        smartSelection: mode !== MODES.MANUAL
      };

    } catch (error) {
      logger.error('Orchestration failed', {
        mode: mode,
        pattern: selectedPattern,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Suggest orchestration approach for given context
   * @param {Array<string>} agentIds - Agent IDs
   * @param {Object} task - Task object
   * @param {Object} options - Options
   * @returns {Object} Suggestion
   */
  suggest(agentIds, task, options = {}) {
    const { prompt = null } = options;

    // If prompt provided, use intelligent suggestion
    if (prompt) {
      return {
        mode: MODES.INTELLIGENT,
        suggestion: this.intelligentOrchestrator.suggestPattern(prompt, {
          agentCount: agentIds.length,
          taskType: task.type
        })
      };
    }

    // Otherwise infer from task
    const pattern = inferPatternFromTask(task, agentIds.length);

    return {
      mode: MODES.AUTO,
      pattern: pattern,
      reasoning: `Inferred from task type: ${task.type}`,
      confidence: 0.7
    };
  }

  /**
   * Get statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return this.manualOrchestrator.getStats();
  }

  /**
   * Cleanup
   */
  destroy() {
    this.manualOrchestrator.destroy();
    this.intelligentOrchestrator.destroy();
    logger.info('SmartOrchestrator destroyed');
  }
}

/**
 * Convenience function for one-off orchestration
 * @param {MessageBus} messageBus - Message bus
 * @param {Array<Agent>} agents - Agent instances
 * @param {Object} task - Task object
 * @param {Object} options - Options
 * @returns {Promise<Object>} Result
 */
async function smartOrchestrate(messageBus, agents, task, options = {}) {
  const orchestrator = new SmartOrchestrator(messageBus);

  // Register agents
  agents.forEach(agent => orchestrator.registerAgent(agent));

  // Execute
  const agentIds = agents.map(a => a.id);
  const result = await orchestrator.orchestrate(agentIds, task, options);

  // Cleanup
  orchestrator.destroy();

  return result;
}

module.exports = SmartOrchestrator;
module.exports.smartOrchestrate = smartOrchestrate;
module.exports.MODES = MODES;
