#!/usr/bin/env node

/**
 * Task CLI - Command-line interface for task management
 *
 * Usage:
 *   node task-cli.js ready              - List ready tasks
 *   node task-cli.js backlog             - Show backlog summary
 *   node task-cli.js create              - Create new task (interactive)
 *   node task-cli.js show <id>           - Show task details
 *   node task-cli.js deps <id>           - Show task dependencies
 *   node task-cli.js complete <id>       - Mark task complete
 *   node task-cli.js move <id> <tier>    - Move task to backlog tier
 *   node task-cli.js stats               - Show statistics
 *
 * @module task-cli
 */

const TaskManager = require('./.claude/core/task-manager');
const MemoryStore = require('./.claude/core/memory-store');
const chalk = require('chalk');
const inquirer = require('inquirer');

const memoryStore = new MemoryStore();
const taskManager = new TaskManager({ memoryStore });

const command = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  try {
    switch (command) {
      case 'ready':
        await cmdReady();
        break;

      case 'backlog':
        await cmdBacklog();
        break;

      case 'create':
        await cmdCreate();
        break;

      case 'show':
        await cmdShow(args[0]);
        break;

      case 'deps':
        await cmdDeps(args[0]);
        break;

      case 'complete':
        await cmdComplete(args[0]);
        break;

      case 'move':
        await cmdMove(args[0], args[1]);
        break;

      case 'stats':
        await cmdStats();
        break;

      case 'list':
        await cmdList(args[0]);
        break;

      default:
        printHelp();
    }
  } catch (error) {
    console.error(chalk.red('\n✗ Error:'), error.message);
    process.exit(1);
  } finally {
    memoryStore.close();
  }
}

async function cmdReady() {
  const phase = args[0] || null;
  const ready = taskManager.getReadyTasks({ phase, backlog: 'now' });

  if (ready.length === 0) {
    console.log(chalk.yellow('\n⚠ No ready tasks in "now" backlog'));
    return;
  }

  console.log(chalk.green.bold(`\n✓ Ready Tasks (${ready.length}):\n`));
  ready.forEach((t, i) => {
    const priorityColor = {
      critical: 'red',
      high: 'yellow',
      medium: 'blue',
      low: 'gray'
    }[t.priority] || 'white';

    console.log(`${i + 1}. ${chalk[priorityColor](`[${t.priority.toUpperCase()}]`)} ${chalk.bold(t.id)}: ${t.title}`);
    console.log(`   Phase: ${t.phase} | Estimate: ${t.estimate} | Score: ${t._score.toFixed(1)}`);
    if (t.tags.length > 0) {
      console.log(`   Tags: ${t.tags.join(', ')}`);
    }
    console.log('');
  });
}

async function cmdBacklog() {
  const summary = taskManager.getBacklogSummary();

  console.log(chalk.blue.bold('\n📋 Backlog Summary:\n'));

  for (const [tier, stats] of Object.entries(summary)) {
    const tierName = tier.toUpperCase().padEnd(8);
    const total = chalk.white(`${stats.total} tasks`);
    const ready = chalk.green(`${stats.ready} ready`);
    const blocked = chalk.red(`${stats.blocked} blocked`);
    const inProgress = chalk.yellow(`${stats.in_progress} in progress`);

    console.log(`${chalk.bold(tierName)}: ${total} | ${ready}, ${blocked}, ${inProgress}`);
  }

  console.log('');
}

