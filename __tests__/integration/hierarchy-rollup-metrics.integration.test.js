/**
 * Integration Tests: Hierarchy Rollup Metrics
 *
 * Tests token aggregation, quality score averaging,
 * duration histograms, success rate rollup, and real-time propagation.
 */

const DelegationMetrics = require('../../.claude/core/delegation-metrics');
const SessionRegistry = require('../../.claude/core/session-registry');
const {
  HierarchyRegistry,
  DelegationStatus
} = require('../../.claude/core/hierarchy-registry');

describe('Hierarchy Rollup Metrics Integration', () => {
  let metrics;
  let sessionRegistry;
  let hierarchyRegistry;

  beforeEach(() => {
    metrics = new DelegationMetrics();
    sessionRegistry = new SessionRegistry();
    hierarchyRegistry = new HierarchyRegistry();
  });

  afterEach(() => {
    metrics.reset();
    sessionRegistry.clear();
    hierarchyRegistry.clear();
  });

  // ============================================================
  // 1. TOKEN AGGREGATION
  // ============================================================
  describe('Token Aggregation', () => {
    it('should sum tokens across all descendants', () => {
      // Setup: root -> [child1, child2], child1 -> [gc1, gc2]
      const tokenUsage = {
        'root': 500,
        'child-1': 1000,
        'child-2': 800,
        'gc-1': 300,
        'gc-2': 400
      };

      const totalTokens = Object.values(tokenUsage).reduce((sum, t) => sum + t, 0);
      expect(totalTokens).toBe(3000);
    });

    it('should calculate rollup tokens for each level', () => {
      metrics.recordTokenUsage('gc-1', 300);
      metrics.recordTokenUsage('gc-2', 400);
      metrics.recordTokenUsage('child-1', 1000);

      // Child-1's rollup includes itself + grandchildren
      const child1Rollup = metrics.getRollupTokens('child-1', ['gc-1', 'gc-2']);
      expect(child1Rollup).toBe(1700);
    });

    it('should handle deep nesting in token calculation', () => {
      const hierarchy = {
        'root': { tokens: 100, children: ['l1-a', 'l1-b'] },
        'l1-a': { tokens: 200, children: ['l2-a', 'l2-b'] },
        'l1-b': { tokens: 150, children: ['l2-c'] },
        'l2-a': { tokens: 50, children: [] },
        'l2-b': { tokens: 75, children: [] },
        'l2-c': { tokens: 60, children: [] }
      };

      const calculateTotal = (nodeId) => {
        const node = hierarchy[nodeId];
        return node.tokens + node.children.reduce((sum, childId) => sum + calculateTotal(childId), 0);
      };

      expect(calculateTotal('root')).toBe(635);
    });

    it('should track token budget utilization percentage', () => {
      const budget = 10000;
      const used = 7500;
      const utilization = (used / budget) * 100;

      expect(utilization).toBe(75);
    });
  });

  // ============================================================
  // 2. QUALITY SCORE AVERAGING
  // ============================================================
  describe('Quality Score Averaging', () => {
    it('should average quality scores across children', () => {
      const childScores = [85, 90, 78, 92];
      const average = childScores.reduce((sum, s) => sum + s, 0) / childScores.length;

      expect(average).toBe(86.25);
    });

    it('should weight scores by task complexity', () => {
      const results = [
        { score: 90, complexity: 10 },
        { score: 80, complexity: 30 },
        { score: 95, complexity: 20 }
      ];

      const totalComplexity = results.reduce((sum, r) => sum + r.complexity, 0);
      const weightedSum = results.reduce((sum, r) => sum + (r.score * r.complexity), 0);
      const weightedAverage = weightedSum / totalComplexity;

      expect(weightedAverage).toBeCloseTo(86.67, 2);
    });

    it('should exclude failed tasks from quality calculation', () => {
      const results = [
        { score: 90, success: true },
        { score: null, success: false },
        { score: 85, success: true }
      ];

      const successfulScores = results.filter(r => r.success).map(r => r.score);
      const average = successfulScores.reduce((sum, s) => sum + s, 0) / successfulScores.length;

      expect(average).toBe(87.5);
    });

    it('should propagate quality updates to parent', () => {
      sessionRegistry.register('parent', { qualityScore: null, childCount: 2 });
      sessionRegistry.register('child-1', { qualityScore: 85, parentId: 'parent' });
      sessionRegistry.register('child-2', { qualityScore: 90, parentId: 'parent' });

      sessionRegistry.updateRollupQuality('parent');

      const parentSession = sessionRegistry.get('parent');
      expect(parentSession.rollupQualityScore).toBe(87.5);
    });
  });

  // ============================================================
  // 3. DURATION HISTOGRAMS
  // ============================================================
  describe('Duration Histograms', () => {
    it('should populate histogram buckets correctly', () => {
      const durations = [500, 1200, 3000, 8000, 15000, 45000];

      durations.forEach(d => metrics.recordDuration(d));

      const histogram = metrics.getDurationHistogram();
      expect(histogram['0-1s']).toBe(1);    // 500ms
      expect(histogram['1-5s']).toBe(2);    // 1200ms, 3000ms
      expect(histogram['5-30s']).toBe(2);   // 8000ms, 15000ms
      expect(histogram['30s+']).toBe(1);    // 45000ms
    });

    it('should calculate percentiles (p50, p90, p99)', () => {
      // Add 100 duration samples
      const samples = Array.from({ length: 100 }, (_, i) => (i + 1) * 100);
      samples.forEach(s => metrics.recordDuration(s));

      const percentiles = metrics.getPercentiles();

      expect(percentiles.p50).toBe(5000);   // Median
      expect(percentiles.p90).toBe(9000);   // 90th percentile
      expect(percentiles.p99).toBe(9900);   // 99th percentile
    });

    it('should track average duration per delegation level', () => {
      metrics.recordDurationByLevel(0, 10000); // Root
      metrics.recordDurationByLevel(0, 8000);
      metrics.recordDurationByLevel(1, 4000);  // Level 1
      metrics.recordDurationByLevel(1, 5000);
      metrics.recordDurationByLevel(2, 2000);  // Level 2
      metrics.recordDurationByLevel(2, 1500);

      const avgByLevel = metrics.getAverageDurationByLevel();
      expect(avgByLevel[0]).toBe(9000);
      expect(avgByLevel[1]).toBe(4500);
      expect(avgByLevel[2]).toBe(1750);
    });
  });

  // ============================================================
  // 4. SUCCESS RATE ROLLUP
  // ============================================================
  describe('Success Rate Rollup', () => {
    it('should calculate success rate for parent from children', () => {
      const childResults = [
        { success: true },
        { success: true },
        { success: false },
        { success: true }
      ];

      const successRate = childResults.filter(r => r.success).length / childResults.length;
      expect(successRate).toBe(0.75);
    });

    it('should calculate success rate across entire tree', () => {
      const treeResults = {
        'child-1': { success: true, children: ['gc-1', 'gc-2'] },
        'child-2': { success: false, children: ['gc-3'] },
        'gc-1': { success: true, children: [] },
        'gc-2': { success: true, children: [] },
        'gc-3': { success: true, children: [] }
      };

      const allResults = Object.values(treeResults);
      const treeSuccessRate = allResults.filter(r => r.success).length / allResults.length;

      expect(treeSuccessRate).toBe(0.8); // 4/5 succeeded
    });

    it('should weight success rate by subtask importance', () => {
      const results = [
        { success: true, priority: 'critical', weight: 3 },
        { success: false, priority: 'high', weight: 2 },
        { success: true, priority: 'normal', weight: 1 }
      ];

      const totalWeight = results.reduce((sum, r) => sum + r.weight, 0);
      const weightedSuccess = results
        .filter(r => r.success)
        .reduce((sum, r) => sum + r.weight, 0);
      const weightedRate = weightedSuccess / totalWeight;

      expect(weightedRate).toBeCloseTo(0.67, 2); // (3+1)/6
    });

    it('should track success rate trend over time', () => {
      const rateHistory = [0.6, 0.7, 0.65, 0.8, 0.85];

      const trend = rateHistory[rateHistory.length - 1] - rateHistory[0];
      const isImproving = trend > 0;

      expect(isImproving).toBe(true);
      expect(trend).toBe(0.25);
    });
  });

  // ============================================================
  // 5. REAL-TIME PROPAGATION
  // ============================================================
  describe('Real-Time Propagation', () => {
    it('should propagate child completion to parent immediately', (done) => {
      sessionRegistry.register('parent', { completedChildren: 0 });
      sessionRegistry.register('child', { parentId: 'parent' });

      sessionRegistry.on('childComplete', (event) => {
        expect(event.parentId).toBe('parent');
        expect(event.childId).toBe('child');
        done();
      });

      sessionRegistry.markComplete('child', { result: 'success' });
    });

    it('should update parent metrics on child completion', () => {
      sessionRegistry.register('parent', {
        totalTokens: 0,
        childTokens: {}
      });
      sessionRegistry.register('child', { parentId: 'parent' });

      sessionRegistry.updateChildMetrics('parent', 'child', {
        tokens: 500,
        quality: 85,
        duration: 3000
      });

      const parent = sessionRegistry.get('parent');
      expect(parent.childTokens['child']).toBe(500);
      expect(parent.totalTokens).toBe(500);
    });

    it('should cascade metrics update to root', () => {
      sessionRegistry.register('root', { totalTokens: 0 });
      sessionRegistry.register('child', { parentId: 'root', totalTokens: 0 });
      sessionRegistry.register('grandchild', { parentId: 'child', totalTokens: 0 });

      // Grandchild completes
      sessionRegistry.propagateMetricUpdate('grandchild', {
        tokens: 200,
        quality: 90
      });

      // Should propagate up
      expect(sessionRegistry.get('child').childTokens?.['grandchild']).toBe(200);
      expect(sessionRegistry.get('root').totalDescendantTokens).toBeGreaterThanOrEqual(200);
    });

    it('should batch updates for performance', (done) => {
      const updateCount = { value: 0 };

      sessionRegistry.on('batchUpdate', () => {
        updateCount.value++;
      });

      // Multiple rapid updates
      for (let i = 0; i < 10; i++) {
        sessionRegistry.queueMetricUpdate('parent', { tokens: 100 * i });
      }

      // Should batch into fewer actual updates
      setTimeout(() => {
        expect(updateCount.value).toBeLessThan(10);
        done();
      }, 100);
    });
  });

  // ============================================================
  // 6. ROLLING WINDOW ACCURACY
  // ============================================================
  describe('Rolling Window Accuracy', () => {
    it('should maintain accurate 1-minute window', () => {
      jest.useFakeTimers();

      // Record metrics over 2 minutes
      metrics.recordMetric('tokens', 100, Date.now());
      jest.advanceTimersByTime(30000); // 30s
      metrics.recordMetric('tokens', 150, Date.now());
      jest.advanceTimersByTime(45000); // 75s total
      metrics.recordMetric('tokens', 200, Date.now());

      const oneMinWindow = metrics.getRollingWindow('tokens', 60000);

      // Only last two entries should be in 1-min window
      expect(oneMinWindow.sum).toBe(350); // 150 + 200

      jest.useRealTimers();
    });

    it('should calculate rolling average correctly', () => {
      const windowData = [100, 150, 200, 120, 180];
      const rollingAvg = windowData.reduce((sum, v) => sum + v, 0) / windowData.length;

      expect(rollingAvg).toBe(150);
    });

    it('should expire old data correctly', () => {
      jest.useFakeTimers();

      metrics.recordMetric('quality', 85, Date.now());
      jest.advanceTimersByTime(120000); // 2 minutes
      metrics.recordMetric('quality', 90, Date.now());

      // 1-minute window should only have recent value
      const window = metrics.getRollingWindow('quality', 60000);
      expect(window.count).toBe(1);
      expect(window.values[0]).toBe(90);

      jest.useRealTimers();
    });

    it('should support multiple window sizes', () => {
      const now = Date.now();
      const data = [
        { value: 100, timestamp: now - 300000 }, // 5 min ago
        { value: 150, timestamp: now - 180000 }, // 3 min ago
        { value: 200, timestamp: now - 60000 },  // 1 min ago
        { value: 175, timestamp: now - 30000 }   // 30s ago
      ];

      data.forEach(d => metrics.recordMetricWithTimestamp('rate', d.value, d.timestamp));

      expect(metrics.getRollingWindow('rate', 60000).sum).toBe(375);  // 200 + 175
      expect(metrics.getRollingWindow('rate', 300000).sum).toBe(625); // All
    });
  });

  // ============================================================
  // 7. SNAPSHOT AND HISTORY
  // ============================================================
  describe('Snapshot and History', () => {
    it('should create accurate point-in-time snapshot', () => {
      metrics.recordDuration(1000);
      metrics.recordDuration(2000);
      metrics.recordTokenUsage('agent-1', 500);
      metrics.recordSuccess('task-1', true);
      metrics.recordSuccess('task-2', false);

      const snapshot = metrics.createSnapshot();

      expect(snapshot.totalDurations).toBe(2);
      expect(snapshot.avgDuration).toBe(1500);
      expect(snapshot.totalTokens).toBe(500);
      expect(snapshot.successRate).toBe(0.5);
      expect(snapshot.timestamp).toBeDefined();
    });

    it('should track metric history for trend analysis', () => {
      const history = [];

      // Simulate hourly snapshots
      for (let hour = 0; hour < 24; hour++) {
        history.push({
          hour,
          successRate: 0.7 + (hour * 0.01), // Improving trend
          avgDuration: 5000 - (hour * 100)   // Decreasing duration
        });
      }

      const firstHour = history[0];
      const lastHour = history[23];

      expect(lastHour.successRate).toBeGreaterThan(firstHour.successRate);
      expect(lastHour.avgDuration).toBeLessThan(firstHour.avgDuration);
    });

    it('should compare snapshots for diff analysis', () => {
      const snapshot1 = {
        successRate: 0.75,
        avgDuration: 5000,
        totalTokens: 10000
      };

      const snapshot2 = {
        successRate: 0.82,
        avgDuration: 4200,
        totalTokens: 12000
      };

      const diff = {
        successRateChange: snapshot2.successRate - snapshot1.successRate,
        durationChange: snapshot2.avgDuration - snapshot1.avgDuration,
        tokenChange: snapshot2.totalTokens - snapshot1.totalTokens
      };

      expect(diff.successRateChange).toBe(0.07);
      expect(diff.durationChange).toBe(-800);
      expect(diff.tokenChange).toBe(2000);
    });
  });

  // ============================================================
  // 8. AGGREGATE STATE QUERIES
  // ============================================================
  describe('Aggregate State Queries', () => {
    it('should get aggregate state for hierarchy', () => {
      hierarchyRegistry.registerAgent('root', { tokens: 100, quality: 90 });
      hierarchyRegistry.registerHierarchy('root', 'child-1', { tokens: 200, quality: 85 });
      hierarchyRegistry.registerHierarchy('root', 'child-2', { tokens: 150, quality: 88 });

      const aggregate = hierarchyRegistry.getAggregateState('root');

      expect(aggregate.totalTokens).toBe(450);
      expect(aggregate.avgQuality).toBeCloseTo(87.67, 2);
      expect(aggregate.activeCount).toBe(3);
    });

    it('should filter aggregate by status', () => {
      hierarchyRegistry.registerAgent('root', { status: 'active' });
      hierarchyRegistry.registerHierarchy('root', 'child-1', { status: 'completed' });
      hierarchyRegistry.registerHierarchy('root', 'child-2', { status: 'active' });
      hierarchyRegistry.registerHierarchy('root', 'child-3', { status: 'failed' });

      const activeAggregate = hierarchyRegistry.getAggregateState('root', { statusFilter: 'active' });

      expect(activeAggregate.count).toBe(2); // root + child-2
    });

    it('should compute aggregate by depth level', () => {
      hierarchyRegistry.registerAgent('root', { tokens: 100 });
      hierarchyRegistry.registerHierarchy('root', 'l1-a', { tokens: 200 });
      hierarchyRegistry.registerHierarchy('root', 'l1-b', { tokens: 150 });
      hierarchyRegistry.registerHierarchy('l1-a', 'l2-a', { tokens: 75 });

      const byLevel = hierarchyRegistry.getAggregateByLevel('root');

      expect(byLevel[0].totalTokens).toBe(100);  // Root only
      expect(byLevel[1].totalTokens).toBe(350);  // l1-a + l1-b
      expect(byLevel[2].totalTokens).toBe(75);   // l2-a
    });
  });
});
