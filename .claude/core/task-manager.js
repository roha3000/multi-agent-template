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
const crypto = require('crypto');

class TaskManager extends EventEmitter {
  constructor(options = {}) {
    super();

    this.tasksPath = options.tasksPath || path.join(process.cwd(), '.claude', 'dev-docs', 'tasks.json');
    this.memoryStore = options.memoryStore || null;
    this.tasks = null;

    // Concurrency protection
    this._lastFileHash = null;
    this._lastFileMtime = null;
    this._saveLock = false;
    this._pendingSave = false;

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

      // Move task to completed backlog tier
      // This ensures completed tasks are archived and don't clutter active tiers
      this._moveToCompletedTier(taskId);

      // Update parent progress if this task has a parent (hierarchy support)
      if (task.parentTaskId) {
        this._updateParentProgress(task.parentTaskId);
      }

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
    if (!['now', 'next', 'later', 'someday', 'completed'].includes(toTier)) {
      throw new Error(`Invalid backlog tier: ${toTier}`);
    }

    const task = this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    let fromTier = null;

    // Remove from current tier (check all tiers including completed)
    for (const tier of ['now', 'next', 'later', 'someday', 'completed']) {
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
   * Move task to completed backlog tier
   * @private
   */
  _moveToCompletedTier(taskId) {
    // Safety check: ensure backlog structure exists
    if (!this.tasks?.backlog) {
      return;
    }

    // Remove from all active tiers
    for (const tier of ['now', 'next', 'later', 'someday']) {
      const tierData = this.tasks.backlog[tier];
      if (tierData?.tasks) {
        const index = tierData.tasks.indexOf(taskId);
        if (index !== -1) {
          tierData.tasks.splice(index, 1);
          break;
        }
      }
    }

    // Add to completed tier if it exists
    if (this.tasks.backlog.completed?.tasks) {
      if (!this.tasks.backlog.completed.tasks.includes(taskId)) {
        this.tasks.backlog.completed.tasks.push(taskId);
      }
    }
    // Note: save() is called by the parent updateStatus() method
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
  // PERSISTENCE (with concurrency protection)
  // ====================================================================

  /**
   * Calculate hash of file contents for change detection
   */
  _calculateHash(content) {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Get file stats (mtime) for change detection
   */
  _getFileStats() {
    try {
      const stats = fs.statSync(this.tasksPath);
      return { mtime: stats.mtimeMs, exists: true };
    } catch (e) {
      return { mtime: null, exists: false };
    }
  }

  /**
   * Load tasks from file with change tracking
   */
  load() {
    try {
      const data = fs.readFileSync(this.tasksPath, 'utf8');
      this.tasks = JSON.parse(data);

      // Track file state for concurrency detection
      this._lastFileHash = this._calculateHash(data);
      this._lastFileMtime = this._getFileStats().mtime;

      // Check and fix queue integrity on load
      const integrityFixed = this._checkAndFixIntegrityOnLoad();
      if (integrityFixed) {
        // Save the fixed state
        this.save();
      }

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

  /**
   * Check and fix queue integrity issues on load
   * @returns {boolean} True if any fixes were made
   */
  _checkAndFixIntegrityOnLoad() {
    if (!this.tasks?.backlog || !this.tasks?.tasks) return false;

    let fixesMade = false;
    const allTiers = ['now', 'next', 'later', 'someday', 'completed'];
    const taskQueueCount = new Map(); // taskId -> count of queues it appears in

    // Count how many queues each task appears in
    for (const tier of allTiers) {
      const tasks = this.tasks.backlog[tier]?.tasks || [];
      for (const taskId of tasks) {
        taskQueueCount.set(taskId, (taskQueueCount.get(taskId) || 0) + 1);
      }
    }

    // Find and fix duplicates
    for (const [taskId, count] of taskQueueCount.entries()) {
      if (count > 1) {
        console.warn(`[TaskManager] Load integrity: Task ${taskId} found in ${count} queues - fixing`);
        fixesMade = true;

        const task = this.tasks.tasks[taskId];
        const targetQueue = task?.status === 'completed' ? 'completed' :
          (this.tasks.backlog.now?.tasks?.includes(taskId) ? 'now' :
           this.tasks.backlog.next?.tasks?.includes(taskId) ? 'next' :
           this.tasks.backlog.later?.tasks?.includes(taskId) ? 'later' :
           'someday');

        // Remove from all queues
        for (const tier of allTiers) {
          if (this.tasks.backlog[tier]?.tasks) {
            this.tasks.backlog[tier].tasks = this.tasks.backlog[tier].tasks.filter(id => id !== taskId);
          }
        }

        // Add to correct queue
        if (this.tasks.backlog[targetQueue]?.tasks) {
          this.tasks.backlog[targetQueue].tasks.push(taskId);
        }
      }
    }

    // Check for status/queue mismatches
    for (const tier of allTiers) {
      const tasks = this.tasks.backlog[tier]?.tasks || [];
      for (const taskId of [...tasks]) {
        const task = this.tasks.tasks[taskId];
        if (task?.status === 'completed' && tier !== 'completed') {
          console.warn(`[TaskManager] Load integrity: Completed task ${taskId} in ${tier} queue - moving to completed`);
          fixesMade = true;

          // Remove from current tier
          this.tasks.backlog[tier].tasks = this.tasks.backlog[tier].tasks.filter(id => id !== taskId);

          // Add to completed if not already there
          if (!this.tasks.backlog.completed.tasks.includes(taskId)) {
            this.tasks.backlog.completed.tasks.push(taskId);
          }
        }
      }
    }

    return fixesMade;
  }

  /**
   * Reload file and detect external changes
   * @returns {{ changed: boolean, diskTasks: Object|null }}
   */
  _checkForExternalChanges() {
    const stats = this._getFileStats();
    if (!stats.exists) {
      return { changed: false, diskTasks: null };
    }

    // Quick check: mtime changed?
    if (stats.mtime === this._lastFileMtime) {
      return { changed: false, diskTasks: null };
    }

    // Read current file and compare hash
    try {
      const data = fs.readFileSync(this.tasksPath, 'utf8');
      const currentHash = this._calculateHash(data);

      if (currentHash !== this._lastFileHash) {
        const diskTasks = JSON.parse(data);
        return { changed: true, diskTasks, data };
      }
    } catch (e) {
      // If we can't read, assume no changes
    }

    return { changed: false, diskTasks: null };
  }

  /**
   * Merge external changes with in-memory changes
   * Strategy: External task additions are preserved, in-memory status updates win
   * IMPORTANT: In-memory queue placement takes precedence to prevent duplicates
   */
  _mergeChanges(diskTasks) {
    const merged = JSON.parse(JSON.stringify(diskTasks));

    // Merge task definitions - in-memory updates win for existing tasks
    for (const [id, task] of Object.entries(this.tasks.tasks || {})) {
      if (merged.tasks[id]) {
        // Task exists on disk - merge with in-memory updates winning for status/phase
        merged.tasks[id] = {
          ...merged.tasks[id],
          status: task.status,
          updated: task.updated,
          started: task.started,
          completed: task.completed,
          qualityScore: task.qualityScore
        };
      } else {
        // Task exists in memory but not on disk - might have been added
        merged.tasks[id] = task;
      }
    }

    // Build a map of in-memory task queue placements (source of truth for existing tasks)
    const memoryQueueMap = new Map(); // taskId -> queueName
    for (const tier of ['now', 'next', 'later', 'someday', 'completed']) {
      for (const taskId of (this.tasks.backlog?.[tier]?.tasks || [])) {
        memoryQueueMap.set(taskId, tier);
      }
    }

    // Build a set of all task IDs we know about
    const allTaskIds = new Set([
      ...Object.keys(merged.tasks),
      ...Object.keys(this.tasks.tasks || {})
    ]);

    // Clear all queue arrays in merged
    for (const tier of ['now', 'next', 'later', 'someday', 'completed']) {
      if (merged.backlog[tier]) {
        merged.backlog[tier].tasks = [];
      }
    }

    // Rebuild queues: in-memory placement wins for known tasks, disk placement for new tasks
    for (const taskId of allTaskIds) {
      let targetQueue = null;

      if (memoryQueueMap.has(taskId)) {
        // In-memory placement takes precedence
        targetQueue = memoryQueueMap.get(taskId);
      } else {
        // New task from disk - find its disk queue
        for (const tier of ['now', 'next', 'later', 'someday', 'completed']) {
          if (diskTasks.backlog?.[tier]?.tasks?.includes(taskId)) {
            targetQueue = tier;
            break;
          }
        }
      }

      // Place task in appropriate queue
      if (targetQueue && merged.backlog[targetQueue]) {
        if (!merged.backlog[targetQueue].tasks.includes(taskId)) {
          merged.backlog[targetQueue].tasks.push(taskId);
        }
      }
    }

    // Final integrity check: ensure completed tasks are in completed queue
    this._enforceQueueIntegrity(merged);

    return merged;
  }

  /**
   * Enforce queue integrity rules:
   * 1. Each task can only be in ONE queue
   * 2. Completed tasks must be in the 'completed' queue
   * 3. Status must match queue placement
   */
  _enforceQueueIntegrity(data) {
    // Ensure backlog structure exists
    if (!data?.backlog) return data;

    const allTiers = ['now', 'next', 'later', 'someday', 'completed'];

    // Ensure completed tier exists
    if (!data.backlog.completed) {
      data.backlog.completed = { description: 'Completed tasks (archived)', tasks: [] };
    }
    if (!data.backlog.completed.tasks) {
      data.backlog.completed.tasks = [];
    }

    const taskQueueMap = new Map(); // taskId -> current queue

    // First pass: detect duplicates and build current placement map
    for (const tier of allTiers) {
      const tasks = data.backlog?.[tier]?.tasks || [];
      for (const taskId of tasks) {
        if (taskQueueMap.has(taskId)) {
          console.warn(`[TaskManager] Integrity violation: Task ${taskId} found in multiple queues (${taskQueueMap.get(taskId)}, ${tier})`);
        }
        taskQueueMap.set(taskId, tier);
      }
    }

    // Second pass: move completed tasks to completed queue, remove duplicates
    const seenTasks = new Set();
    for (const tier of allTiers) {
      if (!data.backlog?.[tier]?.tasks) continue;

      data.backlog[tier].tasks = data.backlog[tier].tasks.filter(taskId => {
        // Skip duplicates
        if (seenTasks.has(taskId)) {
          return false;
        }
        seenTasks.add(taskId);

        const task = data.tasks?.[taskId];
        if (!task) return true; // Keep orphaned queue entries for now

        // If task is completed but not in completed queue, move it
        if (task.status === 'completed' && tier !== 'completed') {
          console.warn(`[TaskManager] Integrity fix: Moving completed task ${taskId} from ${tier} to completed`);
          if (!data.backlog.completed.tasks.includes(taskId)) {
            data.backlog.completed.tasks.push(taskId);
          }
          return false;
        }

        return true;
      });
    }

    return data;
  }

  /**
   * Save tasks to file with concurrency protection
   */
  save() {
    // Prevent concurrent saves
    if (this._saveLock) {
      this._pendingSave = true;
      return;
    }

    this._saveLock = true;

    try {
      // Check for external changes
      const { changed, diskTasks, data: diskData } = this._checkForExternalChanges();

      if (changed && diskTasks) {
        console.warn('[TaskManager] External modification detected - merging changes');
        this.emit('tasks:external-change', { diskTasks });

        // Merge external changes with in-memory state
        this.tasks = this._mergeChanges(diskTasks);
      }

      // Always enforce queue integrity before saving
      this._enforceQueueIntegrity(this.tasks);

      // Auto-archive old completed tasks if configured
      if (this.tasks.archival?.autoArchive) {
        this._archiveOldCompletedTasks();
      }

      // Save merged state
      const data = JSON.stringify(this.tasks, null, 2);
      fs.writeFileSync(this.tasksPath, data, 'utf8');

      // Update tracking state
      this._lastFileHash = this._calculateHash(data);
      this._lastFileMtime = this._getFileStats().mtime;

      this.emit('tasks:saved');
    } finally {
      this._saveLock = false;

      // Process pending save if one was requested during lock
      if (this._pendingSave) {
        this._pendingSave = false;
        setImmediate(() => this.save());
      }
    }
  }

  /**
   * Force reload from disk, discarding in-memory changes
   */
  reload() {
    this.load();
    this.emit('tasks:reloaded');
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

  // ====================================================================
  // ARCHIVAL METHODS
  // ====================================================================

  /**
   * Archive old completed tasks to reduce file size
   * Called automatically on save when archival.autoArchive is true
   */
  _archiveOldCompletedTasks() {
    const archival = this.tasks.archival;
    if (!archival) return;

    const maxCompleted = archival.maxCompleted || 5;
    const archivePath = archival.archivePath
      ? path.join(path.dirname(this.tasksPath), '..', archival.archivePath.replace('.claude/dev-docs/', ''))
      : path.join(path.dirname(this.tasksPath), 'archives', 'tasks-archive.json');

    const completedIds = this.tasks.backlog.completed?.tasks || [];
    if (completedIds.length <= maxCompleted) return;

    // Get completed tasks with timestamps, sorted by completion date (most recent first)
    const completedTasks = completedIds
      .map(id => {
        const task = this.tasks.tasks[id];
        return task ? {
          id,
          task,
          completedAt: task.completed ? new Date(task.completed).getTime() : 0
        } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.completedAt - a.completedAt);

    // Split into keep and archive
    const tasksToKeep = completedTasks.slice(0, maxCompleted);
    const tasksToArchive = completedTasks.slice(maxCompleted);

    if (tasksToArchive.length === 0) return;

    // Ensure archive directory exists
    const archiveDir = path.dirname(archivePath);
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }

    // Load or create archive
    let archive = { archivedAt: new Date().toISOString(), tasks: {} };
    if (fs.existsSync(archivePath)) {
      try {
        archive = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
      } catch (e) {
        console.warn('[TaskManager] Could not read archive file, creating new one');
      }
    }

    // Add tasks to archive
    tasksToArchive.forEach(({ id, task }) => {
      archive.tasks[id] = task;
    });
    archive.lastArchived = new Date().toISOString();

    // Write archive
    fs.writeFileSync(archivePath, JSON.stringify(archive, null, 2), 'utf8');

    // Update in-memory state
    this.tasks.backlog.completed.tasks = tasksToKeep.map(t => t.id);
    tasksToArchive.forEach(({ id }) => {
      delete this.tasks.tasks[id];
    });
    this.tasks.archival.lastArchived = new Date().toISOString();

    console.log(`[TaskManager] Archived ${tasksToArchive.length} completed tasks`);
    this.emit('tasks:archived', { count: tasksToArchive.length, archivePath });
  }

  /**
   * Get a task from the archive by ID
   * @param {string} taskId - Task ID to retrieve
   * @returns {Object|null} Task object or null if not found
   */
  getArchivedTask(taskId) {
    const archival = this.tasks.archival;
    if (!archival) return null;

    const archivePath = archival.archivePath
      ? path.join(path.dirname(this.tasksPath), '..', archival.archivePath.replace('.claude/dev-docs/', ''))
      : path.join(path.dirname(this.tasksPath), 'archives', 'tasks-archive.json');

    if (!fs.existsSync(archivePath)) return null;

    try {
      const archive = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
      return archive.tasks[taskId] || null;
    } catch (e) {
      console.warn('[TaskManager] Could not read archive:', e.message);
      return null;
    }
  }

  /**
   * Get all archived tasks
   * @returns {Object} Map of taskId -> task
   */
  getAllArchivedTasks() {
    const archival = this.tasks.archival;
    if (!archival) return {};

    const archivePath = archival.archivePath
      ? path.join(path.dirname(this.tasksPath), '..', archival.archivePath.replace('.claude/dev-docs/', ''))
      : path.join(path.dirname(this.tasksPath), 'archives', 'tasks-archive.json');

    if (!fs.existsSync(archivePath)) return {};

    try {
      const archive = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
      return archive.tasks || {};
    } catch (e) {
      console.warn('[TaskManager] Could not read archive:', e.message);
      return {};
    }
  }

  // ====================================================================
  // HIERARCHY METHODS (parent-child task relationships)
  // ====================================================================

  /**
   * Create a subtask under a parent task
   * @param {string} parentTaskId - ID of the parent task
   * @param {Object} subtaskData - Subtask data (title, description, etc.)
   * @returns {Object} Created subtask
   */
  createSubtask(parentTaskId, subtaskData) {
    const parent = this.getTask(parentTaskId);
    if (!parent) {
      throw new Error(`Parent task not found: ${parentTaskId}`);
    }

    // Calculate delegation depth
    const delegationDepth = (parent.delegationDepth || 0) + 1;

    // Generate subtask ID
    const id = subtaskData.id || this._generateTaskId(subtaskData.title || 'subtask');

    // Create subtask with parent reference
    const subtask = {
      id,
      title: subtaskData.title,
      description: subtaskData.description || '',
      phase: subtaskData.phase || parent.phase,
      priority: subtaskData.priority || parent.priority,
      estimate: subtaskData.estimate || '1h',
      tags: subtaskData.tags || [...(parent.tags || [])],
      depends: subtaskData.depends || { blocks: [], requires: [], related: [] },
      acceptance: subtaskData.acceptance || [],
      status: 'ready',
      assignee: subtaskData.assignee || null,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      started: null,
      completed: null,
      // Hierarchy fields
      parentTaskId: parentTaskId,
      childTaskIds: [],
      delegatedTo: subtaskData.delegatedTo || null,
      delegationDepth: delegationDepth,
      decomposition: null
    };

    // Add subtask to tasks
    this.tasks.tasks[id] = subtask;

    // Update parent's childTaskIds
    if (!parent.childTaskIds) {
      parent.childTaskIds = [];
    }
    parent.childTaskIds.push(id);

    // Initialize decomposition on parent if not exists
    if (!parent.decomposition) {
      parent.decomposition = {
        strategy: 'manual',
        estimatedSubtasks: null,
        completedSubtasks: 0,
        aggregationRule: 'average'
      };
    }

    parent.updated = new Date().toISOString();

    // Add subtask to same backlog tier as parent (or 'now' by default)
    let parentTier = 'now';
    for (const tier of ['now', 'next', 'later', 'someday']) {
      if (this.tasks.backlog[tier]?.tasks?.includes(parentTaskId)) {
        parentTier = tier;
        break;
      }
    }
    if (!this.tasks.backlog[parentTier].tasks.includes(id)) {
      this.tasks.backlog[parentTier].tasks.push(id);
    }

    this.emit('task:subtask-created', { parent, subtask });
    this.save();

    return subtask;
  }

  /**
   * Get full task hierarchy (tree structure)
   * @param {string} taskId - Root task ID
   * @returns {Object|null} Task with nested children array
   */
  getTaskHierarchy(taskId) {
    const task = this.getTask(taskId);
    if (!task) return null;

    const hierarchy = { ...task };

    if (task.childTaskIds && task.childTaskIds.length > 0) {
      hierarchy.children = task.childTaskIds
        .map(childId => this.getTaskHierarchy(childId))
        .filter(child => child !== null);
    } else {
      hierarchy.children = [];
    }

    return hierarchy;
  }

  /**
   * Get root task for any task in hierarchy
   * @param {string} taskId - Task ID
   * @returns {Object|null} Root task
   */
  getRootTask(taskId) {
    let task = this.getTask(taskId);
    if (!task) return null;

    while (task.parentTaskId) {
      const parent = this.getTask(task.parentTaskId);
      if (!parent) break;
      task = parent;
    }

    return task;
  }

  /**
   * Get ancestor tasks (from immediate parent to root)
   * Note: Different from _getAncestors which tracks dependency graph
   * @param {string} taskId - Task ID
   * @returns {Array} Array of ancestor tasks
   */
  getHierarchyAncestors(taskId) {
    const ancestors = [];
    let task = this.getTask(taskId);

    if (!task) return ancestors;

    while (task.parentTaskId) {
      const parent = this.getTask(task.parentTaskId);
      if (!parent) break;
      ancestors.push(parent);
      task = parent;
    }

    return ancestors;
  }

  /**
   * Get all descendant tasks (flat array)
   * Note: Different from _getDescendants which tracks dependency graph
   * @param {string} taskId - Task ID
   * @returns {Array} Flat array of descendant tasks
   */
  getHierarchyDescendants(taskId) {
    const descendants = [];
    const task = this.getTask(taskId);

    if (!task || !task.childTaskIds) return descendants;

    const collectDescendants = (childIds) => {
      for (const childId of childIds) {
        const child = this.getTask(childId);
        if (child) {
          descendants.push(child);
          if (child.childTaskIds && child.childTaskIds.length > 0) {
            collectDescendants(child.childTaskIds);
          }
        }
      }
    };

    collectDescendants(task.childTaskIds);
    return descendants;
  }

  /**
   * Get sibling tasks (same parent)
   * @param {string} taskId - Task ID
   * @returns {Array} Array of sibling tasks
   */
  getSiblings(taskId) {
    const task = this.getTask(taskId);
    if (!task || !task.parentTaskId) return [];

    const parent = this.getTask(task.parentTaskId);
    if (!parent || !parent.childTaskIds) return [];

    return parent.childTaskIds
      .filter(id => id !== taskId)
      .map(id => this.getTask(id))
      .filter(t => t !== null);
  }

  /**
   * Update parent progress when child is completed
   * @param {string} parentTaskId - Parent task ID
   */
  _updateParentProgress(parentTaskId) {
    const parent = this.getTask(parentTaskId);
    if (!parent || !parent.childTaskIds || parent.childTaskIds.length === 0) return;

    const children = parent.childTaskIds
      .map(id => this.getTask(id))
      .filter(t => t !== null);

    if (children.length === 0) return;

    const aggregationRule = parent.decomposition?.aggregationRule || 'average';
    let completedCount = 0;

    children.forEach(child => {
      if (child.status === 'completed') {
        completedCount++;
      }
    });

    let progress = 0;
    switch (aggregationRule) {
      case 'all':
        progress = completedCount === children.length ? 100 :
          Math.floor((completedCount / children.length) * 100);
        break;
      case 'any':
        progress = completedCount > 0 ? 100 : 0;
        break;
      case 'weighted':
        const totalProgress = children.reduce((sum, child) => {
          return sum + (child.progress || (child.status === 'completed' ? 100 : 0));
        }, 0);
        progress = Math.floor(totalProgress / children.length);
        break;
      case 'average':
      default:
        progress = Math.floor((completedCount / children.length) * 100);
        break;
    }

    // Update decomposition tracking
    if (!parent.decomposition) {
      parent.decomposition = { strategy: 'manual', aggregationRule: 'average' };
    }
    parent.decomposition.completedSubtasks = completedCount;
    parent.progress = progress;
    parent.updated = new Date().toISOString();

    this.emit('task:hierarchy-progress', { parent, progress, completedCount });

    // Recursively update grandparent
    if (parent.parentTaskId) {
      this._updateParentProgress(parent.parentTaskId);
    }
  }

  /**
   * Set decomposition metadata on a task
   * @param {string} taskId - Task ID
   * @param {Object} decompositionData - { strategy, estimatedSubtasks, aggregationRule }
   * @returns {Object|null} Updated task
   */
  setDecomposition(taskId, decompositionData) {
    const task = this.getTask(taskId);
    if (!task) return null;

    task.decomposition = {
      strategy: decompositionData.strategy || 'manual',
      estimatedSubtasks: decompositionData.estimatedSubtasks || null,
      completedSubtasks: decompositionData.completedSubtasks || 0,
      aggregationRule: decompositionData.aggregationRule || 'average',
      ...decompositionData
    };

    task.updated = new Date().toISOString();
    this.save();
    return task;
  }

  /**
   * Delegate task to an agent
   * @param {string} taskId - Task ID
   * @param {Object} delegationInfo - { agentId, sessionId, ... }
   * @returns {Object|null} Updated task
   */
  delegateToAgent(taskId, delegationInfo) {
    const task = this.getTask(taskId);
    if (!task) return null;

    task.delegatedTo = {
      agentId: delegationInfo.agentId || null,
      sessionId: delegationInfo.sessionId || null,
      delegatedAt: new Date().toISOString(),
      ...delegationInfo
    };

    task.updated = new Date().toISOString();
    this.emit('task:delegated', { task, delegationInfo });
    this.save();
    return task;
  }

  /**
   * Complete task with optional cascade to children
   * @param {string} taskId - Task ID
   * @param {Object} options - { cascadeComplete: boolean }
   * @param {Object} metadata - Completion metadata
   * @returns {Object|null} Completed task
   */
  completeTaskWithCascade(taskId, options = {}, metadata = {}) {
    const task = this.getTask(taskId);
    if (!task) return null;

    // Cascade complete children first
    if (options.cascadeComplete && task.childTaskIds && task.childTaskIds.length > 0) {
      for (const childId of task.childTaskIds) {
        this.completeTaskWithCascade(childId, { cascadeComplete: true }, metadata);
      }
    }

    // Complete this task
    return this.updateStatus(taskId, 'completed', metadata);
  }

  /**
   * Delete task and all descendants
   * @param {string} taskId - Task ID
   * @returns {number} Number of tasks deleted
   */
  deleteTaskWithDescendants(taskId) {
    const descendants = this.getHierarchyDescendants(taskId);
    let deletedCount = 0;

    // Sort by depth (deepest first) to avoid orphan issues
    const sortedDescendants = descendants.sort((a, b) =>
      (b.delegationDepth || 0) - (a.delegationDepth || 0)
    );

    // Delete descendants first
    for (const descendant of sortedDescendants) {
      try {
        this.deleteTask(descendant.id);
        deletedCount++;
      } catch (e) {
        // Task may already be deleted
      }
    }

    // Delete the task itself
    try {
      this.deleteTask(taskId);
      deletedCount++;
    } catch (e) {
      // Task may already be deleted
    }

    return deletedCount;
  }

  /**
   * Get hierarchy statistics
   * @returns {Object} Hierarchy stats
   */
  getHierarchyStats() {
    const allTasks = this._getAllTasks();
    const stats = {
      rootTasks: 0,
      parentTasks: 0,
      childTasks: 0,
      maxDepth: 0,
      avgChildrenPerParent: 0
    };

    let totalChildren = 0;
    let parentCount = 0;

    allTasks.forEach(task => {
      if (!task.parentTaskId) {
        stats.rootTasks++;
      }
      if (task.parentTaskId) {
        stats.childTasks++;
      }
      if (task.childTaskIds && task.childTaskIds.length > 0) {
        stats.parentTasks++;
        totalChildren += task.childTaskIds.length;
        parentCount++;
      }
      if ((task.delegationDepth || 0) > stats.maxDepth) {
        stats.maxDepth = task.delegationDepth;
      }
    });

    stats.avgChildrenPerParent = parentCount > 0
      ? Math.round((totalChildren / parentCount) * 100) / 100
      : 0;

    return stats;
  }

  /**
   * Validate hierarchy integrity
   * @returns {Object} { valid, issueCount, issues }
   */
  validateHierarchy() {
    const issues = [];
    const allTasks = this._getAllTasks();

    allTasks.forEach(task => {
      // Check parent exists
      if (task.parentTaskId) {
        const parent = this.getTask(task.parentTaskId);
        if (!parent) {
          issues.push({
            type: 'orphan',
            taskId: task.id,
            message: `Parent task ${task.parentTaskId} not found`
          });
        } else if (!parent.childTaskIds || !parent.childTaskIds.includes(task.id)) {
          issues.push({
            type: 'missing-child-ref',
            taskId: task.id,
            parentId: task.parentTaskId,
            message: `Parent ${task.parentTaskId} does not list ${task.id} as child`
          });
        }
      }

      // Check children exist
      if (task.childTaskIds && task.childTaskIds.length > 0) {
        task.childTaskIds.forEach(childId => {
          const child = this.getTask(childId);
          if (!child) {
            issues.push({
              type: 'missing-child',
              taskId: task.id,
              childId: childId,
              message: `Child task ${childId} not found`
            });
          } else if (child.parentTaskId !== task.id) {
            issues.push({
              type: 'wrong-parent-ref',
              taskId: task.id,
              childId: childId,
              message: `Child ${childId} points to different parent`
            });
          }
        });
      }

      // Check delegation depth
      if (task.parentTaskId) {
        const parent = this.getTask(task.parentTaskId);
        if (parent) {
          const expectedDepth = (parent.delegationDepth || 0) + 1;
          if (task.delegationDepth !== expectedDepth) {
            issues.push({
              type: 'depth-mismatch',
              taskId: task.id,
              expected: expectedDepth,
              actual: task.delegationDepth,
              message: `Depth should be ${expectedDepth}, is ${task.delegationDepth}`
            });
          }
        }
      }
    });

    return {
      valid: issues.length === 0,
      issueCount: issues.length,
      issues
    };
  }

  /**
   * Repair hierarchy issues
   * @returns {Object} { repairsPerformed, repairs }
   */
  repairHierarchy() {
    const validation = this.validateHierarchy();
    const repairs = [];

    validation.issues.forEach(issue => {
      const task = this.getTask(issue.taskId);
      if (!task) return;

      switch (issue.type) {
        case 'orphan':
          task.parentTaskId = null;
          task.delegationDepth = 0;
          repairs.push(`Cleared parent reference for orphan ${issue.taskId}`);
          break;

        case 'missing-child-ref':
          const parent = this.getTask(issue.parentId);
          if (parent) {
            if (!parent.childTaskIds) parent.childTaskIds = [];
            if (!parent.childTaskIds.includes(issue.taskId)) {
              parent.childTaskIds.push(issue.taskId);
              repairs.push(`Added ${issue.taskId} to parent ${issue.parentId} children`);
            }
          }
          break;

        case 'missing-child':
          if (task.childTaskIds) {
            task.childTaskIds = task.childTaskIds.filter(id => id !== issue.childId);
            repairs.push(`Removed missing child ${issue.childId} from ${issue.taskId}`);
          }
          break;

        case 'wrong-parent-ref':
          const child = this.getTask(issue.childId);
          if (child) {
            child.parentTaskId = issue.taskId;
            repairs.push(`Fixed parent reference for ${issue.childId} to ${issue.taskId}`);
          }
          break;

        case 'depth-mismatch':
          task.delegationDepth = issue.expected;
          repairs.push(`Fixed delegation depth for ${issue.taskId} to ${issue.expected}`);
          break;
      }
    });

    if (repairs.length > 0) {
      this.save();
    }

    return {
      repairsPerformed: repairs.length,
      repairs
    };
  }
}

module.exports = TaskManager;
