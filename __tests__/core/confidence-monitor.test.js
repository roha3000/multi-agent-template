/**
 * ConfidenceMonitor Test Suite
 */
const ConfidenceMonitor = require('../../.claude/core/confidence-monitor');

describe('ConfidenceMonitor', () => {
  let monitor;

  beforeEach(() => { monitor = new ConfidenceMonitor(); });
  afterEach(() => { monitor.removeAllListeners(); });

  describe('Signal Updates', () => {
    test('updates qualityScore signal', () => {
      monitor.update('qualityScore', 85);
      expect(monitor.signals.qualityScore).toBe(85);
    });

    test('updates velocity signal', () => {
      monitor.update('velocity', 75);
      expect(monitor.signals.velocity).toBe(75);
    });

    test('updates iterations signal', () => {
      monitor.update('iterations', 2);
      expect(monitor.signals.iterations).toBe(2);
    });

    test('updates errorRate signal', () => {
      monitor.update('errorRate', 3);
      expect(monitor.signals.errorRate).toBe(3);
    });

    test('throws error for invalid signal', () => {
      expect(() => monitor.update('invalidSignal', 50)).toThrow('Invalid signal');
    });

    test('throws error for non-numeric value', () => {
      expect(() => monitor.update('qualityScore', 'high')).toThrow('must be a number');
    });

    test('supports method chaining', () => {
      const result = monitor.update('qualityScore', 80);
      expect(result).toBe(monitor);
    });
  });

  describe('Batch Updates', () => {
    test('updates multiple signals', () => {
      monitor.updateBatch({ qualityScore: 85, velocity: 70, iterations: 1 });
      expect(monitor.signals.qualityScore).toBe(85);
      expect(monitor.signals.velocity).toBe(70);
      expect(monitor.signals.iterations).toBe(1);
    });

    test('ignores invalid signals', () => {
      monitor.updateBatch({ qualityScore: 85, invalidSignal: 50 });
      expect(monitor.signals.qualityScore).toBe(85);
    });
  });

  describe('Confidence Calculation', () => {
    test('returns 50 when no signals set', () => {
      expect(monitor.calculate()).toBe(50);
    });

    test('calculates with all signals at 100', () => {
      monitor.updateBatch({ qualityScore: 100, velocity: 100, iterations: 0, errorRate: 0, historical: 100 });
      expect(monitor.calculate()).toBe(100);
    });

    test('calculates with partial signals', () => {
      monitor.update('qualityScore', 80);
      expect(monitor.calculate()).toBe(80);
    });

    test('caps at 100', () => {
      monitor.updateBatch({ qualityScore: 150, velocity: 120, iterations: -5, errorRate: -10, historical: 200 });
      expect(monitor.calculate()).toBeLessThanOrEqual(100);
    });

    test('floors at 0', () => {
      monitor.updateBatch({ qualityScore: 0, velocity: 0, iterations: 100, errorRate: 100, historical: 0 });
      expect(monitor.calculate()).toBeGreaterThanOrEqual(0);
    });

    test('normalizes iteration score (0 iterations = 100)', () => {
      monitor.update('iterations', 0);
      const breakdown = monitor.getBreakdown();
      expect(breakdown.iterations.normalized).toBe(100);
    });

    test('normalizes error rate (0 errors = 100)', () => {
      monitor.update('errorRate', 0);
      const breakdown = monitor.getBreakdown();
      expect(breakdown.errorRate.normalized).toBe(100);
    });
  });

  describe('Breakdown', () => {
    test('provides detailed breakdown', () => {
      monitor.update('qualityScore', 80);
      const breakdown = monitor.getBreakdown();
      expect(breakdown.qualityScore).toEqual({ raw: 80, normalized: 80, weight: 0.30, contribution: 24 });
    });

    test('shows null for unset signals', () => {
      const breakdown = monitor.getBreakdown();
      expect(breakdown.qualityScore.raw).toBeNull();
    });
  });

  describe('Threshold Alerts', () => {
    test('has default thresholds', () => {
      const t = monitor.getThresholds();
      expect(t.warning).toBe(60);
      expect(t.critical).toBe(40);
      expect(t.emergency).toBe(25);
    });

    test('allows custom thresholds', () => {
      monitor.setThreshold('warning', 70);
      expect(monitor.getThresholds().warning).toBe(70);
    });

    test('throws for invalid level', () => {
      expect(() => monitor.setThreshold('invalid', 50)).toThrow('Invalid threshold');
    });

    test('tracks state as normal initially', () => {
      expect(monitor.getThresholdState()).toBe('normal');
    });

    test('detects warning state', () => {
      monitor.update('qualityScore', 55);
      expect(monitor.getThresholdState()).toBe('warning');
    });

    test('detects critical state', () => {
      monitor.update('qualityScore', 35);
      expect(monitor.getThresholdState()).toBe('critical');
    });

    test('detects emergency state', () => {
      monitor.update('qualityScore', 20);
      expect(monitor.getThresholdState()).toBe('emergency');
    });
  });

  describe('Event Emission', () => {
    test('emits confidence:updated', (done) => {
      monitor.on('confidence:updated', (data) => {
        expect(data.confidence).toBeDefined();
        done();
      });
      monitor.update('qualityScore', 80);
    });

    test('emits confidence:warning', (done) => {
      monitor.on('confidence:warning', (data) => {
        expect(data.confidence).toBeLessThanOrEqual(60);
        done();
      });
      monitor.update('qualityScore', 55);
    });

    test('emits confidence:recovered', (done) => {
      monitor.update('qualityScore', 55);
      monitor.on('confidence:recovered', (data) => {
        expect(data.confidence).toBeGreaterThan(60);
        done();
      });
      monitor.update('qualityScore', 80);
    });

    test('emits confidence:reset', (done) => {
      monitor.on('confidence:reset', () => done());
      monitor.reset();
    });
  });

  describe('Reset Behavior', () => {
    test('clears all signals', () => {
      monitor.updateBatch({ qualityScore: 80, velocity: 70 });
      monitor.reset();
      expect(monitor.signals.qualityScore).toBeNull();
      expect(monitor.signals.velocity).toBeNull();
    });

    test('resets confidence', () => {
      monitor.update('qualityScore', 80);
      monitor.reset();
      expect(monitor.lastConfidence).toBeNull();
    });

    test('resets threshold state', () => {
      monitor.update('qualityScore', 35);
      monitor.reset();
      expect(monitor.getThresholdState()).toBe('normal');
    });
  });

  describe('Tracking Helpers', () => {
    test('trackProgress updates velocity', () => {
      monitor.trackProgress(5, 10);
      expect(monitor.signals.velocity).toBe(50);
    });

    test('trackIteration updates iterations', () => {
      monitor.trackIteration(3);
      expect(monitor.signals.iterations).toBe(3);
    });

    test('trackError accumulates', () => {
      monitor.trackError();
      monitor.trackError(2);
      expect(monitor.errorCount).toBe(3);
    });

    test('resetErrors clears', () => {
      monitor.trackError(5);
      monitor.resetErrors();
      expect(monitor.errorCount).toBe(0);
    });
  });

  describe('State Management', () => {
    test('returns complete state', () => {
      monitor.update('qualityScore', 80);
      const state = monitor.getState();
      expect(state.confidence).toBeDefined();
      expect(state.thresholdState).toBe('normal');
    });

    test('creates snapshot', () => {
      monitor.update('qualityScore', 80);
      const snapshot = monitor.snapshot();
      expect(snapshot.signals.qualityScore).toBe(80);
      expect(snapshot.timestamp).toBeDefined();
    });

    test('restores from snapshot', () => {
      const snapshot = { signals: { qualityScore: 90 }, thresholds: { warning: 65, critical: 45, emergency: 30 } };
      monitor.restore(snapshot);
      expect(monitor.signals.qualityScore).toBe(90);
      expect(monitor.thresholds.warning).toBe(65);
    });
  });

  describe('Edge Cases', () => {
    test('handles zero values', () => {
      monitor.updateBatch({ qualityScore: 0, velocity: 0, iterations: 0, errorRate: 0, historical: 0 });
      const confidence = monitor.calculate();
      expect(confidence).toBeGreaterThanOrEqual(0);
    });

    test('handles negative values', () => {
      monitor.update('qualityScore', -50);
      expect(monitor.getBreakdown().qualityScore.normalized).toBe(0);
    });

    test('handles values over 100', () => {
      monitor.update('qualityScore', 150);
      expect(monitor.getBreakdown().qualityScore.normalized).toBe(100);
    });

    test('limits history to 100', () => {
      for (let i = 0; i < 150; i++) monitor.update('qualityScore', i);
      expect(monitor.updateHistory.length).toBe(100);
    });
  });
});
