/**
 * Memory Search API - Query interface for orchestration memory
 *
 * Provides rich querying capabilities including:
 * - Keyword, semantic, and hybrid search
 * - Pattern and agent-specific queries
 * - Success pattern analysis
 * - Timeline and relationship queries
 *
 * @module memory-search-api
 */

const { createComponentLogger } = require('./logger');

class MemorySearchAPI {
  /**
   * Create a new Memory Search API
   * @param {MemoryStore} memoryStore - MemoryStore instance
   * @param {VectorStore} vectorStore - VectorStore instance (optional)
   */
  constructor(memoryStore, vectorStore = null) {
    this.logger = createComponentLogger('MemorySearchAPI');
    this.memoryStore = memoryStore;
    this.vectorStore = vectorStore;

    this.logger.info('MemorySearchAPI initialized', {
      hasVectorStore: !!vectorStore
    });
  }

  /**
   * General search across all orchestrations
   * Combines FTS5 keyword search with optional vector similarity
   *
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @param {string} options.pattern - Filter by pattern (parallel, consensus, etc.)
   * @param {string} options.agentId - Filter by agent
   * @param {number} options.since - Timestamp (ms) to search from
   * @param {number} options.until - Timestamp (ms) to search until
   * @param {boolean} options.successOnly - Only successful orchestrations
   * @param {number} options.limit - Max results (default: 10)
   * @param {boolean} options.useVector - Use vector search if available (default: true)
   * @returns {Promise<Array>} Search results
   */
  async searchOrchestrations(query, options = {}) {
    const {
      pattern,
      agentId,
      since,
      until,
      successOnly,
      limit = 10,
      useVector = true
    } = options;

    try {
      let results = [];

      // Try vector search first if available and requested
      if (this.vectorStore && useVector && query) {
        try {
          const vectorResults = await this.vectorStore.searchSimilar(query, {
            limit,
            minScore: 0.7,
            filters: { pattern, agentId, since, until, successOnly }
          });

          results = vectorResults.map(r => ({
            ...r.metadata,
            id: r.orchestrationId,
            similarity: r.score,
            searchMethod: 'vector'
          }));

          this.logger.info('Vector search completed', {
            query,
            resultsCount: results.length
          });
        } catch (error) {
          this.logger.warn('Vector search failed, falling back to FTS', {
            error: error.message
          });
        }
      }

      // Fall back to FTS5 or use it if vector not available
      if (results.length === 0 && query) {
        const ftsResults = this.memoryStore.searchObservationsFTS(query, {
          limit: limit * 2 // Get more to filter
        });

        // Get full orchestrations for FTS results
        const orchestrationIds = [...new Set(ftsResults.map(r => r.orchestration_id))];
        const orchestrations = orchestrationIds
          .slice(0, limit)
          .map(id => this.memoryStore.getOrchestrationById(id))
          .filter(Boolean);

        results = orchestrations.map(orch => ({
          ...orch,
          searchMethod: 'fts5'
        }));

        this.logger.info('FTS5 search completed', {
          query,
          resultsCount: results.length
        });
      }

      // If no query, use filter-based search
      if (!query && results.length === 0) {
        results = this.memoryStore.searchOrchestrations({
          pattern,
          agentId,
          since,
          until,
          successOnly,
          limit
        }).map(orch => ({
          ...orch,
          searchMethod: 'filter'
        }));

        this.logger.info('Filter search completed', {
          filters: { pattern, agentId, since, until, successOnly },
          resultsCount: results.length
        });
      }

      return results;

    } catch (error) {
      this.logger.error('Search orchestrations failed', {
        error: error.message,
        query,
        options
      });
      return [];
    }
  }

