/**
 * ContextRetriever - Intelligent context loading with progressive disclosure
 *
 * Features:
 * - Progressive disclosure (Layer 1: Index, Layer 2: Full details)
 * - Token-aware loading with budget management
 * - LRU cache with intelligent eviction
 * - Smart truncation preserving valuable data
 * - Integration with VectorStore and MemoryStore
 *
 * Strategy:
 * 1. Layer 1: Load lightweight index (~100 tokens)
 *    - IDs, summaries, relevance scores
 *    - Fast, minimal token cost
 *    - Provides overview of relevant context
 *
 * 2. Layer 2: Load full details on-demand (token budget aware)
 *    - Complete orchestration data
 *    - Observations and metadata
 *    - Smart truncation if needed
 *
 * @module context-retriever
 */

const { createComponentLogger } = require('./logger');
const TokenCounter = require('./token-counter');

class ContextRetriever {
  /**
   * Create a ContextRetriever instance
   *
   * @param {Object} deps - Dependencies (for testability)
   * @param {MemoryStore} deps.memoryStore - Memory store for data access
   * @param {VectorStore} deps.vectorStore - Vector store for similarity search
   * @param {Object} options - Configuration options
   * @param {number} [options.maxTokens=2000] - Default token budget
   * @param {number} [options.minRelevanceScore=0.6] - Minimum relevance threshold
   * @param {number} [options.cacheSize=100] - LRU cache size
   * @param {number} [options.cacheTTL=300000] - Cache TTL in ms (5 minutes)
   * @param {boolean} [options.enableProgressive=true] - Enable progressive loading
   * @param {number} [options.layer1Limit=3] - Max Layer 1 index entries
   * @param {number} [options.layer2Limit=5] - Max Layer 2 full details
   * @param {number} [options.tokenBufferPercent=0.2] - Token budget buffer (20%)
   */
  constructor(deps = {}, options = {}) {
    // Dependencies
    this.memoryStore = deps.memoryStore;
    this.vectorStore = deps.vectorStore;
    this.tokenCounter = new TokenCounter({ memoryStore: deps.memoryStore });
    this.logger = createComponentLogger('ContextRetriever');

    // Configuration
    this.options = {
      maxTokens: options.maxTokens || 2000,
      minRelevanceScore: options.minRelevanceScore || 0.6,
      cacheSize: options.cacheSize || 100,
      cacheTTL: options.cacheTTL || 300000, // 5 minutes
      enableProgressive: options.enableProgressive !== false,
      layer1Limit: options.layer1Limit || 3,
      layer2Limit: options.layer2Limit || 5,
      tokenBufferPercent: options.tokenBufferPercent || 0.2,
      ...options
    };

    // LRU Cache
    this.cache = new Map();
    this.cacheAccess = new Map(); // Track access times for LRU

    // Metrics
    this.metrics = {
      retrievals: 0,
      cacheHits: 0,
      cacheMisses: 0,
      layer1Loads: 0,
      layer2Loads: 0,
      totalRetrievalTime: 0,
      totalTokensServed: 0,
      truncations: 0,
      avgRetrievalTime: 0,
      cacheHitRate: 0
    };

    this.logger.info('ContextRetriever created', {
      maxTokens: this.options.maxTokens,
      cacheSize: this.options.cacheSize,
      progressive: this.options.enableProgressive
    });
  }

