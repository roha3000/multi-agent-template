/**
 * OTLP Checkpoint Bridge - Integrates OTLP metrics with checkpoint optimization
 *
 * This bridge enables the continuous loop framework to leverage real-time usage
 * metrics from Claude Code sessions (via OTLP) to make intelligent decisions about:
 * - When to create checkpoints
 * - When context is approaching limits
 * - When to save state before compaction
 * - When to clear and reload context
 *
 * Key Features:
 * - Real-time OTLP metric monitoring
 * - Predictive context exhaustion detection
 * - Automatic state preservation before compaction
 * - Context clearing and reloading mechanism
 * - Intelligent checkpoint timing based on actual usage
 *
 * @module otlp-checkpoint-bridge
 */

const { createComponentLogger } = require('./logger');
const EventEmitter = require('events');

class OTLPCheckpointBridge extends EventEmitter {
  /**
   * Create an OTLP-Checkpoint bridge
   *
   * @param {Object} components - System components
   * @param {OTLPReceiver} components.otlpReceiver - OTLP receiver instance
   * @param {CheckpointOptimizer} components.checkpointOptimizer - Checkpoint optimizer
   * @param {ContinuousLoopOrchestrator} components.orchestrator - Loop orchestrator
   * @param {StateManager} components.stateManager - State manager for saving/loading
   * @param {UsageTracker} components.usageTracker - Usage tracker
   * @param {Object} options - Configuration options
   */
  constructor(components, options = {}) {
    super();

    this.logger = createComponentLogger('OTLPCheckpointBridge');

    // Components
    this.otlpReceiver = components.otlpReceiver;
    this.checkpointOptimizer = components.checkpointOptimizer;
    this.orchestrator = components.orchestrator;
    this.stateManager = components.stateManager;
    this.usageTracker = components.usageTracker;

    // Configuration
    this.options = {
      // Context thresholds
      compactionThreshold: 0.95,     // Trigger emergency save at 95%
      warningThreshold: 0.85,        // Start monitoring closely at 85%
      checkpointThreshold: 0.75,     // Normal checkpoint at 75%

      // Token tracking
      contextWindowSize: 200000,     // Claude's context window
      safetyBuffer: 10000,          // Keep 10K token buffer

      // Monitoring
      metricsCheckInterval: 5000,    // Check metrics every 5 seconds
      rapidCheckInterval: 1000,      // Rapid check when critical

      // State management
      autoSaveBeforeCompaction: true,
      autoReloadAfterClear: true,
      preserveEssentialContext: true,

      // Learning
      adaptFromMetrics: true,
      metricsHistorySize: 100,

      ...options
    };

    // State tracking
    this.state = {
      currentTokens: 0,
      lastTokenCount: 0,
      tokenVelocity: 0,              // Tokens per second
      projectedExhaustion: null,     // Estimated time to exhaustion
      lastMetricUpdate: Date.now(),
      checkMode: 'normal',           // normal, rapid, emergency
      recentMetrics: [],
      compactionSaves: 0,
      successfulReloads: 0
    };

    // Metric patterns for learning
    this.metricPatterns = new Map();

    this.logger.info('OTLP Checkpoint Bridge initialized', {
      compactionThreshold: this.options.compactionThreshold,
      warningThreshold: this.options.warningThreshold,
      checkpointThreshold: this.options.checkpointThreshold
    });
  }

  /**
   * Start monitoring OTLP metrics
   */
  start() {
    this.logger.info('Starting OTLP metric monitoring');

    // Subscribe to OTLP metrics if receiver supports events
    if (this.otlpReceiver && this.otlpReceiver.on) {
      this.otlpReceiver.on('metrics:processed', this._handleOTLPMetrics.bind(this));
      this.otlpReceiver.on('metrics:batch', this._handleMetricsBatch.bind(this));
    }

    // Start periodic monitoring
    this._startMonitoring();

    // Listen for orchestrator events
    if (this.orchestrator) {
      this.orchestrator.on('operation:start', this._handleOperationStart.bind(this));
      this.orchestrator.on('operation:complete', this._handleOperationComplete.bind(this));
    }

    this.emit('started');
  }

  /**
   * Stop monitoring
   */
  stop() {
    this.logger.info('Stopping OTLP metric monitoring');

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    if (this.rapidMonitorInterval) {
      clearInterval(this.rapidMonitorInterval);
      this.rapidMonitorInterval = null;
    }

    this.emit('stopped');
  }

