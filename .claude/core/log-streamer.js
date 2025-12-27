/**
 * Log Streamer Service
 *
 * Provides real-time log streaming for autonomous orchestrator sessions.
 * Uses file watching for tail -f behavior and SSE for browser delivery.
 *
 * Features:
 * - Real-time file watching with chokidar
 * - Log level parsing (INFO, WARN, ERROR, DEBUG)
 * - SSE streaming to multiple clients
 * - Pause/resume support
 * - Historical log loading
 *
 * @module log-streamer
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { createComponentLogger } = require('./logger');

const log = createComponentLogger('LogStreamer');

/**
 * Parse log level from a log line.
 * Supports formats: [INFO], [WARN], [ERROR], [DEBUG]
 * @param {string} line - Log line to parse
 * @returns {string} Log level (INFO, WARN, ERROR, DEBUG, or UNKNOWN)
 */
function parseLogLevel(line) {
  // Common patterns for log levels
  const patterns = [
    /\[(INFO|WARN|WARNING|ERROR|ERR|DEBUG|TRACE)\]/i,
    /\b(INFO|WARN|WARNING|ERROR|ERR|DEBUG|TRACE)\b/i,
    /(info|warn|warning|error|err|debug|trace):/i
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      const level = match[1].toUpperCase();
      if (level === 'WARNING' || level === 'WARN') return 'WARN';
      if (level === 'ERR') return 'ERROR';
      if (level === 'TRACE') return 'DEBUG';
      return level;
    }
  }

  return 'INFO'; // Default to INFO
}

/**
 * Parse timestamp from a log line.
 * @param {string} line - Log line to parse
 * @returns {string|null} Parsed timestamp or null
 */
