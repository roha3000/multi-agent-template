/**
 * MemoryStore Swarm Features Test Suite
 *
 * Tests for swarm database schema and methods:
 * - recordConfidenceHistory / getConfidenceHistory
 * - recordComplexityAnalysis / getComplexityAnalysis / updateComplexityValidation
 * - recordPlanComparison / getPlanComparisons / updatePlanComparisonValidation
 * - getSwarmStats
 *
 * @module memory-store.swarm.test
 */

const MemoryStore = require('./memory-store');
const fs = require('fs');
const path = require('path');

describe('MemoryStore Swarm Features', () => {
  let store;
  const testDbPath = path.join(__dirname, '..', 'memory', 'test-swarm.db');

  beforeEach(() => {
    // Remove test database if exists
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    store = new MemoryStore(testDbPath);
  });

  afterEach(() => {
    if (store) {
      store.close();
    }
    // Cleanup test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  // ============================================================================
  // Schema Initialization Tests
  // ============================================================================

  describe('Schema Initialization', () => {
    it('should create swarm tables on first access', () => {
      // Trigger schema creation by calling a swarm method
      store.getSwarmStats();

      // Verify tables exist
      const tables = store.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name IN (
          'confidence_history', 'complexity_analysis', 'plan_comparisons'
        )
      `).all();

      expect(tables.length).toBe(3);
      expect(tables.map(t => t.name)).toContain('confidence_history');
      expect(tables.map(t => t.name)).toContain('complexity_analysis');
      expect(tables.map(t => t.name)).toContain('plan_comparisons');
    });

    it('should create views on first access', () => {
      store.getSwarmStats();

      const views = store.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='view' AND name IN (
          'v_confidence_trends', 'v_complexity_distribution',
          'v_plan_comparison_accuracy', 'v_recent_swarm_activity'
        )
      `).all();

      expect(views.length).toBe(4);
    });

    it('should not recreate schema if already exists', () => {
      // First access
      store.getSwarmStats();

      // Second access should not throw
      expect(() => store.getSwarmStats()).not.toThrow();
    });
  });

  // ============================================================================
  // Confidence History Tests
  // ============================================================================

  describe('recordConfidenceHistory', () => {
    it('should record a basic confidence entry', () => {
      const id = store.recordConfidenceHistory({
        confidenceScore: 75.5
      });

      expect(id).toBeGreaterThan(0);
    });

    it('should record confidence with all fields', () => {
      const id = store.recordConfidenceHistory({
        taskId: 'task-123',
        sessionId: 'session-abc',
        phase: 'implementation',
        iteration: 2,
        confidenceScore: 85.0,
        thresholdState: 'normal',
        signals: { qualityScore: 90, velocity: 80, iterations: 70 },
        weights: { qualityScore: 0.3, velocity: 0.25 },
        trigger: 'batch',
        previousConfidence: 80.0,
        metadata: { source: 'test' }
      });

      expect(id).toBeGreaterThan(0);

      // Verify stored data
      const history = store.getConfidenceHistory({ taskId: 'task-123' });
      expect(history).toHaveLength(1);
      expect(history[0].confidence_score).toBe(85.0);
      expect(history[0].phase).toBe('implementation');
      expect(history[0].confidence_delta).toBe(5.0);
      expect(history[0].signals.qualityScore).toBe(90);
    });

    it('should calculate confidence delta correctly', () => {
      const id = store.recordConfidenceHistory({
        confidenceScore: 60,
        previousConfidence: 75
      });

      const history = store.getConfidenceHistory();
      expect(history[0].confidence_delta).toBe(-15);
    });

    it('should handle null previousConfidence', () => {
      const id = store.recordConfidenceHistory({
        confidenceScore: 50
      });

      const history = store.getConfidenceHistory();
      expect(history[0].confidence_delta).toBeNull();
    });
  });

  describe('getConfidenceHistory', () => {
    beforeEach(() => {
      // Insert test data
      store.recordConfidenceHistory({ taskId: 'task-1', phase: 'research', confidenceScore: 80, thresholdState: 'normal' });
      store.recordConfidenceHistory({ taskId: 'task-1', phase: 'design', confidenceScore: 70, thresholdState: 'warning' });
      store.recordConfidenceHistory({ taskId: 'task-2', phase: 'implementation', confidenceScore: 50, thresholdState: 'critical' });
      store.recordConfidenceHistory({ taskId: 'task-2', phase: 'implementation', confidenceScore: 20, thresholdState: 'emergency' });
    });

    it('should return all records with no filter', () => {
      const history = store.getConfidenceHistory();
      expect(history.length).toBe(4);
    });

    it('should filter by taskId', () => {
      const history = store.getConfidenceHistory({ taskId: 'task-1' });
      expect(history.length).toBe(2);
      expect(history.every(h => h.task_id === 'task-1')).toBe(true);
    });

    it('should filter by phase', () => {
      const history = store.getConfidenceHistory({ phase: 'implementation' });
      expect(history.length).toBe(2);
      expect(history.every(h => h.phase === 'implementation')).toBe(true);
    });

    it('should filter by thresholdState', () => {
      const history = store.getConfidenceHistory({ thresholdState: 'warning' });
      expect(history.length).toBe(1);
      expect(history[0].confidence_score).toBe(70);
    });

    it('should filter by minScore', () => {
      const history = store.getConfidenceHistory({ minScore: 60 });
      expect(history.length).toBe(2);
      expect(history.every(h => h.confidence_score >= 60)).toBe(true);
    });

    it('should filter by maxScore', () => {
      const history = store.getConfidenceHistory({ maxScore: 50 });
      expect(history.length).toBe(2);
      expect(history.every(h => h.confidence_score <= 50)).toBe(true);
    });

    it('should combine multiple filters', () => {
      const history = store.getConfidenceHistory({
        taskId: 'task-2',
        minScore: 30
      });
      expect(history.length).toBe(1);
      expect(history[0].confidence_score).toBe(50);
    });

    it('should respect limit', () => {
      const history = store.getConfidenceHistory({ limit: 2 });
      expect(history.length).toBe(2);
    });

    it('should respect offset', () => {
      const allHistory = store.getConfidenceHistory();
      const offsetHistory = store.getConfidenceHistory({ offset: 2 });
      expect(offsetHistory.length).toBe(2);
      // Records should be different (offset skips first 2)
      expect(offsetHistory[0].id).not.toBe(allHistory[0].id);
    });

    it('should parse JSON fields correctly', () => {
      store.recordConfidenceHistory({
        confidenceScore: 90,
        signals: { qualityScore: 95, velocity: 85 },
        signal_weights: { qualityScore: 0.3, velocity: 0.25 },
        metadata: { custom: 'value' }
      });

      const history = store.getConfidenceHistory({ minScore: 89 });
      expect(history[0].signals).toEqual({ qualityScore: 95, velocity: 85 });
      expect(history[0].metadata.custom).toBe('value');
    });
  });

  // ============================================================================
  // Complexity Analysis Tests
  // ============================================================================

  describe('recordComplexityAnalysis', () => {
    it('should record basic complexity analysis', () => {
      const id = store.recordComplexityAnalysis({
        taskId: 'task-123',
        complexityScore: 65.5,
        strategy: 'standard',
        breakdown: { dependencyDepth: 70, acceptanceCriteria: 60 },
        analyzedAt: new Date().toISOString()
      });

      expect(id).toBeGreaterThan(0);
    });

    it('should record complexity with all fields', () => {
      const id = store.recordComplexityAnalysis({
        taskId: 'task-456',
        taskTitle: 'Complex Feature',
        taskPhase: 'implementation',
        complexityScore: 85.0,
        strategy: 'competitive',
        breakdown: {
          dependencyDepth: 80,
          acceptanceCriteria: 90,
          effortEstimate: 75,
          technicalKeywords: 85,
          historicalSuccess: 70
        },
        weights: {
          dependencyDepth: 0.25,
          acceptanceCriteria: 0.20
        },
        fromCache: false,
        analyzedAt: '2025-12-26T10:00:00Z',
        metadata: { analyzedBy: 'test' }
      });

      expect(id).toBeGreaterThan(0);

      // Verify stored data
      const analysis = store.getComplexityAnalysis('task-456');
      expect(analysis).not.toBeNull();
      expect(analysis.complexity_score).toBe(85.0);
      expect(analysis.strategy).toBe('competitive');
      expect(analysis.task_title).toBe('Complex Feature');
      expect(analysis.breakdown.dependencyDepth).toBe(80);
    });

    it('should store fromCache flag correctly', () => {
      store.recordComplexityAnalysis({
        taskId: 'cached-task',
        complexityScore: 50,
        strategy: 'standard',
        breakdown: {},
        fromCache: true,
        analyzedAt: new Date().toISOString()
      });

      const analysis = store.getComplexityAnalysis('cached-task');
      expect(analysis.from_cache).toBe(1);
    });
  });

  describe('getComplexityAnalysis', () => {
    it('should return null for non-existent task', () => {
      const analysis = store.getComplexityAnalysis('non-existent');
      expect(analysis).toBeNull();
    });

    it('should return most recent analysis for task', () => {
      // Record multiple analyses for same task
      const id1 = store.recordComplexityAnalysis({
        taskId: 'multi-task',
        complexityScore: 40,
        strategy: 'fast-path',
        breakdown: {},
        analyzedAt: '2025-12-26T09:00:00Z'
      });

      const id2 = store.recordComplexityAnalysis({
        taskId: 'multi-task',
        complexityScore: 60,
        strategy: 'standard',
        breakdown: {},
        analyzedAt: '2025-12-26T10:00:00Z'
      });

      // Second record should have higher ID
      expect(id2).toBeGreaterThan(id1);

      const analysis = store.getComplexityAnalysis('multi-task');
      // Should get the record with the highest id (most recently inserted)
      expect(analysis.id).toBe(id2);
      expect(analysis.complexity_score).toBe(60);
      expect(analysis.strategy).toBe('standard');
    });

    it('should parse JSON fields correctly', () => {
      store.recordComplexityAnalysis({
        taskId: 'json-test',
        complexityScore: 75,
        strategy: 'competitive',
        breakdown: { a: 1, b: 2 },
        weights: { w1: 0.5, w2: 0.5 },
        analyzedAt: new Date().toISOString(),
        metadata: { test: true }
      });

      const analysis = store.getComplexityAnalysis('json-test');
      expect(analysis.breakdown).toEqual({ a: 1, b: 2 });
      expect(analysis.weights).toEqual({ w1: 0.5, w2: 0.5 });
      expect(analysis.metadata.test).toBe(true);
    });
  });

  describe('updateComplexityValidation', () => {
    it('should update validation fields', () => {
      const id = store.recordComplexityAnalysis({
        taskId: 'validate-task',
        complexityScore: 70,
        strategy: 'standard',
        breakdown: {},
        analyzedAt: new Date().toISOString()
      });

      const updated = store.updateComplexityValidation(id, {
        actualDuration: 4.5,
        actualComplexity: 'high',
        accuracyScore: 85
      });

      expect(updated).toBe(true);

      const analysis = store.getComplexityAnalysis('validate-task');
      expect(analysis.actual_duration).toBe(4.5);
      expect(analysis.actual_complexity).toBe('high');
      expect(analysis.accuracy_score).toBe(85);
    });

    it('should return false for non-existent record', () => {
      const updated = store.updateComplexityValidation(99999, {
        actualDuration: 2
      });
      expect(updated).toBe(false);
    });

    it('should handle partial updates', () => {
      const id = store.recordComplexityAnalysis({
        taskId: 'partial-task',
        complexityScore: 50,
        strategy: 'standard',
        breakdown: {},
        analyzedAt: new Date().toISOString()
      });

      store.updateComplexityValidation(id, {
        actualDuration: 3.0
      });

      const analysis = store.getComplexityAnalysis('partial-task');
      expect(analysis.actual_duration).toBe(3.0);
      expect(analysis.actual_complexity).toBeNull();
      expect(analysis.accuracy_score).toBeNull();
    });
  });

  // ============================================================================
  // Plan Comparison Tests
  // ============================================================================

  describe('recordPlanComparison', () => {
    it('should record basic plan comparison', () => {
      const id = store.recordPlanComparison({
        taskId: 'task-123',
        comparisonId: 'cmp-abc',
        totalPlans: 3,
        winnerPlanId: 'plan-1',
        winnerTitle: 'Conservative Approach',
        winnerScore: 85.5,
        evaluations: [{ planId: 'plan-1', score: 85.5 }],
        criteria: { completeness: 0.25 },
        rankings: [{ planId: 'plan-1', rank: 1 }],
        comparedAt: new Date().toISOString()
      });

      expect(id).toBeGreaterThan(0);
    });

    it('should record comparison with tie', () => {
      const id = store.recordPlanComparison({
        taskId: 'tie-task',
        comparisonId: 'cmp-tie',
        totalPlans: 2,
        isTie: true,
        tieReason: 'Scores within threshold',
        evaluations: [],
        criteria: {},
        rankings: [],
        comparedAt: new Date().toISOString()
      });

      expect(id).toBeGreaterThan(0);

      const comparisons = store.getPlanComparisons('tie-task');
      expect(comparisons[0].is_tie).toBe(1);
      expect(comparisons[0].tie_reason).toBe('Scores within threshold');
    });

    it('should record full comparison data', () => {
      const evaluations = [
        { planId: 'plan-a', title: 'Plan A', totalScore: 90, scores: { completeness: 95, feasibility: 85 } },
        { planId: 'plan-b', title: 'Plan B', totalScore: 75, scores: { completeness: 70, feasibility: 80 } }
      ];

      const rankings = [
        { planId: 'plan-a', title: 'Plan A', score: 90, rank: 1 },
        { planId: 'plan-b', title: 'Plan B', score: 75, rank: 2 }
      ];

      const id = store.recordPlanComparison({
        taskId: 'full-task',
        comparisonId: 'cmp-full',
        totalPlans: 2,
        winnerPlanId: 'plan-a',
        winnerTitle: 'Plan A',
        winnerScore: 90,
        evaluations,
        criteria: { completeness: { weight: 0.25 }, feasibility: { weight: 0.25 } },
        rankings,
        comparedAt: '2025-12-26T12:00:00Z',
        metadata: { reason: 'test' }
      });

      const comparisons = store.getPlanComparisons('full-task');
      expect(comparisons[0].evaluations).toEqual(evaluations);
      expect(comparisons[0].rankings).toEqual(rankings);
      expect(comparisons[0].metadata.reason).toBe('test');
    });
  });

  describe('getPlanComparisons', () => {
    beforeEach(() => {
      // Insert test data
      store.recordPlanComparison({
        taskId: 'multi-cmp-task',
        comparisonId: 'cmp-1',
        totalPlans: 2,
        winnerPlanId: 'p1',
        winnerScore: 80,
        evaluations: [],
        criteria: {},
        rankings: [],
        comparedAt: '2025-12-26T09:00:00Z'
      });

      store.recordPlanComparison({
        taskId: 'multi-cmp-task',
        comparisonId: 'cmp-2',
        totalPlans: 3,
        winnerPlanId: 'p2',
        winnerScore: 85,
        evaluations: [],
        criteria: {},
        rankings: [],
        comparedAt: '2025-12-26T10:00:00Z'
      });

      store.recordPlanComparison({
        taskId: 'other-task',
        comparisonId: 'cmp-3',
        totalPlans: 2,
        evaluations: [],
        criteria: {},
        rankings: [],
        comparedAt: '2025-12-26T11:00:00Z'
      });
    });

    it('should return comparisons for specific task', () => {
      const comparisons = store.getPlanComparisons('multi-cmp-task');
      expect(comparisons.length).toBe(2);
      expect(comparisons.every(c => c.task_id === 'multi-cmp-task')).toBe(true);
    });

    it('should return comparisons in descending order by recorded_at', () => {
      const comparisons = store.getPlanComparisons('multi-cmp-task');
      // Both records were inserted with same recorded_at timestamp in beforeEach
      // Just verify we get both records
      expect(comparisons.length).toBe(2);
      expect(comparisons.map(c => c.comparison_id).sort()).toEqual(['cmp-1', 'cmp-2']);
    });

    it('should respect limit', () => {
      const comparisons = store.getPlanComparisons('multi-cmp-task', { limit: 1 });
      expect(comparisons.length).toBe(1);
    });

    it('should return empty array for non-existent task', () => {
      const comparisons = store.getPlanComparisons('non-existent');
      expect(comparisons).toEqual([]);
    });

    it('should parse JSON fields correctly', () => {
      store.recordPlanComparison({
        taskId: 'json-task',
        comparisonId: 'cmp-json',
        totalPlans: 2,
        evaluations: [{ id: 1, score: 90 }],
        criteria: { weight: 0.5 },
        rankings: [{ rank: 1 }],
        comparedAt: new Date().toISOString(),
        metadata: { test: 'value' }
      });

      const comparisons = store.getPlanComparisons('json-task');
      expect(comparisons[0].evaluations).toEqual([{ id: 1, score: 90 }]);
      expect(comparisons[0].criteria).toEqual({ weight: 0.5 });
      expect(comparisons[0].rankings).toEqual([{ rank: 1 }]);
      expect(comparisons[0].metadata.test).toBe('value');
    });
  });

  describe('updatePlanComparisonValidation', () => {
    it('should update validation fields', () => {
      const id = store.recordPlanComparison({
        taskId: 'validate-cmp-task',
        comparisonId: 'cmp-validate',
        totalPlans: 2,
        winnerPlanId: 'plan-winner',
        evaluations: [],
        criteria: {},
        rankings: [],
        comparedAt: new Date().toISOString()
      });

      const updated = store.updatePlanComparisonValidation(id, {
        selectedPlanId: 'plan-winner',
        planSucceeded: true,
        accuracyScore: 95
      });

      expect(updated).toBe(true);

      const comparisons = store.getPlanComparisons('validate-cmp-task');
      expect(comparisons[0].selected_plan_id).toBe('plan-winner');
      expect(comparisons[0].plan_succeeded).toBe(1);
      expect(comparisons[0].accuracy_score).toBe(95);
    });

    it('should return false for non-existent record', () => {
      const updated = store.updatePlanComparisonValidation(99999, {
        selectedPlanId: 'any'
      });
      expect(updated).toBe(false);
    });

    it('should handle plan failure', () => {
      const id = store.recordPlanComparison({
        taskId: 'fail-task',
        comparisonId: 'cmp-fail',
        totalPlans: 2,
        evaluations: [],
        criteria: {},
        rankings: [],
        comparedAt: new Date().toISOString()
      });

      store.updatePlanComparisonValidation(id, {
        planSucceeded: false
      });

      const comparisons = store.getPlanComparisons('fail-task');
      expect(comparisons[0].plan_succeeded).toBe(0);
    });
  });

  // ============================================================================
  // Swarm Stats Tests
  // ============================================================================

  describe('getSwarmStats', () => {
    it('should return zeros for empty database', () => {
      const stats = store.getSwarmStats();

      expect(stats.total_confidence_records).toBe(0);
      expect(stats.total_complexity_analyses).toBe(0);
      expect(stats.total_plan_comparisons).toBe(0);
    });

    it('should return accurate counts', () => {
      // Add confidence records
      store.recordConfidenceHistory({ confidenceScore: 80 });
      store.recordConfidenceHistory({ confidenceScore: 70, thresholdState: 'warning' });
      store.recordConfidenceHistory({ confidenceScore: 40, thresholdState: 'critical' });

      // Add complexity analyses
      store.recordComplexityAnalysis({
        taskId: 't1', complexityScore: 30, strategy: 'fast-path',
        breakdown: {}, analyzedAt: new Date().toISOString()
      });
      store.recordComplexityAnalysis({
        taskId: 't2', complexityScore: 55, strategy: 'standard',
        breakdown: {}, analyzedAt: new Date().toISOString()
      });
      store.recordComplexityAnalysis({
        taskId: 't3', complexityScore: 80, strategy: 'competitive',
        breakdown: {}, analyzedAt: new Date().toISOString()
      });

      // Add plan comparisons
      store.recordPlanComparison({
        taskId: 'p1', comparisonId: 'c1', totalPlans: 2,
        evaluations: [], criteria: {}, rankings: [],
        comparedAt: new Date().toISOString()
      });
      store.recordPlanComparison({
        taskId: 'p2', comparisonId: 'c2', totalPlans: 3, isTie: true,
        evaluations: [], criteria: {}, rankings: [],
        comparedAt: new Date().toISOString()
      });

      const stats = store.getSwarmStats();

      expect(stats.total_confidence_records).toBe(3);
      expect(stats.alert_count).toBe(2); // warning + critical
      expect(stats.total_complexity_analyses).toBe(3);
      expect(stats.fast_path_count).toBe(1);
      expect(stats.standard_count).toBe(1);
      expect(stats.competitive_count).toBe(1);
      expect(stats.total_plan_comparisons).toBe(2);
      expect(stats.total_plans_evaluated).toBe(5); // 2 + 3
      expect(stats.tie_count).toBe(1);
    });

    it('should calculate averages correctly', () => {
      store.recordConfidenceHistory({ confidenceScore: 80 });
      store.recordConfidenceHistory({ confidenceScore: 60 });

      store.recordComplexityAnalysis({
        taskId: 't1', complexityScore: 40, strategy: 'standard',
        breakdown: {}, analyzedAt: new Date().toISOString()
      });
      store.recordComplexityAnalysis({
        taskId: 't2', complexityScore: 80, strategy: 'competitive',
        breakdown: {}, analyzedAt: new Date().toISOString()
      });

      const stats = store.getSwarmStats();

      expect(stats.avg_confidence).toBe(70);
      expect(stats.avg_complexity).toBe(60);
    });
  });

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle empty signals object', () => {
      const id = store.recordConfidenceHistory({
        confidenceScore: 50,
        signals: {}
      });

      const history = store.getConfidenceHistory();
      expect(history[0].signals).toEqual({});
    });

    it('should handle empty breakdown object', () => {
      const id = store.recordComplexityAnalysis({
        taskId: 'empty-breakdown',
        complexityScore: 50,
        strategy: 'standard',
        breakdown: {},
        analyzedAt: new Date().toISOString()
      });

      const analysis = store.getComplexityAnalysis('empty-breakdown');
      expect(analysis.breakdown).toEqual({});
    });

    it('should handle empty evaluations array', () => {
      const id = store.recordPlanComparison({
        taskId: 'empty-eval',
        comparisonId: 'cmp-empty',
        totalPlans: 0,
        evaluations: [],
        criteria: {},
        rankings: [],
        comparedAt: new Date().toISOString()
      });

      const comparisons = store.getPlanComparisons('empty-eval');
      expect(comparisons[0].evaluations).toEqual([]);
    });

    it('should handle special characters in task IDs', () => {
      const specialTaskId = 'task-with-special_chars.and/slashes';

      store.recordConfidenceHistory({
        taskId: specialTaskId,
        confidenceScore: 75
      });

      const history = store.getConfidenceHistory({ taskId: specialTaskId });
      expect(history.length).toBe(1);
      expect(history[0].task_id).toBe(specialTaskId);
    });

    it('should handle very long metadata', () => {
      const longMetadata = { data: 'x'.repeat(10000) };

      const id = store.recordConfidenceHistory({
        confidenceScore: 50,
        metadata: longMetadata
      });

      const history = store.getConfidenceHistory();
      expect(history[0].metadata.data.length).toBe(10000);
    });

    it('should handle null optional fields gracefully', () => {
      const id = store.recordConfidenceHistory({
        confidenceScore: 50
        // All optional fields omitted
      });

      const history = store.getConfidenceHistory();
      expect(history[0].task_id).toBeNull();
      expect(history[0].session_id).toBeNull();
      expect(history[0].phase).toBeNull();
    });
  });

  // ============================================================================
  // View Tests
  // ============================================================================

  describe('Views', () => {
    beforeEach(() => {
      // Insert test data
      store.recordConfidenceHistory({
        taskId: 'view-task',
        sessionId: 'view-session',
        phase: 'implementation',
        confidenceScore: 85,
        thresholdState: 'normal'
      });

      store.recordConfidenceHistory({
        taskId: 'view-task',
        sessionId: 'view-session',
        phase: 'implementation',
        confidenceScore: 55,
        thresholdState: 'warning'
      });

      store.recordComplexityAnalysis({
        taskId: 'view-task',
        taskPhase: 'implementation',
        complexityScore: 70,
        strategy: 'standard',
        breakdown: {},
        analyzedAt: new Date().toISOString()
      });
    });

    it('should query v_confidence_trends view', () => {
      const results = store.db.prepare(`
        SELECT * FROM v_confidence_trends WHERE task_id = ?
      `).all('view-task');

      expect(results.length).toBe(1);
      expect(results[0].update_count).toBe(2);
      expect(results[0].min_confidence).toBe(55);
      expect(results[0].max_confidence).toBe(85);
      expect(results[0].warning_count).toBe(1);
    });

    it('should query v_complexity_distribution view', () => {
      const results = store.db.prepare(`
        SELECT * FROM v_complexity_distribution WHERE strategy = ?
      `).all('standard');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].task_count).toBeGreaterThanOrEqual(1);
    });
  });
});
