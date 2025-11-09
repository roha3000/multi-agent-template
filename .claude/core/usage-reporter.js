/**
 * UsageReporter - Generate formatted reports for usage analytics
 *
 * Provides:
 * - Daily/monthly usage reports
 * - Pattern cost analysis
 * - Agent cost analysis
 * - Budget status reports
 * - CLI-formatted output
 * - Export functionality (JSON/CSV)
 *
 * Inspired by ccusage reporting capabilities
 *
 * @module .claude/core/usage-reporter
 */

const { createComponentLogger } = require('./logger');

class UsageReporter {
  /**
   * Create a usage reporter
   *
   * @param {MemoryStore} memoryStore - Database instance
   * @param {UsageTracker} usageTracker - Usage tracker instance
   */
  constructor(memoryStore, usageTracker) {
    if (!memoryStore) {
      throw new Error('MemoryStore is required for UsageReporter');
    }

    if (!usageTracker) {
      throw new Error('UsageTracker is required for UsageReporter');
    }

    this.memoryStore = memoryStore;
    this.usageTracker = usageTracker;
    this.logger = createComponentLogger('UsageReporter');

    this.logger.info('UsageReporter initialized');
  }

  /**
   * Generate daily usage report
   *
   * @param {Object} options - Report options
   * @param {Date} [options.date] - Specific date (defaults to today)
   * @param {boolean} [options.breakdown=false] - Include model breakdown
   * @param {string} [options.format='table'] - 'table', 'json', 'summary'
   * @returns {Promise<Object>} Daily report
   */
  async generateDailyReport(options = {}) {
    try {
      const date = options.date || new Date();
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);

      // Get summary for the day
      const summary = await this.usageTracker.getUsageSummary('day', {
        startDate,
        endDate
      });

      // Get model breakdown if requested
      let modelBreakdown = [];
      if (options.breakdown) {
        modelBreakdown = await this.usageTracker.getCostByModel({
          startDate,
          endDate
        });
      }

      const report = {
        type: 'daily',
        date: date.toISOString().split('T')[0],
        summary: {
          orchestrations: summary.orchestrationCount,
          totalTokens: summary.totalTokens,
          inputTokens: summary.inputTokens,
          outputTokens: summary.outputTokens,
          cacheTokens: summary.cacheCreationTokens + summary.cacheReadTokens,
          totalCost: summary.totalCost,
          cacheSavings: summary.cacheSavings
        },
        modelBreakdown,
        generatedAt: new Date().toISOString()
      };

      return report;

    } catch (error) {
      this.logger.error('Failed to generate daily report', {
        error: error.message,
        options
      });

      return this._getEmptyReport('daily');
    }
  }

  /**
   * Generate monthly usage report
   *
   * @param {Object} options - Report options
   * @param {number} [options.year] - Year (defaults to current)
   * @param {number} [options.month] - Month (1-12, defaults to current)
   * @param {boolean} [options.breakdown=true] - Include breakdowns
   * @returns {Promise<Object>} Monthly report
   */
  async generateMonthlyReport(options = {}) {
    try {
      const now = new Date();
      const year = options.year || now.getFullYear();
      const month = options.month || (now.getMonth() + 1);

      const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
      const endDate = new Date(year, month, 0, 23, 59, 59, 999);

      // Get summary for the month
      const summary = await this.usageTracker.getUsageSummary('month', {
        startDate,
        endDate
      });

      // Get breakdowns
      let modelBreakdown = [];
      let topPatterns = [];

      if (options.breakdown !== false) {
        modelBreakdown = await this.usageTracker.getCostByModel({
          startDate,
          endDate
        });

        // Get pattern costs from database view
        topPatterns = this._getPatternCosts(startDate, endDate);
      }

      const report = {
        type: 'monthly',
        year,
        month,
        monthName: startDate.toLocaleString('default', { month: 'long' }),
        summary: {
          orchestrations: summary.orchestrationCount,
          totalTokens: summary.totalTokens,
          totalCost: summary.totalCost,
          cacheSavings: summary.cacheSavings,
          averageCostPerDay: summary.totalCost / new Date(year, month, 0).getDate()
        },
        modelBreakdown,
        topPatterns,
        generatedAt: new Date().toISOString()
      };

      return report;

    } catch (error) {
      this.logger.error('Failed to generate monthly report', {
        error: error.message,
        options
      });

      return this._getEmptyReport('monthly');
    }
  }

  /**
   * Generate pattern cost analysis
   *
   * @param {Object} options - Analysis options
   * @param {string} [options.timeframe='30days'] - Analysis period
   * @param {boolean} [options.includeAgents=false] - Agent breakdown per pattern
   * @returns {Promise<Object>} Pattern analysis
   */
  async generatePatternCostAnalysis(options = {}) {
    try {
      const { startDate, endDate } = this._getTimeframeRange(options.timeframe || '30days');

      // Query pattern efficiency view
      const patterns = this.memoryStore.db.prepare(`
        SELECT * FROM v_pattern_efficiency
        WHERE pattern IS NOT NULL
        ORDER BY cost_per_success ASC
      `).all();

      // Filter by date range (view doesn't have date filter)
      const patternData = patterns.map(p => ({
        pattern: p.pattern,
        orchestrations: p.total_orchestrations,
        successfulOrchestrations: p.successful_orchestrations,
        successRate: p.success_rate,
        totalCost: p.total_cost,
        avgCostPerOrchestration: p.avg_cost_per_orchestration,
        costPerSuccess: p.cost_per_success
      }));

      // Sort by efficiency (cost per success)
      patternData.sort((a, b) => a.costPerSuccess - b.costPerSuccess);

      const report = {
        type: 'pattern_analysis',
        timeframe: options.timeframe,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        patterns: patternData,
        summary: {
          totalPatterns: patternData.length,
          mostEfficient: patternData[0]?.pattern || null,
          leastEfficient: patternData[patternData.length - 1]?.pattern || null
        },
        generatedAt: new Date().toISOString()
      };

      return report;

    } catch (error) {
      this.logger.error('Failed to generate pattern cost analysis', {
        error: error.message,
        options
      });

      return this._getEmptyReport('pattern_analysis');
    }
  }

  /**
   * Generate agent cost analysis
   *
   * @param {Object} options - Analysis options
   * @param {string} [options.timeframe='30days'] - Analysis period
   * @param {string} [options.sortBy='cost'] - 'cost', 'tokens', 'executions'
   * @returns {Promise<Object>} Agent analysis
   */
  async generateAgentCostAnalysis(options = {}) {
    try {
      const { startDate, endDate } = this._getTimeframeRange(options.timeframe || '30days');

      // Query agent costs view
      const agents = this.memoryStore.db.prepare(`
        SELECT * FROM v_agent_costs
        ORDER BY total_cost DESC
      `).all();

      const agentData = agents.map(a => ({
        agentId: a.agent_id,
        executions: a.executions,
        totalTokens: a.total_tokens,
        totalCost: a.total_cost,
        avgCostPerExecution: a.avg_cost_per_execution,
        totalSavings: a.total_savings,
        avgSavingsPercent: a.avg_savings_pct
      }));

      // Sort by requested field
      const sortBy = options.sortBy || 'cost';
      if (sortBy === 'tokens') {
        agentData.sort((a, b) => b.totalTokens - a.totalTokens);
      } else if (sortBy === 'executions') {
        agentData.sort((a, b) => b.executions - a.executions);
      }
      // Default is already sorted by cost

      const report = {
        type: 'agent_analysis',
        timeframe: options.timeframe,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        agents: agentData,
        summary: {
          totalAgents: agentData.length,
          totalExecutions: agentData.reduce((sum, a) => sum + a.executions, 0),
          totalCost: agentData.reduce((sum, a) => sum + a.totalCost, 0),
          mostExpensive: agentData[0]?.agentId || null
        },
        generatedAt: new Date().toISOString()
      };

      return report;

    } catch (error) {
      this.logger.error('Failed to generate agent cost analysis', {
        error: error.message,
        options
      });

      return this._getEmptyReport('agent_analysis');
    }
  }

  /**
   * Generate billing window report (5-hour windows like ccusage)
   *
   * @param {Object} options - Report options
   * @param {Date} [options.startTime] - Window start (defaults to now - 5h)
   * @param {boolean} [options.live=false] - Live updating mode
   * @returns {Promise<Object>} Billing window report
   */
  async generateBillingWindowReport(options = {}) {
    try {
      const WINDOW_MS = 5 * 60 * 60 * 1000; // 5 hours
      const endTime = new Date();
      const startTime = options.startTime || new Date(endTime.getTime() - WINDOW_MS);

      // Query billing windows view
      const windows = this.memoryStore.db.prepare(`
        SELECT * FROM v_billing_windows
        WHERE window_start >= datetime(?, 'unixepoch')
        AND window_end <= datetime(?, 'unixepoch')
        ORDER BY window_start DESC
        LIMIT 10
      `).all(
        Math.floor(startTime.getTime() / 1000),
        Math.floor(endTime.getTime() / 1000)
      );

      const windowData = windows.map(w => ({
        windowStart: w.window_start,
        windowEnd: w.window_end,
        orchestrations: w.orchestrations,
        totalTokens: w.total_tokens,
        totalCost: w.total_cost,
        cacheSavings: w.cache_savings
      }));

      const report = {
        type: 'billing_window',
        windowSize: '5 hours',
        windows: windowData,
        summary: {
          totalWindows: windowData.length,
          totalCost: windowData.reduce((sum, w) => sum + w.totalCost, 0),
          avgCostPerWindow: windowData.length > 0
            ? windowData.reduce((sum, w) => sum + w.totalCost, 0) / windowData.length
            : 0
        },
        generatedAt: new Date().toISOString()
      };

      return report;

    } catch (error) {
      this.logger.error('Failed to generate billing window report', {
        error: error.message,
        options
      });

      return this._getEmptyReport('billing_window');
    }
  }

  /**
   * Generate cost efficiency report (cost per successful result)
   *
   * @param {Object} options - Report options
   * @param {string} [options.timeframe='30days'] - Analysis period
   * @returns {Promise<Object>} Efficiency analysis
   */
  async generateEfficiencyReport(options = {}) {
    try {
      const patternAnalysis = await this.generatePatternCostAnalysis(options);

      // Calculate overall efficiency metrics
      const patterns = patternAnalysis.patterns;
      const totalCost = patterns.reduce((sum, p) => sum + p.totalCost, 0);
      const totalSuccess = patterns.reduce((sum, p) => sum + p.successfulOrchestrations, 0);
      const overallEfficiency = totalSuccess > 0 ? totalCost / totalSuccess : 0;

      const report = {
        type: 'efficiency',
        timeframe: options.timeframe,
        summary: {
          overallCostPerSuccess: overallEfficiency,
          totalSuccesses: totalSuccess,
          totalCost
        },
        patterns: patterns.map(p => ({
          pattern: p.pattern,
          successRate: p.successRate,
          costPerSuccess: p.costPerSuccess,
          efficiency: overallEfficiency > 0 ? (p.costPerSuccess / overallEfficiency) : 1
        })),
        generatedAt: new Date().toISOString()
      };

      return report;

    } catch (error) {
      this.logger.error('Failed to generate efficiency report', {
        error: error.message,
        options
      });

      return this._getEmptyReport('efficiency');
    }
  }

  /**
   * Generate budget status report
   *
   * @param {Object} options - Report options
   * @returns {Promise<Object>} Budget status
   */
  async generateBudgetReport(options = {}) {
    try {
      const dailyStatus = await this.usageTracker.checkBudgetStatus('day');
      const monthlyStatus = await this.usageTracker.checkBudgetStatus('month');

      const report = {
        type: 'budget',
        daily: dailyStatus,
        monthly: monthlyStatus,
        alerts: this._getRecentAlerts(7), // Last 7 days of alerts
        generatedAt: new Date().toISOString()
      };

      return report;

    } catch (error) {
      this.logger.error('Failed to generate budget report', {
        error: error.message,
        options
      });

      return this._getEmptyReport('budget');
    }
  }

  /**
   * Format report for CLI display
   *
   * @param {Object} report - Report data
   * @param {string} format - 'table', 'compact', 'detailed'
   * @returns {string} Formatted output
   */
  formatForCLI(report, format = 'table') {
    if (!report || !report.type) {
      return 'No report data available';
    }

    switch (report.type) {
      case 'daily':
        return this._formatDailyReport(report, format);
      case 'monthly':
        return this._formatMonthlyReport(report, format);
      case 'pattern_analysis':
        return this._formatPatternAnalysis(report, format);
      case 'agent_analysis':
        return this._formatAgentAnalysis(report, format);
      case 'budget':
        return this._formatBudgetReport(report, format);
      default:
        return JSON.stringify(report, null, 2);
    }
  }

  /**
   * Export report to file
   *
   * @param {Object} report - Report data
   * @param {string} filepath - Output path
   * @param {string} format - 'json' or 'csv'
   * @returns {Promise<void>}
   */
  async exportReport(report, filepath, format = 'json') {
    try {
      const fs = require('fs');
      const path = require('path');

      // Ensure directory exists
      const dir = path.dirname(filepath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (format === 'json') {
        fs.writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf8');
      } else if (format === 'csv') {
        const csv = this._convertToCSV(report);
        fs.writeFileSync(filepath, csv, 'utf8');
      } else {
        throw new Error(`Unsupported export format: ${format}`);
      }

      this.logger.info('Report exported', { filepath, format });

    } catch (error) {
      this.logger.error('Failed to export report', {
        error: error.message,
        filepath,
        format
      });

      throw error;
    }
  }

  // ============================================================================
  // Internal Methods
  // ============================================================================

  /**
   * Get timeframe date range
   * @private
   */
  _getTimeframeRange(timeframe) {
    const now = new Date();
    let startDate;

    switch (timeframe) {
      case '7days':
        startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        break;
      case '30days':
        startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        break;
      case '90days':
        startDate = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));
        break;
      default:
        startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    }

    return { startDate, endDate: now };
  }

  /**
   * Get pattern costs for date range
   * @private
   */
  _getPatternCosts(startDate, endDate) {
    try {
      const patterns = this.memoryStore.db.prepare(`
        SELECT
          pattern,
          COUNT(*) as count,
          SUM(total_cost) as total_cost,
          AVG(total_cost) as avg_cost
        FROM token_usage
        WHERE timestamp >= ? AND timestamp <= ?
        AND pattern IS NOT NULL
        GROUP BY pattern
        ORDER BY total_cost DESC
        LIMIT 10
      `).all(startDate.getTime(), endDate.getTime());

      return patterns.map(p => ({
        pattern: p.pattern,
        count: p.count,
        totalCost: p.total_cost,
        avgCost: p.avg_cost
      }));

    } catch (error) {
      this.logger.error('Failed to get pattern costs', { error: error.message });
      return [];
    }
  }

  /**
   * Get recent budget alerts
   * @private
   */
  _getRecentAlerts(days) {
    try {
      const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);

      const alerts = this.memoryStore.db.prepare(`
        SELECT * FROM budget_alerts
        WHERE triggered_at >= ?
        ORDER BY triggered_at DESC
        LIMIT 20
      `).all(cutoff);

      return alerts.map(a => ({
        type: a.alert_type,
        limit: a.threshold_usd,
        actual: a.actual_usd,
        percentUsed: a.percent_used,
        triggeredAt: new Date(a.triggered_at).toISOString(),
        acknowledged: a.acknowledged === 1
      }));

    } catch (error) {
      this.logger.error('Failed to get recent alerts', { error: error.message });
      return [];
    }
  }

  /**
   * Format daily report for CLI
   * @private
   */
  _formatDailyReport(report, format) {
    const s = report.summary;

    let output = `Daily Usage Report - ${report.date}\n`;
    output += `${'='.repeat(50)}\n\n`;
    output += `Orchestrations: ${s.orchestrations}\n`;
    output += `Total Tokens:   ${this._formatNumber(s.totalTokens)}\n`;
    output += `Total Cost:     $${s.totalCost.toFixed(2)}\n`;
    output += `Cache Savings:  $${s.cacheSavings.toFixed(2)}\n`;

    if (report.modelBreakdown && report.modelBreakdown.length > 0) {
      output += `\nModel Breakdown:\n`;
      output += `${'='.repeat(50)}\n`;

      for (const model of report.modelBreakdown) {
        output += `${model.model}:\n`;
        output += `  Orchestrations: ${model.orchestrationCount}\n`;
        output += `  Cost: $${model.totalCost.toFixed(2)}\n`;
      }
    }

    return output;
  }

  /**
   * Format monthly report for CLI
   * @private
   */
  _formatMonthlyReport(report, format) {
    const s = report.summary;

    let output = `Monthly Usage Report - ${report.monthName} ${report.year}\n`;
    output += `${'='.repeat(50)}\n\n`;
    output += `Orchestrations: ${s.orchestrations}\n`;
    output += `Total Tokens:   ${this._formatNumber(s.totalTokens)}\n`;
    output += `Total Cost:     $${s.totalCost.toFixed(2)}\n`;
    output += `Avg Cost/Day:   $${s.averageCostPerDay.toFixed(2)}\n`;
    output += `Cache Savings:  $${s.cacheSavings.toFixed(2)}\n`;

    return output;
  }

  /**
   * Format pattern analysis for CLI
   * @private
   */
  _formatPatternAnalysis(report, format) {
    let output = `Pattern Cost Analysis\n`;
    output += `${'='.repeat(50)}\n\n`;

    for (const pattern of report.patterns.slice(0, 10)) {
      output += `${pattern.pattern}:\n`;
      output += `  Success Rate:  ${pattern.successRate.toFixed(1)}%\n`;
      output += `  Cost/Success:  $${pattern.costPerSuccess.toFixed(4)}\n`;
      output += `  Total Cost:    $${pattern.totalCost.toFixed(2)}\n\n`;
    }

    return output;
  }

  /**
   * Format agent analysis for CLI
   * @private
   */
  _formatAgentAnalysis(report, format) {
    let output = `Agent Cost Analysis\n`;
    output += `${'='.repeat(50)}\n\n`;

    for (const agent of report.agents.slice(0, 10)) {
      output += `${agent.agentId}:\n`;
      output += `  Executions:    ${agent.executions}\n`;
      output += `  Total Cost:    $${agent.totalCost.toFixed(2)}\n`;
      output += `  Avg Cost:      $${agent.avgCostPerExecution.toFixed(4)}\n\n`;
    }

    return output;
  }

  /**
   * Format budget report for CLI
   * @private
   */
  _formatBudgetReport(report, format) {
    let output = `Budget Status Report\n`;
    output += `${'='.repeat(50)}\n\n`;

    output += `Daily Budget:\n`;
    if (report.daily.limit) {
      output += `  Limit:     $${report.daily.limit.toFixed(2)}\n`;
      output += `  Used:      $${report.daily.used.toFixed(2)} (${report.daily.percentUsed.toFixed(1)}%)\n`;
      output += `  Remaining: $${report.daily.remaining.toFixed(2)}\n`;
      output += `  Status:    ${report.daily.exceeded ? 'EXCEEDED' : report.daily.warning ? 'WARNING' : 'OK'}\n`;
    } else {
      output += `  No daily budget set\n`;
    }

    output += `\nMonthly Budget:\n`;
    if (report.monthly.limit) {
      output += `  Limit:     $${report.monthly.limit.toFixed(2)}\n`;
      output += `  Used:      $${report.monthly.used.toFixed(2)} (${report.monthly.percentUsed.toFixed(1)}%)\n`;
      output += `  Remaining: $${report.monthly.remaining.toFixed(2)}\n`;
      output += `  Status:    ${report.monthly.exceeded ? 'EXCEEDED' : report.monthly.warning ? 'WARNING' : 'OK'}\n`;
    } else {
      output += `  No monthly budget set\n`;
    }

    return output;
  }

  /**
   * Convert report to CSV
   * @private
   */
  _convertToCSV(report) {
    // Simple CSV conversion - can be enhanced based on report type
    if (report.type === 'daily' || report.type === 'monthly') {
      const s = report.summary;
      let csv = 'Metric,Value\n';
      csv += `Orchestrations,${s.orchestrations}\n`;
      csv += `Total Tokens,${s.totalTokens}\n`;
      csv += `Total Cost,${s.totalCost}\n`;
      csv += `Cache Savings,${s.cacheSavings}\n`;
      return csv;
    }

    return JSON.stringify(report);
  }

  /**
   * Format number with commas
   * @private
   */
  _formatNumber(num) {
    return num.toLocaleString();
  }

  /**
   * Get empty report for error cases
   * @private
   */
  _getEmptyReport(type) {
    return {
      type,
      summary: {},
      generatedAt: new Date().toISOString(),
      error: 'Failed to generate report'
    };
  }
}

module.exports = UsageReporter;
