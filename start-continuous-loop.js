#!/usr/bin/env node

/**
 * Continuous Loop System - Quick Start Script
 *
 * This script launches the continuous loop orchestration system with dashboard
 *
 * Usage:
 *   node start-continuous-loop.js
 *
 * Dashboard: http://localhost:3030
 */

const ContinuousLoopOrchestrator = require('./.claude/core/continuous-loop-orchestrator');
const MemoryStore = require('./.claude/core/memory-store');
const tokenCounter = require('./.claude/core/token-counter');
const UsageTracker = require('./.claude/core/usage-tracker');
const fs = require('fs');
const path = require('path');

// Load configuration
const configPath = path.join(__dirname, '.claude', 'continuous-loop-config.json');
let config = { continuousLoop: {} };

if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log('✅ Loaded configuration from .claude/continuous-loop-config.json');
} else {
  console.log('⚠️  No config found at .claude/continuous-loop-config.json');
  console.log('   Using default configuration');

  config.continuousLoop = {
    enabled: true,
    contextMonitoring: { enabled: true },
    apiLimitTracking: { enabled: true, plan: 'Pro' },
    costBudgets: { enabled: true },
    humanInLoop: { enabled: true },
    dashboard: { enabled: true, port: 3030 }
  };
}

async function main() {
  console.log('\n========================================');
  console.log('🚀 Continuous Loop System');
  console.log('========================================\n');

  const pidFile = path.join(__dirname, '.claude', 'continuous-loop.pid');
  let orchestrator = null;
  let memoryStore = null;

  try {
    // Initialize components
    console.log('📦 Initializing components...');

    memoryStore = new MemoryStore('.claude/memory/memory-store.db');

    const usageTracker = new UsageTracker(memoryStore, {
      sessionId: `session-${Date.now()}`
    });

    orchestrator = new ContinuousLoopOrchestrator(
      {
        memoryStore,
        tokenCounter,  // Pass the tokenCounter module (functions)
        usageTracker
      },
      config.continuousLoop
    );

    // Start the orchestrator and dashboard
    await orchestrator.start();

    console.log('✅ Components initialized\n');

    // Write PID file for process management
    if (!process.env.CONTINUOUS_LOOP_BACKGROUND) {
      // Only write PID if NOT running in background mode (started by manager)
      // The manager writes its own PID file
    } else {
      // Write PID file when running as background process
      const port = config.continuousLoop.dashboard?.port || 3030;
      const pidData = {
        pid: process.pid,
        port,
        startedAt: new Date().toISOString(),
        startedBy: 'direct'
      };
      fs.writeFileSync(pidFile, JSON.stringify(pidData, null, 2));
    }

    // Display configuration status
    console.log('📋 Configuration Status:');
    console.log(`   • Continuous Loop: ${config.continuousLoop.enabled ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`   • Context Monitoring: ${config.continuousLoop.contextMonitoring?.enabled ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`   • API Limit Tracking: ${config.continuousLoop.apiLimitTracking?.enabled ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`   • Cost Budgets: ${config.continuousLoop.costBudgets?.enabled ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`   • Human-In-Loop: ${config.continuousLoop.humanInLoop?.enabled ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`   • Dashboard: ${config.continuousLoop.dashboard?.enabled ? '✅ Enabled' : '❌ Disabled'}\n`);

    if (config.continuousLoop.dashboard?.enabled) {
      const port = config.continuousLoop.dashboard.port || 3030;
      console.log('========================================');
      console.log('📊 Dashboard Available');
      console.log('========================================');
      console.log(`\n   👉 http://localhost:${port}\n`);
      console.log('   Open this URL in your browser to:');
      console.log('   • View real-time task progress');
      console.log('   • Monitor token usage and costs');
      console.log('   • See human review queue');
      console.log('   • View session artifacts');
      console.log('   • Toggle features on/off\n');
    }

    console.log('========================================');
    console.log('🎯 System Ready');
    console.log('========================================\n');
    console.log('The continuous loop orchestrator is now running.');
    console.log('It will automatically:');
    console.log('  • Monitor context window usage');
    console.log('  • Create checkpoints at optimal times');
    console.log('  • Track API rate limits');
    console.log('  • Monitor costs against budgets');
    console.log('  • Detect when human review is needed\n');

    console.log('Integration example:');
    console.log('```javascript');
    console.log('// Before each operation');
    console.log('const safety = await orchestrator.checkSafety({');
    console.log('  type: "code-generation",');
    console.log('  task: "Implement feature",');
    console.log('  phase: "implementation",');
    console.log('  estimatedTokens: 5000');
    console.log('});');
    console.log('');
    console.log('if (safety.action === "PROCEED") {');
    console.log('  // Safe to execute');
    console.log('}');
    console.log('```\n');

    console.log('📚 Documentation:');
    console.log('   • System Overview: docs/CONTINUOUS-LOOP-SYSTEM.md');
    console.log('   • Dashboard Guide: docs/DASHBOARD-FEATURES.md');
    console.log('   • Integration Guide: docs/INTEGRATION-GUIDE.md');
    console.log('   • Guardrails Guide: docs/HUMAN-IN-LOOP-GUARDRAILS.md\n');

    console.log('Press Ctrl+C to stop\n');

    // Graceful shutdown function
    const shutdown = async (signal) => {
      console.log(`\n\n🛑 Shutting down (${signal})...`);

      if (orchestrator) {
        const summary = await orchestrator.wrapUp({ reason: 'user-shutdown' });

        if (summary.success && summary.summary) {
          console.log('\n📊 Session Summary:');
          console.log(`   Operations: ${summary.summary.operationsCompleted}`);
          console.log(`   Checkpoints: ${summary.summary.checkpointsCreated}`);
          console.log(`   Duration: ${Math.round(summary.summary.durationMs / 1000)}s`);
          if (summary.summary.totalCost) {
            console.log(`   Cost: $${summary.summary.totalCost.toFixed(4)}`);
          }
        }
      }

      if (memoryStore) {
        memoryStore.close();
      }

      // Clean up PID file
      if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
      }

      console.log('\n✅ Cleanup complete\n');
      process.exit(0);
    };

    // Keep running - handle both SIGINT (Ctrl+C) and SIGTERM (kill command)
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Return orchestrator for programmatic use
    return orchestrator;

  } catch (error) {
    console.error('\n❌ Error starting continuous loop system:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = main;
