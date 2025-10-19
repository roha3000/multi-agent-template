/**
 * AgentOrchestrator Unit Tests
 */

const Agent = require('../../.claude/core/agent');
const MessageBus = require('../../.claude/core/message-bus');
const AgentOrchestrator = require('../../.claude/core/agent-orchestrator');

// Test agent implementations
class SimpleAgent extends Agent {
  async execute(task, context = {}) {
    await new Promise(resolve => setTimeout(resolve, 10));

    return {
      success: true,
      agentId: this.id,
      role: this.role,
      taskType: task.type,
      value: task.value || this.id,
      decision: task.decision || `decision-by-${this.id}`
    };
  }
}

class CritiqueAgent extends Agent {
  async execute(task) {
    if (task.type === 'critique') {
      return {
        success: true,
        critique: `Critique from ${this.id}: ${task.proposal} needs improvement`,
        suggestions: [`Suggestion from ${this.id}`]
      };
    }

    if (task.type === 'synthesize') {
      return {
        success: true,
        improvedProposal: `Improved: ${task.proposal} (synthesized by ${this.id})`
      };
    }

    if (task.phase === 'create') {
      return {
        success: true,
        work: `Initial work by ${this.id}`
      };
    }

    if (task.phase === 'review') {
      return {
        success: true,
        review: `Review from ${this.id}`,
        suggestions: ['Improve X', 'Fix Y']
      };
    }

    if (task.phase === 'revise') {
      return {
        success: true,
        work: `Revised work by ${this.id} based on ${task.reviews.length} reviews`
      };
    }

    return { success: true };
  }
}

