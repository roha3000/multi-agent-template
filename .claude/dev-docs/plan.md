# Current Task Plan - OpenTelemetry Integration

**Last Updated**: 2025-12-13
**Current Task**: Implement OpenTelemetry Integration for Automated Usage Tracking
**Status**: Ready to Begin
**Priority**: CRITICAL (Required for autonomous checkpoint management)

---

## Overview

Implement OpenTelemetry (OTLP) integration to automatically capture token usage from Claude Code sessions. This enables fully automated, accurate usage tracking required for intelligent checkpoint triggering and context window exhaustion prevention.

**Goal**: 100% automated, 100% accurate token usage tracking with zero human intervention

**User Requirement**: "Manual tracking is a non-starter. I want fully automated and reliable tracking. It is the premise behind being able to prevent compaction."

---

## Background

### Problem Identified
Dashboard and UsageTracker infrastructure was built but **not connected to Claude Code sessions**. The system was "monitoring an orchestrator that nothing was using" - like a speedometer not connected to the engine.

### Root Cause
Claude Code hooks do NOT expose API response metadata (token usage). Confirmed via official documentation research using claude-code-guide agent.

### Solution Analysis
Evaluated 5 approaches:
1. ❌ Manual tracking - Fails automation requirement
2. ⚠️ Hook-based estimation - 70-80% accurate (insufficient for checkpoints)
3. ✅ **OpenTelemetry** - 100% automated + 100% accurate (SELECTED)
4. ⚠️ Log parsing - 80-90% accurate, fragile
5. ❌ API proxy - Too complex (10-15 hours), brittle

**Decision**: OpenTelemetry integration (8-11 hours, MEDIUM complexity, HIGH reliability)

---

## Implementation Breakdown

### Phase 1: OTLP Receiver (3-4 hours)
**Status**: ⏳ Not Started
**Goal**: Receive and log telemetry from Claude Code

**Tasks**:
1. Install OpenTelemetry packages (30 min)
   ```bash
   npm install @opentelemetry/api \
               @opentelemetry/sdk-metrics \
               @opentelemetry/exporter-metrics-otlp-http \
               @opentelemetry/exporter-metrics-otlp-grpc
   ```

2. Create basic OTLP HTTP receiver (2 hours)
   - Create `.claude/core/otlp-receiver.js`
   - Listen on port 4318 (standard OTLP HTTP)
   - Parse incoming metric requests (protobuf or JSON)
   - Log metric data to verify format

3. Enable Claude Code telemetry (15 min)
   - Set `CLAUDE_CODE_ENABLE_TELEMETRY=1` in environment
   - Configure OTLP endpoint to point to our receiver
   - Update continuous loop startup scripts

4. Test metric reception (30 min)
   - Trigger Claude Code actions (tool calls, responses)
   - Verify metrics arrive at receiver
   - Inspect actual data format vs documentation
   - Document any format differences

**Deliverable**: `otlp-receiver.js` that successfully logs all metrics from Claude Code

**Success Criteria**:
- Receiver starts without errors
- Metrics arrive from Claude Code
- Can parse and log metric structure
- Confirmed `claude_code.token.usage` metric exists

**Risk**: LOW - OTLP is standardized protocol

---

### Phase 2: Metric Processing (2-3 hours)
**Status**: ⏳ Not Started
**Goal**: Extract token usage from metrics and transform to UsageTracker format

**Tasks**:
1. Parse `claude_code.token.usage` metric (1 hour)
   - Extract data points from metric batches
   - Read attributes (type: input/output/cache_read/cache_creation, model)
   - Handle different attribute formats

2. Handle metric batching and aggregation (1 hour)
   - Metrics arrive in batches, not individually
   - Track cumulative values
   - Calculate incremental (delta) usage per request
   - Handle out-of-order delivery

3. Transform to UsageTracker format (30 min)
   - Map metric attributes to our schema
   - Generate orchestration IDs
   - Correlate with session context
   - Create usage records compatible with `usageTracker.recordUsage()`

**Deliverable**: `metric-processor.js` that outputs UsageTracker-compatible records

**Success Criteria**:
- Correctly parses all token usage metric types
- Calculates accurate incremental usage (not cumulative)
- Handles batching without data loss
- Output matches UsageTracker schema

**Risk**: MEDIUM - Depends on actual metric format (may require adjustments)

---

