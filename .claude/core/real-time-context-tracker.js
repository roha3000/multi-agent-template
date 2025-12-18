/**
 * Real-Time Context Tracker
 *
 * Provides real-time monitoring of Claude Code session context usage by watching
 * JSONL session files and extracting actual token counts from API responses.
 *
 * This replaces all Math.random() simulations with REAL data from Claude Code.
 *
 * Key Features:
 * - Real-time file watching with chokidar (<200ms latency)
 * - Accurate token extraction from JSONL session files
 * - Session accumulation for context window tracking
 * - Integration with dev-docs 3-file pattern for state conservation
 * - Automatic checkpoint triggers at configurable thresholds
 * - Multi-session support
 *
 * Data Flow:
 *   Claude Code -> JSONL files -> chokidar watch -> Parse new lines ->
 *   Extract usage -> Accumulate -> Calculate % -> Trigger checkpoints
 *
 * @module real-time-context-tracker
 */

const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const EventEmitter = require('events');
const { createComponentLogger } = require('./logger');

class RealTimeContextTracker extends EventEmitter {
  /**
   * Create a Real-Time Context Tracker
   *
   * @param {Object} options - Configuration options
   * @param {string} [options.projectPath] - Current project path (for filtering)
   * @param {string} [options.claudeProjectsPath] - Path to ~/.claude/projects
   * @param {number} [options.contextWindowSize=200000] - Claude's context window
   * @param {Object} [options.thresholds] - Checkpoint thresholds
   * @param {StateManager} [options.stateManager] - State manager for dev-docs integration
   * @param {Function} [options.onCheckpoint] - Callback when checkpoint should trigger
   */
  constructor(options = {}) {
    super();

    this.logger = createComponentLogger('RealTimeContextTracker');

    // Configuration
    this.projectPath = options.projectPath || process.cwd();
    this.claudeProjectsPath = options.claudeProjectsPath ||
      path.join(os.homedir(), '.claude', 'projects');

    this.contextWindowSize = options.contextWindowSize || 200000;

    this.thresholds = {
      warning: options.thresholds?.warning || 0.70,      // 70% - warning checkpoint
      critical: options.thresholds?.critical || 0.85,    // 85% - urgent checkpoint
      emergency: options.thresholds?.emergency || 0.95,  // 95% - emergency save
      ...options.thresholds
    };

    this.stateManager = options.stateManager;
    this.onCheckpoint = options.onCheckpoint;

    // State tracking - REAL data, no simulations
    this.sessions = new Map();  // sessionId -> SessionData
    this.currentSessionId = null;
    this.filePositions = new Map();  // filepath -> last read position

    // Aggregated metrics
    this.metrics = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      contextUsed: 0,
      contextPercent: 0,
      messageCount: 0,
      lastUpdate: null,
      velocity: 0,  // tokens per second
      projectedExhaustion: null  // seconds until 100%
    };

    // Checkpoint state
    this.checkpointState = {
      warningTriggered: false,
      criticalTriggered: false,
      emergencyTriggered: false,
      lastCheckpoint: null
    };

    // Compaction detection state
    this.compactionState = {
      lastKnownTokens: 0,
      compactionDetected: false,
      compactionCount: 0,
      lastCompactionTime: null
    };

    // Watcher instance
    this.watcher = null;
    this.isRunning = false;

    // Derive the Claude project folder name from current path
    this.claudeProjectFolder = this._getClaudeProjectFolder();

