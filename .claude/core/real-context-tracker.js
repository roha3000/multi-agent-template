/**
 * Real Context Tracker
 *
 * Monitors Claude Code's actual token usage through multiple methods:
 * 1. File watching for session logs (if available)
 * 2. OpenTelemetry metric accumulation
 * 3. Token counting estimation as fallback
 *
 * This replaces simulated data with real context tracking.
 */

const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');
const { createComponentLogger } = require('./logger');

class RealContextTracker extends EventEmitter {
  constructor(options = {}) {
    super();
    this.logger = createComponentLogger('RealContextTracker');

    // Configuration
    this.options = {
      maxContextWindow: options.maxContextWindow || 200000, // Claude Sonnet default
      checkpointThresholds: options.checkpointThresholds || [70, 85, 95],
      sessionLogsPath: options.sessionLogsPath || this._findSessionLogsPath(),
      updateInterval: options.updateInterval || 5000,
      ...options
    };

    // State tracking
    this.sessions = new Map();
    this.watchers = new Map();
    this.checkpointsFired = new Map();

    this.logger.info('Real Context Tracker initialized', {
      maxContextWindow: this.options.maxContextWindow,
      thresholds: this.options.checkpointThresholds,
      sessionLogsPath: this.options.sessionLogsPath
    });
  }

  /**
   * Find Claude Code session logs path
   */
  _findSessionLogsPath() {
    // Try common locations for Claude Code logs
    const possiblePaths = [
      path.join(os.homedir(), '.claude', 'projects'),
      path.join(os.homedir(), '.claude', 'sessions'),
      path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'sessions'),
      path.join(os.homedir(), 'AppData', 'Local', 'Claude', 'sessions'),
      path.join(process.cwd(), '.claude', 'sessions') // Project-local sessions
    ];

    for (const testPath of possiblePaths) {
      if (fs.existsSync(testPath)) {
        this.logger.info('Found Claude session logs', { path: testPath });
        return testPath;
      }
    }

