# Dashboard V3 Research: Comprehensive Findings

## Executive Summary

This document synthesizes research from 6 expert agents to inform the architecture of a next-generation multi-agent monitoring dashboard. The research covers industry patterns, streaming architectures, visualization libraries, hierarchy display, time-series storage, and current metrics infrastructure.

**Key Recommendations:**

| Area | Recommendation | Rationale |
|------|----------------|-----------|
| Streaming | SSE over HTTP/2 | Simpler than WebSocket, built-in reconnection, 25-30% lower overhead |
| Time-Series Charts | uPlot | Fastest canvas-based library, handles 100K+ points at 60fps |
| Hierarchy Visualization | Collapsible Tree (D3.js) | Best for 3-level hierarchies, familiar UX patterns |
| Standard Charts | Chart.js | Small bundle (~11KB), excellent real-time performance |
| Storage | Hybrid SQLite + In-Memory | Leverages existing infrastructure, sub-ms real-time access |
| Update Frequency | SSE event-driven + 5s polling | Critical data immediate, metrics every 5 seconds |

---

## 1. Research Scope & Questions Answered

### 1.1 Research Questions

| # | Question | Finding |
|---|----------|---------|
| 1 | Best ways to visualize 3+ level agent hierarchies? | Collapsible tree with status badges; avoid force-directed/treemaps |
| 2 | How do Grafana/Datadog handle high-frequency updates? | Streaming (WebSocket/SSE) for critical data, polling for aggregates |
| 3 | Optimal polling/streaming frequency? | Critical: immediate SSE; Metrics: 5s; Trends: 30-60s |
| 4 | How to visualize context usage to predict auto-compact? | Gauge with threshold zones + trend sparkline |
| 5 | Metrics to indicate delegation is improving performance? | Token savings %, time reduction, ROI analysis |
| 6 | How to surface auto-compact issues? | Alert banner + event timeline + context trend charts |
| 7 | Ideal data retention policy? | Tiered: 5min hot, 24h warm, 7d hourly, 1yr daily |
| 8 | How to aggregate per-agent metrics? | Rollup metrics with recursive parent aggregation |
| 9 | Visualization patterns for before/after delegation? | Side-by-side comparison cards, A/B sparklines |
| 10 | How to surface actionable insights? | Alert severity levels, quality thresholds, trend detection |

### 1.2 Component Design Coverage

| Component | Research Document |
|-----------|-------------------|
| Projects Panel | DASHBOARD-PATTERNS-RESEARCH.md |
| Sessions Panel | DASHBOARD-PATTERNS-RESEARCH.md |
| Context Tracker | TIME-SERIES-STORAGE-RESEARCH.md |
| Task Queue | DASHBOARD-PATTERNS-RESEARCH.md |
| Hierarchy Viewer | HIERARCHY-VISUALIZATION-RESEARCH.md |
| Performance Charts | Visualization Libraries Report |
| Orchestrator Metrics | Current Metrics Infrastructure Report |
| Agent Efficiency | TIME-SERIES-STORAGE-RESEARCH.md |
| Auto-Compact Monitor | REALTIME-STREAMING-ARCHITECTURE-RESEARCH.md |

---

## 2. Industry Dashboard Patterns

### 2.1 Key Patterns from Leading Platforms

**Grafana:**
- Streaming via Grafana Live (WebSocket-based)
- Hierarchical dashboard organization (folders, rows, panels)
- 15-20 panels max per dashboard view
- Template variables for dynamic filtering

**Datadog:**
- Top-left placement for critical metrics
- Tiered alerts (60% threshold, 25% anomaly, 15% composite)
- Widget grouping by functional category
- Time window strategies: 1-5min (real-time), 15-60min (trends), hours+ (planning)

**Kubernetes Dashboard:**
- 3-level hierarchy: Cluster → Namespace → Pod → Container
- Pessimistic status roll-up (worst child status bubbles up)
- Watch API for incremental updates

**VS Code Debug Panel:**
- TreeDataProvider pattern for collapsible trees
- Lazy-load children on expand
- Event-driven updates via onDidChangeTreeData

### 2.2 Anti-Patterns to Avoid

| Anti-Pattern | Impact | Solution |
|--------------|--------|----------|
| Over-reliance on templates | Generic views don't provide context | Customize for specific use cases |
| Collecting everything | High costs, noise | Collect what's actionable |
| Monolithic dashboards | Slow load, overwhelming | Break into focused views |
| No maintenance | Stale, irrelevant dashboards | Regular review cycles |
| Excessive polling | Unnecessary load | Use SSE for real-time needs |

---

## 3. Real-Time Streaming Architecture

### 3.1 Recommended: Server-Sent Events (SSE)

**Why SSE over WebSocket:**
- Unidirectional data flow matches dashboard monitoring
- 25-30% lower resource overhead
- Built-in automatic reconnection with Last-Event-ID
- HTTP/2 eliminates 6-connection-per-domain limit
- Production proven (Netflix Hystrix, ChatGPT)

