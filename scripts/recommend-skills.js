/**
 * Skill Recommendation CLI
 *
 * Analyzes usage patterns and recommends skills that should be created.
 *
 * @module scripts/recommend-skills
 */

const path = require('path');
const SkillRecommender = require('../.claude/core/skill-recommender');
const MemoryStore = require('../.claude/core/memory-store');

/**
 * Formats recommendations for display
 */
function formatRecommendations(result) {
  const lines = [
    '',
    '🎯 Skill Recommendations',
    '======================',
    '',
    `Analysis Period: Last 30 days`,
    `Total Prompts Analyzed: ${result.analysisDate ? 'Recent activity' : 'N/A'}`,
    `Existing Skills: ${result.existingSkills}`,
    `Recommendations: ${result.totalRecommendations}`,
    ''
  ];

  if (result.recommendations.length === 0) {
    lines.push('✓ No new skills recommended at this time.');
    lines.push('  Your skill library covers current usage patterns well!');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('Recommended Skills (sorted by priority):');
  lines.push('');

  for (const [index, rec] of result.recommendations.entries()) {
    const priority = rec.priority >= 70 ? '🔴' : rec.priority >= 40 ? '🟡' : '⚪';
    const value = rec.estimatedValue === 'high' ? '💎' : rec.estimatedValue === 'medium' ? '💚' : '💙';

    lines.push(`${index + 1}. ${priority} ${value} ${rec.topic.toUpperCase()}`);
    lines.push(`   Priority: ${rec.priority}/100 | Value: ${rec.estimatedValue}`);
    lines.push(`   Frequency: ${rec.frequency} prompts (${rec.percentage} of activity)`);
    lines.push(`   Reason: ${rec.reason}`);
    lines.push(`   Path: ${rec.suggestedPath}`);
    lines.push('');
    lines.push('   Sample prompts:');

    for (const [i, sample] of rec.samples.entries()) {
      const truncated = sample.length > 80 ? sample.substring(0, 77) + '...' : sample;
      lines.push(`     ${i + 1}. "${truncated}"`);
    }

    lines.push('');
  }

  lines.push('Legend:');
  lines.push('  🔴 High priority (≥70)  🟡 Medium priority (40-69)  ⚪ Low priority (<40)');
  lines.push('  💎 High value  💚 Medium value  💙 Low value');
  lines.push('');

  return lines.join('\n');
}

/**
 * Main CLI function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    console.log(`
Skill Recommendation CLI

Analyzes usage patterns from orchestration memory and recommends
skills that should be created to improve framework effectiveness.

Usage:
  node scripts/recommend-skills.js [options]

Options:
  --create          Auto-create template files for recommendations
  --min-frequency N Minimum frequency to recommend (default: 5)
  --days N          Analyze last N days (default: 30)
  --help            Show this help message

Examples:
  # View recommendations
  node scripts/recommend-skills.js

  # Create template files for top recommendations
  node scripts/recommend-skills.js --create

  # Analyze last 60 days, min 3 occurrences
  node scripts/recommend-skills.js --days 60 --min-frequency 3
`);
    process.exit(0);
  }

  const options = {
    minFrequency: 5,
    daysBack: 30,
    autoCreate: false
  };

  // Parse options
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--min-frequency' && args[i + 1]) {
      options.minFrequency = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--days' && args[i + 1]) {
      options.daysBack = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--create') {
      options.autoCreate = true;
    }
  }

  try {
    // Initialize components
    const memoryStore = new MemoryStore(
      path.join(process.cwd(), '.claude', 'memory', 'orchestrations.db')
    );

    const recommender = new SkillRecommender(
      memoryStore,
      path.join(process.cwd(), '.claude', 'skills')
    );

    console.log('\n🔍 Analyzing usage patterns...\n');

    // Get recommendations
    const result = await recommender.recommendSkills({
      minFrequency: options.minFrequency,
      excludeExisting: true
    });

    // Display recommendations
    console.log(formatRecommendations(result));

    // Auto-create if requested
    if (options.autoCreate && result.recommendations.length > 0) {
      console.log('📝 Creating skill templates...\n');

      for (const rec of result.recommendations) {
        if (rec.priority >= 40) { // Only create medium+ priority
          try {
            const filepath = await recommender.createSkill(rec, true);
            console.log(`   ✓ Created: ${filepath}`);
          } catch (error) {
            console.error(`   ✗ Failed: ${rec.suggestedPath} - ${error.message}`);
          }
        }
      }

      console.log('\n✓ Template creation complete!');
      console.log('  Review and enhance templates with domain-specific content.\n');
    } else if (result.recommendations.length > 0) {
      console.log('💡 Tip: Run with --create to auto-generate skill templates\n');
    }

    // Close memory store
    if (memoryStore.close) {
      memoryStore.close();
    }

  } catch (error) {
    console.error(`\n✗ Error: ${error.message}\n`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { main };
