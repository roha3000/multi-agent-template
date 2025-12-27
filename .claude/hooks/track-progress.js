#!/usr/bin/env node
/**
 * PostToolUse Hook - Track tool execution for auditing
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const AUDIT_LOG = path.join(PROJECT_ROOT, '.claude/logs/tool-audit.jsonl');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
    try {
        const data = JSON.parse(input);
        const entry = {
            timestamp: new Date().toISOString(),
            tool: data.tool_name || 'unknown',
            success: !data.tool_response?.error
        };

        const logDir = path.dirname(AUDIT_LOG);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        fs.appendFileSync(AUDIT_LOG, JSON.stringify(entry) + '\n');
    } catch (err) {
        // Silent fail
    }
    process.exit(0);
});
