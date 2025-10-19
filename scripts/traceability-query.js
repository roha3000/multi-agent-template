#!/usr/bin/env node

/**
 * Traceability Query Tool
 *
 * Interactive CLI for querying prompt history and artifact lineage.
 *
 * Usage:
 *   node scripts/traceability-query.js [command] [options]
 *
 * Commands:
 *   report          Generate full traceability report
 *   artifact        Get history of specific artifact
 *   phase           Get prompts for specific phase
 *   agent           Get prompts by agent
 *   search          Search prompts by keyword
 *   stats           Show prompt statistics
 *   session         Show current session prompts
 */

const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');

// Dynamically require core components
const TraceabilityReport = require('../.claude/core/traceability-report');
const SessionInitializer = require('../.claude/core/session-init');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function printHeader(title) {
  console.log();
  log('═'.repeat(60), 'blue');
  log(`  ${title}`, 'bright');
  log('═'.repeat(60), 'blue');
  console.log();
}

function printSection(title) {
  console.log();
  log(`${title}`, 'cyan');
  log('─'.repeat(title.length), 'cyan');
}

function printUsage() {
  printHeader('Traceability Query Tool');

  console.log('Usage:');
  console.log('  node scripts/traceability-query.js [command] [options]');
  console.log();

  console.log('Commands:');
  console.log('  report [--phase=<phase>] [--agent=<agent>]');
  console.log('    Generate full traceability report');
  console.log();
  console.log('  artifact <path>');
  console.log('    Get complete history of specific artifact');
  console.log();
  console.log('  phase <phase-name>');
  console.log('    Get all prompts for specific phase');
  console.log();
  console.log('  agent <agent-name>');
  console.log('    Get all prompts by specific agent');
  console.log();
  console.log('  search <keyword>');
  console.log('    Search prompts by keyword');
  console.log();
  console.log('  stats');
  console.log('    Show prompt statistics');
  console.log();
  console.log('  session');
  console.log('    Show current session prompts');
  console.log();

  console.log('Examples:');
  console.log('  node scripts/traceability-query.js stats');
  console.log('  node scripts/traceability-query.js artifact src/components/Header.tsx');
  console.log('  node scripts/traceability-query.js phase implementation');
  console.log('  node scripts/traceability-query.js search "authentication"');
  console.log('  node scripts/traceability-query.js report --phase=design');
  console.log();
}

function generateReport(options) {
  printHeader('Generating Traceability Report');

  const reporter = new TraceabilityReport(projectRoot);

  const reportOptions = {
    includeStatistics: true,
    includeTimeline: true,
    includeArtifacts: true
  };

  // Parse filter options
  if (options.phase) {
    reportOptions.filterPhase = options.phase;
    log(`Filtering by phase: ${options.phase}`, 'yellow');
  }

  if (options.agent) {
    reportOptions.filterAgent = options.agent;
    log(`Filtering by agent: ${options.agent}`, 'yellow');
  }

  const report = reporter.generateFullReport(reportOptions);

  // Save to file
  const filePath = reporter.saveReport(
    report,
    `traceability-report-${Date.now()}.md`
  );

  console.log();
  log(`✓ Report generated successfully`, 'green');
  log(`  Location: ${filePath}`, 'dim');
  console.log();

  // Print summary
  const stats = reporter.stateManager.getPromptStatistics();
  printSection('Summary');
  console.log(`Total Prompts: ${stats.totalPrompts}`);
  console.log(`Total Artifacts: ${stats.totalArtifacts}`);
  console.log(`Total Sessions: ${stats.totalSessions}`);
  console.log();
}

function showArtifactHistory(artifactPath) {
  printHeader(`Artifact History: ${artifactPath}`);

  const reporter = new TraceabilityReport(projectRoot);
  const history = reporter.stateManager.getArtifactHistory(artifactPath);

  if (!history) {
    log('✗ Artifact not found in lineage tracking', 'red');
    console.log();
    log('This could mean:', 'yellow');
    console.log('  - The artifact has not been recorded yet');
    console.log('  - The artifact path is incorrect');
    console.log('  - Prompt tracking was not enabled when artifact was created');
    console.log();
    return;
  }

  // Print summary
  printSection('Summary');
  console.log(`Artifact ID: ${history.summary.artifactId}`);
  console.log(`Created: ${new Date(history.summary.created).toLocaleString()}`);
  console.log(`Created By: ${history.summary.createdBy}`);
  console.log(`Current Version: v${history.summary.currentVersion}`);
  console.log(`Total Modifications: ${history.summary.totalModifications}`);
  console.log(`Last Modified: ${new Date(history.summary.lastModified).toLocaleString()}`);

  // Print prompts
  if (history.prompts.length > 0) {
    printSection('Related Prompts');
    history.prompts.forEach((prompt, idx) => {
      console.log(`${idx + 1}. [${new Date(prompt.timestamp).toLocaleString()}] ${prompt.agent}`);
      console.log(`   "${prompt.prompt}"`);
      console.log();
    });
  }

  // Print version history
  if (history.lineage.versions.length > 0) {
    printSection('Version History');
    history.lineage.versions.forEach((version, idx) => {
      const icon = getChangeIcon(version.changeType);
      console.log(`v${version.version} ${icon} ${version.changeType}`);
      console.log(`  Date: ${new Date(version.timestamp).toLocaleString()}`);
      console.log(`  Agent: ${version.agent}`);
      console.log(`  Phase: ${version.phase}`);
      console.log(`  Prompt: "${version.prompt}"`);
      if (version.changeSummary) {
        console.log(`  Summary: ${version.changeSummary}`);
      }
      console.log();
    });
  }
}

