/**
 * DelegationDecider - Automatic delegation decision logic
 *
 * Part of Hierarchy Phase 3 - provides intelligent decision-making
 * for when parent agents should delegate tasks to child agents.
 *
 * Decision factors:
 * - complexity: Task complexity score (0-100)
 * - contextUtilization: Current context window usage (0-100%)
 * - subtaskCount: Number of decomposable subtasks
 * - agentConfidence: Agent's self-assessed confidence (0-100)
 * - agentLoad: Current workload/queue depth
 * - depthRemaining: Remaining delegation depth before limit
 *
 * @module delegation-decider
 */

const { createComponentLogger } = require('./logger');

const logger = createComponentLogger('DelegationDecider');

/**
 * Execution patterns for delegation
 */
const DelegationPattern = {
  PARALLEL: 'parallel',
  SEQUENTIAL: 'sequential',
  DEBATE: 'debate',
  REVIEW: 'review',
  ENSEMBLE: 'ensemble',
  DIRECT: 'direct' // No delegation, execute directly
};

/**
 * Default configuration for delegation decisions
 */
const DEFAULT_DELEGATION_CONFIG = {
  // Thresholds that trigger delegation consideration
  thresholds: {
    complexity: 50,           // Score 0-100, above this suggests delegation
    contextUtilization: 75,   // Percent, above this suggests delegation
    subtaskCount: 3,          // Minimum subtasks to consider delegation
    confidenceFloor: 60,      // Below this confidence, consider delegation
    effortHours: 4,           // Above this effort, consider delegation
    dependencyCount: 3        // Above this, consider sequential delegation
  },

  // Factor weights for decision scoring (must sum to 1.0)
  weights: {
    complexity: 0.30,
    contextUtilization: 0.20,
    subtaskCount: 0.15,
    confidence: 0.15,
    agentLoad: 0.10,
    depthRemaining: 0.10
  },

  // Delegation depth limits
  limits: {
    maxDelegationDepth: 3,
    maxConcurrentDelegations: 5,
    minTokenBudgetPerChild: 500,
    maxChildAgents: 7
  },

  // Pattern selection thresholds
  patternSelection: {
    // If task has independent subtasks and low dependencies
    parallelIndicators: ['independent', 'concurrent', 'parallel', 'batch', 'simultaneously'],
    // If task has sequential dependencies
    sequentialIndicators: ['then', 'after', 'before', 'depends', 'prerequisite', 'first', 'finally'],
    // If task is controversial or needs refinement
    debateIndicators: ['discuss', 'evaluate', 'compare', 'controversial', 'options', 'alternatives'],
    // If task needs creation and review
    reviewIndicators: ['create', 'write', 'draft', 'review', 'critique', 'revise'],
    // If task needs redundancy
    ensembleIndicators: ['verify', 'validate', 'ensure', 'critical', 'important', 'redundant']
  },

  // Minimum decision score to recommend delegation
  minDelegationScore: 60,

  // Cache settings
  cacheMaxAge: 60000 // 1 minute
};

/**
 * Decision factors structure
 * @typedef {Object} DelegationFactors
 * @property {number} complexity - Task complexity score (0-100)
 * @property {number} contextUtilization - Context usage percentage (0-100)
 * @property {number} subtaskCount - Number of potential subtasks
 * @property {number} agentConfidence - Agent's confidence level (0-100)
 * @property {number} agentLoad - Current agent workload (0-100)
 * @property {number} depthRemaining - Remaining delegation depth
 */

/**
 * Delegation decision result
 * @typedef {Object} DelegationDecision
 * @property {boolean} shouldDelegate - Whether to delegate
 * @property {number} confidence - Decision confidence (0-100)
 * @property {number} score - Overall delegation score (0-100)
 * @property {DelegationFactors} factors - Individual factor values
 * @property {Object} factorContributions - Each factor's contribution to score
 * @property {string} suggestedPattern - Recommended execution pattern
 * @property {string} reasoning - Human-readable explanation
 * @property {string[]} hints - Actionable hints for the user/agent
 * @property {Object} metadata - Additional metadata
 */

/**
 * DelegationDecider class for automatic delegation decisions
 */
