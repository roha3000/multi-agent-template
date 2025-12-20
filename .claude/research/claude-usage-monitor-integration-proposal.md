# Research Proposal: Claude-Code-Usage-Monitor Integration Analysis

**Date**: 2025-12-20
**Status**: Research Complete
**Prepared by**: Multi-Agent Research Team
**Target Repository**: https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor

---

## Executive Summary

This research evaluates the Claude-Code-Usage-Monitor project (6,000+ GitHub stars, v3.1.0) against our multi-agent-template's monitoring capabilities. The analysis identifies **12 high-value features** worth incorporating, with estimated implementation effort and priority rankings.

### Key Finding

Claude-Code-Usage-Monitor excels at **user-facing terminal UX** and **ML-based limit prediction**, while multi-agent-template excels at **autonomous orchestration** and **multi-project tracking**. Combining strengths creates a comprehensive monitoring solution.

---

## Comparative Analysis

### Technology Stack Comparison

| Aspect | Claude-Code-Usage-Monitor | Multi-Agent-Template |
|--------|--------------------------|---------------------|
| **Language** | Python 3.9+ | Node.js 18+ |
| **UI Framework** | Rich (Terminal) | HTML/CSS + SSE (Web) |
| **Configuration** | Pydantic v2 | JSON/Environment |
| **Data Storage** | In-memory + JSON files | SQLite + In-memory |
| **Testing** | pytest (100+ tests, 80% coverage) | Jest (260+ tests, 90%+ coverage) |
| **Distribution** | PyPI (`pip install claude-monitor`) | npm + local |
| **Architecture** | 7-layer modular | Event-driven modular |
| **Version** | v3.1.0 (production) | Session 12 (production) |

### Feature Matrix

| Capability | Usage-Monitor | Multi-Agent | Winner |
|------------|---------------|-------------|--------|
| **Real-time token tracking** | ✅ 0.1-20 Hz | ✅ <200ms latency | Tie |
| **Multi-project tracking** | ❌ Single project | ✅ All ~/.claude/projects | Multi-Agent |
| **ML limit prediction (P90)** | ✅ 8-day history analysis | ❌ Fixed thresholds | Usage-Monitor |
| **Subscription plan support** | ✅ Pro/Max5/Max20/Custom | ❌ Single tier assumed | Usage-Monitor |
| **Terminal UI** | ✅ Rich library, WCAG AA+ | ❌ Web only | Usage-Monitor |
| **Web dashboard** | ❌ Terminal only | ✅ SSE real-time | Multi-Agent |
| **Autonomous orchestration** | ❌ Monitoring only | ✅ Phase-based execution | Multi-Agent |
| **Quality gates** | ❌ No validation | ✅ Multi-agent scoring | Multi-Agent |
| **Burn rate calculation** | ✅ Tokens/minute + projection | ⚠️ Velocity only | Usage-Monitor |
| **Cost projections** | ✅ Time-remaining estimates | ❌ Current cost only | Usage-Monitor |
| **Session gap detection** | ✅ Automatic inactivity marking | ❌ Active-only tracking | Usage-Monitor |
| **Theme auto-detection** | ✅ Light/dark/classic/auto | ❌ Fixed styling | Usage-Monitor |
| **View modes** | ✅ Realtime/Daily/Monthly | ❌ Realtime only | Usage-Monitor |
| **OTLP integration** | ❌ Direct JSONL | ✅ OpenTelemetry receiver | Multi-Agent |
| **Compaction detection** | ❌ No tracking | ✅ 30%+ drop detection | Multi-Agent |
| **State recovery** | ❌ No persistence | ✅ Dev-docs 3-file pattern | Multi-Agent |

---

## Visual Design & Dashboard Comparison

This section provides a detailed comparison of the visual design elements between both projects.

### Dashboard Architecture Comparison

| Aspect | Claude-Code-Usage-Monitor | Multi-Agent-Template |
|--------|--------------------------|---------------------|
| **Platform** | Terminal (Rich library) | Web Browser (HTML/CSS/JS) |
| **Rendering** | ANSI escape codes | DOM + CSS |
| **Refresh Rate** | 0.1-20 Hz configurable | SSE (~2s intervals) |
| **Responsive** | Terminal width adaptation | CSS media queries |
| **Offline Support** | Full (local JSONL) | Requires server running |

### Color System Comparison

#### Claude-Code-Usage-Monitor (Terminal)
```
Light Theme (for light terminals):
├── Header:  Deep blue (#00005f)     - 21:1 contrast ⭐
├── Success: Dark green (#005f00)    - 15:1 contrast
├── Warning: Dark orange (#d75f00)   - 8:1 contrast
├── Error:   Dark red (#8b0000)      - 10:1 contrast
└── Info:    Deep blue (#00005f)     - 21:1 contrast

Dark Theme (for dark terminals):
├── Header:  Light blue (#87d7ff)    - 14:1 contrast
├── Success: Bright green (#87ff00)  - 15:1 contrast ⭐
├── Warning: Bright orange (#ffaf00) - 11:1 contrast
├── Error:   Light red (#ff5f5f)     - 8:1 contrast
└── Info:    Light blue (#87d7ff)    - 14:1 contrast

Classic Theme: Basic ANSI 16-color palette (maximum compatibility)
```

