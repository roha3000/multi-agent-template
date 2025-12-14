# Active Tasks - OpenTelemetry Implementation

**Last Updated**: 2025-12-13
**Current Session**: Automated Usage Tracking via OpenTelemetry
**Status**: Ready to Begin
**Priority**: 🔴 CRITICAL

---

## Task Status Legend

- 🟢 **Completed**: Task finished and validated
- 🟡 **In Progress**: Currently working on this task
- ⚪ **Pending**: Waiting to start
- 🔴 **Blocked**: Waiting on dependency or issue resolution

---

## OpenTelemetry Integration (8-11 hours)

### Context
User requirement: "Manual tracking is a non-starter. I want fully automated and reliable tracking. It is the premise behind being able to prevent compaction."

Dashboard and UsageTracker were built but not connected to Claude Code sessions. OpenTelemetry is the only solution that provides 100% automation + 100% accuracy.

---

### Phase 1: OTLP Receiver (3-4 hours) ⚪

**Status**: Pending
**Goal**: Receive and log telemetry from Claude Code
**Risk**: LOW

**Checklist**:
- [ ] Install OpenTelemetry packages
  - [ ] `npm install @opentelemetry/api`
  - [ ] `npm install @opentelemetry/sdk-metrics`
  - [ ] `npm install @opentelemetry/exporter-metrics-otlp-http`
  - [ ] `npm install @opentelemetry/exporter-metrics-otlp-grpc`
- [ ] Create `.claude/core/otlp-receiver.js`
  - [ ] Set up HTTP server on port 4318
  - [ ] Parse incoming OTLP requests (protobuf/JSON)
  - [ ] Log metric structure to console
  - [ ] Add error handling
- [ ] Enable Claude Code telemetry
  - [ ] Set `CLAUDE_CODE_ENABLE_TELEMETRY=1`
  - [ ] Configure OTLP endpoint
  - [ ] Update continuous loop scripts
- [ ] Test metric reception
  - [ ] Trigger Claude Code actions
  - [ ] Verify metrics arrive
  - [ ] Inspect actual format vs documentation
  - [ ] Document any differences

**Success Criteria**:
- [ ] Receiver starts without errors
- [ ] Metrics arrive from Claude Code
- [ ] Can parse and log metric structure
- [ ] Confirmed `claude_code.token.usage` metric exists

**Deliverable**: Working OTLP receiver that logs all metrics

---

### Phase 2: Metric Processing (2-3 hours) ⚪

**Status**: Pending (after Phase 1)
**Goal**: Extract token usage and transform to UsageTracker format
**Risk**: MEDIUM (depends on actual format)

**Checklist**:
- [ ] Create `.claude/core/metric-processor.js`
- [ ] Parse `claude_code.token.usage` metric
  - [ ] Extract data points from batches
  - [ ] Read attributes (type, model)
  - [ ] Handle different attribute formats
- [ ] Implement batching and aggregation
  - [ ] Track cumulative values
  - [ ] Calculate incremental (delta) usage
  - [ ] Handle out-of-order delivery
  - [ ] Add timestamp-based deduplication
- [ ] Transform to UsageTracker schema
  - [ ] Map attributes to our format
  - [ ] Generate orchestration IDs
  - [ ] Correlate with session context
  - [ ] Create `recordUsage()` compatible output

**Success Criteria**:
- [ ] Correctly parses all token types (input/output/cache_read/cache_creation)
- [ ] Calculates accurate incremental usage
- [ ] Handles batching without data loss
- [ ] Output matches UsageTracker schema

**Deliverable**: Processor that outputs UsageTracker-compatible records

---

### Phase 3: Integration (1 hour) ⚪

**Status**: Pending (after Phase 2)
**Goal**: Connect processor to UsageTracker and DashboardManager
**Risk**: LOW

**Checklist**:
- [ ] Integrate with UsageTracker
  - [ ] Call `usageTracker.recordUsage()`
  - [ ] Handle async recording
  - [ ] Maintain event order
  - [ ] Add logging
- [ ] Integrate with DashboardManager
  - [ ] Ensure real-time updates
  - [ ] Verify SSE broadcasts
  - [ ] Test web dashboard display
- [ ] Error handling
  - [ ] Receiver crash → auto-restart
  - [ ] Metric format changes → graceful degradation
  - [ ] Connection issues → queue and retry
  - [ ] Telemetry unavailable → fallback to hook estimation

**Success Criteria**:
- [ ] Usage recorded in DB after API calls
- [ ] Dashboard updates in real-time (<2s)
- [ ] No data loss on errors
- [ ] Graceful degradation works

**Deliverable**: End-to-end automated tracking

---

### Phase 4: Testing & Validation (2-3 hours) ⚪

**Status**: Pending (after Phase 3)
**Goal**: Ensure reliability and accuracy for production
**Risk**: LOW

**Checklist**:
- [ ] Accuracy testing
  - [ ] Compare vs Claude budget tags
  - [ ] Verify token counts match exactly
  - [ ] Test cache metrics
  - [ ] Validate cost calculations
- [ ] Reliability testing
  - [ ] Long-running sessions (>2 hours)
  - [ ] Error recovery (restart mid-session)
  - [ ] Resource usage (memory/CPU)
  - [ ] Metric delivery failures
- [ ] Edge case testing
  - [ ] Multiple concurrent sessions
  - [ ] Rapid-fire requests (stress test)
  - [ ] Different models (Sonnet/Opus/Haiku)
  - [ ] Missing or malformed metrics
