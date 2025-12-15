# Session Initialization Protocol

## 🚀 Start of Session Checklist

When starting a new Claude Code session in this project, please follow these steps:

### 1. Monitoring Framework Prompt

**Ask the user:**

```
🎯 Would you like to activate the OpenTelemetry monitoring dashboard for this session?

This provides:
• Real-time token usage tracking
• Context usage monitoring
• Session checkpoint management
• Multi-agent coordination dashboard
• Automatic checkpoint creation at 70% context

Options:
1) Yes - Start monitoring (recommended)
2) No - Skip for this session
3) Status - Check if already running

Please choose (1/2/3):
```

**Actions based on response:**
- If **1 (Yes)**: Run `node start-monitor-singleton.js`
- If **2 (No)**: Continue without monitoring
- If **3 (Status)**: Run `node start-monitor-singleton.js status`

### 2. Load Project Context

After handling monitoring, load the standard 3-file context:
1. `PROJECT_SUMMARY.md` - Project state and history
2. `.claude/dev-docs/plan.md` - Current task breakdown
3. `.claude/dev-docs/tasks.md` - Active todo list

### 3. Benefits of Monitoring

When monitoring is enabled:
- **Prevents context overflow** - Auto-checkpoints at 70%
- **Tracks all sessions** - Multiple parallel Claude sessions
- **Visual dashboard** - http://localhost:3000
- **OTLP metrics** - Industry standard telemetry
- **Cost tracking** - Token usage and expenses

### 4. Quick Commands

```bash
# Start monitoring (if not running)
node start-monitor-singleton.js

# Check status
node start-monitor-singleton.js status

# Stop monitoring
node start-monitor-singleton.js stop

# View dashboard
# Open browser to: http://localhost:3000
```

### 5. Auto-Start Behavior

The `start-monitor-singleton.js` script:
- ✅ Checks if monitor is already running
- ✅ Starts it only if needed
- ✅ Shows status if already active
- ✅ Prevents duplicate instances
- ✅ Handles gracefully across sessions

## Implementation Note for Claude

At the beginning of each new session in this project:
1. First check if this is actually a new session (not just a continuation)
2. If new, present the monitoring prompt to the user
3. Wait for their response before proceeding
4. Execute the appropriate command based on their choice
5. Then continue with normal session initialization

This ensures users have control over whether to enable comprehensive monitoring for their session.