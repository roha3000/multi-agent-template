/**
 * AICategorizationService - AI-powered observation extraction
 *
 * Extracts structured observations from orchestration results using AI
 * with rule-based fallback for reliability.
 *
 * Features:
 * - Claude API integration for intelligent categorization
 * - Rule-based fallback for reliability
 * - Batch processing with concurrency control
 * - Comprehensive error handling
 * - Metrics tracking
 *
 * Categorization Types:
 * - decision: Strategic choices made
 * - bugfix: Bug resolution
 * - feature: New functionality
 * - pattern-usage: Multi-agent pattern application
 * - discovery: New insights learned
 * - refactor: Code improvements
 *
 * Graceful Degradation Strategy:
 * 1. Try AI categorization (Claude API)
 * 2. Fall back to rule-based heuristics
 * 3. Skip categorization if both fail (orchestration continues)
 *
 * @module ai-categorizer
 */

const { createComponentLogger } = require('./logger');

class AICategorizationService {
  /**
   * Create an AICategorizationService instance
   *
   * @param {Object} deps - Dependencies (for testability)
   * @param {string} deps.apiKey - Anthropic API key (optional, falls back to rules if not provided)
   * @param {Object} deps.anthropicClient - Optional pre-configured Anthropic client
   * @param {Object} options - Configuration options
   * @param {string} [options.model='claude-3-5-sonnet-20241022'] - Claude model to use
   * @param {number} [options.maxTokens=500] - Max tokens for AI response
   * @param {number} [options.temperature=0.3] - Temperature for AI (lower = more consistent)
   * @param {number} [options.timeout=10000] - Request timeout in ms
   * @param {boolean} [options.fallbackToRules=true] - Enable rule-based fallback
   * @param {number} [options.retries=2] - Number of retry attempts
   * @param {number} [options.concurrency=3] - Max concurrent requests
   */
  constructor(deps = {}, options = {}) {
    this.logger = createComponentLogger('AICategorizationService');

    // Extract API key from deps
    const apiKey = typeof deps === 'string' ? deps : deps.apiKey;

    // Configuration
    this.options = {
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
      model: options.model || 'claude-3-5-sonnet-20241022',
      maxTokens: options.maxTokens || 500,
      temperature: options.temperature || 0.3,
      timeout: options.timeout || 10000,
      fallbackToRules: options.fallbackToRules !== false,
      retries: options.retries || 2,
      concurrency: options.concurrency || 3,
      ...options
    };

    // State
    this.anthropic = deps.anthropicClient || null;
    this.isAvailable = false;

    // Metrics
    this.metrics = {
      totalRequests: 0,
      successful: 0,
      failed: 0,
      fallbacks: 0,
      totalDuration: 0,
      avgDuration: 0,
      aiCalls: 0,
      ruleBasedCalls: 0
    };

    // Initialize Anthropic client if API key provided
    if (this.options.apiKey) {
      this._initializeClient();
    } else {
      this.logger.warn('No API key provided, using rule-based categorization only');
    }

    this.logger.info('AICategorizationService created', {
      aiAvailable: this.isAvailable,
      fallbackEnabled: this.options.fallbackToRules,
      model: this.options.model
    });
  }

  /**
   * Initialize Anthropic client
   *
   * @private
   */
  _initializeClient() {
    try {
      const Anthropic = require('@anthropic-ai/sdk');

      this.anthropic = new Anthropic({
        apiKey: this.options.apiKey,
        timeout: this.options.timeout
      });

      this.isAvailable = true;
      this.logger.info('AI categorization client initialized', {
        model: this.options.model
      });

    } catch (error) {
      this.isAvailable = false;
      this.logger.warn('Failed to initialize AI client', {
        error: error.message,
        fallbackEnabled: this.options.fallbackToRules
      });
    }
  }

