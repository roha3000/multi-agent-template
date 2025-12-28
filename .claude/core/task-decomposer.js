/**
 * TaskDecomposer - Analyzes and decomposes complex tasks into subtasks
 *
 * Part of Hierarchy Phase 3 - provides intelligent task decomposition
 * with strategy selection and subtask generation for delegation.
 *
 * @module task-decomposer
 */

const crypto = require('crypto');
const { createComponentLogger } = require('./logger');

const logger = createComponentLogger('TaskDecomposer');

/**
 * Decomposition strategies enum
 */
const DecompositionStrategy = {
  /** Execute all subtasks concurrently */
  PARALLEL: 'parallel',
  /** Execute subtasks one after another in order */
  SEQUENTIAL: 'sequential',
  /** Mix of parallel and sequential based on dependencies */
  HYBRID: 'hybrid',
  /** User must manually decompose */
  MANUAL: 'manual'
};

/**
 * Default configuration for task analysis
 */
const DEFAULT_CONFIG = {
  // Thresholds for auto-decomposition
  complexityThreshold: 50,      // Score above which decomposition is suggested
  effortThresholdHours: 4,      // Effort above which decomposition is suggested
  maxSubtasks: 7,               // Maximum suggested subtasks (Miller's law)
  minSubtasks: 2,               // Minimum for decomposition to make sense

  // Confidence thresholds
  highConfidence: 80,
  mediumConfidence: 50,
  lowConfidence: 30,

  // Keywords that suggest parallel execution
  parallelKeywords: ['independent', 'concurrent', 'parallel', 'simultaneously', 'batch'],

  // Keywords that suggest sequential execution
  sequentialKeywords: ['then', 'after', 'before', 'depends', 'prerequisite', 'first', 'finally'],

  // Capability categories for subtask generation
  capabilityCategories: {
    research: ['analysis', 'investigation', 'evaluation', 'comparison'],
    design: ['architecture', 'specification', 'api-design', 'modeling'],
    implementation: ['coding', 'integration', 'configuration', 'setup'],
    testing: ['unit-testing', 'integration-testing', 'validation', 'verification'],
    documentation: ['docs', 'comments', 'readme', 'api-docs']
  }
};

/**
 * Complexity factors for scoring tasks
 */
const COMPLEXITY_FACTORS = {
  // Description complexity
  descriptionLength: { weight: 0.15, thresholds: [100, 300, 500, 1000] },

  // Technical indicators
  technicalTerms: { weight: 0.20, terms: ['api', 'database', 'async', 'concurrent', 'distributed', 'security', 'performance', 'integration'] },

  // Scope indicators
  scopeIndicators: { weight: 0.20, terms: ['multiple', 'all', 'entire', 'complete', 'full', 'comprehensive'] },

  // Dependency count
  dependencies: { weight: 0.15, thresholds: [0, 2, 4, 6] },

  // Acceptance criteria count
  acceptanceCriteria: { weight: 0.15, thresholds: [1, 3, 5, 8] },

  // Effort estimate
  effort: { weight: 0.15, thresholds: [1, 4, 8, 16] }
};

/**
 * TaskDecomposer class for analyzing and breaking down complex tasks
 */
class TaskDecomposer {
  /**
   * Create a TaskDecomposer instance
   * @param {Object} options - Configuration options
   * @param {Object} [options.taskManager] - TaskManager instance for hierarchy operations
   * @param {Object} [options.config] - Override default configuration
   */
  constructor(options = {}) {
    this.taskManager = options.taskManager || null;
    this.config = { ...DEFAULT_CONFIG, ...options.config };

    // Cache for task analysis results
    this._analysisCache = new Map();
    this._cacheMaxAge = options.cacheMaxAge || 300000; // 5 minutes

    logger.info('TaskDecomposer initialized', {
      complexityThreshold: this.config.complexityThreshold,
      maxSubtasks: this.config.maxSubtasks
    });
  }

