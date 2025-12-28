/**
 * DecompositionStrategies - Task decomposition strategies for hierarchy system
 *
 * Part of Hierarchy Phase 3 - provides strategies for breaking down
 * complex tasks into manageable subtasks.
 *
 * Strategies:
 * - ParallelStrategy: Independent subtasks that run concurrently
 * - SequentialStrategy: Ordered steps with dependencies
 * - HybridStrategy: Mix of parallel and sequential execution
 * - ManualStrategy: User-guided decomposition
 *
 * @module decomposition-strategies
 */

const crypto = require('crypto');

// Default estimation constants
const DEFAULT_ESTIMATES = {
  tokensPerHour: 2000,       // Estimated tokens used per hour of work
  overheadMultiplier: 1.2,   // 20% overhead for coordination
  minSubtaskTime: 0.5,       // Minimum 30 minutes per subtask
  maxSubtaskTime: 4          // Maximum 4 hours per subtask
};

/**
 * Base class for decomposition strategies
 */
class BaseStrategy {
  constructor(name, config = {}) {
    this.name = name;
    this.config = {
      maxSubtasks: config.maxSubtasks || 10,
      minSubtaskSize: config.minSubtaskSize || 0.5, // hours
      maxSubtaskSize: config.maxSubtaskSize || 4,   // hours
      ...config
    };
  }

  /**
   * Check if this strategy can be applied to the task
   * @param {Object} task - Task to decompose
   * @returns {{ canApply: boolean, reason?: string, confidence?: number }}
   */
  canApply(task) {
    throw new Error(`${this.name} must implement canApply()`);
  }

  /**
   * Decompose the task into subtasks
   * @param {Object} task - Task to decompose
   * @param {Object} options - Decomposition options
   * @returns {{ subtasks: Array, strategy: string, metadata: Object }}
   */
  decompose(task, options = {}) {
    throw new Error(`${this.name} must implement decompose()`);
  }

  /**
   * Validate generated subtasks
   * @param {Array} subtasks - Generated subtasks
   * @returns {{ valid: boolean, issues: Array, warnings: Array }}
   */
  validate(subtasks) {
    throw new Error(`${this.name} must implement validate()`);
  }

  /**
   * Estimate effort/time/tokens for subtasks
   * @param {Array} subtasks - Subtasks to estimate
   * @returns {{ totalTime: number, totalTokens: number, criticalPath: number, breakdown: Array }}
   */
  estimate(subtasks) {
    throw new Error(`${this.name} must implement estimate()`);
  }

  /**
   * Generate a unique subtask ID
   * @param {string} parentId - Parent task ID
   * @param {number} index - Subtask index
   * @returns {string}
   */
  _generateSubtaskId(parentId, index) {
    const suffix = crypto.randomBytes(3).toString('hex');
    return `${parentId}-sub${index + 1}-${suffix}`;
  }

  /**
   * Parse time estimate string to hours
   * @param {string} estimate - Time estimate (e.g., "2h", "1d")
   * @returns {number} Hours
   */
  _parseEstimate(estimate) {
    if (!estimate) return 2; // Default 2 hours
    const match = estimate.match(/(\d+\.?\d*)\s*(h|hour|hours|d|day|days|m|min|minutes)?/i);
    if (!match) return 2;

    const value = parseFloat(match[1]);
    const unit = (match[2] || 'h').toLowerCase();

    if (unit.startsWith('d')) return value * 8;
    if (unit.startsWith('m')) return value / 60;
    return value;
  }

  /**
   * Format hours to estimate string
   * @param {number} hours
   * @returns {string}
   */
  _formatEstimate(hours) {
    if (hours >= 8) return `${Math.round(hours / 8)}d`;
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    return `${hours}h`;
  }

