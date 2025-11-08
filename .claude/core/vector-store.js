/**
 * VectorStore - Semantic search with Chroma vector database
 *
 * Provides hybrid search combining:
 * - Vector similarity (semantic understanding via Chroma)
 * - FTS5 keyword matching (fallback via MemoryStore)
 *
 * Graceful degradation strategy:
 * 1. Try Chroma (vector + FTS hybrid)
 * 2. Fall back to FTS-only if Chroma unavailable
 * 3. Return empty results if all fail (orchestration continues)
 *
 * Features:
 * - Lazy initialization with connection pooling
 * - Circuit breaker pattern for resilience
 * - Batch operations with partial success handling
 * - Performance monitoring and metrics
 *
 * @module vector-store
 */

const { createComponentLogger } = require('./logger');

class VectorStore {
  /**
   * Create a VectorStore instance
   *
   * @param {Object} deps - Dependencies (for testability)
   * @param {MemoryStore} deps.memoryStore - Memory store for FTS fallback
   * @param {Object} deps.chromaClient - Optional pre-configured Chroma client
   * @param {Object} options - Configuration options
   * @param {string} [options.chromaHost='http://localhost:8000'] - Chroma server URL
   * @param {string} [options.collectionName='orchestrations'] - Collection name
   * @param {string} [options.embeddingModel='all-MiniLM-L6-v2'] - Embedding model
   * @param {boolean} [options.fallbackToFTS=true] - Enable FTS fallback
   * @param {number} [options.batchSize=10] - Batch processing size
   * @param {number} [options.maxRetries=3] - Maximum retry attempts
   * @param {number} [options.circuitBreakerThreshold=3] - Failures before circuit opens
   * @param {number} [options.circuitBreakerResetTime=60000] - Circuit reset time (ms)
   */
  constructor(deps = {}, options = {}) {
    // Dependencies
    this.memoryStore = deps.memoryStore || deps;
    this.logger = createComponentLogger('VectorStore');

    // Configuration
    this.options = {
      chromaHost: options.chromaHost || process.env.CHROMA_HOST || 'http://localhost:8000',
      collectionName: options.collectionName || 'orchestrations',
      embeddingModel: options.embeddingModel || 'all-MiniLM-L6-v2',
      fallbackToFTS: options.fallbackToFTS !== false,
      batchSize: options.batchSize || 10,
      maxRetries: options.maxRetries || 3,
      circuitBreakerThreshold: options.circuitBreakerThreshold || 3,
      circuitBreakerResetTime: options.circuitBreakerResetTime || 60000,
      ...options
    };

    // State
    this.chromaClient = deps.chromaClient || null;
    this.collection = null;
    this.isAvailable = false;
    this.initializationAttempted = false;
    this.initializationPromise = null;

    // Circuit breaker
    this.circuitBreaker = {
      failures: 0,
      threshold: this.options.circuitBreakerThreshold,
      resetTime: this.options.circuitBreakerResetTime,
      lastFailure: null,
      isOpen: false
    };

    // Metrics
    this.metrics = {
      searches: 0,
      searchesWithChroma: 0,
      searchesWithFTS: 0,
      adds: 0,
      addsSuccessful: 0,
      addsFailed: 0,
      totalSearchDuration: 0,
      totalAddDuration: 0,
      circuitBreakerTrips: 0
    };

    this.logger.info('VectorStore created', {
      chromaHost: this.options.chromaHost,
      collection: this.options.collectionName,
      fallbackEnabled: this.options.fallbackToFTS
    });
  }

  /**
   * Initialize Chroma connection (lazy)
   *
   * This method is called automatically on first use.
   * Safe to call multiple times - initialization happens only once.
   *
   * @returns {Promise<boolean>} True if Chroma available, false otherwise
   */
  async initialize() {
    if (this.initializationAttempted) {
      return this.isAvailable;
    }

    this.initializationAttempted = true;

    try {
      // Try to import Chroma
      const { ChromaClient } = require('chromadb');

      this.logger.debug('Initializing Chroma client', {
        host: this.options.chromaHost
      });

      // Create client
      this.chromaClient = new ChromaClient({
        path: this.options.chromaHost
      });

      // Test connection with heartbeat
      await this.chromaClient.heartbeat();

      // Get or create collection
      this.collection = await this.chromaClient.getOrCreateCollection({
        name: this.options.collectionName,
        metadata: {
          description: 'Multi-agent orchestration vectors',
          embedding_model: this.options.embeddingModel
        }
      });

      this.isAvailable = true;
      this.logger.info('Chroma vector store initialized', {
        host: this.options.chromaHost,
        collection: this.options.collectionName
      });

      return true;

    } catch (error) {
      this.isAvailable = false;
      this.logger.warn('Chroma not available, using FTS-only search', {
        error: error.message,
        host: this.options.chromaHost,
        fallbackEnabled: this.options.fallbackToFTS
      });

      return false;
    }
  }

