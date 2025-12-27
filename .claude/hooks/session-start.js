#!/usr/bin/env node
/**
 * SessionStart Hook - Load project context and initialize swarm
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const TASKS_JSON = path.join(PROJECT_ROOT, '.claude/dev-docs/tasks.json');

function loadTasksContext() {
    try {
        if (!fs.existsSync(TASKS_JSON)) {
            return { status: 'no_tasks', message: 'No tasks.json found' };
        }
        const data = JSON.parse(fs.readFileSync(TASKS_JSON, 'utf8'));
        const nowTasks = data.backlog?.now?.tasks || [];
        return {
            status: 'loaded',
            totalTasks: Object.keys(data.tasks || {}).length,
            nowQueue: nowTasks.length
        };
    } catch (error) {
        return { status: 'error', message: error.message };
    }
}

const context = loadTasksContext();
console.log('\n=== Session Context ===');
console.log(`Tasks: ${context.totalTasks || 0} total, ${context.nowQueue || 0} in NOW queue`);
console.log('========================\n');
process.exit(0);
