# Dashboard v4 Implementation Plan

## Overview

Complete redesign of the Fleet Dashboard from card-based layout to data-dense, table-driven design optimized for half-screen use alongside CLI terminals.

**Design Reference:** `docs/design/dashboard-v4-final.html`

## Key Changes from Current Dashboard

| Aspect | Current (v3) | New (v4) |
|--------|--------------|----------|
| Layout | Cards + 3 columns | 2-panel (sessions + content) |
| Top bar | 5h/daily/weekly limits, costs | Projects, Sessions, Tasks X/Y, Agents/sub-agents |
| Session list | Cards with health/conf | Table rows with CLI/AUTO type, ctx%, predictions |
| Health/Confidence | Session + task level | Task-level only |
| Tabs | Overview only | Overview, Tasks, Hierarchy, Details, Logs |
| Responsiveness | Fixed width | Adapts to half-screen |

## Implementation Phases

### Phase 1: Core Layout & CSS (2h)

**Goal:** Replace current layout with 2-panel data-dense design

- [ ] Create new CSS variables matching v4 design
- [ ] Implement top bar with simplified metrics
- [ ] Create 2-panel layout (left: sessions, right: content)
- [ ] Add responsive breakpoints for narrow screens
- [ ] Ensure proper scrolling in each panel

**Files:** `global-dashboard.html`

### Phase 2: Session Panel (2h)

**Goal:** Rebuild session list with new data

- [ ] Group sessions by project (collapsible)
- [ ] Add CLI/AUTO session type badge
- [ ] Show context %, phase, prediction chip
- [ ] Remove health/confidence from session items
- [ ] Implement session selection highlighting

**Backend:** Add `sessionType` field to session data (`cli` | `autonomous`)

**Files:** `global-dashboard.html`, `global-context-manager.js`

### Phase 3: Tab System (3h)

**Goal:** Implement 5-tab content area

#### 3a. Overview Tab
- [ ] Session stats grid (context, messages, tokens, duration)
- [ ] Prediction section (msgs remaining, time to full, task ETA)
- [ ] Current task with health/confidence
- [ ] Subtasks table

#### 3b. Tasks Tab
- [ ] Active tasks table with health/confidence/ETA
- [ ] Ready tasks table
- [ ] Recently completed section (last 5)

#### 3c. Hierarchy Tab
- [ ] Agent tree visualization (project → root → sub-agents)
- [ ] CLI/AUTO indicators on each node
- [ ] Hierarchy summary table

#### 3d. Details Tab
- [ ] Full session metadata
- [ ] Parent/child relationships
- [ ] Claimed task info

#### 3e. Logs Tab
- [ ] Activity stream with timestamps
- [ ] Color-coded log levels (INFO, WARN, AGENT, START)

**Files:** `global-dashboard.html`

### Phase 4: Backend Updates (2h)

**Goal:** Ensure API returns required data

- [ ] Add `sessionType` to `/api/sessions/summary` and `/api/overview`
- [ ] Add prediction calculations to session data:
  - `messagesRemaining`: (100% - ctx%) × max_tokens ÷ avg_tokens_per_msg
  - `timeToFull`: messagesRemaining × avg_time_per_msg
- [ ] Ensure health/confidence only on task objects (not sessions)
- [ ] Add hierarchy summary to `/api/agent-pool/status`:
  - Total projects, root sessions, sub-agents, max depth, active delegations

**Files:** `global-context-manager.js`

### Phase 5: +Session Launcher (2h)

**Goal:** Launch new Claude Code CLI from dashboard

- [ ] Create `/api/sessions/launch` endpoint
- [ ] Implement project picker modal (list known projects)
- [ ] Launch command: `start cmd /k "cd /d <path> && claude --dangerously-skip-permissions"`
- [ ] Return success/error response
- [ ] Add keyboard shortcut `n` to open modal

**Files:** `global-context-manager.js`, `global-dashboard.html`

### Phase 6: Testing & Polish (2h)

**Goal:** Ensure quality and functionality

- [ ] Update E2E tests for new layout
- [ ] Test keyboard navigation (j/k, 1-5 tabs, n)
- [ ] Test responsive behavior at various widths
- [ ] Performance: ensure <500ms load, <200ms tab switches
- [ ] Cross-browser testing (Chrome, Firefox, Edge)

**Files:** `tests/e2e/dashboard-*.test.js`

## Acceptance Criteria

1. **Layout**: 2-panel design renders correctly at full and half-screen widths
2. **Top bar**: Shows projects, sessions, tasks (X/Y), agents/sub-agents counts
3. **Sessions**: Grouped by project with CLI/AUTO badges and prediction chips
4. **Tabs**: All 5 tabs functional with correct content
5. **Health/Confidence**: Only displayed on tasks, not sessions
6. **Hierarchy**: Full tree with summary statistics
7. **+Session**: Launches new CLI in selected project
8. **Keyboard**: j/k navigate, 1-5 switch tabs, n opens launcher
9. **Performance**: <500ms initial load
10. **Tests**: All E2E tests pass

## Removed Features

These are intentionally removed in v4:
- 5-hour, daily, weekly usage limits (inaccurate)
- Cost tracking (inaccurate, not useful)
- Compact context button (orchestrator handles lifecycle)
- End session button (orchestrator handles lifecycle)
- Health/confidence at session level (task-level only)
- Project cards (replaced by session list)

## Dependencies

- None - this is a UI-only redesign with minor backend additions
- Existing APIs provide most required data

## Estimate

| Phase | Time |
|-------|------|
| Phase 1: Core Layout | 2h |
| Phase 2: Session Panel | 2h |
| Phase 3: Tab System | 3h |
| Phase 4: Backend Updates | 2h |
| Phase 5: +Session Launcher | 2h |
| Phase 6: Testing | 2h |
| **Total** | **13h** |

## Risk Mitigation

- **Risk**: Breaking existing functionality
  **Mitigation**: Keep old code commented until new design is validated

- **Risk**: Session type detection inaccurate
  **Mitigation**: Add explicit flag when spawning autonomous agents

- **Risk**: Predictions inaccurate
  **Mitigation**: Show as estimates with "~" prefix, add "based on X" context
