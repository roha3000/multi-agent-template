/**
 * Checkpoint Optimizer - Learns optimal checkpoint timing to maximize efficiency
 *
 * Intelligence Features:
 * - Learns from historical checkpoint effectiveness
 * - Adapts thresholds based on task patterns
 * - Detects and prevents context compaction
 * - Predicts optimal checkpoint timing
 * - Self-adjusts based on failures
 *
 * Learning Metrics:
 * - Token usage patterns per task type
 * - Checkpoint success/failure rates
 * - Time to compaction events
 * - Recovery success rates
 *
 * @module checkpoint-optimizer
 */

const { createComponentLogger } = require('./logger');

class CheckpointOptimizer {
  /**
   * Create a checkpoint optimizer
   *
   * @param {Object} components - System components
   * @param {MemoryStore} components.memoryStore - Memory store for persistence
   * @param {UsageTracker} components.usageTracker - Usage tracker
   * @param {Object} options - Configuration
   */
  constructor(components, options = {}) {
    this.logger = createComponentLogger('CheckpointOptimizer');

    this.memoryStore = components.memoryStore;
    this.usageTracker = components.usageTracker;

    // Configuration
    this.options = {
      // Initial conservative thresholds
      initialThresholds: {
        context: 0.75,      // Checkpoint at 75% of context
        buffer: 15000       // Keep 15K token buffer
      },

      // Learning parameters
      learningRate: 0.1,              // How quickly to adapt (0-1)
      minThreshold: 0.60,             // Never go below 60%
      maxThreshold: 0.85,             // Never go above 85%
      minBuffer: 10000,               // Minimum safety buffer
      maxBuffer: 30000,               // Maximum buffer (wasteful if too high)

      // Compaction detection
      compactionDetectionEnabled: true,
      compactionTokenDrop: 50000,     // Detect if >50K tokens suddenly disappear

      // Adaptation triggers
      failureAdaptionFactor: 0.9,     // Reduce threshold by 10% on failure
      successAdaptionFactor: 1.02,    // Increase threshold by 2% on success

      ...options
    };

    // Current adaptive thresholds (will evolve over time)
    this.thresholds = { ...this.options.initialThresholds };

    // Learning state
    this.learningData = {
      checkpoints: [],              // Checkpoint history
      compactionEvents: [],         // Detected compaction events
      taskPatterns: new Map(),      // Task type -> average token usage
      successRate: 1.0,             // Current success rate
      totalCheckpoints: 0,
      successfulCheckpoints: 0,
      failedCheckpoints: 0
    };

    // Context tracking
    this.lastContextSize = 0;
    this.contextHistory = [];

    this._loadLearningData();

    this.logger.info('CheckpointOptimizer initialized', {
      thresholds: this.thresholds,
      learningRate: this.options.learningRate
    });
  }

  /**
   * Predict optimal checkpoint timing
   * @param {Object} currentState - Current execution state
   * @returns {Object} Prediction result
   */
  predictCheckpoint(currentState) {
    const {
      contextTokens,      // Current context size
      maxContextTokens,   // Maximum context limit
      taskType,           // Type of task being executed
      estimatedRemaining  // Estimated tokens for remaining work
    } = currentState;

    // Calculate current utilization
    const utilization = contextTokens / maxContextTokens;

    // Get task-specific pattern if available
    const taskPattern = this.learningData.taskPatterns.get(taskType);
    const estimatedTaskTokens = taskPattern?.avgTokens || estimatedRemaining || 5000;

    // Calculate projected tokens after task
    const projectedTokens = contextTokens + estimatedTaskTokens;
    const projectedUtilization = projectedTokens / maxContextTokens;

    // Determine if checkpoint is needed
    const shouldCheckpoint =
      utilization >= this.thresholds.context ||
      projectedUtilization >= (this.thresholds.context + 0.05) ||
      (maxContextTokens - projectedTokens) < this.thresholds.buffer;

    // Calculate urgency level
    let urgency = 'none';
    if (utilization >= 0.95) {
      urgency = 'emergency';
    } else if (utilization >= 0.90) {
      urgency = 'critical';
    } else if (shouldCheckpoint) {
      urgency = 'recommended';
    }

    const prediction = {
      shouldCheckpoint,
      urgency,
      currentUtilization: utilization,
      projectedUtilization,
      tokensUntilThreshold: Math.max(0,
        (maxContextTokens * this.thresholds.context) - contextTokens
      ),
      tokensUntilCritical: Math.max(0,
        (maxContextTokens * 0.90) - contextTokens
      ),
      recommendedAction: this._getRecommendedAction(urgency, utilization),
      confidence: this._calculateConfidence(taskPattern),
      thresholds: { ...this.thresholds }
    };

    this.logger.debug('Checkpoint prediction', prediction);

    return prediction;
  }

