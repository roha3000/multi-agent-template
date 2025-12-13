/**
 * Claude Limit Tracker - Monitor and enforce Claude API rate limits
 *
 * Tracks usage against Claude plan limits:
 * - Free: 50 req/day, 5 req/min
 * - Pro: 1000 req/day, 50 req/min
 * - Team: Custom limits
 *
 * Features:
 * - Rolling window tracking (minute, hour, day)
 * - Proactive limit warnings
 * - Safety thresholds
 * - Automatic window resets
 *
 * @module claude-limit-tracker
 */

const { createComponentLogger } = require('./logger');

class ClaudeLimitTracker {
  /**
   * Create a Claude limit tracker
   *
   * @param {Object} options - Configuration options
   * @param {string} [options.plan='pro'] - Claude plan (free, pro, team)
   * @param {Object} [options.customLimits] - Override default limits
   * @param {number} [options.warningThreshold=0.80] - Warning at 80%
   * @param {number} [options.criticalThreshold=0.90] - Critical at 90%
   * @param {number} [options.emergencyThreshold=0.95] - Emergency at 95%
   * @param {boolean} [options.enabled=true] - Enable tracking
   */
  constructor(options = {}) {
    this.logger = createComponentLogger('ClaudeLimitTracker');

    this.plan = options.plan || 'pro';
    this.enabled = options.enabled !== false;

    // Get base limits for plan
    this.limits = this._getLimitsForPlan(this.plan);

    // Override with custom limits if provided
    if (options.customLimits) {
      this.limits = { ...this.limits, ...options.customLimits };
    }

    // Safety thresholds
    this.thresholds = {
      warning: options.warningThreshold || 0.80,
      critical: options.criticalThreshold || 0.90,
      emergency: options.emergencyThreshold || 0.95
    };

    // Rolling time windows
    this.windows = {
      minute: {
        calls: 0,
        tokens: 0,
        resetAt: Date.now() + 60000 // 1 minute
      },
      hour: {
        calls: 0,
        tokens: 0,
        resetAt: Date.now() + 3600000 // 1 hour
      },
      day: {
        calls: 0,
        tokens: 0,
        resetAt: Date.now() + 86400000 // 24 hours
      }
    };

    this.logger.info('ClaudeLimitTracker initialized', {
      plan: this.plan,
      enabled: this.enabled,
      limits: this.limits
    });
  }

  /**
   * Get default limits for Claude plan
   * @param {string} plan - Plan name
   * @returns {Object} Limit configuration
   * @private
   */
  _getLimitsForPlan(plan) {
    const limits = {
      free: {
        requestsPerMinute: 5,
        requestsPerHour: 50,
        requestsPerDay: 50,
        tokensPerMinute: 10000,
        tokensPerDay: 150000
      },
      pro: {
        requestsPerMinute: 50,
        requestsPerHour: 1000,
        requestsPerDay: 1000,
        tokensPerMinute: 40000,
        tokensPerDay: 2500000
      },
      team: {
        requestsPerMinute: 100,
        requestsPerHour: 5000,
        requestsPerDay: 10000,
        tokensPerMinute: 100000,
        tokensPerDay: 10000000
      }
    };

    return limits[plan] || limits.pro;
  }

  /**
   * Record an API call
   * @param {number} tokenCount - Tokens used in this call
   */
  recordCall(tokenCount = 0) {
    if (!this.enabled) {
      return;
    }

    this._resetExpiredWindows();

    // Increment all windows
    this.windows.minute.calls++;
    this.windows.minute.tokens += tokenCount;

    this.windows.hour.calls++;
    this.windows.hour.tokens += tokenCount;

    this.windows.day.calls++;
    this.windows.day.tokens += tokenCount;

    this.logger.debug('API call recorded', {
      tokens: tokenCount,
      minuteCalls: this.windows.minute.calls,
      dayCalls: this.windows.day.calls
    });
  }

