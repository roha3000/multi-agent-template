/**
 * Pattern Recommender - Intelligent orchestration pattern selection
 *
 * Analyzes historical data to:
 * - Recommend best pattern for a task
 * - Suggest optimal agent teams
 * - Predict success rates
 * - Identify risk factors
 *
 * @module pattern-recommender
 */

const { createComponentLogger } = require('./logger');

class PatternRecommender {
  /**
   * Create a new Pattern Recommender
   * @param {MemoryStore} memoryStore - MemoryStore instance
   * @param {MemorySearchAPI} searchAPI - MemorySearchAPI instance (optional)
   */
  constructor(memoryStore, searchAPI = null) {
    this.logger = createComponentLogger('PatternRecommender');
    this.memoryStore = memoryStore;
    this.searchAPI = searchAPI;

    // Pattern characteristics for scoring
    this.patternCharacteristics = {
      parallel: {
        strengths: ['speed', 'independent_tasks', 'multiple_perspectives'],
        weaknesses: ['coordination_overhead', 'potential_conflicts'],
        idealFor: ['research', 'analysis', 'independent_subtasks']
      },
      consensus: {
        strengths: ['agreement', 'thorough_validation', 'quality'],
        weaknesses: ['slower', 'may_dilute_bold_ideas'],
        idealFor: ['critical_decisions', 'design', 'validation']
      },
      debate: {
        strengths: ['critical_analysis', 'identifies_flaws', 'innovative_solutions'],
        weaknesses: ['time_consuming', 'may_be_confrontational'],
        idealFor: ['problem_solving', 'architecture', 'complex_decisions']
      },
      review: {
        strengths: ['quality_assurance', 'error_detection', 'improvements'],
        weaknesses: ['sequential', 'depends_on_reviewer_expertise'],
        idealFor: ['code_review', 'document_review', 'quality_check']
      },
      ensemble: {
        strengths: ['combines_strengths', 'robust_results', 'error_correction'],
        weaknesses: ['complex', 'resource_intensive'],
        idealFor: ['prediction', 'classification', 'uncertain_tasks']
      }
    };

    this.logger.info('PatternRecommender initialized', {
      hasSearchAPI: !!searchAPI
    });
  }

  /**
   * Recommend best pattern for a task
   * Analyzes task description and historical success rates
   *
   * @param {string} taskDescription - Description of the task
   * @param {Object} context - Additional context
   * @param {Array<string>} context.availableAgents - Available agent IDs
   * @param {Array<string>} context.requiredAgents - Required agent IDs (optional)
   * @param {string} context.priority - Priority: 'speed', 'quality', 'cost' (default: 'quality')
   * @param {number} context.minSuccessRate - Minimum acceptable success rate (default: 0.7)
   * @returns {Promise<Object>} Pattern recommendation with reasoning
   */
  async recommendPattern(taskDescription, context = {}) {
    const {
      availableAgents = [],
      requiredAgents = [],
      priority = 'quality',
      minSuccessRate = 0.7
    } = context;

    try {
      // Analyze task keywords
      const taskKeywords = this._extractKeywords(taskDescription);

      // Get historical success patterns
      let historicalPatterns = [];
      if (this.searchAPI) {
        const analysis = await this.searchAPI.getSuccessPatterns(taskDescription, {
          minSuccessRate,
          minSamples: 2
        });
        historicalPatterns = analysis.successfulPatterns;
      }

      // Score each pattern
      const patternScores = Object.keys(this.patternCharacteristics).map(pattern => {
        const score = this._scorePattern(pattern, {
          taskKeywords,
          historicalPatterns,
          priority,
          availableAgents
        });

        const historical = historicalPatterns.find(p => p.pattern === pattern);

        return {
          pattern,
          score: score.total,
          confidence: score.confidence,
          reasoning: score.reasoning,
          historicalSuccessRate: historical ? historical.successRate : null,
          historicalSamples: historical ? historical.samples : 0,
          characteristics: this.patternCharacteristics[pattern]
        };
      });

      // Sort by score
      patternScores.sort((a, b) => b.score - a.score);

      const recommendation = patternScores[0];
      const alternatives = patternScores.slice(1, 3);

      this.logger.info('Pattern recommendation completed', {
        taskDescription: taskDescription.substring(0, 50),
        recommendedPattern: recommendation.pattern,
        score: recommendation.score,
        confidence: recommendation.confidence
      });

      return {
        recommendation,
        alternatives,
        allScores: patternScores,
        context: {
          priority,
          availableAgents: availableAgents.length,
          hasHistoricalData: historicalPatterns.length > 0
        }
      };

    } catch (error) {
      this.logger.error('Pattern recommendation failed', {
        error: error.message,
        taskDescription: taskDescription.substring(0, 50)
      });

      // Return safe default
      return {
        recommendation: {
          pattern: 'parallel',
          score: 0.5,
          confidence: 'low',
          reasoning: ['Default recommendation due to error'],
          characteristics: this.patternCharacteristics.parallel
        },
        alternatives: [],
        error: error.message
      };
    }
  }

