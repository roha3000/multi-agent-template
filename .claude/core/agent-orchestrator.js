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

const logger = createComponentLogger('AgentOrchestrator');

class AgentOrchestrator {
  /**
   * Create an orchestrator
   * @param {MessageBus} messageBus - Message bus instance
   */
  constructor(messageBus) {
    this.messageBus = messageBus;
    this.agents = new Map();
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
   * Get agent by ID
   * @param {string} agentId - Agent ID
   * @returns {Agent|null} Agent instance
   */
  getAgent(agentId) {
    return this.agents.get(agentId) || null;
  }

  /**
   * Execute task with multiple agents in parallel
   * @param {Array<string>} agentIds - Agent IDs to execute
   * @param {Object} task - Task to execute
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Combined results
   */
  async executeParallel(agentIds, task, options = {}) {
    const {
      timeout = 60000,
      retries = 3,
      synthesizer = this._defaultSynthesizer
    } = options;

    logger.info('Starting parallel execution', {
      agentCount: agentIds.length,
      agentIds
    });

    const startTime = Date.now();

    try {
      // Execute all agents in parallel
      const promises = agentIds.map(agentId => {
        const agent = this.getAgent(agentId);
        if (!agent) {
          return Promise.reject(new Error(`Agent not found: ${agentId}`));
        }

        return this._executeWithRetry(agent, task, { timeout, retries });
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

      return {
        success: successful.length > 0,
        synthesized,
        results: successful,
        failures: failed,
        duration
      };

    } catch (error) {
      logger.error('Parallel execution failed', { error: error.message });
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
