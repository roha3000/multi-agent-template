# Writing Skills - Meta-Skill for Extending the Framework

Create a new slash command (skill) that fits the multi-agent-template conventions.

## Usage
`/writing-skills "name and brief purpose of the new skill"`

## When to Use
- A workflow keeps recurring and deserves its own command
- A team wants to encode project-specific quality gates
- You want to add a domain skill (e.g., `/migration-review`, `/i18n-audit`) without forking the template

## Conventions This Project Uses

Every skill file lives at `.claude/commands/<name>.md` and follows this skeleton:

```markdown
# <Title> - <One-line purpose>

<One paragraph framing: what this skill does and why it exists.>

## Usage
`/<name> "argument"`

## When to Use
- bullet
- bullet

## When NOT to Use
- bullet (point at the alternative skill)

## Process
### Phase 1: <name>
...
### Phase 2: <name>
...

## Anti-patterns
- ❌ ...

## Output
<what the user gets>

## Handoff
<which skill or agent runs next, if any>
```

## Process

### Phase 1: Justify the Skill
Before writing the file, answer:
1. **What problem does this solve that existing skills don't?** Check `.claude/commands/` first — extending an existing skill is usually better than adding a new one.
2. **Is this a phase, a utility, or an audit?** Phases gate progression (have quality scores). Utilities are reusable (e.g., `/agent-handoff`). Audits run agents in parallel.
3. **Which agents does it dispatch?** Reference existing personas in `.claude/agents/` — don't invent new ones unless necessary.
4. **What's the handoff?** Every skill should name the next skill/agent or explicitly end the workflow.

If you can't answer these in two sentences each, the skill isn't ready to be written.

### Phase 2: Draft the File
Write `.claude/commands/<name>.md` using the skeleton above. Rules:
- **Title line** matches the heading in `.claude/bootstrap.md` if it's listed there.
- **Process** is broken into numbered phases, each phase ≤ 8 lines.
- **Anti-patterns** are concrete (`❌ Skip the human checkpoint`), not generic.
- No code unless the skill genuinely produces code artifacts. Skills are guidance, not implementation.
- ≤ 80 lines total. If longer, split into sub-skills.

### Phase 3: Wire Auto-Trigger (optional)
If the skill should be suggested automatically, add a rule to `.claude/hooks/skill-suggester.js`:

```js
{
  pattern: /\b(<keyword1>|<keyword2>)\b/i,
  skill: '/<name>',
  why: '<short tagline>'
}
```

Keep keyword sets tight — false positives erode trust in suggestions.

### Phase 4: Register in Bootstrap
If `.claude/bootstrap.md` lists available skills, add a line. Otherwise skip.

### Phase 5: Smoke Test
Invoke `/<name>` once in a fresh session and confirm Claude follows the process. If Claude improvises around the spec, the skill is under-specified — tighten Phase 2 of the new skill.

## Anti-patterns
- ❌ Creating a skill for a one-off task
- ❌ Copying an existing skill's process verbatim — make sure the new skill earns its existence
- ❌ Skipping Phase 1 justification — most "new skill" requests are better served by editing an existing one
- ❌ Adding broad regex patterns to skill-suggester (`/\bcode\b/i`) that match every prompt
- ❌ Writing a skill that does the work itself instead of orchestrating agents/phases

## Output
A new file at `.claude/commands/<name>.md`, optionally a new rule in `skill-suggester.js`, and a one-line entry in `bootstrap.md` if applicable.

## Handoff
None. The user invokes the new skill directly when they need it.
