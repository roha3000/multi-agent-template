/**
 * Context Tracking Bridge
 *
 * Connects the Real Context Tracker to existing dashboard and checkpoint systems.
 * Replaces simulated data with actual context tracking.
 */

const RealContextTracker = require('./real-context-tracker');
const { createComponentLogger } = require('./logger');

class ContextTrackingBridge {
  constructor(options = {}) {
    this.logger = createComponentLogger('ContextTrackingBridge');

    // Initialize real tracker
    this.tracker = new RealContextTracker({
      maxContextWindow: options.maxContextWindow || 200000,
      checkpointThresholds: options.checkpointThresholds || [70, 85, 95],
      ...options
    });

    // References to existing systems
    this.dashboardManager = options.dashboardManager;
    this.checkpointOptimizer = options.checkpointOptimizer;
    this.sessionProcessor = options.sessionProcessor;
    this.otlpReceiver = options.otlpReceiver;

    this._setupEventHandlers();
    this._patchExistingSystems();

    this.logger.info('Context Tracking Bridge initialized');
  }

  /**
   * Setup event handlers for real tracker
   */
  _setupEventHandlers() {
    // Handle context updates
    this.tracker.on('contextUpdate', (data) => {
      this._updateDashboard(data);
      this._updateSessionProcessor(data);
    });

    // Handle checkpoint events
    this.tracker.on('checkpoint', (data) => {
      this._triggerCheckpoint(data);
    });

    // Handle emergency events
    this.tracker.on('emergency', (data) => {
      this._handleEmergency(data);
    });
  }

  /**
   * Patch existing systems to use real data
   */
  _patchExistingSystems() {
    // Patch SessionAwareMetricProcessor if it exists
    if (this.sessionProcessor) {
      const originalProcess = this.sessionProcessor.processMetrics.bind(this.sessionProcessor);

      this.sessionProcessor.processMetrics = async (otlpData, context) => {
        // Process through real tracker first
        for (const metric of this._extractMetrics(otlpData)) {
          this.tracker.processOTLPMetric(metric);
        }

        // Then continue with original processing
        return originalProcess(otlpData, context);
      };

      // Override contextUtilization calculation
      const originalGetSessions = this.sessionProcessor.getActiveSessions.bind(this.sessionProcessor);

      this.sessionProcessor.getActiveSessions = () => {
        const sessions = originalGetSessions();

        // Replace with real context data
        for (const session of sessions) {
          const realPercentage = this.tracker.getContextPercentage(session.id);
          session.contextUtilization = realPercentage / 100; // Convert to 0-1 range
          session.contextWindow = {
            current: Math.floor(realPercentage * 2000), // Approximate tokens
            max: this.tracker.options.maxContextWindow,
            utilizationHistory: session.contextWindow?.utilizationHistory || []
          };
        }

        return sessions;
      };

      this.logger.info('Patched SessionAwareMetricProcessor to use real context');
    }

    // Patch OTLP Receiver if it exists
    if (this.otlpReceiver) {
      const originalProcess = this.otlpReceiver.processMetrics.bind(this.otlpReceiver);

      this.otlpReceiver.processMetrics = async (otlpData) => {
        // Process through real tracker
        for (const metric of this._extractMetrics(otlpData)) {
          this.tracker.processOTLPMetric(metric);
        }

        // Continue with original
        return originalProcess(otlpData);
      };

      this.logger.info('Patched OTLP Receiver to use real context');
    }
  }

  /**
   * Extract metrics from OTLP data
   */
  _extractMetrics(otlpData) {
    const metrics = [];

    if (otlpData?.resourceMetrics) {
      for (const rm of otlpData.resourceMetrics) {
        for (const sm of rm.scopeMetrics || []) {
          for (const metric of sm.metrics || []) {
            // Extract data points
            const dataPoints = metric.sum?.dataPoints ||
                             metric.gauge?.dataPoints ||
                             metric.histogram?.dataPoints || [];

            for (const dp of dataPoints) {
              metrics.push({
                name: metric.name,
                value: dp.asInt || dp.asDouble || dp.value || 0,
                attributes: this._extractAttributes(dp.attributes || []),
                timestamp: dp.timeUnixNano
              });
            }
          }
        }
      }
    }

    return metrics;
  }

  /**
   * Extract attributes to object
   */
  _extractAttributes(attributes) {
    const obj = {};
    for (const attr of attributes) {
      obj[attr.key] = attr.value?.stringValue ||
                      attr.value?.intValue ||
                      attr.value?.doubleValue ||
                      attr.value?.boolValue;
    }
    return obj;
  }

