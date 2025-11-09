#!/usr/bin/env node

/**
 * Live Usage Monitor
 *
 * Real-time monitoring of token usage, costs, and orchestrations
 * Updates continuously as new orchestrations complete
 *
 * Usage:
 *   node scripts/usage-monitor.js
 *   npm run monitor
 *
 * Features:
 * - Live session statistics
 * - Real-time cost tracking
 * - Budget status monitoring
 * - Recent orchestration feed
 * - Auto-refresh display
 */

const path = require('path');
const fs = require('fs');

// Import required components
const MemoryStore = require('../.claude/core/memory-store');
const UsageTracker = require('../.claude/core/usage-tracker');

// Check if chalk and ora are available (optional)
let chalk, ora;
try {
  chalk = require('chalk');
} catch (error) {
  // Fallback: no colors
  chalk = {
    bold: (s) => s,
    green: (s) => s,
    yellow: (s) => s,
    red: (s) => s,
    cyan: (s) => s,
    dim: (s) => s,
    gray: (s) => s
  };
}

/**
 * Format currency
 */
function formatCurrency(amount) {
  return `$${amount.toFixed(4)}`;
}

/**
 * Format number with commas
 */
function formatNumber(num) {
  return num.toLocaleString();
}

/**
 * Format percentage
 */
function formatPercent(num) {
  return `${num.toFixed(1)}%`;
}

/**
 * Clear screen
 */
function clearScreen() {
  process.stdout.write('\x1Bc');
}

/**
 * Display live session statistics
 */
function displaySessionStats(usageTracker, budgetStatus) {
  const session = usageTracker.getSessionUsage();
  const duration = Math.floor(session.duration / 1000); // seconds
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;

  console.log(chalk.bold.cyan('\n📊 LIVE SESSION MONITOR\n'));
  console.log(chalk.gray('═'.repeat(60)));
  console.log('');

  // Session Info
  console.log(chalk.bold('Session Duration:'), `${minutes}m ${seconds}s`);
  console.log(chalk.bold('Orchestrations:'), chalk.green(session.orchestrationCount));
  console.log('');

  // Token Stats
  console.log(chalk.bold.cyan('Token Usage:'));
  console.log('  Total Tokens:   ', chalk.yellow(formatNumber(session.totalTokens)));
  console.log('  Input Tokens:   ', formatNumber(session.inputTokens));
  console.log('  Output Tokens:  ', formatNumber(session.outputTokens));
  console.log('  Cache Tokens:   ', formatNumber(session.cacheCreationTokens + session.cacheReadTokens));
  console.log('');

  // Cost Stats
  console.log(chalk.bold.cyan('Cost Analysis:'));
  console.log('  Total Cost:     ', chalk.green(formatCurrency(session.totalCost)));
  console.log('  Cache Savings:  ', chalk.yellow(formatCurrency(session.cacheSavings)));
  console.log('  Net Cost:       ', formatCurrency(session.totalCost - session.cacheSavings));
  console.log('');

  // Model Breakdown
  if (Object.keys(session.modelBreakdown).length > 0) {
    console.log(chalk.bold.cyan('Model Breakdown:'));
    for (const [model, stats] of Object.entries(session.modelBreakdown)) {
      console.log(`  ${model}:`);
      console.log(`    Tokens: ${formatNumber(stats.tokens)}`);
      console.log(`    Cost:   ${formatCurrency(stats.cost)}`);
    }
    console.log('');
  }

  // Budget Status
  if (budgetStatus.daily.limit || budgetStatus.monthly.limit) {
    console.log(chalk.bold.cyan('Budget Status:'));

    if (budgetStatus.daily.limit) {
      const dailyColor = budgetStatus.daily.exceeded ? chalk.red :
                        budgetStatus.daily.warning ? chalk.yellow :
                        chalk.green;
      console.log('  Daily:');
      console.log('    Used:      ', dailyColor(formatCurrency(budgetStatus.daily.used)));
      console.log('    Limit:     ', formatCurrency(budgetStatus.daily.limit));
      console.log('    Remaining: ', dailyColor(formatCurrency(budgetStatus.daily.remaining)));
      console.log('    Status:    ', dailyColor(
        budgetStatus.daily.exceeded ? '⚠️  EXCEEDED' :
        budgetStatus.daily.warning ? '⚠️  WARNING' :
        '✅ OK'
      ));
    }

    if (budgetStatus.monthly.limit) {
      const monthlyColor = budgetStatus.monthly.exceeded ? chalk.red :
                          budgetStatus.monthly.warning ? chalk.yellow :
                          chalk.green;
      console.log('  Monthly:');
      console.log('    Used:      ', monthlyColor(formatCurrency(budgetStatus.monthly.used)));
      console.log('    Limit:     ', formatCurrency(budgetStatus.monthly.limit));
      console.log('    Remaining: ', monthlyColor(formatCurrency(budgetStatus.monthly.remaining)));
      console.log('    Projection:', formatCurrency(budgetStatus.monthly.projection || 0));
      console.log('    Status:    ', monthlyColor(
        budgetStatus.monthly.exceeded ? '⚠️  EXCEEDED' :
        budgetStatus.monthly.warning ? '⚠️  WARNING' :
        '✅ OK'
      ));
    }
    console.log('');
  }

  console.log(chalk.gray('═'.repeat(60)));
  console.log(chalk.dim(`Last updated: ${new Date().toLocaleTimeString()}`));
  console.log(chalk.dim('Press Ctrl+C to exit\n'));
}