  /**
   * Handle incoming OTLP metrics
   * @private
   */
  async _handleOTLPMetrics(metrics) {
    // Extract token usage from metrics
    const tokenMetrics = this._extractTokenMetrics(metrics);

    if (tokenMetrics) {
      // Update current state
      const previousTokens = this.state.currentTokens;
      this.state.currentTokens = tokenMetrics.totalTokens || 0;

      // Calculate velocity (tokens per second)
      const timeDelta = (Date.now() - this.state.lastMetricUpdate) / 1000;
      if (timeDelta > 0) {
        this.state.tokenVelocity = (this.state.currentTokens - previousTokens) / timeDelta;
      }

      this.state.lastMetricUpdate = Date.now();

      // Store in recent metrics for pattern analysis
      this.state.recentMetrics.push({
        timestamp: Date.now(),
        tokens: this.state.currentTokens,
        velocity: this.state.tokenVelocity
      });

      // Keep only recent history
      if (this.state.recentMetrics.length > this.options.metricsHistorySize) {
        this.state.recentMetrics.shift();
      }

      // Check context status
      await this._checkContextStatus();

      // Update checkpoint optimizer with real metrics
      if (this.checkpointOptimizer && this.options.adaptFromMetrics) {
        this._updateOptimizerWithMetrics(tokenMetrics);
      }
    }
  }

  /**
   * Handle batch of metrics
   * @private
   */
  async _handleMetricsBatch(batch) {
    // Process batch for aggregate insights
    const aggregated = this._aggregateMetricsBatch(batch);

    if (aggregated.criticalUsage) {
      this.logger.warn('Critical usage detected in metrics batch', {
        maxUtilization: aggregated.maxUtilization,
        avgVelocity: aggregated.avgVelocity
      });

      // Switch to rapid monitoring mode
      this._switchToRapidMode();
    }
  }

  /**
   * Check current context status and take action if needed
   * @private
   */
  async _checkContextStatus() {
    const utilization = this.state.currentTokens / this.options.contextWindowSize;
    const remainingTokens = this.options.contextWindowSize - this.state.currentTokens;

    // Project time to exhaustion based on velocity
    if (this.state.tokenVelocity > 0) {
      this.state.projectedExhaustion = remainingTokens / this.state.tokenVelocity;
    }

    // Emergency: Above compaction threshold
    if (utilization >= this.options.compactionThreshold) {
      await this._handleEmergencyCompaction();
    }
    // Critical: Approaching compaction
    else if (utilization >= this.options.warningThreshold) {
      await this._handleCriticalContext();
    }
    // Warning: Time for normal checkpoint
    else if (utilization >= this.options.checkpointThreshold) {
      await this._handleCheckpointRecommendation();
    }
    // Check velocity-based warnings
    else if (this.state.projectedExhaustion && this.state.projectedExhaustion < 60) {
      // Less than 60 seconds to exhaustion at current rate
      await this._handleRapidExhaustion();
    }

    // Emit status update
    this.emit('context:status', {
      utilization,
      currentTokens: this.state.currentTokens,
      remainingTokens,
      tokenVelocity: this.state.tokenVelocity,
      projectedExhaustion: this.state.projectedExhaustion,
      checkMode: this.state.checkMode
    });
  }

  /**
   * Handle emergency compaction scenario
   * @private
   */
  async _handleEmergencyCompaction() {
    this.logger.error('EMERGENCY: Context near compaction threshold!', {
      currentTokens: this.state.currentTokens,
      utilization: (this.state.currentTokens / this.options.contextWindowSize * 100).toFixed(1) + '%'
    });

    this.state.checkMode = 'emergency';

    // 1. Save state immediately
    if (this.options.autoSaveBeforeCompaction && this.stateManager) {
      try {
        const saveResult = await this._saveStateBeforeCompaction();

        if (saveResult.success) {
          this.state.compactionSaves++;
          this.logger.info('State saved before compaction', {
            stateId: saveResult.stateId,
            preservedTokens: saveResult.preservedTokens
          });
        }
      } catch (error) {
        this.logger.error('Failed to save state before compaction', {
          error: error.message
        });
      }
    }

    // 2. Trigger immediate checkpoint
    if (this.orchestrator) {
      const checkpointResult = await this.orchestrator.checkpoint({
        reason: 'emergency-compaction',
        taskType: 'compaction-prevention'
      });

      if (checkpointResult.success) {
        // 3. Clear non-essential context
        await this._clearNonEssentialContext();

        // 4. Reload if configured
        if (this.options.autoReloadAfterClear) {
          await this._reloadEssentialContext();
        }
      }
    }

    // Emit emergency event
    this.emit('emergency:compaction', {
      currentTokens: this.state.currentTokens,
      action: 'state-saved-and-cleared'
    });
  }