  /**
   * Check for circular dependencies in subtasks
   * @param {Array} subtasks
   * @returns {{ hasCircular: boolean, cycle: Array }}
   */
  _checkCircularDependencies(subtasks) {
    const graph = new Map();
    const visited = new Set();
    const recursionStack = new Set();
    const cycle = [];

    // Build adjacency list
    subtasks.forEach(st => {
      graph.set(st.id, st.depends?.requires || []);
    });

    const dfs = (nodeId, path = []) => {
      if (recursionStack.has(nodeId)) {
        const cycleStart = path.indexOf(nodeId);
        cycle.push(...path.slice(cycleStart), nodeId);
        return true;
      }
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      recursionStack.add(nodeId);

      const deps = graph.get(nodeId) || [];
      for (const dep of deps) {
        if (graph.has(dep) && dfs(dep, [...path, nodeId])) {
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const st of subtasks) {
      if (!visited.has(st.id) && dfs(st.id)) {
        return { hasCircular: true, cycle };
      }
    }

    return { hasCircular: false, cycle: [] };
  }
}

/**
 * ParallelStrategy - Decompose into independent subtasks that run concurrently
 */
class ParallelStrategy extends BaseStrategy {
  constructor(config = {}) {
    super('parallel', config);
    this.splitModes = ['component', 'domain', 'data-partition', 'feature'];
  }

  canApply(task) {
    // Check if task has characteristics suitable for parallel decomposition
    const description = `${task.title || ''} ${task.description || ''}`.toLowerCase();

    // Keywords suggesting parallelizable work
    const parallelKeywords = ['multiple', 'each', 'all', 'various', 'several', 'independent', 'parallel'];
    const hasParallelKeywords = parallelKeywords.some(kw => description.includes(kw));

    // Keywords suggesting sequential work (less suitable)
    const sequentialKeywords = ['then', 'after', 'before', 'first', 'next', 'finally', 'depends'];
    const hasSequentialKeywords = sequentialKeywords.some(kw => description.includes(kw));

    // Check task type/tags
    const tags = task.tags || [];
    const isMultiComponent = tags.includes('multi-component') || tags.includes('parallel');

    const confidence = (
      (hasParallelKeywords ? 0.3 : 0) +
      (isMultiComponent ? 0.3 : 0) +
      (!hasSequentialKeywords ? 0.2 : 0) +
      (this._parseEstimate(task.estimate) >= 4 ? 0.2 : 0.1) // Larger tasks benefit more
    );

    return {
      canApply: confidence >= 0.4,
      reason: confidence >= 0.4
        ? 'Task characteristics suggest parallel decomposition'
        : 'Task appears to have sequential dependencies',
      confidence,
      indicators: { hasParallelKeywords, hasSequentialKeywords, isMultiComponent }
    };
  }

  decompose(task, options = {}) {
    const {
      splitBy = 'component',
      components = [],
      domains = [],
      partitions = [],
      targetSubtasks = null
    } = options;

    const subtasks = [];
    const parentHours = this._parseEstimate(task.estimate);
    let items = [];

    // Determine items to split by
    switch (splitBy) {
      case 'component':
        items = components.length > 0 ? components : this._inferComponents(task);
        break;
      case 'domain':
        items = domains.length > 0 ? domains : this._inferDomains(task);
        break;
      case 'data-partition':
        items = partitions.length > 0 ? partitions : this._inferPartitions(task, targetSubtasks || 3);
        break;
      case 'feature':
        items = this._inferFeatures(task);
        break;
      default:
        items = this._inferComponents(task);
    }

    // Ensure we have at least 2 items
    if (items.length < 2) {
      items = [
        { name: 'Part A', description: 'First portion of work' },
        { name: 'Part B', description: 'Second portion of work' }
      ];
    }

    // Limit to max subtasks
    items = items.slice(0, this.config.maxSubtasks);

    // Distribute time evenly (parallel execution)
    const hoursPerSubtask = Math.max(
      this.config.minSubtaskSize,
      Math.min(this.config.maxSubtaskSize, parentHours / items.length * DEFAULT_ESTIMATES.overheadMultiplier)
    );

    items.forEach((item, index) => {
      const subtask = {
        id: this._generateSubtaskId(task.id, index),
        title: typeof item === 'string' ? `${task.title}: ${item}` : `${task.title}: ${item.name}`,
        description: typeof item === 'string'
          ? `Handle ${item} portion of parent task`
          : item.description || `Handle ${item.name} portion of parent task`,
        phase: task.phase,
        priority: task.priority,
        estimate: this._formatEstimate(hoursPerSubtask),
        tags: [...(task.tags || []), 'parallel', splitBy],
        depends: { blocks: [], requires: [], related: [] },
        acceptance: this._deriveAcceptance(task, item),
        status: 'ready',
        parallelGroup: 0, // All in same parallel group
        canRunParallel: true
      };
      subtasks.push(subtask);
    });

    return {
      subtasks,
      strategy: 'parallel',
      metadata: {
        splitBy,
        itemCount: items.length,
        estimatedParallelTime: hoursPerSubtask,
        estimatedSequentialTime: hoursPerSubtask * items.length
      }
    };
  }

  validate(subtasks) {
    const issues = [];
    const warnings = [];

    if (subtasks.length < 2) {
      issues.push({ type: 'insufficient_subtasks', message: 'Parallel strategy requires at least 2 subtasks' });
    }

    // Check for circular dependencies
    const { hasCircular, cycle } = this._checkCircularDependencies(subtasks);
    if (hasCircular) {
      issues.push({
        type: 'circular_dependency',
        message: `Circular dependency detected: ${cycle.join(' -> ')}`,
        cycle
      });
    }

    // Check all subtasks are independent (no dependencies on each other)
    const subtaskIds = new Set(subtasks.map(st => st.id));
    subtasks.forEach(st => {
      const internalDeps = (st.depends?.requires || []).filter(d => subtaskIds.has(d));
      if (internalDeps.length > 0) {
        warnings.push({
          type: 'internal_dependency',
          subtaskId: st.id,
          message: `Subtask has dependencies on sibling subtasks: ${internalDeps.join(', ')}. Consider sequential or hybrid strategy.`
        });
      }
    });

    return {
      valid: issues.length === 0,
      issues,
      warnings
    };
  }

  estimate(subtasks) {
    const breakdown = subtasks.map(st => ({
      id: st.id,
      title: st.title,
      hours: this._parseEstimate(st.estimate),
      tokens: this._parseEstimate(st.estimate) * DEFAULT_ESTIMATES.tokensPerHour
    }));

    const maxTime = Math.max(...breakdown.map(b => b.hours));
    const totalTokens = breakdown.reduce((sum, b) => sum + b.tokens, 0);

    return {
      totalTime: maxTime, // Parallel = max of subtask times
      totalTokens,
      criticalPath: maxTime,
      parallelEfficiency: breakdown.reduce((sum, b) => sum + b.hours, 0) / maxTime,
      breakdown
    };
  }

  _inferComponents(task) {
    const description = `${task.title} ${task.description}`.toLowerCase();
    const components = [];

    // Common component patterns
    const patterns = [
      /(?:create|implement|add)\s+(\w+(?:\s+\w+)?)\s+(?:component|module|service)/gi,
      /(\w+)\s+(?:component|module|service|handler)/gi
    ];

    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        components.push({ name: match[1], description: `Handle ${match[1]}` });
      }
    });