### 3.2 Update Frequencies by Data Type

| Data Type | Frequency | Method |
|-----------|-----------|--------|
| Token counts | Every 5s | Polling or batched SSE |
| Task status | On change | SSE event-driven |
| Quality scores | On completion | SSE event-driven |
| Session list | 10s + on change | Hybrid |
| Errors/alerts | Immediate | SSE event-driven |
| Progress indicators | 2-3s | SSE with throttling |
| Historical charts | 30-60s | Polling |

### 3.3 Event Structure (JSON Patch for Efficiency)

```javascript
// SSE event format
event: taskUpdate
id: 1703847123456
data: {"op":"replace","path":"/sessions/sess-001/status","value":"completed"}

// Batched changes
event: batchUpdate
data: [
  {"op":"replace","path":"/sessions/sess-001/tokenCount","value":5432},
  {"op":"add","path":"/tasks/-","value":{"id":"task-006","status":"pending"}}
]
```

### 3.4 UI Performance: requestAnimationFrame Batching

```javascript
class UpdateBatcher {
  add(update) {
    this.pending.push(update);
    if (!this.frameId) {
      this.frameId = requestAnimationFrame(() => {
        const updates = this.pending;
        this.pending = [];
        this.onFlush(updates); // Batch into single state change
      });
    }
  }
}
```

---

## 4. Visualization Libraries

### 4.1 Recommended Stack

| Visualization Need | Library | Bundle Size | Rationale |
|-------------------|---------|-------------|-----------|
| Time-series (tokens, metrics) | uPlot | ~47KB | Best performance, 100K+ points at 60fps |
| Agent hierarchy (tree/DAG) | D3.js + d3-dag | ~60KB | Only option for complex hierarchies |
| Standard charts (gauges, bars) | Chart.js | ~11KB | Small bundle, good performance, easy API |
| Sparklines (inline mini-charts) | @fnando/sparkline | ~2KB | Zero deps, tiny, SVG output |
| **Total** | - | **~120KB** | Optimized for performance |

### 4.2 Performance Benchmarks

| Library | 10K Points Render | Memory | Max Points @60fps |
|---------|-------------------|--------|-------------------|
| uPlot | 34ms | 21MB | ~100,000 |
| Chart.js | 38ms | 77MB | ~10,000 |
| ECharts | 55ms | 85MB | ~10,000 |
| Plotly.js | 310ms | High | ~1,000 |

### 4.3 Alternative: Single Library (ECharts)

If team consistency > optimal performance:
- Everything in one package
- Excellent performance with WebGL option
- Tree/treemap support
- Real-time streaming
- Tradeoff: ~1MB bundle size

---

## 5. Hierarchy Visualization

### 5.1 Recommendation: Collapsible Tree View

**Ratings:**

| Aspect | Collapsible Tree | DAG | Force-Directed | Treemap |
|--------|-----------------|-----|----------------|---------|
| Hierarchy clarity | Excellent | Good | Poor | Poor |
| Deep hierarchies (3+ levels) | Excellent | Good | Poor | Poor |
| Real-time updates | Excellent | Fair | Fair | Fair |
| Space efficiency | Good | Fair | Fair | Excellent |
| Familiarity | Excellent | Fair | Good | Fair |

**Why Collapsible Tree:**
- Perfect for root → sub-agents → sub-sub-agents
- Easy to update individual nodes
- Natural metadata placement
- Users familiar from file explorers

### 5.2 Node Design

```
[v] [*] [Robot] Research Analyst     [2.5K] [87*] [45s] (3)
 ^   ^    ^           ^                ^      ^     ^    ^
 |   |    |           |                |      |     |    Child count
 |   |    |           |                |      |     Duration
 |   |    |           |                |      Quality score
 |   |    |           |                Token usage
 |   |    |           Node name
 |   |    Type icon
 |   Status dot (color-coded, may pulse)
 Expand/collapse toggle
```

### 5.3 Status Color Coding

| Status | Color | Visual |
|--------|-------|--------|
| Active (running) | Blue | Pulse animation |
| Completed (success) | Green | Solid |
| Failed (error) | Red | Solid |
| Pending (waiting) | Yellow/amber | Solid |
| Idle | Gray | Solid |

### 5.4 Handling 20+ Nodes

1. **Virtualization**: Only render visible nodes (react-arborist)
2. **Aggregation**: "... and N more" for large child counts
3. **Filtering**: By status, agent type, quality threshold
4. **Search**: Filter tree to matching nodes
5. **Level-of-detail**: Simplified view when zoomed out

---

## 6. Time-Series Storage

### 6.1 Recommendation: Hybrid SQLite + In-Memory

**Architecture:**
```
[Hot: In-Memory LRU Cache] → 5 minutes
        ↓
[Warm: SQLite metrics_raw] → 24 hours
        ↓
[Cold: SQLite metrics_hourly] → 7 days
        ↓
[Archive: SQLite metrics_daily] → 1 year
```