class DelegationDecider {
  /**
   * Create a DelegationDecider instance
   * @param {Object} options - Configuration options
   * @param {Object} [options.taskDecomposer] - TaskDecomposer instance for complexity analysis
   * @param {Object} [options.config] - Override default configuration
   */
  constructor(options = {}) {
    this.taskDecomposer = options.taskDecomposer || null;
    this.config = this._mergeConfig(DEFAULT_DELEGATION_CONFIG, options.config || {});

    // Cache for decisions
    this._decisionCache = new Map();

    // Metrics tracking
    this._metrics = {
      decisionsCount: 0,
      delegationsRecommended: 0,
      directExecutionsRecommended: 0,
      averageConfidence: 0,
      patternDistribution: {}
    };

    logger.info('DelegationDecider initialized', {
      thresholds: this.config.thresholds,
      limits: this.config.limits
    });
  }

  /**
   * Decide whether to delegate a task
   * @param {Object} task - Task to evaluate
   * @param {Object} agent - Agent considering delegation
   * @param {Object} options - Additional options
   * @returns {DelegationDecision} Decision with reasoning
   */
  shouldDelegate(task, agent, options = {}) {
    if (!task) {
      throw new Error('Task is required for delegation decision');
    }

    const taskId = task.id || 'temp-' + Date.now();

    // Check cache
    const cached = this._getCachedDecision(taskId, agent?.id);
    if (cached && !options.skipCache) {
      logger.debug('Returning cached decision', { taskId });
      return cached;
    }

    logger.debug('Evaluating delegation decision', { taskId, agentId: agent?.id });

    try {
      // Calculate all factors
      const factors = this._calculateFactors(task, agent, options);

      // Calculate weighted score
      const { score, contributions } = this._calculateScore(factors);

      // Determine if delegation is recommended
      const shouldDelegateResult = this._shouldDelegateFromScore(score, factors, task, agent);

      // Select best pattern
      const suggestedPattern = shouldDelegateResult
        ? this._selectPattern(task, factors)
        : DelegationPattern.DIRECT;

      // Build reasoning
      const reasoning = this._buildReasoning(factors, score, shouldDelegateResult, suggestedPattern);

      // Generate hints
      const hints = this._generateHints(factors, shouldDelegateResult, suggestedPattern);

      // Calculate confidence in decision
      const confidence = this._calculateDecisionConfidence(factors, score);

      const decision = {
        shouldDelegate: shouldDelegateResult,
        confidence,
        score,
        factors,
        factorContributions: contributions,
        suggestedPattern,
        reasoning,
        hints,
        metadata: {
          taskId,
          agentId: agent?.id,
          timestamp: new Date().toISOString(),
          configVersion: this.config.version || '1.0.0',
          thresholds: this.config.thresholds
        }
      };

      // Cache the decision
      this._cacheDecision(taskId, agent?.id, decision);

      // Update metrics
      this._updateMetrics(decision);

      logger.info('Delegation decision made', {
        taskId,
        shouldDelegate: shouldDelegateResult,
        confidence,
        score,
        pattern: suggestedPattern
      });

      return decision;

    } catch (error) {
      logger.error('Delegation decision failed', { taskId, error: error.message });
      throw error;
    }
  }

  /**
   * Evaluate multiple tasks for delegation (batch)
   * @param {Array<Object>} tasks - Tasks to evaluate
   * @param {Object} agent - Agent considering delegation
   * @param {Object} options - Additional options
   * @returns {Array<DelegationDecision>} Decisions for each task
   */
  evaluateBatch(tasks, agent, options = {}) {
    if (!tasks || !Array.isArray(tasks)) {
      return [];
    }

    logger.debug('Batch evaluating delegation', { taskCount: tasks.length });

    return tasks.map(task => this.shouldDelegate(task, agent, options));
  }

  /**
   * Get delegation hint for a task (lightweight check)
   * @param {Object} task - Task to check
   * @param {Object} agent - Agent to check
   * @returns {Object} Quick hint without full decision
   */
  getQuickHint(task, agent) {
    const complexity = this._estimateComplexity(task);
    const subtaskPotential = this._estimateSubtaskCount(task);

    const shouldConsider = complexity >= this.config.thresholds.complexity ||
                          subtaskPotential >= this.config.thresholds.subtaskCount;

    return {
      shouldConsiderDelegation: shouldConsider,
      quickFactors: { complexity, subtaskPotential },
      hint: shouldConsider
        ? 'Task may benefit from delegation'
        : 'Task appears suitable for direct execution'
    };
  }

  // ============================================
  // Factor Calculation Methods
  // ============================================