    // If no patterns found, create generic components
    if (components.length === 0) {
      return [
        { name: 'Core Logic', description: 'Implement core business logic' },
        { name: 'Data Layer', description: 'Handle data access and storage' },
        { name: 'Interface', description: 'Implement user/API interface' }
      ];
    }

    return components;
  }

  _inferDomains(task) {
    const tags = task.tags || [];
    const domains = [];

    // Map common tags to domains
    const domainMap = {
      'backend': { name: 'Backend', description: 'Server-side implementation' },
      'frontend': { name: 'Frontend', description: 'Client-side implementation' },
      'api': { name: 'API', description: 'API endpoints and contracts' },
      'database': { name: 'Database', description: 'Data model and persistence' },
      'testing': { name: 'Testing', description: 'Test implementation' },
      'docs': { name: 'Documentation', description: 'Documentation updates' }
    };

    tags.forEach(tag => {
      if (domainMap[tag.toLowerCase()]) {
        domains.push(domainMap[tag.toLowerCase()]);
      }
    });

    if (domains.length === 0) {
      return [
        { name: 'Implementation', description: 'Core implementation work' },
        { name: 'Testing', description: 'Test coverage' }
      ];
    }

    return domains;
  }

  _inferPartitions(task, count) {
    const partitions = [];
    for (let i = 0; i < count; i++) {
      partitions.push({
        name: `Partition ${i + 1}`,
        description: `Data/work partition ${i + 1} of ${count}`
      });
    }
    return partitions;
  }

  _inferFeatures(task) {
    const description = `${task.title} ${task.description}`.toLowerCase();
    const features = [];

    // Look for feature-like patterns
    const featurePatterns = [
      /(?:add|implement|create)\s+(\w+(?:\s+\w+)?)\s+(?:feature|functionality)/gi,
      /support\s+(?:for\s+)?(\w+(?:\s+\w+)?)/gi
    ];

    featurePatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        features.push({ name: match[1], description: `Implement ${match[1]} feature` });
      }
    });

    if (features.length === 0) {
      return [
        { name: 'Primary Feature', description: 'Main feature implementation' },
        { name: 'Supporting Feature', description: 'Supporting functionality' }
      ];
    }

    return features;
  }

  _deriveAcceptance(task, item) {
    const itemName = typeof item === 'string' ? item : item.name;
    const baseAcceptance = task.acceptance || [];

    // Filter parent acceptance criteria relevant to this item
    const relevant = baseAcceptance.filter(a =>
      a.toLowerCase().includes(itemName.toLowerCase())
    );

    if (relevant.length > 0) return relevant;

    // Generate default acceptance
    return [`${itemName} component implemented and working`];
  }
}

/**
 * SequentialStrategy - Decompose into ordered steps with dependencies
 */
class SequentialStrategy extends BaseStrategy {
  constructor(config = {}) {
    super('sequential', config);
  }

  canApply(task) {
    const description = `${task.title || ''} ${task.description || ''}`.toLowerCase();

    // Keywords suggesting sequential workflow
    const sequentialKeywords = ['then', 'after', 'before', 'first', 'next', 'finally', 'step', 'phase', 'stage'];
    const hasSequentialKeywords = sequentialKeywords.some(kw => description.includes(kw));

    // Keywords suggesting parallel work (less suitable)
    const parallelKeywords = ['parallel', 'concurrent', 'simultaneously', 'independent'];
    const hasParallelKeywords = parallelKeywords.some(kw => description.includes(kw));

    // Check for numbered steps
    const hasNumberedSteps = /\d+\.\s+|\bstep\s+\d+/i.test(description);

    // Check tags
    const tags = task.tags || [];
    const isWorkflow = tags.includes('workflow') || tags.includes('sequential') || tags.includes('pipeline');

    const confidence = (
      (hasSequentialKeywords ? 0.3 : 0) +
      (hasNumberedSteps ? 0.25 : 0) +
      (isWorkflow ? 0.25 : 0) +
      (!hasParallelKeywords ? 0.2 : 0)
    );

    return {
      canApply: confidence >= 0.4,
      reason: confidence >= 0.4
        ? 'Task characteristics suggest sequential decomposition'
        : 'Task may benefit from parallel execution',
      confidence,
      indicators: { hasSequentialKeywords, hasNumberedSteps, isWorkflow, hasParallelKeywords }
    };
  }

  decompose(task, options = {}) {
    const {
      steps = [],
      workflow = null,
      autoInfer = true
    } = options;

    let workflowSteps = steps;

    // If no steps provided, infer from task
    if (workflowSteps.length === 0 && autoInfer) {
      workflowSteps = workflow
        ? this._parseWorkflow(workflow)
        : this._inferSteps(task);
    }

    // Ensure minimum steps
    if (workflowSteps.length < 2) {
      workflowSteps = [
        { name: 'Preparation', description: 'Setup and preparation' },
        { name: 'Implementation', description: 'Core implementation' },
        { name: 'Verification', description: 'Testing and verification' }
      ];
    }

    // Limit to max subtasks
    workflowSteps = workflowSteps.slice(0, this.config.maxSubtasks);

    const parentHours = this._parseEstimate(task.estimate);
    const hoursPerStep = Math.max(
      this.config.minSubtaskSize,
      Math.min(this.config.maxSubtaskSize, (parentHours / workflowSteps.length) * DEFAULT_ESTIMATES.overheadMultiplier)
    );

    const subtasks = [];
    let previousId = null;

    workflowSteps.forEach((step, index) => {
      const subtask = {
        id: this._generateSubtaskId(task.id, index),
        title: typeof step === 'string' ? `Step ${index + 1}: ${step}` : `Step ${index + 1}: ${step.name}`,
        description: typeof step === 'string'
          ? step
          : step.description || `Execute step: ${step.name}`,
        phase: task.phase,
        priority: task.priority,
        estimate: step.estimate || this._formatEstimate(hoursPerStep),
        tags: [...(task.tags || []), 'sequential', `step-${index + 1}`],
        depends: {
          blocks: [],
          requires: previousId ? [previousId] : [],
          related: []
        },
        acceptance: this._deriveStepAcceptance(task, step, index),
        status: previousId ? 'blocked' : 'ready',
        sequenceOrder: index,
        canRunParallel: false
      };

      subtasks.push(subtask);
      previousId = subtask.id;
    });

    return {
      subtasks,
      strategy: 'sequential',
      metadata: {
        stepCount: workflowSteps.length,
        estimatedTotalTime: hoursPerStep * workflowSteps.length,
        orderPreserved: true
      }
    };
  }

