# Continuous Loop System - Quick Start

## 🚀 Launch the System

### Option 1: Auto-Start with Session Init (Easiest)

The continuous loop can automatically start when you run `/session-init`:

```bash
/session-init [your task description]
```

**When auto-start is enabled** (default):
- System checks if continuous loop is already running
- If not running, automatically starts it in the background
- Dashboard launches on http://localhost:3030
- No manual intervention needed!

**To enable/disable auto-start:**

Edit `.claude/continuous-loop-config.json`:
```json
{
  "continuousLoop": {
    "enabled": true,
    "autoStart": true,        // ← Set to false to disable auto-start
    "autoStartDelay": 2000    // ← Wait 2s after start before continuing
  }
}
```

### Option 2: Manual Start Script

```bash
node start-continuous-loop.js
```

This will:
- ✅ Start the continuous loop orchestrator
- ✅ Launch the dashboard on http://localhost:3030
- ✅ Display system status and configuration
- ✅ Keep running until you press Ctrl+C

**Managing the Process:**

Check if running:
```bash
# The PID file tells you if it's running
cat .claude/continuous-loop.pid
```

Stop the process:
```bash
# Get PID from file
kill $(cat .claude/continuous-loop.pid | grep -o '"pid":[0-9]*' | grep -o '[0-9]*')

# Or use Ctrl+C if running in foreground
```

### Option 3: Run the Demo

```bash
node examples/continuous-loop-demo.js
```

This runs a demonstration showing:
- Safe operations
- Risky operations (production deploys)
- Design decisions requiring human review
- Learning from feedback
- Checkpoint creation
- Graceful wrap-up

## 📊 Dashboard Access

Once started, open your browser to:

**http://localhost:3030**

The dashboard shows:
- 📋 Current tasks (completed/in-progress/pending)
- 📊 Token usage and context window
- 💰 Cost tracking
- 🔌 API limit status
- 👤 Human review queue
- 📁 Session artifacts
- ⚙️ Interactive configuration toggles

## 🎯 How to Use in Your Development Workflow

### Basic Integration

```javascript
const ContinuousLoopOrchestrator = require('./.claude/core/continuous-loop-orchestrator');
const MemoryStore = require('./.claude/core/memory-store');
const tokenCounter = require('./.claude/core/token-counter');  // Module with functions
const UsageTracker = require('./.claude/core/usage-tracker');
const fs = require('fs');

// Load config
const config = JSON.parse(
  fs.readFileSync('.claude/continuous-loop-config.json', 'utf8')
);

// Initialize
const memoryStore = new MemoryStore('.claude/memory/memory-store.db');
const usageTracker = new UsageTracker(memoryStore, {
  sessionId: `session-${Date.now()}`
});

const orchestrator = new ContinuousLoopOrchestrator(
  { memoryStore, tokenCounter, usageTracker },
  config.continuousLoop
);

// Before each operation, check safety
const safetyCheck = await orchestrator.checkSafety({
  type: 'code-generation',
  task: 'Implement user authentication',
  phase: 'implementation',
  estimatedTokens: 5000
});

// Handle the safety check
switch (safetyCheck.action) {
  case 'PROCEED':
    // Safe - execute your task
    await executeTask();
    break;

  case 'CHECKPOINT_NOW':
    // Create checkpoint first
    await orchestrator.checkpoint({ reason: 'threshold-reached' });
    await executeTask();
    break;

  case 'WAIT_FOR_APPROVAL':
    // Human review required - wait for dashboard approval
    const approved = await waitForHumanApproval(safetyCheck.reviewId);
    if (approved) await executeTask();
    break;

  case 'WRAP_UP_SOON':
    // Approaching limits - wrap up gracefully
    await orchestrator.wrapUp({ reason: 'limits-approaching' });
    break;
}
```

### Human Review Workflow

When human review is required:

1. **System detects** risky operation (e.g., "Deploy to production")
2. **Dashboard shows** review request with confidence score
3. **You decide**:
   - ✅ **Approve & Continue** - Task proceeds
   - ❌ **Stop & Revise** - Task halts
4. **Provide feedback** - System learns from your decision
5. **Precision improves** - From ~60% to >85% over 20-30 sessions

## ⚙️ Configuration

Edit `.claude/continuous-loop-config.json`:

```json
{
  "continuousLoop": {
    "enabled": true,         // Master toggle
    "autoStart": true,       // Auto-start with /session-init
    "autoStartDelay": 2000,  // Wait 2s after start

    "contextMonitoring": {
      "enabled": true,
      "checkpointThreshold": 0.75  // Checkpoint at 75% (learns optimal)
    },

    "apiLimitTracking": {
      "enabled": true,
      "plan": "Pro"  // "Free", "Pro", or "Team"
    },

    "costBudgets": {
      "enabled": true,
      "budgets": {
        "session": 5.00,   // Max $5 per session
        "daily": 25.00     // Max $25 per day
      }
    },

    "humanInLoop": {
      "enabled": true,
      "confidenceThreshold": 0.70  // Trigger at 70%+ confidence
    },

    "dashboard": {
      "enabled": true,
      "port": 3030
    }
  }
}
```

## 🛠️ Common Tasks

### Start with Dashboard

```bash
node start-continuous-loop.js
# Dashboard: http://localhost:3030
```

### Run Demo

```bash
node examples/continuous-loop-demo.js
```

### Create Manual Checkpoint

```javascript
await orchestrator.checkpoint({
  reason: 'before-major-refactor',
  taskType: 'refactoring'
});
```

### Wrap Up Session

```javascript
const summary = await orchestrator.wrapUp({
  reason: 'end-of-day'
});

console.log('Operations:', summary.operationsCompleted);
console.log('Cost:', summary.totalCost);
```

### Check Status

```javascript
const status = orchestrator.getStatus();

console.log('Context:', status.checkpointOptimizer.threshold);
console.log('API:', status.apiLimits.safe);
console.log('Cost:', status.costs.sessionCost);
```

## 📚 Documentation

- **System Overview**: `docs/CONTINUOUS-LOOP-SYSTEM.md`
- **Dashboard Guide**: `docs/DASHBOARD-FEATURES.md`
- **Integration Guide**: `docs/INTEGRATION-GUIDE.md`
- **Guardrails Guide**: `docs/HUMAN-IN-LOOP-GUARDRAILS.md`
- **Test Guide**: `__tests__/CONTINUOUS-LOOP-TESTS.md`

## 🔧 Troubleshooting

### Dashboard Not Loading

**Check:**
```bash
# Is port 3030 available?
netstat -ano | findstr :3030

# Try different port
# Edit .claude/continuous-loop-config.json
"dashboard": { "port": 3031 }
```

### Too Many False Positives

Human review triggering too often?

```json
"humanInLoop": {
  "confidenceThreshold": 0.80  // Increase from 0.70
}
```

System will learn and adapt over time!

### Compaction Still Occurring

```json
"contextMonitoring": {
  "checkpointThreshold": 0.60,  // Reduce from 0.75
  "bufferTokens": 20000          // Increase from 10000
}
```

## 🎓 Learning Curve

**Sessions 1-10**: Building patterns, conservative (many stops)
**Sessions 11-30**: Refining patterns, improving precision
**Sessions 31+**: Optimized, high precision (>85%), high recall (>90%)

**Give it time to learn your project!**

## 🆘 Getting Help

1. Check documentation in `docs/` folder
2. Run the demo to see expected behavior
3. Review test examples in `__tests__/`
4. Check dashboard for real-time diagnostics

---

**Ready to start?**

```bash
node start-continuous-loop.js
```

Then open http://localhost:3030 in your browser! 🚀
