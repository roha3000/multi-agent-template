#!/usr/bin/env node
/**
 * UserPromptSubmit Hook - Validate prompts in audit mode
 */

const fs = require('fs');
const path = require('path');

// Debug logging for parallel crash investigation
const debug = require('./hook-debug');
debug.log('validate-prompt', 'load', { pid: process.pid });

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SECURITY_VALIDATOR_PATH = path.join(PROJECT_ROOT, '.claude/core/security-validator.js');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
    input += chunk;
    debug.log('validate-prompt', 'stdin-data', { chunkLen: chunk.length });
});
process.stdin.on('end', () => {
    debug.log('validate-prompt', 'stdin-end', { inputLen: input.length });
    try {
        const data = JSON.parse(input);
        const prompt = data.prompt || '';

        debug.log('validate-prompt', 'parsed', { promptLen: prompt.length });

        if (fs.existsSync(SECURITY_VALIDATOR_PATH)) {
            debug.log('validate-prompt', 'validator-loading', {});
            const SecurityValidator = require(SECURITY_VALIDATOR_PATH);
            const validator = new SecurityValidator({ mode: 'audit' });
            const result = validator.validate(prompt, 'description');

            debug.log('validate-prompt', 'validated', { threats: result.threats?.length || 0 });

            if (result.threats && result.threats.length > 0) {
                console.error(`[Security Audit] ${result.threats.length} potential threat(s) detected`);
            }
        }
        debug.log('validate-prompt', 'done', {});
    } catch (err) {
        debug.log('validate-prompt', 'error', { error: err.message });
        // Silent fail in audit mode
    }
    process.exit(0);
});
