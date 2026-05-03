# Multi-Agent Template Plugin Manifest

This directory packages the framework as an installable Claude Code plugin.

## What this plugin ships
- **Agents** — 35 specialist personas in `.claude/agents/` (research, planning, design, dev, testing, validation, audit, iteration)
- **Commands / skills** — 20+ slash commands in `.claude/commands/` covering all phases plus utilities
- **Hooks** — `SessionStart`, `SessionEnd`, `PostToolUse`, and `UserPromptSubmit` (auto-suggests matching skill from intent keywords)

## Installation (once published)
```
/plugin marketplace add roha3000/multi-agent-template
/plugin install multi-agent-template@<marketplace-name>
```

## Local install (development)
Add this repo as a marketplace from a local path:
```
/plugin marketplace add /absolute/path/to/multi-agent-template
/plugin install multi-agent-template@multi-agent-template
```

## What this plugin does NOT ship
- The dashboard server (`global-context-manager.js`, `global-dashboard.html`) is opt-in infrastructure for fleet-monitoring 50+ concurrent sessions. Run it standalone if you want it.
- `PROJECT_SUMMARY.md`, `.claude/dev-docs/plan.md`, `.claude/dev-docs/tasks.json` are per-project state files. The plugin's `SessionStart` hook reads them if present, no-ops if absent.

## Hook behavior
- **SessionStart** — injects ~1,500-token dev-docs summary into context
- **UserPromptSubmit** — surfaces matching `/phase` or `/skill` based on intent keywords (advisory, never blocks)
- **PostToolUse** — appends a one-line audit entry to `.claude/logs/tool-audit.log`
- **SessionEnd** — appends a session entry to `.claude/logs/sessions.log`

All hooks exit 0 unconditionally. They never block tool calls or prompt submission.
