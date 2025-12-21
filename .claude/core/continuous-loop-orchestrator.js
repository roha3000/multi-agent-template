/**
 * Continuous Loop Orchestrator - Main integration class
 *
 * Coordinates all continuous loop components:
 * - Token monitoring and context window tracking
 * - API rate limit enforcement
 * - Intelligent checkpoint optimization
 * - Human-in-loop guardrails
 * - Cost budget monitoring
 * - Real-time dashboard
 *
 * Features:
 * - Automatic checkpoint before limits
 * - Graceful wrap-up
 * - Session resumption
 * - Learning from experience
 * - Compaction detection and recovery
 * - Multi-level safety checks
 *
 * @module continuous-loop-orchestrator
 */

const { createComponentLogger } = require('./logger');
const EventEmitter = require('events');

class ContinuousLoopOrchestrator extends EventEmitter {
  /**
   * Create a continuous loop orchestrator
   *
   * @param {Object} components - System components
   * @param {MemoryStore} components.memoryStore - Memory store
   * @param {UsageTracker} components.usageTracker - Usage tracker
   * @param {StateManager} components.stateManager - State manager
   * @param {MessageBus} components.messageBus - Message bus
   * @param {Object} options - Configuration
   */
  constructor(components, options = {}) {
    super();

    this.logger = createComponentLogger('ContinuousLoopOrchestrator');

    // Required components
    this.memoryStore = components.memoryStore;
    this.usageTracker = components.usageTracker;
    this.stateManager = components.stateManager;
    this.messageBus = components.messageBus;

    // Configuration
    this.options = this._mergeConfig(options);

    // State
    this.state = {
      status: 'idle', // idle, running, paused, wrapping-up, stopped
      sessionId: `session-${Date.now()}`,
      startTime: Date.now(),
      operations: 0,
      checkpoints: 0,
      wrapUpCount: 0,
      lastCheckpoint: null,
      lastOperation: null
    };

    // Initialize components
    this._initializeComponents();

    this.logger.info('ContinuousLoopOrchestrator initialized', {
      sessionId: this.state.sessionId,
      enabled: this.options.enabled,
      components: {
        limitTracker: !!this.limitTracker,
        optimizer: !!this.optimizer,
        hilDetector: !!this.hilDetector,
        dashboard: !!this.dashboard,
        claudeCodeParser: !!this.claudeCodeParser
      }
    });
  }

