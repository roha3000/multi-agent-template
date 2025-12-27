/**
 * Tests for Log Streamer Service
 *
 * @module log-streamer.test
 */

const fs = require('fs');
const path = require('path');
const { LogStreamer, resetLogStreamer } = require('../../.claude/core/log-streamer');

describe('LogStreamer', () => {
  let logStreamer;
  let testLogsDir;

  beforeEach(() => {
    // Create a temporary logs directory for testing
    testLogsDir = path.join(__dirname, '../../.claude/logs-test-' + Date.now());
    fs.mkdirSync(testLogsDir, { recursive: true });

    // Create a new instance with test directory
    logStreamer = new LogStreamer({ logsDir: testLogsDir });
  });

  afterEach(() => {
    // Shutdown the log streamer
    logStreamer.shutdown();
    resetLogStreamer();

    // Clean up test directory
    try {
      const files = fs.readdirSync(testLogsDir);
      files.forEach(f => fs.unlinkSync(path.join(testLogsDir, f)));
      fs.rmdirSync(testLogsDir);
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      expect(logStreamer.maxLines).toBe(1000);
      expect(logStreamer.tailLines).toBe(100);
    });

    it('should create logs directory if it does not exist', () => {
      expect(fs.existsSync(testLogsDir)).toBe(true);
    });
  });

  describe('getLogPath', () => {
    it('should return correct path for session ID', () => {
      const logPath = logStreamer.getLogPath(123);
      expect(logPath).toBe(path.join(testLogsDir, 'session-123.log'));
    });

    it('should handle string session IDs', () => {
      const logPath = logStreamer.getLogPath('test-session');
      expect(logPath).toBe(path.join(testLogsDir, 'session-test-session.log'));
    });
  });

  describe('writeLog', () => {
    it('should write log entry to file', () => {
      logStreamer.writeLog(1, 'Test message', 'INFO', 'test');

      const logPath = logStreamer.getLogPath(1);
      expect(fs.existsSync(logPath)).toBe(true);

      const content = fs.readFileSync(logPath, 'utf-8');
      expect(content).toContain('Test message');
      expect(content).toContain('[INFO ]');
      expect(content).toContain('[test]');
    });

    it('should append multiple log entries', () => {
      logStreamer.writeLog(2, 'First message', 'INFO', 'test');
      logStreamer.writeLog(2, 'Second message', 'WARN', 'test');
      logStreamer.writeLog(2, 'Third message', 'ERROR', 'test');

      const logPath = logStreamer.getLogPath(2);
      const content = fs.readFileSync(logPath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(3);
      expect(lines[0]).toContain('First message');
      expect(lines[1]).toContain('Second message');
      expect(lines[2]).toContain('Third message');
    });

    it('should format log level correctly', () => {
      logStreamer.writeLog(3, 'Debug log', 'DEBUG', 'test');

      const content = fs.readFileSync(logStreamer.getLogPath(3), 'utf-8');
      expect(content).toContain('[DEBUG]');
    });
  });

  describe('getHistoricalLogs', () => {
    it('should return empty array for non-existent log', async () => {
      const result = await logStreamer.getHistoricalLogs('nonexistent');
      expect(result.entries).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should return parsed log entries', async () => {
      logStreamer.writeLog(4, 'Test entry 1', 'INFO', 'test');
      logStreamer.writeLog(4, 'Test entry 2', 'WARN', 'test');

      const result = await logStreamer.getHistoricalLogs(4);
      expect(result.entries.length).toBe(2);
      expect(result.entries[0].level).toBe('INFO');
      expect(result.entries[1].level).toBe('WARN');
    });

    it('should respect line limit', async () => {
      // Write 10 entries
      for (let i = 0; i < 10; i++) {
        logStreamer.writeLog(5, `Entry ${i}`, 'INFO', 'test');
      }

      // Request only 5
      const result = await logStreamer.getHistoricalLogs(5, { lines: 5 });
      expect(result.entries.length).toBe(5);
      expect(result.entries[0].line).toContain('Entry 5');
      expect(result.entries[4].line).toContain('Entry 9');
      expect(result.total).toBe(10);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('getAvailableLogs', () => {
    it('should return empty array when no logs exist', () => {
      const logs = logStreamer.getAvailableLogs();
      expect(logs).toEqual([]);
    });

    it('should return list of available logs', () => {
      logStreamer.writeLog(6, 'Session 6 log', 'INFO', 'test');
      logStreamer.writeLog(7, 'Session 7 log', 'INFO', 'test');

      const logs = logStreamer.getAvailableLogs();
      expect(logs.length).toBe(2);
      expect(logs.some(l => l.sessionId === '6')).toBe(true);
      expect(logs.some(l => l.sessionId === '7')).toBe(true);
    });

    it('should include file metadata', () => {
      logStreamer.writeLog(8, 'Test log', 'INFO', 'test');

      const logs = logStreamer.getAvailableLogs();
      expect(logs[0].size).toBeGreaterThan(0);
      expect(logs[0].modified).toBeDefined();
      expect(logs[0].filename).toBe('session-8.log');
    });
  });

  describe('getStats', () => {
    it('should return exists: false for non-existent log', async () => {
      const stats = await logStreamer.getStats('nonexistent');
      expect(stats.exists).toBe(false);
      expect(stats.lineCount).toBe(0);
    });

    it('should count log lines', async () => {
      logStreamer.writeLog(9, 'Line 1', 'INFO', 'test');
      logStreamer.writeLog(9, 'Line 2', 'WARN', 'test');
      logStreamer.writeLog(9, 'Line 3', 'ERROR', 'test');

      const stats = await logStreamer.getStats(9);
      expect(stats.exists).toBe(true);
      expect(stats.lineCount).toBe(3);
    });

    it('should count log levels', async () => {
      logStreamer.writeLog(10, 'Info 1', 'INFO', 'test');
      logStreamer.writeLog(10, 'Info 2', 'INFO', 'test');
      logStreamer.writeLog(10, 'Warning', 'WARN', 'test');
      logStreamer.writeLog(10, 'Error', 'ERROR', 'test');

      const stats = await logStreamer.getStats(10);
      expect(stats.levels.INFO).toBe(2);
      expect(stats.levels.WARN).toBe(1);
      expect(stats.levels.ERROR).toBe(1);
    });
  });

  describe('clearLog', () => {
    it('should clear log file contents', () => {
      logStreamer.writeLog(11, 'Some content', 'INFO', 'test');
      const logPath = logStreamer.getLogPath(11);
      expect(fs.readFileSync(logPath, 'utf-8').length).toBeGreaterThan(0);

      logStreamer.clearLog(11);
      expect(fs.readFileSync(logPath, 'utf-8')).toBe('');
    });

    it('should not throw for non-existent log', () => {
      expect(() => logStreamer.clearLog('nonexistent')).not.toThrow();
    });
  });

  describe('pauseStream and resumeStream', () => {
    it('should not throw when no stream exists', () => {
      expect(() => logStreamer.pauseStream('nonexistent')).not.toThrow();
      expect(() => logStreamer.resumeStream('nonexistent')).not.toThrow();
    });
  });

  describe('shutdown', () => {
    it('should clean up all resources', () => {
      logStreamer.shutdown();
      expect(logStreamer.streams.size).toBe(0);
    });
  });

  describe('_parseLine', () => {
    it('should parse log level from line', () => {
      const entry = logStreamer._parseLine('12:30:45 [INFO ] [test] Hello world');
      expect(entry.level).toBe('INFO');
      expect(entry.timestamp).toBe('12:30:45');
    });

    it('should handle WARN level', () => {
      const entry = logStreamer._parseLine('12:30:45 [WARN ] [test] Warning message');
      expect(entry.level).toBe('WARN');
    });

    it('should handle ERROR level', () => {
      const entry = logStreamer._parseLine('12:30:45 [ERROR] [test] Error message');
      expect(entry.level).toBe('ERROR');
    });

    it('should handle DEBUG level', () => {
      const entry = logStreamer._parseLine('12:30:45 [DEBUG] [test] Debug message');
      expect(entry.level).toBe('DEBUG');
    });

    it('should default to INFO for unknown format', () => {
      const entry = logStreamer._parseLine('Some random log line without level');
      expect(entry.level).toBe('INFO');
    });
  });
});