  /**
   * Find orchestrations by specific agent
   * Includes performance metrics and common patterns
   *
   * @param {string} agentId - Agent identifier
   * @param {Object} options - Query options
   * @param {number} options.limit - Max results (default: 20)
   * @param {number} options.since - Timestamp (ms) to search from
   * @returns {Promise<Object>} Agent orchestrations and stats
   */
  async findByAgent(agentId, options = {}) {
    const { limit = 20, since } = options;

    try {
      // Get agent stats
      const stats = this.memoryStore.getAgentStats(agentId);

      // Get orchestrations
      const orchestrations = this.memoryStore.searchOrchestrations({
        agentId,
        since,
        limit
      });

      // Calculate common patterns
      const patternCounts = {};
      orchestrations.forEach(orch => {
        patternCounts[orch.pattern] = (patternCounts[orch.pattern] || 0) + 1;
      });

      const commonPatterns = Object.entries(patternCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([pattern, count]) => ({ pattern, count }));

      this.logger.info('Find by agent completed', {
        agentId,
        orchestrationCount: orchestrations.length
      });

      return {
        agentId,
        stats,
        orchestrations,
        commonPatterns,
        totalFound: orchestrations.length
      };

    } catch (error) {
      this.logger.error('Find by agent failed', {
        error: error.message,
        agentId
      });
      return { agentId, orchestrations: [], stats: null, commonPatterns: [] };
    }
  }

  /**
   * Find orchestrations by pattern type
   * Includes success rates and typical durations
   *
   * @param {string} patternType - Pattern type (parallel, consensus, debate, etc.)
   * @param {Object} options - Query options
   * @param {number} options.limit - Max results (default: 20)
   * @returns {Promise<Object>} Pattern orchestrations and stats
   */
  async findByPattern(patternType, options = {}) {
    const { limit = 20 } = options;

    try {
      // Get pattern stats
      const stats = this.memoryStore.getPatternStats(patternType);

      // Get orchestrations
      const orchestrations = this.memoryStore.searchOrchestrations({
        pattern: patternType,
        limit
      });

      // Get successful collaborations for this pattern
      const successfulCollabs = this.memoryStore.getSuccessfulCollaborations(patternType);

      this.logger.info('Find by pattern completed', {
        patternType,
        orchestrationCount: orchestrations.length
      });

      return {
        pattern: patternType,
        stats,
        orchestrations,
        successfulCollaborations: successfulCollabs,
        totalFound: orchestrations.length
      };

    } catch (error) {
      this.logger.error('Find by pattern failed', {
        error: error.message,
        patternType
      });
      return { pattern: patternType, orchestrations: [], stats: null };
    }
  }

  /**
   * Find orchestrations by concept tags
   * Uses FTS5 to search observation concepts
   *
   * @param {Array<string>} conceptTags - Concept tags to search for
   * @param {Object} options - Query options
   * @param {number} options.limit - Max results (default: 10)
   * @returns {Promise<Array>} Matching orchestrations
   */
  async findByConcept(conceptTags, options = {}) {
    const { limit = 10 } = options;

    if (!Array.isArray(conceptTags) || conceptTags.length === 0) {
      return [];
    }

    try {
      // Build query for FTS5
      const query = conceptTags.join(' OR ');

      // Search observations
      const observations = this.memoryStore.searchObservationsFTS(query, { limit: limit * 3 });

      // Get unique orchestrations
      const orchestrationIds = [...new Set(observations.map(obs => obs.orchestration_id))];
      const orchestrations = orchestrationIds
        .slice(0, limit)
        .map(id => this.memoryStore.getOrchestrationById(id))
        .filter(Boolean);

      this.logger.info('Find by concept completed', {
        conceptTags,
        orchestrationCount: orchestrations.length
      });

      return orchestrations;

    } catch (error) {
      this.logger.error('Find by concept failed', {
        error: error.message,
        conceptTags
      });
      return [];
    }
  }

  /**
   * Get recent orchestrations within a timeframe
   *
   * @param {Object} timeframe - Timeframe options
   * @param {number} timeframe.hours - Hours to look back (default: 24)
   * @param {number} timeframe.days - Days to look back (alternative to hours)
   * @param {number} timeframe.limit - Max results (default: 20)
   * @returns {Promise<Object>} Recent orchestrations with analysis
   */
  async getRecentContext(timeframe = {}) {
    const {
      hours = 24,
      days,
      limit = 20
    } = timeframe;

    try {
      const now = Date.now();
      const hoursBack = days ? days * 24 : hours;
      const since = now - (hoursBack * 60 * 60 * 1000);

      const orchestrations = this.memoryStore.searchOrchestrations({
        since,
        limit
      });

      // Analyze patterns
      const patternCounts = {};
      const successCount = orchestrations.filter(o => o.success).length;

      orchestrations.forEach(orch => {
        patternCounts[orch.pattern] = (patternCounts[orch.pattern] || 0) + 1;
      });

      const trendingPatterns = Object.entries(patternCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([pattern, count]) => ({ pattern, count }));

      this.logger.info('Get recent context completed', {
        hoursBack,
        orchestrationCount: orchestrations.length
      });

      return {
        timeframe: { hours: hoursBack },
        orchestrations,
        trendingPatterns,
        totalFound: orchestrations.length,
        successRate: orchestrations.length > 0
          ? (successCount / orchestrations.length * 100).toFixed(1)
          : 0
      };

    } catch (error) {
      this.logger.error('Get recent context failed', {
        error: error.message,
        timeframe
      });
      return { orchestrations: [], trendingPatterns: [] };
    }
  }