  /**
   * Retrieve context for a task (main entry point)
   *
   * Progressive disclosure:
   * - Layer 1: Index of relevant orchestrations (lightweight)
   * - Layer 2: Full details for top matches (on-demand)
   *
   * @param {Object} context - Current execution context
   * @param {string} context.task - Task description
   * @param {Array<string>} [context.agentIds=[]] - Agent IDs
   * @param {string} [context.pattern] - Pattern type
   * @param {Object} options - Retrieval options
   * @param {number} [options.maxTokens] - Override max tokens
   * @param {boolean} [options.includeObservations=true] - Include observations
   * @param {boolean} [options.progressive] - Override progressive mode
   * @returns {Promise<Object>} Context object
   */
  async retrieveContext(context, options = {}) {
    const startTime = Date.now();
    this.metrics.retrievals++;

    const {
      maxTokens = this.options.maxTokens,
      includeObservations = true,
      progressive = this.options.enableProgressive
    } = options;

    this.logger.debug('Retrieving context', {
      task: context.task?.substring(0, 50),
      pattern: context.pattern,
      maxTokens,
      progressive
    });

    try {
      // Check cache first
      const cacheKey = this._generateCacheKey(context);
      const cached = this._getCached(cacheKey);

      if (cached) {
        this.metrics.cacheHits++;
        this._updateMetrics(startTime, cached.tokenCount, false);

        this.logger.debug('Cache hit', { cacheKey });
        return cached;
      }

      this.metrics.cacheMisses++;

      // Validate dependencies
      if (!this.vectorStore) {
        this.logger.warn('VectorStore not available, returning empty context');
        return this._emptyContext(startTime, 'VectorStore not available');
      }

      let result;

      if (progressive) {
        // PROGRESSIVE DISCLOSURE STRATEGY
        result = await this._retrieveProgressive(context, maxTokens, includeObservations);
      } else {
        // EAGER LOADING STRATEGY (backwards compatibility)
        result = await this._retrieveEager(context, maxTokens, includeObservations);
      }

      // Cache the result
      this._setCache(cacheKey, result);

      // Update metrics
      this._updateMetrics(startTime, result.tokenCount, result.truncated || false);

      this.logger.info('Context retrieved', {
        progressive,
        tokenCount: result.tokenCount,
        duration: result.retrievalTime,
        cached: false,
        truncated: result.truncated || false
      });

      return result;

    } catch (error) {
      this.logger.error('Context retrieval failed', {
        error: error.message,
        stack: error.stack,
        task: context.task?.substring(0, 50)
      });

      // Graceful degradation: return empty context
      return this._emptyContext(startTime, error.message);
    }
  }

  /**
   * Retrieve context using progressive disclosure
   *
   * @private
   * @param {Object} context - Execution context
   * @param {number} maxTokens - Token budget
   * @param {boolean} includeObservations - Include observations
   * @returns {Promise<Object>} Progressive context
   */
  async _retrieveProgressive(context, maxTokens, includeObservations) {
    const startTime = Date.now();

    // Apply token buffer (reserve 20% for safety)
    const effectiveBudget = Math.floor(maxTokens * (1 - this.options.tokenBufferPercent));

    // Layer 1: Load index (lightweight, ~100 tokens)
    const layer1 = await this.loadLayer1(context.task, {
      pattern: context.pattern,
      agentIds: context.agentIds,
      limit: this.options.layer1Limit
    });

    // Calculate remaining token budget
    const layer1Tokens = this.tokenCounter.countTokens(JSON.stringify(layer1));
    const remainingBudget = effectiveBudget - layer1Tokens;

    this.logger.debug('Layer 1 loaded', {
      orchestrations: layer1.orchestrations.length,
      tokens: layer1Tokens,
      remaining: remainingBudget
    });

    // Layer 2: Load full details if budget allows (on-demand)
    let layer2 = null;
    if (remainingBudget > 500 && layer1.orchestrations.length > 0) {
      const topIds = layer1.orchestrations
        .slice(0, this.options.layer2Limit)
        .map(o => o.id);

      layer2 = await this.loadLayer2(topIds, remainingBudget);

      this.logger.debug('Layer 2 loaded', {
        orchestrations: layer2.loaded,
        tokens: layer2.tokenCount,
        skipped: layer2.skipped
      });
    } else {
      this.logger.debug('Skipping Layer 2', {
        reason: remainingBudget <= 500 ? 'insufficient budget' : 'no orchestrations found'
      });
    }

    const totalTokens = layer1Tokens + (layer2?.tokenCount || 0);

    return {
      loaded: true,
      progressive: true,
      layer1,
      layer2,
      tokenCount: totalTokens,
      retrievalTime: Date.now() - startTime,
      truncated: layer2?.truncated || false
    };
  }

