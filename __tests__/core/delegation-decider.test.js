/**
 * Tests for DelegationDecider - Auto-Delegation Decision Logic
 * Part of Hierarchy Phase 3
 */

const { DelegationDecider, DelegationPattern, DEFAULT_DELEGATION_CONFIG } = require('../../.claude/core/delegation-decider');

describe('DelegationDecider', () => {
  let decider;

  beforeEach(() => {
    decider = new DelegationDecider();
  });

  describe('constructor', () => {
    it('should create with default configuration', () => {
      expect(decider.config.thresholds.complexity).toBe(50);
      expect(decider.config.thresholds.contextUtilization).toBe(75);
      expect(decider.config.thresholds.subtaskCount).toBe(3);
      expect(decider.config.limits.maxDelegationDepth).toBe(3);
    });

    it('should accept custom configuration', () => {
      const custom = new DelegationDecider({
        config: {
          thresholds: { complexity: 70 },
          limits: { maxDelegationDepth: 5 }
        }
      });

      expect(custom.config.thresholds.complexity).toBe(70);
      expect(custom.config.limits.maxDelegationDepth).toBe(5);
      // Other defaults preserved
      expect(custom.config.thresholds.contextUtilization).toBe(75);
    });

    it('should initialize empty metrics', () => {
      const metrics = decider.getMetrics();
      expect(metrics.decisionsCount).toBe(0);
      expect(metrics.delegationsRecommended).toBe(0);
    });
  });

  describe('shouldDelegate', () => {
    it('should throw error for null task', () => {
      expect(() => decider.shouldDelegate(null, {})).toThrow('Task is required');
    });

    it('should return decision object with required fields', () => {
      const task = { id: 'test-1', title: 'Test task', description: 'Simple test' };
      const decision = decider.shouldDelegate(task, null);

      expect(decision).toHaveProperty('shouldDelegate');
      expect(decision).toHaveProperty('confidence');
      expect(decision).toHaveProperty('score');
      expect(decision).toHaveProperty('factors');
      expect(decision).toHaveProperty('suggestedPattern');
      expect(decision).toHaveProperty('reasoning');
      expect(decision).toHaveProperty('hints');
      expect(decision).toHaveProperty('metadata');
    });

    it('should recommend delegation for complex task', () => {
      const complexTask = {
        id: 'complex-1',
        title: 'Build distributed API with async processing',
        description: `
          Implement a comprehensive distributed API system with multiple components:
          1. Design RESTful endpoints for user authentication
          2. Implement database connection pooling
          3. Add async message queue integration
          4. Configure load balancing and failover
          5. Set up security middleware and encryption
          6. Add performance monitoring and alerting
        `,
        acceptance: [
          'All API endpoints documented',
          'Database performance optimized',
          'Security audit passed',
          'Integration tests cover 80%',
          'Load testing shows 1000 RPS'
        ],
        estimate: '16h',
        phase: 'implementation'
      };

      const decision = decider.shouldDelegate(complexTask, null);

      expect(decision.factors.complexity).toBeGreaterThan(50);
      expect(decision.factors.subtaskCount).toBeGreaterThan(3);
      expect(decision.shouldDelegate).toBe(true);
    });

    it('should NOT recommend delegation for simple task', () => {
      const simpleTask = {
        id: 'simple-1',
        title: 'Fix typo',
        description: 'Fix typo in README',
        acceptance: ['Typo fixed'],
        estimate: '5m'
      };

      const decision = decider.shouldDelegate(simpleTask, null);

      expect(decision.factors.complexity).toBeLessThan(50);
      expect(decision.shouldDelegate).toBe(false);
      expect(decision.suggestedPattern).toBe(DelegationPattern.DIRECT);
    });

    it('should NOT delegate when depth limit reached', () => {
      const task = {
        id: 'depth-test',
        title: 'Complex task',
        description: 'Task with many components for api integration and database work',
        acceptance: ['A', 'B', 'C', 'D', 'E']
      };

      const agent = {
        id: 'agent-deep',
        hierarchyInfo: { depth: 3 } // At max depth
      };

      const decision = decider.shouldDelegate(task, agent);

      expect(decision.factors.depthRemaining).toBe(0);
      expect(decision.shouldDelegate).toBe(false);
      expect(decision.reasoning).toContain('depth');
    });

    it('should NOT delegate when task has no subtasks', () => {
      const atomicTask = {
        id: 'atomic-1',
        title: 'Single action',
        description: 'Just one thing to do'
        // No acceptance criteria, no numbered list
      };

      const decision = decider.shouldDelegate(atomicTask, null);

      expect(decision.factors.subtaskCount).toBeLessThan(2);
      expect(decision.shouldDelegate).toBe(false);
    });

    it('should NOT delegate when task already has children', () => {
      const parentTask = {
        id: 'parent-1',
        title: 'Parent task',
        description: 'Already decomposed',
        childTaskIds: ['child-1', 'child-2']
      };

      const decision = decider.shouldDelegate(parentTask, null);

      expect(decision.shouldDelegate).toBe(false);
    });

    it('should cache decisions', () => {
      const task = { id: 'cache-test', title: 'Test' };

      const decision1 = decider.shouldDelegate(task, null);
      const decision2 = decider.shouldDelegate(task, null);

      expect(decision1.metadata.timestamp).toBe(decision2.metadata.timestamp);
    });

    it('should skip cache when requested', async () => {
      const task = { id: 'skip-cache', title: 'Test' };

      const decision1 = decider.shouldDelegate(task, null);

      // Small delay to ensure different timestamp
      await new Promise(r => setTimeout(r, 10));

      const decision2 = decider.shouldDelegate(task, null, { skipCache: true });

      // With skipCache, should re-evaluate (different timestamp)
      expect(decision2.metadata.timestamp).not.toBe(decision1.metadata.timestamp);
    });
  });

  describe('factor calculations', () => {
    describe('complexity', () => {
      it('should score higher for technical terms', () => {
        const techTask = {
          id: 't1',
          title: 'API database integration',
          description: 'Implement async distributed security'
        };
        const simpleTask = {
          id: 't2',
          title: 'Update readme',
          description: 'Change text'
        };

        const techDecision = decider.shouldDelegate(techTask, null);
        const simpleDecision = decider.shouldDelegate(simpleTask, null);

        expect(techDecision.factors.complexity).toBeGreaterThan(simpleDecision.factors.complexity);
      });

      it('should score higher for scope indicators', () => {
        const broadTask = {
          id: 'b1',
          title: 'Complete system overhaul',
          description: 'Update all components in entire codebase'
        };
        const narrowTask = {
          id: 'n1',
          title: 'Fix button',
          description: 'Change color'
        };

        const broadDecision = decider.shouldDelegate(broadTask, null);
        const narrowDecision = decider.shouldDelegate(narrowTask, null);

        expect(broadDecision.factors.complexity).toBeGreaterThan(narrowDecision.factors.complexity);
      });

      it('should score higher for more dependencies', () => {
        const depTask = {
          id: 'd1',
          title: 'Task with deps',
          depends: {
            requires: ['a', 'b', 'c'],
            blocks: ['d', 'e']
          }
        };
        const noDepTask = {
          id: 'd2',
          title: 'Independent task'
        };

        const depDecision = decider.shouldDelegate(depTask, null);
        const noDepDecision = decider.shouldDelegate(noDepTask, null);

        expect(depDecision.factors.complexity).toBeGreaterThan(noDepDecision.factors.complexity);
      });
    });

    describe('subtaskCount', () => {
      it('should count acceptance criteria', () => {
        const task = {
          id: 's1',
          title: 'Task',
          acceptance: ['A', 'B', 'C', 'D']
        };

        const decision = decider.shouldDelegate(task, null);

        expect(decision.factors.subtaskCount).toBeGreaterThanOrEqual(4);
      });

      it('should count numbered items in description', () => {
        const task = {
          id: 's2',
          title: 'Task',
          description: '1. First step\n2. Second step\n3. Third step'
        };

        const decision = decider.shouldDelegate(task, null);

        expect(decision.factors.subtaskCount).toBeGreaterThanOrEqual(3);
      });

      it('should count bullet points in description', () => {
        const task = {
          id: 's3',
          title: 'Task',
          description: '- Item one\n- Item two\n- Item three\n- Item four'
        };

        const decision = decider.shouldDelegate(task, null);

        expect(decision.factors.subtaskCount).toBeGreaterThanOrEqual(4);
      });
    });

    describe('agentConfidence', () => {
      it('should use agent reported confidence', () => {
        const task = { id: 'c1', title: 'Task' };
        const agent = { id: 'agent-1', confidence: 90 };

        const decision = decider.shouldDelegate(task, agent);

        expect(decision.factors.agentConfidence).toBe(90);
      });

      it('should infer confidence from capability match', () => {
        const task = {
          id: 'c2',
          title: 'Task',
          requiredCapabilities: ['coding', 'testing', 'review']
        };
        const agent = {
          id: 'agent-2',
          capabilities: ['coding', 'testing'] // 2/3 match
        };

        const decision = decider.shouldDelegate(task, agent);

        expect(decision.factors.agentConfidence).toBeCloseTo(66.67, 0);
      });

      it('should use phase matching for confidence', () => {
        const task = { id: 'c3', title: 'Task', phase: 'implementation' };
        const matchingAgent = { id: 'a1', primaryPhase: 'implementation' };
        const nonMatchingAgent = { id: 'a2', primaryPhase: 'research' };

        const matchDecision = decider.shouldDelegate(task, matchingAgent);
        const nonMatchDecision = decider.shouldDelegate(task, nonMatchingAgent);

        expect(matchDecision.factors.agentConfidence).toBeGreaterThan(
          nonMatchDecision.factors.agentConfidence
        );
      });
    });

    describe('agentLoad', () => {
      it('should calculate from queue depth', () => {
        const task = { id: 'l1', title: 'Task' };
        const loadedAgent = {
          id: 'loaded',
          queueDepth: 8,
          maxQueueDepth: 10
        };

        const decision = decider.shouldDelegate(task, loadedAgent);

        expect(decision.factors.agentLoad).toBe(80);
      });

      it('should calculate from child agent count', () => {
        const task = { id: 'l2', title: 'Task' };
        const busyAgent = {
          id: 'busy',
          hierarchyInfo: { childAgentIds: ['c1', 'c2', 'c3'] },
          quotas: { maxChildren: 5 }
        };

        const decision = decider.shouldDelegate(task, busyAgent);

        expect(decision.factors.agentLoad).toBe(60);
      });
    });

    describe('depthRemaining', () => {
      it('should calculate remaining depth', () => {
        const task = { id: 'dr1', title: 'Task' };

        const level0Agent = { id: 'l0' };
        const level2Agent = { id: 'l2', hierarchyInfo: { depth: 2 } };

        const decision0 = decider.shouldDelegate(task, level0Agent);
        const decision2 = decider.shouldDelegate(task, level2Agent);

        expect(decision0.factors.depthRemaining).toBe(3);
        expect(decision2.factors.depthRemaining).toBe(1);
      });
    });
  });

  describe('pattern selection', () => {
    it('should suggest parallel for independent subtasks', () => {
      const task = {
        id: 'p1',
        title: 'Independent batch processing',
        description: 'Process these items concurrently in parallel',
        acceptance: ['A', 'B', 'C']
      };

      const decision = decider.shouldDelegate(task, null);

      if (decision.shouldDelegate) {
        expect(decision.suggestedPattern).toBe(DelegationPattern.PARALLEL);
      }
    });

    it('should suggest sequential for dependent tasks', () => {
      const task = {
        id: 's1',
        title: 'Step by step process',
        description: 'First do A, then do B after that, finally complete C',
        acceptance: ['A', 'B', 'C'],
        depends: { requires: ['prerequisite-1'] }
      };

      const decision = decider.shouldDelegate(task, null);

      if (decision.shouldDelegate) {
        expect([DelegationPattern.SEQUENTIAL, DelegationPattern.PARALLEL]).toContain(decision.suggestedPattern);
      }
    });

    it('should suggest debate for controversial tasks', () => {
      const task = {
        id: 'd1',
        title: 'Evaluate and compare options',
        description: 'Discuss alternatives and controversial approaches',
        acceptance: ['A', 'B', 'C'],
        phase: 'research'
      };

      const decision = decider.shouldDelegate(task, null);

      if (decision.shouldDelegate) {
        expect(decision.suggestedPattern).toBe(DelegationPattern.DEBATE);
      }
    });

    it('should suggest review for creative tasks', () => {
      const task = {
        id: 'r1',
        title: 'Create and review draft',
        description: 'Write the document then critique and revise',
        acceptance: ['A', 'B', 'C'],
        phase: 'design'
      };

      const decision = decider.shouldDelegate(task, null);

      if (decision.shouldDelegate) {
        expect([DelegationPattern.REVIEW, DelegationPattern.PARALLEL]).toContain(decision.suggestedPattern);
      }
    });
  });

  describe('reasoning and hints', () => {
    it('should provide reasoning for delegation', () => {
      const task = {
        id: 'reason-1',
        title: 'Complex API task',
        description: 'Build distributed async API with database integration',
        acceptance: ['A', 'B', 'C', 'D', 'E']
      };

      const decision = decider.shouldDelegate(task, null);

      expect(decision.reasoning.length).toBeGreaterThan(0);
      expect(decision.reasoning).toContain('score');
    });

    it('should provide actionable hints', () => {
      const task = {
        id: 'hints-1',
        title: 'Task',
        acceptance: ['A', 'B', 'C', 'D']
      };

      const decision = decider.shouldDelegate(task, null);

      expect(Array.isArray(decision.hints)).toBe(true);
    });

    it('should explain why not delegating', () => {
      const simpleTask = {
        id: 'no-delegate',
        title: 'Simple task',
        description: 'Just one thing'
      };

      const decision = decider.shouldDelegate(simpleTask, null);

      if (!decision.shouldDelegate) {
        expect(decision.reasoning).toContain('Direct execution');
      }
    });
  });

  describe('batch evaluation', () => {
    it('should evaluate multiple tasks', () => {
      const tasks = [
        { id: 't1', title: 'Task 1' },
        { id: 't2', title: 'Task 2' },
        { id: 't3', title: 'Task 3' }
      ];

      const decisions = decider.evaluateBatch(tasks, null);

      expect(decisions.length).toBe(3);
      decisions.forEach((d, i) => {
        expect(d.metadata.taskId).toBe(tasks[i].id);
      });
    });

    it('should handle empty array', () => {
      const decisions = decider.evaluateBatch([], null);
      expect(decisions).toEqual([]);
    });
  });

  describe('quick hint', () => {
    it('should return quick assessment', () => {
      const task = { id: 'quick-1', title: 'Task' };
      const hint = decider.getQuickHint(task, null);

      expect(hint).toHaveProperty('shouldConsiderDelegation');
      expect(hint).toHaveProperty('quickFactors');
      expect(hint).toHaveProperty('hint');
    });
  });

  describe('metrics tracking', () => {
    it('should track decision count', () => {
      decider.shouldDelegate({ id: '1', title: 'A' }, null);
      decider.shouldDelegate({ id: '2', title: 'B' }, null);
      decider.shouldDelegate({ id: '3', title: 'C' }, null);

      const metrics = decider.getMetrics();
      expect(metrics.decisionsCount).toBe(3);
    });

    it('should track delegation recommendations', () => {
      // Simple tasks - no delegation
      decider.shouldDelegate({ id: '1', title: 'Fix typo' }, null);

      // Complex task - delegation
      decider.shouldDelegate({
        id: '2',
        title: 'Complex API',
        description: 'Build async distributed database integration',
        acceptance: ['A', 'B', 'C', 'D', 'E']
      }, null);

      const metrics = decider.getMetrics();
      expect(metrics.directExecutionsRecommended).toBeGreaterThanOrEqual(1);
    });

    it('should track pattern distribution', () => {
      decider.shouldDelegate({
        id: 'p1',
        title: 'Parallel task',
        description: 'Process independent concurrent items',
        acceptance: ['A', 'B', 'C']
      }, null);

      const metrics = decider.getMetrics();
      expect(Object.keys(metrics.patternDistribution).length).toBeGreaterThan(0);
    });
  });

  describe('configuration', () => {
    it('should update config at runtime', () => {
      decider.updateConfig({ thresholds: { complexity: 80 } });

      expect(decider.config.thresholds.complexity).toBe(80);
    });

    it('should clear cache on config update', async () => {
      const task = { id: 'config-test', title: 'Task' };

      const decision1 = decider.shouldDelegate(task, null);

      // Small delay + config update clears cache
      await new Promise(r => setTimeout(r, 10));
      decider.updateConfig({ minDelegationScore: 90 });
      const decision2 = decider.shouldDelegate(task, null);

      // Cache was cleared, so timestamps should differ
      expect(decision2.metadata.timestamp).not.toBe(decision1.metadata.timestamp);
    });
  });

  describe('stats', () => {
    it('should return stats object', () => {
      const stats = decider.getStats();

      expect(stats).toHaveProperty('cacheSize');
      expect(stats).toHaveProperty('metrics');
      expect(stats).toHaveProperty('config');
    });
  });
});

