/**
 * Agent Unit Tests
 */

const Agent = require('../../.claude/core/agent');
const MessageBus = require('../../.claude/core/message-bus');

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
      agent.subscribe('topic1', () => {});
      agent.subscribe('topic2', () => {});
      agent.subscribe('topic3', () => {});

      expect(agent.subscriptions).toHaveLength(3);

      agent.destroy();

      expect(agent.subscriptions).toHaveLength(0);
      expect(agent.state).toBe('destroyed');
    });
  });
});