  /**
   * Initialize all components
   * @private
   */
  _initializeComponents() {
    // 1. Claude API Limit Tracker
    if (this.options.apiLimitTracking.enabled) {
      const ClaudeLimitTracker = require('./claude-limit-tracker');
      this.limitTracker = new ClaudeLimitTracker({
        plan: this.options.apiLimitTracking.plan,
        customLimits: this.options.apiLimitTracking.customLimits,
        warningThreshold: this.options.apiLimitTracking.warningThreshold,
        criticalThreshold: this.options.apiLimitTracking.criticalThreshold,
        emergencyThreshold: this.options.apiLimitTracking.emergencyThreshold,
        enabled: true
      });
      this.logger.info('ClaudeLimitTracker initialized');
    }

    // 2. Checkpoint Optimizer (Learning)
    if (this.options.checkpointOptimizer.enabled) {
      const CheckpointOptimizer = require('./checkpoint-optimizer');
      this.optimizer = new CheckpointOptimizer({
        memoryStore: this.memoryStore,
        usageTracker: this.usageTracker
      }, {
        initialThresholds: this.options.contextMonitoring,
        learningRate: this.options.checkpointOptimizer.learningRate,
        minThreshold: this.options.checkpointOptimizer.minThreshold,
        maxThreshold: this.options.checkpointOptimizer.maxThreshold,
        compactionDetectionEnabled: this.options.checkpointOptimizer.detectCompaction
      });
      this.logger.info('CheckpointOptimizer initialized');
    }

    // 3. Human-In-Loop Detector (Guardrails)
    if (this.options.humanInLoop.enabled) {
      const HumanInLoopDetector = require('./human-in-loop-detector');
      this.hilDetector = new HumanInLoopDetector({
        memoryStore: this.memoryStore
      }, {
        enabled: true,
        confidenceThreshold: this.options.humanInLoop.confidenceThreshold,
        adaptiveThresholds: this.options.humanInLoop.adaptiveThresholds
      });
      this.logger.info('HumanInLoopDetector initialized');
    }

    // 4. Dashboard Manager
    if (this.options.dashboard.enableWeb || this.options.dashboard.enableTerminal) {
      const DashboardManager = require('./dashboard-manager');
      this.dashboard = new DashboardManager({
        usageTracker: this.usageTracker,
        limitTracker: this.limitTracker,
        stateManager: this.stateManager,
        messageBus: this.messageBus,
        claudeCodeParser: this.claudeCodeParser
      }, {
        webPort: this.options.dashboard.webPort,
        enableWebDashboard: this.options.dashboard.enableWeb,
        enableTerminalDashboard: this.options.dashboard.enableTerminal,
        updateInterval: this.options.dashboard.updateInterval,
        contextWindowSize: this.options.contextMonitoring.contextWindowSize,
        loopEnabled: this.options.enabled,
        apiLimitTracking: this.options.apiLimitTracking,
        checkpointOptimizer: this.options.checkpointOptimizer,
        humanInLoop: this.options.humanInLoop,
        configPath: this.options.configPath
      });
      this.logger.info('DashboardManager initialized');
    }

    // 5. Claude Code Usage Parser (JSONL tracking)
    if (this.options.claudeCodeTracking && this.options.claudeCodeTracking.enabled) {
      const ClaudeCodeUsageParser = require('./claude-code-usage-parser');
      this.claudeCodeParser = new ClaudeCodeUsageParser({
        usageTracker: this.usageTracker,
        claudeProjectsPath: this.options.claudeCodeTracking.claudeProjectsPath,
        watchFiles: this.options.claudeCodeTracking.watchFiles,
        scanIntervalMs: this.options.claudeCodeTracking.scanIntervalMs,
        trackHistorical: this.options.claudeCodeTracking.trackHistorical
      });
      this.logger.info('ClaudeCodeUsageParser initialized');
    }
  }

  /**
   * Start the continuous loop system
   */
  async start() {
    if (this.state.status === 'running') {
      this.logger.warn('Already running');
      return;
    }

    this.logger.info('Starting continuous loop system');

    this.state.status = 'running';
    this.state.startTime = Date.now();

    // Start dashboard
    if (this.dashboard) {
      await this.dashboard.start();
    }

    // Start Claude Code usage parser
    if (this.claudeCodeParser) {
      await this.claudeCodeParser.start();
    }

    // Emit started event
    this.emit('started', { sessionId: this.state.sessionId });

    this.logger.info('Continuous loop system started', {
      sessionId: this.state.sessionId
    });
  }

  /**
   * Stop the continuous loop system
   */
  async stop() {
    this.logger.info('Stopping continuous loop system');

    this.state.status = 'stopped';

    // Stop Claude Code usage parser
    if (this.claudeCodeParser) {
      await this.claudeCodeParser.stop();
    }

    // Stop dashboard
    if (this.dashboard) {
      await this.dashboard.stop();
    }

    this.emit('stopped');

    this.logger.info('Continuous loop system stopped');
  }

  /**
   * Pause execution
   */
  pause() {
    if (this.state.status !== 'running') {
      return;
    }

    this.state.status = 'paused';
    this.logger.info('Continuous loop paused');
    this.emit('paused');
  }

  /**
   * Resume execution
   */
  resume() {
    if (this.state.status !== 'paused') {
      return;
    }

    this.state.status = 'running';
    this.logger.info('Continuous loop resumed');
    this.emit('resumed');
  }