  /**
   * Recommend optimal agent team for a task
   * Based on historical collaborations and individual performance
   *
   * @param {string} taskDescription - Description of the task
   * @param {Object} options - Recommendation options
   * @param {Array<string>} options.availableAgents - Available agent IDs
   * @param {number} options.minAgents - Minimum agents (default: 2)
   * @param {number} options.maxAgents - Maximum agents (default: 4)
   * @param {string} options.pattern - Orchestration pattern (optional)
   * @returns {Promise<Object>} Team recommendation with reasoning
   */
  async recommendTeam(taskDescription, options = {}) {
    const {
      availableAgents = [],
      minAgents = 2,
      maxAgents = 4,
      pattern
    } = options;

    if (availableAgents.length < minAgents) {
      this.logger.warn('Not enough available agents', {
        available: availableAgents.length,
        required: minAgents
      });
      return {
        recommendation: availableAgents,
        reasoning: ['Using all available agents'],
        confidence: 'low'
      };
    }

    try {
      // Get success patterns to find successful agent combinations
      let successfulCombos = [];
      if (this.searchAPI) {
        const analysis = await this.searchAPI.getSuccessPatterns(taskDescription);
        successfulCombos = analysis.topAgentCombinations || [];
      }

      // Get individual agent stats
      const agentStats = availableAgents.map(agentId => {
        const stats = this.memoryStore.getAgentStats(agentId);
        return {
          agentId,
          stats,
          successRate: stats ? stats.success_rate : 0,
          totalExecutions: stats ? stats.total_executions : 0
        };
      });

      // Score agent combinations
      const teamScores = [];

      // If we have historical data, prioritize those combinations
      if (successfulCombos.length > 0) {
        successfulCombos.forEach(combo => {
          const agents = combo.agents.filter(a => availableAgents.includes(a));
          if (agents.length >= minAgents && agents.length <= maxAgents) {
            teamScores.push({
              agents,
              score: 10 + combo.count, // High score for historical success
              reasoning: [`Successful ${combo.count} times previously`],
              historical: true
            });
          }
        });
      }

      // Generate new combinations based on individual performance
      if (teamScores.length === 0) {
        // Sort agents by success rate
        const topAgents = agentStats
          .filter(a => a.totalExecutions > 0)
          .sort((a, b) => b.successRate - a.successRate);

        if (topAgents.length >= minAgents) {
          // Recommend top performers
          const team = topAgents.slice(0, Math.min(maxAgents, topAgents.length));
          teamScores.push({
            agents: team.map(a => a.agentId),
            score: team.reduce((sum, a) => sum + a.successRate, 0) / team.length,
            reasoning: [
              'Based on individual success rates',
              ...team.map(a => `${a.agentId}: ${(a.successRate * 100).toFixed(1)}% success rate`)
            ],
            historical: false
          });
        }
      }

      // If still no recommendations, use all available
      if (teamScores.length === 0) {
        teamScores.push({
          agents: availableAgents.slice(0, maxAgents),
          score: 0.5,
          reasoning: ['No historical data available, using available agents'],
          historical: false
        });
      }

      // Get successful collaborations for pattern if specified
      let collaborationStats = null;
      if (pattern) {
        collaborationStats = this.memoryStore.getSuccessfulCollaborations(pattern);
      }

      const recommendation = teamScores[0];

      this.logger.info('Team recommendation completed', {
        taskDescription: taskDescription.substring(0, 50),
        recommendedTeam: recommendation.agents,
        teamSize: recommendation.agents.length,
        historical: recommendation.historical
      });

      return {
        recommendation: recommendation.agents,
        reasoning: recommendation.reasoning,
        confidence: recommendation.historical ? 'high' : 'medium',
        score: recommendation.score,
        collaborationStats,
        alternatives: teamScores.slice(1, 3).map(t => t.agents)
      };

    } catch (error) {
      this.logger.error('Team recommendation failed', {
        error: error.message,
        taskDescription: taskDescription.substring(0, 50)
      });

      return {
        recommendation: availableAgents.slice(0, maxAgents),
        reasoning: ['Default recommendation due to error'],
        confidence: 'low',
        error: error.message
      };
    }
  }

