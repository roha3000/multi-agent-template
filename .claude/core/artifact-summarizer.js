/**
 * Artifact Summarizer - Generates and caches artifact summaries
 *
 * Responsibilities:
 * - Summary generation with caching
 * - Token-limited summarization
 * - Cache management and invalidation
 * - Multiple summarization strategies
 *
 * @module artifact-summarizer
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Summary configuration
 */
const SUMMARY_CONFIG = {
  maxTokens: 300,           // Maximum tokens per summary
  charsPerToken: 4,         // Rough estimate
  cacheDir: 'summaries',    // Cache directory name
  maxCacheAge: 86400000,    // 24 hours in milliseconds
  strategies: {
    code: 'extractive',     // For code files
    markdown: 'structural', // For markdown files
    text: 'simple'          // For plain text
  }
};

class ArtifactSummarizer {
  /**
   * Creates an ArtifactSummarizer instance
   * @param {string} projectRoot - Absolute path to project root
   */
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.cacheDir = path.join(projectRoot, '.claude', 'state', SUMMARY_CONFIG.cacheDir);

    // Ensure cache directory exists
    this._ensureCacheDir();
  }

  /**
   * Ensures cache directory exists
   * @private
   */
  _ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Summarizes an artifact with caching
   * @param {string} artifactPath - Relative path to artifact
   * @param {Object} options - Summarization options
   * @returns {Object} Summary object
   */
  summarize(artifactPath, options = {}) {
    try {
      const fullPath = path.join(this.projectRoot, artifactPath);

      // Check if file exists
      if (!fs.existsSync(fullPath)) {
        return this._createErrorSummary(artifactPath, 'File not found');
      }

      // Check cache first
      const cached = this._loadFromCache(artifactPath, fullPath);
      if (cached && !options.forceFresh) {
        console.log(`[ArtifactSummarizer] Using cached summary for ${artifactPath}`);
        return cached;
      }

      // Generate new summary
      console.log(`[ArtifactSummarizer] Generating summary for ${artifactPath}`);
      const summary = this._generateSummary(artifactPath, fullPath, options);

      // Cache the summary
      this._saveToCache(artifactPath, fullPath, summary);

      return summary;

    } catch (error) {
      console.error(`[ArtifactSummarizer] Error summarizing ${artifactPath}:`, error.message);
      return this._createErrorSummary(artifactPath, error.message);
    }
  }

  /**
   * Generates summary for an artifact
   * @param {string} artifactPath - Relative path
   * @param {string} fullPath - Absolute path
   * @param {Object} options - Options
   * @returns {Object} Summary object
   * @private
   */
  _generateSummary(artifactPath, fullPath, options) {
    const content = fs.readFileSync(fullPath, 'utf8');
    const stats = fs.statSync(fullPath);
    const fileType = this._detectFileType(artifactPath);
    const strategy = options.strategy || SUMMARY_CONFIG.strategies[fileType] || 'simple';

    // Generate summary based on strategy
    let summaryText = '';
    let metadata = {};

    switch (strategy) {
      case 'extractive':
        ({ text: summaryText, metadata } = this._extractiveSummary(content, artifactPath));
        break;

      case 'structural':
        ({ text: summaryText, metadata } = this._structuralSummary(content, artifactPath));
        break;

      case 'simple':
      default:
        ({ text: summaryText, metadata } = this._simpleSummary(content, artifactPath));
        break;
    }

    // Ensure summary fits within token limit
    const maxChars = SUMMARY_CONFIG.maxTokens * SUMMARY_CONFIG.charsPerToken;
    if (summaryText.length > maxChars) {
      summaryText = summaryText.slice(0, maxChars) + '...';
    }

    return {
      path: artifactPath,
      summary: summaryText,
      strategy: strategy,
      fileType: fileType,
      size: stats.size,
      modified: stats.mtime.toISOString(),
      tokens: Math.ceil(summaryText.length / SUMMARY_CONFIG.charsPerToken),
      metadata: metadata,
      generated: new Date().toISOString()
    };
  }

  /**
   * Extractive summary strategy (for code files)
   * Extracts key elements: imports, classes, functions, exports
   * @param {string} content - File content
   * @param {string} artifactPath - File path
   * @returns {Object} Summary text and metadata
   * @private
   */
  _extractiveSummary(content, artifactPath) {
    const lines = content.split('\n');
    const extracted = [];
    const metadata = {
      imports: 0,
      exports: 0,
      functions: 0,
      classes: 0,
      comments: 0
    };

    // Extract file header comment if present
    const headerComment = this._extractHeaderComment(lines);
    if (headerComment) {
      extracted.push(headerComment);
      metadata.comments++;
    }

    // Extract imports/requires
    const imports = lines.filter(line => {
      const trimmed = line.trim();
      return trimmed.startsWith('import ') ||
             trimmed.startsWith('require(') ||
             trimmed.startsWith('from ') ||
             trimmed.includes('= require(');
    }).slice(0, 5); // Limit to first 5 imports

    if (imports.length > 0) {
      extracted.push('\n// Imports:');
      extracted.push(...imports);
      metadata.imports = imports.length;
    }

    // Extract class declarations
    const classes = lines.filter(line => {
      const trimmed = line.trim();
      return trimmed.startsWith('class ') ||
             trimmed.startsWith('export class ') ||
             trimmed.startsWith('export default class ');
    });

    if (classes.length > 0) {
      extracted.push('\n// Classes:');
      extracted.push(...classes);
      metadata.classes = classes.length;
    }

    // Extract function signatures (first 10)
    const functions = [];
    for (const line of lines) {
      const trimmed = line.trim();

      // Function declarations
      if (trimmed.startsWith('function ') ||
          trimmed.startsWith('async function ') ||
          trimmed.startsWith('export function ') ||
          trimmed.match(/^(const|let|var)\s+\w+\s*=\s*(async\s+)?(\(|\w+\s*=>)/)) {
        functions.push(line);
      }

      // Method declarations
      if (trimmed.match(/^(async\s+)?[\w]+\s*\([^)]*\)\s*{/) ||
          trimmed.match(/^(static\s+)?(async\s+)?[\w]+\s*\([^)]*\)\s*{/)) {
        functions.push(line);
      }

      if (functions.length >= 10) break;
    }

    if (functions.length > 0) {
      extracted.push('\n// Functions/Methods:');
      extracted.push(...functions);
      metadata.functions = functions.length;
    }

    // Extract exports
    const exports = lines.filter(line => {
      const trimmed = line.trim();
      return trimmed.startsWith('export ') ||
             trimmed.startsWith('module.exports') ||
             trimmed.includes('exports.');
    }).slice(0, 5);

    if (exports.length > 0) {
      extracted.push('\n// Exports:');
      extracted.push(...exports);
      metadata.exports = exports.length;
    }

    const text = `File: ${path.basename(artifactPath)}\n${extracted.join('\n')}`;
    return { text, metadata };
  }

  /**
   * Structural summary strategy (for markdown files)
   * Extracts headers and structure
   * @param {string} content - File content
   * @param {string} artifactPath - File path
   * @returns {Object} Summary text and metadata
   * @private
   */
  _structuralSummary(content, artifactPath) {
    const lines = content.split('\n');
    const structure = [];
    const metadata = {
      headers: {},
      codeBlocks: 0,
      lists: 0
    };

    let inCodeBlock = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Track code blocks
      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        if (inCodeBlock) metadata.codeBlocks++;
        continue;
      }

      // Skip content inside code blocks
      if (inCodeBlock) continue;

      // Extract headers
      if (trimmed.startsWith('#')) {
        const level = trimmed.match(/^#+/)[0].length;
        const title = trimmed.replace(/^#+\s*/, '');

        structure.push('  '.repeat(level - 1) + `${trimmed.slice(0, level)} ${title}`);

        if (!metadata.headers[`h${level}`]) {
          metadata.headers[`h${level}`] = 0;
        }
        metadata.headers[`h${level}`]++;
      }

      // Track lists
      if (trimmed.match(/^[-*+]\s/) || trimmed.match(/^\d+\.\s/)) {
        metadata.lists++;
      }
    }

    const text = `File: ${path.basename(artifactPath)}\nStructure:\n${structure.join('\n')}`;
    return { text, metadata };
  }

  /**
   * Simple summary strategy (first N lines + last N lines)
   * @param {string} content - File content
   * @param {string} artifactPath - File path
   * @returns {Object} Summary text and metadata
   * @private
   */
  _simpleSummary(content, artifactPath) {
    const lines = content.split('\n');
    const metadata = {
      totalLines: lines.length,
      estimatedTokens: Math.ceil(content.length / SUMMARY_CONFIG.charsPerToken)
    };

    // Take first 15 lines and last 5 lines
    const firstLines = lines.slice(0, 15);
    const lastLines = lines.length > 20 ? lines.slice(-5) : [];

    const parts = [
      `File: ${path.basename(artifactPath)} (${lines.length} lines)`,
      '',
      '--- Beginning ---',
      ...firstLines
    ];

    if (lastLines.length > 0) {
      parts.push('', `... (${lines.length - 20} lines omitted) ...`, '', '--- End ---', ...lastLines);
    }

    const text = parts.join('\n');
    return { text, metadata };
  }

  /**
   * Extracts header comment from file
   * @param {Array} lines - File lines
   * @returns {string|null} Header comment or null
   * @private
   */
  _extractHeaderComment(lines) {
    const headerLines = [];
    let inComment = false;

    for (const line of lines.slice(0, 30)) {
      const trimmed = line.trim();

      // Multi-line comment start
      if (trimmed.startsWith('/**') || trimmed.startsWith('/*')) {
        inComment = true;
        headerLines.push(line);
        continue;
      }

      // Multi-line comment end
      if (inComment && (trimmed.endsWith('*/') || trimmed.includes('*/'))) {
        headerLines.push(line);
        inComment = false;
        break;
      }

      // Inside multi-line comment
      if (inComment) {
        headerLines.push(line);
        continue;
      }

      // Single-line comments at top of file
      if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
        headerLines.push(line);
        continue;
      }

      // If we hit non-comment, non-empty line, stop
      if (trimmed.length > 0 && !inComment) {
        break;
      }
    }

    return headerLines.length > 0 ? headerLines.join('\n') : null;
  }

  /**
   * Detects file type from path
   * @param {string} artifactPath - File path
   * @returns {string} File type (code|markdown|text)
   * @private
   */
  _detectFileType(artifactPath) {
    const ext = path.extname(artifactPath).toLowerCase();

    const codeExts = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.go', '.rs', '.rb', '.php'];
    const markdownExts = ['.md', '.markdown'];

    if (codeExts.includes(ext)) return 'code';
    if (markdownExts.includes(ext)) return 'markdown';
    return 'text';
  }

  /**
   * Generates cache key for artifact
   * @param {string} artifactPath - Relative path
   * @param {string} fullPath - Absolute path
   * @returns {string} Cache key
   * @private
   */
  _getCacheKey(artifactPath, fullPath) {
    const stats = fs.statSync(fullPath);
    const mtime = stats.mtime.getTime();

    // Hash of path + modification time
    const hash = crypto.createHash('md5')
      .update(`${artifactPath}:${mtime}`)
      .digest('hex');

    return hash;
  }

  /**
   * Loads summary from cache
   * @param {string} artifactPath - Relative path
   * @param {string} fullPath - Absolute path
   * @returns {Object|null} Cached summary or null
   * @private
   */
  _loadFromCache(artifactPath, fullPath) {
    try {
      const cacheKey = this._getCacheKey(artifactPath, fullPath);
      const cachePath = path.join(this.cacheDir, `${cacheKey}.json`);

      if (!fs.existsSync(cachePath)) {
        return null;
      }

      // Check cache age
      const cacheStats = fs.statSync(cachePath);
      const cacheAge = Date.now() - cacheStats.mtime.getTime();

      if (cacheAge > SUMMARY_CONFIG.maxCacheAge) {
        // Cache too old, delete it
        fs.unlinkSync(cachePath);
        return null;
      }

      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      return cached;

    } catch (error) {
      console.error('[ArtifactSummarizer] Error loading from cache:', error.message);
      return null;
    }
  }

  /**
   * Saves summary to cache
   * @param {string} artifactPath - Relative path
   * @param {string} fullPath - Absolute path
   * @param {Object} summary - Summary object
   * @private
   */
  _saveToCache(artifactPath, fullPath, summary) {
    try {
      const cacheKey = this._getCacheKey(artifactPath, fullPath);
      const cachePath = path.join(this.cacheDir, `${cacheKey}.json`);

      fs.writeFileSync(cachePath, JSON.stringify(summary, null, 2), 'utf8');
      console.log(`[ArtifactSummarizer] Cached summary: ${cacheKey}`);

    } catch (error) {
      console.error('[ArtifactSummarizer] Error saving to cache:', error.message);
    }
  }

  /**
   * Creates error summary
   * @param {string} artifactPath - Artifact path
   * @param {string} errorMessage - Error message
   * @returns {Object} Error summary object
   * @private
   */
  _createErrorSummary(artifactPath, errorMessage) {
    return {
      path: artifactPath,
      summary: `Error: ${errorMessage}`,
      strategy: 'error',
      fileType: 'unknown',
      size: 0,
      modified: null,
      tokens: 10,
      metadata: { error: errorMessage },
      generated: new Date().toISOString()
    };
  }

  /**
   * Clears all cached summaries
   * @returns {number} Number of files deleted
   */
  clearCache() {
    try {
      const files = fs.readdirSync(this.cacheDir);
      let deleted = 0;

      for (const file of files) {
        if (file.endsWith('.json')) {
          fs.unlinkSync(path.join(this.cacheDir, file));
          deleted++;
        }
      }

      console.log(`[ArtifactSummarizer] Cleared ${deleted} cached summaries`);
      return deleted;

    } catch (error) {
      console.error('[ArtifactSummarizer] Error clearing cache:', error.message);
      return 0;
    }
  }

  /**
   * Cleans expired cache entries
   * @returns {number} Number of files deleted
   */
  cleanExpiredCache() {
    try {
      const files = fs.readdirSync(this.cacheDir);
      let deleted = 0;
      const now = Date.now();

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.cacheDir, file);
        const stats = fs.statSync(filePath);
        const age = now - stats.mtime.getTime();

        if (age > SUMMARY_CONFIG.maxCacheAge) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      }

      console.log(`[ArtifactSummarizer] Cleaned ${deleted} expired cache entries`);
      return deleted;

    } catch (error) {
      console.error('[ArtifactSummarizer] Error cleaning cache:', error.message);
      return 0;
    }
  }

  /**
   * Batch summarizes multiple artifacts
   * @param {Array} artifactPaths - Array of relative paths
   * @param {Object} options - Summarization options
   * @returns {Array} Array of summary objects
   */
  batchSummarize(artifactPaths, options = {}) {
    const summaries = [];

    for (const artifactPath of artifactPaths) {
      try {
        const summary = this.summarize(artifactPath, options);
        summaries.push(summary);
      } catch (error) {
        console.error(`[ArtifactSummarizer] Failed to summarize ${artifactPath}:`, error.message);
        summaries.push(this._createErrorSummary(artifactPath, error.message));
      }
    }

    return summaries;
  }

  /**
   * Gets cache statistics
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    try {
      const files = fs.readdirSync(this.cacheDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      let totalSize = 0;
      let oldestTime = Date.now();
      let newestTime = 0;

      for (const file of jsonFiles) {
        const filePath = path.join(this.cacheDir, file);
        const stats = fs.statSync(filePath);

        totalSize += stats.size;
        oldestTime = Math.min(oldestTime, stats.mtime.getTime());
        newestTime = Math.max(newestTime, stats.mtime.getTime());
      }

      return {
        count: jsonFiles.length,
        totalSize: totalSize,
        averageSize: jsonFiles.length > 0 ? Math.round(totalSize / jsonFiles.length) : 0,
        oldestEntry: oldestTime < Date.now() ? new Date(oldestTime).toISOString() : null,
        newestEntry: newestTime > 0 ? new Date(newestTime).toISOString() : null
      };

    } catch (error) {
      console.error('[ArtifactSummarizer] Error getting cache stats:', error.message);
      return {
        count: 0,
        totalSize: 0,
        averageSize: 0,
        oldestEntry: null,
        newestEntry: null
      };
    }
  }
}

module.exports = ArtifactSummarizer;
