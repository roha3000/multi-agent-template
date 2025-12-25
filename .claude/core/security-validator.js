/**
 * SecurityValidator - Protects the autonomous orchestrator from security threats
 *
 * Provides comprehensive security validation for:
 * - Prompt injection attacks
 * - Path traversal attacks
 * - Command injection
 *
 * @module SecurityValidator
 */

const EventEmitter = require('events');
const path = require('path');

const VALID_PHASES = ['research', 'planning', 'design', 'implementation', 'testing', 'validation', 'iteration', 'complete'];

const ALLOWED_COMMANDS = [
  'npm test', 'npm run test', 'pytest', 'jest', 'npm run lint',
  'npm run build', 'npm run dev', 'npm start', 'node', 'npx jest', 'npx pytest'
];

const BLOCKED_COMMANDS = [
  'rm', 'del', 'curl', 'wget', 'eval', 'exec', 'sudo', 'chmod', 'chown',
  'mkfs', 'dd', 'format', 'powershell', 'cmd /c', 'bash -c', 'sh -c',
  '&&', '||', ';', '|', '`', '$(', 'nc', 'netcat', 'telnet'
];

const SENSITIVE_FILES = [
  '.env', '.env.local', '.env.production', 'credentials', 'secrets', 'private',
  'id_rsa', 'id_ed25519', '.ssh', '.gnupg', 'password', 'token', 'apikey', 'api_key'
];

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(all\s+)?(previous|prior|above|earlier|your)\s+(instructions?|prompts?|training)/i,
  /forget\s+(all\s+)?(previous|prior|above|earlier|your)\s+(instructions?|prompts?|context)/i,
  /override\s+(all\s+)?(previous|prior|system)\s+(instructions?|prompts?|settings?)/i,
  /you\s+are\s+now\s+(a|an|the)\s+/i,
  /act\s+as\s+(a|an|if\s+you\s+were)/i,
  /roleplay\s+as/i, /pretend\s+(to\s+be|you\s+are)/i,
  /show\s+(me\s+)?(your|the)\s+(system\s+)?prompt/i,
  /reveal\s+(your|the)\s+(system\s+)?instructions/i,
  /\bDAN\b.*mode/i, /developer\s+mode\s+(enabled|activated|on)/i,
  /jailbreak/i, /bypass\s+(your|the|all)\s+(restrictions?|filters?|safety)/i,
  /\[SYSTEM\]/i, /\[INST\]/i, /<<SYS>>/i
];

const UNICODE_OBFUSCATION = {
  homoglyphs: /[\u0430\u0435\u043E\u0440\u0441\u0443\u0445\u0410\u0412\u0415\u041A\u041C\u041D\u041E\u0420\u0421\u0422\u0425]/,
  zeroWidth: /[\u200B\u200C\u200D\uFEFF\u00AD]/,
  rtlOverride: /[\u202E\u202D\u202C\u202B\u202A]/
};

class SecurityValidator extends EventEmitter {
  constructor(options = {}) {
    super();
    this.mode = options.mode || 'enforce';
    this.projectRoot = path.resolve(options.projectRoot || process.cwd());
    this.maxDescriptionLength = options.maxDescriptionLength || 5000;
    this.logThreats = options.logThreats !== false;
    this.additionalAllowedCommands = options.additionalAllowedCommands || [];
    this.stats = {
      totalValidations: 0, threatsDetected: 0, requestsBlocked: 0,
      threatsByType: { promptInjection: 0, pathTraversal: 0, commandInjection: 0, inputValidation: 0, unicodeObfuscation: 0 }
    };
    this.threatLog = [];
  }

  validate(input, type = 'task') {
    this.stats.totalValidations++;
    try {
      switch (type) {
        case 'task': return this._validateTask(input);
        case 'taskId': return this._validateTaskId(input);
        case 'description': return this._validateDescription(input);
        case 'phase': return this._validatePhase(input);
        default: return this._validateGenericInput(input);
      }
    } catch (error) {
      this._recordThreat('inputValidation', input, `Validation error: ${error.message}`);
      return { valid: false, sanitized: null, threats: [{ type: 'error', message: error.message }] };
    }
  }

  _validateTask(task) {
    const threats = [], sanitized = {};
    if (!task || typeof task !== 'object') {
      threats.push({ type: 'inputValidation', message: 'Task must be an object' });
      return this._createResult(false, null, threats);
    }
    if (task.taskId !== undefined) {
      const result = this._validateTaskId(task.taskId);
      if (!result.valid) threats.push(...result.threats);
      sanitized.taskId = result.sanitized;
    }
    if (task.description !== undefined) {
      const result = this._validateDescription(task.description);
      if (!result.valid) threats.push(...result.threats);
      sanitized.description = result.sanitized;
    }
    if (task.phase !== undefined) {
      const result = this._validatePhase(task.phase);
      if (!result.valid) threats.push(...result.threats);
      sanitized.phase = result.sanitized;
    }
    ['priority', 'timeout', 'retries', 'metadata'].forEach(prop => {
      if (task[prop] !== undefined) sanitized[prop] = task[prop];
    });
    return this._createResult(threats.length === 0, sanitized, threats);
  }

