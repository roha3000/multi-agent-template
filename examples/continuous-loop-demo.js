#!/usr/bin/env node

/**
 * Continuous Loop System - Comprehensive Demo
 *
 * This demo shows how to integrate and use the continuous loop orchestration system
 * with all its components: context monitoring, API limits, cost budgets, human-in-loop
 * guardrails, and real-time dashboard.
 *
 * Run: node examples/continuous-loop-demo.js
 */

const path = require('path');
const fs = require('fs');

// Import all continuous loop components
const ContinuousLoopOrchestrator = require('../.claude/core/continuous-loop-orchestrator');
const MemoryStore = require('../.claude/core/memory-store');
const tokenCounter = require('../.claude/core/token-counter');  // Module with functions
const UsageTracker = require('../.claude/core/usage-tracker');

// Configuration
const CONFIG = {
  continuousLoop: {
    enabled: true,

    contextMonitoring: {
      enabled: true,
      contextWindowSize: 200000,
      checkpointThreshold: 0.75,
      bufferTokens: 10000,
      adaptiveLearning: true
    },

    apiLimitTracking: {
      enabled: true,
      plan: 'Pro',
      thresholds: {
        warning: 0.80,
        critical: 0.90,
        emergency: 0.95
      }
    },

    costBudgets: {
      enabled: true,
      budgets: {
        session: 5.00,
        daily: 25.00
      },
      thresholds: {
        warning: 0.75,
        critical: 0.90,
        emergency: 0.95
      }
    },

    humanInLoop: {
      enabled: true,
      confidenceThreshold: 0.70,
      learningEnabled: true
    },

    dashboard: {
      enabled: true,
      port: 3030,
      autoLaunch: false
    }
  }
};

// Simulated operations for demo
const DEMO_OPERATIONS = [
  {
    type: 'code-generation',
    task: 'Implement user authentication module',
    phase: 'implementation',
    estimatedTokens: 3000,
    description: 'Safe operation - should pass all checks'
  },
  {
    type: 'infrastructure',
    task: 'Deploy authentication system to production',
    phase: 'deployment',
    estimatedTokens: 2000,
    description: 'HIGH RISK - should trigger human review (production deployment)'
  },
  {
    type: 'design',
    task: 'Decide whether to use PostgreSQL or MongoDB for user data',
    phase: 'design',
    estimatedTokens: 4000,
    description: 'DESIGN DECISION - should trigger human review'
  },
  {
    type: 'testing',
    task: 'Write unit tests for payment processing',
    phase: 'testing',
    estimatedTokens: 2500,
    description: 'Safe operation - might trigger false positive initially'
  },
  {
    type: 'code-generation',
    task: 'Implement data export feature',
    phase: 'implementation',
    estimatedTokens: 5000,
    description: 'Safe operation with higher token usage'
  },
  {
    type: 'security',
    task: 'Update SSL certificate configuration',
    phase: 'infrastructure',
    estimatedTokens: 1500,
    description: 'SECURITY - should trigger human review (SSL changes)'
  }
];

/**
 * Main Demo Class
 */
class ContinuousLoopDemo {
  constructor() {
    this.orchestrator = null;
    this.memoryStore = null;
    this.tokenCounter = null;
    this.usageTracker = null;
    this.currentOperation = 0;
    this.simulatedTokens = 0;
    this.pendingReviews = [];
  }

  /**
   * Initialize all components
   */
  async initialize() {
    console.log('\n========================================');
    console.log('Continuous Loop System Demo');
    console.log('========================================\n');

    // Initialize memory store
    console.log('📦 Initializing memory store...');
    this.memoryStore = new MemoryStore(
      path.join(__dirname, '../.claude/memory/demo-memory-store.db')
    );

    // tokenCounter is a module with functions, not a class
    console.log('🔢 Token counter module loaded...');
    this.tokenCounter = tokenCounter;

    // Initialize usage tracker
    console.log('📊 Initializing usage tracker...');
    this.usageTracker = new UsageTracker(this.memoryStore, {
      sessionId: `demo-${Date.now()}`
    });

    // Initialize continuous loop orchestrator
    console.log('🔄 Initializing continuous loop orchestrator...');
    this.orchestrator = new ContinuousLoopOrchestrator({
      memoryStore: this.memoryStore,
      tokenCounter: this.tokenCounter,
      usageTracker: this.usageTracker
    }, CONFIG.continuousLoop);

    console.log('\n✅ All components initialized successfully!\n');
  }

