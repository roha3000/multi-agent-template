# Dashboard Patterns Research: Industry Best Practices for Multi-Agent Monitoring

## Executive Summary

This document synthesizes research on dashboard patterns from leading observability platforms (Grafana, Datadog, Kubernetes Dashboard, VS Code Debug Panel) to inform the design of a multi-agent AI development monitoring dashboard. The research focuses on patterns applicable to showing 10-50 concurrent agent sessions, 3-level hierarchies, token usage tracking, quality scores, and real-time updates without UI jank.

---

## 1. Grafana Patterns

### 1.1 High-Frequency Metric Updates

**Streaming vs Polling Architecture**

Grafana Live (introduced in v8.0) provides real-time streaming via WebSocket:
- Push-based updates eliminate polling overhead
- WebSocket protocol allows sub-second data delivery
- Resource cost: ~50KB memory per persistent connection
- Recommended for high-frequency IoT/sensor data

**When to Use Streaming vs Polling:**
| Scenario | Approach | Rationale |
|----------|----------|-----------|
| Real-time agent status | Streaming | Sub-second updates critical |
| Token usage counters | Polling (5-10s) | Aggregated data, lower frequency acceptable |
| Historical metrics | Polling (30s+) | Data doesn't change frequently |
| Alert states | Streaming | Immediate notification required |

**Performance Optimization Techniques:**
1. **Query Caching**: Avoid repeated identical queries
2. **Precomputed Metrics**: Reduce real-time calculation load
3. **Appropriate Refresh Intervals**: Match refresh rate to data change frequency
4. **Variable Cardinality Control**: Use regex filters to limit query explosion

### 1.2 Dashboard Organization

**Hierarchical Structure Pattern:**
```
Root Dashboard (Index)
  |-- Service Overview Dashboard
  |     |-- Detailed Service A Dashboard
  |     |-- Detailed Service B Dashboard
  |-- Infrastructure Dashboard
        |-- Node Details Dashboard
```

**Organization Mechanisms:**
- **Folders**: Logical grouping by team/service/environment
- **Rows**: Group related panels within a dashboard
- **Template Variables**: Single dashboard serves multiple contexts
- **Dashboard Links**: Navigate between related dashboards

**Panel Layout Best Practices:**
- 15-20 panels maximum per dashboard view
- Use collapsible rows for secondary metrics
- Critical metrics at top-left (natural eye flow)
- Related metrics grouped in visual proximity

### 1.3 Drill-Down Patterns

**Multi-Level Navigation:**
1. **Dashboard Links**: Static navigation to related dashboards
2. **Panel Links**: Context-aware drill-down from specific visualizations
3. **Template Variables**: Dynamic filtering without page navigation
4. **Data Links**: Click-through from data points to detail views

**Recommended Drill-Down Flow:**
```
Overview (all agents)
  --> Agent Group (by type/status)
    --> Individual Agent Detail
      --> Specific Metric Deep-Dive
```

### 1.4 Grafana Design Maturity Model

| Level | Characteristics |
|-------|-----------------|
| Low | Uncontrolled growth, copied dashboards, no version control |
| Medium | Template variables, hierarchical structure, version-controlled JSON |
| High | Scripting libraries (grafonnet), no browser editing, usage tracking |

