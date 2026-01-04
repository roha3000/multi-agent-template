/**
 * Delegation Bridge - Fast hook integration for DelegationDecider
 *
 * Provides a lightweight interface for hooks to access delegation
 * analysis without loading the full DelegationDecider overhead.
 *
 * Phase 2 Enhancements:
 * - Full DelegationDecider integration for complex prompts
 * - TaskDecomposer integration for subtask generation
 * - Per-task delegationConfig from tasks.json
 * - Decision caching for repeated prompts
 *
 * Design goals:
 * - < 200ms hook execution time
 * - No external dependencies beyond core modules
 * - Graceful degradation on errors
 * - Configurable via delegation-config.json
 *
 * @module core/delegation-bridge
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CONFIG_PATH = path.join(PROJECT_ROOT, '.claude/delegation-config.json');
const TASKS_JSON = path.join(PROJECT_ROOT, '.claude/dev-docs/tasks.json');

/**
 * Default configuration for delegation analysis
 */
const DEFAULT_CONFIG = {
  enabled: true,
  showHints: true,
  minComplexityThreshold: 35, // Lowered from 50 to catch more technical prompts
  minSubtaskCount: 3,
  quickAnalysisOnly: false, // Phase 2: Enable full DelegationDecider
  useTaskDecomposer: true,  // Phase 2: Enable TaskDecomposer
  cacheEnabled: true,       // Phase 2: Enable decision caching
  cacheMaxAge: 60000,       // 1 minute cache TTL
  debugMode: false
};

/**
 * Decision cache for repeated prompts
 * Key: prompt hash, Value: { decision, timestamp }
 */
const _decisionCache = new Map();

/**
 * Lazy-loaded module references
 */
let _delegationDecider = null;
let _taskDecomposer = null;
let _loadAttempted = false;

/**
 * Load configuration from file or return defaults
 * @returns {Object} Configuration object
 */
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const content = fs.readFileSync(CONFIG_PATH, 'utf8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
    }
  } catch (error) {
    // Silent fail, use defaults
  }
  return DEFAULT_CONFIG;
}

/**
 * Save configuration to file
 * @param {Object} config - Configuration to save
 */
