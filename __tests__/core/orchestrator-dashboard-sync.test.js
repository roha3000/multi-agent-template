/**
 * Tests for Orchestrator Dashboard Sync Functions
 * Tests updateCommandCenter, recordTaskCompletionToCommandCenter, deregisterFromCommandCenter
 *
 * @module __tests__/core/orchestrator-dashboard-sync
 */

const http = require('http');

describe('Orchestrator Dashboard Sync', () => {
  let mockServer;
  let receivedRequests = [];
  let serverPort;
  let mockPostToDashboard;
  let postToDashboardCalls = [];

  // Create mock postToDashboard that tracks calls
  function createMockPostToDashboard(shouldSucceed = true) {
    postToDashboardCalls = [];
    return async (endpoint, data) => {
      postToDashboardCalls.push({ endpoint, data });
      return { success: shouldSucceed };
    };
  }

  // Create real postToDashboard for integration tests
  function createRealPostToDashboard(baseUrl) {
    return function postToDashboard(endpoint, data) {
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
                const parsed = JSON.parse(body);
                resolve({ success: true, ...parsed });
              } catch {
                resolve({ success: res.statusCode === 200 });
              }
            });
          });

          req.on('error', (err) => {
            resolve({ success: false, error: err.message });
          });
          req.write(postData);
          req.end();
        } catch (err) {
          resolve({ success: false, error: err.message });
        }
      });
    };
  }

  // Create updateCommandCenter function
  function createUpdateCommandCenter(registeredSessionId, state, postToDashboard) {
    return async function updateCommandCenter(updates = {}) {
      if (!registeredSessionId) return;

      try {
        const sessionUpdates = {
          status: 'active',
          logSessionId: state.totalSessions,
          currentTask: state.currentTask ? {
            id: state.currentTask.id,
            title: state.currentTask.title,
            phase: state.currentPhase,
          } : null,
          iteration: state.phaseIteration,
          phase: state.currentPhase,
          ...updates,
        };

        await postToDashboard(`/api/sessions/${registeredSessionId}/update`, sessionUpdates);
      } catch (err) {
        console.error('[COMMAND CENTER] Update failed:', err.message);
      }
    };
  }

  // Create recordTaskCompletionToCommandCenter function
  function createRecordTaskCompletion(projectPath, postToDashboard) {
    return async function recordTaskCompletionToCommandCenter(task, score, cost = 0) {
      try {
        const result = await postToDashboard('/api/sessions/completion', {
          project: projectPath,
          task: { id: task.id, title: task.title },
          score,
          cost
        });
        if (!result.success) {
          console.error('[COMMAND CENTER] Task completion record failed');
        }
        return result;
      } catch (err) {
        console.error('[COMMAND CENTER] Task completion error:', err.message);
        return { success: false, error: err.message };
      }
    };
  }

  // Create deregisterFromCommandCenter function
  function createDeregister(getSessionId, setSessionId, postToDashboard) {
    return async function deregisterFromCommandCenter() {
      const registeredSessionId = getSessionId();
      if (!registeredSessionId) {
        console.log('[COMMAND CENTER] No session to deregister');
        return { success: false, reason: 'no_session' };
      }

      try {
        const result = await postToDashboard(`/api/sessions/${registeredSessionId}/end`, {});
        if (result.success) {
          console.log(`[COMMAND CENTER] Session deregistered: ${registeredSessionId}`);
        } else {
          console.error(`[COMMAND CENTER] Deregistration failed for: ${registeredSessionId}`);
        }
        setSessionId(null);
        return result;
      } catch (err) {
        console.error('[COMMAND CENTER] Deregistration error:', err.message);
        setSessionId(null);
        return { success: false, error: err.message };
      }
    };
  }

  beforeAll((done) => {
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        let parsed = {};
        try {
          parsed = JSON.parse(body);
        } catch {}

        receivedRequests.push({
          method: req.method,
          url: req.url,
          body: parsed
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
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
    receivedRequests = [];
    postToDashboardCalls = [];
  });

  // ============================================================================
  // UNIT TESTS: updateCommandCenter
  // ============================================================================

  describe('updateCommandCenter', () => {
    it('should not call postToDashboard when registeredSessionId is null', async () => {
      const mockPost = createMockPostToDashboard();
      const state = { totalSessions: 1, currentPhase: 'implement', phaseIteration: 1, currentTask: null };
      const updateCommandCenter = createUpdateCommandCenter(null, state, mockPost);

      await updateCommandCenter({ phase: 'test' });

      expect(postToDashboardCalls).toHaveLength(0);
    });

    it('should call postToDashboard with session updates when registered', async () => {
      const mockPost = createMockPostToDashboard();
      const state = { totalSessions: 5, currentPhase: 'implement', phaseIteration: 2, currentTask: null };
      const updateCommandCenter = createUpdateCommandCenter('session-123', state, mockPost);

      await updateCommandCenter({ qualityScore: 85 });

      expect(postToDashboardCalls).toHaveLength(1);
      expect(postToDashboardCalls[0].endpoint).toBe('/api/sessions/session-123/update');
      expect(postToDashboardCalls[0].data).toEqual(expect.objectContaining({
        status: 'active',
        logSessionId: 5,
        phase: 'implement',
        iteration: 2,
        qualityScore: 85
      }));
    });

    it('should include currentTask info when task is active', async () => {
      const mockPost = createMockPostToDashboard();
      const state = {
        totalSessions: 1,
        currentPhase: 'implement',
        phaseIteration: 1,
        currentTask: { id: 'task-1', title: 'Test Task' }
      };
      const updateCommandCenter = createUpdateCommandCenter('session-123', state, mockPost);

      await updateCommandCenter({});

      expect(postToDashboardCalls[0].data.currentTask).toEqual({
        id: 'task-1',
        title: 'Test Task',
        phase: 'implement'
      });
    });

    it('should set currentTask to null when no active task', async () => {
      const mockPost = createMockPostToDashboard();
      const state = { totalSessions: 1, currentPhase: 'test', phaseIteration: 1, currentTask: null };
      const updateCommandCenter = createUpdateCommandCenter('session-123', state, mockPost);

      await updateCommandCenter({});

      expect(postToDashboardCalls[0].data.currentTask).toBeNull();
    });

    it('should handle postToDashboard failure gracefully', async () => {
      const mockPost = createMockPostToDashboard(false);
      const state = { totalSessions: 1, currentPhase: 'test', phaseIteration: 1, currentTask: null };
      const updateCommandCenter = createUpdateCommandCenter('session-123', state, mockPost);

      // Should not throw
      await expect(updateCommandCenter({ phase: 'complete' })).resolves.not.toThrow();
    });

    it('should include phase history when provided', async () => {
      const mockPost = createMockPostToDashboard();
      const state = { totalSessions: 3, currentPhase: 'test', phaseIteration: 1, currentTask: null };
      const updateCommandCenter = createUpdateCommandCenter('session-123', state, mockPost);

      const phaseHistory = [
        { session: 1, iteration: 1, exitReason: 'complete', peakContext: 45.2 },
        { session: 2, iteration: 2, exitReason: 'complete', peakContext: 62.1 }
      ];

      await updateCommandCenter({ phaseHistory });

      expect(postToDashboardCalls[0].data.phaseHistory).toEqual(phaseHistory);
    });
  });

  // ============================================================================
  // UNIT TESTS: recordTaskCompletionToCommandCenter
  // ============================================================================

  describe('recordTaskCompletionToCommandCenter', () => {
    it('should post task completion data to dashboard', async () => {
      const mockPost = createMockPostToDashboard();
      const recordCompletion = createRecordTaskCompletion('test-project', mockPost);

      const task = { id: 'task-abc', title: 'Complete Feature X' };
      await recordCompletion(task, 92, 0.15);

      expect(postToDashboardCalls).toHaveLength(1);
      expect(postToDashboardCalls[0].endpoint).toBe('/api/sessions/completion');
      expect(postToDashboardCalls[0].data).toEqual({
        project: 'test-project',
        task: { id: 'task-abc', title: 'Complete Feature X' },
        score: 92,
        cost: 0.15
      });
    });

    it('should use default cost of 0', async () => {
      const mockPost = createMockPostToDashboard();
      const recordCompletion = createRecordTaskCompletion('test-project', mockPost);

      await recordCompletion({ id: 'task-1', title: 'Task' }, 85);

      expect(postToDashboardCalls[0].data.cost).toBe(0);
    });

    it('should return success status from postToDashboard', async () => {
      const mockPost = createMockPostToDashboard(true);
      const recordCompletion = createRecordTaskCompletion('test-project', mockPost);

      const result = await recordCompletion({ id: 'task-1', title: 'Task' }, 85);

      expect(result.success).toBe(true);
    });

    it('should handle failure gracefully', async () => {
      const mockPost = createMockPostToDashboard(false);
      const recordCompletion = createRecordTaskCompletion('test-project', mockPost);

      const result = await recordCompletion({ id: 'task-1', title: 'Task' }, 85);

      expect(result.success).toBe(false);
    });
  });

  // ============================================================================
  // UNIT TESTS: deregisterFromCommandCenter
  // ============================================================================

  describe('deregisterFromCommandCenter', () => {
    it('should return early when no session is registered', async () => {
      const mockPost = createMockPostToDashboard();
      let sessionId = null;
      const deregister = createDeregister(() => sessionId, (id) => { sessionId = id; }, mockPost);

      const result = await deregister();

      expect(result.reason).toBe('no_session');
      expect(postToDashboardCalls).toHaveLength(0);
    });

    it('should call end endpoint with session ID', async () => {
      const mockPost = createMockPostToDashboard();
      let sessionId = 'session-456';
      const deregister = createDeregister(() => sessionId, (id) => { sessionId = id; }, mockPost);

      await deregister();

      expect(postToDashboardCalls).toHaveLength(1);
      expect(postToDashboardCalls[0].endpoint).toBe('/api/sessions/session-456/end');
    });

    it('should clear session ID after successful deregistration', async () => {
      const mockPost = createMockPostToDashboard(true);
      let sessionId = 'session-789';
      const deregister = createDeregister(() => sessionId, (id) => { sessionId = id; }, mockPost);

      await deregister();

      expect(sessionId).toBeNull();
    });

    it('should clear session ID even on failure', async () => {
      const mockPost = createMockPostToDashboard(false);
      let sessionId = 'session-fail';
      const deregister = createDeregister(() => sessionId, (id) => { sessionId = id; }, mockPost);

      await deregister();

      expect(sessionId).toBeNull();
    });
  });

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================

  describe('Integration: Phase Transition → Dashboard Update', () => {
    it('should send phase update to dashboard on transition', async () => {
      const postToDashboard = createRealPostToDashboard(`http://localhost:${serverPort}`);
      const state = { totalSessions: 3, currentPhase: 'design', phaseIteration: 1, currentTask: null };
      const updateCommandCenter = createUpdateCommandCenter('int-session-1', state, postToDashboard);

      await updateCommandCenter({
        phase: 'implement',
        qualityScore: 88,
        phaseHistory: [{ session: 1, iteration: 1, exitReason: 'complete', peakContext: 50 }]
      });

      // Give time for HTTP request
      await new Promise(r => setTimeout(r, 50));

      expect(receivedRequests.length).toBeGreaterThanOrEqual(1);
      const updateReq = receivedRequests.find(r => r.url.includes('/update'));
      expect(updateReq).toBeDefined();
      expect(updateReq.body.phase).toBe('implement');
      expect(updateReq.body.qualityScore).toBe(88);
    });
  });

  describe('Integration: Task Complete → Dashboard Shows Null Task', () => {
    it('should update dashboard with currentTask: null after completion', async () => {
      const postToDashboard = createRealPostToDashboard(`http://localhost:${serverPort}`);
      const state = { totalSessions: 2, currentPhase: 'implement', phaseIteration: 1, currentTask: null };
      const updateCommandCenter = createUpdateCommandCenter('int-session-2', state, postToDashboard);

      // Simulate task completion update
      await updateCommandCenter({
        currentTask: null,
        qualityScore: 91,
        tasksCompleted: 5
      });

      await new Promise(r => setTimeout(r, 50));

      const updateReq = receivedRequests.find(r => r.url.includes('/update'));
      expect(updateReq.body.currentTask).toBeNull();
      expect(updateReq.body.tasksCompleted).toBe(5);
    });
  });

  describe('Integration: Error Exit → Session Deregistered', () => {
    it('should call deregister endpoint on error exit', async () => {
      const postToDashboard = createRealPostToDashboard(`http://localhost:${serverPort}`);
      let sessionId = 'int-session-error';
      const deregister = createDeregister(() => sessionId, (id) => { sessionId = id; }, postToDashboard);

      await deregister();

      await new Promise(r => setTimeout(r, 50));

      const endReq = receivedRequests.find(r => r.url.includes('/end'));
      expect(endReq).toBeDefined();
      expect(endReq.url).toContain('int-session-error');
    });
  });

  describe('Integration: Dashboard Offline → Graceful Degradation', () => {
    it('should handle connection refused gracefully', async () => {
      // Use a port that's definitely not listening
      const postToDashboard = createRealPostToDashboard('http://localhost:59999');
      const state = { totalSessions: 1, currentPhase: 'test', phaseIteration: 1, currentTask: null };
      const updateCommandCenter = createUpdateCommandCenter('offline-session', state, postToDashboard);

      // Should not throw
      await expect(updateCommandCenter({ phase: 'complete' })).resolves.not.toThrow();
    });

    it('should return failure when dashboard is offline', async () => {
      const postToDashboard = createRealPostToDashboard('http://localhost:59999');
      const recordCompletion = createRecordTaskCompletion('test-project', postToDashboard);

      const result = await recordCompletion({ id: 'task-1', title: 'Task' }, 85);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ============================================================================
  // LIFECYCLE TEST
  // ============================================================================

  describe('Lifecycle: Full Orchestrator Run', () => {
    it('should make all expected dashboard calls during lifecycle', async () => {
      const postToDashboard = createRealPostToDashboard(`http://localhost:${serverPort}`);
      let sessionId = 'lifecycle-session';
      const state = {
        totalSessions: 1,
        currentPhase: 'implement',
        phaseIteration: 1,
        currentTask: { id: 'task-1', title: 'Build Feature' }
      };

      const updateCommandCenter = createUpdateCommandCenter(sessionId, state, postToDashboard);
      const recordCompletion = createRecordTaskCompletion('lifecycle-project', postToDashboard);
      const deregister = createDeregister(() => sessionId, (id) => { sessionId = id; }, postToDashboard);

      // 1. Task claimed - update dashboard
      await updateCommandCenter({
        currentTask: { id: 'task-1', title: 'Build Feature', phase: 'implement' }
      });

      // 2. Phase complete - update with score
      state.currentPhase = 'test';
      await updateCommandCenter({
        phase: 'test',
        qualityScore: 87
      });

      // 3. Task complete - record and clear task
      state.currentTask = null;
      await recordCompletion({ id: 'task-1', title: 'Build Feature' }, 92, 0.25);
      await updateCommandCenter({
        currentTask: null,
        qualityScore: 92,
        tasksCompleted: 1
      });

      // 4. Session end - deregister
      await deregister();

      await new Promise(r => setTimeout(r, 100));

      // Verify all calls were made
      const updateCalls = receivedRequests.filter(r => r.url.includes('/update'));
      const completionCalls = receivedRequests.filter(r => r.url.includes('/completion'));
      const endCalls = receivedRequests.filter(r => r.url.includes('/end'));

      expect(updateCalls.length).toBeGreaterThanOrEqual(3);
      expect(completionCalls).toHaveLength(1);
      expect(endCalls).toHaveLength(1);

      // Verify phase transition was recorded
      const phaseUpdate = updateCalls.find(r => r.body.phase === 'test');
      expect(phaseUpdate).toBeDefined();
      expect(phaseUpdate.body.qualityScore).toBe(87);

      // Verify task completion was recorded
      expect(completionCalls[0].body.task.id).toBe('task-1');
      expect(completionCalls[0].body.score).toBe(92);

      // Verify final update had null task
      const finalUpdate = updateCalls[updateCalls.length - 1];
      expect(finalUpdate.body.currentTask).toBeNull();
    });
  });
});
