/**
 * Usage Tracking Hook
 *
 * Automatically tracks token usage from Claude Code sessions.
 *
 * This hook runs after tool execution and:
 * 1. Estimates token usage from tool calls
 * 2. Sends data to UsageTracker and Dashboard
 * 3. Enables real-time dashboard updates
 *
 * Installation:
 * 1. Ensure continuous loop dashboard is running
 * 2. This hook will automatically feed usage data to it
 *
 * @module hooks/track-usage
 */

const path = require('path');
const fs = require('fs');

// Load core modules
let ClaudeSessionTracker;
let UsageTracker;
let MemoryStore;
let DashboardManager;

try {
  ClaudeSessionTracker = require('../core/claude-session-tracker');
  UsageTracker = require('../core/usage-tracker');
  MemoryStore = require('../core/memory-store');
  DashboardManager = require('../core/dashboard-manager');
} catch (error) {
  console.warn('[Usage Hook] Core modules not available:', error.message);
}

// Singleton tracker instance
let tracker = null;
let usageTracker = null;
let memoryStore = null;
let dashboardManager = null;

/**
 * Initializes the tracker (lazy initialization)
 *
 * @param {string} projectPath - Project root path
 * @returns {Promise<ClaudeSessionTracker|null>}
 */
async function initializeTracker(projectPath) {
  if (tracker) {
    return tracker;
  }

  if (!ClaudeSessionTracker) {
    console.warn('[Usage Hook] ClaudeSessionTracker not available');
    return null;
  }

  try {
    // Initialize MemoryStore
    const dbPath = path.join(projectPath, '.claude', 'memory', 'session-tracking.db');
    memoryStore = new MemoryStore(dbPath);

    // Initialize UsageTracker
    usageTracker = new UsageTracker(memoryStore);

    // Check if dashboard is already running
    const pidFile = path.join(projectPath, '.claude', 'continuous-loop.pid');
    const dashboardRunning = fs.existsSync(pidFile);

    if (dashboardRunning) {
      console.log('[Usage Hook] Dashboard detected, will send usage data');
      // Dashboard is running in separate process, we'll use shared DB
    }

    // Create tracker
    tracker = new ClaudeSessionTracker({
      usageTracker,
      dashboardManager: null, // Dashboard runs in separate process
      projectPath,
      sessionId: process.env.CLAUDE_SESSION_ID || null
    });

    console.log('[Usage Hook] Session tracker initialized');
    return tracker;
  } catch (error) {
    console.error('[Usage Hook] Failed to initialize tracker:', error.message);
    return null;
  }
}

/**
 * Hook entry point
 *
 * Called after each tool execution by Claude Code.
 *
 * @param {Object} context - Hook context
 * @param {string} context.toolName - Name of tool executed
 * @param {Object} context.input - Tool input parameters
 * @param {string} context.response - Tool response
 * @param {string} context.cwd - Current working directory
 * @returns {Promise<Object>} - Hook result
 */
async function hook(context) {
  const {
    toolName,
    input,
    response,
    cwd
  } = context;

  try {
    // Initialize tracker if needed
    const sessionTracker = await initializeTracker(cwd);

    if (!sessionTracker) {
      // Tracker not available, skip silently
      return { success: false, reason: 'tracker_unavailable' };
    }

    // Estimate usage from tool call
    const estimatedTokens = await sessionTracker.estimateFromToolCall({
      toolName,
      input,
      response
    });

    return {
      success: true,
      estimatedTokens,
      message: `Tracked ~${estimatedTokens} tokens from ${toolName}`
    };
  } catch (error) {
    console.error('[Usage Hook] Error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Cleanup function (called on session end if supported)
 */
async function cleanup() {
  if (tracker) {
    const stats = await tracker.endSession();
    console.log('[Usage Hook] Session stats:', JSON.stringify(stats, null, 2));
  }

  if (memoryStore) {
    memoryStore.close();
  }
}

module.exports = {
  hook,
  cleanup
};
