# Auto-Delegation Control Interface Specification

**Created**: 2025-12-29
**Status**: Draft
**Related**: AUTO-DELEGATION-UX-DESIGN.md

---

## Overview

This document specifies the control interface for auto-delegation, including command syntax, configuration schema, and integration APIs.

---

## 1. Prompt Command Syntax

### 1.1 Force Delegation Command

```
/delegate [options] <task description or task-id>
```

**Options**:
| Option | Short | Description | Example |
|--------|-------|-------------|---------|
| `--pattern=<type>` | `-p` | Force execution pattern | `/delegate -p parallel` |
| `--depth=<n>` | `-d` | Set max depth | `/delegate -d 2` |
| `--agents=<n>` | `-a` | Set max agents | `/delegate -a 5` |
| `--budget=<tokens>` | `-b` | Set token budget | `/delegate -b 10000` |
| `--dry-run` | | Show plan without executing | `/delegate --dry-run` |

**Examples**:
```bash
# Basic delegation
/delegate Implement user authentication

# With pattern override
/delegate --pattern=debate Design API architecture

# With depth limit
/delegate -d 1 Refactor the database layer

# Task reference
/delegate audit-cleanup-phase1

# Dry run (preview only)
/delegate --dry-run Build the test suite
```

### 1.2 Force Direct Execution Command

```
/direct <task description or task-id>
```

**Examples**:
```bash
# Skip delegation for simple task
/direct Fix the typo in README.md

# Force direct even for complex task
/direct Implement entire authentication system
```

### 1.3 Delegation Control Commands

```bash
# View active delegations
/delegation status

# Pause a delegation
/delegation pause <delegation-id>

# Resume a delegation
/delegation resume <delegation-id>

# Cancel a delegation
/delegation cancel <delegation-id>

# View delegation history
/delegation history [--limit=10]

# Get delegation hint without executing
/delegation hint <task>

# Modify settings for current session
/delegation config --mode=suggest
```

---

## 2. Configuration Schema

### 2.1 Global Configuration

**Location**: `.claude/config.json` or project-level `claude.config.js`

```javascript
// claude.config.js
module.exports = {
  delegation: {
    // Delegation mode
    mode: 'suggest', // 'disabled' | 'suggest' | 'auto' | 'smart'

    // Decision thresholds
    thresholds: {
      // Minimum score to suggest delegation (0-100)
      delegationScore: 60,

      // Minimum confidence to auto-accept (0-100)
      autoAcceptConfidence: 85,

      // Complexity score that triggers consideration (0-100)
      complexityTrigger: 50,

      // Minimum subtasks to consider delegation
      minSubtasks: 3,

      // Effort threshold (hours)
      effortHours: 4,

      // Context utilization % that triggers delegation
      contextUtilization: 75
    },

    // Resource limits
    limits: {
      // Maximum delegation depth (1-5)
      maxDepth: 3,

      // Maximum concurrent child agents
      maxConcurrentAgents: 5,

      // Token budget per child agent
      tokenBudgetPerChild: 1000,

      // Maximum total token budget for delegation tree
      maxTotalTokens: 50000,

      // Timeout per subtask (ms)
      subtaskTimeout: 600000, // 10 min

      // Timeout for entire delegation (ms)
      delegationTimeout: 3600000 // 1 hour
    },

    // Pattern preferences
    patterns: {
      // Default pattern when not auto-selected
      default: 'parallel',

      // Pattern selection hints (keyword -> pattern)
      hints: {
        parallel: ['concurrent', 'independent', 'batch'],
        sequential: ['depends', 'after', 'then', 'before'],
        debate: ['discuss', 'evaluate', 'compare'],
        review: ['create', 'write', 'draft', 'review'],
        ensemble: ['validate', 'verify', 'critical']
      }
    },

    // UI preferences
    ui: {
      // Show reasoning panel by default
      showReasoningPanel: true,

      // Expand progress tree by default
      expandProgressTree: false,

      // Play sound on completion
      notificationSound: false,

      // Use compact inline suggestions
      compactMode: false,

      // Auto-collapse completed subtasks
      autoCollapseCompleted: true,

      // Show token usage in progress
      showTokenUsage: true
    },

    // Recovery options
    recovery: {
      // Auto-retry failed subtasks
      autoRetry: true,

      // Maximum retry attempts
      maxRetries: 2,

      // Rollback on failure
      rollbackOnFailure: false,

      // Continue on partial failure
      continueOnPartialFailure: true
    },

    // Logging
    logging: {
      // Log delegation decisions
      logDecisions: true,

      // Log subtask progress
      logProgress: true,

      // Store delegation history
      storeHistory: true,

      // History retention (days)
      historyRetention: 30
    }
  }
};
```

