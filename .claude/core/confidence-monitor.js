/**
 * ConfidenceMonitor - Tracks execution confidence using weighted signals
 *
 * Provides real-time confidence scoring with threshold alerts.
 *
 * @module ConfidenceMonitor
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const DEFAULT_SIGNAL_WEIGHTS = {
  qualityScore: 0.30, velocity: 0.25, iterations: 0.20, errorRate: 0.15, historical: 0.10
};

const DEFAULT_THRESHOLDS = { warning: 60, critical: 40, emergency: 25 };

class ConfidenceMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.weights = { ...DEFAULT_SIGNAL_WEIGHTS, ...options.weights };
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
    this.qualityScoresPath = options.qualityScoresPath || path.join(__dirname, '..', 'dev-docs', 'quality-scores.json');
    this.memoryStore = options.memoryStore || null;
    this.maxIterations = options.maxIterations || 5;
    this.signals = { qualityScore: null, velocity: null, iterations: null, errorRate: null, historical: null };
    this.lastConfidence = null;
    this.lastThresholdState = 'normal';
    this.updateHistory = [];
    this.errorCount = 0;
    this.taskCount = 0;
    this.completedTasks = 0;
    this.estimatedTasks = 0;
    this.currentIteration = 0;
    this._normalizeWeights();
  }

  _normalizeWeights() {
    const sum = Object.values(this.weights).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1.0) > 0.001) {
      for (const key of Object.keys(this.weights)) this.weights[key] = this.weights[key] / sum;
    }
  }

  update(signal, value) {
    if (!(signal in this.signals)) throw new Error(`Invalid signal: ${signal}`);
    if (typeof value !== 'number' || isNaN(value)) throw new Error(`Signal value must be a number`);
    this.signals[signal] = value;
    this.updateHistory.push({ signal, value, timestamp: Date.now() });
    if (this.updateHistory.length > 100) this.updateHistory = this.updateHistory.slice(-100);
    const confidence = this.calculate();
    this._checkThresholds(confidence);
    return this;
  }

  updateBatch(updates) {
    for (const [signal, value] of Object.entries(updates)) {
      if (signal in this.signals) {
        this.signals[signal] = value;
        this.updateHistory.push({ signal, value, timestamp: Date.now() });
      }
    }
    if (this.updateHistory.length > 100) this.updateHistory = this.updateHistory.slice(-100);
    const confidence = this.calculate();
    this._checkThresholds(confidence);
    return this;
  }

  _normalizeSignal(signal, value) {
    if (value === null || value === undefined) return null;
    switch (signal) {
      case 'qualityScore': return Math.max(0, Math.min(100, value));
      case 'velocity':
        if (this.estimatedTasks > 0) return Math.max(0, Math.min(100, (this.completedTasks / this.estimatedTasks) * 100));
        return Math.max(0, Math.min(100, value));
      case 'iterations':
        if (value <= 0) return 100;
        if (value >= this.maxIterations) return 0;
        return Math.max(0, ((this.maxIterations - value) / this.maxIterations) * 100);
      case 'errorRate':
        if (value <= 0) return 100;
        if (value >= 10) return 0;
        return Math.max(0, (1 - (value / 10)) * 100);
      case 'historical': return Math.max(0, Math.min(100, value));
      default: return Math.max(0, Math.min(100, value));
    }
  }

  calculate() {
    let totalWeight = 0, weightedSum = 0;
    for (const [signal, weight] of Object.entries(this.weights)) {
      const normalized = this._normalizeSignal(signal, this.signals[signal]);
      if (normalized !== null) { weightedSum += normalized * weight; totalWeight += weight; }
    }
    if (totalWeight === 0) return 50;
    const confidence = Math.round((weightedSum / totalWeight) * 100) / 100;
    this.lastConfidence = Math.max(0, Math.min(100, confidence));
    this.emit('confidence:updated', { confidence: this.lastConfidence, signals: this.getBreakdown(), timestamp: Date.now() });
    return this.lastConfidence;
  }

  getBreakdown() {
    const breakdown = {};
    for (const [signal, weight] of Object.entries(this.weights)) {
      const raw = this.signals[signal];
      const normalized = this._normalizeSignal(signal, raw);
      breakdown[signal] = { raw, normalized, weight, contribution: normalized !== null ? Math.round(normalized * weight * 100) / 100 : null };
    }
    return breakdown;
  }

  setThreshold(level, value) {
    if (!(level in this.thresholds)) throw new Error(`Invalid threshold level: ${level}`);
    if (typeof value !== 'number' || value < 0 || value > 100) throw new Error(`Threshold must be 0-100`);
    this.thresholds[level] = value;
    return this;
  }

  getThresholds() { return { ...this.thresholds }; }

  _checkThresholds(confidence) {
    let currentState = 'normal';
    if (confidence <= this.thresholds.emergency) currentState = 'emergency';
    else if (confidence <= this.thresholds.critical) currentState = 'critical';
    else if (confidence <= this.thresholds.warning) currentState = 'warning';

    const order = ['normal', 'warning', 'critical', 'emergency'];
    const prev = order.indexOf(this.lastThresholdState);
    const curr = order.indexOf(currentState);

    if (curr > prev) {
      this.emit(`confidence:${currentState}`, { confidence, threshold: this.thresholds[currentState], previousState: this.lastThresholdState, timestamp: Date.now() });
    } else if (curr < prev && currentState === 'normal') {
      this.emit('confidence:recovered', { confidence, threshold: this.thresholds.warning, previousState: this.lastThresholdState, timestamp: Date.now() });
    }
    this.lastThresholdState = currentState;
  }

  getThresholdState() { return this.lastThresholdState; }

  reset() {
    this.signals = { qualityScore: null, velocity: null, iterations: null, errorRate: null, historical: null };
    this.lastConfidence = null; this.lastThresholdState = 'normal'; this.updateHistory = [];
    this.errorCount = 0; this.taskCount = 0; this.completedTasks = 0; this.estimatedTasks = 0; this.currentIteration = 0;
    this.emit('confidence:reset', { timestamp: Date.now() });
    return this;
  }

  async loadQualityScore() {
    try {
      if (fs.existsSync(this.qualityScoresPath)) {
        const data = JSON.parse(await fs.promises.readFile(this.qualityScoresPath, 'utf-8'));
        const score = data.overall || data.current || (Array.isArray(data) && data.length > 0 ? data[data.length - 1].score : null);
        if (score) { this.update('qualityScore', score); return score; }
      }
    } catch (e) { /* silent */ }
    return null;
  }

  async loadHistoricalRate(taskType = null) {
    if (!this.memoryStore) return null;
    try {
      const query = taskType ? { type: 'execution', taskType } : { type: 'execution' };
      const results = await this.memoryStore.query(query);
      if (results && results.length > 0) {
        const rate = (results.filter(r => r.success).length / results.length) * 100;
        this.update('historical', rate);
        return rate;
      }
    } catch (e) { /* silent */ }
    return null;
  }

  trackProgress(completed, estimated) {
    this.completedTasks = completed; this.estimatedTasks = estimated;
    if (estimated > 0) this.update('velocity', (completed / estimated) * 100);
    return this;
  }

  trackIteration(current, max = null) {
    this.currentIteration = current;
    if (max !== null) this.maxIterations = max;
    this.update('iterations', current);
    return this;
  }

  trackError(count = 1) { this.errorCount += count; this.update('errorRate', this.errorCount); return this; }
  resetErrors() { this.errorCount = 0; this.update('errorRate', 0); return this; }

  getState() {
    return {
      confidence: this.lastConfidence, thresholdState: this.lastThresholdState,
      signals: { ...this.signals }, breakdown: this.getBreakdown(), thresholds: { ...this.thresholds },
      tracking: { errorCount: this.errorCount, completedTasks: this.completedTasks, estimatedTasks: this.estimatedTasks, currentIteration: this.currentIteration, maxIterations: this.maxIterations },
      updateCount: this.updateHistory.length, lastUpdate: this.updateHistory.length > 0 ? this.updateHistory[this.updateHistory.length - 1].timestamp : null
    };
  }

  getHistory(limit = 10) { return this.updateHistory.slice(-limit); }

  snapshot() {
    return {
      signals: { ...this.signals }, thresholds: { ...this.thresholds }, weights: { ...this.weights },
      lastConfidence: this.lastConfidence, lastThresholdState: this.lastThresholdState,
      tracking: { errorCount: this.errorCount, completedTasks: this.completedTasks, estimatedTasks: this.estimatedTasks, currentIteration: this.currentIteration, maxIterations: this.maxIterations },
      timestamp: Date.now()
    };
  }

  restore(snapshot) {
    if (snapshot.signals) this.signals = { ...snapshot.signals };
    if (snapshot.thresholds) this.thresholds = { ...snapshot.thresholds };
    if (snapshot.weights) { this.weights = { ...snapshot.weights }; this._normalizeWeights(); }
    if (snapshot.lastConfidence !== undefined) this.lastConfidence = snapshot.lastConfidence;
    if (snapshot.lastThresholdState) this.lastThresholdState = snapshot.lastThresholdState;
    if (snapshot.tracking) {
      this.errorCount = snapshot.tracking.errorCount || 0;
      this.completedTasks = snapshot.tracking.completedTasks || 0;
      this.estimatedTasks = snapshot.tracking.estimatedTasks || 0;
      this.currentIteration = snapshot.tracking.currentIteration || 0;
      this.maxIterations = snapshot.tracking.maxIterations || 5;
    }
    this.emit('confidence:restored', { snapshot, timestamp: Date.now() });
    return this;
  }
}

module.exports = ConfidenceMonitor;
