#!/usr/bin/env node
/**
 * Manual Usage Tracking Helper
 *
 * Quick CLI tool to manually record token usage from Claude sessions.
 *
 * Usage:
 *   node .claude/scripts/track-usage.js [input] [output] [cache-read] [cache-creation]
 *
 * Examples:
 *   # Record usage from <budget> tag in Claude's response
 *   node .claude/scripts/track-usage.js 5420 2100 3200 0
 *
 *   # Interactive mode (no arguments)
 *   node .claude/scripts/track-usage.js
 *
 * The script will automatically:
 * - Connect to the running dashboard
 * - Record usage in the database
 * - Update the dashboard in real-time
 */

const path = require('path');
const readline = require('readline');
const ClaudeSessionTracker = require('../core/claude-session-tracker');
const UsageTracker = require('../core/usage-tracker');
const MemoryStore = require('../core/memory-store');

const projectPath = process.cwd();

async function trackUsage(inputTokens, outputTokens, cacheReadTokens = 0, cacheCreationTokens = 0) {
  console.log('📊 Recording Claude usage...\n');

  // Initialize components
  const dbPath = path.join(projectPath, '.claude', 'memory', 'session-tracking.db');
  const memoryStore = new MemoryStore(dbPath);
  const usageTracker = new UsageTracker(memoryStore);
  const tracker = new ClaudeSessionTracker({
    usageTracker,
    projectPath
  });

  // Record usage
  await tracker.recordConversationTurn({
    inputTokens: parseInt(inputTokens),
    outputTokens: parseInt(outputTokens),
    cacheReadTokens: parseInt(cacheReadTokens),
    cacheCreationTokens: parseInt(cacheCreationTokens),
    model: 'claude-sonnet-4',
    task: 'Manual tracking'
  });

  // Get session stats
  const sessionStats = await usageTracker.getSessionUsage();
  const cost = await usageTracker.getSessionCost();

  console.log('✅ Usage recorded successfully!\n');
  console.log('Session Totals:');
  console.log(`  Input tokens:          ${sessionStats.totalInputTokens.toLocaleString()}`);
  console.log(`  Output tokens:         ${sessionStats.totalOutputTokens.toLocaleString()}`);
  console.log(`  Cache read tokens:     ${sessionStats.totalCacheReadTokens.toLocaleString()}`);
  console.log(`  Cache creation tokens: ${sessionStats.totalCacheCreationTokens.toLocaleString()}`);
  console.log(`  Total tokens:          ${sessionStats.totalTokens.toLocaleString()}`);
  console.log(`  Total cost:            $${cost.totalCost.toFixed(4)}`);
  console.log(`\n📈 Dashboard updated! View at: http://localhost:3030\n`);

  // Cleanup
  memoryStore.close();
}

async function interactiveMode() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

  console.log('\n📊 Manual Usage Tracking (Interactive Mode)\n');
  console.log('Look for the <budget:token_budget> tag in Claude\'s response.');
  console.log('Example: Token usage: 5420/200000; 194580 remaining\n');

  try {
    const input = await question('Input tokens (from Claude response): ');
    const output = await question('Output tokens (from Claude response): ');
    const cacheRead = await question('Cache read tokens (default 0): ') || '0';
    const cacheCreation = await question('Cache creation tokens (default 0): ') || '0';

    await trackUsage(input, output, cacheRead, cacheCreation);
  } finally {
    rl.close();
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Interactive mode
    await interactiveMode();
  } else if (args.length >= 2) {
    // Command-line args mode
    const [input, output, cacheRead = '0', cacheCreation = '0'] = args;
    await trackUsage(input, output, cacheRead, cacheCreation);
  } else {
    console.error('❌ Error: Invalid arguments\n');
    console.log('Usage:');
    console.log('  Interactive:  node .claude/scripts/track-usage.js');
    console.log('  Quick:        node .claude/scripts/track-usage.js [input] [output] [cache-read] [cache-creation]');
    console.log('\nExample:');
    console.log('  node .claude/scripts/track-usage.js 5420 2100 3200 0');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
