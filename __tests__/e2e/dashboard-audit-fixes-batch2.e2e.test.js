/**
 * E2E Tests for Dashboard Audit Fixes - Batch 2
 *
 * Tests for Issues: 1.1, 2.1, 2.2, 2.3, 4.2, 4.3, 5.1, 5.3
 * - Session deduplication and TOCTOU race prevention
 * - Stale session grace period
 * - SSE reconnection recovery
 * - SSE state change events
 * - SSE heartbeats
 * - OTLP project isolation
 * - Per-project cleanup configuration
 */

const { SessionRegistry } = require('../../.claude/core/session-registry');
const GlobalContextTracker = require('../../.claude/core/global-context-tracker');
const EventEmitter = require('events');

describe('Dashboard Audit Fixes - Batch 2 E2E', () => {
  // ========================================
  // Issue 1.1 + 2.1: Session Deduplication E2E
  // ========================================
  describe('Session Deduplication (Issues 1.1, 2.1)', () => {
    let registry;

    beforeEach(() => {
      registry = new SessionRegistry({
        persistenceEnabled: false,
        cleanupInterval: 300000
      });
    });

    afterEach(() => {
      registry.shutdown();
    });

    it('E2E: Parallel hook and orchestrator registration creates single session', async () => {
      const claudeSessionId = 'e2e-parallel-registration';

      // Simulate parallel registrations from hook and orchestrator
      const [hookResult, orchestratorResult] = await Promise.all([
        registry.registerWithDeduplication(claudeSessionId, {
          project: 'test-project',
          sessionType: 'cli'
        }),
        registry.registerWithDeduplication(claudeSessionId, {
          project: 'test-project',
          sessionType: 'autonomous',
          orchestratorInfo: { pid: 12345, model: 'claude-opus-4-5' }
        })
      ]);

      // Should produce single session
      expect(hookResult.id).toBe(orchestratorResult.id);

      // Session should be autonomous (upgraded from CLI)
      const session = registry.get(hookResult.id);
      expect(session.sessionType).toBe('autonomous');
      expect(session.autonomous).toBe(true);
    });

    it('E2E: Multiple rapid registrations from same claudeSessionId deduplicate', async () => {
      const claudeSessionId = 'e2e-rapid-registration';

      // Simulate 20 rapid registration attempts
      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          registry.registerWithDeduplication(claudeSessionId, {
            project: 'test-project',
            sessionType: i % 2 === 0 ? 'cli' : 'autonomous'
          })
        );
      }

      const results = await Promise.all(promises);

      // All should return same ID
      const uniqueIds = [...new Set(results.map(r => r.id))];
      expect(uniqueIds).toHaveLength(1);

      // Exactly one non-deduplicated
      const nonDeduplicated = results.filter(r => !r.deduplicated);
      expect(nonDeduplicated).toHaveLength(1);
    });
  });

  // ========================================
  // Issue 2.2 + 2.3: Stale Session Recovery E2E
  // ========================================
  describe('Stale Session Recovery (Issues 2.2, 2.3)', () => {
    let registry;

    beforeEach(() => {
      registry = new SessionRegistry({
        staleTimeout: 100, // 100ms
        staleGracePeriod: 300, // 300ms grace
        cleanupInterval: 50,
        persistenceEnabled: false
      });
    });

    afterEach(() => {
      registry.shutdown();
    });

    it('E2E: SSE reconnection within grace period recovers session', async () => {
      const claudeSessionId = 'e2e-reconnection';

      // Initial connection
      const initial = await registry.registerWithDeduplication(claudeSessionId, {
        project: 'test-project',
        sessionType: 'autonomous',
        status: 'active'
      });

      // Simulate disconnection - session goes stale
      await new Promise(r => setTimeout(r, 150));
      registry._cleanupStaleSessions();

      // Verify stale
      expect(registry.get(initial.id).status).toBe('stale');

      // Reconnect within grace period
      const reconnect = await registry.registerWithDeduplication(claudeSessionId, {
        project: 'test-project',
        sessionType: 'autonomous',
        status: 'active'
      });

      // Should recover same session
      expect(reconnect.id).toBe(initial.id);
      expect(reconnect.deduplicated).toBe(true);

      // Session should be active again
      expect(registry.get(reconnect.id).status).toBe('active');
    });

    it('E2E: Reconnection after grace period creates new session', async () => {
      const claudeSessionId = 'e2e-late-reconnection';

      // Initial connection
      const initial = await registry.registerWithDeduplication(claudeSessionId, {
        project: 'test-project'
      });

      // Wait for stale + grace period to expire
      await new Promise(r => setTimeout(r, 150));
      registry._cleanupStaleSessions();
      await new Promise(r => setTimeout(r, 350));
      registry._cleanupStaleSessions();

      // Original session should be gone
      expect(registry.get(initial.id)).toBeNull();

      // Reconnect creates new session
      const reconnect = await registry.registerWithDeduplication(claudeSessionId, {
        project: 'test-project'
      });

      expect(reconnect.id).not.toBe(initial.id);
      expect(reconnect.deduplicated).toBe(false);
    });
  });

  // ========================================
  // Issue 4.2: SSE State Change Events E2E
  // ========================================
  describe('SSE State Change Events (Issue 4.2)', () => {
    let registry;
    let eventLog;

    beforeEach(() => {
      registry = new SessionRegistry({
        persistenceEnabled: false,
        cleanupInterval: 300000
      });
      eventLog = [];

      // Listen to all events
      registry.on('session:updated', (data) => {
        eventLog.push({ type: 'updated', ...data });
      });
    });

    afterEach(() => {
      registry.shutdown();
    });

    it('E2E: Phase changes emit session:updated with changes', () => {
      const id = registry.register({ project: 'test' });

      // Update phase
      registry.update(id, { phase: 'implementation' });

      // Should have emitted update event
      const phaseEvents = eventLog.filter(e =>
        e.type === 'updated' && e.changes?.phase === 'implementation'
      );
      expect(phaseEvents.length).toBeGreaterThan(0);
    });

    it('E2E: Quality score changes emit session:updated', () => {
      const id = registry.register({ project: 'test', qualityScore: 50 });

      // Update quality
      registry.update(id, { qualityScore: 85 });

      const qualityEvents = eventLog.filter(e =>
        e.type === 'updated' && e.changes?.qualityScore === 85
      );
      expect(qualityEvents.length).toBeGreaterThan(0);
    });

    it('E2E: Confidence score changes emit session:updated', () => {
      const id = registry.register({ project: 'test', confidenceScore: 100 });

      // Update confidence
      registry.update(id, { confidenceScore: 75 });

      const confidenceEvents = eventLog.filter(e =>
        e.type === 'updated' && e.changes?.confidenceScore === 75
      );
      expect(confidenceEvents.length).toBeGreaterThan(0);
    });
  });

  // ========================================
  // Issue 5.1: OTLP Project Isolation E2E
  // ========================================
  describe('OTLP Project Isolation (Issue 5.1)', () => {
    let tracker;

    beforeEach(() => {
      tracker = new GlobalContextTracker({
        claudeProjectsPath: '/tmp/test-projects',
        inactiveThresholdMs: 60000
      });
    });

    afterEach(() => {
      tracker.stop();
    });

    it('E2E: OTLP metric without project falls back correctly', () => {
      // Add a known project with a session
      tracker.projects.set('project-a', {
        folder: 'project-a',
        path: '/path/to/project-a',
        sessions: new Map([['session-1', { id: 'session-1', lastUpdate: Date.now() }]]),
        currentSessionId: 'session-1',
        metrics: { lastUpdate: Date.now() }
      });

      // Add another project
      tracker.projects.set('project-b', {
        folder: 'project-b',
        path: '/path/to/project-b',
        sessions: new Map(),
        currentSessionId: null,
        metrics: { lastUpdate: Date.now() - 10000 }
      });

      // OTLP for unknown session without project folder
      const result = tracker.processOTLPMetric({
        name: 'claude_code.token.usage',
        attributes: {
          'conversation.id': 'unknown-session'
        }
      });

      // Should NOT fall back to most recent project
      expect(result).toBe(0); // Rejected - no project folder, no fallback
    });

    it('E2E: OTLP metric with explicit project routes correctly', () => {
      // Add project with full structure
      tracker.projects.set('explicit-project', {
        folder: 'explicit-project',
        path: '/path/to/explicit-project',
        name: 'explicit-project',
        sessions: new Map(),
        currentSessionId: null,
        status: 'active',
        metrics: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          contextUsed: 0,
          contextPercent: 0,
          messageCount: 0,
          cost: 0,
          model: null,
          lastUpdate: null
        },
        checkpointState: {
          warningTriggered: false,
          criticalTriggered: false,
          emergencyTriggered: false
        }
      });

      // OTLP with explicit project folder (passed as 2nd argument like global-context-manager does)
      const metric = {
        name: 'claude_code.token.usage',
        attributes: {
          'conversation.id': 'new-session',
          'project.folder': 'explicit-project',
          'gen_ai.usage.input_tokens': 100
        }
      };
      // Extract project folder like the caller does
      const projectFolder = metric.attributes?.['project.folder'] || null;
      tracker.processOTLPMetric(metric, projectFolder);

      // Should route to explicit project
      const project = tracker.projects.get('explicit-project');
      expect(project.sessions.has('new-session')).toBe(true);
    });
  });

  // ========================================
  // Issue 5.3: Per-Project Cleanup Config E2E
  // ========================================
  describe('Per-Project Cleanup Configuration (Issue 5.3)', () => {
    let tracker;

    beforeEach(() => {
      tracker = new GlobalContextTracker({
        claudeProjectsPath: '/tmp/test-projects',
        inactiveThresholdMs: 10 * 60 * 1000 // 10 minutes default
      });
    });

    afterEach(() => {
      tracker.stop();
    });

    it('E2E: Per-project config overrides global defaults', () => {
      // Set per-project config
      tracker.setProjectCleanupConfig('fast-cleanup-project', {
        inactiveThresholdMs: 1 * 60 * 1000 // 1 minute
      });

      tracker.setProjectCleanupConfig('slow-cleanup-project', {
        inactiveThresholdMs: 60 * 60 * 1000 // 1 hour
      });

      // Check configs
      const fastConfig = tracker.getProjectCleanupConfig('fast-cleanup-project');
      const slowConfig = tracker.getProjectCleanupConfig('slow-cleanup-project');
      const defaultConfig = tracker.getProjectCleanupConfig('no-config-project');

      expect(fastConfig.inactiveThresholdMs).toBe(1 * 60 * 1000);
      expect(slowConfig.inactiveThresholdMs).toBe(60 * 60 * 1000);
      expect(defaultConfig.inactiveThresholdMs).toBe(10 * 60 * 1000); // Global default
    });

    it('E2E: Cleanup uses per-project thresholds', () => {
      const now = Date.now();

      // Create projects with different cleanup configs
      tracker.setProjectCleanupConfig('fast-project', {
        inactiveThresholdMs: 100 // 100ms
      });

      tracker.setProjectCleanupConfig('slow-project', {
        inactiveThresholdMs: 10 * 60 * 1000 // 10 minutes
      });

      // Add sessions to both projects with full structure
      tracker.projects.set('fast-project', {
        folder: 'fast-project',
        path: '/path/to/fast-project',
        name: 'fast-project',
        sessions: new Map([
          ['session-fast', { id: 'session-fast', lastUpdate: now - 200, filepath: null }]
        ]),
        currentSessionId: null,
        status: 'idle',
        metrics: {
          inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
          contextUsed: 0, contextPercent: 0, messageCount: 0, cost: 0, model: null, lastUpdate: null
        },
        checkpointState: { warningTriggered: false, criticalTriggered: false, emergencyTriggered: false }
      });

      tracker.projects.set('slow-project', {
        folder: 'slow-project',
        path: '/path/to/slow-project',
        name: 'slow-project',
        sessions: new Map([
          ['session-slow', { id: 'session-slow', lastUpdate: now - 200, filepath: null }]
        ]),
        currentSessionId: null,
        status: 'idle',
        metrics: {
          inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
          contextUsed: 0, contextPercent: 0, messageCount: 0, cost: 0, model: null, lastUpdate: null
        },
        checkpointState: { warningTriggered: false, criticalTriggered: false, emergencyTriggered: false }
      });

      // Run cleanup
      const stats = tracker.cleanupInactiveSessions();

      // Fast project session should be removed (200ms > 100ms threshold)
      // Slow project session should remain (200ms < 10min threshold)
      expect(tracker.projects.get('fast-project').sessions.size).toBe(0);
      expect(tracker.projects.get('slow-project').sessions.size).toBe(1);
      expect(stats.sessionsRemoved).toBe(1);
    });
  });

  // ========================================
  // Integration: Full Registration Flow
  // ========================================
  describe('Integration: Full Registration Flow', () => {
    let registry;

    beforeEach(() => {
      registry = new SessionRegistry({
        persistenceEnabled: false,
        staleTimeout: 100,
        staleGracePeriod: 200,
        cleanupInterval: 50
      });
    });

    afterEach(() => {
      registry.shutdown();
    });

    it('E2E: Full session lifecycle - register, upgrade, stale, recover', async () => {
      const claudeSessionId = 'e2e-full-lifecycle';
      const events = [];

      // Track events
      registry.on('session:registered', (s) => events.push({ type: 'registered', id: s.id }));
      registry.on('session:updated', (d) => events.push({ type: 'updated', id: d.session.id, changes: d.changes }));
      registry.on('session:stale', (s) => events.push({ type: 'stale', id: s.id }));

      // 1. Initial CLI registration
      const cliResult = await registry.registerWithDeduplication(claudeSessionId, {
        project: 'lifecycle-test',
        sessionType: 'cli'
      });
      expect(registry.get(cliResult.id).sessionType).toBe('cli');

      // 2. Upgrade to autonomous
      const autoResult = await registry.registerWithDeduplication(claudeSessionId, {
        project: 'lifecycle-test',
        sessionType: 'autonomous'
      });
      expect(autoResult.upgraded).toBe(true);
      expect(registry.get(autoResult.id).sessionType).toBe('autonomous');

      // 3. Session goes stale
      await new Promise(r => setTimeout(r, 150));
      registry._cleanupStaleSessions();
      expect(registry.get(cliResult.id).status).toBe('stale');

      // 4. Recover from stale
      const recoveryResult = await registry.registerWithDeduplication(claudeSessionId, {
        project: 'lifecycle-test',
        sessionType: 'autonomous',
        status: 'active'
      });
      expect(recoveryResult.id).toBe(cliResult.id);
      expect(registry.get(recoveryResult.id).status).toBe('active');

      // Verify event sequence
      const eventTypes = events.map(e => e.type);
      expect(eventTypes).toContain('registered');
      expect(eventTypes).toContain('updated');
      expect(eventTypes).toContain('stale');
    });
  });
});
