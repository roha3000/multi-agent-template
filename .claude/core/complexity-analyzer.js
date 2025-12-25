/**
 * ComplexityAnalyzer - Task complexity scoring and strategy determination
 *
 * Analyzes task complexity across multiple dimensions to determine
 * the optimal execution strategy for the orchestrator.
 *
 * @module ComplexityAnalyzer
 */

const EventEmitter = require('events');

/**
 * Scoring weight configuration for complexity dimensions
 */
const SCORING_WEIGHTS = {
  dependencyDepth: 0.25,
  acceptanceCriteria: 0.20,
  effortEstimate: 0.15,
  technicalKeywords: 0.25,
  historicalSuccess: 0.15
};

/**
 * High-complexity technical keywords and their weight multipliers
 */
const TECHNICAL_KEYWORDS = {
  'architecture': 10, 'refactor': 9, 'migration': 9, 'redesign': 8,
  'security': 9, 'authentication': 8, 'authorization': 8, 'encryption': 8,
  'database': 8, 'schema': 7, 'transaction': 7,
  'integration': 8, 'api': 6, 'webhook': 6, 'sync': 7, 'async': 6,
  'optimization': 7, 'performance': 7, 'scalability': 8, 'caching': 6,
  'e2e': 5, 'end-to-end': 5, 'stress': 6, 'load': 6
};

/**
 * Strategy thresholds for complexity scores
 */
const STRATEGY_THRESHOLDS = { fastPath: 40, standard: 70 };

/**
 * ComplexityAnalyzer class for scoring task complexity
 */