  /**
   * Update dashboard with real context
   */
  _updateDashboard(data) {
    if (!this.dashboardManager) return;

    try {
      // Update dashboard state with real data
      const state = this.dashboardManager.getState();

      // Replace simulated context with real data
      state.contextWindow = {
        current: data.totalTokens,
        max: this.tracker.options.maxContextWindow,
        percentage: data.percentage,
        status: data.percentage >= 95 ? 'critical' :
               data.percentage >= 85 ? 'warning' :
               data.percentage >= 70 ? 'caution' : 'normal'
      };

      // Update token usage
      state.tokenUsage = {
        input: data.breakdown.input,
        output: data.breakdown.output,
        cacheRead: data.breakdown.cacheRead,
        cacheCreation: data.breakdown.cacheCreation,
        total: data.totalTokens
      };

      // Broadcast update
      this.dashboardManager.broadcastUpdate(state);

      this.logger.debug('Dashboard updated with real context', {
        percentage: data.percentage.toFixed(2)
      });
    } catch (error) {
      this.logger.error('Failed to update dashboard', {
        error: error.message
      });
    }
  }

  /**
   * Update session processor with real data
   */
  _updateSessionProcessor(data) {
    if (!this.sessionProcessor) return;

    // Session processor is already patched, just log
    this.logger.debug('Session processor using real context', {
      sessionId: data.sessionId,
      percentage: data.percentage.toFixed(2)
    });
  }

  /**
   * Trigger checkpoint
   */
  _triggerCheckpoint(data) {
    this.logger.warn('CHECKPOINT TRIGGERED', {
      threshold: data.threshold,
      percentage: data.percentage.toFixed(2),
      totalTokens: data.totalTokens
    });

    if (this.checkpointOptimizer) {
      this.checkpointOptimizer.createCheckpoint({
        reason: `context-threshold-${data.threshold}`,
        contextUsage: data.percentage / 100,
        automatic: true
      });
    }

    // Create checkpoint file
    const fs = require('fs');
    const path = require('path');

    const checkpointDir = path.join(process.cwd(), '.claude', 'checkpoints');
    if (!fs.existsSync(checkpointDir)) {
      fs.mkdirSync(checkpointDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const checkpointFile = path.join(checkpointDir, `auto-checkpoint-${data.threshold}-${timestamp}.json`);

    fs.writeFileSync(checkpointFile, JSON.stringify({
      timestamp: data.timestamp,
      threshold: data.threshold,
      contextUsage: data.percentage / 100,
      totalTokens: data.totalTokens,
      sessionId: data.sessionId,
      automatic: true,
      reason: `Automatic checkpoint at ${data.threshold}% context usage`
    }, null, 2));

    this.logger.info('Checkpoint saved', { file: checkpointFile });
  }

  /**
   * Handle emergency context situation
   */
  _handleEmergency(data) {
    this.logger.error('EMERGENCY CONTEXT SITUATION', data);

    // Broadcast emergency to dashboard
    if (this.dashboardManager) {
      this.dashboardManager.broadcastUpdate({
        emergency: true,
        message: data.message,
        percentage: data.percentage,
        action: 'IMMEDIATE CHECKPOINT REQUIRED'
      });
    }

    // Force checkpoint
    this._triggerCheckpoint({
      ...data,
      threshold: 95,
      timestamp: new Date().toISOString()
    });

    // Create emergency file
    const fs = require('fs');
    const path = require('path');

    const emergencyFile = path.join(process.cwd(), 'EMERGENCY_CONTEXT.md');
    fs.writeFileSync(emergencyFile, `# EMERGENCY: Context Near Exhaustion!

**Timestamp**: ${new Date().toISOString()}
**Session**: ${data.sessionId}
**Context Usage**: ${data.percentage.toFixed(2)}%
**Total Tokens**: ${data.totalTokens}

## IMMEDIATE ACTION REQUIRED

1. Save all work immediately
2. Clear context or start new session
3. Review checkpoint at .claude/checkpoints/

## Auto-checkpoint has been created

The system has automatically saved state to prevent data loss.
`);

    this.logger.error('Emergency file created', { file: emergencyFile });
  }

  /**
   * Get current context for all sessions
   */
  getCurrentContext() {
    return this.tracker.getActiveSessions();
  }

  /**
   * Manually update context (for testing)
   */
  manualUpdate(sessionId, percentage) {
    this.tracker.manualUpdate(sessionId, percentage);
  }

  /**
   * Start the bridge
   */
  start() {
    this.logger.info('Context Tracking Bridge started');

    // Start with current session if available
    const currentSessionId = process.env.CLAUDE_SESSION_ID || 'current';
    this.tracker.trackSession(currentSessionId);
  }

  /**
   * Stop the bridge
   */
  stop() {
    this.tracker.stop();
    this.logger.info('Context Tracking Bridge stopped');
  }
}

module.exports = ContextTrackingBridge;