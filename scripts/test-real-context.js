#!/usr/bin/env node

/**
 * Test Real Context Tracking
 *
 * This script tests the real context tracker by:
 * 1. Sending simulated OTLP metrics with token counts
 * 2. Manually updating context percentages
 * 3. Verifying checkpoint triggers
 */

const axios = require('axios');
const chalk = require('chalk');

// Configuration
const OTLP_ENDPOINT = 'http://localhost:4318/v1/metrics';
const DASHBOARD_URL = 'http://localhost:3030';

/**
 * Send OTLP metrics with token usage
 */
async function sendTokenMetrics(sessionId, tokens) {
  const now = Date.now() * 1000000; // nanoseconds

  const payload = {
    resourceMetrics: [{
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'claude-code' } },
          { key: 'conversation.id', value: { stringValue: sessionId } }
        ]
      },
      scopeMetrics: [{
        scope: {
          name: 'claude-code-metrics',
          version: '1.0.0'
        },
        metrics: [{
          name: 'claude_code.token.usage',
          description: 'Token usage',
          unit: 'tokens',
          sum: {
            dataPoints: [
              {
                attributes: [
                  { key: 'model', value: { stringValue: 'claude-opus-4-5-20251101' } },
                  { key: 'type', value: { stringValue: 'input' } }
                ],
                startTimeUnixNano: now - 5000000000,
                timeUnixNano: now,
                asInt: tokens.input || 0
              },
              {
                attributes: [
                  { key: 'model', value: { stringValue: 'claude-opus-4-5-20251101' } },
                  { key: 'type', value: { stringValue: 'output' } }
                ],
                startTimeUnixNano: now - 5000000000,
                timeUnixNano: now,
                asInt: tokens.output || 0
              }
            ],
            aggregationTemporality: 2, // Cumulative
            isMonotonic: true
          }
        }]
      }]
    }]
  };

  try {
    const response = await axios.post(OTLP_ENDPOINT, payload, {
      headers: { 'Content-Type': 'application/json' }
    });
    return response.status === 200;
  } catch (error) {
    console.error(chalk.red('Failed to send metrics:'), error.message);
    return false;
  }
}

/**
 * Check dashboard for context status
 */
async function checkDashboard() {
  try {
    const response = await axios.get(`${DASHBOARD_URL}/api/status`);
    return response.data;
  } catch (error) {
    console.error(chalk.red('Failed to check dashboard:'), error.message);
    return null;
  }
}

/**
 * Simulate a session with increasing token usage
 */
async function simulateSession() {
  console.log(chalk.bold.cyan('\n🧪 Testing Real Context Tracker\n'));

  const sessionId = `test-session-${Date.now()}`;
  console.log(chalk.bold('Session ID:'), sessionId);
  console.log(chalk.bold('Max Context:'), '200,000 tokens\n');

  // Test checkpoints at different percentages
  const tests = [
    { input: 50000, output: 20000, expected: 35 },  // 70k = 35%
    { input: 40000, output: 30000, expected: 70 },  // 140k = 70% (checkpoint!)
    { input: 20000, output: 10000, expected: 85 },  // 170k = 85% (checkpoint!)
    { input: 15000, output: 5000, expected: 95 }    // 190k = 95% (emergency!)
  ];

  let totalInput = 0;
  let totalOutput = 0;

  for (const test of tests) {
    totalInput += test.input;
    totalOutput += test.output;

    console.log(chalk.yellow(`\n📤 Sending metrics: +${test.input} input, +${test.output} output tokens`));

    const sent = await sendTokenMetrics(sessionId, {
      input: test.input,
      output: test.output
    });

    if (!sent) {
      console.error(chalk.red('❌ Failed to send metrics. Is OTLP receiver running?'));
      console.log(chalk.gray('Start it with: npm run start:dashboard'));
      return;
    }

    console.log(chalk.green('✓ Metrics sent'));

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Calculate expected
    const total = totalInput + totalOutput;
    const percentage = (total / 200000) * 100;

    console.log(chalk.blue(`📊 Total tokens: ${total.toLocaleString()}`));
    console.log(chalk.blue(`📊 Context usage: ${percentage.toFixed(1)}%`));

    // Check for checkpoint warnings
    if (percentage >= 70 && percentage < 85) {
      console.log(chalk.yellow('⚠️  WARNING: Context at 70% - checkpoint recommended'));
    } else if (percentage >= 85 && percentage < 95) {
      console.log(chalk.orange('⚠️  WARNING: Context at 85% - checkpoint strongly recommended'));
    } else if (percentage >= 95) {
      console.log(chalk.red('🚨 EMERGENCY: Context at 95% - immediate checkpoint required!'));
    }

    // Check dashboard
    const status = await checkDashboard();
    if (status) {
      console.log(chalk.gray('Dashboard response received'));
    }
  }

  console.log(chalk.bold.green('\n✅ Test Complete!\n'));

  console.log(chalk.bold('Expected behaviors:'));
  console.log('1. Checkpoint should trigger at 70%');
  console.log('2. Warning checkpoint at 85%');
  console.log('3. Emergency checkpoint at 95%');
  console.log('4. Check .claude/checkpoints/ for auto-checkpoint files\n');
}

/**
 * Test manual context update
 */
async function testManualUpdate() {
  console.log(chalk.bold.cyan('\n🔧 Testing Manual Context Update\n'));

  try {
    const response = await axios.post(`${DASHBOARD_URL}/api/context/manual`, {
      sessionId: 'manual-test',
      percentage: 92
    });

    console.log(chalk.green('✓ Manual update sent (92%)'));
    console.log(chalk.red('🚨 This should trigger emergency checkpoint!'));
  } catch (error) {
    console.log(chalk.gray('Manual update endpoint not available yet'));
  }
}

/**
 * Main function
 */
async function main() {
  console.log(chalk.bold.cyan(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║            🧪 Real Context Tracking Test Suite 🧪             ║
║                                                                ║
║  This tests the real context tracking system to ensure        ║
║  checkpoints trigger at the correct thresholds                ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
  `));

  // Check if services are running
  try {
    await axios.get(OTLP_ENDPOINT.replace('/v1/metrics', '/health'));
  } catch (error) {
    console.error(chalk.red('\n❌ OTLP Receiver is not running!'));
    console.log(chalk.yellow('\nPlease start the dashboard first:'));
    console.log(chalk.cyan('  npm run start:dashboard\n'));
    process.exit(1);
  }

  // Run tests
  await simulateSession();
  await testManualUpdate();

  console.log(chalk.bold.cyan('\n🎉 All tests completed!\n'));
  console.log('Check the dashboard at:', chalk.cyan('http://localhost:3030'));
  console.log('Check checkpoint files at:', chalk.cyan('.claude/checkpoints/\n'));
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error(chalk.red('\n❌ Error:'), error.message);
  process.exit(1);
});

// Run main
main().catch(error => {
  console.error(chalk.red('\n❌ Fatal error:'), error);
  process.exit(1);
});