  /**
   * Start the demo
   */
  async start() {
    console.log('========================================');
    console.log('Starting Demo Scenario');
    console.log('========================================\n');

    // Show dashboard info
    if (CONFIG.continuousLoop.dashboard.enabled) {
      console.log('📊 Dashboard available at: http://localhost:3030');
      console.log('   Open this URL in your browser to see real-time monitoring\n');
    }

    // Wait a moment for user to open dashboard
    console.log('⏳ Waiting 5 seconds for you to open the dashboard...\n');
    await this.sleep(5000);

    // Run through demo operations
    console.log('🚀 Running demo operations...\n');

    for (let i = 0; i < DEMO_OPERATIONS.length; i++) {
      const operation = DEMO_OPERATIONS[i];
      await this.executeOperation(operation, i + 1);

      // Pause between operations
      if (i < DEMO_OPERATIONS.length - 1) {
        await this.sleep(3000);
      }
    }

    // Show learning statistics
    await this.showLearningStats();

    // Demonstrate checkpoint
    await this.demonstrateCheckpoint();

    // Demonstrate wrap-up
    await this.demonstrateWrapUp();

    console.log('\n========================================');
    console.log('Demo Complete!');
    console.log('========================================\n');
    console.log('Check the dashboard for full session details.');
    console.log('Press Ctrl+C to exit.\n');
  }

  /**
   * Execute a single operation with full safety checks
   */
  async executeOperation(operation, operationNumber) {
    console.log(`\n[${ operationNumber}/${DEMO_OPERATIONS.length}] Operation: ${operation.task}`);
    console.log(`    Type: ${operation.type} | Phase: ${operation.phase}`);
    console.log(`    Estimated Tokens: ${operation.estimatedTokens}`);
    console.log(`    ${operation.description}\n`);

    // Update simulated token usage
    this.simulatedTokens += operation.estimatedTokens;

    // Track usage
    this.usageTracker.trackTokens({
      inputTokens: Math.floor(operation.estimatedTokens * 0.6),
      outputTokens: Math.floor(operation.estimatedTokens * 0.4),
      model: 'claude-sonnet-4-20250514'
    });

    // Run safety check
    console.log('   🔍 Running safety checks...');
    const safetyCheck = await this.orchestrator.checkSafety({
      type: operation.type,
      task: operation.task,
      phase: operation.phase,
      estimatedTokens: operation.estimatedTokens,
      metadata: {
        operationNumber,
        totalOperations: DEMO_OPERATIONS.length
      }
    });

    // Display safety check results
    this.displaySafetyCheck(safetyCheck);

    // Handle safety check actions
    await this.handleSafetyAction(safetyCheck, operation);

    // Record operation
    this.currentOperation++;
  }

  /**
   * Display safety check results
   */
  displaySafetyCheck(check) {
    console.log(`\n   Safety Check Results:`);
    console.log(`   ─────────────────────`);
    console.log(`   Safe: ${check.safe ? '✅ YES' : '❌ NO'}`);
    console.log(`   Action: ${check.action}`);
    console.log(`   Level: ${check.level || 'SAFE'}`);

    if (check.reason) {
      console.log(`   Reason: ${check.reason}`);
    }

    if (check.checks) {
      console.log(`\n   Component Checks:`);

      if (check.checks.context) {
        const ctx = check.checks.context;
        console.log(`   - Context: ${ctx.safe ? '✅' : '⚠️'} (${ctx.utilizationPercent}% used)`);
      }

      if (check.checks.apiLimits) {
        const api = check.checks.apiLimits;
        console.log(`   - API Limits: ${api.safe ? '✅' : '⚠️'} (${api.level || 'OK'})`);
      }

      if (check.checks.costBudget) {
        const cost = check.checks.costBudget;
        console.log(`   - Cost Budget: ${cost.safe ? '✅' : '⚠️'} (${cost.level || 'OK'})`);
      }

      if (check.checks.humanReview) {
        const hr = check.checks.humanReview;
        console.log(`   - Human Review: ${hr.requiresHuman ? '⚠️ NEEDED' : '✅'}`);
        if (hr.requiresHuman) {
          console.log(`     Confidence: ${Math.round(hr.confidence * 100)}%`);
          console.log(`     Pattern: ${hr.pattern}`);
          console.log(`     Reason: ${hr.reason}`);
        }
      }
    }
  }

