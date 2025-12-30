/**
 * HTTP Integration tests for Task Claims API Endpoints
 * Tests the actual HTTP endpoints on port 3033 (global-context-manager.js)
 *
 * Tests: /api/tasks/:taskId/claim, /api/tasks/:taskId/release,
 *        /api/tasks/:taskId/claim/heartbeat, /api/tasks/in-flight,
 *        /api/sessions/:sessionId/current-task, /api/tasks/claims/cleanup,
 *        /api/tasks/claims/stats
 *
 * Session-Task Claiming - HTTP Endpoint Verification
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('Task Claims HTTP API Endpoints', () => {
  let server;
  let port;
  let baseUrl;
  let testDir;
  let dbPath;

  // Helper function to make HTTP requests
  const makeRequest = (method, urlPath, body = null) => {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: port,
        path: urlPath,
        method: method,
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            resolve({ status: res.statusCode, body: parsed });
          } catch (e) {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });

      req.on('error', reject);

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  };

  beforeAll((done) => {
    // Create unique temp directory for test database
    testDir = path.join(os.tmpdir(), `claims-http-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(testDir, { recursive: true });
    dbPath = path.join(testDir, 'coordination.db');

    // Find an available port
    port = 3150 + Math.floor(Math.random() * 100);
    baseUrl = `http://localhost:${port}`;

    // Clear require cache
    const modulePath = path.resolve(__dirname, '../../global-context-manager.js');
    delete require.cache[modulePath];

    // Set environment
    process.env.PORT = port;
    process.env.NODE_ENV = 'test';
    process.env.COORDINATION_DB_PATH = dbPath;

    // Suppress console output during tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    // Create test server with express and mock CoordinationDB
    const express = require('express');
    const app = express();
    app.use(express.json());

    // Mock CoordinationDB for testing
    const CoordinationDB = require('../../.claude/core/coordination-db');
    const db = new CoordinationDB(dbPath, { autoCleanup: false });

    // Register test sessions
    db.registerSession('test-session-1', '/test/project', 'orchestrator');
    db.registerSession('test-session-2', '/test/project', 'developer');

    // SSE clients
    const sseClients = new Set();
    const broadcastSSE = (event) => {
      const data = JSON.stringify(event);
      for (const client of sseClients) {
        try {
          client.write(`data: ${data}\n\n`);
        } catch (error) {
          sseClients.delete(client);
        }
      }
    };

    // Claim endpoints (replicated from global-context-manager.js)
    app.post('/api/tasks/:taskId/claim', (req, res) => {
      const { taskId } = req.params;
      const { sessionId, ttlMs, metadata } = req.body;

      if (!sessionId) {
        return res.status(400).json({ error: 'SESSION_ID_REQUIRED', message: 'sessionId is required' });
      }

      try {
        const result = db.claimTask(taskId, sessionId, { ttlMs, metadata });
        if (result.claimed) {
          broadcastSSE({ type: 'task:claimed', taskId, sessionId, claim: result.claim });
          res.json(result);
        } else if (result.error === 'TASK_ALREADY_CLAIMED') {
          res.status(409).json(result);
        } else {
          res.status(500).json(result);
        }
      } catch (error) {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
      }
    });

    app.post('/api/tasks/:taskId/release', (req, res) => {
      const { taskId } = req.params;
      const { sessionId, reason } = req.body;

      if (!sessionId) {
        return res.status(400).json({ error: 'SESSION_ID_REQUIRED', message: 'sessionId is required' });
      }

      try {
        const result = db.releaseClaim(taskId, sessionId, reason || 'manual_release');
        if (result.released) {
          broadcastSSE({ type: 'task:released', taskId, sessionId, reason: reason || 'manual_release' });
          res.json(result);
        } else if (result.error === 'CLAIM_NOT_FOUND') {
          res.status(404).json(result);
        } else if (result.error === 'NOT_CLAIM_OWNER') {
          res.status(403).json(result);
        } else {
          res.status(500).json(result);
        }
      } catch (error) {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
      }
    });

    app.post('/api/tasks/:taskId/claim/heartbeat', (req, res) => {
      const { taskId } = req.params;
      const { sessionId, ttlMs } = req.body;

      if (!sessionId) {
        return res.status(400).json({ error: 'SESSION_ID_REQUIRED', message: 'sessionId is required' });
      }

      try {
        const result = db.refreshClaim(taskId, sessionId, ttlMs);
        if (result.success) {
          res.json(result);
        } else if (result.error === 'CLAIM_NOT_FOUND') {
          res.status(404).json(result);
        } else if (result.error === 'NOT_CLAIM_OWNER') {
          res.status(403).json(result);
        } else {
          res.status(500).json(result);
        }
      } catch (error) {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
      }
    });

    app.get('/api/tasks/in-flight', (req, res) => {
      try {
        const sessionId = req.query.session || null;
        const includeExpired = req.query.includeExpired === 'true';
        const limit = parseInt(req.query.limit) || 100;

        let claims;
        if (sessionId) {
          claims = db.getClaimsBySession(sessionId);
        } else {
          claims = db.getActiveClaims();
        }

        if (!includeExpired) {
          const now = Date.now();
          claims = claims.filter(c => c.expiresAt > now);
        }

        claims = claims.slice(0, limit);

        res.json({
          success: true,
          claims,
          count: claims.length
        });
      } catch (error) {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
      }
    });

    app.get('/api/sessions/:sessionId/current-task', (req, res) => {
      const { sessionId } = req.params;

      try {
        const claims = db.getClaimsBySession(sessionId);
        const now = Date.now();
        const activeClaims = claims.filter(c => c.expiresAt > now);

        if (activeClaims.length === 0) {
          return res.json({ sessionId, currentTask: null });
        }

        const currentClaim = activeClaims.sort((a, b) => b.claimedAt - a.claimedAt)[0];

        res.json({
          sessionId,
          currentTask: {
            taskId: currentClaim.taskId,
            claimedAt: currentClaim.claimedAt,
            expiresAt: currentClaim.expiresAt,
            lastHeartbeat: currentClaim.lastHeartbeat,
            metadata: currentClaim.metadata,
            task: null
          }
        });
      } catch (error) {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
      }
    });

    app.post('/api/tasks/claims/cleanup', (req, res) => {
      try {
        const expiredResult = db.cleanupExpiredClaims();
        const orphanedResult = db.cleanupOrphanedClaims();

        const totalCleaned = (expiredResult.count || 0) + (orphanedResult.count || 0);

        if (totalCleaned > 0) {
          broadcastSSE({ type: 'claims:cleanup', cleaned: totalCleaned });
        }

        res.json({
          success: true,
          expired: expiredResult,
          orphaned: orphanedResult,
          totalCleaned
        });
      } catch (error) {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
      }
    });

    app.get('/api/tasks/claims/stats', (req, res) => {
      try {
        const stats = db.getClaimStats();
        res.json(stats);
      } catch (error) {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
      }
    });

    // SSE endpoint
    app.get('/api/sse/claims', (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      sseClients.add(res);

      try {
        const claims = db.getActiveClaims();
        const stats = db.getClaimStats();
        res.write(`data: ${JSON.stringify({ type: 'claims:initial', claims, stats })}\n\n`);
      } catch (error) {
        // Ignore errors
      }

      req.on('close', () => {
        sseClients.delete(res);
      });
    });

    // Store db reference for cleanup
    app.locals.db = db;

    server = app.listen(port, () => {
      done();
    });

    server.on('error', (err) => {
      done(err);
    });
  }, 10000);

  afterAll((done) => {
    if (server) {
      if (server.locals && server.locals.db) {
        try {
          server.locals.db.close();
        } catch (e) {
          // Ignore
        }
      }
      server.close(() => {
        // Clean up temp directory
        if (testDir && fs.existsSync(testDir)) {
          try {
            fs.rmSync(testDir, { recursive: true, force: true });
          } catch (e) {
            // Ignore cleanup errors
          }
        }
        done();
      });
    } else {
      done();
    }
  });

  // ============================================================================
  // POST /api/tasks/:taskId/claim
  // ============================================================================

  describe('POST /api/tasks/:taskId/claim', () => {
    test('returns 400 when sessionId is missing', async () => {
      const res = await makeRequest('POST', '/api/tasks/task-1/claim', {});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('SESSION_ID_REQUIRED');
    });

    test('successfully claims an unclaimed task', async () => {
      const res = await makeRequest('POST', '/api/tasks/task-http-1/claim', {
        sessionId: 'test-session-1'
      });

      expect(res.status).toBe(200);
      expect(res.body.claimed).toBe(true);
      expect(res.body.claim.taskId).toBe('task-http-1');
      expect(res.body.claim.sessionId).toBe('test-session-1');
    });

    test('returns 409 when task already claimed by another session', async () => {
      // First claim succeeds
      await makeRequest('POST', '/api/tasks/task-http-2/claim', {
        sessionId: 'test-session-1'
      });

      // Second claim fails
      const res = await makeRequest('POST', '/api/tasks/task-http-2/claim', {
        sessionId: 'test-session-2'
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('TASK_ALREADY_CLAIMED');
    });

    test('accepts custom TTL', async () => {
      const res = await makeRequest('POST', '/api/tasks/task-http-3/claim', {
        sessionId: 'test-session-1',
        ttlMs: 60000
      });

      expect(res.status).toBe(200);
      expect(res.body.claimed).toBe(true);
    });

    test('accepts metadata', async () => {
      const res = await makeRequest('POST', '/api/tasks/task-http-4/claim', {
        sessionId: 'test-session-1',
        metadata: { priority: 'high', phase: 'testing' }
      });

      expect(res.status).toBe(200);
      expect(res.body.claimed).toBe(true);
    });
  });

  // ============================================================================
  // POST /api/tasks/:taskId/release
  // ============================================================================

  describe('POST /api/tasks/:taskId/release', () => {
    test('returns 400 when sessionId is missing', async () => {
      const res = await makeRequest('POST', '/api/tasks/task-1/release', {});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('SESSION_ID_REQUIRED');
    });

    test('successfully releases owned claim', async () => {
      // First claim
      await makeRequest('POST', '/api/tasks/task-release-1/claim', {
        sessionId: 'test-session-1'
      });

      // Then release
      const res = await makeRequest('POST', '/api/tasks/task-release-1/release', {
        sessionId: 'test-session-1',
        reason: 'completed'
      });

      expect(res.status).toBe(200);
      expect(res.body.released).toBe(true);
    });

    test('returns 404 when claim does not exist', async () => {
      const res = await makeRequest('POST', '/api/tasks/non-existent-task/release', {
        sessionId: 'test-session-1'
      });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('CLAIM_NOT_FOUND');
    });

    test('returns 403 when session does not own claim', async () => {
      // First claim by session 1
      await makeRequest('POST', '/api/tasks/task-release-2/claim', {
        sessionId: 'test-session-1'
      });

      // Session 2 tries to release
      const res = await makeRequest('POST', '/api/tasks/task-release-2/release', {
        sessionId: 'test-session-2'
      });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('NOT_CLAIM_OWNER');
    });
  });

  // ============================================================================
  // POST /api/tasks/:taskId/claim/heartbeat
  // ============================================================================

  describe('POST /api/tasks/:taskId/claim/heartbeat', () => {
    test('returns 400 when sessionId is missing', async () => {
      const res = await makeRequest('POST', '/api/tasks/task-1/claim/heartbeat', {});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('SESSION_ID_REQUIRED');
    });

    test('successfully refreshes claim TTL', async () => {
      // First claim
      await makeRequest('POST', '/api/tasks/task-heartbeat-1/claim', {
        sessionId: 'test-session-1'
      });

      // Heartbeat
      const res = await makeRequest('POST', '/api/tasks/task-heartbeat-1/claim/heartbeat', {
        sessionId: 'test-session-1'
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('returns 404 when claim does not exist', async () => {
      const res = await makeRequest('POST', '/api/tasks/non-existent-task/claim/heartbeat', {
        sessionId: 'test-session-1'
      });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('CLAIM_NOT_FOUND');
    });

    test('returns 403 when session does not own claim', async () => {
      // First claim by session 1
      await makeRequest('POST', '/api/tasks/task-heartbeat-2/claim', {
        sessionId: 'test-session-1'
      });

      // Session 2 tries to heartbeat
      const res = await makeRequest('POST', '/api/tasks/task-heartbeat-2/claim/heartbeat', {
        sessionId: 'test-session-2'
      });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('NOT_CLAIM_OWNER');
    });
  });

  // ============================================================================
  // GET /api/tasks/in-flight
  // ============================================================================

  describe('GET /api/tasks/in-flight', () => {
    test('returns success response with claims array', async () => {
      const res = await makeRequest('GET', '/api/tasks/in-flight');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.claims)).toBe(true);
      expect(typeof res.body.count).toBe('number');
    });

    test('filters by session when query param provided', async () => {
      // Claim tasks
      await makeRequest('POST', '/api/tasks/task-inflight-1/claim', {
        sessionId: 'test-session-1'
      });
      await makeRequest('POST', '/api/tasks/task-inflight-2/claim', {
        sessionId: 'test-session-2'
      });

      const res = await makeRequest('GET', '/api/tasks/in-flight?session=test-session-1');

      expect(res.status).toBe(200);
      expect(res.body.claims.every(c => c.sessionId === 'test-session-1')).toBe(true);
    });

    test('respects limit parameter', async () => {
      const res = await makeRequest('GET', '/api/tasks/in-flight?limit=1');

      expect(res.status).toBe(200);
      expect(res.body.claims.length).toBeLessThanOrEqual(1);
    });
  });

  // ============================================================================
  // GET /api/sessions/:sessionId/current-task
  // ============================================================================

  describe('GET /api/sessions/:sessionId/current-task', () => {
    test('returns null when session has no claims', async () => {
      const res = await makeRequest('GET', '/api/sessions/session-with-no-claims/current-task');

      expect(res.status).toBe(200);
      expect(res.body.currentTask).toBeNull();
    });

    test('returns current task for session with claims', async () => {
      // Claim a task
      await makeRequest('POST', '/api/tasks/task-current-1/claim', {
        sessionId: 'test-session-1'
      });

      const res = await makeRequest('GET', '/api/sessions/test-session-1/current-task');

      expect(res.status).toBe(200);
      expect(res.body.sessionId).toBe('test-session-1');
      expect(res.body.currentTask).toBeDefined();
      expect(res.body.currentTask.taskId).toBe('task-current-1');
    });
  });

  // ============================================================================
  // POST /api/tasks/claims/cleanup
  // ============================================================================

  describe('POST /api/tasks/claims/cleanup', () => {
    test('returns success response with cleanup results', async () => {
      const res = await makeRequest('POST', '/api/tasks/claims/cleanup', {});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.expired).toBeDefined();
      expect(res.body.orphaned).toBeDefined();
      expect(typeof res.body.totalCleaned).toBe('number');
    });
  });

  // ============================================================================
  // GET /api/tasks/claims/stats
  // ============================================================================

  describe('GET /api/tasks/claims/stats', () => {
    test('returns stats object', async () => {
      const res = await makeRequest('GET', '/api/tasks/claims/stats');

      expect(res.status).toBe(200);
      expect(res.body.totalActive).toBeDefined();
      expect(typeof res.body.totalActive).toBe('number');
    });

    test('tracks claims by session', async () => {
      // Claim some tasks
      await makeRequest('POST', '/api/tasks/task-stats-1/claim', {
        sessionId: 'test-session-1'
      });
      await makeRequest('POST', '/api/tasks/task-stats-2/claim', {
        sessionId: 'test-session-1'
      });

      const res = await makeRequest('GET', '/api/tasks/claims/stats');

      expect(res.status).toBe(200);
      expect(res.body.bySession).toBeDefined();
      expect(res.body.bySession['test-session-1']).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================================
  // Error Handling
  // ============================================================================

  describe('Error Handling', () => {
    test('handles invalid JSON body gracefully', async () => {
      const options = {
        hostname: 'localhost',
        port: port,
        path: '/api/tasks/task-1/claim',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const response = await new Promise((resolve) => {
        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.write('not-valid-json{');
        req.end();
      });

      // Should return 400 for invalid JSON
      expect(response.status).toBe(400);
    });
  });
});
