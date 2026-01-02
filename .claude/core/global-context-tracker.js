/**
 * Global Context Tracker
 *
 * Monitors ALL Claude Code projects in ~/.claude/projects/ simultaneously.
 * Provides unified view of context usage across all active sessions.
 *
 * Features:
 * - Watches all project folders for JSONL session files
 * - Tracks per-project context usage independently
 * - Calculates account-level totals (tokens, estimated cost)
 * - Fires alerts for any project hitting thresholds
 * - Real-time updates via EventEmitter
 *
 * @module global-context-tracker
 */

const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

// Pricing per million tokens (as of Dec 2024)
const PRICING = {
  'claude-opus-4-5-20251101': { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-3-opus-20240229': { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25, cacheWrite: 0.30, cacheRead: 0.03 },
  'default': { input: 3.00, output: 15.00, cacheWrite: 3.75, cacheRead: 0.30 }
};

class GlobalContextTracker extends EventEmitter {
  /**
   * Create a Global Context Tracker
   *
   * @param {Object} options - Configuration options
   * @param {string} [options.claudeProjectsPath] - Path to ~/.claude/projects
   * @param {number} [options.contextWindowSize=200000] - Claude's context window
   * @param {number} [options.systemOverhead=45000] - System tokens (prompts, tools, memory)
   * @param {Object} [options.thresholds] - Alert thresholds
   */
  constructor(options = {}) {
    super();

    this.claudeProjectsPath = options.claudeProjectsPath ||
      path.join(os.homedir(), '.claude', 'projects');

    this.contextWindowSize = options.contextWindowSize || 200000;

    // System overhead: tokens used by Claude Code that aren't in JSONL usage
    // Calculated from /context breakdown:
    // - System prompt: ~3k
    // - System tools: ~14k
    // - Memory files (CLAUDE.md): ~2.5k (varies by project)
    // - Custom agents: ~140
    // - Slash commands: ~864
    // - Other overhead: ~17k
    // Total overhead ≈ 38k (validated against /context)
    // Note: Autocompact buffer (~45k) is separate
    this.systemOverhead = options.systemOverhead || 38000;

    // Thresholds based on Claude Code's auto-compact at ~77.5%
    // We want to alert BEFORE auto-compact happens
    this.thresholds = {
      warning: options.thresholds?.warning || 0.50,     // 50% - plenty of time
      critical: options.thresholds?.critical || 0.65,   // 65% - should clear soon
      emergency: options.thresholds?.emergency || 0.75, // 75% - clear NOW before auto-compact
      ...options.thresholds
    };

    // Track all projects: projectFolder -> ProjectData
    this.projects = new Map();

    // Track file positions for incremental reading
    this.filePositions = new Map();

    // Account-level totals
    this.accountTotals = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      totalCost: 0,
      sessionCount: 0,
      activeProjects: 0
    };

    // Watcher instance
    this.watcher = null;
    this.isRunning = false;

    console.log('[GlobalContextTracker] Initialized', {
      claudeProjectsPath: this.claudeProjectsPath,
      thresholds: this.thresholds
    });
  }

  /**
   * Start tracking all projects
   */
  async start() {
    if (this.isRunning) {
      console.log('[GlobalContextTracker] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[GlobalContextTracker] Starting global tracking...');

    // Check if projects directory exists
    if (!fs.existsSync(this.claudeProjectsPath)) {
      console.warn('[GlobalContextTracker] Projects directory not found:', this.claudeProjectsPath);
      this.emit('error', new Error('Projects directory not found'));
      return;
    }

    // Discover existing projects
    await this._discoverProjects();

    // Start watching for changes
    this._startWatching();

    this.emit('started', {
      projectCount: this.projects.size,
      claudeProjectsPath: this.claudeProjectsPath
    });
  }

  /**
   * Stop tracking
   */
  async stop() {
    if (!this.isRunning) return;

    console.log('[GlobalContextTracker] Stopping...');

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.isRunning = false;
    this.emit('stopped');
  }

  /**
   * Discover all existing projects
   * @private
   */
  async _discoverProjects() {
    try {
      const entries = fs.readdirSync(this.claudeProjectsPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const projectFolder = entry.name;
          const projectPath = path.join(this.claudeProjectsPath, projectFolder);

          // Initialize project tracking
          await this._initializeProject(projectFolder, projectPath);
        }
      }

      console.log(`[GlobalContextTracker] Discovered ${this.projects.size} projects`);

    } catch (error) {
      console.error('[GlobalContextTracker] Error discovering projects:', error);
    }
  }

  /**
   * Initialize tracking for a project
   * @private
   */
  async _initializeProject(projectFolder, projectPath) {
    // Convert folder name back to readable path
    const readablePath = this._folderToPath(projectFolder);
    const projectName = path.basename(readablePath);

    // Initialize project data
    const projectData = {
      folder: projectFolder,
      path: readablePath,
      name: projectName,
      sessions: new Map(),
      currentSessionId: null,
      metrics: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        contextUsed: 0,
        contextPercent: 0,
        messageCount: 0,
        cost: 0,
        model: null,
        lastUpdate: null
      },
      checkpointState: {
        warningTriggered: false,
        criticalTriggered: false,
        emergencyTriggered: false
      },
      // Compaction detection state (merged from RealTimeContextTracker)
      compactionState: {
        lastKnownTokens: 0,
        compactionDetected: false,
        compactionCount: 0,
        lastCompactionTime: null
      },
      status: 'inactive'
    };

    // Find session files
    try {
      const files = fs.readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));

      // Find most recent session first
      let mostRecentFile = null;
      let mostRecentTime = 0;

      for (const file of files) {
        const filepath = path.join(projectPath, file);
        const sessionId = path.basename(file, '.jsonl');
        const stats = fs.statSync(filepath);

        if (stats.mtime.getTime() > mostRecentTime) {
          mostRecentTime = stats.mtime.getTime();
          mostRecentFile = file;
        }

        // Track file position (start from end for watching new content)
        this.filePositions.set(filepath, stats.size);

        // Add session to project
        projectData.sessions.set(sessionId, {
          id: sessionId,
          filepath,
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          messageCount: 0,
          model: null,
          lastUpdate: stats.mtime.getTime()
        });
      }

      // Set current session
      if (mostRecentFile) {
        projectData.currentSessionId = path.basename(mostRecentFile, '.jsonl');

        // Check if recently active (within last 5 minutes = likely open session)
        const fiveMinutesAgo = Date.now() - 300000;
        const isActive = mostRecentTime > fiveMinutesAgo;

        if (isActive) {
          projectData.status = 'active';
        } else {
          projectData.status = 'inactive';
          projectData.metrics.contextUsed = 0;
          projectData.metrics.contextPercent = 0;
        }

        // Read context for ALL sessions with today's activity (per-session tracking)
        const todayStart = new Date().setHours(0, 0, 0, 0);
        for (const [sessionId, session] of projectData.sessions) {
          // Skip agent sessions
          if (sessionId.startsWith('agent-')) continue;
          // Only read sessions with today's activity
          if (session.lastUpdate && session.lastUpdate > todayStart) {
            await this._readExistingSession(projectData, session.filepath);
          }
        }
      }

    } catch (error) {
      console.error(`[GlobalContextTracker] Error reading project ${projectFolder}:`, error);
    }

    this.projects.set(projectFolder, projectData);

    // Check thresholds immediately after loading
    await this._checkThresholds(projectData);

    this._updateAccountTotals();
  }

  /**
   * Read existing session file to get current token counts
   * @private
   *
   * IMPORTANT: Context window calculation uses the LATEST entry's tokens,
   * not a cumulative sum. The latest entry's input_tokens + cache_read_input_tokens
   * + cache_creation_input_tokens represents the current conversation context.
   */
  async _readExistingSession(projectData, filepath) {
    try {
      const content = fs.readFileSync(filepath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());

      const sessionId = path.basename(filepath, '.jsonl');
      const session = projectData.sessions.get(sessionId);
      if (!session) return;

      // Track cumulative totals for cost calculation
      let totalInput = 0;
      let totalOutput = 0;
      let totalCacheCreate = 0;
      let totalCacheRead = 0;
      let messageCount = 0;
      let model = null;

      // Track LATEST usage for context window calculation
      let latestUsage = null;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          if (entry.message?.usage) {
            const usage = entry.message.usage;
            // Cumulative totals (for cost)
            totalInput += usage.input_tokens || 0;
            totalOutput += usage.output_tokens || 0;
            totalCacheCreate += usage.cache_creation_input_tokens || 0;
            totalCacheRead += usage.cache_read_input_tokens || 0;
            messageCount++;
            model = entry.message.model || model;
            // Keep track of latest (for context window)
            latestUsage = usage;
          }
        } catch (e) {
          // Skip malformed lines
        }
      }

      // Calculate context used from LATEST entry (not cumulative!)
      // Context window = input_tokens + cache_read + cache_creation + output_tokens + system overhead
      // The JSONL only captures message tokens, not system prompt/tools/memory
      let contextUsed = 0;
      let messageTokens = 0;
      if (latestUsage) {
        messageTokens = (latestUsage.input_tokens || 0) +
                        (latestUsage.cache_read_input_tokens || 0) +
                        (latestUsage.cache_creation_input_tokens || 0) +
                        (latestUsage.output_tokens || 0);
        // Add system overhead (system prompt, tools, memory files, autocompact buffer)
        contextUsed = messageTokens + this.systemOverhead;
      }

      const contextPercent = (contextUsed / this.contextWindowSize) * 100;
      const sessionCost = this._calculateCost(totalInput, totalOutput, totalCacheCreate, totalCacheRead, model);

      // Update session data with cumulative totals AND per-session context
      session.inputTokens = totalInput;
      session.outputTokens = totalOutput;
      session.cacheCreationTokens = totalCacheCreate;
      session.cacheReadTokens = totalCacheRead;
      session.messageCount = messageCount;
      session.model = model;
      session.latestUsage = latestUsage;
      // Per-session context tracking (NEW)
      session.contextUsed = contextUsed;
      session.contextPercent = contextPercent;
      session.cost = sessionCost;

      // Also update project-level metrics (for backward compatibility)
      projectData.metrics = {
        inputTokens: totalInput,
        outputTokens: totalOutput,
        cacheCreationTokens: totalCacheCreate,
        cacheReadTokens: totalCacheRead,
        contextUsed,
        contextPercent,
        messageCount,
        cost: sessionCost,
        model,
        lastUpdate: Date.now(),
        // Store latest usage breakdown for dashboard
        latestUsage: latestUsage ? {
          input: latestUsage.input_tokens || 0,
          cacheRead: latestUsage.cache_read_input_tokens || 0,
          cacheCreation: latestUsage.cache_creation_input_tokens || 0,
          output: latestUsage.output_tokens || 0
        } : null
      };

      console.log(`[GlobalContextTracker] Loaded ${projectData.name}/${sessionId}: ${contextPercent.toFixed(1)}% context (${contextUsed.toLocaleString()} tokens)`);

    } catch (error) {
      console.error(`[GlobalContextTracker] Error reading session file:`, error);
    }
  }

  /**
   * Convert folder name back to readable path
   * e.g., "C--Users-roha3-Claude-project" -> "C:/Users/roha3/Claude/project"
   *
   * Note: The folder naming convention uses single dashes for path separators,
   * but folder names may also contain dashes (e.g., "multi-agent-template").
   * We recursively try to find the path that exists on disk.
   * @private
   */
  _folderToPath(folder) {
    // Handle Windows drive letter (C- -> C:)
    const withDrive = folder.replace(/^([A-Z])-/, '$1:');

    // Split by dashes
    const parts = withDrive.split('-').filter(p => p);

    // Recursively find the valid path
    const findPath = (base, remaining) => {
      if (remaining.length === 0) return base;

      // Try each possible split point
      for (let i = remaining.length; i >= 1; i--) {
        // Join first i parts with dashes (potential folder name with dashes)
        const segment = remaining.slice(0, i).join('-');
        const testPath = base + path.sep + segment;

        // Check if this path exists
        if (fs.existsSync(testPath) && fs.statSync(testPath).isDirectory()) {
          // Found valid path, continue with remaining parts
          const result = findPath(testPath, remaining.slice(i));
          if (result) return result;
        }
      }

      // No valid path found - return the simple concatenation as fallback
      return base + path.sep + remaining.join(path.sep);
    };

    // Start with drive letter
    return findPath(parts[0], parts.slice(1));
  }

  /**
   * Start watching all project directories
   * @private
   */
  _startWatching() {
    // On Windows, watching with ** glob patterns can be unreliable
    // Instead, watch each project directory explicitly
    const watchPaths = [];

    try {
      const entries = fs.readdirSync(this.claudeProjectsPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          watchPaths.push(path.join(this.claudeProjectsPath, entry.name, '*.jsonl'));
        }
      }
    } catch (error) {
      console.error('[GlobalContextTracker] Error reading projects directory:', error);
    }

    console.log('[GlobalContextTracker] Watching', watchPaths.length, 'project directories');

    this.watcher = chokidar.watch(watchPaths, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      },
      // Use polling on Windows for reliability
      usePolling: process.platform === 'win32',
      interval: 500,
      depth: 0
    });

    this.watcher.on('change', async (filepath) => {
      console.log(`[GlobalContextTracker] File changed: ${path.basename(filepath)}`);
      await this._handleFileChange(filepath);
    });

    this.watcher.on('add', async (filepath) => {
      console.log(`[GlobalContextTracker] File added: ${path.basename(filepath)}`);
      await this._handleNewFile(filepath);
    });

    // Debug: log all raw events
    this.watcher.on('raw', (event, filepath, details) => {
      if (filepath && filepath.endsWith('.jsonl')) {
        console.log(`[GlobalContextTracker] Raw event: ${event} - ${path.basename(filepath)}`);
      }
    });

    this.watcher.on('error', (error) => {
      console.error('[GlobalContextTracker] Watcher error:', error);
      this.emit('error', error);
    });

    this.watcher.on('ready', () => {
      console.log('[GlobalContextTracker] Watcher ready');
      this.emit('watcher:ready');
    });
  }

  /**
   * Handle file change (new content)
   * @private
   */
  async _handleFileChange(filepath) {
    try {
      const stats = fs.statSync(filepath);
      const lastPosition = this.filePositions.get(filepath) || 0;

      if (stats.size > lastPosition) {
        // Read new content
        const newContent = await this._readNewLines(filepath, lastPosition, stats.size);
        this.filePositions.set(filepath, stats.size);

        // Parse and process
        await this._processNewEntries(filepath, newContent);
      }

    } catch (error) {
      console.error('[GlobalContextTracker] Error handling file change:', error);
    }
  }

  /**
   * Handle new file (new session)
   * @private
   */
  async _handleNewFile(filepath) {
    const projectFolder = path.basename(path.dirname(filepath));
    const sessionId = path.basename(filepath, '.jsonl');

    console.log(`[GlobalContextTracker] New session: ${sessionId} in ${projectFolder}`);

    // Ensure project exists
    if (!this.projects.has(projectFolder)) {
      const projectPath = path.dirname(filepath);
      await this._initializeProject(projectFolder, projectPath);
    }

    const project = this.projects.get(projectFolder);

    // Add new session
    project.sessions.set(sessionId, {
      id: sessionId,
      filepath,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      messageCount: 0,
      model: null,
      lastUpdate: Date.now()
    });

    project.currentSessionId = sessionId;
    project.status = 'active';

    // Reset checkpoint triggers for new session
    project.checkpointState = {
      warningTriggered: false,
      criticalTriggered: false,
      emergencyTriggered: false
    };

    // Start from beginning for new files
    this.filePositions.set(filepath, 0);

    this.emit('session:new', {
      projectFolder,
      projectName: project.name,
      sessionId
    });
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
    const projectFolder = path.basename(path.dirname(filepath));
    const sessionId = path.basename(filepath, '.jsonl');

    const project = this.projects.get(projectFolder);
    if (!project) return;

    const session = project.sessions.get(sessionId);
    if (!session) return;

    const lines = content.split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        if (entry.message?.usage) {
          const usage = entry.message.usage;
          const model = entry.message.model;

          // Update cumulative session tokens (for cost tracking)
          session.inputTokens += usage.input_tokens || 0;
          session.outputTokens += usage.output_tokens || 0;
          session.cacheCreationTokens += usage.cache_creation_input_tokens || 0;
          session.cacheReadTokens += usage.cache_read_input_tokens || 0;
          session.messageCount++;
          session.model = model || session.model;
          session.lastUpdate = Date.now();
          // IMPORTANT: Store latest usage for context window calculation
          session.latestUsage = usage;

          // Update project metrics
          this._updateProjectMetrics(project, session);

          // Check thresholds
          await this._checkThresholds(project);

          // Update account totals
          this._updateAccountTotals();

          // Emit update
          this.emit('usage:update', {
            projectFolder,
            projectName: project.name,
            sessionId,
            usage,
            metrics: project.metrics,
            accountTotals: this.accountTotals
          });
        }

      } catch (error) {
        // Skip malformed lines
      }
    }
  }

  /**
   * Update project metrics from session data
   * @private
   *
   * IMPORTANT: Context window is calculated from the LATEST API response,
   * not cumulative totals. The latest usage entry reflects the current
   * conversation size including all cached/uncached input tokens.
   */
  _updateProjectMetrics(project, session) {
    const now = Date.now();

    // Calculate totals across all sessions for this project (for cost tracking)
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheCreate = 0;
    let totalCacheRead = 0;
    let totalMessages = 0;

    for (const sess of project.sessions.values()) {
      totalInput += sess.inputTokens;
      totalOutput += sess.outputTokens;
      totalCacheCreate += sess.cacheCreationTokens;
      totalCacheRead += sess.cacheReadTokens;
      totalMessages += sess.messageCount;
    }

    // Context used = LATEST entry's total + system overhead (not cumulative!)
    // The latest usage shows the current conversation context size
    // FIX: Use the passed session (the one being updated), not currentSessionId
    // This ensures context% updates when any session receives new data
    const currentSession = session;

    // Update currentSessionId to track the active session
    if (session && session.id) {
      project.currentSessionId = session.id;
    }

    // Store previous context for velocity calculation
    const previousContextUsed = project.metrics?.contextUsed || 0;
    const previousUpdate = project.metrics?.lastUpdate || now;

    let contextUsed = 0;
    let messageTokens = 0;
    let latestUsage = null;

    if (currentSession && currentSession.latestUsage) {
      const usage = currentSession.latestUsage;
      messageTokens = (usage.input_tokens || 0) +
                      (usage.cache_read_input_tokens || 0) +
                      (usage.cache_creation_input_tokens || 0) +
                      (usage.output_tokens || 0);
      // Add system overhead (system prompt, tools, memory files, autocompact buffer)
      contextUsed = messageTokens + this.systemOverhead;
      latestUsage = {
        input: usage.input_tokens || 0,
        cacheRead: usage.cache_read_input_tokens || 0,
        cacheCreation: usage.cache_creation_input_tokens || 0,
        output: usage.output_tokens || 0,
        messageTokens: messageTokens,
        systemOverhead: this.systemOverhead
      };
    }

    // Calculate velocity (tokens per second)
    let velocity = project.metrics?.velocity || 0;
    const timeDelta = (now - previousUpdate) / 1000; // seconds

    if (timeDelta > 0 && previousContextUsed > 0) {
      const tokenDelta = contextUsed - previousContextUsed;
      // Only calculate positive velocity (context growth)
      if (tokenDelta > 0) {
        const instantVelocity = tokenDelta / timeDelta;
        // Smooth velocity with exponential moving average (alpha = 0.3)
        velocity = velocity === 0 ? instantVelocity : velocity * 0.7 + instantVelocity * 0.3;
      }
    }

    // Compaction detection: Check for sudden drop in tokens
    // Claude Code auto-compacts around 77-80%, causing a significant token drop
    if (!project.compactionState) {
      project.compactionState = {
        lastKnownTokens: 0,
        compactionDetected: false,
        compactionCount: 0,
        lastCompactionTime: null
      };
    }

    if (project.compactionState.lastKnownTokens > 0 && contextUsed > 0) {
      const tokenDrop = project.compactionState.lastKnownTokens - contextUsed;
      const dropPercent = tokenDrop / project.compactionState.lastKnownTokens;

      // If tokens dropped by more than 20% and previous was > 50k, compaction likely occurred
      if (dropPercent > 0.20 && project.compactionState.lastKnownTokens > 50000) {
        this._handleCompactionDetected(project, tokenDrop, dropPercent);
      }
    }

    // Update last known tokens for next comparison
    if (contextUsed > 0) {
      project.compactionState.lastKnownTokens = contextUsed;
    }

    // Initialize velocity history if needed
    if (!project.velocityHistory) {
      project.velocityHistory = [];
    }

    // Track velocity history (keep last 10 samples)
    if (contextUsed > 0) {
      project.velocityHistory.push({
        timestamp: now,
        tokens: contextUsed,
        velocity
      });
      if (project.velocityHistory.length > 10) {
        project.velocityHistory.shift();
      }
    }

    project.metrics = {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheCreationTokens: totalCacheCreate,
      cacheReadTokens: totalCacheRead,
      contextUsed,
      contextPercent: (contextUsed / this.contextWindowSize) * 100,
      messageCount: totalMessages,
      cost: this._calculateCost(totalInput, totalOutput, totalCacheCreate, totalCacheRead, session.model),
      model: session.model,
      lastUpdate: now,
      latestUsage,
      // Velocity tracking (merged from RealTimeContextTracker)
      velocity,
      tokensPerSecond: velocity
    };

    project.status = 'active';

    // Emit velocity update if velocity changed significantly
    if (velocity > 0) {
      this.emit('velocity:update', {
        projectFolder: project.folder,
        projectName: project.name,
        sessionId: project.currentSessionId,
        velocity,
        tokensPerSecond: velocity
      });
    }
  }

  /**
   * Calculate cost based on token usage
   * @private
   */
  _calculateCost(input, output, cacheCreate, cacheRead, model) {
    const pricing = PRICING[model] || PRICING.default;

    const inputCost = (input / 1_000_000) * pricing.input;
    const outputCost = (output / 1_000_000) * pricing.output;
    const cacheWriteCost = (cacheCreate / 1_000_000) * pricing.cacheWrite;
    const cacheReadCost = (cacheRead / 1_000_000) * pricing.cacheRead;

    return inputCost + outputCost + cacheWriteCost + cacheReadCost;
  }

  /**
   * Check thresholds and trigger alerts
   * @private
   */
  async _checkThresholds(project) {
    const utilization = project.metrics.contextUsed / this.contextWindowSize;

    if (utilization >= this.thresholds.emergency && !project.checkpointState.emergencyTriggered) {
      project.checkpointState.emergencyTriggered = true;
      this._triggerAlert(project, 'emergency', utilization);
    }
    else if (utilization >= this.thresholds.critical && !project.checkpointState.criticalTriggered) {
      project.checkpointState.criticalTriggered = true;
      this._triggerAlert(project, 'critical', utilization);
    }
    else if (utilization >= this.thresholds.warning && !project.checkpointState.warningTriggered) {
      project.checkpointState.warningTriggered = true;
      this._triggerAlert(project, 'warning', utilization);
    }
  }

  /**
   * Trigger an alert for a project
   * @private
   */
  _triggerAlert(project, level, utilization) {
    const alertData = {
      level,
      projectFolder: project.folder,
      projectName: project.name,
      projectPath: project.path,
      utilization,
      contextUsed: project.metrics.contextUsed,
      contextWindow: this.contextWindowSize,
      timestamp: new Date().toISOString()
    };

    console.log(`\n[ALERT] ${level.toUpperCase()}: ${project.name} at ${(utilization * 100).toFixed(1)}%\n`);

    this.emit(`alert:${level}`, alertData);
    this.emit('alert', alertData);
  }

  /**
   * Update account-level totals
   * @private
   */
  _updateAccountTotals() {
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheCreate = 0;
    let totalCacheRead = 0;
    let totalCost = 0;
    let sessionCount = 0;
    let activeProjects = 0;

    for (const project of this.projects.values()) {
      totalInput += project.metrics.inputTokens;
      totalOutput += project.metrics.outputTokens;
      totalCacheCreate += project.metrics.cacheCreationTokens;
      totalCacheRead += project.metrics.cacheReadTokens;
      totalCost += project.metrics.cost;
      sessionCount += project.sessions.size;

      if (project.status === 'active') {
        activeProjects++;
      }
    }

    this.accountTotals = {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCacheCreationTokens: totalCacheCreate,
      totalCacheReadTokens: totalCacheRead,
      totalCost,
      sessionCount,
      activeProjects,
      projectCount: this.projects.size
    };
  }

  /**
   * Get all projects data
   */
  getAllProjects() {
    const projects = [];

    for (const [folder, project] of this.projects) {
      projects.push({
        folder,
        name: project.name,
        path: project.path,
        status: project.status,
        currentSessionId: project.currentSessionId,
        sessionCount: project.sessions.size,
        // Show today's CLI sessions (exclude agent-* sessions), sorted by recency
        sessions: Array.from(project.sessions.values())
          .filter(s => {
            // Exclude agent sessions (subagent tasks)
            if (s.id.startsWith('agent-')) return false;
            // Must have activity today (based on file mtime)
            const todayStart = new Date().setHours(0, 0, 0, 0);
            return s.lastUpdate && s.lastUpdate > todayStart;
          })
          .sort((a, b) => (b.lastUpdate || 0) - (a.lastUpdate || 0))
          .slice(0, 5)  // Max 5 CLI sessions per project
          .map(s => ({
            id: s.id,
            inputTokens: s.inputTokens,
            outputTokens: s.outputTokens,
            cacheCreationTokens: s.cacheCreationTokens,
            cacheReadTokens: s.cacheReadTokens,
            messageCount: s.messageCount,
            lastUpdate: s.lastUpdate,
            isActive: s.id === project.currentSessionId,
            // Per-session context tracking
            contextUsed: s.contextUsed || 0,
            contextPercent: s.contextPercent || 0,
            cost: s.cost || 0,
            model: s.model || null
          })),
        metrics: { ...project.metrics },
        checkpointState: { ...project.checkpointState },
        safetyStatus: this._getSafetyStatus(project)
      });
    }

    // Sort by last update (most recent first)
    projects.sort((a, b) => (b.metrics.lastUpdate || 0) - (a.metrics.lastUpdate || 0));

    return projects;
  }

  /**
   * Get account totals
   */
  getAccountTotals() {
    return { ...this.accountTotals };
  }

  /**
   * Get safety status for a project
   * @private
   */
  _getSafetyStatus(project) {
    const utilization = project.metrics.contextUsed / this.contextWindowSize;

    if (utilization >= this.thresholds.emergency) return 'EMERGENCY';
    if (utilization >= this.thresholds.critical) return 'CRITICAL';
    if (utilization >= this.thresholds.warning) return 'WARNING';
    return 'OK';
  }

  /**
   * Get a specific project's data
   */
  getProject(projectFolder) {
    const project = this.projects.get(projectFolder);
    if (!project) return null;

    return {
      folder: project.folder,
      name: project.name,
      path: project.path,
      status: project.status,
      currentSessionId: project.currentSessionId,
      sessions: Array.from(project.sessions.values()),
      metrics: { ...project.metrics },
      checkpointState: { ...project.checkpointState },
      safetyStatus: this._getSafetyStatus(project)
    };
  }

  /**
   * Reset checkpoint triggers for a project
   */
  resetProjectCheckpoints(projectFolder) {
    const project = this.projects.get(projectFolder);
    if (project) {
      project.checkpointState = {
        warningTriggered: false,
        criticalTriggered: false,
        emergencyTriggered: false
      };
      console.log(`[GlobalContextTracker] Reset checkpoints for ${project.name}`);
    }
  }

  // ============================================================================
  // Compaction Detection Methods (merged from RealTimeContextTracker)
  // ============================================================================

  /**
   * Handle compaction detection - trigger recovery
   * @private
   */
  _handleCompactionDetected(project, tokenDrop, dropPercent) {
    console.log(`\n[GlobalContextTracker] COMPACTION DETECTED for ${project.name}!`);
    console.log(`  Token drop: ${tokenDrop.toLocaleString()} (${(dropPercent * 100).toFixed(1)}%)`);
    console.log(`  Previous: ${project.compactionState.lastKnownTokens.toLocaleString()}`);
    console.log(`  Current: ${(project.compactionState.lastKnownTokens - tokenDrop).toLocaleString()}\n`);

    project.compactionState.compactionDetected = true;
    project.compactionState.compactionCount++;
    project.compactionState.lastCompactionTime = Date.now();

    // Reset checkpoint triggers since context was cleared
    project.checkpointState = {
      warningTriggered: false,
      criticalTriggered: false,
      emergencyTriggered: false
    };

    // Generate recovery data
    const recoveryData = {
      timestamp: new Date().toISOString(),
      projectFolder: project.folder,
      projectName: project.name,
      tokenDrop,
      dropPercent,
      previousTokens: project.compactionState.lastKnownTokens,
      currentTokens: project.compactionState.lastKnownTokens - tokenDrop,
      compactionCount: project.compactionState.compactionCount,
      recoveryAction: 'session-init',
      devDocsFiles: [
        'PROJECT_SUMMARY.md',
        '.claude/dev-docs/plan.md',
        '.claude/dev-docs/tasks.json'
      ],
      recoveryCommand: '/session-init',
      recoveryInstructions: `
COMPACTION DETECTED - Context was automatically cleared by Claude Code.

To restore context efficiently (~1,500 tokens), run:
  /session-init

Or manually read these 3 files:
  1. PROJECT_SUMMARY.md - Project state and history
  2. .claude/dev-docs/plan.md - Current task breakdown
  3. .claude/dev-docs/tasks.json - Active task list

The dev-docs 3-file pattern preserves all critical context.
      `.trim()
    };

    // Emit compaction event
    this.emit('compaction:detected', recoveryData);

    // Call registered compaction handlers
    if (this._compactionHandlers) {
      for (const handler of this._compactionHandlers) {
        try {
          handler(recoveryData);
        } catch (err) {
          console.error('[GlobalContextTracker] Compaction handler error:', err);
        }
      }
    }

    return recoveryData;
  }

  /**
   * Register a callback for compaction detection
   *
   * @param {Function} callback - Function to call when compaction is detected
   * @returns {Function} Unsubscribe function
   */
  onCompactionDetected(callback) {
    if (!this._compactionHandlers) {
      this._compactionHandlers = [];
    }
    this._compactionHandlers.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this._compactionHandlers.indexOf(callback);
      if (index > -1) {
        this._compactionHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Generate recovery documentation for a project after compaction
   *
   * @param {string} projectFolder - Project folder name
   * @returns {Object} Recovery documentation object
   */
  generateRecoveryDocs(projectFolder) {
    const project = this.projects.get(projectFolder);
    if (!project) return null;

    return {
      projectFolder: project.folder,
      projectName: project.name,
      projectPath: project.path,
      compactionState: { ...project.compactionState },
      recoveryFiles: [
        'PROJECT_SUMMARY.md',
        '.claude/dev-docs/plan.md',
        '.claude/dev-docs/tasks.json'
      ],
      recoveryCommand: '/session-init',
      lastMetrics: { ...project.metrics },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get compaction state for a project
   *
   * @param {string} projectFolder - Project folder name
   * @returns {Object|null} Compaction state or null if project not found
   */
  getCompactionState(projectFolder) {
    const project = this.projects.get(projectFolder);
    if (!project) return null;

    return {
      ...project.compactionState,
      projectFolder: project.folder,
      projectName: project.name
    };
  }

  // ============================================================================
  // Velocity & Exhaustion Prediction Methods (merged from RealTimeContextTracker)
  // ============================================================================

  /**
   * Get token velocity for a project (tokens per second)
   *
   * @param {string} projectFolder - Project folder name
   * @returns {number} Tokens per second (smoothed average)
   */
  getVelocity(projectFolder) {
    const project = this.projects.get(projectFolder);
    if (!project) return 0;

    // Return stored velocity from metrics
    if (project.metrics?.velocity) {
      return project.metrics.velocity;
    }

    // Calculate from velocity history if available
    if (project.velocityHistory?.length >= 2) {
      const history = project.velocityHistory;
      const first = history[0];
      const last = history[history.length - 1];
      const timeDelta = (last.timestamp - first.timestamp) / 1000;
      const tokenDelta = last.tokens - first.tokens;

      if (timeDelta > 0 && tokenDelta > 0) {
        return tokenDelta / timeDelta;
      }
    }

    return 0;
  }

  /**
   * Get predicted time to context exhaustion for a project
   *
   * @param {string} projectFolder - Project folder name
   * @returns {number} Minutes until context window is exhausted (Infinity if velocity <= 0)
   */
  getPredictedExhaustion(projectFolder) {
    const project = this.projects.get(projectFolder);
    if (!project) return Infinity;

    const velocity = this.getVelocity(projectFolder);
    if (velocity <= 0) return Infinity;

    const contextUsed = project.metrics?.contextUsed || 0;
    const remainingTokens = this.contextWindowSize - contextUsed;

    if (remainingTokens <= 0) return 0;

    const secondsRemaining = remainingTokens / velocity;
    const minutesRemaining = secondsRemaining / 60;

    // Emit exhaustion:imminent event if < 5 minutes remaining
    if (minutesRemaining < 5 && minutesRemaining > 0) {
      // Only emit if not already emitted recently (within 1 minute)
      const lastEmit = project._lastExhaustionWarning || 0;
      if (Date.now() - lastEmit > 60000) {
        project._lastExhaustionWarning = Date.now();
        this.emit('exhaustion:imminent', {
          projectFolder: project.folder,
          projectName: project.name,
          sessionId: project.currentSessionId,
          minutesRemaining,
          contextUsed,
          contextWindow: this.contextWindowSize,
          velocity
        });
      }
    }

    return minutesRemaining;
  }

  /**
   * Get exhaustion prediction details for a project
   *
   * @param {string} projectFolder - Project folder name
   * @returns {Object} Exhaustion prediction details
   */
  getExhaustionDetails(projectFolder) {
    const project = this.projects.get(projectFolder);
    if (!project) return null;

    const velocity = this.getVelocity(projectFolder);
    const contextUsed = project.metrics?.contextUsed || 0;
    const remainingTokens = this.contextWindowSize - contextUsed;
    const minutesRemaining = this.getPredictedExhaustion(projectFolder);

    // Calculate when auto-compact will trigger (around 77.5%)
    const autoCompactThreshold = this.contextWindowSize * 0.775;
    const tokensToAutoCompact = autoCompactThreshold - contextUsed;
    const minutesToAutoCompact = velocity > 0 ? (tokensToAutoCompact / velocity) / 60 : Infinity;

    return {
      projectFolder: project.folder,
      projectName: project.name,
      contextUsed,
      contextWindow: this.contextWindowSize,
      contextPercent: project.metrics?.contextPercent || 0,
      remainingTokens,
      velocity,
      tokensPerSecond: velocity,
      minutesRemaining,
      minutesToAutoCompact: minutesToAutoCompact > 0 ? minutesToAutoCompact : 0,
      status: this._getExhaustionStatus(minutesRemaining),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get exhaustion status label
   * @private
   */
  _getExhaustionStatus(minutesRemaining) {
    if (minutesRemaining === Infinity) return 'STABLE';
    if (minutesRemaining <= 0) return 'EXHAUSTED';
    if (minutesRemaining < 2) return 'CRITICAL';
    if (minutesRemaining < 5) return 'WARNING';
    if (minutesRemaining < 15) return 'CAUTION';
    return 'OK';
  }

  // ============================================================================
  // OTLP Processing Methods (merged from RealContextTracker)
  // ============================================================================

  /**
   * Process an OTLP metric and update the appropriate session
   *
   * @param {Object} metric - OTLP metric object
   * @param {string} metric.name - Metric name (e.g., 'claude_code.tokens.count')
   * @param {Object} metric.attributes - Metric attributes including session info
   * @param {number} [metric.value] - Metric value
   * @param {number} [metric.asInt] - Metric value as integer
   * @param {string} [projectFolder] - Optional project folder to scope the update
   * @returns {number} Current context percentage for the session
   */
  processOTLPMetric(metric, projectFolder = null) {
    // Extract session ID from metric attributes - skip if none provided
    const sessionId = metric.attributes?.['conversation.id'] ||
                     metric.attributes?.['session.id'] ||
                     metric.attributes?.session_id;

    // Ignore metrics without a valid session ID
    if (!sessionId) {
      return 0;
    }

    // Resolve project folder if not provided
    const resolvedProjectFolder = projectFolder || this._resolveProjectFolder(sessionId);

    if (!resolvedProjectFolder) {
      console.warn('[GlobalContextTracker] Could not resolve project folder for OTLP metric', {
        sessionId,
        metricName: metric.name
      });
      return 0;
    }

    // Ensure project exists
    let project = this.projects.get(resolvedProjectFolder);
    if (!project) {
      // Create minimal project entry for OTLP-only tracking
      project = {
        folder: resolvedProjectFolder,
        path: this._folderToPath(resolvedProjectFolder),
        name: path.basename(this._folderToPath(resolvedProjectFolder)),
        sessions: new Map(),
        currentSessionId: sessionId,
        metrics: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          contextUsed: 0,
          contextPercent: 0,
          messageCount: 0,
          cost: 0,
          model: null,
          lastUpdate: null
        },
        checkpointState: {
          warningTriggered: false,
          criticalTriggered: false,
          emergencyTriggered: false
        },
        status: 'active'
      };
      this.projects.set(resolvedProjectFolder, project);
    }

    // Ensure session exists within project
    let session = project.sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        filepath: null, // OTLP sessions may not have file
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        messageCount: 0,
        model: metric.attributes?.['model'] || metric.attributes?.model || null,
        lastUpdate: Date.now(),
        latestUsage: null,
        contextUsed: 0,
        contextPercent: 0,
        cost: 0
      };
      project.sessions.set(sessionId, session);
      project.currentSessionId = sessionId;

      this.emit('session:new', {
        projectFolder: resolvedProjectFolder,
        projectName: project.name,
        sessionId,
        source: 'otlp'
      });
    }

    // Process token metrics based on metric name
    if (metric.name?.includes('token') || metric.name?.includes('usage')) {
      const type = metric.attributes?.['type'] || metric.attributes?.type;
      const value = metric.value || metric.asInt || 0;

      // Update session tokens based on metric type
      switch (type) {
        case 'input':
          session.inputTokens += value;
          break;
        case 'output':
          session.outputTokens += value;
          break;
        case 'cache_read':
          session.cacheReadTokens += value;
          break;
        case 'cache_creation':
          session.cacheCreationTokens += value;
          break;
        default:
          // If type not specified, try to parse from metric name
          if (metric.name?.includes('input')) {
            session.inputTokens += value;
          } else if (metric.name?.includes('output')) {
            session.outputTokens += value;
          } else if (metric.name?.includes('cache_read')) {
            session.cacheReadTokens += value;
          } else if (metric.name?.includes('cache_creation')) {
            session.cacheCreationTokens += value;
          }
      }

      session.messageCount++;
      session.lastUpdate = Date.now();

      // Update latest usage for context window calculation
      session.latestUsage = {
        input_tokens: session.inputTokens,
        output_tokens: session.outputTokens,
        cache_read_input_tokens: session.cacheReadTokens,
        cache_creation_input_tokens: session.cacheCreationTokens
      };

      // Update project metrics
      this._updateProjectMetrics(project, session);

      // Check thresholds
      this._checkThresholds(project);

      // Update account totals
      this._updateAccountTotals();

      // Emit update event
      this.emit('usage:update', {
        projectFolder: resolvedProjectFolder,
        projectName: project.name,
        sessionId,
        source: 'otlp',
        metrics: project.metrics,
        accountTotals: this.accountTotals
      });
    }

    return this.getContextPercentage(resolvedProjectFolder, sessionId);
  }

  /**
   * Resolve project folder from session ID
   * Searches all projects for the session
   * @private
   */
  _resolveProjectFolder(sessionId) {
    // First, check if any project has this session
    for (const [folder, project] of this.projects) {
      if (project.sessions.has(sessionId)) {
        return folder;
      }
    }

    // If not found, try to find the most recently active project
    let mostRecentFolder = null;
    let mostRecentTime = 0;

    for (const [folder, project] of this.projects) {
      if (project.metrics.lastUpdate && project.metrics.lastUpdate > mostRecentTime) {
        mostRecentTime = project.metrics.lastUpdate;
        mostRecentFolder = folder;
      }
    }

    return mostRecentFolder;
  }

  /**
   * Get context percentage for a specific session
   *
   * @param {string} projectFolder - Project folder name
   * @param {string} [sessionId] - Session ID (uses current if not specified)
   * @returns {number} Context percentage (0-100)
   */
  getContextPercentage(projectFolder, sessionId = null) {
    const project = this.projects.get(projectFolder);
    if (!project) return 0;

    const targetSessionId = sessionId || project.currentSessionId;
    const session = project.sessions.get(targetSessionId);

    if (!session) return 0;

    // Return session-level context percentage if available
    if (session.contextPercent !== undefined) {
      return session.contextPercent;
    }

    // Fall back to project-level
    return project.metrics.contextPercent || 0;
  }

  /**
   * Manually update context percentage for testing
   *
   * @param {string} projectFolder - Project folder name
   * @param {string} sessionId - Session ID
   * @param {number} percentage - Target context percentage (0-100)
   */
  manualUpdate(projectFolder, sessionId, percentage) {
    let project = this.projects.get(projectFolder);

    if (!project) {
      // Create project for testing
      project = {
        folder: projectFolder,
        path: this._folderToPath(projectFolder),
        name: path.basename(this._folderToPath(projectFolder)),
        sessions: new Map(),
        currentSessionId: sessionId,
        metrics: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          contextUsed: 0,
          contextPercent: 0,
          messageCount: 0,
          cost: 0,
          model: null,
          lastUpdate: null
        },
        checkpointState: {
          warningTriggered: false,
          criticalTriggered: false,
          emergencyTriggered: false
        },
        status: 'active'
      };
      this.projects.set(projectFolder, project);
    }

    // Calculate tokens from percentage
    const contextUsed = Math.floor(this.contextWindowSize * (percentage / 100));

    // Update or create session
    let session = project.sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        filepath: null,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        messageCount: 0,
        model: null,
        lastUpdate: Date.now()
      };
      project.sessions.set(sessionId, session);
    }

    // Set context values
    session.contextUsed = contextUsed;
    session.contextPercent = percentage;
    session.lastUpdate = Date.now();

    // Update project metrics
    project.metrics.contextUsed = contextUsed;
    project.metrics.contextPercent = percentage;
    project.metrics.lastUpdate = Date.now();
    project.currentSessionId = sessionId;
    project.status = 'active';

    console.log(`[GlobalContextTracker] Manual update: ${projectFolder}/${sessionId} -> ${percentage.toFixed(1)}%`);

    // Check thresholds
    this._checkThresholds(project);

    // Emit update
    this.emit('usage:update', {
      projectFolder,
      projectName: project.name,
      sessionId,
      source: 'manual',
      metrics: project.metrics
    });
  }

  /**
   * Get all active sessions for a project (or all projects)
   *
   * @param {string} [projectFolder] - Optional project folder to filter
   * @returns {Array} Array of session objects with context data
   */
  getActiveSessions(projectFolder = null) {
    const sessions = [];
    const fiveMinutesAgo = Date.now() - 300000;

    const projectsToCheck = projectFolder
      ? [this.projects.get(projectFolder)].filter(Boolean)
      : Array.from(this.projects.values());

    for (const project of projectsToCheck) {
      for (const [sessionId, session] of project.sessions) {
        // Skip agent sessions
        if (sessionId.startsWith('agent-')) continue;

        // Check if session is active (updated within last 5 minutes)
        const isActive = session.lastUpdate && session.lastUpdate > fiveMinutesAgo;

        sessions.push({
          id: sessionId,
          projectFolder: project.folder,
          projectName: project.name,
          isActive,
          isCurrent: sessionId === project.currentSessionId,
          percentage: session.contextPercent || 0,
          contextUsed: session.contextUsed || 0,
          totalTokens: (session.inputTokens || 0) + (session.outputTokens || 0),
          inputTokens: session.inputTokens || 0,
          outputTokens: session.outputTokens || 0,
          cacheReadTokens: session.cacheReadTokens || 0,
          cacheCreationTokens: session.cacheCreationTokens || 0,
          messageCount: session.messageCount || 0,
          model: session.model,
          cost: session.cost || 0,
          duration: session.lastUpdate ? Date.now() - (session.startTime || session.lastUpdate) : 0,
          lastUpdate: session.lastUpdate
        });
      }
    }

    // Sort by last update (most recent first)
    sessions.sort((a, b) => (b.lastUpdate || 0) - (a.lastUpdate || 0));

    return sessions;
  }
}

module.exports = GlobalContextTracker;
