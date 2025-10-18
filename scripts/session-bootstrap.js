#!/usr/bin/env node
/**
 * Session Bootstrap Script
 * Initializes Claude session with intelligent phase detection
 * Usage: node scripts/session-bootstrap.js ["user task description"]
 */

const path = require('path');
const SessionInitializer = require('../.claude/core/session-init');

// Get project root (parent of scripts directory)
const projectRoot = path.resolve(__dirname, '..');

// Get user task from command line or use default
const userTask = process.argv.slice(2).join(' ') || null;

// Initialize session
const sessionInit = new SessionInitializer(projectRoot);

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
    const fs = require('fs');
    fs.writeFileSync(
      path.join(projectRoot, 'SESSION_CONTEXT.md'),
      result.sessionPrompt,
      'utf-8'
    );

    console.log('✅ Session context saved to SESSION_CONTEXT.md');
    console.log('   (Open this file and copy-paste into Claude)\n');

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
