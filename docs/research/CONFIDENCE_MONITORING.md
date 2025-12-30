# Confidence Monitoring System

The Confidence Monitoring system tracks execution confidence using weighted signals, providing real-time scoring and threshold alerts to detect problems early.

## Overview

The `ConfidenceMonitor` aggregates multiple signals into a single confidence score (0-100):

- **qualityScore (30%)**: Quality gate scores from `quality-scores.json`
- **velocity (25%)**: Task completion rate vs. estimates
- **iterations (20%)**: Number of retry attempts (fewer = better)
- **errorRate (15%)**: Error count during execution
- **historical (10%)**: Historical success rate from MemoryStore

Confidence is monitored against thresholds to trigger alerts:
- **Warning** (60): Potential issues
- **Critical** (40): Significant problems
- **Emergency** (25): Immediate intervention needed

## Architecture

```
Signal Inputs
    |
    +-- qualityScore (0-100)
    +-- velocity (completedTasks / estimatedTasks * 100)
    +-- iterations (inversely proportional to maxIterations)
    +-- errorRate (inversely proportional, 0 errors = 100)
    +-- historical (success rate from memory store)
    |
    v
ConfidenceMonitor
    |
    +-- Normalize each signal to 0-100
    +-- Apply weights
    +-- Calculate weighted average
    |
    v
Threshold Check --> Emit events if crossed
    |
    v
Dashboard / Alerts
```

## Configuration

### Environment Variables

```bash
# Enable/disable confidence monitoring (default: true)
ENABLE_CONFIDENCE_MONITORING=true
```

### Constructor Options

```javascript
const ConfidenceMonitor = require('./.claude/core/confidence-monitor');

const monitor = new ConfidenceMonitor({
  // Custom signal weights (must sum to 1.0)
  weights: {
    qualityScore: 0.30,
    velocity: 0.25,
    iterations: 0.20,
    errorRate: 0.15,
    historical: 0.10
  },

  // Custom thresholds
  thresholds: {
    warning: 60,
    critical: 40,
    emergency: 25
  },

  // Path to quality scores file
  qualityScoresPath: './.claude/dev-docs/quality-scores.json',

  // MemoryStore for historical data
  memoryStore: memoryStoreInstance,

  // Maximum iterations before 0 score
  maxIterations: 5
});
```

## Signal Definitions

### qualityScore
The current quality gate score from `quality-scores.json`.

**Normalization**: Direct (0-100 pass-through)

```javascript
monitor.update('qualityScore', 85);
```

### velocity
Task completion progress relative to estimates.

**Normalization**: `(completedTasks / estimatedTasks) * 100`

```javascript
// Completed 3 of 5 estimated tasks = 60% velocity
monitor.trackProgress(3, 5);
```

### iterations
Number of retry attempts on the current task/phase.

**Normalization**: `((maxIterations - current) / maxIterations) * 100`
- 0 iterations = 100 (perfect)
- maxIterations = 0 (worst)

```javascript
// On iteration 2 of max 5 = 60% confidence contribution
monitor.trackIteration(2);
// Or specify max: monitor.trackIteration(2, 10);
```

### errorRate
Count of errors encountered during execution.

**Normalization**: `(1 - (errorCount / 10)) * 100`
- 0 errors = 100
- 10+ errors = 0

```javascript
monitor.trackError();      // Increment by 1
monitor.trackError(3);     // Increment by 3
monitor.resetErrors();     // Reset to 0
```

### historical
Historical success rate from the MemoryStore.

**Normalization**: Direct (0-100 pass-through, inverted for complexity)

```javascript
await monitor.loadHistoricalRate('implementation');
```

## API Reference

### Signal Updates

#### `update(signal, value)`
Update a single signal value.

```javascript
monitor.update('qualityScore', 92);
monitor.update('errorRate', 2);
```

#### `updateBatch(updates)`
Update multiple signals at once.

```javascript
monitor.updateBatch({
  qualityScore: 85,
  velocity: 75,
  iterations: 2
});
```

### Tracking Helpers

#### `trackProgress(completed, estimated)`
Track task velocity.

```javascript
monitor.trackProgress(5, 8); // 5 of 8 tasks done
```

#### `trackIteration(current, max?)`
Track iteration count.

```javascript
monitor.trackIteration(3);      // Uses default maxIterations
monitor.trackIteration(3, 10);  // Override max
```

