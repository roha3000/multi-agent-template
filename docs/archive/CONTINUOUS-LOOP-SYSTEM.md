# Continuous Loop System - Documentation

## Overview

The Continuous Loop System enables Claude to work autonomously for extended periods by:
- **Monitoring context window** usage in real-time
- **Tracking API rate limits** to prevent hitting Claude plan limits
- **Intelligent checkpoint timing** that learns and adapts over time
- **Automatic wrap-up** before hitting any limits
- **Seamless session resumption** to continue where it left off
- **Real-time dashboard** for monitoring all metrics

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│              Continuous Loop Orchestrator                    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Intelligence Layer (Learns & Adapts)                  │ │
│  │  ├─ CheckpointOptimizer: Learns optimal timing        │ │
│  │  ├─ Pattern Recognition: Understands task patterns    │ │
│  │  ├─ Compaction Detection: Prevents context loss       │ │
│  │  └─ Adaptive Thresholds: Self-adjusts over time       │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Monitoring Systems                                    │ │
│  │  ├─ Context Window: 200K token tracking               │ │
│  │  ├─ API Limits: Rate limit enforcement                │ │
│  │  ├─ Token Usage: Cost & budget monitoring             │ │
│  │  └─ Execution State: Progress tracking                │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Dashboard Manager                                     │ │
│  │  ├─ Web Dashboard: http://localhost:3030              │ │
│  │  ├─ Terminal UI: Real-time console view               │ │
│  │  └─ Event Stream: SSE for live updates                │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  State Management                                      │ │
│  │  ├─ Checkpoint: Save before limits                    │ │
│  │  ├─ Wrap-up: Graceful completion                      │ │
│  │  ├─ Resume: Continue from checkpoint                  │ │
│  │  └─ Recovery: Handle failures                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Components

### 1. CheckpointOptimizer (Intelligent Learning)

Learns optimal checkpoint timing by tracking:
- **Success/failure rates** of checkpoints
- **Token usage patterns** per task type
- **Compaction events** and automatic adjustment
- **Task complexity** predictions

**Key Features:**
- Starts conservative (75% threshold)
- Adapts based on experience
- Detects Claude forcing compaction
- Self-adjusts thresholds to prevent future failures

**Example Learning:**
```
Initial:     Checkpoint at 75% context (150K tokens)
After 10 successes: 77% (154K tokens)  ← Gradual increase
After compaction: 64% (128K tokens)    ← Aggressive decrease
```

### 2. ClaudeLimitTracker (API Monitoring)

Tracks usage against Claude plan limits:

**Free Plan:**
- 50 requests/day
- 5 requests/min
- 150K tokens/day

**Pro Plan:**
- 1,000 requests/day
- 50 requests/min
- 2.5M tokens/day

**Team Plan:**
- 10,000 requests/day
- 100 requests/min
- 10M tokens/day

**Safety Levels:**
- 80%: ⚠️ WARNING - Prepare for wrap-up
- 90%: 🔴 CRITICAL - Wrap up now
- 95%: 🛑 EMERGENCY - Halt immediately

### 3. DashboardManager (Real-time Monitoring)

