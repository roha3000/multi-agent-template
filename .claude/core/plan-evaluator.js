/**
 * PlanEvaluator - Scores and compares competing implementation plans
 *
 * Provides heuristic-based scoring for implementation plans
 * against configurable criteria.
 *
 * @module PlanEvaluator
 */

const EventEmitter = require('events');

const DEFAULT_CRITERIA = {
  completeness: { weight: 0.25, description: 'Does the plan cover all requirements?' },
  feasibility: { weight: 0.25, description: 'Is it realistic given constraints?' },
  risk: { weight: 0.20, description: 'Are risks identified and mitigated?' },
  clarity: { weight: 0.15, description: 'Are steps clear and actionable?' },
  efficiency: { weight: 0.15, description: 'Is it resource-efficient?' }
};

const CLARITY_KEYWORDS = [
  'create', 'implement', 'add', 'update', 'remove', 'configure',
  'test', 'validate', 'integrate', 'deploy', 'refactor', 'optimize',
  'file', 'function', 'class', 'module', 'api', 'endpoint',
  'database', 'schema', 'migration', 'component', 'service'
];

const MITIGATION_KEYWORDS = [
  'fallback', 'backup', 'rollback', 'retry', 'timeout', 'validate',
  'test', 'monitor', 'alert', 'review', 'verify', 'check', 'ensure',
  'alternative', 'contingency', 'recover', 'handle', 'catch'
];

class PlanEvaluator extends EventEmitter {
  constructor(options = {}) {
    super();
    this.criteria = options.criteria || { ...DEFAULT_CRITERIA };
    this.tieThreshold = options.tieThreshold ?? 10;
    this.minSteps = options.minSteps ?? 3;
    this.maxSteps = options.maxSteps ?? 15;
    this._validateCriteria();
  }

  _validateCriteria() {
    const total = Object.values(this.criteria).reduce((sum, c) => sum + (c.weight || 0), 0);
    if (Math.abs(total - 1.0) > 0.01) throw new Error(`Criteria weights must sum to 1.0, got ${total.toFixed(2)}`);
  }

  setCriteria(criteria) {
    const old = this.criteria;
    this.criteria = { ...criteria };
    try { this._validateCriteria(); } catch (e) { this.criteria = old; throw e; }
  }

  evaluatePlan(plan, options = {}) {
    const normalizedPlan = this._normalizePlan(plan);
    const acceptanceCriteria = options.acceptanceCriteria || [];
    const scores = {}, breakdown = {}, recommendations = [];

    if (this.criteria.completeness) {
      const r = this._scoreCompleteness(normalizedPlan, acceptanceCriteria);
      scores.completeness = r.score; breakdown.completeness = r.details;
      if (r.recommendation) recommendations.push(r.recommendation);
    }
    if (this.criteria.feasibility) {
      const r = this._scoreFeasibility(normalizedPlan);
      scores.feasibility = r.score; breakdown.feasibility = r.details;
      if (r.recommendation) recommendations.push(r.recommendation);
    }
    if (this.criteria.risk) {
      const r = this._scoreRisk(normalizedPlan);
      scores.risk = r.score; breakdown.risk = r.details;
      if (r.recommendation) recommendations.push(r.recommendation);
    }
    if (this.criteria.clarity) {
      const r = this._scoreClarity(normalizedPlan);
      scores.clarity = r.score; breakdown.clarity = r.details;
      if (r.recommendation) recommendations.push(r.recommendation);
    }
    if (this.criteria.efficiency) {
      const r = this._scoreEfficiency(normalizedPlan);
      scores.efficiency = r.score; breakdown.efficiency = r.details;
      if (r.recommendation) recommendations.push(r.recommendation);
    }

    const totalScore = this._calculateWeightedScore(scores);
    const result = {
      planId: normalizedPlan.id, planTitle: normalizedPlan.title,
      scores, totalScore, recommendations: recommendations.filter(Boolean),
      breakdown, timestamp: new Date().toISOString()
    };
    this.emit('plan:evaluated', result);
    return result;
  }

