#!/usr/bin/env node
/**
 * Session Bootstrap Script
 * Initializes Claude session with intelligent phase detection
 * Usage: node scripts/session-bootstrap.js ["user task description"]
 */

const path = require('path');
const fs = require('fs');
const SessionInitializer = require('../.claude/core/session-init');
const ContinuousLoopManager = require('../.claude/core/continuous-loop-manager');

// Get project root (parent of scripts directory)
const projectRoot = path.resolve(__dirname, '..');

// Get user task from command line or use default
const userTask = process.argv.slice(2).join(' ') || null;

// Initialize session
const sessionInit = new SessionInitializer(projectRoot);

/**
 * Check configuration and start continuous loop if auto-start is enabled
 */
async function checkAndStartContinuousLoop(projectRoot) {
  try {
    // Load continuous loop configuration
    const configPath = path.join(projectRoot, '.claude', 'continuous-loop-config.json');

    if (!fs.existsSync(configPath)) {
      return; // No config file, skip auto-start
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    // Check if continuous loop is enabled and auto-start is configured
    if (!config.continuousLoop?.enabled || !config.continuousLoop?.autoStart) {
      return; // Not enabled or auto-start disabled
    }

    console.log('════════════════════════════════════════════════════════════');
    console.log('  CONTINUOUS LOOP AUTO-START');
    console.log('════════════════════════════════════════════════════════════\n');

    // Initialize continuous loop manager
    const loopManager = new ContinuousLoopManager({ projectRoot });

    // Check if already running
    const status = loopManager.isRunning();
    if (status.running) {
      console.log(`✅ Continuous loop already running`);
      console.log(`   PID: ${status.pid}`);
      console.log(`   Dashboard: http://localhost:${status.port}`);
      console.log(`   Started: ${new Date(status.startedAt).toLocaleString()}\n`);
      return;
    }

    // Start the continuous loop
    console.log('⏳ Starting continuous loop system...');
    const startResult = await loopManager.start(config.continuousLoop);

    if (startResult.success) {
      console.log(`✅ Continuous loop started successfully`);
      console.log(`   PID: ${startResult.pid}`);
      console.log(`   Dashboard: http://localhost:${startResult.port}`);
      console.log(`\n   The system will automatically:`);
      console.log(`   • Monitor context window usage`);
      console.log(`   • Track API rate limits`);
      console.log(`   • Monitor costs against budgets`);
      console.log(`   • Detect operations requiring human review\n`);
    } else {
      console.log(`⚠️  Failed to start continuous loop: ${startResult.message}`);
      console.log(`   You can manually start it with: node start-continuous-loop.js\n`);
    }

  } catch (error) {
    console.log(`⚠️  Error during continuous loop auto-start: ${error.message}`);
    console.log(`   You can manually start it with: node start-continuous-loop.js\n`);
  }
}

async function main() {
  try {
    console.log('🚀 Initializing Claude session...\n');

    // Initialize with user task if provided
    const result = sessionInit.initialize(userTask);

  if (result.success) {
    // Display session information
    console.log('════════════════════════════════════════════════════════════');
    console.log('  SESSION CONTEXT READY');
    console.log('════════════════════════════════════════════════════════════\n');

    console.log(`📍 Target Phase: ${result.targetPhase}`);
    console.log(`🤖 Agent: ${result.agent}`);
    console.log(`💯 Confidence: ${result.confidence}%`);

    if (result.phaseTransition) {
      console.log(`🔄 Transition: ${result.phaseTransition.from} → ${result.phaseTransition.to}`);
    }

    console.log(`\n📊 Token Usage: ${result.metadata.tokenCount} tokens`);

    if (userTask) {
      console.log(`\n📝 Task: "${userTask}"`);
    }

    if (result.reasoning) {
      console.log(`\n💭 Reasoning: ${result.reasoning}`);
    }

    // Display session prompt
    console.log('\n════════════════════════════════════════════════════════════');
    console.log('  PASTE THIS CONTEXT INTO CLAUDE');
    console.log('════════════════════════════════════════════════════════════\n');

    console.log(result.sessionPrompt);

    console.log('\n════════════════════════════════════════════════════════════\n');

    // Save to file for easy copy-paste
    fs.writeFileSync(
      path.join(projectRoot, 'SESSION_CONTEXT.md'),
      result.sessionPrompt,
      'utf-8'
    );

    console.log('✅ Session context saved to SESSION_CONTEXT.md');
    console.log('   (Open this file and copy-paste into Claude)\n');

    // Auto-start continuous loop if configured
    await checkAndStartContinuousLoop(projectRoot);

    // Display project status
    const status = sessionInit.getStatus();
    console.log('════════════════════════════════════════════════════════════');
    console.log('  PROJECT STATUS');
    console.log('════════════════════════════════════════════════════════════\n');

    console.log(`Current Phase: ${status.currentPhase}`);
    console.log(`Quality Score: ${status.qualityScores[status.currentPhase] || 0}/100`);

    if (status.unresolvedBlockers.length > 0) {
      console.log(`\n⚠️  Active Blockers (${status.unresolvedBlockers.length}):`);
      status.unresolvedBlockers.forEach((blocker, i) => {
        console.log(`  ${i + 1}. [${blocker.severity}] ${blocker.blocker}`);
      });
    }

    if (status.artifacts && Object.keys(status.artifacts).length > 0) {
      console.log(`\n📄 Artifacts:`);
      Object.entries(status.artifacts).forEach(([phase, files]) => {
        console.log(`  ${phase}: ${files.length} file(s)`);
      });
    }

    console.log('\n════════════════════════════════════════════════════════════\n');

  } else {
    console.error('❌ Session initialization failed:', result.error);
    console.error('\nDetails:', result.details);
    process.exit(1);
  }

  } catch (error) {
    console.error('❌ Fatal error during session initialization:');
    console.error(error.message);
    console.error('\nStack trace:');
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
