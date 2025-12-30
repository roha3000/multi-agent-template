#!/usr/bin/env node

/**
 * Example Usage - Demonstrates intelligent phase management system
 *
 * This script demonstrates how to use all core components together.
 * Run with: node example.js
 */

const path = require('path');
const SessionInitializer = require('./session-init');

// Get project root (two levels up from this file)
const projectRoot = path.resolve(__dirname, '..', '..');

console.log('='.repeat(60));
console.log('Intelligent Phase Management System - Demo');
console.log('='.repeat(60));
console.log();

// Initialize the session
console.log('1. Initializing session...');
const sessionInit = new SessionInitializer(projectRoot);
console.log('   ✓ Session initializer created');
console.log();

// Get current status
console.log('2. Getting current project status...');
const status = sessionInit.getStatus();
console.log(`   Current Phase: ${status.currentPhase}`);
console.log(`   Phase History: ${status.phaseHistory} transitions`);
console.log(`   Total Artifacts: ${status.totalArtifacts}`);
console.log(`   Unresolved Blockers: ${status.unresolvedBlockers}`);
console.log(`   Critical Blockers: ${status.criticalBlockers}`);
console.log(`   Decisions Made: ${status.decisions}`);
console.log(`   Cache Entries: ${status.cacheStats.count}`);
console.log();

// Test phase inference with various inputs
console.log('3. Testing phase inference...');
const testInputs = [
  'I need to research different database options',
  'Let\'s create a project timeline and roadmap',
  'Design the API architecture and data models',
  'Write unit tests for the authentication module',
  'Implement the user registration feature',
  'Validate the code quality and run tests',
  'Refactor and optimize the database queries'
];

for (const input of testInputs) {
  const result = sessionInit.initialize(input);

  if (result.success) {
    const confidence = (result.context.inference?.confidence || 0) * 100;
    console.log(`   "${input.slice(0, 50)}..."`);
    console.log(`   → Detected: ${result.targetPhase} (${confidence.toFixed(0)}% confidence)`);
    console.log(`   → Valid transition: ${result.transitionValidation.valid ? 'Yes' : 'No'}`);
    console.log();
  }
}

// Initialize a session with specific user input
console.log('4. Initializing session with user input...');
const sessionResult = sessionInit.initialize('Let\'s plan out the project milestones and timeline');

if (sessionResult.success) {
  console.log(`   ✓ Session initialized successfully`);
  console.log(`   Mode: ${sessionResult.mode}`);
  console.log(`   Current Phase: ${sessionResult.currentPhase}`);
  console.log(`   Target Phase: ${sessionResult.targetPhase}`);
  console.log(`   Will Transition: ${sessionResult.willTransition ? 'Yes' : 'No'}`);
  console.log(`   Context Tokens: ${sessionResult.metadata.tokenCount}`);
  console.log();

  // Show recommendations
  if (sessionResult.recommendations) {
    console.log('   Recommendations:');
    if (sessionResult.recommendations.immediate.length > 0) {
      console.log('   Immediate:');
      sessionResult.recommendations.immediate.forEach(rec => {
        console.log(`     - ${rec}`);
      });
    }
    if (sessionResult.recommendations.shortTerm.length > 0) {
      console.log('   Short-term:');
      sessionResult.recommendations.shortTerm.forEach(rec => {
        console.log(`     - ${rec}`);
      });
    }
    console.log();
  }

  // Show a snippet of the session prompt
  console.log('   Session Prompt Preview (first 500 chars):');
  console.log('   ' + '─'.repeat(58));
  const promptPreview = sessionResult.sessionPrompt.slice(0, 500).split('\n').map(line => '   ' + line).join('\n');
  console.log(promptPreview);
  console.log('   ' + '─'.repeat(58));
  console.log('   ... (truncated)');
  console.log();
}

// Demonstrate recording artifacts and decisions
console.log('5. Recording project artifacts...');
const artifactResult = sessionInit.recordArtifact('docs/example-architecture.md', 'design');
if (artifactResult.success) {
  console.log(`   ✓ Artifact recorded: ${artifactResult.artifact}`);
  console.log(`   Phase: ${artifactResult.phase}`);
  console.log();
}

console.log('6. Recording project decision...');
const decisionResult = sessionInit.recordDecision(
  'Use PostgreSQL for primary database',
  'PostgreSQL offers better support for complex queries and JSON data types',
  'System Architect'
);
if (decisionResult.success) {
  console.log(`   ✓ Decision recorded: ${decisionResult.decision}`);
  console.log();
}

// Demonstrate component access
console.log('7. Accessing individual components...');

// State Manager
console.log('   State Manager:');
const state = sessionInit.stateManager.load();
console.log(`     - Phase History Entries: ${state.phase_history.length}`);
console.log(`     - Quality Scores: ${Object.keys(state.quality_scores).length} phases scored`);
console.log();

// Phase Inference
console.log('   Phase Inference Engine:');
const validNextPhases = sessionInit.phaseInference.getValidNextPhases(state.current_phase);
console.log(`     - Valid next phases from ${state.current_phase}:`);
validNextPhases.forEach(phase => console.log(`       • ${phase}`));
console.log();

const suggestion = sessionInit.phaseInference.suggestNextPhase(state);
console.log(`     - Suggested next phase: ${suggestion.phase}`);
console.log(`     - Reasoning: ${suggestion.reasoning}`);
console.log();

// Artifact Summarizer
console.log('   Artifact Summarizer:');
const cacheStats = sessionInit.artifactSummarizer.getCacheStats();
console.log(`     - Cached summaries: ${cacheStats.count}`);
console.log(`     - Total cache size: ${(cacheStats.totalSize / 1024).toFixed(2)} KB`);
if (cacheStats.count > 0) {
  console.log(`     - Average size: ${(cacheStats.averageSize / 1024).toFixed(2)} KB`);
  console.log(`     - Oldest entry: ${cacheStats.oldestEntry}`);
  console.log(`     - Newest entry: ${cacheStats.newestEntry}`);
}
console.log();

// Summary Generator
console.log('   Summary Generator:');
console.log('     - Generating PROJECT_SUMMARY.md...');
const summary = sessionInit.summaryGenerator.generate();
const summaryLines = summary.split('\n').length;
console.log(`     ✓ Generated ${summaryLines} lines`);
console.log();

// Final status
console.log('8. Final project status...');
const finalStatus = sessionInit.getStatus();
console.log(`   Current Phase: ${finalStatus.currentPhase}`);
console.log(`   Total Artifacts: ${finalStatus.totalArtifacts}`);
console.log(`   Quality Scores: ${Object.keys(finalStatus.qualityScores).length} phases`);
console.log(`   Last Updated: ${finalStatus.lastUpdated}`);
console.log();

console.log('='.repeat(60));
console.log('Demo Complete!');
console.log('='.repeat(60));
console.log();
console.log('Next steps:');
console.log('  1. Check .claude/state/project-state.json for state');
console.log('  2. View .claude/PROJECT_SUMMARY.md for project summary');
console.log('  3. Explore .claude/state/backups/ for state backups');
console.log('  4. Check .claude/state/summaries/ for artifact cache');
console.log();