  _validateTaskId(taskId) {
    const threats = [];
    if (typeof taskId !== 'string') {
      threats.push({ type: 'inputValidation', message: 'Task ID must be a string' });
      return this._createResult(false, null, threats);
    }
    if (taskId.includes('\0')) {
      this._recordThreat('inputValidation', taskId, 'Null byte in task ID');
      threats.push({ type: 'inputValidation', message: 'Task ID contains null bytes' });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) {
      this._recordThreat('inputValidation', taskId, 'Invalid characters in task ID');
      threats.push({ type: 'inputValidation', message: 'Task ID contains invalid characters' });
    }
    if (taskId.length > 100) threats.push({ type: 'inputValidation', message: 'Task ID exceeds maximum length' });
    return this._createResult(threats.length === 0, taskId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100), threats);
  }

  _validateDescription(description) {
    const threats = [];
    if (typeof description !== 'string') {
      threats.push({ type: 'inputValidation', message: 'Description must be a string' });
      return this._createResult(false, null, threats);
    }
    if (description.includes('\0')) threats.push({ type: 'inputValidation', message: 'Description contains null bytes' });
    if (description.length > this.maxDescriptionLength) threats.push({ type: 'inputValidation', message: `Description exceeds maximum length` });
    threats.push(...this._detectUnicodeObfuscation(description));
    threats.push(...this._detectPromptInjection(description));
    let sanitized = description.replace(/\0/g, '').slice(0, this.maxDescriptionLength);
    sanitized = sanitized.replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, '');
    return this._createResult(threats.length === 0, sanitized, threats);
  }

  _validatePhase(phase) {
    const threats = [];
    if (typeof phase !== 'string') {
      threats.push({ type: 'inputValidation', message: 'Phase must be a string' });
      return this._createResult(false, null, threats);
    }
    const normalized = phase.toLowerCase().trim();
    if (!VALID_PHASES.includes(normalized)) {
      threats.push({ type: 'inputValidation', message: `Invalid phase "${phase}"` });
      return this._createResult(false, null, threats);
    }
    return this._createResult(true, normalized, threats);
  }

  _validateGenericInput(input) {
    const threats = [];
    if (typeof input !== 'string') return this._createResult(true, input, threats);
    threats.push(...this._detectUnicodeObfuscation(input));
    threats.push(...this._detectPromptInjection(input));
    return this._createResult(threats.length === 0, input.replace(/[\u200B\u200C\u200D\uFEFF\u00AD\0]/g, ''), threats);
  }

  _detectPromptInjection(text) {
    const threats = [];
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        this._recordThreat('promptInjection', text.slice(0, 200), `Pattern matched: ${pattern}`);
        threats.push({ type: 'promptInjection', message: 'Potential prompt injection detected', pattern: pattern.toString() });
      }
    }
    return threats;
  }

  _detectUnicodeObfuscation(text) {
    const threats = [];
    for (const [type, pattern] of Object.entries(UNICODE_OBFUSCATION)) {
      if (pattern.test(text)) {
        this._recordThreat('unicodeObfuscation', text.slice(0, 100), `${type} detected`);
        threats.push({ type: 'unicodeObfuscation', message: `Unicode obfuscation detected: ${type}`, category: type });
      }
    }
    return threats;
  }

  validatePath(filePath) {
    const threats = [];
    if (typeof filePath !== 'string') {
      threats.push({ type: 'pathValidation', message: 'Path must be a string' });
      return this._createResult(false, null, threats);
    }
    if (filePath.includes('\0')) {
      this._recordThreat('pathTraversal', filePath, 'Null byte in path');
      threats.push({ type: 'pathTraversal', message: 'Path contains null bytes' });
      return this._createResult(false, null, threats);
    }
    const traversalPatterns = [/\.\.\//g, /\.\.\\/g, /%2e%2e/gi, /%252e%252e/gi];
    for (const pattern of traversalPatterns) {
      if (pattern.test(filePath)) {
        this._recordThreat('pathTraversal', filePath, `Traversal pattern: ${pattern}`);
        threats.push({ type: 'pathTraversal', message: 'Directory traversal attempt detected' });
      }
    }
    let normalizedPath;
    try {
      normalizedPath = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(this.projectRoot, filePath);
    } catch (e) {
      threats.push({ type: 'pathValidation', message: `Path resolution failed: ${e.message}` });
      return this._createResult(false, null, threats);
    }
    const relative = path.relative(this.projectRoot, normalizedPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      this._recordThreat('pathTraversal', filePath, 'Path escapes project root');
      threats.push({ type: 'pathTraversal', message: 'Path is outside project directory' });
    }
    const lowerPath = filePath.toLowerCase();
    for (const sensitive of SENSITIVE_FILES) {
      if (lowerPath.includes(sensitive.toLowerCase())) {
        this._recordThreat('pathTraversal', filePath, `Sensitive file access: ${sensitive}`);
        threats.push({ type: 'pathTraversal', message: `Access to sensitive file blocked: ${sensitive}` });
      }
    }
    return this._createResult(threats.length === 0, threats.length === 0 ? normalizedPath : null, threats);
  }

  validateCommand(cmd) {
    const threats = [];
    if (typeof cmd !== 'string') {
      threats.push({ type: 'commandValidation', message: 'Command must be a string' });
      return { valid: false, allowed: false, threats };
    }
    const normalizedCmd = cmd.trim().toLowerCase();
    for (const blocked of BLOCKED_COMMANDS) {
      const blockPattern = new RegExp(`(^|\\s|[/\\\\])${blocked.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$|[/\\\\]|[^a-z])`, 'i');
      if (blockPattern.test(cmd) || normalizedCmd.includes(blocked)) {
        this._recordThreat('commandInjection', cmd, `Blocked command: ${blocked}`);
        threats.push({ type: 'commandInjection', message: `Command contains blocked pattern: ${blocked}`, blockedPattern: blocked });
      }
    }
    const allAllowed = [...ALLOWED_COMMANDS, ...this.additionalAllowedCommands];
    const isAllowed = allAllowed.some(allowed => normalizedCmd.startsWith(allowed.toLowerCase()));
    if (!isAllowed && threats.length === 0) {
      threats.push({ type: 'commandInjection', message: 'Command not in allowlist', command: cmd });
    }
    const shellPatterns = [/`[^`]+`/, /\$\([^)]+\)/, /\$\{[^}]+\}/, /[;&|]{2}/];
    for (const pattern of shellPatterns) {
      if (pattern.test(cmd)) {
        this._recordThreat('commandInjection', cmd, `Shell injection pattern: ${pattern}`);
        threats.push({ type: 'commandInjection', message: 'Shell injection pattern detected' });
      }
    }
    return { valid: threats.length === 0, allowed: threats.length === 0, threats };
  }

  setMode(mode) {
    if (mode !== 'enforce' && mode !== 'audit') throw new Error(`Invalid mode "${mode}". Must be "enforce" or "audit"`);
    this.mode = mode;
    this.emit('mode:changed', mode);
  }

  getMode() { return this.mode; }
  getStats() { return { ...this.stats }; }
  getThreatLog(limit) { return limit ? this.threatLog.slice(-limit) : [...this.threatLog]; }
  clearThreatLog() { this.threatLog = []; }
  resetStats() {
    this.stats = { totalValidations: 0, threatsDetected: 0, requestsBlocked: 0,
      threatsByType: { promptInjection: 0, pathTraversal: 0, commandInjection: 0, inputValidation: 0, unicodeObfuscation: 0 }
    };
  }

  _recordThreat(type, input, details) {
    this.stats.threatsDetected++;
    if (this.stats.threatsByType[type] !== undefined) this.stats.threatsByType[type]++;
    const entry = { timestamp: new Date().toISOString(), type, input: String(input).slice(0, 200), details, mode: this.mode };
    this.threatLog.push(entry);
    if (this.threatLog.length > 1000) this.threatLog = this.threatLog.slice(-500);
    this.emit('security:threat', entry);
    if (this.mode === 'enforce') { this.stats.requestsBlocked++; this.emit('security:blocked', entry); }
    if (this.logThreats) console.warn(`[SecurityValidator] ${this.mode.toUpperCase()}: ${type} - ${details}`);
  }

  _createResult(valid, sanitized, threats) {
    const effectiveValid = this.mode === 'audit' ? true : valid;
    return { valid: effectiveValid, sanitized, threats, mode: this.mode, blocked: this.mode === 'enforce' && !valid };
  }

  validateBatch(inputs) {
    const results = [], allThreats = [];
    let allValid = true;
    for (const { input, type } of inputs) {
      const result = this.validate(input, type);
      results.push(result);
      allThreats.push(...result.threats);
      if (!result.valid) allValid = false;
    }
    return { valid: allValid, results, threats: allThreats, mode: this.mode };
  }
}

module.exports = SecurityValidator;
