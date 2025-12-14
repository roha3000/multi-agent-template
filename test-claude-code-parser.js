#!/usr/bin/env node
/**
 * Test script for Claude Code Usage Parser
 *
 * Tests the JSONL parser with sample data
 */

const ClaudeCodeUsageParser = require('./.claude/core/claude-code-usage-parser');
const MemoryStore = require('./.claude/core/memory-store');
const UsageTracker = require('./.claude/core/usage-tracker');
const path = require('path');

async function test() {
  console.log('🧪 Testing Claude Code Usage Parser\n');

  try {
    // Initialize components
    console.log('1. Initializing components...');
    const memoryStore = new MemoryStore('.claude/memory/test-parser.db');
    const usageTracker = new UsageTracker(memoryStore, {
      sessionId: `test-${Date.now()}`
    });

    // Create parser
    console.log('2. Creating parser...');
    const parser = new ClaudeCodeUsageParser({
      usageTracker,
      watchFiles: false, // Don't watch for this test
      trackHistorical: true
    });

    console.log('✅ Parser created successfully\n');

    // Check if .claude/projects directory exists
    console.log('3. Checking for Claude Code projects...');
    const claudeProjectsPath = path.join(require('os').homedir(), '.claude', 'projects');
    console.log(`   Looking in: ${claudeProjectsPath}\n`);

    // Start parser
    console.log('4. Starting parser...');
    await parser.start();

    // Wait a moment for initial scan
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Get statistics
    console.log('\n5. Parser Statistics:');
    const stats = parser.getStats();
    console.log(`   Files processed: ${stats.filesProcessed}`);
    console.log(`   Entries processed: ${stats.entriesProcessed}`);
    console.log(`   Tokens tracked: ${stats.tokensTracked}`);
    console.log(`   Projects discovered: ${stats.projectsDiscovered}`);
    console.log(`   Errors: ${stats.errors}`);
    console.log(`   Is running: ${stats.isRunning}`);

    // Get Claude Code summary
    console.log('\n6. Getting Claude Code usage summary...');
    const summary = await parser.getClaudeCodeSummary('day');

    if (summary && summary.totalCost > 0) {
      console.log(`   Total tokens: ${summary.totalTokens}`);
      console.log(`   Total cost: $${summary.totalCost.toFixed(4)}`);
      console.log(`   Orchestrations: ${summary.orchestrationCount}`);
    } else {
      console.log('   No Claude Code usage found (or no JSONL files)');
    }

    // Stop parser
    console.log('\n7. Stopping parser...');
    await parser.stop();

    // Close memory store
    memoryStore.close();

    console.log('\n✅ Test completed successfully!');

    if (stats.filesProcessed === 0) {
      console.log('\n💡 Note: No JSONL files were found.');
      console.log('   This is normal if you haven\'t used Claude Code yet.');
      console.log('   The parser will automatically track usage once you do.');
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

test().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