  /**
   * Predict success rate for a specific pattern/agent combination
   *
   * @param {string} pattern - Orchestration pattern
   * @param {Array<string>} agentIds - Agent IDs
   * @param {string} taskDescription - Task description (optional)
   * @returns {Promise<Object>} Success prediction
   */
  async predictSuccess(pattern, agentIds, taskDescription = '') {
    try {
      // Get pattern stats
      const patternStats = this.memoryStore.getPatternStats(pattern);

      // Get agent stats
      const agentStats = agentIds.map(id => this.memoryStore.getAgentStats(id));
      const avgAgentSuccessRate = agentStats.reduce((sum, stats) =>
        sum + (stats ? stats.success_rate : 0), 0
      ) / agentStats.length;

      // Get collaboration stats
      const collabStats = this.memoryStore.getSuccessfulCollaborations(pattern);
      const agentKey = agentIds.sort().join(',');
      const exactMatch = collabStats.find(c => c.agents === agentKey);

      // Calculate prediction
      let prediction = 0.5; // Default
      const factors = [];

      if (patternStats && patternStats.success_rate > 0) {
        prediction = patternStats.success_rate * 0.4;
        factors.push({
          factor: 'Pattern Success Rate',
          weight: 0.4,
          value: patternStats.success_rate,
          contribution: patternStats.success_rate * 0.4
        });
      }

      if (avgAgentSuccessRate > 0) {
        prediction += avgAgentSuccessRate * 0.3;
        factors.push({
          factor: 'Agent Average Success Rate',
          weight: 0.3,
          value: avgAgentSuccessRate,
          contribution: avgAgentSuccessRate * 0.3
        });
      }

      if (exactMatch) {
        const collabSuccess = exactMatch.success_count / exactMatch.total_count;
        prediction += collabSuccess * 0.3;
        factors.push({
          factor: 'Exact Collaboration History',
          weight: 0.3,
          value: collabSuccess,
          contribution: collabSuccess * 0.3,
          samples: exactMatch.total_count
        });
      }

      // Get similar historical tasks if description provided
      let similarTasksSuccess = null;
      if (taskDescription && this.searchAPI) {
        const similar = await this.searchAPI.searchOrchestrations(taskDescription, {
          pattern,
          limit: 10
        });

        if (similar.length > 0) {
          const successCount = similar.filter(o => o.success).length;
          similarTasksSuccess = successCount / similar.length;
          factors.push({
            factor: 'Similar Tasks Success',
            weight: 0.2,
            value: similarTasksSuccess,
            samples: similar.length
          });
        }
      }

      // Confidence based on sample size
      const totalSamples = factors.reduce((sum, f) => sum + (f.samples || 0), 0);
      let confidence = 'low';
      if (totalSamples >= 10) confidence = 'high';
      else if (totalSamples >= 5) confidence = 'medium';

      this.logger.info('Success prediction completed', {
        pattern,
        agentCount: agentIds.length,
        prediction: prediction.toFixed(2),
        confidence
      });

      return {
        pattern,
        agents: agentIds,
        predictedSuccessRate: prediction,
        confidence,
        factors,
        recommendations: this._generateRecommendations(prediction, factors)
      };

    } catch (error) {
      this.logger.error('Success prediction failed', {
        error: error.message,
        pattern,
        agentCount: agentIds.length
      });

      return {
        pattern,
        agents: agentIds,
        predictedSuccessRate: 0.5,
        confidence: 'low',
        error: error.message
      };
    }
  }