  /**
   * Analyze a task and suggest decomposition strategy
   * @param {Object} task - Task object to analyze
   * @returns {DecompositionSuggestion} Analysis result with recommendation
   */
  analyze(task) {
    if (!task) {
      throw new Error('Task is required for analysis');
    }

    const taskId = task.id || 'temp-' + Date.now();

    // Check cache
    const cached = this._getCachedAnalysis(taskId);
    if (cached) {
      logger.debug('Returning cached analysis', { taskId });
      return cached;
    }

    logger.debug('Analyzing task', { taskId, title: task.title });

    try {
      // Calculate complexity score
      const complexityScore = this._calculateComplexity(task);

      // Determine if decomposition is recommended
      const shouldDecompose = this._shouldDecompose(task, complexityScore);

      // Calculate confidence
      const confidence = this._calculateConfidence(task, complexityScore);

      // Suggest strategy
      const suggestedStrategy = this._suggestStrategy(task);

      // Generate subtask outlines if decomposition is recommended
      let suggestedSubtasks = [];
      if (shouldDecompose) {
        suggestedSubtasks = this._generateSubtaskOutlines(task, suggestedStrategy);
      }

      // Build reasoning explanation
      const reasoning = this._buildReasoning(task, complexityScore, shouldDecompose, suggestedStrategy);

      const suggestion = {
        taskId,
        shouldDecompose,
        confidence,
        complexityScore,
        suggestedStrategy,
        suggestedSubtasks,
        reasoning,
        analysisTimestamp: new Date().toISOString(),
        metadata: {
          effortHours: this._parseEffort(task.estimate),
          dependencyCount: (task.depends?.requires?.length || 0) + (task.depends?.blocks?.length || 0),
          acceptanceCriteriaCount: task.acceptance?.length || 0
        }
      };

      // Cache the result
      this._cacheAnalysis(taskId, suggestion);

      logger.info('Task analysis complete', {
        taskId,
        shouldDecompose,
        confidence,
        suggestedStrategy,
        subtaskCount: suggestedSubtasks.length
      });

      return suggestion;

    } catch (error) {
      logger.error('Task analysis failed', { taskId, error: error.message });
      throw error;
    }
  }

  /**
   * Decompose a task into subtasks using specified strategy
   * @param {Object} task - Task to decompose
   * @param {string} strategy - Decomposition strategy (parallel, sequential, hybrid, manual)
   * @param {Object} options - Decomposition options
   * @returns {Array<Object>} Array of subtask objects
   */
  decompose(task, strategy = DecompositionStrategy.HYBRID, options = {}) {
    if (!task) {
      throw new Error('Task is required for decomposition');
    }

    const validStrategies = Object.values(DecompositionStrategy);
    if (!validStrategies.includes(strategy)) {
      throw new Error(`Invalid strategy: ${strategy}. Must be one of: ${validStrategies.join(', ')}`);
    }

    logger.info('Decomposing task', { taskId: task.id, title: task.title, strategy });

    try {
      // Generate subtask outlines
      let subtaskOutlines = this._generateSubtaskOutlines(task, strategy, options);

      // Apply strategy-specific processing
      subtaskOutlines = this._applyStrategy(subtaskOutlines, strategy, task);

      // Pre-generate all subtask IDs so we can reference them in dependencies
      const subtaskIds = subtaskOutlines.map((_, index) =>
        `${task.id || 'task'}-sub-${index + 1}-${crypto.randomBytes(4).toString('hex')}`
      );

      // Build full subtask objects with proper ID references
      const subtasks = subtaskOutlines.map((outline, index) =>
        this._buildSubtask(task, outline, index, strategy, subtaskIds)
      );

      // Validate decomposition
      this._validateDecomposition(task, subtasks);

      logger.info('Task decomposition complete', {
        taskId: task.id,
        strategy,
        subtaskCount: subtasks.length
      });

      return subtasks;

    } catch (error) {
      logger.error('Task decomposition failed', { taskId: task.id, error: error.message });
      throw error;
    }
  }