  /**
   * Check safety before operation (MAIN ORCHESTRATION POINT)
   *
   * This is called before each operation to ensure it's safe to proceed
   *
   * @param {Object} operation - Operation details
   * @param {string} operation.type - Operation type
   * @param {string} operation.task - Task description
   * @param {string} operation.phase - Current phase
   * @param {number} operation.estimatedTokens - Estimated token usage
   * @param {Object} operation.metadata - Additional metadata
   * @returns {Promise<Object>} Safety check result
   */
  async checkSafety(operation) {
    if (!this.options.enabled) {
      return { safe: true, reason: 'Loop disabled' };
    }

    if (this.state.status === 'paused') {
      return { safe: false, reason: 'Loop paused', action: 'WAIT' };
    }

    if (this.state.status === 'wrapping-up') {
      return { safe: false, reason: 'Wrapping up', action: 'WAIT' };
    }

    const checks = {
      context: null,
      apiLimits: null,
      costBudget: null,
      humanReview: null
    };

    // 1. Check context window
    if (this.options.contextMonitoring.enabled && this.optimizer) {
      checks.context = await this._checkContextWindow(operation);
    }

    // 2. Check API rate limits
    if (this.options.apiLimitTracking.enabled && this.limitTracker) {
      checks.apiLimits = await this._checkAPILimits(operation);
    }

    // 3. Check cost budgets
    if (this.options.costBudgets.enabled && this.usageTracker) {
      checks.costBudget = await this._checkCostBudget(operation);
    }

    // 4. Check human-in-loop guardrails
    if (this.options.humanInLoop.enabled && this.hilDetector) {
      checks.humanReview = await this._checkHumanReview(operation);
    }

    // Aggregate results
    const result = this._aggregateChecks(checks, operation);

    // Update dashboard with current operation
    if (this.dashboard) {
      this.dashboard.updateExecution({
        phase: operation.phase,
        agent: operation.agent,
        task: operation.task,
        startTime: Date.now()
      });
    }

    // Record state
    this.state.lastOperation = {
      timestamp: Date.now(),
      type: operation.type,
      result: result.action
    };

    this.state.operations++;

    return result;
  }

  /**
   * Check context window status
   * @private
   */
  async _checkContextWindow(operation) {
    const currentUsage = this.usageTracker.getSessionUsage();
    const currentTokens = currentUsage.totalTokens || 0;
    const maxTokens = this.options.contextMonitoring.contextWindowSize || 200000;

    // Check for compaction
    if (this.optimizer) {
      const compactionDetected = this.optimizer.detectCompaction(currentTokens);

      if (compactionDetected) {
        this.logger.error('Context compaction detected!');

        if (this.dashboard) {
          this.dashboard.state.events.unshift({
            timestamp: Date.now(),
            type: 'error',
            message: 'Context compaction detected - thresholds auto-adjusted'
          });
        }
      }
    }

    // Get prediction from optimizer
    const prediction = this.optimizer ? this.optimizer.predictCheckpoint({
      contextTokens: currentTokens,
      maxContextTokens: maxTokens,
      taskType: operation.type,
      estimatedRemaining: operation.estimatedTokens || 5000
    }) : null;

    if (prediction?.urgency === 'emergency') {
      return {
        safe: false,
        level: 'EMERGENCY',
        action: 'CHECKPOINT_IMMEDIATELY',
        utilization: prediction.currentUtilization,
        message: 'Emergency: Context window at 95%+'
      };
    }

    if (prediction?.urgency === 'critical') {
      return {
        safe: false,
        level: 'CRITICAL',
        action: 'CHECKPOINT_NOW',
        utilization: prediction.currentUtilization,
        message: `Critical: ${Math.round(prediction.currentUtilization * 100)}% context used`
      };
    }

    if (prediction?.urgency === 'recommended') {
      return {
        safe: true,
        level: 'WARNING',
        action: 'CHECKPOINT_SOON',
        utilization: prediction.currentUtilization,
        message: 'Warning: Approaching checkpoint threshold'
      };
    }

    return {
      safe: true,
      level: 'OK',
      action: 'CONTINUE',
      utilization: currentTokens / maxTokens,
      message: 'Context window OK'
    };
  }

  /**
   * Check API rate limits
   * @private
   */
  async _checkAPILimits(operation) {
    const estimatedTokens = operation.estimatedTokens || 1000;
    return this.limitTracker.canMakeCall(estimatedTokens);
  }