  /**
   * Calculate all decision factors
   * @private
   */
  _calculateFactors(task, agent, options) {
    return {
      complexity: this._calculateComplexity(task),
      contextUtilization: this._calculateContextUtilization(agent, options),
      subtaskCount: this._calculateSubtaskCount(task),
      agentConfidence: this._calculateAgentConfidence(agent, task),
      agentLoad: this._calculateAgentLoad(agent),
      depthRemaining: this._calculateDepthRemaining(agent)
    };
  }

  /**
   * Calculate task complexity (0-100)
   * @private
   */
  _calculateComplexity(task) {
    // Use TaskDecomposer if available
    if (this.taskDecomposer) {
      try {
        const analysis = this.taskDecomposer.analyze(task);
        return analysis.complexityScore || 0;
      } catch (error) {
        logger.warn('TaskDecomposer analysis failed, using fallback', { error: error.message });
      }
    }

    // Fallback: estimate complexity
    return this._estimateComplexity(task);
  }

  /**
   * Estimate complexity without TaskDecomposer
   * @private
   */
  _estimateComplexity(task) {
    let score = 0;

    // Description length
    const descLength = (task.description || '').length + (task.title || '').length;
    if (descLength > 500) score += 20;
    else if (descLength > 200) score += 10;
    else if (descLength > 50) score += 5;

    // Technical terms
    const text = `${task.title || ''} ${task.description || ''}`.toLowerCase();
    const techTerms = ['api', 'database', 'async', 'concurrent', 'distributed', 'security', 'performance', 'integration'];
    const techCount = techTerms.filter(t => text.includes(t)).length;
    score += Math.min(25, techCount * 5);

    // Scope indicators
    const scopeTerms = ['multiple', 'all', 'entire', 'complete', 'full', 'comprehensive'];
    const scopeCount = scopeTerms.filter(t => text.includes(t)).length;
    score += Math.min(15, scopeCount * 5);

    // Dependencies
    const depCount = (task.depends?.requires?.length || 0) + (task.depends?.blocks?.length || 0);
    score += Math.min(15, depCount * 3);

    // Acceptance criteria
    const criteriaCount = task.acceptance?.length || 0;
    score += Math.min(15, criteriaCount * 2);

    // Effort estimate
    const effortHours = this._parseEffort(task.estimate);
    if (effortHours >= 8) score += 15;
    else if (effortHours >= 4) score += 10;
    else if (effortHours >= 2) score += 5;

    return Math.min(100, score);
  }

  /**
   * Calculate context utilization percentage
   * @private
   */
  _calculateContextUtilization(agent, options) {
    // Check agent's resource usage
    if (agent?.resourceUsage?.tokensUsed && agent?.quotas?.maxTokens) {
      return Math.round((agent.resourceUsage.tokensUsed / agent.quotas.maxTokens) * 100);
    }

    // Check from options
    if (options.tokensUsed && options.maxTokens) {
      return Math.round((options.tokensUsed / options.maxTokens) * 100);
    }

    // Default: assume moderate utilization
    return 50;
  }

  /**
   * Calculate potential subtask count
   * @private
   */
  _calculateSubtaskCount(task) {
    // Use TaskDecomposer if available
    if (this.taskDecomposer) {
      try {
        const analysis = this.taskDecomposer.analyze(task);
        return analysis.suggestedSubtasks?.length || 0;
      } catch (error) {
        // Fall through to estimation
      }
    }

    return this._estimateSubtaskCount(task);
  }

  /**
   * Estimate subtask count from task structure
   * @private
   */
  _estimateSubtaskCount(task) {
    let count = 0;

    // Count acceptance criteria (each is potentially a subtask)
    count += task.acceptance?.length || 0;

    // Count numbered items in description
    const numberedPattern = /(?:^|\n)\s*\d+[.)]/g;
    const description = task.description || '';
    const numberedMatches = description.match(numberedPattern);
    if (numberedMatches) count += numberedMatches.length;

    // Count bullet points
    const bulletPattern = /(?:^|\n)\s*[-*]\s+/g;
    const bulletMatches = description.match(bulletPattern);
    if (bulletMatches) count += bulletMatches.length;

