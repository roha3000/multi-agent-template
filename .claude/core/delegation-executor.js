/**
 * Delegation Executor - Bridges /delegate skill to AgentOrchestrator
 *
 * Provides a simple API for executing delegations from Claude Code skills.
 * Generates Task tool invocations that Claude Code can execute.
 *
 * Phase 4 Implementation:
 * - Parses skill command arguments
 * - Resolves tasks from tasks.json
 * - Gets delegation decisions from DelegationBridge
 * - Generates Task tool execution plans
 * - Formats output for Claude Code consumption
 *
 * @module core/delegation-executor
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const TASKS_JSON = path.join(PROJECT_ROOT, '.claude/dev-docs/tasks.json');

// Lazy load dependencies to keep startup fast
let _delegationBridge = null;
let _taskDecomposer = null;

/**
 * Lazy load DelegationBridge
 * @returns {Object|null}
 */
function getDelegationBridge() {
  if (!_delegationBridge) {
    try {
      _delegationBridge = require('./delegation-bridge');
    } catch (error) {
      console.error('[DelegationExecutor] Failed to load DelegationBridge:', error.message);
      return null;
    }
  }
  return _delegationBridge;
}

/**
 * Lazy load TaskDecomposer
 * @returns {Object|null}
 */
function getTaskDecomposer() {
  if (!_taskDecomposer) {
    try {
      const { TaskDecomposer } = require('./task-decomposer');
      _taskDecomposer = new TaskDecomposer();
    } catch (error) {
      console.error('[DelegationExecutor] Failed to load TaskDecomposer:', error.message);
      return null;
    }
  }
  return _taskDecomposer;
}

/**
 * Parse command-line style arguments from skill input
 * @param {string} input - Raw input from skill
 * @returns {Object} Parsed options and task description
 */
function parseArguments(input) {
  const options = {
    pattern: null,      // --pattern=parallel, -p parallel
    depth: null,        // --depth=2, -d 2
    agents: null,       // --agents=3, -a 3
    budget: null,       // --budget=50000, -b 50000
    dryRun: false,      // --dry-run
    force: false        // --force, -f
  };

  let remaining = input;

  // Parse long options (supports hyphenated names like --dry-run)
  const longOptionPattern = /--([\w-]+)(?:=(\S+))?/g;
  let match;
  while ((match = longOptionPattern.exec(input)) !== null) {
    const [full, name, value] = match;
    switch (name) {
      case 'pattern':
        options.pattern = value;
        break;
      case 'depth':
        options.depth = parseInt(value, 10);
        break;
      case 'agents':
        options.agents = parseInt(value, 10);
        break;
      case 'budget':
        options.budget = parseInt(value, 10);
        break;
      case 'dry-run':
        options.dryRun = true;
        break;
      case 'force':
        options.force = true;
        break;
    }
    remaining = remaining.replace(full, '');
  }

  // Parse short options
  const shortOptionPattern = /-([pdabf])\s+(\S+)?/g;
  while ((match = shortOptionPattern.exec(input)) !== null) {
    const [full, flag, value] = match;
    switch (flag) {
      case 'p':
        options.pattern = value;
        break;
      case 'd':
        options.depth = parseInt(value, 10);
        break;
      case 'a':
        options.agents = parseInt(value, 10);
        break;
      case 'b':
        options.budget = parseInt(value, 10);
        break;
      case 'f':
        options.force = true;
        break;
    }
    remaining = remaining.replace(full, '');
  }

  // Clean up remaining text as task description
  const taskDescription = remaining.trim().replace(/\s+/g, ' ');

  return {
    options,
    taskDescription
  };
}

/**
 * Resolve task from ID or description
 * @param {string} taskInput - Task ID or description
 * @returns {Object|null} Task object or null
 */