### 2.2 Per-Task Configuration

**Location**: `tasks.json` task definition

```json
{
  "id": "audit-cleanup-phase1",
  "title": "Audit Cleanup Phase 1",

  "delegationConfig": {
    "mode": "auto",
    "maxDepth": 2,
    "pattern": "sequential",
    "tokenBudget": 20000,
    "qualityThreshold": 80,
    "subtaskApproval": false,
    "rollbackOnFailure": true,
    "agentHints": {
      "cleanup-1": ["delete", "remove"],
      "doc-fixer": ["documentation", "links"]
    }
  }
}
```

### 2.3 Runtime Override API

```javascript
// Override for current session
delegationManager.setSessionConfig({
  mode: 'auto',
  limits: { maxDepth: 2 }
});

// Override for specific task execution
await delegationManager.execute(task, {
  forceDelegation: true,
  pattern: 'parallel',
  maxDepth: 1
});
```

---

## 3. Delegation Decision API

### 3.1 Decision Request

```javascript
// Get delegation decision without executing
const decision = await delegationDecider.shouldDelegate(task, agent, {
  skipCache: false,
  includeSubtasks: true,
  includeReasoning: true
});
```

### 3.2 Decision Response Schema

```typescript
interface DelegationDecision {
  // Core decision
  shouldDelegate: boolean;
  confidence: number; // 0-100
  score: number; // 0-100

  // Decision factors (individual contributions)
  factors: {
    complexity: number;      // 0-100
    contextUtilization: number; // 0-100
    subtaskCount: number;    // count
    agentConfidence: number; // 0-100
    agentLoad: number;       // 0-100
    depthRemaining: number;  // count
  };

  // Factor contributions to score
  factorContributions: {
    complexity: number;
    contextUtilization: number;
    subtaskCount: number;
    confidence: number;
    agentLoad: number;
    depthRemaining: number;
  };

  // Suggested execution pattern
  suggestedPattern: 'parallel' | 'sequential' | 'debate' | 'review' | 'ensemble' | 'direct';

  // Human-readable reasoning
  reasoning: string;

  // Actionable hints
  hints: string[];

  // Proposed subtasks (if decomposition available)
  subtasks?: {
    id: string;
    title: string;
    complexity: number;
    estimatedDuration: number;
    dependencies: string[];
  }[];

  // Metadata
  metadata: {
    taskId: string;
    agentId: string | null;
    timestamp: string;
    configVersion: string;
    thresholds: object;
  };
}
```

---

## 4. Delegation Lifecycle API

### 4.1 Start Delegation

```javascript
const delegation = await delegationManager.start(taskId, {
  pattern: 'parallel',
  subtasks: approvedSubtasks, // Optional: user-approved subtasks
  maxDepth: 2,
  tokenBudget: 20000,
  callbacks: {
    onSubtaskStart: (subtask) => {},
    onSubtaskComplete: (subtask, result) => {},
    onSubtaskFailed: (subtask, error) => {},
    onProgress: (progress) => {},
    onComplete: (result) => {},
    onFailed: (error) => {}
  }
});

// Returns
{
  delegationId: 'del-abc123',
  taskId: 'audit-cleanup-phase1',
  status: 'running',
  pattern: 'parallel',
  subtasks: [...],
  progress: { completed: 0, total: 7 },
  startedAt: '2025-12-29T10:00:00Z'
}
```