**Sources:**
- [Grafana Dashboard Best Practices](https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/best-practices/)
- [Scaling Grafana Dashboards](https://binaryscripts.com/grafana/2025/05/24/scaling-grafana-dashboards-best-practices-for-performance-and-high-volume-metrics-visualization.html)
- [Grafana Live Documentation](https://grafana.com/docs/grafana/latest/setup-grafana/set-up-grafana-live/)
- [Streaming Real-time Metrics](https://grafana.com/blog/2021/06/28/new-in-grafana-8.0-streaming-real-time-events-and-data-to-dashboards/)

---

## 2. Datadog Patterns

### 2.1 Dashboard Organization for Distributed Systems

**Visual Hierarchy Principles:**
1. Top-left placement for critical information (natural eye tracking)
2. Logical flow mirroring data/component interaction order
3. Widget grouping by functional category
4. Size indicates importance (larger = more critical)

**Widget Organization Pattern:**
```
[High-Level Summary Row]
  - Service Health Overview
  - Error Rate Gauge
  - Request Count

[Detail Rows - Collapsible]
  - Per-Service Metrics
  - Infrastructure Metrics
  - Database Metrics
```

**Recommended Widget Count:**
- 15-20 widgets per view for optimal load times
- Use groups to organize related metrics
- Summary first, detail later

### 2.2 Hierarchical Data Visualization

**Tagging Strategy for Hierarchy:**
```
environment:prod
  |-- service:api
  |     |-- team:platform
  |     |-- customer_tier:premium
  |-- service:worker
        |-- team:data
```

**Visualization Types for Hierarchical Data:**
| Type | Use Case |
|------|----------|
| Heatmap | Distribution patterns, time-based correlation |
| Tree Map | Proportional hierarchy visualization |
| Service Map | Dependency relationships |
| Distribution Widget | Aggregate metrics across tag keys |

### 2.3 Alerting and Status Indicators

**Severity Level Framework:**
| Level | Purpose | Notification |
|-------|---------|--------------|
| Critical | Service unavailable, operational disruption | Page on-call |
| Warning | Non-disruptive, potential risk if unaddressed | Chat/Email |
| Info | Informational, no action required | Dashboard only |

**Alert Design Best Practices:**
1. **Alert on Symptoms**: User-facing impact over internal metrics
2. **Tiered Alerts**: Different channels based on severity
3. **Context in Messages**: Include dashboard links, runbooks
4. **Dynamic Thresholds**: Adjust based on historical patterns
5. **Recommended Mix**: 60% threshold, 25% anomaly detection, 15% composite

**Key Performance Metrics:**
- Alert-to-Action Ratio (AAR): Measures actionable alerts
- Mean Time to Detection (MTTD): Speed of issue identification
- False Positive Rate (FPR): Prevents alert fatigue

### 2.4 Metric Aggregation Patterns

**Time Window Strategies:**
- Short windows (1-5 min): Real-time monitoring, immediate response
- Medium windows (15-60 min): Trend identification, pattern detection
- Long windows (hours-days): Capacity planning, historical analysis

**Aggregation Types:**
- Sum: Total volume metrics (requests, tokens)
- Average: Performance metrics (latency, duration)
- Max/Min: Peak detection, threshold monitoring
- Percentiles (p50, p95, p99): Distribution understanding

**Sources:**
- [Datadog Dashboards Documentation](https://docs.datadoghq.com/dashboards/)
- [Datadog Heatmap Engineering](https://www.datadoghq.com/blog/engineering/how-we-built-the-datadog-heatmap-to-visualize-distributions-over-time-at-arbitrary-scale/)
- [Tiered Alerts](https://www.datadoghq.com/blog/tiered-alerts-urgency-aware-alerting/)
- [Monitoring 101: Alerting](https://www.datadoghq.com/blog/monitoring-101-alerting/)

---

## 3. Kubernetes Dashboard Patterns

### 3.1 Hierarchical Resource Display

**Three-Level Hierarchy Pattern:**
```
Cluster (top level)
  |-- Namespaces
        |-- Workloads (Deployments, StatefulSets)
              |-- Pods
                    |-- Containers
```

**Navigation Patterns:**
- Click-through from summary to detail
- Breadcrumb navigation for context
- Back/up navigation to parent level
- Filter persistence across navigation

**Resource Overview Pattern:**
| View Level | Information Displayed |
|------------|----------------------|
| Cluster | Node count, total resources, global health |
| Namespace | Workload count, resource quotas, namespace health |
| Pod | Container status, resource usage, events |
| Container | Logs, resource metrics, restart count |

### 3.2 Status Indicator Patterns

**Color-Coded Status System:**
| Color | Status | Meaning |
|-------|--------|---------|
| Green | Healthy | All checks passing |
| Yellow/Amber | Warning | Degraded but functional |
| Red | Error/Critical | Failure requiring attention |
| Gray | Unknown | No data or pending |

**Status Aggregation Rules:**
- Parent shows worst child status (pessimistic roll-up)
- Counters show distribution (3 healthy, 1 warning, 0 error)
- Icons indicate status type (health, sync, update)

**Visual Indicator Patterns:**
```
[Pod Name]  [Status Icon]  [Restart Count]  [Age]
├── Container 1  ● Running   [CPU Bar] [Mem Bar]
└── Container 2  ● Running   [CPU Bar] [Mem Bar]
```

### 3.3 Real-Time Update Patterns

**Kubernetes Watch API Pattern:**
- Incremental updates via `--watch` flag
- Resource version tracking for change detection
- Shared Informer pattern for efficient resource tracking
- Event-driven updates minimize polling

**Update Strategies:**
1. **Full Refresh**: Complete data reload (expensive, comprehensive)
2. **Incremental Update**: Only changed items (efficient, complex)
3. **Optimistic Update**: UI updates immediately, reconciles with server

**Tools Using Real-Time Patterns:**
| Tool | Approach | Refresh Rate |
|------|----------|--------------|
| K9s | Auto-refresh, no polling | Continuous |
| Lens | Real-time with Prometheus | Sub-second |
| Skooner | No manual polling required | Real-time |

**Sources:**
- [Kubernetes Dashboard GitHub](https://github.com/kubernetes/dashboard)
- [Coding a Real-time Dashboard](https://learnkube.com/real-time-dashboard)
- [eG Innovations K8s Dashboards](https://www.eginnovations.com/blog/new-dashboards-and-reports-for-kubernetes-monitoring/)
- [Kubernetes Monitoring 101](https://www.cloudzero.com/blog/kubernetes-monitoring/)

---

## 4. VS Code Debug Panel Patterns

### 4.1 Collapsible Tree View Implementation

**TreeDataProvider Interface:**
```typescript
interface TreeDataProvider<T> {
  getChildren(element?: T): ProviderResult<T[]>;
  getTreeItem(element: T): TreeItem | Thenable<TreeItem>;
  onDidChangeTreeData?: Event<T | undefined>;
}
```

**Collapsible State Management:**
| State | Behavior |
|-------|----------|
| `Collapsed` | Shows expand arrow, children hidden |
| `Expanded` | Shows children, allows collapse |
| `None` | Leaf node, no expand/collapse UI |

**Tree View Best Practices:**
1. Lazy-load children on expand (performance)
2. Cache expanded state across sessions
3. Support keyboard navigation
4. Provide context menu actions
5. Use icons for quick visual identification

### 4.2 Call Stack Display Patterns

**Hierarchical Debug Information:**
```
Thread 1 (Paused on Exception)
  |-- main.js:42 - handleRequest()
  |     |-- Local Variables
  |     |     |-- request: {...}
  |     |     |-- response: {...}
  |     |-- Closure
  |-- server.js:156 - processMessage()
  |-- node.js:internal - emit()
```

**Information Hierarchy:**
1. Thread/Process identification
2. Stack frames (most recent first)
3. Source location (file:line)
4. Function name
5. Variable scopes (local, closure, global)

**Visual Distinction Patterns:**
- Bold for current frame
- Dimmed for framework/library code
- Icons for frame type (user code, library, async)
- Inline variable values where space permits

### 4.3 Real-Time Variable Updates

**Update Trigger Patterns:**
- Step execution: Full variable refresh
- Manual refresh: User-initiated reload
- Watch expressions: Continuous evaluation
- Hover inspection: On-demand evaluation

**Performance Considerations:**
- Defer expansion until requested
- Cache variable representations
- Throttle updates during rapid stepping
- Truncate large arrays/objects with expansion

**Event-Driven Updates:**
```typescript
// Fire undefined to refresh entire tree
this._onDidChangeTreeData.fire(undefined);

// Fire specific element to refresh subtree
this._onDidChangeTreeData.fire(changedElement);
```

**Sources:**
- [VS Code Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view)
- [VS Code Debugging Documentation](https://code.visualstudio.com/docs/debugtest/debugging)
- [Debugger Extension Guide](https://code.visualstudio.com/api/extension-guides/debugger-extension)
- [Tree View Sample](https://github.com/Microsoft/vscode-extension-samples/blob/main/tree-view-sample/USAGE.md)

---

## 5. UI Jank Prevention Patterns

### 5.1 Virtual Scrolling

**The Problem:**
- 50,000+ DOM nodes causes jank
- Only ~20 items visible at once
- All items in memory consuming resources

**Virtual Scrolling Solution:**
- Render only visible items + small buffer (overscan)
- Dramatically reduce DOM node count
- Maintain smooth scrolling performance

**Implementation Requirements:**
1. Fixed or predictable row heights
2. Efficient scroll position tracking
3. Overscan buffer for smooth scrolling
4. Recycled DOM elements

**Recommended Libraries:**
| Library | Strengths |
|---------|-----------|
| react-window | Lightweight, simple API |
| react-virtualized | Advanced features, tables |
| @tanstack/react-virtual | High performance, flexible |

### 5.2 Rendering Optimization

**Memoization Patterns:**
```javascript
// Memoize row components
const MemoizedRow = React.memo(Row);

// Use callback memoization
const handleClick = useCallback(() => {}, [deps]);

// Memoize computed values
const filteredData = useMemo(() => filter(data), [data, filter]);
```

**Preventing Layout Thrashing:**
1. Batch DOM reads before writes
2. Use `requestAnimationFrame` for updates
3. Debounce/throttle scroll handlers
4. CSS `contain` property for isolation

**CSS Optimizations:**
- Avoid `box-shadow`, `filter` during scrolling
- Use `transform` and `opacity` for animations
- Enable GPU acceleration where appropriate
- Use `will-change` sparingly

### 5.3 Update Strategies

**Event Handling:**
```javascript
// Debounce rapid updates
const debouncedUpdate = debounce(update, 100);

// Throttle scroll events
const throttledScroll = throttle(onScroll, 16); // ~60fps
```

**Web Workers for Heavy Computation:**
- Offload filtering/sorting to background thread
- Keep UI thread responsive
- Transfer results back for rendering

**Canvas for Extreme Performance:**
- Each cell drawn as pixels, no DOM nodes
- Used by Google Sheets
- Ideal for real-time dashboards with many cells

**Sources:**
- [Virtual Scrolling Guide](https://jsschools.com/web_dev/virtual-scrolling-boost-web-app-performance-with-/)
- [React Dashboard Optimization](https://www.zigpoll.com/content/how-can-i-optimize-the-rendering-performance-of-large-datasets-in-a-react-dashboard-using-virtualization-techniques)
- [Virtualization with Virtual Scrolling](https://dev.to/lalitkhu/rendering-massive-tables-at-lightning-speed-virtualization-with-virtual-scrolling-2dpp)

---

## 6. Anti-Patterns to Avoid

### 6.1 Dashboard Design Anti-Patterns

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| **Over-reliance on Templates** | Generic views don't provide context | Customize for specific use cases |
| **Lack of Clear Objectives** | Cluttered, unfocused dashboards | Define questions dashboard must answer |
| **Missing Context** | Metrics without meaning | Add event logs, annotations, links |
| **Neglecting Historical Data** | Miss long-term trends | Incorporate time-series analysis |
| **Poor UX Design** | Frustrating navigation | User test, iterate on design |
| **Indecipherable Dashboards** | Only creators understand them | Design for organization, not personal use |

### 6.2 Monitoring Anti-Patterns

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| **Tool Obsession** | One tool can't do everything | Match tools to requirements |
| **Collecting Everything** | High costs, noise | Collect what's actionable |
| **Wrong Alerting** | Missed incidents or fatigue | Use severity levels, alert on symptoms |
| **Technology Focus** | No customer impact visibility | Monitor user-facing metrics |
| **Limited Access** | Siloed observability | Democratize dashboard access |

### 6.3 Technical Anti-Patterns

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| **Excessive Polling** | Unnecessary load, lag | Use streaming for real-time needs |
| **No Caching** | Repeated expensive queries | Implement query caching |
| **Monolithic Dashboards** | Slow load, overwhelming | Break into focused views |
| **Ignoring Data Rollups** | Storage costs, slow queries | Aggregate aging data |
| **No Maintenance** | Stale, irrelevant dashboards | Regular review cycles |

**Sources:**
- [Top 10 Mistakes in Observability Dashboards](https://logz.io/blog/top-10-mistakes-building-observability-dashboards/)
- [Observability Anti-Patterns](https://observability-antipatterns.github.io/)
- [Monitoring Anti-Patterns (O'Reilly)](https://www.oreilly.com/library/view/practical-monitoring/9781491957349/ch01.html)
- [Three Observability Anti-Patterns](https://chronosphere.io/learn/three-pesky-observability-anti-patterns-that-impact-developer-efficiency/)

---

## 7. Common Themes Across Platforms

### 7.1 Hierarchy and Navigation

**Universal Pattern: Progressive Disclosure**
All platforms implement a common pattern:
1. Start with high-level summary
2. Allow drill-down to details
3. Maintain context during navigation
4. Provide easy return to overview

### 7.2 Status Visualization

**Consistent Status Representation:**
- Traffic light colors (green/yellow/red)
- Roll-up aggregation (worst status bubbles up)
- Count-based summaries (3 healthy, 1 warning)
- Clear iconography

### 7.3 Real-Time Updates

**Hybrid Approach Works Best:**
- WebSocket streaming for critical, high-frequency data
- Polling for less critical, aggregated data
- Event-driven updates for state changes
- Optimistic UI updates with reconciliation

### 7.4 Performance at Scale

**Scaling Strategies:**
- Virtualization for large lists
- Lazy loading for tree structures
- Query optimization and caching
- Appropriate refresh intervals
- Data aggregation and rollups

---

## 8. Specific Recommendations for Multi-Agent Dashboard

### 8.1 For 10-50 Concurrent Agent Sessions

**Recommended Pattern: Card Grid with Virtual Scrolling**

```
[Filter Bar: Status | Type | Time Range]

[Summary Row]
  Total: 42  |  Active: 35  |  Idle: 5  |  Error: 2

[Agent Grid - Virtualized]
  +------------------+  +------------------+
  | Agent A          |  | Agent B          |
  | Status: Active   |  | Status: Active   |
  | Task: Research   |  | Task: Implement  |
  | Tokens: 12.3k    |  | Tokens: 8.7k     |
  | Quality: 92      |  | Quality: 88      |
  +------------------+  +------------------+
```

**Implementation Notes:**
- Virtual grid layout (react-window-grid or similar)
- Card-based representation for each session
- Status indicator prominent in each card
- Click-to-expand for detail view
- Group by status or agent type option

### 8.2 For 3-Level Agent Hierarchies

**Recommended Pattern: Collapsible Tree with Summary Roll-up**

```
[Orchestrator Session - 3 active, 0 errors]
  |-- [Research Phase - 1 active]
  |     |-- Agent R1 (Active) - Analyzing codebase
  |
  |-- [Implementation Phase - 2 active]
        |-- Agent I1 (Active) - Writing tests
        |-- Agent I2 (Active) - Implementing feature
```

**Implementation Notes:**
- Use VS Code tree view pattern
- Lazy-load children on expand
- Status aggregation at each level
- Progress indicators at group level
- Keyboard navigation support

### 8.3 For Token Usage Tracking

**Recommended Pattern: Multi-Level Gauges + Trend Sparkline**

```
[Token Usage Summary]
  Session Total: 45.2k / 100k [=========>      ] 45%

  [Per-Agent Breakdown - Sortable Table]
  Agent    | Input | Output | Total  | Cost   | Trend
  ---------|-------|--------|--------|--------|-------
  Agent A  | 8.2k  | 4.1k   | 12.3k  | $0.24  | [___/]
  Agent B  | 5.1k  | 3.6k   | 8.7k   | $0.17  | [___-]
```

**Implementation Notes:**
- Determinate progress bar for budget tracking
- Real-time counter updates (WebSocket)
- Sparkline for trend visualization
- Color coding for budget thresholds
- Export/drill-down to detailed log

### 8.4 For Quality Scores

**Recommended Pattern: Gauge + Trend + Threshold Indicators**

```
[Quality Dashboard]

  Overall Quality Score
  [     =====[92]=====     ]  Target: 85
       0    50    85  100

  [Component Scores]
  Research Quality:    [=====>     ] 94
  Code Quality:        [====>      ] 88
  Test Coverage:       [=====>     ] 91
  Documentation:       [===>       ] 85
```

**Implementation Notes:**
- Gauge visualization with target line
- Color zones (red < 70, yellow 70-85, green > 85)
- Historical trend line option
- Component breakdown drill-down
- Alert triggers on threshold breach

### 8.5 For Real-Time Updates Without Jank

**Recommended Architecture:**

```
[Client]
   |
   |-- WebSocket Connection (streaming)
   |     |-- Agent status changes
   |     |-- Alert notifications
   |     |-- Progress updates
   |
   |-- REST API (polling, 10-30s)
         |-- Aggregated metrics
         |-- Historical data
         |-- Dashboard configuration
```

**Implementation Techniques:**
1. **Virtual DOM/Reconciliation**: React/Vue diffing for efficient updates
2. **Windowing**: Only render visible agent cards
3. **Debounced Updates**: Batch rapid state changes
4. **Optimistic UI**: Update immediately, reconcile with server
5. **Web Workers**: Offload metric calculations
6. **Lazy Loading**: Load detail data on demand

### 8.6 Dashboard Layout Recommendation

**Three-Tier Layout:**

```
+--------------------------------------------------+
| [Header] Session Overview | Filters | Actions    |
+--------------------------------------------------+
| [Summary] | Active: 35 | Tokens: 45k | Quality: 92
+--------------------------------------------------+
|                                                  |
| [Main View - Switchable]                         |
|                                                  |
|  [Grid View]     [Tree View]     [Timeline]      |
|                                                  |
|  +----------+  +----------+  +----------+        |
|  | Agent 1  |  | Agent 2  |  | Agent 3  |        |
|  | Status   |  | Status   |  | Status   |        |
|  | Metrics  |  | Metrics  |  | Metrics  |        |
|  +----------+  +----------+  +----------+        |
|                                                  |
+--------------------------------------------------+
| [Detail Panel - Expandable from bottom/side]     |
| Selected: Agent 1 | Full metrics | Logs | Config |
+--------------------------------------------------+
```

**View Modes:**
1. **Grid View**: Best for monitoring many agents at glance
2. **Tree View**: Best for understanding hierarchy/relationships
3. **Timeline View**: Best for understanding task progression

---

## 9. Implementation Checklist

### Phase 1: Foundation
- [ ] Implement virtual scrolling for agent list
- [ ] Create collapsible tree component
- [ ] Set up WebSocket connection for real-time updates
- [ ] Design status indicator component library

### Phase 2: Core Dashboard
- [ ] Build summary row with key metrics
- [ ] Implement agent card component
- [ ] Create drill-down navigation pattern
- [ ] Add filter/sort capabilities

### Phase 3: Visualizations
- [ ] Token usage gauges and trends
- [ ] Quality score gauges
- [ ] Progress indicators for tasks
- [ ] Status aggregation roll-ups

### Phase 4: Polish
- [ ] Keyboard navigation
- [ ] Responsive layout
- [ ] Dark/light theme support
- [ ] Performance profiling and optimization

---

## 10. References

### Primary Sources

**Grafana:**
- [Dashboard Best Practices](https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/best-practices/)
- [Grafana Live Setup](https://grafana.com/docs/grafana/latest/setup-grafana/set-up-grafana-live/)
- [WebSocket Data Visualization](https://grafana.com/blog/2022/04/05/how-to-use-websockets-to-visualize-real-time-iot-data-in-grafana/)

**Datadog:**
- [Dashboards Documentation](https://docs.datadoghq.com/dashboards/)
- [Tiered Alerts](https://www.datadoghq.com/blog/tiered-alerts-urgency-aware-alerting/)
- [Monitoring 101: Alerting](https://www.datadoghq.com/blog/monitoring-101-alerting/)

**Kubernetes:**
- [Official Dashboard Repository](https://github.com/kubernetes/dashboard)
- [Real-time Dashboard Coding](https://learnkube.com/real-time-dashboard)

**VS Code:**
- [Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view)
- [Debugging Documentation](https://code.visualstudio.com/docs/debugtest/debugging)

**Performance:**
- [Virtual Scrolling Guide](https://jsschools.com/web_dev/virtual-scrolling-boost-web-app-performance-with-/)
- [React Dashboard Optimization](https://www.zigpoll.com/content/how-can-i-optimize-the-rendering-performance-of-large-datasets-in-a-react-dashboard-using-virtualization-techniques)

**Anti-Patterns:**
- [Top 10 Dashboard Mistakes](https://logz.io/blog/top-10-mistakes-building-observability-dashboards/)
- [Observability Anti-Patterns](https://observability-antipatterns.github.io/)

---

*Document compiled: December 2025*
*Research scope: Dashboard patterns for multi-agent AI monitoring systems*
