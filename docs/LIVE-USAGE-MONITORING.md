# Live Usage Monitoring Guide

## Overview

The live usage monitor provides real-time tracking of token usage, costs, and orchestration activity in your CLI.

## Quick Start

```bash
# Start the live monitor
npm run monitor

# Or with custom refresh interval (milliseconds)
node scripts/usage-monitor.js 1000  # Refresh every 1 second
```

## What You'll See

The monitor displays:

### 📊 Session Statistics
- **Duration**: How long the current session has been running
- **Orchestration Count**: Number of orchestrations completed
- **Token Usage**: Real-time token consumption breakdown
  - Total tokens used
  - Input vs output tokens
  - Cache tokens (creation + reads)

### 💰 Cost Analysis
- **Total Cost**: Cumulative cost for the session
- **Cache Savings**: Money saved through prompt caching
- **Net Cost**: Actual cost after savings

### 🎯 Model Breakdown
- Per-model token usage
- Per-model costs
- Shows which models are being used most

### 📊 Budget Status (if configured)
- **Daily Budget**: Current usage vs limit
- **Monthly Budget**: Current usage vs limit with projection
- **Status Indicators**:
  - ✅ OK - Under 80% of budget
  - ⚠️  WARNING - 80-100% of budget
  - ⚠️  EXCEEDED - Over budget

### 📝 Recent Orchestrations
- Last 5 orchestrations with timestamps
- Model used, tokens consumed, and cost
- Pattern type (if available)

## Configuration

### Set Budget Limits

You can set budget limits via environment variables:

```bash
# Set daily budget to $10
export DAILY_BUDGET_USD=10

# Set monthly budget to $500
export MONTHLY_BUDGET_USD=500

# Run monitor with budgets
npm run monitor
```

Or configure in your orchestration code:

```javascript
const usageTracker = new UsageTracker(memoryStore, {
  enableBudgetAlerts: true,
  dailyBudgetUSD: 10.00,
  monthlyBudgetUSD: 500.00,
  dailyWarningThreshold: 0.8,   // Warn at 80%
  monthlyWarningThreshold: 0.8
});
```

### Customize Refresh Rate

Default refresh is 2 seconds. You can change it:

```bash
# Refresh every 5 seconds
npm run monitor 5000

# Refresh every 1 second (faster)
npm run monitor 1000

# Refresh every 10 seconds (slower, less CPU)
npm run monitor 10000
```

## Use Cases

### 1. Development Monitoring

Keep the monitor running in a separate terminal while developing:

```bash
# Terminal 1: Run your orchestrations
npm run demo

# Terminal 2: Monitor usage
npm run monitor
```

### 2. Budget Tracking

Monitor spending during long-running processes:

```bash
export DAILY_BUDGET_USD=50
npm run monitor
```

The monitor will show warnings when you approach budget limits.

### 3. Performance Analysis

Watch token usage patterns to optimize your prompts:

- High cache tokens? Your caching is working well! ✅
- Low cache savings? Consider optimizing for prompt caching
- High input tokens? Your context might be too large

### 4. Cost Optimization

Compare costs across different models in real-time:

- See which models are most cost-effective
- Identify expensive patterns
- Track savings from cache usage

## Example Output

```
📊 LIVE SESSION MONITOR

════════════════════════════════════════════════════════════

Session Duration: 5m 32s
Orchestrations: 12

Token Usage:
  Total Tokens:    45,234
  Input Tokens:    30,156
  Output Tokens:   15,078
  Cache Tokens:    125,000

Cost Analysis:
  Total Cost:      $0.2345
  Cache Savings:   $0.3120
  Net Cost:        $-0.0775

Model Breakdown:
  claude-sonnet-4.5:
    Tokens: 30,234
    Cost:   $0.1234
  gpt-4o:
    Tokens: 15,000
    Cost:   $0.1111

Budget Status:
  Daily:
    Used:       $0.2345
    Limit:      $10.0000
    Remaining:  $9.7655
    Status:     ✅ OK
  Monthly:
    Used:       $12.3456
    Limit:      $500.0000
    Remaining:  $487.6544
    Projection: $370.3680
    Status:     ✅ OK

════════════════════════════════════════════════════════════
Last updated: 5:32:15 PM
Press Ctrl+C to exit

📝 Recent Orchestrations:

1. [5:32:10 PM] parallel
   Model: claude-sonnet-4.5
   Tokens: 3,456 | Cost: $0.0234

2. [5:31:45 PM] sequential
   Model: claude-sonnet-4.5
   Tokens: 4,123 | Cost: $0.0289

...
```

## Tips & Tricks

### 1. Multi-Monitor Setup

Run multiple monitors for different aspects:

```bash
# Monitor 1: Overall usage
npm run monitor

# Monitor 2: Detailed reports
npm run usage
```

### 2. Background Monitoring

Run the monitor in the background and check periodically:

```bash
# Start in background (Linux/Mac)
npm run monitor > usage.log 2>&1 &

# View logs
tail -f usage.log
```

### 3. Alert on Budget Exceeded

Combine with system notifications:

```bash
# Monitor and alert (requires notification tools)
npm run monitor | grep "EXCEEDED" && notify-send "Budget Exceeded!"
```

### 4. Export Session Data

The monitor tracks session data. Export it:

```bash
# After monitoring, generate a report
npm run usage

# Export to file
npm run usage > session-report.json
```

## Keyboard Controls

- **Ctrl+C**: Stop monitoring and exit gracefully
- Monitor updates automatically, no interaction needed

## Troubleshooting

### "No database found"

```bash
Error: No database found at .claude/memory/orchestrations.db
Run some orchestrations first to generate usage data.
```

**Solution**: Run at least one orchestration to create the database:

```bash
npm run demo
```

### Monitor shows $0.00

The database exists but has no usage records yet. Run some orchestrations:

```bash
npm run demo
# or
node examples/your-workflow.js
```

### High CPU usage

The default 2-second refresh might be too fast. Slow it down:

```bash
npm run monitor 5000  # Refresh every 5 seconds
```

## Integration with CI/CD

You can use the monitor in automated pipelines:

```bash
#!/bin/bash
# Run tests with budget monitoring

# Set budget
export DAILY_BUDGET_USD=5

# Start monitor in background
npm run monitor > monitor.log 2>&1 &
MONITOR_PID=$!

# Run tests
npm test

# Stop monitor
kill $MONITOR_PID

# Check if budget was exceeded
if grep -q "EXCEEDED" monitor.log; then
  echo "ERROR: Budget exceeded during tests!"
  exit 1
fi
```

## API Usage

You can also use the monitor programmatically:

```javascript
const startMonitoring = require('./scripts/usage-monitor');

// Start monitoring with 3-second refresh
startMonitoring(3000);
```

## See Also

- [Usage Analytics Architecture](./USAGE-ANALYTICS-ARCHITECTURE.md)
- [Usage Tracker Specification](./USAGE-TRACKER-SPECIFICATION.md)
- [Cost Optimization Guide](./COST-OPTIMIZATION.md) (if available)
