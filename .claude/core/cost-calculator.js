/**
 * CostCalculator - Calculate costs for AI model token usage
 *
 * Handles:
 * - Multi-model pricing (Claude Sonnet 4.5, Sonnet 4, Opus 4, GPT-4o, o1-preview)
 * - Cache token pricing and savings calculation
 * - Cost projections and comparisons
 * - Currency conversion (future enhancement)
 *
 * @module .claude/core/cost-calculator
 */

const { createComponentLogger } = require('./logger');

class CostCalculator {
  /**
   * Create a cost calculator
   *
   * @param {Object} options - Configuration options
   * @param {Object} [options.customPricing] - Custom pricing overrides
   * @param {string} [options.currency='USD'] - Currency for costs
   * @param {Object} [options.exchangeRates] - Currency exchange rates
   */
  constructor(options = {}) {
    this.logger = createComponentLogger('CostCalculator');

    // Model pricing (USD per million tokens)
    // Source: Anthropic/OpenAI pricing pages (as of Nov 2025)
    // Updated periodically - check provider pricing pages
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
      'claude-sonnet-4': {
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
      'claude-opus-4': {
        input: 15.00,
        output: 75.00,
        cacheCreation: 18.75,
        cacheRead: 1.50
      },
      'gpt-4o': {
        input: 5.00,
        output: 15.00,
        cacheCreation: 0,     // GPT-4o doesn't support prompt caching yet
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

    this.logger.info('CostCalculator initialized', {
      modelsSupported: Object.keys(this.pricing).length,
      currency: this.currency,
      hasCustomPricing: Object.keys(this.customPricing).length > 0
    });
  }

  /**
   * Calculate cost for a usage record
   *
   * @param {Object} usage - Token usage
   * @param {string} usage.model - Model identifier
   * @param {number} usage.inputTokens - Input tokens consumed
   * @param {number} usage.outputTokens - Output tokens generated
   * @param {number} [usage.cacheCreationTokens=0] - Cache creation tokens
   * @param {number} [usage.cacheReadTokens=0] - Cache read tokens
   * @returns {Object} Cost breakdown
   */
  calculateCost(usage) {
    const {
      model,
      inputTokens,
      outputTokens,
      cacheCreationTokens = 0,
      cacheReadTokens = 0
    } = usage;

    // Get pricing (custom overrides or defaults)
    const pricing = this.customPricing[model] || this.pricing[model];

    if (!pricing) {
      this.logger.warn('Unknown model pricing', { model });
      return {
        totalCost: 0,
        breakdown: {
          input: 0,
          output: 0,
          cacheCreation: 0,
          cacheRead: 0
        },
        tokens: {
          input: inputTokens || 0,
          output: outputTokens || 0,
          cacheCreation: cacheCreationTokens,
          cacheRead: cacheReadTokens,
          total: (inputTokens || 0) + (outputTokens || 0) + cacheCreationTokens + cacheReadTokens
        },
        savings: {
          cacheSavings: 0,
          savingsPercent: 0
        },
        currency: this.currency,
        model,
        error: 'Unknown model'
      };
    }

    // Calculate per million tokens
    const inputCost = ((inputTokens || 0) / 1_000_000) * pricing.input;
    const outputCost = ((outputTokens || 0) / 1_000_000) * pricing.output;
    const cacheCreationCost = (cacheCreationTokens / 1_000_000) * pricing.cacheCreation;
    const cacheReadCost = (cacheReadTokens / 1_000_000) * pricing.cacheRead;

    const totalCost = inputCost + outputCost + cacheCreationCost + cacheReadCost;

    // Calculate what it would have cost WITHOUT caching
    // (cache read tokens would have been regular input tokens)
    // Only calculate savings if there are cache tokens
    let cacheSavings = 0;
    if (cacheReadTokens > 0) {
      const costWithoutCache = (((inputTokens || 0) + cacheReadTokens) / 1_000_000) * pricing.input + outputCost;
      cacheSavings = costWithoutCache - (inputCost + cacheReadCost + cacheCreationCost);
    }

    return {
      totalCost,
      breakdown: {
        input: inputCost,
        output: outputCost,
        cacheCreation: cacheCreationCost,
        cacheRead: cacheReadCost
      },
      tokens: {
        input: inputTokens || 0,
        output: outputTokens || 0,
        cacheCreation: cacheCreationTokens,
        cacheRead: cacheReadTokens,
        total: (inputTokens || 0) + (outputTokens || 0) + cacheCreationTokens + cacheReadTokens
      },
      savings: {
        cacheSavings: Math.max(0, cacheSavings),
        savingsPercent: cacheReadTokens > 0 && cacheSavings > 0
          ? (cacheSavings / (cacheSavings + totalCost)) * 100
          : 0
      },
      currency: this.currency,
      model
    };
  }

  /**
   * Get pricing for a specific model
   *
   * @param {string} model - Model identifier
   * @returns {Object|null} Pricing structure or null if unknown
   */
  getPricing(model) {
    return this.customPricing[model] || this.pricing[model] || null;
  }

  /**
   * Update pricing for a model
   *
   * @param {string} model - Model identifier
   * @param {Object} pricing - New pricing structure
   * @param {number} pricing.input - Input price per million tokens
   * @param {number} pricing.output - Output price per million tokens
   * @param {number} [pricing.cacheCreation] - Cache creation price
   * @param {number} [pricing.cacheRead] - Cache read price
   */
  updatePricing(model, pricing) {
    this.customPricing[model] = pricing;
    this.logger.info('Updated pricing for model', { model, pricing });
  }

  /**
   * Calculate projected monthly cost based on current usage
   *
   * @param {Object} currentUsage - Usage to date
   * @param {number} currentUsage.totalCost - Total cost so far
   * @param {number} daysElapsed - Days since month start
   * @returns {Object} Projection
   */
  projectMonthlyCost(currentUsage, daysElapsed) {
    if (daysElapsed <= 0) {
      return {
        projectedCost: 0,
        averageDailyCost: 0,
        remainingDays: 0,
        confidence: 'low'
      };
    }

    const averageDailyCost = currentUsage.totalCost / daysElapsed;
    const daysInMonth = 30; // Approximate
    const remainingDays = daysInMonth - daysElapsed;
    const projectedCost = currentUsage.totalCost + (averageDailyCost * remainingDays);

    // Confidence based on how much of month has elapsed
    let confidence;
    if (daysElapsed < 3) {
      confidence = 'low';
    } else if (daysElapsed < 10) {
      confidence = 'medium';
    } else {
      confidence = 'high';
    }

    return {
      projectedCost,
      averageDailyCost,
      remainingDays,
      daysElapsed,
      confidence,
      currentCost: currentUsage.totalCost
    };
  }

  /**
   * Compare costs between different models for same task
   *
   * @param {Object} usage - Token usage (model-agnostic)
   * @param {number} usage.inputTokens - Input tokens
   * @param {number} usage.outputTokens - Output tokens
   * @param {number} [usage.cacheCreationTokens] - Cache creation tokens
   * @param {number} [usage.cacheReadTokens] - Cache read tokens
   * @param {Array<string>} models - Models to compare
   * @returns {Array<Object>} Cost comparison sorted by total cost
   */
  compareModelCosts(usage, models) {
    const comparisons = models.map(model => {
      const cost = this.calculateCost({
        ...usage,
        model
      });

      return {
        model,
        totalCost: cost.totalCost,
        breakdown: cost.breakdown,
        tokens: cost.tokens,
        savings: cost.savings,
        error: cost.error
      };
    });

    // Sort by total cost (lowest first)
    return comparisons.sort((a, b) => a.totalCost - b.totalCost);
  }

  /**
   * Calculate savings from prompt caching
   *
   * @param {Object} usage - Usage with cache tokens
   * @returns {Object} Savings analysis
   */
  calculateCacheSavings(usage) {
    const costResult = this.calculateCost(usage);

    return {
      cacheSavings: costResult.savings.cacheSavings,
      savingsPercent: costResult.savings.savingsPercent,
      totalCost: costResult.totalCost,
      costWithoutCache: costResult.totalCost + costResult.savings.cacheSavings,
      cacheTokens: {
        creation: usage.cacheCreationTokens || 0,
        read: usage.cacheReadTokens || 0,
        total: (usage.cacheCreationTokens || 0) + (usage.cacheReadTokens || 0)
      }
    };
  }

  /**
   * Get all supported models
   *
   * @returns {Array<string>} List of supported model IDs
   */
  getSupportedModels() {
    return Object.keys(this.pricing);
  }

  /**
   * Check if a model is supported
   *
   * @param {string} model - Model identifier
   * @returns {boolean} True if supported
   */
  isModelSupported(model) {
    return !!(this.customPricing[model] || this.pricing[model]);
  }

  /**
   * Format cost for display
   *
   * @param {number} cost - Cost in USD
   * @param {Object} [options] - Formatting options
   * @param {number} [options.decimals=2] - Decimal places
   * @param {boolean} [options.includeSymbol=true] - Include currency symbol
   * @returns {string} Formatted cost string
   */
  formatCost(cost, options = {}) {
    const decimals = options.decimals ?? 2;
    const includeSymbol = options.includeSymbol !== false;

    const formatted = cost.toFixed(decimals);
    return includeSymbol ? `$${formatted}` : formatted;
  }

  /**
   * Format token count for display
   *
   * @param {number} tokens - Token count
   * @returns {string} Formatted token count with commas
   */
  formatTokens(tokens) {
    return tokens.toLocaleString();
  }
}

module.exports = CostCalculator;
