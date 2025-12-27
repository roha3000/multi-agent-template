#!/usr/bin/env node
/**
 * UserPromptSubmit Hook - Validate prompts in audit mode
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SECURITY_VALIDATOR_PATH = path.join(PROJECT_ROOT, '.claude/core/security-validator.js');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
    try {
        const data = JSON.parse(input);
        const prompt = data.prompt || '';

        if (fs.existsSync(SECURITY_VALIDATOR_PATH)) {
            const SecurityValidator = require(SECURITY_VALIDATOR_PATH);
            const validator = new SecurityValidator({ mode: 'audit' });
            const result = validator.validate(prompt, 'description');

            if (result.threats && result.threats.length > 0) {
                console.error(`[Security Audit] ${result.threats.length} potential threat(s) detected`);
            }
        }
    } catch (err) {
        // Silent fail in audit mode
    }
    process.exit(0);
});
