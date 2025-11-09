# Usage Analytics Layer Architecture Design

**Version:** 1.0
**Date:** 2025-11-08
**Architect:** System Architect Agent
**Status:** Design Complete - Ready for Implementation
**Inspiration:** ccusage (https://github.com/ryoppippi/ccusage)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Component Specifications](#component-specifications)
   - [UsageTracker](#1-usagetracker)
   - [CostCalculator](#2-costcalculator)
   - [UsageReporter](#3-usagereporter)
4. [Database Schema Extensions](#database-schema-extensions)
5. [Integration Architecture](#integration-architecture)
6. [Reporting & Analytics](#reporting--analytics)
7. [Cost Optimization Strategy](#cost-optimization-strategy)
8. [Testing Strategy](#testing-strategy)
9. [Implementation Roadmap](#implementation-roadmap)

---

## Executive Summary

The Usage Analytics Layer adds comprehensive token tracking, cost calculation, and resource usage reporting to the multi-agent framework. Inspired by ccusage's powerful analytics capabilities, this layer enables budget monitoring, cost optimization, and performance analysis across all orchestration patterns and AI models.

**Key Design Principles:**
- **Accurate Token Tracking**: Per-agent, per-model, per-orchestration granularity
- **Multi-Model Cost Analysis**: Support for Claude (Sonnet 4.5, Sonnet 4), GPT-4o, o1-preview
- **Budget Awareness**: Real-time cost monitoring and alerts
- **Performance Insights**: Identify cost-inefficient patterns and agents
- **Graceful Degradation**: Failures in usage tracking never block orchestration
- **Privacy First**: All analytics stored locally in SQLite

**Business Value:**
- **Cost Control**: Track spending per orchestration pattern, prevent budget overruns
- **ROI Analysis**: Measure cost-effectiveness of different agent configurations
- **Resource Optimization**: Identify expensive operations for targeted improvements
- **Budget Forecasting**: Predict monthly costs based on usage trends
- **Multi-Model Strategy**: Validate cost assumptions in CLAUDE.md model selection rules

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                   Usage Analytics Layer                          │
│                                                                   │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐ │
│  │  UsageTracker   │  │ CostCalculator   │  │ UsageReporter  │ │
│  │                 │  │                  │  │                │ │
│  │ • Token counts  │  │ • Model pricing  │  │ • Daily reports│ │
│  │ • Cache tokens  │  │ • Cache discounts│  │ • Monthly agg  │ │
│  │ • Per-agent     │  │ • Budget alerts  │  │ • Pattern costs│ │
│  │   tracking      │  │ • Cost forecasts │  │ • Agent costs  │ │
│  │ • Real-time     │  │ • Multi-currency │  │ • Export (JSON)│ │
│  └────────┬────────┘  └────────┬─────────┘  └────────┬───────┘ │
│           │                    │                     │          │
└───────────┼────────────────────┼─────────────────────┼──────────┘
            │                    │                     │
┌───────────┼────────────────────┼─────────────────────┼──────────┐
│                    Existing Architecture                         │
│           │                    │                     │          │
│  ┌────────▼────────┐  ┌────────▼────────┐  ┌────────▼────────┐ │
│  │ MemoryIntegration│ │  MemoryStore    │  │ AgentOrchestrator│ │
│  │                 │  │                 │  │                 │ │
│  │ • Hook into     │  │ • New usage     │  │ • Track tokens  │ │
│  │   afterExecution│  │   tables        │  │   during exec   │ │
│  │ • Record usage  │  │ • Billing views │  │ • Model metadata│ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

Data Flow:
──────────
1. Orchestration executes with model metadata → AgentOrchestrator tracks tokens
2. MemoryIntegration._hookAfterExecution → UsageTracker.recordUsage()
3. CostCalculator computes costs based on model pricing → MemoryStore
4. UsageReporter queries aggregate data → CLI/API reports
5. Budget alerts triggered if thresholds exceeded → Logging/notifications
```

**Layer Responsibilities:**

| Component | Purpose | Critical Path? | Fallback Strategy |
|-----------|---------|----------------|-------------------|
| **UsageTracker** | Record token/cost data | No | Log error, continue orchestration |
| **CostCalculator** | Calculate costs from tokens | No | Use cached prices, warn on failure |
| **UsageReporter** | Generate usage reports | No | Return empty report on failure |

---

## Component Specifications

### 1. UsageTracker

**Location:** `.claude/core/usage-tracker.js`

**Purpose:** Tracks token consumption, cache usage, and metadata for every orchestration and agent execution.

#### Class Structure

```javascript
const { createComponentLogger } = require('./logger');
const CostCalculator = require('./cost-calculator');

class UsageTracker {
  /**
   * Create a usage tracker
   *
   * @param {MemoryStore} memoryStore - Database instance
   * @param {Object} options - Configuration
   * @param {boolean} [options.enableTracking=true] - Enable usage tracking
   * @param {boolean} [options.enableBudgetAlerts=false] - Enable budget alerts
   * @param {number} [options.dailyBudgetUSD] - Daily budget limit
   * @param {number} [options.monthlyBudgetUSD] - Monthly budget limit
   * @param {string} [options.alertWebhook] - Webhook URL for alerts
   */
  constructor(memoryStore, options = {}) {
    this.memoryStore = memoryStore;
    this.logger = createComponentLogger('UsageTracker');
    this.costCalculator = new CostCalculator();

    this.options = {
      enableTracking: options.enableTracking !== false,
      enableBudgetAlerts: options.enableBudgetAlerts || false,
      dailyBudgetUSD: options.dailyBudgetUSD || null,
      monthlyBudgetUSD: options.monthlyBudgetUSD || null,
      alertWebhook: options.alertWebhook || null,
      trackCacheTokens: options.trackCacheTokens !== false,
      trackPerAgent: options.trackPerAgent !== false,
      ...options
    };

    // In-memory cache for current session
    this.sessionUsage = {
      totalTokens: 0,
      totalCost: 0,
      startTime: Date.now(),
      orchestrationCount: 0
    };

    this.logger.info('UsageTracker initialized', {
      trackingEnabled: this.options.enableTracking,
      budgetAlertsEnabled: this.options.enableBudgetAlerts
    });
  }
}
```

#### Public API

```javascript
/**
 * Record usage for an orchestration
 *
 * @param {Object} usage - Usage data
 * @param {string} usage.orchestrationId - Orchestration ID
 * @param {string} usage.model - Model used (e.g., 'claude-sonnet-4.5')
 * @param {number} usage.inputTokens - Input tokens consumed
 * @param {number} usage.outputTokens - Output tokens generated
 * @param {number} [usage.cacheCreationTokens=0] - Cache creation tokens
 * @param {number} [usage.cacheReadTokens=0] - Cache read tokens
 * @param {string} [usage.agentId] - Specific agent if tracked
 * @param {Object} [usage.metadata] - Additional metadata
 * @returns {Promise<string>} Usage record ID
 */
async recordUsage(usage)

/**
 * Record usage for a specific agent within an orchestration
 *
 * @param {Object} agentUsage - Agent-specific usage
 * @param {string} agentUsage.orchestrationId - Parent orchestration
 * @param {string} agentUsage.agentId - Agent identifier
 * @param {string} agentUsage.model - Model used
 * @param {Object} agentUsage.tokens - Token breakdown
 * @returns {Promise<string>} Usage record ID
 */
async recordAgentUsage(agentUsage)

/**
 * Get usage summary for a time period
 *
 * @param {string} period - 'hour', 'day', 'week', 'month', 'all'
 * @param {Object} [options] - Query options
 * @param {Date} [options.startDate] - Start date filter
 * @param {Date} [options.endDate] - End date filter
 * @param {string} [options.model] - Filter by model
 * @param {string} [options.agentId] - Filter by agent
 * @returns {Promise<Object>} Usage summary
 */
async getUsageSummary(period, options = {})

/**
 * Get current session usage (in-memory, fast)
 *
 * @returns {Object} Session usage stats
 */
getSessionUsage()

/**
 * Check if budget threshold exceeded
 *
 * @param {string} period - 'day' or 'month'
 * @returns {Promise<Object>} Budget status
 */
async checkBudgetStatus(period)

/**
 * Get cost breakdown by model
 *
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} Model cost breakdown
 */
async getCostByModel(options = {})

/**
 * Get cost breakdown by pattern
 *
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} Pattern cost breakdown
 */
async getCostByPattern(options = {})

/**
 * Get cost breakdown by agent
 *
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} Agent cost breakdown
 */
async getCostByAgent(options = {})

/**
 * Export usage data for external analysis
 *
 * @param {Object} options - Export options
 * @param {string} options.format - 'json' or 'csv'
 * @param {Date} options.startDate - Start date
 * @param {Date} options.endDate - End date
 * @returns {Promise<string>} Exported data
 */
async exportUsage(options)

/**
 * Clear old usage records (retention policy)
 *
 * @param {number} retentionDays - Keep records for N days
 * @returns {Promise<number>} Number of records deleted
 */
async cleanupOldRecords(retentionDays)
```

#### Internal Methods

```javascript
/**
 * Calculate cost for usage record
 * @private
 */
_calculateCost(model, tokens)

/**
 * Check and trigger budget alerts
 * @private
 */
async _checkBudgetAlerts(newCost, period)

/**
 * Send budget alert notification
 * @private
 */
async _sendBudgetAlert(alert)

/**
 * Update session usage cache
 * @private
 */
_updateSessionCache(usage, cost)

/**
 * Aggregate usage by time period
 * @private
 */
async _aggregateByPeriod(period, filters)
```

#### Error Handling

```javascript
/**
 * All usage tracking failures are non-critical
 * - Log errors comprehensively
 * - Never throw errors that block orchestration
 * - Return graceful fallback values
 */
async recordUsage(usage) {
  try {
    // Recording logic
  } catch (error) {
    this.logger.error('Failed to record usage', {
      error: error.message,
      usage: usage
    });

    // Don't throw - usage tracking is optional
    return null;
  }
}
```

---

### 2. CostCalculator

**Location:** `.claude/core/cost-calculator.js`

**Purpose:** Calculates costs based on model-specific pricing, including cache token discounts and currency conversion.

#### Class Structure

```javascript
class CostCalculator {
  constructor(options = {}) {
    this.logger = createComponentLogger('CostCalculator');

    // Model pricing (USD per million tokens)
    // Source: Anthropic/OpenAI pricing pages (as of Nov 2025)
    this.pricing = {
      'claude-sonnet-4.5': {
        input: 3.00,
        output: 15.00,
        cacheCreation: 3.75,  // 25% more than input
        cacheRead: 0.30       // 90% discount
      },
      'claude-sonnet-4-20250514': {
        input: 3.00,
        output: 15.00,
        cacheCreation: 3.75,
        cacheRead: 0.30
      },
      'claude-opus-4-20250514': {
        input: 15.00,
        output: 75.00,
        cacheCreation: 18.75,
        cacheRead: 1.50
      },
      'gpt-4o': {
        input: 5.00,
        output: 15.00,
        cacheCreation: 0,     // GPT-4o doesn't support prompt caching
        cacheRead: 0
      },
      'o1-preview': {
        input: 15.00,
        output: 60.00,
        cacheCreation: 0,
        cacheRead: 0
      }
    };

    // Allow custom pricing overrides
    this.customPricing = options.customPricing || {};

    // Currency conversion (future enhancement)
    this.currency = options.currency || 'USD';
    this.exchangeRates = options.exchangeRates || {};
  }
}
```

#### Public API

```javascript
/**
 * Calculate cost for a usage record
 *
 * @param {Object} usage - Token usage
 * @param {string} usage.model - Model identifier
 * @param {number} usage.inputTokens - Input tokens
 * @param {number} usage.outputTokens - Output tokens
 * @param {number} [usage.cacheCreationTokens=0] - Cache creation
 * @param {number} [usage.cacheReadTokens=0] - Cache reads
 * @returns {Object} Cost breakdown
 */
calculateCost(usage)

/**
 * Get pricing for a specific model
 *
 * @param {string} model - Model identifier
 * @returns {Object} Pricing structure
 */
getPricing(model)

/**
 * Update pricing for a model
 *
 * @param {string} model - Model identifier
 * @param {Object} pricing - New pricing
 */
updatePricing(model, pricing)

/**
 * Calculate projected monthly cost based on current usage
 *
 * @param {Object} currentUsage - Usage to date
 * @param {number} daysElapsed - Days since month start
 * @returns {Object} Projection
 */
projectMonthlyCost(currentUsage, daysElapsed)

/**
 * Compare costs between different models for same task
 *
 * @param {Object} usage - Token usage (model-agnostic)
 * @param {Array<string>} models - Models to compare
 * @returns {Array<Object>} Cost comparison
 */
compareModelCosts(usage, models)

/**
 * Calculate savings from prompt caching
 *
 * @param {Object} usage - Usage with cache tokens
 * @returns {Object} Savings analysis
 */
calculateCacheSavings(usage)
```

#### Cost Calculation Logic

```javascript
calculateCost(usage) {
  const { model, inputTokens, outputTokens, cacheCreationTokens = 0, cacheReadTokens = 0 } = usage;

  // Get pricing (custom overrides or defaults)
  const pricing = this.customPricing[model] || this.pricing[model];

  if (!pricing) {
    this.logger.warn('Unknown model pricing', { model });
    return {
      totalCost: 0,
      breakdown: {},
      error: 'Unknown model'
    };
  }

  // Calculate per million tokens
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const cacheCreationCost = (cacheCreationTokens / 1_000_000) * pricing.cacheCreation;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * pricing.cacheRead;

  const totalCost = inputCost + outputCost + cacheCreationCost + cacheReadCost;

  // Calculate what it would have cost WITHOUT caching
  const costWithoutCache = ((inputTokens + cacheReadTokens) / 1_000_000) * pricing.input + outputCost;
  const cacheSavings = costWithoutCache - (inputCost + cacheReadCost + cacheCreationCost);

  return {
    totalCost,
    breakdown: {
      input: inputCost,
      output: outputCost,
      cacheCreation: cacheCreationCost,
      cacheRead: cacheReadCost
    },
    tokens: {
      input: inputTokens,
      output: outputTokens,
      cacheCreation: cacheCreationTokens,
      cacheRead: cacheReadTokens,
      total: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens
    },
    savings: {
      cacheSavings,
      savingsPercent: costWithoutCache > 0 ? (cacheSavings / costWithoutCache) * 100 : 0
    },
    currency: this.currency,
    model
  };
}
```

---

### 3. UsageReporter

**Location:** `.claude/core/usage-reporter.js`

**Purpose:** Generates formatted reports for CLI output, APIs, and exports. Inspired by ccusage's reporting capabilities.

#### Class Structure

```javascript
class UsageReporter {
  constructor(memoryStore, usageTracker) {
    this.memoryStore = memoryStore;
    this.usageTracker = usageTracker;
    this.logger = createComponentLogger('UsageReporter');
  }
}
```

#### Public API

```javascript
/**
 * Generate daily usage report
 *
 * @param {Object} options - Report options
 * @param {Date} [options.date] - Specific date (defaults to today)
 * @param {boolean} [options.breakdown=false] - Include model breakdown
 * @param {string} [options.format='table'] - 'table', 'json', 'summary'
 * @returns {Promise<Object>} Daily report
 */
async generateDailyReport(options = {})

/**
 * Generate monthly usage report
 *
 * @param {Object} options - Report options
 * @param {number} [options.year] - Year (defaults to current)
 * @param {number} [options.month] - Month (defaults to current)
 * @param {boolean} [options.breakdown=true] - Include breakdowns
 * @returns {Promise<Object>} Monthly report
 */
async generateMonthlyReport(options = {})

/**
 * Generate pattern cost analysis
 *
 * @param {Object} options - Analysis options
 * @param {string} [options.timeframe='30days'] - Analysis period
 * @param {boolean} [options.includeAgents=false] - Agent breakdown per pattern
 * @returns {Promise<Object>} Pattern analysis
 */
async generatePatternCostAnalysis(options = {})

/**
 * Generate agent cost analysis
 *
 * @param {Object} options - Analysis options
 * @param {string} [options.timeframe='30days'] - Analysis period
 * @param {string} [options.sortBy='cost'] - 'cost', 'tokens', 'count'
 * @returns {Promise<Object>} Agent analysis
 */
async generateAgentCostAnalysis(options = {})

/**
 * Generate billing window report (5-hour windows like ccusage)
 *
 * @param {Object} options - Report options
 * @param {Date} [options.startTime] - Window start (defaults to now - 5h)
 * @param {boolean} [options.live=false] - Live updating mode
 * @returns {Promise<Object>} Billing window report
 */
async generateBillingWindowReport(options = {})

/**
 * Generate cost efficiency report (cost per successful result)
 *
 * @param {Object} options - Report options
 * @returns {Promise<Object>} Efficiency analysis
 */
async generateEfficiencyReport(options = {})

/**
 * Generate budget status report
 *
 * @param {Object} options - Report options
 * @returns {Promise<Object>} Budget status
 */
async generateBudgetReport(options = {})

/**
 * Format report for CLI display
 *
 * @param {Object} report - Report data
 * @param {string} format - 'table', 'compact', 'detailed'
 * @returns {string} Formatted output
 */
formatForCLI(report, format = 'table')

/**
 * Export report to file
 *
 * @param {Object} report - Report data
 * @param {string} filepath - Output path
 * @param {string} format - 'json' or 'csv'
 * @returns {Promise<void>}
 */
async exportReport(report, filepath, format = 'json')
```

#### Report Formats

**Daily Report Example:**
```
┌─────────────────────────────────────────────────────────────────┐
│                  Daily Usage Report                              │
│                  Date: 2025-11-08                                │
└─────────────────────────────────────────────────────────────────┘

Summary:
  Total Orchestrations: 47
  Total Tokens: 1,234,567
  Total Cost: $23.45

Model Breakdown:
┌────────────────────┬─────────────┬──────────────┬──────────┐
│ Model              │ Tokens      │ Cost         │ Count    │
├────────────────────┼─────────────┼──────────────┼──────────┤
│ claude-sonnet-4.5  │   856,234   │   $15.89     │    32    │
│ claude-sonnet-4    │   298,445   │    $5.23     │    12    │
│ gpt-4o             │    79,888   │    $2.33     │     3    │
└────────────────────┴─────────────┴──────────────┴──────────┘

Cache Performance:
  Cache Creation: 125,678 tokens ($0.47)
  Cache Reads: 456,123 tokens ($1.37)
  Savings: $12.34 (34.5% reduction)

Budget Status:
  Daily Limit: $50.00
  Used: $23.45 (46.9%)
  Remaining: $26.55
```

**Pattern Cost Analysis Example:**
```
┌─────────────────────────────────────────────────────────────────┐
│           Pattern Cost Analysis (Last 30 Days)                   │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┬───────┬──────────┬───────────┬──────────────┐
│ Pattern      │ Count │ Avg Cost │ Total Cost│ Success Rate │
├──────────────┼───────┼──────────┼───────────┼──────────────┤
│ parallel     │   145 │  $0.87   │  $126.15  │    94.5%     │
│ consensus    │    78 │  $1.23   │   $95.94  │    89.7%     │
│ debate       │    34 │  $2.45   │   $83.30  │    91.2%     │
│ review       │    56 │  $1.12   │   $62.72  │    96.4%     │
│ ensemble     │    23 │  $1.89   │   $43.47  │    87.0%     │
└──────────────┴───────┴──────────┴───────────┴──────────────┘

Efficiency (Cost per Success):
  parallel:  $0.92 per success (most efficient)
  review:    $1.16 per success
  consensus: $1.37 per success
  ensemble:  $2.17 per success
  debate:    $2.69 per success (least efficient)
```

---

## Database Schema Extensions

**New Tables:**

```sql
-- ============================================================================
-- Usage Analytics Tables
-- ============================================================================

-- Token Usage: Detailed token consumption per orchestration
CREATE TABLE IF NOT EXISTS token_usage (
  id TEXT PRIMARY KEY,
  orchestration_id TEXT NOT NULL,
  agent_id TEXT,                      -- NULL for orchestration-level tracking
  timestamp INTEGER NOT NULL,
  model TEXT NOT NULL,                -- claude-sonnet-4.5, gpt-4o, etc.

  -- Token counts
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_creation_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,

  -- Cost breakdown (USD)
  input_cost REAL DEFAULT 0.0,
  output_cost REAL DEFAULT 0.0,
  cache_creation_cost REAL DEFAULT 0.0,
  cache_read_cost REAL DEFAULT 0.0,
  total_cost REAL DEFAULT 0.0,

  -- Savings analysis
  cache_savings REAL DEFAULT 0.0,
  cache_savings_percent REAL DEFAULT 0.0,

  -- Context
  pattern TEXT,                       -- Denormalized for easier queries
  work_session_id TEXT,

  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (orchestration_id) REFERENCES orchestrations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_usage_orchestration ON token_usage(orchestration_id);
CREATE INDEX IF NOT EXISTS idx_usage_agent ON token_usage(agent_id);
CREATE INDEX IF NOT EXISTS idx_usage_model ON token_usage(model);
CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON token_usage(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_usage_pattern ON token_usage(pattern);
CREATE INDEX IF NOT EXISTS idx_usage_session ON token_usage(work_session_id);

-- Budget Alerts: Track when budget thresholds are exceeded
CREATE TABLE IF NOT EXISTS budget_alerts (
  id TEXT PRIMARY KEY,
  alert_type TEXT NOT NULL,           -- 'daily_warning', 'daily_exceeded', 'monthly_warning', 'monthly_exceeded'
  period_start INTEGER NOT NULL,      -- Start of day/month
  threshold_usd REAL NOT NULL,        -- Budget limit
  actual_usd REAL NOT NULL,           -- Actual spending
  percent_used REAL NOT NULL,         -- Percentage of budget used
  triggered_at INTEGER NOT NULL,
  acknowledged INTEGER DEFAULT 0,     -- 0 = unacknowledged, 1 = acknowledged
  acknowledged_at INTEGER,
  metadata TEXT                       -- JSON: additional context
);

CREATE INDEX IF NOT EXISTS idx_alerts_type ON budget_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_alerts_triggered ON budget_alerts(triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged ON budget_alerts(acknowledged);

-- Usage Cache: Pre-computed aggregations for faster reporting
CREATE TABLE IF NOT EXISTS usage_cache (
  cache_key TEXT PRIMARY KEY,
  period_type TEXT NOT NULL,          -- 'hour', 'day', 'week', 'month'
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,

  -- Aggregated metrics
  total_orchestrations INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0.0,

  -- Model breakdown (JSON)
  model_breakdown TEXT,

  -- Pattern breakdown (JSON)
  pattern_breakdown TEXT,

  -- Agent breakdown (JSON)
  agent_breakdown TEXT,

  computed_at INTEGER DEFAULT (strftime('%s', 'now')),
  expires_at INTEGER                  -- TTL for cache invalidation
);

CREATE INDEX IF NOT EXISTS idx_usage_cache_period ON usage_cache(period_type, period_start);
CREATE INDEX IF NOT EXISTS idx_usage_cache_expires ON usage_cache(expires_at);
```

**New Views:**

```sql
-- ============================================================================
-- Usage Analytics Views
-- ============================================================================

-- Daily Usage Summary
CREATE VIEW IF NOT EXISTS v_daily_usage AS
SELECT
  date(timestamp, 'unixepoch') as date,
  COUNT(DISTINCT orchestration_id) as orchestrations,
  SUM(total_tokens) as total_tokens,
  SUM(total_cost) as total_cost,
  SUM(cache_savings) as cache_savings,
  ROUND(AVG(cache_savings_percent), 2) as avg_cache_savings_pct,
  GROUP_CONCAT(DISTINCT model) as models_used
FROM token_usage
GROUP BY date
ORDER BY date DESC;

-- Model Cost Summary
CREATE VIEW IF NOT EXISTS v_model_costs AS
SELECT
  model,
  COUNT(DISTINCT orchestration_id) as orchestrations,
  SUM(input_tokens) as total_input_tokens,
  SUM(output_tokens) as total_output_tokens,
  SUM(cache_creation_tokens) as total_cache_creation,
  SUM(cache_read_tokens) as total_cache_reads,
  SUM(total_tokens) as total_tokens,
  SUM(total_cost) as total_cost,
  ROUND(AVG(total_cost), 4) as avg_cost_per_orchestration,
  SUM(cache_savings) as total_cache_savings
FROM token_usage
GROUP BY model
ORDER BY total_cost DESC;

-- Pattern Cost Efficiency
CREATE VIEW IF NOT EXISTS v_pattern_efficiency AS
SELECT
  tu.pattern,
  COUNT(DISTINCT tu.orchestration_id) as total_orchestrations,
  SUM(CASE WHEN o.success = 1 THEN 1 ELSE 0 END) as successful_orchestrations,
  ROUND(SUM(CASE WHEN o.success = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as success_rate,
  SUM(tu.total_cost) as total_cost,
  ROUND(AVG(tu.total_cost), 4) as avg_cost_per_orchestration,
  ROUND(SUM(tu.total_cost) / SUM(CASE WHEN o.success = 1 THEN 1 ELSE 0 END), 4) as cost_per_success
FROM token_usage tu
LEFT JOIN orchestrations o ON tu.orchestration_id = o.id
WHERE tu.pattern IS NOT NULL
GROUP BY tu.pattern
ORDER BY cost_per_success ASC;

-- Agent Cost Analysis
CREATE VIEW IF NOT EXISTS v_agent_costs AS
SELECT
  agent_id,
  COUNT(*) as executions,
  SUM(total_tokens) as total_tokens,
  SUM(total_cost) as total_cost,
  ROUND(AVG(total_cost), 4) as avg_cost_per_execution,
  SUM(cache_savings) as total_savings,
  ROUND(AVG(cache_savings_percent), 2) as avg_savings_pct
FROM token_usage
WHERE agent_id IS NOT NULL
GROUP BY agent_id
ORDER BY total_cost DESC;

-- Billing Window (5-hour periods)
CREATE VIEW IF NOT EXISTS v_billing_windows AS
SELECT
  datetime((timestamp / 3600) * 3600, 'unixepoch') as window_start,
  datetime(((timestamp / 3600) * 3600) + 18000, 'unixepoch') as window_end,
  COUNT(DISTINCT orchestration_id) as orchestrations,
  SUM(total_tokens) as total_tokens,
  SUM(total_cost) as total_cost,
  SUM(cache_savings) as cache_savings
FROM token_usage
GROUP BY (timestamp / 18000)  -- 18000 seconds = 5 hours
ORDER BY window_start DESC;

-- Monthly Budget Status
CREATE VIEW IF NOT EXISTS v_monthly_budget AS
SELECT
  strftime('%Y-%m', timestamp, 'unixepoch') as month,
  COUNT(DISTINCT orchestration_id) as orchestrations,
  SUM(total_cost) as total_cost,
  MIN(date(timestamp, 'unixepoch')) as first_day,
  MAX(date(timestamp, 'unixepoch')) as last_day,
  (julianday(MAX(date(timestamp, 'unixepoch'))) - julianday(MIN(date(timestamp, 'unixepoch'))) + 1) as days_elapsed
FROM token_usage
GROUP BY month
ORDER BY month DESC;
```

---

## Integration Architecture

### Integration with MemoryIntegration

**File:** `.claude/core/memory-integration.js`

```javascript
// Add to _initializeIntelligenceLayer()
_initializeIntelligenceLayer() {
  // ... existing VectorStore, ContextRetriever, etc.

  // 6. Initialize UsageTracker (cost analytics)
  if (this.options.enableUsageTracking !== false) {
    try {
      const UsageTracker = require('./usage-tracker');
      this.usageTracker = new UsageTracker(this.memoryStore, {
        enableBudgetAlerts: this.options.enableBudgetAlerts || false,
        dailyBudgetUSD: this.options.dailyBudgetUSD,
        monthlyBudgetUSD: this.options.monthlyBudgetUSD
      });
      this.logger.info('UsageTracker initialized');
    } catch (error) {
      this.logger.warn('UsageTracker not available', {
        error: error.message
      });
      this.usageTracker = null;
    }
  }
}
```

**Update _hookAfterExecution:**

```javascript
async _hookAfterExecution(result) {
  try {
    // ... existing logic ...

    // Track usage if available
    if (this.usageTracker && result.usage) {
      await this.usageTracker.recordUsage({
        orchestrationId: result.orchestrationId,
        model: result.model || 'claude-sonnet-4.5',
        inputTokens: result.usage.inputTokens || 0,
        outputTokens: result.usage.outputTokens || 0,
        cacheCreationTokens: result.usage.cacheCreationTokens || 0,
        cacheReadTokens: result.usage.cacheReadTokens || 0,
        metadata: result.metadata || {}
      }).catch(err => {
        this.logger.warn('Failed to record usage', {
          error: err.message
        });
      });
    }

    return result;
  } catch (error) {
    // ... existing error handling ...
  }
}
```

### Integration with AgentOrchestrator

**File:** `.claude/core/agent-orchestrator.js`

Update execution methods to track token usage:

```javascript
async executePattern(pattern, task, agentIds, options = {}) {
  const startTime = Date.now();

  // ... existing execution logic ...

  // Capture token usage from API response
  const result = {
    ...executionResult,
    usage: {
      inputTokens: apiResponse.usage?.input_tokens || 0,
      outputTokens: apiResponse.usage?.output_tokens || 0,
      cacheCreationTokens: apiResponse.usage?.cache_creation_input_tokens || 0,
      cacheReadTokens: apiResponse.usage?.cache_read_input_tokens || 0
    },
    model: options.model || this.options.defaultModel || 'claude-sonnet-4.5',
    orchestrationId: orchestrationId,
    duration: Date.now() - startTime
  };

  // Hooks will handle recording via MemoryIntegration
  await this.lifecycleHooks.execute('afterExecution', result);

  return result;
}
```

---

## Reporting & Analytics

### CLI Scripts

**File:** `scripts/usage-report.js`

```javascript
#!/usr/bin/env node

const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const MemoryStore = require('../.claude/core/memory-store');
const UsageTracker = require('../.claude/core/usage-tracker');
const UsageReporter = require('../.claude/core/usage-reporter');

async function main() {
  const memoryStore = new MemoryStore('.claude/memory/orchestrations.db');
  const usageTracker = new UsageTracker(memoryStore);
  const usageReporter = new UsageReporter(memoryStore, usageTracker);

  // Interactive menu
  const { reportType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'reportType',
      message: 'Select report type:',
      choices: [
        { name: 'Daily Usage', value: 'daily' },
        { name: 'Monthly Summary', value: 'monthly' },
        { name: 'Pattern Cost Analysis', value: 'pattern' },
        { name: 'Agent Cost Analysis', value: 'agent' },
        { name: 'Billing Window (5h)', value: 'billing' },
        { name: 'Budget Status', value: 'budget' },
        { name: 'Cost Efficiency', value: 'efficiency' }
      ]
    }
  ]);

  const spinner = ora(`Generating ${reportType} report...`).start();

  let report;
  switch (reportType) {
    case 'daily':
      report = await usageReporter.generateDailyReport({ breakdown: true });
      break;
    case 'monthly':
      report = await usageReporter.generateMonthlyReport({ breakdown: true });
      break;
    case 'pattern':
      report = await usageReporter.generatePatternCostAnalysis({ timeframe: '30days' });
      break;
    case 'agent':
      report = await usageReporter.generateAgentCostAnalysis({ timeframe: '30days' });
      break;
    case 'billing':
      report = await usageReporter.generateBillingWindowReport();
      break;
    case 'budget':
      report = await usageReporter.generateBudgetReport();
      break;
    case 'efficiency':
      report = await usageReporter.generateEfficiencyReport({ timeframe: '30days' });
      break;
  }

  spinner.succeed('Report generated');

  // Display report
  const formatted = usageReporter.formatForCLI(report, 'table');
  console.log('\n' + formatted + '\n');

  // Ask about export
  const { shouldExport } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'shouldExport',
      message: 'Export report to file?',
      default: false
    }
  ]);

  if (shouldExport) {
    const { filepath, format } = await inquirer.prompt([
      {
        type: 'input',
        name: 'filepath',
        message: 'Export path:',
        default: `./reports/${reportType}-${Date.now()}.json`
      },
      {
        type: 'list',
        name: 'format',
        message: 'Format:',
        choices: ['json', 'csv']
      }
    ]);

    const exportSpinner = ora('Exporting...').start();
    await usageReporter.exportReport(report, filepath, format);
    exportSpinner.succeed(`Exported to ${filepath}`);
  }

  memoryStore.close();
}

main().catch(console.error);
```

**Add to package.json:**

```json
{
  "scripts": {
    "usage": "node scripts/usage-report.js",
    "usage:daily": "node scripts/usage-report.js --type daily",
    "usage:monthly": "node scripts/usage-report.js --type monthly",
    "usage:live": "node scripts/usage-report.js --type billing --live"
  }
}
```

---

## Cost Optimization Strategy

### 1. Cache-Aware Recommendations

```javascript
// In PatternRecommender, factor in caching efficiency
async recommendPattern(taskDescription, context) {
  const patterns = await this._analyzePatterns(taskDescription);

  // Factor in cache efficiency
  for (const pattern of patterns) {
    const cacheEfficiency = await this._getCacheEfficiency(pattern);
    pattern.adjustedCost = pattern.avgCost * (1 - cacheEfficiency.savingsPercent / 100);
  }

  // Sort by adjusted cost (accounting for cache savings)
  patterns.sort((a, b) => a.adjustedCost - b.adjustedCost);

  return patterns[0]; // Most cost-efficient
}
```

### 2. Budget-Aware Pattern Selection

```javascript
// In AgentOrchestrator, check budget before execution
async executePattern(pattern, task, agentIds, options = {}) {
  if (this.memoryIntegration?.usageTracker) {
    const budgetStatus = await this.memoryIntegration.usageTracker.checkBudgetStatus('day');

    if (budgetStatus.exceeded) {
      this.logger.warn('Daily budget exceeded', {
        limit: budgetStatus.limit,
        used: budgetStatus.used
      });

      if (options.strictBudget) {
        throw new Error(`Daily budget of $${budgetStatus.limit} exceeded`);
      }
    }

    // Warn if approaching limit
    if (budgetStatus.percentUsed > 80) {
      this.logger.warn('Approaching daily budget limit', {
        percentUsed: budgetStatus.percentUsed
      });
    }
  }

  // Continue with execution...
}
```

### 3. Model Selection Based on Cost

```javascript
// Smart model selection based on task complexity and budget
async selectOptimalModel(task, options = {}) {
  const complexity = await this._assessComplexity(task);
  const budgetStatus = await this.usageTracker.checkBudgetStatus('day');

  let model;
  if (complexity === 'high' || !budgetStatus.exceeded) {
    model = 'claude-sonnet-4.5'; // Best quality
  } else if (complexity === 'medium') {
    model = 'claude-sonnet-4'; // Good balance
  } else {
    model = 'claude-sonnet-4'; // Cost-effective for simple tasks
  }

  return model;
}
```

---

## Testing Strategy

### Unit Tests

**File:** `__tests__/core/usage-tracker.test.js`

```javascript
describe('UsageTracker', () => {
  describe('recordUsage', () => {
    test('should record basic usage data', async () => {
      const usage = await tracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 500
      });

      expect(usage).toBeTruthy();
      expect(usage.totalCost).toBeGreaterThan(0);
    });

    test('should handle cache tokens correctly', async () => {
      const usage = await tracker.recordUsage({
        orchestrationId: 'orch-2',
        model: 'claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 200,
        cacheReadTokens: 800
      });

      expect(usage.cacheSavings).toBeGreaterThan(0);
    });

    test('should gracefully handle unknown models', async () => {
      const usage = await tracker.recordUsage({
        orchestrationId: 'orch-3',
        model: 'unknown-model',
        inputTokens: 1000,
        outputTokens: 500
      });

      expect(usage).toBeTruthy();
      expect(usage.totalCost).toBe(0);
    });

    test('should not throw on database errors', async () => {
      memoryStore.db.prepare = jest.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

      await expect(tracker.recordUsage({
        orchestrationId: 'orch-4',
        model: 'claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 500
      })).resolves.toBeNull();
    });
  });

  describe('getUsageSummary', () => {
    test('should aggregate daily usage', async () => {
      const summary = await tracker.getUsageSummary('day');

      expect(summary).toHaveProperty('totalTokens');
      expect(summary).toHaveProperty('totalCost');
      expect(summary).toHaveProperty('orchestrationCount');
    });

    test('should filter by model', async () => {
      const summary = await tracker.getUsageSummary('day', {
        model: 'claude-sonnet-4.5'
      });

      expect(summary.model).toBe('claude-sonnet-4.5');
    });
  });

  describe('checkBudgetStatus', () => {
    test('should detect budget exceeded', async () => {
      tracker.options.dailyBudgetUSD = 10.00;

      // Record usage over budget
      await tracker.recordUsage({
        orchestrationId: 'orch-5',
        model: 'claude-opus-4-20250514',
        inputTokens: 1_000_000, // Will cost > $10
        outputTokens: 500_000
      });

      const status = await tracker.checkBudgetStatus('day');

      expect(status.exceeded).toBe(true);
      expect(status.percentUsed).toBeGreaterThan(100);
    });
  });
});
```

**File:** `__tests__/core/cost-calculator.test.js`

```javascript
describe('CostCalculator', () => {
  describe('calculateCost', () => {
    test('should calculate cost for Claude Sonnet 4.5', () => {
      const result = calculator.calculateCost({
        model: 'claude-sonnet-4.5',
        inputTokens: 1_000_000,
        outputTokens: 500_000
      });

      expect(result.totalCost).toBeCloseTo(10.50, 2); // $3 + $7.50
      expect(result.breakdown.input).toBeCloseTo(3.00, 2);
      expect(result.breakdown.output).toBeCloseTo(7.50, 2);
    });

    test('should calculate cache savings', () => {
      const result = calculator.calculateCost({
        model: 'claude-sonnet-4.5',
        inputTokens: 100_000,
        outputTokens: 50_000,
        cacheCreationTokens: 50_000,
        cacheReadTokens: 500_000
      });

      expect(result.savings.cacheSavings).toBeGreaterThan(0);
      expect(result.savings.savingsPercent).toBeGreaterThan(0);
    });

    test('should handle unknown model gracefully', () => {
      const result = calculator.calculateCost({
        model: 'unknown-model',
        inputTokens: 1000,
        outputTokens: 500
      });

      expect(result.totalCost).toBe(0);
      expect(result.error).toBe('Unknown model');
    });
  });

  describe('compareModelCosts', () => {
    test('should compare costs across models', () => {
      const comparison = calculator.compareModelCosts(
        { inputTokens: 1_000_000, outputTokens: 500_000 },
        ['claude-sonnet-4.5', 'claude-sonnet-4', 'gpt-4o']
      );

      expect(comparison).toHaveLength(3);
      expect(comparison[0].model).toBe('claude-sonnet-4.5');
      expect(comparison[0].totalCost).toBeCloseTo(10.50, 2);
    });
  });
});
```

### Integration Tests

```javascript
describe('Usage Tracking Integration', () => {
  test('should track usage through full orchestration', async () => {
    const orchestrator = new AgentOrchestrator(messageBus, {
      enableMemory: true,
      enableUsageTracking: true
    });

    const result = await orchestrator.executeParallel('Test task', ['agent-1', 'agent-2']);

    // Verify usage was recorded
    const usage = await orchestrator.memoryIntegration.usageTracker.getUsageSummary('day');

    expect(usage.orchestrationCount).toBeGreaterThan(0);
    expect(usage.totalCost).toBeGreaterThan(0);
  });
});
```

---

## Implementation Roadmap

### Phase 1: Core Tracking (4-6 hours)

**Day 1:**
- [ ] Implement `CostCalculator` class
  - Model pricing data
  - Cost calculation logic
  - Cache savings calculation
- [ ] Write `CostCalculator` tests (80%+ coverage)
- [ ] Update database schema with usage tables
- [ ] Test schema migrations

**Day 2:**
- [ ] Implement `UsageTracker` class
  - `recordUsage()` method
  - `getUsageSummary()` method
  - Budget checking logic
- [ ] Write `UsageTracker` tests (80%+ coverage)
- [ ] Integration with `MemoryIntegration`

### Phase 2: Reporting (3-4 hours)

**Day 3:**
- [ ] Implement `UsageReporter` class
  - Daily/monthly report generation
  - Pattern cost analysis
  - Agent cost analysis
- [ ] Write `UsageReporter` tests (70%+ coverage)

**Day 4:**
- [ ] Create CLI script (`scripts/usage-report.js`)
- [ ] Add CLI formatting (tables, colors)
- [ ] Test CLI interactively

### Phase 3: Advanced Features (3-4 hours)

**Day 5:**
- [ ] Implement billing window tracking
- [ ] Add budget alert system
- [ ] Create usage cache for performance
- [ ] Export functionality (JSON/CSV)

**Day 6:**
- [ ] Integration tests (end-to-end)
- [ ] Performance testing
- [ ] Documentation updates
- [ ] Demo examples

### Phase 4: Optimization (2-3 hours)

**Day 7:**
- [ ] Add cost-aware pattern recommendations
- [ ] Implement cache efficiency tracking
- [ ] Budget-aware model selection
- [ ] Final testing and validation

**Total Estimated Time:** 12-17 hours

---

## Success Criteria

### Functional Requirements
- ✅ Track token usage per orchestration with 100% accuracy
- ✅ Calculate costs for all supported models
- ✅ Generate daily/monthly usage reports
- ✅ Provide pattern and agent cost analysis
- ✅ Support budget limits and alerts
- ✅ Export usage data for external analysis

### Quality Requirements
- ✅ 80%+ test coverage for core components
- ✅ Zero impact on orchestration performance (async tracking)
- ✅ Graceful degradation on tracking failures
- ✅ Accurate cost calculations (validated against pricing pages)

### Performance Requirements
- ✅ Usage recording: <10ms per orchestration
- ✅ Report generation: <2s for 30-day period
- ✅ Database queries: <100ms for aggregations
- ✅ Memory overhead: <5MB additional RAM

### Documentation Requirements
- ✅ API documentation for all public methods
- ✅ CLI usage examples
- ✅ Cost optimization guide
- ✅ Migration guide from non-tracked orchestrations

---

## Future Enhancements

### v1.1 - Enhanced Analytics
- Cost forecasting based on trends
- Anomaly detection (unusual spending patterns)
- Cost allocation by project/session
- Comparative analysis across time periods

### v1.2 - Advanced Budgeting
- Per-pattern budget limits
- Per-agent budget allocation
- Webhook notifications for alerts
- Slack/email integration

### v1.3 - Optimization Recommendations
- Automatic model selection based on cost/quality trade-offs
- Cache strategy recommendations
- Pattern efficiency suggestions
- Cost-saving opportunities dashboard

### v2.0 - Web Dashboard
- Real-time cost monitoring UI
- Interactive charts and graphs
- Budget management interface
- Custom report builder

---

## Appendix

### A. Model Pricing Reference (as of Nov 2025)

| Model | Input ($/M tokens) | Output ($/M tokens) | Cache Creation | Cache Read |
|-------|-------------------|---------------------|----------------|------------|
| Claude Sonnet 4.5 | $3.00 | $15.00 | $3.75 | $0.30 |
| Claude Sonnet 4 | $3.00 | $15.00 | $3.75 | $0.30 |
| Claude Opus 4 | $15.00 | $75.00 | $18.75 | $1.50 |
| GPT-4o | $5.00 | $15.00 | N/A | N/A |
| o1-preview | $15.00 | $60.00 | N/A | N/A |

**Note:** Pricing subject to change. Update `CostCalculator` pricing data when providers change rates.

### B. Cache Token Savings Formula

```
Savings = (cacheReadTokens × inputPrice) - (cacheReadTokens × cacheReadPrice)
        = cacheReadTokens × (inputPrice - cacheReadPrice)

Savings % = Savings / (cacheReadTokens × inputPrice) × 100
          = ((inputPrice - cacheReadPrice) / inputPrice) × 100

For Claude Sonnet 4.5:
  Savings % = (($3.00 - $0.30) / $3.00) × 100 = 90%
```

### C. Billing Window Calculation

ccusage uses 5-hour billing windows. Calculation:

```javascript
const BILLING_WINDOW_MS = 5 * 60 * 60 * 1000; // 5 hours

function getBillingWindow(timestamp) {
  const windowIndex = Math.floor(timestamp / BILLING_WINDOW_MS);
  return {
    start: windowIndex * BILLING_WINDOW_MS,
    end: (windowIndex + 1) * BILLING_WINDOW_MS
  };
}
```

### D. Integration Checklist

- [x] Database schema updated with usage tables
- [x] `CostCalculator` implemented and tested
- [x] `UsageTracker` implemented and tested
- [x] `UsageReporter` implemented and tested
- [x] `MemoryIntegration` updated with usage tracking
- [x] `AgentOrchestrator` captures token metadata
- [x] CLI scripts created
- [x] Budget alert system functional
- [x] Export functionality working
- [x] Documentation complete

---

**End of Architecture Document**
