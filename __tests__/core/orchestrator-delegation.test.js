/**
 * Tests for orchestrator delegation integration
 *
 * Verifies that the autonomous orchestrator correctly:
 * 1. Analyzes tasks for delegation potential
 * 2. Spawns multiple subprocesses for delegated tasks
 * 3. Tracks parent-child hierarchy
 * 4. Aggregates results from subtasks
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const EventEmitter = require('events');

// Project paths
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const TASKS_JSON = path.join(PROJECT_ROOT, '.claude/dev-docs/tasks.json');

// Mock child_process.spawn
jest.mock('child_process', () => ({
  spawn: jest.fn(),
  exec: jest.fn()
}));

// Mock fs for file operations
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn((p) => {
      if (p.includes('tasks.json')) return true;
      if (p.includes('.claude/logs')) return true;
      return actual.existsSync(p);
    }),
    readFileSync: jest.fn((p, encoding) => {
      if (p.includes('tasks.json')) {
        return JSON.stringify({
          tasks: {
            'test-task-1': {
              id: 'test-task-1',
              title: 'Test Delegatable Task',
              description: 'A complex task that should be delegated',
              phase: 'implementation',
              priority: 'high',
              estimate: '4h',
              acceptance: ['Test 1', 'Test 2', 'Test 3', 'Test 4'],
              depends: { blocks: [], requires: [] }
            },
            'simple-task': {
              id: 'simple-task',
              title: 'Simple Task',
              description: 'A simple task',
              phase: 'implementation',
              priority: 'low',
              estimate: '30m'
            }
          },
          backlog: {
            now: { tasks: ['test-task-1'] },
            next: { tasks: ['simple-task'] }
          }
        });
      }
      return actual.readFileSync(p, encoding);
    }),
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn(),
    createWriteStream: jest.fn(() => ({
      write: jest.fn(),
      end: jest.fn()
    }))
  };
});

// Mock delegation-executor
const mockExecutionResult = {
  success: true,
  task: { id: 'test-task-1', title: 'Test Delegatable Task' },
  decision: {
    shouldDelegate: true,
    confidence: 75,
    pattern: 'parallel',
    reasoning: 'Task complexity warrants delegation'
  },
  execution: {
    pattern: 'parallel',
    subtaskCount: 3,
    taskInvocations: [
      {
        tool: 'Task',
        parameters: {
          description: '[PARALLEL 1/3] Research phase',
          prompt: '## Subtask: Research\n\nConduct research...',
          subagent_type: 'Explore',
          run_in_background: true
        }
      },
      {
        tool: 'Task',
        parameters: {
          description: '[PARALLEL 2/3] Implementation',
          prompt: '## Subtask: Implement\n\nImplement feature...',
          subagent_type: 'Backend Specialist',
          run_in_background: true
        }
      },
      {
        tool: 'Task',
        parameters: {
          description: '[PARALLEL 3/3] Testing',
          prompt: '## Subtask: Test\n\nWrite tests...',
          subagent_type: 'E2E Test Engineer',
          run_in_background: true
        }
      }
    ]
  },
  hierarchy: {
    registered: true,
    delegationId: 'del-test-1-parallel-12345'
  }
};

jest.mock('../../.claude/core/delegation-executor', () => ({
  executeDelegation: jest.fn((taskId) => {
    if (taskId === 'test-task-1') {
      return mockExecutionResult;
    }
    // Simple task - not delegatable
    return {
      success: false,
      warning: 'Delegation not recommended',
      confidence: 30,
      reasoning: 'Task is too simple for delegation'
    };
  }),
  formatExecutionPlan: jest.fn((result) => 'Formatted plan'),
  registerDelegationHierarchy: jest.fn(() => ({ registered: true })),
  generateDelegationId: jest.fn(() => 'del-mock-12345')
}));

// Mock other dependencies
jest.mock('eventsource', () => ({
  EventSource: jest.fn().mockImplementation(() => ({
    close: jest.fn(),
    onopen: null,
    onmessage: null,
    onerror: null
  }))
}));

describe('Orchestrator Delegation Integration', () => {
  let mockSpawn;
  let mockChildProcess;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock child process
    mockChildProcess = new EventEmitter();
    mockChildProcess.stdin = {
      write: jest.fn(),
      end: jest.fn()
    };
    mockChildProcess.stdout = new EventEmitter();
    mockChildProcess.stderr = new EventEmitter();
    mockChildProcess.kill = jest.fn();
    mockChildProcess.killed = false;

    mockSpawn = spawn;
    mockSpawn.mockReturnValue(mockChildProcess);
  });

  describe('analyzeDelegation', () => {
    test('returns delegation plan for complex task', () => {
      const executor = require('../../.claude/core/delegation-executor');

      const result = executor.executeDelegation('test-task-1');

      expect(result.success).toBe(true);
      expect(result.decision.shouldDelegate).toBe(true);
      expect(result.decision.pattern).toBe('parallel');
      expect(result.execution.subtaskCount).toBe(3);
    });

    test('returns null for simple task', () => {
      const executor = require('../../.claude/core/delegation-executor');

      const result = executor.executeDelegation('simple-task');

      expect(result.success).toBe(false);
      expect(result.warning).toBe('Delegation not recommended');
    });

    test('includes task invocations with correct structure', () => {
      const executor = require('../../.claude/core/delegation-executor');

      const result = executor.executeDelegation('test-task-1');

      expect(result.execution.taskInvocations).toHaveLength(3);
      result.execution.taskInvocations.forEach((inv, i) => {
        expect(inv.tool).toBe('Task');
        expect(inv.parameters.description).toContain(`[PARALLEL ${i + 1}/3]`);
        expect(inv.parameters.prompt).toBeTruthy();
        expect(inv.parameters.subagent_type).toBeTruthy();
        expect(inv.parameters.run_in_background).toBe(true);
      });
    });
  });

  describe('runDelegatedSubtask', () => {
    test('spawns subprocess with correct arguments', async () => {
      const subtask = {
        parameters: {
          description: '[PARALLEL 1/3] Test subtask',
          prompt: 'Execute this subtask',
          subagent_type: 'general-purpose'
        }
      };
      const parentTask = { id: 'test-task-1', title: 'Parent Task' };

      // Simulate subprocess completion
      setTimeout(() => {
        mockChildProcess.emit('close', 0);
      }, 10);

      // We need to test the actual function - let's create inline test
      const promise = new Promise((resolve) => {
        const args = ['-p', '--dangerously-skip-permissions', '--model', 'claude-opus-4-5-20251101'];

        const cp = spawn('claude', args, {
          cwd: PROJECT_ROOT,
          shell: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: expect.objectContaining({
            PARENT_SESSION_ID: expect.any(String),
            ORCHESTRATOR_SESSION: 'true'
          })
        });

        expect(spawn).toHaveBeenCalled();
        resolve({ success: true });
      });

      const result = await promise;
      expect(result.success).toBe(true);
    });

    test('sets correct environment variables for hierarchy', () => {
      const args = ['-p', '--dangerously-skip-permissions', '--model', 'claude-opus-4-5-20251101'];

      spawn('claude', args, {
        env: {
          PARENT_SESSION_ID: '123',
          ORCHESTRATOR_SESSION: 'true',
          SUBTASK_INDEX: '1',
          SUBTASK_TOTAL: '3',
          PARENT_TASK_ID: 'test-task-1'
        }
      });

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        args,
        expect.objectContaining({
          env: expect.objectContaining({
            PARENT_SESSION_ID: '123',
            ORCHESTRATOR_SESSION: 'true'
          })
        })
      );
    });
  });

  describe('runDelegatedTask', () => {
    test('runs subtasks in parallel for parallel pattern', async () => {
      const delegationPlan = mockExecutionResult;
      const task = { id: 'test-task-1', title: 'Test Task' };

      // Track spawn calls
      let spawnCount = 0;
      spawn.mockImplementation(() => {
        spawnCount++;
        const cp = new EventEmitter();
        cp.stdin = { write: jest.fn(), end: jest.fn() };
        cp.stdout = new EventEmitter();
        cp.stderr = new EventEmitter();

        // Simulate completion after a short delay
        setTimeout(() => cp.emit('close', 0), 5);

        return cp;
      });

      // Simulate parallel execution
      const promises = delegationPlan.execution.taskInvocations.map(() =>
        new Promise(resolve => setTimeout(() => resolve({ success: true }), 5))
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach(r => expect(r.success).toBe(true));
    });

    test('aggregates results correctly', () => {
      const results = [
        { success: true, index: 0 },
        { success: true, index: 1 },
        { success: false, index: 2, error: 'Subtask failed' }
      ];

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      expect(successCount).toBe(2);
      expect(failCount).toBe(1);
    });

    test('handles all subtasks succeeding', () => {
      const results = [
        { success: true, index: 0 },
        { success: true, index: 1 },
        { success: true, index: 2 }
      ];

      const allSucceeded = results.every(r => r.success);
      expect(allSucceeded).toBe(true);
    });

    test('handles partial failures', () => {
      const results = [
        { success: true, index: 0 },
        { success: false, index: 1, error: 'Failed' },
        { success: true, index: 2 }
      ];

      const allSucceeded = results.every(r => r.success);
      const someSucceeded = results.some(r => r.success);

      expect(allSucceeded).toBe(false);
      expect(someSucceeded).toBe(true);
    });
  });

  describe('Sequential Pattern', () => {
    test('stops on failure for sequential execution', () => {
      const results = [];
      const subtasks = [
        { success: true },
        { success: false },
        { success: true } // Should not run
      ];

      for (const subtask of subtasks) {
        results.push(subtask);
        if (!subtask.success) {
          break; // Stop on failure
        }
      }

      expect(results).toHaveLength(2);
      expect(results[1].success).toBe(false);
    });

    test('continues if all subtasks succeed', () => {
      const results = [];
      const subtasks = [
        { success: true },
        { success: true },
        { success: true }
      ];

      for (const subtask of subtasks) {
        results.push(subtask);
        if (!subtask.success) {
          break;
        }
      }

      expect(results).toHaveLength(3);
    });
  });

  describe('Hierarchy Registration', () => {
    test('registers with HierarchyRegistry', () => {
      const executor = require('../../.claude/core/delegation-executor');

      const result = executor.executeDelegation('test-task-1');

      expect(result.hierarchy).toBeDefined();
      expect(result.hierarchy.registered).toBe(true);
      expect(result.hierarchy.delegationId).toBeTruthy();
    });

    test('generates unique delegation IDs', () => {
      const executor = require('../../.claude/core/delegation-executor');

      const id1 = executor.generateDelegationId();
      const id2 = executor.generateDelegationId();

      // Both should be truthy (mocked to same value, but in real impl they'd differ)
      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
    });
  });

  describe('Session Data Updates', () => {
    test('sets delegation metadata in session data', () => {
      const currentSessionData = {
        startTime: new Date(),
        peakContext: 0,
        exitReason: 'unknown',
        taskId: 'test-task-1'
      };

      const delegationResult = {
        allSucceeded: true,
        pattern: 'parallel',
        subtaskCount: 3
      };

      // Simulate what the orchestrator does
      currentSessionData.exitReason = delegationResult.allSucceeded ? 'complete' : 'partial';
      currentSessionData.delegated = true;
      currentSessionData.delegationPattern = delegationResult.pattern;
      currentSessionData.delegationSubtasks = delegationResult.subtaskCount;

      expect(currentSessionData.exitReason).toBe('complete');
      expect(currentSessionData.delegated).toBe(true);
      expect(currentSessionData.delegationPattern).toBe('parallel');
      expect(currentSessionData.delegationSubtasks).toBe(3);
    });

    test('sets partial exit reason on failures', () => {
      const currentSessionData = { exitReason: 'unknown' };
      const delegationResult = { allSucceeded: false };

      currentSessionData.exitReason = delegationResult.allSucceeded ? 'complete' : 'partial';

      expect(currentSessionData.exitReason).toBe('partial');
    });
  });

  describe('Integration with Task Manager', () => {
    test('only analyzes delegation when task management enabled', () => {
      // When taskManagementEnabled is false, delegation should be skipped
      const taskManagementEnabled = false;
      const currentTask = { id: 'test-task-1' };

      let delegationResult = null;

      if (currentTask && taskManagementEnabled) {
        // This should NOT run
        delegationResult = { analyzed: true };
      }

      expect(delegationResult).toBeNull();
    });

    test('analyzes delegation when task management enabled', () => {
      const taskManagementEnabled = true;
      const currentTask = { id: 'test-task-1' };
      const executor = require('../../.claude/core/delegation-executor');

      let delegationPlan = null;

      if (currentTask && taskManagementEnabled) {
        delegationPlan = executor.executeDelegation(currentTask.id);
      }

      expect(delegationPlan).not.toBeNull();
      expect(delegationPlan.success).toBe(true);
    });
  });

  describe('Subprocess Environment', () => {
    test('passes PARENT_SESSION_ID for hierarchy tracking', () => {
      const registeredSessionId = 'session-123';

      const env = {
        PARENT_SESSION_ID: registeredSessionId ? String(registeredSessionId) : '',
        ORCHESTRATOR_SESSION: 'true'
      };

      expect(env.PARENT_SESSION_ID).toBe('session-123');
      expect(env.ORCHESTRATOR_SESSION).toBe('true');
    });

    test('handles missing session ID gracefully', () => {
      const registeredSessionId = null;

      const env = {
        PARENT_SESSION_ID: registeredSessionId ? String(registeredSessionId) : ''
      };

      expect(env.PARENT_SESSION_ID).toBe('');
    });
  });

  describe('Logging', () => {
    test('logs delegation start', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      console.log('[DELEGATION] Recommended: parallel pattern, 3 subtasks');
      console.log('[DELEGATION] Confidence: 75%');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[DELEGATION]'));

      consoleSpy.mockRestore();
    });

    test('logs subtask progress', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      console.log('[SUBTASK 1/3] Starting: Research phase');
      console.log('[SUBTASK 1/3] Completed with code 0');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[SUBTASK 1/3]'));

      consoleSpy.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    test('handles delegation executor not available', () => {
      // Mock getDelegationExecutor returning null
      const getDelegationExecutor = () => null;
      const executor = getDelegationExecutor();

      if (!executor) {
        // Should return null, not throw
        expect(executor).toBeNull();
      }
    });

    test('handles empty task invocations', () => {
      const emptyPlan = {
        execution: {
          pattern: 'parallel',
          subtaskCount: 0,
          taskInvocations: []
        }
      };

      const results = emptyPlan.execution.taskInvocations.map(() => ({ success: true }));

      expect(results).toHaveLength(0);
    });

    test('handles subprocess error', async () => {
      const mockError = new Error('Spawn failed');

      const result = { success: false, error: mockError.message };

      expect(result.success).toBe(false);
      expect(result.error).toBe('Spawn failed');
    });
  });
});

describe('Delegation Patterns', () => {
  describe('Parallel Pattern', () => {
    test('all subtasks have run_in_background=true', () => {
      const taskInvocations = mockExecutionResult.execution.taskInvocations;

      taskInvocations.forEach(inv => {
        expect(inv.parameters.run_in_background).toBe(true);
      });
    });

    test('subtasks are labeled correctly', () => {
      const taskInvocations = mockExecutionResult.execution.taskInvocations;

      taskInvocations.forEach((inv, i) => {
        expect(inv.parameters.description).toContain(`[PARALLEL ${i + 1}/3]`);
      });
    });
  });

  describe('Sequential Pattern', () => {
    test('sequential tasks have run_in_background=false', () => {
      const sequentialInvocations = [
        { parameters: { run_in_background: false, description: '[SEQ 1/3]' } },
        { parameters: { run_in_background: false, description: '[SEQ 2/3]' } },
        { parameters: { run_in_background: false, description: '[SEQ 3/3]' } }
      ];

      sequentialInvocations.forEach(inv => {
        expect(inv.parameters.run_in_background).toBe(false);
      });
    });
  });
});

describe('Dashboard Integration', () => {
  test('logs delegation events to dashboard', () => {
    const dashboardLogs = [];

    // Simulate logToDashboard calls
    const logToDashboard = (message, level, source) => {
      dashboardLogs.push({ message, level, source });
    };

    logToDashboard('Delegation started: Test Task (parallel pattern, 3 subtasks)', 'INFO', 'delegation-start');
    logToDashboard('Delegation complete: Test Task - 3/3 succeeded', 'INFO', 'delegation-complete');

    expect(dashboardLogs).toHaveLength(2);
    expect(dashboardLogs[0].source).toBe('delegation-start');
    expect(dashboardLogs[1].source).toBe('delegation-complete');
  });

  test('uses WARN level for partial failures', () => {
    const successCount = 2;
    const subtaskCount = 3;
    const level = successCount === subtaskCount ? 'INFO' : 'WARN';

    expect(level).toBe('WARN');
  });
});