**Key Strength**: Scientific color selection with WCAG AA+ compliance (8:1+ contrast ratios)

#### Multi-Agent-Template (Web)
```css
:root {
    --bg-primary: #0d1117;      /* GitHub-dark inspired */
    --bg-secondary: #161b22;
    --bg-tertiary: #21262d;
    --text-primary: #e6edf3;
    --text-secondary: #8b949e;
    --success: #3fb950;
    --warning: #d29922;
    --danger: #f85149;
    --critical: #ff6b6b;
    --info: #58a6ff;
}
```

**Key Strength**: Modern dark theme with gradient alerts and animations

### Progress Bar Comparison

#### Claude-Code-Usage-Monitor
```
Token Progress:
[████████████████░░░░░░░░░░░░░░] 52% | 104,000 / 200,000

Color States:
- 🟢 Green: <50% usage
- 🟡 Yellow: 50-90% usage
- 🔴 Red: ≥90% usage

Features:
- Scales with terminal width
- Percentage + absolute numbers
- Single-line compact display
```

#### Multi-Agent-Template
```html
┌─────────────────────────────────────────────────┐
│  Context: 67% (134,000 / 200,000 tokens)        │
│  ████████████████████░░░░░░░░░░░  67%           │
│           ▲50%      ▲65%    ▲75%  ⚡77.5%       │
│                                                  │
│  Burn Rate: 1,247 tokens/min                    │
│  Time Remaining: ~52 minutes                    │
└─────────────────────────────────────────────────┘

Features:
- Threshold markers at 50%, 65%, 75%, 77.5% (auto-compact)
- Animated pulse effect on emergency
- Gradient fill colors
```

**Visual Advantages**:
| Feature | Usage-Monitor | Multi-Agent |
|---------|--------------|-------------|
| Threshold markers | ❌ | ✅ Clear visual markers |
| Animations | ❌ (terminal limitation) | ✅ Pulse, flash effects |
| Big number display | ❌ | ✅ 72px hero percentage |
| Compact single-line | ✅ | ❌ |
| Works in SSH | ✅ | ❌ |

### Information Density Comparison

#### Claude-Code-Usage-Monitor Display Layout
```
╭─────────────────────── Claude Usage Monitor ───────────────────────╮
│  Session: abc123                              Plan: Max5           │
├────────────────────────────────────────────────────────────────────┤
│  Tokens:  [████████████████░░░░░░░░] 67% (58,960 / 88,000)        │
│  Cost:    [██████████░░░░░░░░░░░░░░] 42% ($14.70 / $35.00)        │
│  Messages:[████████░░░░░░░░░░░░░░░░] 32% (320 / 1,000)            │
├────────────────────────────────────────────────────────────────────┤
│  🔥 Burn Rate: 1,247 tokens/min | ⏰ ~24 min remaining            │
│  💰 $4.32/hour | Session ends: 2:45 PM                            │
╰────────────────────────────────────────────────────────────────────╯

 Daily Summary                    Monthly Summary
┌──────────────────────────────┐ ┌──────────────────────────────┐
│ Date       Tokens    Cost    │ │ Month      Tokens    Cost    │
├──────────────────────────────┤ ├──────────────────────────────┤
│ Dec 20     145,230   $12.45  │ │ Dec 2025   1.2M      $89.50  │
│ Dec 19     132,100   $11.20  │ │ Nov 2025   980K      $72.30  │
│ Dec 18     98,450    $8.90   │ │ Oct 2025   1.1M      $85.20  │
└──────────────────────────────┘ └──────────────────────────────┘
```

**Strengths**:
- Multiple metrics visible simultaneously (tokens, cost, messages)
- Tabular historical views (daily/monthly)
- Burn rate + time projection in compact format

