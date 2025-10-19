#!/usr/bin/env node

/**
 * Prompt Traceability System - End-to-End Validation
 *
 * Tests all components of the prompt traceability system to ensure
 * they work together correctly.
 */

const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');

// Import components
const StateManager = require('../.claude/core/state-manager');
const SessionInitializer = require('../.claude/core/session-init');
const TraceabilityReport = require('../.claude/core/traceability-report');

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function assert(condition, testName, errorMsg = '') {
  if (condition) {
    console.log(`✓ ${testName}`);
    testsPassed++;
  } else {
    console.log(`✗ ${testName}`);
    if (errorMsg) console.log(`  Error: ${errorMsg}`);
    testsFailed++;
  }
}

function printHeader(title) {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${title}`);
  console.log('='.repeat(60) + '\n');
}

function printSection(title) {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
}

async function runTests() {
  printHeader('Prompt Traceability System - Validation Suite');

  // Test 1: Schema Validation
  printSection('Test Suite 1: Schema Validation');

  const stateManager = new StateManager(projectRoot);
  const state = stateManager.load();

  // Add prompt history and artifact lineage if they don't exist
  if (!state.promptHistory) {
    state.promptHistory = [];
  }
  if (!state.artifactLineage) {
    state.artifactLineage = {};
  }

  const saved = stateManager.save(state);
  assert(saved, 'State with new fields validates correctly');

  // Test 2: StateManager Prompt Recording
  printSection('Test Suite 2: StateManager Prompt Recording');

  const promptEntry = stateManager.recordPrompt('Test prompt for validation', {
    phase: 'implementation',
    agent: 'Test Agent',
    artifactPath: 'test-file.js',
    artifactsCreated: ['test-file.js'],
    changeType: 'created',
    changeSummary: 'Test file for validation'
  });

  assert(promptEntry !== null, 'Record prompt returns entry');
  assert(promptEntry.id !== undefined, 'Prompt entry has ID');
  assert(promptEntry.prompt === 'Test prompt for validation', 'Prompt text stored correctly');
  assert(promptEntry.phase === 'implementation', 'Prompt phase stored correctly');
  assert(promptEntry.agent === 'Test Agent', 'Prompt agent stored correctly');

  // Verify it's in state
  const updatedState = stateManager.load();
  assert(
    updatedState.promptHistory && updatedState.promptHistory.length > 0,
    'Prompt added to history'
  );

  const lastPrompt = updatedState.promptHistory[updatedState.promptHistory.length - 1];
  assert(lastPrompt.id === promptEntry.id, 'Prompt ID matches');

  // Test 3: Artifact Lineage Tracking
  printSection('Test Suite 3: Artifact Lineage Tracking');

  assert(
    updatedState.artifactLineage['test-file.js'] !== undefined,
    'Artifact lineage created'
  );

  const lineage = updatedState.artifactLineage['test-file.js'];
  assert(lineage.artifactId !== undefined, 'Lineage has artifact ID');
  assert(lineage.currentVersion === 1, 'Initial version is 1');
  assert(lineage.versions.length === 1, 'One version recorded');
  assert(lineage.totalModifications === 0, 'No modifications yet (only creation)');

  // Test modification
  const modPrompt = stateManager.recordPrompt('Modify test file', {
    phase: 'implementation',
    agent: 'Test Agent',
    artifactPath: 'test-file.js',
    artifactsModified: ['test-file.js'],
    changeType: 'modified',
    changeSummary: 'Added new function'
  });

  const stateAfterMod = stateManager.load();
  const modLineage = stateAfterMod.artifactLineage['test-file.js'];

  assert(modLineage.currentVersion === 2, 'Version incremented after modification');
  assert(modLineage.versions.length === 2, 'Two versions recorded');
  assert(modLineage.totalModifications === 1, 'One modification counted');

  // Test 4: Query Methods
  printSection('Test Suite 4: Query Methods');

  const artifactHistory = stateManager.getArtifactHistory('test-file.js');
  assert(artifactHistory !== null, 'Get artifact history returns data');
  assert(artifactHistory.lineage !== undefined, 'History includes lineage');
  assert(artifactHistory.prompts !== undefined, 'History includes prompts');
  assert(artifactHistory.summary !== undefined, 'History includes summary');
  assert(artifactHistory.prompts.length === 2, 'History has 2 related prompts');

  const sessionPrompts = stateManager.getSessionPrompts();
  assert(sessionPrompts.length >= 2, 'Get session prompts returns data');

  const implPrompts = stateManager.getPromptsByPhase('implementation');
  assert(implPrompts.length >= 2, 'Get prompts by phase returns data');

  const testAgentPrompts = stateManager.getPromptsByAgent('Test Agent');
  assert(testAgentPrompts.length >= 2, 'Get prompts by agent returns data');

  const searchResults = stateManager.searchPrompts('validation');
  assert(searchResults.length >= 1, 'Search prompts finds matches');

  const stats = stateManager.getPromptStatistics();
  assert(stats.totalPrompts >= 2, 'Statistics shows total prompts');
  assert(stats.totalArtifacts >= 1, 'Statistics shows total artifacts');
  assert(stats.byPhase !== undefined, 'Statistics includes by-phase breakdown');
  assert(stats.byAgent !== undefined, 'Statistics includes by-agent breakdown');

  // Test 5: SessionInitializer Integration
  printSection('Test Suite 5: SessionInitializer Integration');

  const sessionInit = new SessionInitializer(projectRoot);

  const artifactResult = sessionInit.recordArtifact(
    'test-component.tsx',
    'implementation',
    {
      prompt: 'Create test component',
      agent: 'Senior Developer',
      changeType: 'created',
      changeSummary: 'React component for testing'
    }
  );

  assert(artifactResult.success === true, 'SessionInit recordArtifact succeeds');
  assert(artifactResult.artifact === 'test-component.tsx', 'Artifact path stored');

  const modResult = sessionInit.recordArtifactModification(
    'test-component.tsx',
    'Add props interface',
    {
      changeType: 'enhanced',
      changeSummary: 'Added TypeScript props interface'
    }
  );

  assert(modResult.success === true, 'SessionInit recordArtifactModification succeeds');

  const componentHistory = sessionInit.getArtifactHistory('test-component.tsx');
  assert(componentHistory !== null, 'Component history retrieved');
  assert(componentHistory.summary.currentVersion === 2, 'Component has 2 versions');

  // Test 6: TraceabilityReport Generation
  printSection('Test Suite 6: TraceabilityReport Generation');

  const reporter = new TraceabilityReport(projectRoot);

  const fullReport = reporter.generateFullReport({
    includeStatistics: true,
    includeTimeline: true,
    includeArtifacts: true
  });

  assert(fullReport.length > 0, 'Full report generates content');
  assert(fullReport.includes('# Artifact Traceability Report'), 'Report has correct header');
  assert(fullReport.includes('## 📊 Statistics'), 'Report includes statistics');
  assert(fullReport.includes('## 📅 Prompt Timeline'), 'Report includes timeline');
  assert(fullReport.includes('## 📁 Artifact Lineage'), 'Report includes lineage');

  const artifactReport = reporter.generateArtifactReport('test-file.js');
  assert(artifactReport !== null, 'Artifact report generates');
  assert(artifactReport.includes('test-file.js'), 'Artifact report includes path');
  assert(artifactReport.includes('Version History'), 'Artifact report includes versions');

  const phaseReport = reporter.generatePhaseReport('implementation');
  assert(phaseReport.length > 0, 'Phase report generates');
  assert(phaseReport.includes('implementation'), 'Phase report includes phase name');

  const agentReport = reporter.generateAgentReport('Test Agent');
  assert(agentReport.length > 0, 'Agent report generates');
  assert(agentReport.includes('Test Agent'), 'Agent report includes agent name');

  // Test 7: Report Persistence
  printSection('Test Suite 7: Report Persistence');

  const reportPath = reporter.saveReport(fullReport, 'test-validation-report.md');
  assert(fs.existsSync(reportPath), 'Report saved to file');

  const savedContent = fs.readFileSync(reportPath, 'utf8');
  assert(savedContent === fullReport, 'Saved report content matches');

  // Cleanup
  fs.unlinkSync(reportPath);
  assert(!fs.existsSync(reportPath), 'Test report cleaned up');

  // Test 8: Edge Cases
  printSection('Test Suite 8: Edge Cases');

  const nonExistentHistory = stateManager.getArtifactHistory('non-existent-file.js');
  assert(nonExistentHistory === null, 'Non-existent artifact returns null');

  const emptySearch = stateManager.searchPrompts('zzzzznonexistentzzzzz');
  assert(emptySearch.length === 0, 'Search with no matches returns empty array');

  const emptyPhasePrompts = stateManager.getPromptsByPhase('nonexistent-phase');
  assert(emptyPhasePrompts.length === 0, 'Non-existent phase returns empty array');

  // Test 9: Data Integrity
  printSection('Test Suite 9: Data Integrity');

  const finalState = stateManager.load();

  // Verify all prompts have required fields
  let allPromptsValid = true;
  finalState.promptHistory?.forEach(p => {
    if (!p.id || !p.timestamp || !p.prompt || !p.phase || !p.agent) {
      allPromptsValid = false;
    }
  });
  assert(allPromptsValid, 'All prompts have required fields');

  // Verify all lineages are properly structured
  let allLineagesValid = true;
  Object.values(finalState.artifactLineage || {}).forEach(lineage => {
    if (!lineage.artifactId || !lineage.created || !lineage.currentVersion || !lineage.versions) {
      allLineagesValid = false;
    }
  });
  assert(allLineagesValid, 'All lineages have required fields');

  // Verify version numbers are sequential
  let versionsSequential = true;
  Object.values(finalState.artifactLineage || {}).forEach(lineage => {
    lineage.versions.forEach((v, idx) => {
      if (v.version !== idx + 1) {
        versionsSequential = false;
      }
    });
  });
  assert(versionsSequential, 'All version numbers are sequential');

  // Test 10: Performance
  printSection('Test Suite 10: Performance');

  const startTime = Date.now();
  for (let i = 0; i < 100; i++) {
    stateManager.recordPrompt(`Performance test prompt ${i}`, {
      phase: 'implementation',
      agent: 'Performance Tester'
    });
  }
  const recordTime = Date.now() - startTime;
  assert(recordTime < 5000, `100 prompts recorded in under 5s (${recordTime}ms)`);

  const queryStart = Date.now();
  const perfStats = stateManager.getPromptStatistics();
  const queryTime = Date.now() - queryStart;
  assert(queryTime < 1000, `Statistics query under 1s (${queryTime}ms)`);
  assert(perfStats.totalPrompts >= 102, 'Performance test prompts counted');

  // Summary
  printHeader('Validation Summary');

  const totalTests = testsPassed + testsFailed;
  const successRate = ((testsPassed / totalTests) * 100).toFixed(1);

  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${testsPassed} ✓`);
  console.log(`Failed: ${testsFailed} ✗`);
  console.log(`Success Rate: ${successRate}%`);
  console.log();

  if (testsFailed === 0) {
    console.log('🎉 All tests passed! Prompt Traceability System is fully functional.');
    console.log();
    console.log('Next steps:');
    console.log('1. Try the CLI: node scripts/traceability-query.js stats');
    console.log('2. Read docs: docs/PROMPT-TRACEABILITY.md');
    console.log('3. Start using: Record prompts in your workflow');
    console.log();
    return 0;
  } else {
    console.log('❌ Some tests failed. Please review the errors above.');
    console.log();
    return 1;
  }
}

// Run tests
runTests()
  .then(exitCode => {
    process.exit(exitCode);
  })
  .catch(error => {
    console.error('\n❌ Validation failed with error:');
    console.error(error);
    process.exit(1);
  });