  /**
   * Handle safety check action
   */
  async handleSafetyAction(check, operation) {
    switch (check.action) {
      case 'PROCEED':
        console.log(`\n   ✅ Proceeding with operation\n`);
        await this.simulateExecution(operation);
        break;

      case 'PROCEED_WITH_CAUTION':
        console.log(`\n   ⚠️ Proceeding with caution (${check.level})\n`);
        await this.simulateExecution(operation);
        break;

      case 'CHECKPOINT_NOW':
        console.log(`\n   💾 Checkpoint recommended - would save state here\n`);
        await this.simulateExecution(operation);
        break;

      case 'WRAP_UP_SOON':
        console.log(`\n   ⏰ Wrap-up recommended soon\n`);
        await this.simulateExecution(operation);
        break;

      case 'WAIT_FOR_APPROVAL':
        console.log(`\n   👤 HUMAN REVIEW REQUIRED\n`);
        console.log(`   This operation is now in the dashboard review queue.`);
        console.log(`   In a real scenario, execution would pause until approval.\n`);

        // Add to pending reviews
        this.pendingReviews.push({
          id: check.reviewId,
          operation: operation.task,
          confidence: check.checks.humanReview.confidence,
          pattern: check.checks.humanReview.pattern
        });

        // Simulate approval after delay
        console.log(`   🤖 [DEMO] Auto-approving after 3 seconds...\n`);
        await this.sleep(3000);

        // Record feedback
        await this.orchestrator.recordHumanFeedback(check.reviewId, {
          approved: true,
          wasCorrect: true,
          actualNeed: 'yes',
          comment: 'Demo auto-approval - this would require real human decision'
        });

        console.log(`   ✅ Approved - continuing execution\n`);
        await this.simulateExecution(operation);
        break;

      case 'STOP_IMMEDIATELY':
        console.log(`\n   🛑 EMERGENCY STOP\n`);
        console.log(`   This operation exceeds safety limits.`);
        console.log(`   In a real scenario, execution would halt completely.\n`);
        break;

      default:
        console.log(`\n   ❓ Unknown action: ${check.action}\n`);
    }
  }

  /**
   * Simulate operation execution
   */
  async simulateExecution(operation) {
    console.log(`   ⚙️ Executing: ${operation.task}...`);
    await this.sleep(1500);
    console.log(`   ✅ Completed successfully`);
  }

