# Current Plan - Continuous Loop Orchestrator

**Last Updated**: 2025-12-17 (Session 12)
**Current Phase**: Implementation
**Status**: Building continuous loop system
**Priority**: HIGH - Core feature for automated long-running tasks

---

## SESSION 12: Continuous Loop Implementation Plan

### Goal
Build an external orchestrator that automatically cycles Claude CLI sessions when context threshold is reached, enabling unlimited-length automated tasks.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              continuous-loop.js (Orchestrator)              │
├─────────────────────────────────────────────────────────────┤
│  1. Spawn: claude "Run /session-init and continue task"     │
│  2. Monitor: Listen to dashboard SSE for context alerts     │
│  3. At 70%: Send SIGTERM, wait for graceful exit            │
│  4. Loop: Start new session (dev-docs already has state)    │
└─────────────────────────────────────────────────────────────┘
          │                              ▲
          │ stdio: inherit               │ SSE alerts
          ▼                              │
┌─────────────────────┐    ┌─────────────────────────────────┐
│   Claude CLI        │    │  Dashboard (localhost:3033)     │
│   (visible output)  │    │  - Context % monitoring         │
│                     │    │  - Session series tracking      │
└─────────────────────┘    └─────────────────────────────────┘
```

### Implementation Steps

#### Step 1: Build Orchestrator (`continuous-loop.js`)
- Spawn Claude CLI with `stdio: 'inherit'` for visibility
- Connect to dashboard SSE at `localhost:3033/events`
- Listen for threshold alerts (≤30% remaining = 70% used)
- Graceful termination with SIGTERM
- Auto-restart loop with configurable delay

#### Step 2: Add Session Series Tracking
- Track session count in current series
- Accumulate total tokens/cost across sessions
- Record exit reasons (threshold/complete/error)
- Display in dashboard UI

#### Step 3: Add NPM Scripts
- `npm run loop` - Start continuous loop
- `npm run loop:start` - Same as above
- Update package.json

#### Step 4: Test the System
- Verify session spawns with visible output
- Verify threshold detection triggers termination
- Verify new session picks up state via /session-init
- Verify dashboard shows session series

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `continuous-loop.js` | CREATE | Main orchestrator |
| `global-context-manager.js` | MODIFY | Add session series tracking |
| `global-dashboard.html` | MODIFY | Display session series |
| `package.json` | MODIFY | Add npm scripts |

### Success Criteria
- [ ] Claude output visible in terminal during execution
- [ ] Automatic session cycling at 70% context
- [ ] New session loads state via /session-init
- [ ] Dashboard shows session series (session 1, 2, 3...)
- [ ] Total cost/tokens tracked across series

---

## PREVIOUS: SESSION 11 REFINEMENTS - ACCURACY IMPROVEMENTS

Refined the context calculation and dashboard display for better accuracy.

### Changes Made

1. **System Overhead Calibration**
   - Adjusted from 45k to 38k tokens based on `/context` validation
   - Now matches `/context` output within ~2%

2. **Dashboard Display Updates**
   - Shows "context remaining" (100% - used%) as main metric
   - Shows "X tokens until auto-compact" (remaining - 45k buffer)
   - Updated threshold markers on progress bar

3. **Threshold Adjustments**
   - ≤25% remaining = EMERGENCY
   - ≤35% remaining = CRITICAL
   - ≤50% remaining = WARNING
   - >50% remaining = OK

### Key Understanding

- `/context` "Free space" = usable space before auto-compact triggers
- Autocompact buffer (45k/22.5%) is reserved and never usable
- Auto-compact triggers when "Free space" reaches 0%

---

## SESSION 10 ACHIEVEMENT - GLOBAL CONTEXT MONITOR

Built a real-time context monitoring dashboard that tracks ALL active Claude Code sessions across all projects.

### What Was Built

1. **Global Context Tracker** (`.claude/core/global-context-tracker.js`)
   - Watches all projects in `~/.claude/projects/`
   - Real-time JSONL file monitoring with chokidar
   - Windows-compatible polling for reliability
   - Automatic session detection (active within 5 min)
   - Cost estimation per session

2. **Global Context Manager** (`global-context-manager.js`)
   - Express server on port 3033
   - SSE real-time updates to dashboard
   - REST API for project/account data
   - Alert event emission

3. **Simplified Dashboard** (`global-dashboard.html`)
   - Shows **context remaining** (not used) - more actionable
   - Big percentage display with token count
   - Progress bar with threshold markers (50%, 65%, 75%)
   - Audio alerts and browser notifications
   - Copy buttons for /clear and /session-init
   - Inactive projects collapsed at bottom

### Key Fixes Applied

1. **Token Calculation** - Fixed to use LATEST API response, not cumulative sum
   - Context = `input_tokens + cache_read + cache_creation + output_tokens`
   - Added 20k system overhead (prompts, tools, memory)

2. **Windows File Watching** - Fixed unreliable glob patterns
   - Now watches each project directory explicitly
   - Uses polling on Windows for reliability

3. **Threshold Adjustment** - Aligned with auto-compact at ~77.5%
   - 50% Warning
   - 65% Critical
   - 75% Emergency (before 77.5% auto-compact)

---

## How to Use

### Start the Monitor
```bash
npm run monitor:global
# Opens dashboard + starts server on port 3033
```

### Or manually:
```bash
node global-context-manager.js
# Then open http://localhost:3033/global-dashboard.html
```

### Dashboard Features
- Real-time updates every 500ms
- Sound alerts at threshold crossings
- Browser notifications (requires permission)
- Copy /clear command with one click

---

## Files Created/Modified

| File | Purpose |
|------|---------|
| `.claude/core/global-context-tracker.js` | Multi-project JSONL watcher |
| `global-context-manager.js` | Express server + SSE |
| `global-dashboard.html` | Simplified UI (context remaining focus) |
| `package.json` | Added npm scripts |

---

## Known Limitations

1. **~10% accuracy variance** - JSONL doesn't capture exact system tokens
2. **5-minute active window** - Sessions go inactive after 5 min of no API calls
3. **Polling overhead** - Windows uses 500ms polling (slight CPU usage)

---

## Next Steps (Optional)

- [ ] Add historical context trends
- [ ] Integrate with notification services (Slack, Discord)
- [ ] Add cost projections based on velocity
- [ ] Create system tray app for always-on monitoring

---

**Status**: COMPLETE - Dashboard is operational at http://localhost:3033
