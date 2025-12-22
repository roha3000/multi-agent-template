#!/usr/bin/env node
/**
 * Validates the autonomous orchestrator components
 * Part of Option A: Test Autonomous Loop
 */

const path = require('path');
const fs = require('fs');

// Test results
const results = {
  passed: [],
  failed: [],
};

function test(name, fn) {
  try {
    fn();
    results.passed.push(name);
    console.log(`✅ ${name}`);
  } catch (err) {
    results.failed.push({ name, error: err.message });
    console.log(`❌ ${name}: ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

console.log('='.repeat(60));
console.log('AUTONOMOUS ORCHESTRATOR VALIDATION');
console.log('='.repeat(60));
console.log();

// Test 1: Quality Gates Module
console.log('--- Quality Gates ---');
const QG = require('../quality-gates');

test('PHASES object exists', () => {
  assert(QG.PHASES, 'PHASES should be defined');
  assert(Object.keys(QG.PHASES).length >= 4, 'Should have at least 4 phases');
});

test('Phase thresholds are correct', () => {
  assert(QG.PHASES.research?.minScore === 80, 'research threshold should be 80');
  assert(QG.PHASES.design?.minScore === 85, 'design threshold should be 85');
  assert(QG.PHASES.implement?.minScore === 90, 'implement threshold should be 90');
  assert(QG.PHASES.test?.minScore === 90, 'test threshold should be 90');
});

test('getNextPhase transitions correctly', () => {
  assert(QG.getNextPhase('research') === 'design', 'research -> design');
  assert(QG.getNextPhase('design') === 'implement', 'design -> implement');
  assert(QG.getNextPhase('implement') === 'test', 'implement -> test');
  const testNext = QG.getNextPhase('test');
  // test phase ends the flow - can be null, undefined, or 'complete'
  assert(testNext === null || testNext === undefined || testNext === 'complete',
    `test should end flow (got ${testNext})`);
});

test('calculatePhaseScore works', () => {
  // Use actual research phase criteria names
  const score = QG.calculatePhaseScore('research', {
    requirementsComplete: 90,
    technicalAnalysis: 85,
    riskAssessment: 80,
    competitiveAnalysis: 85,
    feasibilityValidation: 90,
    stakeholderAlignment: 80,
  });
  assert(score >= 80 && score <= 100, `Score should be 80-100, got ${score}`);
});

test('isPhaseComplete works', () => {
  assert(QG.isPhaseComplete('research', 85) === true, '85 >= 80 should pass');
  assert(QG.isPhaseComplete('research', 75) === false, '75 < 80 should fail');
  assert(QG.isPhaseComplete('implement', 89) === false, '89 < 90 should fail');
});

// Test 2: TaskManager
console.log('\n--- TaskManager ---');
const TaskManager = require('../.claude/core/task-manager');

test('TaskManager can be instantiated', () => {
  const tm = new TaskManager({ persistPath: null });
  assert(tm, 'TaskManager should exist');
});

test('TaskManager loads tasks.json', () => {
  const tasksPath = path.join(__dirname, '..', 'tasks.json');
  assert(fs.existsSync(tasksPath), 'tasks.json should exist');

  const tm = new TaskManager({ persistPath: tasksPath });
  const stats = tm.getStats();
  assert(stats.total >= 4, `Should have at least 4 tasks, got ${stats.total}`);
});

test('TaskManager getReadyTasks works', () => {
  const tasksPath = path.join(__dirname, '..', 'tasks.json');
  const tm = new TaskManager({ persistPath: tasksPath });
  const ready = tm.getReadyTasks();
  assert(Array.isArray(ready), 'getReadyTasks should return array');
});

// Test 3: Autonomous Orchestrator
console.log('\n--- Autonomous Orchestrator ---');
const orchestratorPath = path.join(__dirname, '..', 'autonomous-orchestrator.js');

test('autonomous-orchestrator.js exists', () => {
  assert(fs.existsSync(orchestratorPath), 'File should exist');
});

test('Orchestrator has correct spawn configuration', () => {
  const content = fs.readFileSync(orchestratorPath, 'utf-8');
  assert(content.includes('--dangerously-skip-permissions'), 'Should use dangerous skip permissions');
  assert(!content.includes("'-p',"), 'Should NOT use -p flag (print mode)');
});

// Test 4: Dashboard Integration
console.log('\n--- Dashboard Integration ---');
const dashboardPath = path.join(__dirname, '..', 'global-context-manager.js');

test('global-context-manager.js exists', () => {
  assert(fs.existsSync(dashboardPath), 'File should exist');
});

test('Dashboard serves on port 3033', () => {
  const content = fs.readFileSync(dashboardPath, 'utf-8');
  assert(content.includes('3033'), 'Should use port 3033');
});

// Test 5: Dev-docs State Pattern
console.log('\n--- Dev-docs State Pattern ---');
const devDocsPath = path.join(__dirname, '..', '.claude', 'dev-docs');

test('dev-docs directory exists', () => {
  assert(fs.existsSync(devDocsPath), 'dev-docs should exist');
});

test('plan.md exists', () => {
  assert(fs.existsSync(path.join(devDocsPath, 'plan.md')), 'plan.md should exist');
});

test('tasks.md exists', () => {
  assert(fs.existsSync(path.join(devDocsPath, 'tasks.md')), 'tasks.md should exist');
});

test('PROJECT_SUMMARY.md exists', () => {
  const summaryPath = path.join(__dirname, '..', 'PROJECT_SUMMARY.md');
  assert(fs.existsSync(summaryPath), 'PROJECT_SUMMARY.md should exist');
});

// Summary
console.log('\n' + '='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));
console.log(`Passed: ${results.passed.length}`);
console.log(`Failed: ${results.failed.length}`);

if (results.failed.length > 0) {
  console.log('\nFailed tests:');
  results.failed.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
