/**
 * CompetitivePlanner - Generates competing implementation plans for complex tasks
 *
 * Creates 2-3 alternative implementation strategies when task complexity
 * exceeds a threshold, enabling comparison and optimal plan selection.
 *
 * @module CompetitivePlanner
 */

const EventEmitter = require('events');

const DEFAULT_STRATEGIES = {
  conservative: {
    key: 'conservative',
    name: 'Conservative Approach',
    description: 'Minimal risk, proven patterns, incremental delivery',
    riskTolerance: 'low',
    innovationLevel: 'low'
  },
  balanced: {
    key: 'balanced',
    name: 'Balanced Approach',
    description: 'Moderate risk with measured innovation',
    riskTolerance: 'medium',
    innovationLevel: 'medium'
  },
  aggressive: {
    key: 'aggressive',
    name: 'Aggressive Approach',
    description: 'High innovation, cutting-edge solutions',
    riskTolerance: 'high',
    innovationLevel: 'high'
  }
};

const COMPLEXITY_THRESHOLD = 40;

class CompetitivePlanner extends EventEmitter {
  constructor(options = {}) {
    super();
    this.strategies = options.strategies || { ...DEFAULT_STRATEGIES };
    this.complexityThreshold = options.complexityThreshold || COMPLEXITY_THRESHOLD;
    this.complexityAnalyzer = options.complexityAnalyzer || null;
    this.planEvaluator = options.planEvaluator || null;
    this.planCache = new Map();
    this.cacheTimeout = options.cacheTimeout || 300000; // 5 minutes
    this._generationCounter = 0; // Unique counter for each generation
  }

  /**
   * Generate competing plans for a task
   * @param {Object} task - Task to plan for
   * @param {Object} options - Planning options
   * @returns {Promise<Object>} Plans with comparison
   */
  async generatePlans(task, options = {}) {
    if (!task) throw new Error('Task is required');

    const taskId = task.id || `task-${Date.now()}`;
    const forceRegenerate = options.forceRegenerate || false;

    // Check cache
    if (!forceRegenerate && this.planCache.has(taskId)) {
      const cached = this.planCache.get(taskId);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.result;
      }
      this.planCache.delete(taskId);
    }

    // Analyze complexity if analyzer available
    let complexity = options.complexity;
    if (!complexity && this.complexityAnalyzer) {
      const analysis = await this.complexityAnalyzer.analyze(task);
      complexity = analysis.score;
    }
    complexity = complexity || 50; // Default to medium

    // Determine which strategies to use based on complexity
    const strategiesToUse = this._selectStrategies(complexity);

    // Generate a plan for each strategy
    const plans = strategiesToUse.map(strategyKey =>
      this._generatePlanForStrategy(task, this.strategies[strategyKey], complexity)
    );

    // Evaluate and compare if evaluator available
    let comparison = null;
    let winner = plans[0];
    if (this.planEvaluator && plans.length >= 2) {
      comparison = this.planEvaluator.comparePlans(plans, {
        acceptanceCriteria: task.acceptance || task.acceptanceCriteria || []
      });
      winner = comparison.winner.plan;
    }

    // Increment generation counter for unique timestamps
    this._generationCounter++;
    const timestamp = `${new Date().toISOString()}-${this._generationCounter}`;

    const result = {
      taskId,
      complexity,
      strategies: strategiesToUse,
      plans,
      comparison,
      winner,
      needsHumanReview: comparison?.needsReview || false,
      timestamp
    };

    // Cache result
    this.planCache.set(taskId, { result, timestamp: Date.now() });

    this.emit('plans:generated', {
      taskId, planCount: plans.length, strategies: strategiesToUse,
      hasComparison: !!comparison, needsReview: result.needsHumanReview
    });

