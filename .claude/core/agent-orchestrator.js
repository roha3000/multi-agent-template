/**
 * Agent Orchestrator - Coordinates multiple agents for collaborative tasks
 *
 * Provides various execution patterns:
 * - Parallel execution
 * - Consensus-based decision making
 * - Debate (iterative refinement)
 * - Review (create/critique/revise)
 * - Ensemble (best-of/merge/vote)
 *
 * @module agent-orchestrator
 */

const { createComponentLogger } = require('./logger');
const LifecycleHooks = require('./lifecycle-hooks');
const MemoryStore = require('./memory-store');
const MemoryIntegration = require('./memory-integration');
const AgentLoader = require('./agent-loader');

const logger = createComponentLogger('AgentOrchestrator');

class AgentOrchestrator {
  /**
   * Create an orchestrator with optional memory support
   *
   * @param {MessageBus} messageBus - Message bus instance
   * @param {Object} options - Configuration options
   * @param {boolean} [options.enableMemory=true] - Enable memory persistence
   * @param {string} [options.dbPath='.claude/memory/orchestrations.db'] - Database path
   * @param {boolean} [options.enableAI=false] - Enable AI categorization
   * @param {string} [options.aiApiKey] - Anthropic API key for AI features
   * @param {Object} [options.vectorConfig] - Vector store configuration
   * @param {string} [options.agentsDir='.claude/agents'] - Directory for agent definitions
   * @param {boolean} [options.autoLoadAgents=true] - Auto-load agents from directory
   */
  constructor(messageBus, options = {}) {
    this.messageBus = messageBus;
    this.agents = new Map();
    this.options = {
      enableMemory: options.enableMemory !== false, // Opt-out, not opt-in
      dbPath: options.dbPath || '.claude/memory/orchestrations.db',
      enableAI: options.enableAI || false,
      aiApiKey: options.aiApiKey || null,
      vectorConfig: options.vectorConfig || {},
      agentsDir: options.agentsDir || '.claude/agents',
      autoLoadAgents: options.autoLoadAgents !== false,
      ...options
    };

    // Initialize lifecycle hooks (always available, even without memory)
    this.lifecycleHooks = new LifecycleHooks();

    // Initialize agent loader
    this.agentLoader = new AgentLoader(this.options.agentsDir);

    // Initialize memory system if enabled
    if (this.options.enableMemory) {
      this._initializeMemory();
    }

    logger.info('AgentOrchestrator initialized', {
      memoryEnabled: this.options.enableMemory,
      aiEnabled: this.options.enableAI,
      agentsDir: this.options.agentsDir
    });
  }

  /**
   * Initialize memory system
   * @private
   */
  _initializeMemory() {
    try {
      this.memoryStore = new MemoryStore(this.options.dbPath);

      this.memoryIntegration = new MemoryIntegration(
        this.messageBus,
        this.memoryStore,
        {
          enableAI: this.options.enableAI,
          aiApiKey: this.options.aiApiKey
        }
      );

      // Set up lifecycle hooks for memory operations
      this.memoryIntegration.setupLifecycleHooks(this.lifecycleHooks);

      logger.info('Memory system initialized', {
        dbPath: this.options.dbPath,
        aiEnabled: this.options.enableAI
      });

    } catch (error) {
      logger.error('Failed to initialize memory system', {
        error: error.message
      });

      // Graceful degradation: continue without memory
      this.options.enableMemory = false;
      this.memoryStore = null;
      this.memoryIntegration = null;
    }
  }

  /**
   * Initialize agent loader and auto-load agents from directory
   * Call this async method after construction
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.options.autoLoadAgents) {
      try {
        logger.info('Auto-loading agents from directory...', {
          agentsDir: this.options.agentsDir
        });

        await this.agentLoader.loadAll();

        const stats = this.agentLoader.getStatistics();
        logger.info('Agent auto-loading complete', {
          totalAgents: stats.totalAgents,
          categories: stats.categories,
          phases: Object.keys(stats.byPhase)
        });

      } catch (error) {
        logger.warn('Failed to auto-load agents, continuing with manual registration', {
          error: error.message
        });
        // Graceful degradation: continue without auto-loaded agents
        // Users can still manually register agents via registerAgent()
      }
    }
  }

  /**
   * Register an agent with the orchestrator
   * @param {Agent} agent - Agent instance
   */
  registerAgent(agent) {
    this.agents.set(agent.id, agent);
    logger.info('Agent registered', { agentId: agent.id, role: agent.role });
  }

