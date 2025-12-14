# Dashboard Testing Coverage Gaps

**Created**: 2025-12-13
**Status**: Analysis Complete
**Priority**: High

---

## Executive Summary

**Finding**: The continuous loop system has **ZERO test coverage** for dashboard functionality, including:
- Usage metric updates
- Token tracking display
- Execution plan updates
- Real-time SSE updates

**Impact**: Critical features are untested and may fail silently in production.

**Recommendation**: Add comprehensive dashboard integration tests (estimated 6-8 hours).

---

## Current Test Coverage

### ✅ What IS Tested

**ContinuousLoopOrchestrator** (`__tests__/integration/continuous-loop-system.test.js`):
- ✅ Safety checks and guardrails
- ✅ Checkpoint creation and storage
- ✅ Wrap-up and session summaries
- ✅ Human-in-loop detection
- ✅ API limit tracking (component level)
- ✅ Learning and adaptation
- ✅ Concurrent operations
- ✅ Error handling

**UsageTracker** (`__tests__/core/usage-tracker.test.js`):
- ✅ Recording usage data
- ✅ Cost calculation
- ✅ Database persistence
- ✅ Session usage aggregation
- ✅ Budget alerts (basic)

**Key Finding**: Dashboard is **explicitly disabled** in tests:
```javascript
// Line 71-72 in continuous-loop-system.test.js
dashboard: {
  enabled: false // Disable dashboard for tests
}
```

### ❌ What IS NOT Tested

#### 1. DashboardManager Component
**Status**: **NO TESTS EXIST**

**Missing Test File**: `__tests__/core/dashboard-manager.test.js`

**Untested Functionality**:
- ❌ Dashboard initialization
- ❌ State updates and aggregation
- ❌ Event subscriptions (orchestrator → dashboard)
- ❌ Execution plan updates (`updateExecutionPlan()`)
- ❌ Artifact tracking (`addArtifact()`)
- ❌ Configuration updates (`updateConfig()`)
- ❌ Human review queue management
- ❌ Metrics aggregation
- ❌ State export (`getState()`)

#### 2. Real-Time Updates (SSE)
**Status**: **NO TESTS EXIST**

**Untested Functionality**:
- ❌ SSE connection establishment
- ❌ Event broadcasting to clients
- ❌ Multiple concurrent SSE connections
- ❌ Connection cleanup on disconnect
- ❌ Metric update frequency
- ❌ Event payload structure
- ❌ Backpressure handling

#### 3. Web Dashboard Endpoints
**Status**: **NO TESTS EXIST**

**Untested API Endpoints**:
- ❌ `GET /` - Dashboard HTML
- ❌ `GET /events` - SSE stream
- ❌ `GET /api/state` - Current state
- ❌ `GET /api/metrics` - Metrics
- ❌ `GET /api/artifacts` - Artifacts list
- ❌ `GET /api/file` - File content viewer
- ❌ `POST /api/config` - Config updates
- ❌ `GET /api/reviews` - Human review queue
- ❌ `POST /api/review/:reviewId` - Review responses

#### 4. Dashboard State Synchronization
**Status**: **NO TESTS EXIST**

**Untested Scenarios**:
- ❌ Usage metrics flow from UsageTracker → Dashboard
- ❌ Token counts displayed correctly
- ❌ Execution plan updates from orchestrator
- ❌ Task status changes reflected in real-time
- ❌ Context window percentage calculation
- ❌ API limit visualization
- ❌ Cost tracking display
- ❌ Session status updates

#### 5. Integration: Orchestrator ↔ Dashboard
**Status**: **NO TESTS EXIST**

**Untested Data Flow**:
```
ContinuousLoopOrchestrator
         ↓ (events)
    DashboardManager
         ↓ (SSE)
    Web Clients
```

**Missing Integration Tests**:
- ❌ Orchestrator emits events → Dashboard receives
- ❌ UsageTracker updates → Dashboard displays
- ❌ Execution plan changes → SSE broadcasts
- ❌ Human review triggered → Dashboard shows in queue
- ❌ Checkpoint created → Dashboard updates metrics
- ❌ API limit warning → Dashboard alerts

---

## Critical Testing Gaps

### 🔴 HIGH PRIORITY: Dashboard Core Functionality

**Test File**: `__tests__/core/dashboard-manager.test.js`