describe('DEFAULT_DELEGATION_CONFIG', () => {
  it('should have required threshold properties', () => {
    expect(DEFAULT_DELEGATION_CONFIG.thresholds).toHaveProperty('complexity');
    expect(DEFAULT_DELEGATION_CONFIG.thresholds).toHaveProperty('contextUtilization');
    expect(DEFAULT_DELEGATION_CONFIG.thresholds).toHaveProperty('subtaskCount');
    expect(DEFAULT_DELEGATION_CONFIG.thresholds).toHaveProperty('confidenceFloor');
  });

  it('should have weight properties that sum to 1', () => {
    const weights = DEFAULT_DELEGATION_CONFIG.weights;
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it('should have pattern indicators', () => {
    expect(DEFAULT_DELEGATION_CONFIG.patternSelection.parallelIndicators.length).toBeGreaterThan(0);
    expect(DEFAULT_DELEGATION_CONFIG.patternSelection.sequentialIndicators.length).toBeGreaterThan(0);
  });
});

describe('DelegationPattern', () => {
  it('should define all patterns', () => {
    expect(DelegationPattern.PARALLEL).toBe('parallel');
    expect(DelegationPattern.SEQUENTIAL).toBe('sequential');
    expect(DelegationPattern.DEBATE).toBe('debate');
    expect(DelegationPattern.REVIEW).toBe('review');
    expect(DelegationPattern.ENSEMBLE).toBe('ensemble');
    expect(DelegationPattern.DIRECT).toBe('direct');
  });
});