  /**
   * Handle critical context level
   * @private
   */
  async _handleCriticalContext() {
    this.logger.warn('Critical context level reached', {
      utilization: (this.state.currentTokens / this.options.contextWindowSize * 100).toFixed(1) + '%',
      projectedExhaustion: this.state.projectedExhaustion
    });

    // Switch to rapid monitoring
    this._switchToRapidMode();

    // Recommend immediate checkpoint
    if (this.orchestrator) {
      this.orchestrator.emit('checkpoint:recommended', {
        urgency: 'critical',
        reason: 'approaching-compaction',
        currentTokens: this.state.currentTokens
      });
    }

    this.emit('warning:critical', {
      currentTokens: this.state.currentTokens,
      remainingTokens: this.options.contextWindowSize - this.state.currentTokens
    });
  }

  /**
   * Handle checkpoint recommendation
   * @private
   */
  async _handleCheckpointRecommendation() {
    this.logger.info('Checkpoint recommended', {
      utilization: (this.state.currentTokens / this.options.contextWindowSize * 100).toFixed(1) + '%'
    });

    if (this.orchestrator) {
      this.orchestrator.emit('checkpoint:recommended', {
        urgency: 'normal',
        reason: 'threshold-reached',
        currentTokens: this.state.currentTokens
      });
    }

    this.emit('checkpoint:recommended', {
      currentTokens: this.state.currentTokens
    });
  }

  /**
   * Handle rapid exhaustion scenario
   * @private
   */
  async _handleRapidExhaustion() {
    this.logger.warn('Rapid context exhaustion detected', {
      secondsToExhaustion: this.state.projectedExhaustion,
      tokenVelocity: this.state.tokenVelocity
    });

    this._switchToRapidMode();

    this.emit('warning:rapid-exhaustion', {
      secondsToExhaustion: this.state.projectedExhaustion,
      tokenVelocity: this.state.tokenVelocity
    });
  }

  /**
   * Save state before compaction
   * @private
   */
  async _saveStateBeforeCompaction() {
    const stateId = `compaction-save-${Date.now()}`;

    // Export current state
    const currentState = this.stateManager.export();

    // Determine essential context to preserve
    const essentialContext = this._identifyEssentialContext(currentState);

    // Save to persistent storage
    const saveResult = await this.stateManager.saveCompactionState({
      id: stateId,
      timestamp: Date.now(),
      fullState: currentState,
      essentialContext,
      contextTokens: this.state.currentTokens,
      reason: 'pre-compaction-save'
    });

    return {
      success: true,
      stateId,
      preservedTokens: essentialContext.estimatedTokens || 0
    };
  }

  /**
   * Clear non-essential context
   * @private
   */
  async _clearNonEssentialContext() {
    this.logger.info('Clearing non-essential context');

    // This would integrate with Claude's context management
    // For now, we track what should be cleared

    const cleared = {
      conversationHistory: true,
      intermediateResults: true,
      verboseLogging: true,
      cachedResponses: true
    };

    this.emit('context:cleared', cleared);

    return cleared;
  }

  /**
   * Reload essential context after clearing
   * @private
   */
  async _reloadEssentialContext() {
    this.logger.info('Reloading essential context');

    try {
      // Load the most recent compaction save
      const recentSave = await this.stateManager.getMostRecentCompactionSave();

      if (recentSave && recentSave.essentialContext) {
        // Reload essential parts
        await this.stateManager.loadEssentialContext(recentSave.essentialContext);

        this.state.successfulReloads++;

        this.logger.info('Essential context reloaded', {
          stateId: recentSave.id,
          tokensRestored: recentSave.essentialContext.estimatedTokens
        });

        this.emit('context:reloaded', {
          stateId: recentSave.id,
          success: true
        });

        return true;
      }
    } catch (error) {
      this.logger.error('Failed to reload context', {
        error: error.message
      });

      this.emit('context:reload-failed', {
        error: error.message
      });

      return false;
    }
  }

