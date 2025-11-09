#!/usr/bin/env node

/**
 * Usage Report CLI
 *
 * Interactive command-line tool for viewing usage analytics,
 * token consumption, and cost reports.
 *
 * Usage:
 *   node scripts/usage-report.js
 *   npm run usage
 *
 * Features:
 * - Daily/monthly usage reports
 * - Pattern cost analysis
 * - Agent cost analysis
 * - Budget status
 * - Export to JSON/CSV
 */

const path = require('path');
const fs = require('fs');

// Import required components
const MemoryStore = require('../.claude/core/memory-store');
const UsageTracker = require('../.claude/core/usage-tracker');
const UsageReporter = require('../.claude/core/usage-reporter');

// Check if inquirer, chalk, ora are available (optional dependencies)
let inquirer, chalk, ora;
try {
  inquirer = require('inquirer');
  chalk = require('chalk');
  ora = require('ora');
} catch (error) {
  console.log('Note: For better UX, install inquirer, chalk, and ora:');
  console.log('  npm install --save-dev inquirer chalk ora\n');
}

/**
 * Main CLI function
 */
async function main() {
  try {
    // Find database
    const dbPath = path.join(__dirname, '../.claude/memory/orchestrations.db');

    if (!fs.existsSync(dbPath)) {
      console.error('Error: No database found at', dbPath);
      console.error('Run some orchestrations first to generate usage data.');
      process.exit(1);
    }

    // Initialize components
    const memoryStore = new MemoryStore(dbPath, { readonly: true });
    const usageTracker = new UsageTracker(memoryStore);
    const usageReporter = new UsageReporter(memoryStore, usageTracker);

    console.log(chalk ? chalk.bold('\n📊 Usage Analytics Report\n') : '\n=== Usage Analytics Report ===\n');

    // Get report type from user
    let reportType;
    if (inquirer) {
      const answers = await inquirer.prompt([
        {
          type: 'list',
          name: 'reportType',
          message: 'Select report type:',
          choices: [
            { name: '📅 Daily Usage', value: 'daily' },
            { name: '📆 Monthly Summary', value: 'monthly' },
            { name: '🎯 Pattern Cost Analysis', value: 'pattern' },
            { name: '🤖 Agent Cost Analysis', value: 'agent' },
            { name: '⏰ Billing Window (5h)', value: 'billing' },
            { name: '💰 Budget Status', value: 'budget' },
            { name: '⚡ Cost Efficiency', value: 'efficiency' }
          ]
        }
      ]);
      reportType = answers.reportType;
    } else {
      // Fallback: simple menu
      console.log('Select report type:');
      console.log('1. Daily Usage');
      console.log('2. Monthly Summary');
      console.log('3. Pattern Cost Analysis');
      console.log('4. Agent Cost Analysis');
      console.log('5. Budget Status');

      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });

      reportType = await new Promise(resolve => {
        readline.question('Enter number (1-5): ', answer => {
          readline.close();
          const types = ['daily', 'monthly', 'pattern', 'agent', 'budget'];
          resolve(types[parseInt(answer) - 1] || 'daily');
        });
      });
    }

    // Generate report
    const spinner = ora ? ora(`Generating ${reportType} report...`).start() : null;

    let report;
    switch (reportType) {
      case 'daily':
        report = await usageReporter.generateDailyReport({ breakdown: true });
        break;
      case 'monthly':
        report = await usageReporter.generateMonthlyReport({ breakdown: true });
        break;
      case 'pattern':
        report = await usageReporter.generatePatternCostAnalysis({ timeframe: '30days' });
        break;
      case 'agent':
        report = await usageReporter.generateAgentCostAnalysis({ timeframe: '30days' });
        break;
      case 'billing':
        report = await usageReporter.generateBillingWindowReport();
        break;
      case 'budget':
        report = await usageReporter.generateBudgetReport();
        break;
      case 'efficiency':
        report = await usageReporter.generateEfficiencyReport({ timeframe: '30days' });
        break;
      default:
        report = await usageReporter.generateDailyReport();
    }

    if (spinner) spinner.succeed('Report generated');

    // Display report
    console.log('');
    const formatted = usageReporter.formatForCLI(report, 'table');
    console.log(formatted);
    console.log('');

    // Ask about export (if inquirer available)
    if (inquirer) {
      const { shouldExport } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'shouldExport',
          message: 'Export report to file?',
          default: false
        }
      ]);

      if (shouldExport) {
        const { filepath, format } = await inquirer.prompt([
          {
            type: 'input',
            name: 'filepath',
            message: 'Export path:',
            default: `./reports/${reportType}-${Date.now()}.json`
          },
          {
            type: 'list',
            name: 'format',
            message: 'Format:',
            choices: ['json', 'csv']
          }
        ]);

        const exportSpinner = ora('Exporting...').start();
        try {
          await usageReporter.exportReport(report, filepath, format);
          exportSpinner.succeed(`Exported to ${filepath}`);
        } catch (error) {
          exportSpinner.fail(`Export failed: ${error.message}`);
        }
      }
    }

    // Close database
    memoryStore.close();

    console.log(chalk ? chalk.dim('\n✨ Done\n') : '\nDone\n');

  } catch (error) {
    console.error(chalk ? chalk.red('\nError:') : '\nError:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = main;