async function cmdCreate() {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'title',
      message: 'Task title:',
      validate: (input) => input.trim().length > 0 || 'Title is required'
    },
    {
      type: 'editor',
      name: 'description',
      message: 'Description (opens editor):',
      default: ''
    },
    {
      type: 'list',
      name: 'phase',
      message: 'Phase:',
      choices: ['research', 'planning', 'design', 'implementation', 'testing', 'validation']
    },
    {
      type: 'list',
      name: 'priority',
      message: 'Priority:',
      choices: ['critical', 'high', 'medium', 'low'],
      default: 'medium'
    },
    {
      type: 'input',
      name: 'estimate',
      message: 'Estimate (e.g., "4h", "2d"):',
      default: '2h'
    },
    {
      type: 'input',
      name: 'tags',
      message: 'Tags (comma-separated):',
      filter: (input) => input.split(',').map(t => t.trim()).filter(t => t.length > 0)
    },
    {
      type: 'list',
      name: 'backlogTier',
      message: 'Backlog tier:',
      choices: ['now', 'next', 'later', 'someday'],
      default: 'next'
    }
  ]);

  const task = taskManager.createTask(answers);

  console.log(chalk.green(`\n✓ Created task: ${task.id}`));
  console.log(JSON.stringify(task, null, 2));
}

async function cmdShow(taskId) {
  if (!taskId) {
    console.error(chalk.red('\n✗ Task ID required'));
    process.exit(1);
  }

  const task = taskManager.getTask(taskId);
  if (!task) {
    console.error(chalk.red(`\n✗ Task not found: ${taskId}`));
    process.exit(1);
  }

  console.log(chalk.blue.bold(`\n📋 Task: ${task.id}\n`));
  console.log(chalk.bold('Title:'), task.title);
  console.log(chalk.bold('Status:'), task.status);
  console.log(chalk.bold('Phase:'), task.phase);
  console.log(chalk.bold('Priority:'), task.priority);
  console.log(chalk.bold('Estimate:'), task.estimate);

  if (task.description) {
    console.log(chalk.bold('\nDescription:'));
    console.log(task.description);
  }

  if (task.tags.length > 0) {
    console.log(chalk.bold('\nTags:'), task.tags.join(', '));
  }

  if (task.acceptance.length > 0) {
    console.log(chalk.bold('\nAcceptance Criteria:'));
    task.acceptance.forEach((c, i) => {
      console.log(`  ${i + 1}. ${c}`);
    });
  }

  console.log(chalk.bold('\nDependencies:'));
  console.log('  Requires:', task.depends.requires.length > 0 ? task.depends.requires.join(', ') : 'None');
  console.log('  Blocks:', task.depends.blocks.length > 0 ? task.depends.blocks.join(', ') : 'None');
  console.log('  Related:', task.depends.related.length > 0 ? task.depends.related.join(', ') : 'None');

  console.log(chalk.bold('\nTimestamps:'));
  console.log('  Created:', task.created);
  console.log('  Updated:', task.updated);
  if (task.started) console.log('  Started:', task.started);
  if (task.completed) console.log('  Completed:', task.completed);

  console.log('');
}

async function cmdDeps(taskId) {
  if (!taskId) {
    console.error(chalk.red('\n✗ Task ID required'));
    process.exit(1);
  }

  const graph = taskManager.getDependencyGraph(taskId);
  if (!graph) {
    console.error(chalk.red(`\n✗ Task not found: ${taskId}`));
    process.exit(1);
  }

  console.log(chalk.yellow.bold(`\n🔗 Dependency Graph: ${taskId}\n`));

  console.log(chalk.bold('Blocked By (must complete first):'));
  if (graph.blockedBy.length > 0) {
    graph.blockedBy.forEach(t => {
      const status = t.status === 'completed' ? chalk.green('✓') : chalk.red('✗');
      console.log(`  ${status} ${t.id}: ${t.title}`);
    });
  } else {
    console.log('  None - task is ready');
  }

  console.log(chalk.bold('\nBlocking (will unblock when complete):'));
  if (graph.blocking.length > 0) {
    graph.blocking.forEach(t => {
      console.log(`  → ${t.id}: ${t.title}`);
    });
  } else {
    console.log('  None');
  }

  console.log(chalk.bold('\nAncestors (transitive dependencies):'));
  if (graph.ancestors.length > 0) {
    const uniqueAncestors = [...new Map(graph.ancestors.map(t => [t.id, t])).values()];
    uniqueAncestors.forEach(t => {
      console.log(`  ↑ ${t.id}: ${t.title}`);
    });
  } else {
    console.log('  None');
  }

  console.log(chalk.bold('\nDescendants (downstream tasks):'));
  if (graph.descendants.length > 0) {
    const uniqueDescendants = [...new Map(graph.descendants.map(t => [t.id, t])).values()];
    uniqueDescendants.forEach(t => {
      console.log(`  ↓ ${t.id}: ${t.title}`);
    });
  } else {
    console.log('  None');
  }

  console.log('');
}