### 6.2 Storage Calculations

| Tier | Retention | Size |
|------|-----------|------|
| In-Memory (hot) | 5 min | ~3 MB |
| Raw SQLite (warm) | 24 hours | ~8 MB |
| Hourly aggregates | 7 days | ~2 MB |
| Daily aggregates | 1 year | ~5 MB |
| **Total** | - | **~50 MB** |

### 6.3 Performance

- **Write requirement**: 600/min (10/sec)
- **SQLite capacity**: 72,000 writes/sec
- **Headroom**: 7,200x requirement

| Query Type | Performance |
|------------|-------------|
| Real-time (in-memory) | < 0.1 ms |
| Point query | < 1 ms |
| Range query (24h) | 10-20 ms |
| Aggregation (all sessions) | 20-50 ms |

---

## 7. Current Metrics Infrastructure

### 7.1 Existing Metrics (Already Collected)

**Delegation Metrics:**
- Duration histograms (0-1s, 1-5s, 5-30s, 30s-1m, 1-5m, 5m+)
- Subtask count distribution
- Success/failure counters
- Quality score buckets
- Token budget utilization
- Pattern distribution (parallel, sequential, debate, review, ensemble)

**Session Metrics:**
- Status, current/next task
- Context percentage, quality/confidence scores
- Token usage (input, output, total)
- Cost tracking
- Runtime, iteration count, phase

**Task Claim Metrics:**
- Claim status, heartbeat health
- Claims by agent type

### 7.2 Gaps for Dashboard V3

| Gap | Impact | Priority |
|-----|--------|----------|
| No per-agent performance tracking | Can't identify slow agents | High |
| Limited error classification | Generic failure counts only | Medium |
| No latency percentiles for claims | Missing p50/p95/p99 | Medium |
| No cross-project aggregation | Can't compare projects | Low |
| No alert/SLA tracking | Missing threshold violations | Medium |
| No dashboard performance metrics | Can't optimize dashboard itself | Low |

---

## 8. Dashboard Component Designs

### 8.1 Projects Panel
- Grid layout with session cards
- Click-to-expand for drill-down
- Filter by status/type/time range

### 8.2 Sessions Panel
- Individual CLI + autonomous sessions
- Traffic light status indicators
- Drill-down to session detail

### 8.3 Context Tracker
- Gauge with threshold zones (OK/Warning/Critical/Emergency)
- Trend sparkline (last 5 minutes)
- Token budget remaining

### 8.4 Task Queue
- Current task prominent
- Claim status badges
- Filter buttons (All/Available/Claimed/Mine)

### 8.5 Hierarchy Viewer
- Collapsible tree with status badges
- Expand/collapse on click
- Detail panel on selection
- Real-time status transitions

### 8.6 Performance Charts
- uPlot for time-series (tokens/minute, cost)
- Chart.js gauges for quality scores
- Sparklines in table cells

### 8.7 Orchestrator Metrics
- Success rate gauge
- Retry frequency counter
- Quality score trend

### 8.8 Agent Efficiency
- Token savings percentage
- Time reduction metrics
- ROI analysis cards

### 8.9 Auto-Compact Monitor
- Frequency counter
- Context recovered metrics
- Issue detection alerts

---

## 9. Research Documents Index

| Document | Location | Content |
|----------|----------|---------|
| Dashboard Patterns | `docs/DASHBOARD-PATTERNS-RESEARCH.md` | Grafana, Datadog, K8s, VS Code patterns |
| Real-Time Streaming | `docs/REALTIME-STREAMING-ARCHITECTURE-RESEARCH.md` | SSE vs WebSocket, event structure |
| Hierarchy Visualization | `docs/HIERARCHY-VISUALIZATION-RESEARCH.md` | Tree vs DAG vs force-directed |
| Time-Series Storage | `docs/TIME-SERIES-STORAGE-RESEARCH.md` | SQLite vs InfluxDB, schema design |
| This Document | `docs/DASHBOARD-V3-RESEARCH.md` | Synthesis of all findings |

---

## 10. Next Steps

### Deliverables Remaining

1. **DASHBOARD-V3-ARCHITECTURE.md** - Technical architecture based on these findings
2. **DASHBOARD-V3-WIREFRAMES.md** - UI mockups for all 9 components
3. **DASHBOARD-V3-METRICS-SCHEMA.md** - Complete data model for metrics

### Implementation Phases

1. **Phase 1**: Core infrastructure (SSE streaming, metrics storage)
2. **Phase 2**: Visualization library integration (uPlot, D3, Chart.js)
3. **Phase 3**: Dashboard components (hierarchy viewer, charts)
4. **Phase 4**: Polish (performance optimization, responsive design)

---

*Research completed: December 2025*
*Expert Agents: 6 parallel research streams*
*Total research documents: 5*