function resolveTask(taskInput) {
  try {
    if (!fs.existsSync(TASKS_JSON)) {
      return null;
    }

    const data = JSON.parse(fs.readFileSync(TASKS_JSON, 'utf8'));
    const tasks = data.tasks || {};

    // Check if input is a task ID
    if (tasks[taskInput]) {
      return {
        ...tasks[taskInput],
        source: 'tasks.json',
        resolvedById: true
      };
    }

    // Check if input matches a task ID case-insensitively
    const inputLower = taskInput.toLowerCase();
    for (const [taskId, task] of Object.entries(tasks)) {
      if (taskId.toLowerCase() === inputLower) {
        return {
          ...task,
          source: 'tasks.json',
          resolvedById: true
        };
      }
    }

    // Use DelegationBridge to match by content
    const bridge = getDelegationBridge();
    if (bridge) {
      const matched = bridge.matchKnownTask(taskInput);
      if (matched) {
        return {
          ...matched,
          source: 'tasks.json',
          resolvedById: false
        };
      }
    }

    // Create ad-hoc task from description
    return {
      id: `adhoc-${Date.now()}`,
      title: taskInput.substring(0, 80),
      description: taskInput,
      source: 'ad-hoc',
      resolvedById: false
    };
  } catch (error) {
    console.error('[DelegationExecutor] Failed to resolve task:', error.message);
    return null;
  }
}

/**
 * Get delegation decision for a task
 * @param {Object} task - Task object
 * @param {Object} options - Execution options
 * @returns {Object} Delegation decision
 */
function getDelegationDecision(task, options = {}) {
  const bridge = getDelegationBridge();

  // Get full decision from DelegationBridge
  const decision = bridge ? bridge.getFullDecision(task.description || task.title, task) : null;

  // Apply option overrides
  const result = {
    shouldDelegate: decision?.shouldDelegate ?? options.force ?? false,
    confidence: decision?.confidence ?? 50,
    reasoning: decision?.reasoning ?? 'Manual delegation requested',
    pattern: options.pattern || decision?.pattern || decision?.suggestedPattern || 'sequential',
    preDecomposed: decision?.preDecomposed ?? false
  };

  // Force delegation if --force is set
  if (options.force) {
    result.shouldDelegate = true;
    result.reasoning = 'Forced delegation via --force flag';
  }

  return result;
}

/**
 * Get subtasks for a task
 * @param {Object} task - Parent task
 * @param {Object} decision - Delegation decision
 * @param {Object} options - Execution options
 * @returns {Array} Array of subtasks
 */
function getSubtasks(task, decision, options = {}) {
  // If task is already decomposed, use existing child tasks
  if (task.childTaskIds && task.childTaskIds.length > 0) {
    try {
      const data = JSON.parse(fs.readFileSync(TASKS_JSON, 'utf8'));
      const tasks = data.tasks || {};
      return task.childTaskIds
        .map(id => tasks[id])
        .filter(Boolean)
        .map(t => ({
          id: t.id,
          title: t.title,
          description: t.description || t.title,
          phase: t.phase,
          status: t.status
        }));
    } catch (error) {
      // Fall through to decomposition
    }
  }

  // Use TaskDecomposer to generate subtasks
  const decomposer = getTaskDecomposer();
  if (decomposer) {
    try {
      const strategy = mapPatternToStrategy(decision.pattern);
      const subtasks = decomposer.decompose(task, strategy);
      return subtasks.map((st, i) => ({
        id: `${task.id}-sub-${i + 1}`,
        title: st.title || st.name || `Subtask ${i + 1}`,
        description: st.description || st.title,
        order: i + 1
      }));
    } catch (error) {
      // Fall through to single task
    }
  }

  // Default: treat task as single item
  return [{
    id: task.id,
    title: task.title,
    description: task.description || task.title,
    order: 1
  }];
}

/**
 * Map execution pattern to decomposition strategy
 * @param {string} pattern - Execution pattern
 * @returns {string} Decomposition strategy
 */
function mapPatternToStrategy(pattern) {
  switch (pattern) {
    case 'parallel':
      return 'parallel';
    case 'sequential':
      return 'sequential';
    case 'debate':
    case 'review':
      return 'hybrid';
    default:
      return 'sequential';
  }
}

/**
 * Determine the best agent type for a subtask
 * @param {Object} subtask - Subtask object
 * @param {Object} parentTask - Parent task
 * @returns {string} Agent type for Task tool
 */