  /**
   * Check cost budget
   * @private
   */
  async _checkCostBudget(operation) {
    if (!this.options.costBudgets.dailyBudgetUSD && !this.options.costBudgets.monthlyBudgetUSD) {
      return { safe: true, level: 'OK', action: 'CONTINUE' };
    }

    const dailyStatus = await this.usageTracker.checkBudgetStatus('day');
    const monthlyStatus = await this.usageTracker.checkBudgetStatus('month');

    if (dailyStatus.exceeded || monthlyStatus.exceeded) {
      return {
        safe: false,
        level: 'EMERGENCY',
        action: 'HALT_IMMEDIATELY',
        message: 'Budget exceeded'
      };
    }

    if (dailyStatus.warning || monthlyStatus.warning) {
      return {
        safe: true,
        level: 'WARNING',
        action: 'CHECKPOINT_SOON',
        message: 'Approaching budget limit'
      };
    }

    return {
      safe: true,
      level: 'OK',
      action: 'CONTINUE',
      message: 'Budget OK'
    };
  }

  /**
   * Check human-in-loop guardrails
   * @private
   */
  async _checkHumanReview(operation) {
    const analysis = await this.hilDetector.analyze({
      task: operation.task,
      phase: operation.phase,
      type: operation.type,
      metadata: operation.metadata || {}
    });

    if (analysis.requiresHuman) {
      // Add to dashboard review queue
      if (this.dashboard) {
        const reviewId = this.dashboard.addHumanReview({
          id: analysis.detectionId,
          task: operation.task,
          reason: analysis.reason,
          confidence: analysis.confidence,
          pattern: analysis.pattern,
          context: {
            phase: operation.phase,
            type: operation.type
          }
        });

        return {
          safe: false,
          level: 'CRITICAL',
          action: 'WAIT_FOR_APPROVAL',
          confidence: analysis.confidence,
          reason: analysis.reason,
          reviewId: reviewId,
          detectionId: analysis.detectionId,
          message: `Human review required: ${analysis.reason}`
        };
      }
    }

    return {
      safe: true,
      level: 'OK',
      action: 'CONTINUE',
      message: 'No human review needed'
    };
  }

  /**
   * Aggregate all safety checks
   * @private
   */
  _aggregateChecks(checks, operation) {
    const results = Object.values(checks).filter(c => c !== null);

    // Find most severe issue
    const emergency = results.find(r => r.level === 'EMERGENCY');
    const critical = results.find(r => r.level === 'CRITICAL');
    const warning = results.find(r => r.level === 'WARNING');

    if (emergency) {
      return {
        safe: false,
        action: emergency.action,
        level: 'EMERGENCY',
        checks,
        message: emergency.message,
        recommendation: 'HALT IMMEDIATELY - Emergency condition detected'
      };
    }

    if (critical) {
      return {
        safe: false,
        action: critical.action,
        level: 'CRITICAL',
        checks,
        message: critical.message,
        recommendation: this._getRecommendation(critical.action)
      };
    }

    if (warning) {
      return {
        safe: true,
        action: warning.action,
        level: 'WARNING',
        checks,
        message: warning.message,
        recommendation: 'Continue but prepare for checkpoint'
      };
    }

    return {
      safe: true,
      action: 'CONTINUE',
      level: 'OK',
      checks,
      message: 'All checks passed',
      recommendation: 'Safe to proceed'
    };
  }

  /**
   * Get recommendation text
   * @private
   */
  _getRecommendation(action) {
    const recommendations = {
      'CHECKPOINT_IMMEDIATELY': 'Save state immediately before continuing',
      'CHECKPOINT_NOW': 'Checkpoint recommended before next operation',
      'CHECKPOINT_SOON': 'Plan checkpoint within next 2-3 operations',
      'WRAP_UP_NOW': 'Initiate graceful wrap-up process',
      'HALT_IMMEDIATELY': 'Stop all operations immediately',
      'WAIT_FOR_APPROVAL': 'Pause and wait for human approval'
    };

    return recommendations[action] || 'Review situation manually';
  }