**Required Tests** (estimated 4 hours):

```javascript
describe('DashboardManager', () => {
  describe('initialization', () => {
    test('should initialize with required components');
    test('should set up event subscriptions');
    test('should initialize state structure');
  });

  describe('updateExecutionPlan', () => {
    test('should update plan state with tasks');
    test('should calculate progress correctly');
    test('should emit plan:updated event');
    test('should handle empty task list');
    test('should handle task status changes');
  });

  describe('updateExecution', () => {
    test('should update current execution info');
    test('should track duration');
    test('should emit execution:updated event');
  });

  describe('addArtifact', () => {
    test('should add artifact to state');
    test('should limit artifacts to 100');
    test('should emit artifact:added event');
  });

  describe('updateConfig', () => {
    test('should update configuration setting');
    test('should persist to settings.local.json');
    test('should emit config:changed event');
    test('should handle invalid paths');
  });

  describe('metrics updates', () => {
    test('should update usage metrics periodically');
    test('should update context window state');
    test('should update API limits');
    test('should calculate next checkpoint');
  });

  describe('getState', () => {
    test('should return complete state snapshot');
    test('should include all required fields');
    test('should be JSON serializable');
  });
});
```

### 🔴 HIGH PRIORITY: Real-Time SSE Updates

**Test File**: `__tests__/integration/dashboard-sse.test.js`

**Required Tests** (estimated 3 hours):

```javascript
describe('Dashboard SSE', () => {
  describe('connection management', () => {
    test('should establish SSE connection');
    test('should send initial state on connect');
    test('should handle multiple concurrent connections');
    test('should cleanup on disconnect');
  });

  describe('event broadcasting', () => {
    test('should broadcast metrics updates');
    test('should broadcast plan updates');
    test('should broadcast execution updates');
    test('should broadcast events');
    test('should broadcast artifact additions');
  });

  describe('real-time updates', () => {
    test('should update within 2 seconds');
    test('should not send duplicate events');
    test('should handle backpressure');
    test('should recover from client errors');
  });

  describe('event payload', () => {
    test('should include timestamp');
    test('should include event type');
    test('should include data payload');
    test('should be valid JSON');
  });
});
```

### 🟡 MEDIUM PRIORITY: Web Dashboard Integration

**Test File**: `__tests__/integration/dashboard-web.test.js`

**Required Tests** (estimated 2 hours):

```javascript
describe('Web Dashboard Endpoints', () => {
  describe('GET /', () => {
    test('should serve dashboard HTML');
    test('should return 200 status');
    test('should include JavaScript for SSE');
  });

  describe('GET /api/state', () => {
    test('should return current state');
    test('should include all state fields');
    test('should return valid JSON');
  });

  describe('GET /api/metrics', () => {
    test('should return metrics summary');
    test('should include usage, context, limits');
  });

  describe('POST /api/config', () => {
    test('should update configuration');
    test('should return success response');
    test('should persist changes');
    test('should validate input');
  });

  describe('GET /api/artifacts', () => {
    test('should return artifact list');
    test('should limit to last 100');
  });
});
```

### 🟡 MEDIUM PRIORITY: Integration Testing

**Test File**: `__tests__/integration/orchestrator-dashboard.test.js`

**Required Tests** (estimated 3 hours):

```javascript
describe('Orchestrator ↔ Dashboard Integration', () => {
  describe('usage tracking flow', () => {
    test('should update dashboard when usage recorded');
    test('should display token counts correctly');
    test('should calculate costs accurately');
    test('should show cache savings');
  });

  describe('execution plan flow', () => {
    test('should update dashboard when plan changes');
    test('should show task statuses correctly');
    test('should track task progress');
    test('should update completed count');
  });

  describe('checkpoint flow', () => {
    test('should update dashboard when checkpoint created');
    test('should increment checkpoint count');
    test('should show checkpoint reason');
  });

  describe('human review flow', () => {
    test('should add review to queue when triggered');
    test('should update dashboard with review details');
    test('should remove from queue when responded');
  });

  describe('event propagation', () => {
    test('should propagate orchestrator events to dashboard');
    test('should broadcast dashboard events via SSE');
    test('should maintain event order');
    test('should handle event bursts');
  });
});
```

---

## Specific Test Scenarios

### Scenario 1: Usage Metrics Display