  /**
   * Record checkpoint execution
   * @param {Object} checkpoint - Checkpoint details
   * @param {boolean} success - Whether checkpoint succeeded
   */
  recordCheckpoint(checkpoint, success) {
    this.learningData.totalCheckpoints++;

    const record = {
      timestamp: Date.now(),
      contextTokens: checkpoint.contextTokens,
      utilization: checkpoint.contextTokens / checkpoint.maxContextTokens,
      taskType: checkpoint.taskType,
      success: success,
      threshold: this.thresholds.context
    };

    this.learningData.checkpoints.push(record);

    if (success) {
      this.learningData.successfulCheckpoints++;
    } else {
      this.learningData.failedCheckpoints++;

      // Learn from failure - make more conservative
      this._adaptFromFailure(record);
    }

    // Update success rate
    this.learningData.successRate =
      this.learningData.successfulCheckpoints / this.learningData.totalCheckpoints;

    // Update task pattern
    if (checkpoint.taskType) {
      this._updateTaskPattern(checkpoint.taskType, checkpoint.tokensUsed || 0);
    }

    // Persist learning data
    this._saveLearningData();

    this.logger.info('Checkpoint recorded', {
      success,
      utilization: record.utilization.toFixed(2),
      successRate: this.learningData.successRate.toFixed(2),
      newThreshold: this.thresholds.context
    });
  }

  /**
   * Detect context compaction (Claude forcing context reduction)
   * @param {number} currentContextSize - Current context size
   * @returns {boolean} True if compaction detected
   */
  detectCompaction(currentContextSize) {
    if (!this.options.compactionDetectionEnabled) {
      return false;
    }

    // Check for sudden large drop in context
    if (this.lastContextSize > 0) {
      const drop = this.lastContextSize - currentContextSize;

      if (drop > this.options.compactionTokenDrop) {
        // Compaction detected!
        this._handleCompactionDetected(drop);
        return true;
      }
    }

    // Track context history
    this.contextHistory.push({
      timestamp: Date.now(),
      size: currentContextSize
    });

    // Keep only last 100 measurements
    if (this.contextHistory.length > 100) {
      this.contextHistory.shift();
    }

    this.lastContextSize = currentContextSize;
    return false;
  }

  /**
   * Handle compaction detection
   * @param {number} tokensDrop - Tokens lost to compaction
   * @private
   */
  _handleCompactionDetected(tokensDrop) {
    this.logger.error('COMPACTION DETECTED', {
      tokensLost: tokensDrop,
      previousContext: this.lastContextSize,
      currentThreshold: this.thresholds.context
    });

    // Record compaction event
    const compactionEvent = {
      timestamp: Date.now(),
      tokensLost: tokensDrop,
      previousContext: this.lastContextSize,
      thresholdAtTime: this.thresholds.context,
      bufferAtTime: this.thresholds.buffer
    };

    this.learningData.compactionEvents.push(compactionEvent);

    // Aggressively adapt - this is a critical failure
    this.thresholds.context = Math.max(
      this.options.minThreshold,
      this.thresholds.context * 0.85  // Reduce by 15%
    );

    this.thresholds.buffer = Math.min(
      this.options.maxBuffer,
      this.thresholds.buffer + 5000   // Increase buffer by 5K
    );

    this.logger.warn('Thresholds auto-adjusted after compaction', {
      newContextThreshold: this.thresholds.context,
      newBuffer: this.thresholds.buffer
    });

    // Persist immediately
    this._saveLearningData();

    // Emit alert
    if (this.onCompactionDetected) {
      this.onCompactionDetected(compactionEvent);
    }
  }