  /**
   * Ensure Chroma is initialized (lazy initialization)
   *
   * @private
   * @returns {Promise<boolean>} True if available
   */
  async _ensureInitialized() {
    if (!this.initializationPromise) {
      this.initializationPromise = this.initialize();
    }
    return this.initializationPromise;
  }

  /**
   * Add orchestration to vector store
   *
   * @param {string} orchestrationId - Orchestration ID
   * @param {Object} data - Orchestration data
   * @param {string} data.task - Task description
   * @param {string} [data.resultSummary] - Result summary
   * @param {Array<string>} [data.concepts] - Extracted concepts
   * @param {Object} [data.metadata] - Additional metadata
   * @returns {Promise<boolean>} Success status
   */
  async addOrchestration(orchestrationId, data) {
    const startTime = Date.now();
    this.metrics.adds++;

    try {
      await this._ensureInitialized();

      if (!this.isAvailable) {
        this.logger.debug('Chroma unavailable, skipping vector add', {
          orchestrationId
        });
        return false;
      }

      // Check circuit breaker
      if (this._isCircuitOpen()) {
        this.logger.warn('Circuit breaker open, skipping Chroma add', {
          orchestrationId
        });
        return false;
      }

      // Build document for embedding
      const document = this._buildDocument(data);

      // Add to Chroma collection
      await this._callChroma(async () => {
        await this.collection.add({
          ids: [orchestrationId],
          documents: [document],
          metadatas: [{
            pattern: data.metadata?.pattern || 'unknown',
            success: data.metadata?.success !== false,
            timestamp: Date.now(),
            ...data.metadata
          }]
        });
      });

      this.metrics.addsSuccessful++;
      this.metrics.totalAddDuration += Date.now() - startTime;

      this.logger.debug('Orchestration added to vector store', {
        orchestrationId,
        duration: Date.now() - startTime
      });

      return true;

    } catch (error) {
      this.metrics.addsFailed++;
      this.logger.error('Failed to add orchestration to vector store', {
        orchestrationId,
        error: error.message
      });

      // Don't throw - this is optional operation
      return false;
    }
  }

