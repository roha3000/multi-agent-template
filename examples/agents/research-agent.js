/**
 * Research Agent - Example agent for research and analysis tasks
 *
 * Demonstrates:
 * - Extending the base Agent class
 * - Implementing custom execute() logic
 * - Using state management
 * - Recording execution history
 */

const Agent = require('../../.claude/core/agent');

class ResearchAgent extends Agent {
  constructor(id, messageBus, config = {}) {
    super(id, 'Researcher', messageBus, {
      timeout: 120000, // Research can take longer
      retries: 3,
      ...config
    });

    this.researchHistory = [];
    this.expertise = config.expertise || 'general';
  }

  /**
   * Execute a research task
   * @param {Object} task - Research task
   * @param {Object} context - Execution context
   */
  async execute(task, context = {}) {
    this.setState('working');
    const startTime = Date.now();

    try {
      this.logger.info('Starting research task', {
        taskType: task.type,
        expertise: this.expertise
      });

      let result;

      switch (task.type) {
        case 'analyze':
          result = await this._analyzeData(task);
          break;

        case 'summarize':
          result = await this._summarizeInformation(task);
          break;

        case 'compare':
          result = await this._compareOptions(task);
          break;

        case 'investigate':
          result = await this._investigateTopic(task);
          break;

        default:
          throw new Error(`Unknown research task type: ${task.type}`);
      }

      // Record in history
      this.researchHistory.push({
        timestamp: new Date().toISOString(),
        task,
        result
      });

      const duration = Date.now() - startTime;
      this._recordExecution(task, result, duration);

      this.setState('completed');

      this.logger.info('Research task completed', {
        taskType: task.type,
        duration
      });

      return {
        success: true,
        agentId: this.id,
        role: this.role,
        expertise: this.expertise,
        ...result
      };

    } catch (error) {
      this.logger.error('Research task failed', {
        error: error.message,
        taskType: task.type
      });

      this.setState('failed');

      const duration = Date.now() - startTime;
      this._recordExecution(task, { success: false, error: error.message }, duration);

      throw error;
    }
  }

  /**
   * Analyze data and provide insights
   * @private
   */
  async _analyzeData(task) {
    // Simulate analysis
    await this._simulateWork(500);

    const { data, focus } = task;

    return {
      taskType: 'analyze',
      analysis: `Analysis of ${focus || 'data'}: Based on the provided data, ` +
        `identified ${Math.floor(Math.random() * 5) + 3} key patterns and insights.`,
      insights: [
        `Insight 1: Trend analysis shows ${this.expertise} patterns`,
        `Insight 2: Data correlation indicates dependencies`,
        `Insight 3: Outliers detected in specific areas`
      ],
      confidence: 0.85,
      recommendations: [
        'Further investigation recommended',
        'Collect additional data points',
        'Validate findings with domain experts'
      ]
    };
  }

  /**
   * Summarize information concisely
   * @private
   */
  async _summarizeInformation(task) {
    await this._simulateWork(300);

    const { content, maxLength } = task;

    return {
      taskType: 'summarize',
      summary: `Summary: ${content ? content.substring(0, maxLength || 200) : 'No content provided'}...`,
      keyPoints: [
        'Key point 1: Main theme identified',
        'Key point 2: Supporting details extracted',
        'Key point 3: Conclusions drawn'
      ],
      wordCount: maxLength || 200
    };
  }

  /**
   * Compare multiple options
   * @private
   */
  async _compareOptions(task) {
    await this._simulateWork(400);

    const { options, criteria } = task;

    return {
      taskType: 'compare',
      comparison: options.map((option, idx) => ({
        option,
        score: Math.random() * 100,
        pros: [`Pro ${idx + 1}a`, `Pro ${idx + 1}b`],
        cons: [`Con ${idx + 1}a`, `Con ${idx + 1}b`]
      })),
      recommendation: options[0],
      reasoning: `Based on ${criteria || 'standard'} criteria, option 1 appears most favorable`
    };
  }

  /**
   * Investigate a topic in depth
   * @private
   */
  async _investigateTopic(task) {
    await this._simulateWork(600);

    const { topic, depth } = task;

    return {
      taskType: 'investigate',
      topic,
      depth: depth || 'comprehensive',
      findings: {
        overview: `Comprehensive investigation of ${topic}`,
        details: [
          'Detail 1: Historical context and background',
          'Detail 2: Current state and trends',
          'Detail 3: Future projections and implications'
        ],
        sources: [
          'Primary research materials',
          'Domain expert interviews',
          'Published literature'
        ]
      },
      nextSteps: [
        'Deep dive into specific aspect',
        'Validate with stakeholders',
        'Document findings'
      ]
    };
  }

  /**
   * Simulate work being done
   * @private
   */
  async _simulateWork(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get research history summary
   */
  getResearchSummary() {
    return {
      agentId: this.id,
      expertise: this.expertise,
      totalResearchTasks: this.researchHistory.length,
      history: this.researchHistory,
      stats: this.getStats()
    };
  }
}

module.exports = ResearchAgent;
