/**
 * Claude Code Telemetry Bridge
 *
 * Bridges Claude Code's OpenTelemetry metrics to UsageTracker.
 *
 * Purpose:
 * - Captures token usage from actual Claude Code sessions
 * - Feeds data to UsageTracker and DashboardManager
 * - Enables real-time usage monitoring for Claude conversations
 *
 * How it works:
 * 1. Claude Code exports metrics via OpenTelemetry (when enabled)
 * 2. This bridge consumes those metrics
 * 3. Transforms them to UsageTracker format
 * 4. DashboardManager displays in real-time
 *
 * @module core/claude-telemetry-bridge
 */

const { MeterProvider, PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { ConsoleMetricExporter } = require('@opentelemetry/sdk-metrics');
const logger = require('./logger')('ClaudeTelemetryBridge');

class ClaudeTelemetryBridge {
  /**
   * Creates a new telemetry bridge
   *
   * @param {Object} options - Configuration options
   * @param {UsageTracker} options.usageTracker - UsageTracker instance
   * @param {DashboardManager} options.dashboardManager - DashboardManager instance
   * @param {number} options.exportInterval - Metric export interval in ms (default: 5000)
   * @param {boolean} options.enabled - Enable/disable bridge (default: true)
   */
  constructor(options = {}) {
    const {
      usageTracker,
      dashboardManager,
      exportInterval = 5000,
      enabled = true
    } = options;

    if (!usageTracker) {
      throw new Error('UsageTracker is required');
    }

    this.usageTracker = usageTracker;
    this.dashboardManager = dashboardManager;
    this.exportInterval = exportInterval;
    this.enabled = enabled;
    this.meterProvider = null;
    this.reader = null;
    this.sessionStartTime = Date.now();
    this.lastTokens = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0
    };

    logger.info('ClaudeTelemetryBridge initialized', {
      enabled,
      exportInterval,
      hasUsageTracker: !!usageTracker,
      hasDashboard: !!dashboardManager
    });
  }

  /**
   * Starts the telemetry bridge
   *
   * Sets up OpenTelemetry consumer and begins capturing metrics.
   *
   * @returns {Promise<void>}
   */
  async start() {
    if (!this.enabled) {
      logger.info('Telemetry bridge disabled, skipping start');
      return;
    }

    // Check if telemetry is enabled in environment
    if (!process.env.CLAUDE_CODE_ENABLE_TELEMETRY) {
      logger.warn('CLAUDE_CODE_ENABLE_TELEMETRY not set. Setting it now...');
      process.env.CLAUDE_CODE_ENABLE_TELEMETRY = '1';
    }

    try {
      // Create custom metric exporter that forwards to UsageTracker
      const customExporter = this._createUsageExporter();

      // Set up metric reader
      this.reader = new PeriodicExportingMetricReader({
        exporter: customExporter,
        exportIntervalMillis: this.exportInterval,
      });

      // Create meter provider
      this.meterProvider = new MeterProvider({
        readers: [this.reader],
      });

      logger.info('Telemetry bridge started', {
        exportInterval: this.exportInterval
      });
    } catch (error) {
      logger.error('Failed to start telemetry bridge', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Stops the telemetry bridge
   *
   * @returns {Promise<void>}
   */
  async stop() {
    if (this.meterProvider) {
      await this.meterProvider.shutdown();
      this.meterProvider = null;
    }

    logger.info('Telemetry bridge stopped');
  }

  /**
   * Creates a custom exporter that forwards metrics to UsageTracker
   *
   * @returns {Object} - OpenTelemetry metric exporter
   * @private
   */
  _createUsageExporter() {
    return {
      export: async (metrics, resultCallback) => {
        try {
          await this._processMetrics(metrics);
          resultCallback({ code: 0 }); // Success
        } catch (error) {
          logger.error('Failed to process metrics', {
            error: error.message
          });
          resultCallback({ code: 1, error }); // Failure
        }
      },
      shutdown: async () => {
        logger.info('Metric exporter shutting down');
      }
    };
  }

  /**
   * Processes OpenTelemetry metrics and forwards to UsageTracker
   *
   * @param {Object} metrics - Metrics from OpenTelemetry
   * @returns {Promise<void>}
   * @private
   */
  async _processMetrics(metrics) {
    const resourceMetrics = metrics.resourceMetrics;

    for (const rm of resourceMetrics) {
      for (const scopeMetric of rm.scopeMetrics) {
        for (const metric of scopeMetric.metrics) {
          await this._handleMetric(metric);
        }
      }
    }
  }

  /**
   * Handles individual metric
   *
   * @param {Object} metric - Single metric from telemetry
   * @returns {Promise<void>}
   * @private
   */
  async _handleMetric(metric) {
    const metricName = metric.descriptor.name;

    switch (metricName) {
      case 'claude_code.token.usage':
        await this._handleTokenUsage(metric);
        break;

      case 'claude_code.cost.usage':
        await this._handleCostUsage(metric);
        break;

      case 'claude_code.api_request':
        await this._handleApiRequest(metric);
        break;

      default:
        // Ignore unknown metrics
        break;
    }
  }

  /**
   * Handles token usage metric
   *
   * @param {Object} metric - Token usage metric
   * @returns {Promise<void>}
   * @private
   */
  async _handleTokenUsage(metric) {
    // Extract token counts from metric data points
    const dataPoints = metric.dataPoints || [];

    for (const dp of dataPoints) {
      const attributes = dp.attributes || {};
      const value = dp.value || 0;

      // Claude Code segments token usage by type
      const tokenType = attributes.type; // 'input', 'output', 'cache_read', 'cache_creation'
      const model = attributes.model || 'claude-sonnet-4';

      // Calculate incremental tokens (difference from last reading)
      const previousValue = this.lastTokens[tokenType] || 0;
      const incrementalTokens = value - previousValue;
      this.lastTokens[tokenType] = value;

      if (incrementalTokens > 0) {
        // Record usage in UsageTracker
        const usage = {
          orchestrationId: this._generateOrchestrationId(),
          model,
          inputTokens: tokenType === 'input' ? incrementalTokens : 0,
          outputTokens: tokenType === 'output' ? incrementalTokens : 0,
          cacheReadTokens: tokenType === 'cache_read' ? incrementalTokens : 0,
          cacheCreationTokens: tokenType === 'cache_creation' ? incrementalTokens : 0,
          pattern: 'claude-code-session',
          agentId: 'claude-code',
          source: 'telemetry'
        };

        await this.usageTracker.recordUsage(usage);

        logger.debug('Recorded token usage from telemetry', {
          tokenType,
          tokens: incrementalTokens,
          model
        });
      }
    }
  }

  /**
   * Handles cost usage metric
   *
   * @param {Object} metric - Cost usage metric
   * @returns {Promise<void>}
   * @private
   */
  async _handleCostUsage(metric) {
    // Cost is already calculated by Claude Code
    // We can log it or validate against our cost calculator
    const dataPoints = metric.dataPoints || [];

    for (const dp of dataPoints) {
      const cost = dp.value || 0;
      logger.debug('Session cost from telemetry', {
        cost: `$${cost.toFixed(4)}`
      });
    }
  }

  /**
   * Handles API request metric
   *
   * @param {Object} metric - API request metric
   * @returns {Promise<void>}
   * @private
   */
  async _handleApiRequest(metric) {
    // This contains detailed request metadata
    // Can be used for advanced tracking
    const dataPoints = metric.dataPoints || [];

    for (const dp of dataPoints) {
      const attributes = dp.attributes || {};

      logger.debug('API request from telemetry', {
        model: attributes.model,
        duration: attributes.duration,
        status: attributes.status
      });

      // Update dashboard with execution info
      if (this.dashboardManager) {
        this.dashboardManager.updateExecution({
          phase: 'implementation',
          agent: 'claude-code',
          task: 'AI-assisted development',
          model: attributes.model,
          startTime: Date.now() - (attributes.duration || 0)
        });
      }
    }
  }

  /**
   * Generates orchestration ID for telemetry-sourced usage
   *
   * @returns {string} - Orchestration ID
   * @private
   */
  _generateOrchestrationId() {
    return `telemetry-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Gets current session statistics
   *
   * @returns {Object} - Session stats
   */
  getSessionStats() {
    return {
      sessionDuration: Date.now() - this.sessionStartTime,
      totalTokens: Object.values(this.lastTokens).reduce((sum, val) => sum + val, 0),
      tokenBreakdown: { ...this.lastTokens },
      enabled: this.enabled
    };
  }
}

module.exports = ClaudeTelemetryBridge;