  comparePlans(plans, options = {}) {
    if (!Array.isArray(plans) || plans.length < 2) throw new Error('At least 2 plans required for comparison');
    if (plans.length > 5) throw new Error('Maximum 5 plans can be compared at once');

    const evaluations = plans.map(plan => ({ plan, evaluation: this.evaluatePlan(plan, options) }));
    const rankings = evaluations
      .sort((a, b) => b.evaluation.totalScore - a.evaluation.totalScore)
      .map((item, index) => ({
        rank: index + 1, planId: item.evaluation.planId, planTitle: item.evaluation.planTitle,
        totalScore: item.evaluation.totalScore, scores: item.evaluation.scores, plan: item.plan
      }));

    const winner = rankings[0], runnerUp = rankings[1];
    const margin = winner.totalScore - runnerUp.totalScore;
    const needsReview = margin < this.tieThreshold;
    const reviewReason = needsReview ?
      `Margin of ${margin.toFixed(1)} is below threshold of ${this.tieThreshold}. Top plans: "${winner.planTitle}" vs "${runnerUp.planTitle}"` : null;

    const result = { winner, rankings, margin, needsReview, reviewReason, timestamp: new Date().toISOString() };
    if (needsReview) this.emit('plans:tie', result);
    this.emit('plans:compared', result);
    return result;
  }

  _normalizePlan(plan) {
    if (!plan || typeof plan !== 'object') return { id: 'unknown', title: 'Untitled Plan', steps: [], risks: [], estimates: {}, dependencies: [] };
    return {
      id: plan.id || `plan-${Date.now()}`, title: plan.title || 'Untitled Plan',
      steps: this._normalizeSteps(plan.steps), risks: this._normalizeRisks(plan.risks),
      estimates: plan.estimates || {}, dependencies: Array.isArray(plan.dependencies) ? plan.dependencies : [],
      strategy: plan.strategy || null, analysis: plan.analysis || null
    };
  }

  _normalizeSteps(steps) {
    if (!Array.isArray(steps)) return [];
    return steps.map((step, i) => typeof step === 'string'
      ? { action: step, details: '', order: i + 1 }
      : { action: step.action || step.step || '', details: step.details || '', order: step.order || i + 1, parallel: step.parallel || false }
    );
  }

  _normalizeRisks(risks) {
    if (!Array.isArray(risks)) return [];
    return risks.map(risk => typeof risk === 'string'
      ? { risk, mitigation: '', severity: 'medium' }
      : { risk: risk.risk || '', mitigation: risk.mitigation || '', severity: risk.severity || 'medium' }
    );
  }

  _scoreCompleteness(plan, acceptanceCriteria = []) {
    let score = 0;
    const details = {};
    details.stepCount = plan.steps.length >= this.minSteps ? Math.min(40, plan.steps.length * (40 / this.minSteps)) : (plan.steps.length > 0 ? (plan.steps.length / this.minSteps) * 40 : 0);
    score += details.stepCount;
    if (acceptanceCriteria.length > 0) {
      const planText = this._getPlanText(plan).toLowerCase();
      const covered = acceptanceCriteria.filter(c => planText.includes(c.toLowerCase()));
      details.criteriaCoverage = (covered.length / acceptanceCriteria.length) * 30;
    } else { details.criteriaCoverage = 20; }
    score += details.criteriaCoverage;
    details.hasRisks = plan.risks.length > 0 ? 15 : 0; score += details.hasRisks;
    details.hasEstimates = Object.keys(plan.estimates).length > 0 ? 15 : 0; score += details.hasEstimates;
    return { score: Math.min(100, score), details, recommendation: score < 70 ? 'Add more steps and cover acceptance criteria' : null };
  }

  _scoreFeasibility(plan) {
    let score = 0;
    const details = {};
    const { hours = 0 } = plan.estimates;
    const stepCount = plan.steps.length;
    if (hours > 0 && stepCount > 0) {
      const hoursPerStep = hours / stepCount;
      details.estimateRealism = hoursPerStep >= 0.5 && hoursPerStep <= 4 ? 40 : hoursPerStep > 0 && hoursPerStep < 8 ? 25 : 10;
    } else { details.estimateRealism = 15; }
    score += details.estimateRealism;
    details.dependencyScore = plan.dependencies.length === 0 ? 30 : plan.dependencies.length <= 3 ? 25 : plan.dependencies.length <= 5 ? 15 : 5;
    score += details.dependencyScore;
    const specificSteps = plan.steps.filter(s => CLARITY_KEYWORDS.some(k => (s.action + ' ' + s.details).toLowerCase().includes(k)));
    details.stepSpecificity = (specificSteps.length / Math.max(1, plan.steps.length)) * 30;
    score += details.stepSpecificity;
    return { score: Math.min(100, score), details, recommendation: score < 70 ? 'Add realistic estimates and reduce dependencies' : null };
  }

