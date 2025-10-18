#!/bin/bash
# switch-model.sh - Model switching automation
PHASE=$1
case $PHASE in
  "research"|"planning"|"design"|"validation"|"iteration")
    export CLAUDE_MODEL="claude-sonnet-4.5"
    echo "Switched to Claude Opus for $PHASE phase"
    ;;
  "testing"|"implementation"|"debug")
    export CLAUDE_MODEL="claude-sonnet-4-20250514"
    echo "Switched to Claude Sonnet for $PHASE phase"
    ;;
  *)
    echo "Usage: $0 {research|planning|design|testing|implementation|debug|validation|iteration}"
    exit 1
    ;;
esac
claude --model $CLAUDE_MODEL