    // Avoid double-counting (take max of explicit lists vs acceptance)
    const explicitCount = (numberedMatches?.length || 0) + (bulletMatches?.length || 0);
    return Math.max(task.acceptance?.length || 0, explicitCount);
  }

  /**
   * Calculate agent's confidence for this task
   * @private
   */
  _calculateAgentConfidence(agent, task) {
    // Agent-reported confidence
    if (typeof agent?.confidence === 'number') {
      return agent.confidence;
    }

    // Infer from agent capabilities vs task requirements
    if (agent?.capabilities && task?.requiredCapabilities) {
      const matched = task.requiredCapabilities.filter(
        cap => agent.capabilities.includes(cap)
      );
      const coverage = matched.length / task.requiredCapabilities.length;
      return Math.round(coverage * 100);
    }

    // Phase matching
    if (agent?.primaryPhase && task?.phase) {
      return agent.primaryPhase === task.phase ? 85 : 60;
    }

    // Default confidence
    return 75;
  }

  /**
   * Calculate agent's current load
   * @private
   */
  _calculateAgentLoad(agent) {
    if (!agent) return 0;

    // Check queue depth
    if (typeof agent.queueDepth === 'number' && typeof agent.maxQueueDepth === 'number') {
      return Math.round((agent.queueDepth / agent.maxQueueDepth) * 100);
    }

    // Check active delegations
    if (agent.hierarchyInfo?.childAgentIds?.length && agent.quotas?.maxChildren) {
      return Math.round((agent.hierarchyInfo.childAgentIds.length / agent.quotas.maxChildren) * 100);
    }

    return 0;
  }

  /**
   * Calculate remaining delegation depth
   * @private
   */
  _calculateDepthRemaining(agent) {
    const maxDepth = this.config.limits.maxDelegationDepth;
    const currentDepth = agent?.hierarchyInfo?.depth || agent?.delegationDepth || 0;
    return Math.max(0, maxDepth - currentDepth);
  }

  // ============================================
  // Score Calculation Methods
  // ============================================

  /**
   * Calculate weighted delegation score
   * @private
   */
  _calculateScore(factors) {
    const { weights, thresholds } = this.config;
    const contributions = {};
    let totalScore = 0;

    // Complexity: higher = more likely to delegate
    const complexityNorm = Math.min(100, (factors.complexity / thresholds.complexity) * 100);
    contributions.complexity = complexityNorm * weights.complexity;
    totalScore += contributions.complexity;

    // Context utilization: higher = more likely to delegate
    const contextNorm = Math.min(100, (factors.contextUtilization / thresholds.contextUtilization) * 100);
    contributions.contextUtilization = contextNorm * weights.contextUtilization;
    totalScore += contributions.contextUtilization;

    // Subtask count: more subtasks = more likely to delegate
    const subtaskNorm = Math.min(100, (factors.subtaskCount / this.config.thresholds.subtaskCount) * 100);
    contributions.subtaskCount = subtaskNorm * weights.subtaskCount;
    totalScore += contributions.subtaskCount;

    // Confidence: LOWER confidence = more likely to delegate (inverted)
    const confidenceNorm = Math.max(0, 100 - factors.agentConfidence);
    const confidenceContrib = (confidenceNorm / (100 - thresholds.confidenceFloor)) * 100;
    contributions.confidence = Math.min(100, confidenceContrib) * weights.confidence;
    totalScore += contributions.confidence;

    // Agent load: higher load = more likely to delegate
    const loadNorm = factors.agentLoad;
    contributions.agentLoad = loadNorm * weights.agentLoad;
    totalScore += contributions.agentLoad;

    // Depth remaining: more depth available = slightly more likely to delegate
    const depthNorm = (factors.depthRemaining / this.config.limits.maxDelegationDepth) * 100;
    contributions.depthRemaining = depthNorm * weights.depthRemaining;
    totalScore += contributions.depthRemaining;

    return {
      score: Math.round(totalScore),
      contributions
    };
  }

  /**
   * Determine if delegation should occur based on score and factors
   * @private
   */
  _shouldDelegateFromScore(score, factors, task, agent) {
    // Hard limits - don't delegate if:

    // 1. No remaining depth
    if (factors.depthRemaining <= 0) {
      return false;
    }

    // 2. Task already has children (already decomposed)
    if (task.childTaskIds && task.childTaskIds.length > 0) {
      return false;
    }

    // 3. No decomposable subtasks
    if (factors.subtaskCount < 2) {
      return false;
    }

    // 4. Agent is at max children
    if (agent?.hierarchyInfo?.childAgentIds?.length >= this.config.limits.maxChildAgents) {
      return false;
    }

    // Score-based decision
    return score >= this.config.minDelegationScore;
  }

  /**
   * Calculate confidence in the decision
   * @private
   */
  _calculateDecisionConfidence(factors, score) {
    let confidence = 50;

    // Clear signals increase confidence
    if (factors.complexity > 80 || factors.complexity < 20) confidence += 15;
    if (factors.subtaskCount >= 5 || factors.subtaskCount <= 1) confidence += 10;
    if (factors.agentConfidence > 90 || factors.agentConfidence < 40) confidence += 10;
    if (factors.contextUtilization > 85 || factors.contextUtilization < 30) confidence += 10;

    // Extreme scores are more confident
    if (score > 80 || score < 30) confidence += 15;

    return Math.min(100, confidence);
  }

  // ============================================
  // Pattern Selection Methods
  // ============================================

  /**
   * Select the best execution pattern for delegation
   * @private
   */
  _selectPattern(task, factors) {
    const text = `${task.title || ''} ${task.description || ''}`.toLowerCase();
    const { patternSelection } = this.config;

    // Score each pattern
    const scores = {
      parallel: 0,
      sequential: 0,
      debate: 0,
      review: 0,
      ensemble: 0
    };

    // Check text indicators
    for (const indicator of patternSelection.parallelIndicators) {
      if (text.includes(indicator)) scores.parallel += 2;
    }
    for (const indicator of patternSelection.sequentialIndicators) {
      if (text.includes(indicator)) scores.sequential += 2;
    }
    for (const indicator of patternSelection.debateIndicators) {
      if (text.includes(indicator)) scores.debate += 2;
    }
    for (const indicator of patternSelection.reviewIndicators) {
      if (text.includes(indicator)) scores.review += 2;
    }
    for (const indicator of patternSelection.ensembleIndicators) {
      if (text.includes(indicator)) scores.ensemble += 2;
    }

    // Factor-based adjustments

    // High subtask count with low dependencies = parallel
    if (factors.subtaskCount >= 3) {
      const depCount = (task.depends?.requires?.length || 0);
      if (depCount === 0) scores.parallel += 3;
      else scores.sequential += depCount;
    }

    // Low confidence = debate or ensemble for validation
    if (factors.agentConfidence < 50) {
      scores.debate += 2;
      scores.ensemble += 1;
    }

    // Implementation phase = parallel or sequential
    if (task.phase === 'implementation') {
      scores.parallel += 1;
      scores.sequential += 1;
    }

    // Research/planning = debate
    if (task.phase === 'research' || task.phase === 'planning') {
      scores.debate += 2;
    }

    // Design/validation = review
    if (task.phase === 'design' || task.phase === 'validation') {
      scores.review += 2;
    }

    // Find highest scoring pattern
    let bestPattern = DelegationPattern.PARALLEL; // Default
    let bestScore = scores.parallel;

    for (const [pattern, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestPattern = pattern;
      }
    }

    return bestPattern;
  }

  // ============================================
  // Reasoning and Hints Methods
  // ============================================

  /**
   * Build human-readable reasoning
   * @private
   */
  _buildReasoning(factors, score, shouldDelegate, pattern) {
    const reasons = [];

    if (shouldDelegate) {
      reasons.push(`Delegation recommended (score: ${score}/100)`);

      if (factors.complexity >= this.config.thresholds.complexity) {
        reasons.push(`High complexity (${factors.complexity}/100) suggests breaking down the task`);
      }

      if (factors.contextUtilization >= this.config.thresholds.contextUtilization) {
        reasons.push(`High context utilization (${factors.contextUtilization}%) indicates benefit from fresh contexts`);
      }

      if (factors.subtaskCount >= this.config.thresholds.subtaskCount) {
        reasons.push(`Task can be decomposed into ${factors.subtaskCount} subtasks`);
      }

      if (factors.agentConfidence < this.config.thresholds.confidenceFloor) {
        reasons.push(`Low agent confidence (${factors.agentConfidence}%) suggests delegation to specialists`);
      }

      reasons.push(`Suggested pattern: ${pattern}`);
    } else {
      reasons.push(`Direct execution recommended (score: ${score}/100)`);

      if (factors.depthRemaining <= 0) {
        reasons.push('Maximum delegation depth reached');
      } else if (factors.subtaskCount < 2) {
        reasons.push('Task is atomic (cannot be decomposed)');
      } else if (factors.complexity < this.config.thresholds.complexity) {
        reasons.push(`Complexity (${factors.complexity}/100) below threshold for delegation`);
      } else {
        reasons.push('Task appears suitable for direct execution');
      }
    }

    return reasons.join('. ');
  }

  /**
   * Generate actionable hints
   * @private
   */
  _generateHints(factors, shouldDelegate, pattern) {
    const hints = [];

    if (shouldDelegate) {
      hints.push(`Consider using the '${pattern}' execution pattern`);

      if (factors.subtaskCount >= 3) {
        hints.push(`Decompose into ${factors.subtaskCount} subtasks before delegating`);
      }

      if (factors.agentLoad > 50) {
        hints.push('Current agent load is high; delegation can distribute work');
      }

      if (pattern === DelegationPattern.DEBATE) {
        hints.push('Use 2-3 debate rounds for optimal refinement');
      } else if (pattern === DelegationPattern.REVIEW) {
        hints.push('Assign one creator and 2+ reviewers');
      } else if (pattern === DelegationPattern.ENSEMBLE) {
        hints.push('Use 3+ agents for robust ensemble');
      }
    } else {
      if (factors.complexity > 40) {
        hints.push('Consider breaking task into smaller pieces if issues arise');
      }

      if (factors.contextUtilization > 60) {
        hints.push('Monitor context usage; may need to delegate later');
      }
    }

    return hints;
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Parse effort estimate to hours
   * @private
   */
  _parseEffort(estimate) {
    if (!estimate) return 2; // Default
    if (typeof estimate === 'number') return estimate;

    const match = String(estimate).match(/(\d+\.?\d*)\s*(h|hour|hours|d|day|days|m|min|mins)?/i);
    if (!match) return 2;

    const value = parseFloat(match[1]);
    const unit = match[2]?.toLowerCase();

    if (unit?.startsWith('d')) return value * 8;
    if (unit?.startsWith('m')) return value / 60;
    return value;
  }

  /**
   * Merge configurations with defaults
   * @private
   */
  _mergeConfig(defaults, overrides) {
    const merged = { ...defaults };

    for (const key of Object.keys(overrides)) {
      if (typeof overrides[key] === 'object' && !Array.isArray(overrides[key])) {
        merged[key] = { ...defaults[key], ...overrides[key] };
      } else {
        merged[key] = overrides[key];
      }
    }

    return merged;
  }

  /**
   * Get cached decision
   * @private
   */
  _getCachedDecision(taskId, agentId) {
    const key = `${taskId}:${agentId || 'default'}`;
    const cached = this._decisionCache.get(key);

    if (!cached) return null;

    const age = Date.now() - new Date(cached.metadata.timestamp).getTime();
    if (age > this.config.cacheMaxAge) {
      this._decisionCache.delete(key);
      return null;
    }

    return cached;
  }

  /**
   * Cache a decision
   * @private
   */
  _cacheDecision(taskId, agentId, decision) {
    const key = `${taskId}:${agentId || 'default'}`;
    this._decisionCache.set(key, decision);

    // Cleanup old entries
    if (this._decisionCache.size > 100) {
      const now = Date.now();
      for (const [k, v] of this._decisionCache.entries()) {
        if (now - new Date(v.metadata.timestamp).getTime() > this.config.cacheMaxAge) {
          this._decisionCache.delete(k);
        }
      }
    }
  }

  /**
   * Update metrics
   * @private
   */
  _updateMetrics(decision) {
    this._metrics.decisionsCount++;

    if (decision.shouldDelegate) {
      this._metrics.delegationsRecommended++;
    } else {
      this._metrics.directExecutionsRecommended++;
    }

    // Rolling average confidence
    this._metrics.averageConfidence = (
      (this._metrics.averageConfidence * (this._metrics.decisionsCount - 1)) +
      decision.confidence
    ) / this._metrics.decisionsCount;

    // Pattern distribution
    const pattern = decision.suggestedPattern;
    this._metrics.patternDistribution[pattern] =
      (this._metrics.patternDistribution[pattern] || 0) + 1;
  }

  /**
   * Clear decision cache
   */
  clearCache() {
    this._decisionCache.clear();
    logger.debug('Decision cache cleared');
  }

  /**
   * Update configuration at runtime
   * @param {Object} newConfig - Partial configuration to update
   */
  updateConfig(newConfig) {
    this.config = this._mergeConfig(this.config, newConfig);
    this.clearCache(); // Invalidate cache on config change
    logger.info('Configuration updated', { newConfig });
  }

  /**
   * Get current metrics
   * @returns {Object} Metrics
   */
  getMetrics() {
    return { ...this._metrics };
  }

  /**
   * Get statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      cacheSize: this._decisionCache.size,
      metrics: this._metrics,
      config: {
        thresholds: this.config.thresholds,
        limits: this.config.limits,
        minDelegationScore: this.config.minDelegationScore
      }
    };
  }
}

module.exports = {
  DelegationDecider,
  DelegationPattern,
  DEFAULT_DELEGATION_CONFIG
};