  _scoreRisk(plan) {
    let score = 0;
    const details = {};
    details.riskIdentification = plan.risks.length === 0 ? 0 : plan.risks.length === 1 ? 20 : plan.risks.length >= 2 && plan.risks.length <= 4 ? 40 : 30;
    score += details.riskIdentification;
    if (plan.risks.length > 0) {
      const withMitigation = plan.risks.filter(r => r.mitigation.length > 10 && MITIGATION_KEYWORDS.some(k => r.mitigation.toLowerCase().includes(k)));
      details.mitigationQuality = (withMitigation.length / plan.risks.length) * 40;
    } else { details.mitigationQuality = 0; }
    score += details.mitigationQuality;
    details.severityAwareness = plan.risks.some(r => ['high', 'medium', 'low', 'critical'].includes((r.severity || '').toLowerCase())) ? 20 : plan.risks.length > 0 ? 10 : 0;
    score += details.severityAwareness;
    return { score: Math.min(100, score), details, recommendation: score < 60 ? 'Identify risks and add mitigation strategies' : null };
  }

  _scoreClarity(plan) {
    let score = 0;
    const details = {};
    const titleLen = (plan.title || '').length;
    details.titleClarity = titleLen >= 10 && titleLen <= 100 ? 20 : titleLen > 0 ? 10 : 0;
    score += details.titleClarity;
    if (plan.steps.length === 0) { details.stepDetail = 0; }
    else {
      const detailed = plan.steps.filter(s => (s.action || '').length >= 5 && ((s.action || '').length + (s.details || '').length) >= 15);
      details.stepDetail = (detailed.length / plan.steps.length) * 40;
    }
    score += details.stepDetail;
    const planText = this._getPlanText(plan).toLowerCase();
    const found = CLARITY_KEYWORDS.filter(k => planText.includes(k));
    details.keywordSpecificity = Math.min(25, found.length * 2.5);
    score += details.keywordSpecificity;
    details.logicalOrdering = plan.steps.every((s, i) => s.order === undefined || s.order === i + 1) ? 15 : 5;
    score += details.logicalOrdering;
    return { score: Math.min(100, score), details, recommendation: score < 70 ? 'Add more detail to each step' : null };
  }

  _scoreEfficiency(plan) {
    let score = 0;
    const details = {};
    const stepCount = plan.steps.length;
    if (stepCount >= this.minSteps && stepCount <= this.maxSteps) { details.stepCountEfficiency = 35; }
    else if (stepCount > this.maxSteps) { details.stepCountEfficiency = Math.max(10, 35 - (stepCount - this.maxSteps) * 3); }
    else if (stepCount > 0) { details.stepCountEfficiency = 20; }
    else { details.stepCountEfficiency = 0; }
    score += details.stepCountEfficiency;
    const parallel = plan.steps.filter(s => s.parallel === true);
    details.parallelization = parallel.length > 0 ? Math.min(30, 10 + parallel.length * 5) : 10;
    score += details.parallelization;
    const complexity = ((plan.estimates.complexity || '').toLowerCase());
    const hours = plan.estimates.hours || 0;
    details.resourceEfficiency = complexity === 'low' || (hours > 0 && hours <= 16) ? 35 : complexity === 'medium' || (hours > 16 && hours <= 40) ? 25 : complexity === 'high' || hours > 40 ? 15 : 20;
    score += details.resourceEfficiency;
    return { score: Math.min(100, score), details, recommendation: score < 70 ? 'Simplify or add parallelization' : null };
  }

  _calculateWeightedScore(scores) {
    let total = 0;
    for (const [criterion, score] of Object.entries(scores)) {
      total += score * (this.criteria[criterion]?.weight || 0);
    }
    return Math.round(total * 10) / 10;
  }

  _getPlanText(plan) {
    return [plan.title || '', ...plan.steps.map(s => `${s.action} ${s.details}`), ...plan.risks.map(r => `${r.risk} ${r.mitigation}`), ...(plan.dependencies || [])].join(' ');
  }
}

module.exports = { PlanEvaluator, DEFAULT_CRITERIA, CLARITY_KEYWORDS, MITIGATION_KEYWORDS };
