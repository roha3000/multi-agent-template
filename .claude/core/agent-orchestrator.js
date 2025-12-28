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
const { DelegationContext } = require('./delegation-context');
const { AggregationStrategies } = require('./aggregation-strategies');
const { DelegationDecider, DelegationPattern } = require('./delegation-decider');

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

    // Initialize delegation decider for auto-delegation
    this.delegationDecider = new DelegationDecider({
      config: options.delegationConfig || {}
    });

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
   * @param {boolean} [options.parallelSynthesis=false] - Enable parallel synthesis with multiple agents
   * @param {number} [options.synthesizerCount=1] - Number of synthesizers when parallel (default: all agents)
   * @param {string} [options.mergeStrategy='best'] - How to merge parallel syntheses: 'best', 'consensus', 'merge'
   * @returns {Promise<Object>} Final refined result
   */
  async executeDebate(agentIds, topic, rounds = 3, options = {}) {
    const {
      timeout = 60000,
      parallelSynthesis = false,
      synthesizerCount = agentIds.length,
      mergeStrategy = 'best'
    } = options;

    logger.info('Starting debate', {
      agentCount: agentIds.length,
      rounds,
      parallelSynthesis,
      synthesizerCount: parallelSynthesis ? Math.min(synthesizerCount, agentIds.length) : 1
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

      let synthesized;
      let synthesisResults = [];

      if (parallelSynthesis && agentIds.length > 1) {
        // Parallel synthesis: multiple agents synthesize concurrently for 2.5x speedup
        const synthesizerIds = agentIds.slice(0, Math.min(synthesizerCount, agentIds.length));

        logger.debug('Parallel synthesis starting', {
          round,
          synthesizerCount: synthesizerIds.length,
          mergeStrategy
        });

        // Execute all synthesizers in parallel
        const synthesisPromises = synthesizerIds.map(async (agentId) => {
          const agent = this.getAgent(agentId);
          if (!agent) {
            throw new Error(`Synthesizer agent not found: ${agentId}`);
          }
          const result = await agent.execute(synthesizeTask);
          return { agentId, result };
        });

        const parallelResults = await Promise.allSettled(synthesisPromises);

        // Collect successful syntheses
        for (const result of parallelResults) {
          if (result.status === 'fulfilled') {
            synthesisResults.push(result.value);
          } else {
            logger.warn('Parallel synthesis failed for agent', {
              error: result.reason?.message || result.reason
            });
          }
        }

        if (synthesisResults.length === 0) {
          throw new Error('All parallel synthesizers failed');
        }

        // Merge results based on strategy
        synthesized = await this._mergeDebateSyntheses(synthesisResults, mergeStrategy);

        logger.debug('Parallel synthesis complete', {
          round,
          successfulSynthesizers: synthesisResults.length,
          mergeStrategy
        });

      } else {
        // Sequential synthesis: use first agent (default behavior)
        const synthesizer = this.getAgent(agentIds[0]);
        synthesized = await synthesizer.execute(synthesizeTask);
        synthesisResults = [{ agentId: agentIds[0], result: synthesized }];
      }

      proposal = synthesized.improvedProposal || synthesized.result || proposal;

      debateHistory.push({
        round,
        proposal,
        critiques: critiques.results,
        synthesized,
        parallelSynthesis: parallelSynthesis && agentIds.length > 1,
        synthesisResults: parallelSynthesis ? synthesisResults : undefined
      });

      logger.debug('Debate round complete', { round, proposalLength: proposal.length });
    }

    logger.info('Debate complete', {
      rounds,
      historyLength: debateHistory.length,
      parallelSynthesis
    });

    return {
      success: true,
      finalProposal: proposal,
      debateHistory,
      rounds,
      parallelSynthesis
    };
  }

  /**
   * Merge multiple synthesis results from parallel debate synthesis
   * @private
   * @param {Array<{agentId: string, result: Object}>} synthesisResults - Results from parallel synthesizers
   * @param {string} strategy - Merge strategy: 'best', 'consensus', 'merge'
   * @returns {Object} Merged synthesis result
   */
  async _mergeDebateSyntheses(synthesisResults, strategy) {
    if (synthesisResults.length === 0) {
      throw new Error('No synthesis results to merge');
    }

    if (synthesisResults.length === 1) {
      return synthesisResults[0].result;
    }

    switch (strategy) {
      case 'best':
        // Select the synthesis with the highest quality score or confidence
        let best = synthesisResults[0].result;
        let bestScore = best.quality || best.confidence || 0;

        for (const { result } of synthesisResults) {
          const score = result.quality || result.confidence || 0;
          if (score > bestScore) {
            best = result;
            bestScore = score;
          }
        }

        // If no scores, use the first result (maintains backward compatibility)
        return best;

      case 'consensus':
        // Find common elements across all syntheses
        const proposals = synthesisResults.map(s =>
          s.result.improvedProposal || s.result.result || ''
        );

        // Simple consensus: if all proposals are similar (>80% overlap), use first
        // Otherwise, merge unique insights
        const allSimilar = proposals.every((p, i) =>
          i === 0 || this._calculateSimilarity(proposals[0], p) > 0.8
        );

        if (allSimilar) {
          return synthesisResults[0].result;
        }

        // Merge unique points
        return {
          improvedProposal: proposals.join('\n\n--- Alternative synthesis ---\n\n'),
          merged: true,
          sourceCount: synthesisResults.length,
          consensus: false
        };

      case 'merge':
        // Combine all synthesis results
        const allProposals = synthesisResults.map(s =>
          s.result.improvedProposal || s.result.result || ''
        );

        return {
          improvedProposal: allProposals.join('\n\n--- Synthesis from another agent ---\n\n'),
          merged: true,
          sourceCount: synthesisResults.length,
          sources: synthesisResults.map(s => s.agentId)
        };

      default:
        logger.warn('Unknown merge strategy, using best', { strategy });
        return synthesisResults[0].result;
    }
  }

  /**
   * Calculate similarity between two strings (simple Jaccard similarity on words)
   * @private
   */
  _calculateSimilarity(str1, str2) {
    const words1 = new Set(str1.toLowerCase().split(/\s+/));
    const words2 = new Set(str2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return union.size > 0 ? intersection.size / union.size : 0;
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
    // For simplicity, assume results have a 'decision' or 'value' field
    const votes = new Map();

    results.forEach(({ agentId, result }) => {
      // Prioritize 'decision' field over 'value' for voting
      const value = result.decision || result.value || JSON.stringify(result);
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

  // ============================================
  // Delegation Primitives (Phase 2)
  // ============================================

  /**
   * Delegate a task to a child agent
   * @param {string} parentAgentId - Agent delegating the task
   * @param {Object} task - Task to delegate
   * @param {Object} options - Delegation options
   * @param {string} [options.childAgentId] - Specific child agent (optional)
   * @param {number} [options.timeout=60000] - Timeout in ms
   * @param {Object} [options.context={}] - Additional context
   * @returns {Promise<Object>} Delegation result
   */
  async delegateTask(parentAgentId, task, options = {}) {
    const {
      childAgentId = null,
      timeout = 60000,
      context: additionalContext = {}
    } = options;

    const startTime = Date.now();

    // Get parent agent
    const parentAgent = this.getAgent(parentAgentId);
    if (!parentAgent) {
      return {
        success: false,
        error: `Parent agent ${parentAgentId} not found`,
        duration: Date.now() - startTime
      };
    }

    // Build delegation context
    let delegationContext;
    try {
      delegationContext = DelegationContext.buildDelegationContext(
        parentAgent,
        task,
        task, // subtask is same as task for direct delegation
        {
          childAgentId,
          timeout,
          startTime,
          ...additionalContext
        }
      );
    } catch (error) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      };
    }

    logger.info('Delegating task', {
      parentAgentId,
      childAgentId,
      delegationId: delegationContext.delegationId,
      tokenBudget: delegationContext.constraints.tokenBudget
    });

    // Find or select target agent
    let targetAgent;
    if (childAgentId) {
      targetAgent = this.getAgent(childAgentId);
      if (!targetAgent) {
        return {
          success: false,
          error: `Child agent ${childAgentId} not found`,
          duration: Date.now() - startTime
        };
      }
    } else {
      // Find best agent for task
      const candidates = this.findAgentForTask({
        phase: task.phase,
        capabilities: task.requiredCapabilities || [],
        tags: task.tags || []
      });
      if (candidates) {
        targetAgent = this.getAgent(candidates.id);
      }
    }

    if (!targetAgent) {
      // Fall back to parent executing itself
      logger.warn('No suitable child agent found, parent executing task');
      targetAgent = parentAgent;
    }

    // Execute the task
    try {
      const result = await this._executeWithRetry(targetAgent, {
        ...task,
        delegationContext: delegationContext.toJSON()
      }, { timeout, retries: delegationContext.constraints.maxRetries });

      logger.info('Delegation completed', {
        delegationId: delegationContext.delegationId,
        duration: Date.now() - startTime
      });

      return {
        success: true,
        delegationId: delegationContext.delegationId,
        result,
        agentId: targetAgent.id,
        duration: Date.now() - startTime,
        tokenReduction: delegationContext.metadata.tokenReduction
      };

    } catch (error) {
      logger.error('Delegation failed', {
        delegationId: delegationContext.delegationId,
        error: error.message
      });

      return {
        success: false,
        delegationId: delegationContext.delegationId,
        error: error.message,
        agentId: targetAgent?.id,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Aggregate results from multiple delegations
   * @param {Array<Object>} results - Results to aggregate
   * @param {string} strategy - Aggregation strategy (merge, selectBest, vote, chain)
   * @param {Object} options - Strategy-specific options
   * @returns {Object} Aggregated result
   */
  aggregateResults(results, strategy = 'merge', options = {}) {
    logger.debug('Aggregating results', { strategy, resultCount: results?.length });

    switch (strategy) {
      case 'selectBest':
        return AggregationStrategies.selectBest(results, options);
      case 'vote':
        return AggregationStrategies.vote(results, options);
      case 'chain':
        return AggregationStrategies.chain(results, options);
      case 'merge':
      default:
        return AggregationStrategies.merge(results, options);
    }
  }

  /**
   * Execute delegated tasks in parallel and aggregate results
   * @param {string} parentAgentId - Parent agent ID
   * @param {Array<Object>} tasks - Tasks to delegate
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Aggregated results
   */
  async executeParallelDelegation(parentAgentId, tasks, options = {}) {
    const {
      aggregationStrategy = 'merge',
      aggregationOptions = {},
      timeout = 60000
    } = options;

    logger.info('Starting parallel delegation', {
      parentAgentId,
      taskCount: tasks.length,
      aggregationStrategy
    });

    const startTime = Date.now();

    // Delegate all tasks in parallel
    const promises = tasks.map(task =>
      this.delegateTask(parentAgentId, task, { timeout, ...options })
    );

    const results = await Promise.allSettled(promises);

    // Collect successful results
    const successful = [];
    const failed = [];

    results.forEach((r, idx) => {
      if (r.status === 'fulfilled' && r.value.success) {
        successful.push({
          agentId: r.value.agentId,
          result: r.value.result,
          delegationId: r.value.delegationId
        });
      } else {
        failed.push({
          taskIndex: idx,
          error: r.status === 'rejected' ? r.reason.message : r.value.error
        });
      }
    });

    // Aggregate successful results
    const aggregated = this.aggregateResults(successful, aggregationStrategy, aggregationOptions);

    logger.info('Parallel delegation complete', {
      successful: successful.length,
      failed: failed.length,
      duration: Date.now() - startTime
    });

    return {
      success: successful.length > 0,
      aggregated,
      successful,
      failed,
      duration: Date.now() - startTime
    };
  }

  // ============================================
  // Auto-Delegation Methods (Phase 3)
  // ============================================

  /**
   * Execute task with automatic delegation decision
   * @param {string} agentId - Agent to execute task
   * @param {Object} task - Task to execute
   * @param {Object} options - Execution options
   * @param {boolean} [options.autoDelegation=true] - Enable auto-delegation
   * @param {Object} [options.delegationConfig] - Override delegation config
   * @returns {Promise<Object>} Execution result
   */
  async executeWithAutoDelegation(agentId, task, options = {}) {
    const {
      autoDelegation = true,
      delegationConfig = {},
      timeout = 60000
    } = options;

    const agent = this.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const startTime = Date.now();

    // Get delegation decision
    let decision = null;
    if (autoDelegation) {
      decision = this.getDelegationHint(task, agent, { config: delegationConfig });
    }

    logger.info('Auto-delegation evaluation', {
      agentId,
      taskId: task.id,
      shouldDelegate: decision?.shouldDelegate,
      pattern: decision?.suggestedPattern,
      confidence: decision?.confidence
    });

    // If delegation is recommended, decompose and delegate
    if (decision?.shouldDelegate) {
      return this._executeWithDelegation(agent, task, decision, options);
    }

    // Otherwise, execute directly
    try {
      const result = await this._executeWithRetry(agent, task, { timeout, retries: 3 });

      return {
        success: true,
        result,
        delegated: false,
        decision,
        duration: Date.now() - startTime,
        metadata: { pattern: 'direct', agentId }
      };
    } catch (error) {
      logger.error('Direct execution failed', { agentId, error: error.message });

      return {
        success: false,
        error: error.message,
        delegated: false,
        decision,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Execute task through delegation based on decision
   * @private
   */
  async _executeWithDelegation(agent, task, decision, options) {
    const { timeout = 60000 } = options;
    const startTime = Date.now();
    const pattern = decision.suggestedPattern;

    logger.info('Executing with delegation', {
      agentId: agent.id,
      pattern,
      subtaskCount: decision.factors.subtaskCount
    });

    // Decompose task if TaskDecomposer available
    let subtasks = [];
    if (this.delegationDecider.taskDecomposer) {
      try {
        const decompositionStrategy = this._mapPatternToStrategy(pattern);
        subtasks = this.delegationDecider.taskDecomposer.decompose(task, decompositionStrategy);
      } catch (error) {
        logger.warn('Decomposition failed, using task as single subtask', { error: error.message });
        subtasks = [task];
      }
    } else {
      subtasks = [task];
    }

    // Execute based on pattern
    let result;
    try {
      switch (pattern) {
        case DelegationPattern.PARALLEL:
          result = await this.executeParallelDelegation(agent.id, subtasks, { timeout, ...options });
          break;

        case DelegationPattern.DEBATE:
          // Get agent IDs for debate
          const debateAgents = this._selectAgentsForPattern(task, pattern, 3);
          result = await this.executeDebate(debateAgents, task, 3, { timeout, ...options });
          break;

        case DelegationPattern.REVIEW:
          // Get creator and reviewers
          const reviewAgents = this._selectAgentsForPattern(task, pattern, 3);
          result = await this.executeReview(
            reviewAgents[0],
            reviewAgents.slice(1),
            task,
            { timeout, ...options }
          );
          break;

        case DelegationPattern.ENSEMBLE:
          // Get ensemble agents
          const ensembleAgents = this._selectAgentsForPattern(task, pattern, 3);
          result = await this.executeEnsemble(ensembleAgents, task, { timeout, ...options });
          break;

        case DelegationPattern.SEQUENTIAL:
        default:
          // Sequential delegation
          result = await this._executeSequentialDelegation(agent.id, subtasks, { timeout, ...options });
          break;
      }

      return {
        success: result.success !== false,
        result: result.aggregated || result.finalProposal || result.finalWork || result.result || result,
        delegated: true,
        decision,
        pattern,
        subtaskCount: subtasks.length,
        duration: Date.now() - startTime,
        metadata: { pattern, agentId: agent.id }
      };

    } catch (error) {
      logger.error('Delegated execution failed', { pattern, error: error.message });

      return {
        success: false,
        error: error.message,
        delegated: true,
        decision,
        pattern,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Execute subtasks sequentially
   * @private
   */
  async _executeSequentialDelegation(parentAgentId, subtasks, options = {}) {
    const { timeout = 60000 } = options;
    const results = [];

    for (const subtask of subtasks) {
      const result = await this.delegateTask(parentAgentId, subtask, { timeout });
      results.push(result);

      if (!result.success && options.stopOnFailure !== false) {
        break;
      }
    }

    return {
      success: results.every(r => r.success),
      aggregated: this.aggregateResults(results, 'chain'),
      results,
      duration: results.reduce((sum, r) => sum + (r.duration || 0), 0)
    };
  }

  /**
   * Map delegation pattern to decomposition strategy
   * @private
   */
  _mapPatternToStrategy(pattern) {
    switch (pattern) {
      case DelegationPattern.PARALLEL:
        return 'parallel';
      case DelegationPattern.SEQUENTIAL:
        return 'sequential';
      default:
        return 'hybrid';
    }
  }

  /**
   * Select agents for a specific pattern
   * @private
   */
  _selectAgentsForPattern(task, pattern, count) {
    // Try to find suitable agents by phase
    const phase = task.phase || 'implementation';
    const phaseAgents = this.getAgentsByPhase(phase);

    if (phaseAgents && phaseAgents.length >= count) {
      return phaseAgents.slice(0, count).map(a => a.id);
    }

    // Fall back to any available agents
    const allAgents = Array.from(this.agents.keys());
    return allAgents.slice(0, count);
  }

  /**
   * Get delegation hint for a task
   * @param {Object} task - Task to evaluate
   * @param {Object} agent - Agent considering delegation
   * @param {Object} options - Additional options
   * @returns {Object} Delegation decision
   */
  getDelegationHint(task, agent, options = {}) {
    return this.delegationDecider.shouldDelegate(task, agent, options);
  }

  /**
   * Get delegation hints for multiple tasks
   * @param {Array<Object>} tasks - Tasks to evaluate
   * @param {Object} agent - Agent considering delegation
   * @returns {Array<Object>} Delegation decisions
   */
  getDelegationHintsBatch(tasks, agent) {
    return this.delegationDecider.evaluateBatch(tasks, agent);
  }

  /**
   * Get delegation decider metrics
   * @returns {Object} Metrics
   */
  getDelegationMetrics() {
    return this.delegationDecider.getMetrics();
  }

  /**
   * Update delegation configuration
   * @param {Object} config - New configuration
   */
  updateDelegationConfig(config) {
    this.delegationDecider.updateConfig(config);
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
