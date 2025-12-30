# Context Tracker Consolidation Design

## Overview

Consolidate three context tracking modules into a single unified `GlobalContextTracker`:

| Source Module | Lines | Status | Action |
|--------------|-------|--------|--------|
| `global-context-tracker.js` | 928 | USED (by global-context-manager.js) | **TARGET** - Keep and extend |
| `real-context-tracker.js` | 362 | USED (by context-tracking-bridge.js) | **MERGE** - Extract features, delete |
| `real-time-context-tracker.js` | 810 | ORPHANED | **MERGE** - Extract features, delete |

**Goal**: Single multi-project context tracker with all features from all three modules.

---

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     CURRENT (3 Trackers)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  global-context-manager.js                                      │
│         │                                                       │
│         └──► GlobalContextTracker (multi-project)               │
│              - Watches ~/.claude/projects/*                     │
│              - Per-project sessions                             │
│              - Cost tracking                                    │
│              - Alert thresholds                                 │
│                                                                 │
│  context-tracking-bridge.js                                     │
│         │                                                       │
│         └──► RealContextTracker (single-session)                │
│              - OTLP metric processing                           │
│              - Patches SessionProcessor + OTLPReceiver          │
│                                                                 │
│  (ORPHANED - not imported)                                      │
│         │                                                       │
│         └──► RealTimeContextTracker (single-project)            │
│              - Compaction detection                             │
│              - Velocity tracking                                │
│              - Exhaustion prediction                            │
│              - Dev-docs integration                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     TARGET (1 Unified Tracker)                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  global-context-manager.js ──┐                                  │
│                              │                                  │
│  context-tracking-bridge.js ─┴──► GlobalContextTracker          │
│                                   │                             │
│                                   ├── Multi-project tracking    │
│                                   ├── Per-session tracking      │
│                                   ├── Cost calculation          │
│                                   ├── Alert thresholds          │
│                                   ├── OTLP metric processing    │
│                                   ├── Compaction detection      │
│                                   ├── Velocity tracking         │
│                                   ├── Exhaustion prediction     │
│                                   └── Dev-docs integration      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Features to Consolidate

### From GlobalContextTracker (KEEP)
Already present - no changes needed:
- [x] Multi-project monitoring (`~/.claude/projects/*`)
- [x] Per-project session tracking
- [x] Account-level totals
- [x] Cost calculation with pricing tables
- [x] System overhead calculation (38k tokens)
- [x] File watching with chokidar
- [x] Events: `started`, `session:new`, `usage:update`, `alert:*`
- [x] Threshold levels: warning (50%), critical (65%), emergency (75%)

### From RealContextTracker (MERGE)
Features to add:
- [ ] **OTLP metric processing** - `processOTLPMetric(metric)` method
- [ ] **Session-level context percentage** - `getContextPercentage(sessionId)`
- [ ] **Manual update** - `manualUpdate(sessionId, percentage)` for testing
- [ ] **Active sessions list** - `getActiveSessions()` with context data

### From RealTimeContextTracker (MERGE)
Features to add:
- [ ] **Compaction detection** - Detect when Claude auto-compacts at ~77%
- [ ] **Velocity tracking** - Tokens per second for each session
- [ ] **Exhaustion prediction** - Projected time to context exhaustion
- [ ] **Dev-docs integration** - Update state files on compaction
- [ ] **Recovery instructions** - Generate handoff docs on compaction

---

## API Changes

### New Methods to Add

```javascript
class GlobalContextTracker {
  // Existing methods (unchanged)
  start()
  stop()
  getAllProjects()
  getProject(folder)
  getAccountTotals()
  resetProjectCheckpoints(folder)

  // NEW: From RealContextTracker
  processOTLPMetric(metric)           // Process OTLP metric for a session
  getContextPercentage(sessionId)     // Get context % for specific session
  manualUpdate(projectFolder, sessionId, percentage)  // For testing
  getActiveSessions(projectFolder)    // Get sessions with context data

  // NEW: From RealTimeContextTracker
  getVelocity(projectFolder)          // Get token velocity for project
  getPredictedExhaustion(projectFolder) // Time to exhaustion
  onCompactionDetected(callback)      // Register compaction handler
  generateRecoveryDocs(projectFolder) // Generate handoff docs
}
```

### New Events to Add

```javascript
// Existing events (unchanged)
tracker.on('started', ...)
tracker.on('session:new', ...)
tracker.on('usage:update', ...)
tracker.on('alert:warning', ...)
tracker.on('alert:critical', ...)
tracker.on('alert:emergency', ...)

// NEW events
tracker.on('compaction:detected', { projectFolder, sessionId, contextBefore, contextAfter })
tracker.on('velocity:update', { projectFolder, sessionId, tokensPerSecond })
tracker.on('exhaustion:imminent', { projectFolder, sessionId, minutesRemaining })
```

---

## Implementation Plan

### Phase 1: Add OTLP Processing (from RealContextTracker)

1. Add `processOTLPMetric(metric)` method to GlobalContextTracker
2. Parse metric name and extract session context
3. Update session metrics from OTLP data
4. Emit `usage:update` event

```javascript
processOTLPMetric(metric) {
  // Extract session info from metric attributes
  const sessionId = metric.attributes?.session_id;
  const projectFolder = this._resolveProjectFolder(sessionId);

  // Update token counts based on metric name
  if (metric.name === 'claude_code.tokens.count') {
    // Update session tokens
  }

  this._updateProjectMetrics(project, session);
}
```

### Phase 2: Add Velocity Tracking (from RealTimeContextTracker)

1. Track token timestamps in session data
2. Calculate rolling velocity (tokens/second over last N samples)
3. Emit `velocity:update` events

```javascript
// Add to session data structure
session.velocityHistory = [];  // [{timestamp, tokens}, ...]

// Calculate velocity
getVelocity(projectFolder) {
  const project = this.projects.get(projectFolder);
  const session = project?.sessions.get(project.currentSessionId);
  if (!session?.velocityHistory?.length) return 0;

  const window = session.velocityHistory.slice(-10);
  const timeDelta = (window[window.length-1].timestamp - window[0].timestamp) / 1000;
  const tokenDelta = window[window.length-1].tokens - window[0].tokens;
  return tokenDelta / timeDelta;
}
```

### Phase 3: Add Compaction Detection (from RealTimeContextTracker)

1. Track context percentage history
2. Detect sudden drops (>20% decrease = compaction)
3. Emit `compaction:detected` event
4. Generate recovery documentation

```javascript
// In _updateProjectMetrics
const previousPercent = project.metrics.contextPercent;
const currentPercent = newPercent;

// Detect compaction (sudden large drop)
if (previousPercent > 50 && (previousPercent - currentPercent) > 20) {
  this.emit('compaction:detected', {
    projectFolder: project.folder,
    sessionId: project.currentSessionId,
    contextBefore: previousPercent,
    contextAfter: currentPercent
  });

  this._generateRecoveryDocs(project);
}
```

### Phase 4: Add Exhaustion Prediction (from RealTimeContextTracker)

1. Use velocity to project exhaustion time
2. Emit `exhaustion:imminent` when < 5 minutes remaining
3. Add to project metrics

```javascript
getPredictedExhaustion(projectFolder) {
  const project = this.projects.get(projectFolder);
  const velocity = this.getVelocity(projectFolder);

  if (velocity <= 0) return Infinity;

  const remaining = this.contextWindowSize - project.metrics.contextUsed;
  const secondsRemaining = remaining / velocity;
  return secondsRemaining / 60; // minutes
}
```

### Phase 5: Update Context Tracking Bridge

1. Update `context-tracking-bridge.js` to use GlobalContextTracker
2. Remove dependency on RealContextTracker
3. Adapt event handlers for new event structure

```javascript
// Before
const RealContextTracker = require('./real-context-tracker');
this.tracker = new RealContextTracker({...});

// After
const GlobalContextTracker = require('./global-context-tracker');
this.tracker = new GlobalContextTracker({...});
// OR use existing shared instance
this.tracker = options.globalTracker;
```

### Phase 6: Update Tests

1. Update E2E tests in `tests/e2e/context-tracking.e2e.test.js`
2. Add unit tests for new methods
3. Add integration tests for OTLP processing
4. Add tests for compaction detection

### Phase 7: Delete Deprecated Files

1. Delete `.claude/core/real-context-tracker.js`
2. Delete `.claude/core/real-time-context-tracker.js`
3. Update any remaining imports

---

## Migration Checklist

### Pre-Migration
- [ ] Backup current files
- [ ] Document current test coverage
- [ ] Identify all consumers of each tracker

### During Migration
- [ ] Add new methods incrementally
- [ ] Run tests after each phase
- [ ] Maintain backward compatibility

### Post-Migration
- [ ] Delete deprecated files
- [ ] Update documentation
- [ ] Run full test suite
- [ ] Manual testing with dashboard

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking dashboard | High | Phased migration, test each step |
| Losing OTLP processing | Medium | Port method exactly, test with mock data |
| Performance degradation | Low | Velocity calculation is lightweight |
| Missing compaction events | Low | Add comprehensive tests |

---

## Success Criteria

1. Single `GlobalContextTracker` handles all use cases
2. `context-tracking-bridge.js` works with unified tracker
3. Dashboard continues to function correctly
4. All new features (velocity, compaction, exhaustion) working
5. Test coverage maintained or improved
6. No runtime errors in production
7. `real-context-tracker.js` and `real-time-context-tracker.js` deleted

---

## Dashboard Consolidation (INCLUDED)

**THREE dashboard systems exist - consolidating into ONE:**

| Component | Port | Lines | Fate |
|-----------|------|-------|------|
| `global-context-manager.js` | 3033 | 2232 | **TARGET** - Keep and extend |
| `dashboard-manager.js` | 3030 | ~500 | **DELETE** - Migrate features first |
| `start-enhanced-dashboard.js` | 3033 | ~300 | **DELETE** - Merge OTLP features |
| `context-tracking-bridge.js` | - | 340 | **DELETE** - No longer needed |

### PRINCIPLE: NO PARALLEL DASHBOARDS

After consolidation, there must be **exactly ONE dashboard server** (port 3033).

### Features to Merge from start-enhanced-dashboard.js

The enhanced dashboard has OTLP reception capabilities that must be added:

```javascript
// From start-enhanced-dashboard.js - add to global-context-manager.js
const OTLPReceiver = require('./otlp-receiver');
const SessionAwareMetricProcessor = require('./session-aware-metric-processor');
const OTLPCheckpointBridge = require('./otlp-checkpoint-bridge');
const OTLPDashboardExtension = require('./otlp-dashboard-extension');
```

### Features to Merge from dashboard-manager.js

Four features from DashboardManager must be migrated to global-context-manager.js:

| Feature | Endpoints | Description | Effort |
|---------|-----------|-------------|--------|
| Artifact Tracking | `GET /api/artifacts` | Track files created during execution | Low |
| Human Review Queue | `GET /api/reviews`, `POST /api/review/:id` | UI for HumanInLoopDetector decisions | Medium |
| Config Update API | `POST /api/config` | Live settings modification | Low |
| File Reading API | `GET /api/file` | Read project files (security-scoped) | Low |

```javascript
// Add to global-context-manager.js state
this.state = {
  // ... existing state ...
  artifacts: [],  // NEW: Track created files
  humanReview: {  // NEW: Human review queue
    pending: [],
    history: []
  }
};

// Add endpoints
app.get('/api/artifacts', (req, res) => {
  res.json(state.artifacts);
});

app.get('/api/reviews', (req, res) => {
  res.json({
    pending: state.humanReview.pending,
    history: state.humanReview.history.slice(0, 20)
  });
});

app.post('/api/review/:reviewId', async (req, res) => {
  // Handle human review response
  // This integrates with HumanInLoopDetector in autonomous-orchestrator.js
});

app.post('/api/config', async (req, res) => {
  // Update settings in .claude/settings.local.json
});

app.get('/api/file', (req, res) => {
  // Read file content (security: only within project directory)
});
```

### Single Dashboard Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                 UNIFIED DASHBOARD (port 3033)                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Data Sources (both active):                                    │
│  ├── File Watching (~/.claude/projects/*.jsonl)                 │
│  └── OTLP Reception (port 4318, optional)                       │
│                                                                 │
│  GlobalContextTracker (unified)                                 │
│  ├── Multi-project tracking                                     │
│  ├── OTLP metric processing                                     │
│  ├── Velocity tracking                                          │
│  ├── Compaction detection                                       │
│  └── Exhaustion prediction                                      │
│                                                                 │
│  APIs:                                                          │
│  ├── /api/projects, /api/account, /api/alerts                   │
│  ├── /api/events (SSE)                                          │
│  ├── /api/tasks, /api/execution                                 │
│  └── /api/sessions, /api/usage                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation: Dashboard Consolidation Phase

Add after Phase 7 (Cleanup):

**Phase 8: Add OTLP Reception to global-context-manager.js**
1. Import OTLPReceiver and SessionAwareMetricProcessor
2. Initialize OTLP receiver on configurable port (default 4318)
3. Wire OTLP metrics to GlobalContextTracker.processOTLPMetric()
4. Make OTLP optional (enabled via env var)

**Phase 9: Delete Redundant Files**
1. Delete `scripts/start-enhanced-dashboard.js`
2. Delete `.claude/core/context-tracking-bridge.js`
3. Update any scripts that reference these files
4. Update documentation

---

## Files to Modify

| File | Action |
|------|--------|
| `.claude/core/global-context-tracker.js` | ADD: OTLP, velocity, compaction, exhaustion |
| `global-context-manager.js` | ADD: OTLP reception, merge enhanced dashboard features |
| `tests/e2e/context-tracking.e2e.test.js` | UPDATE: Test new features |

## Files to Delete

| File | Lines | Reason |
|------|-------|--------|
| `.claude/core/real-context-tracker.js` | 362 | Merged into GlobalContextTracker |
| `.claude/core/real-time-context-tracker.js` | 810 | Merged into GlobalContextTracker |
| `.claude/core/context-tracking-bridge.js` | 340 | No longer needed with unified dashboard |
| `scripts/start-enhanced-dashboard.js` | ~300 | Merged into global-context-manager.js |

**Total lines removed (context trackers)**: ~1,812 lines

---

## Orchestrator Consolidation (ADDED)

### Current State

```
┌─────────────────────────────────────────────────────────────────┐
│                 CURRENT (2 Orchestrators)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  autonomous-orchestrator.js (KEEP)                              │
│  ├── Actually spawns Claude Code processes                      │
│  ├── Phase-based task execution                                 │
│  ├── SwarmController (security, complexity, confidence)         │
│  ├── MemoryStore integration                                    │
│  └── SessionRegistry integration                                │
│                                                                 │
│  continuous-loop-orchestrator.js (ELIMINATE)                    │
│  ├── DashboardManager (port 3030) - DUPLICATE                   │
│  ├── ClaudeLimitTracker - NOT NEEDED (API limits, not CLI)      │
│  ├── ClaudeCodeUsageParser - Only for DashboardManager          │
│  ├── CheckpointOptimizer - Used by deleted components           │
│  └── HumanInLoopDetector - MIGRATE TO autonomous-orchestrator   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### HumanInLoopDetector - The One Capability to Preserve

```javascript
// HumanInLoopDetector detects when AI should pause for human input:
// - High-risk operations: deploy, production, delete database, security, payments
// - Design decisions: architecture, technology selection, trade-offs
// - Manual verification: visual inspection, user acceptance testing
// - Strategic decisions: business direction, priorities, investments
// - Legal/compliance reviews

// Features:
// - Pattern recognition from historical stops
// - Confidence scoring (0.7-0.95 thresholds)
// - Adaptive thresholds based on feedback
// - Learning from false positives/negatives
```

### Phase 8: Orchestrator Consolidation

1. **Import HumanInLoopDetector** in autonomous-orchestrator.js
2. **Initialize** with MemoryStore for persistence
3. **Call checkNeedsHumanReview()** before executing tasks
4. **If triggered**: Pause, notify, wait for human approval
5. **Delete continuous-loop system files**:
   - `.claude/core/continuous-loop-orchestrator.js` (1513 lines)
   - `.claude/core/deprecated/continuous-loop-orchestrator.js` (1513 lines)
   - `.claude/core/dashboard-manager.js` (~500 lines)
   - `.claude/core/claude-limit-tracker.js` (~200 lines)

### Additional Files to Delete (Orchestrator)

| File | Lines | Reason |
|------|-------|--------|
| `.claude/core/continuous-loop-orchestrator.js` | 1513 | Replaced by autonomous-orchestrator |
| `.claude/core/deprecated/continuous-loop-orchestrator.js` | 1513 | Duplicate of above |
| `.claude/core/dashboard-manager.js` | ~500 | Duplicates global-context-manager.js |
| `.claude/core/claude-limit-tracker.js` | ~200 | API limits not needed for Claude Code CLI |

**Additional lines removed**: ~3,726 lines

---

## Database Path Consolidation (ADDED)

### Current State (4 Different Paths)

| Path | Consumer | Status |
|------|----------|--------|
| `.claude/data/memory.db` | autonomous-orchestrator.js | KEEP (target) |
| `.claude/memory/orchestrations.db` | MemoryStore default | MIGRATE |
| `.claude/memory/memory-store.db` | start-continuous-loop.js | DELETE (with consumer) |
| `.claude/memory/dashboard.db` | start-enhanced-dashboard.js | DELETE (with consumer) |

### Phase 9: Database Consolidation

1. **Update MemoryStore default path** to `.claude/data/memory.db`
2. **Remove hardcoded paths** in consumers
3. **Migrate data** from orchestrations.db if needed
4. **Delete** orphaned DB files after verification

---

## Estimated Effort (UPDATED)

| Phase | Effort | Description |
|-------|--------|-------------|
| Phase 1: OTLP Processing | 2h | Add processOTLPMetric() to GlobalContextTracker |
| Phase 2: Velocity Tracking | 1h | Add tokens/sec tracking |
| Phase 3: Compaction Detection | 2h | Detect auto-compact, generate recovery docs |
| Phase 4: Exhaustion Prediction | 1h | Add time-to-exhaustion calculation |
| Phase 5: Dashboard OTLP Integration | 2h | Add OTLP receiver to global-context-manager.js |
| Phase 6: Dashboard Feature Migration | 2h | Add artifacts, reviews, config, file APIs |
| Phase 7: Update Tests | 2h | E2E and unit tests for new features |
| Phase 8: Delete Context Tracker Files | 30m | Remove 4 files, update imports |
| Phase 9: Orchestrator Consolidation | 2h | Migrate HumanInLoopDetector, delete continuous-loop |
| Phase 10: Database Consolidation | 1h | Consolidate to single DB path |
| Phase 11: Documentation Updates | 2h | Update/archive 10+ docs referencing deleted components |
| **Total** | **~18h** |

---

## Documentation Updates

### Documents to DELETE/ARCHIVE

| Document | Action | Reason |
|----------|--------|--------|
| `CONTINUOUS-LOOP-QUICKSTART.md` | DELETE or rewrite | References eliminated system |
| `docs/CONTINUOUS-LOOP-SYSTEM.md` | ARCHIVE to docs/archive/ | System eliminated |
| `__tests__/CONTINUOUS-LOOP-TESTS.md` | DELETE | Tests being deleted |

### Documents to UPDATE

| Document | Changes Needed |
|----------|----------------|
| `docs/INTEGRATION-GUIDE.md` | Remove references to dashboard-manager, start-enhanced-dashboard |
| `docs/DASHBOARD-FEATURES.md` | Update to reflect single dashboard on port 3033 |
| `docs/DASHBOARD-UX-REDESIGN.md` | Update architecture diagrams |
| `.claude/core/README.md` | Rewrite - lists 7 components but 80+ exist |
| `docs/MEMORY_SYSTEM.md` | Update database paths to .claude/data/memory.db |
| `docs/LIVE-USAGE-MONITORING.md` | Update monitoring architecture |
| `docs/USAGE-TRACKER-SPECIFICATION.md` | Update after usage consolidation |

### Documents to ARCHIVE (stale)

Move to `docs/archive/`:
- `docs/IMPLEMENTATION-ROADMAP.md`
- `docs/AGENT-MIGRATION-PLAN.md`
- `docs/AGENT-MIGRATION-COMPLETE.md`
- `docs/CLAUDE-MEM-INTEGRATION-PLAN.md`
- `docs/LEAN-INTEGRATION-ROADMAP.md`
- `docs/INTELLIGENCE-LAYER-IMPLEMENTATION-CHECKLIST.md`
- `SESSION_2_COMPLETION_REPORT.md`
- `SESSION_3_COMPLETION_REPORT.md`

---

## Test Cleanup

### Tests to DELETE (components being removed)

| Test File | Component | Reason |
|-----------|-----------|--------|
| `__tests__/integration/continuous-loop-system.test.js` | ContinuousLoopOrchestrator | System eliminated |
| `__tests__/core/dashboard-manager.test.js` | DashboardManager | Features migrated to global-context-manager |
| `__tests__/core/claude-limit-tracker.test.js` | ClaudeLimitTracker | Not needed for Claude Code CLI |

### Tests to KEEP (component migrated, not deleted)

| Test File | Component | Reason |
|-----------|-----------|--------|
| `__tests__/core/human-in-loop-detector.test.js` | HumanInLoopDetector | Component preserved, migrated to autonomous-orchestrator |

### Tests to CREATE (migrated features)

Add to global-context-manager tests:
- Tests for `GET /api/artifacts` - artifact tracking
- Tests for `GET /api/reviews` - human review queue listing
- Tests for `POST /api/review/:id` - human review response handling
- Tests for `POST /api/config` - live config updates
- Tests for `GET /api/file` - file reading (with security boundary tests)

---

## Total Savings Summary

| Category | Files | Lines |
|----------|-------|-------|
| Context Trackers | 3 | ~1,512 |
| Dashboard Systems | 2 | ~800 |
| Orchestrators | 2 | ~3,026 |
| Limit Tracker | 1 | ~200 |
| Tests | 3 | ~500 |
| **Total** | **11** | **~6,038** |

---

## Final Architecture

After consolidation, the system will have:

```
┌─────────────────────────────────────────────────────────────────┐
│                    FINAL ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  global-context-manager.js (port 3033) - THE ONLY DASHBOARD     │
│  ├── 70+ API endpoints                                          │
│  ├── GlobalContextTracker (OTLP + file watching)                │
│  ├── Artifact tracking                                          │
│  ├── Human review queue (for HumanInLoopDetector)               │
│  ├── Config update API                                          │
│  └── SSE real-time updates                                      │
│                                                                 │
│  autonomous-orchestrator.js - THE ONLY ORCHESTRATOR             │
│  ├── Spawns Claude Code processes                               │
│  ├── SwarmController (safety, complexity, confidence)           │
│  ├── HumanInLoopDetector (migrated)                             │
│  └── Phase-based task execution                                 │
│                                                                 │
│  .claude/data/memory.db - THE ONLY DATABASE                     │
│  └── All orchestrations, observations, agent stats              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

NO PARALLEL DASHBOARDS
NO PARALLEL ORCHESTRATORS
NO FRAGMENTED DATABASES
```
