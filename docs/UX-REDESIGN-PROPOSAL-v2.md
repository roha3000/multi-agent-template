# Dashboard UX Redesign Proposal v2

**Date**: 2025-12-27
**Based on**: UX Agent Analysis + User Preferences
**Status**: DRAFT - Awaiting Layout Selection

---

## User Requirements Summary

| Requirement | Value |
|-------------|-------|
| Concurrent sessions | 3-5 |
| Interaction style | Active control (frequent intervention) |
| Priority #1 | Quality scores |
| Priority #2 | Active tasks |
| Priority #3 | Usage limits |
| Quality display | Traffic light summary |
| Controls | Inline buttons (no drill-down) |
| Complexity | Keep it simple |
| Future features | Design for autonomous tracking |

---

## Current Problems Being Solved

1. **Quality scores hidden** → Now prominent via traffic lights
2. **Context % over-emphasized** → Demoted, quality elevated
3. **Pause requires 2 clicks** → Inline buttons on every session
4. **Modal blocks other sessions** → Split-pane or inline expansion
5. **Single-session panels in overview** → Removed or collapsed
6. **No autonomous session distinction** → Visual indicator added

---

## Layout Option A: Split-Pane

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ COMMAND CENTER                          [Usage: ████░░ 62%] [? Help]        │
├─────────────────────────────────────────────────────────────────────────────┤
│ QUALITY STATUS    ● ● ● ○ ●   (5 sessions: 3 healthy, 1 idle, 1 warning)   │
├────────────────────────────────┬────────────────────────────────────────────┤
│ SESSIONS                       │ DETAIL: multi-agent-template               │
│ ┌────────────────────────────┐ │ ┌──────────────────────────────────────┐   │
│ │ ● template         [85] ▶  │ │ │ Quality: 85  │ Phase: implement      │   │
│ │   dashboard-ui    ⏸ ⏭ ⏹  │◀│ │ Context: 47% │ Iteration: 3          │   │
│ └────────────────────────────┘ │ │ Cost: $3.96  │ Runtime: 1h 24m       │   │
│ ┌────────────────────────────┐ │ └──────────────────────────────────────┘   │
│ │ ● focusApp         [92] 🤖 │ │                                            │
│ │   auth-module     ⏸ ⏭ ⏹  │ │ CURRENT TASK                               │
│ └────────────────────────────┘ │ │ dashboard-global-metrics-bar              │
│ ┌────────────────────────────┐ │ │ Add 5-card metrics bar to Command Center │
│ │ ○ api-service      [--] 💤 │ │ │ ✓ Cards displayed horizontally           │
│ │   (idle)          [Resume] │ │ │ ✓ Active sessions count                  │
│ └────────────────────────────┘ │ │ ○ Tasks done today                       │
│ ┌────────────────────────────┐ │ │ ○ Avg health score                       │
│ │ ● analytics        [71] ⚠  │ │ └──────────────────────────────────────┘   │
│ │   data-pipeline   ⏸ ⏭ ⏹  │ │                                            │
│ └────────────────────────────┘ │ │ TASK QUEUE                               │
│                                │ │ 1. dashboard-usage-limits [ready]        │
│ + Start New Session            │ │ 2. dashboard-recent-completions [ready]  │
│                                │ │ 3. autonomous-tracking [blocked]         │
│                                │ └────────────────────────────────────────┘ │
│                                │                                            │
│                                │ ┌──────────────────────────────────────┐   │
│                                │ │ LOGS ▼ (click to expand)             │   │
│                                │ └──────────────────────────────────────┘   │
└────────────────────────────────┴────────────────────────────────────────────┘

