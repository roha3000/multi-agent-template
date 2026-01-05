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

// Extract full detail for expanded view (capped at reasonable size)
function getToolDetail(toolName, toolInput, toolResponse) {
    const input = toolInput || {};
    const maxDetailLen = 5000; // Cap detail at 5KB to avoid bloating logs
    const truncateDetail = (s) => s && s.length > maxDetailLen ? s.slice(0, maxDetailLen) + '\n... (truncated)' : s;

    const detail = {};

    switch (toolName) {
        case 'Read':
            detail.file = input.file_path || input.path || '';
            detail.offset = input.offset;
            detail.limit = input.limit;
            break;
        case 'Write':
            detail.file = input.file_path || input.path || '';
            detail.content = truncateDetail(input.content || '');
            break;
        case 'Edit':
            detail.file = input.file_path || input.path || '';
            detail.old_string = truncateDetail(input.old_string || '');
            detail.new_string = truncateDetail(input.new_string || '');
            detail.replace_all = input.replace_all;
            break;
        case 'Bash':
            detail.command = input.command || '';
            detail.timeout = input.timeout;
            detail.description = input.description;
            break;
        case 'Glob':
            detail.pattern = input.pattern || '';
            detail.path = input.path;
            break;
        case 'Grep':
            detail.pattern = input.pattern || '';
            detail.path = input.path || '.';
            detail.glob = input.glob;
            detail.output_mode = input.output_mode;
            break;
        case 'Task':
            detail.description = input.description || '';
            detail.prompt = truncateDetail(input.prompt || '');
            detail.subagent_type = input.subagent_type;
            detail.model = input.model;
            break;
        case 'WebFetch':
            detail.url = input.url || '';
            detail.prompt = input.prompt;
            break;
        case 'WebSearch':
            detail.query = input.query || '';
            break;
        case 'TodoWrite':
            detail.todos = input.todos || [];
            break;
        default:
            // Include all input fields for unknown tools
            Object.entries(input).forEach(([k, v]) => {
                if (typeof v === 'string') {
                    detail[k] = truncateDetail(v);
                } else {
                    detail[k] = v;
                }
            });
    }

    // Remove undefined/null values
    Object.keys(detail).forEach(k => {
        if (detail[k] === undefined || detail[k] === null) delete detail[k];
    });

    return detail;
}

process.stdin.on('end', () => {
    debug.log('track-progress', 'stdin-end', { inputLen: input.length });
    try {
        const data = JSON.parse(input);
        const toolName = data.tool_name || 'unknown';
        const summary = getToolSummary(toolName, data.tool_input, data.tool_response);
        const detail = getToolDetail(toolName, data.tool_input, data.tool_response);

        const entry = {
            timestamp: new Date().toISOString(),
            tool: toolName,
            summary: summary,
            detail: detail,  // Full detail for expanded view
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