- [ ] Documentation
  - [ ] Update usage tracking guide
  - [ ] Document configuration
  - [ ] Add troubleshooting section
  - [ ] Create validation report

**Success Criteria**:
- [ ] ≥99% accuracy validated
- [ ] Zero data loss in stress tests
- [ ] Edge cases handled gracefully
- [ ] Resource usage acceptable (<50MB RAM, <5% CPU)
- [ ] Documentation complete

**Deliverable**: Production-ready automated tracking with validation report

---

## Completed Prerequisites ✅

### Phase 0: Dashboard Testing
- [x] **Phase 0.1**: DashboardManager core tests (42 tests, 90% coverage)
  - Test initialization and state structure
  - Test execution plan tracking
  - Test context window calculations
  - Test metrics updates from UsageTracker
  - Test event tracking and message bus

### Usage Tracking Analysis
- [x] Identified problem: Dashboard not connected to Claude sessions
- [x] Researched Claude Code documentation (claude-code-guide agent)
- [x] Analyzed 5 alternative approaches
- [x] Selected OpenTelemetry as optimal solution
- [x] Created comprehensive implementation analysis

### Fallback Implementations
- [x] Manual tracking script (`.claude/scripts/track-usage.js`)
- [x] Hook-based estimation (`.claude/hooks/track-usage.js`)
- [x] Session tracker abstraction (`.claude/core/claude-session-tracker.js`)

---

## Pending Future Work

### Dashboard Testing (After OpenTelemetry)
- [ ] **Phase 0.2**: SSE integration tests (3 hours)
- [ ] **Phase 0.3**: Orchestrator integration tests (3 hours)
- [ ] **Phase 0.4**: Web endpoint tests (2 hours, lower priority)

### Multi-Project Implementation (After Dashboard Testing)
- [ ] **Phase 1**: Core infrastructure (8-10 hours)
- [ ] **Phase 2**: Unified dashboard (6-8 hours)
- [ ] **Phase 3**: Advanced features (6-8 hours)
- [ ] **Phase 4**: Testing & polish (6-8 hours)

---

## Progress Summary

### OpenTelemetry Implementation
- **Total Effort**: 8-11 hours
- **Phase 1**: 0% (not started)
- **Phase 2**: 0% (not started)
- **Phase 3**: 0% (not started)
- **Phase 4**: 0% (not started)
- **Overall**: 0% complete

### Next Milestone
Complete Phase 1: OTLP receiver validated with actual Claude Code metrics

---

## Blockers & Dependencies

**Current Blockers**: None ✅

**Dependencies**:
- ✅ UsageTracker (42 tests passing)
- ✅ DashboardManager (42 tests passing, 90% coverage)
- ✅ MemoryStore with SQLite
- ✅ ContinuousLoopOrchestrator
- ✅ Dashboard testing infrastructure (Phase 0.1)

**New Dependencies to Install**:
- `@opentelemetry/api`
- `@opentelemetry/sdk-metrics`
- `@opentelemetry/exporter-metrics-otlp-http`
- `@opentelemetry/exporter-metrics-otlp-grpc`

---

## Current Focus

**Active Task**: None (ready to start Phase 1)
**Next Action**: Install OpenTelemetry packages and create receiver skeleton
**Estimated Time**: 3-4 hours for Phase 1
**Expected Outcome**: Working OTLP receiver that logs Claude Code metrics

---

## Risk Assessment

| Phase | Risk Level | Primary Risk | Mitigation |
|-------|-----------|--------------|------------|
| Phase 1 | 🟢 LOW | Metric format differs | Validate actual format first |
| Phase 2 | 🟡 MEDIUM | Unexpected format | Adjust processor as needed |
| Phase 3 | 🟢 LOW | Integration issues | Use existing tested components |
| Phase 4 | 🟢 LOW | Edge cases | Comprehensive testing |

**Overall Risk**: 🟢 LOW-MEDIUM with incremental validation

---

## Success Metrics

### When OpenTelemetry Is Complete:
- [ ] **100% automated** - Zero human intervention
- [ ] **100% accurate** - Matches Claude's actual token usage
- [ ] **Highly reliable** - Handles errors and edge cases
- [ ] **Low overhead** - Minimal resource impact (<50MB RAM, <5% CPU)
- [ ] **Production-ready** - Fully tested and validated

### Enables:
- ✅ Autonomous checkpoint management
- ✅ Context window exhaustion prevention
- ✅ Accurate cost tracking
- ✅ Real-time dashboard updates
- ✅ Multi-project usage monitoring (future)

---

## Timeline

**Current Session**: Session state saved, ready for implementation

**Next Session**:
1. Start Phase 1 (OTLP receiver)
2. Install packages
3. Create receiver skeleton
4. Enable telemetry and test

**ETA for Complete Integration**:
- Focused: 1-2 work sessions (8-11 hours)
- Part-time: 5-7 days (~2 hours/day)

---

## Notes

- User explicitly rejected manual tracking ("non-starter")
- Hook estimation (70-80% accuracy) insufficient for checkpoint triggering
- OpenTelemetry is ONLY solution meeting automation + accuracy requirements
- Phase 1 validation is critical (confirms Claude Code exports as documented)
- Fallback strategies in place if telemetry doesn't work
- All prerequisites complete - ready to begin immediately

---

**Last Updated**: 2025-12-13
**Next Update**: After Phase 1 completion (receiver validated)