  /**
   * Unregister an agent
   * @param {string} agentId - Agent ID
   */
  unregisterAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.destroy();
      this.agents.delete(agentId);
      logger.info('Agent unregistered', { agentId });
    }
  }

  /**
   * Get agent by ID or name
   * First checks registered agents, then falls back to agent loader
   * @param {string} agentIdOrName - Agent ID or name
   * @returns {Agent|Object|null} Agent instance or configuration
   */
  getAgent(agentIdOrName) {
    // First check manually registered agents
    const registeredAgent = this.agents.get(agentIdOrName);
    if (registeredAgent) {
      return registeredAgent;
    }

    // Fall back to agent loader
    return this.agentLoader.getAgent(agentIdOrName) || null;
  }

  /**
   * Find best agent for task based on criteria
   * Delegates to agent loader
   * @param {Object} criteria - Search criteria
   * @param {string} criteria.phase - Preferred phase
   * @param {string[]} criteria.capabilities - Required capabilities
   * @param {string[]} criteria.tags - Preferred tags
   * @param {string} criteria.category - Preferred category
   * @returns {Object|null} Best matching agent configuration or null
   */
  findAgentForTask(criteria) {
    return this.agentLoader.findAgentForTask(criteria);
  }

  /**
   * Get all agents for a specific phase
   * Delegates to agent loader
   * @param {string} phase - Phase name (research, planning, design, etc.)
   * @returns {Object[]} Array of matching agent configurations
   */
  getAgentsByPhase(phase) {
    return this.agentLoader.getAgentsByPhase(phase);
  }

  /**
   * Get all agents with a specific capability
   * Delegates to agent loader
   * @param {string} capability - Capability name
   * @returns {Object[]} Array of matching agent configurations
   */
  getAgentsByCapability(capability) {
    return this.agentLoader.getAgentsByCapability(capability);
  }

  /**
   * Get all agents in a specific category
   * Delegates to agent loader
   * @param {string} category - Category name
   * @returns {Object[]} Array of matching agent configurations
   */
  getAgentsByCategory(category) {
    return this.agentLoader.getAgentsByCategory(category);
  }

  /**
   * Get all agents with a specific tag
   * Delegates to agent loader
   * @param {string} tag - Tag name
   * @returns {Object[]} Array of matching agent configurations
   */
  getAgentsByTag(tag) {
    return this.agentLoader.getAgentsByTag(tag);
  }

  /**
   * Execute task with multiple agents in parallel
   *
   * HYBRID ARCHITECTURE:
   * - HOOKS: Load context (before) and save results (after)
   * - EVENTS: Notify subscribers via MessageBus
   *
   * @param {Array<string>} agentIds - Agent IDs to execute
   * @param {Object} task - Task to execute
   * @param {Object} options - Execution options
   * @param {boolean} [options.useMemory=true] - Load historical context
   * @returns {Promise<Object>} Combined results
   */
  async executeParallel(agentIds, task, options = {}) {
    const {
      timeout = 60000,
      retries = 3,
      synthesizer = this._defaultSynthesizer,
      useMemory = true
    } = options;

    logger.info('Starting parallel execution', {
      agentCount: agentIds.length,
      agentIds,
      useMemory
    });

    const startTime = Date.now();

    try {
      // HOOK: Before execution (guaranteed, synchronous)
      // Loads relevant historical context
      let context = await this.lifecycleHooks.executeHook('beforeExecution', {
        pattern: 'parallel',
        agentIds,
        task,
        options
      });

      if (context.memoryContext?.loaded) {
        logger.info('Historical context loaded', {
          orchestrations: context.memoryContext.orchestrations?.length || 0
        });
      }

      // Execute all agents in parallel
      const promises = agentIds.map(agentId => {
        const agent = this.getAgent(agentId);
        if (!agent) {
          return Promise.reject(new Error(`Agent not found: ${agentId}`));
        }

        // Pass memory context to agent if available
        const enrichedTask = context.memoryContext
          ? { ...task, memoryContext: context.memoryContext }
          : task;

        return this._executeWithRetry(agent, enrichedTask, { timeout, retries });
      });

      const results = await Promise.allSettled(promises);

      // Separate successful and failed results
      const successful = [];
      const failed = [];

      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') {
          successful.push({
            agentId: agentIds[idx],
            result: r.value
          });
        } else {
          failed.push({
            agentId: agentIds[idx],
            error: r.reason.message
          });
        }
      });

      const duration = Date.now() - startTime;

      logger.info('Parallel execution complete', {
        successful: successful.length,
        failed: failed.length,
        duration
      });

      // Synthesize results
      const synthesized = await synthesizer(successful.map(s => s.result), task);

      const result = {
        success: successful.length > 0,
        synthesized,
        results: successful,
        failures: failed,
        duration,
        metadata: {
          pattern: 'parallel',
          agentIds,
          contextLoaded: context.memoryContext?.loaded || false
        }
      };

      // HOOK: After execution (guaranteed, synchronous)
      // Ensures critical operations complete
      await this.lifecycleHooks.executeHook('afterExecution', result);

      // EVENT: Notify subscribers (optional, asynchronous, fault-isolated)
      // MessageBus ensures failures here don't affect orchestration
      this.messageBus.publish('orchestrator:execution:complete', {
        pattern: 'parallel',
        agentIds,
        task,
        result,
        duration
      }, 'orchestrator');

      return result;

    } catch (error) {
      logger.error('Parallel execution failed', { error: error.message });

      // HOOK: On error (guaranteed, synchronous)
      await this.lifecycleHooks.executeHook('onError', {
        pattern: 'parallel',
        agentIds,
        task,
        error,
        context: { task, agentIds }
      });

      throw error;
    }
  }

  /**
   * Execute task and reach consensus through voting
   * @param {Array<string>} agentIds - Agent IDs to execute
   * @param {Object} task - Task to execute
   * @param {Object} options - Consensus options
   * @returns {Promise<Object>} Consensus result
   */
  async executeWithConsensus(agentIds, task, options = {}) {
    const {
      strategy = 'majority', // majority, weighted, unanimous
      threshold = 0.5, // For majority (0.5 = 50%+1)
      weights = {}, // For weighted voting
      timeout = 60000
    } = options;

    logger.info('Starting consensus execution', {
      agentCount: agentIds.length,
      strategy,
      threshold
    });

    // Execute all agents in parallel
    const parallelResult = await this.executeParallel(agentIds, task, {
      timeout,
      synthesizer: (results) => results // No synthesis yet
    });

    if (!parallelResult.success || parallelResult.results.length === 0) {
      throw new Error('No agents succeeded - cannot reach consensus');
    }

    // Perform voting based on strategy
    const vote = await this._performVoting(
      parallelResult.results,
      strategy,
      threshold,
      weights
    );

    logger.info('Consensus reached', {
      strategy,
      winner: vote.winner ? 'yes' : 'no',
      confidence: vote.confidence
    });

    return {
      success: vote.consensus,
      result: vote.winner,
      vote,
      allResults: parallelResult.results,
      duration: parallelResult.duration
    };
  }

  /**
   * Execute debate: iterative refinement through multiple rounds
   * @param {Array<string>} agentIds - Agent IDs participating in debate
   * @param {Object} topic - Topic/task to debate
   * @param {number} rounds - Number of debate rounds
   * @param {Object} options - Debate options
   * @returns {Promise<Object>} Final refined result
   */
  async executeDebate(agentIds, topic, rounds = 3, options = {}) {
    const { timeout = 60000 } = options;

    logger.info('Starting debate', {
      agentCount: agentIds.length,
      rounds
    });

    let proposal = topic.initialProposal || 'Initial proposal';
    const debateHistory = [];

    for (let round = 1; round <= rounds; round++) {
      logger.debug('Debate round starting', { round, rounds });

      // Each agent critiques the current proposal
      const critiqueTask = {
        type: 'critique',
        proposal,
        round,
        instruction: `Critique the following proposal and suggest improvements:\n\n${proposal}`
      };

      const critiques = await this.executeParallel(agentIds, critiqueTask, {
        timeout,
        synthesizer: (results) => results
      });

      // Synthesize critiques into improved proposal
      const synthesizeTask = {
        type: 'synthesize',
        proposal,
        critiques: critiques.results,
        round
      };

      // Use first agent to synthesize (could be specialized synthesizer agent)
      const synthesizer = this.getAgent(agentIds[0]);
      const synthesized = await synthesizer.execute(synthesizeTask);

      proposal = synthesized.improvedProposal || synthesized.result || proposal;

      debateHistory.push({
        round,
        proposal,
        critiques: critiques.results,
        synthesized
      });

      logger.debug('Debate round complete', { round, proposalLength: proposal.length });
    }

    logger.info('Debate complete', { rounds, historyLength: debateHistory.length });

    return {
      success: true,
      finalProposal: proposal,
      debateHistory,
      rounds
    };
  }

  /**
   * Execute review pattern: create, critique, revise
   * @param {string} creatorId - Agent ID for creator
   * @param {Array<string>} reviewerIds - Agent IDs for reviewers
   * @param {Object} task - Task to create/review
   * @param {Object} options - Review options
   * @returns {Promise<Object>} Reviewed and revised result
   */
  async executeReview(creatorId, reviewerIds, task, options = {}) {
    const {
      timeout = 60000,
      revisionRounds = 1
    } = options;

    logger.info('Starting review process', {
      creator: creatorId,
      reviewerCount: reviewerIds.length,
      revisionRounds
    });

    const creator = this.getAgent(creatorId);
    if (!creator) {
      throw new Error(`Creator agent not found: ${creatorId}`);
    }

    // Step 1: Creator produces initial work
    logger.debug('Creator producing initial work');
    let currentWork = await creator.execute({
      ...task,
      phase: 'create'
    });

    const reviewHistory = [];

    // Step 2-3: Review and revise loop
    for (let round = 1; round <= revisionRounds; round++) {
      logger.debug('Review round starting', { round, revisionRounds });

      // Reviewers critique the work
      const reviewTask = {
        ...task,
        phase: 'review',
        work: currentWork,
        round
      };

      const reviews = await this.executeParallel(reviewerIds, reviewTask, {
        timeout,
        synthesizer: (results) => results
      });

      // Creator revises based on feedback
      const reviseTask = {
        ...task,
        phase: 'revise',
        work: currentWork,
        reviews: reviews.results,
        round
      };

      currentWork = await creator.execute(reviseTask);

      reviewHistory.push({
        round,
        reviews: reviews.results,
        revisedWork: currentWork
      });

      logger.debug('Review round complete', { round });
    }

    logger.info('Review process complete', { revisionRounds });

    return {
      success: true,
      finalWork: currentWork,
      reviewHistory,
      revisionRounds
    };
  }

  /**
   * Execute ensemble: combine multiple agent outputs
   * @param {Array<string>} agentIds - Agent IDs to execute
   * @param {Object} task - Task to execute
   * @param {Object} options - Ensemble options
   * @returns {Promise<Object>} Ensemble result
   */
  async executeEnsemble(agentIds, task, options = {}) {
    const {
      strategy = 'best-of', // best-of, merge, vote
      timeout = 60000,
      selector = null
    } = options;

    logger.info('Starting ensemble execution', {
      agentCount: agentIds.length,
      strategy
    });

    // Execute all agents
    const parallelResult = await this.executeParallel(agentIds, task, {
      timeout,
      synthesizer: (results) => results
    });

    if (!parallelResult.success || parallelResult.results.length === 0) {
      throw new Error('No agents succeeded in ensemble');
    }

    let ensembleResult;

    switch (strategy) {
      case 'best-of':
        ensembleResult = await this._selectBest(
          parallelResult.results,
          selector || this._defaultSelector
        );
        break;

      case 'merge':
        ensembleResult = await this._mergeResults(parallelResult.results);
        break;

      case 'vote':
        const vote = await this._performVoting(
          parallelResult.results,
          'majority',
          0.5,
          {}
        );
        ensembleResult = vote.winner;
        break;

      default:
        throw new Error(`Unknown ensemble strategy: ${strategy}`);
    }

    logger.info('Ensemble execution complete', { strategy });

    return {
      success: true,
      result: ensembleResult,
      strategy,
      allResults: parallelResult.results,
      duration: parallelResult.duration
    };
  }

  /**
   * Execute agent with retry logic
   * @private
   */
  async _executeWithRetry(agent, task, options) {
    const { timeout, retries } = options;
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Execution timeout')), timeout)
        );

        const executionPromise = agent.execute(task);

        const result = await Promise.race([executionPromise, timeoutPromise]);

        return result;

      } catch (error) {
        lastError = error;
        logger.warn('Agent execution failed', {
          agentId: agent.id,
          attempt,
          retries,
          error: error.message
        });

        if (attempt < retries) {
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw lastError;
  }

  /**
   * Perform voting on results
   * @private
   */
  async _performVoting(results, strategy, threshold, weights) {
    // For simplicity, assume results have a 'value' or 'decision' field
    const votes = new Map();

    results.forEach(({ agentId, result }) => {
      const value = result.value || result.decision || JSON.stringify(result);
      const weight = weights[agentId] || 1;

      votes.set(value, (votes.get(value) || 0) + weight);
    });

    const totalWeight = results.reduce((sum, { agentId }) => sum + (weights[agentId] || 1), 0);

    // Find winner
    let winner = null;
    let maxVotes = 0;

    for (const [value, voteCount] of votes.entries()) {
      if (voteCount > maxVotes) {
        maxVotes = voteCount;
        winner = value;
      }
    }

    const confidence = maxVotes / totalWeight;
    let consensus = false;

    switch (strategy) {
      case 'majority':
        consensus = confidence > threshold;
        break;
      case 'unanimous':
        consensus = confidence === 1.0;
        break;
      case 'weighted':
        consensus = confidence >= threshold;
        break;
    }

    return {
      winner,
      consensus,
      confidence,
      votes: Array.from(votes.entries()).map(([value, count]) => ({ value, count }))
    };
  }

  /**
   * Select best result
   * @private
   */
  async _selectBest(results, selector) {
    if (results.length === 0) return null;
    if (results.length === 1) return results[0].result;

    // Use selector function to choose best
    return selector(results.map(r => r.result));
  }

  /**
   * Merge multiple results
   * @private
   */
  async _mergeResults(results) {
    // Simple merge: combine all results into array
    // Override this for domain-specific merging
    return results.map(r => r.result);
  }

  /**
   * Default synthesizer: just return first result
   * @private
   */
  _defaultSynthesizer(results, task) {
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Default selector: return first result
   * @private
   */
  _defaultSelector(results) {
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Get orchestrator statistics
   */
  getStats() {
    const agentStats = Array.from(this.agents.values()).map(agent => agent.getStats());

    return {
      totalAgents: this.agents.size,
      agents: agentStats,
      topics: this.messageBus.getActiveTopics().length
    };
  }

  /**
   * Cleanup orchestrator
   */
  destroy() {
    // Destroy all agents
    Array.from(this.agents.values()).forEach(agent => agent.destroy());
    this.agents.clear();

    logger.info('Orchestrator destroyed');
  }
}

module.exports = AgentOrchestrator;
