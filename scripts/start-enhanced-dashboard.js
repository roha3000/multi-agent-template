#!/usr/bin/env node

/**
 * Start Enhanced Dashboard with Full OTLP Integration
 *
 * This script starts the complete dashboard system with:
 * - OTLP metric reception and processing
 * - Multi-session/multi-project tracking
 * - Execution plan tracking per session
 * - Real-time updates via SSE
 * - Web UI with comprehensive visualization
 */

const path = require('path');
const chalk = require('chalk');

// Components
const OTLPReceiver = require('../.claude/core/otlp-receiver');
const SessionAwareMetricProcessor = require('../.claude/core/session-aware-metric-processor');
const OTLPCheckpointBridge = require('../.claude/core/otlp-checkpoint-bridge');
const OTLPDashboardExtension = require('../.claude/core/otlp-dashboard-extension');
const EnhancedDashboardServer = require('../.claude/core/enhanced-dashboard-server');
const DashboardManager = require('../.claude/core/dashboard-manager');
const ContinuousLoopOrchestrator = require('../.claude/core/continuous-loop-orchestrator');
const CheckpointOptimizer = require('../.claude/core/checkpoint-optimizer');
const StateManager = require('../.claude/core/state-manager');
const MemoryStore = require('../.claude/core/memory-store');
const UsageTracker = require('../.claude/core/usage-tracker');
const MessageBus = require('../.claude/core/message-bus');
const tokenCounter = require('../.claude/core/token-counter');
const ContextTrackingBridge = require('../.claude/core/context-tracking-bridge');
const { createComponentLogger } = require('../.claude/core/logger');

