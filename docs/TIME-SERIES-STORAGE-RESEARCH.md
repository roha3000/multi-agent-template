# Time-Series Storage Research Summary

## Multi-Agent Dashboard Metrics Storage Evaluation

**Prepared for**: Multi-Agent Monitoring Dashboard
**Date**: December 2025
**Data Model**: 50 concurrent sessions, per-session metrics every 5 seconds

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Storage Options Comparison](#storage-options-comparison)
3. [Storage Size Calculations](#storage-size-calculations)
4. [Query Performance Estimates](#query-performance-estimates)
5. [Recommended Approach](#recommended-approach)
6. [Schema Design](#schema-design)
7. [Retention Policy Recommendations](#retention-policy-recommendations)
8. [Implementation Roadmap](#implementation-roadmap)

---

## Executive Summary

### Recommendation: Hybrid SQLite + In-Memory Architecture

For our scale (50 sessions, 5-second intervals), a **hybrid approach using SQLite with an in-memory hot data cache** is optimal. This leverages our existing SQLite infrastructure (coordination-db.js) while providing sub-millisecond access for real-time dashboard updates.

**Key Decision Factors**:
- SQLite handles 72,000+ writes/second with WAL mode - far exceeding our ~600 writes/minute requirement
- In-memory cache provides instant access for real-time dashboard (last 5 minutes)
- No additional infrastructure needed (vs. InfluxDB)
- Proven pattern already in use in coordination-db.js

---

## Storage Options Comparison

| Criteria | SQLite Time-Series | InfluxDB | In-Memory + Snapshots | Hybrid (Recommended) |
|----------|-------------------|----------|----------------------|---------------------|
| **Setup Complexity** | Low (already have) | High (new service) | Low | Low |
| **Query Performance** | Good (100ms for 1M rows) | Excellent | Instant | Excellent |
| **Write Performance** | ~72K writes/sec | Very high | Instant | ~72K writes/sec |
| **Storage Efficiency** | ~35 bytes/row | Excellent compression | Memory-limited | Best of both |
| **Built-in Aggregation** | Manual SQL | Native (Flux) | Custom code | Scheduled jobs |
| **Retention Policies** | Manual/triggers | Built-in | TTL eviction | Tiered retention |
| **Infrastructure Cost** | None (existing) | New service | None | None |
| **Recovery/Durability** | Excellent | Excellent | Poor without snapshots | Excellent |
| **Concurrent Access** | WAL mode (good) | Excellent | Process-local only | WAL mode (good) |

### Option Details

#### 1. SQLite with Time-Series Patterns

**Pros**:
- Already integrated via `coordination-db.js`
- Zero additional infrastructure
- 35% faster than filesystem for reads
- Up to 10x faster than MySQL/PostgreSQL for inserts
- WAL mode supports concurrent readers/writers

**Cons**:
- Manual aggregation required
- No native time-series functions
- Partitioning requires application logic

**Best For**: Small-to-medium scale with existing SQLite usage

#### 2. InfluxDB

**Pros**:
- Purpose-built for time-series data
- Built-in retention policies and downsampling
- Excellent compression (up to 96% reduction)
- Native query language (Flux/InfluxQL)

**Cons**:
- Additional service to deploy and maintain
- Learning curve for Flux query language
- Overkill for our data volume (~1.7 GB/year)
- Different operational model

**Best For**: High-volume IoT/monitoring with dedicated ops team

#### 3. In-Memory with Snapshots

**Pros**:
- Sub-millisecond access
- Perfect for real-time dashboards
- Simple implementation with LRU cache

**Cons**:
- Data loss risk on crash
- Memory constraints (~50MB for 1 hour of data)
- No historical queries without snapshot loading

**Best For**: Real-time displays with acceptable data loss

#### 4. Hybrid Approach (RECOMMENDED)

**Architecture**:
```
[Hot Data: In-Memory LRU Cache]
        ↓ (5 minutes)
[Warm Data: SQLite metrics_raw table]
        ↓ (24 hours)
[Cold Data: SQLite metrics_hourly aggregates]
        ↓ (7 days)
[Archive: SQLite metrics_daily aggregates]
```

**Pros**:
- Instant access for real-time data
- Durable storage for historical analysis
- Automatic downsampling reduces storage
- Leverages existing infrastructure

---

## Storage Size Calculations

### Per-Session Metrics Structure

```javascript
{
  session_id: TEXT,        // ~20 bytes (UUID)
  timestamp: INTEGER,      // 8 bytes (Unix ms)
  tokens_in: INTEGER,      // 4 bytes
  tokens_out: INTEGER,     // 4 bytes
  cost: REAL,              // 8 bytes
  quality_score: REAL,     // 8 bytes
  task_count: INTEGER,     // 4 bytes
  active_tasks: INTEGER,   // 4 bytes
  metadata: TEXT           // ~50 bytes (JSON)
}
// Total: ~110 bytes per raw data point
```

### Write Frequency Analysis

| Metric | Value |
|--------|-------|
| Sessions | 50 (max concurrent) |
| Update interval | 5 seconds |
| Writes per minute | 600 (50 sessions x 12 updates) |
| Writes per hour | 36,000 |
| Writes per day | 864,000 |

### Storage Requirements by Retention Tier

#### Raw Data (1-minute resolution, 24-hour retention)

```
24 hours x 60 minutes = 1,440 data points per session
1,440 x 50 sessions = 72,000 rows
72,000 x 110 bytes = 7.92 MB/day of raw data
```

#### Hourly Aggregates (7-day retention)

```
7 days x 24 hours = 168 aggregates per session
168 x 50 sessions = 8,400 rows
8,400 x 200 bytes (with stats) = 1.68 MB for 7 days
```

#### Daily Aggregates (365-day retention)

```
365 days x 50 sessions = 18,250 rows
18,250 x 250 bytes = 4.56 MB per year
```

### Total Storage Estimate

| Tier | Retention | Size |
|------|-----------|------|
| In-Memory (hot) | 5 minutes | ~3 MB |
| Raw SQLite (warm) | 24 hours | ~8 MB |
| Hourly aggregates | 7 days | ~2 MB |
| Daily aggregates | 1 year | ~5 MB |
| **Total** | - | **~18 MB** |

With indexes and overhead, estimate **~50 MB total** database size.

---

## Query Performance Estimates

### SQLite Benchmarks (with proper indexes)

| Query Type | Expected Performance |
|------------|---------------------|
| Point query (session + timestamp) | < 1 ms |
| Range query (1 hour, single session) | 2-5 ms |
| Range query (24 hours, single session) | 10-20 ms |
| Aggregation (hourly avg, all sessions) | 20-50 ms |
| Full scan (1 million rows) | < 100 ms |

### In-Memory Cache Performance

| Operation | Performance |
|-----------|-------------|
| Get current metrics (single session) | < 0.1 ms |
| Get last 5 minutes (single session) | < 1 ms |
| Iterate all current metrics | < 5 ms |

### Write Performance

| Operation | Performance |
|-----------|-------------|
| Single metric insert (SQLite WAL) | ~14 microseconds |
| Batch insert (100 rows, transaction) | ~1.4 ms |
| In-memory update | < 0.01 ms |

**Our requirement**: 600 writes/minute = 10 writes/second
**SQLite capacity**: 72,000 writes/second
**Headroom**: 7,200x our requirement

---

## Recommended Approach

### Architecture: Tiered Hybrid Storage

```
┌─────────────────────────────────────────────────────────────┐
│                    Dashboard UI                              │
│                  (Real-time Metrics)                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              MetricsStore (Node.js Module)                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Hot Layer: In-Memory LRU Cache             │   │
│  │   • Last 5 minutes of data per session               │   │
│  │   • Max 3,000 entries (50 sessions x 60 points)      │   │
│  │   • TTL-based eviction                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼ (every 60 seconds)              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Warm Layer: SQLite metrics_raw             │   │
│  │   • 24-hour retention                                │   │
│  │   • Full granularity (5-second intervals)            │   │
│  │   • Indexed by (session_id, timestamp)               │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼ (hourly job)                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Cold Layer: SQLite metrics_hourly          │   │
│  │   • 7-day retention                                  │   │
│  │   • Aggregated: avg, min, max, sum, count            │   │
│  │   • Indexed by (session_id, hour_bucket)             │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼ (daily job)                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │         Archive Layer: SQLite metrics_daily          │   │
│  │   • 1-year retention                                 │   │
│  │   • Daily summaries with percentiles                 │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **In-Memory LRU Cache for Hot Data**
   - Use `lru-cache` npm package (most popular, well-maintained)
   - TTL: 5 minutes
   - Max entries: 3,000 (50 sessions x 60 data points)
   - Memory limit: ~5 MB

2. **SQLite for Persistence**
   - Extend existing `coordination-db.js`
   - Use WAL mode (already configured)
   - Batch writes every 60 seconds

3. **Aggregation Strategy**
   - Hourly aggregates: avg, min, max, p50, p95, sum, count
   - Daily aggregates: same metrics plus day-over-day trends

4. **Retention Policy Automation**
   - Background job every 5 minutes
   - Delete raw data older than 24 hours
   - Delete hourly data older than 7 days
   - Archive daily data after 1 year

---

## Schema Design

### SQLite Tables

```sql
-- Raw metrics (24-hour retention)
CREATE TABLE IF NOT EXISTS metrics_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,

  -- Token metrics
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  tokens_total INTEGER GENERATED ALWAYS AS (tokens_in + tokens_out) STORED,

  -- Cost metrics
  cost_usd REAL NOT NULL DEFAULT 0,

  -- Quality metrics
  quality_score REAL,

  -- Task metrics
  task_count INTEGER NOT NULL DEFAULT 0,
  active_tasks INTEGER NOT NULL DEFAULT 0,
  completed_tasks INTEGER NOT NULL DEFAULT 0,

  -- Delegation metrics
  delegation_count INTEGER NOT NULL DEFAULT 0,
  delegation_success_rate REAL,

  -- Additional context
  metadata TEXT,  -- JSON blob for extensibility

  UNIQUE(session_id, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_metrics_raw_session_time
  ON metrics_raw(session_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_raw_time
  ON metrics_raw(timestamp DESC);

-- Hourly aggregates (7-day retention)
CREATE TABLE IF NOT EXISTS metrics_hourly (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  hour_bucket INTEGER NOT NULL,  -- Unix timestamp truncated to hour

  -- Sample count
  sample_count INTEGER NOT NULL DEFAULT 0,

  -- Token aggregates
  tokens_in_sum INTEGER NOT NULL DEFAULT 0,
  tokens_in_avg REAL,
  tokens_out_sum INTEGER NOT NULL DEFAULT 0,
  tokens_out_avg REAL,

  -- Cost aggregates
  cost_sum REAL NOT NULL DEFAULT 0,
  cost_avg REAL,
  cost_max REAL,

  -- Quality aggregates
  quality_avg REAL,
  quality_min REAL,
  quality_max REAL,
  quality_p50 REAL,
  quality_p95 REAL,

  -- Task aggregates
  task_count_max INTEGER,
  completed_tasks_sum INTEGER,

  -- Delegation aggregates
  delegation_count_sum INTEGER,
  delegation_success_rate_avg REAL,

  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),

  UNIQUE(session_id, hour_bucket)
);

CREATE INDEX IF NOT EXISTS idx_metrics_hourly_session_hour
  ON metrics_hourly(session_id, hour_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_hourly_hour
  ON metrics_hourly(hour_bucket DESC);

-- Daily aggregates (1-year retention)
CREATE TABLE IF NOT EXISTS metrics_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,  -- NULL for system-wide aggregates
  day_bucket INTEGER NOT NULL,  -- Unix timestamp truncated to day

  -- Sample count
  sample_count INTEGER NOT NULL DEFAULT 0,
  hour_count INTEGER NOT NULL DEFAULT 0,

  -- Token totals
  tokens_in_total INTEGER NOT NULL DEFAULT 0,
  tokens_out_total INTEGER NOT NULL DEFAULT 0,

  -- Cost totals
  cost_total REAL NOT NULL DEFAULT 0,
  cost_avg_hourly REAL,

  -- Quality summary
  quality_avg REAL,
  quality_trend REAL,  -- Day-over-day change

  -- Task summary
  tasks_completed_total INTEGER,

  -- Delegation summary
  delegations_total INTEGER,
  delegation_success_rate REAL,

  -- Peak metrics
  peak_concurrent_sessions INTEGER,
  peak_tokens_per_hour INTEGER,

  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),

  UNIQUE(session_id, day_bucket)
);

CREATE INDEX IF NOT EXISTS idx_metrics_daily_day
  ON metrics_daily(day_bucket DESC);

-- Retention cleanup tracking
CREATE TABLE IF NOT EXISTS metrics_cleanup_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cleanup_type TEXT NOT NULL,  -- 'raw', 'hourly', 'daily'
  records_deleted INTEGER NOT NULL,
  timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);
```

### In-Memory Cache Structure

```javascript
// Using lru-cache package
const LRUCache = require('lru-cache');

const metricsCache = new LRUCache({
  max: 3000,  // Maximum 3000 entries
  maxSize: 5 * 1024 * 1024,  // 5 MB max
  sizeCalculation: (value) => JSON.stringify(value).length,
  ttl: 5 * 60 * 1000,  // 5 minute TTL
  updateAgeOnGet: true,
  updateAgeOnHas: true
});

// Key format: `${sessionId}:${timestamp}`
// Value format:
{
  sessionId: string,
  timestamp: number,
  tokensIn: number,
  tokensOut: number,
  cost: number,
  qualityScore: number,
  taskCount: number,
  activeTasks: number,
  delegationCount: number,
  delegationSuccessRate: number
}

// Index for fast session lookups
const sessionIndex = new Map();  // sessionId -> Set<cacheKey>
```

---

## Retention Policy Recommendations

### Tiered Retention Strategy

| Data Tier | Retention Period | Cleanup Frequency | Rationale |
|-----------|-----------------|-------------------|-----------|
| In-Memory (hot) | 5 minutes | TTL auto-eviction | Real-time dashboard |
| Raw (warm) | 24 hours | Every 5 minutes | Recent debugging |
| Hourly (cold) | 7 days | Every hour | Short-term trends |
| Daily (archive) | 365 days | Daily | Long-term analysis |

### Aggregation Schedule

```javascript
// Aggregation job schedule
const AGGREGATION_SCHEDULE = {
  // Flush in-memory to raw SQLite
  memoryToRaw: {
    interval: 60 * 1000,  // Every 1 minute
    batchSize: 100
  },

  // Aggregate raw to hourly
  rawToHourly: {
    interval: 60 * 60 * 1000,  // Every hour
    lookback: 2 * 60 * 60 * 1000  // Process last 2 hours (overlap for safety)
  },

  // Aggregate hourly to daily
  hourlyToDaily: {
    interval: 24 * 60 * 60 * 1000,  // Every day
    runAt: '00:05:00',  // 5 minutes after midnight
    lookback: 2 * 24 * 60 * 60 * 1000  // Process last 2 days
  },

  // Cleanup old data
  cleanup: {
    interval: 5 * 60 * 1000,  // Every 5 minutes
    raw: 24 * 60 * 60 * 1000,  // Delete raw older than 24h
    hourly: 7 * 24 * 60 * 60 * 1000,  // Delete hourly older than 7d
    daily: 365 * 24 * 60 * 60 * 1000  // Delete daily older than 1 year
  }
};
```

### SQL Cleanup Queries

```sql
-- Delete old raw metrics (run every 5 minutes)
DELETE FROM metrics_raw
WHERE timestamp < (strftime('%s', 'now') * 1000 - 86400000);  -- 24 hours

-- Delete old hourly aggregates (run every hour)
DELETE FROM metrics_hourly
WHERE hour_bucket < (strftime('%s', 'now') * 1000 - 604800000);  -- 7 days

-- Delete old daily aggregates (run daily)
DELETE FROM metrics_daily
WHERE day_bucket < (strftime('%s', 'now') * 1000 - 31536000000);  -- 365 days
```

---

## Implementation Roadmap

### Phase 1: Core Infrastructure (Week 1)

1. **Add metrics tables to coordination-db.js**
   - Add schema creation to `_initDatabase()`
   - Add prepared statements for metrics CRUD
   - Add retention cleanup to existing cleanup timer

2. **Create MetricsStore module**
   - In-memory LRU cache setup
   - Session index for fast lookups
   - API: `record()`, `getCurrent()`, `getHistory()`, `flush()`

3. **Integrate with existing session management**
   - Emit metrics on session heartbeat
   - Link metrics to session lifecycle

### Phase 2: Aggregation Pipeline (Week 2)

1. **Implement aggregation functions**
   - Raw-to-hourly SQL aggregation
   - Hourly-to-daily SQL aggregation
   - Percentile calculation helpers

2. **Create background job scheduler**
   - Interval-based job execution
   - Job completion tracking
   - Error handling and retry logic

3. **Add API for historical queries**
   - Time-range queries with auto-tier selection
   - Aggregated statistics endpoints

### Phase 3: Dashboard Integration (Week 3)

1. **Real-time metrics endpoint**
   - WebSocket support for live updates
   - Efficient delta updates

2. **Historical charts data**
   - Time-series data formatting
   - Trend calculations

3. **Dashboard widgets**
   - Current session metrics
   - Historical trends
   - Quality score tracking

---

## References

### Sources Consulted

- [SQLite Performance Benchmarks 2025](https://toxigon.com/sqlite-performance-benchmarks-2025-edition) - Write performance and concurrency data
- [SQLite Time-Series Best Practices](https://moldstud.com/articles/p-handling-time-series-data-in-sqlite-best-practices) - Schema design patterns
- [InfluxDB vs SQLite Comparison](https://stackshare.io/stackups/influxdb-vs-sqlite) - Feature comparison
- [SQLite Performance Tuning](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/) - WAL mode and optimization
- [LRU Cache for Node.js](https://www.npmjs.com/package/lru-cache) - In-memory caching
- [TimescaleDB Continuous Aggregates](https://nickb.dev/blog/downsampling-timescale-data-with-continuous-aggregations/) - Downsampling strategies
- [Cold vs Hot Data Storage](https://questdb.com/glossary/cold-vs-hot-storage/) - Tiered storage architecture
- [Prometheus Retention Configuration](https://prometheus.io/docs/prometheus/latest/storage/) - Industry retention practices
- [High-Performance Time Series on SQLite](https://dev.to/zanzythebar/building-high-performance-time-series-on-sqlite-with-go-uuidv7-sqlc-and-libsql-3ejb) - Modern SQLite patterns
- [SQLite Faster Than Filesystem](https://sqlite.org/fasterthanfs.html) - Performance characteristics

### Related Project Files

- `C:\Users\roha3\Claude\multi-agent-template\.claude\core\coordination-db.js` - Existing SQLite infrastructure
- `C:\Users\roha3\Claude\multi-agent-template\.claude\memory\dashboard.db` - Current dashboard database

---

## Conclusion

The **Hybrid SQLite + In-Memory** approach is optimal for our multi-agent dashboard because:

1. **Minimal Infrastructure Change**: Extends existing `coordination-db.js`
2. **Excellent Performance**: Sub-millisecond for real-time, fast queries for history
3. **Cost Effective**: ~50 MB total storage vs. running a dedicated time-series DB
4. **Proven Patterns**: SQLite with WAL mode is battle-tested
5. **Appropriate Scale**: Our 600 writes/minute is well under SQLite's 72,000 writes/second capacity

The implementation can be completed in 3 weeks with gradual integration into the existing dashboard infrastructure.