  validate(subtasks) {
    const issues = [];
    const warnings = [];

    if (subtasks.length < 2) {
      issues.push({ type: 'insufficient_subtasks', message: 'Sequential strategy requires at least 2 subtasks' });
    }

    // Check for circular dependencies
    const { hasCircular, cycle } = this._checkCircularDependencies(subtasks);
    if (hasCircular) {
      issues.push({
        type: 'circular_dependency',
        message: `Circular dependency detected: ${cycle.join(' -> ')}`,
        cycle
      });
    }

    // Verify linear chain
    const subtaskIds = new Set(subtasks.map(st => st.id));
    const hasIncoming = new Set();
    const hasOutgoing = new Set();

    subtasks.forEach(st => {
      (st.depends?.requires || []).forEach(dep => {
        if (subtaskIds.has(dep)) {
          hasIncoming.add(st.id);
          hasOutgoing.add(dep);
        }
      });
    });

    // Check single predecessor constraint
    subtasks.forEach(st => {
      const internalDeps = (st.depends?.requires || []).filter(d => subtaskIds.has(d));
      if (internalDeps.length > 1) {
        warnings.push({
          type: 'multiple_predecessors',
          subtaskId: st.id,
          message: `Subtask has ${internalDeps.length} predecessors. Sequential expects single predecessor.`
        });
      }
    });

    // Check for gaps in chain
    const startNodes = subtasks.filter(st => !hasIncoming.has(st.id));
    if (startNodes.length > 1) {
      warnings.push({
        type: 'multiple_start_nodes',
        message: `Found ${startNodes.length} start nodes. Sequential chain may have gaps.`
      });
    }

    return {
      valid: issues.length === 0,
      issues,
      warnings
    };
  }

  estimate(subtasks) {
    const breakdown = subtasks.map(st => ({
      id: st.id,
      title: st.title,
      hours: this._parseEstimate(st.estimate),
      tokens: this._parseEstimate(st.estimate) * DEFAULT_ESTIMATES.tokensPerHour,
      order: st.sequenceOrder
    }));

    const totalTime = breakdown.reduce((sum, b) => sum + b.hours, 0);
    const totalTokens = breakdown.reduce((sum, b) => sum + b.tokens, 0);

    return {
      totalTime, // Sequential = sum of subtask times
      totalTokens,
      criticalPath: totalTime, // Same as total for sequential
      parallelEfficiency: 1, // No parallelism
      breakdown: breakdown.sort((a, b) => a.order - b.order)
    };
  }

  _inferSteps(task) {
    const description = `${task.title} ${task.description}`;
    const steps = [];

    // Look for numbered steps
    const numberedPattern = /(?:^|\n)\s*(\d+)[.):]\s*([^\n]+)/g;
    let match;
    while ((match = numberedPattern.exec(description)) !== null) {
      steps.push({ name: match[2].trim(), order: parseInt(match[1]) });
    }

    if (steps.length >= 2) {
      return steps.sort((a, b) => a.order - b.order);
    }

    // Look for step keywords
    const stepPatterns = [
      /first[,:]?\s+([^.]+)/gi,
      /then[,:]?\s+([^.]+)/gi,
      /next[,:]?\s+([^.]+)/gi,
      /finally[,:]?\s+([^.]+)/gi
    ];

    stepPatterns.forEach((pattern, idx) => {
      match = pattern.exec(description);
      if (match) {
        steps.push({ name: match[1].trim(), order: idx });
      }
    });

    if (steps.length >= 2) {
      return steps.sort((a, b) => a.order - b.order);
    }

    // Default workflow based on phase
    const phaseWorkflows = {
      research: [
        { name: 'Gather Requirements', description: 'Collect and document requirements' },
        { name: 'Analyze Options', description: 'Research and evaluate alternatives' },
        { name: 'Document Findings', description: 'Create research report' }
      ],
      design: [
        { name: 'Define Architecture', description: 'High-level system design' },
        { name: 'Detail Specifications', description: 'Detailed component specs' },
        { name: 'Review Design', description: 'Validate design decisions' }
      ],
      implementation: [
        { name: 'Setup', description: 'Prepare environment and dependencies' },
        { name: 'Implement Core', description: 'Build core functionality' },
        { name: 'Integrate', description: 'Connect components' },
        { name: 'Test', description: 'Verify implementation' }
      ],
      testing: [
        { name: 'Write Tests', description: 'Create test cases' },
        { name: 'Execute Tests', description: 'Run test suite' },
        { name: 'Fix Issues', description: 'Address test failures' }
      ]
    };

