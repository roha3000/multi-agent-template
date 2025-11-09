/**
 * UsageTracker - Track token usage and costs for AI orchestrations
 *
 * Features:
 * - Records token usage per orchestration with cost calculation
 * - Tracks budget consumption with alerts
 * - Provides usage summaries and analytics
 * - Per-agent and per-pattern cost breakdown
 * - Real-time session monitoring
 *
 * @module .claude/core/usage-tracker
 */

const { createComponentLogger } = require('./logger');
const CostCalculator = require('./cost-calculator');

class UsageTracker {
  /**
   * Create a usage tracker
   *
   * @param {MemoryStore} memoryStore - Database instance
   * @param {Object} options - Configuration options
   * @param {boolean} [options.enableTracking=true] - Enable usage tracking
   * @param {boolean} [options.enableBudgetAlerts=false] - Enable budget alerts
   * @param {number} [options.dailyBudgetUSD] - Daily budget limit in USD
   * @param {number} [options.monthlyBudgetUSD] - Monthly budget limit in USD
   * @param {number} [options.dailyWarningThreshold=0.8] - Warn at 80% of daily budget
   * @param {number} [options.monthlyWarningThreshold=0.8] - Warn at 80% of monthly budget
   * @param {string} [options.alertWebhook] - Webhook URL for alerts (future)
   * @param {boolean} [options.trackCacheTokens=true] - Track cache tokens separately
   * @param {boolean} [options.trackPerAgent=true] - Track per-agent usage
   * @param {number} [options.retentionDays=90] - Keep usage records for N days
   * @param {Object} [options.customPricing] - Custom model pricing
   */
  constructor(memoryStore, options = {}) {
    // Validate dependencies
    if (!memoryStore) {
      throw new Error('MemoryStore is required for UsageTracker');
    }

    this.memoryStore = memoryStore;
    this.logger = createComponentLogger('UsageTracker');
    this.costCalculator = new CostCalculator({
      customPricing: options.customPricing || {}
    });

    // Merge options with defaults
    this.options = {
      enableTracking: options.enableTracking !== false,
      enableBudgetAlerts: options.enableBudgetAlerts || false,
      dailyBudgetUSD: options.dailyBudgetUSD || null,
      monthlyBudgetUSD: options.monthlyBudgetUSD || null,
      dailyWarningThreshold: options.dailyWarningThreshold || 0.8,
      monthlyWarningThreshold: options.monthlyWarningThreshold || 0.8,
      alertWebhook: options.alertWebhook || null,
      trackCacheTokens: options.trackCacheTokens !== false,
      trackPerAgent: options.trackPerAgent !== false,
      retentionDays: options.retentionDays || 90,
      ...options
    };

    // In-memory session cache for fast access
    this.sessionUsage = {
      totalTokens: 0,
      totalCost: 0.0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cacheSavings: 0.0,
      startTime: Date.now(),
      orchestrationCount: 0,
      modelBreakdown: {}, // { model: { tokens, cost } }
      patternBreakdown: {} // { pattern: { count, cost } }
    };

    // Budget alert state
    this.budgetAlerts = {
      dailyWarningTriggered: false,
      dailyExceededTriggered: false,
      monthlyWarningTriggered: false,
      monthlyExceededTriggered: false,
      lastAlertTimestamp: null
    };

    this.logger.info('UsageTracker initialized', {
      trackingEnabled: this.options.enableTracking,
      budgetAlertsEnabled: this.options.enableBudgetAlerts,
      dailyBudget: this.options.dailyBudgetUSD,
      monthlyBudget: this.options.monthlyBudgetUSD,
      retentionDays: this.options.retentionDays
    });
  }