async function main() {
  const logger = createComponentLogger('EnhancedDashboard');

  console.log(chalk.bold.cyan(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║        🚀 Enhanced OTLP Multi-Session Dashboard 🚀            ║
║                                                                ║
║   Real-time monitoring of parallel Claude Code sessions       ║
║   with execution plans and context management                 ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
  `));

  try {
    // Initialize core components
    console.log(chalk.bold('📦 Initializing components...'));

    const memoryStore = new MemoryStore(
      path.join(__dirname, '..', '.claude', 'memory', 'dashboard.db')
    );

    const messageBus = new MessageBus();

    const stateManager = new StateManager(
      path.join(__dirname, '..')
    );

    const usageTracker = new UsageTracker(
      memoryStore,
      { sessionId: `dashboard-${Date.now()}` }
    );

    // Initialize session-aware metric processor
    const sessionProcessor = new SessionAwareMetricProcessor({
      maxConcurrentSessions: 10,
      segregateBySession: true,
      segregateByProject: true,
      autoDetectProjects: true,
      persistSessionMetrics: true
    });

    // Initialize OTLP receiver with session processor
    const otlpReceiver = new OTLPReceiver({
      port: 4318,
      metricProcessor: sessionProcessor,
      usageTracker
    });

    // Override to use session-aware processing
    const originalProcess = otlpReceiver.processMetrics.bind(otlpReceiver);
    otlpReceiver.processMetrics = async function(otlpData, context) {
      // Process with session awareness
      await sessionProcessor.processMetrics(otlpData, context);
      // Also process normally for compatibility
      return originalProcess(otlpData);
    };

    // Initialize checkpoint optimizer
    const checkpointOptimizer = new CheckpointOptimizer(
      { memoryStore, usageTracker },
      { compactionDetectionEnabled: true }
    );

    // Initialize orchestrator
    const orchestrator = new ContinuousLoopOrchestrator(
      {
        memoryStore,
        usageTracker,
        stateManager,
        messageBus,
        tokenCounter
      },
      {
        enabled: true,
        contextMonitoring: { enabled: true, contextWindowSize: 200000 },
        apiLimitTracking: { enabled: false },
        checkpointOptimizer: { enabled: true },
        dashboard: { enableWeb: false } // We'll use our enhanced server
      }
    );

    // Set optimizer in orchestrator
    orchestrator.optimizer = checkpointOptimizer;

    // Initialize OTLP-Checkpoint bridge
    const otlpBridge = new OTLPCheckpointBridge(
      {
        otlpReceiver,
        checkpointOptimizer,
        orchestrator,
        stateManager,
        usageTracker
      },
      {
        compactionThreshold: 0.95,
        warningThreshold: 0.85,
        checkpointThreshold: 0.75,
        autoSaveBeforeCompaction: true,
        autoReloadAfterClear: true
      }
    );

    // Initialize dashboard manager (for backward compatibility)
    const dashboardManager = new DashboardManager(
      {
        usageTracker,
        limitTracker: null,
        stateManager,
        messageBus
      },
      {
        enableWebDashboard: false, // We'll use enhanced server
        enableTerminalDashboard: false,
        contextWindowSize: 200000
      }
    );

    // Initialize OTLP dashboard extension
    const dashboardExtension = new OTLPDashboardExtension(
      {
        dashboardManager,
        sessionProcessor,
        otlpBridge
      }
    );

    // Initialize REAL CONTEXT TRACKER
    const contextBridge = new ContextTrackingBridge({
      dashboardManager,
      checkpointOptimizer,
      sessionProcessor,
      otlpReceiver,
      maxContextWindow: 200000,
      checkpointThresholds: [70, 85, 95]
    });

    // Initialize enhanced dashboard server
    const dashboardServer = new EnhancedDashboardServer(
      {
        dashboardManager,
        sessionProcessor,
        otlpBridge,
        orchestrator,
        usageTracker
      },
      {
        port: 3030,
        updateInterval: 1000
      }
    );

    // Start all services
    console.log(chalk.bold('🚀 Starting services...'));

    await otlpReceiver.start();
    console.log(chalk.green('✓ OTLP Receiver started on port 4318'));

    await orchestrator.start();
    console.log(chalk.green('✓ Continuous Loop Orchestrator started'));

    otlpBridge.start();
    console.log(chalk.green('✓ OTLP-Checkpoint Bridge started'));

    contextBridge.start();
    console.log(chalk.green('✓ Real Context Tracker started'));

    await dashboardManager.start();
    console.log(chalk.green('✓ Dashboard Manager started'));

    await dashboardServer.start();
    console.log(chalk.green('✓ Enhanced Dashboard Server started on port 3030'));

    // Display access information
    console.log(chalk.bold.green('\n✅ System Ready!\n'));

    console.log(chalk.bold('📊 Dashboard Access:'));
    console.log(chalk.cyan('  http://localhost:3030\n'));

    console.log(chalk.bold('🔍 Features:'));
    console.log('  • ' + chalk.yellow('REAL context tracking') + ' (not simulated!)');
    console.log('  • Multiple Claude Code sessions tracked in parallel');
    console.log('  • Per-project metric aggregation');
    console.log('  • Execution plans displayed per session');
    console.log('  • ' + chalk.yellow('Automatic checkpoints at 70%, 85%, 95%'));
    console.log('  • Emergency compaction prevention');
    console.log('  • Session lifecycle tracking\n');

    console.log(chalk.bold('📡 OTLP Endpoint:'));
    console.log('  POST http://localhost:4318/v1/metrics\n');

    console.log(chalk.bold('🎮 Test Commands:'));
    console.log(chalk.gray('  # Send test metrics for a session'));
    console.log(`  curl -X POST http://localhost:4318/v1/metrics \\
    -H "Content-Type: application/json" \\
    -d '{
      "resourceMetrics": [{
        "resource": {
          "attributes": [
            {"key": "service.name", "value": {"stringValue": "claude-code"}},
            {"key": "claude.session.id", "value": {"stringValue": "test-session-1"}},
            {"key": "project.name", "value": {"stringValue": "my-project"}}
          ]
        },
        "scopeMetrics": [{
          "metrics": [{
            "name": "claude.tokens.total",
            "sum": {
              "dataPoints": [{
                "asInt": "50000",
                "timeUnixNano": "'$(date +%s%N)'"
              }]
            }
          }]
        }]
      }]
    }'\n`);

    console.log(chalk.gray('  # Run parallel session load test'));
    console.log('  node scripts/load-test-parallel-sessions.js\n');

    console.log(chalk.gray('  # Check health'));
    console.log('  curl http://localhost:3030/health\n');

    // Set up event listeners for interesting events
    sessionProcessor.on('session:created', ({ sessionId, projectId }) => {
      console.log(chalk.green(`📂 New session: ${sessionId} (project: ${projectId})`));
    });

    sessionProcessor.on('pattern:parallel-sessions', ({ projectId, sessionCount }) => {
      console.log(chalk.yellow(`⚡ ${sessionCount} parallel sessions for project: ${projectId}`));
    });

    otlpBridge.on('emergency:compaction', ({ currentTokens }) => {
      console.log(chalk.red(`🚨 EMERGENCY: Compaction prevention at ${currentTokens} tokens!`));
    });

    otlpBridge.on('checkpoint:recommended', ({ urgency, currentTokens }) => {
      console.log(chalk.yellow(`💾 Checkpoint recommended (${urgency}): ${currentTokens} tokens`));
    });

    // Handle shutdown
    process.on('SIGINT', async () => {
      console.log(chalk.yellow('\n\n🛑 Shutting down...'));

      dashboardExtension.stop();
      await dashboardServer.stop();
      await dashboardManager.stop();
      otlpBridge.stop();
      await orchestrator.stop();
      await otlpReceiver.stop();
      memoryStore.close();

      console.log(chalk.green('✅ Cleanup complete\n'));
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      dashboardExtension.stop();
      await dashboardServer.stop();
      await dashboardManager.stop();
      otlpBridge.stop();
      await orchestrator.stop();
      await otlpReceiver.stop();
      memoryStore.close();
      process.exit(0);
    });

  } catch (error) {
    console.error(chalk.red('Failed to start enhanced dashboard:'), error);
    process.exit(1);
  }
}