  /**
   * Create subtasks in TaskManager (if available)
   * @param {Object} parentTask - Parent task
   * @param {Array<Object>} subtasks - Subtasks to create
   * @returns {Array<Object>} Created subtasks
   */
  createSubtasks(parentTask, subtasks) {
    if (!this.taskManager) {
      logger.warn('TaskManager not available, returning subtasks without persistence');
      return subtasks;
    }

    logger.info('Creating subtasks in TaskManager', {
      parentTaskId: parentTask.id,
      subtaskCount: subtasks.length
    });

    const createdSubtasks = [];

    for (const subtask of subtasks) {
      try {
        const created = this.taskManager.createSubtask(parentTask.id, subtask);
        createdSubtasks.push(created);
      } catch (error) {
        logger.error('Failed to create subtask', {
          parentTaskId: parentTask.id,
          subtaskTitle: subtask.title,
          error: error.message
        });
        // Continue with other subtasks
      }
    }

    // Set decomposition metadata on parent
    if (createdSubtasks.length > 0) {
      this.taskManager.setDecomposition(parentTask.id, {
        strategy: subtasks[0]?.decompositionStrategy || 'manual',
        estimatedSubtasks: subtasks.length,
        completedSubtasks: 0,
        aggregationRule: 'average'
      });
    }

    return createdSubtasks;
  }

  // ============================================
  // Complexity Calculation Methods
  // ============================================

  /**
   * Calculate overall complexity score for a task
   * @private
   * @param {Object} task - Task to analyze
   * @returns {number} Complexity score (0-100)
   */
  _calculateComplexity(task) {
    let score = 0;

    // Description complexity
    const descLength = (task.description || '').length + (task.title || '').length;
    score += this._scoreByThresholds(descLength, COMPLEXITY_FACTORS.descriptionLength);

    // Technical terms
    const text = `${task.title || ''} ${task.description || ''}`.toLowerCase();
    const techTermCount = COMPLEXITY_FACTORS.technicalTerms.terms.filter(t => text.includes(t)).length;
    score += (techTermCount / COMPLEXITY_FACTORS.technicalTerms.terms.length) *
             COMPLEXITY_FACTORS.technicalTerms.weight * 100;

    // Scope indicators
    const scopeCount = COMPLEXITY_FACTORS.scopeIndicators.terms.filter(t => text.includes(t)).length;
    score += (scopeCount / COMPLEXITY_FACTORS.scopeIndicators.terms.length) *
             COMPLEXITY_FACTORS.scopeIndicators.weight * 100;

    // Dependencies
    const depCount = (task.depends?.requires?.length || 0) + (task.depends?.blocks?.length || 0);
    score += this._scoreByThresholds(depCount, COMPLEXITY_FACTORS.dependencies);

    // Acceptance criteria
    const criteriaCount = task.acceptance?.length || 0;
    score += this._scoreByThresholds(criteriaCount, COMPLEXITY_FACTORS.acceptanceCriteria);

    // Effort
    const effortHours = this._parseEffort(task.estimate);
    score += this._scoreByThresholds(effortHours, COMPLEXITY_FACTORS.effort);

    return Math.min(100, Math.round(score));
  }

  /**
   * Score a value based on thresholds
   * @private
   */
  _scoreByThresholds(value, factor) {
    const { weight, thresholds } = factor;
    let level = 0;

    for (let i = 0; i < thresholds.length; i++) {
      if (value >= thresholds[i]) level = i + 1;
    }

    return (level / thresholds.length) * weight * 100;
  }

  // ============================================
  // Strategy Determination Methods
  // ============================================

  /**
   * Determine if task should be decomposed
   * @private
   */
  _shouldDecompose(task, complexityScore) {
    // Already has children - don't decompose further
    if (task.childTaskIds && task.childTaskIds.length > 0) {
      return false;
    }

    // High complexity
    if (complexityScore >= this.config.complexityThreshold) {
      return true;
    }

    // Large effort estimate
    const effortHours = this._parseEffort(task.estimate);
    if (effortHours >= this.config.effortThresholdHours) {
      return true;
    }

    // Multiple acceptance criteria
    if (task.acceptance && task.acceptance.length >= 5) {
      return true;
    }

    // Contains explicit decomposition hints
    const text = `${task.title || ''} ${task.description || ''}`.toLowerCase();
    const decompHints = ['steps', 'phases', 'parts', 'components', 'modules'];
    if (decompHints.some(hint => text.includes(hint))) {
      return true;
    }

    return false;
  }

