/**
 * Tests for delegation-executor.js
 * Phase 4: Execution Integration tests
 */

const path = require('path');
const fs = require('fs');

// Mock dependencies before requiring the module
jest.mock('../../.claude/core/delegation-bridge', () => ({
  getFullDecision: jest.fn(),
  matchKnownTask: jest.fn(),
  loadConfig: jest.fn(() => ({
    enabled: true,
    minComplexityThreshold: 35,
    minSubtaskCount: 3
  }))
}));

jest.mock('../../.claude/core/task-decomposer', () => ({
  TaskDecomposer: jest.fn().mockImplementation(() => ({
    decompose: jest.fn((task, strategy) => [
      { title: 'Subtask 1', description: 'First subtask' },
      { title: 'Subtask 2', description: 'Second subtask' },
      { title: 'Subtask 3', description: 'Third subtask' }
    ]),
    analyze: jest.fn(() => ({
      shouldDecompose: true,
      suggestedSubtasks: ['a', 'b', 'c'],
      confidence: 80
    }))
  }))
}));

const {
  parseArguments,
  resolveTask,
  getDelegationDecision,
  getSubtasks,
  generateParallelTasks,
  generateSequentialTasks,
  generateDebateTasks,
  generateReviewTasks,
  determineAgentType,
  buildSubtaskPrompt,
  executeDelegation,
  formatExecutionPlan
} = require('../../.claude/core/delegation-executor');

const mockBridge = require('../../.claude/core/delegation-bridge');