/**
 * Display recent orchestrations
 */
function displayRecentOrchestrations(memoryStore, limit = 5) {
  try {
    const recent = memoryStore.db.prepare(`
      SELECT
        tu.orchestration_id,
        tu.model,
        tu.total_tokens,
        tu.total_cost,
        tu.timestamp,
        tu.pattern
      FROM token_usage tu
      ORDER BY tu.timestamp DESC
      LIMIT ?
    `).all(limit);

    if (recent.length > 0) {
      console.log(chalk.bold.cyan('\n📝 Recent Orchestrations:\n'));
      recent.forEach((orch, index) => {
        const time = new Date(orch.timestamp).toLocaleTimeString();
        console.log(`${index + 1}. [${time}] ${orch.pattern || 'unknown'}`);
        console.log(`   Model: ${orch.model}`);
        console.log(`   Tokens: ${formatNumber(orch.total_tokens)} | Cost: ${formatCurrency(orch.total_cost)}`);
        console.log('');
      });
    }
  } catch (error) {
    // Ignore errors (table might not exist yet)
  }
}

/**
 * Main monitoring loop
 */
async function startMonitoring(refreshInterval = 2000) {
  try {
    // Find database
    const dbPath = path.join(__dirname, '../.claude/memory/orchestrations.db');

    if (!fs.existsSync(dbPath)) {
      console.error('Error: No database found at', dbPath);
      console.error('Run some orchestrations first to generate usage data.');
      process.exit(1);
    }

    // Initialize components (readonly mode to avoid locks)
    const memoryStore = new MemoryStore(dbPath, { readonly: true });
    const usageTracker = new UsageTracker(memoryStore, {
      enableBudgetAlerts: true,
      dailyBudgetUSD: process.env.DAILY_BUDGET_USD || null,
      monthlyBudgetUSD: process.env.MONTHLY_BUDGET_USD || null
    });

    console.log(chalk.bold.green('\n🚀 Starting Live Usage Monitor...\n'));
    console.log(chalk.dim('Monitoring token usage and costs in real-time'));
    console.log(chalk.dim(`Refresh interval: ${refreshInterval}ms\n`));

    // Monitoring loop
    const monitor = async () => {
      try {
        clearScreen();

        // Get budget status
        const budgetStatus = {
          daily: await usageTracker.checkBudgetStatus('day'),
          monthly: await usageTracker.checkBudgetStatus('month')
        };

        // Display stats
        displaySessionStats(usageTracker, budgetStatus);

        // Display recent orchestrations
        displayRecentOrchestrations(memoryStore);

      } catch (error) {
        console.error(chalk.red('Monitor error:'), error.message);
      }
    };

    // Initial display
    await monitor();

    // Set up refresh interval
    const intervalId = setInterval(monitor, refreshInterval);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      clearInterval(intervalId);
      memoryStore.close();
      console.log(chalk.green('\n\n✨ Monitor stopped\n'));
      process.exit(0);
    });

  } catch (error) {
    console.error(chalk.red('\nError:'), error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const refreshInterval = parseInt(args[0]) || 2000; // Default 2 seconds

// Run if called directly
if (require.main === module) {
  startMonitoring(refreshInterval);
}

module.exports = startMonitoring;
