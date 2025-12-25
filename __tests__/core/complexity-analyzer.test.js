/**
 * ComplexityAnalyzer Test Suite
 */
const ComplexityAnalyzer = require('../../.claude/core/complexity-analyzer');

describe('ComplexityAnalyzer', () => {
  let analyzer;
  let mockMemoryStore;
  let mockTaskManager;

  beforeEach(() => {
    mockMemoryStore = { getTaskPatternSuccess: jest.fn() };
    mockTaskManager = { _getAncestors: jest.fn().mockReturnValue([]), _getDescendants: jest.fn().mockReturnValue([]) };
    analyzer = new ComplexityAnalyzer({ memoryStore: mockMemoryStore, taskManager: mockTaskManager });
  });

  afterEach(() => { analyzer.clearCache(); });

  describe('Constructor', () => {
    test('creates instance with default options', () => {
      const a = new ComplexityAnalyzer();
      expect(a.memoryStore).toBeNull();
      expect(a.taskManager).toBeNull();
    });

    test('creates instance with dependencies', () => {
      expect(analyzer.memoryStore).toBe(mockMemoryStore);
      expect(analyzer.taskManager).toBe(mockTaskManager);
    });
  });

  describe('analyze()', () => {
    test('throws error when task is null', async () => {
      await expect(analyzer.analyze(null)).rejects.toThrow('Task is required');
    });

    test('returns result with required properties', async () => {
      const result = await analyzer.analyze({ id: 'task-1', title: 'Test' });
      expect(result).toHaveProperty('taskId', 'task-1');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('breakdown');
      expect(result).toHaveProperty('strategy');
    });

    test('returns score between 0 and 100', async () => {
      const result = await analyzer.analyze({ id: 'task-1', title: 'Test' });
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    test('uses cache on second call', async () => {
      const task = { id: 'task-1', title: 'Test' };
      const r1 = await analyzer.analyze(task);
      const r2 = await analyzer.analyze(task);
      expect(r1).toEqual(r2);
    });

    test('bypasses cache when useCache is false', async () => {
      const task = { id: 'task-1', title: 'Test' };
      await analyzer.analyze(task);
      const r2 = await analyzer.analyze(task, { useCache: false });
      expect(r2).toHaveProperty('analyzedAt');
    });
  });

  describe('Dependency Depth Scoring', () => {
    test('scores 0 for no dependencies', async () => {
      const result = await analyzer.analyze({ id: 't1', title: 'No deps' });
      expect(result.breakdown.dependencyDepth.score).toBe(0);
    });

    test('increases score with requires array', async () => {
      const result = await analyzer.analyze({ id: 't1', title: 'Has deps', requires: ['d1', 'd2', 'd3'] });
      expect(result.breakdown.dependencyDepth.score).toBeGreaterThan(0);
    });

    test('uses TaskManager ancestors', async () => {
      mockTaskManager._getAncestors.mockReturnValue(['a1', 'a2', 'a3']);
      const result = await analyzer.analyze({ id: 't1', title: 'Deep' }, { useCache: false });
      expect(mockTaskManager._getAncestors).toHaveBeenCalled();
    });
  });

  describe('Acceptance Criteria Scoring', () => {
    test('scores low for no criteria', async () => {
      const result = await analyzer.analyze({ id: 't1', title: 'No AC' });
      expect(result.breakdown.acceptanceCriteria.score).toBe(10);
    });

    test('scores higher with more criteria', async () => {
      const r1 = await analyzer.analyze({ id: 't1', title: 'Few', acceptance: ['A'] });
      const r2 = await analyzer.analyze({ id: 't2', title: 'Many', acceptance: ['A', 'B', 'C', 'D'] });
      expect(r2.breakdown.acceptanceCriteria.score).toBeGreaterThan(r1.breakdown.acceptanceCriteria.score);
    });
  });

  describe('Effort Estimate Scoring', () => {
    test('returns neutral score for missing estimate', async () => {
      const result = await analyzer.analyze({ id: 't1', title: 'No est' });
      expect(result.breakdown.effortEstimate.score).toBe(50);
    });

    test('scores low for short estimates', async () => {
      const result = await analyzer.analyze({ id: 't1', title: 'Quick', estimate: '30m' });
      expect(result.breakdown.effortEstimate.score).toBeLessThanOrEqual(20);
    });

    test('scores high for day estimates', async () => {
      const result = await analyzer.analyze({ id: 't1', title: 'Long', estimate: '1d' });
      expect(result.breakdown.effortEstimate.score).toBeGreaterThanOrEqual(65);
    });
  });

  describe('Technical Keywords Scoring', () => {
    test('detects security keywords', async () => {
      const result = await analyzer.analyze({ id: 't1', title: 'Security audit', description: 'authentication authorization' });
      expect(result.breakdown.technicalKeywords.score).toBeGreaterThan(30);
    });

    test('detects architecture keywords', async () => {
      const result = await analyzer.analyze({ id: 't1', title: 'System architecture refactor' });
      expect(result.breakdown.technicalKeywords.score).toBeGreaterThan(0);
    });
  });

  describe('Strategy Determination', () => {
    test('returns fast-path for simple tasks', async () => {
      mockMemoryStore.getTaskPatternSuccess.mockResolvedValue({ successRate: 0.95, sampleSize: 20 });
      const result = await analyzer.analyze({ id: 't1', title: 'Simple', estimate: '15m' }, { useCache: false });
      if (result.score < 40) expect(result.strategy).toBe('fast-path');
    });

    test('returns competitive for complex tasks', async () => {
      mockMemoryStore.getTaskPatternSuccess.mockResolvedValue({ successRate: 0.3, sampleSize: 15 });
      mockTaskManager._getAncestors.mockReturnValue(['a1', 'a2', 'a3']);
      const result = await analyzer.analyze({
        id: 't1', title: 'Complex architecture refactor security migration',
        description: 'database schema redesign with encryption API integration',
        estimate: '2d', requires: ['d1', 'd2', 'd3', 'd4'],
        acceptance: ['If authenticated allow', 'Response < 100ms', 'Handle 1000 users']
      }, { useCache: false });
      if (result.score >= 70) expect(result.strategy).toBe('competitive');
    });
  });

  describe('Event Emission', () => {
    test('emits complexity:analyzed event', async () => {
      const handler = jest.fn();
      analyzer.on('complexity:analyzed', handler);
      await analyzer.analyze({ id: 't1', title: 'Test' });
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Batch Analysis', () => {
    test('analyzes multiple tasks', async () => {
      const results = await analyzer.analyzeBatch([
        { id: 't1', title: 'Task 1' },
        { id: 't2', title: 'Task 2' }
      ]);
      expect(results).toHaveLength(2);
    });

    test('throws error for non-array', async () => {
      await expect(analyzer.analyzeBatch('not array')).rejects.toThrow('must be an array');
    });
  });

  describe('Cache Management', () => {
    test('clearCache removes cached results', async () => {
      await analyzer.analyze({ id: 't1', title: 'Test' });
      expect(analyzer.getCacheStats().size).toBe(1);
      analyzer.clearCache();
      expect(analyzer.getCacheStats().size).toBe(0);
    });
  });

  describe('Configuration Getters', () => {
    test('getStrategyThresholds returns thresholds', () => {
      const t = analyzer.getStrategyThresholds();
      expect(t.fastPath).toBe(40);
      expect(t.standard).toBe(70);
    });

    test('getScoringWeights returns weights summing to 1', () => {
      const w = analyzer.getScoringWeights();
      const sum = Object.values(w).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 5);
    });
  });
});
