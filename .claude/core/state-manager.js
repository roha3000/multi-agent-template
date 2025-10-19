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
const { createComponentLogger } = require('./logger');

// Create logger instance for StateManager
const logger = createComponentLogger('StateManager');

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
        logger.info('No state file found, creating default state');
        return this._createDefaultState();
      }

      // Read and parse state file
      const stateJson = fs.readFileSync(this.statePath, 'utf8');
      const state = JSON.parse(stateJson);

      // Validate state against schema
      const valid = this.validate(state);
      if (!valid) {
        logger.error('State validation failed', { errors: this.validate.errors });
        return this._attemptRecovery();
      }

      logger.info('State loaded successfully', { currentPhase: state.current_phase });
      return state;

    } catch (error) {
      logger.error('Error loading state', { error: error.message, stack: error.stack });
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

      logger.info('State saved successfully');
      return true;

    } catch (error) {
      logger.error('Error saving state', { error: error.message, stack: error.stack });
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
      logger.debug('Backup created', { backupPath });

      // Clean old backups (keep last 10)
      this._cleanOldBackups(10);

    } catch (error) {
      logger.warn('Error creating backup', { error: error.message });
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
        logger.debug('Deleted old backup', { backupName: backup.name });
      });

    } catch (error) {
      logger.warn('Error cleaning backups', { error: error.message });
    }
  }

  /**
   * Attempts to recover state from backup
   * @returns {Object} Recovered state or default state
   * @private
   */
  _attemptRecovery() {
    logger.warn('Attempting state recovery from backups');

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
            logger.info('Successfully recovered from backup', { backupName: backup.name });

            // Save recovered state as current
            fs.copyFileSync(backup.path, this.statePath);
            return state;
          }
        } catch (error) {
          logger.debug('Backup invalid, trying next', { backupName: backup.name, error: error.message });
          continue;
        }
      }

      logger.warn('No valid backups found, creating default state');
      return this._createDefaultState();

    } catch (error) {
      logger.error('Recovery failed', { error: error.message, stack: error.stack });
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
    logger.info('Phase transition', { newPhase, agent });

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
      logger.info('Added artifact', { phase, artifactPath });
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
    logger.info('Decision recorded', { phase, decision });

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
    logger.warn('Blocker added', { severity, blocker, phase });

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
      logger.info('Blocker resolved', { blocker: state.blockers[blockerIndex].blocker, resolution });
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
      logger.error('Import failed', { error: error.message, stack: error.stack });
      return false;
    }
  }

  /**
   * Resets state to default
   * @returns {Object} Default state
   */
  reset() {
    logger.warn('Resetting state to default');
    return this._createDefaultState();
  }

  // ============================================================================
  // PROMPT TRACEABILITY METHODS
  // ============================================================================

  /**
   * Generates a unique ID for a prompt entry
   * @private
   * @returns {string} Unique ID
   */
  _generatePromptId() {
    return `prompt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generates a unique artifact ID from file path
   * @private
   * @param {string} artifactPath - Path to artifact
   * @returns {string} Artifact ID
   */
  _generateArtifactId(artifactPath) {
    return artifactPath.replace(/[/\\]/g, '-').replace(/\.[^.]+$/, '');
  }

  /**
   * Gets or creates a session ID for grouping prompts
   * @private
   * @returns {string} Session ID
   */
  _getSessionId() {
    if (!this._currentSessionId) {
      this._currentSessionId = `session-${Date.now()}`;
    }
    return this._currentSessionId;
  }

  /**
   * Records a prompt that created or modified artifacts
   * @param {string} prompt - The user prompt or task description
   * @param {Object} options - Optional parameters
   * @param {string} options.artifactPath - Path to artifact created/modified
   * @param {string} options.phase - Current phase
   * @param {string} options.agent - Agent processing the prompt
   * @param {Array<string>} options.artifactsCreated - List of created artifact paths
   * @param {Array<string>} options.artifactsModified - List of modified artifact paths
   * @param {string} options.changeType - Type of change (created|modified|refactored|enhanced|bug-fix)
   * @param {string} options.changeSummary - Brief summary of changes
   * @param {number} options.qualityImpact - Impact on quality score (+/-)
   * @returns {Object} Prompt entry object
   */
  recordPrompt(prompt, options = {}) {
    const state = this.load();

    // Initialize prompt history if not exists
    if (!state.promptHistory) {
      state.promptHistory = [];
    }

    // Capture state before changes
    const stateSnapshot = {
      phase: state.current_phase,
      qualityScore: state.quality_scores[state.current_phase] || 0,
      artifactCount: Object.values(state.artifacts).flat().length
    };

    // Create prompt entry
    const promptEntry = {
      id: this._generatePromptId(),
      timestamp: new Date().toISOString(),
      prompt: prompt,
      phase: options.phase || state.current_phase,
      agent: options.agent || 'Unknown Agent',
      sessionId: this._getSessionId(),
      stateChangesBefore: stateSnapshot
    };

    // Add artifact information if provided
    if (options.artifactPath) {
      promptEntry.artifactId = this._generateArtifactId(options.artifactPath);
      promptEntry.artifactPath = options.artifactPath;
    }

    if (options.artifactsCreated && options.artifactsCreated.length > 0) {
      promptEntry.artifactsCreated = options.artifactsCreated;
    }

    if (options.artifactsModified && options.artifactsModified.length > 0) {
      promptEntry.artifactsModified = options.artifactsModified;
    }

    if (options.qualityImpact !== undefined) {
      promptEntry.qualityImpact = options.qualityImpact;
    }

    // Add to prompt history
    state.promptHistory.push(promptEntry);

    // Update artifact lineage if artifact path is provided
    if (options.artifactPath) {
      this._updateArtifactLineage(state, promptEntry, options);
    }

    this.save(state);
    logger.debug('Prompt recorded', { promptId: promptEntry.id, phase: promptEntry.phase });

    return promptEntry;
  }

  /**
   * Updates artifact lineage tracking
   * @private
   * @param {Object} state - Current state
   * @param {Object} promptEntry - Prompt entry
   * @param {Object} options - Options with change details
   */
  _updateArtifactLineage(state, promptEntry, options) {
    // Initialize artifact lineage if not exists
    if (!state.artifactLineage) {
      state.artifactLineage = {};
    }

    const artifactPath = options.artifactPath;
    const artifactId = promptEntry.artifactId;

    // Create new lineage entry if this is a new artifact
    if (!state.artifactLineage[artifactPath]) {
      state.artifactLineage[artifactPath] = {
        artifactId: artifactId,
        created: promptEntry.timestamp,
        createdBy: {
          promptId: promptEntry.id,
          agent: promptEntry.agent,
          phase: promptEntry.phase
        },
        currentVersion: 1,
        versions: [],
        relatedPrompts: [],
        totalModifications: 0
      };
    }

    const lineage = state.artifactLineage[artifactPath];

    // Increment version if this is a modification
    const isNewArtifact = lineage.versions.length === 0;
    if (!isNewArtifact) {
      lineage.currentVersion += 1;
    }

    // Add version entry
    const versionEntry = {
      version: lineage.currentVersion,
      timestamp: promptEntry.timestamp,
      promptId: promptEntry.id,
      prompt: promptEntry.prompt,
      agent: promptEntry.agent,
      phase: promptEntry.phase,
      changeType: options.changeType || (isNewArtifact ? 'created' : 'modified')
    };

    if (options.changeSummary) {
      versionEntry.changeSummary = options.changeSummary;
    }

    lineage.versions.push(versionEntry);
    lineage.relatedPrompts.push(promptEntry.id);
    lineage.totalModifications = lineage.versions.length - 1; // Exclude initial creation
  }

  /**
   * Gets complete history of an artifact
   * @param {string} artifactPath - Path to artifact
   * @returns {Object|null} Artifact history with lineage and related prompts
   */
  getArtifactHistory(artifactPath) {
    const state = this.load();

    if (!state.artifactLineage || !state.artifactLineage[artifactPath]) {
      return null;
    }

    const lineage = state.artifactLineage[artifactPath];

    // Get all related prompts
    const relatedPrompts = (state.promptHistory || []).filter(p =>
      lineage.relatedPrompts.includes(p.id)
    );

    return {
      lineage: lineage,
      prompts: relatedPrompts,
      summary: {
        artifactId: lineage.artifactId,
        created: lineage.created,
        currentVersion: lineage.currentVersion,
        totalVersions: lineage.versions.length,
        totalModifications: lineage.totalModifications,
        createdBy: lineage.createdBy.agent,
        lastModified: lineage.versions[lineage.versions.length - 1]?.timestamp || lineage.created
      }
    };
  }

  /**
   * Gets all prompts for the current session
   * @returns {Array} Array of prompt entries
   */
  getSessionPrompts() {
    const state = this.load();
    const sessionId = this._getSessionId();

    if (!state.promptHistory) {
      return [];
    }

    return state.promptHistory.filter(p => p.sessionId === sessionId);
  }

  /**
   * Gets prompts by phase
   * @param {string} phase - Phase name
   * @returns {Array} Array of prompt entries
   */
  getPromptsByPhase(phase) {
    const state = this.load();

    if (!state.promptHistory) {
      return [];
    }

    return state.promptHistory.filter(p => p.phase === phase);
  }

  /**
   * Gets prompts by agent
   * @param {string} agent - Agent name
   * @returns {Array} Array of prompt entries
   */
  getPromptsByAgent(agent) {
    const state = this.load();

    if (!state.promptHistory) {
      return [];
    }

    return state.promptHistory.filter(p => p.agent === agent);
  }

  /**
   * Gets all artifacts with their lineage
   * @returns {Object} Map of artifact paths to lineage objects
   */
  getAllArtifactLineages() {
    const state = this.load();
    return state.artifactLineage || {};
  }

  /**
   * Searches prompts by keyword
   * @param {string} keyword - Search keyword
   * @returns {Array} Array of matching prompt entries
   */
  searchPrompts(keyword) {
    const state = this.load();

    if (!state.promptHistory) {
      return [];
    }

    const lowerKeyword = keyword.toLowerCase();
    return state.promptHistory.filter(p =>
      p.prompt.toLowerCase().includes(lowerKeyword) ||
      (p.changeSummary && p.changeSummary.toLowerCase().includes(lowerKeyword))
    );
  }

  /**
   * Gets prompt statistics
   * @returns {Object} Statistics object
   */
  getPromptStatistics() {
    const state = this.load();

    if (!state.promptHistory || state.promptHistory.length === 0) {
      return {
        totalPrompts: 0,
        byPhase: {},
        byAgent: {},
        totalArtifacts: 0,
        totalModifications: 0
      };
    }

    const stats = {
      totalPrompts: state.promptHistory.length,
      byPhase: {},
      byAgent: {},
      totalArtifacts: Object.keys(state.artifactLineage || {}).length,
      totalModifications: 0,
      avgPromptsPerSession: 0,
      sessions: new Set()
    };

    // Calculate statistics
    state.promptHistory.forEach(p => {
      // By phase
      stats.byPhase[p.phase] = (stats.byPhase[p.phase] || 0) + 1;

      // By agent
      stats.byAgent[p.agent] = (stats.byAgent[p.agent] || 0) + 1;

      // Sessions
      stats.sessions.add(p.sessionId);
    });

    // Total modifications
    Object.values(state.artifactLineage || {}).forEach(lineage => {
      stats.totalModifications += lineage.totalModifications;
    });

    // Average prompts per session
    stats.avgPromptsPerSession = Math.round(
      stats.totalPrompts / stats.sessions.size
    );
    stats.totalSessions = stats.sessions.size;
    delete stats.sessions; // Remove Set object

    return stats;
  }
}

module.exports = StateManager;
