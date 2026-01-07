/**
 * Project Key Translation Utilities
 *
 * Provides unified project key handling for GlobalContextTracker and SessionRegistry.
 *
 * Two formats exist:
 * - ENCODED: Used by GlobalContextTracker (C--Users-roha3-...)
 * - NORMALIZED: Used by SessionRegistry (c:/users/roha3/...)
 */

const path = require('path');

/**
 * Convert path to GlobalContextTracker encoded format
 * @param {string} projectPath - Absolute or relative project path
 * @returns {string} Encoded key (C--Users-roha3-...)
 */
function encodeProjectKey(projectPath) {
  if (!projectPath) {
    return 'default-project';
  }
  // Normalize path separators and resolve to absolute path
  const normalized = path.resolve(projectPath).replace(/\\/g, '/');
  // Create a safe folder name by encoding special characters
  return normalized.replace(/[:/\\]/g, '-');
}

/**
 * Convert path to SessionRegistry normalized format
 * @param {string} projectPath - Absolute or relative project path
 * @returns {string} Normalized key (c:/users/roha3/...)
 */
function normalizeProjectKey(projectPath) {
  if (!projectPath) {
    return 'default-project';
  }
  // Normalize to absolute path with forward slashes, lowercase
  return path.resolve(projectPath).toLowerCase().replace(/\\/g, '/');
}

/**
 * Detect format of a project key
 * @param {string} key - Project key to analyze
 * @returns {'encoded'|'normalized'|'unknown'} Detected format
 */
function detectKeyFormat(key) {
  if (!key || typeof key !== 'string') {
    return 'unknown';
  }

  // Check for encoded format (no : or / or \, has -)
  if (!key.includes(':') && !key.includes('/') && !key.includes('\\') && key.includes('-')) {
    return 'encoded';
  }

  // Check for normalized format (has : or /, lowercase)
  if ((key.includes(':') || key.includes('/')) && key === key.toLowerCase()) {
    return 'normalized';
  }

  return 'unknown';
}

/**
 * Translate project key between formats
 * @param {string} key - Source project key
 * @param {'encoded'|'normalized'} targetFormat - Target format
 * @returns {string} Translated key
 */
function translateProjectKey(key, targetFormat) {
  if (!key || typeof key !== 'string') {
    return 'default-project';
  }

  const currentFormat = detectKeyFormat(key);

  // If already in target format, return as-is
  if (currentFormat === targetFormat) {
    return key;
  }

  // Decode if needed
  let decodedPath = key;
  if (currentFormat === 'encoded') {
    // Convert encoded back to path: C--Users-roha3-... -> C:/Users/roha3/...
    decodedPath = key.replace(/^([A-Z])-/, '$1:/')  // First dash after drive letter becomes :/
                    .replace(/-/g, '/');            // Remaining dashes become /
  }

  // Now convert to target format
  if (targetFormat === 'encoded') {
    return encodeProjectKey(decodedPath);
  } else {
    return normalizeProjectKey(decodedPath);
  }
}

/**
 * Get both key formats for a project path
 * @param {string} projectPath - Project path
 * @returns {{encoded: string, normalized: string}} Both key formats
 */
function getProjectKeys(projectPath) {
  return {
    encoded: encodeProjectKey(projectPath),
    normalized: normalizeProjectKey(projectPath)
  };
}

/**
 * Check if two project keys refer to the same project
 * @param {string} key1 - First project key
 * @param {string} key2 - Second project key
 * @returns {boolean} True if keys refer to same project
 */
function isSameProject(key1, key2) {
  if (!key1 || !key2) {
    return false;
  }

  // Normalize both to the same format and compare
  const normalized1 = translateProjectKey(key1, 'normalized');
  const normalized2 = translateProjectKey(key2, 'normalized');

  return normalized1 === normalized2;
}

module.exports = {
  encodeProjectKey,
  normalizeProjectKey,
  detectKeyFormat,
  translateProjectKey,
  getProjectKeys,
  isSameProject
};