  /**
   * Calculate confidence in the analysis
   * @private
   */
  _calculateConfidence(task, complexityScore) {
    let confidence = 50; // Base confidence

    // More data points = higher confidence
    if (task.description && task.description.length > 100) confidence += 10;
    if (task.acceptance && task.acceptance.length > 0) confidence += 10;
    if (task.estimate) confidence += 5;
    if (task.tags && task.tags.length > 0) confidence += 5;

    // Extreme complexity scores = higher confidence in recommendation
    if (complexityScore > 80 || complexityScore < 20) confidence += 10;

    // Phase information helps
    if (task.phase) confidence += 5;

    // Dependencies provide context
    if (task.depends?.requires?.length > 0) confidence += 5;

    return Math.min(100, confidence);
  }

  /**
   * Suggest best decomposition strategy
   * @private
   */
  _suggestStrategy(task) {
    const text = `${task.title || ''} ${task.description || ''}`.toLowerCase();

    // Count strategy indicators
    let parallelScore = 0;
    let sequentialScore = 0;

    for (const keyword of this.config.parallelKeywords) {
      if (text.includes(keyword)) parallelScore++;
    }

    for (const keyword of this.config.sequentialKeywords) {
      if (text.includes(keyword)) sequentialScore++;
    }

    // Check dependencies
    const hasRequirements = task.depends?.requires?.length > 0;
    const hasBlockers = task.depends?.blocks?.length > 0;

    if (hasRequirements || hasBlockers) {
      sequentialScore += 2;
    }

    // Determine strategy
    if (parallelScore > sequentialScore && parallelScore > 0) {
      return DecompositionStrategy.PARALLEL;
    }

    if (sequentialScore > parallelScore && sequentialScore > 0) {
      return DecompositionStrategy.SEQUENTIAL;
    }

    // Default to hybrid for complex tasks
    if (parallelScore > 0 && sequentialScore > 0) {
      return DecompositionStrategy.HYBRID;
    }

    // If no strong signals, use HYBRID for flexibility
    return DecompositionStrategy.HYBRID;
  }

  // ============================================
  // Subtask Generation Methods
  // ============================================

  /**
   * Generate subtask outlines from task analysis
   * @private
   */
  _generateSubtaskOutlines(task, strategy, options = {}) {
    const outlines = [];
    const text = `${task.title || ''} ${task.description || ''}`.toLowerCase();

    // Strategy 1: Extract from acceptance criteria
    if (task.acceptance && task.acceptance.length >= this.config.minSubtasks) {
      const criteriaSubtasks = this._generateFromAcceptanceCriteria(task);
      outlines.push(...criteriaSubtasks);
    }

    // Strategy 2: Extract from description patterns
    const descriptionSubtasks = this._generateFromDescription(task);
    outlines.push(...descriptionSubtasks);

    // Strategy 3: Phase-based decomposition
    if (outlines.length < this.config.minSubtasks) {
      const phaseSubtasks = this._generateFromPhase(task);
      outlines.push(...phaseSubtasks);
    }

    // Strategy 4: Capability-based decomposition
    if (outlines.length < this.config.minSubtasks) {
      const capabilitySubtasks = this._generateFromCapabilities(task);
      outlines.push(...capabilitySubtasks);
    }

    // Remove duplicates and limit count
    const uniqueOutlines = this._deduplicateOutlines(outlines);
    const limitedOutlines = uniqueOutlines.slice(0, this.config.maxSubtasks);

    return limitedOutlines;
  }

