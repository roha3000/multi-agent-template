#!/usr/bin/env node

/**
 * benchmark-swarm.js - Performance Benchmarks for Swarm Components
 *
 * Measures latency for all swarm components:
 * - ComplexityAnalyzer
 * - CompetitivePlanner
 * - PlanEvaluator
 * - ConfidenceMonitor
 * - SecurityValidator
 *
 * Target: All operations < 100ms
 */

const ComplexityAnalyzer = require('./.claude/core/complexity-analyzer');
const CompetitivePlanner = require('./.claude/core/competitive-planner');
const { PlanEvaluator } = require('./.claude/core/plan-evaluator');
const ConfidenceMonitor = require('./.claude/core/confidence-monitor');
const SecurityValidator = require('./.claude/core/security-validator');

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m'
};

// Sample test data
const SAMPLE_TASKS = [
  {
    id: 'simple-task',
    title: 'Add a button to the UI',
    description: 'Add a simple button component',
    estimate: '1h',
    acceptanceCriteria: ['Button renders', 'Button is clickable']
  },
  {
    id: 'medium-task',
    title: 'Implement user authentication API',
    description: 'Create REST endpoints for login, logout, and session management',
    estimate: '4h',
    requires: ['database-setup'],
    blocks: ['dashboard-feature'],
    acceptanceCriteria: [
      'POST /api/login accepts credentials',
      'JWT tokens are generated',
      'Session expiry is configurable',
      'Password hashing uses bcrypt'
    ]
  },
  {
    id: 'complex-task',
    title: 'Database migration with schema redesign',
    description: 'Refactor the database architecture to support multi-tenancy with proper data isolation and security',
    estimate: '2d',
    requires: ['design-review', 'backup-strategy'],
    blocks: ['api-v2', 'performance-optimization', 'security-audit'],
    acceptanceCriteria: [
      'All existing data migrated without loss',
      'Query performance within 50ms for 95th percentile',
      'Rollback procedure tested and documented',
      'Multi-tenant isolation verified with integration tests',
      'Encryption at rest enabled for sensitive columns'
    ],
    tags: ['architecture', 'migration', 'security']
  }
];

const SAMPLE_PLANS = [
  {
    id: 'plan-conservative',
    title: 'Conservative Migration Plan',
    strategy: { key: 'conservative', name: 'Conservative Approach' },
    steps: [
      { action: 'Create backup of current database', details: 'Full pg_dump with schema', order: 1 },
      { action: 'Design new schema in staging', details: 'Apply multi-tenant changes', order: 2 },
      { action: 'Write migration scripts', details: 'Incremental migration with validation', order: 3 },
      { action: 'Test in staging environment', details: 'Full regression suite', order: 4 },
      { action: 'Deploy to production', details: 'Blue-green deployment', order: 5 }
    ],
    risks: [
      { risk: 'Data loss during migration', mitigation: 'Maintain full backup with point-in-time recovery', severity: 'high' },
      { risk: 'Extended downtime', mitigation: 'Use online migration with minimal locking', severity: 'medium' }
    ],
    estimates: { hours: 16, days: 2, complexity: 'high', confidence: 'high' },
    dependencies: ['database', 'backup-system']
  },
  {
    id: 'plan-aggressive',
    title: 'Aggressive Migration Plan',
    strategy: { key: 'aggressive', name: 'Aggressive Approach' },
    steps: [
      { action: 'Parallel migration with dual-write', details: 'Write to both schemas simultaneously', order: 1, parallel: true },
      { action: 'Cutover with feature flag', details: 'Instant switch with rollback capability', order: 2 }
    ],
    risks: [
      { risk: 'Data inconsistency during dual-write', mitigation: 'Reconciliation process monitors changes', severity: 'high' }
    ],
    estimates: { hours: 8, days: 1, complexity: 'high', confidence: 'medium' },
    dependencies: ['database', 'feature-flags']
  }
];

// Benchmark utilities
class BenchmarkRunner {
  constructor() {
    this.results = [];
  }

  async runBenchmark(name, fn, iterations = 100) {
    const times = [];

    // Warmup
    for (let i = 0; i < 5; i++) {
      await fn();
    }

    // Actual benchmark
    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();
      await fn();
      const end = process.hrtime.bigint();
      times.push(Number(end - start) / 1_000_000); // Convert to ms
    }

    // Calculate statistics
    const sorted = times.slice().sort((a, b) => a - b);
    const sum = times.reduce((a, b) => a + b, 0);
    const avg = sum / times.length;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const p50 = sorted[Math.floor(times.length * 0.5)];
    const p95 = sorted[Math.floor(times.length * 0.95)];
    const p99 = sorted[Math.floor(times.length * 0.99)];

