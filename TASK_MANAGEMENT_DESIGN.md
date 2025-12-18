# Intelligent Task Management System Design

**Created**: 2025-12-18
**Purpose**: Native task management with dependencies, backlog tiers, and autonomous selection
**Integration**: Seamless fit into existing 3-layer architecture

---

## Vision

Enable the autonomous orchestrator to **intelligently select and execute tasks** from a structured backlog with:
- ✅ Dependency tracking (blocks, requires, related)
- ✅ Multi-tier backlog (now/next/later/someday)
- ✅ Phase-aware task filtering
- ✅ Priority and effort estimation
- ✅ Historical learning (success patterns)
- ✅ **Zero token overhead** (server-side only)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│              Intelligent Task Management                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  [1] Storage Layer (Git-Tracked)                             │
│      └── tasks.json (structured, human-editable)             │
│                                                              │
│  [2] Query Layer (Server-Side, 0 Tokens)                     │
│      └── TaskManager.js                                      │
│          ├── Dependency resolution                           │
│          ├── Backlog filtering                               │
│          ├── Phase matching                                  │
│          ├── Priority scoring                                │
│          └── Ready task computation                          │
│                                                              │
│  [3] Learning Layer (Historical)                             │
│      └── MemoryStore.tasks table (existing SQLite)           │
│          ├── Task completion history                         │
│          ├── Success patterns                                │
│          ├── Effort vs estimate variance                     │
│          └── Phase alignment scores                          │
│                                                              │
│  [4] Orchestrator Integration                                │
│      └── autonomous-orchestrator.js                          │
│          ├── Query: TaskManager.getReadyTasks(phase)         │
│          ├── Select: Highest priority unblocked task         │
│          ├── Execute: Run task with quality gates            │
│          └── Update: Mark complete, record metrics           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Key Design Principle**: Fits within existing 3-layer architecture (dev-docs, StateManager, MemoryStore) - TaskManager is a **query engine**, not a 4th storage layer.

---

## Task Data Model

### tasks.json Structure

```json
{
  "version": "1.0.0",
  "project": {
    "name": "multi-agent-template",
    "phases": ["research", "planning", "design", "implementation", "testing", "validation"]
  },
  "backlog": {
    "now": {
      "description": "Active tasks for current sprint/iteration",
      "tasks": ["auth-001", "auth-002"]
    },
    "next": {
      "description": "Next priority after 'now' is complete",
      "tasks": ["dashboard-001", "api-003"]
    },
    "later": {
      "description": "Future work, not yet prioritized",
      "tasks": ["optimization-001", "docs-005"]
    },
    "someday": {
      "description": "Ideas and possibilities, lowest priority",
      "tasks": ["ml-predictions", "mobile-app"]
    }
  },
  "tasks": {
    "auth-001": {
      "id": "auth-001",
      "title": "Implement OAuth 2.0 login flow",
      "description": "Complete OAuth implementation with Google, GitHub providers",
      "phase": "implementation",
      "priority": "high",
      "estimate": "4h",
      "tags": ["auth", "security", "backend"],
      "depends": {
        "blocks": [],
        "requires": ["design-auth-001"],
        "related": ["auth-002", "security-001"]
      },
      "acceptance": [
        "Users can log in with Google OAuth",
        "Users can log in with GitHub OAuth",
        "Tokens stored securely in httpOnly cookies",
        "All tests passing"
      ],
      "status": "ready",
      "assignee": null,
      "created": "2025-12-18T10:00:00Z",
      "updated": "2025-12-18T10:00:00Z",
      "completed": null
    },
    "auth-002": {
      "id": "auth-002",
      "title": "Add session management and refresh tokens",
      "description": "Implement secure session handling with automatic refresh",
      "phase": "implementation",
      "priority": "medium",
      "estimate": "3h",
      "tags": ["auth", "security"],
      "depends": {
        "blocks": ["auth-001"],
        "requires": [],
        "related": ["auth-001"]
      },
      "acceptance": [
        "Sessions persist across browser restarts",
        "Tokens refresh automatically before expiry",
        "Logout clears all session data"
      ],
      "status": "blocked",
      "assignee": null,
      "created": "2025-12-18T10:30:00Z",
      "updated": "2025-12-18T10:30:00Z",
      "completed": null
    },
    "design-auth-001": {
      "id": "design-auth-001",
      "title": "Design OAuth architecture and security model",
      "description": "Complete architectural design for OAuth implementation",
      "phase": "design",
      "priority": "high",
      "estimate": "2h",
      "tags": ["auth", "design", "architecture"],
      "depends": {
        "blocks": [],
        "requires": ["research-auth-001"],
        "related": []
      },
      "acceptance": [
        "Architecture diagram created",
        "Security review completed",
        "Token flow documented"
      ],
      "status": "completed",
      "assignee": null,
      "created": "2025-12-17T14:00:00Z",
      "updated": "2025-12-17T16:30:00Z",
      "completed": "2025-12-17T16:30:00Z"
    }
  }
}
```