  /**
   * Generate subtasks from acceptance criteria
   * @private
   */
  _generateFromAcceptanceCriteria(task) {
    if (!task.acceptance || task.acceptance.length === 0) return [];

    return task.acceptance.slice(0, this.config.maxSubtasks).map((criterion, index) => ({
      title: this._extractTitle(criterion, 50),
      description: criterion,
      source: 'acceptance-criteria',
      order: index,
      estimatedEffort: this._estimateSubtaskEffort(task, task.acceptance.length)
    }));
  }

  /**
   * Generate subtasks from description patterns
   * @private
   */
  _generateFromDescription(task) {
    if (!task.description) return [];

    const outlines = [];
    const description = task.description;

    // Pattern 1: Numbered lists (1. 2. 3. or 1) 2) 3))
    const numberedPattern = /(?:^|\n)\s*(\d+)[.)]\s*([^\n]+)/g;
    let match;
    while ((match = numberedPattern.exec(description)) !== null) {
      outlines.push({
        title: this._extractTitle(match[2], 50),
        description: match[2].trim(),
        source: 'numbered-list',
        order: parseInt(match[1], 10) - 1,
        estimatedEffort: '1h'
      });
    }

    // Pattern 2: Bullet points
    const bulletPattern = /(?:^|\n)\s*[-*]\s+([^\n]+)/g;
    while ((match = bulletPattern.exec(description)) !== null) {
      outlines.push({
        title: this._extractTitle(match[1], 50),
        description: match[1].trim(),
        source: 'bullet-point',
        order: outlines.length,
        estimatedEffort: '1h'
      });
    }

    // Pattern 3: Action verbs at sentence start
    const actionPattern = /(?:^|\.\s+)((?:implement|create|build|add|update|fix|test|validate|configure|setup|design|refactor|optimize|document)\s+[^.]+)/gi;
    while ((match = actionPattern.exec(description)) !== null) {
      outlines.push({
        title: this._extractTitle(match[1], 50),
        description: match[1].trim(),
        source: 'action-verb',
        order: outlines.length,
        estimatedEffort: '2h'
      });
    }