### Phase 3: Integration (1 hour)
**Status**: ⏳ Not Started
**Goal**: Connect processor to UsageTracker and DashboardManager

**Tasks**:
1. Call `usageTracker.recordUsage()` (15 min)
   - Pass processed usage records
   - Handle async recording properly
   - Maintain event order

2. Update DashboardManager state (15 min)
   - Ensure dashboard receives updates in real-time
   - Verify SSE broadcasts work
   - Test web dashboard display

3. Handle errors and edge cases (30 min)
   - Receiver crashes → Auto-restart via continuous loop
   - Metric format changes → Graceful degradation
   - Connection issues → Queue and retry
   - Telemetry unavailable → Fall back to hook estimation

**Deliverable**: End-to-end automated tracking from Claude Code → Dashboard

**Success Criteria**:
- Usage recorded in database immediately after API calls
- Dashboard updates in real-time (<2s latency)
- No data loss on errors
- Graceful degradation if telemetry fails

**Risk**: LOW - Integration with existing components is straightforward

---

### Phase 4: Testing & Validation (2-3 hours)
**Status**: ⏳ Not Started
**Goal**: Ensure reliability and accuracy for production use

**Tasks**:
1. Accuracy testing (1 hour)
   - Compare captured usage against Claude's budget tags
   - Verify token counts match exactly
   - Test cache metrics (read/creation)
   - Validate cost calculations

2. Reliability testing (1 hour)
   - Long-running sessions (>2 hours)
   - Error recovery (restart receiver mid-session)
   - Resource usage (memory leaks, CPU)
   - Metric delivery failures

3. Edge case testing (1 hour)
   - Multiple concurrent Claude sessions
   - Rapid-fire requests (stress test)
   - Different models (Sonnet, Opus, Haiku)
   - Missing or malformed metrics

**Deliverable**: Production-ready automated tracking with validation report

**Success Criteria**:
- ≥99% accuracy vs manual tracking
- Zero data loss in stress tests
- Handles edge cases gracefully
- Resource usage acceptable (<50MB RAM, <5% CPU)

**Risk**: LOW - Testing reveals issues but doesn't add complexity

---

## Architecture

### Data Flow
```
Claude Code Session
    ↓ Makes API call to Anthropic
    ↓ Receives response with usage metadata
    ↓ Exports OTLP metric: claude_code.token.usage
    ↓
OTLP Receiver (port 4318)
    ↓ HTTP POST with protobuf/JSON payload
    ↓ Parses metric batch
    ↓
Metric Processor
    ↓ Extracts token data by type
    ↓ Calculates incremental usage
    ↓ Transforms to UsageTracker schema
    ↓
usageTracker.recordUsage({
  orchestrationId: 'telemetry-...',
  model: 'claude-sonnet-4',
  inputTokens: 5420,
  outputTokens: 2100,
  cacheReadTokens: 3200,
  cacheCreationTokens: 0
})
    ↓
MemoryStore (SQLite persistence)
    ↓
DashboardManager (reads from DB)
    ↓
Web Dashboard (SSE updates)
    ↓
Real-time usage display at http://localhost:3030
```

### Component Integration
- **OTLPReceiver**: HTTP server receiving Claude Code metrics
- **MetricProcessor**: Parses and transforms OTLP data
- **UsageTracker**: Existing component (42 tests, production-ready)
- **DashboardManager**: Existing component (42 tests, 90% coverage)
- **MemoryStore**: Existing SQLite layer (tested)

### Configuration
```javascript
// Environment variables
CLAUDE_CODE_ENABLE_TELEMETRY=1
OTLP_RECEIVER_PORT=4318
OTLP_ENDPOINT=http://localhost:4318

// Continuous loop config
{
  "telemetry": {
    "enabled": true,
    "receiver": {
      "port": 4318,
      "protocol": "http",
      "format": "json"
    },
    "fallback": "hook-estimation"
  }
}
```

---

## Dependencies

**Prerequisites** (All Complete ✅):
- ✅ UsageTracker implemented and tested (42 tests)
- ✅ DashboardManager implemented and tested (42 tests)
- ✅ MemoryStore with SQLite persistence
- ✅ ContinuousLoopOrchestrator with MessageBus
- ✅ Dashboard testing infrastructure (Phase 0.1)

**New Dependencies to Install**:
- `@opentelemetry/api`
- `@opentelemetry/sdk-metrics`
- `@opentelemetry/exporter-metrics-otlp-http`
- `@opentelemetry/exporter-metrics-otlp-grpc`

