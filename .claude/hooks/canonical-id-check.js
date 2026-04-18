#!/usr/bin/env node
/**
 * Canonical ID Check - Session-start warning for tasks missing canonicalId
 *
 * Part of CC-ALIGN-001 (single-source-of-truth alignment).
 *
 * GitHub issues are the canonical source of truth for task state.
 * Every task in tasks.json SHOULD reference a canonical GitHub issue via
 * the `canonicalId` field (format: "<owner>/<repo>#<issue-number>", e.g.
 * "roha3000/ops#6").
 *
 * This module inspects .claude/dev-docs/tasks.json and emits a warning
 * listing any tasks that lack a canonicalId. It is intended to be called
 * from the session-start hook so Claude Code sessions surface the drift
 * immediately rather than letting local peer backlog authority silently
 * emerge.
 *
 * Non-fatal: this only warns; it never blocks session start.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const TASKS_JSON = path.join(PROJECT_ROOT, '.claude/dev-docs/tasks.json');

/**
 * Check all tasks in tasks.json for a canonicalId field.
 * Returns { checked, missing, invalid } where missing/invalid are task-id arrays.
 */
function checkCanonicalIds(tasksJsonPath = TASKS_JSON) {
  const result = { checked: 0, missing: [], invalid: [], fileFound: false };

  if (!fs.existsSync(tasksJsonPath)) {
    return result;
  }
  result.fileFound = true;

  let data;
  try {
    data = JSON.parse(fs.readFileSync(tasksJsonPath, 'utf8'));
  } catch (err) {
    result.parseError = err.message;
    return result;
  }

  const tasks = data.tasks || {};
  // Format: owner/repo#number (e.g. roha3000/ops#6)
  const canonicalIdPattern = /^[\w.-]+\/[\w.-]+#\d+$/;

  for (const [taskId, task] of Object.entries(tasks)) {
    result.checked += 1;
    const canonicalId = task && task.canonicalId;
    if (canonicalId === undefined || canonicalId === null || canonicalId === '') {
      result.missing.push(taskId);
    } else if (typeof canonicalId !== 'string' || !canonicalIdPattern.test(canonicalId)) {
      result.invalid.push({ taskId, canonicalId });
    }
  }

  return result;
}

/**
 * Format the check result as a human-readable warning string.
 * Returns null if there is nothing to warn about.
 */
function formatWarning(result) {
  if (!result.fileFound) return null;
  if (result.parseError) {
    return `[canonical-id-check] Could not parse tasks.json: ${result.parseError}`;
  }
  const problems = result.missing.length + result.invalid.length;
  if (problems === 0) return null;

  const lines = [];
  lines.push('=== Canonical ID Warning ===');
  lines.push('GitHub issues are the source of truth. tasks.json is non-canonical.');
  if (result.missing.length > 0) {
    lines.push(`Tasks missing canonicalId (${result.missing.length}):`);
    for (const id of result.missing.slice(0, 10)) {
      lines.push(`  - ${id}`);
    }
    if (result.missing.length > 10) {
      lines.push(`  ... and ${result.missing.length - 10} more`);
    }
  }
  if (result.invalid.length > 0) {
    lines.push(`Tasks with invalid canonicalId (expected "owner/repo#N"):`);
    for (const { taskId, canonicalId } of result.invalid.slice(0, 10)) {
      lines.push(`  - ${taskId}: ${JSON.stringify(canonicalId)}`);
    }
  }
  lines.push('Fix: add canonicalId to each task, or file a GitHub issue first.');
  lines.push('============================');
  return lines.join('\n');
}

// CLI entry point (also usable standalone: `node .claude/hooks/canonical-id-check.js`)
if (require.main === module) {
  const result = checkCanonicalIds();
  const warning = formatWarning(result);
  if (warning) {
    console.warn(warning);
  }
  // Exit 0 always - this is a warning, not a failure.
  process.exit(0);
}

module.exports = { checkCanonicalIds, formatWarning };