  /**
   * Retrieve context using eager loading (legacy)
   *
   * @private
   * @param {Object} context - Execution context
   * @param {number} maxTokens - Token budget
   * @param {boolean} includeObservations - Include observations
   * @returns {Promise<Object>} Eager context
   */
  async _retrieveEager(context, maxTokens, includeObservations) {
    const startTime = Date.now();

    // Search for similar orchestrations
    const orchestrations = await this.vectorStore.searchSimilar(context.task, {
      limit: 5,
      pattern: context.pattern,
      includeObservations,
      minSimilarity: this.options.minRelevanceScore
    });

    // Format orchestrations
    const contextData = {
      orchestrations: orchestrations.map(o => this._formatOrchestration(o))
    };

    let tokenCount = this.tokenCounter.countTokens(JSON.stringify(contextData));
    let wasTruncated = false;

    // Truncate if over budget
    if (tokenCount > maxTokens) {
      contextData.orchestrations = this._truncateToTokens(
        contextData.orchestrations,
        maxTokens
      );
      tokenCount = this.tokenCounter.countTokens(JSON.stringify(contextData));
      wasTruncated = true;
    }

    return {
      loaded: true,
      progressive: false,
      orchestrations: contextData.orchestrations,
      tokenCount,
      retrievalTime: Date.now() - startTime,
      truncated: wasTruncated
    };
  }

  /**
   * Load Layer 1: Index of relevant orchestrations
   * Returns lightweight index with IDs, summaries, relevance scores
   *
   * @param {string} query - Search query
   * @param {Object} filters - Search filters
   * @param {string} [filters.pattern] - Pattern type filter
   * @param {Array<string>} [filters.agentIds] - Agent IDs filter
   * @param {number} [filters.limit] - Maximum results
   * @returns {Promise<Object>} Layer 1 context
   */
  async loadLayer1(query, filters = {}) {
    this.metrics.layer1Loads++;

    const { pattern, limit = this.options.layer1Limit } = filters;

    this.logger.debug('Loading Layer 1', { query: query.substring(0, 50), pattern, limit });

    try {
      // Search using vector store (hybrid search)
      const results = await this.vectorStore.searchSimilar(query, {
        limit,
        pattern,
        includeObservations: false, // Layer 1 doesn't need observations
        searchMode: 'hybrid',
        minSimilarity: this.options.minRelevanceScore
      });

      // Build lightweight index
      const index = results.map(r => ({
        id: r.id,
        pattern: r.pattern || r.metadata?.pattern || 'unknown',
        task: this._truncateText(r.task, 100),
        summary: this._truncateText(r.result_summary || r.metadata?.resultSummary || '', 150),
        relevance: r.combined_score || r.similarity_score || r.relevance_score || 0,
        agentIds: r.agent_ids || r.metadata?.agentIds || [],
        timestamp: r.timestamp,
        success: r.success === 1 || r.metadata?.success === true,
        tokenCount: r.token_count || r.metadata?.tokenCount || 0
      }));

      return {
        orchestrations: index,
        totalFound: results.length,
        query,
        filters
      };

    } catch (error) {
      this.logger.error('Layer 1 loading failed', {
        error: error.message,
        query: query.substring(0, 50)
      });

      // Return empty index on failure
      return {
        orchestrations: [],
        totalFound: 0,
        query,
        filters,
        error: error.message
      };
    }
  }