### 4.2 Control Active Delegation

```javascript
// Pause
await delegationManager.pause(delegationId);

// Resume
await delegationManager.resume(delegationId);

// Cancel
await delegationManager.cancel(delegationId, {
  rollback: false, // Undo completed changes
  reason: 'user-requested'
});

// Retry failed subtask
await delegationManager.retrySubtask(delegationId, subtaskId);

// Skip failed subtask
await delegationManager.skipSubtask(delegationId, subtaskId);
```

### 4.3 Query Delegation Status

```javascript
// Get single delegation
const status = await delegationManager.getStatus(delegationId);

// Get all active delegations
const active = await delegationManager.getActive();

// Get delegation history
const history = await delegationManager.getHistory({
  limit: 20,
  status: 'completed', // 'completed' | 'failed' | 'cancelled' | 'all'
  since: '2025-12-28T00:00:00Z'
});
```

---

## 5. Dashboard API Endpoints

### 5.1 Settings Endpoints

```yaml
# Get global delegation settings
GET /api/delegation/settings
Response:
  {
    mode: 'suggest',
    thresholds: {...},
    limits: {...},
    ui: {...}
  }

# Update delegation settings
PUT /api/delegation/settings
Body:
  {
    mode: 'auto',
    limits: { maxDepth: 2 }
  }
Response:
  { success: true, settings: {...} }
```

### 5.2 Decision Endpoints

```yaml
# Get delegation decision for task
POST /api/delegation/decision
Body:
  {
    taskId: 'audit-cleanup-phase1',
    agentId: 'agent-1',
    includeSubtasks: true
  }
Response:
  {
    decision: {
      shouldDelegate: true,
      confidence: 85,
      score: 72,
      suggestedPattern: 'sequential',
      reasoning: '...',
      subtasks: [...]
    }
  }

# Get delegation hint (lightweight)
GET /api/delegation/hint/:taskId
Response:
  {
    shouldConsiderDelegation: true,
    quickFactors: { complexity: 72, subtaskPotential: 5 },
    hint: 'Task may benefit from delegation'
  }
```

### 5.3 Control Endpoints

```yaml
# Start delegation
POST /api/delegation/start
Body:
  {
    taskId: 'audit-cleanup-phase1',
    pattern: 'sequential',
    subtasks: [...],
    options: { maxDepth: 2 }
  }
Response:
  {
    delegationId: 'del-abc123',
    status: 'running',
    subtasks: [...]
  }

# Pause delegation
POST /api/delegation/:id/pause
Response:
  { success: true, status: 'paused' }

# Resume delegation
POST /api/delegation/:id/resume
Response:
  { success: true, status: 'running' }

# Cancel delegation
POST /api/delegation/:id/cancel
Body:
  { rollback: false, reason: 'user-requested' }
Response:
  { success: true, status: 'cancelled' }

# Retry failed subtask
POST /api/delegation/:id/subtask/:subtaskId/retry
Response:
  { success: true, subtask: {...} }

# Skip failed subtask
POST /api/delegation/:id/subtask/:subtaskId/skip
Response:
  { success: true, remaining: 3 }
```

### 5.4 Query Endpoints

```yaml
# Get active delegations
GET /api/delegation/active
Response:
  {
    delegations: [
      {
        delegationId: 'del-abc123',
        taskId: 'audit-cleanup-phase1',
        status: 'running',
        progress: { completed: 3, total: 7 },
        agents: 2
      }
    ]
  }

# Get delegation status
GET /api/delegation/:id
Response:
  {
    delegationId: 'del-abc123',
    taskId: 'audit-cleanup-phase1',
    status: 'running',
    pattern: 'sequential',
    progress: { completed: 3, total: 7, percentage: 42 },
    subtasks: [...],
    metrics: {
      tokensUsed: 8400,
      estimatedCost: 0.28,
      elapsedTime: 180000,
      avgSubtaskQuality: 87
    }
  }

# Get delegation history
GET /api/delegation/history?limit=20&status=completed
Response:
  {
    delegations: [...],
    pagination: { page: 1, total: 45 }
  }
```