function determineAgentType(subtask, parentTask) {
  const text = `${subtask.title} ${subtask.description}`.toLowerCase();

  // Check for specific patterns
  if (text.includes('research') || text.includes('investigate') || text.includes('analyze')) {
    return 'Explore';
  }
  if (text.includes('test') || text.includes('validate') || text.includes('verify')) {
    return 'E2E Test Engineer';
  }
  if (text.includes('backend') || text.includes('api') || text.includes('server')) {
    return 'Backend Specialist';
  }
  if (text.includes('frontend') || text.includes('ui') || text.includes('component')) {
    return 'Frontend Specialist';
  }
  if (text.includes('plan') || text.includes('design') || text.includes('architecture')) {
    return 'Plan';
  }

  // Default to general purpose
  return 'general-purpose';
}

/**
 * Generate Task tool invocations for parallel execution
 * @param {Array} subtasks - Subtasks to execute
 * @param {Object} parentTask - Parent task for context
 * @param {Object} options - Execution options
 * @returns {Array} Array of Task tool invocations
 */
function generateParallelTasks(subtasks, parentTask, options = {}) {
  return subtasks.map((subtask, index) => ({
    tool: 'Task',
    parameters: {
      description: `[PARALLEL ${index + 1}/${subtasks.length}] ${subtask.title.substring(0, 50)}`,
      prompt: buildSubtaskPrompt(subtask, parentTask, 'parallel'),
      subagent_type: determineAgentType(subtask, parentTask),
      run_in_background: true
    }
  }));
}

/**
 * Generate Task tool invocations for sequential execution
 * @param {Array} subtasks - Subtasks to execute
 * @param {Object} parentTask - Parent task for context
 * @param {Object} options - Execution options
 * @returns {Array} Array of Task tool invocations
 */
function generateSequentialTasks(subtasks, parentTask, options = {}) {
  return subtasks.map((subtask, index) => ({
    tool: 'Task',
    parameters: {
      description: `[SEQ ${index + 1}/${subtasks.length}] ${subtask.title.substring(0, 50)}`,
      prompt: buildSubtaskPrompt(subtask, parentTask, 'sequential', index),
      subagent_type: determineAgentType(subtask, parentTask),
      run_in_background: false
    },
    waitForPrevious: index > 0
  }));
}

/**
 * Generate Task tool invocations for debate pattern
 * @param {Object} task - Main task
 * @param {Object} options - Execution options
 * @returns {Array} Array of Task tool invocations
 */
function generateDebateTasks(task, options = {}) {
  return [
    {
      tool: 'Task',
      parameters: {
        description: `[PRO] Advocate for approach`,
        prompt: `You are an advocate. Argue FOR the best approach to: ${task.title}\n\nTask details: ${task.description}\n\nProvide a strong, well-reasoned argument for your recommended approach.`,
        subagent_type: 'general-purpose',
        run_in_background: true
      }
    },
    {
      tool: 'Task',
      parameters: {
        description: `[CON] Critique approach`,
        prompt: `You are a critic. Identify potential issues with common approaches to: ${task.title}\n\nTask details: ${task.description}\n\nProvide a critical analysis of potential pitfalls and overlooked concerns.`,
        subagent_type: 'general-purpose',
        run_in_background: true
      }
    },
    {
      tool: 'Task',
      parameters: {
        description: `[SYNTH] Synthesize debate`,
        prompt: `Synthesize the advocate and critic perspectives on: ${task.title}\n\nTask details: ${task.description}\n\nProvide a balanced conclusion that incorporates the strongest points from both sides.`,
        subagent_type: 'general-purpose',
        run_in_background: false,
        waitForAgents: ['PRO', 'CON']
      }
    }
  ];
}

/**
 * Generate Task tool invocations for review pattern
 * @param {Object} task - Main task
 * @param {Object} options - Execution options
 * @returns {Array} Array of Task tool invocations
 */