  /**
   * Check if safe to make another API call
   * @param {number} [estimatedTokens=1000] - Estimated tokens for next call
   * @returns {Object} Safety check result
   */
  canMakeCall(estimatedTokens = 1000) {
    if (!this.enabled) {
      return {
        safe: true,
        level: 'DISABLED',
        action: 'CONTINUE',
        utilization: 0,
        message: 'Limit tracking disabled'
      };
    }

    this._resetExpiredWindows();

    // Check all constraints
    const constraints = [
      {
        name: 'requests/minute',
        current: this.windows.minute.calls + 1,
        limit: this.limits.requestsPerMinute,
        window: 'minute',
        type: 'requests'
      },
      {
        name: 'requests/hour',
        current: this.windows.hour.calls + 1,
        limit: this.limits.requestsPerHour,
        window: 'hour',
        type: 'requests'
      },
      {
        name: 'requests/day',
        current: this.windows.day.calls + 1,
        limit: this.limits.requestsPerDay,
        window: 'day',
        type: 'requests'
      },
      {
        name: 'tokens/minute',
        current: this.windows.minute.tokens + estimatedTokens,
        limit: this.limits.tokensPerMinute,
        window: 'minute',
        type: 'tokens'
      },
      {
        name: 'tokens/day',
        current: this.windows.day.tokens + estimatedTokens,
        limit: this.limits.tokensPerDay,
        window: 'day',
        type: 'tokens'
      }
    ];

    // Find most constraining limit
    let maxUtilization = 0;
    let limitingFactor = null;

    for (const constraint of constraints) {
      const utilization = constraint.current / constraint.limit;

      if (utilization > maxUtilization) {
        maxUtilization = utilization;
        limitingFactor = constraint;
      }
    }

    // Determine safety level and recommended action
    if (maxUtilization >= this.thresholds.emergency) {
      return {
        safe: false,
        level: 'EMERGENCY',
        action: 'HALT_IMMEDIATELY',
        utilization: maxUtilization,
        limitingFactor,
        timeToReset: this._getTimeToReset(limitingFactor.window),
        message: `EMERGENCY: ${(maxUtilization * 100).toFixed(1)}% of ${limitingFactor.name} limit reached. System will halt.`
      };
    }

    if (maxUtilization >= this.thresholds.critical) {
      return {
        safe: false,
        level: 'CRITICAL',
        action: 'WRAP_UP_NOW',
        utilization: maxUtilization,
        limitingFactor,
        timeToReset: this._getTimeToReset(limitingFactor.window),
        message: `CRITICAL: ${(maxUtilization * 100).toFixed(1)}% of ${limitingFactor.name} limit reached. Initiating wrap-up.`
      };
    }

    if (maxUtilization >= this.thresholds.warning) {
      return {
        safe: true,
        level: 'WARNING',
        action: 'PREPARE_WRAP_UP',
        utilization: maxUtilization,
        limitingFactor,
        timeToReset: this._getTimeToReset(limitingFactor.window),
        message: `WARNING: ${(maxUtilization * 100).toFixed(1)}% of ${limitingFactor.name} limit reached. Prepare for wrap-up.`
      };
    }

    return {
      safe: true,
      level: 'OK',
      action: 'CONTINUE',
      utilization: maxUtilization,
      limitingFactor,
      message: `Safe: ${(maxUtilization * 100).toFixed(1)}% utilization across all limits.`
    };
  }

  /**
   * Get current status
   * @returns {Object} Status information
   */
  getStatus() {
    if (!this.enabled) {
      return {
        enabled: false,
        plan: this.plan
      };
    }

    this._resetExpiredWindows();

    return {
      plan: this.plan,
      enabled: this.enabled,
      windows: {
        minute: {
          calls: this.windows.minute.calls,
          tokens: this.windows.minute.tokens,
          callsLimit: this.limits.requestsPerMinute,
          tokensLimit: this.limits.tokensPerMinute,
          callsUtilization: this.windows.minute.calls / this.limits.requestsPerMinute,
          tokensUtilization: this.windows.minute.tokens / this.limits.tokensPerMinute,
          resetIn: Math.max(0, this.windows.minute.resetAt - Date.now())
        },
        hour: {
          calls: this.windows.hour.calls,
          tokens: this.windows.hour.tokens,
          callsLimit: this.limits.requestsPerHour,
          callsUtilization: this.windows.hour.calls / this.limits.requestsPerHour,
          resetIn: Math.max(0, this.windows.hour.resetAt - Date.now())
        },
        day: {
          calls: this.windows.day.calls,
          tokens: this.windows.day.tokens,
          callsLimit: this.limits.requestsPerDay,
          tokensLimit: this.limits.tokensPerDay,
          callsUtilization: this.windows.day.calls / this.limits.requestsPerDay,
          tokensUtilization: this.windows.day.tokens / this.limits.tokensPerDay,
          resetIn: Math.max(0, this.windows.day.resetAt - Date.now())
        }
      },
      thresholds: this.thresholds
    };
  }

  /**
   * Reset expired time windows
   * @private
   */
  _resetExpiredWindows() {
    const now = Date.now();

    if (now >= this.windows.minute.resetAt) {
      this.windows.minute = {
        calls: 0,
        tokens: 0,
        resetAt: now + 60000
      };
      this.logger.debug('Minute window reset');
    }

    if (now >= this.windows.hour.resetAt) {
      this.windows.hour = {
        calls: 0,
        tokens: 0,
        resetAt: now + 3600000
      };
      this.logger.debug('Hour window reset');
    }

    if (now >= this.windows.day.resetAt) {
      this.windows.day = {
        calls: 0,
        tokens: 0,
        resetAt: now + 86400000
      };
      this.logger.debug('Day window reset');
    }
  }

  /**
   * Get time until window resets
   * @param {string} window - Window name
   * @returns {number} Milliseconds until reset
   * @private
   */
  _getTimeToReset(window) {
    return Math.max(0, this.windows[window].resetAt - Date.now());
  }

  /**
   * Get formatted time to reset
   * @param {string} window - Window name
   * @returns {string} Formatted time
   */
  getFormattedTimeToReset(window) {
    const ms = this._getTimeToReset(window);
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Reset all windows (for testing)
   */
  reset() {
    const now = Date.now();

    this.windows = {
      minute: { calls: 0, tokens: 0, resetAt: now + 60000 },
      hour: { calls: 0, tokens: 0, resetAt: now + 3600000 },
      day: { calls: 0, tokens: 0, resetAt: now + 86400000 }
    };

    this.logger.info('All windows reset');
  }
}

module.exports = ClaudeLimitTracker;
