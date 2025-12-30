# Continuous Loop System - Integration Guide

## Overview

This guide walks you through integrating the Continuous Loop System into your Claude-based multi-agent project. By the end, you'll have automated state management, intelligent checkpointing, API limit tracking, cost monitoring, human-in-loop guardrails, and a real-time monitoring dashboard.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Detailed Integration](#detailed-integration)
4. [Configuration](#configuration)
5. [Usage Examples](#usage-examples)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Components

Your project must have these components (included in the multi-agent template):

- **MemoryStore** (`.claude/core/memory-store.js`) - SQLite-based state persistence
- **TokenCounter** (`.claude/core/token-counter.js`) - Accurate token counting
- **UsageTracker** (`.claude/core/usage-tracker.js`) - Cost and usage tracking
- **SessionInit** (`.claude/core/session-init.js`) - Session initialization

### Dependencies

```bash
npm install --save \
  better-sqlite3 \
  tiktoken \
  express \
  chalk \
  ora \
  inquirer
```

### File Structure

Ensure you have this structure:

```
your-project/
├── .claude/
│   ├── core/
│   │   ├── continuous-loop-orchestrator.js  ← Main integration
│   │   ├── checkpoint-optimizer.js           ← Learning checkpoint system
│   │   ├── claude-limit-tracker.js           ← API limit tracking
│   │   ├── dashboard-manager.js              ← Real-time dashboard
│   │   ├── dashboard-html.js                 ← Dashboard UI
│   │   ├── human-in-loop-detector.js         ← AI safety guardrails
│   │   ├── memory-store.js                   ← Existing
│   │   ├── token-counter.js                  ← Existing
│   │   └── usage-tracker.js                  ← Existing
│   ├── memory/
│   │   └── memory-store.db                   ← SQLite database
│   ├── state/
│   │   └── checkpoints/                      ← Checkpoint storage
│   └── settings.local.json                   ← Your configuration
└── examples/
    └── continuous-loop-demo.js               ← Demo script
```

---

## Quick Start

### 1. Copy Configuration Template

```bash
cp .claude/settings.local.json.template .claude/settings.local.json
```

### 2. Edit Configuration

Open `.claude/settings.local.json` and set your preferences:

```javascript
{
  "continuousLoop": {
    "enabled": true,                    // Master toggle

    "contextMonitoring": {
      "enabled": true,                  // Monitor context usage
      "contextWindowSize": 200000,      // Claude's context window
      "checkpointThreshold": 0.75       // Checkpoint at 75% (learns over time)
    },

    "apiLimitTracking": {
      "enabled": true,                  // Track API rate limits
      "plan": "Pro"                     // "Free", "Pro", or "Team"
    },

    "costBudgets": {
      "enabled": true,                  // Monitor costs
      "budgets": {
        "session": 5.00,                // Max $5 per session
        "daily": 25.00                  // Max $25 per day
      }
    },

    "humanInLoop": {
      "enabled": true,                  // Intelligent guardrails
      "confidenceThreshold": 0.70       // Trigger at 70%+ confidence
    },

    "dashboard": {
      "enabled": true,                  // Real-time monitoring
      "port": 3030                      // Dashboard port
    }
  }
}
```

### 3. Run Demo

```bash
node examples/continuous-loop-demo.js
```

Open `http://localhost:3030` in your browser to see the dashboard.

---

## Detailed Integration

### Step 1: Initialize Components

```javascript
const ContinuousLoopOrchestrator = require('./.claude/core/continuous-loop-orchestrator');
const MemoryStore = require('./.claude/core/memory-store');
const TokenCounter = require('./.claude/core/token-counter');
const UsageTracker = require('./.claude/core/usage-tracker');
const fs = require('fs');
const path = require('path');

// Load configuration
const config = JSON.parse(
  fs.readFileSync('.claude/settings.local.json', 'utf8')
);

// Initialize memory store
const memoryStore = new MemoryStore({
  dbPath: '.claude/memory/memory-store.db'
});
await memoryStore.initialize();

// Initialize token counter
const tokenCounter = new TokenCounter({
  model: 'claude-sonnet-4-20250514',
  memoryStore: memoryStore
});

// Initialize usage tracker
const usageTracker = new UsageTracker({
  memoryStore: memoryStore,
  sessionId: `session-${Date.now()}`
});

// Initialize continuous loop orchestrator
const orchestrator = new ContinuousLoopOrchestrator(
  {
    memoryStore,
    tokenCounter,
    usageTracker
  },
  config.continuousLoop
);

await orchestrator.initialize();

console.log('✅ Continuous loop system initialized');
console.log(`📊 Dashboard: http://localhost:${config.continuousLoop.dashboard.port}`);
```

### Step 2: Integrate Safety Checks

**Before every operation**, check safety:

```javascript
async function executeTask(task) {
  // 1. Run safety check
  const safetyCheck = await orchestrator.checkSafety({
    type: task.type,              // 'code-generation', 'design', 'testing', etc.
    task: task.description,       // Human-readable task description
    phase: task.phase,            // 'research', 'planning', 'implementation', etc.
    estimatedTokens: task.tokens, // Estimated token usage
    metadata: task.metadata       // Any additional context
  });

  // 2. Handle safety check result
  switch (safetyCheck.action) {
    case 'PROCEED':
      // Safe to execute
      return await performTask(task);

    case 'PROCEED_WITH_CAUTION':
      // Execute but be aware of warnings
      console.warn(`⚠️ ${safetyCheck.reason}`);
      return await performTask(task);

    case 'CHECKPOINT_NOW':
      // Create checkpoint before continuing
      await orchestrator.checkpoint({
        reason: 'threshold-reached',
        taskType: task.type
      });
      return await performTask(task);

    case 'WRAP_UP_SOON':
      // Approaching limits - wrap up gracefully
      console.warn(`⏰ ${safetyCheck.reason}`);
      await orchestrator.wrapUp({ reason: safetyCheck.reason });
      return { status: 'wrapped-up', checkpoint: true };

    case 'WAIT_FOR_APPROVAL':
      // Human review required
      console.log(`👤 Human review required: ${safetyCheck.reason}`);

      // Wait for approval from dashboard
      const approved = await waitForHumanApproval(safetyCheck.reviewId);

      if (approved) {
        return await performTask(task);
      } else {
        return { status: 'rejected', reason: 'human-declined' };
      }

    case 'STOP_IMMEDIATELY':
      // Emergency stop
      throw new Error(`EMERGENCY STOP: ${safetyCheck.reason}`);

    default:
      throw new Error(`Unknown safety action: ${safetyCheck.action}`);
  }
}
```

### Step 3: Implement Human Approval Handler

```javascript
/**
 * Wait for human approval from dashboard
 */
function waitForHumanApproval(reviewId) {
  return new Promise((resolve) => {
    // Dashboard emits events when user approves/rejects
    orchestrator.dashboard.once(`review:${reviewId}:response`, (response) => {
      // Record feedback for learning
      orchestrator.recordHumanFeedback(reviewId, {
        approved: response.approved,
        wasCorrect: response.approved, // User confirmed detection was correct
        actualNeed: response.approved ? 'yes' : 'no',
        comment: response.feedback
      });

      resolve(response.approved);
    });

    // Timeout after 30 minutes
    setTimeout(() => {
      console.warn(`⏰ Review timeout for ${reviewId} - auto-rejecting`);
      resolve(false);
    }, 30 * 60 * 1000);
  });
}
```

### Step 4: Track Operations

```javascript
async function performTask(task) {
  // Track token usage
  const startTokens = usageTracker.getSessionUsage().totalTokens;

  try {
    // Execute your task
    const result = await yourTaskExecutionLogic(task);

    // Track actual token usage
    const endTokens = usageTracker.getSessionUsage().totalTokens;
    const actualTokens = endTokens - startTokens;

    // Record in checkpoint optimizer for learning
    orchestrator.optimizer.recordTaskPattern({
      taskType: task.type,
      estimatedTokens: task.tokens,
      actualTokens: actualTokens
    });

    return result;

  } catch (error) {
    // Track errors for learning
    console.error(`Task failed: ${error.message}`);
    throw error;
  }
}
```

### Step 5: Checkpoint Management

```javascript
/**
 * Manual checkpoint
 */
async function createCheckpoint(reason = 'manual') {
  const result = await orchestrator.checkpoint({
    reason: reason,
    taskType: 'current-task-type',
    includeState: true
  });

  if (result.success) {
    console.log(`✅ Checkpoint created: ${result.checkpointId}`);
  } else {
    console.error(`❌ Checkpoint failed: ${result.reason}`);
  }

  return result;
}

/**
 * Auto-checkpoint based on optimizer
 */
async function autoCheckpointIfNeeded() {
  const currentTokens = usageTracker.getSessionUsage().totalTokens;
  const maxTokens = config.continuousLoop.contextMonitoring.contextWindowSize;

  const shouldCheckpoint = orchestrator.optimizer.shouldCheckpoint(
    currentTokens,
    maxTokens,
    'current-task-type'
  );

  if (shouldCheckpoint.should) {
    console.log(`💾 Auto-checkpoint triggered: ${shouldCheckpoint.reason}`);
    await createCheckpoint('auto');
  }
}
```

### Step 6: Graceful Wrap-Up

```javascript
/**
 * Wrap up session gracefully
 */
async function wrapUpSession(reason = 'manual') {
  console.log(`\n🎬 Starting graceful wrap-up...`);
  console.log(`Reason: ${reason}\n`);

  const result = await orchestrator.wrapUp({
    reason: reason,
    createSummary: true,
    saveState: true
  });

  if (result.success) {
    console.log(`✅ Wrap-up complete!`);

    if (result.summary) {
      console.log(`\nSession Summary:`);
      console.log(`  Duration: ${formatDuration(result.summary.durationMs)}`);
      console.log(`  Operations: ${result.summary.operationsCompleted}`);
      console.log(`  Checkpoints: ${result.summary.checkpointsCreated}`);
      console.log(`  Cost: $${result.summary.totalCost.toFixed(4)}`);
      console.log(`  State: ${result.summary.finalState}`);
    }

    // Next session can resume from last checkpoint
    console.log(`\n📌 Next session: Run session-init to resume`);
  }

  return result;
}
```

### Step 7: Dashboard Integration

The dashboard automatically shows:

- ✅ Real-time task progress
- ✅ Token usage and API limits
- ✅ Cost tracking
- ✅ Artifacts created
- ✅ Human review queue
- ✅ Configuration toggles
- ✅ Learning statistics

**No additional integration needed** - just ensure the dashboard is enabled in config.

---

## Configuration

### Context Monitoring

```javascript
"contextMonitoring": {
  "enabled": true,
  "contextWindowSize": 200000,        // Claude Opus/Sonnet 4: 200K tokens
  "checkpointThreshold": 0.75,        // Start at 75% (learns optimal timing)
  "bufferTokens": 10000,              // 10K safety buffer
  "compactionDetectionDrop": 50000,   // 50K+ drop = compaction detected
  "adaptiveLearning": true            // Learn from experience
}
```

**How it works:**
- Monitors context window usage
- Learns optimal checkpoint timing
- Detects compaction (sudden token drops)
- Auto-adjusts threshold to prevent future compaction

### API Limit Tracking

```javascript
"apiLimitTracking": {
  "enabled": true,
  "plan": "Pro",                      // Your Claude plan

  "limits": {
    "Pro": {
      "requestsPerMinute": 5,
      "requestsPerHour": 500,
      "requestsPerDay": 1000,
      "tokensPerDay": 2500000
    }
  },

  "thresholds": {
    "warning": 0.80,                  // Warn at 80%
    "critical": 0.90,                 // Critical at 90%
    "emergency": 0.95                 // Emergency at 95%
  }
}
```

**Actions:**
- **80%:** Warning logged
- **90%:** Wrap-up recommended
- **95%:** Emergency stop

### Cost Budgets

```javascript
"costBudgets": {
  "enabled": true,

  "budgets": {
    "session": 5.00,                  // Per session
    "daily": 25.00,                   // Per day
    "weekly": 100.00,                 // Per week
    "monthly": 300.00                 // Per month
  },

  "thresholds": {
    "warning": 0.75,
    "critical": 0.90,
    "emergency": 0.95
  }
}
```

### Human-In-Loop Guardrails

```javascript
"humanInLoop": {
  "enabled": true,
  "confidenceThreshold": 0.70,        // Trigger at 70%+ confidence
  "learningEnabled": true,            // Learn from feedback

  "patterns": {
    "highRisk": {
      "enabled": true,
      "keywords": ["deploy", "production", "delete"],
      "confidence": 0.95
    },
    "design": {
      "enabled": true,
      "keywords": ["architecture decision", "trade-off"],
      "confidence": 0.85
    }
    // ... more patterns
  }
}
```

**Built-in patterns:**
- `highRisk` (95%) - Production deployments, destructive operations
- `design` (85%) - Architecture decisions
- `manualTest` (90%) - Manual testing required
- `strategic` (90%) - Business decisions
- `legal` (95%) - Legal/compliance
- `qualityGate` (85%) - Code reviews
- `userExperience` (80%) - UX decisions

### Dashboard

```javascript
"dashboard": {
  "enabled": true,
  "port": 3030,
  "updateIntervalMs": 2000,           // Update every 2 seconds

  "features": {
    "taskTracking": true,
    "artifactViewer": true,
    "configToggles": true,
    "humanReviewQueue": true,
    "metricsDisplay": true
  }
}
```

---

## Usage Examples

### Example 1: Simple Task Execution

```javascript
const task = {
  type: 'code-generation',
  description: 'Implement user authentication',
  phase: 'implementation',
  tokens: 3000
};

const result = await executeTask(task);
console.log('Task result:', result);
```

### Example 2: Multi-Step Workflow

```javascript
const workflow = [
  { type: 'research', description: 'Research auth libraries', tokens: 2000 },
  { type: 'design', description: 'Design auth architecture', tokens: 4000 },
  { type: 'code-generation', description: 'Implement auth', tokens: 5000 },
  { type: 'testing', description: 'Write auth tests', tokens: 3000 },
  { type: 'infrastructure', description: 'Deploy to staging', tokens: 2000 }
];

for (const task of workflow) {
  const result = await executeTask(task);

  if (result.status === 'wrapped-up') {
    console.log('Session wrapped up - resume in next session');
    break;
  }

  if (result.status === 'rejected') {
    console.log('Task rejected by human review');
    break;
  }
}
```

### Example 3: Integration with Agent System

```javascript
class MultiAgentOrchestrator {
  constructor() {
    this.continuousLoop = null;
  }

  async initialize() {
    // Initialize continuous loop
    this.continuousLoop = new ContinuousLoopOrchestrator(/* ... */);
    await this.continuousLoop.initialize();
  }

  async executeAgent(agentType, task) {
    // Safety check before agent execution
    const safetyCheck = await this.continuousLoop.checkSafety({
      type: agentType,
      task: task.description,
      phase: task.phase,
      estimatedTokens: this.estimateTokens(agentType, task)
    });

    if (safetyCheck.action === 'WAIT_FOR_APPROVAL') {
      // Show in dashboard, wait for approval
      const approved = await this.waitForApproval(safetyCheck.reviewId);
      if (!approved) return { status: 'declined' };
    }

    if (safetyCheck.action === 'CHECKPOINT_NOW') {
      await this.continuousLoop.checkpoint();
    }

    // Execute agent
    return await this.runAgent(agentType, task);
  }
}
```

### Example 4: Learning from Compaction

```javascript
// The system automatically detects and learns from compaction

// Session 1: Compaction occurs at 85% context
// → System learns: reduce threshold to 70%

// Session 2: Compaction occurs at 75% context
// → System learns: reduce threshold to 60%

// Session 3+: No more compaction
// → System maintains optimal threshold

// You can check learning progress:
const stats = orchestrator.getStatus();
console.log('Checkpoint threshold:', stats.checkpointOptimizer.threshold);
console.log('Success rate:', stats.checkpointOptimizer.successRate);
console.log('Compactions detected:', stats.checkpointOptimizer.compactionsDetected);
```

---

## Best Practices

### 1. Start Conservative

Begin with:
- `checkpointThreshold: 0.65` (lower than default)
- `confidenceThreshold: 0.60` (lower sensitivity)

Let the system learn and adapt over 10-20 sessions.

### 2. Provide Rich Feedback

When human review is triggered:

**Good feedback:**
```
"SSL certificate changes can break production - this was correctly flagged"
```

**Better feedback:**
```
"SSL certificate changes in production require security team review and
scheduled maintenance window. This detection was correct and very important."
```

The system extracts patterns from detailed feedback.

### 3. Monitor Learning Stats

Check dashboard regularly:
- **Precision** - Are detections accurate? (target: >85%)
- **Recall** - Are risky operations caught? (target: >90%)
- **Success Rate** - Are checkpoints successful? (target: >95%)

### 4. Use Descriptive Task Names

**Bad:**
```javascript
{ task: 'Do thing', type: 'code' }
```

**Good:**
```javascript
{
  task: 'Deploy authentication service to production environment',
  type: 'infrastructure',
  phase: 'deployment',
  metadata: {
    environment: 'production',
    service: 'auth',
    risk: 'high'
  }
}
```

Better descriptions → Better pattern matching → Better safety.

### 5. Don't Disable Too Early

The system needs 20-30 sessions to learn your project's patterns. Don't disable features after a few false positives.

### 6. Use Dashboard During Development

Keep the dashboard open while working:
```bash
# Terminal 1: Your development process
npm run dev

# Terminal 2: Dashboard (if not auto-started)
# Dashboard is embedded in orchestrator and auto-starts
```

### 7. Regular Checkpoints for Long Tasks

For tasks >50K tokens:
```javascript
async function longRunningTask() {
  // Start
  await executeSubtask1();

  // Manual checkpoint
  await orchestrator.checkpoint({ reason: 'progress-save' });

  await executeSubtask2();

  // Another checkpoint
  await orchestrator.checkpoint({ reason: 'progress-save' });

  await executeSubtask3();
}
```

---

## Troubleshooting

### Issue: Dashboard Not Loading

**Check:**
1. Dashboard enabled in config?
   ```javascript
   "dashboard": { "enabled": true }
   ```

2. Port available?
   ```bash
   lsof -i :3030  # Check if port is in use
   ```

3. Firewall blocking?
   ```bash
   # Allow port 3030
   ```

**Solution:**
```javascript
"dashboard": {
  "enabled": true,
  "port": 3031  // Try different port
}
```

### Issue: Too Many False Positives

**Symptoms:** Human review triggers on safe operations

**Solution:**
1. Increase confidence threshold:
   ```javascript
   "confidenceThreshold": 0.80  // From 0.70
   ```

2. Provide feedback marking false positives:
   ```
   "This is safe - just writing tests, not touching production code"
   ```

3. Wait for learning (10-20 detections)

4. Check precision metric:
   ```javascript
   const stats = orchestrator.getStatus();
   console.log('Precision:', stats.humanInLoop.precision);
   // Target: >0.85
   ```

### Issue: Missing Risky Operations

**Symptoms:** System doesn't stop for dangerous tasks

**Solution:**
1. Decrease confidence threshold:
   ```javascript
   "confidenceThreshold": 0.60  // From 0.70
   ```

2. Add custom patterns:
   ```javascript
   "patterns": {
     "customRisk": {
       "enabled": true,
       "keywords": ["your", "custom", "keywords"],
       "confidence": 0.90,
       "reason": "Custom high-risk operation"
     }
   }
   ```

3. Provide feedback on misses:
   When you manually stop Claude, note:
   ```
   "This should have triggered review - database migrations require approval"
   ```

### Issue: Compaction Still Occurring

**Symptoms:** Context window compacting despite monitoring

**Check:**
1. Is adaptive learning enabled?
   ```javascript
   "adaptiveLearning": true
   ```

2. Has compaction been detected?
   ```javascript
   const stats = orchestrator.getStatus();
   console.log('Compactions:', stats.checkpointOptimizer.compactionsDetected);
   ```

3. Is threshold adapting?
   ```javascript
   console.log('Threshold:', stats.checkpointOptimizer.threshold);
   // Should decrease after compaction
   ```

**Solution:**
- Manually reduce threshold:
  ```javascript
  "checkpointThreshold": 0.60  // From 0.75
  ```

- Increase buffer:
  ```javascript
  "bufferTokens": 20000  // From 10000
  ```

### Issue: API Limits Hit

**Symptoms:** Emergency stop due to rate limits

**Check:**
1. Correct plan configured?
   ```javascript
   "plan": "Pro"  // Match your actual Claude plan
   ```

2. Limits accurate?
   ```javascript
   // Verify limits match your plan
   "limits": { "Pro": { "requestsPerDay": 1000 } }
   ```

**Solution:**
1. Reduce thresholds:
   ```javascript
   "thresholds": {
     "warning": 0.70,  // From 0.80
     "critical": 0.85,  // From 0.90
     "emergency": 0.90  // From 0.95
   }
   ```

2. Increase wrap-up buffer:
   ```javascript
   "wrapUpBufferMinutes": 10  // From 5
   ```

### Issue: Costs Exceeding Budget

**Symptoms:** Budget warnings/critical alerts

**Check:**
```javascript
const stats = orchestrator.getStatus();
console.log('Session cost:', stats.costs.sessionCost);
console.log('Daily cost:', stats.costs.dailyCost);
console.log('Budget:', stats.costs.sessionBudget);
```

**Solution:**
1. Adjust budgets:
   ```javascript
   "budgets": {
     "session": 10.00,  // Increase if needed
     "daily": 50.00
   }
   ```

2. Reduce token usage:
   - Use smaller context windows
   - More frequent checkpoints
   - Optimize prompts

### Issue: Learning Not Improving

**Symptoms:** Stats not changing after many sessions

**Check:**
1. Enough data?
   ```javascript
   "minSessionsForLearning": 5  // Need 5+ sessions
   "minDetectionsForAdapt": 10  // Need 10+ detections
   ```

2. Feedback provided?
   - Learning requires user feedback on detections

3. Learning enabled?
   ```javascript
   "learningEnabled": true
   "adaptiveLearning": true
   ```

**Solution:**
- Provide detailed feedback on every detection
- Lower minimum thresholds:
  ```javascript
  "minSessionsForLearning": 3
  "minDetectionsForAdapt": 5
  ```

---

## Advanced Integration

### Custom Event Handlers

```javascript
// Listen to orchestrator events
orchestrator.on('checkpoint:created', (checkpoint) => {
  console.log('Checkpoint created:', checkpoint.id);
  // Custom logic: backup files, notify team, etc.
});

orchestrator.on('safety:critical', (details) => {
  console.warn('Critical safety issue:', details);
  // Custom logic: send alerts, pause CI/CD, etc.
});

orchestrator.on('human-review:requested', (review) => {
  console.log('Human review needed:', review.task);
  // Custom logic: Slack notification, email, etc.
});
```

### Custom Patterns

```javascript
// Add project-specific patterns
orchestrator.hilDetector.addPattern('deploymentWindow', {
  keywords: [
    'deploy outside hours',
    'weekend deployment',
    'holiday deploy'
  ],
  confidence: 0.95,
  reason: 'Deployment outside approved maintenance window'
});
```

### Integration with CI/CD

```javascript
// In your CI/CD pipeline
const orchestrator = new ContinuousLoopOrchestrator(/* ... */);

// Before deployment
const safetyCheck = await orchestrator.checkSafety({
  type: 'infrastructure',
  task: 'Deploy to production',
  phase: 'deployment',
  metadata: { environment: process.env.DEPLOY_ENV }
});

if (safetyCheck.action === 'STOP_IMMEDIATELY') {
  console.error('Deployment blocked by safety check');
  process.exit(1);
}
```

---

## Next Steps

1. **Run the demo** - `node examples/continuous-loop-demo.js`
2. **Read the docs** - Check `docs/CONTINUOUS-LOOP-SYSTEM.md`
3. **Explore dashboard** - Open `http://localhost:3030`
4. **Start integrating** - Follow this guide step-by-step
5. **Provide feedback** - Help the system learn your patterns
6. **Monitor stats** - Track learning progress in dashboard

---

## Support

For issues, questions, or feature requests:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review `docs/archive/CONTINUOUS-LOOP-SYSTEM.md`
3. Check `docs/features/HUMAN-IN-LOOP-GUARDRAILS.md`
4. Review `docs/features/DASHBOARD-FEATURES.md`
5. Run the demo to see expected behavior

---

**Happy Automating!** 🚀

The continuous loop system will learn your project's patterns and become more accurate over time. Give it 20-30 sessions to reach optimal performance.
