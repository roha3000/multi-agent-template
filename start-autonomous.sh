#!/bin/bash
# ============================================================================
# Autonomous Multi-Agent Loop Launcher
# ============================================================================
#
# Starts the complete autonomous execution system:
# 1. Dashboard for monitoring
# 2. Autonomous orchestrator with quality gates
#
# Usage:
#   ./start-autonomous.sh                     # Start with default task
#   ./start-autonomous.sh "Your task here"   # Start with custom task
#   ./start-autonomous.sh --phase research   # Start at specific phase
#
# ============================================================================

set -e

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Default values
TASK=""
PHASE="research"
THRESHOLD=65
MAX_SESSIONS=0

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --phase)
            PHASE="$2"
            shift 2
            ;;
        --threshold)
            THRESHOLD="$2"
            shift 2
            ;;
        --max-sessions)
            MAX_SESSIONS="$2"
            shift 2
            ;;
        --help|-h)
            echo ""
            echo "Autonomous Multi-Agent Loop Launcher"
            echo ""
            echo "Usage:"
            echo "  ./start-autonomous.sh [options] [task]"
            echo ""
            echo "Options:"
            echo "  --phase <phase>        Starting phase (research, design, implement, test)"
            echo "  --threshold <percent>  Context threshold for session cycling (default: 65)"
            echo "  --max-sessions <n>     Maximum sessions to run (default: unlimited)"
            echo "  --help                 Show this help"
            echo ""
            echo "Examples:"
            echo "  ./start-autonomous.sh \"Build a REST API for user management\""
            echo "  ./start-autonomous.sh --phase design \"Implement authentication\""
            echo "  ./start-autonomous.sh --threshold 60 --max-sessions 10"
            echo ""
            exit 0
            ;;
        *)
            TASK="$1"
            shift
            ;;
    esac
done

echo ""
echo "============================================================================"
echo " AUTONOMOUS MULTI-AGENT EXECUTION SYSTEM"
echo "============================================================================"
echo ""
echo " Starting autonomous execution with:"
echo "   Phase: $PHASE"
echo "   Threshold: ${THRESHOLD}%"
echo "   Max Sessions: $MAX_SESSIONS (0 = unlimited)"
[ -n "$TASK" ] && echo "   Task: $TASK"
echo ""
echo "============================================================================"
echo ""

# Check if dashboard is already running
if lsof -i :3033 > /dev/null 2>&1; then
    echo "[OK] Dashboard already running on port 3033"
else
    echo "[STARTING] Dashboard on port 3033..."
    node global-context-manager.js &
    DASHBOARD_PID=$!
    sleep 2
fi

# Open dashboard in browser
echo "[OPENING] Dashboard in browser..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    open http://localhost:3033/global-dashboard.html
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    xdg-open http://localhost:3033/global-dashboard.html 2>/dev/null || true
fi

# Wait for dashboard to be ready
echo "[WAITING] For dashboard to initialize..."
sleep 3

# Build the orchestrator command
CMD="node autonomous-orchestrator.js --phase $PHASE --threshold $THRESHOLD"
[ "$MAX_SESSIONS" != "0" ] && CMD="$CMD --max-sessions $MAX_SESSIONS"
[ -n "$TASK" ] && CMD="$CMD --task \"$TASK\""

echo ""
echo "[LAUNCHING] Autonomous orchestrator..."
echo "Command: $CMD"
echo ""
echo "============================================================================"
echo " Claude will now run autonomously with quality gates."
echo " Press Ctrl+C to stop the orchestrator."
echo "============================================================================"
echo ""

# Run the orchestrator
eval $CMD

# Cleanup
if [ -n "$DASHBOARD_PID" ]; then
    kill $DASHBOARD_PID 2>/dev/null || true
fi