---

## 6. SSE Event Specification

### 6.1 Delegation Events

```typescript
// Delegation lifecycle
interface DelegationStartedEvent {
  type: 'delegation:started';
  data: {
    delegationId: string;
    taskId: string;
    pattern: string;
    subtaskCount: number;
    estimatedDuration: number;
  };
}

interface DelegationCompletedEvent {
  type: 'delegation:completed';
  data: {
    delegationId: string;
    taskId: string;
    duration: number;
    quality: number;
    tokensUsed: number;
    cost: number;
  };
}

interface DelegationFailedEvent {
  type: 'delegation:failed';
  data: {
    delegationId: string;
    taskId: string;
    error: string;
    failedSubtasks: number;
    completedSubtasks: number;
  };
}

interface DelegationPausedEvent {
  type: 'delegation:paused';
  data: {
    delegationId: string;
    reason: string;
  };
}

interface DelegationResumedEvent {
  type: 'delegation:resumed';
  data: {
    delegationId: string;
  };
}

interface DelegationCancelledEvent {
  type: 'delegation:cancelled';
  data: {
    delegationId: string;
    reason: string;
    rolledBack: boolean;
  };
}
```

### 6.2 Subtask Events

```typescript
interface SubtaskStartedEvent {
  type: 'delegation:subtask-started';
  data: {
    delegationId: string;
    subtaskId: string;
    subtaskIndex: number;
    title: string;
    agentId: string;
  };
}

interface SubtaskProgressEvent {
  type: 'delegation:subtask-progress';
  data: {
    delegationId: string;
    subtaskId: string;
    progress: { current: number; total: number };
    lastAction: string;
  };
}

interface SubtaskCompletedEvent {
  type: 'delegation:subtask-completed';
  data: {
    delegationId: string;
    subtaskId: string;
    duration: number;
    quality: number;
    tokensUsed: number;
  };
}

interface SubtaskFailedEvent {
  type: 'delegation:subtask-failed';
  data: {
    delegationId: string;
    subtaskId: string;
    error: string;
    retryable: boolean;
  };
}

interface SubtaskRetriedEvent {
  type: 'delegation:subtask-retried';
  data: {
    delegationId: string;
    subtaskId: string;
    attempt: number;
  };
}

interface SubtaskSkippedEvent {
  type: 'delegation:subtask-skipped';
  data: {
    delegationId: string;
    subtaskId: string;
    reason: string;
  };
}
```

### 6.3 Hint Events

```typescript
interface DelegationHintEvent {
  type: 'delegation:hint';
  data: {
    taskId: string;
    shouldDelegate: boolean;
    confidence: number;
    suggestedPattern: string;
    subtaskCount: number;
  };
}
```

---

## 7. Integration Points

### 7.1 TaskManager Integration

```javascript
// TaskManager hooks for delegation
class TaskManager {
  // Before task execution - check for delegation
  async beforeExecute(task, options) {
    if (options.checkDelegation !== false) {
      const decision = await this.delegationDecider.shouldDelegate(task, options.agent);

      if (decision.shouldDelegate && this.config.delegation.mode !== 'disabled') {
        return {
          delegationSuggested: true,
          decision
        };
      }
    }
    return { delegationSuggested: false };
  }

  // After delegation completes - update task status
  async onDelegationComplete(delegationResult) {
    await this.updateTaskStatus(delegationResult.taskId, 'completed', {
      quality: delegationResult.quality,
      deliverables: delegationResult.deliverables,
      delegationInfo: {
        delegationId: delegationResult.delegationId,
        subtasksCompleted: delegationResult.subtasksCompleted,
        tokensUsed: delegationResult.tokensUsed
      }
    });
  }
}
```