  /**
   * Categorize orchestration and extract observations
   *
   * @param {Object} orchestration - Orchestration data
   * @param {string} orchestration.pattern - Pattern type
   * @param {Array<string>} orchestration.agentIds - Agent IDs
   * @param {string} orchestration.task - Task description
   * @param {string} [orchestration.resultSummary] - Result summary
   * @param {boolean} orchestration.success - Success status
   * @param {number} orchestration.duration - Duration in ms
   * @returns {Promise<Object>} Categorization result
   */
  async categorizeOrchestration(orchestration) {
    const startTime = Date.now();
    this.metrics.totalRequests++;

    this.logger.debug('Categorizing orchestration', {
      pattern: orchestration.pattern,
      success: orchestration.success,
      agentCount: orchestration.agentIds?.length || 0
    });

    try {
      // Try AI categorization if available
      if (this.isAvailable) {
        const result = await this._categorizeWithAI(orchestration);

        this.metrics.successful++;
        this.metrics.aiCalls++;
        this._updateAverageDuration(startTime);

        this.logger.info('AI categorization complete', {
          type: result.type,
          importance: result.importance,
          duration: Date.now() - startTime,
          concepts: result.concepts?.length || 0
        });

        return result;
      }

      // AI not available, try fallback
      throw new Error('AI not available');

    } catch (error) {
      this.logger.warn('AI categorization failed', {
        error: error.message,
        pattern: orchestration.pattern
      });

      this.metrics.failed++;

      // Fallback to rule-based categorization
      if (this.options.fallbackToRules) {
        this.metrics.fallbacks++;
        this.metrics.ruleBasedCalls++;
        const result = this._categorizeWithRules(orchestration);

        this._updateAverageDuration(startTime);

        this.logger.info('Rule-based categorization applied', {
          type: result.type,
          source: result.source
        });

        return result;
      }

      throw error;
    }
  }

  /**
   * AI-powered categorization using Claude API
   *
   * @private
   * @param {Object} orchestration - Orchestration data
   * @returns {Promise<Object>} Categorization result
   */
  async _categorizeWithAI(orchestration) {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized');
    }

    const prompt = this._buildCategorizationPrompt(orchestration);

    try {
      const response = await this.anthropic.messages.create({
        model: this.options.model,
        max_tokens: this.options.maxTokens,
        temperature: this.options.temperature,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const content = response.content[0].text;

      // Parse AI response (expected JSON format)
      try {
        // Extract JSON from response (may have markdown code blocks)
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error('No JSON found in AI response');
        }

        const parsed = JSON.parse(jsonMatch[0]);
        return this._validateCategorization(parsed);

      } catch (parseError) {
        this.logger.error('Failed to parse AI response', {
          error: parseError.message,
          content: content.substring(0, 200)
        });
        throw new Error('Invalid AI response format');
      }

    } catch (error) {
      this.logger.error('AI API call failed', {
        error: error.message,
        model: this.options.model
      });
      throw error;
    }
  }

  /**
   * Build categorization prompt for AI
   *
   * @private
   * @param {Object} orchestration - Orchestration data
   * @returns {string} Structured prompt
   */
  _buildCategorizationPrompt(orchestration) {
    return `Analyze this multi-agent orchestration and extract key observations.

ORCHESTRATION DETAILS:
- Pattern: ${orchestration.pattern}
- Agents: ${orchestration.agentIds?.join(', ') || 'unknown'}
- Task: ${orchestration.task || 'No task description'}
- Result: ${orchestration.resultSummary || 'No summary'}
- Success: ${orchestration.success ? 'Yes' : 'No'}
- Duration: ${orchestration.duration}ms

EXTRACT:
1. Type: Choose ONE from: decision | bugfix | feature | pattern-usage | discovery | refactor
2. Key Learning: 1-2 sentence observation (what was learned or decided)
3. Concepts: 3-5 keywords that capture the essence
4. Importance: 1-10 scale (how valuable is this observation?)
5. Agent Insights: Which agents contributed what? Any standout performance?
6. Recommendations: Guidance for similar future tasks

RESPOND WITH JSON ONLY (no explanation):
{
  "type": "decision | bugfix | feature | pattern-usage | discovery | refactor",
  "observation": "1-2 sentence key learning",
  "concepts": ["keyword1", "keyword2", "keyword3"],
  "importance": 5,
  "agentInsights": {
    "agent-id": "what this agent contributed"
  },
  "recommendations": "Guidance for future tasks"
}`;
  }