  /**
   * Identify essential context to preserve
   * @private
   */
  _identifyEssentialContext(fullState) {
    // Determine what's essential to keep
    return {
      projectConfiguration: fullState.projectConfiguration || {},
      currentTask: fullState.currentTask || {},
      criticalDecisions: fullState.criticalDecisions || [],
      activeCheckpoints: fullState.checkpoints || [],
      estimatedTokens: 5000  // Rough estimate
    };
  }

  /**
   * Extract token metrics from OTLP data
   * @private
   */
  _extractTokenMetrics(metrics) {
    // Look for token-related metrics in OTLP data
    const tokenMetrics = {};

    if (metrics.metrics) {
      metrics.metrics.forEach(metric => {
        if (metric.name.includes('token') || metric.name.includes('context')) {
          // OTLP format uses sum.dataPoints or gauge.dataPoints
          const dataPoint = metric.sum?.dataPoints?.[0] ||
                           metric.gauge?.dataPoints?.[0] ||
                           metric.data?.dataPoints?.[0];
          if (dataPoint) {
            // Parse the value (could be number, string, or asInt)
            const value = parseInt(dataPoint.value || dataPoint.asInt || 0);

            if (metric.name.includes('total')) {
              tokenMetrics.totalTokens = value;
            } else if (metric.name.includes('input')) {
              tokenMetrics.inputTokens = value;
            } else if (metric.name.includes('output')) {
              tokenMetrics.outputTokens = value;
            }
          }
        }
      });
    }

    // Calculate total if not provided
    if (!tokenMetrics.totalTokens && (tokenMetrics.inputTokens || tokenMetrics.outputTokens)) {
      tokenMetrics.totalTokens = (tokenMetrics.inputTokens || 0) + (tokenMetrics.outputTokens || 0);
    }

    return tokenMetrics.totalTokens ? tokenMetrics : null;
  }

  /**
   * Update optimizer with real metrics
   * @private
   */
  _updateOptimizerWithMetrics(tokenMetrics) {
    // Feed real-world data to the optimizer for learning
    if (tokenMetrics.totalTokens) {
      // Detect if compaction occurred (sudden drop in tokens)
      const compactionDetected = this.checkpointOptimizer.detectCompaction(tokenMetrics.totalTokens);

      if (compactionDetected) {
        this.logger.error('Compaction detected via OTLP metrics!');
      }

      // Update optimizer's view of current context
      this.checkpointOptimizer.lastContextSize = tokenMetrics.totalTokens;
    }
  }

  /**
   * Aggregate metrics batch for insights
   * @private
   */
  _aggregateMetricsBatch(batch) {
    let maxUtilization = 0;
    let totalVelocity = 0;
    let count = 0;

    batch.forEach(metrics => {
      const tokenMetrics = this._extractTokenMetrics(metrics);
      if (tokenMetrics) {
        const utilization = tokenMetrics.totalTokens / this.options.contextWindowSize;
        maxUtilization = Math.max(maxUtilization, utilization);

        // Calculate velocity if we have history
        if (this.state.lastTokenCount > 0) {
          const velocity = tokenMetrics.totalTokens - this.state.lastTokenCount;
          totalVelocity += velocity;
          count++;
        }

        this.state.lastTokenCount = tokenMetrics.totalTokens;
      }
    });

    return {
      maxUtilization,
      avgVelocity: count > 0 ? totalVelocity / count : 0,
      criticalUsage: maxUtilization >= this.options.warningThreshold
    };
  }

  /**
   * Start periodic monitoring
   * @private
   */
  _startMonitoring() {
    // Normal monitoring interval
    this.monitorInterval = setInterval(() => {
      if (this.state.checkMode === 'normal') {
        this._performMonitoringCheck();
      }
    }, this.options.metricsCheckInterval);
  }

  /**
   * Switch to rapid monitoring mode
   * @private
   */
  _switchToRapidMode() {
    if (this.state.checkMode === 'rapid') {
      return; // Already in rapid mode
    }

    this.logger.info('Switching to rapid monitoring mode');
    this.state.checkMode = 'rapid';

    // Clear normal interval
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }

    // Start rapid interval
    this.rapidMonitorInterval = setInterval(() => {
      this._performMonitoringCheck();
    }, this.options.rapidCheckInterval);

