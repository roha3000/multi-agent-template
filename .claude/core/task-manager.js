/**
 * TaskManager - Intelligent Task Management System
 *
 * Provides dependency-aware task management with:
 * - Multi-tier backlog (now/next/later/someday)
 * - Dependency tracking (blocks, requires, related)
 * - Intelligent priority scoring
 * - Phase-aware filtering
 * - Historical learning integration
 *
 * @module task-manager
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class TaskManager extends EventEmitter {
  constructor(options = {}) {
    super();

    this.tasksPath = options.tasksPath || path.join(process.cwd(), 'tasks.json');
    this.memoryStore = options.memoryStore || null;
    this.syncToDevDocs = options.syncToDevDocs || false; // Auto-sync to .claude/dev-docs/tasks.md
    this.tasks = null;

    this.load();
  }

  // ====================================================================
  // CORE QUERIES
  // ====================================================================

  /**
   * Get all unblocked tasks ready to work on
   * @param {Object} filters - { phase, priority, backlog, tags }
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
      const backlogIds = this.tasks.backlog[backlogTier]?.tasks || [];
      candidates = candidates.filter(t => backlogIds.includes(t.id));
    }

    // Filter by status (ready or in_progress only)
    candidates = candidates.filter(t =>
      t.status === 'ready' || t.status === 'in_progress'
    );

    // Filter by tags if specified
    if (filters.tags && filters.tags.length > 0) {
      candidates = candidates.filter(t =>
        filters.tags.some(tag => t.tags.includes(tag))
      );
    }

    // Filter by priority if specified
    if (filters.priority) {
      candidates = candidates.filter(t => t.priority === filters.priority);
    }

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
   * @param {Object} options - { fallbackToNext: true }
   * @returns {Task|null} Highest priority ready task
   */
  getNextTask(phase, options = {}) {
    const { fallbackToNext = true } = options;

    // Try 'now' tier first
    const ready = this.getReadyTasks({ phase, backlog: 'now' });

    if (ready.length > 0) {
      return ready[0];
    }

    // Try 'now' tier without phase filter (in case no phase-matching tasks)
    const readyAnyPhase = this.getReadyTasks({ backlog: 'now' });
    if (readyAnyPhase.length > 0) {
      this.emit('task:phase-mismatch', {
        task: readyAnyPhase[0],
        requestedPhase: phase,
        taskPhase: readyAnyPhase[0].phase
      });
      return readyAnyPhase[0];
    }

    // Fallback to 'next' tier if enabled
    if (fallbackToNext) {
      const nextTier = this.getReadyTasks({ phase, backlog: 'next' });
      if (nextTier.length > 0) {
        // Promote task from 'next' to 'now'
        this._promoteTask(nextTier[0].id, 'next', 'now');
        this.emit('task:promoted', {
          task: nextTier[0],
          from: 'next',
          to: 'now'
        });
        return nextTier[0];
      }
    }

    return null;
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
      descendants: this._getDescendants(taskId),  // Tasks this enables (downstream)
      blocking: this._getBlocking(taskId),        // Tasks this blocks
      blockedBy: this._getBlockedBy(taskId),      // Tasks blocking this
    };
  }

  /**
   * Get tasks blocked by incomplete dependencies
   * @returns {Array<Task>} Tasks with status 'blocked'
   */
  getBlockedTasks() {
    return this._getAllTasks().filter(t => t.status === 'blocked');
  }

  /**
   * Get task by ID
   * @param {string} taskId
   * @returns {Task|null}
   */
  getTask(taskId) {
    return this.tasks.tasks[taskId] || null;
  }

  // ====================================================================
  // UPDATES
  // ====================================================================

  /**
   * Update task status
   * @param {string} taskId
   * @param {string} status - ready|in_progress|review|completed|blocked
   * @param {Object} metadata - Additional completion data
   */
  updateStatus(taskId, status, metadata = {}) {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const oldStatus = task.status;
    task.status = status;
    task.updated = new Date().toISOString();

    if (status === 'in_progress' && !task.started) {
      task.started = new Date().toISOString();
    }

    if (status === 'completed') {
      task.completed = new Date().toISOString();

      // Record in MemoryStore for historical learning
      if (this.memoryStore) {
        this.memoryStore.recordTaskCompletion({
          ...task,
          ...metadata
        });
      }

      // Unblock dependent tasks
      this._updateBlockedTasks(taskId);

      this.emit('task:completed', { task, metadata });
    }

    this.emit('task:status-changed', {
      task,
      oldStatus,
      newStatus: status
    });

    this.save();
    return task;
  }

  /**
   * Create new task
   * @param {Object} taskData - Task properties
   * @returns {Task} Created task
   */
  createTask(taskData) {
    if (!taskData.title) {
      throw new Error('Task title is required');
    }
    if (!taskData.phase) {
      throw new Error('Task phase is required');
    }

    const id = taskData.id || this._generateTaskId(taskData.title);

    // Check if task already exists
    if (this.tasks.tasks[id]) {
      throw new Error(`Task ${id} already exists`);
    }

    const task = {
      id,
      title: taskData.title,
      description: taskData.description || '',
      phase: taskData.phase,
      priority: taskData.priority || 'medium',
      estimate: taskData.estimate || '2h',
      tags: taskData.tags || [],
      depends: taskData.depends || { blocks: [], requires: [], related: [] },
      acceptance: taskData.acceptance || [],
      status: this._determineInitialStatus(taskData),
      assignee: taskData.assignee || null,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      started: null,
      completed: null,
    };

    this.tasks.tasks[id] = task;

    // Add to specified backlog tier (default: 'next')
    const backlogTier = taskData.backlogTier || 'next';
    if (!this.tasks.backlog[backlogTier].tasks.includes(id)) {
      this.tasks.backlog[backlogTier].tasks.push(id);
    }

    this.emit('task:created', { task });

    this.save();
    return task;
  }

  /**
   * Update task properties
   * @param {string} taskId
   * @param {Object} updates - Properties to update
   * @returns {Task} Updated task
   */
  updateTask(taskId, updates) {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const allowedFields = [
      'title', 'description', 'phase', 'priority', 'estimate',
      'tags', 'depends', 'acceptance', 'assignee'
    ];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        task[field] = updates[field];
      }
    }

    task.updated = new Date().toISOString();

    // Re-evaluate status if dependencies changed
    if (updates.depends) {
      const newStatus = this._determineInitialStatus(task);
      if (newStatus !== task.status && task.status !== 'completed') {
        task.status = newStatus;
      }
    }

    this.emit('task:updated', { task, updates });

    this.save();
    return task;
  }

  /**
   * Delete task
   * @param {string} taskId
   */
  deleteTask(taskId) {
    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Remove from backlog tiers
    for (const tier of ['now', 'next', 'later', 'someday']) {
      const index = this.tasks.backlog[tier].tasks.indexOf(taskId);
      if (index !== -1) {
        this.tasks.backlog[tier].tasks.splice(index, 1);
      }
    }

    // Remove from tasks
    delete this.tasks.tasks[taskId];

    this.emit('task:deleted', { taskId });

    this.save();
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
    if (!['now', 'next', 'later', 'someday'].includes(toTier)) {
      throw new Error(`Invalid backlog tier: ${toTier}`);
    }

    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    let fromTier = null;

    // Remove from current tier
    for (const tier of ['now', 'next', 'later', 'someday']) {
      const index = this.tasks.backlog[tier].tasks.indexOf(taskId);
      if (index !== -1) {
        this.tasks.backlog[tier].tasks.splice(index, 1);
        fromTier = tier;
        break;
      }
    }

    // Add to new tier
    if (!this.tasks.backlog[toTier].tasks.includes(taskId)) {
      this.tasks.backlog[toTier].tasks.push(taskId);
    }

    this.emit('task:moved', {
      task,
      from: fromTier,
      to: toTier
    });

    this.save();
  }

  /**
   * Get backlog summary
   * @returns {Object} Counts per tier and status
   */
  getBacklogSummary() {
    const summary = {
      now: { total: 0, ready: 0, blocked: 0, in_progress: 0, completed: 0, review: 0, pending: 0 },
      next: { total: 0, ready: 0, blocked: 0, in_progress: 0, completed: 0, review: 0, pending: 0 },
      later: { total: 0, ready: 0, blocked: 0, in_progress: 0, completed: 0, review: 0, pending: 0 },
      someday: { total: 0, ready: 0, blocked: 0, in_progress: 0, completed: 0, review: 0, pending: 0 },
      completed: { total: 0, ready: 0, blocked: 0, in_progress: 0, completed: 0, review: 0, pending: 0 },
    };

    for (const [tier, config] of Object.entries(this.tasks.backlog)) {
      if (!summary[tier]) {
        summary[tier] = { total: 0, ready: 0, blocked: 0, in_progress: 0, completed: 0, review: 0, pending: 0 };
      }
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

  /**
   * Get statistics across all tasks
   * @returns {Object} Overall stats
   */
  getStats() {
    const all = this._getAllTasks();

    return {
      total: all.length,
      byStatus: this._groupBy(all, 'status'),
      byPhase: this._groupBy(all, 'phase'),
      byPriority: this._groupBy(all, 'priority'),
      completionRate: all.filter(t => t.status === 'completed').length / all.length,
    };
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
    } else {
      // Partial credit for related phases
      score += 10;
    }

    // Effort weight (20%) - prefer smaller tasks for quick wins
    const effortHours = this._parseEffort(task.estimate);
    if (effortHours <= 2) score += 20;
    else if (effortHours <= 4) score += 15;
    else if (effortHours <= 8) score += 10;
    else score += 5;

    // Historical success weight (10%)
    if (this.memoryStore) {
      const successRate = this.memoryStore.getTaskPatternSuccess?.(task.tags) || 0.5;
      score += successRate * 10;
    } else {
      score += 5; // Neutral if no history
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
   * Determine initial status based on dependencies
   * @private
   */
  _determineInitialStatus(task) {
    if (task.status === 'completed') return 'completed';
    return this._areRequirementsMet(task) ? 'ready' : 'blocked';
  }

  // ====================================================================
  // DEPENDENCY GRAPH TRAVERSAL
  // ====================================================================

  /**
   * Get all tasks that this task requires (upstream)
   * @private
   */
  _getAncestors(taskId, visited = new Set()) {
    if (visited.has(taskId)) return [];
    visited.add(taskId);

    const task = this.getTask(taskId);
    if (!task || !task.depends?.requires) return [];

    const ancestors = [];
    for (const reqId of task.depends.requires) {
      const reqTask = this.getTask(reqId);
      if (reqTask) {
        ancestors.push(reqTask);
        ancestors.push(...this._getAncestors(reqId, visited));
      }
    }

    return ancestors;
  }

  /**
   * Get all tasks that require this task (downstream)
   * @private
   */
  _getDescendants(taskId, visited = new Set()) {
    if (visited.has(taskId)) return [];
    visited.add(taskId);

    const descendants = [];
    const all = this._getAllTasks();

    for (const task of all) {
      if (task.depends?.requires?.includes(taskId)) {
        descendants.push(task);
        descendants.push(...this._getDescendants(task.id, visited));
      }
    }

    return descendants;
  }

  /**
   * Get all tasks this task blocks
   * @private
   */
  _getBlocking(taskId) {
    const task = this.getTask(taskId);
    if (!task || !task.depends?.blocks) return [];

    return task.depends.blocks
      .map(id => this.getTask(id))
      .filter(t => t !== null);
  }

  /**
   * Get all tasks blocking this task
   * @private
   */
  _getBlockedBy(taskId) {
    const task = this.getTask(taskId);
    if (!task) return [];

    const all = this._getAllTasks();
    return all.filter(t => t.depends?.blocks?.includes(taskId));
  }

  /**
   * Update tasks blocked by completed task
   * @private
   */
  _updateBlockedTasks(completedTaskId) {
    const blocking = this._getBlocking(completedTaskId);

    for (const task of blocking) {
      if (this._areRequirementsMet(task) && task.status === 'blocked') {
        task.status = 'ready';
        task.updated = new Date().toISOString();
        this.emit('task:unblocked', { task, unblockedBy: completedTaskId });
      }
    }

    this.save();
  }

  /**
   * Promote task from one tier to another
   * @private
   */
  _promoteTask(taskId, fromTier, toTier) {
    const fromIndex = this.tasks.backlog[fromTier].tasks.indexOf(taskId);
    if (fromIndex !== -1) {
      this.tasks.backlog[fromTier].tasks.splice(fromIndex, 1);
    }

    if (!this.tasks.backlog[toTier].tasks.includes(taskId)) {
      this.tasks.backlog[toTier].tasks.push(taskId);
    }

    this.save();
  }

  // ====================================================================
  // UTILITIES
  // ====================================================================

  _generateTaskId(title) {
    const prefix = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 20);
    const timestamp = Date.now().toString(36).substring(-6);
    return `${prefix}-${timestamp}`;
  }

  _parseEffort(estimate) {
    if (!estimate) return 4; // default 4 hours
    const match = estimate.match(/(\d+\.?\d*)\s*(h|hour|hours|d|day|days)?/i);
    if (!match) return 4;

    const value = parseFloat(match[1]);
    const unit = match[2]?.toLowerCase();

    if (unit?.startsWith('d')) {
      return value * 8; // Convert days to hours
    }
    return value;
  }

  _getAllTasks() {
    return Object.values(this.tasks.tasks);
  }

  _groupBy(array, key) {
    return array.reduce((acc, item) => {
      const value = item[key];
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});
  }

  // ====================================================================
  // PERSISTENCE
  // ====================================================================

  load() {
    try {
      const data = fs.readFileSync(this.tasksPath, 'utf8');
      this.tasks = JSON.parse(data);
      this.emit('tasks:loaded', { count: this._getAllTasks().length });
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, create default structure
        this.tasks = this._createDefaultStructure();
        this.save();
        this.emit('tasks:initialized');
      } else {
        throw error;
      }
    }
  }

  save() {
    const data = JSON.stringify(this.tasks, null, 2);
    fs.writeFileSync(this.tasksPath, data, 'utf8');
    this.emit('tasks:saved');

    // Auto-sync to dev-docs if enabled
    if (this.syncToDevDocs) {
      this.exportToMarkdown();
    }
  }

  // ====================================================================
  // MARKDOWN EXPORT (Sync to dev-docs/tasks.md)
  // ====================================================================

  /**
   * Export tasks to markdown format for dev-docs/tasks.md
   * This keeps the markdown file in sync with tasks.json
   * @param {string} outputPath - Optional custom output path
   * @returns {string} The generated markdown content
   */
  exportToMarkdown(outputPath = null) {
    const devDocsPath = outputPath || path.join(path.dirname(this.tasksPath), '.claude', 'dev-docs', 'tasks.md');
    const markdown = this._generateMarkdown();

    // Ensure directory exists
    const dir = path.dirname(devDocsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(devDocsPath, markdown, 'utf8');
    this.emit('tasks:exported', { path: devDocsPath });
    return markdown;
  }

  /**
   * Generate markdown content from tasks.json structure
   * @private
   */
  _generateMarkdown() {
    const lines = [];
    const now = new Date().toISOString().split('T')[0];

    // Header
    lines.push('# Active Tasks');
    lines.push('');
    lines.push(`**Last Updated**: ${now} (auto-generated from tasks.json)`);
    lines.push(`**Source of Truth**: \`tasks.json\` - Do not edit this file directly`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Current Backlog Summary
    lines.push('## Current Backlog');
    lines.push('');

    const backlogTiers = ['now', 'next', 'later', 'someday'];
    const tierLabels = {
      now: 'NOW (Active Sprint)',
      next: 'NEXT',
      later: 'LATER',
      someday: 'SOMEDAY'
    };

    for (const tier of backlogTiers) {
      const taskIds = this.tasks.backlog[tier]?.tasks || [];
      if (taskIds.length === 0) continue;

      lines.push(`### ${tierLabels[tier]}`);
      lines.push('| Task ID | Title | Status | Priority | Phase |');
      lines.push('|---------|-------|--------|----------|-------|');

      for (const taskId of taskIds) {
        const task = this.tasks.tasks[taskId];
        if (task) {
          const status = task.status === 'in_progress' ? '**in_progress**' : task.status;
          lines.push(`| ${task.id} | ${task.title} | ${status} | ${task.priority || 'medium'} | ${task.phase || '-'} |`);
        }
      }
      lines.push('');
    }

    // Completed tasks (if exists in backlog)
    const completedIds = this.tasks.backlog.completed?.tasks || [];
    if (completedIds.length > 0) {
      lines.push('### COMPLETED');
      lines.push('| Task ID | Title | Score | Completed |');
      lines.push('|---------|-------|-------|-----------|');

      for (const taskId of completedIds) {
        const task = this.tasks.tasks[taskId];
        if (task) {
          const score = task.qualityScore ? `${task.qualityScore}/100` : '-';
          const completed = task.completed ? task.completed.split('T')[0] : '-';
          lines.push(`| ${task.id} | ${task.title} | ${score} | ${completed} |`);
        }
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');

    // Task Details for active tasks
    lines.push('## Task Details');
    lines.push('');

    const activeTiers = ['now', 'next'];
    for (const tier of activeTiers) {
      const taskIds = this.tasks.backlog[tier]?.tasks || [];
      for (const taskId of taskIds) {
        const task = this.tasks.tasks[taskId];
        if (!task) continue;

        lines.push(`### ${task.id}`);
        lines.push(`**Title**: ${task.title}`);
        lines.push(`**Phase**: ${task.phase || 'unassigned'}`);
        if (task.estimate) lines.push(`**Estimate**: ${task.estimate}`);
        lines.push(`**Priority**: ${task.priority || 'medium'}`);
        lines.push(`**Status**: ${task.status}`);
        lines.push('');

        if (task.description) {
          lines.push(`**Description**: ${task.description}`);
          lines.push('');
        }

        if (task.acceptance && task.acceptance.length > 0) {
          lines.push('**Acceptance Criteria**:');
          for (const criterion of task.acceptance) {
            const checkbox = task.status === 'completed' ? '[x]' : '[ ]';
            lines.push(`- ${checkbox} ${criterion}`);
          }
          lines.push('');
        }

        if (task.depends) {
          const requires = task.depends.requires || [];
          const blocks = task.depends.blocks || [];
          if (requires.length > 0) {
            lines.push(`**Requires**: ${requires.join(', ')}`);
          }
          if (blocks.length > 0) {
            lines.push(`**Blocks**: ${blocks.join(', ')}`);
          }
          if (requires.length > 0 || blocks.length > 0) {
            lines.push('');
          }
        }

        if (task.deliverables && task.deliverables.length > 0) {
          lines.push('**Deliverables**:');
          for (const d of task.deliverables) {
            lines.push(`- ${d}`);
          }
          lines.push('');
        }

        lines.push('---');
        lines.push('');
      }
    }

    // Stats summary
    const stats = this.getStats();
    lines.push('## Statistics');
    lines.push('');
    lines.push(`- **Total Tasks**: ${stats.total}`);
    lines.push(`- **Completed**: ${stats.byStatus.completed || 0}`);
    lines.push(`- **In Progress**: ${stats.byStatus.in_progress || 0}`);
    lines.push(`- **Ready**: ${stats.byStatus.ready || 0}`);
    lines.push(`- **Blocked**: ${stats.byStatus.blocked || 0}`);
    lines.push('');

    return lines.join('\n');
  }

  _createDefaultStructure() {
    return {
      version: '1.0.0',
      project: {
        name: path.basename(process.cwd()),
        phases: ['research', 'planning', 'design', 'implementation', 'testing', 'validation']
      },
      backlog: {
        now: {
          description: 'Active tasks for current sprint/iteration',
          tasks: []
        },
        next: {
          description: 'Next priority after "now" is complete',
          tasks: []
        },
        later: {
          description: 'Future work, not yet prioritized',
          tasks: []
        },
        someday: {
          description: 'Ideas and possibilities, lowest priority',
          tasks: []
        }
      },
      tasks: {}
    };
  }
}

module.exports = TaskManager;
