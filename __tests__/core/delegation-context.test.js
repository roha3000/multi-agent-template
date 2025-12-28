/**
 * Tests for DelegationContext
 */
const { DelegationContext, DEFAULT_CONSTRAINTS, DEFAULT_CHILD_QUOTAS } = require('../../.claude/core/delegation-context');

describe('DelegationContext', () => {
  describe('constructor', () => {
    it('should create with default values', () => {
      const ctx = new DelegationContext();

      expect(ctx.delegationId).toMatch(/^del-/);
      expect(ctx.taskId).toBeNull();
      expect(ctx.parentAgentId).toBeNull();
      expect(ctx.delegationDepth).toBe(0);
      expect(ctx.task.title).toBe('');
      expect(ctx.constraints.tokenBudget).toBe(DEFAULT_CONSTRAINTS.tokenBudget);
    });

    it('should accept custom configuration', () => {
      const ctx = new DelegationContext({
        delegationId: 'del-test-123',
        taskId: 'task-1',
        parentAgentId: 'agent-parent',
        delegationDepth: 2,
        task: {
          title: 'Test Task',
          description: 'Test Description',
          type: 'research'
        },
        constraints: {
          tokenBudget: 5000,
          mustComplete: true
        }
      });

      expect(ctx.delegationId).toBe('del-test-123');
      expect(ctx.taskId).toBe('task-1');
      expect(ctx.parentAgentId).toBe('agent-parent');
      expect(ctx.delegationDepth).toBe(2);
      expect(ctx.task.title).toBe('Test Task');
      expect(ctx.constraints.tokenBudget).toBe(5000);
      expect(ctx.constraints.mustComplete).toBe(true);
    });

    it('should limit acceptance criteria to 5 items', () => {
      const ctx = new DelegationContext({
        task: {
          acceptanceCriteria: ['a', 'b', 'c', 'd', 'e', 'f', 'g']
        }
      });

      expect(ctx.task.acceptanceCriteria.length).toBe(5);
    });

    it('should estimate tokens', () => {
      const ctx = new DelegationContext({
        task: { title: 'Test', description: 'A task' }
      });

      expect(ctx.metadata.estimatedTokens).toBeGreaterThan(0);
    });
  });

  describe('buildDelegationContext', () => {
    const mockParentAgent = {
      id: 'agent-parent',
      role: 'coordinator',
      canDelegate: () => true,
      hierarchyConfig: {
        currentDepth: 1,
        quotas: {
          remainingDelegations: 5,
          maxTokensPerDelegation: 10000,
          remainingChildren: 3
        }
      }
    };

    const mockTask = {
      id: 'task-main',
      title: 'Main Task',
      phase: 'implementation',
      deadline: new Date(Date.now() + 300000) // 5 minutes from now
    };

    const mockSubtask = {
      id: 'subtask-1',
      title: 'Subtask One',
      description: 'Do something specific',
      type: 'implementation'
    };

    it('should build context from parent agent and task', () => {
      const ctx = DelegationContext.buildDelegationContext(
        mockParentAgent,
        mockTask,
        mockSubtask
      );

      expect(ctx.parentAgentId).toBe('agent-parent');
      expect(ctx.taskId).toBe('subtask-1');
      expect(ctx.delegationDepth).toBe(2);
      expect(ctx.task.title).toBe('Subtask One');
    });

    it('should throw if parent cannot delegate', () => {
      const blockedAgent = {
        id: 'blocked-agent',
        canDelegate: () => false
      };

      expect(() => {
        DelegationContext.buildDelegationContext(blockedAgent, mockTask, mockSubtask);
      }).toThrow('Parent agent cannot delegate');
    });

    it('should calculate token budget', () => {
      const ctx = DelegationContext.buildDelegationContext(
        mockParentAgent,
        mockTask,
        mockSubtask,
        { numChildren: 2 }
      );

      expect(ctx.constraints.tokenBudget).toBeGreaterThan(0);
      expect(ctx.constraints.tokenBudget).toBeLessThan(10000);
    });

    it('should calculate token reduction', () => {
      const ctx = DelegationContext.buildDelegationContext(
        mockParentAgent,
        mockTask,
        mockSubtask,
        { fullContextTokens: 7500 }
      );

      expect(ctx.metadata.tokenReduction).toBeGreaterThan(0);
    });

    it('should handle null parent agent gracefully', () => {
      const ctx = DelegationContext.buildDelegationContext(
        null,
        mockTask,
        mockSubtask
      );

      expect(ctx.delegationDepth).toBe(1);
      expect(ctx.parentAgentId).toBeNull();
    });

    it('should set deadline with buffer', () => {
      const ctx = DelegationContext.buildDelegationContext(
        mockParentAgent,
        mockTask,
        mockSubtask
      );

      const parentDeadline = new Date(mockTask.deadline).getTime();
      const contextDeadline = new Date(ctx.constraints.deadline).getTime();

      // Context deadline should be before parent deadline (buffer applied)
      expect(contextDeadline).toBeLessThan(parentDeadline);
    });
  });

  describe('_selectRelevantArtifacts', () => {
    it('should return empty for no artifacts', () => {
      const result = DelegationContext._selectRelevantArtifacts([], {}, 400);
      expect(result).toEqual([]);
    });

    it('should select relevant artifacts by keyword', () => {
      const artifacts = [
        { path: 'src/auth.js', summary: 'Authentication logic' },
        { path: 'src/utils.js', summary: 'Utility functions' },
        { path: 'src/login.js', summary: 'Login component for authentication' }
      ];
      const subtask = { title: 'Fix authentication bug' };

      const result = DelegationContext._selectRelevantArtifacts(artifacts, subtask, 400);

      expect(result.length).toBeLessThanOrEqual(3);
      // Auth-related artifacts should have higher relevance
      const authArtifact = result.find(a => a.path.includes('auth'));
      expect(authArtifact).toBeDefined();
    });

    it('should boost recent artifacts', () => {
      const now = Date.now();
      const artifacts = [
        { path: 'old.js', summary: 'Old file', timestamp: new Date(now - 86400000 * 2) },
        { path: 'new.js', summary: 'New file', timestamp: new Date(now - 1800000) }
      ];
      const subtask = { title: 'Any task' };

      const result = DelegationContext._selectRelevantArtifacts(artifacts, subtask, 400);

      const newArtifact = result.find(a => a.path === 'new.js');
      const oldArtifact = result.find(a => a.path === 'old.js');

      if (newArtifact && oldArtifact) {
        expect(newArtifact.relevance).toBeGreaterThan(oldArtifact.relevance);
      }
    });
  });

  describe('_summarizePhase', () => {
    it('should return phase summary for known phases', () => {
      expect(DelegationContext._summarizePhase('research')).toContain('Research');
      expect(DelegationContext._summarizePhase('implementation')).toContain('Implementation');
      expect(DelegationContext._summarizePhase('testing')).toContain('Testing');
    });

    it('should handle unknown phases', () => {
      const result = DelegationContext._summarizePhase('custom-phase');
      expect(result).toContain('custom-phase');
    });
  });

  describe('_truncateToTokens', () => {
    it('should return empty for null/undefined', () => {
      expect(DelegationContext._truncateToTokens(null, 100)).toBe('');
      expect(DelegationContext._truncateToTokens(undefined, 100)).toBe('');
    });

    it('should not truncate short text', () => {
      const text = 'Short text';
      expect(DelegationContext._truncateToTokens(text, 100)).toBe(text);
    });

    it('should truncate long text with ellipsis', () => {
      const text = 'This is a very long text that needs to be truncated';
      const result = DelegationContext._truncateToTokens(text, 5);

      expect(result.endsWith('...')).toBe(true);
      expect(result.length).toBeLessThanOrEqual(23); // 5 tokens * 4 chars + 3 for ...
    });
  });

  describe('toJSON', () => {
    it('should serialize all properties', () => {
      const ctx = new DelegationContext({
        delegationId: 'del-test',
        taskId: 'task-1',
        task: { title: 'Test' }
      });

      const json = ctx.toJSON();

      expect(json.delegationId).toBe('del-test');
      expect(json.taskId).toBe('task-1');
      expect(json.task).toBeDefined();
      expect(json.constraints).toBeDefined();
      expect(json.communication).toBeDefined();
      expect(json.metadata).toBeDefined();
    });
  });

  describe('communication channels', () => {
    it('should generate unique channel names', () => {
      const ctx = new DelegationContext({ delegationId: 'del-123' });

      expect(ctx.getInstructionChannel()).toBe('delegation:del-123:instructions');
      expect(ctx.getResultChannel()).toBe('delegation:del-123:result');
    });
  });

  describe('deadline management', () => {
    it('should detect expired context', () => {
      const ctx = new DelegationContext({
        constraints: { deadline: new Date(Date.now() - 1000) }
      });

      expect(ctx.isExpired()).toBe(true);
    });

    it('should detect non-expired context', () => {
      const ctx = new DelegationContext({
        constraints: { deadline: new Date(Date.now() + 60000) }
      });

      expect(ctx.isExpired()).toBe(false);
    });

    it('should calculate remaining time', () => {
      const futureTime = Date.now() + 30000;
      const ctx = new DelegationContext({
        constraints: { deadline: new Date(futureTime) }
      });

      const remaining = ctx.getRemainingTime();
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(30000);
    });

    it('should return 0 for expired deadline', () => {
      const ctx = new DelegationContext({
        constraints: { deadline: new Date(Date.now() - 1000) }
      });

      expect(ctx.getRemainingTime()).toBe(0);
    });
  });

  describe('quality threshold', () => {
    it('should check if score meets threshold', () => {
      const ctx = new DelegationContext({
        constraints: { qualityThreshold: 70 }
      });

      expect(ctx.meetsQualityThreshold(80)).toBe(true);
      expect(ctx.meetsQualityThreshold(70)).toBe(true);
      expect(ctx.meetsQualityThreshold(60)).toBe(false);
    });
  });
});
