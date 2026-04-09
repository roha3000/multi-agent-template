---
description: Trigger Codex code review and feed findings back to Claude for remediation
---

# Codex Review Workflow

Run a Codex code review on current changes, triage findings with Claude, and apply fixes.

## Usage

```
/codex-review [optional: file or directory]
```

## When to Use

- After any significant implementation session, before committing
- Before every PR merge
- When something "works but I don't trust it yet"
- After auth, API contract, or security-sensitive changes

## Division of Labor

| Tool | Role |
|------|------|
| **Codex** | Static analysis, security patterns, style, known bug patterns |
| **Claude** | Context-aware triage, architectural judgment, remediation |

## Step 1: Run Codex Review

This workflow uses the native `/codex:review` slash command (from the Codex plugin).
`/codex-review` is a playbook wrapper — follow these steps in order:

```bash
# Review uncommitted changes (default)
/codex:review

# Review vs a specific branch
/codex:review --base main

# Run in background while you keep working
/codex:review --background
# Then check results with: /codex:result
```

## Step 2: Triage Findings

After Codex completes, for each Critical and High finding:
1. Read the referenced file and context
2. Determine if it's a true positive given the actual codebase
3. Classify: **Fix Now** | **Fix Next Session** | **Intentional (suppress)**

Do not blindly apply all suggestions — Codex does not have full architectural context.

## Step 3: Fix Now Items

Apply fixes directly, run tests after each fix:
```bash
npm test
```

## Step 4: Fix Next Session Items

Add to `.claude/dev-docs/tasks.json` with `source: "codex-review"` and appropriate priority.

## Step 5: Quality Gate

After remediation:
```
/quality-gate
```

Zero unresolved Critical/High findings satisfies the Codex Review item in the Validation Phase Gate.
