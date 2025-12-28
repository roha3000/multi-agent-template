/**
 * Tests for DecompositionStrategies
 *
 * Part of Hierarchy Phase 3 - tests for task decomposition strategies
 */

const {
  DecompositionStrategies,
  ParallelStrategy,
  SequentialStrategy,
  HybridStrategy,
  ManualStrategy,
  DEFAULT_ESTIMATES
} = require('../../.claude/core/decomposition-strategies');

describe('DecompositionStrategies', () => {
  // Sample tasks for testing
  const parallelTask = {
    id: 'task-parallel-1',
    title: 'Implement multiple API endpoints',
    description: 'Create CRUD endpoints for users, products, and orders',
    phase: 'implementation',
    priority: 'high',
    estimate: '8h',
    tags: ['api', 'backend', 'multi-component'],
    acceptance: ['All endpoints return correct data', 'Error handling implemented'],
    depends: { blocks: [], requires: [], related: [] }
  };

  const sequentialTask = {
    id: 'task-sequential-1',
    title: 'Database migration workflow',
    description: 'First backup database, then run migrations, next verify data, finally update indexes',
    phase: 'implementation',
    priority: 'critical',
    estimate: '4h',
    tags: ['database', 'workflow'],
    acceptance: ['Migration completed', 'Data integrity verified'],
    depends: { blocks: [], requires: [], related: [] }
  };

  const hybridTask = {
    id: 'task-hybrid-1',
    title: 'Build authentication system',
    description: 'Setup infrastructure, then implement login and registration in parallel, finally integrate and test',
    phase: 'implementation',
    priority: 'high',
    estimate: '16h',
    tags: ['auth', 'security'],
    acceptance: ['Login works', 'Registration works', 'Token refresh implemented'],
    depends: { blocks: [], requires: [], related: [] }
  };

  describe('ParallelStrategy', () => {
    let strategy;

    beforeEach(() => {
      strategy = new ParallelStrategy();
    });

    describe('canApply', () => {
      test('should detect parallel-suitable task', () => {
        const result = strategy.canApply(parallelTask);
        expect(result.canApply).toBe(true);
        expect(result.confidence).toBeGreaterThan(0.4);
      });

      test('should detect sequential task as less suitable', () => {
        const result = strategy.canApply(sequentialTask);
        expect(result.indicators.hasSequentialKeywords).toBe(true);
      });
    });

    describe('decompose', () => {
      test('should create independent subtasks', () => {
        const result = strategy.decompose(parallelTask, {
          splitBy: 'component',
          components: [
            { name: 'Users API', description: 'User endpoints' },
            { name: 'Products API', description: 'Product endpoints' },
            { name: 'Orders API', description: 'Order endpoints' }
          ]
        });

        expect(result.subtasks).toHaveLength(3);
        expect(result.strategy).toBe('parallel');
        expect(result.subtasks.every(st => st.canRunParallel)).toBe(true);
        expect(result.subtasks.every(st => st.parallelGroup === 0)).toBe(true);
      });

      test('should infer components when not provided', () => {
        const result = strategy.decompose(parallelTask);

        expect(result.subtasks.length).toBeGreaterThanOrEqual(2);
        expect(result.metadata.splitBy).toBeDefined();
      });

      test('should generate unique IDs for subtasks', () => {
        const result = strategy.decompose(parallelTask);
        const ids = result.subtasks.map(st => st.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
      });
    });

    describe('validate', () => {
      test('should pass validation for independent subtasks', () => {
        const result = strategy.decompose(parallelTask, {
          components: ['A', 'B', 'C']
        });
        const validation = strategy.validate(result.subtasks);

        expect(validation.valid).toBe(true);
        expect(validation.issues).toHaveLength(0);
      });

      test('should warn about internal dependencies', () => {
        const subtasks = [
          { id: 'st-1', depends: { requires: [] } },
          { id: 'st-2', depends: { requires: ['st-1'] } }
        ];

        const validation = strategy.validate(subtasks);
        expect(validation.warnings.length).toBeGreaterThan(0);
        expect(validation.warnings[0].type).toBe('internal_dependency');
      });

      test('should fail for single subtask', () => {
        const validation = strategy.validate([{ id: 'st-1' }]);
        expect(validation.valid).toBe(false);
        expect(validation.issues[0].type).toBe('insufficient_subtasks');
      });
    });

    describe('estimate', () => {
      test('should calculate parallel time as max of subtasks', () => {
        const result = strategy.decompose(parallelTask, {
          components: ['A', 'B', 'C']
        });
        const estimate = strategy.estimate(result.subtasks);

        expect(estimate.totalTime).toBeLessThan(estimate.breakdown.reduce((sum, b) => sum + b.hours, 0));
        expect(estimate.parallelEfficiency).toBeGreaterThan(1);
      });
    });
  });

  describe('SequentialStrategy', () => {
    let strategy;

    beforeEach(() => {
      strategy = new SequentialStrategy();
    });

    describe('canApply', () => {
      test('should detect sequential-suitable task', () => {
        const result = strategy.canApply(sequentialTask);
        expect(result.canApply).toBe(true);
        expect(result.indicators.hasSequentialKeywords).toBe(true);
      });

      test('should have lower confidence for parallel task', () => {
        const result = strategy.canApply(parallelTask);
        expect(result.confidence).toBeLessThan(0.5);
      });
    });

    describe('decompose', () => {
      test('should create ordered subtasks with dependencies', () => {
        const result = strategy.decompose(sequentialTask, {
          steps: [
            { name: 'Backup', description: 'Backup database' },
            { name: 'Migrate', description: 'Run migrations' },
            { name: 'Verify', description: 'Verify data' },
            { name: 'Index', description: 'Update indexes' }
          ]
        });

        expect(result.subtasks).toHaveLength(4);
        expect(result.strategy).toBe('sequential');

        // First subtask should have no requirements
        expect(result.subtasks[0].depends.requires).toHaveLength(0);
        expect(result.subtasks[0].status).toBe('ready');

        // Subsequent subtasks should depend on previous
        expect(result.subtasks[1].depends.requires).toContain(result.subtasks[0].id);
        expect(result.subtasks[2].depends.requires).toContain(result.subtasks[1].id);
        expect(result.subtasks[3].depends.requires).toContain(result.subtasks[2].id);

        // Blocked status for subsequent subtasks
        expect(result.subtasks[1].status).toBe('blocked');
      });

      test('should infer steps from task description', () => {
        const result = strategy.decompose(sequentialTask, { autoInfer: true });

        expect(result.subtasks.length).toBeGreaterThanOrEqual(2);
        expect(result.metadata.orderPreserved).toBe(true);
      });
    });

    describe('validate', () => {
      test('should pass validation for linear chain', () => {
        const result = strategy.decompose(sequentialTask, {
          steps: ['Step 1', 'Step 2', 'Step 3']
        });
        const validation = strategy.validate(result.subtasks);

        expect(validation.valid).toBe(true);
      });

      test('should detect circular dependencies', () => {
        const subtasks = [
          { id: 'st-1', depends: { requires: ['st-3'] } },
          { id: 'st-2', depends: { requires: ['st-1'] } },
          { id: 'st-3', depends: { requires: ['st-2'] } }
        ];

        const validation = strategy.validate(subtasks);
        expect(validation.valid).toBe(false);
        expect(validation.issues[0].type).toBe('circular_dependency');
      });
    });

    describe('estimate', () => {
      test('should calculate sequential time as sum of subtasks', () => {
        const result = strategy.decompose(sequentialTask, {
          steps: ['Step 1', 'Step 2', 'Step 3']
        });
        const estimate = strategy.estimate(result.subtasks);

        const totalBreakdown = estimate.breakdown.reduce((sum, b) => sum + b.hours, 0);
        expect(estimate.totalTime).toBeCloseTo(totalBreakdown, 1);
        expect(estimate.parallelEfficiency).toBe(1);
      });
    });
  });

  describe('HybridStrategy', () => {
    let strategy;

    beforeEach(() => {
      strategy = new HybridStrategy();
    });

    describe('canApply', () => {
      test('should detect hybrid-suitable task', () => {
        const result = strategy.canApply(hybridTask);
        expect(result.canApply).toBe(true);
      });

      test('should have high confidence for complex tasks', () => {
        const result = strategy.canApply(hybridTask);
        expect(result.indicators.isComplex).toBe(true);
      });
    });

    describe('decompose', () => {
      test('should create groups with internal parallelism and external sequencing', () => {
        const result = strategy.decompose(hybridTask, {
          groups: [
            { name: 'Setup', items: [{ name: 'Infrastructure' }] },
            { name: 'Implementation', items: [{ name: 'Login' }, { name: 'Registration' }] },
            { name: 'Integration', items: [{ name: 'Testing' }] }
          ]
        });

        expect(result.subtasks).toHaveLength(4);
        expect(result.strategy).toBe('hybrid');

        // Check parallel groups
        const groups = new Set(result.subtasks.map(st => st.parallelGroup));
        expect(groups.size).toBe(3);

        // Check dependencies between groups
        const group1Tasks = result.subtasks.filter(st => st.parallelGroup === 1);
        expect(group1Tasks.length).toBe(2);
      });

      test('should build dependency graph', () => {
        const result = strategy.decompose(hybridTask, {
          groups: [
            { name: 'A', items: ['A1'] },
            { name: 'B', items: ['B1', 'B2'] }
          ]
        });

        expect(result.metadata.dependencyGraph).toBeDefined();
        expect(result.metadata.estimatedCriticalPath).toBeDefined();
      });
    });

    describe('validate', () => {
      test('should pass for properly structured hybrid', () => {
        const result = strategy.decompose(hybridTask, {
          groups: [
            { name: 'Phase 1', items: ['A', 'B'] },
            { name: 'Phase 2', items: ['C'] }
          ]
        });
        const validation = strategy.validate(result.subtasks);

        expect(validation.valid).toBe(true);
      });

      test('should warn about intra-group dependencies', () => {
        const subtasks = [
          { id: 'st-1', parallelGroup: 0, depends: { requires: [] } },
          { id: 'st-2', parallelGroup: 0, depends: { requires: ['st-1'] } }
        ];

        const validation = strategy.validate(subtasks);
        expect(validation.warnings.some(w => w.type === 'intra_group_dependency')).toBe(true);
      });
    });

    describe('estimate', () => {
      test('should calculate critical path correctly', () => {
        const result = strategy.decompose(hybridTask, {
          groups: [
            { name: 'Setup', items: [{ name: 'Init', estimate: '1h' }] },
            { name: 'Work', items: [{ name: 'A', estimate: '2h' }, { name: 'B', estimate: '3h' }] },
            { name: 'Finish', items: [{ name: 'Test', estimate: '1h' }] }
          ]
        });

        const estimate = strategy.estimate(result.subtasks);

        expect(estimate.criticalPathNodes).toBeDefined();
        expect(estimate.criticalPathNodes.length).toBeGreaterThan(0);
        expect(estimate.parallelEfficiency).toBeGreaterThan(1);
      });
    });
  });

  describe('ManualStrategy', () => {
    let strategy;

    beforeEach(() => {
      strategy = new ManualStrategy();
    });

    describe('canApply', () => {
      test('should always be applicable', () => {
        const result = strategy.canApply(parallelTask);
        expect(result.canApply).toBe(true);
        expect(result.confidence).toBe(1.0);
      });
    });

    describe('decompose', () => {
      test('should accept user-provided subtasks', () => {
        const result = strategy.decompose(parallelTask, {
          subtasks: [
            { title: 'Task A', estimate: '2h' },
            { title: 'Task B', estimate: '3h' }
          ]
        });

        expect(result.subtasks).toHaveLength(2);
        expect(result.metadata.userProvided).toBe(true);
      });

      test('should throw error when no subtasks provided', () => {
        expect(() => {
          strategy.decompose(parallelTask, { subtasks: [] });
        }).toThrow('ManualStrategy requires user-provided subtasks');
      });

      test('should generate suggestions for improvements', () => {
        const result = strategy.decompose(parallelTask, {
          subtasks: [
            { title: 'Large Task', estimate: '10h' },
            { title: 'Missing Estimate' }
          ],
          suggestImprovements: true
        });

        expect(result.metadata.suggestions.length).toBeGreaterThan(0);
        expect(result.metadata.suggestions.some(s => s.type === 'split_large_subtask')).toBe(true);
      });

      test('should check completeness against parent task', () => {
        const result = strategy.decompose(parallelTask, {
          subtasks: [
            { title: 'Small Task', estimate: '1h' }
          ],
          validateCompleteness: true
        });

        expect(result.metadata.completeness).toBeDefined();
        expect(result.metadata.completeness.complete).toBe(false);
      });
    });

    describe('validate', () => {
      test('should detect duplicate IDs', () => {
        const subtasks = [
          { id: 'dup-id', title: 'A' },
          { id: 'dup-id', title: 'B' }
        ];

        const validation = strategy.validate(subtasks);
        expect(validation.valid).toBe(false);
        expect(validation.issues[0].type).toBe('duplicate_id');
      });

      test('should warn about external dependencies', () => {
        const subtasks = [
          { id: 'st-1', title: 'A', depends: { requires: ['external-task'] } },
          { id: 'st-2', title: 'B', depends: { requires: [] } }
        ];

        const validation = strategy.validate(subtasks);
        expect(validation.warnings.some(w => w.type === 'external_dependency')).toBe(true);
      });
    });
  });

  describe('DecompositionStrategies Factory', () => {
    describe('getStrategy', () => {
      test('should return correct strategy instance', () => {
        const parallel = DecompositionStrategies.getStrategy('parallel');
        const sequential = DecompositionStrategies.getStrategy('sequential');
        const hybrid = DecompositionStrategies.getStrategy('hybrid');
        const manual = DecompositionStrategies.getStrategy('manual');

        expect(parallel).toBeInstanceOf(ParallelStrategy);
        expect(sequential).toBeInstanceOf(SequentialStrategy);
        expect(hybrid).toBeInstanceOf(HybridStrategy);
        expect(manual).toBeInstanceOf(ManualStrategy);
      });

      test('should throw for unknown strategy', () => {
        expect(() => {
          DecompositionStrategies.getStrategy('unknown');
        }).toThrow('Unknown decomposition strategy: unknown');
      });
    });

    describe('selectStrategy', () => {
      test('should auto-select parallel for parallel task', () => {
        const result = DecompositionStrategies.selectStrategy(parallelTask);
        expect(result.strategy).toBe('parallel');
        expect(result.confidence).toBeGreaterThan(0.4);
      });

      test('should auto-select sequential for sequential task', () => {
        const result = DecompositionStrategies.selectStrategy(sequentialTask);
        expect(result.strategy).toBe('sequential');
      });

      test('should provide analysis for all strategies', () => {
        const result = DecompositionStrategies.selectStrategy(hybridTask);
        expect(result.analysis.parallel).toBeDefined();
        expect(result.analysis.sequential).toBeDefined();
        expect(result.analysis.hybrid).toBeDefined();
      });
    });

    describe('decompose', () => {
      test('should auto-select and decompose', () => {
        const result = DecompositionStrategies.decompose(parallelTask);

        expect(result.subtasks.length).toBeGreaterThan(0);
        expect(result.strategy).toBeDefined();
        expect(result.validation).toBeDefined();
        expect(result.estimate).toBeDefined();
      });

      test('should use specified strategy', () => {
        const result = DecompositionStrategies.decompose(parallelTask, {
          strategy: 'sequential'
        });

        expect(result.strategy).toBe('sequential');
      });

      test('should return complete decomposition result', () => {
        const result = DecompositionStrategies.decompose(sequentialTask, {
          strategy: 'sequential',
          steps: ['A', 'B', 'C']
        });

        expect(result.subtasks).toHaveLength(3);
        expect(result.validation.valid).toBe(true);
        expect(result.estimate.totalTime).toBeGreaterThan(0);
      });
    });

    describe('validate', () => {
      test('should validate using specified strategy', () => {
        const subtasks = [
          { id: 'st-1', depends: { requires: [] } },
          { id: 'st-2', depends: { requires: ['st-1'] } }
        ];

        const validation = DecompositionStrategies.validate(subtasks, 'sequential');
        expect(validation.valid).toBe(true);
      });
    });

    describe('estimate', () => {
      test('should estimate using specified strategy', () => {
        const subtasks = [
          { id: 'st-1', estimate: '2h' },
          { id: 'st-2', estimate: '3h' }
        ];

        const parallelEstimate = DecompositionStrategies.estimate(subtasks, 'parallel');
        const sequentialEstimate = DecompositionStrategies.estimate(subtasks, 'sequential');

        expect(parallelEstimate.totalTime).toBe(3); // max
        expect(sequentialEstimate.totalTime).toBe(5); // sum
      });
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty task description', () => {
      const emptyTask = { id: 'empty', title: 'Empty', phase: 'implementation' };
      const result = DecompositionStrategies.selectStrategy(emptyTask);
      expect(result.strategy).toBeDefined();
    });

    test('should handle missing estimate', () => {
      const noEstimate = { id: 'no-est', title: 'No Estimate', phase: 'implementation' };
      const strategy = new ParallelStrategy();
      const result = strategy.decompose(noEstimate);
      expect(result.subtasks.every(st => st.estimate)).toBe(true);
    });

    test('should handle deep circular dependency', () => {
      const subtasks = [
        { id: 'a', depends: { requires: ['c'] } },
        { id: 'b', depends: { requires: ['a'] } },
        { id: 'c', depends: { requires: ['b'] } }
      ];

      const strategy = new SequentialStrategy();
      const validation = strategy.validate(subtasks);
      expect(validation.valid).toBe(false);
      expect(validation.issues[0].cycle).toBeDefined();
    });
  });
});