    // Auto-switch back to normal after context drops
    setTimeout(() => {
      const utilization = this.state.currentTokens / this.options.contextWindowSize;
      if (utilization < this.options.checkpointThreshold) {
        this._switchToNormalMode();
      }
    }, 30000); // Check after 30 seconds
  }

  /**
   * Switch back to normal monitoring mode
   * @private
   */
  _switchToNormalMode() {
    if (this.state.checkMode === 'normal') {
      return;
    }

    this.logger.info('Switching back to normal monitoring mode');
    this.state.checkMode = 'normal';

    // Clear rapid interval
    if (this.rapidMonitorInterval) {
      clearInterval(this.rapidMonitorInterval);
      this.rapidMonitorInterval = null;
    }

    // Restart normal monitoring
    this._startMonitoring();
  }

  /**
   * Perform monitoring check
   * @private
   */
  async _performMonitoringCheck() {
    // Recheck context status
    await this._checkContextStatus();

    // Learn from patterns
    if (this.options.adaptFromMetrics) {
      this._learnFromMetricPatterns();
    }
  }

  /**
   * Learn from metric patterns
   * @private
   */
  _learnFromMetricPatterns() {
    if (this.state.recentMetrics.length < 10) {
      return; // Need more data
    }

    // Analyze patterns in recent metrics
    const pattern = {
      avgVelocity: 0,
      maxVelocity: 0,
      accelerating: false
    };

    let totalVelocity = 0;
    let increasing = 0;

    for (let i = 1; i < this.state.recentMetrics.length; i++) {
      const velocity = this.state.recentMetrics[i].velocity;
      totalVelocity += velocity;
      pattern.maxVelocity = Math.max(pattern.maxVelocity, velocity);

      if (velocity > this.state.recentMetrics[i - 1].velocity) {
        increasing++;
      }
    }

    pattern.avgVelocity = totalVelocity / (this.state.recentMetrics.length - 1);
    pattern.accelerating = increasing > (this.state.recentMetrics.length / 2);

    // Store pattern for current context level
    const utilization = Math.floor(this.state.currentTokens / this.options.contextWindowSize * 10) / 10;
    this.metricPatterns.set(utilization, pattern);

    // Adjust thresholds if acceleration detected
    if (pattern.accelerating && this.checkpointOptimizer) {
      this.logger.info('Token usage accelerating, adjusting thresholds');
      // Make optimizer more conservative
      this.checkpointOptimizer.thresholds.context *= 0.95;
    }
  }

  /**
   * Handle operation start
   * @private
   */
  _handleOperationStart(operation) {
    // Track operation for metric correlation
    this.state.currentOperation = {
      ...operation,
      startTokens: this.state.currentTokens,
      startTime: Date.now()
    };
  }

  /**
   * Handle operation complete
   * @private
   */
  _handleOperationComplete(operation) {
    if (this.state.currentOperation) {
      // Calculate tokens used in operation
      const tokensUsed = this.state.currentTokens - this.state.currentOperation.startTokens;
      const duration = Date.now() - this.state.currentOperation.startTime;

      // Update checkpoint optimizer with operation data
      if (this.checkpointOptimizer && tokensUsed > 0) {
        this.checkpointOptimizer._updateTaskPattern(
          operation.type || 'unknown',
          tokensUsed
        );
      }

      this.logger.debug('Operation completed', {
        type: operation.type,
        tokensUsed,
        duration,
        velocity: tokensUsed / (duration / 1000)
      });
    }
  }

  /**
   * Get current bridge status
   */
  getStatus() {
    const utilization = this.state.currentTokens / this.options.contextWindowSize;

    return {
      currentTokens: this.state.currentTokens,
      utilization,
      utilizationPercent: (utilization * 100).toFixed(1) + '%',
      tokenVelocity: this.state.tokenVelocity,
      projectedExhaustion: this.state.projectedExhaustion,
      checkMode: this.state.checkMode,
      compactionSaves: this.state.compactionSaves,
      successfulReloads: this.state.successfulReloads,
      remainingTokens: this.options.contextWindowSize - this.state.currentTokens,
      safetyStatus: this._getSafetyStatus(utilization)
    };
  }

  /**
   * Get safety status based on utilization
   * @private
   */
  _getSafetyStatus(utilization) {
    if (utilization >= this.options.compactionThreshold) {
      return 'EMERGENCY';
    } else if (utilization >= this.options.warningThreshold) {
      return 'CRITICAL';
    } else if (utilization >= this.options.checkpointThreshold) {
      return 'WARNING';
    } else {
      return 'OK';
    }
  }
}

module.exports = OTLPCheckpointBridge;