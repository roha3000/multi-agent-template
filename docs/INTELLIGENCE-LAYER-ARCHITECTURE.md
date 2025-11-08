# Intelligence Layer Architecture Design

**Version:** 1.0
**Date:** 2025-11-08
**Architect:** System Architect Agent
**Status:** Design Complete - Ready for Implementation

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Component Specifications](#component-specifications)
   - [VectorStore](#1-vectorstore)
   - [ContextRetriever](#2-contextretriever)
   - [AICategorizationService](#3-aicategorizationservice)
4. [Integration Architecture](#integration-architecture)
5. [Error Handling & Graceful Degradation](#error-handling--graceful-degradation)
6. [Testing Strategy](#testing-strategy)
7. [Performance Considerations](#performance-considerations)
8. [Implementation Roadmap](#implementation-roadmap)

---

## Executive Summary

The Intelligence Layer adds semantic search, smart context retrieval, and AI-powered observation extraction on top of the existing core memory architecture. This layer transforms raw orchestration data into actionable insights while maintaining the framework's commitment to graceful degradation and reliability.

**Key Design Principles:**
- **Graceful Degradation First**: Every component has fallback strategies
- **Token Efficiency**: Progressive disclosure and smart caching
- **Performance Optimized**: Batching, caching, and lazy loading
- **Testable Design**: Dependency injection throughout
- **Hybrid Architecture**: Synchronous hooks for critical paths, async events for optional operations

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Intelligence Layer                         │
│                                                                  │
│  ┌────────────────┐  ┌─────────────────┐  ┌──────────────────┐ │
│  │  VectorStore   │  │ ContextRetriever│  │ AICategorizationService
│  │                │  │                 │  │                  │ │
│  │ • Chroma DB    │  │ • Progressive   │  │ • AI Extraction  │ │
│  │ • Hybrid       │  │   Disclosure    │  │ • Rule-based     │ │
│  │   Search       │  │ • Token Aware   │  │   Fallback       │ │
│  │ • Graceful     │  │ • LRU Caching   │  │ • Event-based    │ │
│  │   Fallback     │  │ • Smart Loading │  │   Integration    │ │
│  └────────┬───────┘  └────────┬────────┘  └────────┬─────────┘ │
│           │                   │                     │           │
└───────────┼───────────────────┼─────────────────────┼───────────┘
            │                   │                     │
┌───────────┼───────────────────┼─────────────────────┼───────────┐
│                         Core Architecture                        │
│           │                   │                     │           │
│  ┌────────▼───────┐  ┌────────▼────────┐  ┌────────▼─────────┐ │
│  │  MemoryStore   │  │ LifecycleHooks  │  │   MessageBus     │ │
│  │                │  │                 │  │                  │ │
│  │ • SQLite DB    │◄─┤ • beforeExec    │◄─┤ • orchestrator:  │ │
│  │ • FTS5 Search  │  │ • afterExec     │  │   complete       │ │
│  │ • Stats/Metrics│  │ • onError       │  │ • Fault Isolated │ │
│  └────────────────┘  └─────────────────┘  └──────────────────┘ │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

Data Flow:
──────────
1. Orchestration executes → MemoryStore saves → MessageBus event
2. AICategorizationService (async) → Extracts observations → VectorStore
3. Next orchestration → ContextRetriever queries → VectorStore + FTS5
4. Progressive context loading → Token-aware enrichment → Execution
```

**Layer Responsibilities:**

| Component | Purpose | Critical Path? | Fallback Strategy |
|-----------|---------|----------------|-------------------|
| **VectorStore** | Semantic similarity search | No | Fall back to FTS5-only search |
| **ContextRetriever** | Smart context loading | Yes (via hooks) | Return empty context on failure |
| **AICategorizationService** | Extract observations from orchestrations | No | Use rule-based categorization |

---

## Component Specifications

### 1. VectorStore

**Location:** `.claude/core/vector-store.js`

**Purpose:** Provides semantic similarity search using Chroma vector database with graceful fallback to FTS5-only search.

#### Class Structure

```javascript
class VectorStore {
  constructor(memoryStore, options = {}) {
    // Dependencies
    this.memoryStore = memoryStore;
    this.logger = createComponentLogger('VectorStore');

    // Configuration
    this.options = {
      chromaHost: options.chromaHost || 'http://localhost:8000',
      collectionName: options.collectionName || 'orchestrations',
      embeddingModel: options.embeddingModel || 'all-MiniLM-L6-v2',
      fallbackToFTS: options.fallbackToFTS !== false, // Default true
      batchSize: options.batchSize || 10,
      maxRetries: options.maxRetries || 3,
      ...options
    };

    // State
    this.chromaClient = null;
    this.collection = null;
    this.isAvailable = false;
    this.initializationAttempted = false;
  }
}
```

#### Public API

```javascript
/**
 * Initialize Chroma connection (lazy)
 *
 * @returns {Promise<boolean>} True if Chroma available, false otherwise
 */
async initialize()

/**
 * Add orchestration to vector store
 *
 * @param {string} orchestrationId - Orchestration ID
 * @param {Object} data - Orchestration data
 * @param {string} data.task - Task description
 * @param {string} data.resultSummary - Result summary
 * @param {Array<string>} data.concepts - Extracted concepts
 * @param {Object} data.metadata - Additional metadata
 * @returns {Promise<boolean>} Success status
 */
async addOrchestration(orchestrationId, data)

/**
 * Add multiple orchestrations in batch
 *
 * @param {Array<Object>} orchestrations - Array of orchestration objects
 * @returns {Promise<Object>} { successful: number, failed: number, errors: Array }
 */
async addOrchestrationsBatch(orchestrations)

/**
 * Search for similar orchestrations (hybrid: semantic + keyword)
 *
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @param {number} [options.limit=5] - Maximum results
 * @param {number} [options.minSimilarity=0.6] - Minimum similarity score (0-1)
 * @param {string} [options.pattern] - Filter by pattern type
 * @param {boolean} [options.includeObservations=true] - Include observations
 * @param {string} [options.searchMode='hybrid'] - 'hybrid', 'vector', 'fts'
 * @returns {Promise<Array<Object>>} Search results with similarity scores
 */
async searchSimilar(query, options = {})

/**
 * Get recommended orchestrations based on context
 *
 * @param {Object} context - Current context
 * @param {string} context.task - Current task
 * @param {Array<string>} context.agentIds - Agent IDs
 * @param {string} context.pattern - Pattern type
 * @param {number} [limit=3] - Maximum recommendations
 * @returns {Promise<Array<Object>>} Recommended orchestrations
 */
async getRecommendations(context, limit = 3)

/**
 * Check if Chroma is available
 *
 * @returns {boolean} Availability status
 */
isChromaAvailable()

/**
 * Get vector store statistics
 *
 * @returns {Promise<Object>} Statistics
 */
async getStats()

/**
 * Clean up resources
 */
async close()
```

#### Hybrid Search Strategy

```javascript
// Hybrid search combines vector similarity + FTS5 keyword matching
async searchSimilar(query, options = {}) {
  const {
    limit = 5,
    minSimilarity = 0.6,
    searchMode = 'hybrid',
    includeObservations = true
  } = options;

  let results = [];

  // Try vector search if Chroma available
  if (this.isChromaAvailable() && searchMode !== 'fts') {
    try {
      const vectorResults = await this._vectorSearch(query, limit * 2);
      results.push(...vectorResults);
    } catch (error) {
      this.logger.warn('Vector search failed, falling back to FTS', {
        error: error.message
      });

      // Automatic fallback to FTS on error
      if (this.options.fallbackToFTS && searchMode !== 'vector') {
        const ftsResults = await this._ftsSearch(query, limit);
        results.push(...ftsResults);
      }
    }
  }

  // Add FTS results for hybrid mode
  if (searchMode === 'hybrid' || searchMode === 'fts') {
    const ftsResults = await this._ftsSearch(query, limit);
    results.push(...ftsResults);
  }

  // Merge and deduplicate
  const merged = this._mergeResults(results, limit, minSimilarity);

  // Enrich with observations if requested
  if (includeObservations) {
    for (const result of merged) {
      result.observations = this.memoryStore.getObservationsByOrchestration(
        result.id
      );
    }
  }

  return merged;
}
```

#### Graceful Degradation

```javascript
async initialize() {
  if (this.initializationAttempted) {
    return this.isAvailable;
  }

  this.initializationAttempted = true;

  try {
    const { ChromaClient } = require('chromadb');
    this.chromaClient = new ChromaClient({
      path: this.options.chromaHost
    });

    // Test connection
    await this.chromaClient.heartbeat();

    // Get or create collection
    this.collection = await this.chromaClient.getOrCreateCollection({
      name: this.options.collectionName,
      metadata: { description: 'Multi-agent orchestration vectors' }
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
      host: this.options.chromaHost
    });

    return false;
  }
}
```

#### Error Handling Patterns

```javascript
// Pattern 1: Lazy initialization with retry
async _ensureInitialized() {
  if (!this.initializationAttempted) {
    await this.initialize();
  }
  return this.isAvailable;
}

// Pattern 2: Batch operations with partial success
async addOrchestrationsBatch(orchestrations) {
  const results = { successful: 0, failed: 0, errors: [] };

  // Process in chunks to avoid overwhelming Chroma
  const chunks = this._chunkArray(orchestrations, this.options.batchSize);

  for (const chunk of chunks) {
    try {
      await this._addChunk(chunk);
      results.successful += chunk.length;
    } catch (error) {
      results.failed += chunk.length;
      results.errors.push({
        chunk: chunk.map(o => o.id),
        error: error.message
      });

      this.logger.warn('Batch add failed', {
        chunkSize: chunk.length,
        error: error.message
      });
    }
  }

  return results;
}

// Pattern 3: Automatic fallback on search failure
async _vectorSearch(query, limit) {
  if (!await this._ensureInitialized()) {
    throw new Error('Chroma not available');
  }

  try {
    const results = await this.collection.query({
      queryTexts: [query],
      nResults: limit
    });

    return this._transformChromaResults(results);

  } catch (error) {
    this.logger.error('Vector search failed', {
      query: query.substring(0, 50),
      error: error.message
    });

    // Mark as unavailable for future requests
    this.isAvailable = false;
    throw error;
  }
}
```

---

### 2. ContextRetriever

**Location:** `.claude/core/context-retriever.js`

**Purpose:** Intelligently retrieves and loads relevant historical context with progressive disclosure and token-aware caching.

#### Class Structure

```javascript
class ContextRetriever {
  constructor(memoryStore, vectorStore, tokenCounter, options = {}) {
    // Dependencies
    this.memoryStore = memoryStore;
    this.vectorStore = vectorStore;
    this.tokenCounter = tokenCounter;
    this.logger = createComponentLogger('ContextRetriever');

    // Configuration
    this.options = {
      maxTokens: options.maxTokens || 2000,
      minRelevanceScore: options.minRelevanceScore || 0.6,
      cacheSize: options.cacheSize || 100,
      cacheTTL: options.cacheTTL || 3600000, // 1 hour
      enableProgressive: options.enableProgressive !== false,
      layer1Limit: options.layer1Limit || 3, // Index entries
      layer2Limit: options.layer2Limit || 5, // Full details
      ...options
    };

    // LRU Cache
    this.cache = new Map();
    this.cacheAccess = new Map(); // Track access times
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
}
```

#### Public API

```javascript
/**
 * Retrieve context for a task (main entry point)
 *
 * Progressive disclosure:
 * - Layer 1: Index of relevant orchestrations (lightweight)
 * - Layer 2: Full details for top matches (on-demand)
 *
 * @param {Object} context - Current execution context
 * @param {string} context.task - Task description
 * @param {Array<string>} context.agentIds - Agent IDs
 * @param {string} context.pattern - Pattern type
 * @param {Object} options - Retrieval options
 * @param {number} [options.maxTokens] - Override max tokens
 * @param {boolean} [options.includeObservations=true] - Include observations
 * @param {boolean} [options.progressive=true] - Use progressive loading
 * @returns {Promise<Object>} Context object
 */
async retrieveContext(context, options = {})

/**
 * Load Layer 1: Index of relevant orchestrations
 * Returns lightweight index with IDs, summaries, relevance scores
 *
 * @param {string} query - Search query
 * @param {Object} filters - Search filters
 * @returns {Promise<Object>} Layer 1 context
 */
async loadLayer1(query, filters = {})

/**
 * Load Layer 2: Full details for selected orchestrations
 * Fetches complete orchestration data including observations
 *
 * @param {Array<string>} orchestrationIds - IDs to load
 * @param {number} tokenBudget - Remaining token budget
 * @returns {Promise<Object>} Layer 2 context
 */
async loadLayer2(orchestrationIds, tokenBudget)

/**
 * Get cached context (if available)
 *
 * @param {string} cacheKey - Cache key
 * @returns {Object|null} Cached context or null
 */
getCached(cacheKey)

/**
 * Store context in cache
 *
 * @param {string} cacheKey - Cache key
 * @param {Object} context - Context to cache
 * @param {number} [ttl] - Time to live (ms)
 */
setCache(cacheKey, context, ttl)

/**
 * Generate cache key from context
 *
 * @param {Object} context - Execution context
 * @returns {string} Cache key
 */
generateCacheKey(context)

/**
 * Get retriever statistics
 *
 * @returns {Object} Statistics
 */
getStats()

/**
 * Clear cache (all or specific keys)
 *
 * @param {string} [pattern] - Optional pattern to match
 */
clearCache(pattern)
```

#### Progressive Disclosure Implementation

```javascript
async retrieveContext(context, options = {}) {
  const startTime = Date.now();
  const {
    maxTokens = this.options.maxTokens,
    includeObservations = true,
    progressive = this.options.enableProgressive
  } = options;

  this.logger.debug('Retrieving context', {
    task: context.task?.substring(0, 50),
    maxTokens,
    progressive
  });

  // Check cache first
  const cacheKey = this.generateCacheKey(context);
  const cached = this.getCached(cacheKey);

  if (cached) {
    this.cacheHits++;
    this.logger.debug('Cache hit', { cacheKey });
    return cached;
  }

  this.cacheMisses++;

  try {
    let result;

    if (progressive) {
      // PROGRESSIVE DISCLOSURE STRATEGY

      // Layer 1: Load index (lightweight, ~100 tokens)
      const layer1 = await this.loadLayer1(context.task, {
        pattern: context.pattern,
        agentIds: context.agentIds,
        limit: this.options.layer1Limit
      });

      // Calculate remaining token budget
      const layer1Tokens = this.tokenCounter.countTokens(
        JSON.stringify(layer1)
      );
      const remainingTokens = maxTokens - layer1Tokens;

      // Layer 2: Load full details if budget allows (on-demand)
      let layer2 = null;
      if (remainingTokens > 500 && layer1.orchestrations.length > 0) {
        const topIds = layer1.orchestrations
          .slice(0, this.options.layer2Limit)
          .map(o => o.id);

        layer2 = await this.loadLayer2(topIds, remainingTokens);
      }

      result = {
        loaded: true,
        progressive: true,
        layer1,
        layer2,
        tokenCount: layer1Tokens + (layer2?.tokenCount || 0),
        retrievalTime: Date.now() - startTime
      };

    } else {
      // EAGER LOADING STRATEGY (backwards compatibility)
      const orchestrations = await this.vectorStore.searchSimilar(
        context.task,
        {
          limit: 5,
          pattern: context.pattern,
          includeObservations
        }
      );

      const contextData = this._formatOrchestrations(orchestrations);
      const tokenCount = this.tokenCounter.countTokens(
        JSON.stringify(contextData)
      );

      // Truncate if over budget
      if (tokenCount > maxTokens) {
        contextData.orchestrations = this._truncateToTokens(
          contextData.orchestrations,
          maxTokens
        );
      }

      result = {
        loaded: true,
        progressive: false,
        orchestrations: contextData.orchestrations,
        tokenCount: this.tokenCounter.countTokens(
          JSON.stringify(contextData)
        ),
        retrievalTime: Date.now() - startTime
      };
    }

    // Cache the result
    this.setCache(cacheKey, result);

    this.logger.info('Context retrieved', {
      progressive,
      tokenCount: result.tokenCount,
      duration: result.retrievalTime,
      cached: false
    });

    return result;

  } catch (error) {
    this.logger.error('Context retrieval failed', {
      error: error.message,
      task: context.task?.substring(0, 50)
    });

    // Return empty context on failure (graceful degradation)
    return {
      loaded: false,
      error: error.message,
      tokenCount: 0,
      retrievalTime: Date.now() - startTime
    };
  }
}
```

#### Layer 1: Index Loading

```javascript
async loadLayer1(query, filters = {}) {
  const { pattern, agentIds, limit = this.options.layer1Limit } = filters;

  // Search using vector store (hybrid search)
  const results = await this.vectorStore.searchSimilar(query, {
    limit,
    pattern,
    includeObservations: false, // Layer 1 doesn't need observations
    searchMode: 'hybrid'
  });

  // Build lightweight index
  const index = results.map(r => ({
    id: r.id,
    pattern: r.pattern,
    task: r.task.substring(0, 100) + '...', // Truncated task
    summary: r.result_summary?.substring(0, 150) + '...',
    relevance: r.similarity_score || r.relevance_score,
    agentIds: r.agent_ids,
    timestamp: r.timestamp,
    success: r.success === 1,
    tokenCount: r.token_count
  }));

  return {
    orchestrations: index,
    totalFound: results.length,
    query,
    filters
  };
}
```

#### Layer 2: Full Details Loading

```javascript
async loadLayer2(orchestrationIds, tokenBudget) {
  const orchestrations = [];
  let totalTokens = 0;

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

    if (!orch) continue;

    // Calculate token cost
    const orchTokens = this.tokenCounter.countTokens(JSON.stringify(orch));

    // Check if this single item would exceed budget
    if (totalTokens + orchTokens > tokenBudget) {
      // Try to include a truncated version
      const truncated = this._truncateOrchestration(
        orch,
        tokenBudget - totalTokens
      );

      if (truncated) {
        orchestrations.push(truncated);
        totalTokens += this.tokenCounter.countTokens(
          JSON.stringify(truncated)
        );
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
    skipped: orchestrationIds.length - orchestrations.length
  };
}
```

#### LRU Cache Implementation

```javascript
setCache(cacheKey, context, ttl) {
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
    ttl,
    cacheSize: this.cache.size
  });
}

getCached(cacheKey) {
  const entry = this.cache.get(cacheKey);

  if (!entry) return null;

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

_evictLRU() {
  // Find least recently accessed entry
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

generateCacheKey(context) {
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
```

#### Token-Aware Truncation

```javascript
_truncateOrchestration(orchestration, maxTokens) {
  // Priority order: observations > result_summary > task > metadata

  const core = {
    id: orchestration.id,
    pattern: orchestration.pattern,
    success: orchestration.success,
    timestamp: orchestration.timestamp,
    agent_ids: orchestration.agent_ids
  };

  let currentTokens = this.tokenCounter.countTokens(JSON.stringify(core));
  const remaining = maxTokens - currentTokens;

  if (remaining < 100) {
    return null; // Not enough budget even for core
  }

  const result = { ...core };

  // Add observations (most valuable)
  if (orchestration.observations && remaining > 200) {
    const { text, wasTruncated, actualTokens } =
      this.tokenCounter.truncateToTokenLimit(
        JSON.stringify(orchestration.observations),
        remaining - 100,
        '\n... [observations truncated]'
      );

    if (!wasTruncated || actualTokens > 50) {
      result.observations = JSON.parse(text);
      currentTokens += actualTokens;
    }
  }

  // Add result summary
  const summaryBudget = maxTokens - currentTokens - 50;
  if (orchestration.result_summary && summaryBudget > 50) {
    const { text } = this.tokenCounter.truncateToTokenLimit(
      orchestration.result_summary,
      summaryBudget
    );
    result.result_summary = text;
  }

  return result;
}
```

---

### 3. AICategorizationService

**Location:** `.claude/core/ai-categorizer.js`

**Purpose:** Extracts structured observations from orchestration results using AI (with rule-based fallback).

#### Class Structure

```javascript
class AICategorizationService {
  constructor(apiKey, options = {}) {
    this.logger = createComponentLogger('AICategorizationService');

    // Configuration
    this.options = {
      apiKey,
      model: options.model || 'claude-3-5-sonnet-20241022',
      maxTokens: options.maxTokens || 500,
      temperature: options.temperature || 0.3,
      timeout: options.timeout || 10000,
      fallbackToRules: options.fallbackToRules !== false,
      retries: options.retries || 2,
      ...options
    };

    // Initialize Anthropic client
    if (apiKey) {
      this._initializeClient();
    }

    // State
    this.isAvailable = !!apiKey;
    this.stats = {
      totalRequests: 0,
      successful: 0,
      failed: 0,
      fallbacks: 0,
      avgDuration: 0
    };
  }
}
```

#### Public API

```javascript
/**
 * Categorize orchestration and extract observations
 *
 * @param {Object} orchestration - Orchestration data
 * @param {string} orchestration.pattern - Pattern type
 * @param {Array<string>} orchestration.agentIds - Agent IDs
 * @param {string} orchestration.task - Task description
 * @param {string} orchestration.resultSummary - Result summary
 * @param {boolean} orchestration.success - Success status
 * @param {number} orchestration.duration - Duration in ms
 * @returns {Promise<Object>} Categorization result
 */
async categorizeOrchestration(orchestration)

/**
 * Extract observations from multiple orchestrations (batch)
 *
 * @param {Array<Object>} orchestrations - Array of orchestrations
 * @param {Object} options - Batch options
 * @param {number} [options.concurrency=3] - Concurrent requests
 * @returns {Promise<Array<Object>>} Array of categorization results
 */
async categorizeOrchestrationsBatch(orchestrations, options = {})

/**
 * Check if AI categorization is available
 *
 * @returns {boolean} Availability status
 */
isAIAvailable()

/**
 * Get categorization statistics
 *
 * @returns {Object} Statistics
 */
getStats()
```

#### AI-Powered Categorization

```javascript
async categorizeOrchestration(orchestration) {
  const startTime = Date.now();
  this.stats.totalRequests++;

  this.logger.debug('Categorizing orchestration', {
    pattern: orchestration.pattern,
    success: orchestration.success
  });

  try {
    // Try AI categorization if available
    if (this.isAvailable) {
      const result = await this._categorizeWithAI(orchestration);

      this.stats.successful++;
      this.stats.avgDuration = (
        (this.stats.avgDuration * (this.stats.successful - 1)) +
        (Date.now() - startTime)
      ) / this.stats.successful;

      this.logger.info('AI categorization complete', {
        type: result.type,
        importance: result.importance,
        duration: Date.now() - startTime
      });

      return result;
    }

    // Fall back to rules if AI not available
    throw new Error('AI not available');

  } catch (error) {
    this.logger.warn('AI categorization failed', {
      error: error.message,
      pattern: orchestration.pattern
    });

    this.stats.failed++;

    // Fallback to rule-based categorization
    if (this.options.fallbackToRules) {
      this.stats.fallbacks++;
      const result = this._categorizeWithRules(orchestration);

      this.logger.info('Rule-based categorization applied', {
        type: result.type
      });

      return result;
    }

    throw error;
  }
}

async _categorizeWithAI(orchestration) {
  const prompt = this._buildCategorizationPrompt(orchestration);

  const response = await this.anthropic.messages.create({
    model: this.options.model,
    max_tokens: this.options.maxTokens,
    temperature: this.options.temperature,
    messages: [{
      role: 'user',
      content: prompt
    }]
  });

  const content = response.content[0].text;

  // Parse AI response (expected JSON format)
  try {
    const parsed = JSON.parse(content);
    return this._validateCategorization(parsed);
  } catch (error) {
    this.logger.error('Failed to parse AI response', {
      error: error.message,
      content: content.substring(0, 200)
    });
    throw new Error('Invalid AI response format');
  }
}
```

#### AI Prompt Engineering

```javascript
_buildCategorizationPrompt(orchestration) {
  return `Analyze this multi-agent orchestration and extract key observations.

ORCHESTRATION DETAILS:
- Pattern: ${orchestration.pattern}
- Agents: ${orchestration.agentIds.join(', ')}
- Task: ${orchestration.task}
- Result: ${orchestration.resultSummary || 'No summary'}
- Success: ${orchestration.success ? 'Yes' : 'No'}
- Duration: ${orchestration.duration}ms

EXTRACT:
1. Type: decision | bugfix | feature | pattern-usage | discovery | refactor
2. Key Learning: 1-2 sentence observation (what was learned or decided)
3. Concepts: 3-5 keywords that capture the essence
4. Importance: 1-10 scale (how valuable is this observation?)
5. Agent Insights: Which agents contributed what? Any standout performance?
6. Recommendations: Guidance for similar future tasks

RESPOND WITH JSON:
{
  "type": "decision | bugfix | feature | pattern-usage | discovery | refactor",
  "observation": "1-2 sentence key learning",
  "concepts": ["keyword1", "keyword2", "keyword3"],
  "importance": 5,
  "agentInsights": {
    "agent-id": "what this agent contributed"
  },
  "recommendations": "Guidance for future tasks"
}`;
}
```

#### Rule-Based Fallback

```javascript
_categorizeWithRules(orchestration) {
  // Simple heuristic-based categorization

  let type = 'pattern-usage'; // Default
  let importance = 5;
  const concepts = [];

  // Determine type based on keywords
  const text = `${orchestration.task} ${orchestration.resultSummary}`.toLowerCase();

  if (text.includes('bug') || text.includes('fix') || text.includes('error')) {
    type = 'bugfix';
    importance = 7;
    concepts.push('debugging', 'error-resolution');
  } else if (text.includes('decide') || text.includes('choice') || text.includes('select')) {
    type = 'decision';
    importance = 6;
    concepts.push('decision-making');
  } else if (text.includes('feature') || text.includes('implement') || text.includes('add')) {
    type = 'feature';
    importance = 6;
    concepts.push('feature-development');
  } else if (text.includes('refactor') || text.includes('improve') || text.includes('optimize')) {
    type = 'refactor';
    importance = 5;
    concepts.push('code-improvement');
  } else if (text.includes('discover') || text.includes('learn') || text.includes('found')) {
    type = 'discovery';
    importance = 7;
    concepts.push('learning');
  }

  // Add pattern as concept
  concepts.push(orchestration.pattern);

  // Adjust importance based on success
  if (!orchestration.success) {
    importance = Math.max(importance - 2, 1);
    concepts.push('failure-analysis');
  }

  // Extract agent insights (basic)
  const agentInsights = {};
  orchestration.agentIds.forEach(agentId => {
    agentInsights[agentId] = `Participated in ${orchestration.pattern} pattern`;
  });

  return {
    type,
    observation: `${type} using ${orchestration.pattern} pattern: ${orchestration.task.substring(0, 100)}`,
    concepts: concepts.slice(0, 5),
    importance,
    agentInsights,
    recommendations: orchestration.success
      ? `Consider using ${orchestration.pattern} pattern for similar tasks`
      : `Review ${orchestration.pattern} pattern configuration`,
    source: 'rule-based' // Indicate this is not AI-generated
  };
}
```

#### Batch Processing with Concurrency Control

```javascript
async categorizeOrchestrationsBatch(orchestrations, options = {}) {
  const { concurrency = 3 } = options;

  this.logger.info('Starting batch categorization', {
    count: orchestrations.length,
    concurrency
  });

  const results = [];
  const queue = [...orchestrations];
  const inFlight = new Set();

  const processOne = async () => {
    if (queue.length === 0) return;

    const orchestration = queue.shift();
    const promise = this.categorizeOrchestration(orchestration)
      .then(result => ({
        orchestrationId: orchestration.id,
        success: true,
        result
      }))
      .catch(error => ({
        orchestrationId: orchestration.id,
        success: false,
        error: error.message
      }))
      .finally(() => {
        inFlight.delete(promise);
      });

    inFlight.add(promise);

    const result = await promise;
    results.push(result);

    // Continue processing
    if (queue.length > 0) {
      await processOne();
    }
  };

  // Start concurrent workers
  const workers = Array(Math.min(concurrency, orchestrations.length))
    .fill(null)
    .map(() => processOne());

  await Promise.all(workers);

  this.logger.info('Batch categorization complete', {
    total: results.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length
  });

  return results;
}
```

#### Validation & Error Handling

```javascript
_validateCategorization(categorization) {
  // Validate required fields
  const required = ['type', 'observation', 'concepts', 'importance'];

  for (const field of required) {
    if (!(field in categorization)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  // Validate type
  const validTypes = ['decision', 'bugfix', 'feature', 'pattern-usage', 'discovery', 'refactor'];
  if (!validTypes.includes(categorization.type)) {
    this.logger.warn('Invalid categorization type', {
      type: categorization.type,
      valid: validTypes
    });
    categorization.type = 'pattern-usage'; // Default
  }

  // Validate importance range
  if (categorization.importance < 1 || categorization.importance > 10) {
    categorization.importance = Math.max(1, Math.min(10, categorization.importance));
  }

  // Ensure concepts is array
  if (!Array.isArray(categorization.concepts)) {
    categorization.concepts = [];
  }

  // Ensure agentInsights is object
  if (typeof categorization.agentInsights !== 'object') {
    categorization.agentInsights = {};
  }

  return categorization;
}

_initializeClient() {
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    this.anthropic = new Anthropic({
      apiKey: this.options.apiKey,
      timeout: this.options.timeout
    });

    this.isAvailable = true;
    this.logger.info('AI categorization client initialized', {
      model: this.options.model
    });

  } catch (error) {
    this.isAvailable = false;
    this.logger.warn('Failed to initialize AI client', {
      error: error.message
    });
  }
}
```

---

## Integration Architecture

### Integration Points with Core Components

```javascript
// 1. MemoryIntegration Enhancement
// File: .claude/core/memory-integration.js

class MemoryIntegration {
  constructor(messageBus, memoryStore, options = {}) {
    // ... existing code ...

    // Initialize intelligence layer
    if (options.enableVectorStore) {
      this._initializeVectorStore();
    }

    if (options.enableContextRetrieval) {
      this._initializeContextRetriever();
    }
  }

  _initializeVectorStore() {
    const VectorStore = require('./vector-store');
    this.vectorStore = new VectorStore(this.memoryStore, {
      chromaHost: this.options.chromaHost,
      fallbackToFTS: true
    });
  }

  _initializeContextRetriever() {
    const ContextRetriever = require('./context-retriever');
    const TokenCounter = require('./token-counter');

    this.contextRetriever = new ContextRetriever(
      this.memoryStore,
      this.vectorStore,
      TokenCounter,
      {
        maxTokens: this.options.contextMaxTokens || 2000,
        enableProgressive: true
      }
    );
  }

  // Enhanced hook: Load context with progressive disclosure
  async _hookBeforeExecution(context) {
    try {
      const { task, agentIds, options } = context;

      if (options?.useMemory === false) {
        return context;
      }

      // Use ContextRetriever if available
      if (this.contextRetriever) {
        const memoryContext = await this.contextRetriever.retrieveContext({
          task,
          agentIds,
          pattern: context.pattern
        });

        return {
          ...context,
          memoryContext
        };
      }

      // Fallback to simple context loading
      return context;

    } catch (error) {
      this.logger.error('Failed to load memory context', {
        error: error.message
      });

      return {
        ...context,
        memoryContext: { loaded: false, error: error.message }
      };
    }
  }

  // Enhanced event handler: Add to vector store
  async _handleOrchestrationComplete(event) {
    try {
      // ... existing code to record in MemoryStore ...

      const orchestrationId = this.memoryStore.recordOrchestration({
        // ... data ...
      });

      // Add to vector store (async, non-blocking)
      if (this.vectorStore) {
        this.vectorStore.addOrchestration(orchestrationId, {
          task: event.task,
          resultSummary: this._summarizeResult(event.result),
          concepts: [], // Will be filled by AI categorizer
          metadata: event.metadata
        }).catch(err => {
          this.logger.warn('Failed to add to vector store', {
            error: err.message,
            orchestrationId
          });
        });
      }

      // AI categorization (async, non-blocking)
      if (this.aiCategorizer) {
        // ... existing categorization code ...
      }

    } catch (error) {
      this.logger.error('Failed to record orchestration', {
        error: error.message
      });
    }
  }
}
```

### MessageBus Event Flow

```
Orchestration Complete
         │
         ▼
┌────────────────────┐
│ MessageBus Publish │
│ orchestrator:      │
│ execution:complete │
└────────┬───────────┘
         │
         ▼
┌────────────────────────────────────────┐
│ MemoryIntegration Event Handler       │
│ _handleOrchestrationComplete()         │
│                                        │
│ 1. Record in MemoryStore (SQLite)     │
│ 2. Add to VectorStore (async)         │
│ 3. AI Categorization (async)          │
└────────┬───────────────────────────────┘
         │
         ├──────────────┬──────────────┐
         │              │              │
         ▼              ▼              ▼
    MemoryStore    VectorStore   AICategorizationService
    (SQLite)       (Chroma)      (Claude API)
         │              │              │
         │              │              └──> Extract observations
         │              │                   Record to MemoryStore
         │              │
         └──────────────┴──────────────┐
                                       │
                                       ▼
                        Next Orchestration executes
                                       │
                                       ▼
                        ┌──────────────────────────┐
                        │ beforeExecution Hook     │
                        │                          │
                        │ ContextRetriever loads:  │
                        │ - Semantic similar (Vector)│
                        │ - Keyword matches (FTS5)  │
                        │ - Progressive disclosure  │
                        └──────────────────────────┘
```

### Dependency Injection Pattern

```javascript
// Initialize the complete memory system with intelligence layer

const MessageBus = require('./message-bus');
const MemoryStore = require('./memory-store');
const VectorStore = require('./vector-store');
const ContextRetriever = require('./context-retriever');
const AICategorizationService = require('./ai-categorizer');
const MemoryIntegration = require('./memory-integration');
const TokenCounter = require('./token-counter');

// 1. Create core components
const messageBus = new MessageBus();
const memoryStore = new MemoryStore('.claude/memory/orchestrations.db');

// 2. Create intelligence layer components
const vectorStore = new VectorStore(memoryStore, {
  chromaHost: 'http://localhost:8000',
  fallbackToFTS: true
});

const contextRetriever = new ContextRetriever(
  memoryStore,
  vectorStore,
  TokenCounter,
  {
    maxTokens: 2000,
    enableProgressive: true,
    cacheSize: 100
  }
);

const aiCategorizer = process.env.ANTHROPIC_API_KEY
  ? new AICategorizationService(process.env.ANTHROPIC_API_KEY, {
      model: 'claude-3-5-sonnet-20241022',
      fallbackToRules: true
    })
  : null;

// 3. Create memory integration
const memoryIntegration = new MemoryIntegration(
  messageBus,
  memoryStore,
  {
    enableAI: !!aiCategorizer,
    aiApiKey: process.env.ANTHROPIC_API_KEY,
    vectorStore,
    contextRetriever,
    aiCategorizer
  }
);

// 4. Create orchestrator with memory
const AgentOrchestrator = require('./agent-orchestrator');
const orchestrator = new AgentOrchestrator(messageBus, {
  enableMemory: true,
  dbPath: '.claude/memory/orchestrations.db',
  enableAI: !!aiCategorizer,
  aiApiKey: process.env.ANTHROPIC_API_KEY
});

// All components are wired together and ready to use!
```

---

## Error Handling & Graceful Degradation

### Degradation Matrix

| Component | Failure Mode | Detection | Fallback Strategy | User Impact |
|-----------|-------------|-----------|-------------------|-------------|
| **VectorStore** | Chroma unreachable | Connection timeout | Use FTS5-only search | Slightly less relevant results |
| **VectorStore** | Embedding fails | API error | Skip vector, use FTS5 | No semantic similarity |
| **VectorStore** | Batch insert fails | Write error | Log and continue | Some orchestrations not vectorized |
| **ContextRetriever** | Retrieval fails | Exception | Return empty context | No historical context |
| **ContextRetriever** | Cache full | Size limit | Evict LRU entries | Higher retrieval latency |
| **ContextRetriever** | Token budget exceeded | Count check | Truncate intelligently | Less context provided |
| **AICategorizationService** | API fails | Network/API error | Rule-based categorization | Less accurate observations |
| **AICategorizationService** | Quota exceeded | Rate limit | Queue for later | Delayed observation extraction |
| **AICategorizationService** | Parse error | Invalid JSON | Use default values | Lower quality categorization |

### Error Handling Patterns

```javascript
// Pattern 1: Try-Fallback-Log
async searchSimilar(query, options) {
  try {
    // Try primary strategy (vector + FTS)
    return await this._hybridSearch(query, options);
  } catch (error) {
    this.logger.warn('Hybrid search failed, using FTS only', {
      error: error.message
    });

    // Fallback strategy
    try {
      return await this._ftsSearch(query, options);
    } catch (fallbackError) {
      this.logger.error('All search strategies failed', {
        primary: error.message,
        fallback: fallbackError.message
      });

      // Last resort: return empty
      return [];
    }
  }
}

// Pattern 2: Circuit Breaker
class VectorStore {
  constructor(memoryStore, options) {
    // ...
    this.circuitBreaker = {
      failures: 0,
      threshold: 5,
      resetTime: 60000, // 1 minute
      lastFailure: null,
      isOpen: false
    };
  }

  async _callChroma(operation) {
    // Check if circuit is open
    if (this.circuitBreaker.isOpen) {
      const timeSinceLastFailure = Date.now() - this.circuitBreaker.lastFailure;

      if (timeSinceLastFailure < this.circuitBreaker.resetTime) {
        throw new Error('Circuit breaker open - Chroma unavailable');
      }

      // Reset circuit
      this.circuitBreaker.isOpen = false;
      this.circuitBreaker.failures = 0;
    }

    try {
      const result = await operation();
      return result;
    } catch (error) {
      this.circuitBreaker.failures++;
      this.circuitBreaker.lastFailure = Date.now();

      if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
        this.circuitBreaker.isOpen = true;
        this.logger.error('Circuit breaker opened', {
          failures: this.circuitBreaker.failures
        });
      }

      throw error;
    }
  }
}

// Pattern 3: Partial Success
async categorizeOrchestrationsBatch(orchestrations, options) {
  const results = {
    successful: [],
    failed: [],
    partialSuccess: true
  };

  for (const orch of orchestrations) {
    try {
      const categorization = await this.categorizeOrchestration(orch);
      results.successful.push({ id: orch.id, categorization });
    } catch (error) {
      results.failed.push({ id: orch.id, error: error.message });

      this.logger.warn('Categorization failed for orchestration', {
        id: orch.id,
        error: error.message
      });
    }
  }

  // Log summary
  this.logger.info('Batch categorization complete', {
    total: orchestrations.length,
    successful: results.successful.length,
    failed: results.failed.length
  });

  return results;
}
```

---

## Testing Strategy

### Unit Tests

```javascript
// test/vector-store.test.js

describe('VectorStore', () => {
  describe('Graceful Degradation', () => {
    it('should fall back to FTS when Chroma unavailable', async () => {
      const store = new VectorStore(memoryStore, {
        chromaHost: 'http://localhost:9999', // Invalid
        fallbackToFTS: true
      });

      const results = await store.searchSimilar('test query');

      expect(results).toBeDefined();
      expect(store.isChromaAvailable()).toBe(false);
    });

    it('should handle batch insert failures gracefully', async () => {
      const store = new VectorStore(memoryStore);
      const orchestrations = generateTestOrchestrations(20);

      // Mock Chroma to fail on specific items
      jest.spyOn(store.collection, 'add')
        .mockImplementation(() => {
          throw new Error('Chroma write failed');
        });

      const result = await store.addOrchestrationsBatch(orchestrations);

      expect(result.failed).toBeGreaterThan(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Hybrid Search', () => {
    it('should combine vector and FTS results', async () => {
      const store = new VectorStore(memoryStore);
      await store.initialize();

      const results = await store.searchSimilar('parallel execution', {
        searchMode: 'hybrid',
        limit: 5
      });

      expect(results.length).toBeLessThanOrEqual(5);
      results.forEach(r => {
        expect(r).toHaveProperty('similarity_score');
        expect(r).toHaveProperty('relevance_score');
      });
    });
  });
});

// test/context-retriever.test.js

describe('ContextRetriever', () => {
  describe('Progressive Disclosure', () => {
    it('should load Layer 1 index first', async () => {
      const retriever = new ContextRetriever(
        memoryStore,
        vectorStore,
        TokenCounter,
        { enableProgressive: true }
      );

      const context = await retriever.retrieveContext({
        task: 'implement new feature',
        agentIds: ['agent-1'],
        pattern: 'parallel'
      });

      expect(context.progressive).toBe(true);
      expect(context.layer1).toBeDefined();
      expect(context.layer1.orchestrations).toBeDefined();
    });

    it('should respect token budget', async () => {
      const retriever = new ContextRetriever(
        memoryStore,
        vectorStore,
        TokenCounter,
        { maxTokens: 500 }
      );

      const context = await retriever.retrieveContext({
        task: 'test task',
        agentIds: [],
        pattern: 'parallel'
      }, { maxTokens: 500 });

      expect(context.tokenCount).toBeLessThanOrEqual(500);
    });
  });

  describe('LRU Cache', () => {
    it('should cache retrieved contexts', async () => {
      const retriever = new ContextRetriever(
        memoryStore,
        vectorStore,
        TokenCounter,
        { cacheSize: 10 }
      );

      const context1 = await retriever.retrieveContext({
        task: 'same task',
        agentIds: [],
        pattern: 'parallel'
      });

      const context2 = await retriever.retrieveContext({
        task: 'same task',
        agentIds: [],
        pattern: 'parallel'
      });

      expect(retriever.cacheHits).toBe(1);
      expect(context1).toEqual(context2);
    });

    it('should evict LRU entries when cache full', async () => {
      const retriever = new ContextRetriever(
        memoryStore,
        vectorStore,
        TokenCounter,
        { cacheSize: 2 }
      );

      // Fill cache
      await retriever.retrieveContext({ task: 'task1', agentIds: [], pattern: 'parallel' });
      await retriever.retrieveContext({ task: 'task2', agentIds: [], pattern: 'parallel' });

      // This should evict task1
      await retriever.retrieveContext({ task: 'task3', agentIds: [], pattern: 'parallel' });

      expect(retriever.cache.size).toBe(2);
    });
  });
});

// test/ai-categorizer.test.js

describe('AICategorizationService', () => {
  describe('AI Categorization', () => {
    it('should extract observations using AI', async () => {
      const categorizer = new AICategorizationService(
        process.env.TEST_API_KEY,
        { model: 'claude-3-5-sonnet-20241022' }
      );

      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        agentIds: ['agent-1', 'agent-2'],
        task: 'implement authentication',
        resultSummary: 'Successfully implemented JWT authentication',
        success: true,
        duration: 5000
      });

      expect(result.type).toBeDefined();
      expect(['decision', 'bugfix', 'feature', 'pattern-usage', 'discovery', 'refactor'])
        .toContain(result.type);
      expect(result.observation).toBeDefined();
      expect(result.concepts).toBeInstanceOf(Array);
      expect(result.importance).toBeGreaterThanOrEqual(1);
      expect(result.importance).toBeLessThanOrEqual(10);
    });
  });

  describe('Rule-Based Fallback', () => {
    it('should fall back to rules when AI unavailable', async () => {
      const categorizer = new AICategorizationService(null, {
        fallbackToRules: true
      });

      const result = await categorizer.categorizeOrchestration({
        pattern: 'consensus',
        agentIds: ['agent-1', 'agent-2'],
        task: 'fix bug in authentication',
        resultSummary: 'Bug fixed',
        success: true,
        duration: 3000
      });

      expect(result.type).toBe('bugfix');
      expect(result.source).toBe('rule-based');
      expect(result.concepts).toContain('debugging');
    });
  });

  describe('Batch Processing', () => {
    it('should process multiple orchestrations with concurrency control', async () => {
      const categorizer = new AICategorizationService(
        process.env.TEST_API_KEY
      );

      const orchestrations = generateTestOrchestrations(10);

      const results = await categorizer.categorizeOrchestrationsBatch(
        orchestrations,
        { concurrency: 3 }
      );

      expect(results.length).toBe(10);

      const successful = results.filter(r => r.success);
      expect(successful.length).toBeGreaterThan(0);
    });
  });
});
```

### Integration Tests

```javascript
// test/integration/memory-intelligence.test.js

describe('Memory Intelligence Integration', () => {
  let orchestrator;
  let memoryIntegration;

  beforeAll(async () => {
    // Set up complete system
    const messageBus = new MessageBus();
    const memoryStore = new MemoryStore(':memory:'); // In-memory for tests

    const vectorStore = new VectorStore(memoryStore, {
      chromaHost: 'http://localhost:8000',
      fallbackToFTS: true
    });

    const contextRetriever = new ContextRetriever(
      memoryStore,
      vectorStore,
      TokenCounter
    );

    memoryIntegration = new MemoryIntegration(
      messageBus,
      memoryStore,
      {
        vectorStore,
        contextRetriever,
        enableAI: true,
        aiApiKey: process.env.TEST_API_KEY
      }
    );

    orchestrator = new AgentOrchestrator(messageBus, {
      enableMemory: true,
      memoryIntegration
    });
  });

  it('should complete full orchestration->memory->retrieval cycle', async () => {
    // 1. Execute orchestration
    const result = await orchestrator.executeParallel(
      ['agent-1', 'agent-2'],
      { task: 'implement feature X' }
    );

    expect(result.success).toBe(true);

    // 2. Wait for async processing
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 3. Execute another orchestration - should get context
    const result2 = await orchestrator.executeParallel(
      ['agent-1'],
      { task: 'implement feature Y' }
    );

    expect(result2.metadata.contextLoaded).toBe(true);

    // 4. Verify context was relevant
    // (This would check that the loaded context is actually useful)
  });
});
```

### Edge Cases to Test

1. **VectorStore Edge Cases**
   - Chroma connection loss mid-operation
   - Invalid embedding dimensions
   - Duplicate orchestration IDs
   - Very large batch inserts (>1000 items)
   - Concurrent read/write operations
   - Empty search results

2. **ContextRetriever Edge Cases**
   - Zero token budget
   - Extremely large orchestrations (>10k tokens each)
   - Cache key collisions
   - Expired cache entries during retrieval
   - No relevant historical context found
   - Layer 2 loading timeout

3. **AICategorizationService Edge Cases**
   - API rate limiting
   - Malformed AI responses
   - API timeout during batch processing
   - Partial batch failures
   - Invalid orchestration data
   - Quota exhaustion

---

## Performance Considerations

### Optimization Strategies

1. **VectorStore Optimizations**

```javascript
// Batch embedding generation
async _generateEmbeddings(texts) {
  // Group into optimal batch size for API
  const batchSize = 32; // Typical embedding API limit
  const batches = this._chunkArray(texts, batchSize);

  const allEmbeddings = [];

  for (const batch of batches) {
    const embeddings = await this._callEmbeddingAPI(batch);
    allEmbeddings.push(...embeddings);
  }

  return allEmbeddings;
}

// Lazy initialization with connection pooling
async _ensureInitialized() {
  if (this.initializationPromise) {
    return this.initializationPromise;
  }

  this.initializationPromise = this.initialize();
  return this.initializationPromise;
}
```

2. **ContextRetriever Optimizations**

```javascript
// Parallel loading of Layer 1 and Layer 2
async retrieveContextOptimized(context, options) {
  const layer1Promise = this.loadLayer1(context.task, filters);

  // Start Layer 2 load while Layer 1 is still processing
  const layer1 = await layer1Promise;

  const topIds = layer1.orchestrations
    .slice(0, this.options.layer2Limit)
    .map(o => o.id);

  const layer2 = await this.loadLayer2(topIds, remainingTokens);

  return { layer1, layer2 };
}

// Prefetch popular contexts
async prefetchPopularContexts() {
  const popular = await this.memoryStore.db.prepare(`
    SELECT task, COUNT(*) as count
    FROM orchestrations
    WHERE success = 1
    GROUP BY task
    ORDER BY count DESC
    LIMIT 10
  `).all();

  for (const { task } of popular) {
    await this.retrieveContext({ task, agentIds: [], pattern: 'parallel' });
  }
}
```

3. **AICategorizationService Optimizations**

```javascript
// Request batching with debounce
class AICategorizationService {
  constructor(apiKey, options) {
    // ...
    this.requestQueue = [];
    this.batchInterval = options.batchInterval || 1000;
    this.maxBatchSize = options.maxBatchSize || 5;

    this._startBatchProcessor();
  }

  _startBatchProcessor() {
    setInterval(async () => {
      if (this.requestQueue.length === 0) return;

      const batch = this.requestQueue.splice(0, this.maxBatchSize);

      // Process batch in parallel
      await Promise.allSettled(
        batch.map(({ orchestration, resolve, reject }) =>
          this.categorizeOrchestration(orchestration)
            .then(resolve)
            .catch(reject)
        )
      );
    }, this.batchInterval);
  }

  async categorizeOrchestration(orchestration) {
    // Add to queue instead of immediate processing
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ orchestration, resolve, reject });
    });
  }
}
```

### Performance Benchmarks

Target performance metrics:

| Operation | Target Latency | Max Latency | Throughput |
|-----------|----------------|-------------|------------|
| VectorStore.searchSimilar() | <100ms | <500ms | 100 req/s |
| ContextRetriever.retrieveContext() | <200ms | <1s | 50 req/s |
| AICategorizationService.categorize() | <2s | <5s | 10 req/s |
| Full orchestration with context | <300ms overhead | <1.5s | 30 req/s |

### Memory Management

```javascript
// Automatic cleanup of old cache entries
class ContextRetriever {
  constructor(memoryStore, vectorStore, tokenCounter, options) {
    // ...

    // Periodic cache cleanup
    setInterval(() => this._cleanupExpiredCache(), 300000); // 5 minutes
  }

  _cleanupExpiredCache() {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        this.cacheAccess.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.debug('Expired cache entries cleaned up', {
        removed,
        remaining: this.cache.size
      });
    }
  }
}

// Connection pooling for Chroma
class VectorStore {
  constructor(memoryStore, options) {
    // ...
    this.connectionPool = {
      maxConnections: options.maxConnections || 5,
      activeConnections: 0,
      queue: []
    };
  }

  async _acquireConnection() {
    if (this.connectionPool.activeConnections < this.connectionPool.maxConnections) {
      this.connectionPool.activeConnections++;
      return true;
    }

    // Wait for available connection
    return new Promise(resolve => {
      this.connectionPool.queue.push(resolve);
    });
  }

  _releaseConnection() {
    this.connectionPool.activeConnections--;

    if (this.connectionPool.queue.length > 0) {
      const next = this.connectionPool.queue.shift();
      this.connectionPool.activeConnections++;
      next(true);
    }
  }
}
```

---

## Implementation Roadmap

### Phase 1: VectorStore (2-3 days)

**Deliverables:**
1. VectorStore class with Chroma integration
2. Hybrid search implementation
3. Graceful fallback to FTS5
4. Unit tests
5. Integration with MemoryStore

**Acceptance Criteria:**
- [ ] Chroma connection with lazy initialization
- [ ] Add/batch add orchestrations to vector DB
- [ ] Hybrid search (vector + FTS5) working
- [ ] Automatic fallback on Chroma failure
- [ ] 90%+ test coverage
- [ ] Performance: <100ms average search latency

### Phase 2: ContextRetriever (2-3 days)

**Deliverables:**
1. ContextRetriever class
2. Progressive disclosure (Layer 1 + Layer 2)
3. LRU caching implementation
4. Token-aware loading
5. Unit tests

**Acceptance Criteria:**
- [ ] Progressive context loading working
- [ ] Token budget respected
- [ ] LRU cache with eviction
- [ ] Integration with VectorStore and MemoryStore
- [ ] 90%+ test coverage
- [ ] Performance: <200ms average retrieval latency

### Phase 3: AICategorizationService (2-3 days)

**Deliverables:**
1. AICategorizationService class
2. Claude API integration
3. Rule-based fallback
4. Batch processing with concurrency control
5. Unit tests

**Acceptance Criteria:**
- [ ] AI-powered observation extraction working
- [ ] Rule-based fallback on AI failure
- [ ] Batch processing with concurrency limits
- [ ] Proper error handling and retry logic
- [ ] 85%+ test coverage
- [ ] Performance: <2s average categorization latency

### Phase 4: Integration & Testing (2 days)

**Deliverables:**
1. MemoryIntegration enhancements
2. End-to-end integration tests
3. Performance benchmarking
4. Documentation updates

**Acceptance Criteria:**
- [ ] Full orchestration->memory->retrieval cycle working
- [ ] All components gracefully degrade
- [ ] Integration tests passing
- [ ] Performance benchmarks met
- [ ] Documentation complete

### Total Estimated Time: 8-11 days

---

## Appendix: Key Architectural Decisions

### Decision 1: Hybrid Search Architecture

**Context:** Need both semantic similarity (vector) and keyword matching (FTS5)

**Options Considered:**
1. Vector-only search
2. FTS5-only search
3. Hybrid with vector priority
4. Hybrid with configurable weighting

**Decision:** Hybrid with automatic fallback (Option 3)

**Rationale:**
- Provides best of both worlds: semantic + keyword
- Graceful degradation if Chroma unavailable
- Simple merging algorithm (score-based)
- Configurable via searchMode parameter

### Decision 2: Progressive Disclosure

**Context:** Token budgets are limited, full context loading is expensive

**Options Considered:**
1. Always load full context
2. Load index only
3. Progressive (index + on-demand details)
4. Streaming context loading

**Decision:** Progressive disclosure (Option 3)

**Rationale:**
- Optimal token efficiency
- Flexible: can skip Layer 2 if budget tight
- Backwards compatible (can disable progressive mode)
- Reduces latency for simple queries

### Decision 3: AI Categorization Strategy

**Context:** Want AI-powered insights but need fallback for reliability

**Options Considered:**
1. AI-only categorization
2. Rule-based only
3. AI with rule-based fallback
4. Hybrid (AI + rules combined)

**Decision:** AI with rule-based fallback (Option 3)

**Rationale:**
- Best quality when AI available
- Reliable fallback ensures system works without API key
- Rule-based is "good enough" for basic categorization
- Can always improve rules based on AI output patterns

### Decision 4: Async vs Sync Operations

**Context:** AI categorization and vector insertion are slow

**Options Considered:**
1. Synchronous (block orchestration completion)
2. Fully asynchronous (fire-and-forget)
3. Hybrid (sync critical path, async optional)
4. Background job queue

**Decision:** Hybrid approach (Option 3)

**Rationale:**
- Hooks ensure critical operations complete (context loading)
- Events allow async processing (categorization, vectorization)
- No additional infrastructure needed (job queues)
- Matches existing LifecycleHooks + MessageBus architecture

---

**End of Architecture Design Document**

This design is ready for implementation by the Senior Developer agent. All components follow established patterns from the core architecture, include comprehensive error handling, and maintain the framework's commitment to graceful degradation.

