-- Swarm Features Schema Extension
-- Adds historical storage for swarm component data:
-- - Confidence history tracking
-- - Complexity analysis records
-- - Plan comparison results
-- Version 1.0

-- ============================================================================
-- Confidence History Table
-- ============================================================================

-- Tracks confidence scores over time for trend analysis and learning
CREATE TABLE IF NOT EXISTS confidence_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Session/Task Context
  task_id TEXT,                       -- Associated task ID
  session_id TEXT,                    -- Work session ID
  phase TEXT,                         -- Current phase when recorded
  iteration INTEGER DEFAULT 0,        -- Iteration number within phase

  -- Confidence Score
  confidence_score REAL NOT NULL,     -- Overall confidence (0-100)
  threshold_state TEXT DEFAULT 'normal', -- 'normal', 'warning', 'critical', 'emergency'

  -- Signal Breakdown (JSON)
  signals TEXT,                       -- JSON: { qualityScore, velocity, iterations, errorRate, historical }
  signal_weights TEXT,                -- JSON: weights used for calculation

  -- Context
  trigger TEXT,                       -- What triggered this update: 'update', 'batch', 'calculate'
  previous_confidence REAL,           -- Previous confidence value
  confidence_delta REAL,              -- Change from previous

  -- Metadata
  metadata TEXT,                      -- JSON: additional context
  recorded_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_confidence_history_task ON confidence_history(task_id);
