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
// Extract a human-readable summary of what the tool did
function getToolSummary(toolName, toolInput, toolResponse) {
    const input = toolInput || {};
    const maxLen = 80;
    const truncate = (s) => s && s.length > maxLen ? s.slice(0, maxLen) + '...' : s;

    switch (toolName) {
        case 'Read':
            return truncate(input.file_path || input.path || '');
        case 'Write':
            return truncate(input.file_path || input.path || '');
        case 'Edit':
            return truncate(input.file_path || input.path || '');
        case 'Bash':
            return truncate(input.command || '');
        case 'Glob':
            return truncate(input.pattern || '');
        case 'Grep':
            return truncate(`${input.pattern || ''} in ${input.path || '.'}`);
        case 'Task':
            return truncate(input.description || input.prompt?.slice(0, 50) || '');
        case 'WebFetch':
            return truncate(input.url || '');
        case 'WebSearch':
            return truncate(input.query || '');
        case 'LSP':
            return truncate(`${input.operation || ''} ${input.filePath || ''}`);
        case 'TodoWrite':
            const count = input.todos?.length || 0;
            return `${count} todo(s)`;
        default:
            // Try to get first string value from input
            const firstVal = Object.values(input).find(v => typeof v === 'string');
            return truncate(firstVal || '');
    }
}

process.stdin.on('end', () => {
    debug.log('track-progress', 'stdin-end', { inputLen: input.length });
    try {
        const data = JSON.parse(input);
        const toolName = data.tool_name || 'unknown';
        const summary = getToolSummary(toolName, data.tool_input, data.tool_response);

        const entry = {
            timestamp: new Date().toISOString(),
            tool: toolName,
            summary: summary,
            success: !data.tool_response?.error,
            sessionId: data.session_id || process.env.CLAUDE_SESSION_ID || null,
            cwd: data.cwd || process.cwd()
        };

        debug.log('track-progress', 'writing', { tool: entry.tool, summary: entry.summary, sessionId: entry.sessionId, logPath: AUDIT_LOG });

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