    const result = {
      name,
      iterations,
      avg: avg.toFixed(3),
      min: min.toFixed(3),
      max: max.toFixed(3),
      p50: p50.toFixed(3),
      p95: p95.toFixed(3),
      p99: p99.toFixed(3),
      passTarget: p95 < 100 // Target: p95 < 100ms
    };

    this.results.push(result);
    return result;
  }

  printResults() {
    console.log('\n' + colors.bold + colors.cyan + '=' .repeat(100) + colors.reset);
    console.log(colors.bold + colors.cyan + ' SWARM COMPONENT BENCHMARK RESULTS' + colors.reset);
    console.log(colors.cyan + '=' .repeat(100) + colors.reset);

    // Header
    console.log(
      colors.bold +
      padRight('Benchmark', 45) +
      padRight('Avg(ms)', 10) +
      padRight('Min(ms)', 10) +
      padRight('Max(ms)', 10) +
      padRight('P50(ms)', 10) +
      padRight('P95(ms)', 10) +
      padRight('P99(ms)', 10) +
      'Status' +
      colors.reset
    );
    console.log('-'.repeat(115));

    // Results
    let allPassed = true;
    for (const r of this.results) {
      const status = r.passTarget
        ? colors.green + 'PASS' + colors.reset
        : colors.red + 'FAIL' + colors.reset;

      if (!r.passTarget) allPassed = false;

      console.log(
        padRight(r.name, 45) +
        padRight(r.avg, 10) +
        padRight(r.min, 10) +
        padRight(r.max, 10) +
        padRight(r.p50, 10) +
        padRight(r.p95, 10) +
        padRight(r.p99, 10) +
        status
      );
    }

    console.log('-'.repeat(115));

    // Summary
    const passed = this.results.filter(r => r.passTarget).length;
    const total = this.results.length;
    const summaryColor = allPassed ? colors.green : colors.red;

    console.log('\n' + colors.bold + 'Summary:' + colors.reset);
    console.log(`  Tests: ${summaryColor}${passed}/${total} passed${colors.reset}`);
    console.log(`  Target: P95 < 100ms`);
    console.log(`  Status: ${allPassed ? colors.green + 'ALL BENCHMARKS PASSED' : colors.red + 'SOME BENCHMARKS FAILED'}${colors.reset}`);

    return allPassed;
  }

  getResults() {
    return this.results;
  }
}

function padRight(str, len) {
  return String(str).padEnd(len);
}