    return phaseWorkflows[task.phase] || phaseWorkflows.implementation;
  }

  _parseWorkflow(workflow) {
    if (typeof workflow === 'string') {
      return workflow.split(/[,;]|\n/).map((s, i) => ({
        name: s.trim(),
        order: i
      })).filter(s => s.name);
    }
    return workflow;
  }

  _deriveStepAcceptance(task, step, index) {
    const stepName = typeof step === 'string' ? step : step.name;
    return [`Step ${index + 1} (${stepName}) completed successfully`];
  }
}

/**
 * HybridStrategy - Mix of parallel and sequential execution
 */
class HybridStrategy extends BaseStrategy {
  constructor(config = {}) {
    super('hybrid', config);
  }

  canApply(task) {
    const description = `${task.title || ''} ${task.description || ''}`.toLowerCase();

    // Hybrid is suitable for complex tasks with mixed dependencies
    const hasSequentialIndicators = ['then', 'after', 'before', 'first'].some(kw => description.includes(kw));
    const hasParallelIndicators = ['parallel', 'concurrent', 'multiple', 'each'].some(kw => description.includes(kw));

    const hours = this._parseEstimate(task.estimate);
    const isComplex = hours >= 8; // 1+ day tasks
    const hasSubtasks = task.childTaskIds && task.childTaskIds.length > 0;

    const confidence = (
      (hasSequentialIndicators && hasParallelIndicators ? 0.4 : 0) +
      (isComplex ? 0.3 : 0.1) +
      (hasSubtasks ? 0.2 : 0) +
      0.1 // Base confidence since hybrid is always valid
    );

    return {
      canApply: confidence >= 0.4 || isComplex,
      reason: confidence >= 0.4
        ? 'Task has mixed parallel and sequential characteristics'
        : isComplex ? 'Complex task suitable for hybrid decomposition' : 'Consider simpler strategy',
      confidence,
      indicators: { hasSequentialIndicators, hasParallelIndicators, isComplex }
    };
  }

  decompose(task, options = {}) {
    const {
      groups = [],
      autoInfer = true
    } = options;

    let parallelGroups = groups;

    // If no groups provided, infer from task
    if (parallelGroups.length === 0 && autoInfer) {
      parallelGroups = this._inferParallelGroups(task);
    }

    const parentHours = this._parseEstimate(task.estimate);
    const subtasks = [];
    let previousGroupLastId = null;
    let subtaskIndex = 0;

    parallelGroups.forEach((group, groupIndex) => {
      const groupItems = group.items || [group];
      const groupHours = group.estimate
        ? this._parseEstimate(group.estimate)
        : parentHours / parallelGroups.length;

      const hoursPerItem = Math.max(
        this.config.minSubtaskSize,
        Math.min(this.config.maxSubtaskSize, groupHours / groupItems.length)
      );

      const groupSubtaskIds = [];

      groupItems.forEach((item, itemIndex) => {
        const subtask = {
          id: this._generateSubtaskId(task.id, subtaskIndex++),
          title: typeof item === 'string'
            ? `${task.title}: ${item}`
            : `${task.title}: ${item.name}`,
          description: typeof item === 'string'
            ? item
            : item.description || `Execute: ${item.name}`,
          phase: task.phase,
          priority: task.priority,
          estimate: this._formatEstimate(hoursPerItem),
          tags: [...(task.tags || []), 'hybrid', `group-${groupIndex + 1}`],
          depends: {
            blocks: [],
            requires: previousGroupLastId ? [previousGroupLastId] : [],
            related: []
          },
          acceptance: this._deriveAcceptance(task, item),
          status: previousGroupLastId ? 'blocked' : 'ready',
          parallelGroup: groupIndex,
          canRunParallel: true,
          groupName: group.name || `Group ${groupIndex + 1}`
        };

        subtasks.push(subtask);
        groupSubtaskIds.push(subtask.id);
      });

      // Track last subtask in group for sequential dependency
      previousGroupLastId = groupSubtaskIds[groupSubtaskIds.length - 1];

      // Update dependencies within group (all depend on previous group's last task)
      if (groupIndex > 0) {
        const prevGroupLast = subtasks[subtasks.length - groupItems.length - 1]?.id;
        if (prevGroupLast) {
          groupSubtaskIds.forEach(id => {
            const st = subtasks.find(s => s.id === id);
            if (st && !st.depends.requires.includes(prevGroupLast)) {
              st.depends.requires = [prevGroupLast];
            }
          });
        }
      }
    });

    // Build dependency graph for critical path calculation
    const dependencyGraph = this._buildDependencyGraph(subtasks);

    return {
      subtasks,
      strategy: 'hybrid',
      metadata: {
        groupCount: parallelGroups.length,
        dependencyGraph,
        estimatedCriticalPath: this._calculateCriticalPath(subtasks, dependencyGraph)
      }
    };
  }