### 7.2 AgentOrchestrator Integration

```javascript
// AgentOrchestrator auto-delegation
class AgentOrchestrator {
  async executeWithAutoDelegation(agentId, task, options = {}) {
    const agent = this.getAgent(agentId);
    const decision = this.delegationDecider.shouldDelegate(task, agent, options);

    this.emit('delegation:decision', { task, decision });

    if (decision.shouldDelegate && !options.forceDirect) {
      // Delegate based on suggested pattern
      return this._executeDelegated(task, decision, options);
    } else {
      // Execute directly
      return this._executeDirect(agentId, task, options);
    }
  }

  async _executeDelegated(task, decision, options) {
    const pattern = decision.suggestedPattern;
    const subtasks = decision.subtasks || await this._decomposeTask(task);

    switch (pattern) {
      case 'parallel':
        return this.executeParallel(subtasks.map(st => ({
          agentId: this._selectAgent(st),
          task: st
        })));
      case 'sequential':
        return this.executePipeline(subtasks);
      case 'debate':
        return this.executeDebate(subtasks, { rounds: 3 });
      case 'review':
        return this.executeWithReview(subtasks);
      case 'ensemble':
        return this.executeEnsemble(subtasks);
      default:
        return this.executeParallel(subtasks);
    }
  }
}
```

### 7.3 Dashboard Integration

```javascript
// Dashboard delegation panel
class DelegationPanel {
  constructor(dashboard) {
    this.dashboard = dashboard;
    this.setupSSEListeners();
  }

  setupSSEListeners() {
    this.dashboard.sse.on('delegation:started', this.onDelegationStarted.bind(this));
    this.dashboard.sse.on('delegation:subtask-progress', this.onSubtaskProgress.bind(this));
    this.dashboard.sse.on('delegation:completed', this.onDelegationCompleted.bind(this));
    this.dashboard.sse.on('delegation:failed', this.onDelegationFailed.bind(this));
    this.dashboard.sse.on('delegation:hint', this.onDelegationHint.bind(this));
  }

  // Render active delegations in sidebar
  renderActiveDelegations(delegations) {
    return delegations.map(d => `
      <div class="delegation-card ${d.status}">
        <div class="delegation-header">
          <span class="delegation-task">${d.taskId}</span>
          <span class="delegation-pattern">${d.pattern}</span>
        </div>
        <div class="delegation-progress">
          <div class="progress-bar" style="width: ${d.progress.percentage}%"></div>
          <span>${d.progress.completed}/${d.progress.total}</span>
        </div>
        <div class="delegation-actions">
          <button onclick="pauseDelegation('${d.delegationId}')">Pause</button>
          <button onclick="cancelDelegation('${d.delegationId}')">Cancel</button>
        </div>
      </div>
    `).join('');
  }
}
```

---

## 8. Testing Strategy

### 8.1 Unit Tests

- Decision algorithm with various factor combinations
- Pattern selection logic
- Configuration merging
- Command parsing

### 8.2 Integration Tests

- Full delegation flow with mock agents
- SSE event propagation
- Dashboard API responses
- TaskManager hooks

### 8.3 E2E Tests

- User interaction with delegation suggestions
- Control commands (pause/resume/cancel)
- Error recovery flows
- Dashboard real-time updates

---

## Summary

This control interface provides:

1. **Command Syntax**: `/delegate`, `/direct`, `/delegation` commands
2. **Configuration Layers**: Global, per-task, and runtime overrides
3. **Decision API**: Full transparency into delegation decisions
4. **Lifecycle Management**: Start, pause, resume, cancel, retry
5. **Dashboard Integration**: REST APIs and SSE events
6. **Integration Points**: TaskManager, AgentOrchestrator, Dashboard hooks