  /**
   * Rule-based categorization fallback
   *
   * Uses keyword heuristics and pattern recognition for reliable
   * categorization when AI is unavailable.
   *
   * @private
   * @param {Object} orchestration - Orchestration data
   * @returns {Object} Categorization result
   */
  _categorizeWithRules(orchestration) {
    // Initialize defaults
    let type = 'pattern-usage'; // Default
    let importance = 5;
    const concepts = [];

    // Build search text from task + result
    const text = `${orchestration.task || ''} ${orchestration.resultSummary || ''}`.toLowerCase();

    // Apply keyword heuristics - order matters, check most specific first
    // Check for decision keywords first (often most specific intent)
    if (this._containsKeywords(text, ['decide', 'decision', 'choice', 'select', 'choose', 'determine'])) {
      type = 'decision';
      importance = 6;
      concepts.push('decision-making', 'strategy');
    }
    // Check for discovery (learning intent)
    else if (this._containsKeywords(text, ['discover', 'learn', 'found', 'insight', 'realize'])) {
      type = 'discovery';
      importance = 7;
      concepts.push('learning', 'insight');
    }
    // Check for refactoring (improvement intent)
    else if (this._containsKeywords(text, ['refactor', 'improve', 'optimize', 'clean', 'restructure'])) {
      type = 'refactor';
      importance = 5;
      concepts.push('code-improvement', 'optimization');
    }
    // Check for feature (new functionality)
    else if (this._containsKeywords(text, ['feature', 'implement', 'add', 'create', 'build', 'new'])) {
      type = 'feature';
      importance = 6;
      concepts.push('feature-development', 'implementation');
    }
    // Check for bugfix last (often combined with "fix" which can be ambiguous)
    else if (this._containsKeywords(text, ['bug', 'error', 'issue', 'crash', 'broken']) ||
             (text.includes('fix') && !text.includes('prefix'))) {
      type = 'bugfix';
      importance = 7;
      concepts.push('debugging', 'error-resolution');
    }

    // Add pattern as concept
    if (orchestration.pattern) {
      concepts.push(orchestration.pattern);
    }

    // Adjust importance based on success
    if (!orchestration.success) {
      importance = Math.max(importance - 2, 1);
      concepts.push('failure-analysis');
    }

    // Extract agent insights (basic)
    const agentInsights = {};
    if (orchestration.agentIds && orchestration.agentIds.length > 0) {
      orchestration.agentIds.forEach(agentId => {
        agentInsights[agentId] = `Participated in ${orchestration.pattern} pattern`;
      });
    }

    // Build observation
    const observation = this._buildRuleBasedObservation(
      type,
      orchestration
    );

    // Build recommendations
    const recommendations = orchestration.success
      ? `Consider using ${orchestration.pattern} pattern for similar ${type} tasks`
      : `Review ${orchestration.pattern} pattern configuration for ${type} scenarios`;

    return {
      type,
      observation,
      concepts: concepts.slice(0, 5), // Limit to 5
      importance,
      agentInsights,
      recommendations,
      source: 'rule-based' // Indicate this is not AI-generated
    };
  }

  /**
   * Check if text contains any of the keywords
   *
   * @private
   * @param {string} text - Text to search
   * @param {Array<string>} keywords - Keywords to search for
   * @returns {boolean} True if any keyword found
   */
  _containsKeywords(text, keywords) {
    return keywords.some(keyword => text.includes(keyword));
  }

