# Dashboard V3 Technical Architecture

## Executive Summary

This document defines the technical architecture for the next-generation multi-agent monitoring dashboard based on comprehensive research findings. The architecture prioritizes real-time performance, efficient data flow, and scalable visualization.

**Key Architecture Decisions:**

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Streaming Protocol | SSE over HTTP/2 | Built-in reconnection, 25% lower overhead than WebSocket |
| Frontend Framework | Vanilla JS + Web Components | No framework overhead, optimal performance |
| Visualization Stack | uPlot + D3.js + Chart.js | Best-in-class for each use case |
| Data Storage | Hybrid SQLite + In-Memory | Leverages existing infrastructure |
| Update Strategy | Event-driven + Polling hybrid | Critical data immediate, metrics batched |

---

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DASHBOARD V3 ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        PRESENTATION LAYER                             │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────┐ │   │
│  │  │Projects │ │Sessions │ │ Context │ │  Task   │ │   Hierarchy     │ │   │
│  │  │  Panel  │ │  Panel  │ │ Tracker │ │  Queue  │ │    Viewer       │ │   │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────────┬────────┘ │   │
│  │       │           │           │           │                │          │   │
│  │  ┌────┴───────────┴───────────┴───────────┴────────────────┴────────┐ │   │
│  │  │                     State Manager (Zustand-like)                  │ │   │
│  │  └──────────────────────────────┬────────────────────────────────────┘ │   │
│  └─────────────────────────────────┼────────────────────────────────────────┘   │
│                                    │                                         │
│  ┌─────────────────────────────────┼────────────────────────────────────────┐   │
│  │                        DATA LAYER                                        │   │
│  │  ┌──────────────┐  ┌────────────┴───────────┐  ┌───────────────────────┐ │   │
│  │  │   SSE Client │  │   Update Batcher       │  │  Cache Manager        │ │   │
│  │  │   (EventSource)│  │   (requestAnimationFrame)│  │  (LRU, 5min TTL)   │ │   │
│  │  └──────┬───────┘  └────────────────────────┘  └───────────────────────┘ │   │
│  └─────────┼────────────────────────────────────────────────────────────────┘   │
│            │                                                                 │
│  ══════════╪═══════════════════════════════════════════════════════════════ │
│            │ SSE Stream (HTTP/2)                                             │
│  ══════════╪═══════════════════════════════════════════════════════════════ │
│            │                                                                 │
│  ┌─────────┼────────────────────────────────────────────────────────────────┐   │
│  │         │              API LAYER                                         │   │
│  │  ┌──────┴───────┐  ┌───────────────┐  ┌───────────────┐                 │   │
│  │  │  SSE Server  │  │  REST API     │  │  WebSocket    │                 │   │
│  │  │  /api/stream │  │  /api/v3/*    │  │  (fallback)   │                 │   │
│  │  └──────┬───────┘  └───────┬───────┘  └───────────────┘                 │   │
│  │         │                  │                                             │   │
│  │  ┌──────┴──────────────────┴─────────────────────────────────────────┐  │   │
│  │  │                     Event Aggregator                               │  │   │
│  │  │     (Batches events, manages subscriptions, filters by client)     │  │   │
│  │  └──────────────────────────┬────────────────────────────────────────┘  │   │
│  └─────────────────────────────┼────────────────────────────────────────────┘   │
│                                │                                             │
│  ┌─────────────────────────────┼────────────────────────────────────────────┐   │
│  │                        STORAGE LAYER                                     │   │
│  │  ┌──────────────────┐  ┌────┴─────────────┐  ┌───────────────────────┐  │   │
│  │  │  In-Memory Cache │  │   SQLite Primary │  │  File System          │  │   │
│  │  │  (Hot: 5 min)    │  │   (Warm: 24h)    │  │  (Cold: Archives)     │  │   │
│  │  └──────────────────┘  └──────────────────┘  └───────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Architecture

### 2.1 Frontend Components

```
dashboard-v3/
├── index.html                    # Main dashboard entry
├── components/
│   ├── base/
│   │   ├── BaseComponent.js      # Web Component base class
│   │   ├── StateConnector.js     # State subscription mixin
│   │   └── EventEmitter.js       # Custom event handling
│   │
│   ├── panels/
│   │   ├── ProjectsPanel.js      # Project grid with aggregates
│   │   ├── SessionsPanel.js      # Session cards with drill-down
│   │   ├── TaskQueuePanel.js     # Task list with claim status
│   │   └── HierarchyPanel.js     # Agent tree visualization
│   │
│   ├── charts/
│   │   ├── ContextGauge.js       # Circular gauge with zones
│   │   ├── TokenTimeline.js      # uPlot time-series chart
│   │   ├── QualityChart.js       # Chart.js bar/line
│   │   └── Sparkline.js          # Inline mini-chart
│   │
│   ├── hierarchy/
│   │   ├── TreeView.js           # D3.js collapsible tree
│   │   ├── TreeNode.js           # Individual node component
│   │   └── TreeControls.js       # Expand/collapse/filter
│   │
│   └── shared/
│       ├── StatusBadge.js        # Color-coded status indicator
│       ├── MetricCard.js         # Single metric display
│       ├── AlertBanner.js        # Critical alerts
│       └── LoadingSpinner.js     # Loading state
│
├── state/
│   ├── store.js                  # Central state store
│   ├── actions.js                # State mutations
│   └── selectors.js              # Computed state derivations
│
├── services/
│   ├── SSEClient.js              # EventSource wrapper
│   ├── APIClient.js              # REST API client
│   ├── UpdateBatcher.js          # RAF batching
│   └── CacheManager.js           # Client-side caching
│
└── utils/
    ├── formatters.js             # Number/date formatting
    ├── colors.js                 # Status color mapping
    └── performance.js            # Performance monitoring
```

### 2.2 Component Hierarchy

```
<dashboard-app>
├── <header-bar>
│   ├── <project-selector>
│   └── <time-range-picker>
│
├── <main-grid>
│   ├── <projects-panel>         [Grid: 2x2 cards]
│   │   └── <project-card> (repeated)
│   │
│   ├── <sessions-panel>         [Scrollable list]
│   │   └── <session-card> (repeated)
│   │       ├── <status-badge>
│   │       ├── <context-gauge mini>
│   │       └── <sparkline>
│   │
│   ├── <context-tracker>        [Large gauge + trend]
│   │   ├── <context-gauge large>
│   │   ├── <token-timeline>
│   │   └── <threshold-markers>
│   │
│   ├── <task-queue-panel>       [Prioritized list]
│   │   ├── <current-task>
│   │   └── <queued-tasks>
│   │
│   ├── <hierarchy-viewer>       [Tree visualization]
│   │   ├── <tree-controls>
│   │   ├── <tree-view>
│   │   └── <node-detail-panel>
│   │
│   └── <performance-panel>      [Charts grid]
│       ├── <quality-chart>
│       ├── <delegation-metrics>
│       └── <efficiency-cards>
│
└── <alert-overlay>
    └── <alert-banner> (conditional)
```

---

## 3. Data Flow Architecture

### 3.1 Event Types and Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         EVENT FLOW                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  SOURCES                    AGGREGATOR              CLIENTS          │
│  ────────                   ──────────              ───────          │
│                                                                      │
│  ┌─────────────┐                                                     │
│  │ Orchestrator │─┐                                                  │
│  │  Events      │ │     ┌──────────────────┐                        │
│  └─────────────┘ │     │                  │     ┌─────────────────┐ │
│                  ├────▶│  Event           │────▶│ Dashboard Tab 1 │ │
│  ┌─────────────┐ │     │  Aggregator      │     └─────────────────┘ │
│  │   Session   │─┤     │                  │                         │
│  │   Manager   │ │     │  • Batches by    │     ┌─────────────────┐ │
│  └─────────────┘ │     │    time window   │────▶│ Dashboard Tab 2 │ │
│                  │     │  • Filters by    │     └─────────────────┘ │
│  ┌─────────────┐ │     │    subscription  │                         │
│  │    Task     │─┤     │  • Applies JSON  │     ┌─────────────────┐ │
│  │   System    │ │     │    Patch format  │────▶│ External Client │ │
│  └─────────────┘ │     │                  │     └─────────────────┘ │
│                  │     └──────────────────┘                         │
│  ┌─────────────┐ │              │                                   │
│  │  Metrics    │─┘              │                                   │
│  │  Collector  │                ▼                                   │
│  └─────────────┘         SSE Broadcast                              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Event Types

| Event Type | Frequency | Priority | Payload Size |
|------------|-----------|----------|--------------|
| `session.status` | On change | High | ~100 bytes |
| `session.metrics` | Every 5s | Medium | ~500 bytes |
| `task.created` | On change | High | ~200 bytes |
| `task.claimed` | On change | High | ~150 bytes |
| `task.completed` | On change | High | ~300 bytes |
| `hierarchy.update` | On change | High | ~400 bytes |
| `context.usage` | Every 5s | Medium | ~100 bytes |
| `alert.triggered` | Immediate | Critical | ~200 bytes |
| `metrics.batch` | Every 5s | Low | ~2KB |

### 3.3 SSE Event Format

```javascript
// Single event
event: session.status
id: 1703847123456
data: {"sessionId":"sess-001","status":"active","timestamp":1703847123456}

// Batch event (JSON Patch format)
event: batch
id: 1703847123457
data: [
  {"op":"replace","path":"/sessions/sess-001/tokenCount","value":5432},
  {"op":"replace","path":"/sessions/sess-001/contextPct","value":67.5},
  {"op":"add","path":"/tasks/-","value":{"id":"task-006","status":"pending"}}
]

// Hierarchy update (full subtree)
event: hierarchy.update
id: 1703847123458
data: {
  "rootId": "agent-001",
  "nodes": [
    {"id":"agent-001","status":"active","children":["agent-002","agent-003"]},
    {"id":"agent-002","status":"completed","children":[]},
    {"id":"agent-003","status":"pending","children":[]}
  ]
}
```

---

## 4. API Design

### 4.1 REST Endpoints

```
Dashboard V3 API
================

Base URL: /api/v3

PROJECTS
--------
GET    /projects                    List all projects with summary metrics
GET    /projects/:id                Get project details
GET    /projects/:id/sessions       List sessions for project
GET    /projects/:id/metrics        Get aggregated project metrics

SESSIONS
--------
GET    /sessions                    List all active sessions
GET    /sessions/:id                Get session details
GET    /sessions/:id/hierarchy      Get agent hierarchy for session
GET    /sessions/:id/tasks          Get tasks for session
GET    /sessions/:id/metrics        Get session metrics time-series
GET    /sessions/:id/context        Get context usage history

TASKS
-----
GET    /tasks                       List all tasks (filterable)
GET    /tasks/:id                   Get task details
GET    /tasks/queue                 Get current task queue
GET    /tasks/claims                Get claim status

HIERARCHY
---------
GET    /hierarchy/:sessionId        Get full hierarchy tree
GET    /hierarchy/:sessionId/node/:nodeId   Get single node details
GET    /hierarchy/:sessionId/metrics        Get hierarchy-wide metrics

METRICS
-------
GET    /metrics/realtime            Get current real-time metrics
GET    /metrics/historical          Get historical metrics (with time range)
GET    /metrics/aggregates          Get pre-computed aggregates

STREAMING
---------
GET    /stream                      SSE endpoint (all events)
GET    /stream?filter=sessions      SSE endpoint (filtered)
GET    /stream?sessionId=xxx        SSE endpoint (single session)
```

### 4.2 Query Parameters

| Endpoint | Parameter | Type | Description |
|----------|-----------|------|-------------|
| `/sessions` | `status` | string | Filter by status (active, completed, failed) |
| `/sessions` | `projectId` | string | Filter by project |
| `/tasks` | `status` | string | Filter by status |
| `/tasks` | `claimStatus` | string | Filter by claim status |
| `/metrics/historical` | `start` | timestamp | Start of time range |
| `/metrics/historical` | `end` | timestamp | End of time range |
| `/metrics/historical` | `resolution` | string | Data resolution (1m, 5m, 1h, 1d) |
| `/stream` | `filter` | string[] | Event types to receive |
| `/stream` | `sessionId` | string | Limit to specific session |

### 4.3 Response Formats

```javascript
// Session response
{
  "id": "sess-001",
  "projectId": "proj-001",
  "status": "active",
  "phase": "implementation",
  "context": {
    "current": 45000,
    "max": 128000,
    "percentage": 35.2,
    "trend": "increasing"
  },
  "tokens": {
    "input": 12500,
    "output": 8700,
    "total": 21200
  },
  "quality": {
    "score": 87,
    "confidence": 92
  },
  "currentTask": {
    "id": "task-005",
    "title": "Implement login form",
    "status": "in_progress"
  },
  "hierarchy": {
    "depth": 2,
    "totalAgents": 5,
    "activeAgents": 2
  },
  "startedAt": "2025-12-29T10:00:00Z",
  "lastActivity": "2025-12-29T10:15:30Z"
}

// Hierarchy response
{
  "sessionId": "sess-001",
  "root": {
    "id": "agent-001",
    "type": "orchestrator",
    "name": "Main Orchestrator",
    "status": "active",
    "metrics": {
      "tokens": 5432,
      "quality": 87,
      "duration": 45
    },
    "children": [
      {
        "id": "agent-002",
        "type": "researcher",
        "name": "Research Analyst",
        "status": "completed",
        "metrics": {...},
        "children": []
      },
      {
        "id": "agent-003",
        "type": "implementer",
        "name": "Code Generator",
        "status": "active",
        "metrics": {...},
        "children": [...]
      }
    ]
  },
  "summary": {
    "totalNodes": 5,
    "byStatus": {"active": 2, "completed": 2, "pending": 1},
    "maxDepth": 3
  }
}
```

---

## 5. Storage Architecture

### 5.1 Tiered Storage Model

```
┌─────────────────────────────────────────────────────────────────────┐
│                     TIERED STORAGE ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  HOT TIER (In-Memory LRU Cache)                                     │
│  ─────────────────────────────                                      │
│  Retention: 5 minutes                                                │
│  Access: < 0.1ms                                                     │
│  Size: ~3 MB                                                         │
│  Use: Real-time dashboard updates                                    │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ Map<sessionId, {metrics, hierarchy, tasks, lastUpdate}>     │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                           │                                          │
│                           ▼ (every 30s flush)                        │
│                                                                      │
│  WARM TIER (SQLite - metrics_raw)                                   │
│  ────────────────────────────────                                   │
│  Retention: 24 hours                                                 │
│  Access: < 1ms point, 10-20ms range                                  │
│  Size: ~8 MB                                                         │
│  Use: Recent history, trend analysis                                 │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ session_id | timestamp | metric_type | value | metadata     │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                           │                                          │
│                           ▼ (hourly aggregation job)                 │
│                                                                      │
│  COLD TIER (SQLite - metrics_hourly)                                │
│  ───────────────────────────────────                                │
│  Retention: 7 days                                                   │
│  Access: 20-50ms                                                     │
│  Size: ~2 MB                                                         │
│  Use: Historical trends, reporting                                   │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ session_id | hour | metric_type | min | max | avg | count   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                           │                                          │
│                           ▼ (daily aggregation job)                  │
│                                                                      │
│  ARCHIVE TIER (SQLite - metrics_daily)                              │
│  ─────────────────────────────────────                              │
│  Retention: 1 year                                                   │
│  Access: 50-100ms                                                    │
│  Size: ~5 MB                                                         │
│  Use: Long-term analysis, capacity planning                          │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ session_id | date | metric_type | min | max | avg | count   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 SQLite Schema

```sql
-- Real-time metrics (raw data, 24h retention)
CREATE TABLE metrics_raw (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    agent_id TEXT,
    timestamp INTEGER NOT NULL,
    metric_type TEXT NOT NULL,
    value REAL NOT NULL,
    metadata TEXT,  -- JSON
    UNIQUE(session_id, agent_id, timestamp, metric_type)
);

CREATE INDEX idx_metrics_raw_session ON metrics_raw(session_id, timestamp);
CREATE INDEX idx_metrics_raw_type ON metrics_raw(metric_type, timestamp);

-- Hourly aggregates (7 day retention)
CREATE TABLE metrics_hourly (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    agent_id TEXT,
    hour INTEGER NOT NULL,  -- Unix timestamp truncated to hour
    metric_type TEXT NOT NULL,
    min_value REAL,
    max_value REAL,
    avg_value REAL,
    sum_value REAL,
    count INTEGER,
    UNIQUE(session_id, agent_id, hour, metric_type)
);

CREATE INDEX idx_metrics_hourly_session ON metrics_hourly(session_id, hour);

-- Daily aggregates (1 year retention)
CREATE TABLE metrics_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    date TEXT NOT NULL,  -- YYYY-MM-DD
    metric_type TEXT NOT NULL,
    min_value REAL,
    max_value REAL,
    avg_value REAL,
    sum_value REAL,
    count INTEGER,
    UNIQUE(session_id, date, metric_type)
);

CREATE INDEX idx_metrics_daily_date ON metrics_daily(date);

-- Hierarchy snapshots
CREATE TABLE hierarchy_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    tree_json TEXT NOT NULL,  -- Full hierarchy tree as JSON
    node_count INTEGER,
    max_depth INTEGER
);

CREATE INDEX idx_hierarchy_session ON hierarchy_snapshots(session_id, timestamp);

-- Alert history
CREATE TABLE alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    agent_id TEXT,
    timestamp INTEGER NOT NULL,
    severity TEXT NOT NULL,  -- info, warning, error, critical
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata TEXT,  -- JSON
    acknowledged INTEGER DEFAULT 0
);

CREATE INDEX idx_alerts_time ON alerts(timestamp);
CREATE INDEX idx_alerts_session ON alerts(session_id, timestamp);
```

---

## 6. Real-Time Streaming Implementation

### 6.1 SSE Server Implementation

```javascript
// sse-server.js
class SSEServer {
  constructor(options = {}) {
    this.clients = new Map();
    this.eventBuffer = [];
    this.bufferInterval = options.bufferInterval || 100; // ms
    this.maxBufferSize = options.maxBufferSize || 100;

    // Start buffer flush timer
    setInterval(() => this.flushBuffer(), this.bufferInterval);
  }

  // Handle new SSE connection
  handleConnection(req, res) {
    const clientId = crypto.randomUUID();
    const filter = this.parseFilter(req.query);

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    // Store client
    this.clients.set(clientId, { res, filter, lastEventId: 0 });

    // Send initial state
    this.sendInitialState(clientId);

    // Handle disconnect
    req.on('close', () => {
      this.clients.delete(clientId);
    });

    // Heartbeat every 30s
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 30000);

    req.on('close', () => clearInterval(heartbeat));
  }

  // Buffer events for batching
  emit(eventType, data) {
    const event = {
      id: Date.now(),
      type: eventType,
      data: data,
      timestamp: Date.now()
    };

    this.eventBuffer.push(event);

    // Immediate flush for critical events
    if (this.isCritical(eventType)) {
      this.flushBuffer();
    }
  }

  // Flush buffered events to clients
  flushBuffer() {
    if (this.eventBuffer.length === 0) return;

    const events = this.eventBuffer.splice(0);

    for (const [clientId, client] of this.clients) {
      const filtered = events.filter(e => this.matchesFilter(e, client.filter));

      if (filtered.length === 0) continue;

      // Batch if multiple events
      if (filtered.length > 1) {
        const batchData = filtered.map(e => ({
          type: e.type,
          data: e.data
        }));
        client.res.write(`event: batch\n`);
        client.res.write(`id: ${Date.now()}\n`);
        client.res.write(`data: ${JSON.stringify(batchData)}\n\n`);
      } else {
        const event = filtered[0];
        client.res.write(`event: ${event.type}\n`);
        client.res.write(`id: ${event.id}\n`);
        client.res.write(`data: ${JSON.stringify(event.data)}\n\n`);
      }
    }
  }

  isCritical(eventType) {
    return ['alert.triggered', 'session.failed', 'task.failed'].includes(eventType);
  }
}
```

### 6.2 Client-Side SSE Handler

```javascript
// sse-client.js
class SSEClient {
  constructor(url, options = {}) {
    this.url = url;
    this.options = options;
    this.eventSource = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.updateBatcher = new UpdateBatcher();
  }

  connect() {
    const url = new URL(this.url);
    if (this.options.filter) {
      url.searchParams.set('filter', this.options.filter.join(','));
    }
    if (this.options.sessionId) {
      url.searchParams.set('sessionId', this.options.sessionId);
    }

    this.eventSource = new EventSource(url.toString());

    this.eventSource.onopen = () => {
      this.reconnectAttempts = 0;
      this.emit('connected');
    };

    this.eventSource.onerror = (error) => {
      if (this.eventSource.readyState === EventSource.CLOSED) {
        this.handleReconnect();
      }
    };

    // Handle individual event types
    const eventTypes = [
      'session.status', 'session.metrics',
      'task.created', 'task.claimed', 'task.completed',
      'hierarchy.update', 'context.usage',
      'alert.triggered', 'batch'
    ];

    eventTypes.forEach(type => {
      this.eventSource.addEventListener(type, (event) => {
        this.handleEvent(type, JSON.parse(event.data));
      });
    });
  }

  handleEvent(type, data) {
    if (type === 'batch') {
      // Handle batched events
      data.forEach(item => {
        this.updateBatcher.add(item.type, item.data);
      });
    } else {
      this.updateBatcher.add(type, data);
    }
  }

  handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}

// Update batcher using requestAnimationFrame
class UpdateBatcher {
  constructor() {
    this.pending = [];
    this.frameId = null;
    this.listeners = new Map();
  }

  add(type, data) {
    this.pending.push({ type, data });

    if (!this.frameId) {
      this.frameId = requestAnimationFrame(() => this.flush());
    }
  }

  flush() {
    const updates = this.pending;
    this.pending = [];
    this.frameId = null;

    // Group by type
    const grouped = updates.reduce((acc, { type, data }) => {
      if (!acc[type]) acc[type] = [];
      acc[type].push(data);
      return acc;
    }, {});

    // Emit grouped updates
    for (const [type, dataArray] of Object.entries(grouped)) {
      const listeners = this.listeners.get(type) || [];
      listeners.forEach(fn => fn(dataArray));
    }
  }

  on(type, callback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(callback);
  }
}
```

---

## 7. Performance Optimization

### 7.1 Rendering Optimization

| Technique | Implementation | Benefit |
|-----------|----------------|---------|
| Virtual scrolling | `react-window` or custom | Handle 1000+ items |
| RAF batching | Batch DOM updates per frame | Prevent layout thrashing |
| Memoization | Cache computed values | Reduce recalculation |
| CSS containment | `contain: strict` | Isolate repaint regions |
| Canvas rendering | uPlot for time-series | Handle 100K+ points |

### 7.2 Memory Management

```javascript
// LRU Cache for hot tier
class LRUCache {
  constructor(maxSize = 100, maxAge = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.maxAge = maxAge;
    this.cache = new Map();
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() - item.timestamp > this.maxAge) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.value;
  }

  set(key, value) {
    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }
}
```

### 7.3 Bundle Optimization

| Library | Full Size | Tree-Shaken | Strategy |
|---------|-----------|-------------|----------|
| D3.js | 276KB | ~60KB | Import only d3-hierarchy, d3-selection |
| uPlot | 47KB | 47KB | Already minimal |
| Chart.js | 64KB | ~11KB | Import only needed chart types |

---

## 8. Security Considerations

### 8.1 API Security

- **Authentication**: Bearer token in `Authorization` header
- **Rate limiting**: 100 requests/minute per client
- **CORS**: Whitelist dashboard origins only
- **Input validation**: Sanitize all query parameters

### 8.2 SSE Security

- **Connection limits**: Max 10 connections per client
- **Event filtering**: Server-side filtering only
- **Heartbeat timeout**: Disconnect idle clients after 5 minutes

---

## 9. Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     DEPLOYMENT ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │   Browser    │    │   Browser    │    │   Browser    │          │
│  │   Client 1   │    │   Client 2   │    │   Client 3   │          │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘          │
│         │                   │                   │                    │
│         └───────────────────┼───────────────────┘                    │
│                             │                                        │
│  ┌──────────────────────────┼──────────────────────────────────┐    │
│  │                     Load Balancer                            │    │
│  │              (Sticky sessions for SSE)                       │    │
│  └──────────────────────────┼──────────────────────────────────┘    │
│                             │                                        │
│         ┌───────────────────┼───────────────────┐                    │
│         │                   │                   │                    │
│  ┌──────┴───────┐    ┌──────┴───────┐    ┌──────┴───────┐          │
│  │   Dashboard  │    │   Dashboard  │    │   Dashboard  │          │
│  │   Server 1   │    │   Server 2   │    │   Server 3   │          │
│  │  (Node.js)   │    │  (Node.js)   │    │  (Node.js)   │          │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘          │
│         │                   │                   │                    │
│         └───────────────────┼───────────────────┘                    │
│                             │                                        │
│  ┌──────────────────────────┼──────────────────────────────────┐    │
│  │                    Redis (Pub/Sub)                           │    │
│  │           (Event distribution across servers)                │    │
│  └──────────────────────────┼──────────────────────────────────┘    │
│                             │                                        │
│  ┌──────────────────────────┼──────────────────────────────────┐    │
│  │                    SQLite Database                           │    │
│  │              (Metrics storage, WAL mode)                     │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 10. Implementation Roadmap

### Phase 1: Foundation (Core Infrastructure)
- [ ] SSE streaming server implementation
- [ ] In-memory cache with LRU eviction
- [ ] SQLite schema and tiered storage
- [ ] Basic REST API endpoints

### Phase 2: Visualization (Chart Integration)
- [ ] uPlot time-series charts
- [ ] D3.js hierarchy tree view
- [ ] Chart.js gauges and bar charts
- [ ] Sparkline inline charts

### Phase 3: Components (Dashboard Panels)
- [ ] Projects panel with grid layout
- [ ] Sessions panel with drill-down
- [ ] Context tracker with gauges
- [ ] Task queue with claim status
- [ ] Hierarchy viewer with collapsible tree

### Phase 4: Polish (Optimization & UX)
- [ ] Virtual scrolling for large lists
- [ ] requestAnimationFrame batching
- [ ] Bundle optimization
- [ ] Responsive design
- [ ] Keyboard navigation

---

*Architecture Document Version: 1.0*
*Based on: DASHBOARD-V3-RESEARCH.md*
*Created: December 2025*
