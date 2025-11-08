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
