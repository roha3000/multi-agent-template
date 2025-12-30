# Dashboard V3 Metrics Schema

## Overview

This document defines the complete data model for all metrics tracked by Dashboard V3. The schema supports real-time monitoring, historical analysis, and efficient aggregation across projects, sessions, and agents.

**Design Principles:**
- Immutable event records for audit trails
- Pre-computed aggregates for fast queries
- Hierarchical rollup for multi-level views
- Tiered retention for storage efficiency

---

## 1. Core Entities

### 1.1 Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   Project   │──1:N──│   Session   │──1:N──│    Agent    │
│             │       │             │       │             │
│  - id       │       │  - id       │       │  - id       │
│  - name     │       │  - projectId│       │  - sessionId│
│  - status   │       │  - status   │       │  - parentId │
│  - created  │       │  - type     │       │  - type     │
└─────────────┘       │  - phase    │       │  - status   │
      │               └─────────────┘       └─────────────┘
      │                     │                     │
      │                     │                     │
      ▼                     ▼                     ▼
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│  Project    │       │   Session   │       │    Agent    │
│  Metrics    │       │   Metrics   │       │   Metrics   │
└─────────────┘       └─────────────┘       └─────────────┘
      │                     │                     │
      └──────────────┬──────┴──────────┬─────────┘
                     │                 │
                     ▼                 ▼
              ┌─────────────┐   ┌─────────────┐
              │    Task     │   │    Alert    │
              │             │   │             │
              └─────────────┘   └─────────────┘
```

---

## 2. Entity Schemas

### 2.1 Project

```typescript
interface Project {
  id: string;                    // UUID
  name: string;                  // Human-readable name
  path: string;                  // Filesystem path
  status: ProjectStatus;         // active | idle | archived
  created_at: number;            // Unix timestamp
  updated_at: number;            // Unix timestamp

  // Computed aggregates (updated on session changes)
  aggregate: {
    active_sessions: number;
    total_sessions: number;
    total_tokens: number;
    total_cost: number;
    avg_quality: number;
    last_activity: number;       // Unix timestamp
  };
}

type ProjectStatus = 'active' | 'idle' | 'archived';
```

### 2.2 Session

```typescript
interface Session {
  id: string;                    // UUID (e.g., "sess-001")
  project_id: string;            // FK to Project
  type: SessionType;             // cli | autonomous
  status: SessionStatus;
  phase: SessionPhase;

  // Context tracking
  context: {
    current: number;             // Current token count
    max: number;                 // Maximum context window
    percentage: number;          // Computed (current/max * 100)
    zone: ContextZone;           // ok | warning | critical | emergency
    trend: ContextTrend;         // increasing | stable | decreasing
  };

  // Token metrics
  tokens: {
    input: number;
    output: number;
    total: number;
  };

  // Quality metrics
  quality: {
    score: number;               // 0-100
    confidence: number;          // 0-100
  };

  // Cost tracking
  cost: {
    input_cost: number;          // USD
    output_cost: number;         // USD
    total_cost: number;          // USD
  };

  // Task tracking
  current_task_id: string | null;
  completed_tasks: number;
  failed_tasks: number;

  // Hierarchy summary
  hierarchy: {
    depth: number;               // Max depth of agent tree
    total_agents: number;
    active_agents: number;
  };

  // Timestamps
  started_at: number;            // Unix timestamp
  last_activity: number;         // Unix timestamp
  completed_at: number | null;   // Unix timestamp

  // Iteration tracking
  iteration: number;
  max_iterations: number;
}

type SessionType = 'cli' | 'autonomous';
type SessionStatus = 'pending' | 'active' | 'paused' | 'completed' | 'failed';
type SessionPhase = 'research' | 'planning' | 'design' | 'implementation' | 'testing' | 'validation' | 'iteration';
type ContextZone = 'ok' | 'warning' | 'critical' | 'emergency';
type ContextTrend = 'increasing' | 'stable' | 'decreasing';
```

### 2.3 Agent

```typescript
interface Agent {
  id: string;                    // UUID (e.g., "agent-001")
  session_id: string;            // FK to Session
  parent_id: string | null;      // FK to parent Agent (null for root)

  // Identity
  type: AgentType;
  name: string;                  // Human-readable name

  // Status
  status: AgentStatus;
  depth: number;                 // 0 = root, 1 = first level, etc.

