/**
 * Predictive Analytics Module
 *
 * Provides ML-based predictions for:
 * - Token usage forecasting per project
 * - Context exhaustion timing predictions
 * - Cost optimization recommendations
 * - Session pattern analysis
 *
 * Uses simple statistical models that work without ML libraries:
 * - Linear regression for trend prediction
 * - Exponential smoothing for forecasting
 * - Moving averages for pattern detection
 *
 * @module predictive-analytics
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class PredictiveAnalytics extends EventEmitter {
  /**
   * Create a Predictive Analytics instance
   *
   * @param {Object} options - Configuration
   * @param {Object} [options.globalTracker] - GlobalContextTracker instance
   * @param {Object} [options.memoryStore] - MemoryStore instance
   * @param {number} [options.historyWindow=20] - Number of data points for analysis
   * @param {number} [options.predictionHorizon=10] - Minutes to predict ahead
   */
  constructor(options = {}) {
    super();

    this.globalTracker = options.globalTracker;
    this.memoryStore = options.memoryStore;
    this.historyWindow = options.historyWindow || 20;
    this.predictionHorizon = options.predictionHorizon || 10;

    // Per-project time series data
    this.projectHistory = new Map();

    // Prediction cache
    this.predictions = new Map();

    // Pattern cache
    this.patterns = new Map();

    // Cost tracking
    this.costHistory = [];

    // Bind to global tracker if provided
    if (this.globalTracker) {
      this._bindToTracker();
    }
  }

  /**
   * Bind to GlobalContextTracker events
   * @private
   */
  _bindToTracker() {
    this.globalTracker.on('update', (data) => {
      this._recordDataPoint(data);
      this._updatePredictions();
    });
  }

  /**
   * Record a data point for a project
   * @private
   */
  _recordDataPoint(data) {
    if (!data.projects) return;

    const timestamp = Date.now();

    for (const project of data.projects) {
      const projectId = project.folder || project.name;

      if (!this.projectHistory.has(projectId)) {
        this.projectHistory.set(projectId, []);
      }

      const history = this.projectHistory.get(projectId);

      history.push({
        timestamp,
        contextPercent: project.metrics?.contextPercent || 0,
        contextUsed: project.metrics?.contextUsed || 0,
        cost: project.metrics?.cost || 0,
        messageCount: project.metrics?.messageCount || 0,
        model: project.metrics?.model,
      });

      // Keep only recent history
      while (history.length > this.historyWindow * 2) {
        history.shift();
      }
    }

    // Track total cost
    this.costHistory.push({
      timestamp,
      totalCost: data.accountTotals?.totalCost || 0,
    });

    while (this.costHistory.length > this.historyWindow * 2) {
      this.costHistory.shift();
    }
  }

  /**
   * Update predictions for all projects
   * @private
   */
  _updatePredictions() {
    for (const [projectId, history] of this.projectHistory) {
      if (history.length < 3) continue; // Need at least 3 points

      const prediction = this._predictContextExhaustion(history);
      this.predictions.set(projectId, prediction);

      // Emit if context exhaustion is imminent
      if (prediction.minutesToExhaustion < 5 && prediction.confidence > 0.7) {
        this.emit('exhaustion-warning', {
          projectId,
          ...prediction,
        });
      }
    }
  }

  /**
   * Predict context exhaustion using linear regression
   * @private
   */
  _predictContextExhaustion(history) {
    const recentHistory = history.slice(-this.historyWindow);

    if (recentHistory.length < 3) {
      return {
        minutesToExhaustion: Infinity,
        confidence: 0,
        trend: 'unknown',
        predictedPercent: recentHistory[recentHistory.length - 1]?.contextPercent || 0,
      };
    }

    // Extract context percentages
    const percentages = recentHistory.map(h => h.contextPercent);
    const timestamps = recentHistory.map(h => h.timestamp);

    // Current value
    const currentPercent = percentages[percentages.length - 1];

    // If already at or above threshold, return 0
    if (currentPercent >= 75) {
      return {
        minutesToExhaustion: 0,
        confidence: 1.0,
        trend: 'critical',
        predictedPercent: currentPercent,
        currentPercent,
      };
    }

    // Calculate velocity (change per minute)
    const { slope, intercept, rSquared } = this._linearRegression(
      timestamps.map(t => (t - timestamps[0]) / 60000), // Convert to minutes
      percentages
    );

    // Determine trend
    let trend = 'stable';
    if (slope > 0.5) trend = 'rising-fast';
    else if (slope > 0.1) trend = 'rising';
    else if (slope < -0.1) trend = 'falling';

    // Calculate minutes to 75% (emergency threshold)
    const targetPercent = 75;
    let minutesToExhaustion = Infinity;

    if (slope > 0) {
      const currentTime = (timestamps[timestamps.length - 1] - timestamps[0]) / 60000;
      // Solve for t: slope * t + intercept = targetPercent
      const targetTime = (targetPercent - intercept) / slope;
      minutesToExhaustion = Math.max(0, targetTime - currentTime);
    }

    // Predict value at horizon
    const currentTime = (timestamps[timestamps.length - 1] - timestamps[0]) / 60000;
    const predictedPercent = Math.min(100, Math.max(0,
      slope * (currentTime + this.predictionHorizon) + intercept
    ));

    return {
      minutesToExhaustion: Math.round(minutesToExhaustion * 10) / 10,
      confidence: Math.min(1, rSquared),
      trend,
      slope: Math.round(slope * 100) / 100, // % per minute
      predictedPercent: Math.round(predictedPercent * 10) / 10,
      currentPercent,
    };
  }

  /**
   * Simple linear regression
   * @private
   */
  _linearRegression(x, y) {
    const n = x.length;

    if (n === 0) return { slope: 0, intercept: 0, rSquared: 0 };

    // Calculate means
    const xMean = x.reduce((a, b) => a + b, 0) / n;
    const yMean = y.reduce((a, b) => a + b, 0) / n;

    // Calculate slope and intercept
    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      numerator += (x[i] - xMean) * (y[i] - yMean);
      denominator += (x[i] - xMean) ** 2;
    }

    const slope = denominator !== 0 ? numerator / denominator : 0;
    const intercept = yMean - slope * xMean;

    // Calculate R-squared
    let ssRes = 0;
    let ssTot = 0;

    for (let i = 0; i < n; i++) {
      const predicted = slope * x[i] + intercept;
      ssRes += (y[i] - predicted) ** 2;
      ssTot += (y[i] - yMean) ** 2;
    }

    const rSquared = ssTot !== 0 ? 1 - (ssRes / ssTot) : 0;

    return { slope, intercept, rSquared: Math.max(0, rSquared) };
  }

  /**
   * Get prediction for a specific project
   * @param {string} projectId - Project identifier
   * @returns {Object} Prediction data
   */
  getPrediction(projectId) {
    return this.predictions.get(projectId) || {
      minutesToExhaustion: Infinity,
      confidence: 0,
      trend: 'unknown',
    };
  }

  /**
   * Get all predictions
   * @returns {Object} Map of projectId -> prediction
   */
  getAllPredictions() {
    const result = {};
    for (const [projectId, prediction] of this.predictions) {
      result[projectId] = prediction;
    }
    return result;
  }

  /**
   * Analyze session patterns for a project
   * @param {string} projectId - Project identifier
   * @returns {Object} Pattern analysis
   */
  analyzePatterns(projectId) {
    const history = this.projectHistory.get(projectId);

    if (!history || history.length < 5) {
      return {
        patterns: [],
        averageSessionLength: 0,
        averageTokensPerMessage: 0,
        peakUsageHours: [],
      };
    }

    // Calculate message frequency
    const messageCounts = history.map(h => h.messageCount);
    const tokens = history.map(h => h.contextUsed);

    // Average tokens per message
    const totalMessages = messageCounts[messageCounts.length - 1] - messageCounts[0];
    const totalTokens = tokens[tokens.length - 1] - tokens[0];
    const avgTokensPerMessage = totalMessages > 0 ? totalTokens / totalMessages : 0;

    // Session duration estimate
    const sessionDuration = (history[history.length - 1].timestamp - history[0].timestamp) / 60000;

    // Detect patterns
    const patterns = [];

    // Check for burst pattern (rapid token growth)
    const recentSlope = this._linearRegression(
      history.slice(-5).map((_, i) => i),
      history.slice(-5).map(h => h.contextPercent)
    ).slope;

    if (recentSlope > 1) {
      patterns.push({
        type: 'burst',
        description: 'Rapid context consumption detected',
        severity: 'high',
        recommendation: 'Consider breaking work into smaller sessions',
      });
    }

    // Check for steady pattern
    if (Math.abs(recentSlope) < 0.1 && history[history.length - 1].contextPercent > 30) {
      patterns.push({
        type: 'steady',
        description: 'Stable context usage pattern',
        severity: 'low',
        recommendation: 'Current pace is sustainable',
      });
    }

    // Check for idle pattern (no growth)
    if (recentSlope === 0 && history[history.length - 1].contextPercent < 10) {
      patterns.push({
        type: 'idle',
        description: 'Session appears idle',
        severity: 'info',
        recommendation: 'No action needed',
      });
    }

    return {
      patterns,
      averageSessionLength: Math.round(sessionDuration),
      averageTokensPerMessage: Math.round(avgTokensPerMessage),
      peakUsageHours: this._findPeakHours(history),
    };
  }

  /**
   * Find peak usage hours
   * @private
   */
  _findPeakHours(history) {
    const hourCounts = new Array(24).fill(0);

    for (const entry of history) {
      const hour = new Date(entry.timestamp).getHours();
      hourCounts[hour]++;
    }

    // Find top 3 hours
    const hours = hourCounts
      .map((count, hour) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .filter(h => h.count > 0)
      .map(h => h.hour);

    return hours;
  }

  /**
   * Get cost optimization recommendations
   * @returns {Array} List of recommendations
   */
  getCostRecommendations() {
    const recommendations = [];

    // Analyze recent cost velocity
    if (this.costHistory.length >= 2) {
      const recentCosts = this.costHistory.slice(-10);
      const oldestCost = recentCosts[0].totalCost;
      const newestCost = recentCosts[recentCosts.length - 1].totalCost;
      const duration = (recentCosts[recentCosts.length - 1].timestamp - recentCosts[0].timestamp) / 3600000; // hours

      const costPerHour = duration > 0 ? (newestCost - oldestCost) / duration : 0;

      if (costPerHour > 5) {
        recommendations.push({
          type: 'high-spend',
          priority: 'high',
          title: 'High spending rate detected',
          description: `Current rate: $${costPerHour.toFixed(2)}/hour`,
          actions: [
            'Consider using Sonnet for routine tasks',
            'Batch similar operations to reduce API calls',
            'Use caching more aggressively',
          ],
        });
      }
    }

    // Check for projects with high cache miss rates
    for (const [projectId, history] of this.projectHistory) {
      if (history.length < 2) continue;

      const recent = history[history.length - 1];
      // High context usage might indicate cache misses
      if (recent.contextPercent > 50) {
        recommendations.push({
          type: 'cache-opportunity',
          priority: 'medium',
          title: `Cache optimization for ${projectId}`,
          description: 'High context usage may indicate cache misses',
          actions: [
            'Review prompt structure for better caching',
            'Consider context window management',
          ],
        });
      }
    }

    // Model recommendations
    for (const [projectId, history] of this.projectHistory) {
      if (history.length < 1) continue;

      const recent = history[history.length - 1];
      if (recent.model === 'claude-opus-4-5-20251101') {
        recommendations.push({
          type: 'model-suggestion',
          priority: 'low',
          title: `Consider Sonnet for ${projectId}`,
          description: 'Opus is 5x more expensive than Sonnet',
          actions: [
            'Use Sonnet for code generation and simple tasks',
            'Reserve Opus for complex reasoning and research',
          ],
        });
      }
    }

    return recommendations;
  }

  /**
   * Get comprehensive analytics summary
   * @returns {Object} Complete analytics data
   */
  getSummary() {
    const predictions = this.getAllPredictions();
    const recommendations = this.getCostRecommendations();

    // Find project with soonest exhaustion
    let soonestExhaustion = { projectId: null, minutes: Infinity };
    for (const [projectId, pred] of Object.entries(predictions)) {
      if (pred.minutesToExhaustion < soonestExhaustion.minutes) {
        soonestExhaustion = { projectId, minutes: pred.minutesToExhaustion };
      }
    }

    // Calculate total cost velocity
    let costVelocity = 0;
    if (this.costHistory.length >= 2) {
      const first = this.costHistory[0];
      const last = this.costHistory[this.costHistory.length - 1];
      const hours = (last.timestamp - first.timestamp) / 3600000;
      costVelocity = hours > 0 ? (last.totalCost - first.totalCost) / hours : 0;
    }

    return {
      timestamp: Date.now(),
      projects: Object.keys(predictions).length,
      predictions,
      soonestExhaustion,
      costVelocity: Math.round(costVelocity * 100) / 100,
      recommendations: recommendations.slice(0, 5), // Top 5
      totalCost: this.costHistory.length > 0
        ? this.costHistory[this.costHistory.length - 1].totalCost
        : 0,
    };
  }

  /**
   * Add a data point manually (for testing or external data)
   * @param {string} projectId - Project identifier
   * @param {Object} data - Data point
   */
  addDataPoint(projectId, data) {
    if (!this.projectHistory.has(projectId)) {
      this.projectHistory.set(projectId, []);
    }

    this.projectHistory.get(projectId).push({
      timestamp: data.timestamp || Date.now(),
      contextPercent: data.contextPercent || 0,
      contextUsed: data.contextUsed || 0,
      cost: data.cost || 0,
      messageCount: data.messageCount || 0,
      model: data.model,
    });

    this._updatePredictions();
  }
}

module.exports = PredictiveAnalytics;