  /**
   * Get timeline of related orchestrations
   * Shows what led to this orchestration and what followed
   *
   * @param {string} orchestrationId - Orchestration ID
   * @param {Object} options - Query options
   * @param {number} options.beforeCount - Number of orchestrations before (default: 5)
   * @param {number} options.afterCount - Number of orchestrations after (default: 5)
   * @returns {Promise<Object>} Timeline with context
   */
  async getTimeline(orchestrationId, options = {}) {
    const { beforeCount = 5, afterCount = 5 } = options;

    try {
      // Get the target orchestration
      const target = this.memoryStore.getOrchestrationById(orchestrationId);

      if (!target) {
        this.logger.warn('Orchestration not found for timeline', { orchestrationId });
        return { target: null, before: [], after: [] };
      }

      // Get orchestrations before
      const before = this.memoryStore.searchOrchestrations({
        until: target.timestamp,
        limit: beforeCount
      }).reverse(); // Oldest first

      // Get orchestrations after
      const after = this.memoryStore.searchOrchestrations({
        since: target.timestamp + 1,
        limit: afterCount
      });

      this.logger.info('Get timeline completed', {
        orchestrationId,
        beforeCount: before.length,
        afterCount: after.length
      });

      return {
        target,
        before,
        after,
        totalContext: before.length + after.length + 1
      };

    } catch (error) {
      this.logger.error('Get timeline failed', {
        error: error.message,
        orchestrationId
      });
      return { target: null, before: [], after: [] };
    }
  }

  /**
   * Find orchestrations similar to a given one
   * Uses vector similarity if available, falls back to pattern/agent matching
   *
   * @param {string} orchestrationId - Reference orchestration ID
   * @param {number} limit - Max results (default: 10)
   * @returns {Promise<Array>} Similar orchestrations
   */
  async getSimilarOrchestrations(orchestrationId, limit = 10) {
    try {
      const reference = this.memoryStore.getOrchestrationById(orchestrationId);

      if (!reference) {
        this.logger.warn('Reference orchestration not found', { orchestrationId });
        return [];
      }

      // Try vector search if available
      if (this.vectorStore) {
        try {
          const similar = await this.vectorStore.searchSimilar(reference.task, {
            limit: limit + 1, // +1 to exclude self
            filters: { excludeId: orchestrationId }
          });

          const results = similar
            .filter(s => s.orchestrationId !== orchestrationId)
            .slice(0, limit)
            .map(s => ({
              ...s.metadata,
              similarity: s.score
            }));

          this.logger.info('Similar orchestrations found (vector)', {
            orchestrationId,
            resultsCount: results.length
          });

          return results;

        } catch (error) {
          this.logger.warn('Vector similarity search failed', {
            error: error.message
          });
        }
      }

      // Fallback: Find by same pattern and overlapping agents
      const agentIds = JSON.parse(reference.agent_ids || '[]');
      const similar = this.memoryStore.searchOrchestrations({
        pattern: reference.pattern,
        limit: limit * 2
      }).filter(orch => {
        if (orch.id === orchestrationId) return false;
        const orchAgents = JSON.parse(orch.agent_ids || '[]');
        const overlap = agentIds.filter(id => orchAgents.includes(id));
        return overlap.length > 0;
      }).slice(0, limit);

      this.logger.info('Similar orchestrations found (pattern/agent)', {
        orchestrationId,
        resultsCount: similar.length
      });

      return similar;

    } catch (error) {
      this.logger.error('Get similar orchestrations failed', {
        error: error.message,
        orchestrationId
      });
      return [];
    }
  }