  // Metrics
  metrics: {
    tokens_input: number;
    tokens_output: number;
    tokens_total: number;
    quality_score: number | null;
    confidence: number | null;
    duration_ms: number;
    retries: number;
  };

  // Task info
  current_task: string | null;   // Description of current work

  // Children tracking
  children_ids: string[];        // Array of child agent IDs
  children_count: number;

  // Timestamps
  started_at: number;
  completed_at: number | null;
  last_heartbeat: number;
}

type AgentType =
  | 'orchestrator'
  | 'researcher'
  | 'planner'
  | 'architect'
  | 'implementer'
  | 'coder'
  | 'tester'
  | 'reviewer'
  | 'documenter';

type AgentStatus = 'pending' | 'active' | 'completed' | 'failed' | 'paused';
```

### 2.4 Task

```typescript
interface Task {
  id: string;                    // UUID (e.g., "task-005")
  session_id: string;            // FK to Session
  project_id: string;            // FK to Project

  // Task definition
  title: string;
  description: string | null;
  priority: TaskPriority;

  // Status tracking
  status: TaskStatus;
  claim_status: ClaimStatus;
  claimed_by: string | null;     // Agent ID
  claimed_at: number | null;     // Unix timestamp

  // Dependencies
  dependencies: string[];        // Array of task IDs
  dependents: string[];          // Tasks that depend on this one

  // Execution metrics
  execution: {
    started_at: number | null;
    completed_at: number | null;
    duration_ms: number | null;
    retries: number;
    max_retries: number;
  };

  // Quality
  quality: {
    score: number | null;
    confidence: number | null;
  };

  // Result
  result: {
    success: boolean | null;
    output: string | null;
    error: string | null;
  };

  // Timestamps
  created_at: number;
  updated_at: number;
}

type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
type TaskStatus = 'pending' | 'ready' | 'in_progress' | 'completed' | 'failed' | 'blocked';
type ClaimStatus = 'unclaimed' | 'claimed' | 'released' | 'expired';
```

### 2.5 Alert

```typescript
interface Alert {
  id: string;                    // UUID
  session_id: string | null;     // FK to Session (null for system alerts)
  agent_id: string | null;       // FK to Agent
  task_id: string | null;        // FK to Task

  // Alert definition
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;

  // Metadata
  metadata: Record<string, any>; // Additional context

  // State
  acknowledged: boolean;
  acknowledged_at: number | null;
  acknowledged_by: string | null;

  // Timestamps
  triggered_at: number;
  resolved_at: number | null;
  expires_at: number | null;     // Auto-dismiss time
}

type AlertType =
  | 'context_warning'
  | 'context_critical'
  | 'context_emergency'
  | 'auto_compact_triggered'
  | 'auto_compact_failed'
  | 'task_failed'
  | 'task_timeout'
  | 'agent_failed'
  | 'quality_below_threshold'
  | 'claim_expired'
  | 'heartbeat_missed';

type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';
```

---

## 3. Metrics Time-Series

### 3.1 Raw Metrics (Hot/Warm Tier)

```typescript
interface MetricPoint {
  id: number;                    // Auto-increment
  session_id: string;
  agent_id: string | null;
  timestamp: number;             // Unix timestamp (ms)
  metric_type: MetricType;
  value: number;
  metadata: Record<string, any> | null;
}

type MetricType =
  // Token metrics
  | 'tokens_total'
  | 'tokens_input'
  | 'tokens_output'
  | 'tokens_rate'                // tokens/minute

  // Context metrics
  | 'context_used'
  | 'context_percentage'

  // Quality metrics
  | 'quality_score'
  | 'confidence_score'

  // Performance metrics
  | 'task_duration'
  | 'delegation_duration'
  | 'retry_count'

  // Cost metrics
  | 'cost_accumulated'

  // System metrics
  | 'heartbeat_latency'
  | 'api_response_time';
```

### 3.2 Aggregated Metrics (Cold Tier)

```typescript
interface MetricAggregate {
  id: number;                    // Auto-increment
  session_id: string;
  agent_id: string | null;

  // Time bucket
  bucket_type: BucketType;       // minute | hour | day
  bucket_start: number;          // Unix timestamp (ms)

  metric_type: MetricType;

  // Aggregate values
  min_value: number;
  max_value: number;
  avg_value: number;
  sum_value: number;
  count: number;