  /**
   * Load Layer 2: Full details for selected orchestrations
   * Fetches complete orchestration data including observations
   *
   * @param {Array<string>} orchestrationIds - IDs to load
   * @param {number} tokenBudget - Remaining token budget
   * @returns {Promise<Object>} Layer 2 context
   */
  async loadLayer2(orchestrationIds, tokenBudget) {
    this.metrics.layer2Loads++;

    this.logger.debug('Loading Layer 2', {
      ids: orchestrationIds.length,
      budget: tokenBudget
    });

    const orchestrations = [];
    let totalTokens = 0;
    let truncated = false;

    try {
      for (const id of orchestrationIds) {
        // Check if we're over budget
        if (totalTokens >= tokenBudget) {
          this.logger.debug('Token budget exhausted', {
            loaded: orchestrations.length,
            remaining: orchestrationIds.length - orchestrations.length
          });
          break;
        }

        // Load full orchestration
        const orch = this.memoryStore.getOrchestrationById(id, true);

        if (!orch) {
          this.logger.warn('Orchestration not found', { id });
          continue;
        }

        // Calculate token cost
        const orchTokens = this.tokenCounter.countTokens(JSON.stringify(orch));

        // Check if this single item would exceed budget
        if (totalTokens + orchTokens > tokenBudget) {
          // Try to include a truncated version
          const truncatedOrch = this._truncateOrchestration(
            orch,
            tokenBudget - totalTokens
          );

          if (truncatedOrch) {
            const truncatedTokens = this.tokenCounter.countTokens(
              JSON.stringify(truncatedOrch)
            );
            orchestrations.push(truncatedOrch);
            totalTokens += truncatedTokens;
            truncated = true;

            this.logger.debug('Orchestration truncated to fit budget', {
              id,
              originalTokens: orchTokens,
              truncatedTokens,
              remaining: tokenBudget - totalTokens
            });
          }

          break;
        }

        orchestrations.push(orch);
        totalTokens += orchTokens;
      }

      return {
        orchestrations,
        tokenCount: totalTokens,
        loaded: orchestrations.length,
        skipped: orchestrationIds.length - orchestrations.length,
        truncated
      };

    } catch (error) {
      this.logger.error('Layer 2 loading failed', {
        error: error.message
      });

      return {
        orchestrations: [],
        tokenCount: 0,
        loaded: 0,
        skipped: orchestrationIds.length,
        error: error.message
      };
    }
  }

  /**
   * Truncate orchestration to fit token budget
   *
   * Priority order: core fields > observations > result_summary > metadata
   *
   * @private
   * @param {Object} orchestration - Orchestration to truncate
   * @param {number} maxTokens - Token budget
   * @returns {Object|null} Truncated orchestration or null if can't fit
   */
  _truncateOrchestration(orchestration, maxTokens) {
    this.metrics.truncations++;

    // Start with core fields (always include)
    const core = {
      id: orchestration.id,
      pattern: orchestration.pattern,
      success: orchestration.success,
      timestamp: orchestration.timestamp,
      agent_ids: orchestration.agent_ids,
      task: orchestration.task
    };

    let currentTokens = this.tokenCounter.countTokens(JSON.stringify(core));
    const remaining = maxTokens - currentTokens;

    // Not enough budget even for core
    if (remaining < 100) {
      this.logger.warn('Insufficient budget for core fields', {
        required: currentTokens,
        available: maxTokens
      });
      return null;
    }

    const result = { ...core };

    // Add observations (most valuable)
    if (orchestration.observations && remaining > 200) {
      const obsString = JSON.stringify(orchestration.observations);
      const obsBudget = Math.floor(remaining * 0.6); // 60% for observations

      const { text, wasTruncated, actualTokens } = this.tokenCounter.truncateToTokenLimit(
        obsString,
        obsBudget,
        '... [observations truncated]'
      );

      if (!wasTruncated || actualTokens > 50) {
        try {
          result.observations = JSON.parse(text);
          currentTokens += actualTokens;
        } catch (error) {
          this.logger.warn('Failed to parse truncated observations', {
            error: error.message
          });
        }
      }
    }

    // Add result summary if budget allows
    const summaryBudget = maxTokens - currentTokens - 50;
    if (orchestration.result_summary && summaryBudget > 50) {
      const { text } = this.tokenCounter.truncateToTokenLimit(
        orchestration.result_summary,
        summaryBudget,
        '... [truncated]'
      );
      result.result_summary = text;
    }

    // Add metadata if space remains
    if (orchestration.metadata) {
      result.metadata = orchestration.metadata;
    }

    return result;
  }

