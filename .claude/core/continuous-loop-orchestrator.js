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
 * - Task complexity analysis
 * - Competitive planning for complex tasks
 * - Plan evaluation and comparison
 * - Execution confidence monitoring
 * - Security validation
 *
 * Features:
 * - Automatic checkpoint before limits
 * - Graceful wrap-up
 * - Session resumption
 * - Learning from experience
 * - Compaction detection and recovery
 * - Multi-level safety checks
 * - Multi-plan generation for complex tasks
 * - Confidence-based execution tracking
 * - Security-hardened input validation
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

    // Initialize database tables
    this._initializeDatabase();

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
        claudeCodeParser: !!this.claudeCodeParser,
        complexityAnalyzer: !!this.complexityAnalyzer,
        competitivePlanner: !!this.competitivePlanner,
        planEvaluator: !!this.planEvaluator,
        confidenceMonitor: !!this.confidenceMonitor,
        securityValidator: !!this.securityValidator
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
      this.limitTracker = new ClaudeLimitTracker(
        { memoryStore: this.memoryStore },
        {
          plan: this.options.apiLimitTracking.plan,
          customLimits: this.options.apiLimitTracking.customLimits,
          thresholds: {
            warning: this.options.apiLimitTracking.warningThreshold,
            critical: this.options.apiLimitTracking.criticalThreshold,
            emergency: this.options.apiLimitTracking.emergencyThreshold
          },
          enabled: true
        }
      );
      this.logger.info('ClaudeLimitTracker initialized');
    }

    // 2. Checkpoint Optimizer (Learning)
    if (this.options.checkpointOptimizer.enabled) {
      const CheckpointOptimizer = require('./checkpoint-optimizer');
      this.optimizer = new CheckpointOptimizer({
        memoryStore: this.memoryStore,
        usageTracker: this.usageTracker
      }, {
        initialThresholds: {
          context: this.options.contextMonitoring.checkpointThreshold || this.options.contextMonitoring.warningThreshold || 0.75,
          buffer: this.options.contextMonitoring.bufferTokens || 15000
        },
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
    if (this.options.dashboard.enabled && (this.options.dashboard.enableWeb || this.options.dashboard.enableTerminal)) {
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

    // 6. Security Validator (Input validation and threat detection)
    if (this.options.securityValidation?.enabled !== false) {
      const SecurityValidator = require('./security-validator');
      this.securityValidator = new SecurityValidator({
        mode: this.options.securityValidation?.mode || 'audit',
        logThreats: this.options.securityValidation?.logThreats !== false,
        maxDescriptionLength: this.options.securityValidation?.maxDescriptionLength || 5000
      });
      this.logger.info('SecurityValidator initialized', {
        mode: this.securityValidator.getMode()
      });
    }

    // 7. Complexity Analyzer (Task complexity scoring)
    if (this.options.complexityAnalysis?.enabled !== false) {
      const ComplexityAnalyzer = require('./complexity-analyzer');
      this.complexityAnalyzer = new ComplexityAnalyzer({
        memoryStore: this.memoryStore,
        taskManager: null // Will be set if task manager is available
      });
      this.logger.info('ComplexityAnalyzer initialized');
    }

    // 8. Plan Evaluator (Plan scoring and comparison)
    if (this.options.planEvaluation?.enabled !== false) {
      const { PlanEvaluator } = require('./plan-evaluator');
      this.planEvaluator = new PlanEvaluator({
        criteria: this.options.planEvaluation?.criteria
      });
      this.logger.info('PlanEvaluator initialized');
    }

    // 9. Competitive Planner (Multi-plan generation)
    if (this.options.competitivePlanning?.enabled !== false) {
      const CompetitivePlanner = require('./competitive-planner');
      this.competitivePlanner = new CompetitivePlanner({
        complexityAnalyzer: this.complexityAnalyzer,
        planEvaluator: this.planEvaluator,
        complexityThreshold: this.options.competitivePlanning?.complexityThreshold || 40
      });
      this.logger.info('CompetitivePlanner initialized', {
        complexityThreshold: this.competitivePlanner.getComplexityThreshold()
      });
    }

    // 10. Confidence Monitor (Execution confidence tracking)
    if (this.options.confidenceMonitoring?.enabled !== false) {
      const ConfidenceMonitor = require('./confidence-monitor');
      this.confidenceMonitor = new ConfidenceMonitor();

      // Configure thresholds if provided
      if (this.options.confidenceMonitoring?.thresholds) {
        const t = this.options.confidenceMonitoring.thresholds;
        if (t.warning) this.confidenceMonitor.setThreshold('warning', t.warning);
        if (t.critical) this.confidenceMonitor.setThreshold('critical', t.critical);
        if (t.emergency) this.confidenceMonitor.setThreshold('emergency', t.emergency);
      }

      // Wire confidence events to orchestrator
      this.confidenceMonitor.on('confidence:warning', (data) => {
        this.emit('confidence:warning', data);
        this.logger.warn('Confidence warning', data);
      });
      this.confidenceMonitor.on('confidence:critical', (data) => {
        this.emit('confidence:critical', data);
        this.logger.error('Confidence critical', data);
      });

      this.logger.info('ConfidenceMonitor initialized', {
        thresholds: this.confidenceMonitor.getThresholds()
      });
    }
  }

  /**
   * Initialize (no-op since initialization happens in constructor)
   * This method exists for compatibility with test suites
   */
  async initialize() {
    // Already initialized in constructor
    return Promise.resolve();
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
   * Validate input for security threats
   * @param {string} input - Input to validate
   * @param {string} type - Type of input (description, taskId, phase, path, command)
   * @returns {Object} Validation result
   */
  validateInput(input, type = 'description') {
    if (!this.securityValidator) {
      return { valid: true, threats: [], sanitized: input };
    }

    const result = this.securityValidator.validate(input, type);

    if (!result.valid && this.options.securityValidation.mode === 'enforce') {
      this.logger.warn('Security validation failed', {
        type,
        threats: result.threats.map(t => t.type)
      });
    }

    return result;
  }

  /**
   * Analyze task complexity and determine execution strategy
   * @param {Object} task - Task to analyze
   * @returns {Promise<Object>} Complexity analysis with strategy
   */
  async analyzeTaskComplexity(task) {
    if (!this.complexityAnalyzer) {
      return { score: 50, strategy: 'standard', breakdown: {} };
    }

    const analysis = await this.complexityAnalyzer.analyze(task);

    this.logger.info('Task complexity analyzed', {
      taskId: task.id,
      score: analysis.score,
      strategy: analysis.strategy
    });

    // Update confidence monitor with complexity
    if (this.confidenceMonitor) {
      this.confidenceMonitor.update('qualityScore', Math.max(0, 100 - analysis.score));
    }

    return analysis;
  }

  /**
   * Generate competing plans for a complex task
   * @param {Object} task - Task to plan for
   * @param {Object} options - Planning options
   * @returns {Promise<Object>} Generated plans with comparison
   */
  async generateCompetingPlans(task, options = {}) {
    if (!this.competitivePlanner) {
      return { plans: [], winner: null, needsHumanReview: false };
    }

    // First analyze complexity if not provided
    let complexity = options.complexity;
    if (!complexity && this.complexityAnalyzer) {
      const analysis = await this.complexityAnalyzer.analyze(task);
      complexity = analysis.score;
    }

    const result = await this.competitivePlanner.generatePlans(task, {
      ...options,
      complexity
    });

    this.logger.info('Competing plans generated', {
      taskId: task.id,
      planCount: result.plans.length,
      strategies: result.strategies,
      needsReview: result.needsHumanReview
    });

    // If plans need human review, add to dashboard queue
    if (result.needsHumanReview && this.dashboard) {
      this.dashboard.addHumanReview({
        id: `plan-review-${task.id}`,
        task: task.title || task.id,
        reason: 'Multiple plans with similar scores - human selection recommended',
        confidence: 0.5,
        pattern: 'plan-comparison',
        context: {
          planCount: result.plans.length,
          strategies: result.strategies
        }
      });
    }

    return result;
  }

  /**
   * Evaluate and compare plans
   * @param {Array} plans - Plans to compare
   * @returns {Object} Comparison result with winner
   */
  comparePlans(plans) {
    if (!this.planEvaluator) {
      return { winner: plans[0], rankings: [], needsReview: false };
    }

    const result = this.planEvaluator.comparePlans(plans);

    this.logger.info('Plans compared', {
      planCount: plans.length,
      winnerId: result.winner?.planId,
      margin: result.margin,
      needsReview: result.needsReview
    });

    return result;
  }

  /**
   * Track execution progress and update confidence
   * @param {Object} progress - Progress update
   * @param {number} progress.completed - Completed items
   * @param {number} progress.total - Total items
   * @param {number} progress.iteration - Current iteration
   * @param {number} progress.errors - Error count
   * @param {number} progress.qualityScore - Quality score (0-100)
   */
  trackProgress(progress) {
    if (!this.confidenceMonitor) {
      return;
    }

    if (progress.completed !== undefined && progress.total !== undefined) {
      this.confidenceMonitor.trackProgress(progress.completed, progress.total);
    }

    if (progress.iteration !== undefined) {
      this.confidenceMonitor.trackIteration(progress.iteration);
    }

    if (progress.errors !== undefined) {
      this.confidenceMonitor.update('errorRate', progress.errors);
    }

    if (progress.qualityScore !== undefined) {
      this.confidenceMonitor.update('qualityScore', progress.qualityScore);
    }

    // Emit confidence update
    const state = this.confidenceMonitor.getState();
    this.emit('confidence:updated', state);

    // Update dashboard if available
    if (this.dashboard && state.thresholdState !== 'normal') {
      this.dashboard.state.events.unshift({
        timestamp: Date.now(),
        type: state.thresholdState === 'emergency' ? 'error' : 'warning',
        message: `Confidence ${state.thresholdState}: ${state.confidence.toFixed(1)}%`
      });
    }
  }

  /**
   * Get current confidence state
   * @returns {Object} Confidence state
   */
  getConfidenceState() {
    if (!this.confidenceMonitor) {
      return { confidence: 100, thresholdState: 'normal', signals: {} };
    }
    return this.confidenceMonitor.getState();
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
      security: null,
      context: null,
      apiLimits: null,
      costBudget: null,
      humanReview: null,
      confidence: null
    };

    // 0. Security validation (if enabled)
    if (this.options.securityValidation?.enabled && this.securityValidator) {
      checks.security = this._checkSecurityValidation(operation);
    }

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

    // 5. Check confidence level
    if (this.options.confidenceMonitoring?.enabled && this.confidenceMonitor) {
      checks.confidence = this._checkConfidence(operation);
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
   * Check security validation
   * @private
   */
  _checkSecurityValidation(operation) {
    const inputs = [
      { value: operation.task, type: 'description' },
      { value: operation.phase, type: 'phase' }
    ];

    const threats = [];
    for (const input of inputs) {
      if (input.value) {
        const result = this.securityValidator.validate(input.value, input.type);
        if (!result.valid) {
          threats.push(...result.threats);
        }
      }
    }

    if (threats.length > 0) {
      const isEnforce = this.options.securityValidation.mode === 'enforce';
      return {
        safe: !isEnforce,
        level: isEnforce ? 'CRITICAL' : 'WARNING',
        action: isEnforce ? 'BLOCK' : 'CONTINUE',
        threats,
        message: `Security threats detected: ${threats.map(t => t.type).join(', ')}`
      };
    }

    return {
      safe: true,
      level: 'OK',
      action: 'CONTINUE',
      message: 'Security validation passed'
    };
  }

  /**
   * Check confidence level
   * @private
   */
  _checkConfidence(operation) {
    const state = this.confidenceMonitor.getState();
    const thresholdState = state.thresholdState;

    if (thresholdState === 'emergency') {
      return {
        safe: false,
        level: 'EMERGENCY',
        action: 'HALT_IMMEDIATELY',
        confidence: state.confidence,
        message: `Emergency: Confidence at ${state.confidence.toFixed(1)}%`
      };
    }

    if (thresholdState === 'critical') {
      return {
        safe: false,
        level: 'CRITICAL',
        action: 'WAIT_FOR_APPROVAL',
        confidence: state.confidence,
        requiresHuman: true,
        reason: 'Low execution confidence',
        message: `Critical: Confidence at ${state.confidence.toFixed(1)}%`
      };
    }

    if (thresholdState === 'warning') {
      return {
        safe: true,
        level: 'WARNING',
        action: 'CONTINUE',
        confidence: state.confidence,
        message: `Warning: Confidence at ${state.confidence.toFixed(1)}%`
      };
    }

    return {
      safe: true,
      level: 'OK',
      action: 'CONTINUE',
      confidence: state.confidence,
      message: 'Confidence OK'
    };
  }

  /**
   * Check context window status
   * @private
   */
  async _checkContextWindow(operation) {
    if (!this.usageTracker && !this.otlpBridge) {
      return {
        safe: true,
        level: 'OK',
        action: 'CONTINUE',
        utilization: 0,
        message: 'Context monitoring unavailable (no usage tracker or OTLP bridge)'
      };
    }

    // Get current token count from OTLP bridge if available, otherwise from usage tracker
    let currentTokens = 0;
    if (this.otlpBridge) {
      currentTokens = this.otlpBridge.state.currentTokens || 0;
    } else if (this.usageTracker) {
      const currentUsage = this.usageTracker.getSessionUsage();
      currentTokens = currentUsage.totalTokens || 0;
    }

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

    // First check current status (without projection)
    // This gives us the current warning level
    const currentStatus = this.limitTracker.getStatus();

    // If already at warning/critical/emergency, return current status
    if (currentStatus.level && currentStatus.level !== 'OK') {
      return currentStatus;
    }

    // Otherwise, check if next call would be safe (with projection)
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
          requiresHuman: true,
          confidence: analysis.confidence,
          reason: analysis.reason,
          reviewId: reviewId,
          detectionId: analysis.detectionId,
          message: `Human review required: ${analysis.reason}`
        };
      }

      // If no dashboard, use detectionId as reviewId
      return {
        safe: false,
        level: 'CRITICAL',
        action: 'WAIT_FOR_APPROVAL',
        requiresHuman: true,
        confidence: analysis.confidence,
        reason: analysis.reason,
        reviewId: analysis.detectionId,  // Use detectionId when no dashboard
        detectionId: analysis.detectionId,
        message: `Human review required: ${analysis.reason}`
      };
    }

    return {
      safe: true,
      level: 'OK',
      action: 'CONTINUE',
      requiresHuman: false,
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
        recommendation: 'HALT IMMEDIATELY - Emergency condition detected',
        // Spread emergency-specific fields to top level
        ...( emergency.reviewId ? { reviewId: emergency.reviewId, detectionId: emergency.detectionId, requiresHuman: emergency.requiresHuman, confidence: emergency.confidence } : {})
      };
    }

    if (critical) {
      return {
        safe: false,
        action: critical.action,
        level: 'CRITICAL',
        checks,
        message: critical.message,
        recommendation: this._getRecommendation(critical.action),
        // Spread critical-specific fields to top level (includes reviewId, detectionId for human reviews)
        ...( critical.reviewId ? { reviewId: critical.reviewId, detectionId: critical.detectionId, requiresHuman: critical.requiresHuman, confidence: critical.confidence } : {})
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
      action: 'PROCEED',
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

    // Include random component to avoid collision when creating concurrent checkpoints
    const checkpointId = `checkpoint-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

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
   * Record human feedback for a review
   *
   * @param {string} reviewId - Review ID or detection ID
   * @param {Object} feedback - Feedback data
   * @param {boolean} feedback.approved - Whether the action was approved
   * @param {boolean} feedback.wasCorrect - Whether the detection was correct
   * @param {string} feedback.actualNeed - Actual need (yes/no)
   * @param {string} feedback.comment - Optional comment
   * @returns {Promise<Object>} Feedback result
   */
  async recordHumanFeedback(reviewId, feedback) {
    this.logger.info('Recording human feedback', { reviewId });

    try {
      if (!this.hilDetector) {
        this.logger.warn('HumanInLoopDetector not available');
        return {
          success: false,
          error: 'HumanInLoopDetector not available',
          approved: feedback.approved
        };
      }

      // Record feedback with detector (it handles detection lookup internally)
      const result = await this.hilDetector.recordFeedback(reviewId, {
        wasCorrect: feedback.wasCorrect,
        actualNeed: feedback.actualNeed,
        comment: feedback.comment
      });

      // Update dashboard if available
      if (this.dashboard) {
        this.dashboard.updateReviewStatus(reviewId, {
          status: feedback.approved ? 'approved' : 'rejected',
          feedback: feedback.comment
        });
      }

      this.logger.info('Human feedback recorded', {
        reviewId,
        wasCorrect: feedback.wasCorrect,
        approved: feedback.approved,
        learnedFromFeedback: result.learned
      });

      return {
        success: true,
        approved: feedback.approved,
        learned: result.learned,
        updated: result.updated
      };

    } catch (error) {
      this.logger.error('Failed to record feedback', {
        error: error.message,
        reviewId
      });

      return {
        success: false,
        error: error.message,
        approved: feedback.approved
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
      sessionId: this.state.sessionId,
      durationMs: duration,
      duration: this._formatDuration(duration),
      operationsCompleted: this.state.operations,
      checkpointsCreated: this.state.checkpoints,
      wrapUps: this.state.wrapUpCount,
      totalTokens: usage.totalTokens || 0,
      totalCost: usage.totalCost || 0,
      cacheSavings: usage.cacheSavings || 0,
      learningStats: {
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
    const hilStats = this.hilDetector ? this.hilDetector.getStatistics() : null;
    const optimizerStats = this.optimizer ? this.optimizer.getStatistics() : null;
    const limitTrackerStats = this.limitTracker ? this.limitTracker.getStatus() : null;

    // Get new component stats
    const confidenceState = this.confidenceMonitor ? this.confidenceMonitor.getState() : null;
    const securityStats = this.securityValidator ? this.securityValidator.getStats() : null;
    const complexityCache = this.complexityAnalyzer ? this.complexityAnalyzer.getCacheStats() : null;

    return {
      // Flatten state properties to top level for test compatibility
      sessionId: this.state.sessionId,
      status: this.state.status,
      startTime: this.state.startTime,
      operations: this.state.operations,
      checkpoints: this.state.checkpoints,
      wrapUpCount: this.state.wrapUpCount,
      lastCheckpoint: this.state.lastCheckpoint,
      lastOperation: this.state.lastOperation,

      enabled: this.options.enabled,
      uptimeMs: Date.now() - this.state.startTime,
      components: {
        limitTracker: limitTrackerStats,
        optimizer: optimizerStats,
        hilDetector: hilStats,
        // New claude-swarm components
        complexityAnalyzer: complexityCache,
        competitivePlanner: this.competitivePlanner ? { enabled: true } : null,
        planEvaluator: this.planEvaluator ? { enabled: true } : null,
        confidenceMonitor: confidenceState,
        securityValidator: securityStats
      },
      // Convenience aliases for common access patterns
      humanInLoop: hilStats,
      checkpointOptimizer: optimizerStats,
      apiLimits: limitTrackerStats,
      // New component aliases
      confidence: confidenceState,
      security: securityStats,
      // Usage and cost information
      usage,
      costs: {
        total: usage.totalCost || 0,
        sessionCost: usage.totalCost || 0,
        cacheSavings: usage.cacheSavings || 0
      },
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
        checkpointThreshold: options.contextMonitoring?.checkpointThreshold || 0.75,
        bufferTokens: options.contextMonitoring?.bufferTokens || 15000,
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
        enabled: options.dashboard?.enabled !== false,
        enableWeb: options.dashboard?.enableWeb !== false,
        enableTerminal: options.dashboard?.enableTerminal !== false,
        webPort: options.dashboard?.webPort || 3030,
        updateInterval: options.dashboard?.updateInterval || 2000
      },

      // Claude-swarm integration components
      securityValidation: {
        enabled: options.securityValidation?.enabled !== false,
        mode: options.securityValidation?.mode || 'audit', // 'audit' or 'enforce'
        logThreats: options.securityValidation?.logThreats !== false,
        maxDescriptionLength: options.securityValidation?.maxDescriptionLength || 5000
      },

      complexityAnalysis: {
        enabled: options.complexityAnalysis?.enabled !== false,
        fastPathThreshold: options.complexityAnalysis?.fastPathThreshold || 40,
        competitiveThreshold: options.complexityAnalysis?.competitiveThreshold || 70
      },

      planEvaluation: {
        enabled: options.planEvaluation?.enabled !== false,
        criteria: options.planEvaluation?.criteria || null // Use defaults if null
      },

      competitivePlanning: {
        enabled: options.competitivePlanning?.enabled !== false,
        complexityThreshold: options.competitivePlanning?.complexityThreshold || 40,
        maxPlans: options.competitivePlanning?.maxPlans || 3
      },

      confidenceMonitoring: {
        enabled: options.confidenceMonitoring?.enabled !== false,
        thresholds: {
          warning: options.confidenceMonitoring?.thresholds?.warning || 60,
          critical: options.confidenceMonitoring?.thresholds?.critical || 40,
          emergency: options.confidenceMonitoring?.thresholds?.emergency || 25
        }
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
