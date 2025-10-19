#!/usr/bin/env node

/**
 * Interactive CLI for Multi-Agent Framework
 *
 * Provides a user-friendly menu interface for common framework operations.
 * Makes features discoverable and the tool pleasant to use.
 */

const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const path = require('path');
const fs = require('fs');

// Import framework components
const StateManager = require('../.claude/core/state-manager');
const TraceabilityReport = require('../.claude/core/traceability-report');
const { createComponentLogger } = require('../.claude/core/logger');

const logger = createComponentLogger('CLI');
const projectRoot = process.cwd();

// Banner
function showBanner() {
  console.log(chalk.blue.bold('\n╔════════════════════════════════════════════════════════════╗'));
  console.log(chalk.blue.bold('║                                                            ║'));
  console.log(chalk.blue.bold('║        ') + chalk.white.bold('🤖 Multi-Agent Development Framework') + chalk.blue.bold('        ║'));
  console.log(chalk.blue.bold('║                                                            ║'));
  console.log(chalk.blue.bold('║        ') + chalk.gray('Token Optimization • Prompt Traceability') + chalk.blue.bold('        ║'));
  console.log(chalk.blue.bold('║                                                            ║'));
  console.log(chalk.blue.bold('╚════════════════════════════════════════════════════════════╝\n'));
}

// Main menu
async function showMainMenu() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '📊 View Project Status', value: 'status' },
        { name: '📈 View Traceability Statistics', value: 'stats' },
        { name: '🔍 Search Prompts', value: 'search' },
        { name: '📁 View Artifact History', value: 'artifact' },
        { name: '📝 Generate Reports', value: 'reports' },
        { name: '⚙️  Framework Settings', value: 'settings' },
        new inquirer.Separator(),
        { name: '🚪 Exit', value: 'exit' }
      ],
      pageSize: 10
    }
  ]);

  return action;
}

// View project status
async function viewProjectStatus() {
  const spinner = ora('Loading project status...').start();

  try {
    const stateManager = new StateManager(projectRoot);
    const state = stateManager.load();

    spinner.succeed('Project status loaded');

    console.log(chalk.bold('\n📊 Project Status\n'));
    console.log(chalk.gray('─'.repeat(60)));

    console.log(chalk.cyan('Current Phase:     ') + chalk.white(state.current_phase));
    console.log(chalk.cyan('Last Updated:      ') + chalk.white(new Date(state.last_updated).toLocaleString()));

    // Quality scores
    console.log(chalk.bold('\n🎯 Quality Scores:\n'));
    Object.entries(state.quality_scores || {}).forEach(([phase, score]) => {
      const color = score >= 85 ? chalk.green : score >= 70 ? chalk.yellow : chalk.red;
      console.log(`  ${phase.padEnd(18)} ${color(score.toString().padStart(3))}${color('/100')}`);
    });

    // Artifacts count
    console.log(chalk.bold('\n📁 Artifacts by Phase:\n'));
    Object.entries(state.artifacts || {}).forEach(([phase, artifacts]) => {
      if (artifacts.length > 0) {
        console.log(`  ${phase.padEnd(18)} ${chalk.white(artifacts.length)} files`);
      }
    });

    // Decisions and blockers
    const decisions = state.decisions?.length || 0;
    const blockers = state.blockers?.length || 0;
    const unresolvedBlockers = state.blockers?.filter(b => !b.resolved).length || 0;

    console.log(chalk.bold('\n📋 Activity:\n'));
    console.log(`  Decisions Made:      ${chalk.white(decisions)}`);
    console.log(`  Total Blockers:      ${chalk.white(blockers)}`);
    if (unresolvedBlockers > 0) {
      console.log(`  Unresolved Blockers: ${chalk.red.bold(unresolvedBlockers)}`);
    }

    console.log('');

  } catch (error) {
    spinner.fail('Error loading project status');
    console.error(chalk.red('\nError: ' + error.message));
  }
}