CREATE INDEX IF NOT EXISTS idx_confidence_history_session ON confidence_history(session_id);
CREATE INDEX IF NOT EXISTS idx_confidence_history_phase ON confidence_history(phase);
CREATE INDEX IF NOT EXISTS idx_confidence_history_state ON confidence_history(threshold_state);
CREATE INDEX IF NOT EXISTS idx_confidence_history_recorded ON confidence_history(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_confidence_history_score ON confidence_history(confidence_score);

-- ============================================================================
-- Complexity Analysis Table
-- ============================================================================

-- Stores task complexity analysis results for pattern learning
CREATE TABLE IF NOT EXISTS complexity_analysis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Task Identification
  task_id TEXT NOT NULL,
  task_title TEXT,
  task_phase TEXT,

  -- Complexity Score
  complexity_score REAL NOT NULL,     -- Overall score (0-100)
  strategy TEXT NOT NULL,             -- 'fast-path', 'standard', 'competitive'

  -- Dimension Breakdown (JSON)
  breakdown TEXT NOT NULL,            -- JSON: { dependencyDepth, acceptanceCriteria, effortEstimate, technicalKeywords, historicalSuccess }
  weights TEXT,                       -- JSON: weights used for calculation

  -- Analysis Context
  from_cache INTEGER DEFAULT 0,       -- Whether result came from cache
  cache_hit_count INTEGER DEFAULT 0,  -- How many times this was retrieved from cache

  -- Validation (can be updated after task completion)
  actual_duration REAL,               -- Actual duration in hours (filled after completion)
  actual_complexity TEXT,             -- Manual classification after completion
  accuracy_score REAL,                -- How accurate was the prediction (0-100)

  -- Metadata
  analyzed_at TEXT NOT NULL,          -- ISO timestamp when analysis was performed
  metadata TEXT,                      -- JSON: additional context
  recorded_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_complexity_task ON complexity_analysis(task_id);
CREATE INDEX IF NOT EXISTS idx_complexity_strategy ON complexity_analysis(strategy);
CREATE INDEX IF NOT EXISTS idx_complexity_score ON complexity_analysis(complexity_score);
CREATE INDEX IF NOT EXISTS idx_complexity_phase ON complexity_analysis(task_phase);
CREATE INDEX IF NOT EXISTS idx_complexity_recorded ON complexity_analysis(recorded_at DESC);

-- ============================================================================
-- Plan Comparisons Table
-- ============================================================================

-- Stores plan evaluation and comparison results for learning optimal approaches
CREATE TABLE IF NOT EXISTS plan_comparisons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Task Context
  task_id TEXT NOT NULL,
  comparison_id TEXT NOT NULL,        -- Unique ID for this comparison set

  -- Comparison Summary
  total_plans INTEGER NOT NULL,       -- Number of plans compared
  winner_plan_id TEXT,                -- ID of winning plan
  winner_title TEXT,                  -- Title of winning plan
  winner_score REAL,                  -- Score of winning plan
  is_tie INTEGER DEFAULT 0,           -- Whether result was a tie
  tie_reason TEXT,                    -- Reason for tie if applicable

  -- All Plan Evaluations (JSON array)
  evaluations TEXT NOT NULL,          -- JSON: [{ planId, title, totalScore, scores: {...}, recommendations }]

  -- Criteria Used (JSON)
  criteria TEXT NOT NULL,             -- JSON: criteria weights used

  -- Rankings (JSON array)
  rankings TEXT NOT NULL,             -- JSON: [{ planId, title, score, rank }]

  -- Validation (filled after task completion)
  selected_plan_id TEXT,              -- Which plan was actually selected
  plan_succeeded INTEGER,             -- Did the selected plan succeed?
  accuracy_score REAL,                -- How accurate was the recommendation (0-100)

  -- Metadata
  compared_at TEXT NOT NULL,          -- ISO timestamp
  metadata TEXT,                      -- JSON: additional context
  recorded_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_comparison_task ON plan_comparisons(task_id);
CREATE INDEX IF NOT EXISTS idx_comparison_id ON plan_comparisons(comparison_id);
CREATE INDEX IF NOT EXISTS idx_comparison_winner ON plan_comparisons(winner_plan_id);
CREATE INDEX IF NOT EXISTS idx_comparison_recorded ON plan_comparisons(recorded_at DESC);

-- ============================================================================
-- Views for Swarm Analytics
-- ============================================================================

-- Confidence Trend Summary
CREATE VIEW IF NOT EXISTS v_confidence_trends AS
SELECT
  task_id,
  session_id,
  phase,
  COUNT(*) as update_count,
  MIN(confidence_score) as min_confidence,
  MAX(confidence_score) as max_confidence,
  AVG(confidence_score) as avg_confidence,
  SUM(CASE WHEN threshold_state = 'warning' THEN 1 ELSE 0 END) as warning_count,
  SUM(CASE WHEN threshold_state = 'critical' THEN 1 ELSE 0 END) as critical_count,
  SUM(CASE WHEN threshold_state = 'emergency' THEN 1 ELSE 0 END) as emergency_count,
  MIN(recorded_at) as first_update,
  MAX(recorded_at) as last_update
FROM confidence_history
GROUP BY task_id, session_id, phase
ORDER BY last_update DESC;

-- Complexity Strategy Distribution
CREATE VIEW IF NOT EXISTS v_complexity_distribution AS
SELECT
  strategy,
  task_phase as phase,
  COUNT(*) as task_count,
  ROUND(AVG(complexity_score), 2) as avg_score,
  MIN(complexity_score) as min_score,
  MAX(complexity_score) as max_score,
  SUM(CASE WHEN accuracy_score IS NOT NULL THEN 1 ELSE 0 END) as validated_count,
  ROUND(AVG(accuracy_score), 2) as avg_accuracy
FROM complexity_analysis
GROUP BY strategy, task_phase
ORDER BY task_count DESC;

-- Plan Comparison Success Rate
CREATE VIEW IF NOT EXISTS v_plan_comparison_accuracy AS
SELECT
  COUNT(*) as total_comparisons,
  SUM(CASE WHEN is_tie = 0 THEN 1 ELSE 0 END) as clear_winners,
  SUM(is_tie) as ties,
  SUM(CASE WHEN plan_succeeded = 1 THEN 1 ELSE 0 END) as successful_selections,
  ROUND(AVG(CASE WHEN plan_succeeded IS NOT NULL THEN accuracy_score END), 2) as avg_accuracy,
  SUM(CASE WHEN selected_plan_id = winner_plan_id THEN 1 ELSE 0 END) as winner_selected_count,
  ROUND(CAST(SUM(CASE WHEN selected_plan_id = winner_plan_id THEN 1 ELSE 0 END) AS REAL) /
        NULLIF(SUM(CASE WHEN selected_plan_id IS NOT NULL THEN 1 ELSE 0 END), 0) * 100, 2) as winner_selection_rate
FROM plan_comparisons;

-- Recent Swarm Activity
CREATE VIEW IF NOT EXISTS v_recent_swarm_activity AS
SELECT
  'confidence' as type,
  task_id,
  phase,
  CAST(confidence_score AS TEXT) as score,
  threshold_state as status,
  recorded_at
FROM confidence_history
WHERE recorded_at > strftime('%s', 'now') - 86400
UNION ALL
SELECT
  'complexity' as type,
  task_id,
  task_phase as phase,
  CAST(complexity_score AS TEXT) as score,
  strategy as status,
  recorded_at
FROM complexity_analysis
WHERE recorded_at > strftime('%s', 'now') - 86400
UNION ALL
SELECT
  'comparison' as type,
  task_id,
  NULL as phase,
  CAST(winner_score AS TEXT) as score,
  CASE WHEN is_tie = 1 THEN 'tie' ELSE 'clear' END as status,
  recorded_at
FROM plan_comparisons
WHERE recorded_at > strftime('%s', 'now') - 86400
ORDER BY recorded_at DESC;

-- ============================================================================
-- Schema Version Tracking
-- ============================================================================

INSERT OR REPLACE INTO system_info (key, value, updated_at)
VALUES ('swarm_schema_version', '1.0.0', strftime('%s', 'now'));