describe('AgentOrchestrator', () => {
  let messageBus;
  let orchestrator;
  let agents;

  beforeEach(() => {
    messageBus = new MessageBus();
    orchestrator = new AgentOrchestrator(messageBus);
    agents = [];

    // Create test agents
    for (let i = 1; i <= 5; i++) {
      const agent = new SimpleAgent(`agent${i}`, `Role${i}`, messageBus);
      agents.push(agent);
      orchestrator.registerAgent(agent);
    }
  });

  afterEach(() => {
    orchestrator.destroy();
    messageBus.clear();
  });

  describe('Agent Management', () => {
    test('should register agents', () => {
      expect(orchestrator.agents.size).toBe(5);
      expect(orchestrator.getAgent('agent1')).toBe(agents[0]);
    });

    test('should unregister agents', () => {
      orchestrator.unregisterAgent('agent1');
      expect(orchestrator.agents.size).toBe(4);
      expect(orchestrator.getAgent('agent1')).toBeNull();
    });

    test('should get orchestrator stats', () => {
      const stats = orchestrator.getStats();
      expect(stats.totalAgents).toBe(5);
      expect(stats.agents).toHaveLength(5);
    });
  });

  describe('Parallel Execution', () => {
    test('should execute multiple agents in parallel', async () => {
      const task = { type: 'test', value: 42 };
      const agentIds = ['agent1', 'agent2', 'agent3'];

      const result = await orchestrator.executeParallel(agentIds, task);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(3);
      expect(result.failures).toHaveLength(0);
      expect(result.duration).toBeGreaterThan(0);

      result.results.forEach(r => {
        expect(r.result.success).toBe(true);
        expect(r.result.taskType).toBe('test');
      });
    });

    test('should handle partial failures', async () => {
      // Create an agent that fails
      class FailingAgent extends Agent {
        async execute() {
          throw new Error('Intentional failure');
        }
      }

      const failAgent = new FailingAgent('failer', 'Failer', messageBus);
      orchestrator.registerAgent(failAgent);

      const result = await orchestrator.executeParallel(
        ['agent1', 'failer', 'agent2'],
        { type: 'test' },
        { retries: 1 }
      );

      expect(result.success).toBe(true); // At least one succeeded
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.failures).toHaveLength(1);

      // Check that failer is in the failures (order may vary)
      const failedAgentIds = result.failures.map(f => f.agentId);
      expect(failedAgentIds).toContain('failer');

      failAgent.destroy();
    });

    test('should respect timeout', async () => {
      class SlowAgent extends Agent {
        async execute() {
          await new Promise(resolve => setTimeout(resolve, 1000));
          return { success: true };
        }
      }

      const slowAgent = new SlowAgent('slow', 'Slow', messageBus);
      orchestrator.registerAgent(slowAgent);

      const result = await orchestrator.executeParallel(
        ['slow'],
        { type: 'test' },
        { timeout: 100, retries: 1 }
      );

      expect(result.failures).toHaveLength(1);

      slowAgent.destroy();
    });
  });

  describe('Consensus Execution', () => {
    test('should reach majority consensus', async () => {
      // Create agents with same decision
      const task = { type: 'vote', decision: 'option-A' };

      // All three agents will return decision: 'option-A'
      const result = await orchestrator.executeWithConsensus(
        ['agent1', 'agent2', 'agent3'],
        task,
        { strategy: 'majority', threshold: 0.5 }
      );

      expect(result.success).toBe(true);
      // All agents returned same decision, so consensus should be reached
      expect(result.vote.consensus).toBe(true);
      expect(result.vote.confidence).toBe(1.0); // All 3 voted the same
    });

    test('should fail consensus with high threshold', async () => {
      const task = { type: 'vote' };

      const result = await orchestrator.executeWithConsensus(
        ['agent1', 'agent2', 'agent3', 'agent4', 'agent5'],
        task,
        { strategy: 'unanimous', threshold: 1.0 }
      );

      // Each agent returns different decision
      expect(result.vote.consensus).toBe(false);
    });
  });

  describe('Debate Execution', () => {
    test('should run debate rounds', async () => {
      // Create critique agents
      const critiqueAgents = [];
      for (let i = 1; i <= 3; i++) {
        const agent = new CritiqueAgent(`critic${i}`, `Critic${i}`, messageBus);
        critiqueAgents.push(agent);
        orchestrator.registerAgent(agent);
      }

      const topic = {
        initialProposal: 'Original proposal'
      };

      const result = await orchestrator.executeDebate(
        ['critic1', 'critic2', 'critic3'],
        topic,
        2 // 2 rounds
      );

      expect(result.success).toBe(true);
      expect(result.debateHistory).toHaveLength(2);
      expect(result.rounds).toBe(2);
      expect(result.finalProposal).toContain('Improved');

      critiqueAgents.forEach(a => a.destroy());
    });
  });

  describe('Review Execution', () => {
    test('should execute create-review-revise cycle', async () => {
      const critiqueAgents = [];
      for (let i = 1; i <= 3; i++) {
        const agent = new CritiqueAgent(`reviewer${i}`, `Reviewer${i}`, messageBus);
        critiqueAgents.push(agent);
        orchestrator.registerAgent(agent);
      }

      const creator = new CritiqueAgent('creator', 'Creator', messageBus);
      orchestrator.registerAgent(creator);

      const task = { type: 'create-document' };

      const result = await orchestrator.executeReview(
        'creator',
        ['reviewer1', 'reviewer2', 'reviewer3'],
        task,
        { revisionRounds: 2 }
      );

      expect(result.success).toBe(true);
      expect(result.reviewHistory).toHaveLength(2);
      expect(result.revisionRounds).toBe(2);
      expect(result.finalWork).toBeDefined();

      [...critiqueAgents, creator].forEach(a => a.destroy());
    });
  });

  describe('Ensemble Execution', () => {
    test('should execute ensemble with best-of strategy', async () => {
      const task = { type: 'generate' };

      const result = await orchestrator.executeEnsemble(
        ['agent1', 'agent2', 'agent3'],
        task,
        { strategy: 'best-of' }
      );

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.allResults).toHaveLength(3);
      expect(result.strategy).toBe('best-of');
    });

    test('should execute ensemble with merge strategy', async () => {
      const task = { type: 'generate' };

      const result = await orchestrator.executeEnsemble(
        ['agent1', 'agent2'],
        task,
        { strategy: 'merge' }
      );

      expect(result.success).toBe(true);
      expect(Array.isArray(result.result)).toBe(true);
      expect(result.result).toHaveLength(2);
      expect(result.strategy).toBe('merge');
    });

    test('should execute ensemble with vote strategy', async () => {
      const task = { type: 'decision', decision: 'option-X' };

      const result = await orchestrator.executeEnsemble(
        ['agent1', 'agent2', 'agent3'],
        task,
        { strategy: 'vote' }
      );

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.strategy).toBe('vote');
    });
  });

  describe('Error Handling', () => {
    test('should handle nonexistent agent', async () => {
      const result = await orchestrator.executeParallel(['nonexistent'], { type: 'test' });

      expect(result.success).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].agentId).toBe('nonexistent');
      expect(result.failures[0].error).toContain('Agent not found');
    });

    test('should handle empty agent list', async () => {
      const result = await orchestrator.executeParallel([], { type: 'test' });

      expect(result.success).toBe(false);
      expect(result.results).toHaveLength(0);
    });
  });

  describe('Cleanup', () => {
    test('should destroy all agents on orchestrator destroy', () => {
      const agentStates = agents.map(a => a.state);
      agentStates.forEach(state => expect(state).not.toBe('destroyed'));

      orchestrator.destroy();

      agents.forEach(agent => {
        expect(agent.state).toBe('destroyed');
      });

      expect(orchestrator.agents.size).toBe(0);
    });
  });
});
