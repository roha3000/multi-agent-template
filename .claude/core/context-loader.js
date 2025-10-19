/**
 * Context Loader - Token-budget aware context assembly
 *
 * Responsibilities:
 * - Token-budget aware loading
 * - Sliding window for artifacts
 * - Phase-specific context assembly
 * - Priority-based content selection
 *
 * @module context-loader
 */

const fs = require('fs');
const path = require('path');
const { countTokens, estimateCharsForTokens } = require('./token-counter');
const { createComponentLogger } = require('./logger');

// Create logger instance for ContextLoader
const logger = createComponentLogger('ContextLoader');

/**
 * Token budget allocation for different context components
 */
const TOKEN_BUDGETS = {
  bootstrap: 800,           // Bootstrap.md (cached)
  currentPhase: 1500,       // Current phase full prompt
  adjacentPhase: 500,       // Each adjacent phase summary
  recentArtifacts: 2000,    // Recent artifacts from current phase
  projectSummary: 1000,     // PROJECT_SUMMARY.md
  sessionState: 700,        // Current session state
  buffer: 500               // Safety buffer
};

/**
 * Total token budget
 */
const TOTAL_TOKEN_BUDGET = 7500;

class ContextLoader {
  /**
   * Creates a ContextLoader instance
   * @param {string} projectRoot - Absolute path to project root
   * @param {Object} stateManager - StateManager instance
   */
  constructor(projectRoot, stateManager) {
    this.projectRoot = projectRoot;
    this.stateManager = stateManager;
    this.claudeDir = path.join(projectRoot, '.claude');
    this.commandsDir = path.join(this.claudeDir, 'commands');
  }

  /**
   * Loads complete context for a session
   * @param {string} targetPhase - Target phase to load context for
   * @param {Object} options - Loading options
   * @returns {Object} Assembled context with token counts
   */
  loadContext(targetPhase, options = {}) {
    const context = {
      bootstrap: null,
      currentPhasePrompt: null,
      adjacentPhasePrompts: [],
      artifacts: [],
      projectSummary: null,
      sessionState: null,
      tokenCounts: {},
      totalTokens: 0
    };

    try {
      // 1. Load bootstrap (always included, cached)
      context.bootstrap = this._loadBootstrap();
      context.tokenCounts.bootstrap = this._estimateTokens(context.bootstrap);

      // 2. Load current phase prompt (full detail)
      context.currentPhasePrompt = this._loadPhasePrompt(targetPhase, 'full');
      context.tokenCounts.currentPhase = this._estimateTokens(context.currentPhasePrompt);

      // 3. Load adjacent phase prompts (summaries)
      const adjacentPhases = this._getAdjacentPhases(targetPhase);
      for (const phase of adjacentPhases) {
        const prompt = this._loadPhasePrompt(phase, 'summary');
        if (prompt) {
          context.adjacentPhasePrompts.push({ phase, content: prompt });
          context.tokenCounts[`adjacent_${phase}`] = this._estimateTokens(prompt);
        }
      }

      // 4. Load recent artifacts (sliding window)
      const artifacts = this._loadRecentArtifacts(targetPhase, TOKEN_BUDGETS.recentArtifacts);
      context.artifacts = artifacts;
      context.tokenCounts.artifacts = artifacts.reduce((sum, a) => sum + a.tokens, 0);

      // 5. Load project summary
      const summary = this._loadProjectSummary();
      if (summary) {
        context.projectSummary = summary;
        context.tokenCounts.projectSummary = this._estimateTokens(summary);
      }

      // 6. Load session state
      const state = this.stateManager.load();
      context.sessionState = this._formatSessionState(state);
      context.tokenCounts.sessionState = this._estimateTokens(context.sessionState);

      // Calculate total tokens
      context.totalTokens = Object.values(context.tokenCounts).reduce((sum, count) => sum + count, 0);

      // Verify we're within budget
      if (context.totalTokens > TOTAL_TOKEN_BUDGET) {
        logger.warn('Token budget exceeded', { current: context.totalTokens, budget: TOTAL_TOKEN_BUDGET });
        context = this._trimContext(context, TOTAL_TOKEN_BUDGET);
      }

      logger.info('Context loaded', { totalTokens: context.totalTokens, budget: TOTAL_TOKEN_BUDGET });
      return context;

    } catch (error) {
      logger.error('Error loading context', { error: error.message, stack: error.stack });
      return this._getMinimalContext(targetPhase);
    }
  }

