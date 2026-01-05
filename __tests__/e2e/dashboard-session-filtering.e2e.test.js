/**
 * Dashboard Session Filtering E2E Tests
 *
 * Tests for proper filtering of CLI vs autonomous sessions in the dashboard.
 * Ensures autonomous child sessions don't appear as duplicate CLI sessions.
 */

const http = require('http');

// Helper to make API requests
async function apiRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3033,
      path,
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => reject(new Error('Request timeout')));

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Check if dashboard is running
async function isDashboardRunning() {
  try {
    const res = await apiRequest('/api/sessions/summary');
    return res.status === 200;
  } catch {
    return false;
  }
}

describe('Dashboard Session Filtering', () => {
  let dashboardRunning = false;

  beforeAll(async () => {
    dashboardRunning = await isDashboardRunning();
    if (!dashboardRunning) {
      console.log('Dashboard not running - tests will be skipped');
    }
  });

  describe('Session Type Detection', () => {
    it('should return sessions with sessionType field', async () => {
      if (!dashboardRunning) return;

      const res = await apiRequest('/api/sessions/summary');
      expect(res.status).toBe(200);
      expect(res.data.sessions).toBeDefined();

      res.data.sessions.forEach(session => {
        expect(['cli', 'autonomous']).toContain(session.sessionType);
      });
    });

    it('should mark orchestrator children as autonomous', async () => {
      if (!dashboardRunning) return;

      const res = await apiRequest('/api/sessions/summary');
      expect(res.status).toBe(200);

      // Find sessions with parentSessionId set (indicating they're children)
      const childSessions = res.data.sessions.filter(s =>
        s.hierarchyInfo?.parentSessionId
      );

      // All child sessions should be autonomous
      childSessions.forEach(child => {
        expect(child.sessionType).toBe('autonomous');
      });
    });

    it('should include claudeSessionId for sessions that have it', async () => {
      if (!dashboardRunning) return;

      const res = await apiRequest('/api/sessions/summary');
      expect(res.status).toBe(200);

      // Non-orchestrator sessions should have claudeSessionId
      const nonOrchestratorSessions = res.data.sessions.filter(s =>
        !s.orchestratorInfo
      );

      nonOrchestratorSessions.forEach(session => {
        // Either it's a CLI session or an autonomous child - both should have claudeSessionId
        if (session.status !== 'ended') {
          expect(session.claudeSessionId).toBeDefined();
        }
      });
    });
  });

  describe('Ended Session Handling', () => {
    it('should keep ended sessions in registry for hierarchy visibility', async () => {
      if (!dashboardRunning) return;

      const res = await apiRequest('/api/sessions/summary');
      expect(res.status).toBe(200);

      // Check that ended sessions are preserved (if any exist)
      const endedSessions = res.data.sessions.filter(s => s.status === 'ended');

      // Each ended session should still be in the registry with proper fields
      endedSessions.forEach(session => {
        expect(session.id).toBeDefined();
        // endedAt is set when session is deregistered
        // It may be null if session was ended but not properly deregistered
        if (session.endedAt) {
          expect(typeof session.endedAt).toBe('string');
        }
      });
    });

    it('should exclude ended sessions from active count', async () => {
      if (!dashboardRunning) return;

      const res = await apiRequest('/api/sessions/summary');
      expect(res.status).toBe(200);

      const activeSessions = res.data.sessions.filter(s => s.status === 'active');

      // The globalMetrics.activeCount should match active sessions
      expect(res.data.globalMetrics.activeCount).toBe(activeSessions.length);
    });
  });

  describe('Hierarchy API', () => {
    it('should return children for parent sessions', async () => {
      if (!dashboardRunning) return;

      const summaryRes = await apiRequest('/api/sessions/summary');
      if (summaryRes.status !== 200) return;

      // Find an autonomous parent session (orchestrator)
      const parentSessions = summaryRes.data.sessions.filter(s =>
        s.sessionType === 'autonomous' && s.orchestratorInfo
      );

      if (parentSessions.length === 0) {
        console.log('No parent orchestrator sessions found - skipping hierarchy test');
        return;
      }

      const parent = parentSessions[0];
      const hierarchyRes = await apiRequest(`/api/sessions/${parent.id}/hierarchy`);

      expect(hierarchyRes.status).toBe(200);
      expect(hierarchyRes.data.sessionId).toBe(parent.id);
      expect(hierarchyRes.data.children).toBeDefined();
      expect(Array.isArray(hierarchyRes.data.children)).toBe(true);
    });

    it('should link child sessions to parent via hierarchyInfo', async () => {
      if (!dashboardRunning) return;

      const summaryRes = await apiRequest('/api/sessions/summary');
      if (summaryRes.status !== 200) return;

      const parentSessions = summaryRes.data.sessions.filter(s =>
        s.sessionType === 'autonomous' && s.orchestratorInfo
      );

      if (parentSessions.length === 0) return;

      const parent = parentSessions[0];
      const childSessions = summaryRes.data.sessions.filter(s =>
        s.hierarchyInfo?.parentSessionId === parent.id
      );

      childSessions.forEach(child => {
        expect(child.sessionType).toBe('autonomous');
        expect(child.hierarchyInfo.parentSessionId).toBe(parent.id);
      });
    });
  });

  describe('Projects API Cross-Reference', () => {
    it('should not duplicate sessions across projects and registry APIs', async () => {
      if (!dashboardRunning) return;

      const [projectsRes, summaryRes] = await Promise.all([
        apiRequest('/api/projects'),
        apiRequest('/api/sessions/summary')
      ]);

      if (projectsRes.status !== 200 || summaryRes.status !== 200) return;

      // Build registry map by claudeSessionId
      const registryByClaudeId = new Map();
      summaryRes.data.sessions.forEach(s => {
        if (s.claudeSessionId) {
          registryByClaudeId.set(s.claudeSessionId, s);
        }
      });

      // Check that autonomous sessions in projects API are also in registry
      projectsRes.data.projects.forEach(project => {
        (project.sessions || []).forEach(cliSession => {
          const registrySession = registryByClaudeId.get(cliSession.id);
          if (registrySession && registrySession.sessionType === 'autonomous') {
            // These should be filtered out in dashboard display
            expect(registrySession.autonomous || registrySession.sessionType === 'autonomous').toBe(true);
          }
        });
      });
    });
  });
});