### Task Status Lifecycle

```
created → ready → in_progress → review → completed
              ↓
           blocked (if dependencies not met)
```

### Dependency Types

| Type | Meaning | Example |
|------|---------|---------|
| **blocks** | This task blocks OTHER tasks | auth-001 must complete before auth-002 can start |
| **requires** | This task REQUIRES other tasks first | auth-001 requires design-auth-001 |
| **related** | Informational relationship only | auth-001 related to security-001 |

---

## TaskManager.js Implementation

### Core API

```javascript
class TaskManager {
  constructor(tasksPath, memoryStore) {
    this.tasksPath = tasksPath || path.join(process.cwd(), 'tasks.json');
    this.memoryStore = memoryStore;
    this.tasks = null;
    this.load();
  }

  // ====================================================================
  // CORE QUERIES
  // ====================================================================

  /**
   * Get all unblocked tasks ready to work on
   * @param {Object} filters - { phase, priority, backlog }
   * @returns {Array<Task>} Sorted by priority and readiness
   */
  getReadyTasks(filters = {}) {
    const allTasks = this._getAllTasks();

    // Filter by phase if specified
    let candidates = filters.phase
      ? allTasks.filter(t => t.phase === filters.phase)
      : allTasks;

    // Filter by backlog tier (default: 'now' only)
    const backlogTier = filters.backlog || 'now';
    if (backlogTier !== 'all') {
      const backlogIds = this.tasks.backlog[backlogTier].tasks;
      candidates = candidates.filter(t => backlogIds.includes(t.id));
    }

    // Filter by status (ready or in_progress only)
    candidates = candidates.filter(t =>
      t.status === 'ready' || t.status === 'in_progress'
    );

    // Check dependencies - must have all "requires" completed
    candidates = candidates.filter(t => this._areRequirementsMet(t));

    // Score and sort
    candidates = candidates.map(t => ({
      ...t,
      _score: this._calculateTaskScore(t, filters.phase)
    }));

    candidates.sort((a, b) => b._score - a._score);

    return candidates;
  }

  /**
   * Get next recommended task for autonomous execution
   * @param {string} phase - Current phase
   * @returns {Task|null} Highest priority ready task
   */
  getNextTask(phase) {
    const ready = this.getReadyTasks({ phase, backlog: 'now' });

    if (ready.length === 0) {
      // Try 'next' tier if 'now' is empty
      const nextTier = this.getReadyTasks({ phase, backlog: 'next' });
      if (nextTier.length > 0) {
        // Promote task from 'next' to 'now'
        this._promoteTask(nextTier[0].id, 'next', 'now');
        return nextTier[0];
      }
      return null;
    }

    return ready[0];
  }

  /**
   * Get task dependency graph
   * @param {string} taskId
   * @returns {Object} { ancestors, descendants, blocking, blockedBy }
   */
  getDependencyGraph(taskId) {
    const task = this.getTask(taskId);
    if (!task) return null;

    return {
      ancestors: this._getAncestors(taskId),      // Tasks required (upstream)
      descendants: this._getDescendants(taskId),  // Tasks blocked (downstream)
      blocking: this._getBlocking(taskId),        // Tasks this blocks
      blockedBy: this._getBlockedBy(taskId),      // Tasks blocking this
    };
  }

  // ====================================================================
  // UPDATES
  // ====================================================================

  /**
   * Update task status
   * @param {string} taskId
   * @param {string} status - ready|in_progress|review|completed|blocked
   */
  updateStatus(taskId, status) {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    task.status = status;
    task.updated = new Date().toISOString();

    if (status === 'completed') {
      task.completed = new Date().toISOString();

      // Record in MemoryStore for historical learning
      if (this.memoryStore) {
        this.memoryStore.recordTaskCompletion(task);
      }

      // Unblock dependent tasks
      this._updateBlockedTasks(taskId);
    }

    this.save();
  }

  /**
   * Create new task
   * @param {Object} taskData - Task properties
   * @returns {Task} Created task
   */
  createTask(taskData) {
    const id = taskData.id || this._generateTaskId(taskData.title);

    const task = {
      id,
      title: taskData.title,
      description: taskData.description || '',
      phase: taskData.phase,
      priority: taskData.priority || 'medium',
      estimate: taskData.estimate,
      tags: taskData.tags || [],
      depends: taskData.depends || { blocks: [], requires: [], related: [] },
      acceptance: taskData.acceptance || [],
      status: this._areRequirementsMet(taskData) ? 'ready' : 'blocked',
      assignee: taskData.assignee || null,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      completed: null,
    };

    this.tasks.tasks[id] = task;

    // Add to 'next' backlog by default
    this.tasks.backlog.next.tasks.push(id);

    this.save();
    return task;
  }

  // ====================================================================
  // BACKLOG MANAGEMENT
  // ====================================================================

  /**
   * Move task between backlog tiers
   * @param {string} taskId
   * @param {string} toTier - now|next|later|someday
   */
  moveToBacklog(taskId, toTier) {
    // Remove from current tier
    for (const tier of ['now', 'next', 'later', 'someday']) {
      const index = this.tasks.backlog[tier].tasks.indexOf(taskId);
      if (index !== -1) {
        this.tasks.backlog[tier].tasks.splice(index, 1);
        break;
      }
    }

    // Add to new tier
    if (!this.tasks.backlog[toTier].tasks.includes(taskId)) {
      this.tasks.backlog[toTier].tasks.push(taskId);
    }

    this.save();
  }

  /**
   * Get backlog summary
   * @returns {Object} Counts per tier and status
   */
  getBacklogSummary() {
    const summary = {
      now: { total: 0, ready: 0, blocked: 0, in_progress: 0 },
      next: { total: 0, ready: 0, blocked: 0, in_progress: 0 },
      later: { total: 0, ready: 0, blocked: 0, in_progress: 0 },
      someday: { total: 0, ready: 0, blocked: 0, in_progress: 0 },
    };

    for (const [tier, config] of Object.entries(this.tasks.backlog)) {
      summary[tier].total = config.tasks.length;

      for (const taskId of config.tasks) {
        const task = this.getTask(taskId);
        if (task) {
          summary[tier][task.status] = (summary[tier][task.status] || 0) + 1;
        }
      }
    }

    return summary;
  }

  // ====================================================================
  // SCORING & INTELLIGENCE
  // ====================================================================

  /**
   * Calculate task priority score
   * @private
   */
  _calculateTaskScore(task, currentPhase) {
    let score = 0;

    // Priority weight (40%)
    const priorityWeights = { critical: 100, high: 75, medium: 50, low: 25 };
    score += (priorityWeights[task.priority] || 50) * 0.4;

    // Phase alignment weight (30%)
    if (task.phase === currentPhase) {
      score += 30;
    }

    // Effort weight (20%) - prefer smaller tasks for quick wins
    const effortHours = this._parseEffort(task.estimate);
    if (effortHours <= 2) score += 20;
    else if (effortHours <= 4) score += 15;
    else if (effortHours <= 8) score += 10;
    else score += 5;

    // Historical success weight (10%)
    if (this.memoryStore) {
      const successRate = this.memoryStore.getTaskPatternSuccess(task.tags);
      score += successRate * 10;
    }

    return score;
  }

  /**
   * Check if task requirements are met
   * @private
   */
  _areRequirementsMet(task) {
    if (!task.depends || !task.depends.requires) return true;

    for (const requiredId of task.depends.requires) {
      const required = this.getTask(requiredId);
      if (!required || required.status !== 'completed') {
        return false;
      }
    }

    return true;
  }

  /**
   * Get all tasks blocked by this task
   * @private
   */
  _getBlocking(taskId) {
    return this._getAllTasks().filter(t =>
      t.depends?.blocks?.includes(taskId)
    );
  }

  /**
   * Update tasks blocked by completed task
   * @private
   */
  _updateBlockedTasks(completedTaskId) {
    const blocking = this._getBlocking(completedTaskId);

    for (const task of blocking) {
      if (this._areRequirementsMet(task)) {
        task.status = 'ready';
        task.updated = new Date().toISOString();
      }
    }

    this.save();
  }

  // ====================================================================
  // UTILITIES
  // ====================================================================

  _generateTaskId(title) {
    const prefix = title.toLowerCase().split(' ')[0];
    const timestamp = Date.now().toString(36);
    return `${prefix}-${timestamp}`;
  }

  _parseEffort(estimate) {
    if (!estimate) return 4; // default
    const match = estimate.match(/(\d+)h/);
    return match ? parseInt(match[1]) : 4;
  }

  _getAllTasks() {
    return Object.values(this.tasks.tasks);
  }

  getTask(taskId) {
    return this.tasks.tasks[taskId] || null;
  }

  load() {
    try {
      this.tasks = JSON.parse(fs.readFileSync(this.tasksPath, 'utf8'));
    } catch (error) {
      this.tasks = this._createDefaultStructure();
      this.save();
    }
  }

  save() {
    fs.writeFileSync(this.tasksPath, JSON.stringify(this.tasks, null, 2));
  }

  _createDefaultStructure() {
    return {
      version: '1.0.0',
      project: {
        name: 'project',
        phases: ['research', 'planning', 'design', 'implementation', 'testing', 'validation']
      },
      backlog: {
        now: { description: 'Active tasks', tasks: [] },
        next: { description: 'Next priority', tasks: [] },
        later: { description: 'Future work', tasks: [] },
        someday: { description: 'Ideas', tasks: [] },
      },
      tasks: {}
    };
  }
}

module.exports = TaskManager;
```