#### Multi-Agent-Template Display Layout
```
┌─────────────────────────────────────────────────────────────────┐
│ 🔴 CRITICAL: Only 35% remaining - Clear soon                   │
│                                            [Copy /clear]        │
└─────────────────────────────────────────────────────────────────┘

┌── Continuous Loop Active ──────────────────────────────────────┐
│ ⚡ Session: 3  │ Completed: 2 │ Tokens: 245k │ Cost: $18.50   │
│                                                                 │
│ [🔄 S1: 65%] [✅ S2: 72%] [⚡ S3: Running...]                  │
└─────────────────────────────────────────────────────────────────┘

┌── Current Phase ───────┐  ┌── Quality Score ──────────────────┐
│ 🏗️ IMPLEMENT           │  │ Score: 87/100 (Min: 90)           │
│ Iteration 2 of 10      │  │ ████████████████░░░░ Code: 85     │
│ ○ ○ ● (history)        │  │ ███████████████░░░░░ Tests: 78    │
└────────────────────────┘  └───────────────────────────────────┘

┌── Task Progress ────────────────────────────────────────────────┐
│ ████████████░░░░░░░░░░░░ 4/10                                  │
│ ☑ Implement P90 calculator                                      │
│ ☑ Add plan configuration                                        │
│ ☑ Create burn rate module                                       │
│ ☐ Update dashboard display  ← in progress                       │
│ ☐ Add theme system                                              │
└─────────────────────────────────────────────────────────────────┘

┌── my-project ──────────────────────────────────────────────────┐
│                          35%                                    │
│                     CONTEXT REMAINING                           │
│                    (70,000 tokens left)                         │
│                                                                 │
│ ████████████████████████████░░░░░░░░░░░░ 65%                   │
│             ▲50%        ▲65%      ▲75%  ⚡77.5%                 │
│                                                                 │
│ [Copy /clear]                    [Copy /session-init]           │
└─────────────────────────────────────────────────────────────────┘
```

**Strengths**:
- Big hero number (72px) for quick glance
- Session series history with visual chips
- Quality gate scoring with criteria breakdown
- Todo list with progress
- Phase-based execution visibility
- Autonomous orchestration status

### Visual Elements Worth Adopting

#### From Claude-Code-Usage-Monitor → Multi-Agent-Template

| Element | Description | Implementation Effort |
|---------|-------------|----------------------|
| **Multi-Metric Progress Bars** | Show tokens, cost, AND messages side-by-side | 3-4 hours |
| **Burn Rate Display** | "1,247 tokens/min \| ~24 min remaining" | 2-3 hours |
| **Time Projection** | "Session ends: 2:45 PM" | 1-2 hours |
| **Daily/Monthly Tables** | Tabular historical summaries | 6-8 hours |
| **Light Theme** | WCAG-compliant light mode option | 4-5 hours |
| **Model Usage Breakdown** | Stacked bar showing Opus/Sonnet/Haiku split | 3-4 hours |
| **Plan Indicator Badge** | "Pro" / "Max5" / "Max20" badge in header | 1 hour |

#### Visual Mockup: Enhanced Dashboard

```
┌─────────────────────────────────────────────────────────────────┐
│ 🔴 CRITICAL: Only 35% remaining (~24 min) - Clear soon         │
└─────────────────────────────────────────────────────────────────┘

┌── my-project ─────────────────────────────── [Max5] ───────────┐
│                                                                 │
│                          35%                                    │
│                     CONTEXT REMAINING                           │
│              🔥 1,247 tokens/min | ⏰ ~24 min left              │
│                                                                 │
│ Tokens:   ████████████████████████████░░░░░░░░░ 65% (57k/88k)  │
│ Cost:     ██████████████░░░░░░░░░░░░░░░░░░░░░░ 42% ($14.70)    │
│ Messages: ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 32% (320/1k)    │
│                                                                 │
│ Model Usage: [████ Opus 45%][██████ Sonnet 55%]                │
│                                                                 │
│ [Copy /clear]  [Copy /session-init]  [View Daily]  [Monthly]   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Task Management & Backlog UI Requirements

This section addresses the need for comprehensive task tracking with read/write capability.

### Current State Analysis

**What exists now:**
```
┌── Task Progress Panel (Read-Only) ─────────────────────────────┐
│ ████████████░░░░░░░░░░░░ 4/10                                  │
│ ☑ Implement P90 calculator                                      │
│ ☑ Add plan configuration                                        │
│ ☐ Update dashboard display                                      │
│ ☐ Add theme system                                              │
└─────────────────────────────────────────────────────────────────┘

Data Source: .claude/dev-docs/tasks.md (parsed markdown checkboxes)
API: GET /api/execution/todos (read-only)
```

**Current Limitations:**
| Capability | Status | Gap |
|------------|--------|-----|
| View in-flight tasks | ✅ Works | - |
| Toggle task completion | ❌ Missing | No write API |
| View backlog (future tasks) | ❌ Missing | Only parses current session |
| Add new tasks | ❌ Missing | No creation endpoint |
| Edit task text | ❌ Missing | No update endpoint |
| Task categories/phases | ❌ Missing | Flat list only |
| Priority indicators | ❌ Missing | No priority field |
| Drag-and-drop reorder | ❌ Missing | Static order |

### Proposed Task Management System

#### Data Model Enhancement

```javascript
// Current: Simple todo object
{ completed: boolean, text: string }