  /**
   * Loads bootstrap.md
   * @returns {string} Bootstrap content
   * @private
   */
  _loadBootstrap() {
    const bootstrapPath = path.join(this.claudeDir, 'bootstrap.md');

    if (!fs.existsSync(bootstrapPath)) {
      logger.warn('bootstrap.md not found');
      return '# Multi-Agent System Bootstrap\n\nBootstrap file not found.';
    }

    return fs.readFileSync(bootstrapPath, 'utf8');
  }

  /**
   * Loads phase prompt from commands directory
   * @param {string} phase - Phase name
   * @param {string} mode - 'full' or 'summary'
   * @returns {string|null} Phase prompt content
   * @private
   */
  _loadPhasePrompt(phase, mode = 'full') {
    const promptPath = path.join(this.commandsDir, `${phase}-phase.md`);

    if (!fs.existsSync(promptPath)) {
      logger.warn('Phase prompt not found', { file: `${phase}-phase.md` });
      return null;
    }

    const content = fs.readFileSync(promptPath, 'utf8');

    if (mode === 'summary') {
      return this._summarizePrompt(content);
    }

    return content;
  }

  /**
   * Summarizes a phase prompt to key points
   * @param {string} content - Full prompt content
   * @returns {string} Summarized content
   * @private
   */
  _summarizePrompt(content) {
    // Extract title and first paragraph
    const lines = content.split('\n');
    const summary = [];

    let inHeader = true;
    let paragraphCount = 0;

    for (const line of lines) {
      // Always include headers
      if (line.startsWith('#')) {
        summary.push(line);
        inHeader = false;
      }
      // Include first 2 paragraphs of content
      else if (!inHeader && line.trim() && paragraphCount < 2) {
        summary.push(line);
        if (line.trim()) paragraphCount++;
      }
      // Include bullet points under headers
      else if (line.trim().match(/^[-*]\s/)) {
        summary.push(line);
      }
    }

    return summary.join('\n').slice(0, estimateCharsForTokens(TOKEN_BUDGETS.adjacentPhase));
  }

  /**
   * Gets adjacent phases (previous and next) for a given phase
   * @param {string} phase - Current phase
   * @returns {Array} Array of adjacent phase names
   * @private
   */
  _getAdjacentPhases(phase) {
    const phaseOrder = [
      'research',
      'planning',
      'design',
      'test-first',
      'implementation',
      'validation',
      'iteration'
    ];

    const currentIndex = phaseOrder.indexOf(phase);
    if (currentIndex === -1) return [];

    const adjacent = [];

    // Add previous phase
    if (currentIndex > 0) {
      adjacent.push(phaseOrder[currentIndex - 1]);
    }

    // Add next phase
    if (currentIndex < phaseOrder.length - 1) {
      adjacent.push(phaseOrder[currentIndex + 1]);
    }

    return adjacent;
  }

  /**
   * Loads recent artifacts with sliding window
   * @param {string} phase - Phase to load artifacts for
   * @param {number} tokenBudget - Token budget for artifacts
   * @returns {Array} Array of artifact objects
   * @private
   */
  _loadRecentArtifacts(phase, tokenBudget) {
    const state = this.stateManager.load();
    const phaseArtifacts = state.artifacts[phase] || [];
    const artifacts = [];
    let tokensUsed = 0;

    // Load artifacts in reverse order (most recent first)
    const reversedArtifacts = [...phaseArtifacts].reverse();

    for (const artifactPath of reversedArtifacts) {
      // Skip if we've exceeded token budget
      if (tokensUsed >= tokenBudget) break;

      const artifact = this._loadArtifact(artifactPath, tokenBudget - tokensUsed);

      if (artifact) {
        artifacts.push(artifact);
        tokensUsed += artifact.tokens;
      }

      // Stop after 3 artifacts (sliding window)
      if (artifacts.length >= 3) break;
    }

    // Also load summaries from previous phase
    const adjacentPhases = this._getAdjacentPhases(phase);
    if (adjacentPhases.length > 0 && tokensUsed < tokenBudget) {
      const prevPhase = adjacentPhases[0];
      const prevArtifacts = state.artifacts[prevPhase] || [];

      if (prevArtifacts.length > 0) {
        // Just load the most recent artifact summary from previous phase
        const summaryPath = prevArtifacts[prevArtifacts.length - 1];
        const summary = this._loadArtifactSummary(summaryPath);

        if (summary) {
          artifacts.push({
            path: summaryPath,
            phase: prevPhase,
            content: summary,
            tokens: this._estimateTokens(summary),
            isSummary: true
          });
        }
      }
    }

    return artifacts;
  }