    return outlines;
  }

  /**
   * Generate subtasks based on development phase
   * @private
   */
  _generateFromPhase(task) {
    const phase = task.phase || 'implementation';
    const phaseTemplates = {
      research: [
        { title: 'Gather requirements', description: 'Collect and document all requirements', estimatedEffort: '2h' },
        { title: 'Research approaches', description: 'Investigate potential solutions', estimatedEffort: '3h' },
        { title: 'Evaluate options', description: 'Compare and contrast approaches', estimatedEffort: '2h' },
        { title: 'Document findings', description: 'Write up research conclusions', estimatedEffort: '1h' }
      ],
      planning: [
        { title: 'Define scope', description: 'Clearly outline project boundaries', estimatedEffort: '1h' },
        { title: 'Create timeline', description: 'Establish milestones and deadlines', estimatedEffort: '1h' },
        { title: 'Identify resources', description: 'Determine required resources', estimatedEffort: '1h' },
        { title: 'Risk assessment', description: 'Identify and plan for risks', estimatedEffort: '1h' }
      ],
      design: [
        { title: 'Design architecture', description: 'Create high-level system design', estimatedEffort: '3h' },
        { title: 'Define interfaces', description: 'Specify API contracts and interfaces', estimatedEffort: '2h' },
        { title: 'Design data model', description: 'Create data structures and schemas', estimatedEffort: '2h' },
        { title: 'Review design', description: 'Validate design decisions', estimatedEffort: '1h' }
      ],
      implementation: [
        { title: 'Setup environment', description: 'Prepare development environment', estimatedEffort: '1h' },
        { title: 'Implement core logic', description: 'Build main functionality', estimatedEffort: '4h' },
        { title: 'Add error handling', description: 'Implement error handling and edge cases', estimatedEffort: '2h' },
        { title: 'Integration', description: 'Connect with existing systems', estimatedEffort: '2h' }
      ],
      testing: [
        { title: 'Write unit tests', description: 'Create unit test coverage', estimatedEffort: '2h' },
        { title: 'Integration tests', description: 'Test component interactions', estimatedEffort: '2h' },
        { title: 'Manual testing', description: 'Perform manual verification', estimatedEffort: '1h' },
        { title: 'Fix issues', description: 'Address any found issues', estimatedEffort: '2h' }
      ],
      validation: [
        { title: 'Code review', description: 'Review code quality', estimatedEffort: '1h' },
        { title: 'Quality gates', description: 'Verify quality standards', estimatedEffort: '1h' },
        { title: 'Documentation review', description: 'Check documentation completeness', estimatedEffort: '1h' },
        { title: 'Sign-off', description: 'Final approval', estimatedEffort: '30m' }
      ]
    };

    const templates = phaseTemplates[phase] || phaseTemplates.implementation;

    return templates.map((t, index) => ({
      ...t,
      source: 'phase-template',
      order: index
    }));
  }

  /**
   * Generate subtasks from required capabilities
   * @private
   */
  _generateFromCapabilities(task) {
    const text = `${task.title || ''} ${task.description || ''}`.toLowerCase();
    const outlines = [];

    for (const [category, capabilities] of Object.entries(this.config.capabilityCategories)) {
      for (const capability of capabilities) {
        if (text.includes(capability.replace('-', ' '))) {
          outlines.push({
            title: `${category.charAt(0).toUpperCase() + category.slice(1)}: ${capability}`,
            description: `Perform ${capability} activities`,
            source: 'capability',
            requiredCapabilities: [capability],
            estimatedEffort: '2h',
            order: outlines.length
          });
        }
      }
    }

    return outlines;
  }

  // ============================================
  // Subtask Building Methods
  // ============================================

  /**
   * Build a complete subtask object from outline
   * @private
   * @param {Object} parentTask - Parent task
   * @param {Object} outline - Subtask outline
   * @param {number} index - Index in subtask array
   * @param {string} strategy - Decomposition strategy
   * @param {Array<string>} allSubtaskIds - Pre-generated IDs for all subtasks
   */
  _buildSubtask(parentTask, outline, index, strategy, allSubtaskIds = []) {
    // Use pre-generated ID if available, otherwise generate new one
    const id = allSubtaskIds[index] || `${parentTask.id || 'task'}-sub-${index + 1}-${crypto.randomBytes(4).toString('hex')}`;

    // Calculate dependencies based on strategy, passing all IDs for proper references
    const dependencies = this._calculateSubtaskDependencies(parentTask, index, strategy, outline, allSubtaskIds);

    return {
      id,
      title: outline.title || `Subtask ${index + 1}`,
      description: outline.description || '',
      estimatedEffort: outline.estimatedEffort || this._estimateSubtaskEffort(parentTask, this.config.maxSubtasks),
      requiredCapabilities: outline.requiredCapabilities || this._inferCapabilities(outline),
      dependencies,
      phase: parentTask.phase,
      priority: parentTask.priority || 'medium',
      tags: [...(parentTask.tags || []), 'auto-decomposed'],
      acceptance: outline.acceptance || [],
      decompositionStrategy: strategy,
      decompositionSource: outline.source || 'auto',
      order: outline.order ?? index
    };
  }

  /**
   * Calculate dependencies for a subtask based on strategy
   * @private
   * @param {Object} parentTask - Parent task
   * @param {number} index - Subtask index
   * @param {string} strategy - Decomposition strategy
   * @param {Object} outline - Subtask outline
   * @param {Array<string>} allSubtaskIds - Pre-generated IDs for all subtasks
   */
  _calculateSubtaskDependencies(parentTask, index, strategy, outline, allSubtaskIds = []) {
    const dependencies = {
      blocks: [],
      requires: [],
      related: []
    };

    switch (strategy) {
      case DecompositionStrategy.SEQUENTIAL:
        // Each task requires the previous one (using actual pre-generated ID)
        if (index > 0 && allSubtaskIds[index - 1]) {
          dependencies.requires.push(allSubtaskIds[index - 1]);
        }
        break;

      case DecompositionStrategy.PARALLEL:
        // No inter-subtask dependencies
        break;

      case DecompositionStrategy.HYBRID:
        // Group tasks by source and create dependencies within groups
        // For now, create minimal sequential dependencies for numbered lists
        if (index > 0 && outline.source === 'numbered-list' && allSubtaskIds[index - 1]) {
          dependencies.requires.push(allSubtaskIds[index - 1]);
        }
        break;

      case DecompositionStrategy.MANUAL:
        // No auto-generated dependencies
        break;
    }

    // Inherit parent's blocking relationships
    if (parentTask.depends?.blocks) {
      dependencies.related.push(...parentTask.depends.blocks);
    }

    return dependencies;
  }

  /**
   * Infer required capabilities from outline
   * @private
   */
  _inferCapabilities(outline) {
    const text = `${outline.title || ''} ${outline.description || ''}`.toLowerCase();
    const capabilities = [];

    for (const [category, caps] of Object.entries(this.config.capabilityCategories)) {
      for (const cap of caps) {
        if (text.includes(cap.replace('-', ' '))) {
          capabilities.push(cap);
        }
      }
    }

    return capabilities.length > 0 ? capabilities : ['general'];
  }

  /**
   * Apply strategy-specific processing to subtasks
   * @private
   */
  _applyStrategy(outlines, strategy, parentTask) {
    switch (strategy) {
      case DecompositionStrategy.SEQUENTIAL:
        // Ensure proper ordering
        return outlines.sort((a, b) => (a.order || 0) - (b.order || 0));

      case DecompositionStrategy.PARALLEL:
        // Randomize order (no dependencies)
        return outlines.map(o => ({ ...o, order: 0 }));

      case DecompositionStrategy.HYBRID:
        // Group by source, sequence within groups
        const groups = {};
        outlines.forEach(o => {
          const source = o.source || 'other';
          if (!groups[source]) groups[source] = [];
          groups[source].push(o);
        });

        let order = 0;
        const result = [];
        for (const group of Object.values(groups)) {
          group.sort((a, b) => (a.order || 0) - (b.order || 0));
          group.forEach(o => {
            result.push({ ...o, order: order++ });
          });
        }
        return result;

      case DecompositionStrategy.MANUAL:
      default:
        return outlines;
    }
  }

  // ============================================
  // Validation Methods
  // ============================================

  /**
   * Validate the decomposition results
   * @private
   */
  _validateDecomposition(parentTask, subtasks) {
    if (subtasks.length < this.config.minSubtasks) {
      logger.warn('Decomposition produced fewer than minimum subtasks', {
        taskId: parentTask.id,
        subtaskCount: subtasks.length,
        minimum: this.config.minSubtasks
      });
    }

    // Check for circular dependencies
    const ids = new Set(subtasks.map(s => s.id));
    for (const subtask of subtasks) {
      for (const req of subtask.dependencies?.requires || []) {
        if (!ids.has(req) && req !== parentTask.id) {
          logger.warn('Subtask has external dependency', {
            subtaskId: subtask.id,
            dependency: req
          });
        }
      }
    }

    // Ensure total effort is reasonable
    const totalEffort = subtasks.reduce((sum, s) => sum + this._parseEffort(s.estimatedEffort), 0);
    const parentEffort = this._parseEffort(parentTask.estimate);

    if (totalEffort > parentEffort * 2) {
      logger.warn('Subtask total effort exceeds parent estimate significantly', {
        taskId: parentTask.id,
        parentEffort,
        totalSubtaskEffort: totalEffort
      });
    }
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Extract a title from text
   * @private
   */
  _extractTitle(text, maxLength = 50) {
    if (!text) return 'Untitled';

    // Clean up and truncate
    let title = text.trim().replace(/\s+/g, ' ');

    // Capitalize first letter
    title = title.charAt(0).toUpperCase() + title.slice(1);

    // Truncate if needed
    if (title.length > maxLength) {
      title = title.substring(0, maxLength - 3) + '...';
    }

    return title;
  }

  /**
   * Parse effort estimate string to hours
   * @private
   */
  _parseEffort(estimate) {
    if (!estimate) return 4; // Default 4 hours
    if (typeof estimate === 'number') return estimate;

    const match = String(estimate).match(/(\d+\.?\d*)\s*(h|hour|hours|d|day|days|m|min|mins)?/i);
    if (!match) return 4;

    const value = parseFloat(match[1]);
    const unit = match[2]?.toLowerCase();

    if (unit?.startsWith('d')) return value * 8;
    if (unit?.startsWith('m')) return value / 60;
    return value;
  }

  /**
   * Estimate subtask effort based on parent
   * @private
   */
  _estimateSubtaskEffort(parentTask, subtaskCount) {
    const parentEffort = this._parseEffort(parentTask.estimate);
    const subtaskEffort = Math.max(0.5, parentEffort / Math.max(1, subtaskCount));

    if (subtaskEffort < 1) return `${Math.round(subtaskEffort * 60)}m`;
    return `${Math.round(subtaskEffort)}h`;
  }

  /**
   * Build reasoning explanation
   * @private
   */
  _buildReasoning(task, complexityScore, shouldDecompose, strategy) {
    const reasons = [];

    if (complexityScore >= this.config.complexityThreshold) {
      reasons.push(`High complexity score (${complexityScore}/100) exceeds threshold (${this.config.complexityThreshold})`);
    }

    const effortHours = this._parseEffort(task.estimate);
    if (effortHours >= this.config.effortThresholdHours) {
      reasons.push(`Large effort estimate (${effortHours}h) exceeds threshold (${this.config.effortThresholdHours}h)`);
    }

    if (task.acceptance && task.acceptance.length >= 5) {
      reasons.push(`Multiple acceptance criteria (${task.acceptance.length}) suggest complex requirements`);
    }

    if (task.depends?.requires?.length > 0) {
      reasons.push(`Task has ${task.depends.requires.length} upstream dependencies`);
    }

    if (!shouldDecompose) {
      reasons.push('Task appears simple enough to complete atomically');
    }

    reasons.push(`Suggested strategy: ${strategy} based on task structure and keywords`);

    return reasons.join('. ');
  }

  /**
   * Deduplicate subtask outlines
   * @private
   */
  _deduplicateOutlines(outlines) {
    const seen = new Set();
    return outlines.filter(outline => {
      const key = `${outline.title}|${outline.description}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Get cached analysis result
   * @private
   */
  _getCachedAnalysis(taskId) {
    const cached = this._analysisCache.get(taskId);
    if (!cached) return null;

    const age = Date.now() - new Date(cached.analysisTimestamp).getTime();
    if (age > this._cacheMaxAge) {
      this._analysisCache.delete(taskId);
      return null;
    }

    return cached;
  }

  /**
   * Cache analysis result
   * @private
   */
  _cacheAnalysis(taskId, result) {
    this._analysisCache.set(taskId, result);

    // Clean old cache entries periodically
    if (this._analysisCache.size > 100) {
      const now = Date.now();
      for (const [key, value] of this._analysisCache.entries()) {
        if (now - new Date(value.analysisTimestamp).getTime() > this._cacheMaxAge) {
          this._analysisCache.delete(key);
        }
      }
    }
  }

  /**
   * Clear analysis cache
   */
  clearCache() {
    this._analysisCache.clear();
    logger.debug('Analysis cache cleared');
  }

  /**
   * Get decomposer statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      cacheSize: this._analysisCache.size,
      config: {
        complexityThreshold: this.config.complexityThreshold,
        effortThresholdHours: this.config.effortThresholdHours,
        maxSubtasks: this.config.maxSubtasks
      }
    };
  }
}

module.exports = {
  TaskDecomposer,
  DecompositionStrategy,
  DEFAULT_CONFIG,
  COMPLEXITY_FACTORS
};
