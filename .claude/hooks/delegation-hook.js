#!/usr/bin/env node
/**
 * UserPromptSubmit Hook - Delegation Analysis
 *
 * Analyzes user prompts and injects delegation hints into the conversation.
 * Part of the auto-delegation integration (Phase 1).
 *
 * This hook:
 * 1. Reads user prompt from stdin
 * 2. Analyzes complexity and potential for delegation
 * 3. Outputs hint to stdout (injected into conversation)
 *
 * Performance target: < 200ms total execution
 *
 * @module hooks/delegation-hook
 */

const fs = require('fs');
const path = require('path');

// Debug logging for development
const debug = require('./hook-debug');
debug.log('delegation-hook', 'load', { pid: process.pid });

// Import delegation bridge (lightweight analysis)
const { getQuickHint, formatHintForStdout, loadConfig } = require('../core/delegation-bridge');

const startTime = Date.now();

/**
 * Read user prompt from stdin
 * Claude Code provides prompt data as JSON
 */
function readStdin() {
  return new Promise((resolve) => {
    let data = '';

    // Timeout for safety (hooks should be fast)
    const timeout = setTimeout(() => {
      debug.log('delegation-hook', 'stdin-timeout', { dataLen: data.length });
      resolve(null);
    }, 500);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      clearTimeout(timeout);
      try {
        const parsed = JSON.parse(data);
        debug.log('delegation-hook', 'stdin-parsed', {
          hasPrompt: !!parsed.prompt,
          promptLen: parsed.prompt?.length || 0
        });
        resolve(parsed);
      } catch (e) {
        debug.log('delegation-hook', 'stdin-parse-error', { error: e.message });
        resolve(null);
      }
    });
    process.stdin.on('error', (err) => {
      clearTimeout(timeout);
      debug.log('delegation-hook', 'stdin-error', { error: err.message });
      resolve(null);
    });

    process.stdin.resume();
  });
}

/**
 * Main entry point
 */
async function main() {
  debug.log('delegation-hook', 'main-start', {});

  try {
    // Check config first (fast operation)
    const config = loadConfig();
    if (!config.enabled) {
      debug.log('delegation-hook', 'disabled', {});
      process.exit(0);
      return;
    }

    // Read prompt from stdin
    const input = await readStdin();

    if (!input || !input.prompt) {
      debug.log('delegation-hook', 'no-prompt', {});
      process.exit(0);
      return;
    }

    const prompt = input.prompt;

    // Get quick delegation hint
    const analysis = getQuickHint(prompt, {
      sessionId: input.session_id || null,
      cwd: input.cwd || process.cwd()
    });

    // Format for stdout if applicable
    const hint = formatHintForStdout(analysis);

    const duration = Date.now() - startTime;
    debug.log('delegation-hook', 'analysis-complete', {
      shouldConsider: analysis.shouldConsiderDelegation,
      complexity: analysis.factors?.complexity,
      subtasks: analysis.factors?.subtaskCount,
      hasHint: !!hint,
      duration
    });

    // Output hint to stdout (injected into conversation)
    if (hint) {
      console.log(hint);
    }

    // Log performance warning if slow
    if (duration > 200) {
      debug.log('delegation-hook', 'slow-execution', { duration });
    }

  } catch (error) {
    debug.log('delegation-hook', 'error', {
      error: error.message,
      stack: error.stack?.split('\n').slice(0, 3).join(' | ')
    });
    // Silent fail - don't disrupt user experience
  }

  process.exit(0);
}

main();