  // Percentiles (optional)
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

type BucketType = 'minute' | 'hour' | 'day';
```

---

## 4. Delegation Metrics

### 4.1 Delegation Event

```typescript
interface DelegationEvent {
  id: string;                    // UUID
  session_id: string;
  parent_agent_id: string;
  child_agent_id: string;

  // Delegation details
  pattern: DelegationPattern;
  task_description: string;
  token_budget: number;

  // Execution
  status: DelegationStatus;
  started_at: number;
  completed_at: number | null;
  duration_ms: number | null;

  // Results
  result: {
    success: boolean;
    tokens_used: number;
    quality_score: number | null;
    retries: number;
  };

  // Error handling
  error: {
    type: string | null;
    message: string | null;
    recovered: boolean;
  };
}

type DelegationPattern =
  | 'sequential'
  | 'parallel'
  | 'debate'
  | 'review'
  | 'ensemble'
  | 'recursive';

type DelegationStatus = 'pending' | 'active' | 'completed' | 'failed' | 'cancelled';
```

### 4.2 Delegation Aggregates

```typescript
interface DelegationStats {
  session_id: string;
  period: string;                // "hour:2025-12-29T10" | "day:2025-12-29"

  // Counts
  total_delegations: number;
  successful_delegations: number;
  failed_delegations: number;

  // Performance
  success_rate: number;          // 0-100%
  avg_duration_ms: number;
  avg_retries: number;

  // Tokens
  total_tokens_budgeted: number;
  total_tokens_used: number;
  token_efficiency: number;      // used/budgeted * 100

  // Quality
  avg_quality_score: number;

  // Pattern breakdown
  by_pattern: {
    [K in DelegationPattern]?: {
      count: number;
      success_rate: number;
      avg_duration_ms: number;
    };
  };
}
```

---

## 5. Hierarchy Metrics

### 5.1 Hierarchy Snapshot

```typescript
interface HierarchySnapshot {
  id: number;                    // Auto-increment
  session_id: string;
  timestamp: number;             // Unix timestamp

  // Full tree structure
  tree: HierarchyNode;

  // Summary stats
  summary: {
    total_nodes: number;
    max_depth: number;
    by_status: Record<AgentStatus, number>;
    by_type: Record<AgentType, number>;
    total_tokens: number;
    avg_quality: number;
  };
}

interface HierarchyNode {
  id: string;
  type: AgentType;
  name: string;
  status: AgentStatus;
  depth: number;

  metrics: {
    tokens: number;
    quality: number | null;
    duration_ms: number;
  };

  children: HierarchyNode[];
}
```

### 5.2 Rollup Metrics

```typescript
interface HierarchyRollup {
  agent_id: string;
  session_id: string;
  timestamp: number;

  // Self metrics (this agent only)
  self: {
    tokens: number;
    quality: number | null;
    duration_ms: number;
  };

  // Subtree metrics (this agent + all descendants)
  subtree: {
    total_tokens: number;
    avg_quality: number;
    max_duration_ms: number;
    total_agents: number;
    completed_agents: number;
    failed_agents: number;
  };
}
```

---

## 6. Auto-Compact Metrics

### 6.1 Auto-Compact Event

```typescript
interface AutoCompactEvent {
  id: string;                    // UUID
  session_id: string;

  // Trigger
  trigger_reason: CompactTrigger;
  context_before: number;        // Token count
  context_after: number;         // Token count
  tokens_recovered: number;

  // Performance
  duration_ms: number;

  // Side effects
  side_effects: {
    context_lost: boolean;
    repeated_work: boolean;
    quality_impact: number | null;
  };

  // Timestamps
  triggered_at: number;
  completed_at: number;
}

type CompactTrigger =
  | 'threshold_95'
  | 'threshold_100'
  | 'manual'
  | 'scheduled';
```

### 6.2 Auto-Compact Stats

```typescript
interface AutoCompactStats {
  session_id: string;

  // Counts
  total_compacts: number;
  successful_compacts: number;
  failed_compacts: number;

  // Recovery
  total_tokens_recovered: number;
  avg_tokens_recovered: number;

  // Performance
  avg_duration_ms: number;

  // Issues
  context_loss_incidents: number;
  repeated_work_incidents: number;
}
```

---

## 7. Efficiency Metrics

### 7.1 Efficiency Calculations

```typescript
interface EfficiencyMetrics {
  session_id: string;
  calculated_at: number;