    this.logger.info('RealTimeContextTracker initialized', {
      projectPath: this.projectPath,
      claudeProjectFolder: this.claudeProjectFolder,
      contextWindowSize: this.contextWindowSize,
      thresholds: this.thresholds
    });
  }

  /**
   * Get the Claude project folder name (derived from project path)
   * @private
   */
  _getClaudeProjectFolder() {
    // Claude Code stores projects with path converted to folder name
    // e.g., C:\Users\roha3\Claude\multi-agent-template becomes
    //       C--Users-roha3-Claude-multi-agent-template
    // Note: Uses double dash (--) as separator
    return this.projectPath
      .replace(/^([A-Za-z]):/, (match, drive) => drive.toUpperCase() + '-')
      .replace(/[/\\]/g, '-');
  }

  /**
   * Start real-time tracking
   */
  async start() {
    if (this.isRunning) {
      this.logger.warn('Tracker already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting real-time context tracking');

    // Build the watch path for this project's session files
    const projectSessionPath = path.join(
      this.claudeProjectsPath,
      this.claudeProjectFolder
    );

    // Check if directory exists
    if (!fs.existsSync(projectSessionPath)) {
      this.logger.warn('Claude project session directory not found', {
        path: projectSessionPath,
        expectedFolder: this.claudeProjectFolder
      });

      // Watch for directory creation
      this._watchForDirectoryCreation(projectSessionPath);
      return;
    }

    // Initialize file positions for existing files (tail from end)
    await this._initializeFilePositions(projectSessionPath);

    // Start watching with chokidar
    this._startWatching(projectSessionPath);

    this.emit('started', {
      projectPath: this.projectPath,
      sessionPath: projectSessionPath
    });
  }

  /**
   * Stop tracking
   */
  async stop() {
    if (!this.isRunning) return;

    this.logger.info('Stopping real-time context tracking');

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.isRunning = false;
    this.emit('stopped');
  }

  /**
   * Initialize file positions to tail from current end
   * @private
   */
  async _initializeFilePositions(sessionPath) {
    try {
      const files = fs.readdirSync(sessionPath)
        .filter(f => f.endsWith('.jsonl'));

      for (const file of files) {
        const filepath = path.join(sessionPath, file);
        const stats = fs.statSync(filepath);

        // Start from current end (don't re-read historical data)
        this.filePositions.set(filepath, stats.size);

        // Extract session ID from filename
        const sessionId = path.basename(file, '.jsonl');

        // Initialize session tracking
        if (!this.sessions.has(sessionId)) {
          this.sessions.set(sessionId, {
            id: sessionId,
            filepath,
            inputTokens: 0,
            outputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            messageCount: 0,
            model: null,
            startTime: Date.now(),
            lastUpdate: Date.now()
          });
        }
      }

      // Find the most recent session (current session)
      const sortedFiles = files
        .map(f => ({
          file: f,
          mtime: fs.statSync(path.join(sessionPath, f)).mtime.getTime()
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (sortedFiles.length > 0) {
        this.currentSessionId = path.basename(sortedFiles[0].file, '.jsonl');
        this.logger.info('Current session identified', {
          sessionId: this.currentSessionId
        });
      }

      this.logger.info('File positions initialized', {
        fileCount: files.length,
        currentSession: this.currentSessionId
      });

    } catch (error) {
      this.logger.error('Error initializing file positions', {
        error: error.message
      });
    }
  }

  /**
   * Start chokidar file watching
   * @private
   */
  _startWatching(sessionPath) {
    const watchPattern = path.join(sessionPath, '*.jsonl');

    this.logger.info('Starting file watcher', { pattern: watchPattern });

    this.watcher = chokidar.watch(watchPattern, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      },
      usePolling: false,  // Use native events for better performance
      interval: 100
    });

    // Handle file changes (new content appended)
    this.watcher.on('change', async (filepath) => {
      await this._handleFileChange(filepath);
    });

    // Handle new files (new sessions)
    this.watcher.on('add', async (filepath) => {
      await this._handleNewFile(filepath);
    });

    // Handle errors
    this.watcher.on('error', (error) => {
      this.logger.error('Watcher error', { error: error.message });
      this.emit('error', error);
    });

    this.watcher.on('ready', () => {
      this.logger.info('File watcher ready');
      this.emit('watcher:ready');
    });
  }

  /**
   * Handle file change event (new content appended)
   * @private
   */
  async _handleFileChange(filepath) {
    try {
      const stats = fs.statSync(filepath);
      const lastPosition = this.filePositions.get(filepath) || 0;

      // Check if file grew (new content)
      if (stats.size > lastPosition) {
        // Read only the new content
        const newContent = await this._readNewLines(filepath, lastPosition, stats.size);

        // Update position
        this.filePositions.set(filepath, stats.size);

        // Parse and process new entries
        await this._processNewEntries(filepath, newContent);
      }

    } catch (error) {
      this.logger.error('Error handling file change', {
        filepath,
        error: error.message
      });
    }
  }

  /**
   * Handle new file (new session started)
   * @private
   */
  async _handleNewFile(filepath) {
    const sessionId = path.basename(filepath, '.jsonl');

    this.logger.info('New session file detected', { sessionId, filepath });

    // Initialize tracking for new session
    this.sessions.set(sessionId, {
      id: sessionId,
      filepath,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      messageCount: 0,
      model: null,
      startTime: Date.now(),
      lastUpdate: Date.now()
    });

    // Start from beginning for new files
    this.filePositions.set(filepath, 0);

    // This becomes the current session
    this.currentSessionId = sessionId;

    // Reset checkpoint triggers for new session
    this.checkpointState.warningTriggered = false;
    this.checkpointState.criticalTriggered = false;
    this.checkpointState.emergencyTriggered = false;

    this.emit('session:new', { sessionId, filepath });
  }

  /**
   * Read new lines from file
   * @private
   */
  async _readNewLines(filepath, start, end) {
    return new Promise((resolve, reject) => {
      const chunks = [];

      const stream = fs.createReadStream(filepath, {
        start,
        end: end - 1,
        encoding: 'utf8'
      });

      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => resolve(chunks.join('')));
      stream.on('error', reject);
    });
  }

  /**
   * Process new JSONL entries
   * @private
   */
  async _processNewEntries(filepath, content) {
    const sessionId = path.basename(filepath, '.jsonl');
    const session = this.sessions.get(sessionId);

    if (!session) {
      this.logger.warn('Session not found for file', { sessionId });
      return;
    }

    const lines = content.split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        // Extract usage from message.usage
        if (entry.message?.usage) {
          const usage = entry.message.usage;
          const model = entry.message.model;

          // Accumulate tokens for this session
          session.inputTokens += usage.input_tokens || 0;
          session.outputTokens += usage.output_tokens || 0;
          session.cacheCreationTokens += usage.cache_creation_input_tokens || 0;
          session.cacheReadTokens += usage.cache_read_input_tokens || 0;
          session.messageCount++;
          session.model = model || session.model;
          session.lastUpdate = Date.now();

          // Update session in map
          this.sessions.set(sessionId, session);

          // Update aggregated metrics
          this._updateMetrics(usage, sessionId);

          // Log the update
          this.logger.debug('Token usage updated', {
            sessionId,
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheCreation: usage.cache_creation_input_tokens,
            cacheRead: usage.cache_read_input_tokens,
            totalContext: this.metrics.contextUsed,
            contextPercent: this.metrics.contextPercent.toFixed(1) + '%'
          });

          // Check thresholds and trigger checkpoints
          await this._checkThresholds();

          // Emit update event
          this.emit('usage:update', {
            sessionId,
            usage,
            metrics: this.getMetrics()
          });
        }

      } catch (error) {
        // Skip malformed lines (common during file writes)
        if (!line.includes('"type"')) {
          // Only log if it looks like it should be valid JSON
          this.logger.debug('Skipping non-usage entry', {
            preview: line.substring(0, 50)
          });
        }
      }
    }
  }

  /**
   * Update aggregated metrics
   * @private
   *
   * IMPORTANT: Context window is calculated from the CURRENT API response's usage,
   * not cumulative totals. The usage object contains:
   * - input_tokens: Fresh (uncached) input tokens
   * - cache_read_input_tokens: Cached input tokens (still in context window!)
   * - cache_creation_input_tokens: New tokens being cached
   * - output_tokens: Response tokens
   *
   * Total context = input + cache_read + cache_creation + output
   */
  _updateMetrics(usage, sessionId) {
    const now = Date.now();
    const previousContextUsed = this.metrics.contextUsed;
    const timeDelta = this.metrics.lastUpdate ?
      (now - this.metrics.lastUpdate) / 1000 : 1;

    // Context used = CURRENT response's total tokens (not cumulative!)
    // This accurately reflects the current conversation context size
    const currentContextUsed = (usage.input_tokens || 0) +
                               (usage.cache_read_input_tokens || 0) +
                               (usage.cache_creation_input_tokens || 0) +
                               (usage.output_tokens || 0);

    this.metrics.contextUsed = currentContextUsed;

    // Store latest usage breakdown
    this.metrics.latestUsage = {
      input: usage.input_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      cacheCreation: usage.cache_creation_input_tokens || 0,
      output: usage.output_tokens || 0
    };

    // COMPACTION DETECTION: Check for sudden drop in tokens
    // Claude Code auto-compacts around 80%, causing a significant token drop
    if (this.compactionState.lastKnownTokens > 0) {
      const tokenDrop = this.compactionState.lastKnownTokens - this.metrics.contextUsed;
      const dropPercent = tokenDrop / this.compactionState.lastKnownTokens;

      // If tokens dropped by more than 30%, compaction likely occurred
      if (dropPercent > 0.30 && this.compactionState.lastKnownTokens > 50000) {
        this._handleCompactionDetected(tokenDrop, dropPercent);
      }
    }

    // Update last known tokens for next comparison
    this.compactionState.lastKnownTokens = this.metrics.contextUsed;

    // Update cumulative totals (for cost tracking/reporting)
    this.metrics.totalInputTokens += usage.input_tokens || 0;
    this.metrics.totalOutputTokens += usage.output_tokens || 0;
    this.metrics.totalCacheCreationTokens += usage.cache_creation_input_tokens || 0;
    this.metrics.totalCacheReadTokens += usage.cache_read_input_tokens || 0;
    this.metrics.messageCount++;

    // Calculate context percentage
    this.metrics.contextPercent =
      (this.metrics.contextUsed / this.contextWindowSize) * 100;

    // Calculate velocity (tokens per second)
    if (timeDelta > 0 && previousContextUsed > 0) {
      const tokenDelta = this.metrics.contextUsed - previousContextUsed;
      this.metrics.velocity = tokenDelta / timeDelta;

      // Project time to exhaustion
      const remainingTokens = this.contextWindowSize - this.metrics.contextUsed;
      if (this.metrics.velocity > 0) {
        this.metrics.projectedExhaustion = remainingTokens / this.metrics.velocity;
      }
    }

    this.metrics.lastUpdate = now;
  }

  /**
   * Handle compaction detection - trigger session-init reload
   * @private
   */
  async _handleCompactionDetected(tokenDrop, dropPercent) {
    this.logger.warn('COMPACTION DETECTED!', {
      tokenDrop: tokenDrop.toLocaleString(),
      dropPercent: (dropPercent * 100).toFixed(1) + '%',
      previousTokens: this.compactionState.lastKnownTokens.toLocaleString(),
      currentTokens: this.metrics.contextUsed.toLocaleString()
    });

    this.compactionState.compactionDetected = true;
    this.compactionState.compactionCount++;
    this.compactionState.lastCompactionTime = Date.now();

    // Reset checkpoint triggers since context was cleared
    this.resetCheckpointTriggers();

    // Emit compaction event with recovery instructions
    const recoveryData = {
      timestamp: new Date().toISOString(),
      tokenDrop,
      dropPercent,
      previousTokens: this.compactionState.lastKnownTokens,
      currentTokens: this.metrics.contextUsed,
      compactionCount: this.compactionState.compactionCount,
      recoveryAction: 'session-init',
      devDocsFiles: [
        'PROJECT_SUMMARY.md',
        '.claude/dev-docs/plan.md',
        '.claude/dev-docs/tasks.md'
      ],
      recoveryCommand: '/session-init',
      recoveryInstructions: `
COMPACTION DETECTED - Context was automatically cleared by Claude Code.

To restore context efficiently (~400 tokens), run:
  /session-init

Or manually read these 3 files:
  1. PROJECT_SUMMARY.md - Project state and history
  2. .claude/dev-docs/plan.md - Current task breakdown
  3. .claude/dev-docs/tasks.md - Active todo list

The dev-docs 3-file pattern preserves all critical context.
      `.trim()
    };

    this.emit('compaction:detected', recoveryData);

    // Log recovery instructions to console
    console.log('\n' + '!'.repeat(60));
    console.log('COMPACTION DETECTED - AUTO-RECOVERY TRIGGERED');
    console.log('!'.repeat(60));
    console.log(recoveryData.recoveryInstructions);
    console.log('!'.repeat(60) + '\n');

    // If state manager available, record the compaction event
    if (this.stateManager) {
      try {
        this.stateManager.addDecision(
          `Compaction detected - ${tokenDrop.toLocaleString()} tokens cleared`,
          `Claude Code auto-compaction occurred. Recovery via /session-init recommended.`,
          'implementation',
          'RealTimeContextTracker'
        );
      } catch (error) {
        this.logger.error('Failed to record compaction event', { error: error.message });
      }
    }

    return recoveryData;
  }

  /**
   * Check thresholds and trigger checkpoints
   * @private
   */
  async _checkThresholds() {
    const utilization = this.metrics.contextUsed / this.contextWindowSize;

    // Emergency threshold (95%)
    if (utilization >= this.thresholds.emergency && !this.checkpointState.emergencyTriggered) {
      this.checkpointState.emergencyTriggered = true;
      await this._triggerCheckpoint('emergency', utilization);
    }
    // Critical threshold (85%)
    else if (utilization >= this.thresholds.critical && !this.checkpointState.criticalTriggered) {
      this.checkpointState.criticalTriggered = true;
      await this._triggerCheckpoint('critical', utilization);
    }
    // Warning threshold (70%)
    else if (utilization >= this.thresholds.warning && !this.checkpointState.warningTriggered) {
      this.checkpointState.warningTriggered = true;
      await this._triggerCheckpoint('warning', utilization);
    }
  }

  /**
   * Trigger a checkpoint using the dev-docs 3-file pattern
   * @private
   */
  async _triggerCheckpoint(level, utilization) {
    this.logger.warn(`CHECKPOINT TRIGGERED: ${level.toUpperCase()}`, {
      utilization: (utilization * 100).toFixed(1) + '%',
      contextUsed: this.metrics.contextUsed,
      contextWindow: this.contextWindowSize
    });

    const checkpointData = {
      level,
      timestamp: new Date().toISOString(),
      utilization,
      metrics: this.getMetrics(),
      sessionId: this.currentSessionId
    };

    // Use dev-docs 3-file pattern for efficient state conservation
    if (this.stateManager) {
      try {
        // Save decision about checkpoint
        this.stateManager.addDecision(
          `Context checkpoint triggered at ${(utilization * 100).toFixed(1)}%`,
          `${level} threshold reached. Context: ${this.metrics.contextUsed}/${this.contextWindowSize} tokens.`,
          'implementation',
          'RealTimeContextTracker'
        );

        // The dev-docs pattern already maintains:
        // 1. PROJECT_SUMMARY.md - Project state
        // 2. .claude/dev-docs/plan.md - Current task
        // 3. .claude/dev-docs/tasks.md - Todo list
        // These are automatically loaded on session reload (~400 tokens)

        this.logger.info('State saved using dev-docs pattern');

      } catch (error) {
        this.logger.error('Failed to save state', { error: error.message });
      }
    }

    // Call custom checkpoint handler if provided
    if (this.onCheckpoint) {
      await this.onCheckpoint(checkpointData);
    }

    this.checkpointState.lastCheckpoint = checkpointData;

    // Emit checkpoint event
    this.emit(`checkpoint:${level}`, checkpointData);
    this.emit('checkpoint', checkpointData);
  }

  /**
   * Watch for directory creation
   * @private
   */
  _watchForDirectoryCreation(dirPath) {
    const parentDir = path.dirname(dirPath);

    if (!fs.existsSync(parentDir)) {
      this.logger.warn('Parent directory does not exist', { parentDir });
      return;
    }

    const parentWatcher = chokidar.watch(parentDir, {
      persistent: true,
      depth: 1
    });

    parentWatcher.on('addDir', async (addedPath) => {
      if (addedPath === dirPath || addedPath.endsWith(this.claudeProjectFolder)) {
        this.logger.info('Project session directory created', { path: addedPath });
        await parentWatcher.close();

        // Now start watching the session files
        await this._initializeFilePositions(dirPath);
        this._startWatching(dirPath);
      }
    });
  }

  /**
   * Get current metrics (for dashboard/API consumption)
   */
  getMetrics() {
    return {
      // Context tracking
      contextUsed: this.metrics.contextUsed,
      contextPercent: this.metrics.contextPercent,
      contextWindow: this.contextWindowSize,
      remainingTokens: this.contextWindowSize - this.metrics.contextUsed,

      // Token breakdown (cumulative for cost tracking)
      inputTokens: this.metrics.totalInputTokens,
      outputTokens: this.metrics.totalOutputTokens,
      cacheCreationTokens: this.metrics.totalCacheCreationTokens,
      cacheReadTokens: this.metrics.totalCacheReadTokens,

      // Latest usage breakdown (for dashboard detail)
      latestUsage: this.metrics.latestUsage || null,

      // Session info
      messageCount: this.metrics.messageCount,
      currentSessionId: this.currentSessionId,
      sessionCount: this.sessions.size,

      // Velocity and projections
      velocity: this.metrics.velocity,
      projectedExhaustion: this.metrics.projectedExhaustion,

      // Timestamps
      lastUpdate: this.metrics.lastUpdate,

      // Checkpoint state
      checkpointState: { ...this.checkpointState },

      // Compaction detection state
      compactionState: { ...this.compactionState },

      // Safety status
      safetyStatus: this._getSafetyStatus()
    };
  }

  /**
   * Get safety status based on current utilization
   * @private
   */
  _getSafetyStatus() {
    const utilization = this.metrics.contextUsed / this.contextWindowSize;

    if (utilization >= this.thresholds.emergency) {
      return 'EMERGENCY';
    } else if (utilization >= this.thresholds.critical) {
      return 'CRITICAL';
    } else if (utilization >= this.thresholds.warning) {
      return 'WARNING';
    } else {
      return 'OK';
    }
  }

  /**
   * Get current session data
   */
  getCurrentSession() {
    if (!this.currentSessionId) return null;
    return this.sessions.get(this.currentSessionId);
  }

  /**
   * Get all sessions
   */
  getAllSessions() {
    return Array.from(this.sessions.values());
  }

  /**
   * Reset checkpoint triggers (for new session or after context clear)
   */
  resetCheckpointTriggers() {
    this.checkpointState.warningTriggered = false;
    this.checkpointState.criticalTriggered = false;
    this.checkpointState.emergencyTriggered = false;
    this.logger.info('Checkpoint triggers reset');
  }

  /**
   * Manually set context used (for testing or recovery)
   */
  setContextUsed(tokens) {
    this.metrics.contextUsed = tokens;
    this.metrics.contextPercent = (tokens / this.contextWindowSize) * 100;
    this.metrics.lastUpdate = Date.now();
    this.emit('usage:manual-update', this.getMetrics());
  }
}

module.exports = RealTimeContextTracker;
