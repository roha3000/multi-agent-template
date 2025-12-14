#!/usr/bin/env node
/**
 * System Validation Script
 * Tests all components end-to-end
 * Usage: node scripts/validate-system.js
 */

const path = require('path');
const fs = require('fs').promises;
const StateManager = require('../.claude/core/state-manager');
const PhaseInference = require('../.claude/core/phase-inference');
const ContextLoader = require('../.claude/core/context-loader');
const ArtifactSummarizer = require('../.claude/core/artifact-summarizer');
const SummaryGenerator = require('../.claude/core/summary-generator');
const SessionInitializer = require('../.claude/core/session-init');

const projectRoot = path.resolve(__dirname, '..');

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  testsRun++;
  if (condition) {
    testsPassed++;
    console.log(`  ✓ ${message}`);
  } else {
    testsFailed++;
    console.error(`  ✗ ${message}`);
  }
}

async function test(name, fn) {
  console.log(`\n📝 ${name}`);
  try {
    await fn();
  } catch (error) {
    testsFailed++;
    console.error(`  ✗ Test failed:`, error.message);
  }
}

async function main() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('  SYSTEM VALIDATION - OPTION B');
  console.log('════════════════════════════════════════════════════════════\n');

  // Test 1: State Manager
  await test('State Manager - Load/Save/Update', async () => {
    const stateManager = new StateManager(projectRoot);
    let state;

    try {
      state = stateManager.load();
      assert(state !== null, 'State loaded successfully');
      assert(state.current_phase !== undefined, 'State has current_phase');
    } catch (error) {
      // Initialize if doesn't exist
      stateManager.reset();
      state = stateManager.load();
      assert(state !== null, 'State initialized successfully');
    }

    // Test update
    const originalPhase = state.current_phase;
    stateManager.transitionPhase('planning', 'Test Agent', 'Validation test');
    const updatedState = stateManager.load();
    assert(updatedState.current_phase === 'planning', 'Phase transition successful');

    // Restore original
    stateManager.transitionPhase(originalPhase, 'Test Agent', 'Restore original');
  });

  // Test 2: Phase Inference
  await test('Phase Inference - Keyword Detection', async () => {
    const stateManager = new StateManager(projectRoot);
    const inference = new PhaseInference(stateManager);

    // Test research detection
    const researchResult = inference.infer('Research authentication libraries', 'research');
    assert(researchResult.phase === 'research', 'Detected research phase');
    assert(researchResult.confidence > 0.5, 'Confidence > 50%');

    // Test implementation detection
    const implResult = inference.infer('Implement user login', 'design');
    assert(implResult.phase === 'implementation', 'Detected implementation phase');

    // Test planning detection
    const planResult = inference.infer('Create project roadmap', 'research');
    assert(planResult.phase === 'planning', 'Detected planning phase');
  });

  // Test 3: Context Loader
  await test('Context Loader - Token Budget', async () => {
    const stateManager = new StateManager(projectRoot);
    const contextLoader = new ContextLoader(projectRoot, stateManager);

    const context = contextLoader.loadContext('implementation');
    assert(context !== null, 'Context loaded');
    assert(context.totalTokens !== undefined, 'Token count calculated');
    assert(context.totalTokens < 8000, `Token count (${context.totalTokens}) within budget`);
  });

  // Test 4: Artifact Summarizer
  await test('Artifact Summarizer - Summary Generation', async () => {
    const summarizer = new ArtifactSummarizer(projectRoot);

    // Create test file
    const testFile = path.join(projectRoot, 'test-artifact.md');
    await fs.writeFile(testFile, '# Test Artifact\n\nThis is a test file for validation.\n\n## Section 1\nContent here.\n', 'utf-8');

    try {
      const summary = summarizer.summarize(testFile);
      assert(summary !== null, 'Summary generated');
      assert(summary.summary.length > 0, 'Summary contains content');
      assert(summary.tokens > 0, 'Token count calculated');
    } finally {
      // Cleanup
      await fs.unlink(testFile).catch(() => {});
    }
  });

  // Test 5: Summary Generator
  await test('Summary Generator - PROJECT_SUMMARY.md', async () => {
    const stateManager = new StateManager(projectRoot);
    const generator = new SummaryGenerator(projectRoot, stateManager);

    generator.generate();

    const summaryPath = path.join(projectRoot, 'PROJECT_SUMMARY.md');
    const exists = await fs.access(summaryPath).then(() => true).catch(() => false);
    assert(exists, 'PROJECT_SUMMARY.md created');

    if (exists) {
      const content = await fs.readFile(summaryPath, 'utf-8');
      assert(content.includes('# Project Summary'), 'Contains project summary header');
      assert(content.includes('Current Phase'), 'Contains current phase');
    }
  });

  // Test 6: Session Initializer
  await test('Session Initializer - Full Workflow', async () => {
    const sessionInit = new SessionInitializer(projectRoot);

    // Test without user task
    const result1 = sessionInit.initialize();
    assert(result1.success, 'Initialization without task succeeded');
    assert(result1.sessionPrompt.length > 0, 'Session prompt generated');
    assert(result1.metadata.tokenCount > 0, 'Token count calculated');

    // Test with user task
    const result2 = sessionInit.initialize('Let\'s plan the next sprint');
    assert(result2.success, 'Initialization with task succeeded');
    assert(result2.targetPhase !== undefined, 'Target phase detected');
    assert(result2.confidence >= 0 && result2.confidence <= 100, 'Confidence in valid range');
  });

  // Test 7: End-to-End Scenario
  await test('End-to-End - New Project Lifecycle', async () => {
    const sessionInit = new SessionInitializer(projectRoot);

    // 1. Start in research
    const researchResult = sessionInit.initialize('Research database options');
    assert(researchResult.targetPhase === 'research', 'Started in research phase');

    // 2. Record artifact
    sessionInit.recordArtifact('docs/db-research.md', 'research');
    const status1 = sessionInit.getStatus();
    assert(status1.artifacts.research && status1.artifacts.research.length > 0, 'Artifact recorded');

    // 3. Transition to planning
    const transitionResult = sessionInit.executeTransition('planning', 'Strategic Planner', 'User requested', 85);
    assert(transitionResult.success, 'Transitioned to planning');
    assert(transitionResult.phase === 'planning', 'In planning phase');

    // 4. Record decision
    sessionInit.recordDecision('Use PostgreSQL', 'Better for relational data', 'System Architect');
    const status2 = sessionInit.getStatus();
    assert(status2.decisions.length > 0, 'Decision recorded');

    // 5. Export state
    const exported = sessionInit.export();
    assert(exported.state !== undefined, 'State exported');
    assert(exported.summary !== undefined, 'Summary exported');
  });

  // Test 8: Token Optimization Validation
  await test('Token Optimization - Caching Strategy', async () => {
    const contextLoader = new ContextLoader(projectRoot, new StateManager(projectRoot));

    // Load context multiple times
    const context1 = contextLoader.loadContext('implementation');
    const context2 = contextLoader.loadContext('implementation');

    assert(context1.totalTokens > 0, 'First load calculated tokens');
    assert(context2.totalTokens > 0, 'Second load calculated tokens');

    // Verify within budget
    assert(context1.totalTokens < 8000, 'First load within budget');
    assert(context2.totalTokens < 8000, 'Second load within budget');
  });

  // Results
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  VALIDATION RESULTS');
  console.log('════════════════════════════════════════════════════════════\n');

  console.log(`Tests Run: ${testsRun}`);
  console.log(`Passed: ${testsPassed} ✓`);
  console.log(`Failed: ${testsFailed} ✗`);

  const successRate = ((testsPassed / testsRun) * 100).toFixed(1);
  console.log(`\nSuccess Rate: ${successRate}%`);

  if (testsFailed === 0) {
    console.log('\n✅ ALL TESTS PASSED - System is ready for use!\n');
  } else {
    console.log(`\n⚠️  ${testsFailed} test(s) failed - Please review errors above\n`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('\n❌ Validation failed with fatal error:');
  console.error(error.message);
  console.error('\nStack trace:');
  console.error(error.stack);
  process.exit(1);
});
