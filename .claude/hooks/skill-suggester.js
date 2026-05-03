#!/usr/bin/env node
/**
 * UserPromptSubmit Hook - Skill / Phase Suggester
 *
 * Inspects the user's prompt for intent keywords and surfaces the matching
 * phase or skill command as additionalContext. This is the multi-agent-template
 * analogue of superpowers' auto-triggered skills: the user keeps writing in
 * natural language, and the harness reminds Claude which workflow applies.
 *
 * Suggestions are advisory — Claude decides whether to invoke. The hook never
 * blocks, never errors out (exit 0 unconditionally).
 */

const fs = require('fs');

// Read the JSON event from stdin (Claude Code hook protocol).
function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_) {
    return '';
  }
}

// Each rule: a regex (case-insensitive) over the prompt text → suggested command.
// Keep this list small and well-targeted; noisy suggestions train Claude to
// ignore the hook.
const RULES = [
  {
    pattern: /\b(brainstorm|clarify requirements?|what are we (really )?trying to|unclear (what|how)|help me think through|design discussion)\b/i,
    skill: '/brainstorming',
    why: 'Socratic clarification before planning'
  },
  {
    pattern: /\b(research|investigate|landscape|market|competitive|evaluate (tech|tool|framework)|prior art)\b/i,
    skill: '/research-phase',
    why: 'Multi-model deep research'
  },
  {
    pattern: /\b(plan|roadmap|break (it|this) down|sequence|milestone|estimate|task breakdown)\b/i,
    skill: '/planning-phase',
    why: 'Strategic planning + logic validation'
  },
  {
    pattern: /\b(architect|design (the|a) (system|api|schema)|component (boundaries?|registry)|data model)\b/i,
    skill: '/design-phase',
    why: 'System architecture + technical design'
  },
  {
    pattern: /\b(write tests? first|tdd|red[- ]green[- ]refactor|test[- ]first)\b/i,
    skill: '/test-first-phase',
    why: 'TDD: failing tests before implementation'
  },
  {
    pattern: /\b(implement|build (the|this)|code (it|this) up|add the feature)\b/i,
    skill: '/implement-phase',
    why: 'Implementation with senior-developer agent'
  },
  {
    pattern: /\b(review (my|this) (code|change|pr)|sanity check|validate (the|my) implementation|quality gate)\b/i,
    skill: '/validate-phase',
    why: 'Cross-agent validation + quality gate'
  },
  {
    pattern: /\b(security review|threat model|attack surface|red[- ]team|adversarial)\b/i,
    skill: '/codex-adversarial',
    why: 'Codex surface scan + attacker/defender debate'
  },
  {
    pattern: /\b(static analysis|lint pass|codex (review|scan)|pre[- ]merge)\b/i,
    skill: '/codex-review',
    why: 'Codex static analysis + Claude triage'
  },
  {
    pattern: /\b(dead code|unused|duplicate|drift|audit (the|this) codebase|orphaned)\b/i,
    skill: '/audit',
    why: 'Parallel audit agents (dead code, dup, arch, DB, docs, deps)'
  },
  {
    pattern: /\b(parallel (feature|branch|work)|isolate (this|the) refactor|side[- ]by[- ]side branch)\b/i,
    skill: '/worktree',
    why: 'Git worktree + isolated dev-docs'
  },
  {
    pattern: /\b(hand off|next agent|context transfer|transition (to|the) (next|another))\b/i,
    skill: '/agent-handoff',
    why: 'Structured handoff documentation'
  },
  {
    pattern: /\b(emergency|production (down|broken)|hotfix|crisis|urgent bug)\b/i,
    skill: '/emergency-debug',
    why: 'Crisis response + rapid resolution'
  },
  {
    pattern: /\b(new skill|add (a )?skill|new command|extend the framework|create a workflow)\b/i,
    skill: '/writing-skills',
    why: 'Meta-skill for adding new commands/skills'
  }
];

function main() {
  const raw = readStdin();
  if (!raw) { process.exit(0); }

  let event;
  try { event = JSON.parse(raw); } catch (_) { process.exit(0); }

  const prompt = (event && event.prompt) || '';
  if (!prompt || prompt.startsWith('/')) {
    // User already invoked a slash command — don't second-guess.
    process.exit(0);
  }

  const matches = [];
  const seen = new Set();
  for (const rule of RULES) {
    if (rule.pattern.test(prompt) && !seen.has(rule.skill)) {
      matches.push(rule);
      seen.add(rule.skill);
      if (matches.length >= 3) break; // cap noise
    }
  }

  if (matches.length === 0) { process.exit(0); }

  const lines = ['[skill-suggester] Workflows matching this request:'];
  for (const m of matches) {
    lines.push(`  - ${m.skill} — ${m.why}`);
  }
  lines.push('(Advisory only. Invoke if it fits; ignore otherwise.)');

  // additionalContext is appended to the user's turn.
  const response = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: lines.join('\n')
    }
  };
  process.stdout.write(JSON.stringify(response));
  process.exit(0);
}

try { main(); } catch (_) { process.exit(0); }
