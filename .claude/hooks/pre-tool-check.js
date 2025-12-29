#!/usr/bin/env node
/**
 * PreToolUse Hook - Check tool safety before execution
 * Exit 2 to block, Exit 0 to allow
 */

const fs = require('fs');
const path = require('path');

// Debug logging for parallel crash investigation
const debug = require('./hook-debug');
debug.log('pre-tool-check', 'load', { pid: process.pid });

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SECURITY_VALIDATOR_PATH = path.join(PROJECT_ROOT, '.claude/core/security-validator.js');

const dangerousPatterns = [
    /\brm\s+(-rf?|--recursive)\s+[\/\\]/i,
    /\bformat\s+[a-z]:/i,
    /\b(shutdown|reboot|halt)\b/i,
    /\bcurl.*\|\s*(bash|sh)\b/i,
    />\s*\/dev\/sd[a-z]/i
];

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
    input += chunk;
    debug.log('pre-tool-check', 'stdin-data', { chunkLen: chunk.length, totalLen: input.length });
});
process.stdin.on('end', () => {
    debug.log('pre-tool-check', 'stdin-end', { inputLen: input.length });
    try {
        const data = JSON.parse(input);
        const toolName = data.tool_name || '';
        const toolInput = data.tool_input || {};

        debug.log('pre-tool-check', 'parsed', { tool: toolName });

        if (toolName.toLowerCase() === 'bash') {
            const command = toolInput.command || '';
            for (const pattern of dangerousPatterns) {
                if (pattern.test(command)) {
                    debug.log('pre-tool-check', 'blocked', { reason: 'dangerous', pattern: String(pattern) });
                    console.error(`[Security] Blocked dangerous command: ${pattern}`);
                    process.exit(2);
                }
            }
        }

        // Check path traversal
        const filePath = toolInput.file_path || toolInput.path || '';
        if (filePath && filePath.includes('..')) {
            const resolved = path.resolve(PROJECT_ROOT, filePath);
            if (!resolved.startsWith(PROJECT_ROOT)) {
                debug.log('pre-tool-check', 'blocked', { reason: 'path-traversal', path: filePath });
                console.error('[Security] Blocked path traversal attempt');
                process.exit(2);
            }
        }

        debug.log('pre-tool-check', 'allowed', { tool: toolName });
    } catch (err) {
        debug.log('pre-tool-check', 'parse-error', { error: err.message });
        // Fail open on errors
    }
    process.exit(0);
});