**No Blockers**: All prerequisites complete, ready to implement

---

## Timeline

| Phase | Estimated Time | Status |
|-------|---------------|--------|
| Phase 1: OTLP Receiver | 3-4 hours | ⏳ Pending |
| Phase 2: Metric Processing | 2-3 hours | ⏳ Pending |
| Phase 3: Integration | 1 hour | ⏳ Pending |
| Phase 4: Testing & Validation | 2-3 hours | ⏳ Pending |
| **TOTAL** | **8-11 hours** | **Ready** |

**Recommended Approach**: Implement incrementally, validate each phase before proceeding

**ETA**: 1-2 focused work sessions (or 5-7 days part-time)

---

## Success Criteria

### Phase 1 Complete When:
- [ ] OTLP receiver running on port 4318
- [ ] Claude Code successfully sends metrics
- [ ] Can parse and log metric structure
- [ ] Confirmed `claude_code.token.usage` exists in actual data

### Phase 2 Complete When:
- [ ] Correctly extracts input/output/cache tokens
- [ ] Calculates incremental usage (not cumulative)
- [ ] Handles metric batching
- [ ] Output matches UsageTracker schema

### Phase 3 Complete When:
- [ ] Usage recorded in database after API calls
- [ ] Dashboard updates in real-time
- [ ] No data loss
- [ ] Graceful error handling

### Phase 4 Complete When:
- [ ] ≥99% accuracy validated
- [ ] Stress tests pass
- [ ] Edge cases handled
- [ ] Resource usage acceptable
- [ ] Documentation complete

### Overall Success:
- [ ] **100% automated** - Zero human intervention required
- [ ] **100% accurate** - Matches Claude's actual token usage
- [ ] **Highly reliable** - Handles errors, edge cases
- [ ] **Low overhead** - Minimal resource impact
- [ ] **Production-ready** - Tested and validated

---

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Metric format differs from docs | MEDIUM | HIGH | Phase 1 validates actual format first |
| Metrics arrive out of order | LOW | MEDIUM | Implement timestamp-based aggregation |
| Receiver process crashes | LOW | HIGH | Integrate with ContinuousLoopOrchestrator (auto-restart) |
| Claude Code doesn't export as expected | LOW | CRITICAL | Fallback to hook estimation, request feature |
| Performance impact | LOW | LOW | OTLP designed for low overhead |

**Overall Risk**: LOW-MEDIUM with proper incremental implementation

---

## Fallback Strategy

If OpenTelemetry integration faces insurmountable issues:
1. **Primary Fallback**: Hook-based estimation (already implemented)
   - 70-80% accurate
   - Fully automatic
   - Sufficient for basic checkpoint triggering

2. **Request Feature**: If telemetry doesn't work as documented
   - File issue with Claude Code team
   - Request better hook access to API metadata
   - Community may have solutions

3. **Alternative Approaches**: Log parsing or API proxy (documented but not recommended)

---

## Next Steps

### Immediate (This Session or Next)
1. Start Phase 1: Create OTLP receiver
2. Validate Claude Code actually exports metrics
3. Inspect actual metric format

### After Phase 1 Validation
4. If metrics work as expected → Continue with Phases 2-4
5. If metrics differ from docs → Adjust processor accordingly
6. If metrics don't arrive → Investigate telemetry configuration

### After OpenTelemetry Complete
7. Complete dashboard testing Phases 0.2-0.3 (6 hours)
8. Begin multi-project implementation (26-34 hours)

---

## Documentation References

**Created During Analysis**:
- `.claude/dev-docs/opentelemetry-implementation-analysis.md` - Full analysis (comprehensive)
- `.claude/dev-docs/usage-tracking-integration.md` - Integration guide (419 lines)
- `.claude/dev-docs/dashboard-testing-gaps.md` - Testing analysis

**External Documentation**:
- OpenTelemetry OTLP Specification
- Claude Code Monitoring & Usage docs
- @opentelemetry/sdk-metrics API docs

---

## Current Focus

**Active Task**: Prepare for Phase 1 implementation
**Next Action**: Install OpenTelemetry packages and create receiver skeleton
**Blockers**: None
**Status**: Ready to begin

---

**Last Updated**: 2025-12-13
**Next Update**: After Phase 1 completion (receiver validated)