  /**
   * Truncate array of orchestrations to fit token budget
   *
   * @private
   * @param {Array<Object>} orchestrations - Orchestrations to truncate
   * @param {number} maxTokens - Token budget
   * @returns {Array<Object>} Truncated orchestrations
   */
  _truncateToTokens(orchestrations, maxTokens) {
    const result = [];
    let totalTokens = 0;

    for (const orch of orchestrations) {
      const orchTokens = this.tokenCounter.countTokens(JSON.stringify(orch));

      if (totalTokens + orchTokens <= maxTokens) {
        result.push(orch);
        totalTokens += orchTokens;
      } else {
        // Try truncated version
        const truncated = this._truncateOrchestration(orch, maxTokens - totalTokens);
        if (truncated) {
          result.push(truncated);
          totalTokens += this.tokenCounter.countTokens(JSON.stringify(truncated));
        }
        break;
      }
    }

    return result;
  }

  /**
   * Format orchestration for output
   *
   * @private
   * @param {Object} orchestration - Raw orchestration
   * @returns {Object} Formatted orchestration
   */
  _formatOrchestration(orchestration) {
    return {
      id: orchestration.id,
      pattern: orchestration.pattern || orchestration.metadata?.pattern,
      task: orchestration.task,
      result_summary: orchestration.result_summary || orchestration.metadata?.resultSummary,
      success: orchestration.success === 1 || orchestration.metadata?.success,
      timestamp: orchestration.timestamp,
      agent_ids: orchestration.agent_ids || orchestration.metadata?.agentIds || [],
      observations: orchestration.observations || [],
      relevance: orchestration.combined_score || orchestration.similarity_score || 0
    };
  }

