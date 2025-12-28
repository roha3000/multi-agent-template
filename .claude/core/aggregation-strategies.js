/**
 * AggregationStrategies - Result aggregation for delegation results
 *
 * Part of Hierarchy Phase 2 - provides strategies for combining
 * results from multiple delegated tasks.
 *
 * @module aggregation-strategies
 */

class AggregationStrategies {
  /**
   * Merge all results into a unified structure
   * @param {Array<{agentId: string, result: any}>} results - Results to merge
   * @param {Object} options - Merge options
   * @returns {{merged: any, sourceCount: number, sources: string[], quality: number, metadata: Object}}
   */
  static merge(results, options = {}) {
    const { combineArrays = true, includeMetadata = true, weightByQuality = false } = options;

    if (!results || results.length === 0) {
      return { merged: null, sourceCount: 0, sources: [], quality: 0, metadata: {} };
    }

    const sources = results.map(r => r.agentId).filter(Boolean);
    const values = results.map(r => r.result);

    // Determine type and merge accordingly
    const firstNonNull = values.find(v => v != null);
    let merged;

    if (Array.isArray(firstNonNull)) {
      merged = this._mergeArrays(values, combineArrays);
    } else if (typeof firstNonNull === 'object' && firstNonNull !== null) {
      merged = this._mergeObjects(values, weightByQuality, results);
    } else {
      merged = this._mergePrimitives(values);
    }

    const quality = this._calculateAverageQuality(results);

    return {
      merged,
      sourceCount: results.length,
      sources,
      quality,
      metadata: includeMetadata ? { strategy: 'merge', timestamp: new Date().toISOString() } : {}
    };
  }

  /**
   * Select the highest quality result
   * @param {Array<{agentId: string, result: any}>} results - Results to select from
   * @param {Object} options - Selection options
   * @returns {{best: any, agentId: string, score: number, alternatives: Array, metadata: Object}}
   */
  static selectBest(results, options = {}) {
    const { criteria = 'quality', tieBreaker = 'first', minQualityScore = 0, selector } = options;

    if (!results || results.length === 0) {
      return { best: null, agentId: null, score: 0, alternatives: [], metadata: {} };
    }

    // Custom selector function
    if (typeof selector === 'function') {
      const selected = selector(results);
      return {
        best: selected?.result || selected,
        agentId: selected?.agentId || null,
        score: this._getQualityScore(selected),
        alternatives: results.filter(r => r !== selected),
        metadata: { strategy: 'selectBest', custom: true }
      };
    }

    // Score and filter results
    const scored = results
      .map(r => ({ ...r, score: this._getQualityScore(r, criteria) }))
      .filter(r => r.score >= minQualityScore)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return { best: null, agentId: null, score: 0, alternatives: results, metadata: {} };
    }

    // Handle ties
    const topScore = scored[0].score;
    const tied = scored.filter(r => r.score === topScore);

    let winner;
    if (tied.length === 1 || tieBreaker === 'first') {
      winner = tied[0];
    } else if (tieBreaker === 'last') {
      winner = tied[tied.length - 1];
    } else if (tieBreaker === 'random') {
      winner = tied[Math.floor(Math.random() * tied.length)];
    } else {
      winner = tied[0];
    }