  /**
   * Create checkpoint
   *
   * @param {Object} options - Checkpoint options
   * @returns {Promise<Object>} Checkpoint result
   */
  async checkpoint(options = {}) {
    this.logger.info('Creating checkpoint');

    const checkpointId = `checkpoint-${Date.now()}`;

    try {
      // Get current state
      const currentUsage = this.usageTracker.getSessionUsage();
      const projectState = this.stateManager ? this.stateManager.export() : {};

      // Create checkpoint record
      const checkpoint = {
        id: checkpointId,
        timestamp: Date.now(),
        sessionId: this.state.sessionId,
        contextTokens: currentUsage.totalTokens || 0,
        maxContextTokens: this.options.contextMonitoring.contextWindowSize || 200000,
        taskType: options.taskType || 'unknown',
        reason: options.reason || 'automatic',
        projectState,
        usage: currentUsage
      };

      // Save to memory store
      if (this.memoryStore) {
        const stmt = this.memoryStore.db.prepare(`
          INSERT INTO checkpoints (
            id, timestamp, session_id, context_tokens, max_tokens,
            task_type, reason, state_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
          checkpoint.id,
          checkpoint.timestamp,
          checkpoint.sessionId,
          checkpoint.contextTokens,
          checkpoint.maxContextTokens,
          checkpoint.taskType,
          checkpoint.reason,
          JSON.stringify({
            projectState: checkpoint.projectState,
            usage: checkpoint.usage
          })
        );
      }

      // Record in optimizer (for learning)
      if (this.optimizer) {
        this.optimizer.recordCheckpoint(checkpoint, true);
      }

      // Update state
      this.state.lastCheckpoint = checkpoint;
      this.state.checkpoints++;

      // Emit event
      if (this.messageBus) {
        this.messageBus.publish('loop:checkpoint:created', checkpoint);
      }

      this.logger.info('Checkpoint created', {
        checkpointId,
        contextTokens: checkpoint.contextTokens,
        utilization: (checkpoint.contextTokens / checkpoint.maxContextTokens * 100).toFixed(1) + '%'
      });

      return {
        success: true,
        checkpointId,
        checkpoint
      };

    } catch (error) {
      this.logger.error('Checkpoint failed', {
        error: error.message,
        stack: error.stack
      });

      // Record failure in optimizer
      if (this.optimizer) {
        this.optimizer.recordCheckpoint({
          id: checkpointId,
          contextTokens: 0,
          maxContextTokens: 200000
        }, false);
      }

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Initiate graceful wrap-up
   *
   * @param {string} reason - Reason for wrap-up
   * @returns {Promise<Object>} Wrap-up result
   */
  async wrapUp(reason = 'manual') {
    this.logger.warn('Initiating wrap-up', { reason });

    this.state.status = 'wrapping-up';

    // Emit event
    if (this.messageBus) {
      this.messageBus.publish('loop:wrapup:started', { reason });
    }

    try {
      // 1. Create final checkpoint
      await this.checkpoint({
        reason: `wrap-up: ${reason}`,
        taskType: 'wrap-up'
      });

      // 2. Save state
      if (this.stateManager) {
        this.stateManager.save();
      }

      // 3. Generate summary
      const summary = this._generateSummary();

      // 4. Update state
      this.state.wrapUpCount++;

      // Emit completion
      if (this.messageBus) {
        this.messageBus.publish('loop:wrapup:completed', { reason, summary });
      }

      this.logger.info('Wrap-up completed', { reason });

      return {
        success: true,
        reason,
        summary
      };

    } catch (error) {
      this.logger.error('Wrap-up failed', {
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate session summary
   * @private
   */
  _generateSummary() {
    const usage = this.usageTracker.getSessionUsage();
    const duration = Date.now() - this.state.startTime;

    const summary = {
      session: {
        id: this.state.sessionId,
        duration: this._formatDuration(duration),
        operations: this.state.operations,
        checkpoints: this.state.checkpoints,
        wrapUps: this.state.wrapUpCount
      },
      usage: {
        totalTokens: usage.totalTokens || 0,
        totalCost: usage.totalCost || 0,
        cacheSavings: usage.cacheSavings || 0
      },
      learning: {
        checkpointOptimizer: this.optimizer ? this.optimizer.getStatistics() : null,
        humanInLoop: this.hilDetector ? this.hilDetector.getStatistics() : null
      }
    };

    return summary;
  }

  /**
   * Format duration in human-readable format
   * @private
   */
  _formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Get current status
   * @returns {Object} Status information
   */
  getStatus() {
    const usage = this.usageTracker.getSessionUsage();

    return {
      state: { ...this.state },
      enabled: this.options.enabled,
      components: {
        limitTracker: this.limitTracker ? this.limitTracker.getStatus() : null,
        optimizer: this.optimizer ? this.optimizer.getStatistics() : null,
        hilDetector: this.hilDetector ? this.hilDetector.getStatistics() : null
      },
      usage,
      duration: Date.now() - this.state.startTime
    };
  }

  /**
   * Merge configuration with defaults
   * @private
   */
  _mergeConfig(options) {
    return {
      enabled: options.enabled !== false,
      configPath: options.configPath || './.claude/settings.local.json',

      contextMonitoring: {
        enabled: options.contextMonitoring?.enabled !== false,
        contextWindowSize: options.contextMonitoring?.contextWindowSize || 200000,
        warningThreshold: options.contextMonitoring?.warningThreshold || 0.80,
        criticalThreshold: options.contextMonitoring?.criticalThreshold || 0.85,
        emergencyThreshold: options.contextMonitoring?.emergencyThreshold || 0.95
      },

      apiLimitTracking: {
        enabled: options.apiLimitTracking?.enabled !== false,
        plan: options.apiLimitTracking?.plan || 'pro',
        customLimits: options.apiLimitTracking?.customLimits || null,
        warningThreshold: options.apiLimitTracking?.warningThreshold || 0.80,
        criticalThreshold: options.apiLimitTracking?.criticalThreshold || 0.90,
        emergencyThreshold: options.apiLimitTracking?.emergencyThreshold || 0.95
      },

      costBudgets: {
        enabled: options.costBudgets?.enabled !== false,
        dailyBudgetUSD: options.costBudgets?.dailyBudgetUSD || null,
        monthlyBudgetUSD: options.costBudgets?.monthlyBudgetUSD || null,
        warningThreshold: options.costBudgets?.warningThreshold || 0.80
      },

      checkpointOptimizer: {
        enabled: options.checkpointOptimizer?.enabled !== false,
        learningRate: options.checkpointOptimizer?.learningRate || 0.1,
        minThreshold: options.checkpointOptimizer?.minThreshold || 0.60,
        maxThreshold: options.checkpointOptimizer?.maxThreshold || 0.85,
        detectCompaction: options.checkpointOptimizer?.detectCompaction !== false
      },

      humanInLoop: {
        enabled: options.humanInLoop?.enabled !== false,
        confidenceThreshold: options.humanInLoop?.confidenceThreshold || 0.70,
        adaptiveThresholds: options.humanInLoop?.adaptiveThresholds !== false
      },

      dashboard: {
        enableWeb: options.dashboard?.enableWeb !== false,
        enableTerminal: options.dashboard?.enableTerminal !== false,
        webPort: options.dashboard?.webPort || 3030,
        updateInterval: options.dashboard?.updateInterval || 2000
      }
    };
  }

  /**
   * Initialize database tables
   * @private
   */
  _initializeDatabase() {
    if (!this.memoryStore) {
      return;
    }

    try {
      this.memoryStore.db.exec(`
        CREATE TABLE IF NOT EXISTS checkpoints (
          id TEXT PRIMARY KEY,
          timestamp INTEGER NOT NULL,
          session_id TEXT NOT NULL,
          context_tokens INTEGER NOT NULL,
          max_tokens INTEGER NOT NULL,
          task_type TEXT,
          reason TEXT,
          state_json TEXT,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_checkpoints_session
        ON checkpoints(session_id);

        CREATE INDEX IF NOT EXISTS idx_checkpoints_timestamp
        ON checkpoints(timestamp);
      `);
    } catch (error) {
      this.logger.warn('Failed to create checkpoint tables', {
        error: error.message
      });
    }
  }
}

// Initialize database on module load
ContinuousLoopOrchestrator.prototype._initializeDatabase.call({
  memoryStore: null,
  logger: { warn: () => {} }
});

module.exports = ContinuousLoopOrchestrator;