// View traceability statistics
async function viewStatistics() {
  const spinner = ora('Calculating statistics...').start();

  try {
    const stateManager = new StateManager(projectRoot);
    const stats = stateManager.getPromptStatistics();

    spinner.succeed('Statistics calculated');

    console.log(chalk.bold('\n📈 Prompt Traceability Statistics\n'));
    console.log(chalk.gray('─'.repeat(60)));

    console.log(chalk.cyan('Total Prompts:     ') + chalk.white.bold(stats.totalPrompts));
    console.log(chalk.cyan('Total Artifacts:   ') + chalk.white.bold(stats.totalArtifacts));
    console.log(chalk.cyan('Modifications:     ') + chalk.white.bold(stats.totalModifications || 0));

    if (stats.totalPrompts > 0) {
      console.log(chalk.bold('\n📊 Prompts by Phase:\n'));
      Object.entries(stats.byPhase || {})
        .sort((a, b) => b[1] - a[1])
        .forEach(([phase, count]) => {
          const percentage = ((count / stats.totalPrompts) * 100).toFixed(1);
          const bar = '█'.repeat(Math.floor(count / stats.totalPrompts * 30));
          console.log(`  ${phase.padEnd(18)} ${chalk.blue(bar)} ${chalk.white(count)} (${percentage}%)`);
        });

      console.log(chalk.bold('\n👥 Prompts by Agent:\n'));
      Object.entries(stats.byAgent || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10) // Top 10
        .forEach(([agent, count]) => {
          const percentage = ((count / stats.totalPrompts) * 100).toFixed(1);
          console.log(`  ${agent.padEnd(25)} ${chalk.white(count.toString().padStart(4))} (${percentage}%)`);
        });
    }

    console.log('');

  } catch (error) {
    spinner.fail('Error calculating statistics');
    console.error(chalk.red('\nError: ' + error.message));
  }
}

// Search prompts
async function searchPrompts() {
  const { keyword } = await inquirer.prompt([
    {
      type: 'input',
      name: 'keyword',
      message: 'Enter search keyword:',
      validate: (input) => input.length > 0 || 'Please enter a keyword'
    }
  ]);

  const spinner = ora('Searching prompts...').start();

  try {
    const stateManager = new StateManager(projectRoot);
    const results = stateManager.searchPrompts(keyword);

    spinner.succeed(`Found ${results.length} matching prompts`);

    if (results.length === 0) {
      console.log(chalk.yellow('\nNo prompts found matching: ' + keyword));
      return;
    }

    console.log(chalk.bold(`\n🔍 Search Results (${results.length} found)\n`));
    console.log(chalk.gray('─'.repeat(60)));

    results.slice(0, 20).forEach((prompt, idx) => {
      console.log(chalk.bold(`\n${idx + 1}. ${prompt.phase} • ${prompt.agent}`));
      console.log(chalk.gray('   ' + new Date(prompt.timestamp).toLocaleString()));
      console.log('   ' + prompt.prompt.slice(0, 100) + (prompt.prompt.length > 100 ? '...' : ''));

      if (prompt.artifactsCreated?.length > 0) {
        console.log(chalk.green('   ✓ Created: ' + prompt.artifactsCreated.join(', ')));
      }
      if (prompt.artifactsModified?.length > 0) {
        console.log(chalk.blue('   ✎ Modified: ' + prompt.artifactsModified.join(', ')));
      }
    });

    if (results.length > 20) {
      console.log(chalk.gray(`\n... and ${results.length - 20} more results`));
    }

    console.log('');

  } catch (error) {
    spinner.fail('Error searching prompts');
    console.error(chalk.red('\nError: ' + error.message));
  }
}

