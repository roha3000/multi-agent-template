# Competitive Planning System

The Competitive Planning system generates multiple implementation plans for complex tasks, enabling comparison and optimal plan selection.

## Overview

When a task exceeds a complexity threshold (default: 40), the `CompetitivePlanner` generates 2-3 competing implementation strategies:

- **Conservative**: Minimal risk, proven patterns, incremental delivery
- **Balanced**: Moderate risk with measured innovation
- **Aggressive**: High innovation, cutting-edge solutions

Plans are automatically evaluated and compared using the `PlanEvaluator` to select the winner or flag ties for human review.

## Architecture

```
Task Input
    |
    v
ComplexityAnalyzer --> score < 40? --> Single balanced plan
    |
    v (score >= 40)
CompetitivePlanner --> Generate 2-3 plans
    |
    v
PlanEvaluator --> Score each plan
    |
    v
Comparison --> Winner selected OR Human review flagged
```

## Configuration

### Environment Variables

```bash
# Enable/disable competitive planning (default: true)
ENABLE_COMPETITIVE_PLANNING=true
```

### Constructor Options

```javascript
const { CompetitivePlanner } = require('./.claude/core/competitive-planner');

const planner = new CompetitivePlanner({
  // Complexity threshold for competitive planning (default: 40)
  complexityThreshold: 40,

  // Cache timeout in milliseconds (default: 300000 = 5 minutes)
  cacheTimeout: 300000,

  // Optional: inject ComplexityAnalyzer for automatic scoring
  complexityAnalyzer: complexityAnalyzer,

  // Optional: inject PlanEvaluator for automatic comparison
  planEvaluator: planEvaluator,

  // Custom strategies (optional)
  strategies: {
    conservative: { key: 'conservative', name: 'Custom Conservative', riskTolerance: 'low', innovationLevel: 'low' },
    balanced: { key: 'balanced', name: 'Custom Balanced', riskTolerance: 'medium', innovationLevel: 'medium' },
    aggressive: { key: 'aggressive', name: 'Custom Aggressive', riskTolerance: 'high', innovationLevel: 'high' }
  }
});
```

## API Reference

### `generatePlans(task, options)`

Generates competing plans for a task.

**Parameters:**
- `task` (Object): Task object with `id`, `title`, `description`, `estimate`, `acceptance`
- `options` (Object):
  - `complexity` (number): Override complexity score (0-100)
  - `forceRegenerate` (boolean): Bypass cache

**Returns:** `Promise<Object>`
```javascript
{
  taskId: 'task-123',
  complexity: 65,
  strategies: ['conservative', 'balanced'],
  plans: [...],           // Array of generated plans
  comparison: {...},      // PlanEvaluator comparison result (if evaluator attached)
  winner: {...},          // Winning plan object
  needsHumanReview: false,
  timestamp: '2025-12-26T10:00:00.000Z'
}
```

### `getCachedPlan(taskId)`

Retrieves a cached plan result if available and not expired.

### `clearCache()`

Clears the plan cache.

### `getStrategies()`

Returns the current strategy definitions.

### `setComplexityThreshold(threshold)`

Sets the complexity threshold (0-100) that triggers competitive planning.

### `getComplexityThreshold()`

Returns the current complexity threshold.

## Plan Structure

Each generated plan contains:

```javascript
{
  id: 'task-123-conservative-1735200000000',
  taskId: 'task-123',
  strategy: {
    key: 'conservative',
    name: 'Conservative Approach',
    description: 'Minimal risk, proven patterns, incremental delivery',
    riskTolerance: 'low',
    innovationLevel: 'low'
  },
  title: 'Implement Feature X - Conservative Approach',
  steps: [
    { order: 1, action: 'Research: Analyze requirements', details: 'Analyze existing patterns...', phase: 'research' },
    { order: 2, action: 'Design: Analyze requirements', details: 'Create detailed specification', phase: 'design' },
    // ...
  ],
  risks: [
    { risk: 'Slower delivery timeline', mitigation: 'Prioritize critical path...', severity: 'low' }
  ],
  estimates: {
    hours: 8,
    days: 1,
    complexity: 'medium',
    confidence: 'high'
  },
  dependencies: ['database', 'api-framework'],
  analysis: {
    complexity: 65,
    riskLevel: 'low',
    innovationLevel: 'low'
  },
  createdAt: '2025-12-26T10:00:00.000Z'
}
```

## PlanEvaluator Criteria

When a `PlanEvaluator` is attached, plans are scored on 5 weighted criteria:

| Criterion | Weight | Description |
|-----------|--------|-------------|
| Completeness | 25% | Does the plan cover all requirements? |
| Feasibility | 25% | Is it realistic given constraints? |
| Risk | 20% | Are risks identified and mitigated? |
| Clarity | 15% | Are steps clear and actionable? |
| Efficiency | 15% | Is it resource-efficient? |

### Tie Detection

If the score margin between the top two plans is below the tie threshold (default: 10 points), the comparison is flagged for human review:

```javascript
{
  winner: { planId: 'plan-1', totalScore: 78.5 },
  rankings: [...],
  margin: 5.2,
  needsReview: true,
  reviewReason: 'Margin of 5.2 is below threshold of 10. Top plans: "Plan A" vs "Plan B"'
}
```

## Events

The `CompetitivePlanner` emits:

| Event | Payload | Description |
|-------|---------|-------------|
| `plans:generated` | `{ taskId, planCount, strategies, hasComparison, needsReview }` | Fired after plan generation |

The `PlanEvaluator` emits:

| Event | Payload | Description |
|-------|---------|-------------|
| `plan:evaluated` | `{ planId, planTitle, scores, totalScore, recommendations }` | Fired after evaluating a single plan |
| `plans:compared` | `{ winner, rankings, margin, needsReview }` | Fired after comparing plans |
| `plans:tie` | Same as `plans:compared` | Fired when a tie is detected |

## Integration with Orchestrator

The `ContinuousLoopOrchestrator` integrates competitive planning:

```javascript
const orchestrator = require('./autonomous-orchestrator');

// Analyze task complexity
const analysis = await orchestrator.analyzeTaskComplexity(task);
// Returns: { taskId, score, strategy, breakdown }

// Generate competing plans for complex tasks
const planResult = await orchestrator.generateCompetingPlans(task, { complexity: analysis.score });
// Returns: { taskId, plans, winner, needsHumanReview }

// Compare plans manually
const comparison = orchestrator.comparePlans(plans);
// Returns: { winner, rankings, margin, needsReview }
```

## Examples

### Basic Usage

```javascript
const CompetitivePlanner = require('./.claude/core/competitive-planner');
const { PlanEvaluator } = require('./.claude/core/plan-evaluator');

const planner = new CompetitivePlanner({
  planEvaluator: new PlanEvaluator()
});

const task = {
  id: 'auth-system',
  title: 'Implement OAuth2 authentication',
  description: 'Add OAuth2 support with Google and GitHub providers',
  estimate: '8h',
  acceptance: [
    'Users can sign in with Google',
    'Users can sign in with GitHub',
    'Tokens are securely stored'
  ]
};

const result = await planner.generatePlans(task, { complexity: 72 });

console.log(`Winner: ${result.winner.title}`);
console.log(`Strategy: ${result.winner.strategy.name}`);
console.log(`Steps: ${result.winner.steps.length}`);
console.log(`Needs Human Review: ${result.needsHumanReview}`);
```

### With ComplexityAnalyzer

```javascript
const ComplexityAnalyzer = require('./.claude/core/complexity-analyzer');
const CompetitivePlanner = require('./.claude/core/competitive-planner');
const { PlanEvaluator } = require('./.claude/core/plan-evaluator');

const analyzer = new ComplexityAnalyzer();
const planner = new CompetitivePlanner({
  complexityAnalyzer: analyzer,
  planEvaluator: new PlanEvaluator()
});

const task = {
  id: 'db-migration',
  title: 'Database schema migration',
  description: 'Migrate from MongoDB to PostgreSQL with zero downtime',
  estimate: '2d',
  acceptance: ['Zero downtime', 'All data migrated', 'Rollback tested']
};

// Complexity is automatically analyzed
const result = await planner.generatePlans(task);
console.log(`Complexity: ${result.complexity}`);
console.log(`Strategies used: ${result.strategies.join(', ')}`);
```

### Listening to Events

```javascript
planner.on('plans:generated', (event) => {
  console.log(`Generated ${event.planCount} plans for ${event.taskId}`);
  if (event.needsReview) {
    console.log('Human review required!');
  }
});

const evaluator = new PlanEvaluator();
evaluator.on('plans:tie', (event) => {
  console.log(`Tie detected: ${event.reviewReason}`);
});
```

## Strategy Selection Logic

The number of strategies used depends on task complexity:

| Complexity Score | Strategies Used | Rationale |
|------------------|-----------------|-----------|
| < 40 | Balanced only | Simple tasks don't need alternatives |
| 40-69 | Conservative + Balanced | Medium tasks benefit from comparison |
| >= 70 | All three | Complex tasks need full spectrum |

## Best Practices

1. **Set appropriate thresholds**: Adjust `complexityThreshold` based on your team's capacity for plan review
2. **Use caching**: Let the cache work - avoid `forceRegenerate` unless necessary
3. **Handle ties**: Always check `needsHumanReview` and implement a review workflow
4. **Monitor events**: Subscribe to events for logging and alerting
5. **Integrate evaluator**: Always attach a `PlanEvaluator` for objective comparison

## Troubleshooting

### Plans not being generated
- Ensure `ENABLE_COMPETITIVE_PLANNING=true` in environment
- Check that task complexity exceeds `complexityThreshold`

### All plans look similar
- Verify strategies are properly configured
- Check that task description is detailed enough

### Cache issues
- Call `clearCache()` to force regeneration
- Adjust `cacheTimeout` if plans become stale
