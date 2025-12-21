-- Multi-Agent Framework Memory Database Schema
-- SQLite with FTS5 full-text search
-- Version 1.0

-- ============================================================================
-- Core Tables
-- ============================================================================

-- Orchestrations: Records of multi-agent executions
CREATE TABLE IF NOT EXISTS orchestrations (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  pattern TEXT NOT NULL,              -- parallel, consensus, debate, review, ensemble
  task TEXT NOT NULL,                 -- Description of the task
  agent_ids TEXT NOT NULL,            -- JSON array of agent IDs involved
  result_summary TEXT,                -- Brief summary of results
  success INTEGER DEFAULT 1,          -- 1 = success, 0 = failed
  duration INTEGER,                   -- Execution time in milliseconds
  token_count INTEGER DEFAULT 0,      -- Total tokens used
  metadata TEXT,                      -- JSON object with additional data
  work_session_id TEXT,               -- Optional: group related orchestrations
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_orchestrations_timestamp ON orchestrations(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_orchestrations_pattern ON orchestrations(pattern);
CREATE INDEX IF NOT EXISTS idx_orchestrations_success ON orchestrations(success);
CREATE INDEX IF NOT EXISTS idx_orchestrations_session ON orchestrations(work_session_id);
CREATE INDEX IF NOT EXISTS idx_orchestrations_created ON orchestrations(created_at DESC);

-- Observations: AI-extracted learnings from orchestrations
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  orchestration_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL,                 -- decision, bugfix, feature, refactor, discovery, change
  content TEXT NOT NULL,              -- 1-2 sentence key learning
  concepts TEXT,                      -- JSON array of keywords/concepts
  importance INTEGER DEFAULT 5,       -- 1-10 scale
  agent_insights TEXT,                -- JSON: agent-specific analysis
  recommendations TEXT,               -- Future guidance
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (orchestration_id) REFERENCES orchestrations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_observations_orchestration ON observations(orchestration_id);
CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
CREATE INDEX IF NOT EXISTS idx_observations_importance ON observations(importance DESC);
CREATE INDEX IF NOT EXISTS idx_observations_timestamp ON observations(timestamp DESC);

-- FTS5 Virtual Table for Full-Text Search
-- This enables fast keyword search across observations and orchestrations
CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
  content,
  concepts,
  type,
  content='observations',
  content_rowid='rowid'
);

-- Triggers to keep FTS index synchronized
CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
  INSERT INTO observations_fts(rowid, content, concepts, type)
  VALUES (new.rowid, new.content, new.concepts, new.type);
END;

CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, content, concepts, type)
  VALUES ('delete', old.rowid, old.content, old.concepts, old.type);
END;

CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, content, concepts, type)
  VALUES ('delete', old.rowid, old.content, old.concepts, old.type);
  INSERT INTO observations_fts(rowid, content, concepts, type)
  VALUES (new.rowid, new.content, new.concepts, new.type);
END;

-- ============================================================================
-- Agent Performance Tables
-- ============================================================================

