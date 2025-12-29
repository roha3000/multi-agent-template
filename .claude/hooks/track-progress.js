#!/usr/bin/env node
/**
 * PostToolUse Hook - Track tool execution for auditing
 */

const fs = require('fs');
const path = require('path');

// Debug logging for parallel crash investigation
const debug = require('./hook-debug');
debug.log('track-progress', 'load', { pid: process.pid });

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const AUDIT_LOG = path.join(PROJECT_ROOT, '.claude/logs/tool-audit.jsonl');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
    input += chunk;
    debug.log('track-progress', 'stdin-data', { chunkLen: chunk.length });
});
process.stdin.on('end', () => {
    debug.log('track-progress', 'stdin-end', { inputLen: input.length });
    try {
        const data = JSON.parse(input);
        const entry = {
            timestamp: new Date().toISOString(),
            tool: data.tool_name || 'unknown',
            success: !data.tool_response?.error
        };

        debug.log('track-progress', 'writing', { tool: entry.tool, logPath: AUDIT_LOG });

        const logDir = path.dirname(AUDIT_LOG);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        fs.appendFileSync(AUDIT_LOG, JSON.stringify(entry) + '\n');
        debug.log('track-progress', 'written', { tool: entry.tool });
    } catch (err) {
        debug.log('track-progress', 'error', { error: err.message });
        // Silent fail
    }
    process.exit(0);
});