describe('DelegationExecutor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseArguments', () => {
    test('parses long options correctly', () => {
      const result = parseArguments('--pattern=parallel --depth=2 --dry-run task description');
      expect(result.options.pattern).toBe('parallel');
      expect(result.options.depth).toBe(2);
      expect(result.options.dryRun).toBe(true);
      expect(result.taskDescription).toContain('task description');
    });

    test('parses short options correctly', () => {
      const result = parseArguments('-p sequential -d 1 -a 3 build tests');
      expect(result.options.pattern).toBe('sequential');
      expect(result.options.depth).toBe(1);
      expect(result.options.agents).toBe(3);
      expect(result.taskDescription).toContain('build tests');
    });

    test('parses --force flag', () => {
      const result = parseArguments('--force simple task');
      expect(result.options.force).toBe(true);
    });

    test('parses -f short flag', () => {
      const result = parseArguments('-f simple task');
      expect(result.options.force).toBe(true);
    });

    test('handles task ID only', () => {
      const result = parseArguments('auto-delegation-phase4');
      expect(result.taskDescription).toBe('auto-delegation-phase4');
      expect(result.options.pattern).toBeNull();
    });

    test('parses budget option', () => {
      const result = parseArguments('--budget=50000 complex task');
      expect(result.options.budget).toBe(50000);
    });
  });

  describe('determineAgentType', () => {
    test('returns Explore for research tasks', () => {
      expect(determineAgentType({ title: 'Research API options', description: '' }, {})).toBe('Explore');
      expect(determineAgentType({ title: 'Investigate performance', description: '' }, {})).toBe('Explore');
      expect(determineAgentType({ title: 'Analyze codebase', description: '' }, {})).toBe('Explore');
    });

    test('returns Backend Specialist for backend tasks', () => {
      expect(determineAgentType({ title: 'Build API endpoint', description: '' }, {})).toBe('Backend Specialist');
      expect(determineAgentType({ title: 'Create server logic', description: '' }, {})).toBe('Backend Specialist');
    });

    test('returns Frontend Specialist for UI tasks', () => {
      expect(determineAgentType({ title: 'Build UI component', description: '' }, {})).toBe('Frontend Specialist');
      expect(determineAgentType({ title: 'Create frontend form', description: '' }, {})).toBe('Frontend Specialist');
    });

    test('returns E2E Test Engineer for test tasks', () => {
      expect(determineAgentType({ title: 'Test the feature', description: '' }, {})).toBe('E2E Test Engineer');
      expect(determineAgentType({ title: 'Validate implementation', description: '' }, {})).toBe('E2E Test Engineer');
    });

    test('returns Plan for design tasks', () => {
      expect(determineAgentType({ title: 'Design architecture', description: '' }, {})).toBe('Plan');
      expect(determineAgentType({ title: 'Plan implementation', description: '' }, {})).toBe('Plan');
    });

    test('returns general-purpose for generic tasks', () => {
      expect(determineAgentType({ title: 'Do something', description: '' }, {})).toBe('general-purpose');
    });
  });

  describe('generateParallelTasks', () => {
    test('generates parallel task invocations', () => {
      const subtasks = [
        { id: 'sub-1', title: 'First', description: 'First task' },
        { id: 'sub-2', title: 'Second', description: 'Second task' }
      ];
      const parentTask = { id: 'parent', title: 'Parent Task', phase: 'implementation' };

      const result = generateParallelTasks(subtasks, parentTask);

      expect(result).toHaveLength(2);
      expect(result[0].tool).toBe('Task');
      expect(result[0].parameters.run_in_background).toBe(true);
      expect(result[0].parameters.description).toContain('[PARALLEL 1/2]');
      expect(result[1].parameters.description).toContain('[PARALLEL 2/2]');
    });
  });

  describe('generateSequentialTasks', () => {
    test('generates sequential task invocations', () => {
      const subtasks = [
        { id: 'sub-1', title: 'First', description: 'First task' },
        { id: 'sub-2', title: 'Second', description: 'Second task' }
      ];
      const parentTask = { id: 'parent', title: 'Parent Task' };

      const result = generateSequentialTasks(subtasks, parentTask);

      expect(result).toHaveLength(2);
      expect(result[0].parameters.run_in_background).toBe(false);
      expect(result[0].parameters.description).toContain('[SEQ 1/2]');
      expect(result[1].waitForPrevious).toBe(true);
    });
  });

  describe('generateDebateTasks', () => {
    test('generates three debate agents', () => {
      const task = { id: 'debate-task', title: 'Design API', description: 'Choose API design' };

      const result = generateDebateTasks(task);

      expect(result).toHaveLength(3);
      expect(result[0].parameters.description).toContain('[PRO]');
      expect(result[1].parameters.description).toContain('[CON]');
      expect(result[2].parameters.description).toContain('[SYNTH]');
    });
  });

  describe('generateReviewTasks', () => {
    test('generates impl and review agents', () => {
      const task = { id: 'review-task', title: 'Build Feature', description: 'Implement feature' };

      const result = generateReviewTasks(task);

      expect(result).toHaveLength(2);
      expect(result[0].parameters.description).toContain('[IMPL]');
      expect(result[1].parameters.description).toContain('[REVIEW]');
    });
  });

  describe('buildSubtaskPrompt', () => {
    test('includes subtask title and description', () => {
      const subtask = { title: 'Test Subtask', description: 'Do the thing' };
      const parentTask = { title: 'Parent', phase: 'testing' };

      const prompt = buildSubtaskPrompt(subtask, parentTask, 'parallel');

      expect(prompt).toContain('## Subtask: Test Subtask');
      expect(prompt).toContain('Do the thing');
      expect(prompt).toContain('Parent');
    });

    test('includes parallel note for parallel pattern', () => {
      const prompt = buildSubtaskPrompt(
        { title: 'Sub', description: 'Desc' },
        { title: 'Parent' },
        'parallel'
      );

      expect(prompt).toContain('parallel task');
      expect(prompt).toContain('Work independently');
    });

    test('includes sequential note for sequential pattern', () => {
      const prompt = buildSubtaskPrompt(
        { title: 'Sub', description: 'Desc' },
        { title: 'Parent' },
        'sequential',
        1
      );

      expect(prompt).toContain('sequential task');
      expect(prompt).toContain('Previous steps');
    });
  });

  describe('getDelegationDecision', () => {
    test('returns decision from bridge', () => {
      mockBridge.getFullDecision.mockReturnValue({
        shouldDelegate: true,
        confidence: 85,
        reasoning: 'Complex task',
        pattern: 'parallel'
      });

      const task = { id: 'test', title: 'Test', description: 'Test task' };
      const decision = getDelegationDecision(task);

      expect(decision.shouldDelegate).toBe(true);
      expect(decision.confidence).toBe(85);
      expect(decision.pattern).toBe('parallel');
    });

    test('respects --force option', () => {
      mockBridge.getFullDecision.mockReturnValue({
        shouldDelegate: false,
        confidence: 30,
        reasoning: 'Simple task'
      });

      const task = { id: 'test', title: 'Test', description: 'Simple' };
      const decision = getDelegationDecision(task, { force: true });

      expect(decision.shouldDelegate).toBe(true);
      expect(decision.reasoning).toContain('Forced');
    });

    test('uses option pattern override', () => {
      mockBridge.getFullDecision.mockReturnValue({
        shouldDelegate: true,
        pattern: 'sequential'
      });

      const task = { id: 'test', title: 'Test' };
      const decision = getDelegationDecision(task, { pattern: 'debate' });

      expect(decision.pattern).toBe('debate');
    });
  });

  describe('executeDelegation', () => {
    test('returns error for empty input', () => {
      const result = executeDelegation('');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No task description');
    });

    test('returns error for very short input', () => {
      const result = executeDelegation('ab');
      expect(result.success).toBe(false);
    });

    test('returns warning when delegation not recommended', () => {
      mockBridge.getFullDecision.mockReturnValue({
        shouldDelegate: false,
        confidence: 25,
        reasoning: 'Too simple'
      });
      mockBridge.matchKnownTask.mockReturnValue(null);

      const result = executeDelegation('simple task here');

      expect(result.success).toBe(false);
      expect(result.warning).toBe('Delegation not recommended');
      expect(result.hint).toContain('--force');
    });

    test('generates execution plan with --force', () => {
      mockBridge.getFullDecision.mockReturnValue({
        shouldDelegate: false,
        confidence: 25
      });
      mockBridge.matchKnownTask.mockReturnValue(null);

      const result = executeDelegation('--force simple task');

      expect(result.success).toBe(true);
      expect(result.execution).toBeDefined();
      expect(result.execution.taskInvocations).toBeDefined();
    });

    test('generates dry-run plan', () => {
      mockBridge.getFullDecision.mockReturnValue({
        shouldDelegate: true,
        confidence: 80,
        pattern: 'parallel',
        reasoning: 'Complex task'
      });
      mockBridge.matchKnownTask.mockReturnValue(null);

      // Use --force with --dry-run to ensure delegation proceeds
      const result = executeDelegation('--dry-run --force complex implementation task');

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.subtasks).toBeDefined();
    });
  });

  describe('formatExecutionPlan', () => {
    test('formats error result', () => {
      const result = { success: false, error: 'Test error', hint: 'Try again' };
      const formatted = formatExecutionPlan(result);

      expect(formatted).toContain('Error');
      expect(formatted).toContain('Test error');
      expect(formatted).toContain('Try again');
    });

    test('formats warning result', () => {
      const result = { success: false, warning: 'Not recommended', reasoning: 'Too simple' };
      const formatted = formatExecutionPlan(result);

      expect(formatted).toContain('Warning');
      expect(formatted).toContain('Not recommended');
    });

    test('formats dry-run result', () => {
      const result = {
        success: true,
        dryRun: true,
        task: { id: 'test', title: 'Test Task' },
        decision: { pattern: 'parallel', confidence: 85 },
        subtasks: [
          { id: 'sub-1', title: 'Sub 1', agentType: 'general-purpose' }
        ],
        estimatedAgents: 1
      };

      const formatted = formatExecutionPlan(result);

      expect(formatted).toContain('Dry Run');
      expect(formatted).toContain('Test Task');
      expect(formatted).toContain('parallel');
      expect(formatted).toContain('Sub 1');
    });

    test('formats execution plan', () => {
      const result = {
        success: true,
        task: { id: 'test', title: 'Test Task' },
        execution: {
          pattern: 'sequential',
          subtaskCount: 2,
          taskInvocations: [
            {
              tool: 'Task',
              parameters: {
                description: '[SEQ 1/2] First',
                prompt: 'Do first thing',
                subagent_type: 'general-purpose'
              }
            }
          ]
        }
      };

      const formatted = formatExecutionPlan(result);

      expect(formatted).toContain('Execution Plan');
      expect(formatted).toContain('sequential');
      expect(formatted).toContain('[SEQ 1/2]');
      expect(formatted).toContain('Task');
    });
  });
});
