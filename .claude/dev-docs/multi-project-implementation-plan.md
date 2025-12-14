# Multi-Project Continuous Loop Implementation Plan

**Created**: 2025-12-13
**Status**: Planning
**Architecture**: Option A - Centralized Multi-Project Manager
**Estimated Effort**: 24-32 hours

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Implementation Phases](#implementation-phases)
4. [Component Specifications](#component-specifications)
5. [Multi-Project Task Tracking](#multi-project-task-tracking)
6. [Database Schema Changes](#database-schema-changes)
7. [API Specifications](#api-specifications)
8. [Dashboard UI Changes](#dashboard-ui-changes)
9. [Testing Strategy](#testing-strategy)
10. [Migration Path](#migration-path)
11. [Risk Assessment](#risk-assessment)
12. [Success Criteria](#success-criteria)

---

## Executive Summary

### Current State
- Single-project continuous loop system
- Hardcoded port 3030
- Single PID file per installation
- No cross-project coordination
- Manual project switching required

### Target State
- Multi-project orchestration from central manager
- Unified dashboard showing all projects
- Auto-allocated ports per project (3031+)
- Shared API limit tracking across projects
- Cross-project cost aggregation
- Global project registry

### Benefits
- **Developer Productivity**: Monitor multiple projects simultaneously
- **Resource Optimization**: Shared API quota management
- **Cost Visibility**: Aggregated cost tracking across all work
- **Operational Efficiency**: Single dashboard for all projects
- **Scalability**: Support 10+ concurrent projects

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│              Multi-Project Orchestrator Manager                  │
│                  (~/.claude-multi-project/)                      │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Project Registry (registry.json)                           │ │
│  │                                                             │ │
│  │ {                                                           │ │
│  │   "a8c3f2": {                                              │ │
│  │     "id": "a8c3f2",                                        │ │
│  │     "path": "/home/user/project-1",                       │ │
│  │     "name": "project-1",                                  │ │
│  │     "port": 3031,                                         │ │
│  │     "pid": 12345,                                         │ │
│  │     "status": "running",                                  │ │
│  │     "startedAt": "2025-12-13T10:00:00Z"                  │ │
│  │   },                                                       │ │
│  │   "b9d4e7": { ... }                                       │ │
│  │ }                                                           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Unified Dashboard (Port 3030)                              │ │
│  │                                                             │ │
│  │  GET /                    -> Multi-project dashboard HTML  │ │
│  │  GET /events              -> SSE for all projects          │ │
│  │  GET /api/projects        -> List all projects             │ │
│  │  GET /api/metrics         -> Aggregated metrics            │ │
│  │  POST /api/projects/:id   -> Start/stop project           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Shared Services                                            │ │
│  │  - SharedAPILimitTracker  (global quota management)       │ │
│  │  - CostAggregator         (cross-project costs)           │ │
│  │  - PortAllocator          (port 3031-3100 pool)           │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                     │              │              │
                     ▼              ▼              ▼
            ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
            │   Project 1   │ │   Project 2   │ │   Project 3   │
            │   (a8c3f2)    │ │   (b9d4e7)    │ │   (c1e8f9)    │
            ├───────────────┤ ├───────────────┤ ├───────────────┤
            │ Loop (3031)   │ │ Loop (3032)   │ │ Loop (3033)   │
            │ State         │ │ State         │ │ State         │
            │ Memory DB     │ │ Memory DB     │ │ Memory DB     │
            └───────────────┘ └───────────────┘ └───────────────┘
```

---

## Implementation Phases

### Phase 0: Dashboard Testing (PREREQUISITE) (6-12 hours)

**Goal**: Establish test coverage for dashboard functionality before multi-project implementation

**Status**: ✅ Phase 1 Complete, Phases 2-4 Stubbed
**Priority**: 🔴 HIGH - Must complete before multi-project work

#### 0.1 Phase 1: DashboardManager Core Tests (4 hours) ✅ COMPLETE
- [x] Create `__tests__/core/dashboard-manager.test.js`
- [x] Test initialization and state structure
- [x] Test `updateExecutionPlan()` method
- [x] Test `updateExecution()` method
- [x] Test `addArtifact()` method
- [x] Test metrics updates from UsageTracker
- [x] Test context window calculations
- [x] Test `getState()` serialization
- [x] Test event tracking and timeline
- [x] Test lifecycle (start/stop)
- [x] Test message bus integration

**Files Created**:
- `__tests__/core/dashboard-manager.test.js` (550+ lines, comprehensive coverage)

**Test Coverage Achieved**: ~90% of DashboardManager core functionality

#### 0.2 Phase 2: SSE Integration Tests (3 hours) ⏳ STUBBED
- [ ] Create `__tests__/integration/dashboard-sse.test.js`
- [ ] Test SSE connection establishment
- [ ] Test event broadcasting (metrics, plan, execution, artifacts)
- [ ] Test real-time updates (<2s latency)
- [ ] Test multiple concurrent connections (10+)
- [ ] Test connection cleanup on disconnect
- [ ] Test backpressure handling

**Files Created**:
- `__tests__/integration/dashboard-sse.test.js` (stub with TODOs)

**Dependencies**:
- `eventsource` package for Node.js SSE testing
- Phase 1 tests passing
- Web dashboard enabled in tests

#### 0.3 Phase 3: Orchestrator Integration Tests (3 hours) ⏳ STUBBED
- [ ] Create `__tests__/integration/orchestrator-dashboard.test.js`
- [ ] Test usage tracking flow (UsageTracker → Dashboard)
- [ ] Test execution plan updates
- [ ] Test checkpoint event propagation
- [ ] Test human review queue management
- [ ] Test context window tracking accuracy
- [ ] Test event propagation integrity

**Files Created**:
- `__tests__/integration/orchestrator-dashboard.test.js` (stub with TODOs)

**Dependencies**:
- Phases 1-2 passing
- ContinuousLoopOrchestrator tests passing

#### 0.4 Phase 4: Web Endpoint Tests (2 hours) ⏳ STUBBED
- [ ] Create `__tests__/integration/dashboard-web.test.js`
- [ ] Test all HTTP endpoints (GET /, /api/state, /api/metrics, etc.)
- [ ] Test error handling (404, 500)
- [ ] Test security (directory traversal, XSS prevention)
- [ ] Test CORS headers

**Files Created**:
- `__tests__/integration/dashboard-web.test.js` (stub with TODOs)

**Dependencies**:
- `supertest` package for HTTP testing
- Phases 1-3 passing
- Can be deferred until after multi-project implementation

**Why This is a Prerequisite**:
1. 🔴 **Zero current test coverage** for dashboard functionality
2. 🔴 **Multi-project dashboard is 10x more complex** - needs solid foundation
3. 🔴 **Risk of silent failures** in production without tests
4. 🔴 **Data integrity** - token counts, costs, progress tracking must be verified
5. 🟡 **Debugging** - Without tests, issues in multi-project will be very hard to diagnose

**Acceptance Criteria**:
- [x] Phase 1 complete (core tests passing)
- [ ] Phase 2 complete (SSE tests passing) - **recommended before multi-project**
- [ ] Phase 3 complete (integration tests passing) - **recommended before multi-project**
- [ ] Phase 4 complete (web tests passing) - can be done later
- [ ] All tests passing with ≥85% coverage
- [ ] No flaky tests
- [ ] Test execution time <10 seconds

**Reference Documentation**:
- See `.claude/dev-docs/dashboard-testing-gaps.md` for detailed gap analysis

---

### Phase 1: Core Infrastructure (8-10 hours)

**Goal**: Create foundational multi-project components

#### 1.1 Global Registry System (2 hours)
- [ ] Create `~/.claude-multi-project/` directory structure
- [ ] Implement `ProjectRegistry` class
- [ ] Add project registration/deregistration
- [ ] Implement project ID generation (hash-based)
- [ ] Add persistence to `registry.json`

**Files to Create**:
- `.claude/core/project-registry.js`
- `.claude/core/project-id-generator.js`

**Acceptance Criteria**:
- Registry persists across restarts
- Project IDs are stable for same path
- Thread-safe concurrent access
- Handles corrupted registry gracefully

#### 1.2 Port Allocation System (2 hours)
- [ ] Implement `PortAllocator` class
- [ ] Port range: 3031-3100 (70 projects max)
- [ ] Port availability checking
- [ ] Port reservation and release
- [ ] Conflict detection and resolution

**Files to Create**:
- `.claude/core/port-allocator.js`

**Acceptance Criteria**:
- No port conflicts between projects
- Detects and skips ports in use by other apps
- Releases ports when projects stop
- Handles port exhaustion gracefully

#### 1.3 Multi-Project Orchestrator (4 hours)
- [ ] Create `MultiProjectOrchestrator` class
- [ ] Implement `registerProject(projectPath, config)`
- [ ] Implement `startProject(projectId)`
- [ ] Implement `stopProject(projectId)`
- [ ] Implement `stopAll()`
- [ ] Add event aggregation from all projects
- [ ] Add health monitoring for all projects

**Files to Create**:
- `.claude/core/multi-project-orchestrator.js`

**Acceptance Criteria**:
- Can manage 10+ projects simultaneously
- Isolated failures (one project crash doesn't affect others)
- Proper cleanup on shutdown
- Event propagation from projects to manager

---

### Phase 2: Component Updates (8-10 hours)

**Goal**: Adapt existing components for multi-project support

#### 2.1 ContinuousLoopManager Enhancement (2 hours)
- [ ] Add `projectId` to constructor options
- [ ] Change PID file location to `~/.claude-multi-project/pids/${projectId}.pid`
- [ ] Accept allocated port instead of hardcoded 3030
- [ ] Add project metadata to PID file
- [ ] Update `isRunning()` to use project-specific PID

**Files to Modify**:
- `.claude/core/continuous-loop-manager.js` (lines 17-23, 47-72, 78-160)

**Acceptance Criteria**:
- Multiple projects can run without PID conflicts
- Each project uses assigned port
- PID files cleaned up properly on exit

#### 2.2 ContinuousLoopOrchestrator Enhancement (2 hours)
- [ ] Add `projectId` and `projectPath` to constructor
- [ ] Pass project context to all components
- [ ] Add project info to session state
- [ ] Namespace events with project ID
- [ ] Update checkpoint records with project ID

**Files to Modify**:
- `.claude/core/continuous-loop-orchestrator.js` (lines 37-77, 168-195)

**Acceptance Criteria**:
- State isolated per project
- Events distinguishable by project
- Checkpoints tagged with project ID

#### 2.3 UsageTracker Enhancement (2 hours)
- [ ] Add `projectId` and `projectPath` to options
- [ ] Include project info in all usage records
- [ ] Namespace session usage by project
- [ ] Add `getProjectUsage(projectId)` method
- [ ] Add `getAggregatedUsage()` method

**Files to Modify**:
- `.claude/core/usage-tracker.js` (lines 35-93, 111-165)

**Acceptance Criteria**:
- Usage tracked per project
- Can query usage by project ID
- Aggregation across projects works
- Cost breakdown by project available

#### 2.4 DashboardManager Enhancement (2 hours)
- [ ] Add `projectId` and `projectPath` to constructor
- [ ] Add `useUnifiedDashboard` mode flag
- [ ] Implement `_registerWithUnifiedDashboard()`
- [ ] Use allocated port in standalone mode
- [ ] Add project context to dashboard state

**Files to Modify**:
- `.claude/core/dashboard-manager.js` (lines 35-130, 186-206, 666-827)

**Acceptance Criteria**:
- Can run standalone (per-project dashboard)
- Can register with unified dashboard
- Project info visible in dashboard state
- No port conflicts in standalone mode

---

### Phase 3: Unified Dashboard (6-8 hours)

**Goal**: Create centralized dashboard for all projects

#### 3.1 UnifiedDashboard Backend (3 hours)
- [ ] Create `UnifiedDashboard` class
- [ ] Implement Express server on port 3030
- [ ] Add project registration endpoint
- [ ] Implement SSE for multi-project updates
- [ ] Add metrics aggregation
- [ ] Add project control endpoints (start/stop)

**Files to Create**:
- `.claude/core/unified-dashboard.js`

**API Endpoints**:
```javascript
GET  /                              // Multi-project HTML dashboard
GET  /events                        // SSE updates for all projects
GET  /api/projects                  // List all registered projects
GET  /api/projects/:id              // Get project details
GET  /api/projects/:id/state        // Get project state
POST /api/projects/:id/start        // Start a project
POST /api/projects/:id/stop         // Stop a project
POST /api/projects/:id/restart      // Restart a project
GET  /api/metrics/aggregate         // Aggregated metrics
GET  /api/metrics/by-project        // Per-project breakdown
```

**Acceptance Criteria**:
- Single dashboard shows all projects
- Real-time updates via SSE
- Can control projects from dashboard
- Aggregated metrics accurate

#### 3.2 Multi-Project Dashboard UI (3 hours)
- [ ] Design multi-project layout
- [ ] Add project selector (tabs or dropdown)
- [ ] Create aggregated metrics view
- [ ] Add per-project detail views
- [ ] Implement project status indicators
- [ ] Add start/stop/restart controls

**Files to Create**:
- `.claude/core/unified-dashboard-html.js`

**UI Components**:
```
┌─────────────────────────────────────────────────────────┐
│  🤖 Claude Multi-Project Monitor                        │
├─────────────────────────────────────────────────────────┤
│  [All Projects ▼] [Project 1] [Project 2] [Project 3]  │
├─────────────────────────────────────────────────────────┤
│  Aggregated Metrics                                     │
│  ┌────────────┬────────────┬────────────┬─────────────┐│
│  │ Total Cost │ Total Usage│ Projects   │ API Limit   ││
│  │   $12.45   │ 1.2M tokens│   3/10     │  45% used   ││
│  └────────────┴────────────┴────────────┴─────────────┘│
├─────────────────────────────────────────────────────────┤
│  Project Details                                        │
│  ┌─────────────────────────────────────────────────────┐│
│  │ 🟢 project-1                    [Stop] [Restart]    ││
│  │    Cost: $4.20 | Tokens: 450K | Port: 3031         ││
│  │    Phase: implementation | Agent: Senior Developer  ││
│  ├─────────────────────────────────────────────────────┤│
│  │ 🟢 project-2                    [Stop] [Restart]    ││
│  │    Cost: $6.15 | Tokens: 680K | Port: 3032         ││
│  │    Phase: testing | Agent: Test Engineer           ││
│  ├─────────────────────────────────────────────────────┤│
│  │ 🔴 project-3                    [Start]             ││
│  │    Status: Stopped                                  ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

**Acceptance Criteria**:
- Clean, readable multi-project view
- Project switching is smooth
- Aggregated metrics update in real-time
- Start/stop controls work reliably

---

### Phase 4: Shared Services (4-6 hours)

**Goal**: Implement cross-project resource management

#### 4.1 Shared API Limit Tracker (2 hours)
- [ ] Create `SharedAPILimitTracker` class
- [ ] Track global API quota (not per-project)
- [ ] Implement fair quota allocation
- [ ] Add per-project usage visibility
- [ ] Prevent quota exhaustion by single project

**Files to Create**:
- `.claude/core/shared-api-limit-tracker.js`

**Features**:
```javascript
class SharedAPILimitTracker {
  constructor(options = {}) {
    this.globalLimits = {
      callsPerMinute: 50,
      callsPerDay: 1000,
      tokensPerMinute: 40000,
      tokensPerDay: 1000000
    };

    this.projectUsage = new Map(); // projectId -> usage
    this.fairShareEnabled = true;
  }

  async canMakeCall(projectId, estimatedTokens) {
    // Check global quota
    if (this._isGlobalQuotaExceeded()) {
      return { allowed: false, reason: 'global-quota-exceeded' };
    }

    // Check fair-share limit (optional)
    if (this.fairShareEnabled) {
      const projectQuota = this._calculateProjectQuota(projectId);
      if (this._isProjectQuotaExceeded(projectId, projectQuota)) {
        return { allowed: false, reason: 'project-quota-exceeded' };
      }
    }

    return { allowed: true };
  }

  _calculateProjectQuota(projectId) {
    const activeProjects = this.projectUsage.size;
    return {
      callsPerMinute: Math.floor(this.globalLimits.callsPerMinute / activeProjects),
      tokensPerMinute: Math.floor(this.globalLimits.tokensPerMinute / activeProjects)
    };
  }
}
```

**Acceptance Criteria**:
- Single global quota tracked accurately
- Projects cannot exhaust quota
- Fair-share allocation works
- Quota resets properly (per minute/day)

#### 4.2 Cost Aggregator (2 hours)
- [ ] Create `CostAggregator` class
- [ ] Aggregate costs across all projects
- [ ] Support time-based queries (hour, day, month)
- [ ] Per-project cost breakdown
- [ ] Budget tracking across all projects

**Files to Create**:
- `.claude/core/cost-aggregator.js`

**Features**:
```javascript
class CostAggregator {
  async getAggregatedCosts(timeframe = 'day') {
    // Query all projects' usage databases
    const projectCosts = await this._queryAllProjects(timeframe);

    return {
      total: projectCosts.reduce((sum, p) => sum + p.cost, 0),
      byProject: projectCosts.map(p => ({
        projectId: p.id,
        projectName: p.name,
        cost: p.cost,
        tokens: p.tokens,
        percentage: p.cost / total * 100
      })),
      byModel: this._aggregateByModel(projectCosts),
      byPattern: this._aggregateByPattern(projectCosts)
    };
  }
}
```

**Acceptance Criteria**:
- Accurate cost aggregation
- Fast queries (<100ms for day, <500ms for month)
- Breakdown by project/model/pattern
- Budget alerts work across projects

---

### Phase 5: Database Schema (2-3 hours)

**Goal**: Add multi-project support to databases

#### 5.1 Schema Migration (2 hours)
- [ ] Create migration script
- [ ] Add `project_id` column to tables
- [ ] Add `project_path` column to tables
- [ ] Create indexes for multi-project queries
- [ ] Migrate existing data (assign default project)

**Migration Script**:
```sql
-- .claude/migrations/001_add_project_support.sql

-- Add project columns to usage_records
ALTER TABLE usage_records ADD COLUMN project_id TEXT;
ALTER TABLE usage_records ADD COLUMN project_path TEXT;

-- Add project columns to checkpoints
ALTER TABLE checkpoints ADD COLUMN project_id TEXT;
ALTER TABLE checkpoints ADD COLUMN project_path TEXT;

-- Add project columns to executions (if exists)
ALTER TABLE executions ADD COLUMN project_id TEXT;
ALTER TABLE executions ADD COLUMN project_path TEXT;

-- Add project columns to human_reviews (if exists)
ALTER TABLE human_reviews ADD COLUMN project_id TEXT;

-- Create indexes for efficient multi-project queries
CREATE INDEX IF NOT EXISTS idx_usage_project_time
  ON usage_records(project_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_checkpoints_project
  ON checkpoints(project_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_executions_project
  ON executions(project_id, timestamp);

-- Migrate existing data to default project
UPDATE usage_records
  SET project_id = 'default',
      project_path = (SELECT value FROM metadata WHERE key = 'project_root')
  WHERE project_id IS NULL;

UPDATE checkpoints
  SET project_id = 'default'
  WHERE project_id IS NULL;
```

**Files to Create**:
- `.claude/migrations/001_add_project_support.sql`
- `.claude/core/database-migrator.js`

**Acceptance Criteria**:
- Migration runs without errors
- Existing data preserved
- Indexes improve query performance
- Rollback capability exists

#### 5.2 Query Updates (1 hour)
- [ ] Update all SQL queries to include `project_id`
- [ ] Add project filtering to reports
- [ ] Update cost calculation queries
- [ ] Test query performance with multiple projects

**Acceptance Criteria**:
- All queries return project-scoped data
- Performance acceptable with 10+ projects
- No data leakage between projects

---

### Phase 6: CLI & Management Tools (2-3 hours)

**Goal**: Provide command-line tools for project management

#### 6.1 CLI Commands (2 hours)
- [ ] Create `claude-loop` CLI tool
- [ ] Implement `start --project <path>` command
- [ ] Implement `stop --project <id|path>` command
- [ ] Implement `list` command (show all projects)
- [ ] Implement `status` command (detailed status)
- [ ] Implement `logs --project <id>` command
- [ ] Implement `stop-all` command

**Files to Create**:
- `bin/claude-loop.js`

**CLI Usage**:
```bash
# Start a project
$ claude-loop start --project /home/user/my-project
✅ Project started
   ID: a8c3f2
   Port: 3031
   Dashboard: http://localhost:3030

# List all projects
$ claude-loop list
┌──────────┬───────────────┬────────┬──────┬─────────────────────┐
│ ID       │ Name          │ Status │ Port │ Started             │
├──────────┼───────────────┼────────┼──────┼─────────────────────┤
│ a8c3f2   │ my-project    │ 🟢 RUN │ 3031 │ 2025-12-13 10:00:00 │
│ b9d4e7   │ other-project │ 🟢 RUN │ 3032 │ 2025-12-13 11:30:00 │
│ c1e8f9   │ test-project  │ 🔴 STOP│  -   │ -                   │
└──────────┴───────────────┴────────┴──────┴─────────────────────┘

# Stop a project
$ claude-loop stop --project a8c3f2
✅ Project stopped (ID: a8c3f2)

# Stop all projects
$ claude-loop stop-all
✅ Stopped 2 projects

# Show status
$ claude-loop status
📊 Multi-Project Status

Active Projects: 2/10
Total Cost (today): $12.45
Total Tokens (today): 1.2M
API Limit Usage: 45%
Unified Dashboard: http://localhost:3030
```

**Acceptance Criteria**:
- All commands work reliably
- Clear error messages
- Helpful usage information
- Works on Windows/Mac/Linux

---

## Component Specifications

### 1. MultiProjectOrchestrator

**Responsibility**: Manage lifecycle of all projects

**Key Methods**:
```javascript
class MultiProjectOrchestrator extends EventEmitter {
  constructor(options = {}) {
    this.registry = new ProjectRegistry();
    this.portAllocator = new PortAllocator({ min: 3031, max: 3100 });
    this.unifiedDashboard = new UnifiedDashboard({ port: 3030 });
    this.sharedLimitTracker = new SharedAPILimitTracker();
    this.costAggregator = new CostAggregator();
    this.projects = new Map(); // projectId -> ProjectInstance
  }

  async registerProject(projectPath, config = {}) {
    // Generate project ID from path
    // Allocate port
    // Create project entry in registry
    // Return project instance
  }

  async startProject(projectId) {
    // Load project from registry
    // Start ContinuousLoopOrchestrator
    // Register with unified dashboard
    // Subscribe to project events
  }

  async stopProject(projectId) {
    // Gracefully stop orchestrator
    // Release port
    // Update registry
    // Notify unified dashboard
  }

  async stopAll() {
    // Stop all running projects
    // Graceful shutdown with timeout
  }

  getProjectStatus(projectId) {
    // Return detailed status for project
  }

  listProjects() {
    // Return list of all registered projects
  }

  async getAggregatedMetrics() {
    // Aggregate metrics from all projects
    // Call costAggregator
    // Return unified view
  }
}
```

**Events Emitted**:
- `project:registered`
- `project:started`
- `project:stopped`
- `project:error`
- `metrics:updated`

---

### 2. UnifiedDashboard

**Responsibility**: Central dashboard for all projects

**Key Methods**:
```javascript
class UnifiedDashboard extends EventEmitter {
  constructor(options = {}) {
    this.port = options.port || 3030;
    this.projects = new Map(); // projectId -> ProjectState
    this.app = express();
    this.sseConnections = new Set();
  }

  async start() {
    // Start Express server
    // Setup routes
    // Initialize SSE
  }

  async stop() {
    // Close all SSE connections
    // Stop Express server
  }

  addProject(projectId, projectInstance) {
    // Register project
    // Subscribe to project events
    // Broadcast to SSE clients
  }

  removeProject(projectId) {
    // Unregister project
    // Update UI
  }

  broadcastUpdate(data) {
    // Send SSE to all connected clients
  }

  getAggregatedState() {
    // Return current state of all projects
  }
}
```

**HTML Dashboard Features**:
- Multi-project tabs or dropdown selector
- Aggregated metrics card (total cost, tokens, projects)
- Per-project status cards
- Real-time updates via SSE
- Start/stop/restart buttons
- Project logs viewer
- API limit visualization (shared quota)

---

### 3. SharedAPILimitTracker

**Responsibility**: Track global API quota across all projects

**Key Methods**:
```javascript
class SharedAPILimitTracker extends EventEmitter {
  constructor(options = {}) {
    this.plan = options.plan || 'pro';
    this.globalLimits = this._getPlanLimits(this.plan);
    this.windows = {
      minute: { calls: 0, tokens: 0, resetAt: 0 },
      day: { calls: 0, tokens: 0, resetAt: 0 }
    };
    this.projectUsage = new Map(); // projectId -> usage
    this.fairShareEnabled = options.fairShareEnabled !== false;
  }

  async canMakeCall(projectId, estimatedTokens = 1000) {
    // Check global quota first
    const globalCheck = this._checkGlobalQuota(estimatedTokens);
    if (!globalCheck.allowed) {
      return globalCheck;
    }

    // Check fair-share if enabled
    if (this.fairShareEnabled) {
      const fairShareCheck = this._checkFairShare(projectId, estimatedTokens);
      if (!fairShareCheck.allowed) {
        return fairShareCheck;
      }
    }

    return { allowed: true };
  }

  recordCall(projectId, tokens) {
    // Record call in global counters
    // Record call in project counters
    // Emit events if thresholds crossed
  }

  getStatus() {
    // Return current quota status
    // Include per-project breakdown
  }

  _checkGlobalQuota(estimatedTokens) {
    // Check against global limits
  }

  _checkFairShare(projectId, estimatedTokens) {
    // Calculate project's fair share
    // Check if project would exceed fair share
  }
}
```

**Fair Share Algorithm**:
```javascript
// Equal division among active projects
fairShareQuota = globalQuota / activeProjects

// Weighted by recent usage (optional)
projectWeight = projectTokensLastHour / totalTokensLastHour
fairShareQuota = globalQuota * projectWeight
```

---

### 4. ProjectRegistry

**Responsibility**: Persist project metadata

**Storage Format** (`~/.claude-multi-project/registry.json`):
```json
{
  "version": "1.0.0",
  "projects": {
    "a8c3f2e1b4d7": {
      "id": "a8c3f2e1b4d7",
      "name": "my-awesome-project",
      "path": "/home/user/projects/my-awesome-project",
      "port": 3031,
      "pid": 12345,
      "status": "running",
      "createdAt": "2025-12-13T10:00:00.000Z",
      "startedAt": "2025-12-13T10:00:05.000Z",
      "lastActive": "2025-12-13T15:30:00.000Z",
      "config": {
        "autoStart": true,
        "loopEnabled": true,
        "dashboardEnabled": true
      },
      "metadata": {
        "language": "javascript",
        "framework": "react",
        "totalCost": 4.25
      }
    }
  },
  "settings": {
    "maxProjects": 10,
    "portRange": { "min": 3031, "max": 3100 },
    "unifiedDashboardPort": 3030
  }
}
```

**Key Methods**:
```javascript
class ProjectRegistry {
  constructor(registryPath = '~/.claude-multi-project/registry.json') {
    this.registryPath = registryPath;
    this.data = this._load();
  }

  register(project) {
    // Add project to registry
    // Persist to disk
  }

  unregister(projectId) {
    // Remove project
    // Persist to disk
  }

  get(projectId) {
    // Return project by ID
  }

  getByPath(projectPath) {
    // Find project by path
  }

  list() {
    // Return all projects
  }

  update(projectId, updates) {
    // Update project fields
    // Persist to disk
  }

  _load() {
    // Load from disk
    // Handle corrupted file
  }

  _save() {
    // Save to disk
    // Atomic write (tmp file + rename)
  }
}
```

---

## Multi-Project Task Tracking

### Overview

Each project maintains its own task list, which is aggregated in the unified dashboard. Tasks flow from three sources:
1. **Runtime (TodoWrite tool)** - Active session tasks
2. **File-based (.claude/dev-docs/tasks.md)** - Persisted task lists
3. **Database (optional)** - Long-term task history

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│           Unified Dashboard (Port 3030)                      │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Task Aggregator                                       │ │
│  │  • Collects tasks from all project DashboardManagers  │ │
│  │  • Maintains projectId → tasks mapping                │ │
│  │  • Real-time updates via SSE                          │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Multi-Project Task View                              │ │
│  │                                                         │ │
│  │  [Project 1 ▼]  [Project 2]  [Project 3]             │ │
│  │  ┌──────────────────────────────────────────────────┐ │ │
│  │  │ ✅ Setup database (completed)                     │ │ │
│  │  │ 🔄 Implement API (in_progress) ████░░░░ 60%      │ │ │
│  │  │ ⏳ Write tests (pending)                          │ │ │
│  │  └──────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Project 1   │ │  Project 2   │ │  Project 3   │
│  Dashboard   │ │  Dashboard   │ │  Dashboard   │
│              │ │              │ │              │
│ state.plan:  │ │ state.plan:  │ │ state.plan:  │
│  tasks: [5]  │ │  tasks: [3]  │ │  tasks: [2]  │
│  completed:2 │ │  completed:2 │ │  completed:0 │
└──────────────┘ └──────────────┘ └──────────────┘
```

### Data Flow

#### Step 1: Project-Level Task Updates
```javascript
// Each project's DashboardManager tracks its own tasks
// Project 1 (a8c3f2)
dashboardManager1.updateExecutionPlan([
  { content: "Setup database", status: "completed" },
  { content: "Implement API", status: "in_progress", progress: 60 },
  { content: "Write tests", status: "pending" }
]);
// This updates dashboardManager1.state.plan.tasks
```

#### Step 2: Event Emission with Project Context
```javascript
// Enhanced DashboardManager emits events with project ID
class DashboardManager {
  updateExecutionPlan(tasks, currentIndex = 0) {
    // Add project context to each task
    this.state.plan.tasks = tasks.map((task, index) => ({
      id: task.id || `${this.projectId}-task-${index}`,
      projectId: this.projectId,              // NEW
      projectName: this.state.project.name,   // NEW
      content: task.content,
      status: task.status,
      activeForm: task.activeForm,
      progress: task.progress || 0
    }));

    // Emit with project context
    this.emit('plan:updated', {
      projectId: this.projectId,   // NEW
      plan: this.state.plan
    });
  }
}
```

#### Step 3: Aggregation in UnifiedDashboard
```javascript
class UnifiedDashboard {
  constructor() {
    this.projectTasks = new Map(); // projectId → plan
  }

  addProject(projectId, projectInstance) {
    // Subscribe to project's plan updates
    projectInstance.orchestrator.dashboard.on('plan:updated', (event) => {
      this.onProjectPlanUpdated(event.projectId, event.plan);
    });
  }

  onProjectPlanUpdated(projectId, plan) {
    this.projectTasks.set(projectId, {
      projectId,
      projectName: this.projects.get(projectId).name,
      tasks: plan.tasks,
      totalTasks: plan.totalTasks,
      completedTasks: plan.completedTasks,
      progress: (plan.completedTasks / plan.totalTasks) * 100
    });

    // Broadcast to SSE clients
    this.broadcastSSE({
      type: 'tasks_updated',
      projectId,
      data: this.projectTasks.get(projectId)
    });
  }

  getAggregatedTasks() {
    return {
      byProject: Array.from(this.projectTasks.values()),
      totalTasks: this._sumTotalTasks(),
      completedTasks: this._sumCompletedTasks(),
      inProgressTasks: this._sumInProgressTasks(),
      overallProgress: this._calculateOverallProgress()
    };
  }
}
```

### UI Options

#### Option 1: Tabbed View (Recommended)
```
┌───────────────────────────────────────────────────────────┐
│  📋 Tasks & Execution Plans                               │
├───────────────────────────────────────────────────────────┤
│  [All] [Project 1 (3)] [Project 2 (5)] [Project 3 (2)]  │
├───────────────────────────────────────────────────────────┤
│  Project 1: my-project                                    │
│  Progress: ████████████░░░░░░░░ 60% (3/5)               │
│                                                           │
│  ✅ Task 1: Setup database (completed)                   │
│  🔄 Task 2: Implement API (60%) ████████░░░             │
│  ⏳ Task 3: Write tests (pending)                        │
│  ⏳ Task 4: Integration tests (pending)                  │
│  ⏳ Task 5: Deploy (pending)                             │
└───────────────────────────────────────────────────────────┘
```

#### Option 2: Aggregated "All Projects" View
```
┌───────────────────────────────────────────────────────────┐
│  📊 All Projects - Combined Tasks                         │
├───────────────────────────────────────────────────────────┤
│  Sort: [Status ▼] [Project ▼] [Recent ▼]                │
├───────────────────────────────────────────────────────────┤
│  🔄 IN PROGRESS (3 tasks)                                │
│    • Implement API          [Project 1] 60%              │
│    • Connect to backend     [Project 2] 90%              │
│    • Add validations        [Project 3] 40%              │
│                                                           │
│  ✅ COMPLETED (6 tasks)                                  │
│    • Setup database         [Project 1]                  │
│    • Design UI              [Project 2]                  │
│    • Create models          [Project 3]                  │
│    • ... 3 more                                          │
│                                                           │
│  ⏳ PENDING (8 tasks)                                    │
│    • Write tests            [Project 1]                  │
│    • E2E tests              [Project 2]                  │
│    • ... 6 more                                          │
└───────────────────────────────────────────────────────────┘
```

### API Endpoints

#### Get Tasks for Specific Project
```http
GET /api/projects/:projectId/tasks

Response:
{
  "projectId": "a8c3f2",
  "projectName": "my-project",
  "tasks": [
    {
      "id": "a8c3f2-task-1",
      "content": "Setup database",
      "status": "completed",
      "progress": 100,
      "completedAt": "2025-12-13T10:30:00Z"
    },
    {
      "id": "a8c3f2-task-2",
      "content": "Implement API",
      "status": "in_progress",
      "activeForm": "Implementing REST endpoints",
      "progress": 60,
      "startedAt": "2025-12-13T11:00:00Z"
    }
  ],
  "totalTasks": 5,
  "completedTasks": 2,
  "inProgressTasks": 1,
  "progress": 40
}
```

#### Get Aggregated Tasks
```http
GET /api/tasks/aggregate

Response:
{
  "byProject": {
    "a8c3f2": {
      "projectName": "my-project",
      "tasks": [...],
      "progress": 40,
      "completedTasks": 2,
      "totalTasks": 5
    },
    "b9d4e7": {
      "projectName": "other-project",
      "tasks": [...],
      "progress": 80,
      "completedTasks": 4,
      "totalTasks": 5
    }
  },
  "aggregate": {
    "totalTasks": 10,
    "completedTasks": 6,
    "inProgressTasks": 2,
    "pendingTasks": 2,
    "overallProgress": 60
  }
}
```

#### Get Tasks by Status
```http
GET /api/tasks?status=in_progress

Response:
{
  "tasks": [
    {
      "id": "a8c3f2-task-2",
      "projectId": "a8c3f2",
      "projectName": "my-project",
      "content": "Implement API",
      "status": "in_progress",
      "progress": 60
    },
    {
      "id": "b9d4e7-task-3",
      "projectId": "b9d4e7",
      "projectName": "other-project",
      "content": "Connect to backend",
      "status": "in_progress",
      "progress": 90
    }
  ],
  "count": 2
}
```

### SSE Events for Task Updates

```javascript
// Real-time task updates via Server-Sent Events
GET /api/events

Event Stream Examples:

// Task list updated for a project
data: {
  "type": "tasks_updated",
  "projectId": "a8c3f2",
  "data": {
    "tasks": [...],
    "totalTasks": 5,
    "completedTasks": 2,
    "progress": 40
  },
  "timestamp": 1702489200000
}

// Individual task status changed
data: {
  "type": "task_status_changed",
  "projectId": "a8c3f2",
  "taskId": "a8c3f2-task-2",
  "oldStatus": "in_progress",
  "newStatus": "completed",
  "timestamp": 1702489250000
}

// Aggregate progress update
data: {
  "type": "aggregate_progress",
  "data": {
    "totalTasks": 10,
    "completedTasks": 7,
    "inProgressTasks": 2,
    "pendingTasks": 1,
    "overallProgress": 70
  },
  "timestamp": 1702489300000
}
```

### Database Schema for Task Persistence (Optional)

```sql
-- Optional: Store tasks in database for history and analytics
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  project_path TEXT,
  project_name TEXT,
  content TEXT NOT NULL,
  status TEXT CHECK(status IN ('pending', 'in_progress', 'completed', 'blocked')) NOT NULL,
  active_form TEXT,
  progress INTEGER DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
  priority INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL,
  metadata TEXT,  -- JSON for additional fields
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_updated ON tasks(updated_at DESC);

-- View for task statistics by project
CREATE VIEW task_stats_by_project AS
SELECT
  project_id,
  project_name,
  COUNT(*) as total_tasks,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
  SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_tasks,
  SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_tasks,
  ROUND(AVG(progress), 2) as avg_progress,
  MAX(updated_at) as last_updated
FROM tasks
GROUP BY project_id, project_name;
```

### Implementation Checklist

**Phase 3.1: Task Tracking Enhancement (2 hours)**
- [ ] Update `DashboardManager.updateExecutionPlan()` to include project context
- [ ] Add `projectId` and `projectName` to task objects
- [ ] Emit `plan:updated` events with project ID
- [ ] Update existing dashboard HTML to preserve project context

**Phase 3.2: UnifiedDashboard Task Aggregation (2 hours)**
- [ ] Add `projectTasks` Map to UnifiedDashboard
- [ ] Implement `onProjectPlanUpdated()` handler
- [ ] Implement `getAggregatedTasks()` method
- [ ] Add task-specific SSE events
- [ ] Implement helper methods (`_sumTotalTasks`, `_calculateOverallProgress`)

**Phase 3.3: Task API Endpoints (1 hour)**
- [ ] `GET /api/projects/:projectId/tasks`
- [ ] `GET /api/tasks/aggregate`
- [ ] `GET /api/tasks?status=<status>`
- [ ] `PATCH /api/projects/:projectId/tasks/:taskId` (optional)

**Phase 3.4: Multi-Project Task UI (2 hours)**
- [ ] Create tabbed interface for project task lists
- [ ] Add task status indicators (✅ 🔄 ⏳)
- [ ] Add progress bars for in-progress tasks
- [ ] Create "All Projects" aggregated view
- [ ] Implement task filtering and sorting
- [ ] Add real-time updates via SSE

**Phase 3.5: Database Integration (Optional, 1 hour)**
- [ ] Create `tasks` table schema
- [ ] Implement task persistence on status changes
- [ ] Add task history queries
- [ ] Create task statistics views

### Testing Requirements

```javascript
// Test task aggregation across projects
test('should aggregate tasks from multiple projects', async () => {
  const orchestrator = new MultiProjectOrchestrator();

  // Setup projects with tasks
  const project1 = await orchestrator.startProject('project-1');
  project1.dashboard.updateExecutionPlan([
    { content: "Task 1", status: "completed" },
    { content: "Task 2", status: "in_progress" }
  ]);

  const project2 = await orchestrator.startProject('project-2');
  project2.dashboard.updateExecutionPlan([
    { content: "Task A", status: "completed" },
    { content: "Task B", status: "pending" }
  ]);

  // Get aggregated tasks
  const aggregated = orchestrator.unifiedDashboard.getAggregatedTasks();

  expect(aggregated.totalTasks).toBe(4);
  expect(aggregated.completedTasks).toBe(2);
  expect(aggregated.inProgressTasks).toBe(1);
  expect(aggregated.byProject).toHaveLength(2);
});

// Test task SSE updates
test('should broadcast task updates via SSE', async (done) => {
  const eventSource = new EventSource('http://localhost:3030/api/events');

  eventSource.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'tasks_updated') {
      expect(data.projectId).toBe('a8c3f2');
      expect(data.data.tasks).toBeDefined();
      done();
    }
  });

  // Trigger task update
  dashboard.updateExecutionPlan([...tasks]);
});
```

---

## Database Schema Changes

### Migration: 001_add_project_support.sql

```sql
-- Add project identification columns to all tables

-- Usage Records
ALTER TABLE usage_records ADD COLUMN project_id TEXT;
ALTER TABLE usage_records ADD COLUMN project_path TEXT;
ALTER TABLE usage_records ADD COLUMN project_name TEXT;

-- Checkpoints
ALTER TABLE checkpoints ADD COLUMN project_id TEXT;
ALTER TABLE checkpoints ADD COLUMN project_path TEXT;

-- Executions (if exists)
CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY,
  orchestration_id TEXT,
  project_id TEXT,
  project_path TEXT,
  agent_id TEXT,
  phase TEXT,
  status TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  error TEXT,
  metadata TEXT
);

-- Human Reviews (if exists)
ALTER TABLE human_reviews ADD COLUMN project_id TEXT;

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_usage_project_time
  ON usage_records(project_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_usage_project_cost
  ON usage_records(project_id, total_cost);

CREATE INDEX IF NOT EXISTS idx_checkpoints_project
  ON checkpoints(project_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_executions_project
  ON executions(project_id, started_at DESC);

-- Create materialized view for project summaries (optional)
CREATE TABLE IF NOT EXISTS project_usage_summary (
  project_id TEXT PRIMARY KEY,
  project_name TEXT,
  total_cost REAL,
  total_tokens INTEGER,
  total_executions INTEGER,
  first_used INTEGER,
  last_used INTEGER,
  updated_at INTEGER
);

-- Trigger to update summary on usage insert
CREATE TRIGGER IF NOT EXISTS update_project_summary
AFTER INSERT ON usage_records
BEGIN
  INSERT INTO project_usage_summary (
    project_id, project_name, total_cost, total_tokens,
    total_executions, first_used, last_used, updated_at
  )
  VALUES (
    NEW.project_id, NEW.project_name, NEW.total_cost,
    (NEW.input_tokens + NEW.output_tokens), 1,
    NEW.timestamp, NEW.timestamp, NEW.timestamp
  )
  ON CONFLICT(project_id) DO UPDATE SET
    total_cost = total_cost + NEW.total_cost,
    total_tokens = total_tokens + (NEW.input_tokens + NEW.output_tokens),
    total_executions = total_executions + 1,
    last_used = NEW.timestamp,
    updated_at = NEW.timestamp;
END;
```

### Query Examples

```sql
-- Get usage by project (last 24 hours)
SELECT
  project_id,
  project_name,
  SUM(total_cost) as cost,
  SUM(input_tokens + output_tokens) as tokens,
  COUNT(*) as executions
FROM usage_records
WHERE timestamp >= strftime('%s', 'now', '-24 hours') * 1000
GROUP BY project_id, project_name
ORDER BY cost DESC;

-- Get top projects by cost (all time)
SELECT * FROM project_usage_summary
ORDER BY total_cost DESC
LIMIT 10;

-- Get project activity timeline
SELECT
  date(timestamp / 1000, 'unixepoch') as date,
  project_name,
  SUM(total_cost) as daily_cost
FROM usage_records
WHERE project_id = ?
GROUP BY date, project_name
ORDER BY date DESC;
```

---

## API Specifications

### Multi-Project REST API

**Base URL**: `http://localhost:3030/api`

#### 1. List Projects
```http
GET /api/projects

Response:
{
  "projects": [
    {
      "id": "a8c3f2",
      "name": "my-project",
      "path": "/home/user/my-project",
      "status": "running",
      "port": 3031,
      "pid": 12345,
      "startedAt": "2025-12-13T10:00:00Z",
      "uptime": 3600000,
      "metrics": {
        "cost": 4.25,
        "tokens": 450000
      }
    }
  ],
  "total": 1,
  "running": 1,
  "stopped": 0
}
```

#### 2. Get Project Details
```http
GET /api/projects/:projectId

Response:
{
  "id": "a8c3f2",
  "name": "my-project",
  "path": "/home/user/my-project",
  "status": "running",
  "port": 3031,
  "state": {
    "session": { ... },
    "context": { ... },
    "usage": { ... },
    "execution": { ... }
  }
}
```

#### 3. Start Project
```http
POST /api/projects/:projectId/start

Request Body (optional):
{
  "config": {
    "loopEnabled": true,
    "dashboardEnabled": false
  }
}

Response:
{
  "success": true,
  "projectId": "a8c3f2",
  "port": 3031,
  "pid": 12345
}
```

#### 4. Stop Project
```http
POST /api/projects/:projectId/stop

Response:
{
  "success": true,
  "projectId": "a8c3f2"
}
```

#### 5. Get Aggregated Metrics
```http
GET /api/metrics/aggregate?timeframe=day

Response:
{
  "timeframe": "day",
  "total": {
    "cost": 12.45,
    "tokens": 1200000,
    "cacheSavings": 8.30
  },
  "byProject": [
    {
      "projectId": "a8c3f2",
      "name": "my-project",
      "cost": 4.25,
      "tokens": 450000,
      "percentage": 34.1
    }
  ],
  "byModel": {
    "claude-sonnet-4": { "cost": 8.20, "tokens": 800000 },
    "claude-opus-4": { "cost": 4.25, "tokens": 400000 }
  }
}
```

#### 6. SSE Events
```http
GET /api/events

Event Stream:
data: {
  "type": "metrics_update",
  "projectId": "a8c3f2",
  "data": { ... }
}

data: {
  "type": "project_started",
  "projectId": "b9d4e7"
}

data: {
  "type": "aggregate_update",
  "data": { ... }
}
```

---

## Dashboard UI Changes

### Multi-Project Dashboard Layout

**Main Dashboard** (`GET /`):
```html
<!DOCTYPE html>
<html>
<head>
  <title>Claude Multi-Project Monitor</title>
  <style>
    /* Modern, clean design with project cards */
  </style>
</head>
<body>
  <div class="header">
    <h1>🤖 Claude Multi-Project Monitor</h1>
    <div class="global-stats">
      <span>Projects: <strong id="projectCount">0</strong></span>
      <span>Total Cost: <strong id="totalCost">$0.00</strong></span>
      <span>API Limit: <strong id="apiLimit">0%</strong></span>
    </div>
  </div>

  <div class="project-list">
    <!-- Project cards will be inserted here -->
  </div>

  <div class="aggregated-metrics">
    <h2>Aggregated Metrics</h2>
    <!-- Charts and graphs -->
  </div>

  <script>
    const eventSource = new EventSource('/api/events');
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      updateDashboard(data);
    };
  </script>
</body>
</html>
```

**Project Card Component**:
```html
<div class="project-card" data-project-id="a8c3f2">
  <div class="project-header">
    <h3>🟢 my-project</h3>
    <div class="project-controls">
      <button onclick="restartProject('a8c3f2')">Restart</button>
      <button onclick="stopProject('a8c3f2')">Stop</button>
    </div>
  </div>

  <div class="project-stats">
    <div class="stat">
      <span class="label">Port</span>
      <span class="value">3031</span>
    </div>
    <div class="stat">
      <span class="label">Cost</span>
      <span class="value">$4.25</span>
    </div>
    <div class="stat">
      <span class="label">Tokens</span>
      <span class="value">450K</span>
    </div>
    <div class="stat">
      <span class="label">Uptime</span>
      <span class="value">1h 23m</span>
    </div>
  </div>

  <div class="project-status">
    <span class="phase">Phase: implementation</span>
    <span class="agent">Agent: Senior Developer</span>
  </div>

  <div class="project-progress">
    <div class="progress-bar">
      <div class="fill" style="width: 65%"></div>
    </div>
  </div>
</div>
```

**Features**:
- Responsive grid layout for project cards
- Color-coded status indicators (🟢 running, 🔴 stopped, 🟡 warning)
- Real-time metric updates via SSE
- Click project card to expand details
- Start/stop/restart controls
- Link to project-specific dashboard
- Aggregated charts (cost over time, tokens by model)

---

## Testing Strategy

### Unit Tests

**1. ProjectRegistry Tests**
```javascript
describe('ProjectRegistry', () => {
  test('should register new project', () => { });
  test('should prevent duplicate registration', () => { });
  test('should generate stable project IDs', () => { });
  test('should persist to disk', () => { });
  test('should recover from corrupted registry', () => { });
});
```

**2. PortAllocator Tests**
```javascript
describe('PortAllocator', () => {
  test('should allocate ports sequentially', () => { });
  test('should skip ports already in use', () => { });
  test('should release ports', () => { });
  test('should handle port exhaustion', () => { });
  test('should detect port conflicts', () => { });
});
```

**3. MultiProjectOrchestrator Tests**
```javascript
describe('MultiProjectOrchestrator', () => {
  test('should register multiple projects', () => { });
  test('should start project', () => { });
  test('should stop project', () => { });
  test('should handle project crashes gracefully', () => { });
  test('should aggregate metrics', () => { });
});
```

**4. SharedAPILimitTracker Tests**
```javascript
describe('SharedAPILimitTracker', () => {
  test('should track global quota', () => { });
  test('should enforce fair share', () => { });
  test('should reset quota windows', () => { });
  test('should handle multiple projects', () => { });
});
```

### Integration Tests

**1. Multi-Project Startup**
```javascript
test('should start 3 projects simultaneously', async () => {
  const orchestrator = new MultiProjectOrchestrator();

  await orchestrator.registerProject('/project-1');
  await orchestrator.registerProject('/project-2');
  await orchestrator.registerProject('/project-3');

  await orchestrator.startProject('project-1-id');
  await orchestrator.startProject('project-2-id');
  await orchestrator.startProject('project-3-id');

  const projects = orchestrator.listProjects();
  expect(projects.filter(p => p.status === 'running')).toHaveLength(3);
});
```

**2. Port Conflict Resolution**
```javascript
test('should handle port conflicts', async () => {
  // Occupy port 3031 externally
  const externalServer = http.createServer().listen(3031);

  const orchestrator = new MultiProjectOrchestrator();
  await orchestrator.registerProject('/project-1');

  // Should allocate 3032 instead
  const project = orchestrator.getProject('project-1-id');
  expect(project.port).toBe(3032);
});
```

**3. Cross-Project Metrics**
```javascript
test('should aggregate metrics across projects', async () => {
  // ... setup 3 projects with usage ...

  const metrics = await orchestrator.getAggregatedMetrics();

  expect(metrics.total.cost).toBeCloseTo(12.50, 2);
  expect(metrics.byProject).toHaveLength(3);
  expect(metrics.byProject[0].cost).toBeGreaterThan(0);
});
```

### End-to-End Tests

**1. Full Lifecycle Test**
```javascript
test('complete multi-project lifecycle', async () => {
  // 1. Start unified dashboard
  // 2. Register 3 projects
  // 3. Start all projects
  // 4. Verify dashboard shows all projects
  // 5. Generate usage in each project
  // 6. Verify aggregated metrics
  // 7. Stop one project
  // 8. Verify dashboard updates
  // 9. Stop all projects
  // 10. Verify cleanup
});
```

**2. Dashboard UI Test (Playwright)**
```javascript
test('unified dashboard displays correctly', async ({ page }) => {
  await page.goto('http://localhost:3030');

  // Check project count
  const projectCount = await page.textContent('#projectCount');
  expect(projectCount).toBe('3');

  // Check project cards
  const cards = await page.$$('.project-card');
  expect(cards).toHaveLength(3);

  // Click stop button
  await page.click('[data-project-id="a8c3f2"] .stop-button');

  // Verify project stopped
  await page.waitForSelector('[data-project-id="a8c3f2"] .status-stopped');
});
```

### Performance Tests

**1. Concurrent Project Scaling**
```javascript
test('should handle 10 projects efficiently', async () => {
  const orchestrator = new MultiProjectOrchestrator();

  const startTime = Date.now();

  for (let i = 0; i < 10; i++) {
    await orchestrator.registerProject(`/project-${i}`);
    await orchestrator.startProject(`project-${i}-id`);
  }

  const elapsed = Date.now() - startTime;
  expect(elapsed).toBeLessThan(5000); // Should complete in <5 seconds
});
```

**2. SSE Performance**
```javascript
test('SSE should handle 100 connections', async () => {
  const connections = [];

  for (let i = 0; i < 100; i++) {
    const es = new EventSource('http://localhost:3030/api/events');
    connections.push(es);
  }

  // Generate update
  await orchestrator.broadcastUpdate({ test: 'data' });

  // All connections should receive update within 100ms
  await expect(allConnectionsReceived()).resolves.toBe(true);
});
```

---

## Migration Path

### From Single-Project to Multi-Project

**Step 1: Backup Current State**
```bash
# Backup existing project state
cp -r .claude/state .claude/state.backup
cp .claude/memory.db .claude/memory.db.backup
```

**Step 2: Run Database Migration**
```bash
# Run migration script
node .claude/migrations/run-migration.js 001_add_project_support

# Verify migration
sqlite3 .claude/memory.db "SELECT COUNT(*) FROM usage_records WHERE project_id IS NOT NULL"
```

**Step 3: Install Multi-Project Components**
```bash
# Install new dependencies (if any)
npm install

# Create global directory
mkdir -p ~/.claude-multi-project/pids
```

**Step 4: Register Existing Project**
```bash
# Register current project
claude-loop register --path $(pwd) --name "current-project"

# Verify registration
claude-loop list
```

**Step 5: Start Multi-Project System**
```bash
# Start unified dashboard
claude-loop start-global

# Start current project
claude-loop start --project current-project

# Verify at http://localhost:3030
```

**Step 6: Migrate Other Projects (Gradual)**
```bash
# For each existing project
cd /path/to/other/project
claude-loop start --project $(pwd)
```

### Rollback Plan

If issues occur, rollback steps:

```bash
# 1. Stop all projects
claude-loop stop-all

# 2. Restore database
cp .claude/memory.db.backup .claude/memory.db

# 3. Restore state
cp -r .claude/state.backup .claude/state

# 4. Restart single-project mode
node start-continuous-loop.js
```

---

## Risk Assessment

### High Risk

**1. Port Conflicts**
- **Risk**: Multiple dashboards try to use same port
- **Mitigation**: Port allocator with conflict detection, fallback to next available port
- **Contingency**: Manual port assignment via config

**2. Database Corruption During Migration**
- **Risk**: Migration fails mid-way, corrupts database
- **Mitigation**: Atomic migrations with transactions, automatic backup before migration
- **Contingency**: Rollback script, manual database repair tools

**3. PID File Conflicts**
- **Risk**: Multiple processes write to same PID file
- **Mitigation**: Global PID directory with project-specific files, file locking
- **Contingency**: Manual PID cleanup, process detection by port

### Medium Risk

**4. API Quota Sharing Issues**
- **Risk**: Fair-share algorithm is unfair or buggy
- **Mitigation**: Comprehensive testing, configurable fair-share modes
- **Contingency**: Disable fair-share, use global quota only

**5. Memory Leaks with Many Projects**
- **Risk**: Event listeners not cleaned up, memory grows unbounded
- **Mitigation**: Proper event cleanup, memory monitoring, limits on project count
- **Contingency**: Restart manager process periodically

**6. SSE Connection Limits**
- **Risk**: Too many SSE connections overwhelm server
- **Mitigation**: Connection pooling, max connection limit, backpressure
- **Contingency**: Polling fallback, websocket upgrade

### Low Risk

**7. Registry File Corruption**
- **Risk**: registry.json becomes corrupted
- **Mitigation**: Atomic writes, validation on read, periodic backups
- **Contingency**: Rebuild from PID files and project directories

**8. Cross-Project Data Leakage**
- **Risk**: Project A sees Project B's data
- **Mitigation**: Strict project_id filtering in all queries, code review
- **Contingency**: Audit logs, data isolation verification

---

## Success Criteria

### Functional Requirements

- [ ] Can register unlimited projects (tested with 10)
- [ ] Each project runs independently with isolated state
- [ ] Unified dashboard shows all projects on single page
- [ ] Dashboard updates in real-time (<2 second latency)
- [ ] Can start/stop projects from CLI and dashboard
- [ ] No port conflicts between projects
- [ ] API limits tracked globally across all projects
- [ ] Costs aggregated accurately across all projects
- [ ] Database migration completes without data loss
- [ ] Rollback to single-project mode works

### Performance Requirements

- [ ] Start 10 projects in <10 seconds
- [ ] Dashboard responsive with 10 projects (<100ms render)
- [ ] SSE supports 50+ simultaneous connections
- [ ] Aggregated metrics query <500ms
- [ ] Memory usage <500MB with 10 projects
- [ ] CPU usage <20% idle with 10 projects

### Quality Requirements

- [ ] 90%+ test coverage for new components
- [ ] All integration tests pass
- [ ] No errors in logs during normal operation
- [ ] Graceful degradation on errors
- [ ] Clear error messages for all failure modes
- [ ] Documentation complete for all APIs

### User Experience

- [ ] CLI commands are intuitive
- [ ] Dashboard is visually clear and organized
- [ ] Project switching is smooth (<100ms)
- [ ] Help text is comprehensive
- [ ] Error messages are actionable

---

## Implementation Timeline

### Phase 0 (PREREQUISITE): Dashboard Testing (6-12 hours)
- [x] Phase 0.1 (4 hours): DashboardManager core tests ✅ **COMPLETE**
- [ ] Phase 0.2 (3 hours): SSE integration tests
- [ ] Phase 0.3 (3 hours): Orchestrator integration tests
- [ ] Phase 0.4 (2 hours): Web endpoint tests (optional, can be deferred)

**Status**: Phase 0.1 complete. Recommend completing 0.2-0.3 before starting Phase 1.

---

### Week 1: Foundation (8-10 hours)
- [ ] Day 1-2: ProjectRegistry, PortAllocator, ID generation
- [ ] Day 3-4: MultiProjectOrchestrator core
- [ ] Day 5: Testing and bug fixes

### Week 2: Component Updates (8-10 hours)
- [ ] Day 1-2: Update ContinuousLoopManager, Orchestrator
- [ ] Day 3: Update UsageTracker, DashboardManager
- [ ] Day 4-5: Database migration, testing

### Week 3: Dashboard (6-8 hours)
- [ ] Day 1-2: UnifiedDashboard backend
- [ ] Day 3-4: Multi-project UI
- [ ] Day 5: SSE implementation, testing

### Week 4: Shared Services & Polish (4-6 hours)
- [ ] Day 1-2: SharedAPILimitTracker, CostAggregator
- [ ] Day 3: CLI commands
- [ ] Day 4: Documentation
- [ ] Day 5: Final testing, bug fixes

**Total**: 32-46 hours (Phase 0 + Phases 1-4) (~5-6 weeks @ 6-8 hours/week)

---

## Next Steps

1. **Complete Phase 0 Testing (PREREQUISITE)**
   - [x] Phase 0.1: DashboardManager core tests ✅
   - [ ] Phase 0.2: SSE integration tests (recommended)
   - [ ] Phase 0.3: Orchestrator integration tests (recommended)
   - [ ] Verify all tests passing
   - [ ] Achieve ≥85% dashboard test coverage

2. **Review and Approve Multi-Project Plan**
   - Review this implementation plan
   - Identify any concerns or gaps
   - Prioritize features (MVP vs nice-to-have)

3. **Create Development Branch**
   ```bash
   git checkout -b feature/multi-project-support
   ```

4. **Start Phase 1: Core Infrastructure**
   - Begin with ProjectRegistry
   - Then PortAllocator
   - Then MultiProjectOrchestrator

5. **Iterative Development**
   - Implement phase-by-phase
   - Test thoroughly after each phase
   - Update this plan as needed

**IMPORTANT**: Do not start multi-project implementation until Phase 0.1-0.3 tests are complete and passing. The multi-project dashboard will be significantly more complex, and without proper test coverage of the single-project dashboard, debugging issues will be extremely difficult.

---

**Document Version**: 1.0
**Last Updated**: 2025-12-13
**Next Review**: After Phase 1 completion