  /**
   * Loads a single artifact file
   * @param {string} artifactPath - Relative path to artifact
   * @param {number} maxTokens - Maximum tokens to load
   * @returns {Object|null} Artifact object or null
   * @private
   */
  _loadArtifact(artifactPath, maxTokens) {
    try {
      const fullPath = path.join(this.projectRoot, artifactPath);

      if (!fs.existsSync(fullPath)) {
        logger.warn('Artifact not found', { artifactPath });
        return null;
      }

      const stats = fs.statSync(fullPath);
      const content = fs.readFileSync(fullPath, 'utf8');
      const tokens = this._estimateTokens(content);

      // If artifact is too large, truncate
      let finalContent = content;
      let wasTruncated = false;

      if (tokens > maxTokens) {
        const maxChars = estimateCharsForTokens(maxTokens);
        finalContent = content.slice(0, maxChars) + '\n\n[... truncated ...]';
        wasTruncated = true;
      }

      return {
        path: artifactPath,
        content: finalContent,
        tokens: Math.min(tokens, maxTokens),
        size: stats.size,
        modified: stats.mtime.toISOString(),
        wasTruncated: wasTruncated
      };

    } catch (error) {
      logger.error('Error loading artifact', { artifactPath, error: error.message });
      return null;
    }
  }

  /**
   * Loads artifact summary (first few lines)
   * @param {string} artifactPath - Relative path to artifact
   * @returns {string|null} Summary content
   * @private
   */
  _loadArtifactSummary(artifactPath) {
    try {
      const fullPath = path.join(this.projectRoot, artifactPath);

      if (!fs.existsSync(fullPath)) {
        return null;
      }

      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n').slice(0, 10);

      return `Summary of ${path.basename(artifactPath)}:\n${lines.join('\n')}`;

    } catch (error) {
      logger.error('Error loading summary', { artifactPath, error: error.message });
      return null;
    }
  }

  /**
   * Loads PROJECT_SUMMARY.md if it exists
   * @returns {string|null} Project summary content
   * @private
   */
  _loadProjectSummary() {
    const summaryPath = path.join(this.claudeDir, 'PROJECT_SUMMARY.md');

    if (!fs.existsSync(summaryPath)) {
      logger.debug('PROJECT_SUMMARY.md not found (this is OK for new projects)');
      return null;
    }

    try {
      const content = fs.readFileSync(summaryPath, 'utf8');
      const tokens = this._estimateTokens(content);

      // Truncate if too large
      if (tokens > TOKEN_BUDGETS.projectSummary) {
        const maxChars = estimateCharsForTokens(TOKEN_BUDGETS.projectSummary);
        return content.slice(0, maxChars) + '\n\n[... truncated ...]';
      }

      return content;

    } catch (error) {
      logger.error('Error loading PROJECT_SUMMARY.md', { error: error.message });
      return null;
    }
  }

  /**
   * Formats session state for context
   * @param {Object} state - Project state
   * @returns {string} Formatted state
   * @private
   */
  _formatSessionState(state) {
    const formatted = [];

    formatted.push('## Current Session State');
    formatted.push('');
    formatted.push(`**Current Phase**: ${state.current_phase}`);
    formatted.push('');

    // Recent phase history (last 5)
    if (state.phase_history.length > 0) {
      formatted.push('**Recent Phase History**:');
      const recentHistory = state.phase_history.slice(-5);
      for (const entry of recentHistory) {
        const score = entry.score ? ` (score: ${entry.score})` : '';
        formatted.push(`- ${entry.phase} by ${entry.agent}${score} at ${entry.timestamp}`);
      }
      formatted.push('');
    }

    // Quality scores
    if (Object.keys(state.quality_scores).length > 0) {
      formatted.push('**Quality Scores**:');
      for (const [phase, score] of Object.entries(state.quality_scores)) {
        formatted.push(`- ${phase}: ${score}/100`);
      }
      formatted.push('');
    }

    // Unresolved blockers
    const unresolvedBlockers = state.blockers.filter(b => !b.resolved);
    if (unresolvedBlockers.length > 0) {
      formatted.push('**Active Blockers**:');
      for (const blocker of unresolvedBlockers) {
        formatted.push(`- [${blocker.severity.toUpperCase()}] ${blocker.blocker}`);
      }
      formatted.push('');
    }

    // Recent decisions (last 3)
    if (state.decisions.length > 0) {
      formatted.push('**Recent Decisions**:');
      const recentDecisions = state.decisions.slice(-3);
      for (const decision of recentDecisions) {
        formatted.push(`- ${decision.decision}`);
        formatted.push(`  Rationale: ${decision.rationale}`);
      }
      formatted.push('');
    }

    return formatted.join('\n');
  }

