#!/usr/bin/env node
/**
 * SessionStart Hook - Load project context summary
 * Reads dev-docs and prints a brief context summary to stdout.
 * Output is injected into the Claude session context.
 */

const fs = require('fs');
const path = require('path');

const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function readJSON(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      process.stderr.write(`[session-start] Failed to read/parse ${filePath}: ${e.message}\n`);
    }
    return null;
  }
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') {
      process.stderr.write(`[session-start] Failed to read ${filePath}: ${e.message}\n`);
    }
    return null;
  }
}

function main() {
  const tasksPath = path.join(projectRoot, '.claude/dev-docs/tasks.json');
  const planPath = path.join(projectRoot, '.claude/dev-docs/plan.md');
  const summaryPath = path.join(projectRoot, 'PROJECT_SUMMARY.md');

  const tasks = readJSON(tasksPath);
  const plan = readFile(planPath);
  const summary = readFile(summaryPath);

  const lines = ['=== SESSION CONTEXT ==='];

  if (summary) {
    const summaryPreview = summary.split('\n').slice(0, 5).join('\n');
    lines.push('--- Project Summary ---');
    lines.push(summaryPreview);
  }

  if (tasks) {
    // Support both array and object-map formats for tasks.tasks
    const tasksArray = Array.isArray(tasks.tasks)
      ? tasks.tasks
      : Object.values(tasks.tasks || {});
    const active = tasksArray.filter(t => t.status === 'active' || t.status === 'in_progress');
    const backlog = tasksArray.filter(t => t.status === 'backlog' || t.status === 'pending');
    lines.push(`Tasks: ${active.length} active, ${backlog.length} in backlog`);
    if (active.length > 0) {
      lines.push('Active: ' + active.map(t => t.id + ' - ' + t.title).join(', '));
    }
  }

  if (plan) {
    const planPreview = plan.split('\n').slice(0, 8).join('\n');
    lines.push('--- Current Plan ---');
    lines.push(planPreview);
  }

  if (!tasks && !plan && !summary) {
    lines.push('No project context found. This appears to be a new project.');
    lines.push('Recommended: Run /session-init to set up context.');
  }

  lines.push('======================');
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

main();