  /**
   * Adapt from checkpoint failure
   * @param {Object} failedCheckpoint - Failed checkpoint record
   * @private
   */
  _adaptFromFailure(failedCheckpoint) {
    // Make more conservative
    const oldThreshold = this.thresholds.context;

    this.thresholds.context = Math.max(
      this.options.minThreshold,
      this.thresholds.context * this.options.failureAdaptionFactor
    );

    this.thresholds.buffer = Math.min(
      this.options.maxBuffer,
      this.thresholds.buffer * 1.1  // Increase buffer 10%
    );

    this.logger.warn('Adapted from failure', {
      oldThreshold,
      newThreshold: this.thresholds.context,
      reduction: ((1 - this.thresholds.context / oldThreshold) * 100).toFixed(1) + '%'
    });
  }

  /**
   * Gradually adapt from success (be less conservative over time)
   * Only called periodically when success rate is high
   */
  adaptFromSuccess() {
    if (this.learningData.successRate < 0.95) {
      return; // Only adapt up if very successful
    }

    if (this.learningData.successfulCheckpoints < 10) {
      return; // Need enough data
    }

    const oldThreshold = this.thresholds.context;

    this.thresholds.context = Math.min(
      this.options.maxThreshold,
      this.thresholds.context * this.options.successAdaptionFactor
    );

    if (oldThreshold !== this.thresholds.context) {
      this.logger.info('Adapted from success', {
        oldThreshold,
        newThreshold: this.thresholds.context,
        successRate: this.learningData.successRate
      });

      this._saveLearningData();
    }
  }

  /**
   * Update task pattern learning
   * @param {string} taskType - Type of task
   * @param {number} tokensUsed - Tokens used
   * @private
   */
  _updateTaskPattern(taskType, tokensUsed) {
    const pattern = this.learningData.taskPatterns.get(taskType) || {
      count: 0,
      totalTokens: 0,
      avgTokens: 0,
      minTokens: Infinity,
      maxTokens: 0
    };

    pattern.count++;
    pattern.totalTokens += tokensUsed;
    pattern.avgTokens = pattern.totalTokens / pattern.count;
    pattern.minTokens = Math.min(pattern.minTokens, tokensUsed);
    pattern.maxTokens = Math.max(pattern.maxTokens, tokensUsed);

    this.learningData.taskPatterns.set(taskType, pattern);
  }

  /**
   * Get recommended action
   * @param {string} urgency - Urgency level
   * @param {number} utilization - Current utilization
   * @returns {string} Recommended action
   * @private
   */
  _getRecommendedAction(urgency, utilization) {
    if (urgency === 'emergency') {
      return 'CHECKPOINT_IMMEDIATELY';
    } else if (urgency === 'critical') {
      return 'CHECKPOINT_BEFORE_NEXT_OPERATION';
    } else if (urgency === 'recommended') {
      return 'CHECKPOINT_WHEN_CONVENIENT';
    } else {
      return 'CONTINUE';
    }
  }