// View artifact history
async function viewArtifactHistory() {
  const { artifactPath } = await inquirer.prompt([
    {
      type: 'input',
      name: 'artifactPath',
      message: 'Enter artifact path (relative to project root):',
      validate: (input) => input.length > 0 || 'Please enter an artifact path'
    }
  ]);

  const spinner = ora('Loading artifact history...').start();

  try {
    const stateManager = new StateManager(projectRoot);
    const history = stateManager.getArtifactHistory(artifactPath);

    if (!history) {
      spinner.fail('Artifact not found in lineage');
      console.log(chalk.yellow(`\nNo history found for: ${artifactPath}`));
      console.log(chalk.gray('This artifact may not have been tracked yet.'));
      return;
    }

    spinner.succeed('Artifact history loaded');

    console.log(chalk.bold(`\n📁 Artifact History: ${artifactPath}\n`));
    console.log(chalk.gray('─'.repeat(60)));

    const { summary } = history;
    console.log(chalk.cyan('Created:           ') + chalk.white(new Date(summary.created).toLocaleString()));
    console.log(chalk.cyan('Created By:        ') + chalk.white(summary.createdBy));
    console.log(chalk.cyan('Current Version:   ') + chalk.white.bold(summary.currentVersion));
    console.log(chalk.cyan('Total Versions:    ') + chalk.white(summary.totalVersions));
    console.log(chalk.cyan('Modifications:     ') + chalk.white(summary.totalModifications));
    console.log(chalk.cyan('Last Modified:     ') + chalk.white(new Date(summary.lastModified).toLocaleString()));

    console.log(chalk.bold('\n📜 Version History:\n'));

    history.lineage.versions.forEach((version, idx) => {
      const isLatest = idx === history.lineage.versions.length - 1;
      const versionLabel = isLatest ? chalk.green.bold(`v${version.version} (current)`) : chalk.gray(`v${version.version}`);

      console.log(`\n  ${versionLabel}`);
      console.log(chalk.gray('  ' + new Date(version.timestamp).toLocaleString()));
      console.log(`  ${version.agent} • ${version.changeType}`);
      console.log('  "' + version.prompt.slice(0, 80) + (version.prompt.length > 80 ? '..."' : '"'));
      if (version.changeSummary) {
        console.log(chalk.italic('  → ' + version.changeSummary));
      }
    });

    console.log('');

  } catch (error) {
    spinner.fail('Error loading artifact history');
    console.error(chalk.red('\nError: ' + error.message));
  }
}

// Generate reports
async function generateReports() {
  const { reportType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'reportType',
      message: 'What type of report would you like to generate?',
      choices: [
        { name: '📊 Full Traceability Report', value: 'full' },
        { name: '📁 Artifact Report', value: 'artifact' },
        { name: '🔄 Phase Report', value: 'phase' },
        { name: '👤 Agent Report', value: 'agent' },
        new inquirer.Separator(),
        { name: '← Back', value: 'back' }
      ]
    }
  ]);

  if (reportType === 'back') return;

  const reporter = new TraceabilityReport(projectRoot);
  const spinner = ora('Generating report...').start();

  try {
    let report;
    let filename;

    switch (reportType) {
      case 'full':
        report = reporter.generateFullReport({
          includeStatistics: true,
          includeTimeline: true,
          includeArtifacts: true
        });
        filename = `traceability-report-${Date.now()}.md`;
        break;

      case 'artifact': {
        const { path } = await inquirer.prompt([
          { type: 'input', name: 'path', message: 'Artifact path:' }
        ]);
        report = reporter.generateArtifactReport(path);
        filename = `artifact-${path.replace(/\//g, '-')}-${Date.now()}.md`;
        break;
      }

      case 'phase': {
        const { phase } = await inquirer.prompt([
          { type: 'input', name: 'phase', message: 'Phase name:' }
        ]);
        report = reporter.generatePhaseReport(phase);
        filename = `phase-${phase}-${Date.now()}.md`;
        break;
      }

      case 'agent': {
        const { agent } = await inquirer.prompt([
          { type: 'input', name: 'agent', message: 'Agent name:' }
        ]);
        report = reporter.generateAgentReport(agent);
        filename = `agent-${agent.replace(/\s+/g, '-')}-${Date.now()}.md`;
        break;
      }
    }

    if (report) {
      const reportPath = reporter.saveReport(report, filename);
      spinner.succeed('Report generated successfully');
      console.log(chalk.green('\n✓ Report saved to: ' + chalk.bold(reportPath)));
      console.log(chalk.gray('  Open this file to view the full report.\n'));
    }

  } catch (error) {
    spinner.fail('Error generating report');
    console.error(chalk.red('\nError: ' + error.message));
  }
}