    return result;
  }

  /**
   * Select which strategies to use based on complexity
   * @private
   */
  _selectStrategies(complexity) {
    if (complexity >= 70) {
      // High complexity: use all three strategies
      return ['conservative', 'balanced', 'aggressive'];
    } else if (complexity >= this.complexityThreshold) {
      // Medium complexity: use conservative and balanced
      return ['conservative', 'balanced'];
    } else {
      // Low complexity: just use balanced (single plan)
      return ['balanced'];
    }
  }

  /**
   * Generate a plan for a specific strategy
   * @private
   */
  _generatePlanForStrategy(task, strategy, complexity) {
    const plan = {
      id: `${task.id || 'task'}-${strategy.key}-${Date.now()}`,
      taskId: task.id,
      strategy: { ...strategy },
      title: `${task.title || 'Task'} - ${strategy.name}`,
      steps: this._generateSteps(task, strategy, complexity),
      risks: this._generateRisks(task, strategy),
      estimates: this._generateEstimates(task, strategy, complexity),
      dependencies: this._identifyDependencies(task, strategy),
      analysis: {
        complexity,
        riskLevel: strategy.riskTolerance,
        innovationLevel: strategy.innovationLevel
      },
      createdAt: new Date().toISOString()
    };

    return plan;
  }

  /**
   * Generate implementation steps based on strategy
   * @private
   */
  _generateSteps(task, strategy, complexity) {
    const baseSteps = this._extractBaseSteps(task);
    const stepCount = this._calculateStepCount(complexity, strategy);

    // Expand or contract steps based on strategy
    let steps = [];

    if (strategy.key === 'conservative') {
      // More granular steps, explicit validation
      steps = this._expandStepsConservative(baseSteps, stepCount);
    } else if (strategy.key === 'aggressive') {
      // Fewer steps, parallel execution
      steps = this._expandStepsAggressive(baseSteps, stepCount);
    } else {
      // Balanced approach
      steps = this._expandStepsBalanced(baseSteps, stepCount);
    }

    return steps.map((step, i) => ({
      ...step,
      order: i + 1
    }));
  }

  _extractBaseSteps(task) {
    const steps = [];
    const title = (task.title || '').toLowerCase();
    const desc = (task.description || '').toLowerCase();
    const combined = `${title} ${desc}`;

    // Extract verbs/actions from task
    if (/\b(create|build|implement)\b/.test(combined)) {
      steps.push({ action: 'Implement core functionality', phase: 'build' });
    }
    if (/\b(add|integrate)\b/.test(combined)) {
      steps.push({ action: 'Add integration layer', phase: 'integrate' });
    }
    if (/\b(test|validate)\b/.test(combined)) {
      steps.push({ action: 'Create test suite', phase: 'test' });
    }
    if (/\b(deploy|release)\b/.test(combined)) {
      steps.push({ action: 'Deploy to environment', phase: 'deploy' });
    }

    // Always include basic steps
    if (steps.length < 2) {
      steps.push({ action: 'Analyze requirements', phase: 'design' });
      steps.push({ action: 'Implement solution', phase: 'build' });
      steps.push({ action: 'Test and validate', phase: 'test' });
    }

    return steps;
  }

  _calculateStepCount(complexity, strategy) {
    let base = Math.floor(complexity / 15) + 3; // 3-10 steps based on complexity
    if (strategy.key === 'conservative') base += 2; // More steps
    if (strategy.key === 'aggressive') base -= 1; // Fewer steps
    return Math.max(3, Math.min(12, base));
  }

  _expandStepsConservative(baseSteps, targetCount) {
    const expanded = [];
    for (const step of baseSteps) {
      expanded.push({ action: `Research: ${step.action}`, details: 'Analyze existing patterns and best practices', phase: 'research' });
      expanded.push({ action: `Design: ${step.action}`, details: 'Create detailed specification', phase: 'design' });
      expanded.push({ action: `Implement: ${step.action}`, details: 'Build with comprehensive error handling', phase: 'build' });
      expanded.push({ action: `Test: ${step.action}`, details: 'Unit and integration tests', phase: 'test' });
    }
    return expanded.slice(0, targetCount);
  }

  _expandStepsAggressive(baseSteps, targetCount) {
    const expanded = [];
    for (let i = 0; i < baseSteps.length; i += 2) {
      const step1 = baseSteps[i];
      const step2 = baseSteps[i + 1];
      expanded.push({
        action: step2 ? `${step1.action} + ${step2.action}` : step1.action,
        details: 'Parallel execution with modern tooling',
        phase: 'build',
        parallel: true
      });
    }
    expanded.push({ action: 'Rapid deployment', details: 'CI/CD pipeline deployment', phase: 'deploy', parallel: true });
    return expanded.slice(0, targetCount);
  }

  _expandStepsBalanced(baseSteps, targetCount) {
    const expanded = [];
    expanded.push({ action: 'Initial setup', details: 'Configure environment and dependencies', phase: 'setup' });
    for (const step of baseSteps) {
      expanded.push({ action: step.action, details: 'Standard implementation approach', phase: step.phase || 'build' });
    }
    expanded.push({ action: 'Final validation', details: 'End-to-end testing', phase: 'test' });
    return expanded.slice(0, targetCount);
  }

  /**
   * Generate risks based on strategy
   * @private
   */
  _generateRisks(task, strategy) {
    const risks = [];
    const combined = `${task.title || ''} ${task.description || ''}`.toLowerCase();

    // Strategy-specific risks
    if (strategy.key === 'conservative') {
      risks.push({
        risk: 'Slower delivery timeline',
        mitigation: 'Prioritize critical path and parallelize where safe',
        severity: 'low'
      });
    } else if (strategy.key === 'aggressive') {
      risks.push({
        risk: 'Technical debt accumulation',
        mitigation: 'Schedule immediate refactoring sprint post-delivery',
        severity: 'medium'
      });
      risks.push({
        risk: 'Integration issues with cutting-edge dependencies',
        mitigation: 'Maintain fallback to stable versions',
        severity: 'medium'
      });
    }

    // Task-specific risks
    if (/\b(database|schema|migration)\b/.test(combined)) {
      risks.push({
        risk: 'Data migration failures',
        mitigation: 'Create backup and rollback procedures',
        severity: 'high'
      });
    }
    if (/\b(api|integration|external)\b/.test(combined)) {
      risks.push({
        risk: 'External service dependency',
        mitigation: 'Implement circuit breaker pattern',
        severity: 'medium'
      });
    }

    return risks;
  }

  /**
   * Generate time/resource estimates
   * @private
   */
  _generateEstimates(task, strategy, complexity) {
    // Base hours from task estimate or complexity
    let baseHours = 4;
    if (task.estimate) {
      const match = task.estimate.match(/(\d+)\s*h/i);
      if (match) baseHours = parseInt(match[1], 10);
    } else {
      baseHours = Math.floor(complexity / 10) + 2;
    }

    // Adjust by strategy
    let multiplier = 1.0;
    if (strategy.key === 'conservative') multiplier = 1.3;
    if (strategy.key === 'aggressive') multiplier = 0.8;

    const hours = Math.round(baseHours * multiplier);

    return {
      hours,
      days: Math.ceil(hours / 8),
      complexity: complexity >= 70 ? 'high' : complexity >= 40 ? 'medium' : 'low',
      confidence: strategy.key === 'conservative' ? 'high' : strategy.key === 'aggressive' ? 'medium' : 'high'
    };
  }

  /**
   * Identify dependencies based on task and strategy
   * @private
   */
  _identifyDependencies(task, strategy) {
    const deps = [];
    const combined = `${task.title || ''} ${task.description || ''}`.toLowerCase();

    if (/\b(database|sql|postgres|mysql)\b/.test(combined)) deps.push('database');
    if (/\b(api|rest|graphql)\b/.test(combined)) deps.push('api-framework');
    if (/\b(auth|authentication|jwt)\b/.test(combined)) deps.push('auth-library');
    if (/\b(test|jest|mocha)\b/.test(combined)) deps.push('test-framework');

    // Aggressive strategy may add modern deps
    if (strategy.key === 'aggressive') {
      if (!deps.includes('test-framework')) deps.push('test-framework');
    }

    return deps;
  }

  /**
   * Get plan from cache
   */
  getCachedPlan(taskId) {
    if (this.planCache.has(taskId)) {
      const cached = this.planCache.get(taskId);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.result;
      }
    }
    return null;
  }

  /**
   * Clear plan cache
   */
  clearCache() {
    this.planCache.clear();
  }

  /**
   * Get available strategies
   */
  getStrategies() {
    return { ...this.strategies };
  }

  /**
   * Set complexity threshold
   */
  setComplexityThreshold(threshold) {
    if (typeof threshold !== 'number' || threshold < 0 || threshold > 100) {
      throw new Error('Threshold must be 0-100');
    }
    this.complexityThreshold = threshold;
  }

  /**
   * Get complexity threshold
   */
  getComplexityThreshold() {
    return this.complexityThreshold;
  }
}

module.exports = CompetitivePlanner;