  /**
   * Analyze success patterns for a task type
   * Returns patterns and agent combinations that worked best
   *
   * @param {string} taskType - Type of task or keywords
   * @param {Object} options - Analysis options
   * @param {number} options.minSuccessRate - Minimum success rate (default: 0.7)
   * @param {number} options.minSamples - Minimum number of samples (default: 3)
   * @returns {Promise<Object>} Success pattern analysis
   */
  async getSuccessPatterns(taskType, options = {}) {
    const { minSuccessRate = 0.7, minSamples = 3 } = options;

    try {
      // Search for relevant orchestrations
      const orchestrations = await this.searchOrchestrations(taskType, {
        successOnly: false,
        limit: 100
      });

      // Group by pattern
      const byPattern = {};
      orchestrations.forEach(orch => {
        if (!byPattern[orch.pattern]) {
          byPattern[orch.pattern] = { total: 0, success: 0, orchestrations: [] };
        }
        byPattern[orch.pattern].total++;
        if (orch.success) byPattern[orch.pattern].success++;
        byPattern[orch.pattern].orchestrations.push(orch);
      });

      // Calculate success rates and filter
      const successfulPatterns = Object.entries(byPattern)
        .map(([pattern, data]) => ({
          pattern,
          successRate: data.success / data.total,
          samples: data.total,
          successfulOrchestrations: data.success,
          examples: data.orchestrations.filter(o => o.success).slice(0, 3)
        }))
        .filter(p => p.successRate >= minSuccessRate && p.samples >= minSamples)
        .sort((a, b) => b.successRate - a.successRate);

      // Find successful agent combinations
      const agentCombos = {};
      orchestrations.filter(o => o.success).forEach(orch => {
        const key = JSON.parse(orch.agent_ids || '[]').sort().join(',');
        if (!agentCombos[key]) {
          agentCombos[key] = { agents: JSON.parse(orch.agent_ids), count: 0 };
        }
        agentCombos[key].count++;
      });

      const topAgentCombos = Object.values(agentCombos)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      this.logger.info('Success patterns analyzed', {
        taskType,
        patternsFound: successfulPatterns.length,
        totalOrchestrations: orchestrations.length
      });

      return {
        taskType,
        successfulPatterns,
        topAgentCombinations: topAgentCombos,
        totalAnalyzed: orchestrations.length
      };

    } catch (error) {
      this.logger.error('Get success patterns failed', {
        error: error.message,
        taskType
      });
      return { taskType, successfulPatterns: [], topAgentCombinations: [] };
    }
  }

  /**
   * Analyze failure patterns for a task type
   * Returns common failure modes to avoid
   *
   * @param {string} taskType - Type of task or keywords
   * @returns {Promise<Object>} Failure pattern analysis
   */
  async getFailurePatterns(taskType) {
    try {
      // Search for failed orchestrations
      const orchestrations = await this.searchOrchestrations(taskType, {
        successOnly: false,
        limit: 100
      });

      const failures = orchestrations.filter(o => !o.success);

      // Group by pattern
      const byPattern = {};
      failures.forEach(orch => {
        if (!byPattern[orch.pattern]) {
          byPattern[orch.pattern] = { count: 0, examples: [] };
        }
        byPattern[orch.pattern].count++;
        if (byPattern[orch.pattern].examples.length < 3) {
          byPattern[orch.pattern].examples.push(orch);
        }
      });

      const commonFailures = Object.entries(byPattern)
        .map(([pattern, data]) => ({
          pattern,
          failureCount: data.count,
          examples: data.examples
        }))
        .sort((a, b) => b.failureCount - a.failureCount);

      this.logger.info('Failure patterns analyzed', {
        taskType,
        failuresFound: failures.length,
        totalOrchestrations: orchestrations.length
      });

      return {
        taskType,
        commonFailures,
        totalFailures: failures.length,
        failureRate: orchestrations.length > 0
          ? (failures.length / orchestrations.length * 100).toFixed(1)
          : 0
      };

    } catch (error) {
      this.logger.error('Get failure patterns failed', {
        error: error.message,
        taskType
      });
      return { taskType, commonFailures: [], totalFailures: 0 };
    }
  }

  /**
   * Get comprehensive stats across all memory
   * @returns {Object} Memory statistics
   */
  getMemoryStats() {
    try {
      return this.memoryStore.getStats();
    } catch (error) {
      this.logger.error('Get memory stats failed', {
        error: error.message
      });
      return {};
    }
  }
}

module.exports = MemorySearchAPI;