**What Should Happen**:
1. UsageTracker records token usage
2. DashboardManager._updateMetrics() polls usage
3. state.usage updated with latest metrics
4. SSE broadcasts `metrics:updated` event
5. Web client updates display

**Current Testing**: ❌ NOT TESTED

**Required Test**:
```javascript
test('should display usage metrics correctly', async () => {
  // 1. Start dashboard
  await dashboard.start();

  // 2. Record usage
  await usageTracker.recordUsage({
    orchestrationId: 'orch-1',
    model: 'claude-sonnet-4',
    inputTokens: 10000,
    outputTokens: 5000
  });

  // 3. Wait for update interval
  await new Promise(resolve => setTimeout(resolve, 2100));

  // 4. Verify dashboard state
  const state = dashboard.getState();
  expect(state.usage.totalTokens).toBe(15000);
  expect(state.usage.totalCost).toBeGreaterThan(0);
  expect(state.usage.inputTokens).toBe(10000);
  expect(state.usage.outputTokens).toBe(5000);
});
```

### Scenario 2: Execution Plan Updates

**What Should Happen**:
1. Orchestrator calls `dashboard.updateExecutionPlan(tasks)`
2. Dashboard updates `state.plan.tasks`
3. Dashboard emits `plan:updated` event
4. SSE broadcasts update
5. Web client updates task list UI

**Current Testing**: ❌ NOT TESTED

**Required Test**:
```javascript
test('should update execution plan in real-time', async () => {
  // 1. Setup SSE listener
  const updates = [];
  const eventSource = new EventSource('http://localhost:3030/events');
  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'plan:updated') {
      updates.push(data);
    }
  };

  // 2. Update plan
  dashboard.updateExecutionPlan([
    { content: "Implement API", status: "in_progress", progress: 60 },
    { content: "Write tests", status: "pending" }
  ]);

  // 3. Wait for SSE
  await new Promise(resolve => setTimeout(resolve, 100));

  // 4. Verify
  expect(updates.length).toBe(1);
  expect(updates[0].data.tasks).toHaveLength(2);
  expect(updates[0].data.tasks[0].status).toBe('in_progress');
  expect(updates[0].data.completedTasks).toBe(0);
  expect(updates[0].data.totalTasks).toBe(2);

  eventSource.close();
});
```

### Scenario 3: Token Count Display

**What Should Happen**:
1. Multiple operations record token usage
2. Dashboard aggregates totals
3. Context window percentage calculated
4. Next checkpoint threshold shown
5. Progress bar updates in UI

**Current Testing**: ❌ NOT TESTED

**Required Test**:
```javascript
test('should calculate context window correctly', async () => {
  // 1. Record multiple usages
  const usages = [
    { inputTokens: 50000, outputTokens: 20000 },
    { inputTokens: 30000, outputTokens: 10000 },
    { inputTokens: 20000, outputTokens: 5000 }
  ];

  for (const usage of usages) {
    await usageTracker.recordUsage({
      orchestrationId: `orch-${Date.now()}`,
      model: 'claude-sonnet-4',
      ...usage
    });
  }

  // 2. Wait for dashboard update
  await new Promise(resolve => setTimeout(resolve, 2100));

  // 3. Verify calculations
  const state = dashboard.getState();

  // Total: (50k+20k) + (30k+10k) + (20k+5k) = 135k tokens
  expect(state.context.current).toBe(135000);

  // Context window: 200k
  expect(state.context.limit).toBe(200000);

  // Percentage: 135k / 200k = 67.5%
  expect(state.context.percentage).toBeCloseTo(67.5, 1);

  // Status: should be 'ok' (< 80%)
  expect(state.context.status).toBe('ok');

  // Next checkpoint: (200k * 0.85) - 135k = 35k tokens
  expect(state.context.nextCheckpoint).toBeCloseTo(35000, -3);
});
```

### Scenario 4: Multi-Project SSE Isolation

**What Should Happen** (for future multi-project):
1. Project 1 updates → Only Project 1 SSE events emitted
2. Project 2 updates → Only Project 2 SSE events emitted
3. Aggregated view → Receives all events
4. No cross-project data leakage

**Current Testing**: ❌ NOT TESTED (will be critical for multi-project)

---

## Implementation Priority

