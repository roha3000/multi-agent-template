#!/usr/bin/env node

/**
 * Validate Real Context Tracking
 *
 * Simple test to verify the real context tracker is working
 */

const RealContextTracker = require('../.claude/core/real-context-tracker');
const chalk = require('chalk');

console.log(chalk.bold.cyan(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║            🧪 Real Context Tracking Validation 🧪             ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`));

async function testTracker() {
  console.log(chalk.bold('1. Testing Real Context Tracker Initialization'));

  const tracker = new RealContextTracker({
    maxContextWindow: 200000,
    checkpointThresholds: [70, 85, 95]
  });

  console.log(chalk.green('✓ Tracker initialized successfully'));
  console.log(chalk.gray(`  - Max context: 200,000 tokens`));
  console.log(chalk.gray(`  - Thresholds: 70%, 85%, 95%`));
  console.log(chalk.gray(`  - Session logs path: ${tracker.options.sessionLogsPath || 'Not found'}`));

  // Test session tracking
  console.log(chalk.bold('\n2. Testing Session Tracking'));

  const sessionId = 'test-session-1';
  const session = tracker.trackSession(sessionId);

  console.log(chalk.green('✓ Session created'));
  console.log(chalk.gray(`  - Session ID: ${session.id}`));
  console.log(chalk.gray(`  - Model: ${session.model}`));
  console.log(chalk.gray(`  - Total tokens: ${session.totalTokens}`));

  // Test token accumulation
  console.log(chalk.bold('\n3. Testing Token Accumulation'));

  // Track checkpoint triggers
  let checkpoints = [];
  tracker.on('checkpoint', (data) => {
    checkpoints.push(data);
    console.log(chalk.yellow(`  ⚠️ Checkpoint triggered at ${data.threshold}%!`));
  });

  tracker.on('emergency', (data) => {
    console.log(chalk.red(`  🚨 EMERGENCY at ${data.percentage.toFixed(1)}%!`));
  });

  // Simulate token usage
  const tests = [
    { tokens: 50000, expected: 25 },   // 25%
    { tokens: 90000, expected: 70 },   // 70% - should trigger checkpoint
    { tokens: 30000, expected: 85 },   // 85% - should trigger checkpoint
    { tokens: 20000, expected: 95 }    // 95% - should trigger emergency
  ];

  for (const test of tests) {
    tracker._updateSessionTokens(sessionId, {
      input: test.tokens / 2,
      output: test.tokens / 2
    });

    const percentage = tracker.getContextPercentage(sessionId);
    console.log(chalk.blue(`  Added ${test.tokens.toLocaleString()} tokens → ${percentage.toFixed(1)}% context`));

    // Wait for events to fire
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Verify checkpoints
  console.log(chalk.bold('\n4. Validation Results'));

  const expectedCheckpoints = [70, 85, 95];
  const triggeredThresholds = checkpoints.map(c => c.threshold);

  let allPassed = true;

  for (const expected of expectedCheckpoints) {
    if (triggeredThresholds.includes(expected)) {
      console.log(chalk.green(`  ✓ Checkpoint at ${expected}% - PASSED`));
    } else {
      console.log(chalk.red(`  ✗ Checkpoint at ${expected}% - FAILED`));
      allPassed = false;
    }
  }

  // Test session info
  console.log(chalk.bold('\n5. Testing Session Info'));

  const info = tracker.getSessionInfo(sessionId);
  console.log(chalk.gray(`  - Total tokens: ${info.totalTokens.toLocaleString()}`));
  console.log(chalk.gray(`  - Context used: ${info.percentage.toFixed(1)}%`));
  console.log(chalk.gray(`  - Tokens remaining: ${info.contextRemaining.toLocaleString()}`));
  console.log(chalk.gray(`  - Est. requests remaining: ~${info.estimatedRequestsRemaining}`));

  // Stop tracker
  tracker.stop();

  // Final result
  console.log(chalk.bold('\n═══════════════════════════════════════════════'));
  if (allPassed) {
    console.log(chalk.green.bold('✅ ALL TESTS PASSED!'));
    console.log(chalk.green('The Real Context Tracker is working correctly.'));
    console.log(chalk.green('Checkpoints trigger at the correct thresholds.'));
  } else {
    console.log(chalk.red.bold('❌ SOME TESTS FAILED'));
    console.log(chalk.red('Check the results above for details.'));
  }
  console.log(chalk.bold('═══════════════════════════════════════════════\n'));

  return allPassed;
}

// Test manual update
async function testManualUpdate() {
  console.log(chalk.bold('\n6. Testing Manual Context Update'));

  const tracker = new RealContextTracker();

  let emergencyFired = false;
  tracker.on('emergency', () => {
    emergencyFired = true;
  });

  tracker.manualUpdate('manual-test', 96);

  await new Promise(resolve => setTimeout(resolve, 100));

  if (emergencyFired) {
    console.log(chalk.green('  ✓ Manual update at 96% triggered emergency'));
  } else {
    console.log(chalk.red('  ✗ Manual update did not trigger emergency'));
  }

  tracker.stop();
}

// Run tests
async function main() {
  try {
    const passed = await testTracker();
    await testManualUpdate();

    if (passed) {
      console.log(chalk.bold.green('\n🎉 Validation Complete - System is Working!\n'));
      process.exit(0);
    } else {
      console.log(chalk.bold.red('\n⚠️ Validation Failed - Check Implementation\n'));
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red('\n❌ Error during validation:'), error);
    process.exit(1);
  }
}

main();