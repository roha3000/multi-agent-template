/**
 * E2E Tests for Fleet Management Dashboard UI
 *
 * Tests project cards, fleet lineage, and keyboard navigation.
 * Requires dashboard server running at localhost:3033.
 */

const http = require('http');

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

describe('Fleet Management Dashboard UI', () => {
  let serverRunning = false;

  beforeAll(async () => {
    serverRunning = await isServerRunning();
    if (!serverRunning) {
      console.log('  Dashboard server not running at', BASE_URL);
      console.log('   Start it with: node global-context-manager.js');
      console.log('   Skipping E2E tests...');
    }
  }, TEST_TIMEOUT);

  describe('GET /api/overview (Project Cards Data)', () => {
    test('returns projects array with expected structure', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/api/overview');

      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('projects');
      expect(Array.isArray(res.data.projects)).toBe(true);

      // Check global metrics exist
      expect(res.data).toHaveProperty('global');
      expect(res.data.global).toHaveProperty('fiveHourLimit');
      expect(res.data.global).toHaveProperty('activeSessionCount');
    });

    test('projects have required fields for card rendering', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/api/overview');

      if (res.data.projects.length > 0) {
        const project = res.data.projects[0];
        expect(project).toHaveProperty('name');
        expect(project).toHaveProperty('sessionCount');
        expect(project).toHaveProperty('activeSessionCount');
        expect(project).toHaveProperty('metrics');
        expect(project).toHaveProperty('health');
        expect(project).toHaveProperty('sessions');
      }
    });

    test('returns alerts for alert banner', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/api/overview');

      expect(res.data).toHaveProperty('alerts');
      expect(Array.isArray(res.data.alerts)).toBe(true);
    });
  });

  describe('GET /api/agent-pool/status (Fleet Lineage Data)', () => {
    test('returns hierarchy array', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/api/agent-pool/status');

      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('hierarchy');
      expect(Array.isArray(res.data.hierarchy)).toBe(true);
    });

    test('returns summary metrics', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/api/agent-pool/status');

      expect(res.data).toHaveProperty('summary');
      expect(res.data.summary).toHaveProperty('totalAgents');
      expect(res.data.summary).toHaveProperty('activeAgents');
    });

    test('returns health status', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/api/agent-pool/status');

      expect(res.data).toHaveProperty('health');
      expect(res.data.health).toHaveProperty('status');
    });
  });

  describe('GET /api/sessions/:sessionId/hierarchy', () => {
    test('returns 404 for non-existent session', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/api/sessions/non-existent-session/hierarchy');

      expect(res.status).toBe(404);
      expect(res.data).toHaveProperty('error');
    });

    test('handles URL-encoded session IDs', async () => {
      if (!serverRunning) return;

      // Test that special characters are handled
      const res = await httpRequest('GET', '/api/sessions/test%2Fsession/hierarchy');

      // Should return 404 (session doesn't exist) not 500 (server error)
      expect([404, 200]).toContain(res.status);
    });
  });

  describe('Dashboard HTML', () => {
    test('serves dashboard HTML at root', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/');

      expect(res.status).toBe(200);
      expect(typeof res.data).toBe('string');
      expect(res.data).toContain('<!DOCTYPE html>');
    });

    test('HTML contains project cards container', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/');

      expect(res.data).toContain('id="projectCards"');
    });

    test('HTML contains fleet lineage section', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/');

      expect(res.data).toContain('id="fleetLineageSection"');
      expect(res.data).toContain('fleetHierarchyContainer');
    });

    test('HTML contains keyboard navigation handler', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/');

      expect(res.data).toContain("addEventListener('keydown'");
      expect(res.data).toContain("case 'ArrowDown'");
      expect(res.data).toContain("case 'ArrowUp'");
    });

    test('HTML contains updateProjectCards function', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/');

      expect(res.data).toContain('function updateProjectCards()');
    });

    test('HTML contains toggleFleetLineage function', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/');

      expect(res.data).toContain('function toggleFleetLineage()');
    });
  });

  // ==========================================
  // Dashboard v4 Tests
  // ==========================================

  describe('Dashboard v4: API Endpoints', () => {
    test('GET /api/projects returns projects array', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/api/projects');

      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('projects');
      expect(Array.isArray(res.data.projects)).toBe(true);
    });

    test('POST /api/sessions/launch validates project path', async () => {
      if (!serverRunning) return;

      // Test with no path
      const res = await httpRequest('POST', '/api/sessions/launch', {});

      expect(res.status).toBe(400);
      expect(res.data).toHaveProperty('success', false);
      expect(res.data).toHaveProperty('message');
      expect(res.data.message).toContain('required');
    });

    test('POST /api/sessions/launch validates path exists', async () => {
      if (!serverRunning) return;

      // Test with non-existent path
      const res = await httpRequest('POST', '/api/sessions/launch', {
        projectPath: '/nonexistent/path/that/should/not/exist'
      });

      expect(res.status).toBe(400);
      expect(res.data).toHaveProperty('success', false);
      expect(res.data.message).toContain('does not exist');
    });
  });

  describe('Dashboard v4: Layout Elements', () => {
    test('HTML contains v4 top bar', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/');

      expect(res.data).toContain('class="top-bar"');
      expect(res.data).toContain('class="logo"');
      expect(res.data).toContain('top-metrics');
    });

    test('HTML contains 2-panel layout', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/');

      expect(res.data).toContain('class="main-container"');
      expect(res.data).toContain('class="left-panel"');
      expect(res.data).toContain('class="right-panel"');
    });

    test('HTML contains view tabs for 5 tabs', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/');

      expect(res.data).toContain('class="view-tabs"');
      expect(res.data).toContain('data-tab="overview"');
      expect(res.data).toContain('data-tab="tasks"');
      expect(res.data).toContain('data-tab="hierarchy"');
      expect(res.data).toContain('data-tab="details"');
      expect(res.data).toContain('data-tab="logs"');
    });

    test('HTML contains view panes for tabs', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/');

      expect(res.data).toContain('id="pane-overview"');
      expect(res.data).toContain('id="pane-tasks"');
      expect(res.data).toContain('id="pane-hierarchy"');
      expect(res.data).toContain('id="pane-details"');
      expect(res.data).toContain('id="pane-logs"');
    });

    test('HTML contains keyboard bar', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/');

      expect(res.data).toContain('class="keyboard-bar"');
      expect(res.data).toContain('<kbd>');
    });
  });

  describe('Dashboard v4: Session Launcher Modal', () => {
    test('HTML contains session launcher modal', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/');

      expect(res.data).toContain('id="sessionLauncherModal"');
      expect(res.data).toContain('id="projectList"');
      expect(res.data).toContain('id="customProjectPath"');
    });

    test('HTML contains session launcher functions', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/');

      expect(res.data).toContain('function openNewSessionModal()');
      expect(res.data).toContain('function closeNewSessionModal()');
      expect(res.data).toContain('function launchSession()');
      expect(res.data).toContain('function fetchProjects()');
    });

    test('HTML contains New Session header button', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/');

      expect(res.data).toContain('header-btn-new');
      expect(res.data).toContain('openNewSessionModal()');
    });
  });

  describe('Dashboard v4: Tab Pane Functions', () => {
    test('HTML contains tab update functions', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/');

      expect(res.data).toContain('function updateOverviewPane');
      expect(res.data).toContain('function updateTasksPane');
      expect(res.data).toContain('function updateHierarchyPane');
      expect(res.data).toContain('function updateDetailsPane');
      expect(res.data).toContain('function updateLogsPane');
      expect(res.data).toContain('function updateAllTabPanes');
    });

    test('HTML contains switchTab function', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/');

      expect(res.data).toContain('function switchTab');
    });
  });

  describe('Dashboard v4: Keyboard Shortcuts', () => {
    test('HTML contains keyboard handler for tab switching (1-5)', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/');

      // Check for keyboard handler that switches tabs with number keys
      expect(res.data).toContain("switchTab('overview')");
      expect(res.data).toContain("switchTab('tasks')");
      expect(res.data).toContain("switchTab('hierarchy')");
      expect(res.data).toContain("switchTab('details')");
      expect(res.data).toContain("switchTab('logs')");
    });

    test('HTML contains n key shortcut for new session', async () => {
      if (!serverRunning) return;

      const res = await httpRequest('GET', '/');

      expect(res.data).toContain("case 'n':");
      expect(res.data).toContain('openNewSessionModal()');
    });
  });
});