// Proposed: Rich task object
{
  id: string,                    // Unique identifier
  text: string,                  // Task description
  status: 'pending' | 'in_progress' | 'completed' | 'blocked',
  priority: 'critical' | 'high' | 'medium' | 'low',
  phase: 'research' | 'design' | 'implement' | 'test' | null,
  category: 'backlog' | 'current' | 'completed',
  createdAt: ISO8601,
  completedAt: ISO8601 | null,
  blockedBy: string | null,      // Reference to blocking task
  order: number                  // For drag-and-drop ordering
}
```

#### API Endpoints (New)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/todos` | Get all tasks with filtering |
| `GET` | `/api/todos/backlog` | Get backlog tasks only |
| `GET` | `/api/todos/current` | Get in-flight tasks only |
| `POST` | `/api/todos` | Create new task |
| `PUT` | `/api/todos/:id` | Update task (text, status, priority) |
| `PATCH` | `/api/todos/:id/status` | Toggle completion status |
| `PATCH` | `/api/todos/:id/order` | Reorder task (for drag-drop) |
| `DELETE` | `/api/todos/:id` | Delete task |

**Query Parameters for GET /api/todos:**
- `?status=pending,in_progress` - Filter by status
- `?phase=implement` - Filter by phase
- `?category=backlog` - Filter by category
- `?priority=critical,high` - Filter by priority

#### UI Components (New)

```
┌── Task Management Dashboard ─────────────────────────────────────┐
│                                                                   │
│  [+ Add Task]  [Filter ▼]  [View: Kanban | List]                 │
│                                                                   │
│  ┌─ BACKLOG (12) ─────┐  ┌─ IN PROGRESS (3) ─┐  ┌─ DONE (8) ────┐│
│  │ ○ Add P90 calc   🔴│  │ ● Update UI    🟡│  │ ✓ Research   ││
│  │ ○ Burn rate      🟡│  │ ● Fix SSE     🟡│  │ ✓ Design     ││
│  │ ○ Theme system   🟢│  │ ● Add tests   🟢│  │ ✓ API layer  ││
│  │ ○ View modes     🟢│  │                  │  │              ││
│  │ [drag to reorder]  │  │                  │  │              ││
│  └─────────────────────┘  └──────────────────┘  └──────────────┘│
│                                                                   │
│  Legend: 🔴 Critical  🟡 High  🟢 Medium  ⚪ Low                  │
└───────────────────────────────────────────────────────────────────┘
```

#### Markdown Sync Strategy

**Problem**: tasks.md is the source of truth, but dashboard needs write capability.

**Solution**: Bidirectional sync with markdown preservation

```javascript
// Write changes back to tasks.md
async function updateTaskInMarkdown(taskId, updates) {
  const content = await fs.readFile(TASKS_PATH, 'utf-8');

  // Find and update the specific checkbox line
  const updated = content.replace(
    /- \[[ xX]\] (.+)/g,
    (match, text) => {
      if (generateId(text) === taskId) {
        const checkbox = updates.completed ? 'x' : ' ';
        return `- [${checkbox}] ${updates.text || text}`;
      }
      return match;
    }
  );

  await fs.writeFile(TASKS_PATH, updated, 'utf-8');
  return parseTasksMarkdown(updated);
}
```

#### Implementation Phases

| Phase | Features | Effort | Priority |
|-------|----------|--------|----------|
| **Phase 1** | Toggle completion from UI | 3-4h | Critical |
| **Phase 2** | Backlog view with filters | 4-6h | High |
| **Phase 3** | Add/Edit/Delete tasks | 4-5h | High |
| **Phase 4** | Kanban board view | 6-8h | Medium |
| **Phase 5** | Drag-and-drop reordering | 4-6h | Low |

**Total Effort**: 21-29 hours

### Backlog View Mockup

```
┌── Backlog Management ────────────────────────────────────────────┐
│                                                                   │
│  📋 BACKLOG                                    [+ Add Task]       │
│                                                                   │
│  Filter: [All Phases ▼] [All Priorities ▼] [Search...        ]  │
│                                                                   │
│  ┌─ Option A: Predictive Analytics ──────────────────────────┐   │
│  │ 🔴 P90 Limit Detection (ML-based)           [research] 4-6h│   │
│  │ 🟡 Burn Rate + Time Projection              [implement] 3-4h│   │
│  │ 🟡 Session Gap Detection                    [implement] 2-3h│   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Option C: Advanced Visualizations ────────────────────────┐   │
│  │ 🟢 View Modes (Realtime/Daily/Monthly)      [design] 6-8h  │   │
│  │ 🟢 WCAG Theme System                        [design] 4-5h  │   │
│  │ 🟢 Multi-metric Progress Bars               [implement] 3-4h│   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Task Management ──────────────────────────────────────────┐   │
│  │ 🔴 Toggle completion from UI                [implement] 3-4h│   │
│  │ 🟡 Backlog view with filters                [implement] 4-6h│   │
│  │ 🟡 Add/Edit/Delete tasks                    [implement] 4-5h│   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  Total: 15 tasks | Est: 45-60 hours                              │
└───────────────────────────────────────────────────────────────────┘
```

### Integration with Claude-Code-Usage-Monitor Features

