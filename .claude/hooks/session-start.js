#!/usr/bin/env node
/**
 * SessionStart Hook - Load project context and initialize swarm
 */

const fs = require('fs');
const path = require('path');

// Debug logging for parallel crash investigation
const debug = require('./hook-debug');
debug.log('session-start', 'load', { pid: process.pid, ppid: process.ppid });

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const TASKS_JSON = path.join(PROJECT_ROOT, '.claude/dev-docs/tasks.json');

function loadTasksContext() {
    debug.log('session-start', 'loadTasks-start', { path: TASKS_JSON });
    try {
        if (!fs.existsSync(TASKS_JSON)) {
            debug.log('session-start', 'loadTasks-nofile', {});
            return { status: 'no_tasks', message: 'No tasks.json found' };
        }
        debug.log('session-start', 'loadTasks-reading', {});
        const data = JSON.parse(fs.readFileSync(TASKS_JSON, 'utf8'));
        const nowTasks = data.backlog?.now?.tasks || [];
        const result = {
            status: 'loaded',
            totalTasks: Object.keys(data.tasks || {}).length,
            nowQueue: nowTasks.length
        };
        debug.log('session-start', 'loadTasks-success', result);
        return result;
    } catch (error) {
        debug.log('session-start', 'loadTasks-error', { error: error.message });
        return { status: 'error', message: error.message };
    }
}

debug.log('session-start', 'calling-loadTasks', {});
const context = loadTasksContext();
console.log('\n=== Session Context ===');
console.log(`Tasks: ${context.totalTasks || 0} total, ${context.nowQueue || 0} in NOW queue`);
console.log('========================\n');
debug.log('session-start', 'exit', { context });
process.exit(0);
