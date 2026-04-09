#!/usr/bin/env node
/**
 * PostToolUse Hook - Track tool execution for auditing
 * Reads stdin for tool use data, appends a one-line summary to tool-audit.log.
 * Always exits 0, never blocks.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const AUDIT_LOG = path.join(PROJECT_ROOT, '.claude/logs/tool-audit.log');

// Extract a human-readable summary of what the tool did
function getToolSummary(toolName, toolInput) {
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
    case 'TodoWrite': {
      const count = input.todos?.length || 0;
      return `${count} todo(s)`;
    }
    default: {
      const firstVal = Object.values(input).find(v => typeof v === 'string');
      return truncate(firstVal || '');
    }
  }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });

process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || 'unknown';
    const summary = getToolSummary(toolName, data.tool_input);
    const timestamp = new Date().toISOString();
    const success = !data.tool_response?.error;
    const logLine = `[${timestamp}] ${toolName} | ${success ? 'OK' : 'ERR'} | ${summary}\n`;

    const logDir = path.dirname(AUDIT_LOG);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(AUDIT_LOG, logLine);
  } catch (err) {
    // Silent fail - never block
  }
  process.exit(0);
});

process.stdin.on('error', () => { process.exit(0); });