The task management system integrates with proposed features:

| Feature | Task Integration |
|---------|------------------|
| **P90 Limit Detection** | Show task as blocked if near context limit |
| **Burn Rate** | Estimate time to complete based on token velocity |
| **View Modes** | Daily/Monthly task completion history |
| **Quality Gates** | Auto-block tasks if phase quality score < threshold |

---

### Recommended Visual Enhancements (Priority Order)

1. **Add Burn Rate + Time Remaining** (Critical, 3h)
   - Display tokens/minute in real-time
   - Show projected time until threshold
   - Add "Session ends at: X:XX PM"

2. **Multi-Metric Progress Bars** (High, 4h)
   - Add cost progress bar below tokens
   - Add message count progress bar
   - Stacked or side-by-side layout

3. **Light Theme Support** (Medium, 5h)
   - WCAG-compliant light color palette
   - `prefers-color-scheme` media query detection
   - Manual toggle in header

4. **Plan Badge** (Low, 1h)
   - Show current plan (Pro/Max5/Max20/Custom)
   - Auto-detected or configured

5. **View Mode Tabs** (Medium, 6h)
   - Realtime (current) / Daily / Monthly tabs
   - Table views for historical data
   - SQLite aggregation queries

---

## Best Elements to Incorporate

### Priority 1: High-Impact, Low-Effort (Recommended for Immediate Implementation)

#### 1.1 P90 Percentile Limit Detection
**Source**: `p90_calculator.py`
**Impact**: Critical
**Effort**: 4-6 hours

**Current Gap**: Multi-agent-template uses fixed context thresholds (50%, 65%, 75%). Users on different Claude plans hit limits at different token counts, causing false positives/negatives.

**Feature Description**:
```javascript
// Proposed implementation concept
class P90LimitCalculator {
  calculateLimit(sessionBlocks, ttl = 300) {
    // 1. Filter limit-hitting blocks (>95% of known limits)
    const hits = sessionBlocks.filter(b =>
      this.didHitLimit(b, LIMIT_DETECTION_THRESHOLD)
    );

    // 2. Fallback to inactive blocks if no limit hits
    const samples = hits.length ? hits :
      sessionBlocks.filter(b => !b.isGap && !b.isActive);

    // 3. Return 90th percentile or minimum default
    if (samples.length < 3) return DEFAULT_LIMIT;
    return this.quantile(samples.map(s => s.tokens), 0.9);
  }
}
```

**Benefits**:
- Automatically learns user's actual limit from history
- No manual plan configuration needed
- More accurate threshold alerts
- Works across Pro, Max5, Max20, and custom limits

**Implementation Location**: `.claude/core/p90-limit-calculator.js`

---

#### 1.2 Burn Rate & Time Projection
**Source**: `calculations.py`, `burn_rate.py`
**Impact**: High
**Effort**: 3-4 hours

**Current Gap**: Multi-agent-template shows context percentage but not "time until limit" or "tokens per minute".

**Feature Description**:
```javascript
class BurnRateCalculator {
  calculate(recentEntries, windowMinutes = 15) {
    const tokens = this.sumTokens(recentEntries);
    const tokensPerMinute = tokens / windowMinutes;

    return {
      tokensPerMinute,
      costPerHour: (tokens / windowMinutes) * 60 * this.avgCostPerToken,
      projectedExhaustion: this.calculateTimeRemaining(tokensPerMinute)
    };
  }

  calculateTimeRemaining(tokensPerMinute) {
    if (tokensPerMinute <= 0) return Infinity;
    const remaining = this.limit - this.currentUsage;
    return remaining / tokensPerMinute; // minutes
  }
}
```

**Dashboard Enhancement**:
```
Context: 67% (134,000 / 200,000 tokens)
├── Burn Rate: 1,247 tokens/min
├── Time Remaining: ~52 minutes at current rate
├── Projected Cost: $4.32/hour
└── Session Ends: 2:45 PM
```

**Benefits**:
- Proactive session planning
- Users know when to checkpoint
- Cost forecasting for budget management

---

#### 1.3 Subscription Plan Awareness
**Source**: `plans.py`, `settings.py`
**Impact**: High
**Effort**: 2-3 hours

> ⚠️ **ALIGNMENT NOTE - Existing Plan System**
> The `claude-limit-tracker.js` already implements plan support with **Free/Pro/Team** tiers.
> Claude-Code-Usage-Monitor uses **Pro/Max5/Max20** (context limits, not API limits).
> These are complementary systems:
> - **claude-limit-tracker.js**: API rate limits (requests/min, requests/day)
> - **Claude-Code-Usage-Monitor plans**: Context window limits (token thresholds)
>
> **Recommendation**: Extend existing system to support both plan taxonomies.
> See `.claude/dev-docs/tasks.md` for integration notes.

**Current Gap**: Multi-agent-template assumes 200k context for everyone. Pro users have ~19k tokens, Max5 has ~88k.