// Demo function to simulate execution plans
async function simulateExecutionPlans() {
  const axios = require('axios');

  const plans = [
    {
      sessionId: 'demo-session-1',
      projectId: 'web-refactor',
      tasks: [
        { content: 'Analyze codebase structure', status: 'completed', progress: 100 },
        { content: 'Identify refactoring opportunities', status: 'completed', progress: 100 },
        { content: 'Refactor authentication module', status: 'in_progress', activeForm: 'Refactoring auth...', progress: 65 },
        { content: 'Update API endpoints', status: 'pending', progress: 0 },
        { content: 'Write unit tests', status: 'pending', progress: 0 }
      ]
    },
    {
      sessionId: 'demo-session-2',
      projectId: 'api-design',
      tasks: [
        { content: 'Define API requirements', status: 'completed', progress: 100 },
        { content: 'Create OpenAPI specification', status: 'in_progress', activeForm: 'Generating spec...', progress: 40 },
        { content: 'Implement endpoints', status: 'pending', progress: 0 }
      ]
    }
  ];

  // Wait for system to be ready
  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log(chalk.magenta('\n🎭 Simulating execution plans...'));

  for (const plan of plans) {
    // Create session with OTLP metric
    const metric = {
      resourceMetrics: [{
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'claude-code' } },
            { key: 'claude.session.id', value: { stringValue: plan.sessionId } },
            { key: 'project.name', value: { stringValue: plan.projectId } }
          ]
        },
        scopeMetrics: [{
          metrics: [{
            name: 'claude.tokens.total',
            sum: {
              dataPoints: [{
                asInt: Math.floor(Math.random() * 100000).toString(),
                timeUnixNano: (Date.now() * 1000000).toString()
              }]
            }
          }]
        }]
      }]
    };

    try {
      await axios.post('http://localhost:4318/v1/metrics', metric, {
        headers: { 'Content-Type': 'application/json' }
      });

      // Update execution plan
      await axios.post(`http://localhost:3030/api/otlp/session/${plan.sessionId}/plan`, {
        tasks: plan.tasks,
        currentIndex: plan.tasks.findIndex(t => t.status === 'in_progress')
      });

      console.log(chalk.green(`  ✓ Created session ${plan.sessionId} with execution plan`));
    } catch (error) {
      // Ignore errors in demo
    }
  }
}

// Run main and optionally demo
if (require.main === module) {
  main().then(() => {
    if (process.argv.includes('--demo')) {
      simulateExecutionPlans();
    }
  });
}

module.exports = main;