  /**
   * Analyze risks for a planned orchestration
   *
   * @param {string} pattern - Orchestration pattern
   * @param {Array<string>} agentIds - Agent IDs
   * @param {string} taskDescription - Task description
   * @returns {Promise<Object>} Risk analysis
   */
  async analyzeRisks(pattern, agentIds, taskDescription) {
    try {
      const risks = [];

      // Get failure patterns
      let failures = [];
      if (this.searchAPI) {
        const analysis = await this.searchAPI.getFailurePatterns(taskDescription);
        failures = analysis.commonFailures || [];
      }

      // Check if this pattern has high failure rate
      const patternFailures = failures.find(f => f.pattern === pattern);
      if (patternFailures && patternFailures.failureCount > 2) {
        risks.push({
          level: 'high',
          category: 'pattern',
          description: `Pattern '${pattern}' has failed ${patternFailures.failureCount} times for similar tasks`,
          mitigation: `Consider using alternative pattern or adding more agents`
        });
      }

      // Check agent performance
      const agentStats = agentIds.map(id => ({
        id,
        stats: this.memoryStore.getAgentStats(id)
      }));

      const inexperiencedAgents = agentStats.filter(a =>
        !a.stats || a.stats.total_executions < 3
      );

      if (inexperiencedAgents.length > 0) {
        risks.push({
          level: 'medium',
          category: 'agents',
          description: `${inexperiencedAgents.length} agent(s) have limited execution history`,
          agents: inexperiencedAgents.map(a => a.id),
          mitigation: 'Consider adding experienced agents or using review pattern'
        });
      }

      const underperformingAgents = agentStats.filter(a =>
        a.stats && a.stats.success_rate < 0.6
      );

      if (underperformingAgents.length > 0) {
        risks.push({
          level: 'high',
          category: 'agents',
          description: `${underperformingAgents.length} agent(s) have low success rates`,
          agents: underperformingAgents.map(a => ({
            id: a.id,
            successRate: a.stats.success_rate
          })),
          mitigation: 'Replace with higher-performing agents or add validation step'
        });
      }

      // Check collaboration history
      const collabStats = this.memoryStore.getSuccessfulCollaborations(pattern);
      const agentKey = agentIds.sort().join(',');
      const thisCollab = collabStats.find(c => c.agents === agentKey);

      if (!thisCollab && collabStats.length > 0) {
        risks.push({
          level: 'low',
          category: 'collaboration',
          description: 'This agent combination has not worked together before',
          mitigation: 'Consider using proven agent combinations from history'
        });
      }

      // Overall risk level
      const highRisks = risks.filter(r => r.level === 'high').length;
      const mediumRisks = risks.filter(r => r.level === 'medium').length;

      let overallRisk = 'low';
      if (highRisks > 0) overallRisk = 'high';
      else if (mediumRisks > 1) overallRisk = 'medium';

      this.logger.info('Risk analysis completed', {
        pattern,
        agentCount: agentIds.length,
        overallRisk,
        riskCount: risks.length
      });

      return {
        overallRisk,
        risks,
        riskCounts: {
          high: highRisks,
          medium: mediumRisks,
          low: risks.length - highRisks - mediumRisks
        },
        recommendation: overallRisk === 'high'
          ? 'Consider alternative pattern or agents'
          : overallRisk === 'medium'
          ? 'Proceed with caution and monitoring'
          : 'Low risk, good to proceed'
      };

    } catch (error) {
      this.logger.error('Risk analysis failed', {
        error: error.message
      });

      return {
        overallRisk: 'unknown',
        risks: [],
        error: error.message
      };
    }
  }