**Proposed Configuration**:
```json
// .claude/config/plans.json
{
  "plans": {
    "pro": { "tokenLimit": 19000, "costLimit": 18.00, "messageLimit": 250 },
    "max5": { "tokenLimit": 88000, "costLimit": 35.00, "messageLimit": 1000 },
    "max20": { "tokenLimit": 220000, "costLimit": 140.00, "messageLimit": 2000 },
    "custom": { "tokenLimit": null, "autoDetect": true }
  },
  "activePlan": "custom"
}
```

**Auto-Detection Strategy**:
When plan is "custom", use P90 calculator on 8-day history to determine actual limit.

---

#### 1.4 Session Gap Detection
**Source**: `analyzer.py`
**Impact**: Medium
**Effort**: 2-3 hours

**Current Gap**: Multi-agent-template tracks active sessions only. Gaps between sessions cause context calculations to drift.

**Algorithm**:
```javascript
function detectGaps(entries, gapThreshold = 30 * 60 * 1000) { // 30 min
  const blocks = [];
  let currentBlock = { entries: [], startTime: null };

  for (const entry of entries) {
    if (currentBlock.entries.length === 0) {
      currentBlock.startTime = entry.timestamp;
    } else {
      const lastEntry = currentBlock.entries.at(-1);
      const gap = entry.timestamp - lastEntry.timestamp;

      if (gap > gapThreshold) {
        blocks.push({ ...currentBlock, isGap: false });
        blocks.push({ isGap: true, duration: gap, tokens: 0 });
        currentBlock = { entries: [], startTime: entry.timestamp };
      }
    }
    currentBlock.entries.push(entry);
  }

  return blocks;
}
```

**Benefits**:
- Accurate session boundary detection
- Better P90 calculations
- Historical trend analysis enablement

---

### Priority 2: Medium-Impact, Medium-Effort

#### 2.1 View Mode System (Realtime/Daily/Monthly)
**Source**: `display_controller.py`, `table_views.py`
**Impact**: Medium
**Effort**: 6-8 hours

**Current Gap**: Dashboard only shows real-time view. No historical aggregation.

**Proposed Views**:

| View | Display | Data Source |
|------|---------|-------------|
| **Realtime** | Current session with progress bars | Live SSE |
| **Daily** | Table of daily totals with trends | SQLite aggregation |
| **Monthly** | Month-over-month comparison | SQLite aggregation |

**Dashboard Additions**:
```html
<div class="view-switcher">
  <button onclick="setView('realtime')" class="active">Realtime</button>
  <button onclick="setView('daily')">Daily</button>
  <button onclick="setView('monthly')">Monthly</button>
</div>

<div id="daily-view" style="display:none">
  <table>
    <tr><th>Date</th><th>Tokens</th><th>Cost</th><th>Sessions</th></tr>
    <!-- Aggregated data -->
  </table>
</div>
```

---

#### 2.2 WCAG-Compliant Color Themes
**Source**: `terminal/colors.py`, `themes.py`
**Impact**: Medium
**Effort**: 4-5 hours

**Current Gap**: Fixed color scheme may have poor contrast on some monitors.

**Proposed Theme System**:
```javascript
const THEMES = {
  light: {
    background: '#ffffff',
    text: '#1a1a1a',
    success: '#005f00',  // 15:1 contrast
    warning: '#d75f00',  // 8:1 contrast
    error: '#8b0000',    // 10:1 contrast
    info: '#00005f'      // 21:1 contrast
  },
  dark: {
    background: '#1a1a1a',
    text: '#e0e0e0',
    success: '#87ff00',  // 15:1 contrast
    warning: '#ffaf00',  // 11:1 contrast
    error: '#ff5f5f',    // 8:1 contrast
    info: '#87d7ff'      // 14:1 contrast
  },
  auto: null // Detected from system
};

function detectTheme() {
  // Check prefers-color-scheme media query
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}
```

---

#### 2.3 Intelligent Notification Cooldowns
**Source**: `utils/notifications.py`
**Impact**: Medium
**Effort**: 2-3 hours

**Current Gap**: Alert system may spam notifications when crossing thresholds repeatedly.

**Cooldown Implementation**:
```javascript
class NotificationManager {
  constructor() {
    this.cooldowns = new Map(); // type -> lastSentTimestamp
    this.defaultCooldown = 24 * 60 * 60 * 1000; // 24 hours
  }

  canSend(type) {
    const lastSent = this.cooldowns.get(type);
    if (!lastSent) return true;
    return Date.now() - lastSent > this.defaultCooldown;
  }

  send(type, message) {
    if (!this.canSend(type)) return false;
    this.cooldowns.set(type, Date.now());
    this.persist(); // Save to JSON
    // Emit notification
    return true;
  }
}
```

**Notification Types**:
- `context_warning` - 50% threshold crossed
- `context_critical` - 65% threshold crossed
- `context_emergency` - 75% threshold crossed
- `plan_exceeded` - Limit reached
- `cost_alert` - Budget threshold