---

## Integration with Autonomous Orchestrator

### Modified autonomous-orchestrator.js

```javascript
const TaskManager = require('./task-manager');
const MemoryStore = require('./.claude/core/memory-store');

// Initialize
const memoryStore = new MemoryStore();
const taskManager = new TaskManager(
  path.join(CONFIG.projectPath, 'tasks.json'),
  memoryStore
);

// In generatePhasePrompt():
function generatePhasePrompt(phase, iteration, previousScore = null, improvements = null) {
  // ... existing code ...

  // ADD: Get next recommended task
  const nextTask = taskManager.getNextTask(phase);

  if (nextTask) {
    prompt += `\n## Current Task\n\n`;
    prompt += `**${nextTask.id}**: ${nextTask.title}\n\n`;
    prompt += `**Description**: ${nextTask.description}\n\n`;
    prompt += `**Acceptance Criteria**:\n`;
    nextTask.acceptance.forEach(criterion => {
      prompt += `- [ ] ${criterion}\n`;
    });
    prompt += `\n**Estimated Effort**: ${nextTask.estimate}\n`;

    if (nextTask.depends.requires.length > 0) {
      prompt += `\n**Dependencies** (already completed):\n`;
      nextTask.depends.requires.forEach(depId => {
        const dep = taskManager.getTask(depId);
        prompt += `- ✅ ${dep.title}\n`;
      });
    }

    prompt += `\n**Instructions**:\n`;
    prompt += `1. Mark task as in_progress: Update tasks.json status\n`;
    prompt += `2. Complete all acceptance criteria\n`;
    prompt += `3. Run tests and validation\n`;
    prompt += `4. Mark task as completed when done\n`;
    prompt += `5. System will automatically select next task\n`;
  } else {
    prompt += `\n## No Tasks Ready\n\n`;
    prompt += `All tasks in current backlog are either blocked or complete.\n`;
    prompt += `Consider:\n`;
    prompt += `1. Reviewing 'next' tier tasks\n`;
    prompt += `2. Creating new tasks based on discoveries\n`;
    prompt += `3. Advancing to next phase\n`;
  }

  return prompt;
}
```

### Updated Quality Gate Check

```javascript
// After quality gate passes:
if (isPhaseComplete(phase, score)) {
  // Mark current task as complete
  if (state.currentTaskId) {
    taskManager.updateStatus(state.currentTaskId, 'completed');
  }

  // Move to next phase
  state.currentPhase = getNextPhase(phase);
  state.phaseIteration = 0;
} else {
  // Task needs iteration
  state.phaseIteration++;
}
```

---

## MemoryStore Integration (Historical Learning)

### Extend existing MemoryStore.js

```javascript
class MemoryStore {
  // ... existing methods ...