-- Agent Statistics: Track performance metrics per agent
CREATE TABLE IF NOT EXISTS agent_stats (
  agent_id TEXT PRIMARY KEY,
  role TEXT,                          -- Agent's role/specialization
  total_executions INTEGER DEFAULT 0,
  successful_executions INTEGER DEFAULT 0,
  failed_executions INTEGER DEFAULT 0,
  total_duration INTEGER DEFAULT 0,   -- Cumulative duration in ms
  total_tokens INTEGER DEFAULT 0,     -- Cumulative token usage
  last_used INTEGER,                  -- Timestamp of last execution
  avg_duration REAL DEFAULT 0,        -- Average duration
  success_rate REAL DEFAULT 0,        -- Success percentage
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_stats_success_rate ON agent_stats(success_rate DESC);
CREATE INDEX IF NOT EXISTS idx_agent_stats_last_used ON agent_stats(last_used DESC);

-- Agent Collaboration: Track which agents work well together
CREATE TABLE IF NOT EXISTS agent_collaborations (
  id TEXT PRIMARY KEY,
  agent_ids TEXT NOT NULL,            -- JSON array of agent IDs (sorted)
  pattern TEXT NOT NULL,              -- Pattern used
  total_executions INTEGER DEFAULT 0,
  successful_executions INTEGER DEFAULT 0,
  avg_duration REAL DEFAULT 0,
  success_rate REAL DEFAULT 0,
  last_used INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_collab_pattern ON agent_collaborations(pattern);
CREATE INDEX IF NOT EXISTS idx_collab_success_rate ON agent_collaborations(success_rate DESC);

-- ============================================================================
-- Pattern Analytics Tables
-- ============================================================================

-- Pattern Statistics: Track effectiveness of orchestration patterns
CREATE TABLE IF NOT EXISTS pattern_stats (
  pattern TEXT PRIMARY KEY,
  total_executions INTEGER DEFAULT 0,
  successful_executions INTEGER DEFAULT 0,
  failed_executions INTEGER DEFAULT 0,
  avg_duration REAL DEFAULT 0,
  avg_tokens REAL DEFAULT 0,
  success_rate REAL DEFAULT 0,
  last_used INTEGER,
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- ============================================================================
-- Work Session Tables
-- ============================================================================

-- Work Sessions: Group related orchestrations together
CREATE TABLE IF NOT EXISTS work_sessions (
  id TEXT PRIMARY KEY,
  project_name TEXT NOT NULL,
  description TEXT,
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  status TEXT DEFAULT 'active',       -- active, paused, completed
  total_orchestrations INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  metadata TEXT,                      -- JSON object
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON work_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON work_sessions(start_time DESC);

-- ============================================================================
-- Context Cache Tables
-- ============================================================================

-- Context Cache: Store frequently accessed context for faster retrieval
CREATE TABLE IF NOT EXISTS context_cache (
  cache_key TEXT PRIMARY KEY,
  context_data TEXT NOT NULL,         -- JSON serialized context
  token_count INTEGER DEFAULT 0,
  access_count INTEGER DEFAULT 0,
  last_accessed INTEGER,
  expires_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_cache_expires ON context_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_cache_accessed ON context_cache(last_accessed DESC);

-- ============================================================================
-- API Rate Limiting Tables
-- ============================================================================

-- API Limit Tracking: Track API calls for rate limiting
CREATE TABLE IF NOT EXISTS api_limit_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  tokens INTEGER DEFAULT 0,
  calls INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_limit_timestamp ON api_limit_tracking(timestamp DESC);

-- ============================================================================
-- System Metadata
-- ============================================================================

-- System Info: Store schema version and configuration
CREATE TABLE IF NOT EXISTS system_info (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

INSERT OR IGNORE INTO system_info (key, value) VALUES ('schema_version', '1.0.0');
INSERT OR IGNORE INTO system_info (key, value) VALUES ('created_at', strftime('%s', 'now'));

-- ============================================================================
-- Views for Common Queries
-- ============================================================================

-- Recent Successful Orchestrations
CREATE VIEW IF NOT EXISTS v_recent_success AS
SELECT
  o.id,
  o.timestamp,
  o.pattern,
  o.task,
  o.agent_ids,
  o.duration,
  o.token_count,
  COUNT(obs.id) as observation_count
FROM orchestrations o
LEFT JOIN observations obs ON o.id = obs.orchestration_id
WHERE o.success = 1
GROUP BY o.id
ORDER BY o.timestamp DESC;

-- Agent Performance Summary
CREATE VIEW IF NOT EXISTS v_agent_performance AS
SELECT
  agent_id,
  role,
  total_executions,
  successful_executions,
  ROUND(success_rate * 100, 2) as success_percentage,
  ROUND(avg_duration, 2) as avg_duration_ms,
  total_tokens,
  datetime(last_used, 'unixepoch') as last_used_date
FROM agent_stats
ORDER BY success_rate DESC, total_executions DESC;

-- Pattern Effectiveness Summary
CREATE VIEW IF NOT EXISTS v_pattern_effectiveness AS
SELECT
  pattern,
  total_executions,
  successful_executions,
  ROUND(success_rate * 100, 2) as success_percentage,
  ROUND(avg_duration, 2) as avg_duration_ms,
  ROUND(avg_tokens, 2) as avg_tokens,
  datetime(last_used, 'unixepoch') as last_used_date
FROM pattern_stats
ORDER BY success_rate DESC, total_executions DESC;

-- ============================================================================
-- Usage Analytics Tables
-- ============================================================================

-- Token Usage: Detailed token consumption per orchestration
CREATE TABLE IF NOT EXISTS token_usage (
  id TEXT PRIMARY KEY,
  orchestration_id TEXT NOT NULL,
  agent_id TEXT,                      -- NULL for orchestration-level tracking
  timestamp INTEGER NOT NULL,
  model TEXT NOT NULL,                -- claude-sonnet-4.5, gpt-4o, etc.

  -- Token counts
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_creation_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,

  -- Cost breakdown (USD)
  input_cost REAL DEFAULT 0.0,
  output_cost REAL DEFAULT 0.0,
  cache_creation_cost REAL DEFAULT 0.0,
  cache_read_cost REAL DEFAULT 0.0,
  total_cost REAL DEFAULT 0.0,

  -- Savings analysis
  cache_savings REAL DEFAULT 0.0,
  cache_savings_percent REAL DEFAULT 0.0,

  -- Context
  pattern TEXT,                       -- Denormalized for easier queries
  work_session_id TEXT,

  created_at INTEGER DEFAULT (strftime('%s', 'now'))
  -- Note: No foreign key constraint to allow flexible usage tracking
  -- FOREIGN KEY (orchestration_id) REFERENCES orchestrations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_usage_orchestration ON token_usage(orchestration_id);
CREATE INDEX IF NOT EXISTS idx_usage_agent ON token_usage(agent_id);
CREATE INDEX IF NOT EXISTS idx_usage_model ON token_usage(model);
CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON token_usage(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_usage_pattern ON token_usage(pattern);
CREATE INDEX IF NOT EXISTS idx_usage_session ON token_usage(work_session_id);

-- Budget Alerts: Track when budget thresholds are exceeded
CREATE TABLE IF NOT EXISTS budget_alerts (
  id TEXT PRIMARY KEY,
  alert_type TEXT NOT NULL,           -- 'daily_warning', 'daily_exceeded', 'monthly_warning', 'monthly_exceeded'
  period_start INTEGER NOT NULL,      -- Start of day/month
  threshold_usd REAL NOT NULL,        -- Budget limit
  actual_usd REAL NOT NULL,           -- Actual spending
  percent_used REAL NOT NULL,         -- Percentage of budget used
  triggered_at INTEGER NOT NULL,
  acknowledged INTEGER DEFAULT 0,     -- 0 = unacknowledged, 1 = acknowledged
  acknowledged_at INTEGER,
  metadata TEXT                       -- JSON: additional context
);

CREATE INDEX IF NOT EXISTS idx_alerts_type ON budget_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_alerts_triggered ON budget_alerts(triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged ON budget_alerts(acknowledged);

-- Usage Cache: Pre-computed aggregations for faster reporting
CREATE TABLE IF NOT EXISTS usage_cache (
  cache_key TEXT PRIMARY KEY,
  period_type TEXT NOT NULL,          -- 'hour', 'day', 'week', 'month'
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,

  -- Aggregated metrics
  total_orchestrations INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0.0,

  -- Model breakdown (JSON)
  model_breakdown TEXT,

  -- Pattern breakdown (JSON)
  pattern_breakdown TEXT,

  -- Agent breakdown (JSON)
  agent_breakdown TEXT,

  computed_at INTEGER DEFAULT (strftime('%s', 'now')),
  expires_at INTEGER                  -- TTL for cache invalidation
);

CREATE INDEX IF NOT EXISTS idx_usage_cache_period ON usage_cache(period_type, period_start);
CREATE INDEX IF NOT EXISTS idx_usage_cache_expires ON usage_cache(expires_at);

-- ============================================================================
-- Usage Analytics Views
-- ============================================================================

-- Daily Usage Summary
CREATE VIEW IF NOT EXISTS v_daily_usage AS
SELECT
  date(timestamp, 'unixepoch') as date,
  COUNT(DISTINCT orchestration_id) as orchestrations,
  SUM(total_tokens) as total_tokens,
  SUM(total_cost) as total_cost,
  SUM(cache_savings) as cache_savings,
  ROUND(AVG(cache_savings_percent), 2) as avg_cache_savings_pct,
  GROUP_CONCAT(DISTINCT model) as models_used
FROM token_usage
GROUP BY date
ORDER BY date DESC;

-- Model Cost Summary
CREATE VIEW IF NOT EXISTS v_model_costs AS
SELECT
  model,
  COUNT(DISTINCT orchestration_id) as orchestrations,
  SUM(input_tokens) as total_input_tokens,
  SUM(output_tokens) as total_output_tokens,
  SUM(cache_creation_tokens) as total_cache_creation,
  SUM(cache_read_tokens) as total_cache_reads,
  SUM(total_tokens) as total_tokens,
  SUM(total_cost) as total_cost,
  ROUND(AVG(total_cost), 4) as avg_cost_per_orchestration,
  SUM(cache_savings) as total_cache_savings
FROM token_usage
GROUP BY model
ORDER BY total_cost DESC;

-- Pattern Cost Efficiency
CREATE VIEW IF NOT EXISTS v_pattern_efficiency AS
SELECT
  tu.pattern,
  COUNT(DISTINCT tu.orchestration_id) as total_orchestrations,
  SUM(CASE WHEN o.success = 1 THEN 1 ELSE 0 END) as successful_orchestrations,
  ROUND(SUM(CASE WHEN o.success = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as success_rate,
  SUM(tu.total_cost) as total_cost,
  ROUND(AVG(tu.total_cost), 4) as avg_cost_per_orchestration,
  ROUND(SUM(tu.total_cost) / NULLIF(SUM(CASE WHEN o.success = 1 THEN 1 ELSE 0 END), 0), 4) as cost_per_success
FROM token_usage tu
LEFT JOIN orchestrations o ON tu.orchestration_id = o.id
WHERE tu.pattern IS NOT NULL
GROUP BY tu.pattern
ORDER BY cost_per_success ASC;

-- Agent Cost Analysis
CREATE VIEW IF NOT EXISTS v_agent_costs AS
SELECT
  agent_id,
  COUNT(*) as executions,
  SUM(total_tokens) as total_tokens,
  SUM(total_cost) as total_cost,
  ROUND(AVG(total_cost), 4) as avg_cost_per_execution,
  SUM(cache_savings) as total_savings,
  ROUND(AVG(cache_savings_percent), 2) as avg_savings_pct
FROM token_usage
WHERE agent_id IS NOT NULL
GROUP BY agent_id
ORDER BY total_cost DESC;

-- Billing Window (5-hour periods)
CREATE VIEW IF NOT EXISTS v_billing_windows AS
SELECT
  datetime((timestamp / 18000) * 18000, 'unixepoch') as window_start,
  datetime(((timestamp / 18000) * 18000) + 18000, 'unixepoch') as window_end,
  COUNT(DISTINCT orchestration_id) as orchestrations,
  SUM(total_tokens) as total_tokens,
  SUM(total_cost) as total_cost,
  SUM(cache_savings) as cache_savings
FROM token_usage
GROUP BY (timestamp / 18000)  -- 18000 seconds = 5 hours
ORDER BY window_start DESC;

-- Monthly Budget Status
CREATE VIEW IF NOT EXISTS v_monthly_budget AS
SELECT
  strftime('%Y-%m', timestamp, 'unixepoch') as month,
  COUNT(DISTINCT orchestration_id) as orchestrations,
  SUM(total_cost) as total_cost,
  MIN(date(timestamp, 'unixepoch')) as first_day,
  MAX(date(timestamp, 'unixepoch')) as last_day,
  (julianday(MAX(date(timestamp, 'unixepoch'))) - julianday(MIN(date(timestamp, 'unixepoch'))) + 1) as days_elapsed
FROM token_usage
GROUP BY month
ORDER BY month DESC;
