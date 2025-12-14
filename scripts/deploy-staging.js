#!/usr/bin/env node

/**
 * Deploy to Staging Environment
 *
 * This script sets up the complete OTLP + Continuous Loop system in staging mode
 * with health checks, monitoring, and production-ready features.
 *
 * Features:
 * - Health check endpoints
 * - Prometheus metrics export
 * - Monitoring dashboards
 * - Alerting rules
 * - Load testing capabilities
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const http = require('http');

// Components
const OTLPReceiver = require('../.claude/core/otlp-receiver');
const MetricProcessor = require('../.claude/core/metric-processor');
const OTLPCheckpointBridge = require('../.claude/core/otlp-checkpoint-bridge');
const ContinuousLoopOrchestrator = require('../.claude/core/continuous-loop-orchestrator');
const CheckpointOptimizer = require('../.claude/core/checkpoint-optimizer');
const StateManager = require('../.claude/core/state-manager');
const MemoryStore = require('../.claude/core/memory-store');
const UsageTracker = require('../.claude/core/usage-tracker');
const MessageBus = require('../.claude/core/message-bus');
const tokenCounter = require('../.claude/core/token-counter');
const { createComponentLogger } = require('../.claude/core/logger');

class StagingEnvironment {
  constructor(config = {}) {
    this.logger = createComponentLogger('StagingEnvironment');

    this.config = {
      // Ports
      otlpPort: process.env.STAGING_OTLP_PORT || 4318,
      healthPort: process.env.STAGING_HEALTH_PORT || 8080,
      dashboardPort: process.env.STAGING_DASHBOARD_PORT || 3030,
      prometheusPort: process.env.STAGING_PROMETHEUS_PORT || 9090,

      // Paths
      dataDir: path.join(__dirname, '..', '.claude', 'staging'),
      logsDir: path.join(__dirname, '..', 'logs', 'staging'),

      // Features
      enableHealthChecks: true,
      enablePrometheus: true,
      enableAlerting: true,
      enableDashboard: true,
      enableLoadTest: false,

      // Monitoring
      metricsInterval: 5000,
      healthCheckInterval: 10000,

      ...config
    };

    // Ensure directories exist
    this._ensureDirectories();

    // Components
    this.components = {};
    this.services = {};
    this.metrics = {
      startTime: Date.now(),
      requests: 0,
      errors: 0,
      checkpoints: 0,
      compactionSaves: 0,
      contextReloads: 0
    };
  }

  /**
   * Initialize all components
   */
  async initialize() {
    this.logger.info('Initializing staging environment', this.config);

    try {
      // 1. Core components
      this.components.memoryStore = new MemoryStore(
        path.join(this.config.dataDir, 'staging.db')
      );

      this.components.messageBus = new MessageBus();

      this.components.stateManager = new StateManager(
        { memoryStore: this.components.memoryStore },
        { persistInterval: 30000 }
      );

      this.components.usageTracker = new UsageTracker(
        this.components.memoryStore,
        { sessionId: `staging-${Date.now()}` }
      );

      // 2. OTLP components
      this.components.metricProcessor = new MetricProcessor({
        batchSize: 100,
        batchIntervalMs: 5000,
        enableDeduplication: true,
        enableAggregation: true,
        enableDelta: true
      });

      this.components.otlpReceiver = new OTLPReceiver({
        port: this.config.otlpPort,
        metricProcessor: this.components.metricProcessor,
        usageTracker: this.components.usageTracker
      });

      // 3. Checkpoint optimizer
      this.components.checkpointOptimizer = new CheckpointOptimizer(
        {
          memoryStore: this.components.memoryStore,
          usageTracker: this.components.usageTracker
        },
        {
          compactionDetectionEnabled: true,
          learningRate: 0.1
        }
      );

      // 4. Continuous loop orchestrator
      this.components.orchestrator = new ContinuousLoopOrchestrator(
        {
          memoryStore: this.components.memoryStore,
          usageTracker: this.components.usageTracker,
          stateManager: this.components.stateManager,
          messageBus: this.components.messageBus,
          tokenCounter
        },
        {
          enabled: true,
          contextMonitoring: { enabled: true, contextWindowSize: 200000 },
          apiLimitTracking: { enabled: true, plan: 'Pro' },
          checkpointOptimizer: { enabled: true },
          dashboard: {
            enableWeb: this.config.enableDashboard,
            webPort: this.config.dashboardPort
          }
        }
      );

      // 5. OTLP-Checkpoint Bridge (NEW!)
      this.components.otlpBridge = new OTLPCheckpointBridge(
        {
          otlpReceiver: this.components.otlpReceiver,
          checkpointOptimizer: this.components.checkpointOptimizer,
          orchestrator: this.components.orchestrator,
          stateManager: this.components.stateManager,
          usageTracker: this.components.usageTracker
        },
        {
          compactionThreshold: 0.95,
          warningThreshold: 0.85,
          checkpointThreshold: 0.75,
          autoSaveBeforeCompaction: true,
          autoReloadAfterClear: true
        }
      );

      // Set up event listeners for metrics
      this._setupEventListeners();

      this.logger.info('All components initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize components', { error: error.message });
      throw error;
    }
  }

  /**
   * Start all services
   */
  async start() {
    this.logger.info('Starting staging environment services');

    // 1. Start OTLP receiver
    await this.components.otlpReceiver.start();
    this.logger.info(`OTLP receiver started on port ${this.config.otlpPort}`);

    // 2. Start orchestrator
    await this.components.orchestrator.start();
    this.logger.info('Continuous loop orchestrator started');

    // 3. Start OTLP bridge
    this.components.otlpBridge.start();
    this.logger.info('OTLP-Checkpoint bridge started');

    // 4. Start health check server
    if (this.config.enableHealthChecks) {
      await this._startHealthCheckServer();
    }

    // 5. Start Prometheus exporter
    if (this.config.enablePrometheus) {
      await this._startPrometheusExporter();
    }

    // 6. Start alerting system
    if (this.config.enableAlerting) {
      this._startAlertingSystem();
    }

    // 7. Start load test if enabled
    if (this.config.enableLoadTest) {
      setTimeout(() => this._startLoadTest(), 5000);
    }

    this.logger.info('All services started successfully');

    // Display status
    this._displayStatus();
  }

  /**
   * Start health check server
   * @private
   */
  async _startHealthCheckServer() {
    const app = express();

    // Main health endpoint
    app.get('/health', (req, res) => {
      const health = this._getHealthStatus();
      const statusCode = health.status === 'healthy' ? 200 : 503;

      res.status(statusCode).json(health);
      this.metrics.requests++;
    });

    // Liveness probe (is service alive?)
    app.get('/health/live', (req, res) => {
      res.status(200).json({ status: 'alive', timestamp: Date.now() });
    });

    // Readiness probe (is service ready to accept traffic?)
    app.get('/health/ready', (req, res) => {
      const ready = this._isReady();
      res.status(ready ? 200 : 503).json({
        ready,
        components: this._getComponentStatus()
      });
    });

    // Component-specific health checks
    app.get('/health/otlp', (req, res) => {
      const otlpHealth = {
        status: this.components.otlpReceiver?.server ? 'healthy' : 'unhealthy',
        port: this.config.otlpPort,
        metricsReceived: this.components.otlpReceiver?.metricsReceived || 0
      };
      res.json(otlpHealth);
    });

    app.get('/health/checkpoint', (req, res) => {
      const bridgeStatus = this.components.otlpBridge?.getStatus() || {};
      res.json({
        status: bridgeStatus.safetyStatus || 'unknown',
        ...bridgeStatus
      });
    });

    app.get('/health/orchestrator', (req, res) => {
      const orchStatus = {
        status: this.components.orchestrator?.state?.status || 'unknown',
        sessionId: this.components.orchestrator?.state?.sessionId,
        operationCount: this.components.orchestrator?.state?.operationCount || 0,
        checkpointCount: this.components.orchestrator?.state?.checkpointCount || 0
      };
      res.json(orchStatus);
    });

    // Metrics endpoint
    app.get('/metrics', (req, res) => {
      res.json(this._getMetrics());
    });

    this.services.healthServer = http.createServer(app);

    return new Promise((resolve) => {
      this.services.healthServer.listen(this.config.healthPort, () => {
        this.logger.info(`Health check server started on port ${this.config.healthPort}`);
        resolve();
      });
    });
  }

  /**
   * Start Prometheus exporter
   * @private
   */
  async _startPrometheusExporter() {
    const app = express();

    app.get('/metrics', (req, res) => {
      const metrics = this._generatePrometheusMetrics();
      res.set('Content-Type', 'text/plain');
      res.send(metrics);
    });

    this.services.prometheusServer = http.createServer(app);

    return new Promise((resolve) => {
      this.services.prometheusServer.listen(this.config.prometheusPort, () => {
        this.logger.info(`Prometheus exporter started on port ${this.config.prometheusPort}`);
        resolve();
      });
    });
  }

  /**
   * Generate Prometheus format metrics
   * @private
   */
  _generatePrometheusMetrics() {
    const bridgeStatus = this.components.otlpBridge?.getStatus() || {};
    const orchState = this.components.orchestrator?.state || {};
    const usage = this.components.usageTracker?.getSessionUsage() || {};

    const metrics = [];

    // Context metrics
    metrics.push(`# HELP context_tokens_total Current total context tokens`);
    metrics.push(`# TYPE context_tokens_total gauge`);
    metrics.push(`context_tokens_total ${bridgeStatus.currentTokens || 0}`);

    metrics.push(`# HELP context_utilization Context window utilization ratio`);
    metrics.push(`# TYPE context_utilization gauge`);
    metrics.push(`context_utilization ${bridgeStatus.utilization || 0}`);

    metrics.push(`# HELP context_velocity_tokens_per_sec Token consumption velocity`);
    metrics.push(`# TYPE context_velocity_tokens_per_sec gauge`);
    metrics.push(`context_velocity_tokens_per_sec ${bridgeStatus.tokenVelocity || 0}`);

    // Checkpoint metrics
    metrics.push(`# HELP checkpoints_total Total number of checkpoints created`);
    metrics.push(`# TYPE checkpoints_total counter`);
    metrics.push(`checkpoints_total ${orchState.checkpointCount || 0}`);

    metrics.push(`# HELP compaction_saves_total Total compaction saves`);
    metrics.push(`# TYPE compaction_saves_total counter`);
    metrics.push(`compaction_saves_total ${bridgeStatus.compactionSaves || 0}`);

    // Operation metrics
    metrics.push(`# HELP operations_total Total operations processed`);
    metrics.push(`# TYPE operations_total counter`);
    metrics.push(`operations_total ${orchState.operationCount || 0}`);

    // Cost metrics
    metrics.push(`# HELP cost_total_usd Total cost in USD`);
    metrics.push(`# TYPE cost_total_usd gauge`);
    metrics.push(`cost_total_usd ${usage.totalCost || 0}`);

    // System metrics
    metrics.push(`# HELP uptime_seconds System uptime in seconds`);
    metrics.push(`# TYPE uptime_seconds counter`);
    metrics.push(`uptime_seconds ${Math.floor((Date.now() - this.metrics.startTime) / 1000)}`);

    return metrics.join('\n');
  }

  /**
   * Start alerting system
   * @private
   */
  _startAlertingSystem() {
    this.logger.info('Starting alerting system');

    // Set up alert rules
    this.alertRules = [
      {
        name: 'HighContextUtilization',
        condition: () => {
          const status = this.components.otlpBridge?.getStatus();
          return status && status.utilization > 0.85;
        },
        severity: 'warning',
        message: 'Context utilization above 85%'
      },
      {
        name: 'CriticalContextUtilization',
        condition: () => {
          const status = this.components.otlpBridge?.getStatus();
          return status && status.utilization > 0.95;
        },
        severity: 'critical',
        message: 'CRITICAL: Context utilization above 95% - Compaction imminent!'
      },
      {
        name: 'RapidTokenConsumption',
        condition: () => {
          const status = this.components.otlpBridge?.getStatus();
          return status && status.tokenVelocity > 1000; // >1000 tokens/sec
        },
        severity: 'warning',
        message: 'Rapid token consumption detected'
      },
      {
        name: 'CompactionDetected',
        condition: () => {
          const lastCompactionSaves = this.lastCompactionSaves || 0;
          const currentSaves = this.components.otlpBridge?.getStatus()?.compactionSaves || 0;
          this.lastCompactionSaves = currentSaves;
          return currentSaves > lastCompactionSaves;
        },
        severity: 'error',
        message: 'Context compaction detected and handled'
      }
    ];

    // Check alerts periodically
    this.alertInterval = setInterval(() => {
      this._checkAlerts();
    }, 5000);

    // Listen for emergency events
    if (this.components.otlpBridge) {
      this.components.otlpBridge.on('emergency:compaction', (data) => {
        this._triggerAlert({
          name: 'EmergencyCompaction',
          severity: 'critical',
          message: `EMERGENCY: Compaction prevention triggered at ${data.currentTokens} tokens`,
          data
        });
      });

      this.components.otlpBridge.on('warning:critical', (data) => {
        this._triggerAlert({
          name: 'CriticalWarning',
          severity: 'warning',
          message: `Critical context level: ${data.remainingTokens} tokens remaining`,
          data
        });
      });
    }
  }

  /**
   * Check alert rules
   * @private
   */
  _checkAlerts() {
    this.alertRules.forEach(rule => {
      try {
        if (rule.condition()) {
          this._triggerAlert(rule);
        }
      } catch (error) {
        this.logger.error(`Alert rule ${rule.name} failed`, { error: error.message });
      }
    });
  }

  /**
   * Trigger an alert
   * @private
   */
  _triggerAlert(alert) {
    const timestamp = new Date().toISOString();

    // Log alert
    if (alert.severity === 'critical' || alert.severity === 'error') {
      this.logger.error(`ALERT: ${alert.message}`, alert);
    } else {
      this.logger.warn(`ALERT: ${alert.message}`, alert);
    }

    // Store alert
    if (!this.alertHistory) {
      this.alertHistory = [];
    }

    this.alertHistory.push({
      timestamp,
      ...alert
    });

    // Keep only last 100 alerts
    if (this.alertHistory.length > 100) {
      this.alertHistory.shift();
    }

    // Emit alert event
    if (this.components.messageBus) {
      this.components.messageBus.publish('alert:triggered', {
        timestamp,
        ...alert
      });
    }

    // In production, this would send to external alerting system
    // For staging, we just log and store
  }

  /**
   * Start load test
   * @private
   */
  _startLoadTest() {
    this.logger.info('Starting load test simulation');

    const scenarios = [
      { name: 'normal', tokensPerCall: 500, interval: 5000 },
      { name: 'burst', tokensPerCall: 2000, interval: 1000 },
      { name: 'sustained', tokensPerCall: 1000, interval: 2000 },
      { name: 'heavy', tokensPerCall: 5000, interval: 3000 }
    ];

    let scenarioIndex = 0;
    let callCount = 0;

    const runScenario = () => {
      const scenario = scenarios[scenarioIndex % scenarios.length];

      // Simulate OTLP metric
      const metric = {
        metrics: [{
          name: 'claude.tokens.total',
          data: {
            dataPoints: [{
              value: callCount * scenario.tokensPerCall + Math.random() * 100
            }]
          }
        }]
      };

      // Send to OTLP receiver
      if (this.components.otlpReceiver) {
        this.components.otlpReceiver.processMetrics(metric);
      }

      callCount++;

      // Switch scenarios every 10 calls
      if (callCount % 10 === 0) {
        scenarioIndex++;
        this.logger.info(`Load test switching to scenario: ${scenarios[scenarioIndex % scenarios.length].name}`);
      }

      // Stop after 100 calls
      if (callCount < 100) {
        setTimeout(runScenario, scenario.interval);
      } else {
        this.logger.info('Load test completed', { totalCalls: callCount });
      }
    };

    // Start load test
    setTimeout(runScenario, 2000);
  }

  /**
   * Set up event listeners
   * @private
   */
  _setupEventListeners() {
    // Track metrics from various components
    if (this.components.orchestrator) {
      this.components.orchestrator.on('started', () => {
        this.logger.info('Orchestrator started event received');
      });

      this.components.orchestrator.on('checkpoint:created', () => {
        this.metrics.checkpoints++;
      });
    }

    if (this.components.otlpBridge) {
      this.components.otlpBridge.on('context:status', (status) => {
        this.lastContextStatus = status;
      });

      this.components.otlpBridge.on('context:cleared', () => {
        this.metrics.contextReloads++;
      });
    }

    if (this.components.otlpReceiver) {
      this.components.otlpReceiver.on('error', (error) => {
        this.metrics.errors++;
        this.logger.error('OTLP receiver error', error);
      });
    }
  }

  /**
   * Get health status
   * @private
   */
  _getHealthStatus() {
    const components = this._getComponentStatus();
    const allHealthy = Object.values(components).every(status => status === 'healthy');

    return {
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: Date.now(),
      uptime: Date.now() - this.metrics.startTime,
      components,
      metrics: this._getMetrics()
    };
  }

  /**
   * Get component status
   * @private
   */
  _getComponentStatus() {
    return {
      otlpReceiver: this.components.otlpReceiver?.server ? 'healthy' : 'unhealthy',
      orchestrator: this.components.orchestrator?.state?.status === 'running' ? 'healthy' : 'unhealthy',
      otlpBridge: this.components.otlpBridge ? 'healthy' : 'unhealthy',
      checkpointOptimizer: this.components.checkpointOptimizer ? 'healthy' : 'unhealthy',
      stateManager: this.components.stateManager ? 'healthy' : 'unhealthy',
      memoryStore: this.components.memoryStore?.db ? 'healthy' : 'unhealthy'
    };
  }

  /**
   * Check if ready
   * @private
   */
  _isReady() {
    const components = this._getComponentStatus();
    return Object.values(components).every(status => status === 'healthy');
  }

  /**
   * Get metrics
   * @private
   */
  _getMetrics() {
    const bridgeStatus = this.components.otlpBridge?.getStatus() || {};
    const orchState = this.components.orchestrator?.state || {};

    return {
      ...this.metrics,
      contextTokens: bridgeStatus.currentTokens || 0,
      contextUtilization: bridgeStatus.utilization || 0,
      tokenVelocity: bridgeStatus.tokenVelocity || 0,
      operations: orchState.operationCount || 0,
      checkpoints: orchState.checkpointCount || 0,
      compactionSaves: bridgeStatus.compactionSaves || 0,
      alertsTriggered: this.alertHistory?.length || 0
    };
  }

  /**
   * Display status
   * @private
   */
  _displayStatus() {
    console.log('\n========================================');
    console.log('🚀 STAGING ENVIRONMENT ACTIVE');
    console.log('========================================\n');

    console.log('📡 Services:');
    console.log(`   OTLP Receiver:    http://localhost:${this.config.otlpPort}`);
    console.log(`   Health Checks:    http://localhost:${this.config.healthPort}/health`);
    console.log(`   Prometheus:       http://localhost:${this.config.prometheusPort}/metrics`);
    console.log(`   Dashboard:        http://localhost:${this.config.dashboardPort}`);

    console.log('\n🔍 Health Check Endpoints:');
    console.log(`   /health          - Overall health status`);
    console.log(`   /health/live     - Liveness probe`);
    console.log(`   /health/ready    - Readiness probe`);
    console.log(`   /health/otlp     - OTLP receiver status`);
    console.log(`   /health/checkpoint - Checkpoint bridge status`);
    console.log(`   /health/orchestrator - Orchestrator status`);
    console.log(`   /metrics         - JSON metrics`);

    console.log('\n⚡ Features Enabled:');
    console.log(`   ✅ OTLP metric reception`);
    console.log(`   ✅ Automatic checkpointing`);
    console.log(`   ✅ Compaction prevention`);
    console.log(`   ✅ State preservation`);
    console.log(`   ✅ Context reloading`);
    console.log(`   ✅ Health monitoring`);
    console.log(`   ✅ Prometheus metrics`);
    console.log(`   ✅ Alert system`);
    if (this.config.enableLoadTest) {
      console.log(`   ✅ Load testing`);
    }

    console.log('\n📊 Monitoring:');
    console.log('   The system is now monitoring OTLP metrics and will:');
    console.log('   • Create checkpoints before context limits');
    console.log('   • Save state before compaction');
    console.log('   • Clear and reload context as needed');
    console.log('   • Trigger alerts on critical conditions');

    console.log('\n========================================\n');
  }

  /**
   * Ensure directories exist
   * @private
   */
  _ensureDirectories() {
    [this.config.dataDir, this.config.logsDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Shutdown gracefully
   */
  async shutdown() {
    this.logger.info('Shutting down staging environment');

    // Clear intervals
    if (this.alertInterval) {
      clearInterval(this.alertInterval);
    }

    // Stop components
    if (this.components.otlpBridge) {
      this.components.otlpBridge.stop();
    }

    if (this.components.orchestrator) {
      await this.components.orchestrator.stop();
    }

    if (this.components.otlpReceiver) {
      await this.components.otlpReceiver.stop();
    }

    // Close servers
    if (this.services.healthServer) {
      this.services.healthServer.close();
    }

    if (this.services.prometheusServer) {
      this.services.prometheusServer.close();
    }

    // Close memory store
    if (this.components.memoryStore) {
      this.components.memoryStore.close();
    }

    this.logger.info('Staging environment shutdown complete');
  }
}

// Main execution
async function main() {
  const staging = new StagingEnvironment({
    enableLoadTest: process.argv.includes('--load-test')
  });

  try {
    await staging.initialize();
    await staging.start();

    // Handle shutdown
    process.on('SIGINT', async () => {
      console.log('\n\nShutting down...');
      await staging.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await staging.shutdown();
      process.exit(0);
    });

  } catch (error) {
    console.error('Failed to start staging environment:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = StagingEnvironment;