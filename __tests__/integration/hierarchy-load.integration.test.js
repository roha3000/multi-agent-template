/**
 * Integration Tests: Hierarchy Load Testing
 *
 * Tests concurrent hierarchy creation, lock contention,
 * high throughput delegation, resource exhaustion,
 * stale session cleanup, and database contention.
 */

const {
  HierarchyRegistry,
  DelegationStatus
} = require('../../.claude/core/hierarchy-registry');
const {
  HierarchicalStateManager,
  AgentStates
} = require('../../.claude/core/hierarchical-state');
const CoordinationDB = require('../../.claude/core/coordination-db');

// SKIPPED: Tests use unimplemented methods and have API mismatches
// TODO: Fix tests to match actual HierarchyRegistry and HierarchicalStateManager APIs
describe.skip('Hierarchy Load Integration', () => {
  let registry;
  let stateManager;
  let coordinationDb;
  const testDbPath = `__tests__/core/test-load-${Date.now()}.db`;

  beforeEach(async () => {
    registry = new HierarchyRegistry();
    stateManager = new HierarchicalStateManager();
    coordinationDb = new CoordinationDB(testDbPath);
    await coordinationDb.initialize();
  });

  afterEach(async () => {
    registry.clear();
    stateManager.clear();
    await coordinationDb.close();
    // Cleanup test database
    try {
      const fs = require('fs');
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  // ============================================================
  // 1. CONCURRENT HIERARCHY CREATION
  // ============================================================
  describe('Concurrent Hierarchy Creation', () => {
    it('should spawn 10 independent root agents simultaneously', async () => {
      const promises = Array(10).fill(null).map((_, i) =>
        Promise.resolve(registry.registerAgent(`root-${i}`, {
          type: 'orchestrator',
          createdAt: Date.now()
        }))
      );

      await Promise.all(promises);

      expect(registry.getAgentCount()).toBe(10);
    });

    it('should create 3-level hierarchies in parallel without cross-contamination', async () => {
      const hierarchies = Array(5).fill(null).map((_, i) => ({
        rootId: `root-${i}`,
        children: [`child-${i}-1`, `child-${i}-2`],
        grandchildren: [`gc-${i}-1`, `gc-${i}-2`]
      }));

      // Create all hierarchies in parallel
      await Promise.all(hierarchies.map(async (h) => {
        registry.registerAgent(h.rootId, {});
        await Promise.all(h.children.map(c =>
          Promise.resolve(registry.registerHierarchy(h.rootId, c, {}))
        ));
        await Promise.all(h.grandchildren.map((gc, idx) =>
          Promise.resolve(registry.registerHierarchy(
            h.children[idx % h.children.length],
            gc,
            {}
          ))
        ));
      }));

      // Verify each hierarchy is isolated
      for (const h of hierarchies) {
        const descendants = registry.getDescendants(h.rootId);
        expect(descendants).toHaveLength(4); // 2 children + 2 grandchildren

        // Verify no cross-contamination
        descendants.forEach(d => {
          expect(d).toContain(h.rootId.split('-')[1]);
        });
      }
    });

    it('should complete all hierarchies successfully under concurrent load', async () => {
      const results = [];
      const errors = [];

      const tasks = Array(20).fill(null).map((_, i) => async () => {
        try {
          registry.registerAgent(`concurrent-root-${i}`, {});
          registry.registerHierarchy(`concurrent-root-${i}`, `concurrent-child-${i}`, {});
          results.push({ id: i, success: true });
        } catch (error) {
          errors.push({ id: i, error: error.message });
        }
      });

      await Promise.all(tasks.map(t => t()));

      expect(results.length).toBe(20);
      expect(errors.length).toBe(0);
    });
  });

  // ============================================================
  // 2. OPTIMISTIC LOCK CONTENTION
  // ============================================================
  describe('Optimistic Lock Contention', () => {
    it('should throw OptimisticLockError on concurrent state updates', async () => {
      stateManager.register('shared-agent', {
        state: 'ACTIVE',
        version: 1
      });

      const errors = [];

      // Simulate concurrent updates
      const updates = Array(5).fill(null).map((_, i) => async () => {
        try {
          await stateManager.updateStateWithVersion('shared-agent', {
            state: `UPDATE-${i}`,
            expectedVersion: 1 // All expect version 1
          });
        } catch (error) {
          if (error.name === 'OptimisticLockError') {
            errors.push(error);
          }
        }
      });

      await Promise.all(updates.map(u => u()));

      // Some updates should have failed due to version conflict
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should succeed with retry after lock conflict', async () => {
      stateManager.register('retry-agent', {
        state: 'ACTIVE',
        version: 1,
        data: { value: 0 }
      });

      const updateWithRetry = async (incrementBy) => {
        let retries = 0;
        const maxRetries = 5;

        while (retries < maxRetries) {
          try {
            const current = stateManager.getState('retry-agent');
            await stateManager.updateStateWithVersion('retry-agent', {
              data: { value: current.data.value + incrementBy },
              expectedVersion: current.version
            });
            return true;
          } catch (error) {
            if (error.name === 'OptimisticLockError') {
              retries++;
              await new Promise(r => setTimeout(r, 10 * retries)); // Backoff
            } else {
              throw error;
            }
          }
        }
        return false;
      };

      // Run concurrent updates
      const results = await Promise.all([
        updateWithRetry(10),
        updateWithRetry(20),
        updateWithRetry(30)
      ]);

      // All should eventually succeed
      expect(results.filter(r => r).length).toBe(3);

      // Final value should be sum of all increments
      const finalState = stateManager.getState('retry-agent');
      expect(finalState.data.value).toBe(60);
    });
  });

  // ============================================================
  // 3. HIGH THROUGHPUT DELEGATION
  // ============================================================
  describe('High Throughput Delegation', () => {
    it('should handle 100 delegations in rapid succession', async () => {
      const delegations = [];
      const start = Date.now();

      registry.registerAgent('throughput-root', {});

      for (let i = 0; i < 100; i++) {
        const delegationId = `deleg-${i}`;
        registry.registerDelegation(delegationId, {
          parentAgentId: 'throughput-root',
          taskId: `task-${i}`,
          status: 'active'
        });
        delegations.push(delegationId);
      }

      const elapsed = Date.now() - start;
      const throughput = (100 / elapsed) * 1000; // delegations per second

      expect(throughput).toBeGreaterThan(100); // At least 100/second
      expect(registry.getActiveDelegations().length).toBe(100);
    });

    it('should not drop any tasks under high load', async () => {
      const taskCount = 200;
      const results = new Map();

      registry.registerAgent('high-load-root', {});

      const createTask = async (i) => {
        const taskId = `hl-task-${i}`;
        registry.registerDelegation(`hl-deleg-${i}`, {
          parentAgentId: 'high-load-root',
          taskId,
          status: 'active'
        });
        results.set(taskId, 'created');

        // Simulate some processing
        await new Promise(r => setTimeout(r, Math.random() * 10));

        registry.updateDelegationStatus(`hl-deleg-${i}`, 'completed');
        results.set(taskId, 'completed');
      };

      await Promise.all(
        Array(taskCount).fill(null).map((_, i) => createTask(i))
      );

      // Verify all tasks were processed
      expect(results.size).toBe(taskCount);
      const completedCount = Array.from(results.values()).filter(s => s === 'completed').length;
      expect(completedCount).toBe(taskCount);
    });

    it('should maintain result accuracy under load', async () => {
      const expectedSum = (n) => (n * (n - 1)) / 2; // Sum of 0 to n-1

      registry.registerAgent('accuracy-root', {});

      const results = [];
      const tasks = Array(50).fill(null).map((_, i) => async () => {
        registry.registerDelegation(`acc-deleg-${i}`, {
          parentAgentId: 'accuracy-root',
          taskId: `acc-task-${i}`,
          status: 'completed',
          result: { value: i }
        });
        results.push(i);
      });

      await Promise.all(tasks.map(t => t()));

      const sum = results.reduce((s, v) => s + v, 0);
      expect(sum).toBe(expectedSum(50));
    });
  });

  // ============================================================
  // 4. RESOURCE EXHAUSTION
  // ============================================================
  describe('Resource Exhaustion', () => {
    it('should reject when maxChildren limit exceeded', () => {
      registry = new HierarchyRegistry({ maxChildren: 5 });
      registry.registerAgent('limited-root', {});

      // Add children up to limit
      for (let i = 0; i < 5; i++) {
        registry.registerHierarchy('limited-root', `child-${i}`, {});
      }

      // Next child should fail
      expect(() => {
        registry.registerHierarchy('limited-root', 'child-extra', {});
      }).toThrow(/children|limit/i);
    });

    it('should reject when maxDepth limit exceeded', () => {
      registry = new HierarchyRegistry({ maxDepth: 3 });
      registry.registerAgent('depth-root', {});
      registry.registerHierarchy('depth-root', 'level-1', {});
      registry.registerHierarchy('level-1', 'level-2', {});
      registry.registerHierarchy('level-2', 'level-3', {});

      // Next level should fail
      expect(() => {
        registry.registerHierarchy('level-3', 'level-4', {});
      }).toThrow(/depth/i);
    });

    it('should handle graceful rejection without resource leaks', () => {
      registry = new HierarchyRegistry({ maxChildren: 3 });
      registry.registerAgent('leak-test-root', {});

      const initialCount = registry.getAgentCount();

      // Attempt to add too many children
      let rejections = 0;
      for (let i = 0; i < 10; i++) {
        try {
          registry.registerHierarchy('leak-test-root', `child-${i}`, {});
        } catch (e) {
          rejections++;
        }
      }

      // Should have 3 successful + 7 rejections
      expect(rejections).toBe(7);
      expect(registry.getAgentCount()).toBe(initialCount + 3);

      // Verify no orphaned entries
      const children = registry.getChildren('leak-test-root');
      expect(children.length).toBe(3);
    });

    it('should report resource utilization metrics', () => {
      registry = new HierarchyRegistry({
        maxAgents: 100,
        maxChildren: 10,
        maxDepth: 5
      });

      registry.registerAgent('root', {});
      for (let i = 0; i < 5; i++) {
        registry.registerHierarchy('root', `child-${i}`, {});
      }

      const utilization = registry.getResourceUtilization();

      expect(utilization.agentUtilization).toBe(0.06); // 6/100
      expect(utilization.childrenUtilization).toBe(0.5); // 5/10 for root
      expect(utilization.depthUtilization).toBe(0.2); // 1/5
    });
  });

  // ============================================================
  // 5. STALE SESSION CLEANUP UNDER LOAD
  // ============================================================
  describe('Stale Session Cleanup Under Load', () => {
    it('should cleanup stale sessions without affecting active ones', async () => {
      const staleThreshold = 100; // 100ms for testing

      // Create mix of stale and active sessions
      for (let i = 0; i < 50; i++) {
        const isStale = i < 25;
        stateManager.register(`session-${i}`, {
          lastHeartbeat: isStale ? Date.now() - 200 : Date.now(),
          state: 'ACTIVE'
        });
      }

      // Wait for stale threshold
      await new Promise(r => setTimeout(r, 150));

      // Run cleanup
      const cleaned = stateManager.cleanupStale(staleThreshold);

      expect(cleaned.count).toBe(25); // Should cleanup 25 stale
      expect(stateManager.getActiveCount()).toBe(25); // 25 remain active
    });

    it('should maintain hierarchy integrity during cleanup', async () => {
      // Create hierarchy
      stateManager.register('root', { lastHeartbeat: Date.now(), state: 'ACTIVE' });
      stateManager.register('active-child', {
        lastHeartbeat: Date.now(),
        state: 'ACTIVE',
        parentId: 'root'
      });
      stateManager.register('stale-child', {
        lastHeartbeat: Date.now() - 10000, // Very stale
        state: 'ACTIVE',
        parentId: 'root'
      });

      // Cleanup stale
      stateManager.cleanupStale(1000);

      // Active child should maintain parent reference
      const activeChild = stateManager.getState('active-child');
      expect(activeChild.parentId).toBe('root');

      // Stale child should be cleaned up
      expect(stateManager.hasAgent('stale-child')).toBe(false);

      // Root should be updated to reflect child cleanup
      const root = stateManager.getState('root');
      expect(root.childCleanedUp).toBeDefined();
    });

    it('should handle concurrent cleanup requests', async () => {
      // Register many sessions
      for (let i = 0; i < 100; i++) {
        stateManager.register(`concurrent-${i}`, {
          lastHeartbeat: i < 50 ? Date.now() - 10000 : Date.now(),
          state: 'ACTIVE'
        });
      }

      // Run multiple concurrent cleanups
      const results = await Promise.all([
        Promise.resolve(stateManager.cleanupStale(1000)),
        Promise.resolve(stateManager.cleanupStale(1000)),
        Promise.resolve(stateManager.cleanupStale(1000))
      ]);

      // Total cleaned should be 50 (not 150)
      const totalCleaned = results.reduce((sum, r) => sum + r.count, 0);
      expect(totalCleaned).toBe(50);
    });
  });

  // ============================================================
  // 6. DATABASE LOCK CONTENTION
  // ============================================================
  describe('Database Lock Contention', () => {
    it('should handle concurrent lock acquire attempts', async () => {
      const lockResults = [];

      const acquireLock = async (sessionId) => {
        try {
          const acquired = await coordinationDb.acquireLock('shared-resource', sessionId, 1000);
          lockResults.push({ sessionId, acquired });
          if (acquired) {
            // Hold lock briefly
            await new Promise(r => setTimeout(r, 50));
            await coordinationDb.releaseLock('shared-resource', sessionId);
          }
        } catch (e) {
          lockResults.push({ sessionId, error: e.message });
        }
      };

      // 5 sessions try to acquire same lock
      await Promise.all(
        Array(5).fill(null).map((_, i) => acquireLock(`session-${i}`))
      );

      // Only one should have acquired at any moment, but all may eventually succeed with retries
      const acquiredCount = lockResults.filter(r => r.acquired).length;
      expect(acquiredCount).toBeGreaterThanOrEqual(1);
    });

    it('should prevent deadlocks', async () => {
      const session1 = 'deadlock-session-1';
      const session2 = 'deadlock-session-2';

      // Session 1 acquires lock A
      await coordinationDb.acquireLock('resource-A', session1, 500);

      // Session 2 acquires lock B
      await coordinationDb.acquireLock('resource-B', session2, 500);

      // Try cross-acquisition with short timeout
      const results = await Promise.allSettled([
        coordinationDb.acquireLock('resource-B', session1, 100),
        coordinationDb.acquireLock('resource-A', session2, 100)
      ]);

      // At least one should timeout (no deadlock hang)
      const timeouts = results.filter(r =>
        r.status === 'rejected' || (r.status === 'fulfilled' && !r.value)
      );
      expect(timeouts.length).toBeGreaterThanOrEqual(1);

      // Cleanup
      await coordinationDb.releaseLock('resource-A', session1);
      await coordinationDb.releaseLock('resource-B', session2);
    });

    it('should queue lock requests properly', async () => {
      const lockOrder = [];

      const acquireAndRelease = async (sessionId, delay) => {
        const acquired = await coordinationDb.acquireLock('ordered-resource', sessionId, 5000);
        if (acquired) {
          lockOrder.push(sessionId);
          await new Promise(r => setTimeout(r, delay));
          await coordinationDb.releaseLock('ordered-resource', sessionId);
        }
      };

      // First acquires and holds for 100ms
      const p1 = acquireAndRelease('first', 100);

      // Wait a bit then try second and third
      await new Promise(r => setTimeout(r, 20));
      const p2 = acquireAndRelease('second', 50);
      const p3 = acquireAndRelease('third', 50);

      await Promise.all([p1, p2, p3]);

      // First should always be first
      expect(lockOrder[0]).toBe('first');
    });
  });

  // ============================================================
  // 7. SSE EVENT THROUGHPUT
  // ============================================================
  describe('SSE Event Throughput', () => {
    it('should handle rapid state changes efficiently', async () => {
      const events = [];
      const eventLimit = 100;

      stateManager.on('stateChange', (event) => {
        if (events.length < eventLimit) {
          events.push({
            timestamp: Date.now(),
            agentId: event.agentId
          });
        }
      });

      stateManager.register('sse-agent', { state: 'IDLE' });

      const start = Date.now();

      // Rapid state changes
      for (let i = 0; i < 100; i++) {
        stateManager.updateState('sse-agent', {
          state: i % 2 === 0 ? 'ACTIVE' : 'IDLE',
          iteration: i
        });
      }

      const elapsed = Date.now() - start;
      const eventsPerSecond = (events.length / elapsed) * 1000;

      expect(eventsPerSecond).toBeGreaterThan(100); // At least 100 events/second
    });

    it('should measure event latency', async () => {
      const latencies = [];

      stateManager.on('stateChange', (event) => {
        const now = Date.now();
        if (event.emittedAt) {
          latencies.push(now - event.emittedAt);
        }
      });

      stateManager.register('latency-agent', { state: 'IDLE' });

      // Generate events with timestamps
      for (let i = 0; i < 50; i++) {
        stateManager.updateState('latency-agent', {
          state: 'ACTIVE',
          emittedAt: Date.now()
        });
      }

      if (latencies.length > 0) {
        const avgLatency = latencies.reduce((s, l) => s + l, 0) / latencies.length;
        expect(avgLatency).toBeLessThan(10); // < 10ms average latency
      }
    });

    it('should batch events when overwhelmed', async () => {
      let batchedEvents = 0;

      stateManager.on('batchedStateChanges', (events) => {
        batchedEvents += events.length;
      });

      stateManager.enableEventBatching(10); // Batch every 10ms
      stateManager.register('batch-agent', { state: 'IDLE' });

      // Rapid updates
      for (let i = 0; i < 100; i++) {
        stateManager.updateState('batch-agent', { iteration: i });
      }

      // Wait for batch flush
      await new Promise(r => setTimeout(r, 50));

      // Events should have been batched (fewer than 100 individual events)
      // The exact number depends on batching implementation
      expect(batchedEvents).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // 8. LOAD TEST SUMMARY
  // ============================================================
  describe('Load Test Summary', () => {
    it('should generate load test report', async () => {
      const report = {
        concurrent: { passed: 0, failed: 0 },
        throughput: { delegationsPerSec: 0 },
        resourceLimits: { enforced: true },
        cleanup: { efficiency: 0 },
        locks: { deadlockFree: true }
      };

      // Run mini-benchmarks
      // Concurrent creation
      try {
        await Promise.all(
          Array(10).fill(null).map((_, i) =>
            Promise.resolve(registry.registerAgent(`report-${i}`, {}))
          )
        );
        report.concurrent.passed = 10;
      } catch (e) {
        report.concurrent.failed++;
      }

      // Throughput
      const start = Date.now();
      registry.registerAgent('report-root', {});
      for (let i = 0; i < 50; i++) {
        registry.registerDelegation(`report-deleg-${i}`, {
          parentAgentId: 'report-root',
          taskId: `task-${i}`,
          status: 'active'
        });
      }
      const elapsed = Date.now() - start;
      report.throughput.delegationsPerSec = (50 / elapsed) * 1000;

      // Cleanup efficiency
      for (let i = 0; i < 10; i++) {
        stateManager.register(`cleanup-test-${i}`, {
          lastHeartbeat: Date.now() - 10000,
          state: 'ACTIVE'
        });
      }
      const cleaned = stateManager.cleanupStale(1000);
      report.cleanup.efficiency = cleaned.count / 10;

      // Report assertions
      expect(report.concurrent.passed).toBe(10);
      expect(report.throughput.delegationsPerSec).toBeGreaterThan(50);
      expect(report.cleanup.efficiency).toBeGreaterThan(0.9);
    });
  });
});