  /**
   * Estimates token count from text
   * @param {string} text - Text to estimate
   * @returns {number} Estimated token count
   * @private
   */
  _estimateTokens(text) {
    // Use accurate token counting via tiktoken
    return countTokens(text);
  }

  /**
   * Trims context to fit within token budget
   * @param {Object} context - Context object
   * @param {number} budget - Token budget
   * @returns {Object} Trimmed context
   * @private
   */
  _trimContext(context, budget) {
    logger.info('Trimming context to fit budget');

    // Priority order for trimming:
    // 1. Trim artifacts (least critical)
    // 2. Trim adjacent phase prompts
    // 3. Trim project summary
    // 4. Never trim: bootstrap, current phase, session state

    const excess = context.totalTokens - budget;
    let tokensToRemove = excess;

    // 1. Trim artifacts
    while (tokensToRemove > 0 && context.artifacts.length > 0) {
      const removed = context.artifacts.pop();
      tokensToRemove -= removed.tokens;
      context.tokenCounts.artifacts -= removed.tokens;
    }

    // 2. Trim adjacent phase prompts
    while (tokensToRemove > 0 && context.adjacentPhasePrompts.length > 0) {
      const removed = context.adjacentPhasePrompts.pop();
      const key = `adjacent_${removed.phase}`;
      tokensToRemove -= context.tokenCounts[key];
      delete context.tokenCounts[key];
    }

    // 3. Trim project summary
    if (tokensToRemove > 0 && context.projectSummary) {
      const summaryTokens = context.tokenCounts.projectSummary;
      context.projectSummary = null;
      tokensToRemove -= summaryTokens;
      context.tokenCounts.projectSummary = 0;
    }

    // Recalculate total
    context.totalTokens = Object.values(context.tokenCounts).reduce((sum, count) => sum + count, 0);

    logger.info('Context trimmed', { totalTokens: context.totalTokens });
    return context;
  }

  /**
   * Gets minimal context when full loading fails
   * @param {string} phase - Target phase
   * @returns {Object} Minimal context
   * @private
   */
  _getMinimalContext(phase) {
    return {
      bootstrap: this._loadBootstrap(),
      currentPhasePrompt: this._loadPhasePrompt(phase, 'full'),
      adjacentPhasePrompts: [],
      artifacts: [],
      projectSummary: null,
      sessionState: '## Session State\n\nMinimal context loaded due to error.',
      tokenCounts: {
        bootstrap: 800,
        currentPhase: 1500,
        sessionState: 100
      },
      totalTokens: 2400,
      isMinimal: true
    };
  }

  /**
   * Assembles context into a single prompt string
   * @param {Object} context - Context object from loadContext
   * @returns {string} Assembled prompt
   */
  assemblePrompt(context) {
    const sections = [];

    // 1. Bootstrap
    if (context.bootstrap) {
      sections.push('# System Bootstrap\n');
      sections.push(context.bootstrap);
      sections.push('\n---\n');
    }

    // 2. Project Summary
    if (context.projectSummary) {
      sections.push('# Project Summary\n');
      sections.push(context.projectSummary);
      sections.push('\n---\n');
    }

    // 3. Session State
    if (context.sessionState) {
      sections.push(context.sessionState);
      sections.push('\n---\n');
    }

    // 4. Current Phase Prompt
    if (context.currentPhasePrompt) {
      sections.push('# Current Phase Instructions\n');
      sections.push(context.currentPhasePrompt);
      sections.push('\n---\n');
    }

    // 5. Adjacent Phase Context
    if (context.adjacentPhasePrompts.length > 0) {
      sections.push('# Related Phases\n');
      for (const adjacent of context.adjacentPhasePrompts) {
        sections.push(`\n## ${adjacent.phase}\n`);
        sections.push(adjacent.content);
      }
      sections.push('\n---\n');
    }

    // 6. Recent Artifacts
    if (context.artifacts.length > 0) {
      sections.push('# Recent Artifacts\n');
      for (const artifact of context.artifacts) {
        const tag = artifact.isSummary ? ' (Summary)' : '';
        sections.push(`\n## ${artifact.path}${tag}\n`);
        sections.push(artifact.content);
        sections.push('\n');
      }
      sections.push('\n---\n');
    }

    // 7. Token usage footer
    sections.push(`\n<!-- Context loaded: ${context.totalTokens} tokens -->\n`);

    return sections.join('\n');
  }
}

module.exports = ContextLoader;
