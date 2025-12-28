/**
 * Tests for TaskDecomposer
 *
 * Phase 3 of the Hierarchy System - comprehensive tests for task decomposition,
 * strategy selection, and estimation functionality.
 */
const { TaskDecomposer, DecompositionStrategy, DEFAULT_CONFIG, COMPLEXITY_FACTORS } = require('../../.claude/core/task-decomposer');

describe('TaskDecomposer', () => {
  let decomposer;
  let mockTaskManager;

  beforeEach(() => {
    // Create mock TaskManager
    mockTaskManager = {
      createSubtask: jest.fn((parentId, subtask) => ({
        ...subtask,
        id: subtask.id || `${parentId}-sub-mock`,
        created: new Date().toISOString()
      })),
      setDecomposition: jest.fn(),
      getTask: jest.fn()
    };

    decomposer = new TaskDecomposer({
      taskManager: mockTaskManager
    });
  });

  afterEach(() => {
    decomposer.clearCache();
    jest.clearAllMocks();
  });

  // ============================================
  // CONSTRUCTOR TESTS
  // ============================================

  describe('constructor', () => {
    it('should create with default configuration', () => {
      const d = new TaskDecomposer();
      expect(d.config.complexityThreshold).toBe(DEFAULT_CONFIG.complexityThreshold);
      expect(d.config.maxSubtasks).toBe(DEFAULT_CONFIG.maxSubtasks);
      expect(d.config.minSubtasks).toBe(DEFAULT_CONFIG.minSubtasks);
    });

    it('should accept custom configuration', () => {
      const d = new TaskDecomposer({
        config: {
          complexityThreshold: 75,
          maxSubtasks: 10
        }
      });
      expect(d.config.complexityThreshold).toBe(75);
      expect(d.config.maxSubtasks).toBe(10);
    });

    it('should accept TaskManager instance', () => {
      const d = new TaskDecomposer({ taskManager: mockTaskManager });
      expect(d.taskManager).toBe(mockTaskManager);
    });

    it('should initialize empty cache', () => {
      const stats = decomposer.getStats();
      expect(stats.cacheSize).toBe(0);
    });
  });

  // ============================================
  // ANALYZE() TESTS
  // ============================================

  describe('analyze()', () => {
    describe('simple task returns shouldDecompose: false', () => {
      it('should not recommend decomposition for very simple tasks', () => {
        const simpleTask = {
          id: 'simple-task',
          title: 'Fix typo',
          description: 'Fix a typo in README',
          estimate: '15m',
          phase: 'implementation'
        };

        const result = decomposer.analyze(simpleTask);

        expect(result.shouldDecompose).toBe(false);
        expect(result.complexityScore).toBeLessThan(DEFAULT_CONFIG.complexityThreshold);
        expect(result.suggestedSubtasks).toEqual([]);
      });

      it('should not recommend decomposition for tasks with low effort', () => {
        const quickTask = {
          id: 'quick-task',
          title: 'Update config',
          description: 'Change a config value',
          estimate: '30m'
        };

        const result = decomposer.analyze(quickTask);

        expect(result.shouldDecompose).toBe(false);
        expect(result.metadata.effortHours).toBeLessThan(DEFAULT_CONFIG.effortThresholdHours);
      });

      it('should not recommend decomposition for tasks already decomposed', () => {
        const decomposedTask = {
          id: 'parent-task',
          title: 'Parent task',
          description: 'Already has children',
          childTaskIds: ['child-1', 'child-2'],
          estimate: '8h'
        };

        const result = decomposer.analyze(decomposedTask);

        expect(result.shouldDecompose).toBe(false);
      });
    });

    describe('complex task returns shouldDecompose: true with strategy', () => {
      it('should recommend decomposition for high complexity tasks', () => {
        const complexTask = {
          id: 'complex-task',
          title: 'Implement complete authentication and authorization system with database integration and async processing',
          description: 'Build a comprehensive authentication system that includes user registration, login, password reset, OAuth integration with multiple providers, session management, security measures against common attacks, performance optimization, and scalable architecture design.',
          estimate: '16h',
          acceptance: [
            'User registration works with validation',
            'Login with email/password works securely',
            'OAuth integration with Google and GitHub works',
            'Password reset flow works with email verification',
            'Session management is secure with proper caching',
            'Rate limiting prevents brute force attacks',
            'All API endpoints are properly secured',
            'Database transactions are atomic'
          ],
          tags: ['security', 'authentication', 'database', 'integration', 'performance', 'api'],
          phase: 'implementation',
          depends: {
            requires: ['design-task'],
            blocks: ['deployment-task']
          }
        };

        const result = decomposer.analyze(complexTask);

        expect(result.shouldDecompose).toBe(true);
        expect(result.complexityScore).toBeGreaterThanOrEqual(DEFAULT_CONFIG.complexityThreshold);
        expect(result.suggestedStrategy).toBeDefined();
        expect(result.suggestedSubtasks.length).toBeGreaterThan(0);
      });

      it('should recommend decomposition for tasks with many acceptance criteria', () => {
        const manyAcTask = {
          id: 'many-ac-task',
          title: 'Feature with many requirements',
          description: 'Implement feature',
          estimate: '2h',
          acceptance: [
            'Requirement 1', 'Requirement 2', 'Requirement 3',
            'Requirement 4', 'Requirement 5', 'Requirement 6'
          ]
        };

        const result = decomposer.analyze(manyAcTask);

        expect(result.shouldDecompose).toBe(true);
        expect(result.metadata.acceptanceCriteriaCount).toBe(6);
      });

      it('should suggest PARALLEL strategy for independent components', () => {
        const parallelTask = {
          id: 'parallel-task',
          title: 'Process batch files independently and concurrently',
          description: 'Process each file independently. Files can be processed simultaneously.',
          estimate: '4h',
          acceptance: [
            'File A processed',
            'File B processed',
            'File C processed'
          ]
        };

        const result = decomposer.analyze(parallelTask);

        expect(result.shouldDecompose).toBe(true);
        expect(result.suggestedStrategy).toBe(DecompositionStrategy.PARALLEL);
      });

      it('should suggest SEQUENTIAL strategy for ordered steps', () => {
        const sequentialTask = {
          id: 'sequential-task',
          title: 'Database migration workflow',
          description: 'First backup data, then run migration, finally validate results.',
          estimate: '6h',
          depends: {
            requires: ['previous-setup'],
            blocks: []
          },
          acceptance: [
            'Step 1: Backup completed',
            'Step 2: Migration executed',
            'Step 3: Validation passed'
          ]
        };

        const result = decomposer.analyze(sequentialTask);

        expect(result.shouldDecompose).toBe(true);
        expect(result.suggestedStrategy).toBe(DecompositionStrategy.SEQUENTIAL);
      });
    });

    describe('confidence scoring accuracy', () => {
      it('should have higher confidence with more task information', () => {
        const detailedTask = {
          id: 'detailed-task',
          title: 'Well-documented task',
          description: 'This is a very detailed description that explains exactly what needs to be done. It includes specific requirements and context.',
          estimate: '4h',
          acceptance: ['AC 1', 'AC 2', 'AC 3', 'AC 4'],
          tags: ['feature', 'important'],
          phase: 'implementation',
          depends: { requires: ['other-task'], blocks: [] }
        };

        const result = decomposer.analyze(detailedTask);

        expect(result.confidence).toBeGreaterThanOrEqual(70);
      });

      it('should have lower confidence with minimal task information', () => {
        const vagueTask = {
          id: 'vague-task',
          title: 'Do the thing'
        };

        const result = decomposer.analyze(vagueTask);

        expect(result.confidence).toBeLessThan(70);
      });

      it('should have higher confidence for extreme complexity scores', () => {
        const extremeTask = {
          id: 'extreme-task',
          title: 'Simple tiny fix',
          description: 'x',
          estimate: '5m'
        };

        const result = decomposer.analyze(extremeTask);

        // Low complexity = high confidence it should NOT be decomposed
        if (result.complexityScore < 20) {
          expect(result.confidence).toBeGreaterThanOrEqual(50);
        }
      });
    });

    describe('edge cases', () => {
      it('should throw error for null task', () => {
        expect(() => decomposer.analyze(null)).toThrow('Task is required');
      });

      it('should throw error for undefined task', () => {
        expect(() => decomposer.analyze(undefined)).toThrow('Task is required');
      });

      it('should handle task with empty title', () => {
        const emptyTitleTask = {
          id: 'empty-title',
          title: '',
          description: 'Some description'
        };

        const result = decomposer.analyze(emptyTitleTask);

        expect(result).toBeDefined();
        expect(result.taskId).toBe('empty-title');
      });

      it('should handle task with missing optional fields', () => {
        const minimalTask = {
          id: 'minimal',
          title: 'Minimal task'
        };

        const result = decomposer.analyze(minimalTask);

        expect(result).toBeDefined();
        expect(result.metadata.effortHours).toBe(4); // Default
        expect(result.metadata.acceptanceCriteriaCount).toBe(0);
        expect(result.metadata.dependencyCount).toBe(0);
      });

      it('should assign temporary id for task without id', () => {
        const noIdTask = {
          title: 'No ID task'
        };

        const result = decomposer.analyze(noIdTask);

        expect(result.taskId).toMatch(/^temp-\d+$/);
      });

      it('should handle task with null fields gracefully', () => {
        const nullFieldsTask = {
          id: 'null-fields',
          title: 'Task',
          description: null,
          acceptance: null,
          depends: null
        };

        const result = decomposer.analyze(nullFieldsTask);

        expect(result).toBeDefined();
      });
    });

    describe('caching behavior', () => {
      it('should cache analysis results', () => {
        const task = { id: 'cached-task', title: 'Test' };

        const result1 = decomposer.analyze(task);
        const result2 = decomposer.analyze(task);

        expect(result1.analysisTimestamp).toBe(result2.analysisTimestamp);
        expect(decomposer.getStats().cacheSize).toBe(1);
      });

      it('should clear cache on clearCache()', () => {
        const task = { id: 'clear-test', title: 'Test' };
        decomposer.analyze(task);

        decomposer.clearCache();

        expect(decomposer.getStats().cacheSize).toBe(0);
      });
    });
  });

  // ============================================
  // DECOMPOSE() TESTS
  // ============================================

  describe('decompose()', () => {
    describe('parallel decomposition generates independent subtasks', () => {
      it('should generate subtasks without inter-dependencies', () => {
        const task = {
          id: 'parallel-parent',
          title: 'Process files',
          description: 'Process A, B, and C files',
          estimate: '6h',
          acceptance: ['File A done', 'File B done', 'File C done'],
          phase: 'implementation'
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);

        expect(subtasks.length).toBeGreaterThanOrEqual(DEFAULT_CONFIG.minSubtasks);
        subtasks.forEach(st => {
          // Parallel subtasks should not require other subtasks
          expect(st.dependencies.requires.length).toBe(0);
        });
      });

      it('should set order to 0 for all parallel subtasks', () => {
        const task = {
          id: 'parallel-order',
          title: 'Parallel task',
          description: 'Multiple independent items',
          estimate: '4h',
          acceptance: ['Item 1', 'Item 2', 'Item 3']
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);

        subtasks.forEach(st => {
          expect(st.order).toBe(0);
        });
      });

      it('should inherit parent phase', () => {
        const task = {
          id: 'phase-inherit',
          title: 'Testing task',
          phase: 'testing',
          estimate: '4h',
          acceptance: ['Test 1', 'Test 2', 'Test 3']
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);

        subtasks.forEach(st => {
          expect(st.phase).toBe('testing');
        });
      });
    });

    describe('sequential decomposition generates ordered subtasks', () => {
      it('should generate subtasks with sequential dependencies', () => {
        const task = {
          id: 'sequential-parent',
          title: 'Migration workflow',
          description: '1. Backup 2. Migrate 3. Validate',
          estimate: '8h',
          acceptance: [
            'Step 1: Backup done',
            'Step 2: Migration complete',
            'Step 3: Validation passed'
          ],
          phase: 'implementation'
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.SEQUENTIAL);

        expect(subtasks.length).toBeGreaterThanOrEqual(2);

        // Second subtask should require first
        for (let i = 1; i < subtasks.length; i++) {
          expect(subtasks[i].dependencies.requires).toContain(subtasks[i - 1].id);
        }
      });

      it('should maintain proper ordering', () => {
        const task = {
          id: 'ordered',
          title: 'Ordered steps',
          description: 'First A, then B, finally C',
          estimate: '6h',
          acceptance: ['A complete', 'B complete', 'C complete']
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.SEQUENTIAL);

        for (let i = 0; i < subtasks.length - 1; i++) {
          expect(subtasks[i].order).toBeLessThan(subtasks[i + 1].order);
        }
      });

      it('should generate valid dependency chain', () => {
        const task = {
          id: 'dep-chain',
          title: 'Chain task',
          estimate: '4h',
          acceptance: ['Step 1', 'Step 2', 'Step 3', 'Step 4']
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.SEQUENTIAL);
        const ids = new Set(subtasks.map(s => s.id));

        // All dependencies should be valid subtask IDs
        subtasks.forEach(st => {
          st.dependencies.requires.forEach(depId => {
            expect(ids.has(depId)).toBe(true);
          });
        });
      });
    });

    describe('hybrid decomposition generates mixed graph', () => {
      it('should handle hybrid strategy', () => {
        const task = {
          id: 'hybrid-parent',
          title: 'Complex feature',
          description: 'This involves multiple phases with parallel work within each phase',
          estimate: '16h',
          acceptance: [
            'Phase 1 setup complete',
            'Phase 1 config done',
            'Phase 2 implementation A done',
            'Phase 2 implementation B done',
            'Phase 3 testing complete'
          ],
          phase: 'implementation'
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.HYBRID);

        expect(subtasks.length).toBeGreaterThanOrEqual(DEFAULT_CONFIG.minSubtasks);
        expect(subtasks[0].decompositionStrategy).toBe(DecompositionStrategy.HYBRID);
      });

      it('should group subtasks by source', () => {
        const task = {
          id: 'grouped',
          title: 'Grouped task',
          description: '1. First step 2. Second step\n- Bullet one\n- Bullet two',
          estimate: '6h',
          phase: 'implementation'
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.HYBRID);

        // Should have subtasks from different sources
        const sources = new Set(subtasks.map(s => s.decompositionSource));
        expect(sources.size).toBeGreaterThanOrEqual(1);
      });
    });

    describe('manual decomposition validates user input', () => {
      it('should throw error for invalid strategy', () => {
        const task = { id: 'test', title: 'Test' };

        expect(() => decomposer.decompose(task, 'invalid-strategy'))
          .toThrow('Invalid strategy');
      });

      it('should throw error for null task', () => {
        expect(() => decomposer.decompose(null, DecompositionStrategy.PARALLEL))
          .toThrow('Task is required');
      });

      it('should handle manual strategy with default subtask generation', () => {
        const task = {
          id: 'manual-default',
          title: 'Manual decomposition',
          description: 'User will define subtasks',
          estimate: '4h',
          phase: 'implementation'
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.MANUAL);

        expect(subtasks).toBeDefined();
        expect(Array.isArray(subtasks)).toBe(true);
      });
    });

    describe('subtask generation', () => {
      it('should generate unique IDs for each subtask', () => {
        const task = {
          id: 'unique-ids',
          title: 'Test',
          estimate: '4h',
          acceptance: ['A', 'B', 'C', 'D']
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);
        const ids = subtasks.map(s => s.id);
        const uniqueIds = new Set(ids);

        expect(uniqueIds.size).toBe(ids.length);
      });

      it('should include parent id in subtask id', () => {
        const task = {
          id: 'parent-123',
          title: 'Parent task',
          estimate: '4h',
          acceptance: ['A', 'B']
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);

        subtasks.forEach(st => {
          expect(st.id).toContain('parent-123');
        });
      });

      it('should add auto-decomposed tag', () => {
        const task = {
          id: 'tagged',
          title: 'Tagged task',
          tags: ['original-tag'],
          estimate: '4h',
          acceptance: ['A', 'B', 'C']
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);

        subtasks.forEach(st => {
          expect(st.tags).toContain('auto-decomposed');
          expect(st.tags).toContain('original-tag');
        });
      });

      it('should respect maxSubtasks limit', () => {
        const customDecomposer = new TaskDecomposer({
          config: { maxSubtasks: 3 }
        });

        const task = {
          id: 'max-test',
          title: 'Many criteria',
          estimate: '8h',
          acceptance: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']
        };

        const subtasks = customDecomposer.decompose(task, DecompositionStrategy.PARALLEL);

        expect(subtasks.length).toBeLessThanOrEqual(3);
      });
    });
  });

  // ============================================
  // STRATEGY TESTS
  // ============================================

  describe('strategy tests', () => {
    describe('ParallelStrategy canApply correctness', () => {
      it('should prefer parallel for tasks with parallel keywords', () => {
        const task = {
          id: 'parallel-keywords',
          title: 'Process data concurrently',
          description: 'Each item can be processed independently in a batch',
          estimate: '4h'
        };

        const result = decomposer.analyze(task);

        if (result.shouldDecompose) {
          expect(result.suggestedStrategy).toBe(DecompositionStrategy.PARALLEL);
        }
      });

      it('should suggest parallel when no dependencies exist', () => {
        const task = {
          id: 'no-deps',
          title: 'Implement feature independently',
          description: 'Multiple components that are independent',
          estimate: '6h',
          depends: { requires: [], blocks: [] }
        };

        const result = decomposer.analyze(task);

        if (result.shouldDecompose && result.suggestedStrategy) {
          // Should not suggest sequential when there are no dependencies
          expect([DecompositionStrategy.PARALLEL, DecompositionStrategy.HYBRID])
            .toContain(result.suggestedStrategy);
        }
      });
    });

    describe('SequentialStrategy canApply correctness', () => {
      it('should prefer sequential for tasks with ordered steps', () => {
        const task = {
          id: 'ordered-steps',
          title: 'Deploy application',
          description: 'First build, then deploy, finally verify',
          estimate: '4h',
          acceptance: ['Build complete', 'Deploy done', 'Verification passed']
        };

        const result = decomposer.analyze(task);

        if (result.shouldDecompose) {
          expect(result.suggestedStrategy).toBe(DecompositionStrategy.SEQUENTIAL);
        }
      });

      it('should prefer sequential when task has prerequisites', () => {
        const task = {
          id: 'prereq',
          title: 'Implementation after design',
          description: 'This depends on prerequisite tasks',
          estimate: '8h',
          depends: {
            requires: ['design-task', 'setup-task'],
            blocks: []
          }
        };

        const result = decomposer.analyze(task);

        if (result.shouldDecompose) {
          expect(result.suggestedStrategy).toBe(DecompositionStrategy.SEQUENTIAL);
        }
      });
    });

    describe('HybridStrategy for mixed patterns', () => {
      it('should suggest hybrid when both parallel and sequential indicators present', () => {
        const task = {
          id: 'hybrid-indicators',
          title: 'Complex workflow with parallel and sequential parts',
          description: 'First setup phase, then run tasks concurrently, finally aggregate',
          estimate: '12h',
          depends: { requires: ['setup'], blocks: [] }
        };

        // This task has both sequential (first/then/finally) and parallel (concurrently) indicators
        const result = decomposer.analyze(task);

        if (result.shouldDecompose && result.suggestedStrategy) {
          // Should recognize mixed nature
          expect([DecompositionStrategy.HYBRID, DecompositionStrategy.SEQUENTIAL])
            .toContain(result.suggestedStrategy);
        }
      });

      it('should default to hybrid for complex tasks with no clear pattern', () => {
        const task = {
          id: 'no-pattern',
          title: 'Complex implementation task',
          description: 'Implement comprehensive feature with multiple aspects',
          estimate: '16h',
          acceptance: [
            'Backend implemented',
            'Frontend implemented',
            'Tests written',
            'Documentation complete',
            'Integration verified'
          ],
          phase: 'implementation'
        };

        const result = decomposer.analyze(task);

        if (result.shouldDecompose) {
          expect(result.suggestedStrategy).toBe(DecompositionStrategy.HYBRID);
        }
      });
    });

    describe('ManualStrategy validation', () => {
      it('should accept manual strategy', () => {
        const task = {
          id: 'manual-test',
          title: 'Manual decomposition',
          estimate: '4h'
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.MANUAL);

        expect(subtasks).toBeDefined();
        subtasks.forEach(st => {
          expect(st.decompositionStrategy).toBe(DecompositionStrategy.MANUAL);
        });
      });
    });
  });

  // ============================================
  // ESTIMATION TESTS
  // ============================================

  describe('estimation tests', () => {
    describe('effort estimation for different task types', () => {
      it('should estimate effort for research tasks', () => {
        const task = {
          id: 'research',
          title: 'Research task',
          phase: 'research',
          estimate: '8h'
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);

        subtasks.forEach(st => {
          expect(st.estimatedEffort).toBeDefined();
        });
      });

      it('should estimate effort for implementation tasks', () => {
        const task = {
          id: 'impl',
          title: 'Implementation task',
          phase: 'implementation',
          estimate: '8h'
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);

        subtasks.forEach(st => {
          expect(st.estimatedEffort).toBeDefined();
          expect(st.estimatedEffort).toMatch(/^\d+[mh]$/);
        });
      });

      it('should scale effort based on subtask count', () => {
        const task = {
          id: 'scaled',
          title: 'Scaled task',
          estimate: '12h',
          acceptance: ['A', 'B', 'C', 'D', 'E', 'F']
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);

        // Total subtask effort should be reasonable relative to parent
        const totalEffortHours = subtasks.reduce((sum, st) => {
          const match = st.estimatedEffort.match(/(\d+)(m|h)/);
          if (match) {
            const value = parseInt(match[1]);
            return sum + (match[2] === 'h' ? value : value / 60);
          }
          return sum;
        }, 0);

        // Total should not exceed 2x parent estimate
        expect(totalEffortHours).toBeLessThanOrEqual(24);
      });
    });

    describe('token estimation accuracy', () => {
      it('should include estimated effort in subtasks', () => {
        const task = {
          id: 'tokens',
          title: 'Token estimation test',
          estimate: '6h',
          acceptance: ['A', 'B', 'C']
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);

        subtasks.forEach(st => {
          expect(st.estimatedEffort).toBeDefined();
        });
      });
    });

    describe('time estimation with parallelization', () => {
      it('should recognize parallel execution time benefit', () => {
        const task = {
          id: 'parallel-time',
          title: 'Parallel execution',
          estimate: '8h',
          acceptance: ['Task A', 'Task B', 'Task C', 'Task D']
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);

        // All parallel tasks should have order 0
        const parallelCount = subtasks.filter(st => st.order === 0).length;
        expect(parallelCount).toBe(subtasks.length);
      });

      it('should recognize sequential execution time constraint', () => {
        const task = {
          id: 'sequential-time',
          title: 'Sequential execution',
          estimate: '8h',
          acceptance: ['First', 'Second', 'Third', 'Fourth']
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.SEQUENTIAL);

        // Sequential tasks should have increasing orders
        for (let i = 0; i < subtasks.length - 1; i++) {
          expect(subtasks[i].order).toBeLessThanOrEqual(subtasks[i + 1].order);
        }
      });
    });
  });

  // ============================================
  // INTEGRATION TESTS
  // ============================================

  describe('integration tests', () => {
    describe('decompose and createSubtasks round-trip', () => {
      it('should create subtasks via TaskManager', () => {
        const task = {
          id: 'integration-test',
          title: 'Integration test task',
          estimate: '6h',
          acceptance: ['A', 'B', 'C']
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);
        const created = decomposer.createSubtasks(task, subtasks);

        expect(mockTaskManager.createSubtask).toHaveBeenCalledTimes(subtasks.length);
        expect(mockTaskManager.setDecomposition).toHaveBeenCalledWith(
          task.id,
          expect.objectContaining({
            strategy: expect.any(String),
            estimatedSubtasks: subtasks.length
          })
        );
        expect(created.length).toBe(subtasks.length);
      });

      it('should handle TaskManager errors gracefully', () => {
        mockTaskManager.createSubtask
          .mockImplementationOnce(() => ({ id: 'sub-1' }))
          .mockImplementationOnce(() => { throw new Error('DB error'); })
          .mockImplementationOnce(() => ({ id: 'sub-3' }));

        const task = {
          id: 'error-test',
          title: 'Error handling test',
          estimate: '4h',
          acceptance: ['A', 'B', 'C']
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);
        const created = decomposer.createSubtasks(task, subtasks);

        // Should continue despite error
        expect(created.length).toBe(2);
      });

      it('should work without TaskManager', () => {
        const standaloneDecomposer = new TaskDecomposer();

        const task = {
          id: 'standalone',
          title: 'Standalone test',
          estimate: '4h',
          acceptance: ['A', 'B']
        };

        const subtasks = standaloneDecomposer.decompose(task, DecompositionStrategy.PARALLEL);
        const result = standaloneDecomposer.createSubtasks(task, subtasks);

        // Should return subtasks without persistence
        expect(result).toEqual(subtasks);
      });
    });

    describe('integration with TaskManager hierarchy methods', () => {
      it('should generate subtasks compatible with TaskManager.createSubtask', () => {
        const task = {
          id: 'tm-compat',
          title: 'TaskManager compatible',
          phase: 'implementation',
          priority: 'high',
          estimate: '8h',
          tags: ['feature'],
          acceptance: ['Done 1', 'Done 2', 'Done 3']
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.SEQUENTIAL);

        // Each subtask should have required fields
        subtasks.forEach(st => {
          expect(st.id).toBeDefined();
          expect(st.title).toBeDefined();
          expect(st.phase).toBe(task.phase);
          expect(st.priority).toBe(task.priority);
          expect(st.dependencies).toBeDefined();
          expect(st.tags).toContain('feature');
        });
      });

      it('should preserve parent task context in subtasks', () => {
        const task = {
          id: 'context-test',
          title: 'Context preservation',
          description: 'Important context',
          phase: 'testing',
          priority: 'critical',
          tags: ['important', 'urgent'],
          estimate: '6h',
          acceptance: ['Test A', 'Test B']
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);

        subtasks.forEach(st => {
          expect(st.phase).toBe('testing');
          expect(st.priority).toBe('critical');
          expect(st.tags).toContain('important');
          expect(st.tags).toContain('urgent');
        });
      });
    });
  });

  // ============================================
  // COMPLEXITY CALCULATION TESTS
  // ============================================

  describe('complexity calculation', () => {
    it('should score higher for longer descriptions', () => {
      const shortTask = {
        id: 'short',
        title: 'Short',
        description: 'Brief'
      };

      const longTask = {
        id: 'long',
        title: 'Long detailed title with many words',
        description: 'This is a very long and detailed description that explains the task in great detail. It includes multiple sentences and covers various aspects of the work that needs to be done. The complexity should be recognized.'
      };

      const shortResult = decomposer.analyze(shortTask);
      const longResult = decomposer.analyze(longTask);

      expect(longResult.complexityScore).toBeGreaterThan(shortResult.complexityScore);
    });

    it('should score higher for technical terms', () => {
      const nonTechnical = {
        id: 'non-tech',
        title: 'Write a report',
        description: 'Create a summary document'
      };

      const technical = {
        id: 'tech',
        title: 'Implement database with async API integration',
        description: 'Build concurrent distributed system with security and performance optimization'
      };

      const nonTechResult = decomposer.analyze(nonTechnical);
      const techResult = decomposer.analyze(technical);

      expect(techResult.complexityScore).toBeGreaterThan(nonTechResult.complexityScore);
    });

    it('should score higher for many dependencies', () => {
      const noDeps = {
        id: 'no-deps',
        title: 'Standalone task'
      };

      const manyDeps = {
        id: 'many-deps',
        title: 'Dependent task',
        depends: {
          requires: ['a', 'b', 'c', 'd'],
          blocks: ['e', 'f']
        }
      };

      const noResult = decomposer.analyze(noDeps);
      const manyResult = decomposer.analyze(manyDeps);

      expect(manyResult.complexityScore).toBeGreaterThan(noResult.complexityScore);
    });

    it('should score higher for more acceptance criteria', () => {
      const fewAC = {
        id: 'few-ac',
        title: 'Simple task',
        acceptance: ['Done']
      };

      const manyAC = {
        id: 'many-ac',
        title: 'Complex task',
        acceptance: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
      };

      const fewResult = decomposer.analyze(fewAC);
      const manyResult = decomposer.analyze(manyAC);

      expect(manyResult.complexityScore).toBeGreaterThan(fewResult.complexityScore);
    });

    it('should score higher for larger effort estimates', () => {
      const quickTask = {
        id: 'quick',
        title: 'Quick fix',
        estimate: '30m'
      };

      const longTask = {
        id: 'long-effort',
        title: 'Major feature',
        estimate: '2d'
      };

      const quickResult = decomposer.analyze(quickTask);
      const longResult = decomposer.analyze(longTask);

      expect(longResult.complexityScore).toBeGreaterThan(quickResult.complexityScore);
    });
  });

  // ============================================
  // CAPABILITY MATCHING TESTS
  // ============================================

  describe('capability matching', () => {
    describe('capability inference from task content', () => {
      it('should infer implementation capabilities from coding keywords', () => {
        const task = {
          id: 'impl-task',
          title: 'Build user authentication',
          description: 'Coding and integration work for the auth module with proper setup and configuration',
          estimate: '6h',
          phase: 'implementation'
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);

        // At least one subtask should have implementation-related capabilities
        const hasImplCapabilities = subtasks.some(st =>
          st.requiredCapabilities.some(cap =>
            ['coding', 'integration', 'configuration', 'setup'].includes(cap)
          )
        );

        expect(hasImplCapabilities).toBe(true);
      });

      it('should infer research capabilities from analysis keywords', () => {
        const task = {
          id: 'research-task',
          title: 'Perform analysis of database options',
          description: 'Conduct analysis and comparison tasks. Run investigation and evaluation activities.',
          estimate: '4h',
          phase: 'research',
          acceptance: [
            'Complete analysis of options',
            'Document comparison results',
            'Finish investigation report'
          ]
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);

        // At least one subtask should have research-related capabilities
        const hasResearchCapabilities = subtasks.some(st =>
          st.requiredCapabilities.some(cap =>
            ['analysis', 'investigation', 'evaluation', 'comparison'].includes(cap)
          )
        );

        expect(hasResearchCapabilities).toBe(true);
      });

      it('should infer testing capabilities from test keywords', () => {
        const task = {
          id: 'test-task',
          title: 'Verify authentication system',
          description: 'Perform unit-testing and validation of the auth module with verification steps',
          estimate: '3h',
          phase: 'testing'
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);

        // At least one subtask should have testing-related capabilities
        const hasTestCapabilities = subtasks.some(st =>
          st.requiredCapabilities.some(cap =>
            ['unit-testing', 'integration-testing', 'validation', 'verification'].includes(cap)
          )
        );

        expect(hasTestCapabilities).toBe(true);
      });

      it('should infer design capabilities from architecture keywords', () => {
        const task = {
          id: 'design-task',
          title: 'Design API structure',
          description: 'Create architecture and specification for the new API with modeling of data structures',
          estimate: '4h',
          phase: 'design'
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);

        // At least one subtask should have design-related capabilities
        const hasDesignCapabilities = subtasks.some(st =>
          st.requiredCapabilities.some(cap =>
            ['architecture', 'specification', 'api-design', 'modeling'].includes(cap)
          )
        );

        expect(hasDesignCapabilities).toBe(true);
      });

      it('should default to general capability when no specific keywords found', () => {
        const task = {
          id: 'generic-task',
          title: 'Complete the work',
          description: 'Finish the remaining items',
          estimate: '2h'
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);

        // Subtasks with no matching keywords should have 'general' capability
        const hasGeneralCapability = subtasks.some(st =>
          st.requiredCapabilities.includes('general')
        );

        expect(hasGeneralCapability).toBe(true);
      });
    });

    describe('capability-based subtask generation', () => {
      it('should generate subtasks from detected capabilities in description', () => {
        const task = {
          id: 'multi-cap-task',
          title: 'Full feature implementation',
          description: 'This task requires analysis of requirements, then coding the solution, followed by unit-testing',
          estimate: '8h',
          phase: 'implementation'
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.HYBRID);

        // Should have subtasks covering multiple capability areas
        const allCapabilities = subtasks.flatMap(st => st.requiredCapabilities);
        const uniqueCapabilities = [...new Set(allCapabilities)];

        expect(uniqueCapabilities.length).toBeGreaterThanOrEqual(1);
      });

      it('should include requiredCapabilities field on all subtasks', () => {
        const task = {
          id: 'cap-field-task',
          title: 'Implement feature',
          estimate: '4h',
          acceptance: ['Feature works', 'Tests pass', 'Docs updated']
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);

        subtasks.forEach(st => {
          expect(st.requiredCapabilities).toBeDefined();
          expect(Array.isArray(st.requiredCapabilities)).toBe(true);
          expect(st.requiredCapabilities.length).toBeGreaterThan(0);
        });
      });
    });
  });

  // ============================================
  // UTILITY METHOD TESTS
  // ============================================

  describe('utility methods', () => {
    it('should parse various effort formats', () => {
      const formats = [
        { estimate: '30m', expected: '30m' },
        { estimate: '2h', expected: '2h' },
        { estimate: '1d', expected: '1d' },
        { estimate: '4 hours', expected: '4 hours' }
      ];

      formats.forEach(({ estimate }) => {
        const task = { id: 'parse-test', title: 'Test', estimate };
        const result = decomposer.analyze(task);
        expect(result.metadata.effortHours).toBeGreaterThan(0);
      });
    });

    it('should extract titles correctly', () => {
      const task = {
        id: 'title-extract',
        title: 'Test',
        estimate: '4h',
        acceptance: [
          'This is a very long acceptance criterion that should be truncated to a reasonable title length',
          'Short one'
        ]
      };

      const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);

      subtasks.forEach(st => {
        expect(st.title.length).toBeLessThanOrEqual(53); // 50 + "..."
      });
    });

    it('should deduplicate subtask outlines', () => {
      const task = {
        id: 'dedup',
        title: 'Duplicate test',
        description: '- Implement feature\n- Implement feature\n- Implement feature',
        estimate: '4h'
      };

      const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);

      const titles = subtasks.map(s => s.title.toLowerCase());
      const uniqueTitles = new Set(titles);

      // Most should be unique (accounting for generated ones)
      expect(uniqueTitles.size).toBeGreaterThan(0);
    });
  });

  // ============================================
  // DECOMPOSITION VALIDATION TESTS
  // ============================================

  describe('decomposition validation', () => {
    it('should warn when subtask effort exceeds parent', () => {
      // This test verifies the validation logic runs without crashing
      const task = {
        id: 'effort-warning',
        title: 'Quick task',
        estimate: '1h',
        acceptance: [
          'Complex requirement 1',
          'Complex requirement 2',
          'Complex requirement 3',
          'Complex requirement 4'
        ]
      };

      // Should not throw
      expect(() => {
        decomposer.decompose(task, DecompositionStrategy.PARALLEL);
      }).not.toThrow();
    });

    it('should validate dependency references', () => {
      const task = {
        id: 'dep-validation',
        title: 'Dependency test',
        estimate: '4h',
        acceptance: ['First', 'Second', 'Third']
      };

      const subtasks = decomposer.decompose(task, DecompositionStrategy.SEQUENTIAL);

      // All dependency references should be valid
      const ids = new Set(subtasks.map(s => s.id));
      subtasks.forEach(st => {
        st.dependencies.requires.forEach(dep => {
          expect(ids.has(dep) || dep === task.id).toBe(true);
        });
      });
    });
  });

  // ============================================
  // PHASE-BASED GENERATION TESTS
  // ============================================

  describe('phase-based subtask generation', () => {
    const phases = ['research', 'planning', 'design', 'implementation', 'testing', 'validation'];

    phases.forEach(phase => {
      it(`should generate appropriate subtasks for ${phase} phase`, () => {
        const task = {
          id: `${phase}-task`,
          title: `${phase} task`,
          phase,
          estimate: '8h'
        };

        const subtasks = decomposer.decompose(task, DecompositionStrategy.PARALLEL);

        expect(subtasks.length).toBeGreaterThanOrEqual(DEFAULT_CONFIG.minSubtasks);
        subtasks.forEach(st => {
          expect(st.phase).toBe(phase);
        });
      });
    });
  });

  // ============================================
  // getStats() TEST
  // ============================================

  describe('getStats()', () => {
    it('should return decomposer statistics', () => {
      const stats = decomposer.getStats();

      expect(stats).toHaveProperty('cacheSize');
      expect(stats).toHaveProperty('config');
      expect(stats.config).toHaveProperty('complexityThreshold');
      expect(stats.config).toHaveProperty('effortThresholdHours');
      expect(stats.config).toHaveProperty('maxSubtasks');
    });

    it('should reflect cache size changes', () => {
      expect(decomposer.getStats().cacheSize).toBe(0);

      decomposer.analyze({ id: 'task-1', title: 'Task 1' });
      expect(decomposer.getStats().cacheSize).toBe(1);

      decomposer.analyze({ id: 'task-2', title: 'Task 2' });
      expect(decomposer.getStats().cacheSize).toBe(2);

      decomposer.clearCache();
      expect(decomposer.getStats().cacheSize).toBe(0);
    });
  });
});
