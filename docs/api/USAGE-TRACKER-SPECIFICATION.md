# UsageTracker Component - Technical Specification

**Version:** 1.0
**Component:** `.claude/core/usage-tracker.js`
**Date:** 2025-11-08
**Author:** System Architect Agent
**Status:** Ready for Implementation

---

## Table of Contents

1. [Component Overview](#component-overview)
2. [Class Specification](#class-specification)
3. [Public API Reference](#public-api-reference)
4. [Internal Implementation](#internal-implementation)
5. [Database Interactions](#database-interactions)
6. [Error Handling](#error-handling)
7. [Performance Considerations](#performance-considerations)
8. [Usage Examples](#usage-examples)
9. [Testing Specification](#testing-specification)

---

## Component Overview

### Purpose

The `UsageTracker` component is responsible for:
1. **Recording token usage** from orchestration executions with per-model granularity
2. **Calculating costs** using the `CostCalculator` service
3. **Tracking budget consumption** and triggering alerts when thresholds are exceeded
4. **Providing query interfaces** for usage summaries and analytics
5. **Managing session state** for real-time usage monitoring

### Design Principles

- **Non-blocking**: Never throw errors that would halt orchestration execution
- **Accurate**: Precise token counting and cost calculation
- **Efficient**: Minimal performance overhead (<10ms per record)
- **Flexible**: Support multiple models, patterns, and agents
- **Observable**: Comprehensive logging for debugging

### Dependencies

```javascript
const { createComponentLogger } = require('./logger');
const CostCalculator = require('./cost-calculator');
```

**Required:**
- `MemoryStore` instance (passed to constructor)
- `CostCalculator` for cost calculations

**Optional:**
- Webhook service for budget alerts (future enhancement)

---

## Class Specification

### Constructor

```javascript
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
   */
  constructor(memoryStore, options = {})
}
```

### Constructor Implementation

```javascript
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
```

---

## Public API Reference

### recordUsage()

**Purpose:** Record token usage and cost for an orchestration.

**Signature:**
```javascript
async recordUsage(usage)
```

**Parameters:**
```typescript
interface UsageRecord {
  orchestrationId: string;        // Required: Orchestration ID
  model: string;                  // Required: Model used (e.g., 'claude-sonnet-4.5')
  inputTokens: number;            // Required: Input tokens consumed
  outputTokens: number;           // Required: Output tokens generated
  cacheCreationTokens?: number;   // Optional: Cache creation tokens (default: 0)
  cacheReadTokens?: number;       // Optional: Cache read tokens (default: 0)
  agentId?: string;               // Optional: Specific agent within orchestration
  pattern?: string;               // Optional: Orchestration pattern
  workSessionId?: string;         // Optional: Work session ID
  metadata?: Record<string, any>; // Optional: Additional metadata
}
```

**Returns:** `Promise<string | null>` - Usage record ID or null on failure

**Implementation:**
```javascript
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
```

---

### getUsageSummary()

**Purpose:** Get aggregated usage statistics for a time period.

**Signature:**
```javascript
async getUsageSummary(period, options = {})
```

**Parameters:**
```typescript
type Period = 'hour' | 'day' | 'week' | 'month' | 'all';

interface SummaryOptions {
  startDate?: Date;      // Filter from this date
  endDate?: Date;        // Filter until this date
  model?: string;        // Filter by specific model
  agentId?: string;      // Filter by specific agent
  pattern?: string;      // Filter by orchestration pattern
  workSessionId?: string; // Filter by work session
}
```

**Returns:** `Promise<UsageSummary>`

```typescript
interface UsageSummary {
  period: string;
  startDate: Date;
  endDate: Date;
  orchestrationCount: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalCost: number;
  cacheSavings: number;
  cacheSavingsPercent: number;
  modelBreakdown: Array<{
    model: string;
    tokens: number;
    cost: number;
    count: number;
  }>;
  filters?: SummaryOptions;
}
```

**Implementation:**
```javascript
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
```

---

### getSessionUsage()

**Purpose:** Get current session usage from in-memory cache (fast, no DB query).

**Signature:**
```javascript
getSessionUsage()
```

**Returns:** `SessionUsage`

```typescript
interface SessionUsage {
  totalTokens: number;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cacheSavings: number;
  startTime: number;
  duration: number;
  orchestrationCount: number;
  modelBreakdown: Record<string, { tokens: number; cost: number }>;
  patternBreakdown: Record<string, { count: number; cost: number }>;
}
```

**Implementation:**
```javascript
getSessionUsage() {
  return {
    ...this.sessionUsage,
    duration: Date.now() - this.sessionUsage.startTime
  };
}
```

---

### checkBudgetStatus()

**Purpose:** Check if budget thresholds are exceeded.

**Signature:**
```javascript
async checkBudgetStatus(period)
```

**Parameters:**
- `period: 'day' | 'month'` - Budget period to check

**Returns:** `Promise<BudgetStatus>`

```typescript
interface BudgetStatus {
  period: 'day' | 'month';
  limit: number | null;      // Budget limit in USD
  used: number;              // Amount used in USD
  remaining: number;         // Amount remaining
  percentUsed: number;       // Percentage of budget used
  exceeded: boolean;         // True if limit exceeded
  warning: boolean;          // True if warning threshold exceeded
  projection: number | null; // Projected end-of-period cost
}
```

**Implementation:**
```javascript
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
```

---

### getCostByModel()

**Purpose:** Get cost breakdown by model.

**Signature:**
```javascript
async getCostByModel(options = {})
```

**Parameters:**
```typescript
interface CostBreakdownOptions {
  startDate?: Date;
  endDate?: Date;
  pattern?: string;
  agentId?: string;
  sortBy?: 'cost' | 'tokens' | 'count'; // Default: 'cost'
  limit?: number; // Default: no limit
}
```

**Returns:** `Promise<Array<ModelCost>>`

```typescript
interface ModelCost {
  model: string;
  orchestrationCount: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalCost: number;
  avgCostPerOrchestration: number;
  cacheSavings: number;
}
```

**Implementation:**
```javascript
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
```

---

### getCostByPattern()

**Purpose:** Get cost breakdown by orchestration pattern.

**Signature:**
```javascript
async getCostByPattern(options = {})
```

**Returns:** `Promise<Array<PatternCost>>`

```typescript
interface PatternCost {
  pattern: string;
  orchestrationCount: number;
  successfulOrchestrations: number;
  successRate: number;
  totalCost: number;
  avgCostPerOrchestration: number;
  costPerSuccess: number;
  totalTokens: number;
}
```

**Implementation:** (Similar structure to `getCostByModel()`)

---

### getCostByAgent()

**Purpose:** Get cost breakdown by agent.

**Signature:**
```javascript
async getCostByAgent(options = {})
```

**Returns:** `Promise<Array<AgentCost>>`

**Implementation:** (Similar structure to `getCostByModel()`)

---

### exportUsage()

**Purpose:** Export usage data for external analysis.

**Signature:**
```javascript
async exportUsage(options)
```

**Parameters:**
```typescript
interface ExportOptions {
  format: 'json' | 'csv';
  startDate: Date;
  endDate: Date;
  includeMetadata?: boolean; // Default: false
}
```

**Returns:** `Promise<string>` - Serialized data

**Implementation:**
```javascript
async exportUsage(options) {
  try {
    const { startDate, endDate, format, includeMetadata = false } = options;

    // Query all usage records in range
    const records = await this._getAllUsageRecords(startDate, endDate);

    if (format === 'json') {
      return JSON.stringify(records, null, 2);
    } else if (format === 'csv') {
      return this._convertToCSV(records, includeMetadata);
    } else {
      throw new Error(`Unsupported format: ${format}`);
    }

  } catch (error) {
    this.logger.error('Failed to export usage', {
      error: error.message,
      options
    });

    throw error;
  }
}
```

---

### cleanupOldRecords()

**Purpose:** Delete usage records older than retention period.

**Signature:**
```javascript
async cleanupOldRecords(retentionDays)
```

**Parameters:**
- `retentionDays: number` - Keep records for this many days

**Returns:** `Promise<number>` - Number of records deleted

**Implementation:**
```javascript
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
```

---

## Internal Implementation

### _updateSessionCache()

**Purpose:** Update in-memory session cache with new usage.

```javascript
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
```

---

### _checkBudgetAlerts()

**Purpose:** Check budget thresholds and trigger alerts.

```javascript
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
```

---

### _sendBudgetAlert()

**Purpose:** Record and log budget alert.

```javascript
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

    // Future: Send webhook notification
    if (this.options.alertWebhook) {
      // await this._sendWebhook(this.options.alertWebhook, alert);
    }

    this.budgetAlerts.lastAlertTimestamp = Date.now();

  } catch (error) {
    this.logger.error('Failed to send budget alert', {
      error: error.message,
      alert
    });
  }
}
```

---

## Error Handling

### Critical Principle: Non-Blocking

**All methods MUST NOT throw errors that would block orchestration execution.**

```javascript
// ✅ CORRECT: Catch errors, log, return graceful fallback
async recordUsage(usage) {
  try {
    // ... implementation ...
  } catch (error) {
    this.logger.error('Failed to record usage', { error: error.message });
    return null; // Graceful failure
  }
}

// ❌ INCORRECT: Throwing would block orchestration
async recordUsage(usage) {
  // ... implementation ...
  throw new Error('Database error'); // NEVER DO THIS
}
```

### Error Recovery Strategies

1. **Database Errors**: Log error, return null/empty result
2. **Calculation Errors**: Log error, use fallback values (0 cost, unknown model)
3. **Budget Alert Failures**: Log error, continue tracking
4. **Export Failures**: Throw error (export is user-initiated, blocking is acceptable)

---

## Performance Considerations

### Targets

- **Recording:** <10ms per `recordUsage()` call
- **Summary Queries:** <100ms for 30-day aggregation
- **Session Cache Access:** <1ms (`getSessionUsage()`)
- **Memory Overhead:** <5MB for session cache

### Optimizations

1. **In-Memory Session Cache**: Fast access without DB queries
2. **Database Indexes**: All time-based queries use indexed columns
3. **Prepared Statements**: Reuse compiled SQL queries
4. **Batch Operations**: Use transactions for bulk operations
5. **View Caching**: Pre-compute aggregations in views

### Monitoring

```javascript
// Add timing metrics
const startTime = process.hrtime.bigint();

// ... operation ...

const endTime = process.hrtime.bigint();
const durationMs = Number(endTime - startTime) / 1_000_000;

this.logger.debug('Operation timing', {
  operation: 'recordUsage',
  durationMs
});
```

---

## Usage Examples

### Example 1: Basic Usage Recording

```javascript
const memoryStore = new MemoryStore('.claude/memory/orchestrations.db');
const usageTracker = new UsageTracker(memoryStore, {
  enableTracking: true
});

// Record usage after orchestration
const usageId = await usageTracker.recordUsage({
  orchestrationId: 'orch-123',
  model: 'claude-sonnet-4.5',
  inputTokens: 5000,
  outputTokens: 2000,
  cacheCreationTokens: 500,
  cacheReadTokens: 3000,
  pattern: 'parallel',
  agentId: 'agent-1'
});

console.log('Usage recorded:', usageId);
```

### Example 2: Daily Usage Report

```javascript
// Get daily usage summary
const dailySummary = await usageTracker.getUsageSummary('day');

console.log('Daily Usage Summary:');
console.log(`  Orchestrations: ${dailySummary.orchestrationCount}`);
console.log(`  Total Tokens: ${dailySummary.totalTokens.toLocaleString()}`);
console.log(`  Total Cost: $${dailySummary.totalCost.toFixed(2)}`);
console.log(`  Cache Savings: $${dailySummary.cacheSavings.toFixed(2)} (${dailySummary.cacheSavingsPercent.toFixed(1)}%)`);

console.log('\nModel Breakdown:');
dailySummary.modelBreakdown.forEach(model => {
  console.log(`  ${model.model}: ${model.tokens.toLocaleString()} tokens, $${model.cost.toFixed(2)}`);
});
```

### Example 3: Budget Monitoring

```javascript
const usageTracker = new UsageTracker(memoryStore, {
  enableTracking: true,
  enableBudgetAlerts: true,
  dailyBudgetUSD: 50.00,
  monthlyBudgetUSD: 1000.00
});

// Check budget status
const budgetStatus = await usageTracker.checkBudgetStatus('day');

if (budgetStatus.exceeded) {
  console.warn('⚠️  Daily budget exceeded!');
  console.warn(`   Used: $${budgetStatus.used.toFixed(2)} / $${budgetStatus.limit.toFixed(2)}`);
} else if (budgetStatus.warning) {
  console.warn('⚠️  Approaching daily budget limit');
  console.warn(`   Used: ${budgetStatus.percentUsed.toFixed(1)}%`);
} else {
  console.log('✓ Budget OK');
  console.log(`  Used: $${budgetStatus.used.toFixed(2)} / $${budgetStatus.limit.toFixed(2)} (${budgetStatus.percentUsed.toFixed(1)}%)`);
}
```

### Example 4: Cost Analysis by Pattern

```javascript
// Analyze cost by pattern
const patternCosts = await usageTracker.getCostByPattern({
  startDate: new Date('2025-11-01'),
  endDate: new Date('2025-11-08'),
  sortBy: 'cost'
});

console.log('Pattern Cost Analysis:');
patternCosts.forEach(pattern => {
  console.log(`  ${pattern.pattern}:`);
  console.log(`    Total Cost: $${pattern.totalCost.toFixed(2)}`);
  console.log(`    Avg Cost: $${pattern.avgCostPerOrchestration.toFixed(2)}`);
  console.log(`    Cost per Success: $${pattern.costPerSuccess.toFixed(2)}`);
  console.log(`    Success Rate: ${pattern.successRate.toFixed(1)}%`);
});
```

### Example 5: Real-Time Session Monitoring

```javascript
// Get current session usage (fast, in-memory)
const sessionUsage = usageTracker.getSessionUsage();

console.log('Current Session:');
console.log(`  Duration: ${(sessionUsage.duration / 1000 / 60).toFixed(1)} minutes`);
console.log(`  Orchestrations: ${sessionUsage.orchestrationCount}`);
console.log(`  Total Tokens: ${sessionUsage.totalTokens.toLocaleString()}`);
console.log(`  Total Cost: $${sessionUsage.totalCost.toFixed(2)}`);
console.log(`  Cache Savings: $${sessionUsage.cacheSavings.toFixed(2)}`);

console.log('\nModels Used:');
Object.entries(sessionUsage.modelBreakdown).forEach(([model, stats]) => {
  console.log(`  ${model}: ${stats.tokens.toLocaleString()} tokens, $${stats.cost.toFixed(2)}`);
});
```

---

## Testing Specification

### Test Coverage Requirements

- **Unit Tests**: 80%+ code coverage
- **Integration Tests**: All public methods with database
- **Error Handling**: All error paths tested

### Unit Test Structure

```javascript
describe('UsageTracker', () => {
  let memoryStore;
  let usageTracker;

  beforeEach(() => {
    memoryStore = new MemoryStore(':memory:');
    usageTracker = new UsageTracker(memoryStore);
  });

  afterEach(() => {
    memoryStore.close();
  });

  describe('recordUsage', () => {
    test('should record basic usage', async () => {
      const usageId = await usageTracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 500
      });

      expect(usageId).toBeTruthy();

      // Verify in database
      const record = memoryStore.db.prepare('SELECT * FROM token_usage WHERE id = ?').get(usageId);
      expect(record.total_tokens).toBe(1500);
      expect(record.total_cost).toBeGreaterThan(0);
    });

    test('should handle cache tokens', async () => {
      const usageId = await usageTracker.recordUsage({
        orchestrationId: 'orch-2',
        model: 'claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 200,
        cacheReadTokens: 800
      });

      const record = memoryStore.db.prepare('SELECT * FROM token_usage WHERE id = ?').get(usageId);
      expect(record.cache_savings).toBeGreaterThan(0);
    });

    test('should return null on database error', async () => {
      memoryStore.db.close(); // Close DB to force error

      const usageId = await usageTracker.recordUsage({
        orchestrationId: 'orch-3',
        model: 'claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 500
      });

      expect(usageId).toBeNull();
    });
  });

  describe('getUsageSummary', () => {
    beforeEach(async () => {
      // Insert test data
      await usageTracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 500
      });
    });

    test('should aggregate daily usage', async () => {
      const summary = await usageTracker.getUsageSummary('day');

      expect(summary.orchestrationCount).toBe(1);
      expect(summary.totalTokens).toBe(1500);
      expect(summary.totalCost).toBeGreaterThan(0);
    });

    test('should filter by model', async () => {
      const summary = await usageTracker.getUsageSummary('day', {
        model: 'claude-sonnet-4.5'
      });

      expect(summary.modelBreakdown).toHaveLength(1);
      expect(summary.modelBreakdown[0].model).toBe('claude-sonnet-4.5');
    });
  });

  describe('checkBudgetStatus', () => {
    test('should detect budget exceeded', async () => {
      usageTracker.options.dailyBudgetUSD = 0.01; // Very low budget

      await usageTracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4.5',
        inputTokens: 10000,
        outputTokens: 5000
      });

      const status = await usageTracker.checkBudgetStatus('day');

      expect(status.exceeded).toBe(true);
      expect(status.percentUsed).toBeGreaterThan(100);
    });
  });

  describe('getSessionUsage', () => {
    test('should return in-memory session stats', () => {
      const sessionUsage = usageTracker.getSessionUsage();

      expect(sessionUsage).toHaveProperty('totalTokens');
      expect(sessionUsage).toHaveProperty('totalCost');
      expect(sessionUsage).toHaveProperty('duration');
      expect(sessionUsage.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
```

---

**End of Specification**