  /**
   * Add multiple orchestrations in batch
   *
   * Processes in chunks to avoid overwhelming Chroma.
   * Returns partial success status.
   *
   * @param {Array<Object>} orchestrations - Array of orchestration objects
   * @param {Object} options - Batch options
   * @param {boolean} [options.continueOnError=true] - Continue on chunk failure
   * @returns {Promise<Object>} { successful: number, failed: number, errors: Array }
   */
  async addOrchestrationsBatch(orchestrations, options = {}) {
    const { continueOnError = true } = options;
    const results = {
      successful: 0,
      failed: 0,
      errors: []
    };

    try {
      await this._ensureInitialized();

      if (!this.isAvailable) {
        this.logger.warn('Chroma unavailable, skipping batch add');
        results.failed = orchestrations.length;
        return results;
      }

      // Split into chunks
      const chunks = this._chunkArray(orchestrations, this.options.batchSize);

      this.logger.info('Starting batch add', {
        total: orchestrations.length,
        chunks: chunks.length,
        chunkSize: this.options.batchSize
      });

      // Process each chunk
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        try {
          await this._addChunk(chunk);
          results.successful += chunk.length;

          this.logger.debug('Chunk processed', {
            chunk: i + 1,
            total: chunks.length,
            size: chunk.length
          });

        } catch (error) {
          results.failed += chunk.length;
          results.errors.push({
            chunkIndex: i,
            chunkSize: chunk.length,
            ids: chunk.map(o => o.id),
            error: error.message
          });

          this.logger.warn('Batch chunk failed', {
            chunk: i + 1,
            size: chunk.length,
            error: error.message
          });

          if (!continueOnError) {
            break;
          }
        }
      }

      this.logger.info('Batch add complete', {
        successful: results.successful,
        failed: results.failed,
        errors: results.errors.length
      });

      return results;

    } catch (error) {
      this.logger.error('Batch add failed', {
        error: error.message,
        total: orchestrations.length
      });

      results.failed = orchestrations.length;
      results.errors.push({
        error: error.message,
        message: 'Batch initialization failed'
      });

      return results;
    }
  }

  /**
   * Add a chunk of orchestrations to Chroma
   *
   * @private
   * @param {Array<Object>} chunk - Chunk of orchestrations
   */
  async _addChunk(chunk) {
    const ids = chunk.map(o => o.id);
    const documents = chunk.map(o => this._buildDocument(o.data));
    const metadatas = chunk.map(o => ({
      pattern: o.data?.metadata?.pattern || 'unknown',
      success: o.data?.metadata?.success !== false,
      timestamp: Date.now(),
      ...o.data?.metadata
    }));

    await this._callChroma(async () => {
      await this.collection.add({
        ids,
        documents,
        metadatas
      });
    });
  }

  /**
   * Search for similar orchestrations (hybrid: semantic + keyword)
   *
   * Search modes:
   * - 'hybrid': Combine vector similarity + FTS keywords (default)
   * - 'vector': Vector similarity only (requires Chroma)
   * - 'fts': FTS keyword search only (always available)
   *
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @param {number} [options.limit=5] - Maximum results
   * @param {number} [options.minSimilarity=0.6] - Minimum similarity score (0-1)
   * @param {string} [options.pattern] - Filter by pattern type
   * @param {boolean} [options.includeObservations=true] - Include observations
   * @param {string} [options.searchMode='hybrid'] - Search mode
   * @returns {Promise<Array<Object>>} Search results with similarity scores
   */
  async searchSimilar(query, options = {}) {
    const startTime = Date.now();
    this.metrics.searches++;

    const {
      limit = 5,
      minSimilarity = 0.6,
      pattern,
      includeObservations = true,
      searchMode = 'hybrid'
    } = options;

    this.logger.debug('Searching orchestrations', {
      query: query.substring(0, 50),
      limit,
      searchMode,
      pattern
    });

    let results = [];

    try {
      // Try vector search if Chroma available and mode allows
      if (searchMode !== 'fts') {
        await this._ensureInitialized();

        if (this.isAvailable && !this._isCircuitOpen()) {
          try {
            const vectorResults = await this._vectorSearch(query, limit * 2, pattern);
            results.push(...vectorResults);
            this.metrics.searchesWithChroma++;

            this.logger.debug('Vector search complete', {
              results: vectorResults.length
            });

          } catch (error) {
            this.logger.warn('Vector search failed, falling back to FTS', {
              error: error.message
            });

            // Automatic fallback to FTS on error
            if (this.options.fallbackToFTS && searchMode !== 'vector') {
              const ftsResults = await this._ftsSearch(query, limit, pattern);
              results.push(...ftsResults);
              this.metrics.searchesWithFTS++;
            }
          }
        } else if (searchMode === 'vector') {
          // Vector-only mode but Chroma unavailable
          this.logger.warn('Vector search requested but Chroma unavailable');
          return [];
        }
      }

      // Add FTS results for hybrid mode or FTS-only mode
      if ((searchMode === 'hybrid' && results.length === 0) || searchMode === 'fts') {
        const ftsResults = await this._ftsSearch(query, limit, pattern);
        results.push(...ftsResults);
        this.metrics.searchesWithFTS++;

        this.logger.debug('FTS search complete', {
          results: ftsResults.length
        });
      }

      // Merge and deduplicate
      const merged = this._mergeResults(results, limit, minSimilarity);

      // Enrich with observations if requested
      if (includeObservations && this.memoryStore) {
        for (const result of merged) {
          try {
            result.observations = this.memoryStore.getObservationsByOrchestration(result.id);
          } catch (error) {
            this.logger.warn('Failed to load observations', {
              orchestrationId: result.id,
              error: error.message
            });
            result.observations = [];
          }
        }
      }

      this.metrics.totalSearchDuration += Date.now() - startTime;

      this.logger.info('Search complete', {
        query: query.substring(0, 50),
        results: merged.length,
        mode: searchMode,
        duration: Date.now() - startTime
      });

      return merged;

    } catch (error) {
      this.logger.error('Search failed', {
        query: query.substring(0, 50),
        error: error.message,
        stack: error.stack
      });

      // Graceful degradation: return empty results
      return [];
    }
  }

  /**
   * Perform vector similarity search using Chroma
   *
   * @private
   * @param {string} query - Search query
   * @param {number} limit - Maximum results
   * @param {string} [pattern] - Filter by pattern
   * @returns {Promise<Array<Object>>} Vector search results
   */
  async _vectorSearch(query, limit, pattern) {
    if (!this.isAvailable) {
      throw new Error('Chroma not available');
    }

    try {
      const queryOptions = {
        queryTexts: [query],
        nResults: limit
      };

      // Add metadata filter if pattern specified
      if (pattern) {
        queryOptions.where = { pattern };
      }

      const chromaResults = await this._callChroma(async () => {
        return await this.collection.query(queryOptions);
      });

      // Transform Chroma results to standard format
      return this._transformChromaResults(chromaResults);

    } catch (error) {
      this.logger.error('Vector search failed', {
        query: query.substring(0, 50),
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Perform FTS keyword search using MemoryStore
   *
   * @private
   * @param {string} query - Search query
   * @param {number} limit - Maximum results
   * @param {string} [pattern] - Filter by pattern
   * @returns {Promise<Array<Object>>} FTS search results
   */
  async _ftsSearch(query, limit, pattern) {
    if (!this.memoryStore || !this.memoryStore.searchObservationsFTS) {
      this.logger.warn('FTS search not available, MemoryStore missing');
      return [];
    }

    try {
      const results = this.memoryStore.searchObservationsFTS(query, {
        limit: limit * 2, // Get more for merging
        type: pattern
      });

      // Transform to standard format
      return results.map(r => ({
        id: r.orchestration_id,
        similarity_score: null,
        relevance_score: Math.abs(r.relevance_score) || 0,
        source: 'fts',
        ...r
      }));

    } catch (error) {
      this.logger.error('FTS search failed', {
        query: query.substring(0, 50),
        error: error.message
      });

      return [];
    }
  }

  /**
   * Merge and deduplicate search results from multiple sources
   *
   * @private
   * @param {Array<Object>} results - Combined results from vector and FTS
   * @param {number} limit - Maximum results to return
   * @param {number} minSimilarity - Minimum similarity threshold
   * @returns {Array<Object>} Merged and ranked results
   */
  _mergeResults(results, limit, minSimilarity) {
    if (results.length === 0) return [];

    // Group by ID and combine scores
    const merged = new Map();

    for (const result of results) {
      const id = result.id;

      if (!merged.has(id)) {
        merged.set(id, {
          ...result,
          sources: [result.source],
          combined_score: this._calculateCombinedScore(result)
        });
      } else {
        // Merge duplicate entries
        const existing = merged.get(id);
        existing.sources.push(result.source);

        // Update scores (take best)
        if (result.similarity_score && (!existing.similarity_score || result.similarity_score > existing.similarity_score)) {
          existing.similarity_score = result.similarity_score;
        }
        if (result.relevance_score && (!existing.relevance_score || result.relevance_score > existing.relevance_score)) {
          existing.relevance_score = result.relevance_score;
        }

        existing.combined_score = this._calculateCombinedScore(existing);
      }
    }

    // Convert to array, filter, sort, and limit
    const mergedArray = Array.from(merged.values())
      .filter(r => r.combined_score >= minSimilarity)
      .sort((a, b) => b.combined_score - a.combined_score)
      .slice(0, limit);

    this.logger.debug('Results merged', {
      total: results.length,
      unique: merged.size,
      filtered: mergedArray.length
    });

    return mergedArray;
  }

  /**
   * Calculate combined score from multiple sources
   *
   * @private
   * @param {Object} result - Search result
   * @returns {number} Combined score (0-1)
   */
  _calculateCombinedScore(result) {
    const vectorScore = result.similarity_score || 0;
    const ftsScore = result.relevance_score ? this._normalizeFTSScore(result.relevance_score) : 0;

    // Weighted average: vector 70%, FTS 30%
    if (vectorScore && ftsScore) {
      return vectorScore * 0.7 + ftsScore * 0.3;
    }

    return vectorScore || ftsScore || 0;
  }

  /**
   * Normalize FTS BM25 score to 0-1 range
   *
   * @private
   * @param {number} bm25Score - BM25 score (typically negative)
   * @returns {number} Normalized score (0-1)
   */
  _normalizeFTSScore(bm25Score) {
    // BM25 scores are negative, closer to 0 is better
    // Map to 0-1 range using sigmoid-like function
    const score = Math.abs(bm25Score);
    return 1 / (1 + score / 10);
  }

  /**
   * Transform Chroma query results to standard format
   *
   * @private
   * @param {Object} chromaResults - Raw Chroma results
   * @returns {Array<Object>} Transformed results
   */
  _transformChromaResults(chromaResults) {
    if (!chromaResults || !chromaResults.ids || chromaResults.ids.length === 0) {
      return [];
    }

    const results = [];
    const ids = chromaResults.ids[0] || [];
    const distances = chromaResults.distances ? chromaResults.distances[0] : [];
    const metadatas = chromaResults.metadatas ? chromaResults.metadatas[0] : [];
    const documents = chromaResults.documents ? chromaResults.documents[0] : [];

    for (let i = 0; i < ids.length; i++) {
      // Convert distance to similarity (Chroma uses L2 distance)
      // Lower distance = higher similarity
      const distance = distances[i] || 1;
      const similarity = 1 / (1 + distance);

      results.push({
        id: ids[i],
        similarity_score: similarity,
        relevance_score: null,
        distance,
        document: documents[i],
        metadata: metadatas[i] || {},
        source: 'vector'
      });
    }

    return results;
  }

  /**
   * Get recommended orchestrations based on context
   *
   * @param {Object} context - Current context
   * @param {string} context.task - Current task
   * @param {Array<string>} [context.agentIds] - Agent IDs
   * @param {string} [context.pattern] - Pattern type
   * @param {number} [limit=3] - Maximum recommendations
   * @returns {Promise<Array<Object>>} Recommended orchestrations
   */
  async getRecommendations(context, limit = 3) {
    const { task, pattern } = context;

    if (!task) {
      this.logger.warn('Cannot get recommendations without task');
      return [];
    }

    this.logger.debug('Getting recommendations', {
      task: task.substring(0, 50),
      pattern,
      limit
    });

    // Search with higher similarity threshold for recommendations
    return await this.searchSimilar(task, {
      limit,
      minSimilarity: 0.7,
      pattern,
      includeObservations: true,
      searchMode: 'hybrid'
    });
  }

  /**
   * Build document text for embedding
   *
   * @private
   * @param {Object} data - Orchestration data
   * @returns {string} Document text
   */
  _buildDocument(data) {
    const parts = [];

    if (data.task) {
      parts.push(`Task: ${data.task}`);
    }

    if (data.resultSummary) {
      parts.push(`Result: ${data.resultSummary}`);
    }

    if (data.concepts && data.concepts.length > 0) {
      parts.push(`Concepts: ${data.concepts.join(', ')}`);
    }

    return parts.join('\n');
  }

  /**
   * Split array into chunks
   *
   * @private
   * @param {Array} array - Array to chunk
   * @param {number} size - Chunk size
   * @returns {Array<Array>} Array of chunks
   */
  _chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Call Chroma with circuit breaker protection
   *
   * @private
   * @param {Function} operation - Async operation to execute
   * @returns {Promise<any>} Operation result
   */
  async _callChroma(operation) {
    // Check if circuit is open
    if (this._isCircuitOpen()) {
      const timeSinceLastFailure = Date.now() - this.circuitBreaker.lastFailure;

      if (timeSinceLastFailure < this.circuitBreaker.resetTime) {
        throw new Error('Circuit breaker open - Chroma unavailable');
      }

      // Try to reset circuit
      this.logger.info('Attempting circuit breaker reset');
      this._resetCircuit();
    }

    try {
      const result = await operation();

      // Success - reset failure count
      if (this.circuitBreaker.failures > 0) {
        this.circuitBreaker.failures = 0;
        this.logger.debug('Circuit breaker failures reset');
      }

      return result;

    } catch (error) {
      // Record failure
      this.circuitBreaker.failures++;
      this.circuitBreaker.lastFailure = Date.now();

      // Open circuit if threshold reached
      if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
        this._openCircuit();
      }

      throw error;
    }
  }

  /**
   * Check if circuit breaker is open
   *
   * @private
   * @returns {boolean} True if circuit is open
   */
  _isCircuitOpen() {
    return this.circuitBreaker.isOpen;
  }

  /**
   * Open circuit breaker
   *
   * @private
   */
  _openCircuit() {
    if (!this.circuitBreaker.isOpen) {
      this.circuitBreaker.isOpen = true;
      this.metrics.circuitBreakerTrips++;

      this.logger.error('Circuit breaker opened', {
        failures: this.circuitBreaker.failures,
        threshold: this.circuitBreaker.threshold,
        resetTime: this.circuitBreaker.resetTime
      });
    }
  }

  /**
   * Reset circuit breaker
   *
   * @private
   */
  _resetCircuit() {
    this.circuitBreaker.isOpen = false;
    this.circuitBreaker.failures = 0;

    this.logger.info('Circuit breaker reset');
  }

  /**
   * Check if Chroma is available
   *
   * @returns {boolean} Availability status
   */
  isHealthy() {
    return this.isAvailable && !this._isCircuitOpen();
  }

  /**
   * Get vector store statistics and metrics
   *
   * @returns {Promise<Object>} Statistics
   */
  async getMetrics() {
    const metrics = {
      ...this.metrics,
      isAvailable: this.isAvailable,
      circuitBreakerOpen: this.circuitBreaker.isOpen,
      circuitBreakerFailures: this.circuitBreaker.failures,
      avgSearchDuration: this.metrics.searches > 0
        ? this.metrics.totalSearchDuration / this.metrics.searches
        : 0,
      avgAddDuration: this.metrics.adds > 0
        ? this.metrics.totalAddDuration / this.metrics.adds
        : 0,
      addSuccessRate: this.metrics.adds > 0
        ? this.metrics.addsSuccessful / this.metrics.adds
        : 0
    };

    // Add Chroma collection stats if available
    if (this.isAvailable && this.collection) {
      try {
        const count = await this.collection.count();
        metrics.totalVectors = count;
      } catch (error) {
        this.logger.warn('Failed to get collection count', {
          error: error.message
        });
      }
    }

    return metrics;
  }

  /**
   * Clean up resources
   */
  async close() {
    this.logger.info('VectorStore closing');

    // Reset state
    this.isAvailable = false;
    this.chromaClient = null;
    this.collection = null;

    this.logger.info('VectorStore closed');
  }
}

module.exports = VectorStore;

/**
 * Usage Example:
 *
 * ```javascript
 * const MemoryStore = require('./memory-store');
 * const VectorStore = require('./vector-store');
 *
 * // Initialize
 * const memoryStore = new MemoryStore('.claude/memory/orchestrations.db');
 * const vectorStore = new VectorStore({ memoryStore }, {
 *   chromaHost: 'http://localhost:8000',
 *   fallbackToFTS: true
 * });
 *
 * // Add orchestration
 * await vectorStore.addOrchestration('orch-123', {
 *   task: 'Implement authentication',
 *   resultSummary: 'Successfully implemented JWT authentication',
 *   concepts: ['authentication', 'jwt', 'security'],
 *   metadata: { pattern: 'parallel', success: true }
 * });
 *
 * // Search similar
 * const results = await vectorStore.searchSimilar('authentication implementation', {
 *   limit: 5,
 *   searchMode: 'hybrid',
 *   includeObservations: true
 * });
 *
 * // Get recommendations
 * const recommendations = await vectorStore.getRecommendations({
 *   task: 'Add user authentication',
 *   pattern: 'parallel'
 * }, 3);
 *
 * // Check health
 * const isHealthy = vectorStore.isHealthy();
 *
 * // Get metrics
 * const metrics = await vectorStore.getMetrics();
 *
 * // Cleanup
 * await vectorStore.close();
 * ```
 */