  /**
   * Show learning statistics
   */
  async showLearningStats() {
    console.log('\n========================================');
    console.log('Learning Statistics');
    console.log('========================================\n');

    const stats = this.orchestrator.getStatus();

    // Checkpoint optimizer stats
    if (stats.checkpointOptimizer) {
      const opt = stats.checkpointOptimizer;
      console.log('📊 Checkpoint Optimizer:');
      console.log(`   Current Threshold: ${(opt.threshold * 100).toFixed(1)}%`);
      console.log(`   Success Rate: ${(opt.successRate * 100).toFixed(1)}%`);
      console.log(`   Total Checkpoints: ${opt.totalCheckpoints}`);
      console.log(`   Compactions Detected: ${opt.compactionsDetected || 0}`);
      console.log('');
    }

    // Human-in-loop stats
    if (stats.humanInLoop) {
      const hil = stats.humanInLoop;
      console.log('🛡️ Human-In-Loop Guardrails:');
      console.log(`   Total Detections: ${hil.totalDetections || 0}`);
      console.log(`   Precision: ${((hil.precision || 0) * 100).toFixed(1)}%`);
      console.log(`   Recall: ${((hil.recall || 0) * 100).toFixed(1)}%`);
      console.log(`   Patterns Learned: ${hil.patternsLearned || 0}`);
      console.log('');
    }

    // API usage stats
    if (stats.apiLimits) {
      const api = stats.apiLimits;
      console.log('🔌 API Usage:');
      console.log(`   Plan: ${api.plan}`);
      console.log(`   Requests Today: ${api.requestsToday || 0}/${api.dailyLimit || 'unlimited'}`);
      console.log(`   Status: ${api.status || 'OK'}`);
      console.log('');
    }

    // Cost stats
    if (stats.costs) {
      const cost = stats.costs;
      console.log('💰 Costs:');
      console.log(`   Session: $${(cost.sessionCost || 0).toFixed(4)}`);
      console.log(`   Daily: $${(cost.dailyCost || 0).toFixed(4)}`);
      console.log('');
    }
  }

  /**
   * Demonstrate checkpoint creation
   */
  async demonstrateCheckpoint() {
    console.log('\n========================================');
    console.log('Checkpoint Demonstration');
    console.log('========================================\n');

    console.log('💾 Creating checkpoint...\n');

    const result = await this.orchestrator.checkpoint({
      reason: 'demo-checkpoint',
      taskType: 'demonstration'
    });

    if (result.success) {
      console.log(`✅ Checkpoint created successfully!`);
      console.log(`   Checkpoint ID: ${result.checkpointId}`);
      console.log(`   Context Tokens: ${result.checkpoint.contextTokens}`);
      console.log(`   Timestamp: ${new Date(result.checkpoint.timestamp).toISOString()}`);
    } else {
      console.log(`❌ Checkpoint failed: ${result.reason}`);
    }
  }

  /**
   * Demonstrate wrap-up process
   */
  async demonstrateWrapUp() {
    console.log('\n========================================');
    console.log('Wrap-Up Demonstration');
    console.log('========================================\n');

    console.log('🎬 Starting graceful wrap-up process...\n');

    const result = await this.orchestrator.wrapUp({
      reason: 'demo-complete'
    });

    if (result.success) {
      console.log(`✅ Wrap-up completed successfully!\n`);

      if (result.summary) {
        console.log(`Session Summary:`);
        console.log(`   Duration: ${this.formatDuration(result.summary.durationMs)}`);
        console.log(`   Operations: ${result.summary.operationsCompleted}`);
        console.log(`   Checkpoints: ${result.summary.checkpointsCreated}`);
        console.log(`   Human Reviews: ${result.summary.humanReviewsRequested || 0}`);
        console.log(`   Final State: ${result.summary.finalState}`);
      }
    } else {
      console.log(`❌ Wrap-up failed: ${result.reason}`);
    }
  }

  /**
   * Format duration in ms to readable string
   */
  formatDuration(ms) {
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
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Cleanup
   */
  async cleanup() {
    console.log('\n🧹 Cleaning up...\n');

    if (this.orchestrator) {
      await this.orchestrator.stop();
    }

    if (this.memoryStore) {
      this.memoryStore.close();
    }

    console.log('✅ Cleanup complete\n');
  }
}

/**
 * Main execution
 */
async function main() {
  const demo = new ContinuousLoopDemo();

  try {
    await demo.initialize();
    await demo.start();

    // Keep running until Ctrl+C
    console.log('Demo is complete but dashboard is still running.');
    console.log('Press Ctrl+C to exit and cleanup.\n');

    // Handle cleanup on exit
    process.on('SIGINT', async () => {
      console.log('\n\n Received SIGINT, cleaning up...\n');
      await demo.cleanup();
      process.exit(0);
    });

  } catch (error) {
    console.error('\n❌ Demo error:', error.message);
    console.error(error.stack);
    await demo.cleanup();
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = ContinuousLoopDemo;
