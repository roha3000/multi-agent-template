/**
 * Tests for AggregationStrategies
 */
const { AggregationStrategies } = require('../../.claude/core/aggregation-strategies');

describe('AggregationStrategies', () => {
  describe('merge', () => {
    it('should merge object results', () => {
      const results = [
        { agentId: 'a1', result: { a: 1, b: 2 } },
        { agentId: 'a2', result: { b: 3, c: 4 } }
      ];
      const merged = AggregationStrategies.merge(results);

      expect(merged.merged).toEqual({ a: 1, b: 3, c: 4 });
      expect(merged.sourceCount).toBe(2);
      expect(merged.sources).toEqual(['a1', 'a2']);
    });

    it('should merge array results with deduplication', () => {
      const results = [
        { agentId: 'a1', result: ['apple', 'banana'] },
        { agentId: 'a2', result: ['banana', 'cherry'] }
      ];
      const merged = AggregationStrategies.merge(results);

      expect(merged.merged).toEqual(['apple', 'banana', 'cherry']);
    });

    it('should handle empty results', () => {
      const merged = AggregationStrategies.merge([]);
      expect(merged.merged).toBeNull();
      expect(merged.sourceCount).toBe(0);
    });

    it('should merge primitive values', () => {
      const results = [
        { agentId: 'a1', result: 'yes' },
        { agentId: 'a2', result: 'no' },
        { agentId: 'a3', result: 'yes' }
      ];
      const merged = AggregationStrategies.merge(results);

      expect(merged.merged).toEqual(['yes', 'no']);
    });
  });

  describe('selectBest', () => {
    it('should select highest quality result', () => {
      const results = [
        { agentId: 'a1', result: 'low', quality: 0.3 },
        { agentId: 'a2', result: 'high', quality: 0.9 },
        { agentId: 'a3', result: 'mid', quality: 0.5 }
      ];
      const best = AggregationStrategies.selectBest(results);

      expect(best.best).toBe('high');
      expect(best.agentId).toBe('a2');
      expect(best.score).toBe(0.9);
    });

    it('should handle ties with first tieBreaker', () => {
      const results = [
        { agentId: 'a1', result: 'first', quality: 0.8 },
        { agentId: 'a2', result: 'second', quality: 0.8 }
      ];
      const best = AggregationStrategies.selectBest(results, { tieBreaker: 'first' });

      expect(best.best).toBe('first');
    });

    it('should filter by minimum quality', () => {
      const results = [
        { agentId: 'a1', result: 'low', quality: 0.3 },
        { agentId: 'a2', result: 'mid', quality: 0.5 }
      ];
      const best = AggregationStrategies.selectBest(results, { minQualityScore: 0.6 });

      expect(best.best).toBeNull();
    });

    it('should support custom selector', () => {
      const results = [
        { agentId: 'a1', result: { len: 5 } },
        { agentId: 'a2', result: { len: 10 } }
      ];
      const best = AggregationStrategies.selectBest(results, {
        selector: (rs) => rs.sort((a, b) => b.result.len - a.result.len)[0]
      });

      expect(best.best.len).toBe(10);
    });
  });

  describe('vote', () => {
    it('should reach majority consensus', () => {
      const results = [
        { agentId: 'a1', result: { decision: 'yes' } },
        { agentId: 'a2', result: { decision: 'yes' } },
        { agentId: 'a3', result: { decision: 'no' } }
      ];
      const vote = AggregationStrategies.vote(results);

      expect(vote.winner).toBe('yes');
      expect(vote.consensus).toBe(true);
      expect(vote.confidence).toBeCloseTo(0.67, 1);
    });

    it('should support weighted voting', () => {
      const results = [
        { agentId: 'a1', result: 'A' },
        { agentId: 'a2', result: 'B' },
        { agentId: 'a3', result: 'B' }
      ];
      const vote = AggregationStrategies.vote(results, {
        strategy: 'weighted',
        weights: { a1: 5, a2: 1, a3: 1 }
      });

      expect(vote.winner).toBe('A');
    });

    it('should require unanimous for unanimous strategy', () => {
      const results = [
        { agentId: 'a1', result: 'yes' },
        { agentId: 'a2', result: 'yes' },
        { agentId: 'a3', result: 'no' }
      ];
      const vote = AggregationStrategies.vote(results, { strategy: 'unanimous' });

      expect(vote.consensus).toBe(false);
    });

    it('should extract vote from specified field', () => {
      const results = [
        { agentId: 'a1', result: { recommendation: 'approve' } },
        { agentId: 'a2', result: { recommendation: 'approve' } }
      ];
      const vote = AggregationStrategies.vote(results, { extractField: 'recommendation' });

      expect(vote.winner).toBe('approve');
    });
  });

  describe('chain', () => {
    it('should execute pipeline stages', () => {
      const results = [
        { agentId: 'a1', result: { v: 10 }, quality: 0.9 },
        { agentId: 'a2', result: { v: 5 }, quality: 0.3 },
        { agentId: 'a3', result: { v: 8 }, quality: 0.7 }
      ];
      const chained = AggregationStrategies.chain(results, {
        pipeline: [
          { type: 'filter', config: { minQuality: 0.5 } }
        ]
      });

      expect(chained.final.length).toBe(2);
      expect(chained.stages).toBe(1);
    });

    it('should stop on failure when configured', () => {
      const results = [{ agentId: 'a1', result: 'test' }];
      const chained = AggregationStrategies.chain(results, {
        pipeline: [
          { type: 'unknown', config: {} },
          { type: 'filter', config: {} }
        ],
        stopOnFailure: true
      });

      expect(chained.stages).toBe(0);
      expect(chained.history[0].success).toBe(false);
    });

    it('should collect history', () => {
      const results = [{ agentId: 'a1', result: 'test', quality: 0.8 }];
      const chained = AggregationStrategies.chain(results, {
        pipeline: [{ type: 'filter', config: { minQuality: 0.5 } }],
        collectHistory: true
      });

      expect(chained.history.length).toBe(1);
      expect(chained.history[0].success).toBe(true);
    });
  });

  describe('custom', () => {
    it('should execute custom aggregator', async () => {
      const results = [
        { agentId: 'a1', result: 10 },
        { agentId: 'a2', result: 20 }
      ];
      const custom = await AggregationStrategies.custom(
        results,
        (rs) => rs.reduce((sum, r) => sum + r.result, 0)
      );

      expect(custom.result).toBe(30);
      expect(custom.errors.length).toBe(0);
    });

    it('should handle async functions', async () => {
      const results = [{ agentId: 'a1', result: 'hello' }];
      const custom = await AggregationStrategies.custom(
        results,
        async (rs) => rs[0].result.toUpperCase()
      );

      expect(custom.result).toBe('HELLO');
    });

    it('should capture errors', async () => {
      const results = [{ agentId: 'a1', result: 'test' }];
      const custom = await AggregationStrategies.custom(
        results,
        () => { throw new Error('Custom error'); }
      );

      expect(custom.result).toBeNull();
      expect(custom.errors.length).toBe(1);
      expect(custom.errors[0].message).toBe('Custom error');
    });
  });

  describe('helper methods', () => {
    it('should calculate similarity', () => {
      expect(AggregationStrategies.calculateSimilarity('hello', 'hello')).toBe(1.0);
      expect(AggregationStrategies.calculateSimilarity('abc', 'xyz')).toBe(0);
      expect(AggregationStrategies.calculateSimilarity('the quick', 'the slow')).toBeGreaterThan(0);
    });
  });
});