  /**
   * Truncate text to maximum length
   *
   * @private
   * @param {string} text - Text to truncate
   * @param {number} maxLength - Maximum length
   * @returns {string} Truncated text
   */
  _truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  /**
   * Generate cache key from context
   *
   * @private
   * @param {Object} context - Execution context
   * @returns {string} Cache key
   */
  _generateCacheKey(context) {
    // Create stable cache key from context
    const parts = [
      context.task || '',
      (context.agentIds || []).sort().join(','),
      context.pattern || ''
    ];

    // Simple hash function
    const hash = parts.join('::').split('').reduce(
      (acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0,
      0
    );

    return `ctx_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Get cached context (if available and not expired)
   *
   * @private
   * @param {string} cacheKey - Cache key
   * @returns {Object|null} Cached context or null
   */
  _getCached(cacheKey) {
    const entry = this.cache.get(cacheKey);

    if (!entry) {
      return null;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(cacheKey);
      this.cacheAccess.delete(cacheKey);
      this.logger.debug('Cache entry expired', { cacheKey });
      return null;
    }

    // Update access time (LRU)
    this.cacheAccess.set(cacheKey, Date.now());

    return entry.context;
  }

  /**
   * Store context in cache
   *
   * @private
   * @param {string} cacheKey - Cache key
   * @param {Object} context - Context to cache
   * @param {number} [ttl] - Time to live (ms)
   */
  _setCache(cacheKey, context, ttl) {
    const expiresAt = Date.now() + (ttl || this.options.cacheTTL);

    // Evict if cache is full
    if (this.cache.size >= this.options.cacheSize) {
      this._evictLRU();
    }

    this.cache.set(cacheKey, {
      context,
      expiresAt,
      createdAt: Date.now()
    });

    this.cacheAccess.set(cacheKey, Date.now());

    this.logger.debug('Context cached', {
      cacheKey,
      ttl: ttl || this.options.cacheTTL,
      cacheSize: this.cache.size
    });
  }

  /**
   * Evict least recently used cache entry
   *
   * @private
   */
  _evictLRU() {
    // Find entry with oldest access time
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, time] of this.cacheAccess.entries()) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.cacheAccess.delete(oldestKey);
      this.logger.debug('Cache entry evicted (LRU)', {
        cacheKey: oldestKey
      });
    }
  }

  /**
   * Return empty context on failure (graceful degradation)
   *
   * @private
   * @param {number} startTime - Start time for duration calculation
   * @param {string} error - Error message
   * @returns {Object} Empty context
   */
  _emptyContext(startTime, error) {
    return {
      loaded: false,
      error,
      tokenCount: 0,
      retrievalTime: Date.now() - startTime
    };
  }

  /**
   * Update metrics
   *
   * @private
   * @param {number} startTime - Start time
   * @param {number} tokenCount - Tokens served
   * @param {boolean} wasTruncated - Whether truncation occurred
   */
  _updateMetrics(startTime, tokenCount, wasTruncated) {
    const duration = Math.max(1, Date.now() - startTime); // Ensure at least 1ms

    this.metrics.totalRetrievalTime += duration;
    this.metrics.totalTokensServed += tokenCount;

    // Calculate averages
    this.metrics.avgRetrievalTime = this.metrics.retrievals > 0
      ? this.metrics.totalRetrievalTime / this.metrics.retrievals
      : 0;

    this.metrics.cacheHitRate = this.metrics.retrievals > 0
      ? this.metrics.cacheHits / this.metrics.retrievals
      : 0;
  }

  /**
   * Clear cache (all or specific keys)
   *
   * @param {string} [pattern] - Optional pattern to match (simple string match)
   */
  clearCache(pattern) {
    if (pattern) {
      let cleared = 0;
      for (const key of this.cache.keys()) {
        if (key.includes(pattern)) {
          this.cache.delete(key);
          this.cacheAccess.delete(key);
          cleared++;
        }
      }
      this.logger.info('Cache cleared by pattern', { pattern, cleared });
    } else {
      const size = this.cache.size;
      this.cache.clear();
      this.cacheAccess.clear();
      this.logger.info('Cache cleared', { cleared: size });
    }
  }

  /**
   * Get cache statistics
   *
   * @returns {Object} Cache stats
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      maxSize: this.options.cacheSize,
      hitRate: this.metrics.cacheHitRate,
      hits: this.metrics.cacheHits,
      misses: this.metrics.cacheMisses
    };
  }

  /**
   * Get retriever statistics and metrics
   *
   * @returns {Object} Statistics
   */
  getMetrics() {
    return {
      ...this.metrics,
      cache: this.getCacheStats(),
      avgTokensPerRetrieval: this.metrics.retrievals > 0
        ? this.metrics.totalTokensServed / this.metrics.retrievals
        : 0
    };
  }
}

module.exports = ContextRetriever;

/**
 * Usage Example:
 *
 * ```javascript
 * const MemoryStore = require('./memory-store');
 * const VectorStore = require('./vector-store');
 * const ContextRetriever = require('./context-retriever');
 *
 * // Initialize dependencies
 * const memoryStore = new MemoryStore('.claude/memory/orchestrations.db');
 * const vectorStore = new VectorStore({ memoryStore }, {
 *   chromaHost: 'http://localhost:8000'
 * });
 *
 * // Create context retriever
 * const contextRetriever = new ContextRetriever(
 *   { memoryStore, vectorStore },
 *   {
 *     maxTokens: 2000,
 *     enableProgressive: true,
 *     cacheSize: 100
 *   }
 * );
 *
 * // Retrieve context
 * const context = await contextRetriever.retrieveContext({
 *   task: 'Implement user authentication',
 *   agentIds: ['agent-1', 'agent-2'],
 *   pattern: 'parallel'
 * });
 *
 * // Access progressive layers
 * if (context.progressive) {
 *   console.log('Layer 1 Index:', context.layer1.orchestrations);
 *   console.log('Layer 2 Details:', context.layer2?.orchestrations);
 * }
 *
 * // Load specific layers
 * const layer1 = await contextRetriever.loadLayer1('authentication', {
 *   pattern: 'parallel',
 *   limit: 5
 * });
 *
 * const layer2 = await contextRetriever.loadLayer2(
 *   layer1.orchestrations.map(o => o.id),
 *   1500 // token budget
 * );
 *
 * // Cache management
 * contextRetriever.clearCache('authentication'); // Clear specific pattern
 * const stats = contextRetriever.getCacheStats();
 *
 * // Metrics
 * const metrics = contextRetriever.getMetrics();
 * console.log('Cache hit rate:', metrics.cache.hitRate);
 * console.log('Avg retrieval time:', metrics.avgRetrievalTime);
 * ```
 */