  /**
   * Calculate confidence in prediction
   * @param {Object} taskPattern - Task pattern data
   * @returns {number} Confidence (0-1)
   * @private
   */
  _calculateConfidence(taskPattern) {
    if (!taskPattern || taskPattern.count < 5) {
      return 0.5; // Low confidence without data
    }

    // More data = higher confidence, capped at 0.95
    const dataConfidence = Math.min(0.95, 0.5 + (taskPattern.count / 100));

    // High variance = lower confidence
    const variance = taskPattern.maxTokens - taskPattern.minTokens;
    const variancePenalty = Math.min(0.3, variance / 100000);

    return Math.max(0.3, dataConfidence - variancePenalty);
  }

  /**
   * Get current optimization statistics
   * @returns {Object} Statistics
   */
  getStatistics() {
    return {
      thresholds: { ...this.thresholds },
      learning: {
        totalCheckpoints: this.learningData.totalCheckpoints,
        successfulCheckpoints: this.learningData.successfulCheckpoints,
        failedCheckpoints: this.learningData.failedCheckpoints,
        successRate: this.learningData.successRate,
        compactionEvents: this.learningData.compactionEvents.length,
        taskPatternsLearned: this.learningData.taskPatterns.size
      },
      taskPatterns: Array.from(this.learningData.taskPatterns.entries()).map(
        ([type, pattern]) => ({
          taskType: type,
          count: pattern.count,
          avgTokens: Math.round(pattern.avgTokens),
          minTokens: pattern.minTokens,
          maxTokens: pattern.maxTokens
        })
      )
    };
  }

  /**
   * Load learning data from persistence
   * @private
   */
  _loadLearningData() {
    if (!this.memoryStore) {
      return;
    }

    try {
      // Try to load from database
      const stmt = this.memoryStore.db.prepare(`
        SELECT data FROM checkpoint_learning_data
        WHERE id = 'current'
      `);

      const row = stmt.get();

      if (row) {
        const loaded = JSON.parse(row.data);

        this.thresholds = loaded.thresholds || this.thresholds;
        this.learningData = {
          ...this.learningData,
          ...loaded.learningData,
          taskPatterns: new Map(loaded.learningData?.taskPatterns || [])
        };

        this.logger.info('Learning data loaded', {
          checkpoints: this.learningData.totalCheckpoints,
          successRate: this.learningData.successRate,
          thresholds: this.thresholds
        });
      }
    } catch (error) {
      // Table might not exist yet, create it
      try {
        this.memoryStore.db.exec(`
          CREATE TABLE IF NOT EXISTS checkpoint_learning_data (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `);
      } catch (createError) {
        this.logger.warn('Could not create learning data table', {
          error: createError.message
        });
      }
    }
  }

  /**
   * Save learning data to persistence
   * @private
   */
  _saveLearningData() {
    if (!this.memoryStore) {
      return;
    }

    try {
      const data = JSON.stringify({
        thresholds: this.thresholds,
        learningData: {
          ...this.learningData,
          taskPatterns: Array.from(this.learningData.taskPatterns.entries())
        }
      });

      const stmt = this.memoryStore.db.prepare(`
        INSERT OR REPLACE INTO checkpoint_learning_data (id, data, updated_at)
        VALUES ('current', ?, ?)
      `);

      stmt.run(data, Date.now());

      this.logger.debug('Learning data saved');
    } catch (error) {
      this.logger.error('Failed to save learning data', {
        error: error.message
      });
    }
  }

  /**
   * Reset learning data (for testing or emergency)
   * @param {boolean} confirm - Must be true to execute
   */
  reset(confirm = false) {
    if (!confirm) {
      throw new Error('Reset requires explicit confirmation');
    }

    this.thresholds = { ...this.options.initialThresholds };
    this.learningData = {
      checkpoints: [],
      compactionEvents: [],
      taskPatterns: new Map(),
      successRate: 1.0,
      totalCheckpoints: 0,
      successfulCheckpoints: 0,
      failedCheckpoints: 0
    };

    this._saveLearningData();

    this.logger.warn('Learning data reset to defaults');
  }
}

module.exports = CheckpointOptimizer;