  validate(subtasks) {
    const issues = [];
    const warnings = [];

    if (subtasks.length < 2) {
      issues.push({ type: 'insufficient_subtasks', message: 'Hybrid strategy requires at least 2 subtasks' });
    }

    // Check for circular dependencies
    const { hasCircular, cycle } = this._checkCircularDependencies(subtasks);
    if (hasCircular) {
      issues.push({
        type: 'circular_dependency',
        message: `Circular dependency detected: ${cycle.join(' -> ')}`,
        cycle
      });
    }

    // Verify parallel groups are properly isolated
    const groups = new Map();
    subtasks.forEach(st => {
      const group = st.parallelGroup;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(st);
    });

    // Check intra-group dependencies (should be minimal)
    groups.forEach((groupSubtasks, groupId) => {
      const groupIds = new Set(groupSubtasks.map(st => st.id));
      groupSubtasks.forEach(st => {
        const intraGroupDeps = (st.depends?.requires || []).filter(d => groupIds.has(d));
        if (intraGroupDeps.length > 0) {
          warnings.push({
            type: 'intra_group_dependency',
            subtaskId: st.id,
            group: groupId,
            message: `Subtask has dependencies within same parallel group: ${intraGroupDeps.join(', ')}`
          });
        }
      });
    });

    return {
      valid: issues.length === 0,
      issues,
      warnings
    };
  }

  estimate(subtasks) {
    const graph = this._buildDependencyGraph(subtasks);
    const criticalPath = this._calculateCriticalPath(subtasks, graph);

    const breakdown = subtasks.map(st => ({
      id: st.id,
      title: st.title,
      hours: this._parseEstimate(st.estimate),
      tokens: this._parseEstimate(st.estimate) * DEFAULT_ESTIMATES.tokensPerHour,
      group: st.parallelGroup,
      isOnCriticalPath: criticalPath.path.includes(st.id)
    }));

    const totalSequentialTime = breakdown.reduce((sum, b) => sum + b.hours, 0);
    const totalTokens = breakdown.reduce((sum, b) => sum + b.tokens, 0);

    return {
      totalTime: criticalPath.duration,
      totalTokens,
      criticalPath: criticalPath.duration,
      criticalPathNodes: criticalPath.path,
      parallelEfficiency: totalSequentialTime / criticalPath.duration,
      breakdown
    };
  }

  _inferParallelGroups(task) {
    // Try to identify natural groupings
    const groups = [];

    // Common hybrid patterns
    const phases = {
      preparation: { name: 'Preparation', items: [] },
      parallel: { name: 'Main Work', items: [] },
      integration: { name: 'Integration', items: [] }
    };

    const description = `${task.title} ${task.description}`.toLowerCase();

    // Preparation phase keywords
    if (description.includes('setup') || description.includes('prepare') || description.includes('initialize')) {
      phases.preparation.items.push({ name: 'Setup', description: 'Preparation and setup' });
    }

    // Main parallel work
    const components = this._extractComponents(description);
    if (components.length > 1) {
      phases.parallel.items = components;
    } else {
      phases.parallel.items = [
        { name: 'Core Implementation', description: 'Main work' },
        { name: 'Supporting Work', description: 'Supporting tasks' }
      ];
    }

    // Integration phase
    if (description.includes('integrate') || description.includes('test') || description.includes('verify')) {
      phases.integration.items.push({ name: 'Integration & Testing', description: 'Combine and verify' });
    }

    // Build groups
    if (phases.preparation.items.length > 0) {
      groups.push(phases.preparation);
    }
    groups.push(phases.parallel);
    if (phases.integration.items.length > 0) {
      groups.push(phases.integration);
    }

    return groups;
  }

  _extractComponents(description) {
    const components = [];
    const patterns = [
      /(\w+)\s+(?:component|module|service)/gi,
      /implement\s+(\w+)/gi
    ];

    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        components.push({ name: match[1], description: `Handle ${match[1]}` });
      }
    });

    return components.slice(0, 4); // Max 4 parallel components
  }

  _buildDependencyGraph(subtasks) {
    const graph = {
      nodes: {},
      edges: []
    };

    subtasks.forEach(st => {
      graph.nodes[st.id] = {
        id: st.id,
        duration: this._parseEstimate(st.estimate),
        group: st.parallelGroup
      };

      (st.depends?.requires || []).forEach(dep => {
        graph.edges.push({ from: dep, to: st.id });
      });
    });

    return graph;
  }

  _calculateCriticalPath(subtasks, graph) {
    // Topological sort and longest path calculation
    const inDegree = {};
    const earliestStart = {};
    const earliestFinish = {};
    const predecessor = {};

    Object.keys(graph.nodes).forEach(id => {
      inDegree[id] = 0;
      earliestStart[id] = 0;
      earliestFinish[id] = 0;
      predecessor[id] = null;
    });

    graph.edges.forEach(edge => {
      inDegree[edge.to] = (inDegree[edge.to] || 0) + 1;
    });

    // Process in topological order
    const queue = Object.keys(inDegree).filter(id => inDegree[id] === 0);

    while (queue.length > 0) {
      const current = queue.shift();
      const node = graph.nodes[current];

      earliestFinish[current] = earliestStart[current] + node.duration;

      // Update successors
      graph.edges
        .filter(e => e.from === current)
        .forEach(edge => {
          if (earliestFinish[current] > earliestStart[edge.to]) {
            earliestStart[edge.to] = earliestFinish[current];
            predecessor[edge.to] = current;
          }

          inDegree[edge.to]--;
          if (inDegree[edge.to] === 0) {
            queue.push(edge.to);
          }
        });
    }

    // Find the path with maximum finish time
    let maxFinish = 0;
    let endNode = null;

    Object.keys(earliestFinish).forEach(id => {
      if (earliestFinish[id] > maxFinish) {
        maxFinish = earliestFinish[id];
        endNode = id;
      }
    });

    // Reconstruct critical path
    const path = [];
    let current = endNode;
    while (current) {
      path.unshift(current);
      current = predecessor[current];
    }

    return {
      duration: maxFinish,
      path
    };
  }

  _deriveAcceptance(task, item) {
    const itemName = typeof item === 'string' ? item : item.name;
    return [`${itemName} completed successfully`];
  }
}

