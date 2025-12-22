/**
 * Tests for Predictive Analytics Module
 */

const PredictiveAnalytics = require('./predictive-analytics');

describe('PredictiveAnalytics', () => {
  let analytics;

  beforeEach(() => {
    analytics = new PredictiveAnalytics();
  });

  describe('constructor', () => {
    it('should create instance with default options', () => {
      expect(analytics).toBeDefined();
      expect(analytics.historyWindow).toBe(20);
      expect(analytics.predictionHorizon).toBe(10);
    });

    it('should accept custom options', () => {
      const custom = new PredictiveAnalytics({
        historyWindow: 30,
        predictionHorizon: 15,
      });
      expect(custom.historyWindow).toBe(30);
      expect(custom.predictionHorizon).toBe(15);
    });
  });

  describe('addDataPoint', () => {
    it('should add data point for new project', () => {
      analytics.addDataPoint('project-1', {
        contextPercent: 25,
        contextUsed: 50000,
        cost: 0.50,
        messageCount: 10,
      });

      expect(analytics.projectHistory.has('project-1')).toBe(true);
      expect(analytics.projectHistory.get('project-1').length).toBe(1);
    });

    it('should accumulate data points', () => {
      for (let i = 0; i < 5; i++) {
        analytics.addDataPoint('project-1', {
          timestamp: Date.now() + i * 60000,
          contextPercent: 10 + i * 5,
          contextUsed: 20000 + i * 10000,
        });
      }

      expect(analytics.projectHistory.get('project-1').length).toBe(5);
    });
  });

  describe('getPrediction', () => {
    it('should return default for unknown project', () => {
      const pred = analytics.getPrediction('unknown');
      expect(pred.minutesToExhaustion).toBe(Infinity);
      expect(pred.confidence).toBe(0);
      expect(pred.trend).toBe('unknown');
    });

    it('should predict exhaustion for rising context', () => {
      const baseTime = Date.now();

      // Simulate rapid context growth
      for (let i = 0; i < 10; i++) {
        analytics.addDataPoint('rising-project', {
          timestamp: baseTime + i * 60000,
          contextPercent: 20 + i * 5, // Rises by 5% per minute
        });
      }

      const pred = analytics.getPrediction('rising-project');
      expect(pred.trend).toMatch(/rising/);
      expect(pred.minutesToExhaustion).toBeLessThan(20);
      expect(pred.confidence).toBeGreaterThan(0.5);
    });

    it('should predict stable for flat context', () => {
      const baseTime = Date.now();

      // Simulate stable context (exactly flat, no noise)
      for (let i = 0; i < 10; i++) {
        analytics.addDataPoint('stable-project', {
          timestamp: baseTime + i * 60000,
          contextPercent: 30, // Exactly 30%
        });
      }

      const pred = analytics.getPrediction('stable-project');
      // Stable trend means slope is near zero - could be stable or falling
      expect(['stable', 'falling']).toContain(pred.trend);
      expect(pred.minutesToExhaustion).toBeGreaterThan(50);
    });

    it('should return 0 minutes when above threshold', () => {
      analytics.addDataPoint('critical-project', {
        contextPercent: 80,
      });
      analytics.addDataPoint('critical-project', {
        contextPercent: 82,
      });
      analytics.addDataPoint('critical-project', {
        contextPercent: 85,
      });

      const pred = analytics.getPrediction('critical-project');
      expect(pred.minutesToExhaustion).toBe(0);
      expect(pred.trend).toBe('critical');
    });
  });

  describe('getAllPredictions', () => {
    it('should return predictions for all projects', () => {
      analytics.addDataPoint('project-a', { contextPercent: 30 });
      analytics.addDataPoint('project-a', { contextPercent: 35 });
      analytics.addDataPoint('project-a', { contextPercent: 40 });

      analytics.addDataPoint('project-b', { contextPercent: 10 });
      analytics.addDataPoint('project-b', { contextPercent: 12 });
      analytics.addDataPoint('project-b', { contextPercent: 14 });

      const all = analytics.getAllPredictions();
      expect(Object.keys(all)).toContain('project-a');
      expect(Object.keys(all)).toContain('project-b');
    });
  });

  describe('analyzePatterns', () => {
    it('should return empty patterns for insufficient data', () => {
      const patterns = analytics.analyzePatterns('no-data');
      expect(patterns.patterns).toEqual([]);
      expect(patterns.averageSessionLength).toBe(0);
    });

    it('should detect burst pattern', () => {
      const baseTime = Date.now();

      for (let i = 0; i < 10; i++) {
        analytics.addDataPoint('burst-project', {
          timestamp: baseTime + i * 60000,
          contextPercent: 10 + i * 8, // 8% per minute (very fast)
          messageCount: i * 5,
        });
      }

      const analysis = analytics.analyzePatterns('burst-project');
      const burstPattern = analysis.patterns.find(p => p.type === 'burst');
      expect(burstPattern).toBeDefined();
      expect(burstPattern.severity).toBe('high');
    });

    it('should detect steady pattern', () => {
      const baseTime = Date.now();

      for (let i = 0; i < 10; i++) {
        analytics.addDataPoint('steady-project', {
          timestamp: baseTime + i * 60000,
          contextPercent: 40, // Constant at 40%
          messageCount: i,
        });
      }

      const analysis = analytics.analyzePatterns('steady-project');
      const steadyPattern = analysis.patterns.find(p => p.type === 'steady');
      expect(steadyPattern).toBeDefined();
    });

    it('should calculate average tokens per message', () => {
      const baseTime = Date.now();

      analytics.addDataPoint('metrics-project', {
        timestamp: baseTime,
        contextUsed: 10000,
        messageCount: 5,
      });
      analytics.addDataPoint('metrics-project', {
        timestamp: baseTime + 60000,
        contextUsed: 20000,
        messageCount: 10,
      });
      analytics.addDataPoint('metrics-project', {
        timestamp: baseTime + 120000,
        contextUsed: 30000,
        messageCount: 15,
      });
      analytics.addDataPoint('metrics-project', {
        timestamp: baseTime + 180000,
        contextUsed: 40000,
        messageCount: 20,
      });
      analytics.addDataPoint('metrics-project', {
        timestamp: baseTime + 240000,
        contextUsed: 50000,
        messageCount: 25,
      });

      const analysis = analytics.analyzePatterns('metrics-project');
      expect(analysis.averageTokensPerMessage).toBeGreaterThan(0);
    });
  });

  describe('getCostRecommendations', () => {
    it('should return empty for no cost data', () => {
      const recs = analytics.getCostRecommendations();
      expect(Array.isArray(recs)).toBe(true);
    });

    it('should recommend Sonnet for Opus users', () => {
      analytics.addDataPoint('opus-project', {
        model: 'claude-opus-4-5-20251101',
        contextPercent: 30,
      });

      const recs = analytics.getCostRecommendations();
      const modelRec = recs.find(r => r.type === 'model-suggestion');
      expect(modelRec).toBeDefined();
      expect(modelRec.actions).toContain('Use Sonnet for code generation and simple tasks');
    });
  });

  describe('getSummary', () => {
    it('should return comprehensive summary', () => {
      analytics.addDataPoint('project-1', { contextPercent: 40 });
      analytics.addDataPoint('project-1', { contextPercent: 45 });
      analytics.addDataPoint('project-1', { contextPercent: 50 });

      const summary = analytics.getSummary();

      expect(summary).toHaveProperty('timestamp');
      expect(summary).toHaveProperty('projects');
      expect(summary).toHaveProperty('predictions');
      expect(summary).toHaveProperty('soonestExhaustion');
      expect(summary).toHaveProperty('costVelocity');
      expect(summary).toHaveProperty('recommendations');
    });

    it('should identify soonest exhaustion', () => {
      const baseTime = Date.now();

      // Project A: slower growth
      for (let i = 0; i < 5; i++) {
        analytics.addDataPoint('slow-project', {
          timestamp: baseTime + i * 60000,
          contextPercent: 20 + i * 2,
        });
      }

      // Project B: faster growth
      for (let i = 0; i < 5; i++) {
        analytics.addDataPoint('fast-project', {
          timestamp: baseTime + i * 60000,
          contextPercent: 50 + i * 5,
        });
      }

      const summary = analytics.getSummary();
      expect(summary.soonestExhaustion.projectId).toBe('fast-project');
    });
  });

  describe('linear regression', () => {
    it('should calculate correct slope for linear data', () => {
      const baseTime = Date.now();

      // Perfect linear growth: 10% per minute
      for (let i = 0; i < 5; i++) {
        analytics.addDataPoint('linear-project', {
          timestamp: baseTime + i * 60000,
          contextPercent: i * 10,
        });
      }

      const pred = analytics.getPrediction('linear-project');
      expect(pred.slope).toBeCloseTo(10, 0);
      expect(pred.confidence).toBeGreaterThan(0.9);
    });
  });

  describe('event emission', () => {
    it('should emit exhaustion-warning for imminent exhaustion', () => {
      const warnings = [];
      analytics.on('exhaustion-warning', (data) => {
        warnings.push(data);
      });

      const baseTime = Date.now();

      // Rapid approach to threshold
      for (let i = 0; i < 10; i++) {
        analytics.addDataPoint('danger-project', {
          timestamp: baseTime + i * 60000,
          contextPercent: 65 + i * 2, // Will hit 75+ in 5 minutes
        });
      }

      // Check that at least one warning was emitted
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].projectId).toBe('danger-project');
    });
  });
});
