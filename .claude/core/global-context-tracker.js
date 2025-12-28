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
          // Only read and show context for ACTIVE sessions
          const currentSessionPath = path.join(projectPath, mostRecentFile);
          await this._readExistingSession(projectData, currentSessionPath);
        } else {
          // Inactive sessions show 0% context (session is closed)
          projectData.status = 'inactive';
          projectData.metrics.contextUsed = 0;
          projectData.metrics.contextPercent = 0;
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

      // Update session data with cumulative totals
      session.inputTokens = totalInput;
      session.outputTokens = totalOutput;
      session.cacheCreationTokens = totalCacheCreate;
      session.cacheReadTokens = totalCacheRead;
      session.messageCount = messageCount;
      session.model = model;
      // Store latest usage for context calculation
      session.latestUsage = latestUsage;

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

      projectData.metrics = {
        inputTokens: totalInput,
        outputTokens: totalOutput,
        cacheCreationTokens: totalCacheCreate,
        cacheReadTokens: totalCacheRead,
        contextUsed,
        contextPercent: (contextUsed / this.contextWindowSize) * 100,
        messageCount,
        cost: this._calculateCost(totalInput, totalOutput, totalCacheCreate, totalCacheRead, model),
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

      console.log(`[GlobalContextTracker] Loaded ${projectData.name}: ${projectData.metrics.contextPercent.toFixed(1)}% context (${contextUsed.toLocaleString()} tokens)`);

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
      lastUpdate: Date.now(),
      latestUsage
    };

    project.status = 'active';
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
        // Include only recent/active sessions (updated within last 2 hours)
        sessions: Array.from(project.sessions.values())
          .filter(s => {
            const isActive = s.id === project.currentSessionId;
            const recentThreshold = Date.now() - (2 * 60 * 60 * 1000); // 2 hours
            const isRecent = s.lastUpdate && s.lastUpdate > recentThreshold;
            return isActive || isRecent;
          })
          .map(s => ({
            id: s.id,
            inputTokens: s.inputTokens,
            outputTokens: s.outputTokens,
            cacheCreationTokens: s.cacheCreationTokens,
            cacheReadTokens: s.cacheReadTokens,
            messageCount: s.messageCount,
            lastUpdate: s.lastUpdate,
            isActive: s.id === project.currentSessionId
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
}

module.exports = GlobalContextTracker;
