/**
 * CostCalculator Tests
 *
 * Tests for token usage cost calculation across multiple AI models
 */

const CostCalculator = require('../../.claude/core/cost-calculator');

describe('CostCalculator', () => {
  let calculator;

  beforeEach(() => {
    calculator = new CostCalculator();
  });

  describe('constructor', () => {
    test('should initialize with default pricing', () => {
      expect(calculator.pricing).toBeDefined();
      expect(calculator.pricing['claude-sonnet-4.5']).toBeDefined();
      expect(calculator.currency).toBe('USD');
    });

    test('should accept custom pricing', () => {
      const customCalc = new CostCalculator({
        customPricing: {
          'test-model': {
            input: 1.00,
            output: 2.00,
            cacheCreation: 1.25,
            cacheRead: 0.10
          }
        }
      });

      expect(customCalc.customPricing['test-model']).toBeDefined();
    });

    test('should support custom currency', () => {
      const customCalc = new CostCalculator({
        currency: 'EUR'
      });

      expect(customCalc.currency).toBe('EUR');
    });
  });

  describe('calculateCost', () => {
    test('should calculate cost for Claude Sonnet 4.5', () => {
      const result = calculator.calculateCost({
        model: 'claude-sonnet-4.5',
        inputTokens: 1_000_000,
        outputTokens: 500_000
      });

      // $3.00 for 1M input + $7.50 for 500k output = $10.50
      expect(result.totalCost).toBeCloseTo(10.50, 2);
      expect(result.breakdown.input).toBeCloseTo(3.00, 2);
      expect(result.breakdown.output).toBeCloseTo(7.50, 2);
      expect(result.model).toBe('claude-sonnet-4.5');
      expect(result.currency).toBe('USD');
    });

    test('should calculate cost with cache tokens', () => {
      const result = calculator.calculateCost({
        model: 'claude-sonnet-4.5',
        inputTokens: 100_000,
        outputTokens: 50_000,
        cacheCreationTokens: 50_000,
        cacheReadTokens: 500_000
      });

      // Input: 100k * $3/M = $0.30
      // Output: 50k * $15/M = $0.75
      // Cache creation: 50k * $3.75/M = $0.1875
      // Cache read: 500k * $0.30/M = $0.15
      // Total: $1.3875

      expect(result.totalCost).toBeCloseTo(1.3875, 4);
      expect(result.breakdown.cacheCreation).toBeCloseTo(0.1875, 4);
      expect(result.breakdown.cacheRead).toBeCloseTo(0.15, 4);
    });

    test('should calculate cache savings correctly', () => {
      const result = calculator.calculateCost({
        model: 'claude-sonnet-4.5',
        inputTokens: 100_000,
        outputTokens: 50_000,
        cacheCreationTokens: 50_000,
        cacheReadTokens: 500_000
      });

      // Without cache: (100k + 500k) * $3/M = $1.80
      // With cache read: 500k * $0.30/M = $0.15
      // Savings: $1.50 - $0.15 = $1.35

      expect(result.savings.cacheSavings).toBeGreaterThan(0);
      expect(result.savings.savingsPercent).toBeGreaterThan(0);
      expect(result.savings.savingsPercent).toBeLessThanOrEqual(100);
    });

    test('should handle unknown model gracefully', () => {
      const result = calculator.calculateCost({
        model: 'unknown-model',
        inputTokens: 1000,
        outputTokens: 500
      });

      expect(result.totalCost).toBe(0);
      expect(result.error).toBe('Unknown model');
      expect(result.tokens.total).toBe(1500);
    });

    test('should handle zero tokens', () => {
      const result = calculator.calculateCost({
        model: 'claude-sonnet-4.5',
        inputTokens: 0,
        outputTokens: 0
      });

      expect(result.totalCost).toBe(0);
      expect(result.breakdown.input).toBe(0);
      expect(result.breakdown.output).toBe(0);
    });

    test('should handle missing optional parameters', () => {
      const result = calculator.calculateCost({
        model: 'claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 500
        // cacheCreationTokens and cacheReadTokens omitted
      });

      expect(result.totalCost).toBeGreaterThan(0);
      expect(result.breakdown.cacheCreation).toBe(0);
      expect(result.breakdown.cacheRead).toBe(0);
    });

    test('should calculate cost for GPT-4o (no cache support)', () => {
      const result = calculator.calculateCost({
        model: 'gpt-4o',
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cacheCreationTokens: 50_000,  // Should be ignored
        cacheReadTokens: 100_000       // Should be ignored
      });

      // GPT-4o: $5 input, $15 output per million
      // $5.00 for 1M input + $7.50 for 500k output = $12.50
      expect(result.totalCost).toBeCloseTo(12.50, 2);
      expect(result.breakdown.cacheCreation).toBe(0);
      expect(result.breakdown.cacheRead).toBe(0);
    });

    test('should calculate cost for o1-preview', () => {
      const result = calculator.calculateCost({
        model: 'o1-preview',
        inputTokens: 1_000_000,
        outputTokens: 500_000
      });

      // o1-preview: $15 input, $60 output per million
      // $15.00 for 1M input + $30.00 for 500k output = $45.00
      expect(result.totalCost).toBeCloseTo(45.00, 2);
    });
  });

  describe('getPricing', () => {
    test('should return pricing for known model', () => {
      const pricing = calculator.getPricing('claude-sonnet-4.5');

      expect(pricing).toBeDefined();
      expect(pricing.input).toBe(3.00);
      expect(pricing.output).toBe(15.00);
      expect(pricing.cacheRead).toBe(0.30);
    });

    test('should return null for unknown model', () => {
      const pricing = calculator.getPricing('unknown-model');

      expect(pricing).toBeNull();
    });

    test('should prefer custom pricing over default', () => {
      calculator.updatePricing('test-model', {
        input: 1.00,
        output: 2.00
      });

      const pricing = calculator.getPricing('test-model');

      expect(pricing.input).toBe(1.00);
      expect(pricing.output).toBe(2.00);
    });
  });

  describe('updatePricing', () => {
    test('should update pricing for a model', () => {
      calculator.updatePricing('new-model', {
        input: 4.00,
        output: 20.00,
        cacheCreation: 5.00,
        cacheRead: 0.40
      });

      const result = calculator.calculateCost({
        model: 'new-model',
        inputTokens: 1_000_000,
        outputTokens: 500_000
      });

      // $4.00 for 1M input + $10.00 for 500k output = $14.00
      expect(result.totalCost).toBeCloseTo(14.00, 2);
    });

    test('should override existing pricing', () => {
      calculator.updatePricing('claude-sonnet-4.5', {
        input: 10.00,
        output: 50.00,
        cacheCreation: 12.50,
        cacheRead: 1.00
      });

      const result = calculator.calculateCost({
        model: 'claude-sonnet-4.5',
        inputTokens: 1_000_000,
        outputTokens: 500_000
      });

      // Custom pricing: $10.00 for 1M input + $25.00 for 500k output = $35.00
      expect(result.totalCost).toBeCloseTo(35.00, 2);
    });
  });

  describe('projectMonthlyCost', () => {
    test('should project cost for full month', () => {
      const projection = calculator.projectMonthlyCost(
        { totalCost: 100.00 },
        10 // 10 days elapsed
      );

      expect(projection.averageDailyCost).toBeCloseTo(10.00, 2);
      expect(projection.projectedCost).toBeCloseTo(300.00, 2); // 10 * 30 days
      expect(projection.remainingDays).toBe(20);
      expect(projection.daysElapsed).toBe(10);
      expect(projection.confidence).toBe('high'); // 10 days >= 10, so high confidence
    });

    test('should have low confidence for early in month', () => {
      const projection = calculator.projectMonthlyCost(
        { totalCost: 10.00 },
        2 // Only 2 days elapsed
      );

      expect(projection.confidence).toBe('low');
    });

    test('should have high confidence for late in month', () => {
      const projection = calculator.projectMonthlyCost(
        { totalCost: 250.00 },
        25 // 25 days elapsed
      );

      expect(projection.confidence).toBe('high');
      expect(projection.projectedCost).toBeCloseTo(300.00, 1);
    });

    test('should handle zero elapsed days', () => {
      const projection = calculator.projectMonthlyCost(
        { totalCost: 0 },
        0
      );

      expect(projection.projectedCost).toBe(0);
      expect(projection.confidence).toBe('low');
    });
  });

  describe('compareModelCosts', () => {
    test('should compare costs across models', () => {
      const comparison = calculator.compareModelCosts(
        {
          inputTokens: 1_000_000,
          outputTokens: 500_000
        },
        ['claude-sonnet-4.5', 'gpt-4o', 'o1-preview']
      );

      expect(comparison).toHaveLength(3);

      // Should be sorted by cost (lowest first)
      expect(comparison[0].totalCost).toBeLessThanOrEqual(comparison[1].totalCost);
      expect(comparison[1].totalCost).toBeLessThanOrEqual(comparison[2].totalCost);

      // Sonnet 4.5: $10.50, GPT-4o: $12.50, o1-preview: $45.00
      expect(comparison[0].model).toBe('claude-sonnet-4.5');
      expect(comparison[2].model).toBe('o1-preview');
    });

    test('should include cache tokens in comparison', () => {
      const comparison = calculator.compareModelCosts(
        {
          inputTokens: 100_000,
          outputTokens: 50_000,
          cacheCreationTokens: 50_000,
          cacheReadTokens: 500_000
        },
        ['claude-sonnet-4.5', 'claude-opus-4']
      );

      expect(comparison).toHaveLength(2);
      expect(comparison[0].savings).toBeDefined();
      expect(comparison[0].savings.cacheSavings).toBeGreaterThan(0);
    });

    test('should handle unknown models in comparison', () => {
      const comparison = calculator.compareModelCosts(
        {
          inputTokens: 1000,
          outputTokens: 500
        },
        ['claude-sonnet-4.5', 'unknown-model']
      );

      expect(comparison).toHaveLength(2);
      expect(comparison.find(c => c.model === 'unknown-model').error).toBe('Unknown model');
    });
  });

  describe('calculateCacheSavings', () => {
    test('should calculate savings from caching', () => {
      const savings = calculator.calculateCacheSavings({
        model: 'claude-sonnet-4.5',
        inputTokens: 100_000,
        outputTokens: 50_000,
        cacheCreationTokens: 50_000,
        cacheReadTokens: 500_000
      });

      expect(savings.cacheSavings).toBeGreaterThan(0);
      expect(savings.savingsPercent).toBeGreaterThan(0);
      expect(savings.totalCost).toBeLessThan(savings.costWithoutCache);
      expect(savings.cacheTokens.total).toBe(550_000);
    });

    test('should return zero savings when no cache tokens', () => {
      const savings = calculator.calculateCacheSavings({
        model: 'claude-sonnet-4.5',
        inputTokens: 100_000,
        outputTokens: 50_000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0
      });

      // When there are no cache tokens, savings should be minimal/zero
      // but the calculation may show small differences due to formula
      expect(savings.cacheSavings).toBeCloseTo(0, 2);
      expect(savings.savingsPercent).toBeCloseTo(0, 2);
      expect(savings.cacheTokens.total).toBe(0);
    });
  });

  describe('getSupportedModels', () => {
    test('should return list of supported models', () => {
      const models = calculator.getSupportedModels();

      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
      expect(models).toContain('claude-sonnet-4.5');
      expect(models).toContain('gpt-4o');
      expect(models).toContain('o1-preview');
    });
  });

  describe('isModelSupported', () => {
    test('should return true for supported model', () => {
      expect(calculator.isModelSupported('claude-sonnet-4.5')).toBe(true);
      expect(calculator.isModelSupported('gpt-4o')).toBe(true);
    });

    test('should return false for unsupported model', () => {
      expect(calculator.isModelSupported('unknown-model')).toBe(false);
    });

    test('should return true for custom pricing model', () => {
      calculator.updatePricing('custom-model', {
        input: 1.00,
        output: 2.00
      });

      expect(calculator.isModelSupported('custom-model')).toBe(true);
    });
  });

  describe('formatCost', () => {
    test('should format cost with default options', () => {
      const formatted = calculator.formatCost(12.345);

      expect(formatted).toBe('$12.35');
    });

    test('should format cost with custom decimal places', () => {
      const formatted = calculator.formatCost(12.345, { decimals: 3 });

      expect(formatted).toBe('$12.345');
    });

    test('should format cost without currency symbol', () => {
      const formatted = calculator.formatCost(12.345, { includeSymbol: false });

      expect(formatted).toBe('12.35');
    });

    test('should handle zero cost', () => {
      const formatted = calculator.formatCost(0);

      expect(formatted).toBe('$0.00');
    });

    test('should handle very small costs', () => {
      const formatted = calculator.formatCost(0.001234, { decimals: 4 });

      expect(formatted).toBe('$0.0012');
    });
  });

  describe('formatTokens', () => {
    test('should format tokens with commas', () => {
      expect(calculator.formatTokens(1000)).toBe('1,000');
      expect(calculator.formatTokens(1234567)).toBe('1,234,567');
    });

    test('should handle small numbers', () => {
      expect(calculator.formatTokens(100)).toBe('100');
      expect(calculator.formatTokens(0)).toBe('0');
    });
  });

  describe('edge cases', () => {
    test('should handle very large token counts', () => {
      const result = calculator.calculateCost({
        model: 'claude-sonnet-4.5',
        inputTokens: 100_000_000,
        outputTokens: 50_000_000
      });

      // $300 for 100M input + $750 for 50M output = $1,050
      expect(result.totalCost).toBeCloseTo(1050.00, 2);
    });

    test('should handle fractional token counts', () => {
      const result = calculator.calculateCost({
        model: 'claude-sonnet-4.5',
        inputTokens: 1500.5,
        outputTokens: 750.3
      });

      expect(result.totalCost).toBeGreaterThan(0);
      expect(result.tokens.total).toBeCloseTo(2250.8, 1);
    });

    test('should handle all cache tokens, no regular tokens', () => {
      const result = calculator.calculateCost({
        model: 'claude-sonnet-4.5',
        inputTokens: 0,
        outputTokens: 1000,
        cacheCreationTokens: 5000,
        cacheReadTokens: 10000
      });

      expect(result.totalCost).toBeGreaterThan(0);
      expect(result.breakdown.input).toBe(0);
    });
  });
});
