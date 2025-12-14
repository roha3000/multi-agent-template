/**
 * Claude Session Tracker
 *
 * Tracks token usage from Claude Code sessions via two methods:
 * 1. Manual tracking API (user calls after interactions)
 * 2. Hook-based estimation (approximates usage from tool calls)
 *
 * This solves the "monitoring a silent system" problem by providing
 * a way to feed actual Claude session data into the dashboard.
 *
 * @module core/claude-session-tracker
 */

const logger = require('./logger')('ClaudeSessionTracker');

class ClaudeSessionTracker {
  /**
   * Creates a new session tracker
   *
   * @param {Object} options - Configuration options
   * @param {UsageTracker} options.usageTracker - UsageTracker instance
   * @param {DashboardManager} options.dashboardManager - DashboardManager instance
   * @param {string} options.projectPath - Project path for this session
   * @param {string} options.sessionId - Optional session ID
   */
  constructor(options = {}) {
    const {
      usageTracker,
      dashboardManager,
      projectPath = process.cwd(),
      sessionId = null
    } = options;

    if (!usageTracker) {
      throw new Error('UsageTracker is required');
    }

    this.usageTracker = usageTracker;
    this.dashboardManager = dashboardManager;
    this.projectPath = projectPath;
    this.sessionId = sessionId || `session-${Date.now()}`;
    this.sessionStartTime = Date.now();
    this.messageCount = 0;
    this.totalEstimatedTokens = 0;

    logger.info('ClaudeSessionTracker initialized', {
      sessionId: this.sessionId,
      projectPath,
      hasDashboard: !!dashboardManager
    });
  }

  /**
   * Records token usage from Claude conversation
   *
   * Call this method after each Claude response to track actual usage.
   *
   * Usage:
   * ```javascript
   * // After receiving Claude's response:
   * await tracker.recordConversationTurn({
   *   inputTokens: 5420,      // From <budget> tag in Claude's response
   *   outputTokens: 2100,     // From <budget> tag
   *   cacheReadTokens: 3200,  // From cache info
   *   cacheCreationTokens: 0
   * });
   * ```
   *
   * @param {Object} usage - Token usage data
   * @param {number} usage.inputTokens - Input tokens used
   * @param {number} usage.outputTokens - Output tokens generated
   * @param {number} usage.cacheReadTokens - Tokens read from cache
   * @param {number} usage.cacheCreationTokens - Tokens written to cache
   * @param {string} usage.model - Model used (defaults to claude-sonnet-4)
   * @param {string} usage.task - Optional task description
   * @returns {Promise<void>}
   */
  async recordConversationTurn(usage) {
    const {
      inputTokens = 0,
      outputTokens = 0,
      cacheReadTokens = 0,
      cacheCreationTokens = 0,
      model = 'claude-sonnet-4',
      task = null
    } = usage;

    this.messageCount++;

    // Record in UsageTracker
    const orchestrationId = `${this.sessionId}-msg-${this.messageCount}`;
    await this.usageTracker.recordUsage({
      orchestrationId,
      model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      pattern: 'claude-code-session',
      agentId: 'claude-code',
      source: 'manual-tracking',
      metadata: {
        sessionId: this.sessionId,
        messageNumber: this.messageCount,
        task,
        projectPath: this.projectPath
      }
    });

    this.totalEstimatedTokens += inputTokens + outputTokens;

    // Update dashboard
    if (this.dashboardManager) {
      this.dashboardManager.updateExecution({
        phase: 'implementation',
        agent: 'claude-code',
        task: task || `Conversation turn ${this.messageCount}`,
        model,
        startTime: Date.now()
      });
    }

    logger.info('Recorded conversation turn', {
      sessionId: this.sessionId,
      messageNumber: this.messageCount,
      totalTokens: inputTokens + outputTokens,
      model,
      task
    });
  }

  /**
   * Estimates token usage from tool calls
   *
   * This is less accurate but provides automatic tracking.
   * Can be used in hooks to approximate usage.
   *
   * @param {Object} toolCall - Tool call information
   * @param {string} toolCall.toolName - Name of tool called
   * @param {Object} toolCall.input - Tool input parameters
   * @param {string} toolCall.response - Tool response
   * @returns {Promise<number>} - Estimated tokens used
   */
  async estimateFromToolCall(toolCall) {
    const { toolName, input, response } = toolCall;

    // Rough estimation: 1 token ≈ 4 characters
    const inputStr = JSON.stringify(input || {});
    const responseStr = response || '';

    const estimatedInput = Math.ceil(inputStr.length / 4);
    const estimatedOutput = Math.ceil(responseStr.length / 4);

    // Add overhead for tool use (XML formatting, thinking, etc.)
    const overhead = 500; // Conservative estimate
    const total = estimatedInput + estimatedOutput + overhead;

    // Record estimation
    await this.recordConversationTurn({
      inputTokens: estimatedInput + overhead,
      outputTokens: estimatedOutput,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      task: `Tool: ${toolName}`
    });

    logger.debug('Estimated usage from tool call', {
      toolName,
      estimatedTokens: total
    });

    return total;
  }

  /**
   * Gets current session statistics
   *
   * @returns {Object} - Session stats
   */
  getSessionStats() {
    return {
      sessionId: this.sessionId,
      projectPath: this.projectPath,
      messageCount: this.messageCount,
      sessionDuration: Date.now() - this.sessionStartTime,
      totalEstimatedTokens: this.totalEstimatedTokens,
      averageTokensPerMessage: this.messageCount > 0
        ? Math.round(this.totalEstimatedTokens / this.messageCount)
        : 0
    };
  }

  /**
   * Ends the session and logs final stats
   *
   * @returns {Promise<Object>} - Final session stats
   */
  async endSession() {
    const stats = this.getSessionStats();

    logger.info('Session ended', stats);

    // Get final usage from UsageTracker
    const sessionUsage = await this.usageTracker.getSessionUsage(this.sessionId);

    return {
      ...stats,
      actualUsage: sessionUsage
    };
  }
}

module.exports = ClaudeSessionTracker;
