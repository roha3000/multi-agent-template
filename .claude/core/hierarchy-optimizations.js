/**
 * Hierarchy Optimizations Module
 *
 * Performance optimizations for hierarchical agent delegation:
 * - Agent Pooling: Pre-warmed agent pool for fast checkout
 * - Tiered Timeouts: Depth-based timeout configuration
 * - Context Caching: Parent-level caching for shared context
 * - Speculative Execution: Early child spawning (foundation)
 *
 * @module hierarchy-optimizations
 */

const EventEmitter = require('events');

// ============================================================================
// TIERED TIMEOUT CONFIGURATION
// ============================================================================

const DEFAULT_TIMEOUT_TIERS = {
  0: { timeout: 60000, label: 'root' },
  1: { timeout: 60000, label: 'primary' },
  2: { timeout: 30000, label: 'secondary' },
  3: { timeout: 15000, label: 'tertiary' },
  default: { timeout: 10000, label: 'deep' }
};

const DEFAULT_TIMEOUT_CONFIG = {
  tiers: DEFAULT_TIMEOUT_TIERS,
  inheritance: {
    enabled: true,
    reductionFactor: 0.5,
    minTimeout: 10000,
    aggregationBufferRatio: 0.1,
    aggregationBufferMin: 5000
  },
  gracePeriod: {
    enabled: true,
    partialCompletionThreshold: 0.7,
    baseGracePeriod: 5000,
    gracePeriodByDepth: {
      0: 10000,
      1: 8000,
      2: 5000,
      3: 3000,
      default: 2000
    },
    maxGraceExtensions: 1
  }
};

/**
 * TieredTimeoutCalculator - Calculates timeouts based on delegation depth
 */
class TieredTimeoutCalculator {
  constructor(config = {}) {
    this.config = { ...DEFAULT_TIMEOUT_CONFIG, ...config };
  }

  /**
   * Calculate timeout for a delegation at given depth
   * @param {number} depth - Delegation depth (0 = root)
   * @param {Object} options - Additional options
   * @returns {Object} Timeout configuration
   */
  calculateTimeout(depth, options = {}) {
    const { parentRemainingTime, isParallel, siblingCount } = options;

    // Get base tier timeout
    const tierConfig = this.config.tiers[depth] || this.config.tiers.default;
    let timeout = tierConfig.timeout;

    // Apply inheritance if parent time is constraining
    if (parentRemainingTime !== undefined && this.config.inheritance.enabled) {
      const buffer = this._calculateAggregationBuffer(parentRemainingTime);
      const inheritedTimeout = parentRemainingTime - buffer;
      timeout = Math.min(timeout, inheritedTimeout);
    }

    // Ensure minimum timeout
    timeout = Math.max(timeout, this.config.inheritance.minTimeout);

    return {
      timeout,
      tier: depth <= 3 ? depth : 'deep',
      tierLabel: tierConfig.label,
      inherited: parentRemainingTime !== undefined && timeout < tierConfig.timeout
    };
  }

  /**
   * Calculate grace period for a depth
   * @param {number} depth - Delegation depth
   * @returns {Object} Grace period configuration
   */
  calculateGracePeriod(depth) {
    if (!this.config.gracePeriod.enabled) {
      return { enabled: false, duration: 0 };
    }

    const duration = this.config.gracePeriod.gracePeriodByDepth[depth]
      || this.config.gracePeriod.gracePeriodByDepth.default;

    return {
      enabled: true,
      duration,
      partialThreshold: this.config.gracePeriod.partialCompletionThreshold
    };
  }

  /**
   * Calculate deadline from timeout
   * @param {number} timeout - Timeout in milliseconds
   * @param {number} startTime - Start timestamp
   * @returns {Date} Deadline
   */
  calculateDeadline(timeout, startTime = Date.now()) {
    return new Date(startTime + timeout);
  }

  _calculateAggregationBuffer(remainingTime) {
    const { aggregationBufferRatio, aggregationBufferMin } = this.config.inheritance;
    return Math.max(aggregationBufferMin, remainingTime * aggregationBufferRatio);
  }

  /**
   * Get configuration
   * @returns {Object} Current configuration
   */
  getConfig() {
    return { ...this.config };
  }
}

// ============================================================================
// CONTEXT CACHE
// ============================================================================