### Phase 1: Core Dashboard Tests (4 hours) 🔴 HIGH
- Create `__tests__/core/dashboard-manager.test.js`
- Test all DashboardManager methods
- Test state management
- Test event emissions

### Phase 2: SSE Integration Tests (3 hours) 🔴 HIGH
- Create `__tests__/integration/dashboard-sse.test.js`
- Test SSE connection lifecycle
- Test event broadcasting
- Test real-time updates

### Phase 3: Orchestrator Integration (3 hours) 🟡 MEDIUM
- Create `__tests__/integration/orchestrator-dashboard.test.js`
- Test data flow from orchestrator to dashboard
- Test all update paths (usage, plan, checkpoints)
- Test event propagation

### Phase 4: Web Endpoints (2 hours) 🟢 LOW
- Create `__tests__/integration/dashboard-web.test.js`
- Test all HTTP endpoints
- Test error handling
- Test response formats

**Total Estimated Effort**: 12 hours

---

## Test Coverage Goals

### Current Coverage
```
DashboardManager:     0%  ❌
SSE Broadcasting:     0%  ❌
Web Endpoints:        0%  ❌
Integration Flow:     0%  ❌
Overall Dashboard:    0%  ❌
```

### Target Coverage
```
DashboardManager:     90%  ✅
SSE Broadcasting:     85%  ✅
Web Endpoints:        80%  ✅
Integration Flow:     85%  ✅
Overall Dashboard:    85%  ✅
```

---

## Risks of Current Gap

### 🔴 CRITICAL RISKS

**1. Silent Failures**
- Dashboard may not update when usage changes
- Users see stale data
- Debugging becomes impossible

**2. Data Integrity**
- Token counts may be incorrect
- Cost calculations may be wrong
- Progress tracking unreliable

**3. Multi-Project Impact**
- No confidence that dashboard will work for multiple projects
- SSE isolation untested
- Cross-project data leakage possible

### 🟡 MEDIUM RISKS

**4. Performance Issues**
- SSE may not scale to 10+ projects
- Memory leaks from unclosed connections
- Event flooding under load

**5. User Experience**
- Real-time updates may fail silently
- UI may freeze or become unresponsive
- Error messages not shown

---

## Recommended Actions

### Immediate (Next Sprint)
1. ✅ Create `dashboard-manager.test.js` with core functionality tests
2. ✅ Create `dashboard-sse.test.js` with SSE integration tests
3. ✅ Add integration tests for orchestrator → dashboard flow
4. ✅ Enable dashboard in existing integration tests

### Short-Term (Following Sprint)
5. ✅ Add web endpoint tests
6. ✅ Add performance tests (SSE with 10+ connections)
7. ✅ Add error handling tests
8. ✅ Document dashboard testing patterns

### Long-Term (Before Multi-Project Release)
9. ✅ Add multi-project SSE isolation tests
10. ✅ Add cross-project aggregation tests
11. ✅ Add load testing (50+ concurrent SSE connections)
12. ✅ Add end-to-end dashboard UI tests (Playwright)

---

## Success Criteria

**Phase 1 Complete When**:
- [ ] All DashboardManager methods tested
- [ ] SSE connection lifecycle tested
- [ ] Usage metric updates verified
- [ ] Execution plan updates verified
- [ ] Test coverage ≥ 85%

**Phase 2 Complete When**:
- [ ] Integration tests passing
- [ ] Real-time updates working (<2s latency)
- [ ] No memory leaks detected
- [ ] Error handling robust

**Multi-Project Ready When**:
- [ ] All dashboard tests pass for multi-project
- [ ] SSE isolation verified
- [ ] Aggregation logic tested
- [ ] Performance acceptable (10+ projects)

---

## Conclusion

**Current State**: Dashboard has **zero test coverage** despite being a critical user-facing component.

**Impact**: High risk of silent failures, incorrect data display, and poor user experience.

**Recommendation**: Prioritize dashboard testing immediately. Start with Phase 1 (core tests) and Phase 2 (SSE tests) before multi-project implementation.

**Estimated Effort**: 12 hours total
- Phase 1 (Core): 4 hours
- Phase 2 (SSE): 3 hours
- Phase 3 (Integration): 3 hours
- Phase 4 (Endpoints): 2 hours

---

**Last Updated**: 2025-12-13
**Next Review**: After Phase 1 implementation