/**
 * ManualStrategy - User-guided decomposition
 */
class ManualStrategy extends BaseStrategy {
  constructor(config = {}) {
    super('manual', config);
  }

  canApply(task) {
    // Manual strategy is always applicable
    return {
      canApply: true,
      reason: 'Manual decomposition can be applied to any task',
      confidence: 1.0,
      indicators: { alwaysApplicable: true }
    };
  }

  decompose(task, options = {}) {
    const {
      subtasks: providedSubtasks = [],
      validateCompleteness = true,
      suggestImprovements = true
    } = options;

    if (providedSubtasks.length === 0) {
      throw new Error('ManualStrategy requires user-provided subtasks');
    }

    // Normalize and enhance provided subtasks
    const subtasks = providedSubtasks.map((st, index) => ({
      id: st.id || this._generateSubtaskId(task.id, index),
      title: st.title || `Subtask ${index + 1}`,
      description: st.description || '',
      phase: st.phase || task.phase,
      priority: st.priority || task.priority,
      estimate: st.estimate || '1h',
      tags: [...(task.tags || []), 'manual', ...(st.tags || [])],
      depends: {
        blocks: st.depends?.blocks || [],
        requires: st.depends?.requires || [],
        related: st.depends?.related || []
      },
      acceptance: st.acceptance || [`${st.title || `Subtask ${index + 1}`} completed`],
      status: st.status || 'ready',
      parallelGroup: st.parallelGroup !== undefined ? st.parallelGroup : null,
      canRunParallel: st.canRunParallel !== undefined ? st.canRunParallel : true
    }));

    // Generate suggestions if enabled
    const suggestions = suggestImprovements ? this._generateSuggestions(task, subtasks) : [];

    // Validate completeness if enabled
    const completeness = validateCompleteness ? this._checkCompleteness(task, subtasks) : { complete: true };

    return {
      subtasks,
      strategy: 'manual',
      metadata: {
        userProvided: true,
        subtaskCount: subtasks.length,
        suggestions,
        completeness
      }
    };
  }

  validate(subtasks) {
    const issues = [];
    const warnings = [];

    if (subtasks.length === 0) {
      issues.push({ type: 'empty', message: 'No subtasks provided' });
      return { valid: false, issues, warnings };
    }

    // Check for circular dependencies
    const { hasCircular, cycle } = this._checkCircularDependencies(subtasks);
    if (hasCircular) {
      issues.push({
        type: 'circular_dependency',
        message: `Circular dependency detected: ${cycle.join(' -> ')}`,
        cycle
      });
    }

    // Check for duplicate IDs
    const ids = new Set();
    subtasks.forEach(st => {
      if (ids.has(st.id)) {
        issues.push({
          type: 'duplicate_id',
          subtaskId: st.id,
          message: `Duplicate subtask ID: ${st.id}`
        });
      }
      ids.add(st.id);
    });

    // Check for missing required fields
    subtasks.forEach(st => {
      if (!st.title || st.title.trim() === '') {
        warnings.push({
          type: 'missing_title',
          subtaskId: st.id,
          message: 'Subtask missing title'
        });
      }
    });

    // Check for unreferenced dependencies
    subtasks.forEach(st => {
      const allDeps = [
        ...(st.depends?.requires || []),
        ...(st.depends?.blocks || []),
        ...(st.depends?.related || [])
      ];

      allDeps.forEach(dep => {
        if (!ids.has(dep)) {
          warnings.push({
            type: 'external_dependency',
            subtaskId: st.id,
            dependencyId: dep,
            message: `Dependency ${dep} is external to subtask set`
          });
        }
      });
    });

    return {
      valid: issues.length === 0,
      issues,
      warnings
    };
  }

  estimate(subtasks) {
    const breakdown = subtasks.map(st => ({
      id: st.id,
      title: st.title,
      hours: this._parseEstimate(st.estimate),
      tokens: this._parseEstimate(st.estimate) * DEFAULT_ESTIMATES.tokensPerHour,
      group: st.parallelGroup
    }));

    // Group by parallel group
    const groups = new Map();
    breakdown.forEach(b => {
      const group = b.group !== null ? b.group : b.id;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(b);
    });

    // Calculate time for each group (parallel within group)
    const groupTimes = [];
    groups.forEach(groupItems => {
      const maxInGroup = Math.max(...groupItems.map(b => b.hours));
      groupTimes.push(maxInGroup);
    });

    // Sum group times (sequential between groups)
    const totalTime = groupTimes.reduce((sum, t) => sum + t, 0);
    const totalTokens = breakdown.reduce((sum, b) => sum + b.tokens, 0);
    const sequentialTime = breakdown.reduce((sum, b) => sum + b.hours, 0);

    return {
      totalTime,
      totalTokens,
      criticalPath: totalTime,
      parallelEfficiency: sequentialTime / totalTime,
      breakdown
    };
  }

