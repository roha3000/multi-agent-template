/**
 * Agent Unit Tests
 */

const Agent = require('../../.claude/core/agent');
const MessageBus = require('../../.claude/core/message-bus');
const { resetHierarchyRegistry } = require('../../.claude/core/hierarchy-registry');

// Test agent implementation
class TestAgent extends Agent {
  async execute(task, context = {}) {
    this.setState('working');

    const startTime = Date.now();

    try {
      // Simulate work
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = {
        success: true,
        taskType: task.type || 'unknown',
        data: task.data || null,
        agentId: this.id,
        role: this.role
      };

      const duration = Date.now() - startTime;
      this._recordExecution(task, result, duration);

      this.setState('completed');
      return result;

    } catch (error) {
      this.setState('failed');
      throw error;
    }
  }
}

describe('Agent', () => {
  let messageBus;
  let agent;

  beforeEach(() => {
    messageBus = new MessageBus();
    agent = new TestAgent('agent1', 'Developer', messageBus);
  });

  afterEach(() => {
    agent.destroy();
    messageBus.clear();
  });

  describe('Initialization', () => {
    test('should initialize with correct properties', () => {
      expect(agent.id).toBe('agent1');
      expect(agent.role).toBe('Developer');
      expect(agent.state).toBe('idle');
      expect(agent.messageBus).toBe(messageBus);
    });

    test('should have default configuration', () => {
      expect(agent.config.timeout).toBe(60000);
      expect(agent.config.retries).toBe(3);
    });

    test('should allow custom configuration', () => {
      const customAgent = new TestAgent('custom', 'Custom', messageBus, {
        timeout: 30000,
        retries: 5
      });

      expect(customAgent.config.timeout).toBe(30000);
      expect(customAgent.config.retries).toBe(5);

      customAgent.destroy();
    });
  });

  describe('Task Execution', () => {
    test('should execute tasks successfully', async () => {
      const task = { type: 'test', data: { value: 42 } };
      const result = await agent.execute(task);

      expect(result.success).toBe(true);
      expect(result.taskType).toBe('test');
      expect(result.data.value).toBe(42);
      expect(result.agentId).toBe('agent1');
    });

    test('should update state during execution', async () => {
      expect(agent.state).toBe('idle');

      const executePromise = agent.execute({ type: 'test' });

      // State should change to working quickly
      await new Promise(resolve => setTimeout(resolve, 5));
      expect(agent.state).toBe('working');

      await executePromise;
      expect(agent.state).toBe('completed');
    });

    test('should record execution history', async () => {
      await agent.execute({ type: 'test1' });
      await agent.execute({ type: 'test2' });
      await agent.execute({ type: 'test3' });

      expect(agent.executionHistory).toHaveLength(3);
      expect(agent.executionHistory[0].task.type).toBe('test1');
      expect(agent.executionHistory[2].task.type).toBe('test3');
    });

    test('should limit execution history to 100', async () => {
      for (let i = 0; i < 150; i++) {
        await agent.execute({ type: `test${i}` });
      }

      expect(agent.executionHistory).toHaveLength(100);
    });
  });

  describe('Direct Messaging', () => {
    test('should send direct messages to another agent', async () => {
      const agent2 = new TestAgent('agent2', 'Reviewer', messageBus);

      // Set up agent2 to handle direct messages
      agent2.handleDirectMessages(async (message) => {
        return { received: true, data: message.data };
      });

      const response = await agent.send('agent2', { data: 'test message' });

      expect(response.received).toBe(true);
      expect(response.data).toBe('test message');

      agent2.destroy();
    });

    test('should timeout on no response', async () => {
      const shortTimeoutAgent = new TestAgent('short', 'Test', messageBus, {
        timeout: 100
      });

      await expect(
        shortTimeoutAgent.send('nonexistent', { data: 'test' })
      ).rejects.toThrow();

      shortTimeoutAgent.destroy();
    });
  });

  describe('Broadcasting', () => {
    test('should broadcast messages to all agents', (done) => {
      const agent2 = new TestAgent('agent2', 'Listener', messageBus);
      let receivedCount = 0;

      agent2.handleBroadcasts((message) => {
        expect(message.data).toBe('broadcast test');
        receivedCount++;

        if (receivedCount === 1) {
          agent2.destroy();
          done();
        }
      });

      agent.broadcast({ data: 'broadcast test' });
    });

    test('should not receive own broadcasts', (done) => {
      let receivedOwn = false;

      agent.handleBroadcasts(() => {
        receivedOwn = true;
      });

      agent.broadcast({ data: 'test' });

      setTimeout(() => {
        expect(receivedOwn).toBe(false);
        done();
      }, 50);
    });
  });

  describe('Statistics', () => {
    test('should track execution statistics', async () => {
      await agent.execute({ type: 'test1' });
      await agent.execute({ type: 'test2' });
      await agent.execute({ type: 'test3' });

      const stats = agent.getStats();

      expect(stats.agentId).toBe('agent1');
      expect(stats.role).toBe('Developer');
      expect(stats.totalExecutions).toBe(3);
      expect(stats.successfulExecutions).toBe(3);
      expect(stats.failedExecutions).toBe(0);
      expect(stats.successRate).toBe('100.0');
      expect(stats.avgDuration).toBeGreaterThan(0);
    });

    test('should calculate correct success rate', async () => {
      // Create agent that can fail
      class FailingAgent extends Agent {
        constructor(id, role, messageBus) {
          super(id, role, messageBus);
          this.shouldFail = false;
        }

        async execute(task) {
          const startTime = Date.now();
          const success = !this.shouldFail;

          const result = { success };
          this._recordExecution(task, result, Date.now() - startTime);

          if (!success) {
            throw new Error('Intentional failure');
          }

          return result;
        }
      }

      const failAgent = new FailingAgent('fail', 'Failer', messageBus);

      await failAgent.execute({}).catch(() => {});
      failAgent.shouldFail = true;
      await failAgent.execute({}).catch(() => {});
      await failAgent.execute({}).catch(() => {});
      failAgent.shouldFail = false;
      await failAgent.execute({}).catch(() => {});

      const stats = failAgent.getStats();
      expect(stats.totalExecutions).toBe(4);
      expect(stats.successfulExecutions).toBe(2);
      expect(stats.failedExecutions).toBe(2);
      expect(stats.successRate).toBe('50.0');

      failAgent.destroy();
    });
  });

  describe('State Management', () => {
    test('should update state correctly', () => {
      agent.setState('working');
      expect(agent.state).toBe('working');

      agent.setState('completed');
      expect(agent.state).toBe('completed');
    });

    test('should publish state change events', (done) => {
      // Create a separate agent to avoid interference from afterEach
      const testAgent = new TestAgent('testAgent', 'Test', messageBus);

      // Verify initial state
      expect(testAgent.state).toBe('idle');

      let eventReceived = false;

      messageBus.subscribe('agent:state-change', 'test', (message) => {
        if (message.agentId === 'testAgent' && !eventReceived) {
          eventReceived = true;
          try {
            expect(message.agentId).toBe('testAgent');
            expect(message.oldState).toBe('idle');
            expect(message.newState).toBe('working');
            testAgent.destroy();
            done();
          } catch (error) {
            testAgent.destroy();
            done(error);
          }
        }
      });

      // Use setImmediate to ensure subscription is active before state change
      setImmediate(() => {
        testAgent.setState('working');
      });
    });
  });

  describe('Cleanup', () => {
    test('should unsubscribe all topics on destroy', () => {
      // Base subscriptions from hierarchy setup (child-report topic)
      const baseSubscriptions = agent.subscriptions.length;

      agent.subscribe('topic1', () => {});
      agent.subscribe('topic2', () => {});
      agent.subscribe('topic3', () => {});

      expect(agent.subscriptions).toHaveLength(baseSubscriptions + 3);

      agent.destroy();

      expect(agent.subscriptions).toHaveLength(0);
      expect(agent.state).toBe('destroyed');
    });
  });
});