  /**
   * Extract keywords from task description
   * @private
   */
  _extractKeywords(taskDescription) {
    const text = taskDescription.toLowerCase();
    const keywords = {
      research: /research|investigate|explore|analyze|study/i.test(text),
      design: /design|architect|structure|plan|blueprint/i.test(text),
      implement: /implement|code|develop|build|create/i.test(text),
      review: /review|validate|check|verify|audit/i.test(text),
      test: /test|testing|qa|quality/i.test(text),
      debate: /debate|discuss|analyze|evaluate|compare/i.test(text),
      urgent: /urgent|asap|immediate|critical|emergency/i.test(text),
      complex: /complex|difficult|challenging|intricate/i.test(text),
      simple: /simple|straightforward|easy|basic/i.test(text)
    };

    return keywords;
  }

  /**
   * Score a pattern for given context
   * @private
   */
  _scorePattern(pattern, context) {
    const { taskKeywords, historicalPatterns, priority, availableAgents } = context;
    let score = 5; // Base score
    const reasoning = [];

    // Historical success weighs heavily
    const historical = historicalPatterns.find(p => p.pattern === pattern);
    if (historical) {
      score += historical.successRate * 5;
      reasoning.push(`${(historical.successRate * 100).toFixed(0)}% historical success rate (${historical.samples} samples)`);
    }

    // Task keyword matching
    const chars = this.patternCharacteristics[pattern];
    let keywordMatches = 0;

    if (taskKeywords.research && chars.idealFor.includes('research')) {
      score += 2;
      keywordMatches++;
    }
    if (taskKeywords.design && chars.idealFor.includes('design')) {
      score += 2;
      keywordMatches++;
    }
    if (taskKeywords.review && chars.idealFor.includes('quality_check')) {
      score += 2;
      keywordMatches++;
    }
    if (taskKeywords.complex && pattern === 'debate') {
      score += 1;
      keywordMatches++;
    }

    if (keywordMatches > 0) {
      reasoning.push(`Matches ${keywordMatches} task characteristics`);
    }

    // Priority-based scoring
    if (priority === 'speed' && pattern === 'parallel') {
      score += 2;
      reasoning.push('Parallel pattern optimal for speed priority');
    }
    if (priority === 'quality' && (pattern === 'consensus' || pattern === 'review')) {
      score += 2;
      reasoning.push(`${pattern} pattern optimal for quality priority`);
    }

    // Agent availability
    const minAgentsNeeded = {
      parallel: 2,
      consensus: 3,
      debate: 2,
      review: 2,
      ensemble: 3
    };

    if (availableAgents.length < minAgentsNeeded[pattern]) {
      score -= 3;
      reasoning.push(`Not enough agents (need ${minAgentsNeeded[pattern]}, have ${availableAgents.length})`);
    }

    // Determine confidence
    let confidence = 'medium';
    if (historical && historical.samples >= 5) {
      confidence = 'high';
    } else if (!historical && keywordMatches === 0) {
      confidence = 'low';
    }

    return {
      total: Math.max(0, Math.min(10, score)),
      confidence,
      reasoning
    };
  }

  /**
   * Generate recommendations based on prediction factors
   * @private
   */
  _generateRecommendations(prediction, factors) {
    const recommendations = [];

    if (prediction < 0.5) {
      recommendations.push('Consider alternative pattern - low predicted success rate');
    }

    const lowFactors = factors.filter(f => f.value < 0.5);
    if (lowFactors.length > 0) {
      lowFactors.forEach(f => {
        recommendations.push(`Improve ${f.factor.toLowerCase()} (currently ${(f.value * 100).toFixed(0)}%)`);
      });
    }

    const noSampleFactors = factors.filter(f => !f.samples || f.samples < 3);
    if (noSampleFactors.length > 0) {
      recommendations.push('Limited historical data - proceed with monitoring');
    }

    if (prediction >= 0.7) {
      recommendations.push('Good chance of success - proceed with confidence');
    }

    return recommendations;
  }
}

module.exports = PatternRecommender;