// Framework settings
async function frameworkSettings() {
  const stateManager = new StateManager(projectRoot);
  const state = stateManager.load();

  const { setting } = await inquirer.prompt([
    {
      type: 'list',
      name: 'setting',
      message: 'Settings:',
      choices: [
        { name: '📊 View Token Budgets', value: 'budgets' },
        { name: '🔄 View Phase Configuration', value: 'phases' },
        { name: '📁 View Directory Structure', value: 'dirs' },
        new inquirer.Separator(),
        { name: '← Back', value: 'back' }
      ]
    }
  ]);

  if (setting === 'back') return;

  switch (setting) {
    case 'budgets':
      console.log(chalk.bold('\n💰 Token Budget Configuration\n'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(chalk.cyan('Bootstrap:         ') + chalk.white('800 tokens'));
      console.log(chalk.cyan('Current Phase:     ') + chalk.white('1500 tokens'));
      console.log(chalk.cyan('Adjacent Phase:    ') + chalk.white('500 tokens'));
      console.log(chalk.cyan('Recent Artifacts:  ') + chalk.white('2000 tokens'));
      console.log(chalk.cyan('Project Summary:   ') + chalk.white('1000 tokens'));
      console.log(chalk.cyan('Session State:     ') + chalk.white('700 tokens'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(chalk.bold('Total Budget:      ') + chalk.white.bold('7500 tokens\n'));
      break;

    case 'phases':
      console.log(chalk.bold('\n🔄 Available Phases\n'));
      console.log(chalk.gray('─'.repeat(60)));
      ['research', 'planning', 'design', 'test-first', 'implementation', 'validation', 'iteration'].forEach((phase, idx) => {
        const score = state.quality_scores[phase];
        const scoreStr = score ? chalk.green(` (${score}/100)`) : chalk.gray(' (not started)');
        const current = state.current_phase === phase ? chalk.yellow(' ← current') : '';
        console.log(`  ${(idx + 1)}. ${phase}${scoreStr}${current}`);
      });
      console.log('');
      break;

    case 'dirs':
      console.log(chalk.bold('\n📁 Directory Structure\n'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(chalk.cyan('.claude/           ') + chalk.gray('Framework configuration'));
      console.log(chalk.cyan('  ├─ core/         ') + chalk.gray('Core modules'));
      console.log(chalk.cyan('  ├─ commands/     ') + chalk.gray('Phase prompts'));
      console.log(chalk.cyan('  ├─ state/        ') + chalk.gray('Project state & backups'));
      console.log(chalk.cyan('  ├─ logs/         ') + chalk.gray('Application logs'));
      console.log(chalk.cyan('  └─ reports/      ') + chalk.gray('Generated reports'));
      console.log(chalk.cyan('scripts/           ') + chalk.gray('Utility scripts'));
      console.log(chalk.cyan('docs/              ') + chalk.gray('Documentation'));
      console.log('');
      break;
  }
}

// Main CLI loop
async function main() {
  showBanner();

  try {
    while (true) {
      const action = await showMainMenu();

      if (action === 'exit') {
        console.log(chalk.blue('\n👋 Thank you for using Multi-Agent Framework!\n'));
        process.exit(0);
      }

      switch (action) {
        case 'status':
          await viewProjectStatus();
          break;
        case 'stats':
          await viewStatistics();
          break;
        case 'search':
          await searchPrompts();
          break;
        case 'artifact':
          await viewArtifactHistory();
          break;
        case 'reports':
          await generateReports();
          break;
        case 'settings':
          await frameworkSettings();
          break;
      }

      // Pause before showing menu again
      await inquirer.prompt([
        {
          type: 'input',
          name: 'continue',
          message: 'Press Enter to continue...'
        }
      ]);
    }

  } catch (error) {
    if (error.isTtyError) {
      console.error(chalk.red('\nError: Prompt couldn\'t be rendered in the current environment'));
    } else {
      console.error(chalk.red('\nError: ' + error.message));
      logger.error('CLI error', { error: error.message, stack: error.stack });
    }
    process.exit(1);
  }
}

// Run CLI
if (require.main === module) {
  main();
}

module.exports = { main };
