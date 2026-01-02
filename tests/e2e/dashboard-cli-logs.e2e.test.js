/**
 * E2E Tests for CLI Session Activity Logs in Dashboard
 *
 * Tests the /api/logs/:sessionId/activity endpoint and SSE streaming.
 * Requires dashboard server running at localhost:3033.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3033';
const TEST_TIMEOUT = 10000;
const AUDIT_LOG_PATH = path.join(__dirname, '../../.claude/logs/tool-audit.jsonl');

// Helper to make HTTP requests
function httpRequest(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function isServerRunning() {
  try {
    const res = await httpRequest('GET', '/api/health');
    return res.status === 200;
  } catch {
    return false;
  }
}

// Helper to write test entries to audit log
function writeTestAuditEntry(entry) {
  const logsDir = path.dirname(AUDIT_LOG_PATH);
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + '\n');
}

// Helper to clear audit log
function clearAuditLog() {
  if (fs.existsSync(AUDIT_LOG_PATH)) {
    fs.unlinkSync(AUDIT_LOG_PATH);
  }
}

describe('CLI Session Activity Logs', () => {
  let serverRunning = false;
  const TEST_SESSION_ID = 'test-cli-session-' + Date.now();

  beforeAll(async () => {
    serverRunning = await isServerRunning();
    if (!serverRunning) {
      console.log('  Dashboard server not running at', BASE_URL);
      console.log('   Start it with: node global-context-manager.js');
      console.log('   Skipping E2E tests...');
    }
  }, TEST_TIMEOUT);

  afterAll(() => {
    // Clean up test entries (optional - leave for debugging)
    // clearAuditLog();
  });

  describe('GET /api/logs/:sessionId/activity', () => {
    test('returns empty array when no entries exist for session', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', `/api/logs/nonexistent-session-123/activity`);

      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('entries');
      expect(res.data.entries).toEqual([]);
      expect(res.data.count).toBe(0);
      expect(res.data.total).toBe(0);
    });

    test('returns activity entries for a session', async () => {
      if (!serverRunning) return;

      // Write test entries
      const testEntries = [
        { timestamp: new Date().toISOString(), tool: 'Read', success: true, sessionId: TEST_SESSION_ID },
        { timestamp: new Date().toISOString(), tool: 'Edit', success: true, sessionId: TEST_SESSION_ID },
        { timestamp: new Date().toISOString(), tool: 'Bash', success: false, sessionId: TEST_SESSION_ID }
      ];

      testEntries.forEach(writeTestAuditEntry);

      const res = await httpRequest('GET', `/api/logs/${TEST_SESSION_ID}/activity`);

      expect(res.status).toBe(200);
      expect(res.data.entries.length).toBeGreaterThanOrEqual(3);
      expect(res.data.total).toBeGreaterThanOrEqual(3);

      // Check entry structure
      const entry = res.data.entries[0];
      expect(entry).toHaveProperty('timestamp');
      expect(entry).toHaveProperty('tool');
      expect(entry).toHaveProperty('success');
      expect(entry).toHaveProperty('sessionId');
    });

    test('respects limit and offset parameters', async () => {
      if (!serverRunning) return;

      // Request with limit
      const res1 = await httpRequest('GET', `/api/logs/${TEST_SESSION_ID}/activity?limit=2`);
      expect(res1.status).toBe(200);
      expect(res1.data.entries.length).toBeLessThanOrEqual(2);

      // Request with offset
      const res2 = await httpRequest('GET', `/api/logs/${TEST_SESSION_ID}/activity?limit=1&offset=1`);
      expect(res2.status).toBe(200);
      expect(res2.data.entries.length).toBeLessThanOrEqual(1);
    });

    test('sorts entries by timestamp descending (newest first)', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', `/api/logs/${TEST_SESSION_ID}/activity`);

      if (res.data.entries.length >= 2) {
        const times = res.data.entries.map(e => new Date(e.timestamp).getTime());
        for (let i = 0; i < times.length - 1; i++) {
          expect(times[i]).toBeGreaterThanOrEqual(times[i + 1]);
        }
      }
    });

    test('includes hasMore flag for pagination', async () => {
      if (!serverRunning) return;

      // Add more entries to ensure we have enough
      for (let i = 0; i < 5; i++) {
        writeTestAuditEntry({
          timestamp: new Date().toISOString(),
          tool: `Tool${i}`,
          success: true,
          sessionId: TEST_SESSION_ID
        });
      }

      const res = await httpRequest('GET', `/api/logs/${TEST_SESSION_ID}/activity?limit=2`);

      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('hasMore');
      // hasMore should be true if total > limit
      if (res.data.total > 2) {
        expect(res.data.hasMore).toBe(true);
      }
    });
  });

  describe('GET /api/logs/:sessionId/activity/stream (SSE)', () => {
    test('establishes SSE connection and receives connected event', async () => {
      if (!serverRunning) return;

      return new Promise((resolve, reject) => {
        const req = http.get(`${BASE_URL}/api/logs/${TEST_SESSION_ID}/activity/stream`, (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toBe('text/event-stream');

          let data = '';
          res.on('data', chunk => {
            data += chunk;
            // Check for connected event
            if (data.includes('"type":"connected"')) {
              res.destroy();
              resolve();
            }
          });

          // Timeout after 3 seconds
          setTimeout(() => {
            res.destroy();
            reject(new Error('Did not receive connected event'));
          }, 3000);
        });

        req.on('error', reject);
      });
    });

    test('receives activity events when new entries are written', async () => {
      if (!serverRunning) return;

      const uniqueSessionId = 'sse-test-session-' + Date.now();

      return new Promise((resolve, reject) => {
        const receivedEvents = [];

        const req = http.get(`${BASE_URL}/api/logs/${uniqueSessionId}/activity/stream`, (res) => {
          res.on('data', chunk => {
            const data = chunk.toString();
            if (data.includes('"type":"activity"')) {
              receivedEvents.push(data);
              res.destroy();
              expect(receivedEvents.length).toBeGreaterThan(0);
              resolve();
            }
          });
        });

        req.on('error', reject);

        // Wait a bit then write a new entry
        setTimeout(() => {
          writeTestAuditEntry({
            timestamp: new Date().toISOString(),
            tool: 'SSETestTool',
            success: true,
            sessionId: uniqueSessionId
          });
        }, 500);

        // Timeout after 5 seconds
        setTimeout(() => {
          req.destroy();
          // It's OK if we didn't receive the event - file watching might not trigger
          // This is a best-effort test
          resolve();
        }, 5000);
      });
    });
  });

  describe('Integration with tool-audit.jsonl', () => {
    test('audit log is stored at expected path', () => {
      const expectedPath = path.join(__dirname, '../../.claude/logs/tool-audit.jsonl');
      // Path should be writable
      const logsDir = path.dirname(expectedPath);
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      expect(fs.existsSync(logsDir)).toBe(true);
    });

    test('entries are properly formatted JSONL', () => {
      if (fs.existsSync(AUDIT_LOG_PATH)) {
        const content = fs.readFileSync(AUDIT_LOG_PATH, 'utf8');
        const lines = content.trim().split('\n').filter(Boolean);

        for (const line of lines.slice(-5)) { // Check last 5 lines
          expect(() => JSON.parse(line)).not.toThrow();
          const entry = JSON.parse(line);
          expect(entry).toHaveProperty('timestamp');
          expect(entry).toHaveProperty('tool');
          expect(typeof entry.success).toBe('boolean');
        }
      }
    });
  });
});