  /**
   * Record task completion for learning
   */
  recordTaskCompletion(task) {
    const stmt = this.db.prepare(`
      INSERT INTO task_history (
        task_id, title, phase, priority, estimate,
        actual_duration, tags, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      task.id,
      task.title,
      task.phase,
      task.priority,
      task.estimate,
      this._calculateDuration(task.created, task.completed),
      JSON.stringify(task.tags),
      task.completed
    );
  }

  /**
   * Get success rate for tasks with similar tags
   */
  getTaskPatternSuccess(tags) {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN actual_duration <= estimate THEN 1 ELSE 0 END) as on_time
      FROM task_history
      WHERE tags LIKE ?
    `);

    const result = stmt.get(`%${tags[0]}%`);
    return result.total > 0 ? result.on_time / result.total : 0.5;
  }

  /**
   * Get average duration by phase
   */
  getAverageDurationByPhase(phase) {
    const stmt = this.db.prepare(`
      SELECT AVG(actual_duration) as avg_duration
      FROM task_history
      WHERE phase = ?
    `);

    return stmt.get(phase)?.avg_duration || 4;
  }

  // Initialize schema
  _initializeTaskTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        title TEXT NOT NULL,
        phase TEXT NOT NULL,
        priority TEXT NOT NULL,
        estimate TEXT,
        actual_duration REAL,
        tags TEXT,
        completed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_task_phase ON task_history(phase);
      CREATE INDEX IF NOT EXISTS idx_task_tags ON task_history(tags);
    `);
  }
}
```

---

## CLI Tool for Task Management

### task-cli.js

```javascript
#!/usr/bin/env node
const TaskManager = require('./task-manager');
const chalk = require('chalk');

const taskManager = new TaskManager();

const command = process.argv[2];

switch (command) {
  case 'ready':
    const ready = taskManager.getReadyTasks({ backlog: 'now' });
    console.log(chalk.green.bold('\n✓ Ready Tasks:\n'));
    ready.forEach((t, i) => {
      console.log(`${i + 1}. [${t.priority}] ${t.id}: ${t.title}`);
      console.log(`   Phase: ${t.phase} | Estimate: ${t.estimate}`);
    });
    break;

  case 'backlog':
    const summary = taskManager.getBacklogSummary();
    console.log(chalk.blue.bold('\n📋 Backlog Summary:\n'));
    Object.entries(summary).forEach(([tier, stats]) => {
      console.log(`${tier.toUpperCase()}: ${stats.total} tasks`);
      console.log(`  Ready: ${stats.ready}, Blocked: ${stats.blocked}, In Progress: ${stats.in_progress}`);
    });
    break;

  case 'create':
    // Interactive task creation
    break;

  case 'show':
    const taskId = process.argv[3];
    const task = taskManager.getTask(taskId);
    console.log(JSON.stringify(task, null, 2));
    break;

  case 'deps':
    const id = process.argv[3];
    const graph = taskManager.getDependencyGraph(id);
    console.log(chalk.yellow.bold('\n🔗 Dependencies:\n'));
    console.log('Requires:', graph.blockedBy.map(t => t.id).join(', '));
    console.log('Blocks:', graph.blocking.map(t => t.id).join(', '));
    break;

  default:
    console.log(`
Usage: node task-cli.js <command>

Commands:
  ready           List all ready tasks
  backlog         Show backlog summary
  create          Create new task (interactive)
  show <id>       Show task details
  deps <id>       Show task dependencies
    `);
}
```

---

## Migration from tasks.md

### tasks-migration.js

```javascript
const fs = require('fs');
const TaskManager = require('./task-manager');

/**
 * Migrate from tasks.md to tasks.json
 */
function migrateTasks() {
  const tasksMarkdown = fs.readFileSync('tasks.md', 'utf8');
  const taskManager = new TaskManager();

  const lines = tasksMarkdown.split('\n');
  let currentPhase = 'implementation';

  for (const line of lines) {
    // Extract task from markdown checkbox
    const match = line.match(/^- \[(x| )\] (.+)$/);
    if (match) {
      const [, checked, title] = match;
      const status = checked === 'x' ? 'completed' : 'ready';

      taskManager.createTask({
        title,
        phase: currentPhase,
        priority: 'medium',
        estimate: '2h',
        status,
      });
    }
  }

  console.log('Migration complete. tasks.json created.');
}

migrateTasks();
```

---

## Token Cost Analysis

| Component | Context Cost | Notes |
|-----------|--------------|-------|
| **TaskManager.js** | 0 tokens | Server-side only, never in context |
| **tasks.json** | 0 tokens | Loaded server-side, queried programmatically |
| **Task injection in prompt** | ~200 tokens | Only CURRENT task details (title, acceptance, deps) |
| **MemoryStore queries** | 0 tokens | Server-side |

**Total**: ~200 tokens per session (vs current ~400 for full dev-docs)

**Efficiency gain**: More structured, focused context

---

## Comparison to Current System

| Feature | Current (tasks.md) | New (TaskManager) |
|---------|-------------------|-------------------|
| **Dependencies** | ❌ None | ✅ 3 types (blocks, requires, related) |
| **Backlog tiers** | ❌ None | ✅ 4 tiers (now/next/later/someday) |
| **Autonomous selection** | ❌ Manual | ✅ Automatic via getNextTask() |
| **Priority scoring** | ❌ None | ✅ Multi-factor scoring |
| **Historical learning** | ❌ None | ✅ MemoryStore integration |
| **Phase filtering** | ❌ Manual | ✅ Automatic |
| **Token cost** | ~400 tokens (full file) | ~200 tokens (current task only) |
| **Git tracking** | ✅ Yes | ✅ Yes (tasks.json) |
| **Human editable** | ✅ Very easy | ⚠️ JSON (still readable) |
| **Query performance** | N/A | ~5ms (in-memory) |

---

## Implementation Roadmap

### Phase 1: Core TaskManager (4 hours)
- [ ] Implement TaskManager.js (~300 lines)
- [ ] Create tasks.json schema
- [ ] Add basic CRUD operations
- [ ] Write unit tests

### Phase 2: Dependency Resolution (3 hours)
- [ ] Implement dependency graph traversal
- [ ] Add getReadyTasks() with filtering
- [ ] Add getNextTask() with scoring
- [ ] Test complex dependency scenarios

### Phase 3: Orchestrator Integration (2 hours)
- [ ] Modify autonomous-orchestrator.js
- [ ] Inject task into phase prompts
- [ ] Update quality gates to mark complete
- [ ] Test autonomous task selection

### Phase 4: Historical Learning (3 hours)
- [ ] Extend MemoryStore with task tables
- [ ] Add recordTaskCompletion()
- [ ] Implement pattern-based scoring
- [ ] Add duration tracking

### Phase 5: CLI & Migration (2 hours)
- [ ] Build task-cli.js
- [ ] Create tasks-migration.js
- [ ] Migrate existing tasks.md
- [ ] Add npm scripts

**Total**: ~14 hours

---

## Expected Benefits

1. **Intelligent Task Selection**
   - Autonomous orchestrator picks highest-value tasks automatically
   - No manual intervention needed for task ordering

2. **Dependency Awareness**
   - Never work on blocked tasks
   - Automatic unblocking when dependencies complete

3. **Backlog Management**
   - Clear prioritization with 4-tier system
   - Easy to add future ideas without cluttering active work

4. **Historical Learning**
   - System learns which task patterns succeed
   - Better effort estimation over time

5. **Token Efficiency**
   - Only current task in context (~200 tokens)
   - 50% reduction vs loading full tasks.md

6. **Continuous Operation**
   - Orchestrator runs indefinitely, always has next task
   - Automatically promotes from 'next' tier when 'now' is empty

---

## Next Steps

Would you like me to:

**Option A**: Implement Phase 1 (Core TaskManager) now (~4 hours)
**Option B**: Create a working prototype with 3-4 sample tasks to validate the design
**Option C**: Refine the design based on your feedback first

This system maintains your zero-overhead architecture while adding the intelligence needed for truly autonomous operation.
