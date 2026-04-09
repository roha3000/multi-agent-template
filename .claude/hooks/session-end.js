#!/usr/bin/env node
/**
 * SessionEnd Hook - Log session completion
 * Appends a line to .claude/logs/sessions.log
 */

const fs = require('fs');
const path = require('path');

function main() {
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '../..');
  const logsDir = path.join(projectRoot, '.claude/logs');
  const logPath = path.join(logsDir, 'sessions.log');

  try {
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] Session ended\n`;
    fs.appendFileSync(logPath, logLine);
  } catch (e) {
    process.stderr.write(`[session-end] Failed to write session log: ${e.message}\n`);
    // Still exit 0 — never block session end
  }

  process.exit(0);
}

main();