function showPhasePrompts(phase) {
  printHeader(`Phase Prompts: ${phase}`);

  const sessionInit = new SessionInitializer(projectRoot);
  const prompts = sessionInit.getPromptsByPhase(phase);

  if (prompts.length === 0) {
    log(`✗ No prompts found for phase: ${phase}`, 'yellow');
    console.log();
    return;
  }

  log(`Found ${prompts.length} prompt(s)`, 'green');
  console.log();

  prompts.forEach((prompt, idx) => {
    console.log(`${idx + 1}. [${new Date(prompt.timestamp).toLocaleString()}]`);
    console.log(`   Agent: ${prompt.agent}`);
    console.log(`   Session: ${prompt.sessionId}`);
    console.log(`   Prompt: "${prompt.prompt}"`);

    if (prompt.artifactsCreated && prompt.artifactsCreated.length > 0) {
      console.log(`   Created: ${prompt.artifactsCreated.join(', ')}`);
    }

    if (prompt.artifactsModified && prompt.artifactsModified.length > 0) {
      console.log(`   Modified: ${prompt.artifactsModified.join(', ')}`);
    }

    console.log();
  });
}

function showAgentPrompts(agent) {
  printHeader(`Agent Prompts: ${agent}`);

  const sessionInit = new SessionInitializer(projectRoot);
  const prompts = sessionInit.stateManager.getPromptsByAgent(agent);

  if (prompts.length === 0) {
    log(`✗ No prompts found for agent: ${agent}`, 'yellow');
    console.log();
    return;
  }

  log(`Found ${prompts.length} prompt(s)`, 'green');
  console.log();

  // Group by phase
  const byPhase = {};
  prompts.forEach(p => {
    if (!byPhase[p.phase]) {
      byPhase[p.phase] = [];
    }
    byPhase[p.phase].push(p);
  });

  Object.entries(byPhase).forEach(([phase, phasePrompts]) => {
    printSection(`${phase} (${phasePrompts.length} prompts)`);

    phasePrompts.forEach((prompt, idx) => {
      console.log(`${idx + 1}. [${new Date(prompt.timestamp).toLocaleString()}]`);
      console.log(`   "${prompt.prompt}"`);

      if (prompt.artifactsCreated && prompt.artifactsCreated.length > 0) {
        console.log(`   Created: ${prompt.artifactsCreated.join(', ')}`);
      }

      console.log();
    });
  });
}

function searchPrompts(keyword) {
  printHeader(`Search Results: "${keyword}"`);

  const sessionInit = new SessionInitializer(projectRoot);
  const prompts = sessionInit.searchPrompts(keyword);

  if (prompts.length === 0) {
    log(`✗ No prompts found matching: ${keyword}`, 'yellow');
    console.log();
    return;
  }

  log(`Found ${prompts.length} matching prompt(s)`, 'green');
  console.log();

  prompts.forEach((prompt, idx) => {
    console.log(`${idx + 1}. [${new Date(prompt.timestamp).toLocaleString()}]`);
    console.log(`   Phase: ${prompt.phase}`);
    console.log(`   Agent: ${prompt.agent}`);
    console.log(`   Prompt: "${prompt.prompt}"`);

    if (prompt.artifactPath) {
      console.log(`   Artifact: ${prompt.artifactPath}`);
    }

    console.log();
  });
}

