# Brainstorming - Socratic Design Clarification

Step back from the keyboard. Before any planning or implementation, surface the real problem and the hidden constraints.

## Usage
`/brainstorming "what you think you want to build"`

## When to Use
- The request is vague ("make it better", "add AI", "fix the dashboard")
- You suspect the stated solution isn't the right solution
- Multiple stakeholders may want different things
- The work touches architectural boundaries
- Cost of building the wrong thing is high

## When NOT to Use
- The task is mechanical (rename, move, format)
- The user has already specified exact behavior + acceptance criteria
- This is a hotfix — use `/emergency-debug` instead

## Process

This skill runs **before** `/planning-phase`. It produces clarified intent, not a plan.

### Phase 1: Problem Restatement
Restate the request in your own words. Do not propose solutions yet.
- What is the user actually trying to accomplish?
- Who benefits if this works? Who is affected if it fails?
- What does "done" look like, concretely?

### Phase 2: Socratic Questions (chunked)
Ask **one chunk of 2-4 questions at a time**, wait for answers, then proceed. Never dump 20 questions at once. Categories to probe:

1. **Goal vs. solution** — "You said X. Is X the goal, or a means to Y?"
2. **Constraints** — budget, timeline, compatibility, team skills
3. **Non-goals** — what is explicitly out of scope?
4. **Failure modes** — what happens if this is partially built? Not built?
5. **Existing alternatives** — does something already do this? (Check `.claude/ARCHITECTURE.md`)
6. **Verification** — how will we know it works?

### Phase 3: Specification Draft
Produce a short spec (≤ 30 lines):

```
## Problem
<one paragraph>

## Goal
<one sentence>

## Non-goals
- ...

## Constraints
- ...

## Acceptance criteria
- [ ] ...
- [ ] ...

## Open questions
- ...
```

### Phase 4: Human Checkpoint
Present the spec. Ask: **"Does this match what you want? Anything missing or wrong?"**

Do NOT proceed to `/planning-phase` until the user confirms. Iterate the spec until they do.

## Anti-patterns

- ❌ Jumping to implementation suggestions during Phase 2
- ❌ Asking 15 questions in one message — overwhelming, low signal
- ❌ Treating the first answer as final — re-probe if answers contradict
- ❌ Producing a plan instead of a spec — that's `/planning-phase`'s job
- ❌ Skipping the human checkpoint

## Output

A spec block ready to feed into `/planning-phase`. The spec lives in the conversation; it does not need to be committed to a file unless the user asks.

## Handoff

When the user confirms the spec, hand off to `/planning-phase` with the spec as input.
