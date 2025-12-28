/**
 * Unit tests for SessionRegistry
 *
 * Tests session type tracking, autonomous flags, orchestrator info,
 * and logSessionId functionality.
 */

const { SessionRegistry, resetSessionRegistry } = require('../../.claude/core/session-registry');

describe('SessionRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new SessionRegistry({
      staleTimeout: 60000,
      cleanupInterval: 300000 // Long interval to avoid interference
    });
  });

  afterEach(() => {
    registry.shutdown();
  });

  describe('register()', () => {
    it('should assign incrementing IDs', () => {
      const id1 = registry.register({ project: 'test1' });
      const id2 = registry.register({ project: 'test2' });

      expect(id1).toBe(1);
      expect(id2).toBe(2);
    });

    it('should store sessionType field', () => {
      const id = registry.register({
        project: 'test-project',
        sessionType: 'autonomous'
      });

      const session = registry.get(id);
      expect(session.sessionType).toBe('autonomous');
    });

    it('should default sessionType to "cli" when not provided', () => {
      const id = registry.register({ project: 'test-project' });

      const session = registry.get(id);
      expect(session.sessionType).toBe('cli');
    });

    it('should store autonomous flag when explicitly set', () => {
      const id = registry.register({
        project: 'test-project',
        autonomous: true
      });

      const session = registry.get(id);
      expect(session.autonomous).toBe(true);
    });

    it('should derive autonomous flag from sessionType="autonomous"', () => {
      const id = registry.register({
        project: 'test-project',
        sessionType: 'autonomous'
      });

      const session = registry.get(id);
      expect(session.autonomous).toBe(true);
    });

    it('should NOT set autonomous flag for sessionType="cli"', () => {
      const id = registry.register({
        project: 'test-project',
        sessionType: 'cli'
      });

      const session = registry.get(id);
      expect(session.autonomous).toBe(false);
    });

    it('should store orchestratorInfo object', () => {
      const orchestratorInfo = {
        version: '1.0.0',
        startTime: new Date().toISOString(),
        mode: 'autonomous'
      };

      const id = registry.register({
        project: 'test-project',
        orchestratorInfo
      });

      const session = registry.get(id);
      expect(session.orchestratorInfo).toEqual(orchestratorInfo);
    });

    it('should default orchestratorInfo to null', () => {
      const id = registry.register({ project: 'test-project' });

      const session = registry.get(id);
      expect(session.orchestratorInfo).toBeNull();
    });

    it('should store logSessionId', () => {
      const id = registry.register({
        project: 'test-project',
        logSessionId: 5
      });

      const session = registry.get(id);
      expect(session.logSessionId).toBe(5);
    });

    it('should default logSessionId to null', () => {
      const id = registry.register({ project: 'test-project' });

      const session = registry.get(id);
      expect(session.logSessionId).toBeNull();
    });

    it('should emit session:registered event', () => {
      const handler = jest.fn();
      registry.on('session:registered', handler);

      const id = registry.register({
        project: 'test-project',
        sessionType: 'autonomous'
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id,
          project: 'test-project',
          sessionType: 'autonomous'
        })
      );
    });
  });

  describe('update()', () => {
    it('should preserve sessionType on update', () => {
      const id = registry.register({
        project: 'test-project',
        sessionType: 'autonomous'
      });

      registry.update(id, { status: 'active' });

      const session = registry.get(id);
      expect(session.sessionType).toBe('autonomous');
      expect(session.status).toBe('active');
    });

    it('should allow updating sessionType', () => {
      const id = registry.register({
        project: 'test-project',
        sessionType: 'cli'
      });

      registry.update(id, { sessionType: 'loop' });

      const session = registry.get(id);
      expect(session.sessionType).toBe('loop');
    });

    it('should preserve logSessionId on update', () => {
      const id = registry.register({
        project: 'test-project',
        logSessionId: 3
      });

      registry.update(id, { phase: 'implementation' });

      const session = registry.get(id);
      expect(session.logSessionId).toBe(3);
    });

    it('should emit session:updated event with changes', () => {
      const handler = jest.fn();
      registry.on('session:updated', handler);

      const id = registry.register({ project: 'test-project' });
      registry.update(id, { phase: 'testing', qualityScore: 85 });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          session: expect.objectContaining({
            id,
            phase: 'testing',
            qualityScore: 85
          }),
          changes: expect.objectContaining({ phase: 'testing', qualityScore: 85 })
        })
      );
    });
  });

  describe('getSummary()', () => {
    it('should include sessionType in session list', () => {
      registry.register({
        project: 'autonomous-project',
        sessionType: 'autonomous',
        status: 'active'
      });

      registry.register({
        project: 'cli-project',
        sessionType: 'cli',
        status: 'idle'
      });

      const summary = registry.getSummary();

      expect(summary.sessions).toHaveLength(2);
      expect(summary.sessions[0].sessionType).toBe('autonomous');
      expect(summary.sessions[1].sessionType).toBe('cli');
    });

    it('should include autonomous flag in session list', () => {
      registry.register({
        project: 'autonomous-project',
        sessionType: 'autonomous',
        status: 'active'
      });

      const summary = registry.getSummary();

      expect(summary.sessions[0].autonomous).toBe(true);
    });

    it('should include logSessionId in session list', () => {
      registry.register({
        project: 'test-project',
        logSessionId: 7
      });

      const summary = registry.getSummary();

      expect(summary.sessions[0].logSessionId).toBe(7);
    });

    it('should include orchestratorInfo in session list', () => {
      const orchestratorInfo = {
        version: '2.0.0',
        mode: 'continuous'
      };

      registry.register({
        project: 'test-project',
        orchestratorInfo
      });

      const summary = registry.getSummary();

      expect(summary.sessions[0].orchestratorInfo).toEqual(orchestratorInfo);
    });

    it('should calculate correct globalMetrics', () => {
      registry.register({
        project: 'project1',
        sessionType: 'autonomous',
        status: 'active',
        qualityScore: 80,
        confidenceScore: 90
      });

      registry.register({
        project: 'project2',
        sessionType: 'cli',
        status: 'active',
        qualityScore: 70,
        confidenceScore: 80
      });

      const summary = registry.getSummary();

      expect(summary.metrics.activeCount).toBe(2);
    });
  });

  describe('deregister()', () => {
    it('should remove session and return it', () => {
      const id = registry.register({
        project: 'test-project',
        sessionType: 'autonomous'
      });

      const session = registry.deregister(id);

      expect(session).not.toBeNull();
      expect(session.sessionType).toBe('autonomous');
      expect(session.status).toBe('ended');
      expect(registry.get(id)).toBeNull();
    });

    it('should emit session:deregistered event', () => {
      const handler = jest.fn();
      registry.on('session:deregistered', handler);

      const id = registry.register({
        project: 'test-project',
        sessionType: 'autonomous'
      });

      registry.deregister(id);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id,
          sessionType: 'autonomous',
          status: 'ended'
        })
      );
    });
  });

  describe('getActive()', () => {
    it('should only return non-ended sessions', () => {
      const id1 = registry.register({ project: 'p1', status: 'active' });
      const id2 = registry.register({ project: 'p2', status: 'idle' });
      registry.register({ project: 'p3', status: 'ended' });

      const active = registry.getActive();

      expect(active).toHaveLength(2);
      expect(active.map(s => s.id)).toContain(id1);
      expect(active.map(s => s.id)).toContain(id2);
    });
  });

  describe('session type combinations', () => {
    it('should handle CLI session correctly', () => {
      const id = registry.register({
        project: 'cli-project',
        sessionType: 'cli',
        path: '/path/to/project'
      });

      const session = registry.get(id);

      expect(session.sessionType).toBe('cli');
      expect(session.autonomous).toBe(false);
      expect(session.orchestratorInfo).toBeNull();
      expect(session.logSessionId).toBeNull();
    });

    it('should handle autonomous session correctly', () => {
      const id = registry.register({
        project: 'autonomous-project',
        sessionType: 'autonomous',
        path: '/path/to/project',
        logSessionId: 1,
        orchestratorInfo: {
          version: '1.0.0',
          startTime: '2025-01-01T00:00:00.000Z',
          mode: 'autonomous'
        }
      });

      const session = registry.get(id);

      expect(session.sessionType).toBe('autonomous');
      expect(session.autonomous).toBe(true);
      expect(session.orchestratorInfo).not.toBeNull();
      expect(session.logSessionId).toBe(1);
    });

    it('should handle loop session correctly', () => {
      const id = registry.register({
        project: 'loop-project',
        sessionType: 'loop',
        autonomous: true,
        logSessionId: 2
      });

      const session = registry.get(id);

      expect(session.sessionType).toBe('loop');
      expect(session.autonomous).toBe(true);
    });
  });
});