#### `trackError(count?)`
Increment error count.

```javascript
monitor.trackError();   // +1
monitor.trackError(5);  // +5
```

#### `resetErrors()`
Reset error count to 0.

### Data Loading

#### `async loadQualityScore()`
Load quality score from file.

```javascript
const score = await monitor.loadQualityScore();
```

#### `async loadHistoricalRate(taskType?)`
Load historical success rate from MemoryStore.

```javascript
const rate = await monitor.loadHistoricalRate('testing');
```

### Calculations

#### `calculate()`
Calculate and return the current confidence score.

```javascript
const confidence = monitor.calculate();
console.log(`Confidence: ${confidence}%`);
```

#### `getBreakdown()`
Get detailed breakdown of all signals.

```javascript
const breakdown = monitor.getBreakdown();
/*
{
  qualityScore: { raw: 85, normalized: 85, weight: 0.30, contribution: 25.5 },
  velocity: { raw: 60, normalized: 60, weight: 0.25, contribution: 15.0 },
  iterations: { raw: 2, normalized: 60, weight: 0.20, contribution: 12.0 },
  errorRate: { raw: 1, normalized: 90, weight: 0.15, contribution: 13.5 },
  historical: { raw: null, normalized: null, weight: 0.10, contribution: null }
}
*/
```

### Threshold Management

#### `setThreshold(level, value)`
Update a threshold value.

```javascript
monitor.setThreshold('warning', 65);
monitor.setThreshold('critical', 45);
```

#### `getThresholds()`
Get all threshold values.

```javascript
const thresholds = monitor.getThresholds();
// { warning: 60, critical: 40, emergency: 25 }
```

#### `getThresholdState()`
Get current threshold state.

```javascript
const state = monitor.getThresholdState();
// 'normal', 'warning', 'critical', or 'emergency'
```

### State Management

#### `getState()`
Get complete monitor state.

```javascript
const state = monitor.getState();
/*
{
  confidence: 72.5,
  thresholdState: 'normal',
  signals: { qualityScore: 85, velocity: 60, ... },
  breakdown: { ... },
  thresholds: { warning: 60, critical: 40, emergency: 25 },
  tracking: {
    errorCount: 1,
    completedTasks: 3,
    estimatedTasks: 5,
    currentIteration: 2,
    maxIterations: 5
  },
  updateCount: 15,
  lastUpdate: 1735200000000
}
*/
```

#### `getHistory(limit?)`
Get recent update history.

```javascript
const history = monitor.getHistory(10);
/*
[
  { signal: 'qualityScore', value: 85, timestamp: 1735200000000 },
  { signal: 'velocity', value: 60, timestamp: 1735200001000 },
  ...
]
*/
```

#### `snapshot()`
Create a serializable snapshot for persistence.

```javascript
const snapshot = monitor.snapshot();
// Store in file or database
```

#### `restore(snapshot)`
Restore from a previous snapshot.

```javascript
monitor.restore(previousSnapshot);
```

#### `reset()`
Reset all signals and tracking to defaults.

```javascript
monitor.reset();
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `confidence:updated` | `{ confidence, signals, timestamp }` | Fired after every recalculation |
| `confidence:warning` | `{ confidence, threshold, previousState, timestamp }` | Crossed into warning zone |
| `confidence:critical` | `{ confidence, threshold, previousState, timestamp }` | Crossed into critical zone |
| `confidence:emergency` | `{ confidence, threshold, previousState, timestamp }` | Crossed into emergency zone |
| `confidence:recovered` | `{ confidence, threshold, previousState, timestamp }` | Recovered to normal state |
| `confidence:reset` | `{ timestamp }` | Monitor was reset |
| `confidence:restored` | `{ snapshot, timestamp }` | Restored from snapshot |

### Event Examples

```javascript
monitor.on('confidence:warning', (event) => {
  console.log(`WARNING: Confidence dropped to ${event.confidence}`);
  // Send Slack notification
});

monitor.on('confidence:critical', (event) => {
  console.log(`CRITICAL: Confidence at ${event.confidence}`);
  // Page on-call engineer
});

monitor.on('confidence:emergency', (event) => {
  console.log(`EMERGENCY: Confidence at ${event.confidence}`);
  // Halt execution, require human intervention
});