function saveConfig(config) {
  try {
    const dirPath = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Generate a hash for prompt caching
 * @param {string} prompt - Prompt text
 * @returns {string} Hash of the prompt
 */
function hashPrompt(prompt) {
  return crypto.createHash('md5').update(prompt).digest('hex');
}

/**
 * Get cached decision for a prompt
 * @param {string} prompt - Prompt text
 * @param {Object} config - Current configuration
 * @returns {Object|null} Cached decision or null
 */
function getCachedDecision(prompt, config) {
  if (!config.cacheEnabled) return null;

  const hash = hashPrompt(prompt);
  const cached = _decisionCache.get(hash);

  if (!cached) return null;

  const age = Date.now() - cached.timestamp;
  if (age > config.cacheMaxAge) {
    _decisionCache.delete(hash);
    return null;
  }

  return cached.decision;
}

/**
 * Cache a decision for a prompt
 * @param {string} prompt - Prompt text
 * @param {Object} decision - Decision to cache
 * @param {Object} config - Current configuration
 */
function cacheDecision(prompt, decision, config) {
  if (!config.cacheEnabled) return;

  const hash = hashPrompt(prompt);
  _decisionCache.set(hash, {
    decision,
    timestamp: Date.now()
  });

  // Cleanup old entries if cache is getting large
  if (_decisionCache.size > 100) {
    const now = Date.now();
    for (const [key, value] of _decisionCache.entries()) {
      if (now - value.timestamp > config.cacheMaxAge) {
        _decisionCache.delete(key);
      }
    }
  }
}

/**
 * Clear the decision cache
 */
function clearCache() {
  _decisionCache.clear();
}

/**
 * Get cache statistics
 * @returns {Object} Cache stats
 */
function getCacheStats() {
  return {
    size: _decisionCache.size,
    entries: Array.from(_decisionCache.keys()).slice(0, 5)
  };
}

/**
 * Lazy load the full DelegationDecider module
 * @returns {Object|null} DelegationDecider instance or null
 */
function loadDelegationDecider() {
  if (_loadAttempted && !_delegationDecider) {
    return null;
  }

  if (_delegationDecider) {
    return _delegationDecider;
  }

  _loadAttempted = true;

  try {
    const { DelegationDecider } = require('./delegation-decider');
    const { TaskDecomposer } = require('./task-decomposer');

    // Create TaskDecomposer first
    _taskDecomposer = new TaskDecomposer();

    // Create DelegationDecider with TaskDecomposer
    _delegationDecider = new DelegationDecider({
      taskDecomposer: _taskDecomposer
    });

    return _delegationDecider;
  } catch (error) {
    // Silent fail - continue with quick analysis
    return null;
  }
}

/**
 * Get the TaskDecomposer instance
 * @returns {Object|null} TaskDecomposer instance or null
 */
function getTaskDecomposer() {
  if (!_loadAttempted) {
    loadDelegationDecider();
  }
  return _taskDecomposer;
}

/**
 * Quick complexity estimation without loading full modules
 * Matches DelegationDecider._estimateComplexity logic
 *
 * @param {string} prompt - User prompt text
 * @returns {number} Complexity score 0-100
 */
function estimateComplexity(prompt) {
  let score = 0;
  const text = prompt.toLowerCase();
  const length = prompt.length;

  // Length scoring
  if (length > 500) score += 20;
  else if (length > 200) score += 10;
  else if (length > 50) score += 5;

  // Technical terms (expanded list for better detection)
  const techTerms = [
    'api', 'database', 'async', 'concurrent', 'distributed',
    'security', 'performance', 'integration', 'architecture',
    'refactor', 'migrate', 'implement', 'design', 'optimize',
    'authentication', 'authorization', 'testing', 'deployment',
    'infrastructure', 'backend', 'frontend', 'fullstack',
    'microservice', 'component', 'module', 'service', 'endpoint',
    'schema', 'model', 'controller', 'middleware', 'validation',
    'documentation', 'configuration', 'feature', 'system'
  ];
  const techCount = techTerms.filter(t => text.includes(t)).length;
  score += Math.min(30, techCount * 5); // Increased cap from 25 to 30

  // Scope indicators
  const scopeTerms = ['multiple', 'all', 'entire', 'complete', 'full', 'comprehensive', 'across'];
  const scopeCount = scopeTerms.filter(t => text.includes(t)).length;
  score += Math.min(15, scopeCount * 5);

  // Multi-step indicators
  const multiStepTerms = ['and then', 'also', 'additionally', 'furthermore', 'as well'];
  const stepCount = multiStepTerms.filter(t => text.includes(t)).length;
  score += Math.min(15, stepCount * 5);

  // Question complexity (questions are usually simpler)
  if (text.startsWith('what') || text.startsWith('how') || text.startsWith('why')) {
    score = Math.max(0, score - 10);
  }

  // Single word or very short prompts
  if (length < 20) {
    score = Math.min(score, 20);
  }

  return Math.min(100, score);
}

/**
 * Estimate potential subtask count from prompt
 *
 * @param {string} prompt - User prompt text
 * @returns {number} Estimated subtask count
 */
function estimateSubtaskCount(prompt) {
  let count = 0;

  // Count numbered items
  const numberedPattern = /(?:^|\n)\s*\d+[.)]/g;
  const numberedMatches = prompt.match(numberedPattern);
  if (numberedMatches) count += numberedMatches.length;

  // Count bullet points
  const bulletPattern = /(?:^|\n)\s*[-*]\s+/g;
  const bulletMatches = prompt.match(bulletPattern);
  if (bulletMatches) count += bulletMatches.length;

  // Count "and"/"then" connectors suggesting multiple actions
  const text = prompt.toLowerCase();
  const connectorMatches = (text.match(/\band\b/g) || []).length;
  const thenMatches = (text.match(/\bthen\b/g) || []).length;

  // Each connector suggests ~0.5 extra subtasks
  count += Math.floor((connectorMatches + thenMatches) * 0.5);

  // Minimum of 1 if prompt exists
  return Math.max(1, count);
}

/**
 * Check if prompt matches a known task from tasks.json
 * Phase 2: Enhanced with per-task delegationConfig support
 *
 * @param {string} prompt - User prompt text
 * @returns {Object|null} Matched task or null, with delegationConfig if present
 */
function matchKnownTask(prompt) {
  try {
    if (!fs.existsSync(TASKS_JSON)) {
      return null;
    }

    const data = JSON.parse(fs.readFileSync(TASKS_JSON, 'utf8'));
    const tasks = data.tasks || {};
    const promptLower = prompt.toLowerCase();

    // Check NOW queue first (higher priority)
    const nowTasks = data.backlog?.now?.tasks || [];

    for (const taskId of nowTasks) {
      const task = tasks[taskId];
      if (!task) continue;

      const titleLower = (task.title || '').toLowerCase();

      // Check for title match
      if (promptLower.includes(titleLower) || titleLower.includes(promptLower.substring(0, 30))) {
        return enrichTaskWithDelegationConfig(task, 'title', 'high');
      }

      // Check for ID match
      if (promptLower.includes(taskId.toLowerCase())) {
        return enrichTaskWithDelegationConfig(task, 'id', 'high');
      }
    }

    // Check NEXT queue
    const nextTasks = data.backlog?.next?.tasks || [];
    for (const taskId of nextTasks) {
      const task = tasks[taskId];
      if (!task) continue;

      if (promptLower.includes(taskId.toLowerCase())) {
        return enrichTaskWithDelegationConfig(task, 'id', 'medium');
      }
    }

    // Check all tasks for keyword matches
    for (const [taskId, task] of Object.entries(tasks)) {
      if (task.status === 'completed') continue;

      const titleWords = (task.title || '').toLowerCase().split(/\s+/);
      const matchedWords = titleWords.filter(w => w.length > 4 && promptLower.includes(w));

      if (matchedWords.length >= 2) {
        return enrichTaskWithDelegationConfig(task, 'keywords', 'medium', matchedWords);
      }

      // Also check tags
      if (task.tags) {
        const matchedTags = task.tags.filter(tag => promptLower.includes(tag.toLowerCase()));
        if (matchedTags.length >= 2) {
          return enrichTaskWithDelegationConfig(task, 'tags', 'low', matchedTags);
        }
      }
    }
  } catch (error) {
    // Silent fail
  }

  return null;
}

/**
 * Enrich a matched task with delegation configuration
 * Per-task config overrides global settings
 *
 * @param {Object} task - Matched task
 * @param {string} matchType - How the task was matched
 * @param {string} matchStrength - Match confidence
 * @param {Array} matchedItems - Items that matched (words, tags)
 * @returns {Object} Enriched task with delegation config
 */
function enrichTaskWithDelegationConfig(task, matchType, matchStrength, matchedItems = null) {
  const result = {
    ...task,
    matchType,
    matchStrength
  };

  if (matchedItems) {
    result.matchedItems = matchedItems;
  }

  // Check for per-task delegationConfig
  if (task.delegationConfig) {
    result.delegationConfig = task.delegationConfig;
  } else {
    // Infer delegation config from task properties
    result.delegationConfig = inferDelegationConfig(task);
  }

  return result;
}

/**
 * Infer delegation configuration from task properties
 *
 * @param {Object} task - Task to analyze
 * @returns {Object} Inferred delegation config
 */
function inferDelegationConfig(task) {
  const config = {
    shouldDelegate: false,
    pattern: 'direct',
    priority: 'normal'
  };

  // Check if task has child tasks (already decomposed)
  if (task.childTaskIds && task.childTaskIds.length > 0) {
    config.shouldDelegate = true;
    config.pattern = task.decomposition || 'sequential';
    config.subtaskIds = task.childTaskIds;
  }

  // Parse effort estimate
  const effort = parseEffortHours(task.estimate);
  if (effort >= 4) {
    config.shouldDelegate = true;
    config.priority = effort >= 8 ? 'high' : 'normal';
  }

  // Check acceptance criteria count
  if (task.acceptance && task.acceptance.length >= 4) {
    config.shouldDelegate = true;
    config.pattern = 'parallel';
  }

  // Check for explicit delegation hints in description
  const text = `${task.title || ''} ${task.description || ''}`.toLowerCase();
  if (text.includes('parallel') || text.includes('concurrent')) {
    config.pattern = 'parallel';
  } else if (text.includes('sequential') || text.includes('step by step')) {
    config.pattern = 'sequential';
  }

  // Priority indicators
  if (task.priority === 'critical' || task.priority === 'high') {
    config.priority = 'high';
  }

  return config;
}

/**
 * Parse effort estimate to hours
 * @param {string|number} estimate - Effort estimate
 * @returns {number} Hours
 */
function parseEffortHours(estimate) {
  if (!estimate) return 2;
  if (typeof estimate === 'number') return estimate;

  const match = String(estimate).match(/(\d+\.?\d*)\s*(h|hour|hours|d|day|days|m|min|mins)?/i);
  if (!match) return 2;

  const value = parseFloat(match[1]);
  const unit = match[2]?.toLowerCase();

  if (unit?.startsWith('d')) return value * 8;
  if (unit?.startsWith('m')) return value / 60;
  return value;
}

/**
 * Determine suggested execution pattern
 *
 * @param {string} prompt - User prompt text
 * @param {number} subtaskCount - Estimated subtask count
 * @returns {string} Pattern name
 */
function suggestPattern(prompt, subtaskCount) {
  const text = prompt.toLowerCase();

  // Check for explicit pattern indicators
  if (text.includes('parallel') || text.includes('concurrent') || text.includes('simultaneously')) {
    return 'parallel';
  }
  if (text.includes('then') || text.includes('after') || text.includes('first') || text.includes('finally')) {
    return 'sequential';
  }
  if (text.includes('compare') || text.includes('debate') || text.includes('options')) {
    return 'debate';
  }
  if (text.includes('review') || text.includes('critique') || text.includes('check')) {
    return 'review';
  }

  // Default based on subtask count
  if (subtaskCount >= 3) {
    return 'parallel';
  }

  return 'direct';
}

/**
 * Generate quick delegation hint for a prompt
 * This is the main function called by the hook
 *
 * Phase 2 enhancements:
 * - Uses full DelegationDecider for complex prompts
 * - Caches decisions for repeated prompts
 * - Includes per-task delegationConfig
 *
 * @param {string} prompt - User prompt text
 * @param {Object} options - Additional options
 * @returns {Object} Delegation analysis result
 */
function getQuickHint(prompt, options = {}) {
  const startTime = Date.now();
  const config = loadConfig();

  // Early exit if disabled
  if (!config.enabled) {
    return {
      enabled: false,
      hint: null,
      duration: Date.now() - startTime
    };
  }

  // Check cache first (Phase 2)
  const cached = getCachedDecision(prompt, config);
  if (cached) {
    return {
      ...cached,
      fromCache: true,
      duration: Date.now() - startTime
    };
  }

  // Run quick analysis first for fast response
  const complexity = estimateComplexity(prompt);
  const subtaskCount = estimateSubtaskCount(prompt);
  const matchedTask = matchKnownTask(prompt);
  const pattern = suggestPattern(prompt, subtaskCount);

  // Determine if delegation should be considered
  let shouldConsider = complexity >= config.minComplexityThreshold ||
                       subtaskCount >= config.minSubtaskCount ||
                       matchedTask !== null;

  // Phase 2: Use full DelegationDecider for complex cases
  let fullDecision = null;
  let decompositionSuggestion = null;

  if (!config.quickAnalysisOnly && shouldConsider) {
    fullDecision = getFullDecision(prompt, matchedTask, options);
    if (fullDecision) {
      // Override with full decision
      shouldConsider = fullDecision.shouldDelegate;
    }

    // Get decomposition suggestion if task decomposer is available
    if (config.useTaskDecomposer && matchedTask) {
      decompositionSuggestion = getDecompositionSuggestion(matchedTask);
    }
  }

  // Check per-task delegation config (Phase 2)
  let effectivePattern = pattern;
  let taskDelegationConfig = null;
  if (matchedTask?.delegationConfig) {
    taskDelegationConfig = matchedTask.delegationConfig;
    if (taskDelegationConfig.pattern && taskDelegationConfig.pattern !== 'direct') {
      effectivePattern = taskDelegationConfig.pattern;
    }
    if (taskDelegationConfig.shouldDelegate === false) {
      shouldConsider = false;
    } else if (taskDelegationConfig.shouldDelegate === true) {
      shouldConsider = true;
    }
  }

  // Build hint message
  let hint = null;
  if (config.showHints && shouldConsider) {
    const parts = [];

    if (matchedTask) {
      parts.push(`Matches task: ${matchedTask.title} (${matchedTask.id})`);
      if (matchedTask.estimate) {
        parts.push(`Estimated effort: ${matchedTask.estimate}`);
      }
    }

    if (fullDecision) {
      parts.push(`Decision confidence: ${fullDecision.confidence}%`);
    } else if (complexity >= config.minComplexityThreshold) {
      parts.push(`Complexity: ${complexity}/100 - may benefit from delegation`);
    }

    if (decompositionSuggestion) {
      parts.push(`Decomposable into ~${decompositionSuggestion.subtaskCount} subtasks`);
    } else if (subtaskCount >= config.minSubtaskCount) {
      parts.push(`Decomposable into ~${subtaskCount} subtasks`);
    }

    if (effectivePattern !== 'direct') {
      parts.push(`Suggested pattern: ${effectivePattern}`);
    }

    hint = parts.join(' | ');
  }

  const result = {
    enabled: true,
    shouldConsiderDelegation: shouldConsider,
    factors: {
      complexity,
      subtaskCount,
      hasMatchedTask: !!matchedTask
    },
    matchedTask: matchedTask ? {
      id: matchedTask.id,
      title: matchedTask.title,
      phase: matchedTask.phase,
      estimate: matchedTask.estimate,
      matchType: matchedTask.matchType,
      delegationConfig: taskDelegationConfig
    } : null,
    suggestedPattern: effectivePattern,
    fullDecision: fullDecision ? {
      shouldDelegate: fullDecision.shouldDelegate,
      confidence: fullDecision.confidence,
      reasoning: fullDecision.reasoning
    } : null,
    decomposition: decompositionSuggestion,
    hint,
    fromCache: false,
    duration: Date.now() - startTime
  };

  // Cache the result (Phase 2)
  cacheDecision(prompt, result, config);

  if (config.debugMode) {
    console.error('[DelegationBridge]', JSON.stringify(result, null, 2));
  }

  return result;
}

/**
 * Get full delegation decision using DelegationDecider
 * @param {string} prompt - User prompt
 * @param {Object} matchedTask - Matched task from tasks.json
 * @param {Object} options - Additional options
 * @returns {Object|null} Full decision or null
 */
function getFullDecision(prompt, matchedTask, options = {}) {
  // Short-circuit: Tasks with existing child tasks should always delegate
  // This fixes the issue where pre-decomposed tasks were not recognized
  if (matchedTask?.childTaskIds?.length > 0) {
    return {
      shouldDelegate: true,
      confidence: 95,
      reasoning: `Task already decomposed into ${matchedTask.childTaskIds.length} subtasks`,
      pattern: matchedTask.decomposition || 'sequential',
      preDecomposed: true
    };
  }

  const decider = loadDelegationDecider();
  if (!decider) return null;

  try {
    // Build a task object from the prompt if no match
    const task = matchedTask || {
      id: 'prompt-' + hashPrompt(prompt).substring(0, 8),
      title: prompt.substring(0, 100),
      description: prompt
    };

    // Get decision from full DelegationDecider
    const decision = decider.shouldDelegate(task, null, {
      skipCache: false,
      ...options
    });

    return decision;
  } catch (error) {
    // Fall back to quick analysis
    return null;
  }
}

/**
 * Get decomposition suggestion using TaskDecomposer
 * @param {Object} task - Task to analyze
 * @returns {Object|null} Decomposition suggestion or null
 */
function getDecompositionSuggestion(task) {
  const decomposer = getTaskDecomposer();
  if (!decomposer) return null;

  try {
    const analysis = decomposer.analyze(task);
    return {
      shouldDecompose: analysis.shouldDecompose,
      subtaskCount: analysis.suggestedSubtasks?.length || 0,
      strategy: analysis.suggestedStrategy,
      confidence: analysis.confidence
    };
  } catch (error) {
    return null;
  }
}

/**
 * Format hint for stdout injection into Claude conversation
 *
 * @param {Object} analysis - Result from getQuickHint
 * @returns {string|null} Formatted hint or null
 */
function formatHintForStdout(analysis) {
  if (!analysis.enabled || !analysis.hint) {
    return null;
  }

  if (!analysis.shouldConsiderDelegation) {
    return null;
  }

  // Format as a concise system note
  const lines = [
    '[Delegation Analysis]',
    analysis.hint
  ];

  if (analysis.matchedTask) {
    lines.push(`Task: ${analysis.matchedTask.id} (${analysis.matchedTask.phase})`);
  }

  return lines.join('\n');
}

module.exports = {
  // Main API
  getQuickHint,
  formatHintForStdout,

  // Configuration
  loadConfig,
  saveConfig,
  DEFAULT_CONFIG,
  CONFIG_PATH,

  // Quick analysis functions
  estimateComplexity,
  estimateSubtaskCount,
  matchKnownTask,
  suggestPattern,

  // Phase 2: Full decision engine
  getFullDecision,
  getDecompositionSuggestion,
  loadDelegationDecider,
  getTaskDecomposer,

  // Phase 2: Caching
  getCachedDecision,
  cacheDecision,
  clearCache,
  getCacheStats,
  hashPrompt,

  // Phase 2: Per-task config
  enrichTaskWithDelegationConfig,
  inferDelegationConfig,
  parseEffortHours
};