function showStatistics() {
  printHeader('Prompt Statistics');

  const sessionInit = new SessionInitializer(projectRoot);
  const stats = sessionInit.getPromptStatistics();

  if (stats.totalPrompts === 0) {
    log('No prompts recorded yet', 'yellow');
    console.log();
    return;
  }

  printSection('Overview');
  console.log(`Total Prompts: ${stats.totalPrompts}`);
  console.log(`Total Sessions: ${stats.totalSessions}`);
  console.log(`Avg Prompts/Session: ${stats.avgPromptsPerSession}`);
  console.log(`Total Artifacts: ${stats.totalArtifacts}`);
  console.log(`Total Modifications: ${stats.totalModifications}`);

  if (Object.keys(stats.byPhase).length > 0) {
    printSection('By Phase');
    Object.entries(stats.byPhase)
      .sort((a, b) => b[1] - a[1])
      .forEach(([phase, count]) => {
        const pct = ((count / stats.totalPrompts) * 100).toFixed(1);
        const bar = '█'.repeat(Math.round(pct / 2));
        console.log(`${phase.padEnd(20)} ${count.toString().padStart(4)} (${pct}%) ${bar}`);
      });
  }

  if (Object.keys(stats.byAgent).length > 0) {
    printSection('By Agent');
    Object.entries(stats.byAgent)
      .sort((a, b) => b[1] - a[1])
      .forEach(([agent, count]) => {
        const pct = ((count / stats.totalPrompts) * 100).toFixed(1);
        const bar = '█'.repeat(Math.round(pct / 2));
        console.log(`${agent.padEnd(20)} ${count.toString().padStart(4)} (${pct}%) ${bar}`);
      });
  }

  console.log();
}

function showSessionPrompts() {
  printHeader('Current Session Prompts');

  const sessionInit = new SessionInitializer(projectRoot);
  const prompts = sessionInit.getSessionPrompts();

  if (prompts.length === 0) {
    log('No prompts in current session', 'yellow');
    console.log();
    return;
  }

  log(`Found ${prompts.length} prompt(s) in current session`, 'green');
  console.log();

  prompts.forEach((prompt, idx) => {
    console.log(`${idx + 1}. [${new Date(prompt.timestamp).toLocaleString()}]`);
    console.log(`   Phase: ${prompt.phase}`);
    console.log(`   Agent: ${prompt.agent}`);
    console.log(`   Prompt: "${prompt.prompt}"`);

    if (prompt.artifactsCreated && prompt.artifactsCreated.length > 0) {
      console.log(`   Created: ${prompt.artifactsCreated.join(', ')}`);
    }

    if (prompt.artifactsModified && prompt.artifactsModified.length > 0) {
      console.log(`   Modified: ${prompt.artifactsModified.join(', ')}`);
    }

    console.log();
  });
}

function getChangeIcon(changeType) {
  const icons = {
    'created': '🆕',
    'modified': '✏️',
    'refactored': '♻️',
    'enhanced': '⭐',
    'bug-fix': '🐛'
  };
  return icons[changeType] || '📝';
}

// Main execution
const args = process.argv.slice(2);
const command = args[0];

if (!command || command === 'help' || command === '--help' || command === '-h') {
  printUsage();
  process.exit(0);
}

try {
  switch (command) {
    case 'report':
      const options = {};
      args.slice(1).forEach(arg => {
        if (arg.startsWith('--phase=')) {
          options.phase = arg.split('=')[1];
        } else if (arg.startsWith('--agent=')) {
          options.agent = arg.split('=')[1];
        }
      });
      generateReport(options);
      break;

    case 'artifact':
      if (!args[1]) {
        log('✗ Error: Artifact path required', 'red');
        console.log('Usage: node scripts/traceability-query.js artifact <path>');
        process.exit(1);
      }
      showArtifactHistory(args[1]);
      break;

    case 'phase':
      if (!args[1]) {
        log('✗ Error: Phase name required', 'red');
        console.log('Usage: node scripts/traceability-query.js phase <phase-name>');
        process.exit(1);
      }
      showPhasePrompts(args[1]);
      break;

    case 'agent':
      if (!args[1]) {
        log('✗ Error: Agent name required', 'red');
        console.log('Usage: node scripts/traceability-query.js agent <agent-name>');
        process.exit(1);
      }
      showAgentPrompts(args[1]);
      break;

    case 'search':
      if (!args[1]) {
        log('✗ Error: Search keyword required', 'red');
        console.log('Usage: node scripts/traceability-query.js search <keyword>');
        process.exit(1);
      }
      searchPrompts(args.slice(1).join(' '));
      break;

    case 'stats':
      showStatistics();
      break;

    case 'session':
      showSessionPrompts();
      break;

    default:
      log(`✗ Error: Unknown command: ${command}`, 'red');
      console.log();
      printUsage();
      process.exit(1);
  }

} catch (error) {
  console.error();
  log(`✗ Error: ${error.message}`, 'red');
  console.error();
  console.error('Stack trace:');
  console.error(error.stack);
  process.exit(1);
}
