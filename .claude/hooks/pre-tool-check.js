#!/usr/bin/env node
/**
 * PreToolUse Hook - Check tool safety before execution
 * Exit 2 to block, Exit 0 to allow
 */

const fs = require('fs');
const path = require('path');

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
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
    try {
        const data = JSON.parse(input);
        const toolName = data.tool_name || '';
        const toolInput = data.tool_input || {};

        if (toolName.toLowerCase() === 'bash') {
            const command = toolInput.command || '';
            for (const pattern of dangerousPatterns) {
                if (pattern.test(command)) {
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
                console.error('[Security] Blocked path traversal attempt');
                process.exit(2);
            }
        }
    } catch (err) {
        // Fail open on errors
    }
    process.exit(0);
});