async function cmdComplete(taskId) {
  if (!taskId) {
    console.error(chalk.red('\n✗ Task ID required'));
    process.exit(1);
  }

  const task = taskManager.updateStatus(taskId, 'completed');
  console.log(chalk.green(`\n✓ Task marked complete: ${task.id}`));

  // Show unblocked tasks
  const graph = taskManager.getDependencyGraph(taskId);
  if (graph.blocking.length > 0) {
    console.log(chalk.yellow('\nUnblocked tasks:'));
    graph.blocking.forEach(t => {
      const nowReady = taskManager._areRequirementsMet(t);
      if (nowReady) {
        console.log(chalk.green(`  ✓ ${t.id}: ${t.title}`));
      }
    });
  }

  console.log('');
}

async function cmdMove(taskId, toTier) {
  if (!taskId || !toTier) {
    console.error(chalk.red('\n✗ Usage: task-cli move <task-id> <tier>'));
    console.error(chalk.gray('  Tiers: now, next, later, someday'));
    process.exit(1);
  }

  taskManager.moveToBacklog(taskId, toTier);
  console.log(chalk.green(`\n✓ Moved ${taskId} to "${toTier}" backlog`));
}

async function cmdStats() {
  const stats = taskManager.getStats();

  console.log(chalk.blue.bold('\n📊 Task Statistics:\n'));
  console.log(chalk.bold('Total Tasks:'), stats.total);
  console.log(chalk.bold('Completion Rate:'), `${(stats.completionRate * 100).toFixed(1)}%`);

  console.log(chalk.bold('\nBy Status:'));
  Object.entries(stats.byStatus).forEach(([status, count]) => {
    console.log(`  ${status.padEnd(12)}: ${count}`);
  });

  console.log(chalk.bold('\nBy Phase:'));
  Object.entries(stats.byPhase).forEach(([phase, count]) => {
    console.log(`  ${phase.padEnd(15)}: ${count}`);
  });

  console.log(chalk.bold('\nBy Priority:'));
  Object.entries(stats.byPriority).forEach(([priority, count]) => {
    console.log(`  ${priority.padEnd(12)}: ${count}`);
  });

  console.log('');
}

async function cmdList(filter) {
  const all = taskManager.getReadyTasks({ backlog: 'all' });

  console.log(chalk.blue.bold(`\n📋 All Tasks (${all.length}):\n`));

  all.forEach((t, i) => {
    const statusIcon = {
      ready: '○',
      in_progress: '◐',
      blocked: '●',
      completed: '✓',
      review: '◎'
    }[t.status] || '?';

    console.log(`${statusIcon} ${chalk.bold(t.id)} [${t.phase}] ${t.title}`);
  });

  console.log('');
}

function printHelp() {
  console.log(`
${chalk.blue.bold('Task CLI - Intelligent Task Management')}

${chalk.bold('Usage:')}
  node task-cli.js <command> [options]

${chalk.bold('Commands:')}
  ready [phase]        List ready tasks (optionally filter by phase)
  backlog              Show backlog summary (now/next/later/someday)
  create               Create new task (interactive prompts)
  show <id>            Show detailed task information
  deps <id>            Show task dependency graph
  complete <id>        Mark task as completed
  move <id> <tier>     Move task to backlog tier (now/next/later/someday)
  stats                Show task statistics
  list                 List all tasks

${chalk.bold('Examples:')}
  node task-cli.js ready
  node task-cli.js ready implementation
  node task-cli.js show auth-001
  node task-cli.js deps auth-001
  node task-cli.js complete auth-001
  node task-cli.js move auth-002 now
  node task-cli.js stats
`);
}

main();