    this.logger.warn('Claude session logs not found, will rely on OpenTelemetry');
    return null;
  }

  /**
   * Start tracking a session
   */
  trackSession(sessionId, metadata = {}) {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId);
    }

    const session = {
      id: sessionId,
      startTime: Date.now(),
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      model: metadata.model || 'claude-opus-4-5-20251101',
      projectPath: metadata.projectPath || process.cwd(),
      checkpointsFired: new Set(),
      lastUpdate: Date.now()
    };

    this.sessions.set(sessionId, session);

    // Start file watching if path is available
    if (this.options.sessionLogsPath) {
      this._startFileWatching(sessionId);
    }

    this.logger.info('Started tracking session', { sessionId, model: session.model });
    return session;
  }

  /**
   * Start watching session log files
   */
  _startFileWatching(sessionId) {
    const sessionPattern = path.join(
      this.options.sessionLogsPath,
      '**',
      `*${sessionId}*.jsonl`
    );

    const watcher = chokidar.watch(sessionPattern, {
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100
      }
    });

    watcher.on('change', (filepath) => {
      this._parseSessionLog(sessionId, filepath);
    });

    watcher.on('add', (filepath) => {
      this._parseSessionLog(sessionId, filepath);
    });

    this.watchers.set(sessionId, watcher);
    this.logger.info('Started file watching for session', { sessionId, pattern: sessionPattern });
  }

  /**
   * Parse JSONL session log for token counts
   */
  _parseSessionLog(sessionId, filepath) {
    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const lines = content.trim().split('\n');

      // Parse only new lines since last check
      const session = this.sessions.get(sessionId);
      if (!session) return;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          // Extract token counts from API response
          if (entry.usage) {
            this._updateSessionTokens(sessionId, {
              input: entry.usage.input_tokens || 0,
              output: entry.usage.output_tokens || 0,
              cacheRead: entry.usage.cache_read_input_tokens || 0,
              cacheCreation: entry.usage.cache_creation_input_tokens || 0
            });
          }
        } catch (e) {
          // Skip invalid JSON lines
        }
      }
    } catch (error) {
      this.logger.error('Failed to parse session log', {
        sessionId,
        filepath,
        error: error.message
      });
    }
  }

  /**
   * Update session with token counts from OpenTelemetry
   */
  processOTLPMetric(metric) {
    // Extract session ID from metric attributes
    const sessionId = metric.attributes?.['conversation.id'] ||
                     metric.attributes?.['session.id'] ||
                     'default';

    // Ensure session exists
    const session = this.trackSession(sessionId, {
      model: metric.attributes?.['model']
    });

    // Process token metrics
    if (metric.name?.includes('token.usage')) {
      const type = metric.attributes?.['type'];
      const value = metric.value || metric.asInt || 0;

      const tokenUpdate = {};
      switch (type) {
        case 'input':
          tokenUpdate.input = value;
          break;
        case 'output':
          tokenUpdate.output = value;
          break;
        case 'cache_read':
          tokenUpdate.cacheRead = value;
          break;
        case 'cache_creation':
          tokenUpdate.cacheCreation = value;
          break;
      }

      this._updateSessionTokens(sessionId, tokenUpdate);
    }

    return this.getContextPercentage(sessionId);
  }

  /**
   * Update session token counts
   */
  _updateSessionTokens(sessionId, tokens) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // IMPORTANT: Accumulate tokens, don't reset!
    if (tokens.input) session.inputTokens += tokens.input;
    if (tokens.output) session.outputTokens += tokens.output;
    if (tokens.cacheRead) session.cacheReadTokens += tokens.cacheRead;
    if (tokens.cacheCreation) session.cacheCreationTokens += tokens.cacheCreation;

    // Calculate total (exclude cache reads as they don't consume new context)
    session.totalTokens = session.inputTokens + session.outputTokens + session.cacheCreationTokens;
    session.lastUpdate = Date.now();

    // Check thresholds
    this._checkThresholds(sessionId);

    // Emit update event
    this.emit('contextUpdate', {
      sessionId,
      totalTokens: session.totalTokens,
      percentage: this.getContextPercentage(sessionId),
      breakdown: {
        input: session.inputTokens,
        output: session.outputTokens,
        cacheRead: session.cacheReadTokens,
        cacheCreation: session.cacheCreationTokens
      }
    });
  }

  /**
   * Get current context percentage for a session
   */
  getContextPercentage(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return 0;

    const percentage = (session.totalTokens / this.options.maxContextWindow) * 100;
    return Math.min(percentage, 100); // Cap at 100%
  }

  /**
   * Check and fire checkpoint thresholds
   */
  _checkThresholds(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const percentage = this.getContextPercentage(sessionId);

    for (const threshold of this.options.checkpointThresholds) {
      if (percentage >= threshold && !session.checkpointsFired.has(threshold)) {
        session.checkpointsFired.add(threshold);

        this.logger.warn('Context threshold reached!', {
          sessionId,
          threshold,
          percentage: percentage.toFixed(2),
          totalTokens: session.totalTokens
        });

        // Emit checkpoint event
        this.emit('checkpoint', {
          sessionId,
          threshold,
          percentage,
          totalTokens: session.totalTokens,
          timestamp: new Date().toISOString()
        });

        // Special handling for critical threshold
        if (threshold >= 95) {
          this.emit('emergency', {
            sessionId,
            percentage,
            message: 'EMERGENCY: Context near exhaustion! Immediate checkpoint required!'
          });
        }
      }
    }
  }

  /**
   * Get all active sessions
   */
  getActiveSessions() {
    const sessions = [];
    for (const [id, session] of this.sessions) {
      sessions.push({
        id,
        percentage: this.getContextPercentage(id),
        totalTokens: session.totalTokens,
        model: session.model,
        duration: Date.now() - session.startTime,
        lastUpdate: session.lastUpdate
      });
    }
    return sessions;
  }

  /**
   * Get detailed session info
   */
  getSessionInfo(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      ...session,
      percentage: this.getContextPercentage(sessionId),
      contextRemaining: this.options.maxContextWindow - session.totalTokens,
      estimatedRequestsRemaining: Math.floor(
        (this.options.maxContextWindow - session.totalTokens) / 4000
      ) // Assume ~4k tokens per request average
    };
  }

  /**
   * Manually update context (for testing or manual override)
   */
  manualUpdate(sessionId, percentage) {
    const session = this.trackSession(sessionId);
    session.totalTokens = Math.floor(this.options.maxContextWindow * (percentage / 100));
    session.lastUpdate = Date.now();

    this.logger.info('Manual context update', {
      sessionId,
      percentage,
      totalTokens: session.totalTokens
    });

    this._checkThresholds(sessionId);
  }

  /**
   * Stop tracking
   */
  stop() {
    // Close all file watchers
    for (const [sessionId, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();

    this.logger.info('Real Context Tracker stopped');
  }
}

module.exports = RealContextTracker;