LEGEND:
● = Active session     ○ = Idle session      ⚠ = Warning (quality < 75)
[85] = Quality score   🤖 = Autonomous       💤 = Paused/Idle
⏸ = Pause   ⏭ = Skip Task   ⏹ = End Session   ▶ = Selected
```

**Pros**:
- Always see session list AND detail simultaneously
- Click session to view detail (no modal)
- Quality traffic lights at top for instant scan
- Inline controls (⏸ ⏭ ⏹) on every session

**Cons**:
- Narrower detail panel on small screens
- May need horizontal scroll on mobile

**Complexity**: Low-Medium

---

## Layout Option B: Kanban Board

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ COMMAND CENTER                          [Usage: ████░░ 62%] [? Help]        │
├─────────────────────────────────────────────────────────────────────────────┤
│ QUALITY STATUS    ● ● ● ○ ●   (5 sessions: 3 healthy, 1 idle, 1 warning)   │
├─────────────────┬─────────────────┬─────────────────┬───────────────────────┤
│ RESEARCH        │ DESIGN          │ IMPLEMENT       │ TEST                  │
│ ─────────────── │ ─────────────── │ ─────────────── │ ───────────────────── │
│                 │ ┌─────────────┐ │ ┌─────────────┐ │                       │
│                 │ │ ● focusApp  │ │ │ ● template  │ │                       │
│                 │ │   [92] 🤖   │ │ │   [85]      │ │                       │
│                 │ │ auth-module │ │ │ dashboard-ui│ │                       │
│                 │ │ ⏸ ⏭ ⏹     │ │ │ ⏸ ⏭ ⏹     │ │                       │
│                 │ └─────────────┘ │ └─────────────┘ │                       │
│                 │                 │ ┌─────────────┐ │                       │
│                 │                 │ │ ● analytics │ │                       │
│                 │                 │ │   [71] ⚠    │ │                       │
│                 │                 │ │ data-pipe   │ │                       │
│                 │                 │ │ ⏸ ⏭ ⏹     │ │                       │
│                 │                 │ └─────────────┘ │                       │
│                 │                 │                 │                       │
│ ┌─────────────┐ │                 │                 │                       │
│ │ ○ api-svc   │ │                 │                 │                       │
│ │   [--] 💤   │ │                 │                 │                       │
│ │  [Resume]   │ │                 │                 │                       │
│ └─────────────┘ │                 │                 │                       │
└─────────────────┴─────────────────┴─────────────────┴───────────────────────┘

Click any card to expand detail panel below:
┌─────────────────────────────────────────────────────────────────────────────┐
│ DETAIL: template                                                    [Close] │
│ Quality: 85 │ Context: 47% │ Cost: $3.96 │ Runtime: 1h 24m │ Iteration: 3   │
│ ──────────────────────────────────────────────────────────────────────────  │
│ Task: dashboard-global-metrics-bar                                          │
│ ✓ Cards displayed │ ✓ Active sessions │ ○ Tasks done │ ○ Avg health        │
│ ──────────────────────────────────────────────────────────────────────────  │
│ Queue: dashboard-usage-limits → dashboard-recent-completions → autonomous   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Pros**:
- Visual phase progress across ALL sessions at once
- Natural grouping by development phase
- Can see which phases have congestion
- Supports drag-drop priority ordering (future)

**Cons**:
- Horizontal scroll with many phases
- Cards smaller than split-pane
- More visual complexity

**Complexity**: Medium

---

## Layout Option C: Table-Based

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ COMMAND CENTER                          [Usage: ████░░ 62%] [? Help]        │
├─────────────────────────────────────────────────────────────────────────────┤
│ QUALITY STATUS    ● ● ● ○ ●   (5 sessions: 3 healthy, 1 idle, 1 warning)   │
├─────────────────────────────────────────────────────────────────────────────┤
│ ◉ SESSION         │ QUALITY │ PHASE     │ TASK              │ CONTROLS     │
│ ──────────────────┼─────────┼───────────┼───────────────────┼──────────────│
│ ▼ template        │  ● 85   │ implement │ dashboard-ui      │ ⏸  ⏭  ⏹     │
│ │ Context: 47%    │         │ iter: 3   │ ✓✓○○ (2/4 done)  │              │
│ │ Cost: $3.96     │         │           │                   │              │
│ │ Queue: usage-limits → recent-completions → autonomous     │              │
│ └─────────────────┴─────────┴───────────┴───────────────────┴──────────────│
│ ▶ focusApp 🤖     │  ● 92   │ design    │ auth-module       │ ⏸  ⏭  ⏹     │
│ ▶ api-service 💤  │  ○ --   │ idle      │ (paused)          │ [Resume]     │
│ ▼ analytics       │  ⚠ 71   │ implement │ data-pipeline     │ ⏸  ⏭  ⏹     │
│ │ Context: 82%    │         │ iter: 5   │ ○○○○ (0/4 done)  │              │
│ │ Cost: $8.21     │         │           │                   │              │
│ │ ⚠ ALERT: Quality below threshold, iteration 5            │              │
│ └─────────────────┴─────────┴───────────┴───────────────────┴──────────────│
│ ▶ test-runner     │  ● 88   │ test      │ e2e-suite         │ ⏸  ⏭  ⏹     │
└─────────────────────────────────────────────────────────────────────────────┘

LEGEND:
▶ = Collapsed row (click to expand)    ▼ = Expanded row
● = Healthy (75+)    ⚠ = Warning (50-74)    ⛔ = Critical (<50)    ○ = Idle
🤖 = Autonomous session    💤 = Paused
```