---

#### 2.4 Terminal CLI Mode
**Source**: Entire `cli/`, `ui/` modules
**Impact**: Medium-High
**Effort**: 12-16 hours

**Current Gap**: Multi-agent-template is web-only. Terminal workflows require opening browser.

**Proposal**: Create a lightweight terminal view using `blessed` or `ink` (React for CLI):

```javascript
// monitor-cli.js using ink (React for terminals)
import {render, Box, Text, useInput} from 'ink';

function MonitorApp({data}) {
  return (
    <Box flexDirection="column">
      <Text bold>Claude Context Monitor</Text>
      <ProgressBar
        value={data.contextPercent}
        label={`${data.contextPercent}% (${formatTokens(data.tokens)})`}
      />
      <Text>Burn Rate: {data.burnRate} tokens/min</Text>
      <Text>Time Remaining: {data.timeRemaining}</Text>
    </Box>
  );
}
```

**Benefits**:
- No browser needed
- Lighter resource usage
- Terminal multiplexer friendly (tmux)
- Remote SSH monitoring

---

### Priority 3: Lower Priority / Future Consideration

#### 3.1 Pydantic-Style Configuration Validation
**Source**: `core/settings.py`
**Impact**: Low-Medium
**Effort**: 8-10 hours

Replace current JSON config with schema validation using Zod or AJV:

```javascript
import { z } from 'zod';

const SettingsSchema = z.object({
  plan: z.enum(['pro', 'max5', 'max20', 'custom']).default('custom'),
  refreshRate: z.number().min(1).max(60).default(2),
  theme: z.enum(['light', 'dark', 'classic', 'auto']).default('auto'),
  timezone: z.string().default('auto'),
  alertThresholds: z.object({
    warning: z.number().default(50),
    critical: z.number().default(65),
    emergency: z.number().default(75)
  })
});
```

---

#### 3.2 Atomic File Operations
**Source**: Configuration save logic
**Impact**: Low
**Effort**: 2-3 hours

Prevent configuration corruption on crash:

```javascript
async function atomicWrite(filePath, data) {
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  const backupPath = `${filePath}.bak`;

  // Write to temp
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2));

  // Backup existing
  if (await fs.exists(filePath)) {
    await fs.rename(filePath, backupPath);
  }

  // Atomic rename
  await fs.rename(tempPath, filePath);

  // Clean backup
  await fs.unlink(backupPath).catch(() => {});
}
```

---

#### 3.3 Multi-View Table Aggregation
**Source**: `data/aggregator.py`
**Impact**: Medium
**Effort**: 6-8 hours

Implement time-period aggregation for daily/monthly views:

```javascript
function aggregateByPeriod(entries, periodFn) {
  const groups = new Map();

  for (const entry of entries) {
    const key = periodFn(entry.timestamp);
    if (!groups.has(key)) {
      groups.set(key, { entries: [], tokens: 0, cost: 0 });
    }
    const group = groups.get(key);
    group.entries.push(entry);
    group.tokens += entry.tokens;
    group.cost += entry.cost;
  }

  return Array.from(groups.entries()).map(([key, data]) => ({
    period: key,
    ...data,
    avgTokensPerEntry: data.tokens / data.entries.length
  }));
}

// Usage
const daily = aggregateByPeriod(entries, t => t.toISOString().slice(0, 10));
const monthly = aggregateByPeriod(entries, t => t.toISOString().slice(0, 7));
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
| Task | Effort | Priority |
|------|--------|----------|
| P90 Limit Calculator | 4-6h | Critical |
| Plan Configuration System | 2-3h | Critical |
| Burn Rate Calculator | 3-4h | High |
| Session Gap Detection | 2-3h | High |

**Deliverable**: Intelligent limit detection with burn rate projections

### Phase 2: UX Enhancement (Week 3-4)
| Task | Effort | Priority |
|------|--------|----------|
| View Mode System | 6-8h | Medium |
| Theme System (WCAG) | 4-5h | Medium |
| Notification Cooldowns | 2-3h | Medium |
| Dashboard Burn Rate Display | 3-4h | Medium |

**Deliverable**: Multi-view dashboard with accessibility compliance

### Phase 3: Advanced Features (Week 5-6)
| Task | Effort | Priority |
|------|--------|----------|
| Terminal CLI Mode | 12-16h | Medium |
| Configuration Validation (Zod) | 8-10h | Low |
| Time Period Aggregation | 6-8h | Medium |
| Atomic File Operations | 2-3h | Low |

**Deliverable**: Terminal monitoring with robust configuration

---

## Risk Assessment

### Integration Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| P90 calculation inaccurate for new users | Medium | Low | Fallback to default limits with clear messaging |
| Theme detection fails | Low | Low | Manual override option always available |
| Terminal CLI adds dependencies | Medium | Medium | Make terminal mode optional package |
| Configuration migration breaks existing users | Low | High | Version migration scripts + backup |

### Technical Debt Considerations

1. **Dual UI maintenance**: Adding terminal CLI means maintaining two UIs. Consider shared data layer.

2. **Testing burden**: Each feature needs unit + integration tests. Estimate +30% for test writing.

3. **Documentation**: New features require updated docs. Allocate 2-4 hours per major feature.

---

## Metrics for Success

### Quantitative Goals

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| False positive alerts | ~15% | <5% | User surveys |
| Time to understand context status | ~10s | <3s | Dashboard load + comprehension |
| Plan detection accuracy | 0% (no detection) | >95% | P90 vs actual limit comparison |
| Theme accessibility score | Unknown | WCAG AA | Lighthouse audit |

### Qualitative Goals

- Users no longer manually calculate time remaining
- Dashboard provides actionable next steps
- Terminal workflow users can monitor without browser
- Configuration changes are validated before save

---

## Appendix A: Files to Create/Modify

### New Files
```
.claude/core/p90-limit-calculator.js       # P90 algorithm
.claude/core/burn-rate-calculator.js       # Burn rate + projections
.claude/core/notification-manager.js       # Cooldown system
.claude/core/session-block-analyzer.js     # Gap detection
.claude/core/theme-manager.js              # WCAG themes
.claude/config/plans.json                  # Plan definitions
.claude/config/themes.json                 # Theme definitions
.claude/cli/monitor-cli.js                 # Terminal UI (Phase 3)
```

### Modified Files
```
global-dashboard.html                      # View modes, burn rate display
global-context-manager.js                  # Plan awareness, new API endpoints
.claude/core/global-context-tracker.js     # P90 integration, gap detection
.claude/core/cost-calculator.js            # Plan-aware pricing
package.json                               # New dependencies (blessed/ink, zod)
```

---

## Appendix B: Code Samples from Claude-Code-Usage-Monitor

### P90 Calculator Core Logic (Python → JS Translation)

```javascript
// Translation of p90_calculator.py core algorithm
const LIMIT_DETECTION_THRESHOLD = 0.95;
const KNOWN_LIMITS = [19000, 44000, 88000, 220000];
const DEFAULT_LIMIT = 44000;

function calculateP90Limit(blocks, minSamples = 3) {
  // Step 1: Find blocks that hit limit
  const limitHits = blocks.filter(block => {
    if (block.isGap || block.isActive) return false;
    return KNOWN_LIMITS.some(limit =>
      block.tokens >= limit * LIMIT_DETECTION_THRESHOLD
    );
  });

  // Step 2: Use limit hits if available, else use all inactive
  const samples = limitHits.length >= minSamples
    ? limitHits
    : blocks.filter(b => !b.isGap && !b.isActive);

  if (samples.length < minSamples) return DEFAULT_LIMIT;

  // Step 3: Calculate 90th percentile
  const tokenCounts = samples.map(s => s.tokens).sort((a, b) => a - b);
  const p90Index = Math.floor(tokenCounts.length * 0.9);
  return tokenCounts[p90Index];
}
```

### Burn Rate Projection (Python → JS Translation)

```javascript
// Translation of calculations.py projection logic
function calculateProjections(currentTokens, burnRate, limit, sessionEndTime) {
  const now = Date.now();
  const remainingTokens = limit - currentTokens;

  if (burnRate <= 0) {
    return {
      willExceed: false,
      timeToLimit: Infinity,
      tokenAtSessionEnd: currentTokens
    };
  }

  const minutesToLimit = remainingTokens / burnRate;
  const timeToLimit = new Date(now + minutesToLimit * 60 * 1000);

  const minutesToSessionEnd = (sessionEndTime - now) / 60000;
  const tokensAtEnd = currentTokens + (burnRate * minutesToSessionEnd);

  return {
    willExceed: tokensAtEnd > limit,
    timeToLimit,
    tokensAtSessionEnd: Math.min(tokensAtEnd, limit),
    percentAtSessionEnd: (tokensAtEnd / limit) * 100
  };
}
```

---

## Conclusion

The Claude-Code-Usage-Monitor project offers valuable features that address gaps in multi-agent-template's monitoring capabilities. The **P90 limit detection**, **burn rate calculations**, and **plan awareness** are the highest-value additions that should be prioritized.

The proposed 6-week roadmap balances feature richness with implementation effort, resulting in a comprehensive monitoring solution that combines the strengths of both systems.

### Recommended Next Steps

1. **Approve Phase 1** implementation of P90 + burn rate + plans
2. **Assign development resources** for 2-week sprint
3. **Create feature branch** for integration work
4. **Schedule user testing** with different plan types (Pro, Max5, Max20)

---

**Document Version**: 1.0
**Last Updated**: 2025-12-20
**Authors**: Research Analyst (Claude Opus 4.5), Technical Designer (Claude Opus 4.5)