    return {
      best: winner.result,
      agentId: winner.agentId,
      score: winner.score,
      scoreBreakdown: { criteria, tiedCount: tied.length },
      alternatives: scored.slice(1).map(r => ({ agentId: r.agentId, score: r.score, result: r.result })),
      metadata: { strategy: 'selectBest', timestamp: new Date().toISOString() }
    };
  }

  /**
   * Vote on results to reach consensus
   * @param {Array<{agentId: string, result: any}>} results - Results to vote on
   * @param {Object} options - Voting options
   * @returns {{winner: any, consensus: boolean, confidence: number, votes: Object, metadata: Object}}
   */
  static vote(results, options = {}) {
    const { strategy = 'majority', threshold = 0.5, weights = {}, extractField } = options;

    if (!results || results.length === 0) {
      return { winner: null, consensus: false, confidence: 0, votes: {}, metadata: {} };
    }

    // Extract vote values
    const votes = new Map();
    let totalWeight = 0;

    for (const { agentId, result } of results) {
      const voteValue = this._extractVote(result, extractField);
      const voteKey = JSON.stringify(voteValue);
      const weight = weights[agentId] || 1;

      if (!votes.has(voteKey)) {
        votes.set(voteKey, { value: voteValue, count: 0, weight: 0, agents: [] });
      }

      const entry = votes.get(voteKey);
      entry.count++;
      entry.weight += weight;
      entry.agents.push(agentId);
      totalWeight += weight;
    }

    // Find winner
    const sorted = Array.from(votes.values()).sort((a, b) => {
      return strategy === 'weighted' ? b.weight - a.weight : b.count - a.count;
    });

    const leader = sorted[0];
    const confidence = strategy === 'weighted'
      ? leader.weight / totalWeight
      : leader.count / results.length;

    let consensus = false;
    switch (strategy) {
      case 'unanimous':
        consensus = sorted.length === 1;
        break;
      case 'weighted':
      case 'majority':
      default:
        consensus = confidence > threshold;
    }

    return {
      winner: leader.value,
      consensus,
      confidence,
      votes: Object.fromEntries(votes.entries()),
      breakdown: { strategy, threshold, totalVotes: results.length, totalWeight },
      metadata: { strategy: 'vote', votingStrategy: strategy, timestamp: new Date().toISOString() }
    };
  }

  /**
   * Chain results through a pipeline of stages
   * @param {Array<{agentId: string, result: any}>} results - Results to process
   * @param {Object} options - Chain options
   * @returns {{final: any, stages: number, history: Array, metadata: Object}}
   */
  static chain(results, options = {}) {
    const { pipeline = [], stopOnFailure = true, collectHistory = true } = options;

    if (!results || results.length === 0) {
      return { final: null, stages: 0, history: [], metadata: {} };
    }

    let current = results;
    const history = [];
    let stagesCompleted = 0;

    for (const stage of pipeline) {
      try {
        const stageResult = this._executeStage(current, stage);
        stagesCompleted++;

        if (collectHistory) {
          history.push({ stage: stage.type, success: true, inputCount: current.length });
        }

        current = stageResult;
      } catch (error) {
        if (collectHistory) {
          history.push({ stage: stage.type, success: false, error: error.message });
        }
        if (stopOnFailure) break;
      }
    }

    return {
      final: current,
      stages: stagesCompleted,
      history,
      metadata: { strategy: 'chain', pipelineLength: pipeline.length }
    };
  }

  /**
   * Custom aggregation with user-provided function
   * @param {Array<{agentId: string, result: any}>} results - Results to aggregate
   * @param {Function} aggregatorFn - Custom aggregation function
   * @param {Object} context - Additional context
   * @returns {Promise<{result: any, aggregator: string, executionTime: number, errors: Array}>}
   */
  static async custom(results, aggregatorFn, context = {}) {
    const startTime = Date.now();
    const errors = [];

    if (typeof aggregatorFn !== 'function') {
      return {
        result: null,
        aggregator: 'custom',
        executionTime: 0,
        errors: [{ message: 'aggregatorFn must be a function' }],
        metadata: { strategy: 'custom' }
      };
    }

    let result = null;
    try {
      result = await aggregatorFn(results, { ...context, allResults: results });
    } catch (error) {
      errors.push({ message: error.message, type: error.name });
    }

    return {
      result,
      aggregator: aggregatorFn.name || 'anonymous',
      executionTime: Date.now() - startTime,
      errors,
      metadata: { strategy: 'custom', success: errors.length === 0 }
    };
  }

  // ============================================
  // Helper Methods
  // ============================================

  static _getQualityScore(entry, criteria = 'quality') {
    if (!entry) return 0;

    // Check entry-level
    if (typeof entry.quality === 'number') return entry.quality;
    if (typeof entry.confidence === 'number') return entry.confidence;
    if (typeof entry.score === 'number') return entry.score;

    // Check result-level
    const result = entry.result;
    if (result && typeof result === 'object') {
      if (typeof result.quality === 'number') return result.quality;
      if (typeof result.confidence === 'number') return result.confidence;
      if (typeof result.score === 'number') return result.score;
    }

    return 0.5; // Default
  }

  static _extractVote(result, field) {
    if (result == null) return null;

    if (field && typeof result === 'object') {
      return result[field] ?? result;
    }

    if (typeof result === 'object' && !Array.isArray(result)) {
      return result.decision ?? result.vote ?? result.value ?? result;
    }

    return result;
  }

  static _calculateAverageQuality(results) {
    if (!results || results.length === 0) return 0;
    const total = results.reduce((sum, r) => sum + this._getQualityScore(r), 0);
    return total / results.length;
  }

  static _mergeArrays(values, combineArrays) {
    const arrays = values.filter(Array.isArray);
    if (arrays.length === 0) return [];
    if (!combineArrays) return arrays[0];

    const combined = [];
    const seen = new Set();
    for (const arr of arrays) {
      for (const item of arr) {
        const key = JSON.stringify(item);
        if (!seen.has(key)) {
          combined.push(item);
          seen.add(key);
        }
      }
    }
    return combined;
  }

  static _mergeObjects(values, weightByQuality, results) {
    const objects = values.filter(v => v && typeof v === 'object' && !Array.isArray(v));
    if (objects.length === 0) return {};

    if (weightByQuality && results) {
      // Sort by quality and merge in order
      const sorted = objects
        .map((obj, i) => ({ obj, quality: this._getQualityScore(results[i]) }))
        .sort((a, b) => b.quality - a.quality);
      return sorted.reduce((acc, { obj }) => this._deepMerge(acc, obj), {});
    }

    return objects.reduce((acc, obj) => this._deepMerge(acc, obj), {});
  }

  static _mergePrimitives(values) {
    const filtered = values.filter(v => v != null);
    if (filtered.length === 0) return null;
    if (filtered.every(v => v === filtered[0])) return filtered[0];
    return [...new Set(filtered)];
  }

  static _deepMerge(obj1, obj2) {
    if (obj1 == null) return obj2;
    if (obj2 == null) return obj1;

    if (typeof obj1 !== 'object' || typeof obj2 !== 'object') {
      return obj2 ?? obj1;
    }

    if (Array.isArray(obj1) && Array.isArray(obj2)) {
      return [...obj1, ...obj2];
    }

    const merged = { ...obj1 };
    for (const key of Object.keys(obj2)) {
      merged[key] = key in merged
        ? this._deepMerge(merged[key], obj2[key])
        : obj2[key];
    }
    return merged;
  }

  static _executeStage(current, stage) {
    const { type, config = {} } = stage;

    switch (type) {
      case 'filter':
        return Array.isArray(current)
          ? current.filter(r => this._getQualityScore(r) >= (config.minQuality || 0))
          : current;

      case 'transform':
        return Array.isArray(current) && typeof config.mapper === 'function'
          ? current.map(config.mapper)
          : current;

      case 'aggregate':
        const method = config.method || 'merge';
        if (method === 'best') return this.selectBest(current, config.options);
        if (method === 'vote') return this.vote(current, config.options);
        return this.merge(current, config.options);

      case 'validate':
        if (!Array.isArray(current)) return current;
        const required = config.required || [];
        return current.filter(r => {
          if (!r.result || typeof r.result !== 'object') return !config.strict;
          return required.every(f => f in r.result && r.result[f] != null);
        });

      default:
        throw new Error(`Unknown stage type: ${type}`);
    }
  }

  /**
   * Calculate Jaccard similarity between two strings
   */
  static calculateSimilarity(str1, str2) {
    if (str1 === str2) return 1.0;
    if (!str1 || !str2) return 0.0;

    const words1 = new Set(String(str1).toLowerCase().split(/\s+/));
    const words2 = new Set(String(str2).toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }
}

module.exports = { AggregationStrategies };
