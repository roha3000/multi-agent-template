/**
 * E2E Tests for Orchestrator → Dashboard Communication
 *
 * Tests that the autonomous orchestrator correctly registers with the dashboard
 * via HTTP API and that sessions appear in the dashboard's session list.
 *
 * These tests use real HTTP calls to verify cross-process communication works.
 */

const http = require('http');
const path = require('path');

const BASE_URL = 'http://localhost:3033';
const TEST_TIMEOUT = 10000;

// Helper to make HTTP requests
function httpRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: data ? JSON.parse(data) : null
          });
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

// Check if server is running
async function isServerRunning() {
  try {
    const res = await httpRequest('GET', '/api/health');
    return res.status === 200;
  } catch {
    return false;
  }
}

describe('Orchestrator → Dashboard Communication', () => {
  let registeredSessionId = null;

  beforeAll(async () => {
    const running = await isServerRunning();
    if (!running) {
      console.log('⚠️  Dashboard server not running at', BASE_URL);
      console.log('   Start it with: node global-context-manager.js');
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    // Clean up: deregister test session if it was registered
    if (registeredSessionId) {
      try {
        await httpRequest('POST', `/api/sessions/${registeredSessionId}/end`);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  describe('POST /api/sessions/register', () => {
    it('should register a new autonomous session', async () => {
      const running = await isServerRunning();
      if (!running) {
        console.log('⏭️  Skipping: Server not running');
        return;
      }

      const sessionData = {
        project: 'e2e-test-project',
        path: path.resolve(__dirname, '../..'),
        sessionType: 'autonomous',
        autonomous: true,
        status: 'active',
        phase: 'research',
        currentTask: {
          id: 'test-task-1',
          title: 'E2E Test Task',
          phase: 'research'
        },
        logSessionId: 999,
        orchestratorInfo: {
          version: '1.0.0-test',
          startTime: new Date().toISOString(),
          mode: 'autonomous'
        }
      };

      const res = await httpRequest('POST', '/api/sessions/register', sessionData);

      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('id');
      expect(typeof res.data.id).toBe('number');

      registeredSessionId = res.data.id;
    }, TEST_TIMEOUT);

    it('should include all required fields in registration response', async () => {
      const running = await isServerRunning();
      if (!running) return;

      // Use a fresh registration for this test
      const sessionData = {
        project: 'e2e-test-fields',
        path: '/test/path',
        sessionType: 'autonomous',
        autonomous: true,
        logSessionId: 888
      };

      const res = await httpRequest('POST', '/api/sessions/register', sessionData);

      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('id');
      expect(res.data).toHaveProperty('success');
      expect(res.data.success).toBe(true);

      // Clean up
      if (res.data.id) {
        await httpRequest('POST', `/api/sessions/${res.data.id}/end`);
      }
    }, TEST_TIMEOUT);
  });

  describe('GET /api/sessions/summary', () => {
    it('should return registered session in summary', async () => {
      const running = await isServerRunning();
      if (!running) return;

      // Register a session first
      const sessionData = {
        project: 'e2e-summary-test',
        path: '/test/summary/path',
        sessionType: 'autonomous',
        autonomous: true,
        status: 'active',
        logSessionId: 777
      };

      const registerRes = await httpRequest('POST', '/api/sessions/register', sessionData);
      expect(registerRes.status).toBe(200);
      const sessionId = registerRes.data.id;

      try {
        // Now fetch summary
        const summaryRes = await httpRequest('GET', '/api/sessions/summary');

        expect(summaryRes.status).toBe(200);
        expect(summaryRes.data).toHaveProperty('sessions');
        expect(Array.isArray(summaryRes.data.sessions)).toBe(true);

        // Find our session
        const session = summaryRes.data.sessions.find(s => s.id === sessionId);
        expect(session).toBeDefined();
        expect(session.project).toBe('e2e-summary-test');
        expect(session.sessionType).toBe('autonomous');
        expect(session.autonomous).toBe(true);
        expect(session.logSessionId).toBe(777);
      } finally {
        // Clean up
        await httpRequest('POST', `/api/sessions/${sessionId}/end`);
      }
    }, TEST_TIMEOUT);

    it('should include globalMetrics in summary', async () => {
      const running = await isServerRunning();
      if (!running) return;

      const res = await httpRequest('GET', '/api/sessions/summary');

      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('globalMetrics');
      expect(res.data.globalMetrics).toHaveProperty('activeCount');
      expect(res.data.globalMetrics).toHaveProperty('tasksCompletedToday');
      expect(res.data.globalMetrics).toHaveProperty('avgHealthScore');
    }, TEST_TIMEOUT);
  });

  describe('POST /api/sessions/:id/update', () => {
    it('should update session phase and status', async () => {
      const running = await isServerRunning();
      if (!running) return;

      // Register first
      const registerRes = await httpRequest('POST', '/api/sessions/register', {
        project: 'e2e-update-test',
        sessionType: 'autonomous',
        phase: 'research'
      });
      const sessionId = registerRes.data.id;

      try {
        // Update session
        const updateRes = await httpRequest('POST', `/api/sessions/${sessionId}/update`, {
          phase: 'implementation',
          status: 'active',
          qualityScore: 85
        });

        expect(updateRes.status).toBe(200);

        // Verify update persisted
        const summaryRes = await httpRequest('GET', '/api/sessions/summary');
        const session = summaryRes.data.sessions.find(s => s.id === sessionId);

        expect(session.phase).toBe('implementation');
        expect(session.qualityScore).toBe(85);
      } finally {
        await httpRequest('POST', `/api/sessions/${sessionId}/end`);
      }
    }, TEST_TIMEOUT);

    it('should preserve sessionType on update', async () => {
      const running = await isServerRunning();
      if (!running) return;

      const registerRes = await httpRequest('POST', '/api/sessions/register', {
        project: 'e2e-preserve-test',
        sessionType: 'autonomous',
        autonomous: true
      });
      const sessionId = registerRes.data.id;

      try {
        // Update without sessionType
        await httpRequest('POST', `/api/sessions/${sessionId}/update`, {
          phase: 'testing'
        });

        // Verify sessionType still set
        const summaryRes = await httpRequest('GET', '/api/sessions/summary');
        const session = summaryRes.data.sessions.find(s => s.id === sessionId);

        expect(session.sessionType).toBe('autonomous');
        expect(session.autonomous).toBe(true);
      } finally {
        await httpRequest('POST', `/api/sessions/${sessionId}/end`);
      }
    }, TEST_TIMEOUT);
  });

  describe('POST /api/sessions/:id/end', () => {
    it('should remove session from summary', async () => {
      const running = await isServerRunning();
      if (!running) return;

      // Register
      const registerRes = await httpRequest('POST', '/api/sessions/register', {
        project: 'e2e-deregister-test',
        sessionType: 'autonomous'
      });
      const sessionId = registerRes.data.id;

      // Verify registered
      let summaryRes = await httpRequest('GET', '/api/sessions/summary');
      let session = summaryRes.data.sessions.find(s => s.id === sessionId);
      expect(session).toBeDefined();
      expect(session.status).toBe('active');

      // Deregister
      const deregisterRes = await httpRequest('POST', `/api/sessions/${sessionId}/end`);
      expect(deregisterRes.status).toBe(200);

      // Verify session is marked as ended (but kept for hierarchy visibility)
      summaryRes = await httpRequest('GET', '/api/sessions/summary');
      session = summaryRes.data.sessions.find(s => s.id === sessionId);
      expect(session).toBeDefined();
      expect(session.status).toBe('ended');
      expect(session.endedAt).toBeDefined();
    }, TEST_TIMEOUT);
  });

  describe('Session type differentiation', () => {
    it('should correctly identify autonomous vs CLI sessions', async () => {
      const running = await isServerRunning();
      if (!running) return;

      // Register autonomous session
      const autoRes = await httpRequest('POST', '/api/sessions/register', {
        project: 'auto-project',
        sessionType: 'autonomous',
        autonomous: true
      });

      // Register CLI session
      const cliRes = await httpRequest('POST', '/api/sessions/register', {
        project: 'cli-project',
        sessionType: 'cli',
        autonomous: false
      });

      try {
        const summaryRes = await httpRequest('GET', '/api/sessions/summary');

        const autoSession = summaryRes.data.sessions.find(s => s.id === autoRes.data.id);
        const cliSession = summaryRes.data.sessions.find(s => s.id === cliRes.data.id);

        expect(autoSession.sessionType).toBe('autonomous');
        expect(autoSession.autonomous).toBe(true);

        expect(cliSession.sessionType).toBe('cli');
        expect(cliSession.autonomous).toBe(false);
      } finally {
        await httpRequest('POST', `/api/sessions/${autoRes.data.id}/end`);
        await httpRequest('POST', `/api/sessions/${cliRes.data.id}/end`);
      }
    }, TEST_TIMEOUT);
  });

  describe('Log session ID mapping', () => {
    it('should preserve logSessionId through session lifecycle', async () => {
      const running = await isServerRunning();
      if (!running) return;

      const logSessionId = 42;

      // Register with logSessionId
      const registerRes = await httpRequest('POST', '/api/sessions/register', {
        project: 'log-test-project',
        sessionType: 'autonomous',
        logSessionId
      });
      const sessionId = registerRes.data.id;

      try {
        // Update session
        await httpRequest('POST', `/api/sessions/${sessionId}/update`, {
          phase: 'implementation'
        });

        // Verify logSessionId preserved
        const summaryRes = await httpRequest('GET', '/api/sessions/summary');
        const session = summaryRes.data.sessions.find(s => s.id === sessionId);

        expect(session.logSessionId).toBe(logSessionId);
      } finally {
        await httpRequest('POST', `/api/sessions/${sessionId}/end`);
      }
    }, TEST_TIMEOUT);
  });
});