  // Token efficiency
  token_savings: {
    without_delegation: number;  // Estimated tokens if no delegation
    with_delegation: number;     // Actual tokens used
    savings_absolute: number;    // Difference
    savings_percentage: number;  // Savings as percentage
  };

  // Time efficiency
  time_savings: {
    estimated_serial_ms: number; // Estimated if tasks ran serially
    actual_parallel_ms: number;  // Actual time with parallelization
    savings_absolute_ms: number;
    savings_percentage: number;
  };

  // ROI
  roi: {
    cost_without_delegation: number;
    cost_with_delegation: number;
    cost_savings: number;
    hourly_rate_equivalent: number;
  };

  // Quality
  quality_metrics: {
    avg_score: number;
    score_variance: number;
    above_threshold_percentage: number;
  };
}
```

---

## 8. SQLite Schema Implementation

### 8.1 Core Tables

```sql
-- Projects table
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT,
    status TEXT DEFAULT 'idle',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    -- Aggregates (denormalized for fast queries)
    active_sessions INTEGER DEFAULT 0,
    total_sessions INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    total_cost REAL DEFAULT 0,
    avg_quality REAL,
    last_activity INTEGER
);

CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_last_activity ON projects(last_activity);

-- Sessions table
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    type TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    phase TEXT,

    -- Context
    context_current INTEGER DEFAULT 0,
    context_max INTEGER DEFAULT 128000,
    context_zone TEXT DEFAULT 'ok',
    context_trend TEXT DEFAULT 'stable',

    -- Tokens
    tokens_input INTEGER DEFAULT 0,
    tokens_output INTEGER DEFAULT 0,
    tokens_total INTEGER DEFAULT 0,

    -- Quality
    quality_score REAL,
    quality_confidence REAL,

    -- Cost
    cost_input REAL DEFAULT 0,
    cost_output REAL DEFAULT 0,
    cost_total REAL DEFAULT 0,

    -- Task tracking
    current_task_id TEXT,
    completed_tasks INTEGER DEFAULT 0,
    failed_tasks INTEGER DEFAULT 0,

    -- Hierarchy summary
    hierarchy_depth INTEGER DEFAULT 0,
    hierarchy_total_agents INTEGER DEFAULT 0,
    hierarchy_active_agents INTEGER DEFAULT 0,

    -- Timestamps
    started_at INTEGER NOT NULL,
    last_activity INTEGER NOT NULL,
    completed_at INTEGER,

    -- Iteration
    iteration INTEGER DEFAULT 0,
    max_iterations INTEGER DEFAULT 10
);

CREATE INDEX idx_sessions_project ON sessions(project_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_started ON sessions(started_at);

-- Agents table
CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    parent_id TEXT REFERENCES agents(id),

    type TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    depth INTEGER DEFAULT 0,

    -- Metrics
    tokens_input INTEGER DEFAULT 0,
    tokens_output INTEGER DEFAULT 0,
    tokens_total INTEGER DEFAULT 0,
    quality_score REAL,
    confidence REAL,
    duration_ms INTEGER DEFAULT 0,
    retries INTEGER DEFAULT 0,

    current_task TEXT,
    children_count INTEGER DEFAULT 0,

    -- Timestamps
    started_at INTEGER,
    completed_at INTEGER,
    last_heartbeat INTEGER
);

CREATE INDEX idx_agents_session ON agents(session_id);
CREATE INDEX idx_agents_parent ON agents(parent_id);
CREATE INDEX idx_agents_status ON agents(status);

