# CRITICAL DISCOVERY: No Real-Time Context API Available

## The Fatal Flaw

After the auto-compact failure at 97% context, we've discovered a fundamental limitation:

**Claude Code does NOT expose a real-time API for context usage tracking.**

## What This Means

### The Problem
- We cannot access Claude's actual context percentage from JavaScript
- All our monitoring shows fake data (Math.random() simulations)
- Checkpoints trigger on fake thresholds, not real usage
- The entire monitoring system is watching imaginary metrics

### Evidence Found
1. **context-manager.js**: Uses `Math.min(95, 15 + (tokenIncrement / 2000))`
2. **dashboard-backend.js**: Simulates with `Math.random() * 100`
3. **production/telemetry-server.js**: Generates fake trends
4. **No environment variables** for real context access
5. **No OTLP metrics** coming from Claude Code itself

## Why This Happened

We built an elaborate monitoring system assuming we could access real context data. But:
- Claude's context is internal to the application
- No JavaScript API exposes this information
- No telemetry is sent from Claude Code to our OTLP receiver
- We've been monitoring our own simulations

## The Harsh Reality

While the dashboard showed 60% usage, your real context hit 97% and triggered auto-compact. The monitoring system provided **zero value** because it never had access to real data.

## Alternative Solutions

### 1. Time-Based Checkpoints
Instead of context percentage, save state every N minutes:
```javascript
setInterval(() => {
  saveCheckpoint();
}, 15 * 60 * 1000); // Every 15 minutes
```

### 2. Manual Context Input
Let users tell us the context percentage:
```javascript
// Dashboard with manual input
<input type="number" id="contextPercentage" placeholder="Enter context %" />
<button onclick="updateRealContext()">Update</button>
```

### 3. Token Counting (Approximate)
Count tokens in messages, but this is still a guess:
```javascript
const estimatedTokens = message.length / 4; // Rough approximation
const estimatedContext = (totalTokens / 200000) * 100;
```

### 4. File-Based State Management
Use the efficient dev-docs pattern more frequently:
- Save state to PROJECT_SUMMARY.md regularly
- Keep plan.md and tasks.md updated
- Reload from these files after context issues

## Lessons Learned

1. **Verify data sources first** - We should have confirmed API availability
2. **Test with real conditions** - Simulated data masked the real problem
3. **Simple solutions often work** - Time-based saves would have prevented this
4. **Don't build on assumptions** - We assumed an API existed that doesn't

## Immediate Actions Required

1. **Remove all fake data displays** - Stop showing misleading percentages
2. **Implement time-based saves** - Every 10-15 minutes
3. **Add manual checkpoint button** - Let users trigger saves
4. **Update documentation** - Warn about this limitation
5. **Simplify the system** - Remove complex monitoring that can't work

## The Path Forward

We need to pivot from context-percentage-based monitoring to:
- Time-based automatic saves
- Manual checkpoint triggers
- Better use of the dev-docs pattern
- Clear communication about what we CAN'T monitor

This is a fundamental architectural limitation, not a bug we can fix.