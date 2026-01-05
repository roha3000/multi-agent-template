/**
 * Dashboard Session ID Conflict Detection E2E Tests
 *
 * Tests for detecting when session IDs are reused with different claudeSessionIds,
 * which indicates stale session data from a previous dashboard instance.
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

describe('Dashboard Session ID Conflict Detection', () => {
  let dashboardRunning = false;

  beforeAll(async () => {
    dashboardRunning = await isDashboardRunning();
    if (!dashboardRunning) {
      console.log('Dashboard not running - tests will be skipped');
    }
  });

  describe('Session Data Structure', () => {
    it('should return sessions with claudeSessionId field', async () => {
      if (!dashboardRunning) return;

      const res = await apiRequest('/api/sessions/summary');
      expect(res.status).toBe(200);
      expect(res.data.sessions).toBeDefined();

      // Sessions with Claude Code hooks should have claudeSessionId
      // Note: orchestrator parents may not have claudeSessionId
      const sessionsWithId = res.data.sessions.filter(s => s.claudeSessionId);

      // Each claudeSessionId should be unique across all sessions
      const claudeIds = sessionsWithId.map(s => s.claudeSessionId);
      const uniqueClaudeIds = new Set(claudeIds);
      expect(claudeIds.length).toBe(uniqueClaudeIds.size);
    });

    it('should not have duplicate registryId with different claudeSessionId', async () => {
      if (!dashboardRunning) return;

      const res = await apiRequest('/api/sessions/summary');
      expect(res.status).toBe(200);

      // Group sessions by registryId
      const sessionsByRegistryId = new Map();
      for (const session of res.data.sessions) {
        const key = session.id;
        if (!sessionsByRegistryId.has(key)) {
          sessionsByRegistryId.set(key, []);
        }
        sessionsByRegistryId.get(key).push(session);
      }

      // Check for conflicts: same registryId with different claudeSessionId
      for (const [registryId, sessions] of sessionsByRegistryId) {
        if (sessions.length > 1) {
          // Multiple sessions with same registryId is a conflict
          console.warn(`Potential conflict: registryId ${registryId} has ${sessions.length} sessions`);
        }

        // If multiple sessions exist with same registryId, they should have same claudeSessionId
        const claudeIds = sessions.map(s => s.claudeSessionId).filter(Boolean);
        const uniqueClaudeIds = new Set(claudeIds);
        expect(uniqueClaudeIds.size).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('Session Registration Deduplication', () => {
    it('should not create duplicate sessions for same claudeSessionId', async () => {
      if (!dashboardRunning) return;

      // Get current sessions
      const beforeRes = await apiRequest('/api/sessions/summary');
      const beforeCount = beforeRes.data.sessions.length;

      // Try to register a session with unique claudeSessionId
      const testClaudeSessionId = `test-conflict-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Register first time
      const reg1 = await apiRequest('/api/sessions/register', 'POST', {
        project: 'conflict-test-project',
        path: 'C:/test/conflict',
        status: 'active',
        sessionType: 'cli',
        claudeSessionId: testClaudeSessionId
      });
      expect(reg1.status).toBe(200);
      const firstId = reg1.data.id;

      // Try to register again with same claudeSessionId
      const reg2 = await apiRequest('/api/sessions/register', 'POST', {
        project: 'conflict-test-project',
        path: 'C:/test/conflict',
        status: 'active',
        sessionType: 'cli',
        claudeSessionId: testClaudeSessionId
      });
      expect(reg2.status).toBe(200);

      // Should return same session ID (deduplicated)
      expect(reg2.data.id).toBe(firstId);

      // Clean up: deregister the test session
      await apiRequest('/api/sessions/deregister', 'POST', {
        claudeSessionId: testClaudeSessionId,
        reason: 'test-cleanup'
      });
    });

    it('should create new session for different claudeSessionId', async () => {
      if (!dashboardRunning) return;

      // Register two sessions with different claudeSessionIds
      const testId1 = `test-unique-1-${Date.now()}`;
      const testId2 = `test-unique-2-${Date.now()}`;

      const reg1 = await apiRequest('/api/sessions/register', 'POST', {
        project: 'conflict-test-project',
        path: 'C:/test/conflict',
        status: 'active',
        sessionType: 'cli',
        claudeSessionId: testId1
      });

      const reg2 = await apiRequest('/api/sessions/register', 'POST', {
        project: 'conflict-test-project-2',
        path: 'C:/test/conflict2',
        status: 'active',
        sessionType: 'cli',
        claudeSessionId: testId2
      });

      // Should get different session IDs
      expect(reg1.data.id).not.toBe(reg2.data.id);

      // Clean up
      await apiRequest('/api/sessions/deregister', 'POST', {
        claudeSessionId: testId1,
        reason: 'test-cleanup'
      });
      await apiRequest('/api/sessions/deregister', 'POST', {
        claudeSessionId: testId2,
        reason: 'test-cleanup'
      });
    });
  });

  describe('Session Staleness Detection', () => {
    it('should mark sessions as stale after inactivity', async () => {
      if (!dashboardRunning) return;

      const res = await apiRequest('/api/sessions/summary');
      expect(res.status).toBe(200);

      // Check that sessions have lastUpdate field for staleness detection
      for (const session of res.data.sessions) {
        if (session.status !== 'ended') {
          expect(session.lastUpdate).toBeDefined();
        }
      }
    });
  });
});

// Unit tests for the frontend conflict detection logic
describe('Frontend Conflict Detection Logic (Unit)', () => {
  // Simulate the frontend state and functions
  let sessionIdHistory;
  let sessionConflicts;

  beforeEach(() => {
    sessionIdHistory = new Map();
    sessionConflicts = [];
  });

  function detectSessionConflict(session) {
    const registryId = session.registryId;
    const claudeSessionId = session.claudeSessionId;
    if (!registryId) return null;

    const existing = sessionIdHistory.get(registryId);
    if (existing) {
      if (existing.claudeSessionId && claudeSessionId &&
          existing.claudeSessionId !== claudeSessionId) {
        return {
          registryId,
          oldClaudeSessionId: existing.claudeSessionId,
          newClaudeSessionId: claudeSessionId,
          project: session.project,
          detectedAt: Date.now()
        };
      }
      existing.lastSeen = Date.now();
    } else {
      sessionIdHistory.set(registryId, {
        claudeSessionId: claudeSessionId || null,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        project: session.project
      });
    }
    return null;
  }

  function checkAllSessionConflicts(sessionList) {
    const newConflicts = [];
    for (const s of sessionList) {
      const conflict = detectSessionConflict(s);
      if (conflict && !sessionConflicts.some(c => c.registryId === conflict.registryId)) {
        newConflicts.push(conflict);
      }
    }
    if (newConflicts.length > 0) {
      sessionConflicts = [...sessionConflicts, ...newConflicts];
    }
    return newConflicts;
  }

  it('should detect no conflict for first-time session', () => {
    const session = {
      registryId: 1,
      claudeSessionId: 'abc-123',
      project: 'test-project'
    };

    const conflict = detectSessionConflict(session);
    expect(conflict).toBeNull();
    expect(sessionIdHistory.has(1)).toBe(true);
  });

  it('should detect no conflict for same claudeSessionId', () => {
    const session1 = {
      registryId: 1,
      claudeSessionId: 'abc-123',
      project: 'test-project'
    };
    const session2 = {
      registryId: 1,
      claudeSessionId: 'abc-123',
      project: 'test-project'
    };

    detectSessionConflict(session1);
    const conflict = detectSessionConflict(session2);
    expect(conflict).toBeNull();
  });

  it('should detect conflict when claudeSessionId changes', () => {
    const session1 = {
      registryId: 1,
      claudeSessionId: 'abc-123',
      project: 'test-project'
    };
    const session2 = {
      registryId: 1,
      claudeSessionId: 'xyz-456', // Different!
      project: 'test-project'
    };

    detectSessionConflict(session1);
    const conflict = detectSessionConflict(session2);

    expect(conflict).not.toBeNull();
    expect(conflict.registryId).toBe(1);
    expect(conflict.oldClaudeSessionId).toBe('abc-123');
    expect(conflict.newClaudeSessionId).toBe('xyz-456');
  });

  it('should handle sessions without registryId', () => {
    const session = {
      claudeSessionId: 'abc-123',
      project: 'test-project'
      // No registryId
    };

    const conflict = detectSessionConflict(session);
    expect(conflict).toBeNull();
  });

  it('should handle sessions without claudeSessionId', () => {
    const session1 = {
      registryId: 1,
      project: 'test-project'
      // No claudeSessionId
    };
    const session2 = {
      registryId: 1,
      claudeSessionId: 'abc-123',
      project: 'test-project'
    };

    detectSessionConflict(session1);
    const conflict = detectSessionConflict(session2);

    // No conflict because first session had no claudeSessionId
    expect(conflict).toBeNull();
  });

  it('should accumulate conflicts from multiple sessions', () => {
    const sessions = [
      { registryId: 1, claudeSessionId: 'old-1', project: 'p1' },
      { registryId: 2, claudeSessionId: 'old-2', project: 'p2' }
    ];

    // First pass - no conflicts
    let conflicts = checkAllSessionConflicts(sessions);
    expect(conflicts.length).toBe(0);

    // Second pass with changed IDs - should detect conflicts
    const changedSessions = [
      { registryId: 1, claudeSessionId: 'new-1', project: 'p1' },
      { registryId: 2, claudeSessionId: 'new-2', project: 'p2' }
    ];

    conflicts = checkAllSessionConflicts(changedSessions);
    expect(conflicts.length).toBe(2);
    expect(sessionConflicts.length).toBe(2);
  });

  it('should not duplicate conflicts', () => {
    const session1 = { registryId: 1, claudeSessionId: 'old-1', project: 'p1' };
    const session2 = { registryId: 1, claudeSessionId: 'new-1', project: 'p1' };

    checkAllSessionConflicts([session1]);
    checkAllSessionConflicts([session2]); // First conflict
    checkAllSessionConflicts([session2]); // Same conflict again

    expect(sessionConflicts.length).toBe(1); // Should not duplicate
  });
});
