# Recovery Instructions - Post Context Clear

## Timestamp: 2025-12-14T22:46:00.263Z

## Current State
- Context was at 92% when checkpoint triggered
- Production telemetry system is running
- Dashboard at http://localhost:3000
- Continuous loop monitor at http://localhost:3030

## To Resume Work:
1. Read PROJECT_SUMMARY.md for project context
2. Read EMERGENCY_CHECKPOINT.md for session state
3. Check dashboard at http://localhost:3000
4. Resume from latest checkpoint in .claude/checkpoints/

## Active Systems:
- Telemetry Server: http://localhost:9464
- Dashboard: http://localhost:3000
- WebSocket: ws://localhost:3001
- Continuous Loop: http://localhost:3030

## Critical Issue to Fix:
The continuous loop is not properly detecting context usage.
It should have triggered checkpoint at 75% but didn't.
Need to fix context detection mechanism.

## Commands to Resume:
```bash
# Check running processes
tasklist | findstr node

# View dashboard
start http://localhost:3000

# Check continuous loop
start http://localhost:3030
```