class ComplexityAnalyzer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.memoryStore = options.memoryStore || null;
    this.taskManager = options.taskManager || null;
    this._analysisCache = new Map();
    this._cacheTimeout = options.cacheTimeout || 60000;
  }

  /**
   * Analyzes task complexity and determines execution strategy
   * @param {Object} task - Task object to analyze
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} Analysis result with score, breakdown, and strategy
   */
  async analyze(task, options = {}) {
    if (!task) throw new Error('Task is required for complexity analysis');

    const useCache = options.useCache !== false;
    const taskId = task.id || 'unknown';

    if (useCache && this._analysisCache.has(taskId)) {
      const cached = this._analysisCache.get(taskId);
      if (Date.now() - cached.timestamp < this._cacheTimeout) return cached.result;
      this._analysisCache.delete(taskId);
    }

    const breakdown = {
      dependencyDepth: await this._scoreDependencyDepth(task),
      acceptanceCriteria: this._scoreAcceptanceCriteria(task),
      effortEstimate: this._scoreEffortEstimate(task),
      technicalKeywords: this._scoreTechnicalKeywords(task),
      historicalSuccess: await this._scoreHistoricalSuccess(task)
    };

    const score = this._calculateWeightedScore(breakdown);
    const strategy = this._determineStrategy(score);

    const result = {
      taskId, score: Math.round(score * 100) / 100,
      breakdown: this._formatBreakdown(breakdown),
      strategy, analyzedAt: new Date().toISOString(),
      weights: { ...SCORING_WEIGHTS }
    };

    if (useCache) {
      this._analysisCache.set(taskId, { result, timestamp: Date.now() });
    }

    this.emit('complexity:analyzed', {
      taskId, score: result.score, strategy: result.strategy, breakdown: result.breakdown
    });

    return result;
  }

  async _scoreDependencyDepth(task) {
    let dependencyCount = 0, ancestorDepth = 0, descendantCount = 0;

    if (Array.isArray(task.requires)) dependencyCount += task.requires.length;
    if (Array.isArray(task.blocks)) dependencyCount += task.blocks.length;

    if (this.taskManager && task.id) {
      try {
        if (typeof this.taskManager._getAncestors === 'function') {
          const ancestors = this.taskManager._getAncestors(task.id);
          ancestorDepth = ancestors ? ancestors.length : 0;
        }
        if (typeof this.taskManager._getDescendants === 'function') {
          const descendants = this.taskManager._getDescendants(task.id);
          descendantCount = descendants ? descendants.length : 0;
        }
      } catch (error) { /* Continue with direct dependency count */ }
    }

    const directScore = Math.min(dependencyCount * 10, 50);
    const ancestorScore = Math.min(ancestorDepth * 5, 25);
    const descendantScore = Math.min(descendantCount * 3, 25);
    return Math.min(directScore + ancestorScore + descendantScore, 100);
  }

  _scoreAcceptanceCriteria(task) {
    const criteria = task.acceptanceCriteria || task.acceptance || [];
    if (!Array.isArray(criteria) || criteria.length === 0) return 10;

    let score = Math.min(criteria.length * 8, 64);
    for (const criterion of criteria) {
      if (typeof criterion !== 'string') continue;
      if (/\d+%|\d+\s*(ms|seconds?|minutes?|hours?)|\d+\s*(requests?|users?|items?)/i.test(criterion)) score += 2;
      if (/\b(if|when|unless|except|only when)\b/i.test(criterion)) score += 3;
      if (/\b(integrate|connect|sync|api|external)\b/i.test(criterion)) score += 2;
    }
    return Math.min(score, 100);
  }

  _scoreEffortEstimate(task) {
    const estimate = task.estimate;
    if (!estimate || typeof estimate !== 'string') return 50;

    const totalMinutes = this._parseEstimateToMinutes(estimate);
    if (totalMinutes === 0) return 50;

    if (totalMinutes <= 30) return Math.round((totalMinutes / 30) * 20);
    if (totalMinutes <= 60) return Math.round(20 + ((totalMinutes - 30) / 30) * 15);
    if (totalMinutes <= 120) return Math.round(35 + ((totalMinutes - 60) / 60) * 15);
    if (totalMinutes <= 240) return Math.round(50 + ((totalMinutes - 120) / 120) * 15);
    if (totalMinutes <= 480) return Math.round(65 + ((totalMinutes - 240) / 240) * 15);
    if (totalMinutes <= 960) return Math.round(80 + ((totalMinutes - 480) / 480) * 10);
    return Math.min(90 + Math.round((totalMinutes - 960) / 480) * 5, 100);
  }

  _parseEstimateToMinutes(estimate) {
    let total = 0;
    const weeks = estimate.match(/(\d+)\s*w(?:eeks?)?/i);
    const days = estimate.match(/(\d+)\s*d(?:ays?)?/i);
    const hours = estimate.match(/(\d+)\s*h(?:(?:ou)?rs?)?/i);
    const mins = estimate.match(/(\d+)\s*m(?:in(?:ute)?s?)?/i);

    if (weeks) total += parseInt(weeks[1], 10) * 5 * 8 * 60;
    if (days) total += parseInt(days[1], 10) * 8 * 60;
    if (hours) total += parseInt(hours[1], 10) * 60;
    if (mins) total += parseInt(mins[1], 10);
    return total;
  }

  _scoreTechnicalKeywords(task) {
    const textFields = [
      task.title || '', task.description || '',
      ...(task.acceptanceCriteria || task.acceptance || []),
      ...(task.tags || [])
    ];
    const combinedText = textFields.join(' ').toLowerCase();
    if (!combinedText.trim()) return 20;

    let totalWeight = 0;
    const foundKeywords = new Set();
    for (const [keyword, weight] of Object.entries(TECHNICAL_KEYWORDS)) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(combinedText) && !foundKeywords.has(keyword)) {
        totalWeight += weight;
        foundKeywords.add(keyword);
      }
    }
    return Math.min((totalWeight / 50) * 100, 100);
  }

  async _scoreHistoricalSuccess(task) {
    if (!this.memoryStore) return 50;
    try {
      const pattern = this._extractTaskPattern(task);
      if (typeof this.memoryStore.getTaskPatternSuccess === 'function') {
        const successData = await this.memoryStore.getTaskPatternSuccess(pattern);
        if (successData && typeof successData.successRate === 'number') {
          const invertedScore = (1 - successData.successRate) * 100;
          const sampleWeight = Math.min(successData.sampleSize / 10, 1);
          return Math.round(invertedScore * sampleWeight + 50 * (1 - sampleWeight));
        }
      }
    } catch (error) { /* Use neutral score */ }
    return 50;
  }

  _extractTaskPattern(task) {
    const pattern = { type: task.type || 'unknown', tags: [...(task.tags || [])].sort(), keywords: [] };
    const text = `${task.title || ''} ${task.description || ''}`.toLowerCase();
    for (const keyword of Object.keys(TECHNICAL_KEYWORDS)) {
      if (text.includes(keyword)) pattern.keywords.push(keyword);
    }
    pattern.keywords.sort();
    return pattern;
  }

  _calculateWeightedScore(breakdown) {
    let weightedSum = 0;
    for (const [dimension, weight] of Object.entries(SCORING_WEIGHTS)) {
      weightedSum += (breakdown[dimension] || 0) * weight;
    }
    return weightedSum;
  }

  _formatBreakdown(breakdown) {
    const formatted = {};
    for (const [dimension, score] of Object.entries(breakdown)) {
      const weight = SCORING_WEIGHTS[dimension] || 0;
      formatted[dimension] = {
        score: Math.round(score * 100) / 100,
        weight, contribution: Math.round(score * weight * 100) / 100
      };
    }
    return formatted;
  }

  _determineStrategy(score) {
    if (score < STRATEGY_THRESHOLDS.fastPath) return 'fast-path';
    if (score < STRATEGY_THRESHOLDS.standard) return 'standard';
    return 'competitive';
  }

  clearCache() { this._analysisCache.clear(); }
  getCacheStats() { return { size: this._analysisCache.size, timeout: this._cacheTimeout }; }
  getStrategyThresholds() { return { ...STRATEGY_THRESHOLDS }; }
  getScoringWeights() { return { ...SCORING_WEIGHTS }; }

  async analyzeBatch(tasks, options = {}) {
    if (!Array.isArray(tasks)) throw new Error('Tasks must be an array');
    const results = await Promise.all(tasks.map(task => this.analyze(task, options)));
    this.emit('complexity:batch-analyzed', {
      count: results.length,
      averageScore: results.reduce((sum, r) => sum + r.score, 0) / results.length,
      strategies: {
        'fast-path': results.filter(r => r.strategy === 'fast-path').length,
        'standard': results.filter(r => r.strategy === 'standard').length,
        'competitive': results.filter(r => r.strategy === 'competitive').length
      }
    });
    return results;
  }
}

module.exports = ComplexityAnalyzer;