function parseTimestamp(line) {
  // Match common timestamp formats
  const patterns = [
    /^(\d{2}:\d{2}:\d{2})/,                           // HH:MM:SS
    /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/,     // ISO format
    /^\[(\d{2}:\d{2}:\d{2})\]/,                       // [HH:MM:SS]
    /^(\d{2}:\d{2}:\d{2}\.\d{3})/                     // HH:MM:SS.mmm
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Log Streamer for real-time log file streaming.
 * @extends EventEmitter
 */
class LogStreamer extends EventEmitter {
  constructor(options = {}) {
    super();

    this.logsDir = options.logsDir || path.join(process.cwd(), '.claude', 'logs');
    this.maxLines = options.maxLines || 1000;
    this.tailLines = options.tailLines || 100;

    // Active streams: sessionId -> { watcher, clients: Set, paused: boolean }
    this.streams = new Map();

    // Ensure logs directory exists
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }

    log.info('Log streamer initialized', { logsDir: this.logsDir });
  }

  /**
   * Get the log file path for a session.
   * @param {string|number} sessionId - Session identifier
   * @returns {string} Path to log file
   */
  getLogPath(sessionId) {
    return path.join(this.logsDir, `session-${sessionId}.log`);
  }

  /**
   * Get available log files.
   * @returns {Array} List of available session logs
   */
  getAvailableLogs() {
    try {
      const files = fs.readdirSync(this.logsDir);
      return files
        .filter(f => f.startsWith('session-') && f.endsWith('.log'))
        .map(f => {
          const sessionId = f.replace('session-', '').replace('.log', '');
          const filePath = path.join(this.logsDir, f);
          const stats = fs.statSync(filePath);
          return {
            sessionId,
            filename: f,
            size: stats.size,
            modified: stats.mtime.toISOString()
          };
        })
        .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    } catch (err) {
      log.error('Failed to list log files', { error: err.message });
      return [];
    }
  }

  /**
   * Read the last N lines of a log file.
   * @param {string|number} sessionId - Session identifier
   * @param {number} lines - Number of lines to read
   * @returns {Promise<Array>} Array of parsed log entries
   */
  async getHistoricalLogs(sessionId, options = {}) {
    const {
      lines = 100,
      offset = 0,
      before = null  // ISO timestamp - get logs before this time
    } = typeof options === 'number' ? { lines: options } : options;

    const logPath = this.getLogPath(sessionId);

    if (!fs.existsSync(logPath)) {
      return { entries: [], total: 0 };
    }

    return new Promise((resolve, reject) => {
      const allEntries = [];
      const rl = readline.createInterface({
        input: fs.createReadStream(logPath),
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        if (line.trim()) {
          const entry = this._parseLine(line);

          // Filter by before timestamp if provided
          if (before) {
            const beforeTime = new Date(before).getTime();
            const entryTime = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();
            if (entryTime > beforeTime) {
              return; // Skip entries after the 'before' time
            }
          }

          allEntries.push(entry);
        }
      });

      rl.on('close', () => {
        const total = allEntries.length;

        // Apply offset and limit (get last N entries, offset from end)
        const start = Math.max(0, total - lines - offset);
        const end = Math.max(0, total - offset);
        const entries = allEntries.slice(start, end);

        resolve({ entries, total, hasMore: start > 0 });
      });
      rl.on('error', reject);
    });
  }

  /**
   * Parse a log line into a structured entry.
   * @param {string} line - Raw log line
   * @returns {Object} Parsed log entry
   */
  _parseLine(line) {
    const level = parseLogLevel(line);
    const timestamp = parseTimestamp(line) || new Date().toISOString().split('T')[1].split('.')[0];

    return {
      line: line.trim(),
      level,
      timestamp,
      raw: line
    };
  }

  /**
   * Start streaming logs for a session.
   * @param {string|number} sessionId - Session identifier
   * @param {Object} res - Express response object for SSE
   * @returns {Object} Stream control object
   */
  startStream(sessionId, res) {
    const logPath = this.getLogPath(sessionId);
    const clientId = Date.now().toString(36) + Math.random().toString(36).substr(2);

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    // Initialize or get existing stream
    if (!this.streams.has(sessionId)) {
      this.streams.set(sessionId, {
        watcher: null,
        clients: new Set(),
        paused: false,
        lastPosition: 0
      });
    }

    const stream = this.streams.get(sessionId);
    stream.clients.add({ id: clientId, res });

    log.info('Client connected to log stream', { sessionId, clientId, totalClients: stream.clients.size });

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({
      sessionId,
      clientId,
      logPath,
      exists: fs.existsSync(logPath)
    })}\n\n`);

    // Send historical logs first
    this.getHistoricalLogs(sessionId, this.tailLines).then(entries => {
      if (entries.length > 0) {
        res.write(`event: history\ndata: ${JSON.stringify({ entries })}\n\n`);
      }

      // Start file watcher if not already running
      if (!stream.watcher && fs.existsSync(logPath)) {
        this._startWatcher(sessionId, logPath);
      }
    });

    // Return control object
    return {
      clientId,
      pause: () => this.pauseStream(sessionId),
      resume: () => this.resumeStream(sessionId),
      stop: () => this.removeClient(sessionId, clientId)
    };
  }

  /**
   * Start watching a log file for changes.
   * @param {string|number} sessionId - Session identifier
   * @param {string} logPath - Path to log file
   */
  _startWatcher(sessionId, logPath) {
    const stream = this.streams.get(sessionId);
    if (!stream) return;

    // Track file position
    const stats = fs.statSync(logPath);
    stream.lastPosition = stats.size;

    // Use polling for cross-platform compatibility
    const watcher = fs.watchFile(logPath, { interval: 500 }, (curr, prev) => {
      if (curr.size > prev.size && !stream.paused) {
        // File grew - read new content
        this._readNewContent(sessionId, logPath, prev.size, curr.size);
      }
    });

    stream.watcher = watcher;
    log.debug('Started watching log file', { sessionId, logPath });
  }

  /**
   * Read new content from log file and broadcast to clients.
   * @param {string|number} sessionId - Session identifier
   * @param {string} logPath - Path to log file
   * @param {number} start - Start position
   * @param {number} end - End position
   */
  _readNewContent(sessionId, logPath, start, end) {
    const stream = this.streams.get(sessionId);
    if (!stream || stream.clients.size === 0) return;

    const buffer = Buffer.alloc(end - start);
    const fd = fs.openSync(logPath, 'r');

    try {
      fs.readSync(fd, buffer, 0, end - start, start);
      const content = buffer.toString('utf-8');
      const lines = content.split('\n').filter(l => l.trim());

      lines.forEach(line => {
        const entry = this._parseLine(line);
        this._broadcastToClients(sessionId, 'log', entry);
      });
    } finally {
      fs.closeSync(fd);
    }
  }

  /**
   * Broadcast event to all clients of a session.
   * @param {string|number} sessionId - Session identifier
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  _broadcastToClients(sessionId, event, data) {
    const stream = this.streams.get(sessionId);
    if (!stream) return;

    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const deadClients = [];

    stream.clients.forEach(client => {
      try {
        client.res.write(payload);
      } catch (err) {
        log.debug('Client disconnected', { sessionId, clientId: client.id });
        deadClients.push(client.id);
      }
    });

    // Clean up dead clients
    deadClients.forEach(id => this.removeClient(sessionId, id));
  }

  /**
   * Remove a client from a stream.
   * @param {string|number} sessionId - Session identifier
   * @param {string} clientId - Client identifier
   */
  removeClient(sessionId, clientId) {
    const stream = this.streams.get(sessionId);
    if (!stream) return;

    stream.clients.forEach(client => {
      if (client.id === clientId) {
        stream.clients.delete(client);
        try {
          client.res.end();
        } catch (err) {
          // Client already disconnected
        }
      }
    });

    log.debug('Client removed from stream', { sessionId, clientId, remainingClients: stream.clients.size });

    // Stop watcher if no clients remaining
    if (stream.clients.size === 0) {
      this._stopWatcher(sessionId);
    }
  }

  /**
   * Stop watching a log file.
   * @param {string|number} sessionId - Session identifier
   */
  _stopWatcher(sessionId) {
    const stream = this.streams.get(sessionId);
    if (!stream) return;

    if (stream.watcher) {
      const logPath = this.getLogPath(sessionId);
      fs.unwatchFile(logPath);
      stream.watcher = null;
      log.debug('Stopped watching log file', { sessionId });
    }

    this.streams.delete(sessionId);
  }

  /**
   * Pause log streaming for a session.
   * @param {string|number} sessionId - Session identifier
   */
  pauseStream(sessionId) {
    const stream = this.streams.get(sessionId);
    if (stream) {
      stream.paused = true;
      this._broadcastToClients(sessionId, 'status', { paused: true });
      log.debug('Stream paused', { sessionId });
    }
  }

  /**
   * Resume log streaming for a session.
   * @param {string|number} sessionId - Session identifier
   */
  resumeStream(sessionId) {
    const stream = this.streams.get(sessionId);
    if (stream) {
      stream.paused = false;
      this._broadcastToClients(sessionId, 'status', { paused: false });
      log.debug('Stream resumed', { sessionId });
    }
  }

  /**
   * Write a log entry for a session.
   * @param {string|number} sessionId - Session identifier
   * @param {string} message - Log message
   * @param {string} level - Log level
   * @param {string} source - Log source (component name)
   */
  writeLog(sessionId, message, level = 'INFO', source = 'orchestrator') {
    const logPath = this.getLogPath(sessionId);
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const line = `${timestamp} [${level.padEnd(5)}] [${source}] ${message}\n`;

    fs.appendFileSync(logPath, line);

    // If we have active clients, broadcast immediately
    const stream = this.streams.get(sessionId);
    if (stream && stream.clients.size > 0 && !stream.paused) {
      this._broadcastToClients(sessionId, 'log', this._parseLine(line));
    }
  }

  /**
   * Get statistics for a log file.
   * @param {string|number} sessionId - Session identifier
   * @returns {Object} Log statistics
   */
  async getStats(sessionId) {
    const logPath = this.getLogPath(sessionId);

    if (!fs.existsSync(logPath)) {
      return { exists: false, lineCount: 0, size: 0, levels: {} };
    }

    const stats = fs.statSync(logPath);
    const levels = { INFO: 0, WARN: 0, ERROR: 0, DEBUG: 0 };
    let lineCount = 0;

    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: fs.createReadStream(logPath),
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        lineCount++;
        const level = parseLogLevel(line);
        levels[level] = (levels[level] || 0) + 1;
      });

      rl.on('close', () => {
        resolve({
          exists: true,
          lineCount,
          size: stats.size,
          sizeFormatted: formatBytes(stats.size),
          levels,
          modified: stats.mtime.toISOString()
        });
      });
    });
  }

  /**
   * Clear log file for a session.
   * @param {string|number} sessionId - Session identifier
   */
  clearLog(sessionId) {
    const logPath = this.getLogPath(sessionId);
    if (fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, '');
      this._broadcastToClients(sessionId, 'cleared', { timestamp: new Date().toISOString() });
      log.info('Log cleared', { sessionId });
    }
  }

  /**
   * Shutdown the log streamer.
   */
  shutdown() {
    // Stop all watchers and disconnect all clients
    this.streams.forEach((stream, sessionId) => {
      this._broadcastToClients(sessionId, 'shutdown', {});
      stream.clients.forEach(client => {
        try {
          client.res.end();
        } catch (err) {
          // Ignore
        }
      });
      this._stopWatcher(sessionId);
    });

    this.streams.clear();
    log.info('Log streamer shutdown');
  }
}

/**
 * Format bytes to human-readable string.
 * @param {number} bytes - Byte count
 * @returns {string} Formatted string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Singleton instance
let instance = null;

function getLogStreamer(options = {}) {
  if (!instance) {
    instance = new LogStreamer(options);
  }
  return instance;
}

function resetLogStreamer() {
  if (instance) {
    instance.shutdown();
    instance = null;
  }
}

module.exports = { LogStreamer, getLogStreamer, resetLogStreamer };