**Pros**:
- Most information-dense layout
- Easy to sort by any column (quality, phase, cost)
- Expandable rows for detail (no separate panel)
- Familiar table interaction pattern
- Works well for 5+ sessions

**Cons**:
- Less visual appeal than cards
- May feel "spreadsheet-like"
- Expansion can push content down

**Complexity**: Low

---

## Common Elements (All Layouts)

### Traffic Light Quality Bar
```
QUALITY STATUS    ● ● ● ○ ●   (5 sessions: 3 healthy, 1 idle, 1 warning)
                  │ │ │ │ │
                  │ │ │ │ └─ test-runner (88)
                  │ │ │ └─── api-service (idle)
                  │ │ └───── analytics (71) ⚠
                  │ └─────── focusApp (92)
                  └───────── template (85)
```
- Hover over dot shows session name + score
- Click dot jumps to that session
- Color: Green (75+), Yellow (50-74), Red (<50), Gray (idle)

### Inline Session Controls
```
⏸ Pause    ⏭ Skip Task    ⏹ End Session
```
- Always visible on each session
- No drill-down required
- Keyboard shortcuts: P (pause), S (skip), E (end)

### Autonomous Session Indicator
```
● focusApp 🤖    ← Robot emoji indicates autonomous mode
│
└─ Shows: phase, iteration, auto-quality-gate status
```

### Usage Limits (Collapsed by Default)
```
[Usage: ████░░ 62%]  ← Click to expand

┌─────────────────────────────────────────────┐
│ 5-Hour: 186/300 (62%) │ Resets: 2h 14m     │
│ Daily:  465/1500 (31%) │ Resets: 8h 32m    │
│ Weekly: 1.2K/7K (18%) │ Resets: Mon        │
└─────────────────────────────────────────────┘
```
- Since usage limits are lower priority, collapsed by default
- Expands on click/hover
- Alert badge if >90%

---

## Upcoming Feature Integration: Autonomous Tracking

### Visual Indicators
```
● focusApp 🤖     ← Autonomous session
│
├─ Phase Timeline: ████░░░░ (Design phase, 40% through gate)
├─ Auto Quality Gate: 85/90 (needs 5 more points to proceed)
├─ Iteration: 2 of max 5
└─ Next Action: Run quality-gate check in 3 tasks
```

### Autonomous Panel (when expanded)
```
┌──────────────────────────────────────────────────────┐
│ AUTONOMOUS EXECUTION                          🤖     │
│ ────────────────────────────────────────────────────│
│ Mode: Full Autonomous (no human intervention)        │
│ Phase: DESIGN (2/4)                                  │
│                                                      │
│ Progress: [research ✓] [design ●] [implement ○] [test ○] │
│                                                      │
│ Quality Gates:                                       │
│   Research: 88/80 ✓                                  │
│   Design:   72/85 ⏳ (in progress)                   │
│                                                      │
│ Current Task: auth-module-design                     │
│ Acceptance: ✓✓○○○ (2/5 criteria met)                │
│                                                      │
│ [Pause Auto] [Skip to Next Phase] [End Session]     │
└──────────────────────────────────────────────────────┘
```

---

## Live Task Refresh Integration

All layouts will include:
- **Real-time task status updates** (SSE, <1 second latency)
- **Pulse animation** when task status changes
- **Counter badges** that update live: `Ready: 3 | In Progress: 1 | Done: 12`
- **Task queue reordering** without page refresh

---

## Recommendation

For your use case (3-5 sessions, active control, quality-focused):

| Layout | Fit Score | Reason |
|--------|-----------|--------|
| **Split-Pane** | ⭐⭐⭐⭐⭐ | Best balance of overview + detail, lowest complexity |
| **Table-Based** | ⭐⭐⭐⭐ | Most information-dense, great for quick scanning |
| **Kanban** | ⭐⭐⭐ | Best for phase visualization, but adds visual complexity |

**My recommendation**: **Split-Pane** (Option A)
- You can see all sessions AND detail without modals
- Inline controls on every session
- Quality traffic lights for instant scan
- Lowest cognitive load
- Scales well from 3 to 10+ sessions

---

## Next Steps

1. **Review mockups above** and select preferred layout
2. I will create detailed component specs for chosen layout
3. Implementation as new dashboard version (can keep old as fallback)
4. Integration with autonomous tracking and live refresh APIs

---

## Questions for You

See the AskUserQuestion dialog for layout selection.
