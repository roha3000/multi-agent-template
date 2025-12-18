/**
 * Memory Store - SQLite-based persistent storage for orchestrations
 *
 * Features:
 * - SQLite with FTS5 full-text search
 * - Agent performance tracking
 * - Pattern effectiveness analytics
 * - Work session management
 * - Context caching
 *
 * @module memory-store
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { createComponentLogger } = require('./logger');

class MemoryStore {
  constructor(dbPath = '.claude/memory/orchestrations.db', options = {}) {
    this.logger = createComponentLogger('MemoryStore');
    this.dbPath = dbPath;
    this.options = {
      verbose: options.verbose || false,
      readonly: options.readonly || false,
      fileMustExist: options.fileMustExist || false
    };

    this._ensureDirectoryExists();
    this._initializeDatabase();
  }

  /**
   * Ensure the database directory exists
   * @private
   */
  _ensureDirectoryExists() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      this.logger.info('Created database directory', { dir });
    }
  }

  /**
   * Initialize database connection and schema
   * @private
   */
  _initializeDatabase() {
    try {
      this.db = new Database(this.dbPath, {
        verbose: this.options.verbose ? console.log : undefined,
        readonly: this.options.readonly,
        fileMustExist: this.options.fileMustExist
      });

      // Enable foreign keys
      this.db.pragma('foreign_keys = ON');

      // Performance optimizations
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('cache_size = -64000'); // 64MB cache

      this.logger.info('Database initialized', {
        path: this.dbPath,
        readonly: this.options.readonly
      });

      // Create schema if needed
      this._createSchema();

    } catch (error) {
      this.logger.error('Database initialization failed', {
        error: error.message,
        path: this.dbPath
      });
      throw error;
    }
  }

  /**
   * Create database schema from SQL file
   * @private
   */
  _createSchema() {
    const schemaPath = path.join(__dirname, 'schema.sql');

    if (!fs.existsSync(schemaPath)) {
      this.logger.warn('Schema file not found', { schemaPath });
      return;
    }

    const schema = fs.readFileSync(schemaPath, 'utf8');

    try {
      this.db.exec(schema);
      this.logger.info('Schema created successfully');
    } catch (error) {
      this.logger.error('Schema creation failed', {
        error: error.message
      });
      throw error;
    }
  }

  // ============================================================================
  // Orchestration CRUD Operations
  // ============================================================================

  /**
   * Record a new orchestration
   *
   * @param {Object} data - Orchestration data
   * @param {string} data.pattern - Pattern type (parallel, consensus, etc.)
   * @param {Array<string>} data.agentIds - Agent IDs involved
   * @param {string} data.task - Task description
   * @param {string} [data.resultSummary] - Summary of results
   * @param {boolean} [data.success=true] - Whether execution succeeded
   * @param {number} [data.duration] - Duration in milliseconds
   * @param {number} [data.tokenCount=0] - Tokens used
   * @param {Object} [data.metadata={}] - Additional metadata
   * @param {string} [data.workSessionId] - Work session ID
   * @returns {string} Orchestration ID
   */
  recordOrchestration(data) {
    const id = this._generateId();
    const timestamp = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO orchestrations (
        id, timestamp, pattern, task, agent_ids, result_summary,
        success, duration, token_count, metadata, work_session_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(
        id,
        timestamp,
        data.pattern,
        data.task,
        JSON.stringify(data.agentIds || []),
        data.resultSummary || null,
        data.success ? 1 : 0,
        data.duration || null,
        data.tokenCount || 0,
        JSON.stringify(data.metadata || {}),
        data.workSessionId || null
      );

      this.logger.info('Orchestration recorded', {
        id,
        pattern: data.pattern,
        agentCount: data.agentIds?.length || 0,
        success: data.success
      });

      // Update statistics
      this._updatePatternStats(data.pattern, data.success, data.duration, data.tokenCount);
      this._updateAgentStats(data.agentIds, data.success, data.duration, data.tokenCount);
      this._updateCollaborationStats(data.agentIds, data.pattern, data.success, data.duration);

      return id;

    } catch (error) {
      this.logger.error('Failed to record orchestration', {
        error: error.message,
        pattern: data.pattern
      });
      throw error;
    }
  }

  /**
   * Get orchestration by ID
   *
   * @param {string} id - Orchestration ID
   * @param {boolean} [includeObservations=true] - Include observations
   * @returns {Object|null} Orchestration data
   */
  getOrchestrationById(id, includeObservations = true) {
    const stmt = this.db.prepare('SELECT * FROM orchestrations WHERE id = ?');
    const orchestration = stmt.get(id);

    if (!orchestration) {
      return null;
    }

    // Parse JSON fields
    orchestration.agent_ids = JSON.parse(orchestration.agent_ids);
    orchestration.metadata = JSON.parse(orchestration.metadata || '{}');

    if (includeObservations) {
      orchestration.observations = this.getObservationsByOrchestration(id);
    }

    return orchestration;
  }

  /**
   * Search orchestrations with filters
   *
   * @param {Object} filters - Search filters
   * @param {string} [filters.pattern] - Pattern type
   * @param {boolean} [filters.successOnly] - Only successful executions
   * @param {number} [filters.limit=10] - Maximum results
   * @param {number} [filters.offset=0] - Result offset
   * @param {number} [filters.minTimestamp] - Minimum timestamp
   * @param {string} [filters.workSessionId] - Work session ID
   * @returns {Array<Object>} Orchestration results
   */
  searchOrchestrations(filters = {}) {
    const conditions = [];
    const params = [];

    if (filters.pattern) {
      conditions.push('pattern = ?');
      params.push(filters.pattern);
    }

    if (filters.successOnly) {
      conditions.push('success = 1');
    }

    if (filters.minTimestamp) {
      conditions.push('timestamp >= ?');
      params.push(filters.minTimestamp);
    }

    if (filters.workSessionId) {
      conditions.push('work_session_id = ?');
      params.push(filters.workSessionId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit || 10;
    const offset = filters.offset || 0;

    const query = `
      SELECT * FROM orchestrations
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);

    const stmt = this.db.prepare(query);
    const results = stmt.all(...params);

    // Parse JSON fields
    return results.map(r => ({
      ...r,
      agent_ids: JSON.parse(r.agent_ids),
      metadata: JSON.parse(r.metadata || '{}')
    }));
  }

  /**
   * Full-text search across observations
   *
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @param {number} [options.limit=10] - Maximum results
   * @param {string} [options.type] - Filter by observation type
   * @returns {Array<Object>} Search results with relevance scores
   */
  searchObservationsFTS(query, options = {}) {
    const limit = options.limit || 10;
    const conditions = ['observations_fts MATCH ?'];
    const params = [query];

    if (options.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    const sql = `
      SELECT
        o.*,
        bm25(observations_fts) as relevance_score
      FROM observations_fts
      JOIN observations o ON observations_fts.rowid = o.rowid
      WHERE ${conditions.join(' AND ')}
      ORDER BY relevance_score
      LIMIT ?
    `;

    params.push(limit);

    const stmt = this.db.prepare(sql);
    const results = stmt.all(...params);

    return results.map(r => ({
      ...r,
      concepts: JSON.parse(r.concepts || '[]'),
      agent_insights: JSON.parse(r.agent_insights || '{}')
    }));
  }

  // ============================================================================
  // Observation Operations
  // ============================================================================

  /**
   * Record an observation
   *
   * @param {string} orchestrationId - Parent orchestration ID
   * @param {Object} observation - Observation data
   * @param {string} observation.type - Observation type
   * @param {string} observation.content - Key learning
   * @param {Array<string>} [observation.concepts=[]] - Keywords
   * @param {number} [observation.importance=5] - Importance (1-10)
   * @param {Object} [observation.agentInsights={}] - Agent analysis
   * @param {string} [observation.recommendations] - Guidance
   * @returns {string} Observation ID
   */
  recordObservation(orchestrationId, observation) {
    const id = this._generateId();
    const timestamp = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO observations (
        id, orchestration_id, timestamp, type, content,
        concepts, importance, agent_insights, recommendations
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(
        id,
        orchestrationId,
        timestamp,
        observation.type,
        observation.content,
        JSON.stringify(observation.concepts || []),
        observation.importance || 5,
        JSON.stringify(observation.agentInsights || {}),
        observation.recommendations || null
      );

      this.logger.info('Observation recorded', {
        id,
        orchestrationId,
        type: observation.type
      });

      return id;

    } catch (error) {
      this.logger.error('Failed to record observation', {
        error: error.message,
        orchestrationId
      });
      throw error;
    }
  }

  /**
   * Get observations for an orchestration
   *
   * @param {string} orchestrationId - Orchestration ID
   * @returns {Array<Object>} Observations
   */
  getObservationsByOrchestration(orchestrationId) {
    const stmt = this.db.prepare(`
      SELECT * FROM observations
      WHERE orchestration_id = ?
      ORDER BY importance DESC, timestamp DESC
    `);

    const results = stmt.all(orchestrationId);

    return results.map(r => ({
      ...r,
      concepts: JSON.parse(r.concepts || '[]'),
      agent_insights: JSON.parse(r.agent_insights || '{}')
    }));
  }

  // ============================================================================
  // Statistics Operations
  // ============================================================================

  /**
   * Update pattern statistics
   * @private
   */
  _updatePatternStats(pattern, success, duration, tokens) {
    const stmt = this.db.prepare(`
      INSERT INTO pattern_stats (
        pattern, total_executions, successful_executions, failed_executions,
        avg_duration, avg_tokens, success_rate, last_used
      ) VALUES (?, 1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pattern) DO UPDATE SET
        total_executions = total_executions + 1,
        successful_executions = successful_executions + ?,
        failed_executions = failed_executions + ?,
        avg_duration = ((avg_duration * total_executions) + ?) / (total_executions + 1),
        avg_tokens = ((avg_tokens * total_executions) + ?) / (total_executions + 1),
        success_rate = CAST(successful_executions + ? AS REAL) / (total_executions + 1),
        last_used = ?,
        updated_at = strftime('%s', 'now')
    `);

    const successVal = success ? 1 : 0;
    const failVal = success ? 0 : 1;

    stmt.run(
      pattern,
      successVal,
      failVal,
      duration || 0,
      tokens || 0,
      successVal,
      Date.now(),
      successVal,
      failVal,
      duration || 0,
      tokens || 0,
      successVal,
      Date.now()
    );
  }

  /**
   * Update agent statistics
   * @private
   */
  _updateAgentStats(agentIds, success, duration, tokens) {
    if (!agentIds || agentIds.length === 0) return;

    const avgDuration = duration ? duration / agentIds.length : 0;
    const avgTokens = tokens ? tokens / agentIds.length : 0;
    const successVal = success ? 1 : 0;
    const failVal = success ? 0 : 1;

    const stmt = this.db.prepare(`
      INSERT INTO agent_stats (
        agent_id, total_executions, successful_executions, failed_executions,
        total_duration, total_tokens, last_used, avg_duration, success_rate
      ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        total_executions = total_executions + 1,
        successful_executions = successful_executions + ?,
        failed_executions = failed_executions + ?,
        total_duration = total_duration + ?,
        total_tokens = total_tokens + ?,
        last_used = ?,
        avg_duration = CAST(total_duration + ? AS REAL) / (total_executions + 1),
        success_rate = CAST(successful_executions + ? AS REAL) / (total_executions + 1),
        updated_at = strftime('%s', 'now')
    `);

    agentIds.forEach(agentId => {
      stmt.run(
        agentId,
        successVal,
        failVal,
        avgDuration,
        avgTokens,
        Date.now(),
        avgDuration,
        successVal,
        successVal,
        failVal,
        avgDuration,
        avgTokens,
        Date.now(),
        avgDuration,
        successVal
      );
    });
  }

  /**
   * Update collaboration statistics
   * @private
   */
  _updateCollaborationStats(agentIds, pattern, success, duration) {
    if (!agentIds || agentIds.length < 2) return;

    // Sort agent IDs for consistent comparison
    const sortedIds = [...agentIds].sort();
    const collabKey = `${sortedIds.join(',')}:${pattern}`;
    const successVal = success ? 1 : 0;

    const stmt = this.db.prepare(`
      INSERT INTO agent_collaborations (
        id, agent_ids, pattern, total_executions, successful_executions,
        avg_duration, success_rate, last_used
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        total_executions = total_executions + 1,
        successful_executions = successful_executions + ?,
        avg_duration = ((avg_duration * total_executions) + ?) / (total_executions + 1),
        success_rate = CAST(successful_executions + ? AS REAL) / (total_executions + 1),
        last_used = ?,
        updated_at = strftime('%s', 'now')
    `);

    stmt.run(
      collabKey,
      JSON.stringify(sortedIds),
      pattern,
      successVal,
      duration || 0,
      successVal,
      Date.now(),
      successVal,
      duration || 0,
      successVal,
      Date.now()
    );
  }

  /**
   * Get agent performance statistics
   *
   * @param {string} [agentId] - Specific agent ID, or all if omitted
   * @returns {Object|Array} Agent stats
   */
  getAgentStats(agentId) {
    if (agentId) {
      const stmt = this.db.prepare('SELECT * FROM agent_stats WHERE agent_id = ?');
      return stmt.get(agentId);
    }

    const stmt = this.db.prepare('SELECT * FROM v_agent_performance');
    return stmt.all();
  }

  /**
   * Get pattern effectiveness statistics
   *
   * @param {string} [pattern] - Specific pattern, or all if omitted
   * @returns {Object|Array} Pattern stats
   */
  getPatternStats(pattern) {
    if (pattern) {
      const stmt = this.db.prepare('SELECT * FROM pattern_stats WHERE pattern = ?');
      return stmt.get(pattern);
    }

    const stmt = this.db.prepare('SELECT * FROM v_pattern_effectiveness');
    return stmt.all();
  }

  /**
   * Get successful agent collaborations
   *
   * @param {string} [pattern] - Filter by pattern
   * @param {number} [minSuccessRate=0.5] - Minimum success rate
   * @returns {Array<Object>} Collaboration stats
   */
  getSuccessfulCollaborations(pattern, minSuccessRate = 0.5) {
    let query = 'SELECT * FROM agent_collaborations WHERE success_rate >= ?';
    const params = [minSuccessRate];

    if (pattern) {
      query += ' AND pattern = ?';
      params.push(pattern);
    }

    query += ' ORDER BY success_rate DESC, total_executions DESC';

    const stmt = this.db.prepare(query);
    return stmt.all(...params).map(r => ({
      ...r,
      agent_ids: JSON.parse(r.agent_ids)
    }));
  }

  // ============================================================================
  // Task History Methods
  // ============================================================================

  /**
   * Initialize task history schema
   * @private
   */
  _initializeTaskSchema() {
    const schemaPath = path.join(__dirname, 'schema-tasks.sql');

    if (!fs.existsSync(schemaPath)) {
      this.logger.warn('Task schema file not found', { schemaPath });
      return;
    }

    const schema = fs.readFileSync(schemaPath, 'utf8');

    try {
      this.db.exec(schema);
      this.logger.info('Task schema initialized successfully');
    } catch (error) {
      this.logger.error('Task schema initialization failed', {
        error: error.message
      });
    }
  }

  /**
   * Record task completion for historical learning
   *
   * @param {Object} task - Completed task data
   * @returns {number} Record ID
   */
  recordTaskCompletion(task) {
    this._ensureTaskSchema();

    const actualDuration = this._calculateTaskDuration(task.started || task.created, task.completed);

    const stmt = this.db.prepare(`
      INSERT INTO task_history (
        task_id, title, description, phase, priority, estimate,
        actual_duration, tags, status, success,
        created_at, started_at, completed_at,
        work_session_id, orchestration_id, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      task.id,
      task.title,
      task.description || null,
      task.phase,
      task.priority,
      task.estimate || null,
      actualDuration,
      JSON.stringify(task.tags || []),
      task.status,
      task.status === 'completed' ? 1 : 0,
      task.created,
      task.started || null,
      task.completed,
      task.workSessionId || null,
      task.orchestrationId || null,
      JSON.stringify(task.metadata || {})
    );

    // Update pattern stats
    this._updateTaskPatternStats(task, actualDuration);

    // Update tag stats
    if (task.tags && task.tags.length > 0) {
      this._updateTagStats(task.tags, task.status === 'completed', actualDuration);
    }

    this.logger.info('Task completion recorded', {
      taskId: task.id,
      phase: task.phase,
      actualDuration
    });

    return result.lastInsertRowid;
  }

  /**
   * Get task pattern success rate
   *
   * @param {Array<string>} tags - Task tags
   * @returns {number} Success rate (0-1)
   */
  getTaskPatternSuccess(tags) {
    this._ensureTaskSchema();

    if (!tags || tags.length === 0) return 0.5; // neutral

    // Get stats for primary tag
    const stmt = this.db.prepare('SELECT success_rate FROM tag_stats WHERE tag = ?');
    const result = stmt.get(tags[0]);

    return result ? result.success_rate : 0.5;
  }

  /**
   * Get average duration by phase
   *
   * @param {string} phase - Phase name
   * @returns {number} Average duration in hours
   */
  getAverageDurationByPhase(phase) {
    this._ensureTaskSchema();

    const stmt = this.db.prepare(`
      SELECT AVG(actual_duration) as avg_duration
      FROM task_history
      WHERE phase = ? AND success = 1 AND actual_duration IS NOT NULL
    `);

    const result = stmt.get(phase);
    return result?.avg_duration || 4; // default 4 hours
  }

  /**
   * Get task completion stats
   *
   * @param {Object} filters - { phase, priority, tags }
   * @returns {Object} Completion statistics
   */
  getTaskStats(filters = {}) {
    this._ensureTaskSchema();

    let query = 'SELECT * FROM task_history WHERE 1=1';
    const params = [];

    if (filters.phase) {
      query += ' AND phase = ?';
      params.push(filters.phase);
    }

    if (filters.priority) {
      query += ' AND priority = ?';
      params.push(filters.priority);
    }

    if (filters.tags && filters.tags.length > 0) {
      query += ' AND tags LIKE ?';
      params.push(`%${filters.tags[0]}%`);
    }

    const stmt = this.db.prepare(query);
    const tasks = stmt.all(...params);

    const completed = tasks.filter(t => t.success === 1);

    return {
      total: tasks.length,
      completed: completed.length,
      success_rate: tasks.length > 0 ? completed.length / tasks.length : 0,
      avg_duration: completed.length > 0
        ? completed.reduce((sum, t) => sum + (t.actual_duration || 0), 0) / completed.length
        : 0
    };
  }

  /**
   * Update task pattern statistics
   * @private
   */
  _updateTaskPatternStats(task, actualDuration) {
    const patternKey = `phase:${task.phase}|priority:${task.priority}`;
    const success = task.status === 'completed' ? 1 : 0;

    const estimateHours = this._parseEstimateHours(task.estimate);
    const estimateAccuracy = estimateHours > 0 && actualDuration > 0
      ? 1 - Math.abs(actualDuration - estimateHours) / estimateHours
      : 0;

    const stmt = this.db.prepare(`
      INSERT INTO task_pattern_stats (
        pattern_key, total_tasks, completed_tasks, success_rate,
        avg_duration, avg_estimate_accuracy, last_updated
      ) VALUES (?, 1, ?, ?, ?, ?, strftime('%s', 'now'))
      ON CONFLICT(pattern_key) DO UPDATE SET
        total_tasks = total_tasks + 1,
        completed_tasks = completed_tasks + ?,
        success_rate = CAST(completed_tasks AS REAL) / total_tasks,
        avg_duration = (avg_duration * (total_tasks - 1) + ?) / total_tasks,
        avg_estimate_accuracy = (avg_estimate_accuracy * (total_tasks - 1) + ?) / total_tasks,
        last_updated = strftime('%s', 'now')
    `);

    stmt.run(
      patternKey,
      success,
      success,
      actualDuration || 0,
      estimateAccuracy,
      success,
      actualDuration || 0,
      estimateAccuracy
    );
  }

  /**
   * Update tag statistics
   * @private
   */
  _updateTagStats(tags, success, actualDuration) {
    for (const tag of tags) {
      const successVal = success ? 1 : 0;
      const failureVal = success ? 0 : 1;

      const stmt = this.db.prepare(`
        INSERT INTO tag_stats (
          tag, total_occurrences, success_count, failure_count,
          success_rate, avg_duration, last_seen
        ) VALUES (?, 1, ?, ?, ?, ?, strftime('%s', 'now'))
        ON CONFLICT(tag) DO UPDATE SET
          total_occurrences = total_occurrences + 1,
          success_count = success_count + ?,
          failure_count = failure_count + ?,
          success_rate = CAST(success_count AS REAL) / total_occurrences,
          avg_duration = (avg_duration * (total_occurrences - 1) + ?) / total_occurrences,
          last_seen = strftime('%s', 'now')
      `);

      stmt.run(
        tag,
        successVal,
        failureVal,
        successVal,
        actualDuration || 0,
        successVal,
        failureVal,
        actualDuration || 0
      );
    }
  }

  /**
   * Calculate task duration in hours
   * @private
   */
  _calculateTaskDuration(startTime, endTime) {
    if (!startTime || !endTime) return null;

    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();

    const durationMs = end - start;
    return durationMs / (1000 * 60 * 60); // Convert to hours
  }

  /**
   * Parse estimate to hours
   * @private
   */
  _parseEstimateHours(estimate) {
    if (!estimate) return 0;

    const match = estimate.match(/(\d+\.?\d*)\s*(h|hour|hours|d|day|days)?/i);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[2]?.toLowerCase();

    if (unit?.startsWith('d')) {
      return value * 8; // Convert days to hours
    }
    return value;
  }

  /**
   * Ensure task schema is initialized
   * @private
   */
  _ensureTaskSchema() {
    // Check if task_history table exists
    const stmt = this.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='task_history'
    `);

    if (!stmt.get()) {
      this._initializeTaskSchema();
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Generate unique ID
   * @private
   */
  _generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get database statistics
   *
   * @returns {Object} Database stats
   */
  getStats() {
    const stmt = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM orchestrations) as total_orchestrations,
        (SELECT COUNT(*) FROM orchestrations WHERE success = 1) as successful_orchestrations,
        (SELECT COUNT(*) FROM observations) as total_observations,
        (SELECT COUNT(*) FROM agent_stats) as tracked_agents,
        (SELECT COUNT(*) FROM work_sessions) as work_sessions,
        (SELECT SUM(token_count) FROM orchestrations) as total_tokens
    `);

    return stmt.get();
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.logger.info('Database closed');
    }
  }
}

module.exports = MemoryStore;