  _generateSuggestions(task, subtasks) {
    const suggestions = [];

    // Check for very large subtasks
    subtasks.forEach(st => {
      const hours = this._parseEstimate(st.estimate);
      if (hours > 4) {
        suggestions.push({
          type: 'split_large_subtask',
          subtaskId: st.id,
          message: `Consider splitting subtask "${st.title}" (${hours}h) into smaller tasks`
        });
      }
    });

    // Check for missing estimates
    subtasks.forEach(st => {
      if (!st.estimate) {
        suggestions.push({
          type: 'add_estimate',
          subtaskId: st.id,
          message: `Add time estimate for "${st.title}"`
        });
      }
    });

    // Check for all parallel (might benefit from sequencing)
    const allParallel = subtasks.every(st => st.canRunParallel !== false);
    if (allParallel && subtasks.length > 3) {
      suggestions.push({
        type: 'consider_sequencing',
        message: 'All subtasks are parallel. Consider if some should be sequential.'
      });
    }

    // Check for missing acceptance criteria
    subtasks.forEach(st => {
      if (!st.acceptance || st.acceptance.length === 0) {
        suggestions.push({
          type: 'add_acceptance',
          subtaskId: st.id,
          message: `Add acceptance criteria for "${st.title}"`
        });
      }
    });

    return suggestions;
  }

  _checkCompleteness(task, subtasks) {
    const parentHours = this._parseEstimate(task.estimate);
    const subtaskHours = subtasks.reduce((sum, st) => sum + this._parseEstimate(st.estimate), 0);

    // Check if subtasks cover the parent task estimate
    const coverage = subtaskHours / parentHours;

    // Check acceptance criteria coverage
    const parentAcceptance = task.acceptance || [];
    const subtaskAcceptance = subtasks.flatMap(st => st.acceptance || []);

    const acceptanceCoverage = parentAcceptance.length > 0
      ? parentAcceptance.filter(pa =>
          subtaskAcceptance.some(sa =>
            sa.toLowerCase().includes(pa.toLowerCase().substring(0, 20))
          )
        ).length / parentAcceptance.length
      : 1;

    return {
      complete: coverage >= 0.8 && acceptanceCoverage >= 0.5,
      timeCoverage: Math.round(coverage * 100),
      acceptanceCoverage: Math.round(acceptanceCoverage * 100),
      gaps: coverage < 0.8 ? ['Time estimate gap - subtasks may not cover full scope'] : []
    };
  }
}

/**
 * DecompositionStrategies - Factory and utilities for decomposition strategies
 */
class DecompositionStrategies {
  static strategies = {
    parallel: ParallelStrategy,
    sequential: SequentialStrategy,
    hybrid: HybridStrategy,
    manual: ManualStrategy
  };

  /**
   * Get a strategy instance by name
   * @param {string} name - Strategy name
   * @param {Object} config - Strategy configuration
   * @returns {BaseStrategy}
   */
  static getStrategy(name, config = {}) {
    const StrategyClass = this.strategies[name];
    if (!StrategyClass) {
      throw new Error(`Unknown decomposition strategy: ${name}`);
    }
    return new StrategyClass(config);
  }

  /**
   * Auto-select the best strategy for a task
   * @param {Object} task - Task to analyze
   * @returns {{ strategy: string, confidence: number, analysis: Object }}
   */
  static selectStrategy(task) {
    const analyses = {};
    let bestStrategy = 'manual';
    let bestConfidence = 0;

    // Evaluate each strategy
    Object.entries(this.strategies).forEach(([name, StrategyClass]) => {
      if (name === 'manual') return; // Skip manual as it's always applicable

      const strategy = new StrategyClass();
      const result = strategy.canApply(task);
      analyses[name] = result;

      if (result.canApply && result.confidence > bestConfidence) {
        bestConfidence = result.confidence;
        bestStrategy = name;
      }
    });

    // Fall back to manual if no strategy has high confidence
    if (bestConfidence < 0.4) {
      bestStrategy = 'manual';
      bestConfidence = 1.0;
    }

    return {
      strategy: bestStrategy,
      confidence: bestConfidence,
      analysis: analyses
    };
  }

  /**
   * Decompose a task using the specified or auto-selected strategy
   * @param {Object} task - Task to decompose
   * @param {Object} options - Decomposition options
   * @param {string} options.strategy - Strategy name (auto-select if not provided)
   * @returns {{ subtasks: Array, strategy: string, validation: Object, estimate: Object }}
   */
  static decompose(task, options = {}) {
    let strategyName = options.strategy;
    let selectionResult = null;

    // Auto-select strategy if not specified
    if (!strategyName) {
      selectionResult = this.selectStrategy(task);
      strategyName = selectionResult.strategy;
    }

    const strategy = this.getStrategy(strategyName, options.strategyConfig);

    // Perform decomposition
    const decompositionResult = strategy.decompose(task, options);

    // Validate subtasks
    const validation = strategy.validate(decompositionResult.subtasks);

    // Estimate effort
    const estimate = strategy.estimate(decompositionResult.subtasks);

    return {
      subtasks: decompositionResult.subtasks,
      strategy: strategyName,
      strategySelection: selectionResult,
      metadata: decompositionResult.metadata,
      validation,
      estimate
    };
  }

  /**
   * Validate subtasks using the appropriate strategy
   * @param {Array} subtasks - Subtasks to validate
   * @param {string} strategyName - Strategy used
   * @returns {Object} Validation result
   */
  static validate(subtasks, strategyName = 'manual') {
    const strategy = this.getStrategy(strategyName);
    return strategy.validate(subtasks);
  }

  /**
   * Estimate effort for subtasks
   * @param {Array} subtasks - Subtasks to estimate
   * @param {string} strategyName - Strategy used
   * @returns {Object} Estimate result
   */
  static estimate(subtasks, strategyName = 'manual') {
    const strategy = this.getStrategy(strategyName);
    return strategy.estimate(subtasks);
  }
}

module.exports = {
  DecompositionStrategies,
  BaseStrategy,
  ParallelStrategy,
  SequentialStrategy,
  HybridStrategy,
  ManualStrategy,
  DEFAULT_ESTIMATES
};