monitor.on('confidence:recovered', (event) => {
  console.log(`Recovered from ${event.previousState} to normal`);
});
```

## Integration with Orchestrator

The `ContinuousLoopOrchestrator` integrates confidence monitoring:

```javascript
const orchestrator = require('./autonomous-orchestrator');

// Track execution progress
orchestrator.trackProgress({
  qualityScore: 85,
  completed: 3,
  estimated: 5,
  iteration: 2,
  errors: 1
});

// Get current confidence state
const state = orchestrator.getConfidenceState();
// Returns: { confidence, thresholdState, signals, breakdown }
```

### Safety Check Integration

Confidence is checked in the safety pipeline:

```javascript
// In checkSafety():
if (this.confidenceMonitor) {
  const state = this.confidenceMonitor.getThresholdState();
  if (state === 'emergency') {
    return { safe: false, reason: 'Confidence emergency' };
  }
}
```

## Examples

### Basic Usage

```javascript
const ConfidenceMonitor = require('./.claude/core/confidence-monitor');

const monitor = new ConfidenceMonitor();

// Update signals
monitor.update('qualityScore', 85);
monitor.trackProgress(3, 5);      // 60% velocity
monitor.trackIteration(2);         // 2nd iteration
monitor.trackError();              // 1 error

// Get confidence
const confidence = monitor.calculate();
console.log(`Confidence: ${confidence}%`);
console.log(`State: ${monitor.getThresholdState()}`);
```

### With Events

```javascript
const monitor = new ConfidenceMonitor({
  thresholds: { warning: 70, critical: 50, emergency: 30 }
});

monitor.on('confidence:warning', ({ confidence }) => {
  console.log(`Low confidence: ${confidence}%`);
});

monitor.on('confidence:recovered', () => {
  console.log('Confidence recovered!');
});

// Simulate degradation
monitor.update('qualityScore', 60);  // Triggers warning
monitor.update('qualityScore', 85);  // Triggers recovered
```

### Persistence with Snapshots

```javascript
const fs = require('fs');

// Save state
const snapshot = monitor.snapshot();
fs.writeFileSync('confidence-state.json', JSON.stringify(snapshot));

// Restore state
const restored = JSON.parse(fs.readFileSync('confidence-state.json'));
monitor.restore(restored);
```

### Dashboard Integration

```javascript
// In SSE endpoint
app.get('/events', (req, res) => {
  const sendConfidence = () => {
    const state = monitor.getState();
    res.write(`data: ${JSON.stringify({ type: 'confidence', ...state })}\n\n`);
  };

  monitor.on('confidence:updated', sendConfidence);

  // Send initial state
  sendConfidence();
});
```

## Threshold Tuning Guide

### Conservative Settings (Critical Systems)

```javascript
const monitor = new ConfidenceMonitor({
  thresholds: {
    warning: 75,   // Alert early
    critical: 60,  // Investigate immediately
    emergency: 50  // Halt execution
  }
});
```

### Aggressive Settings (Experimental)

```javascript
const monitor = new ConfidenceMonitor({
  thresholds: {
    warning: 50,   // Allow more variance
    critical: 30,  // Only serious issues
    emergency: 15  // Only halt on failure
  }
});
```

### Adjusting Weights

Emphasize quality for critical projects:

```javascript
const monitor = new ConfidenceMonitor({
  weights: {
    qualityScore: 0.45,   // Increase quality weight
    velocity: 0.15,       // Decrease velocity weight
    iterations: 0.15,
    errorRate: 0.15,
    historical: 0.10
  }
});
```

## Best Practices

1. **Start with defaults**: The default weights and thresholds work well for most cases
2. **Monitor events**: Always subscribe to threshold events for alerting
3. **Use snapshots**: Persist state across session restarts
4. **Track all signals**: Provide data for all 5 signals for accurate scoring
5. **Tune thresholds**: Adjust based on your team's tolerance for risk
6. **Integrate with dashboard**: Show confidence in real-time UI

## Troubleshooting

### Confidence stuck at 50
- Signals may be missing - call `getBreakdown()` to see which are null
- Load quality score with `loadQualityScore()`
- Ensure MemoryStore is connected for historical data

### False positives (too many warnings)
- Lower the warning threshold
- Check if errorRate is too sensitive
- Verify iteration tracking is correct

### Events not firing
- Ensure signals cross thresholds (not just approach them)
- Check that events are subscribed before signal updates
- Verify the threshold state actually changed