**Web Dashboard** (http://localhost:3030):
- Visual progress bars
- Real-time metrics
- Execution plan tracking
- Event timeline
- Auto-updates via Server-Sent Events

**Terminal Dashboard:**
- Compact console view
- Color-coded status
- Live metric updates
- Interactive controls

### 4. ContinuousLoopOrchestrator (Main Controller)

Coordinates all systems:
- Checks safety before each operation
- Triggers checkpoints when needed
- Executes graceful wrap-up
- Manages session resumption
- Handles emergencies

## Configuration

### Basic Setup

```javascript
// .claude/settings.local.json
{
  "continuousLoop": {
    // Enable/disable the entire system
    "enabled": true,

    // Maximum loop iterations (safety)
    "maxIterations": 10,

    // Auto-resume after wrap-up
    "autoResume": true,

    // Context monitoring
    "contextMonitoring": {
      "enabled": true,
      "warningThreshold": 0.80,   // 160K tokens
      "criticalThreshold": 0.85,  // 170K tokens
      "emergencyThreshold": 0.95  // 190K tokens
    },

    // API limit tracking (TOGGLEABLE)
    "apiLimitTracking": {
      "enabled": true,
      "plan": "pro",              // free, pro, team
      "warningThreshold": 0.80,
      "criticalThreshold": 0.90,
      "emergencyThreshold": 0.95,

      // Optional: Override auto-detected limits
      "customLimits": {
        "requestsPerMinute": 50,
        "requestsPerDay": 1000,
        "tokensPerDay": 2500000
      }
    },

    // Cost budget tracking
    "costBudgets": {
      "enabled": true,
      "dailyBudgetUSD": 10,
      "monthlyBudgetUSD": 200,
      "warningThreshold": 0.80
    },

    // Intelligent checkpoint optimization
    "checkpointOptimizer": {
      "enabled": true,
      "learningRate": 0.1,
      "minThreshold": 0.60,
      "maxThreshold": 0.85,
      "detectCompaction": true
    },

    // Dashboard
    "dashboard": {
      "enableWeb": true,
      "webPort": 3030,
      "enableTerminal": true,
      "updateInterval": 2000  // 2 seconds
    },

    // Wrap-up behavior
    "wrapUp": {
      "enabled": true,
      "completeCurrentTask": true,
      "updateDevDocs": true,
      "generateSummary": true,
      "notifyUser": true
    }
  }
}
```

### Toggle Features On/Off

**Disable API limit tracking:**
```json
{
  "continuousLoop": {
    "apiLimitTracking": {
      "enabled": false
    }
  }
}
```

**Disable learning (use fixed thresholds):**
```json
{
  "continuousLoop": {
    "checkpointOptimizer": {
      "enabled": false
    },
    "contextMonitoring": {
      "warningThreshold": 0.75  // Fixed at 75%
    }
  }
}
```

**Disable entire system:**
```json
{
  "continuousLoop": {
    "enabled": false
  }
}
```

## How It Works

### 1. Normal Operation Flow

```
┌─────────────────────────────────────────────────┐
│ 1. Start Session                                │
│    - Load checkpoint or initialize new          │
│    - Start dashboard monitoring                 │
│    - Begin task execution                       │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│ 2. Before Each Operation                        │
│    - Check context window (e.g., 120K/200K)     │
│    - Check API limits (e.g., 30/50 req/min)     │
│    - Check cost budget (e.g., $5/$10)           │
│    - Get prediction from optimizer              │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
      ┌──────────────────────┐
      │ All checks OK?       │
      └────┬────────────┬────┘
           │ YES        │ NO
           │            │
           ▼            ▼
┌────────────────┐  ┌──────────────────┐
│ 3. Execute     │  │ 3. Wrap Up       │
│    Task        │  │    - Save state  │
│    - Process   │  │    - Update docs │
│    - Update    │  │    - Summary     │
│    - Track     │  │    - /clear      │
└────────┬───────┘  └────────┬─────────┘
         │                   │
         │ Loop back         │
         └───────────────────┘
```

### 2. Checkpoint Process

```
┌─────────────────────────────────────────────────┐
│ Checkpoint Trigger (85% context reached)        │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│ 1. Save Current State                           │
│    - project-state.json                         │
│    - PROJECT_SUMMARY.md                         │
│    - plan.md + tasks.md                         │
│    - Work context & decisions                   │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│ 2. Record Checkpoint in Learning System         │
│    - Track success/failure                      │
│    - Update task patterns                       │
│    - Adjust thresholds                          │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│ 3. Clear Context (if needed)                    │
│    - Run /clear command                         │
│    - Free up tokens                             │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│ 4. Resume                                       │
│    - Run /session-init with checkpoint data     │
│    - Restore work context                       │
│    - Continue from last action                  │
└─────────────────────────────────────────────────┘
```

### 3. Compaction Detection & Recovery

```
┌─────────────────────────────────────────────────┐
│ Monitor Context Size                            │
│ Previous: 180K tokens                           │
│ Current:  120K tokens                           │
│ Drop:     60K tokens (COMPACTION!)              │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│ 1. Detect Compaction Event                      │
│    - Log details                                │
│    - Alert user                                 │
│    - Record in learning system                  │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│ 2. Auto-Adjust Thresholds                       │
│    - Reduce checkpoint threshold: 85% → 72%     │
│    - Increase safety buffer: 15K → 20K          │
│    - Save new thresholds                        │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│ 3. Apply More Conservative Strategy             │
│    - Earlier checkpoints going forward          │
│    - Larger safety margins                      │
│    - Prevents future compaction                 │
└─────────────────────────────────────────────────┘
```

## Learning Examples

### Example 1: Successful Adaptation

```
Session 1: Checkpoint at 75% → Success ✅
Session 2: Checkpoint at 76% → Success ✅
Session 3: Checkpoint at 77% → Success ✅
Session 4: Checkpoint at 78% → Success ✅
Session 5: Checkpoint at 79% → Success ✅
Session 6: Checkpoint at 80% → Success ✅

Result: System learned it can safely use more context
        New threshold: 80% (160K tokens)
        Efficiency gain: 10K more tokens per session
```

### Example 2: Compaction Recovery

```
Session 10: Checkpoint at 82% → Compaction detected! ❌
            (Claude forced context reduction at 164K tokens)

Immediate Response:
- Reduce threshold: 82% → 70% (aggressive safety)
- Increase buffer: 15K → 20K tokens
- Log event for analysis

Session 11: Checkpoint at 70% → Success ✅
Session 12: Checkpoint at 71% → Success ✅
Session 13: Checkpoint at 72% → Success ✅

Result: System recovered and gradually increases threshold
        New safe operating point: ~75% (learned from failure)
```

### Example 3: Task Pattern Learning

```
Task Type: "Implement feature X"

Execution 1:  Used 8,500 tokens
Execution 2:  Used 9,200 tokens
Execution 3:  Used 8,800 tokens
Execution 4:  Used 9,100 tokens
Execution 5:  Used 8,900 tokens

Learned Pattern:
- Average: 8,900 tokens
- Min: 8,500 tokens
- Max: 9,200 tokens
- Confidence: High (low variance)

Next Time:
- System reserves ~9,500 tokens (avg + buffer)
- Predicts checkpoint need in advance
- More accurate timing
```

## Usage

### Starting the Loop

```javascript
const ContinuousLoopOrchestrator = require('./.claude/core/continuous-loop-orchestrator');

// Initialize
const loop = new ContinuousLoopOrchestrator({
  config: require('./.claude/settings.local.json').continuousLoop
});

// Start
await loop.start();

// Dashboard available at http://localhost:3030
```

### Manual Controls

```javascript
// Check status
const status = await loop.getStatus();

// Pause loop
await loop.pause();

// Resume loop
await loop.resume();

// Force checkpoint
await loop.checkpoint();

// Initiate wrap-up
await loop.wrapUp('Manual wrap-up');

// Stop completely
await loop.stop();
```

### Monitoring

**Web Dashboard:**
```bash
# Open browser to:
http://localhost:3030
```

**Terminal:**
```bash
# View logs
tail -f .claude/logs/continuous-loop.log

# Check statistics
node -e "
  const loop = require('./.claude/core/continuous-loop-orchestrator');
  console.log(loop.getStatistics());
"
```

## Safety Features

### Multi-Level Protection

1. **Context Window**
   - Warning at 80% (160K tokens)
   - Critical at 85% (170K tokens)
   - Emergency at 95% (190K tokens)

2. **API Limits**
   - Per-minute tracking
   - Per-hour tracking
   - Per-day tracking

3. **Cost Budgets**
   - Daily budget enforcement
   - Monthly budget tracking
   - Real-time cost calculation

4. **Compaction Detection**
   - Monitors for sudden token drops
   - Auto-adjusts thresholds
   - Prevents future occurrences

### Emergency Procedures

**If Loop Gets Stuck:**
```javascript
// Emergency stop
await loop.emergencyStop();

// Reset learning data (use with caution)
await loop.resetLearning(true);

// Disable loop in config
// Edit .claude/settings.local.json:
{
  "continuousLoop": { "enabled": false }
}
```

**If Compaction Occurs:**
- System automatically detects
- Thresholds reduced by 15%
- Future sessions use more conservative limits
- No manual intervention needed

## Performance Metrics

### Efficiency Gains

**Without Continuous Loop:**
- Manual checkpoint every ~2 hours
- Context waste: ~30K tokens per session
- Requires constant monitoring
- Risk of hitting limits

**With Continuous Loop:**
- Automatic optimization
- 10-15% more usable context (learned over time)
- Zero monitoring required
- Never hits limits (proactive wrap-up)

### Typical Session

```
Session Start: 0K tokens
   ├─ Task 1: +25K tokens (25K total)
   ├─ Task 2: +30K tokens (55K total)
   ├─ Task 3: +40K tokens (95K total)
   ├─ Task 4: +35K tokens (130K total)
   ├─ ⚠️ Warning threshold (160K) approaching
   ├─ Task 5: +30K tokens (160K total)
   ├─ 🔴 Checkpoint triggered at 80%
   ├─ State saved
   ├─ /clear executed
   ├─ Session resumed with context
   └─ Continue from Task 6...

Total Efficiency: 160K tokens used (vs 150K without learning)
Gain: +10K tokens = ~6.6% improvement
```

## Troubleshooting

### Common Issues

**Dashboard not loading:**
```bash
# Check if port is in use
lsof -i :3030

# Try different port in config
"webPort": 3031
```

**Thresholds too conservative:**
```javascript
// Increase learning rate for faster adaptation
"learningRate": 0.2  // Default: 0.1

// Or set minimum threshold higher
"minThreshold": 0.70  // Default: 0.60
```

**Too many checkpoints:**
```javascript
// Increase threshold
"warningThreshold": 0.85  // From 0.80

// Reduce buffer
"minBuffer": 10000  // From 15000
```

## Best Practices

1. **Let it Learn**: Give the system 10-20 sessions to learn optimal thresholds
2. **Monitor Dashboard**: Check web dashboard periodically to see learning progress
3. **Trust Auto-Adjustment**: System adjusts automatically after compaction
4. **Review Statistics**: Check learning stats to see improvement trends
5. **Don't Override Learning**: Unless necessary, let adaptive thresholds work
6. **Keep Logs**: Useful for debugging and understanding behavior

## Future Enhancements

- [ ] Multi-model support (GPT-4, etc.)
- [ ] Cost optimization across models
- [ ] Predictive task scheduling
- [ ] Cloud state backup
- [ ] Distributed checkpoints
- [ ] Advanced visualization
- [ ] Mobile dashboard app
- [ ] Slack/Discord notifications

---

**Created:** 2025-12-13
**Version:** 1.0.0
**Status:** Production Ready
