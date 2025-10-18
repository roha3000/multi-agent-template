/**
 * State Manager - Manages project state persistence and validation
 *
 * Responsibilities:
 * - CRUD operations for project state
 * - JSON schema validation
 * - Backup and restore functionality
 * - Error handling with recovery
 *
 * @module state-manager
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

// JSON Schema for project state validation
const STATE_SCHEMA = {
  type: 'object',
  required: ['current_phase', 'phase_history', 'quality_scores', 'artifacts', 'decisions', 'blockers', 'last_updated'],
  properties: {
    current_phase: {
      type: 'string',
      enum: ['research', 'planning', 'design', 'test-first', 'implementation', 'validation', 'iteration']
    },
    phase_history: {
      type: 'array',
      items: {
        type: 'object',
        required: ['phase', 'timestamp', 'agent'],
        properties: {
          phase: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
          agent: { type: 'string' },
          trigger: { type: 'string' },
          score: { type: 'number', minimum: 0, maximum: 100 }
        }
      }
    },
    quality_scores: {
      type: 'object',
      patternProperties: {
        '^(research|planning|design|test-first|implementation|validation|iteration)$': {
          type: 'number',
          minimum: 0,
          maximum: 100
        }
      }
    },
    artifacts: {
      type: 'object',
      patternProperties: {
        '^(research|planning|design|test-first|implementation|validation|iteration)$': {
          type: 'array',
          items: { type: 'string' }
        }
      }
    },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['decision', 'rationale', 'timestamp', 'phase'],
        properties: {
          decision: { type: 'string' },
          rationale: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
          phase: { type: 'string' },
          agent: { type: 'string' }
        }
      }
    },
    blockers: {
      type: 'array',
      items: {
        type: 'object',
        required: ['blocker', 'severity', 'timestamp'],
        properties: {
          blocker: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          timestamp: { type: 'string', format: 'date-time' },
          phase: { type: 'string' },
          resolved: { type: 'boolean' },
          resolution: { type: 'string' }
        }
      }
    },
    last_updated: {
      type: 'string',
      format: 'date-time'
    },
    metadata: {
      type: 'object',
      properties: {
        project_name: { type: 'string' },
        created_at: { type: 'string', format: 'date-time' },
        version: { type: 'string' }
      }
    }
  }
};

// Default initial state
const DEFAULT_STATE = {
  current_phase: 'research',
  phase_history: [],
  quality_scores: {},
  artifacts: {},
  decisions: [],
  blockers: [],
  last_updated: new Date().toISOString(),
  metadata: {
    project_name: 'Unknown Project',
    created_at: new Date().toISOString(),
    version: '1.0.0'
  }
};

class StateManager {
  /**
   * Creates a StateManager instance
   * @param {string} projectRoot - Absolute path to project root
   */
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.stateDir = path.join(projectRoot, '.claude', 'state');
    this.statePath = path.join(this.stateDir, 'project-state.json');
    this.backupDir = path.join(this.stateDir, 'backups');

    // Initialize JSON schema validator
    this.ajv = new Ajv({ allErrors: true, useDefaults: true });
    addFormats(this.ajv); // Add support for date-time and other formats
    this.validate = this.ajv.compile(STATE_SCHEMA);

    // Ensure directories exist
    this._ensureDirectories();
  }

  /**
   * Ensures state directories exist
   * @private
   */
  _ensureDirectories() {
    [this.stateDir, this.backupDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Loads project state from disk
   * @returns {Object} Project state object
   * @throws {Error} If state is corrupted and cannot be recovered
   */
  load() {
    try {
      // Check if state file exists
      if (!fs.existsSync(this.statePath)) {
        console.log('[StateManager] No state file found, creating default state');
        return this._createDefaultState();
      }

      // Read and parse state file
      const stateJson = fs.readFileSync(this.statePath, 'utf8');
      const state = JSON.parse(stateJson);

      // Validate state against schema
      const valid = this.validate(state);
      if (!valid) {
        console.error('[StateManager] State validation failed:', this.validate.errors);
        return this._attemptRecovery();
      }

      console.log(`[StateManager] State loaded successfully. Current phase: ${state.current_phase}`);
      return state;

    } catch (error) {
      console.error('[StateManager] Error loading state:', error.message);
      return this._attemptRecovery();
    }
  }

  /**
   * Saves project state to disk with backup
   * @param {Object} state - State object to save
   * @returns {boolean} Success status
   */
  save(state) {
    try {
      // Validate state before saving
      const valid = this.validate(state);
      if (!valid) {
        throw new Error(`State validation failed: ${JSON.stringify(this.validate.errors)}`);
      }

      // Update last_updated timestamp
      state.last_updated = new Date().toISOString();

      // Create backup of existing state
      if (fs.existsSync(this.statePath)) {
        this._createBackup();
      }

      // Write state to disk (atomic write)
      const tempPath = this.statePath + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8');
      fs.renameSync(tempPath, this.statePath);

      console.log(`[StateManager] State saved successfully at ${new Date().toISOString()}`);
      return true;

    } catch (error) {
      console.error('[StateManager] Error saving state:', error.message);
      return false;
    }
  }

  /**
   * Creates a backup of the current state
   * @private
   */
  _createBackup() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(this.backupDir, `state-backup-${timestamp}.json`);

      fs.copyFileSync(this.statePath, backupPath);
      console.log(`[StateManager] Backup created: ${backupPath}`);

      // Clean old backups (keep last 10)
      this._cleanOldBackups(10);

    } catch (error) {
      console.error('[StateManager] Error creating backup:', error.message);
    }
  }

  /**
   * Cleans old backup files, keeping only the most recent N backups
   * @param {number} keepCount - Number of backups to keep
   * @private
   */
  _cleanOldBackups(keepCount) {
    try {
      const backups = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('state-backup-'))
        .map(f => ({
          name: f,
          path: path.join(this.backupDir, f),
          time: fs.statSync(path.join(this.backupDir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);

      // Delete backups beyond keepCount
      backups.slice(keepCount).forEach(backup => {
        fs.unlinkSync(backup.path);
        console.log(`[StateManager] Deleted old backup: ${backup.name}`);
      });

    } catch (error) {
      console.error('[StateManager] Error cleaning backups:', error.message);
    }
  }

  /**
   * Attempts to recover state from backup
   * @returns {Object} Recovered state or default state
   * @private
   */
  _attemptRecovery() {
    console.log('[StateManager] Attempting state recovery from backups...');

    try {
      // Get all backup files sorted by modification time (newest first)
      const backups = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('state-backup-'))
        .map(f => ({
          name: f,
          path: path.join(this.backupDir, f),
          time: fs.statSync(path.join(this.backupDir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);

      // Try each backup until we find a valid one
      for (const backup of backups) {
        try {
          const stateJson = fs.readFileSync(backup.path, 'utf8');
          const state = JSON.parse(stateJson);

          const valid = this.validate(state);
          if (valid) {
            console.log(`[StateManager] Successfully recovered from backup: ${backup.name}`);

            // Save recovered state as current
            fs.copyFileSync(backup.path, this.statePath);
            return state;
          }
        } catch (error) {
          console.log(`[StateManager] Backup ${backup.name} is invalid, trying next...`);
          continue;
        }
      }

      console.log('[StateManager] No valid backups found, creating default state');
      return this._createDefaultState();

    } catch (error) {
      console.error('[StateManager] Recovery failed:', error.message);
      return this._createDefaultState();
    }
  }

  /**
   * Creates and saves default state
   * @returns {Object} Default state object
   * @private
   */
  _createDefaultState() {
    const state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    this.save(state);
    return state;
  }

  /**
   * Updates current phase and adds to history
   * @param {string} newPhase - New phase name
   * @param {string} agent - Agent name executing the phase
   * @param {string} trigger - What triggered the phase change
   * @param {number} [score] - Quality score if transitioning from completed phase
   * @returns {Object} Updated state
   */
  transitionPhase(newPhase, agent, trigger, score = null) {
    const state = this.load();

    // Validate phase name
    const validPhases = ['research', 'planning', 'design', 'test-first', 'implementation', 'validation', 'iteration'];
    if (!validPhases.includes(newPhase)) {
      throw new Error(`Invalid phase: ${newPhase}. Must be one of: ${validPhases.join(', ')}`);
    }

    // Add to phase history
    const historyEntry = {
      phase: newPhase,
      timestamp: new Date().toISOString(),
      agent: agent,
      trigger: trigger
    };

    if (score !== null) {
      historyEntry.score = score;
      state.quality_scores[state.current_phase] = score;
    }

    state.phase_history.push(historyEntry);
    state.current_phase = newPhase;

    this.save(state);
    console.log(`[StateManager] Phase transition: ${newPhase} (agent: ${agent})`);

    return state;
  }

  /**
   * Adds an artifact to the current phase
   * @param {string} phase - Phase name
   * @param {string} artifactPath - Relative path to artifact
   * @returns {Object} Updated state
   */
  addArtifact(phase, artifactPath) {
    const state = this.load();

    if (!state.artifacts[phase]) {
      state.artifacts[phase] = [];
    }

    if (!state.artifacts[phase].includes(artifactPath)) {
      state.artifacts[phase].push(artifactPath);
      this.save(state);
      console.log(`[StateManager] Added artifact to ${phase}: ${artifactPath}`);
    }

    return state;
  }

  /**
   * Records a decision
   * @param {string} decision - Decision description
   * @param {string} rationale - Reasoning behind decision
   * @param {string} phase - Phase where decision was made
   * @param {string} agent - Agent who made the decision
   * @returns {Object} Updated state
   */
  addDecision(decision, rationale, phase, agent) {
    const state = this.load();

    state.decisions.push({
      decision: decision,
      rationale: rationale,
      timestamp: new Date().toISOString(),
      phase: phase,
      agent: agent
    });

    this.save(state);
    console.log(`[StateManager] Decision recorded for ${phase}`);

    return state;
  }

  /**
   * Adds a blocker
   * @param {string} blocker - Blocker description
   * @param {string} severity - Severity level (low|medium|high|critical)
   * @param {string} phase - Phase where blocker occurred
   * @returns {Object} Updated state
   */
  addBlocker(blocker, severity, phase) {
    const state = this.load();

    state.blockers.push({
      blocker: blocker,
      severity: severity,
      timestamp: new Date().toISOString(),
      phase: phase,
      resolved: false
    });

    this.save(state);
    console.log(`[StateManager] Blocker added (${severity}): ${blocker}`);

    return state;
  }

  /**
   * Resolves a blocker
   * @param {number} blockerIndex - Index of blocker in blockers array
   * @param {string} resolution - Resolution description
   * @returns {Object} Updated state
   */
  resolveBlocker(blockerIndex, resolution) {
    const state = this.load();

    if (blockerIndex >= 0 && blockerIndex < state.blockers.length) {
      state.blockers[blockerIndex].resolved = true;
      state.blockers[blockerIndex].resolution = resolution;
      state.blockers[blockerIndex].resolved_at = new Date().toISOString();

      this.save(state);
      console.log(`[StateManager] Blocker resolved: ${state.blockers[blockerIndex].blocker}`);
    }

    return state;
  }

  /**
   * Gets all unresolved blockers
   * @returns {Array} Array of unresolved blockers
   */
  getUnresolvedBlockers() {
    const state = this.load();
    return state.blockers.filter(b => !b.resolved);
  }

  /**
   * Gets artifacts for a specific phase
   * @param {string} phase - Phase name
   * @returns {Array} Array of artifact paths
   */
  getArtifacts(phase) {
    const state = this.load();
    return state.artifacts[phase] || [];
  }

  /**
   * Gets quality score for a phase
   * @param {string} phase - Phase name
   * @returns {number|null} Quality score or null if not set
   */
  getQualityScore(phase) {
    const state = this.load();
    return state.quality_scores[phase] || null;
  }

  /**
   * Exports state as JSON string
   * @param {boolean} pretty - Whether to format JSON
   * @returns {string} JSON string
   */
  export(pretty = true) {
    const state = this.load();
    return JSON.stringify(state, null, pretty ? 2 : 0);
  }

  /**
   * Imports state from JSON string
   * @param {string} jsonString - JSON string to import
   * @returns {boolean} Success status
   */
  import(jsonString) {
    try {
      const state = JSON.parse(jsonString);
      const valid = this.validate(state);

      if (!valid) {
        throw new Error(`Invalid state format: ${JSON.stringify(this.validate.errors)}`);
      }

      return this.save(state);

    } catch (error) {
      console.error('[StateManager] Import failed:', error.message);
      return false;
    }
  }

  /**
   * Resets state to default
   * @returns {Object} Default state
   */
  reset() {
    console.log('[StateManager] Resetting state to default');
    return this._createDefaultState();
  }
}

module.exports = StateManager;
