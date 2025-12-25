/**
 * PlanEvaluator Test Suite
 */
const { PlanEvaluator, DEFAULT_CRITERIA } = require('../../.claude/core/plan-evaluator');

function createGoodPlan(overrides = {}) {
  return {
    id: 'plan-good', title: 'Implement User Authentication',
    steps: [
      { action: 'Create user model', details: 'Define schema', order: 1 },
      { action: 'Implement registration', details: 'POST /api/register', order: 2 },
      { action: 'Add login', details: 'JWT tokens', order: 3 },
      { action: 'Create middleware', details: 'Auth middleware', order: 4 },
      { action: 'Add password reset', details: 'Email flow', order: 5 }
    ],
    risks: [
      { risk: 'Password security', mitigation: 'Use bcrypt with fallback validation', severity: 'high' },
      { risk: 'Token theft', mitigation: 'Token refresh with retry and monitoring', severity: 'medium' }
    ],
    estimates: { hours: 16, complexity: 'medium' },
    dependencies: ['bcrypt', 'jsonwebtoken'],
    ...overrides
  };
}

function createMinimalPlan(overrides = {}) {
  return { id: 'plan-minimal', title: 'Quick Fix', steps: [{ action: 'Fix bug', details: '' }], risks: [], estimates: {}, dependencies: [], ...overrides };
}

describe('PlanEvaluator', () => {
  let evaluator;

  beforeEach(() => { evaluator = new PlanEvaluator(); });

  describe('Single Plan Evaluation', () => {
    test('evaluates well-formed plan', () => {
      const result = evaluator.evaluatePlan(createGoodPlan());
      expect(result).toHaveProperty('scores');
      expect(result).toHaveProperty('totalScore');
      expect(result).toHaveProperty('recommendations');
      expect(result.scores).toHaveProperty('completeness');
      expect(result.scores).toHaveProperty('feasibility');
      expect(result.scores).toHaveProperty('risk');
      expect(result.scores).toHaveProperty('clarity');
      expect(result.scores).toHaveProperty('efficiency');
    });

    test('scores in valid range', () => {
      const result = evaluator.evaluatePlan(createGoodPlan());
      Object.values(result.scores).forEach(score => {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      });
      expect(result.totalScore).toBeGreaterThanOrEqual(0);
      expect(result.totalScore).toBeLessThanOrEqual(100);
    });

    test('provides recommendations for low scores', () => {
      const result = evaluator.evaluatePlan(createMinimalPlan());
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    test('emits plan:evaluated event', () => {
      const handler = jest.fn();
      evaluator.on('plan:evaluated', handler);
      evaluator.evaluatePlan(createGoodPlan());
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Multi-Plan Comparison', () => {
    test('compares two plans', () => {
      const result = evaluator.comparePlans([
        createGoodPlan({ id: 'p1' }),
        createMinimalPlan({ id: 'p2' })
      ]);
      expect(result.winner.planId).toBe('p1');
      expect(result.rankings.length).toBe(2);
      expect(result.margin).toBeGreaterThan(0);
    });

    test('ranks three plans correctly', () => {
      const result = evaluator.comparePlans([
        createGoodPlan({ id: 'p1' }),
        createMinimalPlan({ id: 'p2' }),
        createGoodPlan({ id: 'p3', title: 'Another Good Plan' })
      ]);
      expect(result.rankings.length).toBe(3);
      expect(result.rankings[0].rank).toBe(1);
    });

    test('throws for fewer than 2 plans', () => {
      expect(() => evaluator.comparePlans([createGoodPlan()])).toThrow('At least 2 plans');
    });

    test('throws for more than 5 plans', () => {
      const plans = Array(6).fill(null).map((_, i) => createGoodPlan({ id: `p${i}` }));
      expect(() => evaluator.comparePlans(plans)).toThrow('Maximum 5');
    });

    test('identifies tie when margin is low', () => {
      const p1 = createGoodPlan({ id: 'p1' });
      const p2 = createGoodPlan({ id: 'p2' });
      const result = evaluator.comparePlans([p1, p2]);
      expect(result.needsReview).toBe(true);
    });

    test('emits plans:compared event', () => {
      const handler = jest.fn();
      evaluator.on('plans:compared', handler);
      evaluator.comparePlans([createGoodPlan({ id: 'p1' }), createMinimalPlan({ id: 'p2' })]);
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Criteria Weighting', () => {
    test('default weights sum to 1.0', () => {
      const sum = Object.values(DEFAULT_CRITERIA).reduce((s, c) => s + c.weight, 0);
      expect(sum).toBeCloseTo(1.0, 2);
    });

    test('allows custom criteria', () => {
      const custom = new PlanEvaluator({
        criteria: { completeness: { weight: 0.5 }, feasibility: { weight: 0.3 }, risk: { weight: 0.1 }, clarity: { weight: 0.05 }, efficiency: { weight: 0.05 } }
      });
      const result = custom.evaluatePlan(createGoodPlan());
      expect(result.totalScore).toBeDefined();
    });

    test('rejects weights not summing to 1.0', () => {
      expect(() => new PlanEvaluator({
        criteria: { completeness: { weight: 0.5 }, feasibility: { weight: 0.5 }, risk: { weight: 0.2 } }
      })).toThrow('weights must sum to 1.0');
    });
  });

  describe('Edge Cases', () => {
    test('handles empty plan', () => {
      const result = evaluator.evaluatePlan({});
      expect(result.planTitle).toBe('Untitled Plan');
    });

    test('handles null plan', () => {
      const result = evaluator.evaluatePlan(null);
      expect(result.planTitle).toBe('Untitled Plan');
    });

    test('handles string steps', () => {
      const result = evaluator.evaluatePlan({ title: 'Test', steps: ['Step 1', 'Step 2'] });
      expect(result.totalScore).toBeGreaterThan(0);
    });

    test('handles string risks', () => {
      const result = evaluator.evaluatePlan({ title: 'Test', steps: [{ action: 'Do' }], risks: ['Risk one'] });
      expect(result.breakdown.risk.riskIdentification).toBeGreaterThan(0);
    });
  });

  describe('Scoring Heuristics', () => {
    test('detects clarity keywords', () => {
      const withKeywords = evaluator.evaluatePlan(createGoodPlan());
      const without = evaluator.evaluatePlan({ title: 'Test', steps: [{ action: 'Stuff', details: 'Things' }] });
      expect(withKeywords.breakdown.clarity.keywordSpecificity).toBeGreaterThan(without.breakdown.clarity.keywordSpecificity);
    });

    test('detects mitigation keywords', () => {
      const withMitigation = evaluator.evaluatePlan(createGoodPlan());
      const without = evaluator.evaluatePlan({ title: 'Test', steps: [{ action: 'Do' }], risks: [{ risk: 'Risk', mitigation: 'Hope' }] });
      expect(withMitigation.breakdown.risk.mitigationQuality).toBeGreaterThan(without.breakdown.risk.mitigationQuality);
    });

    test('rewards parallel steps', () => {
      const parallel = evaluator.evaluatePlan({ title: 'Test', steps: [{ action: 'A', parallel: true }, { action: 'B', parallel: true }] });
      const sequential = evaluator.evaluatePlan({ title: 'Test', steps: [{ action: 'A' }, { action: 'B' }] });
      expect(parallel.breakdown.efficiency.parallelization).toBeGreaterThan(sequential.breakdown.efficiency.parallelization);
    });
  });
});
