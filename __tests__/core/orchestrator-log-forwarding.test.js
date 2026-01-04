/**
 * Tests for Orchestrator Log Forwarding to Dashboard
 * Tests the logToDashboard functionality
 *
 * @module __tests__/core/orchestrator-log-forwarding
 */

const http = require('http');

describe('Orchestrator Log Forwarding', () => {
  let mockServer;
  let receivedLogs = [];
  let serverPort;

  // Simulate the logToDashboard function
  function createLogToDashboard(sessionId, state, dashboardUrl) {
    return async function logToDashboard(message, level = 'INFO', source = 'orchestrator') {
      if (!sessionId) return false;

      try {
        const logEntry = {
          timestamp: new Date().toISOString(),
          level,
          source,
          message,
          sessionNumber: state.totalSessions,
          phase: state.currentPhase,
          taskId: state.currentTask?.id || null
        };

        return await postToDashboard(
          dashboardUrl,
          `/api/logs/${sessionId}/write`,
          logEntry
        );
      } catch (err) {
        return false;
      }
    };
  }

  function postToDashboard(baseUrl, endpoint, data) {
    return new Promise((resolve) => {
      try {
        const url = new URL(baseUrl);
        const postData = JSON.stringify(data);

        const options = {
          hostname: url.hostname,
          port: url.port,
          path: endpoint,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        };

        const req = http.request(options, (res) => {
          let body = '';
          res.on('data', (chunk) => body += chunk);
          res.on('end', () => {
            try {
              resolve(res.statusCode === 200);
            } catch {
              resolve(false);
            }
          });
        });

        req.on('error', () => resolve(false));
        req.write(postData);
        req.end();
      } catch {
        resolve(false);
      }
    });
  }

  beforeAll((done) => {
    // Create mock server
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        if (req.url.includes('/api/logs/') && req.url.includes('/write')) {
          try {
            const logEntry = JSON.parse(body);
            receivedLogs.push({
              url: req.url,
              body: logEntry
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });

    mockServer.listen(0, () => {
      serverPort = mockServer.address().port;
      done();
    });
  });

  afterAll((done) => {
    mockServer.close(done);
  });

  beforeEach(() => {
    receivedLogs = [];
  });

  describe('logToDashboard', () => {
    test('sends log entry to dashboard', async () => {
      const sessionId = 'test-session-123';
      const state = {
        totalSessions: 5,
        currentPhase: 'implement',
        currentTask: { id: 'task-001' }
      };
      const dashboardUrl = `http://localhost:${serverPort}`;

      const logToDashboard = createLogToDashboard(sessionId, state, dashboardUrl);
      const result = await logToDashboard('Test message', 'INFO', 'test');

      expect(result).toBe(true);
      expect(receivedLogs).toHaveLength(1);
      expect(receivedLogs[0].body.message).toBe('Test message');
      expect(receivedLogs[0].body.level).toBe('INFO');
      expect(receivedLogs[0].body.source).toBe('test');
    });

    test('includes session context in log entry', async () => {
      const sessionId = 'session-456';
      const state = {
        totalSessions: 10,
        currentPhase: 'testing',
        currentTask: { id: 'task-789' }
      };
      const dashboardUrl = `http://localhost:${serverPort}`;

      const logToDashboard = createLogToDashboard(sessionId, state, dashboardUrl);
      await logToDashboard('Phase complete', 'INFO', 'phase-transition');

      expect(receivedLogs[0].body.sessionNumber).toBe(10);
      expect(receivedLogs[0].body.phase).toBe('testing');
      expect(receivedLogs[0].body.taskId).toBe('task-789');
    });

    test('handles null task gracefully', async () => {
      const sessionId = 'session-no-task';
      const state = {
        totalSessions: 1,
        currentPhase: 'research',
        currentTask: null
      };
      const dashboardUrl = `http://localhost:${serverPort}`;

      const logToDashboard = createLogToDashboard(sessionId, state, dashboardUrl);
      await logToDashboard('Research started');

      expect(receivedLogs[0].body.taskId).toBeNull();
    });

    test('returns false when no session ID', async () => {
      const state = { totalSessions: 1, currentPhase: 'test' };
      const dashboardUrl = `http://localhost:${serverPort}`;

      const logToDashboard = createLogToDashboard(null, state, dashboardUrl);
      const result = await logToDashboard('Should not send');

      expect(result).toBe(false);
      expect(receivedLogs).toHaveLength(0);
    });

    test('returns false when dashboard unreachable', async () => {
      const sessionId = 'session-123';
      const state = { totalSessions: 1, currentPhase: 'test' };
      const dashboardUrl = 'http://localhost:99999'; // Invalid port

      const logToDashboard = createLogToDashboard(sessionId, state, dashboardUrl);
      const result = await logToDashboard('Should fail');

      expect(result).toBe(false);
    });

    test('uses correct log levels', async () => {
      const sessionId = 'session-levels';
      const state = { totalSessions: 1, currentPhase: 'test' };
      const dashboardUrl = `http://localhost:${serverPort}`;

      const logToDashboard = createLogToDashboard(sessionId, state, dashboardUrl);

      await logToDashboard('Info message', 'INFO', 'test');
      await logToDashboard('Warning message', 'WARN', 'test');
      await logToDashboard('Error message', 'ERROR', 'test');

      expect(receivedLogs[0].body.level).toBe('INFO');
      expect(receivedLogs[1].body.level).toBe('WARN');
      expect(receivedLogs[2].body.level).toBe('ERROR');
    });

    test('uses correct source identifiers', async () => {
      const sessionId = 'session-sources';
      const state = { totalSessions: 1, currentPhase: 'test' };
      const dashboardUrl = `http://localhost:${serverPort}`;

      const logToDashboard = createLogToDashboard(sessionId, state, dashboardUrl);

      await logToDashboard('Task claimed', 'INFO', 'task-claim');
      await logToDashboard('Task done', 'INFO', 'task-complete');
      await logToDashboard('Phase change', 'INFO', 'phase-transition');
      await logToDashboard('Session start', 'INFO', 'session-start');
      await logToDashboard('Safety issue', 'WARN', 'swarm-safety');

      expect(receivedLogs.map(l => l.body.source)).toEqual([
        'task-claim',
        'task-complete',
        'phase-transition',
        'session-start',
        'swarm-safety'
      ]);
    });

    test('sends to correct endpoint with session ID', async () => {
      const sessionId = 'unique-session-abc';
      const state = { totalSessions: 1, currentPhase: 'test' };
      const dashboardUrl = `http://localhost:${serverPort}`;

      const logToDashboard = createLogToDashboard(sessionId, state, dashboardUrl);
      await logToDashboard('Test endpoint');

      expect(receivedLogs[0].url).toContain(`/api/logs/${sessionId}/write`);
    });

    test('includes timestamp in log entry', async () => {
      const sessionId = 'session-timestamp';
      const state = { totalSessions: 1, currentPhase: 'test' };
      const dashboardUrl = `http://localhost:${serverPort}`;

      const beforeTime = new Date().toISOString();
      const logToDashboard = createLogToDashboard(sessionId, state, dashboardUrl);
      await logToDashboard('Timed message');
      const afterTime = new Date().toISOString();

      const logTimestamp = receivedLogs[0].body.timestamp;
      expect(logTimestamp >= beforeTime).toBe(true);
      expect(logTimestamp <= afterTime).toBe(true);
    });
  });

  describe('log forwarding scenarios', () => {
    test('logs task claim events', async () => {
      const sessionId = 'session-claim';
      const state = {
        totalSessions: 3,
        currentPhase: 'implement',
        currentTask: { id: 'fix-auth-bug', title: 'Fix auth bug' }
      };
      const dashboardUrl = `http://localhost:${serverPort}`;

      const logToDashboard = createLogToDashboard(sessionId, state, dashboardUrl);
      await logToDashboard(
        'Task claimed: Fix auth bug (fix-auth-bug) - Priority: high',
        'INFO',
        'task-claim'
      );

      expect(receivedLogs[0].body.message).toContain('Task claimed');
      expect(receivedLogs[0].body.message).toContain('fix-auth-bug');
    });

    test('logs task completion events', async () => {
      const sessionId = 'session-complete';
      const state = {
        totalSessions: 5,
        currentPhase: 'implement',
        currentTask: { id: 'add-feature' }
      };
      const dashboardUrl = `http://localhost:${serverPort}`;

      const logToDashboard = createLogToDashboard(sessionId, state, dashboardUrl);
      await logToDashboard(
        'Task completed: Add feature (add-feature) - Quality: 92/100, Duration: 1.5h',
        'INFO',
        'task-complete'
      );

      expect(receivedLogs[0].body.message).toContain('Quality: 92/100');
      expect(receivedLogs[0].body.source).toBe('task-complete');
    });

    test('logs phase transitions', async () => {
      const sessionId = 'session-phase';
      const state = {
        totalSessions: 8,
        currentPhase: 'design',
        currentTask: null
      };
      const dashboardUrl = `http://localhost:${serverPort}`;

      const logToDashboard = createLogToDashboard(sessionId, state, dashboardUrl);
      await logToDashboard(
        'Phase transition: research → design (Score: 85/100, Iterations: 3)',
        'INFO',
        'phase-transition'
      );

      expect(receivedLogs[0].body.message).toContain('Phase transition');
      expect(receivedLogs[0].body.message).toContain('85/100');
    });

    test('logs safety warnings', async () => {
      const sessionId = 'session-safety';
      const state = {
        totalSessions: 2,
        currentPhase: 'implement',
        currentTask: { id: 'risky-task' }
      };
      const dashboardUrl = `http://localhost:${serverPort}`;

      const logToDashboard = createLogToDashboard(sessionId, state, dashboardUrl);
      await logToDashboard(
        'Safety check failed: Potential security risk detected',
        'WARN',
        'swarm-safety'
      );

      expect(receivedLogs[0].body.level).toBe('WARN');
      expect(receivedLogs[0].body.source).toBe('swarm-safety');
    });

    test('logs session errors', async () => {
      const sessionId = 'session-error';
      const state = {
        totalSessions: 4,
        currentPhase: 'test',
        currentTask: { id: 'failing-task' }
      };
      const dashboardUrl = `http://localhost:${serverPort}`;

      const logToDashboard = createLogToDashboard(sessionId, state, dashboardUrl);
      await logToDashboard(
        'Session error: Process exited with code 1',
        'ERROR',
        'session-error'
      );

      expect(receivedLogs[0].body.level).toBe('ERROR');
      expect(receivedLogs[0].body.source).toBe('session-error');
    });
  });
});