function generateReviewTasks(task, options = {}) {
  return [
    {
      tool: 'Task',
      parameters: {
        description: `[IMPL] Implement solution`,
        prompt: `Implement a solution for: ${task.title}\n\nTask details: ${task.description}\n\nProvide a complete, working implementation.`,
        subagent_type: determineAgentType(task, task),
        run_in_background: false
      }
    },
    {
      tool: 'Task',
      parameters: {
        description: `[REVIEW] Review implementation`,
        prompt: `Review the implementation of: ${task.title}\n\nTask details: ${task.description}\n\nProvide a thorough code review with specific suggestions for improvement.`,
        subagent_type: 'general-purpose',
        run_in_background: false,
        waitForAgents: ['IMPL']
      }
    }
  ];
}

/**
 * Build prompt for a subtask with context
 * @param {Object} subtask - Subtask object
 * @param {Object} parentTask - Parent task for context
 * @param {string} pattern - Execution pattern
 * @param {number} index - Subtask index (for sequential)
 * @returns {string} Formatted prompt
 */
function buildSubtaskPrompt(subtask, parentTask, pattern, index = 0) {
  const lines = [
    `## Subtask: ${subtask.title}`,
    '',
    subtask.description,
    '',
    `### Parent Task Context`,
    `- **Parent**: ${parentTask.title}`,
    `- **Phase**: ${parentTask.phase || 'implementation'}`,
  ];

  if (parentTask.acceptance && parentTask.acceptance.length > 0) {
    lines.push(`- **Acceptance Criteria**: ${parentTask.acceptance.length} criteria`);
  }

  if (pattern === 'sequential' && index > 0) {
    lines.push('', '### Note');
    lines.push('This is a sequential task. Previous steps have been completed.');
    lines.push('Build upon prior work and pass results to subsequent steps.');
  }

  if (pattern === 'parallel') {
    lines.push('', '### Note');
    lines.push('This is a parallel task. Work independently and thoroughly.');
    lines.push('Your results will be aggregated with other parallel subtasks.');
  }

  return lines.join('\n');
}

/**
 * Execute delegation - main entry point
 * @param {string} input - Raw input from /delegate skill
 * @returns {Object} Execution plan or result
 */
function executeDelegation(input) {
  const startTime = Date.now();

  // Parse arguments
  const { options, taskDescription } = parseArguments(input);

  // Validate input
  if (!taskDescription || taskDescription.length < 3) {
    return {
      success: false,
      error: 'No task description provided',
      usage: '/delegate [options] <task description or task-id>'
    };
  }

  // Resolve task
  const task = resolveTask(taskDescription);
  if (!task) {
    return {
      success: false,
      error: `Could not resolve task: ${taskDescription}`,
      hint: 'Provide a task ID from tasks.json or a detailed description'
    };
  }

  // Get delegation decision
  const decision = getDelegationDecision(task, options);

  // Check if delegation is recommended
  if (!decision.shouldDelegate && !options.force) {
    return {
      success: false,
      warning: 'Delegation not recommended',
      confidence: decision.confidence,
      reasoning: decision.reasoning,
      hint: 'Use --force to delegate anyway',
      task: {
        id: task.id,
        title: task.title
      }
    };
  }

  // Get subtasks
  const subtasks = getSubtasks(task, decision, options);

  // Apply pattern override
  const pattern = options.pattern || decision.pattern;

  // Handle dry run
  if (options.dryRun) {
    return {
      success: true,
      dryRun: true,
      task: {
        id: task.id,
        title: task.title,
        source: task.source
      },
      decision: {
        shouldDelegate: decision.shouldDelegate,
        confidence: decision.confidence,
        pattern
      },
      subtasks: subtasks.map(st => ({
        id: st.id,
        title: st.title,
        agentType: determineAgentType(st, task)
      })),
      estimatedAgents: subtasks.length,
      duration: Date.now() - startTime
    };
  }

  // Generate Task tool invocations based on pattern
  let taskInvocations;
  switch (pattern) {
    case 'parallel':
      taskInvocations = generateParallelTasks(subtasks, task, options);
      break;
    case 'debate':
      taskInvocations = generateDebateTasks(task, options);
      break;
    case 'review':
      taskInvocations = generateReviewTasks(task, options);
      break;
    case 'sequential':
    default:
      taskInvocations = generateSequentialTasks(subtasks, task, options);
      break;
  }

  return {
    success: true,
    task: {
      id: task.id,
      title: task.title,
      source: task.source
    },
    decision: {
      shouldDelegate: decision.shouldDelegate,
      confidence: decision.confidence,
      pattern,
      reasoning: decision.reasoning
    },
    execution: {
      pattern,
      subtaskCount: subtasks.length,
      taskInvocations
    },
    duration: Date.now() - startTime
  };
}