  /**
   * Build rule-based observation text
   *
   * @private
   * @param {string} type - Categorization type
   * @param {Object} orchestration - Orchestration data
   * @returns {string} Observation text
   */
  _buildRuleBasedObservation(type, orchestration) {
    const task = orchestration.task || 'task';
    const pattern = orchestration.pattern || 'multi-agent pattern';
    const status = orchestration.success ? 'successfully completed' : 'attempted';

    const templates = {
      bugfix: `Bug fix ${status} using ${pattern}: ${task.substring(0, 100)}`,
      decision: `Strategic decision made using ${pattern}: ${task.substring(0, 100)}`,
      feature: `Feature ${status} using ${pattern}: ${task.substring(0, 100)}`,
      refactor: `Code improvement ${status} using ${pattern}: ${task.substring(0, 100)}`,
      discovery: `Discovery made using ${pattern}: ${task.substring(0, 100)}`,
      'pattern-usage': `${pattern} pattern ${status}: ${task.substring(0, 100)}`
    };

    return templates[type] || templates['pattern-usage'];
  }

  /**
   * Validate and normalize categorization result
   *
   * @private
   * @param {Object} categorization - Raw categorization result
   * @returns {Object} Validated categorization
   */
  _validateCategorization(categorization) {
    // Validate required fields
    const required = ['type', 'observation', 'concepts', 'importance'];

    for (const field of required) {
      if (!(field in categorization)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate type
    const validTypes = ['decision', 'bugfix', 'feature', 'pattern-usage', 'discovery', 'refactor'];
    if (!validTypes.includes(categorization.type)) {
      this.logger.warn('Invalid categorization type, using default', {
        type: categorization.type,
        valid: validTypes
      });
      categorization.type = 'pattern-usage'; // Default
    }

    // Validate importance range (1-10)
    if (typeof categorization.importance !== 'number' ||
        categorization.importance < 1 ||
        categorization.importance > 10) {
      this.logger.warn('Invalid importance value, clamping', {
        value: categorization.importance
      });
      categorization.importance = Math.max(1, Math.min(10, categorization.importance || 5));
    }

    // Ensure concepts is array
    if (!Array.isArray(categorization.concepts)) {
      this.logger.warn('Concepts is not an array, converting', {
        type: typeof categorization.concepts
      });
      categorization.concepts = [];
    }

    // Ensure agentInsights is object
    if (typeof categorization.agentInsights !== 'object' || categorization.agentInsights === null) {
      this.logger.warn('AgentInsights is not an object, using empty', {
        type: typeof categorization.agentInsights
      });
      categorization.agentInsights = {};
    }

    // Ensure recommendations is string
    if (typeof categorization.recommendations !== 'string') {
      categorization.recommendations = '';
    }

    // Add source marker for AI categorizations
    if (!categorization.source) {
      categorization.source = 'ai';
    }

    return categorization;
  }

  /**
   * Extract observations from multiple orchestrations (batch)
   *
   * Processes orchestrations concurrently with configurable concurrency.
   * Returns partial success with detailed per-item error tracking.
   *
   * @param {Array<Object>} orchestrations - Array of orchestrations
   * @param {Object} options - Batch options
   * @param {number} [options.concurrency] - Override concurrency limit
   * @returns {Promise<Array<Object>>} Array of categorization results
   */
  async categorizeOrchestrationsBatch(orchestrations, options = {}) {
    const { concurrency = this.options.concurrency } = options;

    this.logger.info('Starting batch categorization', {
      count: orchestrations.length,
      concurrency
    });

    const results = [];
    const queue = [...orchestrations];
    const inFlight = new Set();

    /**
     * Process one orchestration from queue
     * @private
     */
    const processOne = async () => {
      if (queue.length === 0) return;

      const orchestration = queue.shift();
      const promise = this.categorizeOrchestration(orchestration)
        .then(result => ({
          orchestrationId: orchestration.id,
          success: true,
          result
        }))
        .catch(error => ({
          orchestrationId: orchestration.id,
          success: false,
          error: error.message
        }))
        .finally(() => {
          inFlight.delete(promise);
        });

      inFlight.add(promise);

      const result = await promise;
      results.push(result);

      // Continue processing if queue not empty
      if (queue.length > 0) {
        await processOne();
      }
    };

    // Start concurrent workers
    const workers = Array(Math.min(concurrency, orchestrations.length))
      .fill(null)
      .map(() => processOne());

    await Promise.all(workers);

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    this.logger.info('Batch categorization complete', {
      total: results.length,
      successful,
      failed,
      successRate: successful / results.length
    });

    return results;
  }

  /**
   * Check if AI categorization is available
   *
   * @returns {boolean} Availability status
   */
  isHealthy() {
    return this.isAvailable;
  }

  /**
   * Get categorization statistics and metrics
   *
   * @returns {Object} Statistics
   */
  getMetrics() {
    return {
      ...this.metrics,
      isAvailable: this.isAvailable,
      fallbackEnabled: this.options.fallbackToRules,
      successRate: this.metrics.totalRequests > 0
        ? this.metrics.successful / this.metrics.totalRequests
        : 0,
      fallbackRate: this.metrics.totalRequests > 0
        ? this.metrics.fallbacks / this.metrics.totalRequests
        : 0,
      aiUsageRate: this.metrics.totalRequests > 0
        ? this.metrics.aiCalls / this.metrics.totalRequests
        : 0
    };
  }

  /**
   * Update average duration metric
   *
   * @private
   * @param {number} startTime - Start time in ms
   */
  _updateAverageDuration(startTime) {
    const duration = Date.now() - startTime;
    this.metrics.totalDuration += duration;
    this.metrics.avgDuration = this.metrics.totalRequests > 0
      ? this.metrics.totalDuration / this.metrics.totalRequests
      : 0;
  }
}

module.exports = AICategorizationService;

/**
 * Usage Example:
 *
 * ```javascript
 * const AICategorizationService = require('./ai-categorizer');
 *
 * // Initialize with API key
 * const categorizer = new AICategorizationService(
 *   { apiKey: process.env.ANTHROPIC_API_KEY },
 *   {
 *     model: 'claude-3-5-sonnet-20241022',
 *     fallbackToRules: true
 *   }
 * );
 *
 * // Categorize single orchestration
 * const result = await categorizer.categorizeOrchestration({
 *   pattern: 'parallel',
 *   agentIds: ['agent-1', 'agent-2'],
 *   task: 'Implement user authentication',
 *   resultSummary: 'Successfully implemented JWT authentication',
 *   success: true,
 *   duration: 5000
 * });
 *
 * console.log('Type:', result.type);
 * console.log('Observation:', result.observation);
 * console.log('Concepts:', result.concepts);
 * console.log('Importance:', result.importance);
 * console.log('Source:', result.source); // 'ai' or 'rule-based'
 *
 * // Batch categorization
 * const batchResults = await categorizer.categorizeOrchestrationsBatch(
 *   orchestrations,
 *   { concurrency: 3 }
 * );
 *
 * // Check metrics
 * const metrics = categorizer.getMetrics();
 * console.log('Success rate:', metrics.successRate);
 * console.log('Fallback rate:', metrics.fallbackRate);
 * console.log('Average duration:', metrics.avgDuration);
 *
 * // Health check
 * const isHealthy = categorizer.isHealthy();
 * ```
 *
 * Graceful Degradation Example:
 *
 * ```javascript
 * // Initialize without API key - uses rules only
 * const fallbackCategorizer = new AICategorizationService(
 *   { apiKey: null },
 *   { fallbackToRules: true }
 * );
 *
 * // Will automatically use rule-based categorization
 * const result = await fallbackCategorizer.categorizeOrchestration(orchestration);
 * console.log('Source:', result.source); // 'rule-based'
 * ```
 */
