-- Task Management Schema Extension
-- Adds historical learning for task execution patterns
-- Version 1.0

-- ============================================================================
-- Task History Tables
-- ============================================================================

-- Task History: Record completed tasks for learning patterns
CREATE TABLE IF NOT EXISTS task_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  phase TEXT NOT NULL,
  priority TEXT NOT NULL,
  estimate TEXT,
  actual_duration REAL,              -- Actual duration in hours
  tags TEXT,                         -- JSON array of tags
  status TEXT NOT NULL,              -- completed, abandoned, etc.
  success INTEGER DEFAULT 1,         -- 1 = completed successfully, 0 = abandoned/failed

  -- Timestamps
  created_at TEXT,                   -- When task was created
  started_at TEXT,                   -- When work started
  completed_at TEXT,                 -- When task completed

  -- Context
  work_session_id TEXT,
  orchestration_id TEXT,             -- Link to orchestration if applicable

  -- Metadata
  metadata TEXT,                     -- JSON: additional context

  recorded_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_task_history_task_id ON task_history(task_id);
CREATE INDEX IF NOT EXISTS idx_task_history_phase ON task_history(phase);
CREATE INDEX IF NOT EXISTS idx_task_history_priority ON task_history(priority);
CREATE INDEX IF NOT EXISTS idx_task_history_success ON task_history(success);
CREATE INDEX IF NOT EXISTS idx_task_history_tags ON task_history(tags);
CREATE INDEX IF NOT EXISTS idx_task_history_completed ON task_history(completed_at DESC);

-- Task Pattern Stats: Learn which types of tasks succeed
CREATE TABLE IF NOT EXISTS task_pattern_stats (
  pattern_key TEXT PRIMARY KEY,      -- e.g., "phase:implementation|priority:high"
  total_tasks INTEGER DEFAULT 0,
  completed_tasks INTEGER DEFAULT 0,
  success_rate REAL DEFAULT 0,
  avg_duration REAL DEFAULT 0,       -- Average actual duration in hours
  avg_estimate_accuracy REAL DEFAULT 0,  -- How accurate estimates are
  last_updated INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_pattern_success_rate ON task_pattern_stats(success_rate DESC);

-- Tag Success Stats: Learn which tags correlate with success
CREATE TABLE IF NOT EXISTS tag_stats (
  tag TEXT PRIMARY KEY,
  total_occurrences INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  success_rate REAL DEFAULT 0,
  avg_duration REAL DEFAULT 0,
  last_seen INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_tag_success_rate ON tag_stats(success_rate DESC);
CREATE INDEX IF NOT EXISTS idx_tag_occurrences ON tag_stats(total_occurrences DESC);

-- ============================================================================
-- Task Analytics Views
-- ============================================================================

-- Task Completion Summary
CREATE VIEW IF NOT EXISTS v_task_completion_summary AS
SELECT
  phase,
  priority,
  COUNT(*) as total_tasks,
  SUM(success) as completed_successfully,
  ROUND(AVG(success) * 100, 2) as success_rate,
  ROUND(AVG(actual_duration), 2) as avg_duration_hours,
  ROUND(AVG(CASE
    WHEN estimate LIKE '%h' OR estimate LIKE '% hour%'
    THEN CAST(REPLACE(REPLACE(estimate, 'h', ''), ' hours', '') AS REAL)
    ELSE 4
  END), 2) as avg_estimate_hours
FROM task_history
WHERE completed_at IS NOT NULL
GROUP BY phase, priority
ORDER BY phase, priority DESC;

-- Tag Effectiveness
CREATE VIEW IF NOT EXISTS v_tag_effectiveness AS
SELECT
  tag,
  total_occurrences,
  success_count,
  failure_count,
  ROUND(success_rate * 100, 2) as success_percentage,
  ROUND(avg_duration, 2) as avg_duration_hours
FROM tag_stats
WHERE total_occurrences >= 3  -- Only show tags with 3+ occurrences
ORDER BY success_rate DESC, total_occurrences DESC;

-- Recent Task Performance
CREATE VIEW IF NOT EXISTS v_recent_task_performance AS
SELECT
  task_id,
  title,
  phase,
  priority,
  estimate,
  ROUND(actual_duration, 2) as actual_hours,
  ROUND(actual_duration - CAST(REPLACE(REPLACE(estimate, 'h', ''), ' hours', '') AS REAL), 2) as variance_hours,
  datetime(completed_at) as completed_date,
  CASE WHEN success = 1 THEN 'Success' ELSE 'Failed' END as outcome
FROM task_history
WHERE completed_at IS NOT NULL
ORDER BY completed_at DESC
LIMIT 50;
