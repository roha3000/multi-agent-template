/**
 * Claude Code Usage Parser
 *
 * Parses Claude Code JSONL session files to extract token usage data
 * for tracking across all Claude Code projects.
 *
 * Features:
 * - Reads JSONL files from ~/.claude/projects/
 * - Extracts token usage from API responses
 * - Watches for new sessions in real-time
 * - Integrates with existing UsageTracker
 * - Per-project usage breakdown
 * - Handles malformed entries gracefully
 *
 * @module .claude/core/claude-code-usage-parser
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { createComponentLogger } = require('./logger');
const os = require('os');

class ClaudeCodeUsageParser {
  /**
   * Create a Claude Code usage parser
   *
   * @param {Object} options - Configuration options
   * @param {UsageTracker} options.usageTracker - Usage tracker instance
   * @param {string} [options.claudeProjectsPath] - Path to .claude/projects directory
   * @param {boolean} [options.watchFiles=true] - Enable file watching
   * @param {number} [options.scanIntervalMs=60000] - Scan interval (default: 1 minute)
   * @param {boolean} [options.trackHistorical=true] - Parse historical sessions on startup
   */
  constructor(options = {}) {
    this.logger = createComponentLogger('ClaudeCodeUsageParser');

    // Validate dependencies
    if (!options.usageTracker) {
      throw new Error('UsageTracker is required for ClaudeCodeUsageParser');
    }

    this.usageTracker = options.usageTracker;

    // Configuration
    this.claudeProjectsPath = options.claudeProjectsPath ||
      path.join(os.homedir(), '.claude', 'projects');

    this.watchFiles = options.watchFiles !== false;
    this.scanIntervalMs = options.scanIntervalMs || 60000; // 1 minute default
    this.trackHistorical = options.trackHistorical !== false;

    // State tracking
    this.processedFiles = new Set(); // Track which files we've already processed
    this.watchers = new Map(); // File watchers for active sessions
    this.scanTimer = null;
    this.isRunning = false;

    // Statistics
    this.stats = {
      filesProcessed: 0,
      entriesProcessed: 0,
      tokensTracked: 0,
      errors: 0,
      projectsDiscovered: 0
    };

    this.logger.info('ClaudeCodeUsageParser initialized', {
      claudeProjectsPath: this.claudeProjectsPath,
      watchFiles: this.watchFiles,
      scanIntervalMs: this.scanIntervalMs,
      trackHistorical: this.trackHistorical
    });
  }

  /**
   * Start the parser
   * - Scans for existing JSONL files
   * - Optionally parses historical data
   * - Sets up file watching
   */
  async start() {
    if (this.isRunning) {
      this.logger.warn('Parser already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting Claude Code usage parser');

    // Check if .claude/projects directory exists
    if (!fs.existsSync(this.claudeProjectsPath)) {
      this.logger.warn('Claude projects directory not found', {
        path: this.claudeProjectsPath
      });
      this.logger.info('Parser will wait for directory to be created');

      // Set up periodic check for directory creation
      this.scanTimer = setInterval(() => this._checkAndScan(), this.scanIntervalMs);
      return;
    }

    // Initial scan
    await this._scanProjects();

    // Set up periodic scanning
    if (this.watchFiles) {
      this.scanTimer = setInterval(() => this._scanProjects(), this.scanIntervalMs);
      this.logger.info('File watching enabled', { intervalMs: this.scanIntervalMs });
    }
  }

  /**
   * Stop the parser
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping Claude Code usage parser');

    // Stop scan timer
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }

    // Close all file watchers
    for (const [file, watcher] of this.watchers.entries()) {
      watcher.close();
      this.logger.debug('Closed watcher for file', { file });
    }
    this.watchers.clear();

    this.isRunning = false;
    this.logger.info('Parser stopped', this.stats);
  }

  /**
   * Check if directory exists and scan
   * @private
   */
  async _checkAndScan() {
    if (fs.existsSync(this.claudeProjectsPath)) {
      this.logger.info('Claude projects directory found, starting scan');
      await this._scanProjects();
    }
  }

  /**
   * Scan all projects for JSONL files
   * @private
   */
  async _scanProjects() {
    try {
      if (!fs.existsSync(this.claudeProjectsPath)) {
        return;
      }

      const projects = fs.readdirSync(this.claudeProjectsPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      this.logger.debug('Scanning projects', { count: projects.length });

      for (const project of projects) {
        await this._scanProject(project);
      }

    } catch (error) {
      this.logger.error('Error scanning projects', {
        error: error.message,
        stack: error.stack
      });
      this.stats.errors++;
    }
  }

  /**
   * Scan a single project for JSONL files
   * @private
   */
  async _scanProject(projectName) {
    const projectPath = path.join(this.claudeProjectsPath, projectName);

    try {
      const files = fs.readdirSync(projectPath)
        .filter(file => file.endsWith('.jsonl'));

      if (files.length === 0) {
        return;
      }

      this.logger.debug('Found JSONL files in project', {
        project: projectName,
        fileCount: files.length
      });

      this.stats.projectsDiscovered++;

      for (const file of files) {
        const filePath = path.join(projectPath, file);
        await this._processFile(filePath, projectName);
      }

    } catch (error) {
      this.logger.error('Error scanning project', {
        project: projectName,
        error: error.message
      });
      this.stats.errors++;
    }
  }

  /**
   * Process a JSONL file
   * @private
   */
  async _processFile(filePath, projectName) {
    // Skip if already processed (unless watching for updates)
    const fileKey = `${filePath}`;

    if (this.processedFiles.has(fileKey) && !this.trackHistorical) {
      return;
    }

    try {
      const stats = fs.statSync(filePath);

      // Skip empty files
      if (stats.size === 0) {
        return;
      }

      this.logger.debug('Processing JSONL file', {
        file: path.basename(filePath),
        project: projectName,
        size: stats.size
      });

      // Parse JSONL file
      const entries = await this._parseJSONL(filePath);

      // Extract usage data
      const usageData = this._extractUsage(entries, projectName, filePath);

      // Record with UsageTracker
      if (usageData.length > 0) {
        await this._recordUsage(usageData);
        this.stats.filesProcessed++;
        this.stats.entriesProcessed += entries.length;
      }

      // Mark as processed
      this.processedFiles.add(fileKey);

    } catch (error) {
      this.logger.error('Error processing file', {
        file: filePath,
        error: error.message,
        stack: error.stack
      });
      this.stats.errors++;
    }
  }

  /**
   * Parse JSONL file line by line
   * @private
   */
  async _parseJSONL(filePath) {
    const entries = [];

    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (!line.trim()) {
        continue; // Skip empty lines
      }

      try {
        const entry = JSON.parse(line);
        entries.push(entry);
      } catch (error) {
        this.logger.warn('Malformed JSONL entry, skipping', {
          file: path.basename(filePath),
          error: error.message
        });
        this.stats.errors++;
      }
    }

    return entries;
  }

  /**
   * Extract usage data from JSONL entries
   * @private
   */
  _extractUsage(entries, projectName, filePath) {
    const usageRecords = [];
    const sessionId = path.basename(filePath, '.jsonl');

    for (const entry of entries) {
      try {
        // Look for entries with message.usage data
        const message = entry.message;
        if (!message || !message.usage) {
          continue;
        }

        const usage = message.usage;
        const model = message.model || 'unknown';

        // Extract timestamp (could be in multiple places)
        const timestamp = entry.timestamp || message.timestamp || Date.now();

        // Create usage record
        const usageRecord = {
          orchestrationId: `claude-code-${sessionId}-${message.id || timestamp}`,
          model: model,
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          cacheCreationTokens: usage.cache_creation_input_tokens || 0,
          cacheReadTokens: usage.cache_read_input_tokens || 0,
          timestamp: new Date(timestamp),
          pattern: 'claude-code',
          metadata: {
            source: 'claude-code-jsonl',
            project: projectName,
            sessionId: sessionId,
            messageId: message.id,
            filePath: filePath
          }
        };

        usageRecords.push(usageRecord);
        this.stats.tokensTracked += (usageRecord.inputTokens + usageRecord.outputTokens);

      } catch (error) {
        this.logger.warn('Error extracting usage from entry', {
          error: error.message,
          entry: JSON.stringify(entry).substring(0, 100)
        });
        this.stats.errors++;
      }
    }

    return usageRecords;
  }

  /**
   * Record usage data with UsageTracker
   * @private
   */
  async _recordUsage(usageRecords) {
    for (const record of usageRecords) {
      try {
        await this.usageTracker.recordUsage(record);
        this.logger.debug('Recorded Claude Code usage', {
          project: record.metadata.project,
          model: record.model,
          tokens: record.inputTokens + record.outputTokens
        });
      } catch (error) {
        this.logger.error('Error recording usage', {
          error: error.message,
          orchestrationId: record.orchestrationId
        });
        this.stats.errors++;
      }
    }
  }

  /**
   * Get parser statistics
   */
  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      processedFilesCount: this.processedFiles.size,
      activeWatchers: this.watchers.size
    };
  }

  /**
   * Force rescan of all projects (ignores processed cache)
   */
  async rescan() {
    this.logger.info('Forcing full rescan');
    this.processedFiles.clear();
    await this._scanProjects();
  }

  /**
   * Get usage summary for Claude Code sessions
   */
  async getClaudeCodeSummary(period = 'day') {
    try {
      // Query UsageTracker for Claude Code pattern
      const summary = await this.usageTracker.getUsageSummary(period, {
        pattern: 'claude-code'
      });

      return summary;
    } catch (error) {
      this.logger.error('Error getting Claude Code summary', {
        error: error.message
      });
      return null;
    }
  }
}

module.exports = ClaudeCodeUsageParser;
