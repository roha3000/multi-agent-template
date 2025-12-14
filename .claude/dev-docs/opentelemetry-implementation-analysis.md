# OpenTelemetry Integration - Implementation Analysis

## Executive Summary

**Effort**: 6-9 hours of focused development
**Complexity**: MEDIUM (well-documented, standardized approach)
**Reliability**: HIGH (once working, fully automatic and accurate)
**Risk**: LOW-MEDIUM (depends on Claude Code's telemetry output format)

**Recommendation**: IMPLEMENT - This is the right solution for autonomous operation

---

## What Claude Code Provides

According to official documentation, when `CLAUDE_CODE_ENABLE_TELEMETRY=1` is set, Claude Code exports:

### Metrics Available

1. **`claude_code.token.usage`** (CRITICAL for us)
   - Segmented by type: `input`, `output`, `cache_read`, `cache_creation`
   - Includes model information
   - Real-time per-request data

2. **`claude_code.cost.usage`**
   - Session cost in USD
   - Useful for validation against our CostCalculator

3. **`claude_code.api_request`** (Event)
   - Detailed metadata including token counts
   - Cache metrics
   - Request duration
   - Model used

### Export Format

- Protocol: OTLP (OpenTelemetry Protocol)
- Transport: HTTP or gRPC
- Format: Protobuf or JSON

---

## Architecture: How It Would Work

```
┌─────────────────────────────────────────────────────────┐
│              Claude Code Process                         │
│                                                          │
│  [Makes API call to Anthropic]                          │
│           ↓                                             │
│  [Receives response with token usage]                   │
│           ↓                                             │
│  [Exports OTLP metric: claude_code.token.usage]         │
│                                                          │
└──────────────────────┬──────────────────────────────────┘
                       │ OTLP over HTTP/gRPC
                       ↓
┌─────────────────────────────────────────────────────────┐
│         OpenTelemetry Metric Receiver                    │
│         (Our custom receiver in Node.js)                 │
│                                                          │
│  • Listens on port (e.g., 4318 for HTTP)                │
│  • Receives metric batches                              │
│  • Parses OTLP protobuf/JSON                            │
│                                                          │
└──────────────────────┬──────────────────────────────────┘
                       │ Parsed metrics
                       ↓
┌─────────────────────────────────────────────────────────┐
│            Metric Processor & Aggregator                 │
│                                                          │
│  • Extracts token counts by type                        │
│  • Aggregates incremental usage                         │
│  • Correlates with session context                      │
│                                                          │
└──────────────────────┬──────────────────────────────────┘
                       │ Structured usage data
                       ↓
┌─────────────────────────────────────────────────────────┐
│                  UsageTracker                            │
│                                                          │
│  usageTracker.recordUsage({                             │
│    orchestrationId,                                     │
│    model,                                               │
│    inputTokens,                                         │
│    outputTokens,                                        │
│    cacheReadTokens,                                     │
│    cacheCreationTokens                                  │
│  })                                                     │
│                                                          │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ↓
              [Existing DashboardManager flow]
```

---

## Implementation Breakdown

### Phase 1: Basic OTLP Receiver (3-4 hours)

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
   - Listen on port 4318 (standard OTLP HTTP)
   - Parse incoming metric requests
   - Log metric data to verify format

3. Enable Claude Code telemetry (15 min)
   - Set `CLAUDE_CODE_ENABLE_TELEMETRY=1`
   - Configure OTLP endpoint to our receiver

4. Test metric reception (30 min)
   - Trigger Claude Code actions
   - Verify metrics arrive
   - Inspect actual data format

**Deliverable**: Receiver that logs all metrics from Claude Code

**Risk**: LOW - OTLP is standardized

### Phase 2: Metric Processing (2-3 hours)

**Goal**: Extract token usage from metrics and transform to UsageTracker format

**Tasks**:
1. Parse `claude_code.token.usage` metric (1 hour)
   - Extract data points
   - Read attributes (type, model)
   - Calculate incremental usage

2. Handle metric batching and aggregation (1 hour)
   - Metrics may arrive in batches
   - Need to track cumulative vs incremental
   - Handle out-of-order delivery

3. Transform to UsageTracker format (30 min)
   - Map metric attributes to our schema
   - Generate orchestration IDs
   - Correlate with session context

**Deliverable**: Processor that outputs UsageTracker-compatible records

**Risk**: MEDIUM - Depends on actual metric format (may need adjustments)

### Phase 3: Integration (1 hour)

**Goal**: Connect processor to UsageTracker and DashboardManager

**Tasks**:
1. Call `usageTracker.recordUsage()` (15 min)
2. Update DashboardManager state (15 min)
3. Handle errors and edge cases (30 min)
   - Receiver crashes
   - Metric format changes
   - Connection issues

**Deliverable**: End-to-end automated tracking

**Risk**: LOW - Integration is straightforward

### Phase 4: Testing & Validation (2-3 hours)

**Goal**: Ensure reliability and accuracy

**Tasks**:
1. Accuracy testing (1 hour)
   - Compare against manual tracking
   - Verify token counts match Claude's reports
   - Test cache metrics

2. Reliability testing (1 hour)
   - Long-running sessions
   - Error recovery
   - Resource usage (memory leaks, etc.)

3. Edge case testing (1 hour)
   - Multiple concurrent sessions
   - Rapid-fire requests
   - Metric delivery failures

**Deliverable**: Production-ready automated tracking

**Risk**: LOW - Testing reveals issues but doesn't add complexity

---

## Total Effort Estimate

| Phase | Time | Complexity |
|-------|------|------------|
| Phase 1: OTLP Receiver | 3-4 hours | MEDIUM |
| Phase 2: Metric Processing | 2-3 hours | MEDIUM-HIGH |
| Phase 3: Integration | 1 hour | LOW |
| Phase 4: Testing | 2-3 hours | LOW |
| **TOTAL** | **8-11 hours** | **MEDIUM** |

**Revised estimate**: 8-11 hours (slightly higher than initial 6-9 due to testing)

---

## Complexity Analysis

### Technical Complexity: MEDIUM

**Pros** (reduces complexity):
- ✅ OTLP is a well-documented standard
- ✅ OpenTelemetry has mature Node.js SDKs
- ✅ Our UsageTracker is already designed for this
- ✅ No need to modify Claude Code itself

**Cons** (increases complexity):
- ⚠️ Need to understand OTLP protocol
- ⚠️ Metric format might differ from documentation
- ⚠️ Requires running a background receiver service
- ⚠️ Additional dependency (OpenTelemetry packages)

### Operational Complexity: MEDIUM

**New components to manage**:
1. OTLP receiver process (could be integrated with dashboard)
2. Additional configuration (telemetry endpoint)
3. Error handling for metric delivery failures

**Mitigation**:
- Integrate receiver into existing DashboardManager process
- Use same SQLite database for persistence
- Graceful degradation if telemetry unavailable

---

## Alternative Approaches Considered

### Alternative 1: Parse Claude Code Logs

**Effort**: 4-6 hours
**Complexity**: MEDIUM
**Reliability**: LOW-MEDIUM

**Pros**:
- No external dependencies
- Simpler setup

**Cons**:
- Log format might change
- Less structured data
- Harder to parse reliably
- May miss token usage if not logged

**Verdict**: NOT RECOMMENDED - Less reliable than telemetry

### Alternative 2: Proxy Anthropic API Calls

**Effort**: 10-15 hours
**Complexity**: HIGH
**Reliability**: HIGH (but fragile)

**Approach**:
- Set up HTTP proxy
- Intercept Claude Code's API requests
- Parse responses for token usage
- Forward data to UsageTracker

**Pros**:
- 100% accurate
- Captures all API calls

**Cons**:
- Very complex (TLS interception, etc.)
- Brittle (breaks if Claude Code changes networking)
- Security concerns
- High maintenance

**Verdict**: NOT RECOMMENDED - Too complex

### Alternative 3: Hook into Anthropic SDK

**Effort**: 6-8 hours
**Complexity**: MEDIUM-HIGH
**Reliability**: MEDIUM

**Approach**:
- Monkey-patch Anthropic SDK
- Wrap API call methods
- Capture responses before Claude Code sees them

**Pros**:
- Relatively simple
- Direct access to responses

**Cons**:
- Requires finding where SDK is loaded
- Brittle (breaks on SDK updates)
- Might not work if Claude Code bundles SDK

**Verdict**: POSSIBLE - But less reliable than telemetry

---

## Risks & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Claude Code telemetry format differs from docs | MEDIUM | HIGH | Phase 1 validates actual format first |
| Metrics arrive out of order | LOW | MEDIUM | Implement aggregation with timestamps |
| Receiver process crashes | LOW | HIGH | Integrate with DashboardManager (auto-restart) |
| Claude Code doesn't export metrics as expected | LOW | CRITICAL | Fallback to estimation or request feature |
| Performance impact on Claude Code | LOW | LOW | OTLP is designed for low overhead |

**Overall Risk Level**: LOW-MEDIUM with proper testing

---

## Decision Matrix

| Criteria | Manual Tracking | Hook Estimation | OpenTelemetry | Log Parsing | API Proxy |
|----------|----------------|-----------------|---------------|-------------|-----------|
| **Automation** | ❌ None | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| **Accuracy** | ✅ 100% | ⚠️ 70-80% | ✅ 100% | ⚠️ 80-90% | ✅ 100% |
| **Reliability** | ❌ User-dependent | ⚠️ Medium | ✅ High | ⚠️ Medium | ⚠️ Fragile |
| **Effort** | ✅ 0 hours | ✅ Done | ⚠️ 8-11 hours | ⚠️ 4-6 hours | ❌ 10-15 hours |
| **Complexity** | ✅ None | ✅ Low | ⚠️ Medium | ⚠️ Medium | ❌ High |
| **Maintenance** | ✅ None | ✅ Low | ✅ Low | ⚠️ Medium | ❌ High |
| **Future-proof** | ✅ N/A | ⚠️ Depends on hooks | ✅ Standardized | ❌ Log changes | ❌ Brittle |

**Weighted Score** (higher is better):
- Manual Tracking: ❌ **Fails automation requirement**
- Hook Estimation: **5/10** - Automatic but inaccurate
- **OpenTelemetry: 9/10** ⭐ - Best balance
- Log Parsing: 6/10 - Less reliable
- API Proxy: 5/10 - Too complex

---

## Recommendation: IMPLEMENT OPENTELEMETRY

### Why This Is The Right Choice

1. **Meets Core Requirement**: Fully automatic, no human intervention
2. **High Accuracy**: Uses actual Claude API response data
3. **Industry Standard**: OTLP is widely supported and stable
4. **Reasonable Effort**: 8-11 hours is acceptable for a critical feature
5. **Low Maintenance**: Once working, requires minimal upkeep
6. **Future-Proof**: Standard protocol unlikely to change

### What Success Looks Like

After implementation:
```
✅ Claude Code session starts
✅ Every API call triggers metric export
✅ Receiver captures token usage automatically
✅ UsageTracker records usage in real-time
✅ Dashboard updates with accurate data
✅ Context window monitoring works correctly
✅ Checkpoint triggers activate when needed
✅ ZERO manual intervention required
```

### Implementation Timeline

**Single focused work session**: 1-2 days
**Part-time over a week**: 5-7 days

### Next Steps

1. **Approve this approach** ✓
2. **Phase 1**: Set up OTLP receiver (validate metrics arrive)
3. **Phase 2**: Implement metric processing
4. **Phase 3**: Integrate with UsageTracker
5. **Phase 4**: Test and validate
6. **Deploy**: Enable in continuous loop system

---

## Code Structure Preview

```javascript
// .claude/core/telemetry-receiver.js
class TelemetryReceiver {
  constructor({ usageTracker, port = 4318 }) {
    this.server = http.createServer(this.handleRequest.bind(this));
    this.usageTracker = usageTracker;
  }

  async handleRequest(req, res) {
    // Parse OTLP metric request
    const metrics = await this.parseOTLPRequest(req);

    // Process each metric
    for (const metric of metrics) {
      if (metric.name === 'claude_code.token.usage') {
        await this.processTokenUsage(metric);
      }
    }

    res.writeHead(200);
    res.end();
  }

  async processTokenUsage(metric) {
    // Extract token data
    const usage = this.extractUsageFromMetric(metric);

    // Record in UsageTracker
    await this.usageTracker.recordUsage(usage);
  }
}
```

**Estimated LOC**: 400-500 lines total

---

## Conclusion

**OpenTelemetry integration is feasible, reasonable, and the right solution.**

- ✅ Achieves full automation (your requirement)
- ✅ High reliability and accuracy
- ⚠️ Moderate effort (8-11 hours)
- ⚠️ Medium complexity (but well-documented)
- ✅ Low ongoing maintenance
- ✅ Industry-standard approach

**Recommend**: Proceed with implementation

The alternative (hook-based estimation) remains functional as a fallback, but won't provide the accuracy needed for reliable checkpoint triggering.

**Question**: Should we proceed with Phase 1 (basic receiver) to validate the approach?
