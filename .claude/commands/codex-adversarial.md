---
description: Adversarial review — Codex surface scan + parallel attacker/defender agents
---

# Codex Adversarial Review

A structured red-team workflow for security-sensitive features: Codex identifies the attack surface, then parallel Claude subagents stress-test the implementation.

## Usage

```
/codex-adversarial [target: file, directory, or feature name]
```

## When to Use

- Before any security-sensitive feature ships (auth, payments, data access, permissions)
- After a Codex review surfaces multiple security findings
- Before a major release as a final quality gate
- When the codebase has significant new external-facing changes

## Division of Labor

| Role | Tool | Responsibility |
|------|------|---------------|
| Surface scanner | Codex | Attack surface map, OWASP pattern matches |
| Attacker agent | Claude subagent | Find exploits, logic flaws, edge case abuse |
| Defender agent | Claude subagent | Propose hardening, validate attacker findings |
| Synthesizer | Claude (main) | Reconcile findings, produce remediation plan |

## Step 1: Codex Adversarial Scan

This workflow uses the native `/codex:adversarial-review` slash command (from the Codex plugin).
`/codex-adversarial` is a playbook wrapper — follow these steps in order:

```bash
# Run adversarial review (steerable)
/codex:adversarial-review

# With specific focus
/codex:adversarial-review look for race conditions and auth bypass

# Background mode
/codex:adversarial-review --background "focus on input validation and SQL injection surface"
# Check with: /codex:result
```

## Step 2: Spawn Attacker and Defender Agents

Using the Codex findings, spawn two Claude subagents in parallel via the Agent tool:

**Attacker prompt:**
```
You are a security researcher. Target: [target].
Codex findings: [paste findings summary].

Find exploitable vulnerabilities:
1. Construct proof-of-concept attacks for each Codex finding
2. Find logic flaws Codex missed (race conditions, TOCTOU, auth bypass)
3. Test boundary conditions and malformed input paths
4. Identify trust boundary violations

Output: Ranked list of exploitable vulnerabilities with reproduction steps.
```

**Defender prompt:**
```
You are a security architect. Target: [target].
Codex findings: [paste findings summary].

Propose hardening strategies:
1. Assess exploitability in this specific codebase context
2. Propose minimum-change mitigations
3. Identify defense-in-depth opportunities
4. Flag false positives given the actual architecture

Output: Ranked hardening recommendations with effort estimates.
```

## Step 3: Synthesize

After both agents complete:
1. Map attacker exploits to defender mitigations
2. Mark items as **Confirmed Vulnerability** or **Theoretical Only**
3. Confirmed Vulnerabilities = ship blockers; Theoretical = tech debt

## Step 4: Remediate and Sign Off

For each Confirmed Vulnerability:
- Apply the defender's mitigation
- Verify the attacker's exploit no longer works
- Document fix with exploit attempt as the regression test basis

Run `/quality-gate --phase=validation` to record completion.
