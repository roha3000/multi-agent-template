/**
 * CompetitivePlanner Test Suite
 */
const CompetitivePlanner = require('../../.claude/core/competitive-planner');

describe('CompetitivePlanner', () => {
  let planner;

  beforeEach(() => { planner = new CompetitivePlanner(); });

  describe('Constructor', () => {
    test('creates instance with default options', () => {
      expect(planner.complexityThreshold).toBe(40);
      expect(planner.strategies).toHaveProperty('conservative');
      expect(planner.strategies).toHaveProperty('balanced');
      expect(planner.strategies).toHaveProperty('aggressive');
    });

    test('accepts custom options', () => {
      const custom = new CompetitivePlanner({ complexityThreshold: 50 });
      expect(custom.complexityThreshold).toBe(50);
    });
  });

  describe('generatePlans()', () => {
    test('throws error when task is null', async () => {
      await expect(planner.generatePlans(null)).rejects.toThrow('Task is required');
    });

    test('returns result with required properties', async () => {
      const result = await planner.generatePlans({ id: 'task-1', title: 'Test Task' });
      expect(result).toHaveProperty('taskId');
      expect(result).toHaveProperty('complexity');
      expect(result).toHaveProperty('strategies');
      expect(result).toHaveProperty('plans');
      expect(result).toHaveProperty('winner');
    });

    test('generates balanced plan for low complexity', async () => {
      const result = await planner.generatePlans({ id: 'task-1', title: 'Simple task' }, { complexity: 30 });
      expect(result.strategies).toContain('balanced');
      expect(result.plans.length).toBe(1);
    });

    test('generates two plans for medium complexity', async () => {
      const result = await planner.generatePlans({ id: 'task-1', title: 'Medium task' }, { complexity: 50 });
      expect(result.strategies).toContain('conservative');
      expect(result.strategies).toContain('balanced');
      expect(result.plans.length).toBe(2);
    });

    test('generates three plans for high complexity', async () => {
      const result = await planner.generatePlans({ id: 'task-1', title: 'Complex task' }, { complexity: 75 });
      expect(result.strategies).toContain('conservative');
      expect(result.strategies).toContain('balanced');
      expect(result.strategies).toContain('aggressive');
      expect(result.plans.length).toBe(3);
    });

    test('uses cache on second call', async () => {
      const task = { id: 'task-1', title: 'Test' };
      const r1 = await planner.generatePlans(task, { complexity: 50 });
      const r2 = await planner.generatePlans(task, { complexity: 50 });
      expect(r1.timestamp).toBe(r2.timestamp);
    });

    test('bypasses cache with forceRegenerate', async () => {
      const task = { id: 'task-1', title: 'Test' };
      const r1 = await planner.generatePlans(task, { complexity: 50 });
      const r2 = await planner.generatePlans(task, { complexity: 50, forceRegenerate: true });
      expect(r1.timestamp).not.toBe(r2.timestamp);
    });
  });

  describe('Plan Structure', () => {
    test('plans have required properties', async () => {
      const result = await planner.generatePlans({ id: 'task-1', title: 'Auth system' }, { complexity: 75 });
      const plan = result.plans[0];
      expect(plan).toHaveProperty('id');
      expect(plan).toHaveProperty('strategy');
      expect(plan).toHaveProperty('title');
      expect(plan).toHaveProperty('steps');
      expect(plan).toHaveProperty('risks');
      expect(plan).toHaveProperty('estimates');
      expect(plan).toHaveProperty('dependencies');
    });

    test('steps have action and order', async () => {
      const result = await planner.generatePlans({ id: 'task-1', title: 'Build API' }, { complexity: 50 });
      const steps = result.plans[0].steps;
      expect(steps.length).toBeGreaterThan(0);
      steps.forEach(step => {
        expect(step).toHaveProperty('action');
        expect(step).toHaveProperty('order');
      });
    });

    test('risks have mitigation', async () => {
      const result = await planner.generatePlans({ id: 'task-1', title: 'Database migration' }, { complexity: 75 });
      const risks = result.plans[0].risks;
      risks.forEach(risk => {
        expect(risk).toHaveProperty('risk');
        expect(risk).toHaveProperty('mitigation');
        expect(risk).toHaveProperty('severity');
      });
    });

    test('estimates have hours and complexity', async () => {
      const result = await planner.generatePlans({ id: 'task-1', title: 'Test', estimate: '4h' }, { complexity: 50 });
      const estimates = result.plans[0].estimates;
      expect(estimates).toHaveProperty('hours');
      expect(estimates).toHaveProperty('complexity');
    });
  });

  describe('Strategy Differences', () => {
    test('conservative has more steps', async () => {
      const result = await planner.generatePlans({ id: 'task-1', title: 'Complex' }, { complexity: 75 });
      const conservative = result.plans.find(p => p.strategy.key === 'conservative');
      const aggressive = result.plans.find(p => p.strategy.key === 'aggressive');
      expect(conservative.steps.length).toBeGreaterThanOrEqual(aggressive.steps.length);
    });

    test('aggressive has higher risk tolerance', async () => {
      const result = await planner.generatePlans({ id: 'task-1', title: 'Complex' }, { complexity: 75 });
      const aggressive = result.plans.find(p => p.strategy.key === 'aggressive');
      expect(aggressive.strategy.riskTolerance).toBe('high');
    });

    test('conservative has lower estimate', async () => {
      const result = await planner.generatePlans({ id: 'task-1', title: 'Complex', estimate: '8h' }, { complexity: 75 });
      const conservative = result.plans.find(p => p.strategy.key === 'conservative');
      const aggressive = result.plans.find(p => p.strategy.key === 'aggressive');
      expect(conservative.estimates.hours).toBeGreaterThan(aggressive.estimates.hours);
    });
  });

  describe('Integration with Dependencies', () => {
    test('uses ComplexityAnalyzer if provided', async () => {
      const mockAnalyzer = { analyze: jest.fn().mockResolvedValue({ score: 80 }) };
      const p = new CompetitivePlanner({ complexityAnalyzer: mockAnalyzer });
      await p.generatePlans({ id: 'task-1', title: 'Test' });
      expect(mockAnalyzer.analyze).toHaveBeenCalled();
    });

    test('uses PlanEvaluator if provided', async () => {
      const mockEvaluator = {
        comparePlans: jest.fn().mockReturnValue({
          winner: { plan: { id: 'plan-1' }, planId: 'plan-1' },
          needsReview: false
        })
      };
      const p = new CompetitivePlanner({ planEvaluator: mockEvaluator });
      const result = await p.generatePlans({ id: 'task-1', title: 'Test' }, { complexity: 50 });
      expect(mockEvaluator.comparePlans).toHaveBeenCalled();
    });
  });

  describe('Event Emission', () => {
    test('emits plans:generated event', async () => {
      const handler = jest.fn();
      planner.on('plans:generated', handler);
      await planner.generatePlans({ id: 'task-1', title: 'Test' }, { complexity: 50 });
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        taskId: 'task-1',
        planCount: 2
      }));
    });
  });

  describe('Cache Management', () => {
    test('getCachedPlan returns cached result', async () => {
      await planner.generatePlans({ id: 'task-1', title: 'Test' }, { complexity: 50 });
      const cached = planner.getCachedPlan('task-1');
      expect(cached).not.toBeNull();
      expect(cached.taskId).toBe('task-1');
    });

    test('getCachedPlan returns null for unknown task', () => {
      const cached = planner.getCachedPlan('unknown');
      expect(cached).toBeNull();
    });

    test('clearCache removes all cached plans', async () => {
      await planner.generatePlans({ id: 'task-1', title: 'Test' }, { complexity: 50 });
      planner.clearCache();
      const cached = planner.getCachedPlan('task-1');
      expect(cached).toBeNull();
    });
  });

  describe('Configuration', () => {
    test('getStrategies returns all strategies', () => {
      const strategies = planner.getStrategies();
      expect(Object.keys(strategies)).toEqual(['conservative', 'balanced', 'aggressive']);
    });

    test('setComplexityThreshold updates threshold', () => {
      planner.setComplexityThreshold(60);
      expect(planner.getComplexityThreshold()).toBe(60);
    });

    test('setComplexityThreshold throws for invalid value', () => {
      expect(() => planner.setComplexityThreshold(-10)).toThrow('must be 0-100');
      expect(() => planner.setComplexityThreshold(150)).toThrow('must be 0-100');
    });
  });

  describe('Task Analysis', () => {
    test('detects database keywords', async () => {
      const result = await planner.generatePlans({ id: 't1', title: 'Database migration', description: 'Schema update' }, { complexity: 75 });
      const risks = result.plans[0].risks;
      expect(risks.some(r => r.risk.toLowerCase().includes('data'))).toBe(true);
    });

    test('detects API keywords', async () => {
      const result = await planner.generatePlans({ id: 't1', title: 'API integration', description: 'External service' }, { complexity: 75 });
      const deps = result.plans[0].dependencies;
      expect(deps.some(d => d.includes('api'))).toBe(true);
    });

    test('extracts estimate from task', async () => {
      const result = await planner.generatePlans({ id: 't1', title: 'Test', estimate: '8h' }, { complexity: 50 });
      const balanced = result.plans.find(p => p.strategy.key === 'balanced');
      expect(balanced.estimates.hours).toBeCloseTo(8, 0);
    });
  });
});
