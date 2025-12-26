/**
 * Migration 001: Swarm Features Database Schema
 *
 * Adds tables for storing swarm component history:
 * - confidence_history: Tracks confidence scores over time
 * - complexity_analysis: Stores task complexity analysis results
 * - plan_comparisons: Records plan evaluation and comparison results
 *
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');

const MIGRATION_ID = '001-swarm-features';
const MIGRATION_VERSION = '1.0.0';

/**
 * Check if migration has already been applied
 * @param {Object} db - better-sqlite3 database instance
 * @returns {boolean} True if migration already applied
 */
function isMigrationApplied(db) {
  try {
    // Check if migrations table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='schema_migrations'
    `).get();

    if (!tableExists) {
      return false;
    }

    // Check if this specific migration has been applied
    const migration = db.prepare(`
      SELECT * FROM schema_migrations WHERE migration_id = ?
    `).get(MIGRATION_ID);

    return !!migration;
  } catch (error) {
    return false;
  }
}

/**
 * Create migrations tracking table if it doesn't exist
 * @param {Object} db - better-sqlite3 database instance
 */
function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration_id TEXT UNIQUE NOT NULL,
      version TEXT NOT NULL,
      description TEXT,
      applied_at INTEGER DEFAULT (strftime('%s', 'now')),
      checksum TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_migrations_id ON schema_migrations(migration_id);
  `);
}

/**
 * Record migration as applied
 * @param {Object} db - better-sqlite3 database instance
 * @param {string} checksum - Schema file checksum
 */
function recordMigration(db, checksum) {
  db.prepare(`
    INSERT INTO schema_migrations (migration_id, version, description, checksum)
    VALUES (?, ?, ?, ?)
  `).run(MIGRATION_ID, MIGRATION_VERSION, 'Add swarm features schema (confidence_history, complexity_analysis, plan_comparisons)', checksum);
}

/**
 * Calculate simple checksum for schema file
 * @param {string} content - File content
 * @returns {string} Checksum string
 */
function calculateChecksum(content) {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

/**
 * Apply the migration
 * @param {Object} db - better-sqlite3 database instance
 * @param {Object} options - Migration options
 * @returns {Object} Migration result
 */
function up(db, options = {}) {
  const logger = options.logger || console;
  const result = {
    success: false,
    migrationId: MIGRATION_ID,
    version: MIGRATION_VERSION,
    tablesCreated: [],
    indexesCreated: [],
    viewsCreated: [],
    error: null
  };

  try {
    // Check if already applied
    ensureMigrationsTable(db);

    if (isMigrationApplied(db)) {
      logger.info?.(`Migration ${MIGRATION_ID} already applied, skipping`) ||
        console.log(`Migration ${MIGRATION_ID} already applied, skipping`);
      result.success = true;
      result.skipped = true;
      return result;
    }

    // Read schema file
    const schemaPath = path.join(__dirname, '..', 'schema-swarm.sql');

    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found: ${schemaPath}`);
    }

    const schema = fs.readFileSync(schemaPath, 'utf8');
    const checksum = calculateChecksum(schema);

    // Apply schema in a transaction
    db.exec('BEGIN TRANSACTION');

    try {
      db.exec(schema);

      // Track what was created
      result.tablesCreated = ['confidence_history', 'complexity_analysis', 'plan_comparisons'];
      result.indexesCreated = [
        'idx_confidence_history_task', 'idx_confidence_history_session',
        'idx_confidence_history_phase', 'idx_confidence_history_state',
        'idx_confidence_history_recorded', 'idx_confidence_history_score',
        'idx_complexity_task', 'idx_complexity_strategy', 'idx_complexity_score',
        'idx_complexity_phase', 'idx_complexity_recorded',
        'idx_comparison_task', 'idx_comparison_id', 'idx_comparison_winner',
        'idx_comparison_recorded'
      ];
      result.viewsCreated = [
        'v_confidence_trends', 'v_complexity_distribution',
        'v_plan_comparison_accuracy', 'v_recent_swarm_activity'
      ];

      // Record migration
      recordMigration(db, checksum);

      db.exec('COMMIT');

      logger.info?.(`Migration ${MIGRATION_ID} applied successfully`) ||
        console.log(`Migration ${MIGRATION_ID} applied successfully`);

      result.success = true;

    } catch (innerError) {
      db.exec('ROLLBACK');
      throw innerError;
    }

  } catch (error) {
    result.error = error.message;
    logger.error?.(`Migration ${MIGRATION_ID} failed: ${error.message}`) ||
      console.error(`Migration ${MIGRATION_ID} failed: ${error.message}`);
  }

  return result;
}

/**
 * Rollback the migration (for development/testing)
 * @param {Object} db - better-sqlite3 database instance
 * @param {Object} options - Migration options
 * @returns {Object} Rollback result
 */
function down(db, options = {}) {
  const logger = options.logger || console;
  const result = {
    success: false,
    migrationId: MIGRATION_ID,
    tablesDropped: [],
    error: null
  };

  try {
    db.exec('BEGIN TRANSACTION');

    try {
      // Drop views first (they depend on tables)
      db.exec(`
        DROP VIEW IF EXISTS v_confidence_trends;
        DROP VIEW IF EXISTS v_complexity_distribution;
        DROP VIEW IF EXISTS v_plan_comparison_accuracy;
        DROP VIEW IF EXISTS v_recent_swarm_activity;
      `);

      // Drop tables
      db.exec(`
        DROP TABLE IF EXISTS confidence_history;
        DROP TABLE IF EXISTS complexity_analysis;
        DROP TABLE IF EXISTS plan_comparisons;
      `);

      result.tablesDropped = ['confidence_history', 'complexity_analysis', 'plan_comparisons'];

      // Remove migration record
      db.prepare('DELETE FROM schema_migrations WHERE migration_id = ?').run(MIGRATION_ID);

      // Remove swarm schema version from system_info
      db.prepare('DELETE FROM system_info WHERE key = ?').run('swarm_schema_version');

      db.exec('COMMIT');

      logger.info?.(`Migration ${MIGRATION_ID} rolled back successfully`) ||
        console.log(`Migration ${MIGRATION_ID} rolled back successfully`);

      result.success = true;

    } catch (innerError) {
      db.exec('ROLLBACK');
      throw innerError;
    }

  } catch (error) {
    result.error = error.message;
    logger.error?.(`Migration ${MIGRATION_ID} rollback failed: ${error.message}`) ||
      console.error(`Migration ${MIGRATION_ID} rollback failed: ${error.message}`);
  }

  return result;
}

/**
 * Get migration info
 * @returns {Object} Migration metadata
 */
function getInfo() {
  return {
    id: MIGRATION_ID,
    version: MIGRATION_VERSION,
    description: 'Add swarm features schema (confidence_history, complexity_analysis, plan_comparisons)',
    tables: ['confidence_history', 'complexity_analysis', 'plan_comparisons'],
    dependencies: ['schema.sql'] // Depends on system_info table
  };
}

module.exports = {
  up,
  down,
  getInfo,
  isMigrationApplied,
  MIGRATION_ID,
  MIGRATION_VERSION
};