-- Tasks table
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    project_id TEXT NOT NULL REFERENCES projects(id),

    title TEXT NOT NULL,
    description TEXT,
    priority TEXT DEFAULT 'medium',

    status TEXT DEFAULT 'pending',
    claim_status TEXT DEFAULT 'unclaimed',
    claimed_by TEXT REFERENCES agents(id),
    claimed_at INTEGER,

    -- Execution
    started_at INTEGER,
    completed_at INTEGER,
    duration_ms INTEGER,
    retries INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,

    -- Quality
    quality_score REAL,
    quality_confidence REAL,

    -- Result
    success INTEGER,
    output TEXT,
    error TEXT,

    -- Timestamps
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX idx_tasks_session ON tasks(session_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_claim_status ON tasks(claim_status);

-- Task dependencies (junction table)
CREATE TABLE task_dependencies (
    task_id TEXT NOT NULL REFERENCES tasks(id),
    depends_on TEXT NOT NULL REFERENCES tasks(id),
    PRIMARY KEY (task_id, depends_on)
);

-- Alerts table
CREATE TABLE alerts (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id),
    agent_id TEXT REFERENCES agents(id),
    task_id TEXT REFERENCES tasks(id),

    type TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata TEXT,  -- JSON

    acknowledged INTEGER DEFAULT 0,
    acknowledged_at INTEGER,
    acknowledged_by TEXT,

    triggered_at INTEGER NOT NULL,
    resolved_at INTEGER,
    expires_at INTEGER
);

CREATE INDEX idx_alerts_session ON alerts(session_id);
CREATE INDEX idx_alerts_severity ON alerts(severity);
CREATE INDEX idx_alerts_triggered ON alerts(triggered_at);
```

### 8.2 Time-Series Tables

```sql
-- Raw metrics (24h retention)
CREATE TABLE metrics_raw (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    agent_id TEXT,
    timestamp INTEGER NOT NULL,
    metric_type TEXT NOT NULL,
    value REAL NOT NULL,
    metadata TEXT,

    UNIQUE(session_id, agent_id, timestamp, metric_type)
);

CREATE INDEX idx_metrics_raw_session_time ON metrics_raw(session_id, timestamp);
CREATE INDEX idx_metrics_raw_type_time ON metrics_raw(metric_type, timestamp);

-- Hourly aggregates (7 day retention)
CREATE TABLE metrics_hourly (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    agent_id TEXT,
    bucket_start INTEGER NOT NULL,
    metric_type TEXT NOT NULL,

    min_value REAL,
    max_value REAL,
    avg_value REAL,
    sum_value REAL,
    count INTEGER,
    p50 REAL,
    p95 REAL,
    p99 REAL,

    UNIQUE(session_id, agent_id, bucket_start, metric_type)
);

CREATE INDEX idx_metrics_hourly_session ON metrics_hourly(session_id, bucket_start);

-- Daily aggregates (1 year retention)
CREATE TABLE metrics_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    bucket_date TEXT NOT NULL,  -- YYYY-MM-DD
    metric_type TEXT NOT NULL,

    min_value REAL,
    max_value REAL,
    avg_value REAL,
    sum_value REAL,
    count INTEGER,

    UNIQUE(session_id, bucket_date, metric_type)
);

CREATE INDEX idx_metrics_daily_date ON metrics_daily(bucket_date);

-- Delegation events
CREATE TABLE delegation_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    parent_agent_id TEXT NOT NULL,
    child_agent_id TEXT NOT NULL,

    pattern TEXT NOT NULL,
    task_description TEXT,
    token_budget INTEGER,

    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    duration_ms INTEGER,

    success INTEGER,
    tokens_used INTEGER,
    quality_score REAL,
    retries INTEGER DEFAULT 0,

    error_type TEXT,
    error_message TEXT,
    error_recovered INTEGER
);

CREATE INDEX idx_delegation_session ON delegation_events(session_id);
CREATE INDEX idx_delegation_pattern ON delegation_events(pattern);

-- Hierarchy snapshots
CREATE TABLE hierarchy_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    tree_json TEXT NOT NULL,

    total_nodes INTEGER,
    max_depth INTEGER,
    total_tokens INTEGER,
    avg_quality REAL
);

CREATE INDEX idx_hierarchy_session ON hierarchy_snapshots(session_id, timestamp);

-- Auto-compact events
CREATE TABLE auto_compact_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,

    trigger_reason TEXT NOT NULL,
    context_before INTEGER NOT NULL,
    context_after INTEGER NOT NULL,
    tokens_recovered INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,

    context_lost INTEGER DEFAULT 0,
    repeated_work INTEGER DEFAULT 0,
    quality_impact REAL,

    triggered_at INTEGER NOT NULL,
    completed_at INTEGER NOT NULL
);

CREATE INDEX idx_compact_session ON auto_compact_events(session_id);
```

---

## 9. Query Patterns

### 9.1 Real-Time Dashboard Queries

```sql
-- Active sessions with metrics
SELECT
    s.*,
    (SELECT COUNT(*) FROM agents WHERE session_id = s.id AND status = 'active') as active_agents,
    (SELECT COUNT(*) FROM tasks WHERE session_id = s.id AND status = 'pending') as pending_tasks