// Main benchmark execution
async function runAllBenchmarks() {
  console.log(colors.bold + '\nInitializing Swarm Components...' + colors.reset);

  // Initialize components
  const complexityAnalyzer = new ComplexityAnalyzer();
  const planEvaluator = new PlanEvaluator();
  const competitivePlanner = new CompetitivePlanner({
    complexityAnalyzer,
    planEvaluator
  });
  const confidenceMonitor = new ConfidenceMonitor();
  const securityValidator = new SecurityValidator({ logThreats: false });

  console.log(colors.green + 'Components initialized.' + colors.reset);

  const runner = new BenchmarkRunner();

  // ═══════════════════════════════════════════════════════════════════════════
  // ComplexityAnalyzer Benchmarks
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(colors.dim + '\nRunning ComplexityAnalyzer benchmarks...' + colors.reset);

  await runner.runBenchmark(
    'ComplexityAnalyzer.analyze (simple task)',
    () => complexityAnalyzer.analyze(SAMPLE_TASKS[0], { useCache: false })
  );

  await runner.runBenchmark(
    'ComplexityAnalyzer.analyze (medium task)',
    () => complexityAnalyzer.analyze(SAMPLE_TASKS[1], { useCache: false })
  );

  await runner.runBenchmark(
    'ComplexityAnalyzer.analyze (complex task)',
    () => complexityAnalyzer.analyze(SAMPLE_TASKS[2], { useCache: false })
  );

  await runner.runBenchmark(
    'ComplexityAnalyzer.analyze (cached)',
    () => complexityAnalyzer.analyze(SAMPLE_TASKS[1], { useCache: true })
  );

  await runner.runBenchmark(
    'ComplexityAnalyzer.analyzeBatch (3 tasks)',
    () => complexityAnalyzer.analyzeBatch(SAMPLE_TASKS, { useCache: false })
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // CompetitivePlanner Benchmarks
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(colors.dim + '\nRunning CompetitivePlanner benchmarks...' + colors.reset);

  await runner.runBenchmark(
    'CompetitivePlanner.generatePlans (low complexity)',
    () => competitivePlanner.generatePlans(SAMPLE_TASKS[0], {
      complexity: 30,
      forceRegenerate: true
    })
  );

  await runner.runBenchmark(
    'CompetitivePlanner.generatePlans (medium complexity)',
    () => competitivePlanner.generatePlans(SAMPLE_TASKS[1], {
      complexity: 55,
      forceRegenerate: true
    })
  );

  await runner.runBenchmark(
    'CompetitivePlanner.generatePlans (high complexity)',
    () => competitivePlanner.generatePlans(SAMPLE_TASKS[2], {
      complexity: 80,
      forceRegenerate: true
    })
  );

  await runner.runBenchmark(
    'CompetitivePlanner.generatePlans (cached)',
    () => competitivePlanner.generatePlans(SAMPLE_TASKS[1], {
      forceRegenerate: false
    })
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PlanEvaluator Benchmarks
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(colors.dim + '\nRunning PlanEvaluator benchmarks...' + colors.reset);

  await runner.runBenchmark(
    'PlanEvaluator.evaluatePlan (conservative)',
    () => planEvaluator.evaluatePlan(SAMPLE_PLANS[0])
  );

  await runner.runBenchmark(
    'PlanEvaluator.evaluatePlan (aggressive)',
    () => planEvaluator.evaluatePlan(SAMPLE_PLANS[1])
  );

  await runner.runBenchmark(
    'PlanEvaluator.evaluatePlan (with criteria)',
    () => planEvaluator.evaluatePlan(SAMPLE_PLANS[0], {
      acceptanceCriteria: SAMPLE_TASKS[2].acceptanceCriteria
    })
  );

  await runner.runBenchmark(
    'PlanEvaluator.comparePlans (2 plans)',
    () => planEvaluator.comparePlans(SAMPLE_PLANS)
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ConfidenceMonitor Benchmarks
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(colors.dim + '\nRunning ConfidenceMonitor benchmarks...' + colors.reset);

  await runner.runBenchmark(
    'ConfidenceMonitor.update (single signal)',
    () => {
      confidenceMonitor.update('qualityScore', Math.random() * 100);
    }
  );

  await runner.runBenchmark(
    'ConfidenceMonitor.updateBatch (all signals)',
    () => {
      confidenceMonitor.updateBatch({
        qualityScore: Math.random() * 100,
        velocity: Math.random() * 100,
        iterations: Math.floor(Math.random() * 5),
        errorRate: Math.random() * 10,
        historical: Math.random() * 100
      });
    }
  );

  await runner.runBenchmark(
    'ConfidenceMonitor.calculate',
    () => confidenceMonitor.calculate()
  );

  await runner.runBenchmark(
    'ConfidenceMonitor.getBreakdown',
    () => confidenceMonitor.getBreakdown()
  );

  await runner.runBenchmark(
    'ConfidenceMonitor.getState',
    () => confidenceMonitor.getState()
  );

  await runner.runBenchmark(
    'ConfidenceMonitor.snapshot',
    () => confidenceMonitor.snapshot()
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // SecurityValidator Benchmarks
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(colors.dim + '\nRunning SecurityValidator benchmarks...' + colors.reset);

  await runner.runBenchmark(
    'SecurityValidator.validate (task)',
    () => securityValidator.validate(SAMPLE_TASKS[1], 'task')
  );

  await runner.runBenchmark(
    'SecurityValidator.validate (taskId)',
    () => securityValidator.validate('valid-task-id-123', 'taskId')
  );

  await runner.runBenchmark(
    'SecurityValidator.validate (description)',
    () => securityValidator.validate(
      'This is a normal description without any injection attempts.',
      'description'
    )
  );

  await runner.runBenchmark(
    'SecurityValidator.validate (phase)',
    () => securityValidator.validate('implementation', 'phase')
  );

  await runner.runBenchmark(
    'SecurityValidator.validatePath (safe)',
    () => securityValidator.validatePath('./src/components/Button.js')
  );

  await runner.runBenchmark(
    'SecurityValidator.validatePath (traversal attempt)',
    () => securityValidator.validatePath('../../../etc/passwd')
  );

  await runner.runBenchmark(
    'SecurityValidator.validateCommand (safe)',
    () => securityValidator.validateCommand('npm test')
  );

  await runner.runBenchmark(
    'SecurityValidator.validateCommand (blocked)',
    () => securityValidator.validateCommand('rm -rf /')
  );

  await runner.runBenchmark(
    'SecurityValidator.validateBatch (5 inputs)',
    () => securityValidator.validateBatch([
      { input: 'task-1', type: 'taskId' },
      { input: 'implementation', type: 'phase' },
      { input: 'Normal description', type: 'description' },
      { input: SAMPLE_TASKS[0], type: 'task' },
      { input: 'Generic text', type: 'generic' }
    ])
  );

  // Print results
  const allPassed = runner.printResults();

  // Return exit code
  return allPassed ? 0 : 1;
}

// Run benchmarks
runAllBenchmarks()
  .then(exitCode => {
    process.exit(exitCode);
  })
  .catch(error => {
    console.error(colors.red + 'Benchmark error:' + colors.reset, error);
    process.exit(1);
  });