// ============================================
// HIERARCHY TESTS
// ============================================

describe('Agent Hierarchy Extension', () => {
  let messageBus;

  beforeEach(() => {
    resetHierarchyRegistry();
    messageBus = new MessageBus();
  });

  afterEach(() => {
    resetHierarchyRegistry();
    messageBus.clear();
  });

  describe('Hierarchy Initialization', () => {
    test('should initialize hierarchyInfo with defaults', () => {
      const agent = new TestAgent('root-1', 'Root', messageBus);

      expect(agent.hierarchyInfo).toBeDefined();
      expect(agent.hierarchyInfo.parentAgentId).toBeNull();
      expect(agent.hierarchyInfo.childAgentIds).toEqual([]);
      expect(agent.hierarchyInfo.depth).toBe(0);
      expect(agent.hierarchyInfo.isRoot).toBe(true);
      expect(agent.hierarchyInfo.maxDepth).toBe(3);

      agent.destroy();
    });

    test('should initialize with parent agent ID', () => {
      const parent = new TestAgent('parent-1', 'Parent', messageBus);
      const child = new TestAgent('child-1', 'Child', messageBus, {
        hierarchy: { parentAgentId: 'parent-1' }
      });

      expect(child.hierarchyInfo.parentAgentId).toBe('parent-1');
      expect(child.hierarchyInfo.isRoot).toBe(false);
      expect(child.hierarchyInfo.depth).toBe(1);

      child.destroy();
      parent.destroy();
    });

    test('should track depth through multi-level hierarchy', () => {
      const root = new TestAgent('root', 'Root', messageBus);
      const level1 = new TestAgent('level1', 'L1', messageBus, {
        hierarchy: { parentAgentId: 'root' }
      });
      const level2 = new TestAgent('level2', 'L2', messageBus, {
        hierarchy: { parentAgentId: 'level1' }
      });

      expect(root.hierarchyInfo.depth).toBe(0);
      expect(level1.hierarchyInfo.depth).toBe(1);
      expect(level2.hierarchyInfo.depth).toBe(2);

      level2.destroy();
      level1.destroy();
      root.destroy();
    });
  });

  describe('Resource Quotas', () => {
    test('should initialize with default quotas', () => {
      const agent = new TestAgent('agent-1', 'Agent', messageBus);

      expect(agent.quotas).toBeDefined();
      expect(agent.quotas.maxTokens).toBe(Agent.DEFAULT_QUOTAS.maxTokens);
      expect(agent.quotas.maxTime).toBe(Agent.DEFAULT_QUOTAS.maxTime);
      expect(agent.quotas.maxChildren).toBe(Agent.DEFAULT_QUOTAS.maxChildren);

      agent.destroy();
    });

    test('should allow custom quotas', () => {
      const agent = new TestAgent('agent-1', 'Agent', messageBus, {
        quotas: { maxTokens: 50000, maxChildren: 5 }
      });

      expect(agent.quotas.maxTokens).toBe(50000);
      expect(agent.quotas.maxChildren).toBe(5);
      expect(agent.quotas.maxTime).toBe(Agent.DEFAULT_QUOTAS.maxTime);

      agent.destroy();
    });

    test('should track resource usage', () => {
      const agent = new TestAgent('agent-1', 'Agent', messageBus);

      expect(agent.resourceUsage.tokensUsed).toBe(0);
      expect(agent.resourceUsage.timeUsed).toBe(0);
      expect(agent.resourceUsage.childrenSpawned).toBe(0);

      agent.updateResourceUsage({ tokens: 1000, time: 5000 });

      expect(agent.resourceUsage.tokensUsed).toBe(1000);
      expect(agent.resourceUsage.timeUsed).toBe(5000);

      agent.destroy();
    });

    test('should calculate remaining quotas', () => {
      const agent = new TestAgent('agent-1', 'Agent', messageBus, {
        quotas: { maxTokens: 10000, maxTime: 60000, maxChildren: 5 }
      });

      agent.updateResourceUsage({ tokens: 3000, time: 20000 });
      agent.resourceUsage.childrenSpawned = 2;

      const remaining = agent.getRemainingQuotas();

      expect(remaining.tokens).toBe(7000);
      expect(remaining.time).toBe(40000);
      expect(remaining.children).toBe(3);

      agent.destroy();
    });

    test('should check quota status', () => {
      const agent = new TestAgent('agent-1', 'Agent', messageBus, {
        quotas: { maxTokens: 1000, maxTime: 1000, maxChildren: 2 }
      });

      agent.updateResourceUsage({ tokens: 500 });
      let status = agent.checkQuotas();
      expect(status.withinQuotas).toBe(true);
      expect(status.tokensExceeded).toBe(false);

      agent.updateResourceUsage({ tokens: 600 });
      status = agent.checkQuotas();
      expect(status.tokensExceeded).toBe(true);

      agent.destroy();
    });
  });

  describe('canDelegate()', () => {
    test('should allow delegation for root agent', () => {
      const agent = new TestAgent('root-1', 'Root', messageBus);

      const result = agent.canDelegate();

      expect(result.canDelegate).toBe(true);
      expect(result.remainingDepth).toBe(3);
      expect(result.currentDepth).toBe(0);

      agent.destroy();
    });

    test('should prevent delegation at max depth', () => {
      const root = new TestAgent('root', 'Root', messageBus, {
        hierarchy: { maxDepth: 2 }
      });
      const level1 = new TestAgent('l1', 'L1', messageBus, {
        hierarchy: { parentAgentId: 'root', maxDepth: 2 }
      });
      const level2 = new TestAgent('l2', 'L2', messageBus, {
        hierarchy: { parentAgentId: 'l1', maxDepth: 2 }
      });

      const result = level2.canDelegate();
      expect(result.canDelegate).toBe(false);
      expect(result.reason).toContain('depth');

      level2.destroy();
      level1.destroy();
      root.destroy();
    });

    test('should prevent delegation when children quota exceeded', () => {
      const agent = new TestAgent('agent-1', 'Agent', messageBus, {
        quotas: { maxChildren: 2 }
      });

      agent.resourceUsage.childrenSpawned = 2;
      const result = agent.canDelegate();

      expect(result.canDelegate).toBe(false);
      expect(result.reason).toContain('children');

      agent.destroy();
    });
  });

  describe('Parent/Child Management', () => {
    test('should register child agents', () => {
      const parent = new TestAgent('parent-1', 'Parent', messageBus);

      const result = parent.registerChild('child-1');

      expect(result).toBe(true);
      expect(parent.hierarchyInfo.childAgentIds).toContain('child-1');
      expect(parent.resourceUsage.childrenSpawned).toBe(1);

      parent.destroy();
    });

    test('should not duplicate child registration', () => {
      const parent = new TestAgent('parent-1', 'Parent', messageBus);

      parent.registerChild('child-1');
      parent.registerChild('child-1');

      expect(parent.hierarchyInfo.childAgentIds.length).toBe(1);
      expect(parent.resourceUsage.childrenSpawned).toBe(1);

      parent.destroy();
    });

    test('should unregister child agents', () => {
      const parent = new TestAgent('parent-1', 'Parent', messageBus);

      parent.registerChild('child-1');
      parent.registerChild('child-2');

      const result = parent.unregisterChild('child-1');

      expect(result).toBe(true);
      expect(parent.hierarchyInfo.childAgentIds).not.toContain('child-1');
      expect(parent.hierarchyInfo.childAgentIds).toContain('child-2');

      parent.destroy();
    });

    test('should return false when unregistering non-existent child', () => {
      const parent = new TestAgent('parent-1', 'Parent', messageBus);

      const result = parent.unregisterChild('non-existent');

      expect(result).toBe(false);

      parent.destroy();
    });
  });

  describe('reportToParent()', () => {
    test('should return false for root agents', () => {
      const agent = new TestAgent('root-1', 'Root', messageBus);

      const result = agent.reportToParent({ type: 'progress', data: { percent: 50 } });

      expect(result).toBe(false);

      agent.destroy();
    });

    test('should publish to parent child-report topic', (done) => {
      const parent = new TestAgent('parent-1', 'Parent', messageBus);
      const child = new TestAgent('child-1', 'Child', messageBus, {
        hierarchy: { parentAgentId: 'parent-1' }
      });

      let progressReceived = false;

      messageBus.subscribe(`agent:parent-1:child-report`, 'test', (message) => {
        // Only check the progress message, not the status message from destroy
        if (message.type === 'progress' && !progressReceived) {
          progressReceived = true;
          expect(message.childAgentId).toBe('child-1');
          expect(message.data.percent).toBe(75);

          // Clean up after receiving progress
          child.destroy();
          parent.destroy();
          done();
        }
      });

      setTimeout(() => {
        child.reportToParent({ type: 'progress', data: { percent: 75 } });
      }, 10);
    });
  });

  describe('getStats() with hierarchy', () => {
    test('should include hierarchy info in stats', () => {
      const parent = new TestAgent('parent-1', 'Parent', messageBus);
      parent.registerChild('child-1');
      parent.registerChild('child-2');

      const stats = parent.getStats();

      expect(stats.hierarchy).toBeDefined();
      expect(stats.hierarchy.parentAgentId).toBeNull();
      expect(stats.hierarchy.childCount).toBe(2);
      expect(stats.hierarchy.depth).toBe(0);
      expect(stats.hierarchy.isRoot).toBe(true);

      parent.destroy();
    });

    test('should include resource usage in stats', () => {
      const agent = new TestAgent('agent-1', 'Agent', messageBus);
      agent.updateResourceUsage({ tokens: 5000, time: 10000 });
      agent.resourceUsage.childrenSpawned = 3;

      const stats = agent.getStats();

      expect(stats.resources).toBeDefined();
      expect(stats.resources.tokensUsed).toBe(5000);
      expect(stats.resources.timeUsed).toBe(10000);
      expect(stats.resources.childrenSpawned).toBe(3);
      expect(stats.resources.remaining).toBeDefined();

      agent.destroy();
    });
  });

  describe('getDelegationChain()', () => {
    test('should return delegation chain from root', () => {
      const root = new TestAgent('root', 'Root', messageBus);
      const level1 = new TestAgent('level1', 'L1', messageBus, {
        hierarchy: { parentAgentId: 'root' }
      });
      const level2 = new TestAgent('level2', 'L2', messageBus, {
        hierarchy: { parentAgentId: 'level1' }
      });

      const chain = level2.getDelegationChain();

      expect(chain.length).toBe(3);
      expect(chain[0].agentId).toBe('root');
      expect(chain[1].agentId).toBe('level1');
      expect(chain[2].agentId).toBe('level2');

      level2.destroy();
      level1.destroy();
      root.destroy();
    });
  });
});