  /**
   * Record usage for an orchestration
   *
   * @param {Object} usage - Usage data
   * @param {string} usage.orchestrationId - Orchestration ID
   * @param {string} usage.model - Model used
   * @param {number} usage.inputTokens - Input tokens consumed
   * @param {number} usage.outputTokens - Output tokens generated
   * @param {number} [usage.cacheCreationTokens=0] - Cache creation tokens
   * @param {number} [usage.cacheReadTokens=0] - Cache read tokens
   * @param {string} [usage.agentId] - Specific agent if tracked
   * @param {string} [usage.pattern] - Orchestration pattern
   * @param {string} [usage.workSessionId] - Work session ID
   * @param {Object} [usage.metadata] - Additional metadata
   * @returns {Promise<string|null>} Usage record ID or null on failure
   */
  async recordUsage(usage) {
    if (!this.options.enableTracking) {
      this.logger.debug('Usage tracking disabled');
      return null;
    }

    try {
      // Validate required fields
      if (!usage.orchestrationId || !usage.model) {
        throw new Error('orchestrationId and model are required');
      }

      // Extract token counts
      const inputTokens = usage.inputTokens || 0;
      const outputTokens = usage.outputTokens || 0;
      const cacheCreationTokens = usage.cacheCreationTokens || 0;
      const cacheReadTokens = usage.cacheReadTokens || 0;

      // Calculate cost using CostCalculator
      const costResult = this.costCalculator.calculateCost({
        model: usage.model,
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens
      });

      // Generate unique ID
      const usageId = `usage-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      // Prepare database record
      const record = {
        id: usageId,
        orchestration_id: usage.orchestrationId,
        agent_id: usage.agentId || null,
        timestamp: Date.now(),
        model: usage.model,

        // Token counts
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation_tokens: cacheCreationTokens,
        cache_read_tokens: cacheReadTokens,
        total_tokens: costResult.tokens.total,

        // Cost breakdown
        input_cost: costResult.breakdown.input,
        output_cost: costResult.breakdown.output,
        cache_creation_cost: costResult.breakdown.cacheCreation,
        cache_read_cost: costResult.breakdown.cacheRead,
        total_cost: costResult.totalCost,

        // Savings analysis
        cache_savings: costResult.savings.cacheSavings,
        cache_savings_percent: costResult.savings.savingsPercent,

        // Context (denormalized for easier queries)
        pattern: usage.pattern || null,
        work_session_id: usage.workSessionId || null
      };

      // Insert into database
      const stmt = this.memoryStore.db.prepare(`
        INSERT INTO token_usage (
          id, orchestration_id, agent_id, timestamp, model,
          input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, total_tokens,
          input_cost, output_cost, cache_creation_cost, cache_read_cost, total_cost,
          cache_savings, cache_savings_percent,
          pattern, work_session_id
        ) VALUES (
          @id, @orchestration_id, @agent_id, @timestamp, @model,
          @input_tokens, @output_tokens, @cache_creation_tokens, @cache_read_tokens, @total_tokens,
          @input_cost, @output_cost, @cache_creation_cost, @cache_read_cost, @total_cost,
          @cache_savings, @cache_savings_percent,
          @pattern, @work_session_id
        )
      `);

      stmt.run(record);

      // Update in-memory session cache
      this._updateSessionCache(usage, costResult);

      // Check budget alerts
      if (this.options.enableBudgetAlerts) {
        await this._checkBudgetAlerts(costResult.totalCost);
      }

      this.logger.debug('Usage recorded', {
        usageId,
        orchestrationId: usage.orchestrationId,
        model: usage.model,
        totalTokens: costResult.tokens.total,
        totalCost: costResult.totalCost,
        cacheSavings: costResult.savings.cacheSavings
      });

      return usageId;

    } catch (error) {
      // CRITICAL: Never throw errors that would block orchestration
      this.logger.error('Failed to record usage', {
        error: error.message,
        stack: error.stack,
        usage: usage
      });

      return null; // Graceful failure
    }
  }

  /**
   * Get usage summary for a time period
   *
   * @param {string} period - 'hour', 'day', 'week', 'month', 'all'
   * @param {Object} [options] - Query options
   * @param {Date} [options.startDate] - Start date filter
   * @param {Date} [options.endDate] - End date filter
   * @param {string} [options.model] - Filter by model
   * @param {string} [options.agentId] - Filter by agent
   * @param {string} [options.pattern] - Filter by pattern
   * @param {string} [options.workSessionId] - Filter by work session
   * @returns {Promise<Object>} Usage summary
   */
  async getUsageSummary(period, options = {}) {
    try {
      // Determine time range
      const { startTimestamp, endTimestamp } = this._getPeriodRange(period, options);

      // Build query with filters
      let query = `
        SELECT
          COUNT(DISTINCT orchestration_id) as orchestration_count,
          SUM(total_tokens) as total_tokens,
          SUM(input_tokens) as input_tokens,
          SUM(output_tokens) as output_tokens,
          SUM(cache_creation_tokens) as cache_creation_tokens,
          SUM(cache_read_tokens) as cache_read_tokens,
          SUM(total_cost) as total_cost,
          SUM(cache_savings) as cache_savings,
          AVG(cache_savings_percent) as avg_cache_savings_pct
        FROM token_usage
        WHERE timestamp >= ? AND timestamp <= ?
      `;

      const params = [startTimestamp, endTimestamp];

      // Add optional filters
      if (options.model) {
        query += ' AND model = ?';
        params.push(options.model);
      }

      if (options.agentId) {
        query += ' AND agent_id = ?';
        params.push(options.agentId);
      }

      if (options.pattern) {
        query += ' AND pattern = ?';
        params.push(options.pattern);
      }

      if (options.workSessionId) {
        query += ' AND work_session_id = ?';
        params.push(options.workSessionId);
      }

      const stmt = this.memoryStore.db.prepare(query);
      const summary = stmt.get(...params);

      // Get model breakdown
      const modelBreakdown = this._getModelBreakdown(startTimestamp, endTimestamp, options);

      return {
        period,
        startDate: new Date(startTimestamp),
        endDate: new Date(endTimestamp),
        orchestrationCount: summary.orchestration_count || 0,
        totalTokens: summary.total_tokens || 0,
        inputTokens: summary.input_tokens || 0,
        outputTokens: summary.output_tokens || 0,
        cacheCreationTokens: summary.cache_creation_tokens || 0,
        cacheReadTokens: summary.cache_read_tokens || 0,
        totalCost: summary.total_cost || 0,
        cacheSavings: summary.cache_savings || 0,
        cacheSavingsPercent: summary.avg_cache_savings_pct || 0,
        modelBreakdown,
        filters: options
      };

    } catch (error) {
      this.logger.error('Failed to get usage summary', {
        error: error.message,
        period,
        options
      });

      // Return empty summary on error
      return this._getEmptySummary(period);
    }
  }

  /**
   * Get current session usage from in-memory cache (fast, no DB query)
   *
   * @returns {Object} Session usage stats
   */
  getSessionUsage() {
    return {
      ...this.sessionUsage,
      duration: Date.now() - this.sessionUsage.startTime
    };
  }

  /**
   * Check if budget threshold exceeded
   *
   * @param {string} period - 'day' or 'month'
   * @returns {Promise<Object>} Budget status
   */
  async checkBudgetStatus(period) {
    try {
      const limit = period === 'day'
        ? this.options.dailyBudgetUSD
        : this.options.monthlyBudgetUSD;

      if (!limit) {
        return {
          period,
          limit: null,
          used: 0,
          remaining: 0,
          percentUsed: 0,
          exceeded: false,
          warning: false,
          projection: null
        };
      }

      // Get usage for current period
      const summary = await this.getUsageSummary(period);
      const used = summary.totalCost;

      // Calculate projection
      const { startDate, endDate } = this._getCurrentPeriodRange(period);
      const elapsed = Date.now() - startDate.getTime();
      const total = endDate.getTime() - startDate.getTime();
      const projection = total > 0 ? (used / elapsed) * total : used;

      const remaining = Math.max(0, limit - used);
      const percentUsed = limit > 0 ? (used / limit) * 100 : 0;

      const warningThreshold = period === 'day'
        ? this.options.dailyWarningThreshold
        : this.options.monthlyWarningThreshold;

      return {
        period,
        limit,
        used,
        remaining,
        percentUsed,
        exceeded: used > limit,
        warning: percentUsed >= (warningThreshold * 100),
        projection
      };

    } catch (error) {
      this.logger.error('Failed to check budget status', {
        error: error.message,
        period
      });

      return {
        period,
        limit: null,
        used: 0,
        remaining: 0,
        percentUsed: 0,
        exceeded: false,
        warning: false,
        projection: null
      };
    }
  }

  /**
   * Get cost breakdown by model
   *
   * @param {Object} [options] - Filter options
   * @returns {Promise<Array>} Model cost breakdown
   */
  async getCostByModel(options = {}) {
    try {
      const { startDate, endDate } = this._getDateRange(options);
      const startTimestamp = startDate ? startDate.getTime() : 0;
      const endTimestamp = endDate ? endDate.getTime() : Date.now();

      let query = `
        SELECT
          model,
          COUNT(DISTINCT orchestration_id) as orchestration_count,
          SUM(total_tokens) as total_tokens,
          SUM(input_tokens) as input_tokens,
          SUM(output_tokens) as output_tokens,
          SUM(cache_creation_tokens) as cache_creation_tokens,
          SUM(cache_read_tokens) as cache_read_tokens,
          SUM(total_cost) as total_cost,
          AVG(total_cost) as avg_cost_per_orchestration,
          SUM(cache_savings) as cache_savings
        FROM token_usage
        WHERE timestamp >= ? AND timestamp <= ?
      `;

      const params = [startTimestamp, endTimestamp];

      if (options.pattern) {
        query += ' AND pattern = ?';
        params.push(options.pattern);
      }

      if (options.agentId) {
        query += ' AND agent_id = ?';
        params.push(options.agentId);
      }

      query += ' GROUP BY model';

      // Sort by
      const sortBy = options.sortBy || 'cost';
      if (sortBy === 'cost') {
        query += ' ORDER BY total_cost DESC';
      } else if (sortBy === 'tokens') {
        query += ' ORDER BY total_tokens DESC';
      } else if (sortBy === 'count') {
        query += ' ORDER BY orchestration_count DESC';
      }

      if (options.limit) {
        query += ' LIMIT ?';
        params.push(options.limit);
      }

      const stmt = this.memoryStore.db.prepare(query);
      const results = stmt.all(...params);

      return results.map(row => ({
        model: row.model,
        orchestrationCount: row.orchestration_count,
        totalTokens: row.total_tokens,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cacheCreationTokens: row.cache_creation_tokens,
        cacheReadTokens: row.cache_read_tokens,
        totalCost: row.total_cost,
        avgCostPerOrchestration: row.avg_cost_per_orchestration,
        cacheSavings: row.cache_savings
      }));

    } catch (error) {
      this.logger.error('Failed to get cost by model', {
        error: error.message,
        options
      });

      return [];
    }
  }

  /**
   * Get cost breakdown by pattern
   *
   * @param {Object} [options] - Filter options
   * @returns {Promise<Array>} Pattern cost breakdown
   */
  async getCostByPattern(options = {}) {
    // Implementation similar to getCostByModel, grouping by pattern
    // Left as exercise - would query pattern column instead of model
    return [];
  }

  /**
   * Get cost breakdown by agent
   *
   * @param {Object} [options] - Filter options
   * @returns {Promise<Array>} Agent cost breakdown
   */
  async getCostByAgent(options = {}) {
    // Implementation similar to getCostByModel, grouping by agent_id
    // Left as exercise
    return [];
  }

  /**
   * Clean up old usage records
   *
   * @param {number} retentionDays - Keep records for N days
   * @returns {Promise<number>} Number of records deleted
   */
  async cleanupOldRecords(retentionDays) {
    try {
      const cutoffTimestamp = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

      const stmt = this.memoryStore.db.prepare(`
        DELETE FROM token_usage
        WHERE timestamp < ?
      `);

      const result = stmt.run(cutoffTimestamp);

      this.logger.info('Cleaned up old usage records', {
        deletedCount: result.changes,
        retentionDays,
        cutoffDate: new Date(cutoffTimestamp)
      });

      return result.changes;

    } catch (error) {
      this.logger.error('Failed to cleanup old records', {
        error: error.message,
        retentionDays
      });

      return 0;
    }
  }

  // ============================================================================
  // Internal Methods
  // ============================================================================

  /**
   * Update in-memory session cache
   * @private
   */
  _updateSessionCache(usage, costResult) {
    this.sessionUsage.totalTokens += costResult.tokens.total;
    this.sessionUsage.totalCost += costResult.totalCost;
    this.sessionUsage.inputTokens += usage.inputTokens || 0;
    this.sessionUsage.outputTokens += usage.outputTokens || 0;
    this.sessionUsage.cacheCreationTokens += usage.cacheCreationTokens || 0;
    this.sessionUsage.cacheReadTokens += usage.cacheReadTokens || 0;
    this.sessionUsage.cacheSavings += costResult.savings.cacheSavings;
    this.sessionUsage.orchestrationCount += 1;

    // Update model breakdown
    if (!this.sessionUsage.modelBreakdown[usage.model]) {
      this.sessionUsage.modelBreakdown[usage.model] = {
        tokens: 0,
        cost: 0
      };
    }

    this.sessionUsage.modelBreakdown[usage.model].tokens += costResult.tokens.total;
    this.sessionUsage.modelBreakdown[usage.model].cost += costResult.totalCost;

    // Update pattern breakdown (if pattern provided)
    if (usage.pattern) {
      if (!this.sessionUsage.patternBreakdown[usage.pattern]) {
        this.sessionUsage.patternBreakdown[usage.pattern] = {
          count: 0,
          cost: 0
        };
      }

      this.sessionUsage.patternBreakdown[usage.pattern].count += 1;
      this.sessionUsage.patternBreakdown[usage.pattern].cost += costResult.totalCost;
    }
  }

  /**
   * Check and trigger budget alerts
   * @private
   */
  async _checkBudgetAlerts(newCost) {
    try {
      // Check daily budget
      if (this.options.dailyBudgetUSD) {
        const dailyStatus = await this.checkBudgetStatus('day');

        if (dailyStatus.exceeded && !this.budgetAlerts.dailyExceededTriggered) {
          await this._sendBudgetAlert({
            type: 'daily_exceeded',
            limit: dailyStatus.limit,
            used: dailyStatus.used,
            percentUsed: dailyStatus.percentUsed
          });
          this.budgetAlerts.dailyExceededTriggered = true;
        } else if (dailyStatus.warning && !this.budgetAlerts.dailyWarningTriggered) {
          await this._sendBudgetAlert({
            type: 'daily_warning',
            limit: dailyStatus.limit,
            used: dailyStatus.used,
            percentUsed: dailyStatus.percentUsed
          });
          this.budgetAlerts.dailyWarningTriggered = true;
        }
      }

      // Check monthly budget
      if (this.options.monthlyBudgetUSD) {
        const monthlyStatus = await this.checkBudgetStatus('month');

        if (monthlyStatus.exceeded && !this.budgetAlerts.monthlyExceededTriggered) {
          await this._sendBudgetAlert({
            type: 'monthly_exceeded',
            limit: monthlyStatus.limit,
            used: monthlyStatus.used,
            percentUsed: monthlyStatus.percentUsed
          });
          this.budgetAlerts.monthlyExceededTriggered = true;
        } else if (monthlyStatus.warning && !this.budgetAlerts.monthlyWarningTriggered) {
          await this._sendBudgetAlert({
            type: 'monthly_warning',
            limit: monthlyStatus.limit,
            used: monthlyStatus.used,
            percentUsed: monthlyStatus.percentUsed
          });
          this.budgetAlerts.monthlyWarningTriggered = true;
        }
      }

    } catch (error) {
      this.logger.error('Failed to check budget alerts', {
        error: error.message
      });
    }
  }

  /**
   * Send budget alert notification
   * @private
   */
  async _sendBudgetAlert(alert) {
    try {
      const alertId = `alert-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      // Record in database
      const stmt = this.memoryStore.db.prepare(`
        INSERT INTO budget_alerts (
          id, alert_type, period_start, threshold_usd, actual_usd, percent_used, triggered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const periodStart = this._getPeriodStart(alert.type.startsWith('daily') ? 'day' : 'month');

      stmt.run(
        alertId,
        alert.type,
        periodStart,
        alert.limit,
        alert.used,
        alert.percentUsed,
        Date.now()
      );

      // Log alert
      this.logger.warn('Budget alert triggered', {
        alertId,
        type: alert.type,
        limit: alert.limit,
        used: alert.used,
        percentUsed: alert.percentUsed
      });

      this.budgetAlerts.lastAlertTimestamp = Date.now();

    } catch (error) {
      this.logger.error('Failed to send budget alert', {
        error: error.message,
        alert
      });
    }
  }

  /**
   * Get period range timestamps
   * @private
   */
  _getPeriodRange(period, options) {
    const now = Date.now();
    let startTimestamp, endTimestamp;

    if (options.startDate && options.endDate) {
      startTimestamp = options.startDate.getTime();
      endTimestamp = options.endDate.getTime();
    } else {
      switch (period) {
        case 'hour':
          startTimestamp = now - (60 * 60 * 1000);
          break;
        case 'day':
          startTimestamp = this._getStartOfDay(now);
          break;
        case 'week':
          startTimestamp = now - (7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startTimestamp = this._getStartOfMonth(now);
          break;
        case 'all':
          startTimestamp = 0;
          break;
        default:
          startTimestamp = this._getStartOfDay(now);
      }
      endTimestamp = now;
    }

    return { startTimestamp, endTimestamp };
  }

  /**
   * Get current period range for budget calculations
   * @private
   */
  _getCurrentPeriodRange(period) {
    const now = Date.now();
    const startDate = period === 'day'
      ? new Date(this._getStartOfDay(now))
      : new Date(this._getStartOfMonth(now));

    const endDate = period === 'day'
      ? new Date(this._getStartOfDay(now) + (24 * 60 * 60 * 1000))
      : new Date(this._getStartOfMonth(now) + (30 * 24 * 60 * 60 * 1000));

    return { startDate, endDate };
  }

  /**
   * Get start of day timestamp
   * @private
   */
  _getStartOfDay(timestamp) {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  /**
   * Get start of month timestamp
   * @private
   */
  _getStartOfMonth(timestamp) {
    const date = new Date(timestamp);
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  /**
   * Get period start for alerts
   * @private
   */
  _getPeriodStart(period) {
    const now = Date.now();
    return period === 'day' ? this._getStartOfDay(now) : this._getStartOfMonth(now);
  }

  /**
   * Get model breakdown
   * @private
   */
  _getModelBreakdown(startTimestamp, endTimestamp, options) {
    let query = `
      SELECT
        model,
        SUM(total_tokens) as tokens,
        SUM(total_cost) as cost,
        COUNT(DISTINCT orchestration_id) as count
      FROM token_usage
      WHERE timestamp >= ? AND timestamp <= ?
    `;

    const params = [startTimestamp, endTimestamp];

    if (options.agentId) {
      query += ' AND agent_id = ?';
      params.push(options.agentId);
    }

    if (options.pattern) {
      query += ' AND pattern = ?';
      params.push(options.pattern);
    }

    query += ' GROUP BY model ORDER BY cost DESC';

    const stmt = this.memoryStore.db.prepare(query);
    return stmt.all(...params);
  }

  /**
   * Get date range from options
   * @private
   */
  _getDateRange(options) {
    if (options.startDate && options.endDate) {
      return {
        startDate: options.startDate,
        endDate: options.endDate
      };
    }

    const now = new Date();
    const startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)); // Default: 30 days ago
    const endDate = now;

    return { startDate, endDate };
  }

  /**
   * Get empty summary for error cases
   * @private
   */
  _getEmptySummary(period) {
    return {
      period,
      startDate: new Date(),
      endDate: new Date(),
      orchestrationCount: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalCost: 0,
      cacheSavings: 0,
      cacheSavingsPercent: 0,
      modelBreakdown: [],
      filters: {}
    };
  }
}

module.exports = UsageTracker;