/**
 * Format execution plan as markdown for Claude Code
 * @param {Object} result - Result from executeDelegation
 * @returns {string} Formatted markdown
 */
function formatExecutionPlan(result) {
  if (!result.success) {
    const lines = [`## Delegation ${result.warning ? 'Warning' : 'Error'}`];
    lines.push('');
    lines.push(result.error || result.warning);
    if (result.hint) lines.push('', `**Hint**: ${result.hint}`);
    if (result.reasoning) lines.push('', `**Reason**: ${result.reasoning}`);
    return lines.join('\n');
  }

  if (result.dryRun) {
    const lines = [
      '## Delegation Plan (Dry Run)',
      '',
      `**Task**: ${result.task.title}`,
      `**Pattern**: ${result.decision.pattern}`,
      `**Confidence**: ${result.decision.confidence}%`,
      `**Estimated Agents**: ${result.estimatedAgents}`,
      '',
      '### Subtasks'
    ];

    result.subtasks.forEach((st, i) => {
      lines.push(`${i + 1}. **${st.title}** (${st.agentType})`);
    });

    lines.push('', '*Run without --dry-run to execute*');
    return lines.join('\n');
  }

  const lines = [
    '## Delegation Execution Plan',
    '',
    `**Task**: ${result.task.title}`,
    `**Pattern**: ${result.execution.pattern}`,
    `**Subtasks**: ${result.execution.subtaskCount}`,
    '',
    '### Task Tool Invocations',
    '',
    'Execute these Task tool calls:'
  ];

  result.execution.taskInvocations.forEach((inv, i) => {
    lines.push('');
    lines.push(`#### ${i + 1}. ${inv.parameters.description}`);
    lines.push('```json');
    lines.push(JSON.stringify({
      tool: inv.tool,
      parameters: inv.parameters
    }, null, 2));
    lines.push('```');
  });

  return lines.join('\n');
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2).join(' ');

  if (!args || args === '--help') {
    console.log(`
Delegation Executor - Execute task delegations

Usage: node delegation-executor.js [options] <task description or task-id>

Options:
  --pattern=<type>    Force execution pattern (parallel, sequential, debate, review)
  --depth=<n>         Set max delegation depth (1-3)
  --agents=<n>        Set max concurrent agents (1-10)
  --budget=<tokens>   Set token budget
  --dry-run           Show plan without executing
  --force, -f         Force delegation even if not recommended

Examples:
  node delegation-executor.js Implement user authentication
  node delegation-executor.js --pattern=parallel auto-delegation-phase4
  node delegation-executor.js --dry-run Build the test suite
`);
    process.exit(0);
  }

  const result = executeDelegation(args);
  console.log(formatExecutionPlan(result));

  if (result.success && !result.dryRun) {
    console.log('\n---\nExecution plan generated. Use Task tool calls above.');
  }

  process.exit(result.success ? 0 : 1);
}

module.exports = {
  // Main API
  executeDelegation,
  formatExecutionPlan,

  // Parsing
  parseArguments,
  resolveTask,

  // Decision
  getDelegationDecision,
  getSubtasks,

  // Task generation
  generateParallelTasks,
  generateSequentialTasks,
  generateDebateTasks,
  generateReviewTasks,
  determineAgentType,
  buildSubtaskPrompt,

  // Utilities
  mapPatternToStrategy,
  getDelegationBridge,
  getTaskDecomposer
};