FROM sessions s
WHERE s.status IN ('active', 'pending')
ORDER BY s.last_activity DESC;

-- Session hierarchy tree
WITH RECURSIVE agent_tree AS (
    SELECT id, parent_id, type, name, status, depth, tokens_total, quality_score
    FROM agents
    WHERE session_id = ? AND parent_id IS NULL

    UNION ALL

    SELECT a.id, a.parent_id, a.type, a.name, a.status, a.depth, a.tokens_total, a.quality_score
    FROM agents a
    JOIN agent_tree t ON a.parent_id = t.id
)
SELECT * FROM agent_tree;

-- Context trend (last 5 minutes)
SELECT
    timestamp,
    value as context_percentage
FROM metrics_raw
WHERE session_id = ?
    AND metric_type = 'context_percentage'
    AND timestamp > (strftime('%s', 'now') * 1000 - 300000)
ORDER BY timestamp ASC;
```

### 9.2 Historical Analysis Queries

```sql
-- Daily token usage by project
SELECT
    p.name as project_name,
    m.bucket_date,
    SUM(m.sum_value) as total_tokens
FROM metrics_daily m
JOIN sessions s ON m.session_id = s.id
JOIN projects p ON s.project_id = p.id
WHERE m.metric_type = 'tokens_total'
    AND m.bucket_date >= date('now', '-30 days')
GROUP BY p.id, m.bucket_date
ORDER BY m.bucket_date;

-- Delegation success rate by pattern
SELECT
    pattern,
    COUNT(*) as total,
    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
    ROUND(100.0 * SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as success_rate,
    ROUND(AVG(duration_ms), 0) as avg_duration_ms
FROM delegation_events
WHERE session_id = ?
GROUP BY pattern;

-- Quality score trend by agent type
SELECT
    a.type,
    DATE(a.completed_at / 1000, 'unixepoch') as completion_date,
    ROUND(AVG(a.quality_score), 1) as avg_quality
FROM agents a
WHERE a.quality_score IS NOT NULL
    AND a.completed_at IS NOT NULL
GROUP BY a.type, completion_date
ORDER BY completion_date;
```

---

## 10. Retention & Cleanup

### 10.1 Retention Policy

| Data Tier | Retention | Cleanup Schedule |
|-----------|-----------|------------------|
| `metrics_raw` | 24 hours | Hourly |
| `metrics_hourly` | 7 days | Daily |
| `metrics_daily` | 1 year | Monthly |
| `hierarchy_snapshots` | 7 days | Daily |
| `alerts` (resolved) | 30 days | Daily |
| `delegation_events` | 90 days | Weekly |
| `auto_compact_events` | 90 days | Weekly |

### 10.2 Cleanup Queries

```sql
-- Cleanup raw metrics older than 24h
DELETE FROM metrics_raw
WHERE timestamp < (strftime('%s', 'now') * 1000 - 86400000);

-- Aggregate raw metrics to hourly before cleanup
INSERT INTO metrics_hourly (session_id, agent_id, bucket_start, metric_type, min_value, max_value, avg_value, sum_value, count)
SELECT
    session_id,
    agent_id,
    (timestamp / 3600000) * 3600000 as bucket_start,
    metric_type,
    MIN(value),
    MAX(value),
    AVG(value),
    SUM(value),
    COUNT(*)
FROM metrics_raw
WHERE timestamp < (strftime('%s', 'now') * 1000 - 86400000)
GROUP BY session_id, agent_id, bucket_start, metric_type
ON CONFLICT DO UPDATE SET
    min_value = MIN(min_value, excluded.min_value),
    max_value = MAX(max_value, excluded.max_value),
    sum_value = sum_value + excluded.sum_value,
    count = count + excluded.count,
    avg_value = (sum_value + excluded.sum_value) / (count + excluded.count);

-- Cleanup hourly metrics older than 7 days
DELETE FROM metrics_hourly
WHERE bucket_start < (strftime('%s', 'now') * 1000 - 604800000);
```

---

*Metrics Schema Version: 1.0*
*Based on: DASHBOARD-V3-RESEARCH.md, DASHBOARD-V3-ARCHITECTURE.md*
*Created: December 2025*