const DEFAULT_CACHE_CONFIG = {
  maxMemoryBytes: 50 * 1024 * 1024, // 50MB
  maxEntries: 1000,
  defaultTTL: 300000, // 5 minutes
  tokenBudget: 100000,
  evictionPolicy: 'lru-ttl'
};

/**
 * ContextCache - Parent-level context caching for shared sub-agent context
 */
class ContextCache extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };

    // Core storage
    this._entries = new Map();
    this._accessOrder = []; // For LRU tracking
    this._sizeTracker = 0;
    this._tokenTracker = 0;

    // Indexes
    this._byContextType = new Map();
    this._byParentAgent = new Map();
    this._byHash = new Map();
    this._shareableMarkers = new Set();

    // Metrics
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
  }

  /**
   * Get entry from cache
   * @param {string} key - Cache key
   * @returns {Object|null} Cache entry or null
   */
  get(key) {
    const entry = this._entries.get(key);

    if (!entry) {
      this._misses++;
      return null;
    }

    // Check TTL expiration
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      this._misses++;
      return null;
    }

    // Update LRU order
    this._updateAccessOrder(key);
    entry.lastAccessedAt = Date.now();
    entry.accessCount++;

    this._hits++;
    return entry;
  }

  /**
   * Set entry in cache
   * @param {string} key - Cache key
   * @param {Object} value - Value to cache
   * @param {Object} options - Cache options
   * @returns {boolean} Success status
   */
  set(key, value, options = {}) {
    const {
      contextType = 'generic',
      ownerAgentId = null,
      ttl = this.config.defaultTTL,
      shareable = false,
      shareableWith = [],
      priority = 5,
      sourcePath = null,
      phase = null
    } = options;

    // Calculate sizes
    const serialized = JSON.stringify(value);
    const byteSize = Buffer.byteLength(serialized, 'utf8');
    const tokenCount = Math.ceil(serialized.length / 4); // Rough estimate

    // Check limits and evict if needed
    if (!this._ensureSpace(byteSize, tokenCount)) {
      return false;
    }

    const contentHash = this._hashContent(serialized);
    const now = Date.now();

    const entry = {
      key,
      contextType,
      contentHash,
      content: value,
      byteSize,
      tokenCount,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 1,
      expiresAt: now + ttl,
      ownerAgentId,
      shareableWith: shareable ? (shareableWith.length ? shareableWith : ['*']) : [],
      isShareable: shareable,
      sourcePath,
      phase,
      priority
    };

    // Remove old entry if exists
    if (this._entries.has(key)) {
      this.delete(key);
    }

    // Store entry
    this._entries.set(key, entry);
    this._sizeTracker += byteSize;
    this._tokenTracker += tokenCount;

    // Update indexes
    this._addToIndex(this._byContextType, contextType, key);
    if (ownerAgentId) {
      this._addToIndex(this._byParentAgent, ownerAgentId, key);
    }
    this._byHash.set(contentHash, key);
    if (shareable) {
      this._shareableMarkers.add(key);
    }

    // Update LRU
    this._accessOrder.push(key);

    this.emit('cache:set', { key, contextType, byteSize, tokenCount });
    return true;
  }

  /**
   * Check if key exists
   * @param {string} key - Cache key
   * @returns {boolean} Exists status
   */
  has(key) {
    const entry = this._entries.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Delete entry from cache
   * @param {string} key - Cache key
   * @returns {boolean} Success status
   */
  delete(key) {
    const entry = this._entries.get(key);
    if (!entry) return false;

    // Update trackers
    this._sizeTracker -= entry.byteSize;
    this._tokenTracker -= entry.tokenCount;

    // Remove from indexes
    this._removeFromIndex(this._byContextType, entry.contextType, key);
    if (entry.ownerAgentId) {
      this._removeFromIndex(this._byParentAgent, entry.ownerAgentId, key);
    }
    this._byHash.delete(entry.contentHash);
    this._shareableMarkers.delete(key);

    // Remove from LRU
    const idx = this._accessOrder.indexOf(key);
    if (idx > -1) {
      this._accessOrder.splice(idx, 1);
    }

    this._entries.delete(key);
    this.emit('cache:delete', { key });
    return true;
  }

  /**
   * Get shareable entries for an agent
   * @param {string} parentAgentId - Parent agent ID
   * @returns {Array} Shareable entries
   */
  getShareable(parentAgentId) {
    const entries = [];
    for (const key of this._shareableMarkers) {
      const entry = this._entries.get(key);
      if (entry && !this._isExpired(entry)) {
        if (entry.shareableWith.includes('*') || entry.shareableWith.includes(parentAgentId)) {
          entries.push(entry);
        }
      }
    }
    return entries;
  }

  /**
   * Mark entry as shareable
   * @param {string} key - Cache key
   */
  markShareable(key) {
    const entry = this._entries.get(key);
    if (entry) {
      entry.isShareable = true;
      if (!entry.shareableWith.length) {
        entry.shareableWith = ['*'];
      }
      this._shareableMarkers.add(key);
    }
  }

  /**
   * Invalidate entries by pattern
   * @param {Object} options - Invalidation options
   * @returns {number} Number of invalidated entries
   */
  invalidate(options = {}) {
    const { contextType, agentId, pattern } = options;
    let count = 0;

    if (contextType) {
      const keys = this._byContextType.get(contextType) || new Set();
      for (const key of keys) {
        if (this.delete(key)) count++;
      }
    }

    if (agentId) {
      const keys = this._byParentAgent.get(agentId) || new Set();
      for (const key of keys) {
        if (this.delete(key)) count++;
      }
    }

    if (pattern) {
      for (const key of this._entries.keys()) {
        if (key.includes(pattern)) {
          if (this.delete(key)) count++;
        }
      }
    }

    return count;
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getStats() {
    return {
      entries: this._entries.size,
      memoryUsed: this._sizeTracker,
      memoryLimit: this.config.maxMemoryBytes,
      memoryPercent: (this._sizeTracker / this.config.maxMemoryBytes) * 100,
      tokensUsed: this._tokenTracker,
      tokenLimit: this.config.tokenBudget,
      hits: this._hits,
      misses: this._misses,
      hitRate: this._hits + this._misses > 0
        ? (this._hits / (this._hits + this._misses)) * 100
        : 0,
      evictions: this._evictions,
      shareableCount: this._shareableMarkers.size
    };
  }

  /**
   * Clear all entries
   */
  clear() {
    this._entries.clear();
    this._accessOrder = [];
    this._sizeTracker = 0;
    this._tokenTracker = 0;
    this._byContextType.clear();
    this._byParentAgent.clear();
    this._byHash.clear();
    this._shareableMarkers.clear();
    this.emit('cache:clear');
  }

  // Private methods

  _ensureSpace(neededBytes, neededTokens) {
    // First evict expired entries
    this._evictExpired();

    // Then evict LRU entries if still over limit
    while (
      (this._sizeTracker + neededBytes > this.config.maxMemoryBytes ||
       this._tokenTracker + neededTokens > this.config.tokenBudget ||
       this._entries.size >= this.config.maxEntries) &&
      this._accessOrder.length > 0
    ) {
      const lruKey = this._accessOrder[0];
      this.delete(lruKey);
      this._evictions++;
    }

    return this._sizeTracker + neededBytes <= this.config.maxMemoryBytes &&
           this._tokenTracker + neededTokens <= this.config.tokenBudget &&
           this._entries.size < this.config.maxEntries;
  }

  _evictExpired() {
    const now = Date.now();
    for (const [key, entry] of this._entries) {
      if (now > entry.expiresAt) {
        this.delete(key);
        this._evictions++;
      }
    }
  }

  _updateAccessOrder(key) {
    const idx = this._accessOrder.indexOf(key);
    if (idx > -1) {
      this._accessOrder.splice(idx, 1);
    }
    this._accessOrder.push(key);
  }

  _addToIndex(index, indexKey, cacheKey) {
    if (!index.has(indexKey)) {
      index.set(indexKey, new Set());
    }
    index.get(indexKey).add(cacheKey);
  }

  _removeFromIndex(index, indexKey, cacheKey) {
    const set = index.get(indexKey);
    if (set) {
      set.delete(cacheKey);
      if (set.size === 0) {
        index.delete(indexKey);
      }
    }
  }

  _hashContent(content) {
    // Simple hash for deduplication
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `hash-${Math.abs(hash).toString(36)}`;
  }

  _isExpired(entry) {
    return Date.now() > entry.expiresAt;
  }
}

// ============================================================================
// AGENT POOL
// ============================================================================

const DEFAULT_POOL_CONFIG = {
  minPoolSize: 2,
  maxPoolSize: 10,
  warmupInterval: 30000,
  idleTimeout: 300000,
  checkoutTimeout: 10000,
  recycleAfterUses: 50,
  recycleOnError: true,
  maxAgentAge: 3600000,
  warmupBatchSize: 3
};

/**
 * AgentPool - Pre-warmed agent pool for fast checkout
 */
class AgentPool extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };

    // Pool storage
    this._pool = new Map(); // agentId -> PooledAgent
    this._idleQueue = []; // Array of idle agent IDs (FIFO)
    this._inUseSet = new Set(); // Set of in-use agent IDs
    this._recyclingSet = new Set(); // Set of recycling agent IDs
    this._waitQueue = []; // Pending checkout requests

    // State
    this._initialized = false;
    this._closed = false;
    this._warmupTimer = null;
    this._cleanupTimer = null;

    // Metrics
    this._checkouts = 0;
    this._checkins = 0;
    this._recycled = 0;
    this._created = 0;
    this._disposed = 0;
    this._timeouts = 0;
  }

  /**
   * Initialize the pool with minimum agents
   * @param {Function} agentFactory - Factory function to create agents
   */
  async initialize(agentFactory) {
    if (this._initialized) return;

    this._agentFactory = agentFactory;

    // Create minimum pool size
    await this.warmup(this.config.minPoolSize);

    // Start warmup timer
    this._warmupTimer = setInterval(() => {
      this._checkWarmup();
    }, this.config.warmupInterval);

    // Start cleanup timer
    this._cleanupTimer = setInterval(() => {
      this._cleanupExpired();
    }, 60000); // Check every minute

    this._initialized = true;
    this.emit('pool:initialized', { size: this._pool.size });
  }

  /**
   * Checkout an agent from the pool
   * @param {Object} criteria - Agent selection criteria
   * @returns {Promise<Object>} Pooled agent
   */
  async checkout(criteria = {}) {
    if (!this._initialized || this._closed) {
      throw new Error('Pool not initialized or closed');
    }

    // Try to get from idle queue
    const agentId = this._findAvailable(criteria);

    if (agentId) {
      const agent = this._pool.get(agentId);
      this._moveToInUse(agentId);
      this._checkouts++;
      this.emit('pool:checkout', { agentId, fromPool: true });
      return agent;
    }

    // If pool has room, create new agent
    if (this._pool.size < this.config.maxPoolSize) {
      const agent = await this._createAgent(criteria);
      this._inUseSet.add(agent.id);
      this._checkouts++;
      this.emit('pool:checkout', { agentId: agent.id, fromPool: false });
      return agent;
    }

    // Queue the request and wait
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = this._waitQueue.findIndex(r => r.id === requestId);
        if (idx > -1) {
          this._waitQueue.splice(idx, 1);
        }
        this._timeouts++;
        reject(new Error('Checkout timeout'));
      }, this.config.checkoutTimeout);

      const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this._waitQueue.push({
        id: requestId,
        criteria,
        resolve,
        reject,
        timeout
      });
    });
  }

  /**
   * Checkin an agent back to the pool
   * @param {string} agentId - Agent ID
   * @param {Object} result - Execution result
   */
  checkin(agentId, result = {}) {
    const agent = this._pool.get(agentId);
    if (!agent) return;

    // Update stats
    agent.useCount++;
    agent.lastUsedAt = Date.now();
    if (result.success === false) {
      agent.failureCount++;
    } else {
      agent.successCount++;
    }

    this._inUseSet.delete(agentId);
    this._checkins++;

    // Check if should recycle
    if (this._shouldRecycle(agent)) {
      this._recycle(agentId);
    } else {
      this._moveToIdle(agentId);
      this._processWaitQueue();
    }

    this.emit('pool:checkin', { agentId, useCount: agent.useCount });
  }

  /**
   * Warmup pool with additional agents
   * @param {number} count - Number of agents to create
   */
  async warmup(count) {
    const toCreate = Math.min(count, this.config.maxPoolSize - this._pool.size);

    for (let i = 0; i < toCreate; i++) {
      const agent = await this._createAgent({});
      this._idleQueue.push(agent.id);
    }

    this.emit('pool:warmup', { created: toCreate, totalSize: this._pool.size });
  }

  /**
   * Get pool statistics
   * @returns {Object} Pool statistics
   */
  getStats() {
    return {
      size: this._pool.size,
      idle: this._idleQueue.length,
      inUse: this._inUseSet.size,
      recycling: this._recyclingSet.size,
      waiting: this._waitQueue.length,
      utilization: this._pool.size > 0
        ? (this._inUseSet.size / this._pool.size) * 100
        : 0,
      checkouts: this._checkouts,
      checkins: this._checkins,
      recycled: this._recycled,
      created: this._created,
      disposed: this._disposed,
      timeouts: this._timeouts,
      hitRate: this._checkouts > 0
        ? ((this._checkouts - this._created) / this._checkouts) * 100
        : 0
    };
  }

  /**
   * Shutdown the pool
   */
  async shutdown() {
    this._closed = true;

    if (this._warmupTimer) {
      clearInterval(this._warmupTimer);
    }
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
    }

    // Reject waiting requests
    for (const request of this._waitQueue) {
      clearTimeout(request.timeout);
      request.reject(new Error('Pool shutdown'));
    }
    this._waitQueue = [];

    // Dispose all agents
    for (const agentId of this._pool.keys()) {
      await this._dispose(agentId);
    }

    this.emit('pool:shutdown');
  }

  // Private methods

  async _createAgent(criteria) {
    const id = `pooled-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    const agent = {
      id,
      config: criteria,
      state: 'idle',
      createdAt: now,
      lastUsedAt: now,
      useCount: 0,
      successCount: 0,
      failureCount: 0,
      // Factory would create actual agent here
      instance: this._agentFactory ? await this._agentFactory(id, criteria) : null
    };

    this._pool.set(id, agent);
    this._created++;

    return agent;
  }

  _findAvailable(criteria) {
    // Simple FIFO for now, could add criteria matching
    for (const agentId of this._idleQueue) {
      const agent = this._pool.get(agentId);
      if (agent && agent.state === 'idle') {
        return agentId;
      }
    }
    return null;
  }

  _moveToInUse(agentId) {
    const idx = this._idleQueue.indexOf(agentId);
    if (idx > -1) {
      this._idleQueue.splice(idx, 1);
    }
    this._inUseSet.add(agentId);
    const agent = this._pool.get(agentId);
    if (agent) {
      agent.state = 'in-use';
    }
  }

  _moveToIdle(agentId) {
    this._inUseSet.delete(agentId);
    this._recyclingSet.delete(agentId);
    this._idleQueue.push(agentId);
    const agent = this._pool.get(agentId);
    if (agent) {
      agent.state = 'idle';
    }
  }

  _shouldRecycle(agent) {
    if (agent.useCount >= this.config.recycleAfterUses) return true;
    if (this.config.recycleOnError && agent.failureCount > 0) return true;
    if (Date.now() - agent.createdAt > this.config.maxAgentAge) return true;
    return false;
  }

  async _recycle(agentId) {
    const agent = this._pool.get(agentId);
    if (!agent) return;

    agent.state = 'recycling';
    this._recyclingSet.add(agentId);
    this._inUseSet.delete(agentId);

    // Reset agent state
    agent.useCount = 0;
    agent.successCount = 0;
    agent.failureCount = 0;
    agent.lastUsedAt = Date.now();

    // If pool is at max, dispose instead of recycle
    if (this._idleQueue.length >= this.config.minPoolSize) {
      await this._dispose(agentId);
    } else {
      this._moveToIdle(agentId);
    }

    this._recycled++;
    this.emit('pool:recycle', { agentId });
  }

  async _dispose(agentId) {
    const agent = this._pool.get(agentId);
    if (!agent) return;

    // Cleanup
    this._pool.delete(agentId);
    this._idleQueue = this._idleQueue.filter(id => id !== agentId);
    this._inUseSet.delete(agentId);
    this._recyclingSet.delete(agentId);

    this._disposed++;
    this.emit('pool:dispose', { agentId });
  }

  _processWaitQueue() {
    while (this._waitQueue.length > 0 && this._idleQueue.length > 0) {
      const request = this._waitQueue.shift();
      const agentId = this._findAvailable(request.criteria);

      if (agentId) {
        clearTimeout(request.timeout);
        const agent = this._pool.get(agentId);
        this._moveToInUse(agentId);
        request.resolve(agent);
      } else {
        this._waitQueue.unshift(request);
        break;
      }
    }
  }

  _checkWarmup() {
    const idleCount = this._idleQueue.length;
    if (idleCount < this.config.minPoolSize && this._pool.size < this.config.maxPoolSize) {
      const needed = this.config.minPoolSize - idleCount;
      this.warmup(Math.min(needed, this.config.warmupBatchSize));
    }
  }

  _cleanupExpired() {
    const now = Date.now();
    for (const agentId of this._idleQueue) {
      const agent = this._pool.get(agentId);
      if (agent && now - agent.lastUsedAt > this.config.idleTimeout) {
        if (this._idleQueue.length > this.config.minPoolSize) {
          this._dispose(agentId);
        }
      }
    }
  }
}

// ============================================================================
// OPTIMIZATION MANAGER
// ============================================================================

/**
 * HierarchyOptimizationManager - Coordinates all optimization components
 */
class HierarchyOptimizationManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      pooling: { enabled: true, ...config.pooling },
      caching: { enabled: true, ...config.caching },
      timeouts: { enabled: true, ...config.timeouts }
    };

    // Components
    this.timeoutCalculator = new TieredTimeoutCalculator(config.timeouts);
    this.contextCache = new ContextCache(config.caching);
    this.agentPool = new AgentPool(config.pooling);

    // Metrics
    this._delegationsOptimized = 0;
    this._tokensaved = 0;
    this._latencySaved = 0;
  }

  /**
   * Initialize optimization components
   * @param {Object} options - Initialization options
   */
  async initialize(options = {}) {
    if (this.config.pooling.enabled && options.agentFactory) {
      await this.agentPool.initialize(options.agentFactory);
    }

    this.emit('optimizations:initialized', this.getStatus());
  }

  /**
   * Get optimized timeout for delegation
   * @param {number} depth - Delegation depth
   * @param {Object} options - Additional options
   * @returns {Object} Timeout configuration
   */
  getTimeout(depth, options = {}) {
    if (!this.config.timeouts.enabled) {
      return { timeout: 60000, tier: 0, tierLabel: 'default', inherited: false };
    }
    return this.timeoutCalculator.calculateTimeout(depth, options);
  }

  /**
   * Get cached context or store new
   * @param {string} key - Context key
   * @param {Function} fetcher - Function to fetch if not cached
   * @param {Object} options - Cache options
   * @returns {Promise<Object>} Context value
   */
  async getOrSetContext(key, fetcher, options = {}) {
    if (!this.config.caching.enabled) {
      return fetcher();
    }

    const cached = this.contextCache.get(key);
    if (cached) {
      this._tokensaved += cached.tokenCount;
      return cached.content;
    }

    const value = await fetcher();
    this.contextCache.set(key, value, options);
    return value;
  }

  /**
   * Checkout agent from pool
   * @param {Object} criteria - Agent criteria
   * @returns {Promise<Object>} Pooled agent
   */
  async checkoutAgent(criteria = {}) {
    if (!this.config.pooling.enabled) {
      throw new Error('Pooling not enabled');
    }
    return this.agentPool.checkout(criteria);
  }

  /**
   * Checkin agent back to pool
   * @param {string} agentId - Agent ID
   * @param {Object} result - Execution result
   */
  checkinAgent(agentId, result = {}) {
    if (!this.config.pooling.enabled) return;
    this.agentPool.checkin(agentId, result);
  }

  /**
   * Get current status of all optimizations
   * @returns {Object} Optimization status
   */
  getStatus() {
    return {
      pooling: {
        enabled: this.config.pooling.enabled,
        ...this.agentPool.getStats()
      },
      caching: {
        enabled: this.config.caching.enabled,
        ...this.contextCache.getStats()
      },
      timeouts: {
        enabled: this.config.timeouts.enabled,
        config: this.timeoutCalculator.getConfig()
      },
      metrics: {
        delegationsOptimized: this._delegationsOptimized,
        tokensSaved: this._tokensaved,
        latencySaved: this._latencySaved
      }
    };
  }

  /**
   * Shutdown all optimization components
   */
  async shutdown() {
    await this.agentPool.shutdown();
    this.contextCache.clear();
    this.emit('optimizations:shutdown');
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Core classes
  TieredTimeoutCalculator,
  ContextCache,
  AgentPool,
  HierarchyOptimizationManager,

  // Configurations
  DEFAULT_TIMEOUT_TIERS,
  DEFAULT_TIMEOUT_CONFIG,
  DEFAULT_CACHE_CONFIG,
  DEFAULT_POOL_CONFIG
};
