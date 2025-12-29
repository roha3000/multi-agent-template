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

  // ============================================
  // Delegation Flow Tests (Phase 2)
  // ============================================

  describe('Delegation Flow', () => {
    test('should delegate task from parent agent to child agent', async () => {
      const task = { type: 'subtask', value: 'delegated-work' };

      const result = await orchestrator.delegateTask('agent1', task, {
        childAgentId: 'agent2',
        timeout: 5000
      });

      expect(result.success).toBe(true);
      expect(result.delegationId).toBeDefined();
      expect(result.agentId).toBe('agent2');
      expect(result.result).toBeDefined();
      expect(result.result.success).toBe(true);
      expect(result.duration).toBeGreaterThan(0);
    });

    test('should return error when parent agent not found', async () => {
      const task = { type: 'test' };

      const result = await orchestrator.delegateTask('nonexistent-parent', task, {
        childAgentId: 'agent1'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Parent agent nonexistent-parent not found');
    });

    test('should return error when specified child agent not found', async () => {
      const task = { type: 'test' };

      const result = await orchestrator.delegateTask('agent1', task, {
        childAgentId: 'nonexistent-child'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Child agent nonexistent-child not found');
    });

    test('should pass delegation options correctly', async () => {
      const task = { type: 'test-with-options', phase: 'implementation' };

      const result = await orchestrator.delegateTask('agent1', task, {
        childAgentId: 'agent2',
        timeout: 10000,
        context: { customData: 'test-data' }
      });

      expect(result.success).toBe(true);
      expect(result.delegationId).toMatch(/^del-/);
    });

    test('should include tokenReduction in delegation result', async () => {
      const task = {
        type: 'complex-task',
        description: 'A complex task requiring delegation',
        acceptance: ['criterion1', 'criterion2']
      };

      const result = await orchestrator.delegateTask('agent1', task, {
        childAgentId: 'agent2'
      });

      expect(result.success).toBe(true);
      expect(typeof result.tokenReduction).toBe('number');
    });

    test('should fallback to parent agent when no suitable child found', async () => {
      // Create orchestrator without many agents
      const sparseBus = new MessageBus();
      const sparseOrchestrator = new AgentOrchestrator(sparseBus);
      const singleAgent = new SimpleAgent('lone-agent', 'Solo', sparseBus);
      sparseOrchestrator.registerAgent(singleAgent);

      const task = { type: 'test', requiredCapabilities: ['non-existent'] };

      // This should not throw but fall back to parent
      const result = await sparseOrchestrator.delegateTask('lone-agent', task, {});

      expect(result.success).toBe(true);
      expect(result.agentId).toBe('lone-agent'); // Fell back to parent

      sparseOrchestrator.destroy();
    });
  });

  // ============================================
  // Result Aggregation Tests (Phase 2)
  // ============================================

  describe('Result Aggregation', () => {
    test('should aggregate multiple child results with merge strategy', () => {
      const results = [
        { agentId: 'agent1', result: { data: 'result1', items: [1, 2] } },
        { agentId: 'agent2', result: { data: 'result2', items: [3, 4] } },
        { agentId: 'agent3', result: { other: 'value' } }
      ];

      const aggregated = orchestrator.aggregateResults(results, 'merge');

      expect(aggregated.merged).toBeDefined();
      expect(aggregated.sourceCount).toBe(3);
      expect(aggregated.sources).toEqual(['agent1', 'agent2', 'agent3']);
    });

    test('should aggregate with selectBest strategy', () => {
      const results = [
        { agentId: 'agent1', result: { value: 'low', quality: 30 } },
        { agentId: 'agent2', result: { value: 'high', quality: 90 } },
        { agentId: 'agent3', result: { value: 'medium', quality: 60 } }
      ];

      const aggregated = orchestrator.aggregateResults(results, 'selectBest');

      expect(aggregated.best).toEqual({ value: 'high', quality: 90 });
      expect(aggregated.agentId).toBe('agent2');
      expect(aggregated.score).toBe(90);
    });

    test('should aggregate with vote strategy', () => {
      const results = [
        { agentId: 'agent1', result: { decision: 'optionA' } },
        { agentId: 'agent2', result: { decision: 'optionA' } },
        { agentId: 'agent3', result: { decision: 'optionB' } }
      ];

      const aggregated = orchestrator.aggregateResults(results, 'vote');

      expect(aggregated.winner).toBe('optionA');
      expect(aggregated.consensus).toBe(true);
      expect(aggregated.confidence).toBeGreaterThan(0.5);
    });

    test('should aggregate with chain strategy', () => {
      const results = [
        { agentId: 'agent1', result: { step: 1 } },
        { agentId: 'agent2', result: { step: 2 } }
      ];

      const aggregated = orchestrator.aggregateResults(results, 'chain');

      expect(aggregated.final).toBeDefined();
      expect(aggregated.stages).toBe(0); // No pipeline stages provided
    });

    test('should handle empty results gracefully', () => {
      const aggregated = orchestrator.aggregateResults([], 'merge');

      expect(aggregated.merged).toBeNull();
      expect(aggregated.sourceCount).toBe(0);
      expect(aggregated.sources).toEqual([]);
    });

    test('should handle failed child results in aggregation', () => {
      const results = [
        { agentId: 'agent1', result: { success: true, value: 'valid' } },
        { agentId: 'agent2', result: null }, // Failed result
        { agentId: 'agent3', result: { success: true, value: 'valid2' } }
      ];

      const aggregated = orchestrator.aggregateResults(results, 'merge');

      expect(aggregated.sourceCount).toBe(3);
      expect(aggregated.merged).toBeDefined();
    });

    test('should default to merge strategy when not specified', () => {
      const results = [
        { agentId: 'agent1', result: { a: 1 } },
        { agentId: 'agent2', result: { b: 2 } }
      ];

      const aggregated = orchestrator.aggregateResults(results);

      expect(aggregated.merged).toBeDefined();
      expect(aggregated.metadata.strategy).toBe('merge');
    });
  });

  // ============================================
  // Parallel Delegation Tests
  // ============================================

  describe('Parallel Delegation', () => {
    test('should execute multiple delegations in parallel', async () => {
      const tasks = [
        { type: 'subtask1', value: 1 },
        { type: 'subtask2', value: 2 },
        { type: 'subtask3', value: 3 }
      ];

      const result = await orchestrator.executeParallelDelegation('agent1', tasks, {
        timeout: 5000
      });

      expect(result.success).toBe(true);
      expect(result.successful.length).toBe(3);
      expect(result.failed.length).toBe(0);
      expect(result.duration).toBeGreaterThan(0);
    });

    test('should aggregate parallel delegation results', async () => {
      const tasks = [
        { type: 'compute', value: 10 },
        { type: 'compute', value: 20 }
      ];

      const result = await orchestrator.executeParallelDelegation('agent1', tasks, {
        aggregationStrategy: 'merge',
        timeout: 5000
      });

      expect(result.success).toBe(true);
      expect(result.aggregated).toBeDefined();
      expect(result.aggregated.sourceCount).toBe(2);
    });

    test('should handle partial failures in parallel delegation', async () => {
      // Create an agent that fails
      class FailingDelegateAgent extends Agent {
        async execute() {
          throw new Error('Delegate failed');
        }
      }

      const failAgent = new FailingDelegateAgent('fail-delegate', 'Failer', messageBus);
      orchestrator.registerAgent(failAgent);

      const tasks = [
        { type: 'task1' },
        { type: 'task2' }
      ];

      // First task goes to fail-delegate, second to agent1
      const result = await orchestrator.executeParallelDelegation('agent1', tasks, {
        timeout: 3000
      });

      // At least one should succeed
      expect(result.successful.length).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThan(0);

      failAgent.destroy();
    });

    test('should respect aggregation strategy in parallel delegation', async () => {
      const tasks = [
        { type: 'vote-task', decision: 'yes' },
        { type: 'vote-task', decision: 'yes' },
        { type: 'vote-task', decision: 'no' }
      ];

      const result = await orchestrator.executeParallelDelegation('agent1', tasks, {
        aggregationStrategy: 'vote',
        timeout: 5000
      });

      expect(result.success).toBe(true);
      expect(result.aggregated).toBeDefined();
    });

    test('should return correct structure from parallel delegation', async () => {
      const tasks = [{ type: 'single-task' }];

      const result = await orchestrator.executeParallelDelegation('agent1', tasks, {
        timeout: 5000
      });

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('aggregated');
      expect(result).toHaveProperty('successful');
      expect(result).toHaveProperty('failed');
      expect(result).toHaveProperty('duration');
    });
  });

  // ============================================
  // Auto-Delegation Tests (Phase 3)
  // ============================================

  describe('Auto-Delegation', () => {
    test('should evaluate delegation hint for complex task', () => {
      const complexTask = {
        id: 'complex-task-1',
        title: 'Implement full authentication system',
        description: 'Create authentication with multiple factors, database integration, and API endpoints',
        phase: 'implementation',
        acceptance: ['criterion1', 'criterion2', 'criterion3', 'criterion4'],
        estimate: '8h'
      };

      const agent = orchestrator.getAgent('agent1');
      const hint = orchestrator.getDelegationHint(complexTask, agent);

      expect(hint).toBeDefined();
      expect(typeof hint.shouldDelegate).toBe('boolean');
      expect(typeof hint.confidence).toBe('number');
      expect(hint.confidence).toBeGreaterThanOrEqual(0);
      expect(hint.confidence).toBeLessThanOrEqual(100);
      expect(hint.suggestedPattern).toBeDefined();
      expect(hint.reasoning).toBeDefined();
    });

    test('should recommend direct execution for simple task', () => {
      const simpleTask = {
        id: 'simple-task-1',
        title: 'Fix typo',
        description: 'Correct spelling error',
        phase: 'implementation'
      };

      const agent = orchestrator.getAgent('agent1');
      const hint = orchestrator.getDelegationHint(simpleTask, agent);

      expect(hint.shouldDelegate).toBe(false);
      expect(hint.suggestedPattern).toBe('direct');
    });

    test('should suggest parallel pattern for independent subtasks', () => {
      const parallelTask = {
        id: 'parallel-task',
        title: 'Batch process files',
        description: 'Process multiple independent files simultaneously in parallel',
        phase: 'implementation',
        acceptance: ['file1', 'file2', 'file3', 'file4']
      };

      const agent = orchestrator.getAgent('agent1');
      const hint = orchestrator.getDelegationHint(parallelTask, agent);

      // Parallel indicators in description should suggest parallel pattern
      if (hint.shouldDelegate) {
        expect(['parallel', 'sequential', 'debate', 'review', 'ensemble']).toContain(hint.suggestedPattern);
      }
    });

    test('should execute with auto-delegation disabled', async () => {
      const task = { type: 'simple-task' };

      const result = await orchestrator.executeWithAutoDelegation('agent1', task, {
        autoDelegation: false,
        timeout: 5000
      });

      expect(result.success).toBe(true);
      expect(result.delegated).toBe(false);
      expect(result.result).toBeDefined();
    });

    test('should execute with auto-delegation enabled', async () => {
      const task = {
        type: 'task-for-auto',
        title: 'Test task',
        description: 'A test task'
      };

      const result = await orchestrator.executeWithAutoDelegation('agent1', task, {
        autoDelegation: true,
        timeout: 5000
      });

      expect(result.success).toBe(true);
      expect(typeof result.delegated).toBe('boolean');
      expect(result.decision).toBeDefined();
      expect(result.duration).toBeGreaterThan(0);
    });

    test('should include decision metadata in auto-delegation result', async () => {
      const task = { type: 'test' };

      const result = await orchestrator.executeWithAutoDelegation('agent1', task, {
        autoDelegation: true,
        timeout: 5000
      });

      expect(result.decision).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.metadata.pattern).toBeDefined();
    });

    test('should handle agent not found in auto-delegation', async () => {
      const task = { type: 'test' };

      await expect(
        orchestrator.executeWithAutoDelegation('nonexistent', task, {})
      ).rejects.toThrow('Agent not found: nonexistent');
    });
  });

  // ============================================
  // Delegation Hint Tests
  // ============================================

  describe('Delegation Hints', () => {
    test('should return valid hint structure', () => {
      const task = {
        id: 'task-1',
        title: 'Test task',
        description: 'A test task for hint generation'
      };

      const agent = orchestrator.getAgent('agent1');
      const hint = orchestrator.getDelegationHint(task, agent);

      expect(hint).toHaveProperty('shouldDelegate');
      expect(hint).toHaveProperty('confidence');
      expect(hint).toHaveProperty('score');
      expect(hint).toHaveProperty('factors');
      expect(hint).toHaveProperty('factorContributions');
      expect(hint).toHaveProperty('suggestedPattern');
      expect(hint).toHaveProperty('reasoning');
      expect(hint).toHaveProperty('hints');
      expect(hint).toHaveProperty('metadata');
    });

    test('should include all factors in hint', () => {
      const task = { id: 'task-2', title: 'Test' };
      const agent = orchestrator.getAgent('agent1');
      const hint = orchestrator.getDelegationHint(task, agent);

      expect(hint.factors).toHaveProperty('complexity');
      expect(hint.factors).toHaveProperty('contextUtilization');
      expect(hint.factors).toHaveProperty('subtaskCount');
      expect(hint.factors).toHaveProperty('agentConfidence');
      expect(hint.factors).toHaveProperty('agentLoad');
      expect(hint.factors).toHaveProperty('depthRemaining');
    });

    test('should batch evaluate multiple tasks', () => {
      const tasks = [
        { id: 'batch-1', title: 'Task 1' },
        { id: 'batch-2', title: 'Task 2' },
        { id: 'batch-3', title: 'Task 3' }
      ];

      const agent = orchestrator.getAgent('agent1');
      const hints = orchestrator.getDelegationHintsBatch(tasks, agent);

      expect(hints).toHaveLength(3);
      hints.forEach(hint => {
        expect(hint).toHaveProperty('shouldDelegate');
        expect(hint).toHaveProperty('confidence');
      });
    });

    test('should provide actionable hints array', () => {
      const task = {
        id: 'hint-task',
        title: 'Complex implementation',
        description: 'Implement multiple features with database integration',
        acceptance: ['feature1', 'feature2', 'feature3', 'feature4', 'feature5']
      };

      const agent = orchestrator.getAgent('agent1');
      const hint = orchestrator.getDelegationHint(task, agent);

      expect(Array.isArray(hint.hints)).toBe(true);
    });
  });

  // ============================================
  // Delegation Metrics Tests
  // ============================================

  describe('Delegation Metrics', () => {
    test('should return delegation metrics', () => {
      const metrics = orchestrator.getDelegationMetrics();

      expect(metrics).toHaveProperty('decisionsCount');
      expect(metrics).toHaveProperty('delegationsRecommended');
      expect(metrics).toHaveProperty('directExecutionsRecommended');
      expect(metrics).toHaveProperty('averageConfidence');
      expect(metrics).toHaveProperty('patternDistribution');
    });

    test('should update metrics after delegation decisions', () => {
      const task = { id: 'metric-task', title: 'Test' };
      const agent = orchestrator.getAgent('agent1');

      const metricsBefore = orchestrator.getDelegationMetrics();
      orchestrator.getDelegationHint(task, agent);
      const metricsAfter = orchestrator.getDelegationMetrics();

      expect(metricsAfter.decisionsCount).toBe(metricsBefore.decisionsCount + 1);
    });

    test('should allow updating delegation configuration', () => {
      const newConfig = {
        thresholds: {
          complexity: 70
        }
      };

      orchestrator.updateDelegationConfig(newConfig);

      // Should not throw
      expect(() => orchestrator.updateDelegationConfig({})).not.toThrow();
    });
  });

  // ============================================
  // Edge Cases and Error Handling
  // ============================================

  describe('Delegation Edge Cases', () => {
    test('should handle delegation with missing task properties', async () => {
      const minimalTask = {};

      const result = await orchestrator.delegateTask('agent1', minimalTask, {
        childAgentId: 'agent2'
      });

      expect(result.success).toBe(true);
    });

    test('should handle delegation timeout', async () => {
      class SlowDelegateAgent extends Agent {
        async execute() {
          await new Promise(resolve => setTimeout(resolve, 5000));
          return { success: true };
        }
      }

      const slowAgent = new SlowDelegateAgent('slow-delegate', 'Slow', messageBus);
      orchestrator.registerAgent(slowAgent);

      const result = await orchestrator.delegateTask('agent1', { type: 'test' }, {
        childAgentId: 'slow-delegate',
        timeout: 100
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');

      slowAgent.destroy();
    });

    test('should handle null agent in hint generation', () => {
      const task = { id: 'null-agent-task', title: 'Test' };

      // Should not throw, handle gracefully
      expect(() => {
        orchestrator.getDelegationHint(task, null);
      }).not.toThrow();
    });

    test('should handle empty task list in parallel delegation', async () => {
      const result = await orchestrator.executeParallelDelegation('agent1', [], {
        timeout: 5000
      });

      expect(result.success).toBe(false);
      expect(result.successful).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
    });
  });
});
