/**
 * Skill Recommender
 *
 * Analyzes user prompts and usage patterns to recommend new skills
 * that should be created, helping the framework learn and improve over time.
 *
 * @module core/skill-recommender
 */

const fs = require('fs');
const path = require('path');

/**
 * Analyzes usage patterns to recommend skills
 */
class SkillRecommender {
  constructor(memoryStore, skillsDir = '.claude/skills') {
    this.memoryStore = memoryStore;
    this.skillsDir = skillsDir;
  }

  /**
   * Analyzes user prompts to identify recurring topics
   *
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} - Analysis results
   */
  async analyzeUsagePatterns(options = {}) {
    const {
      daysBack = 30,
      minFrequency = 3,
      minRelevance = 0.6
    } = options;

    // Get recent orchestrations from memory
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    const orchestrations = await this.memoryStore.getOrchestrations({
      since: cutoffDate.toISOString(),
      limit: 1000
    });

    // Extract topics from prompts
    const topics = this.extractTopics(orchestrations);

    // Count frequency of each topic
    const topicFrequency = this.calculateTopicFrequency(topics);

    // Filter by minimum frequency
    const frequentTopics = Object.entries(topicFrequency)
      .filter(([topic, count]) => count >= minFrequency)
      .map(([topic, count]) => ({
        topic,
        frequency: count,
        percentage: count / orchestrations.length,
        samples: this.getSamplePrompts(orchestrations, topic, 5)
      }))
      .sort((a, b) => b.frequency - a.frequency);

    return {
      totalPrompts: orchestrations.length,
      daysAnalyzed: daysBack,
      frequentTopics,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Extracts topics from orchestration prompts
   *
   * @param {Array} orchestrations - List of orchestrations
   * @returns {Array<string>} - Extracted topics
   */
  extractTopics(orchestrations) {
    const topics = [];

    for (const orch of orchestrations) {
      const prompt = orch.context?.prompt || orch.prompt || '';
      const words = prompt.toLowerCase().split(/\s+/);

      // Common topic keywords
      const topicKeywords = [
        'api', 'rest', 'graphql', 'database', 'sql', 'nosql',
        'testing', 'unit', 'integration', 'e2e',
        'authentication', 'authorization', 'security',
        'performance', 'optimization', 'caching',
        'deployment', 'docker', 'kubernetes', 'ci/cd',
        'react', 'vue', 'angular', 'frontend',
        'node', 'express', 'backend',
        'typescript', 'javascript', 'python',
        'debugging', 'logging', 'monitoring',
        'design', 'architecture', 'patterns'
      ];

      // Extract matching topics
      for (const keyword of topicKeywords) {
        if (words.includes(keyword)) {
          topics.push(keyword);
        }
      }

      // Extract multi-word topics
      const multiWordTopics = [
        'api testing', 'database optimization', 'error handling',
        'state management', 'code review', 'performance testing'
      ];

      const lowerPrompt = prompt.toLowerCase();
      for (const topic of multiWordTopics) {
        if (lowerPrompt.includes(topic)) {
          topics.push(topic);
        }
      }
    }

    return topics;
  }

  /**
   * Calculates frequency of each topic
   *
   * @param {Array<string>} topics - List of topics
   * @returns {Object} - Topic frequency map
   */
  calculateTopicFrequency(topics) {
    const frequency = {};

    for (const topic of topics) {
      frequency[topic] = (frequency[topic] || 0) + 1;
    }

    return frequency;
  }

  /**
   * Gets sample prompts for a topic
   *
   * @param {Array} orchestrations - List of orchestrations
   * @param {string} topic - Topic to search for
   * @param {number} limit - Maximum samples
   * @returns {Array<string>} - Sample prompts
   */
  getSamplePrompts(orchestrations, topic, limit = 5) {
    const samples = [];

    for (const orch of orchestrations) {
      if (samples.length >= limit) break;

      const prompt = orch.context?.prompt || orch.prompt || '';
      if (prompt.toLowerCase().includes(topic)) {
        samples.push(prompt);
      }
    }

    return samples;
  }

  /**
   * Recommends skills that should be created
   *
   * @param {Object} options - Recommendation options
   * @returns {Promise<Object>} - Skill recommendations
   */
  async recommendSkills(options = {}) {
    const {
      minFrequency = 5,
      excludeExisting = true
    } = options;

    // Analyze usage patterns
    const analysis = await this.analyzeUsagePatterns({ minFrequency });

    // Get existing skills
    const existingSkills = excludeExisting
      ? this.getExistingSkillTopics()
      : [];

    // Filter out existing skills
    const recommendations = analysis.frequentTopics
      .filter(topic => !this.hasExistingSkill(topic.topic, existingSkills))
      .map(topic => ({
        skillName: this.normalizeSkillName(topic.topic),
        topic: topic.topic,
        frequency: topic.frequency,
        percentage: (topic.percentage * 100).toFixed(1) + '%',
        reason: `Mentioned in ${topic.frequency} prompts (${(topic.percentage * 100).toFixed(1)}% of all activity)`,
        samples: topic.samples.slice(0, 3),
        priority: this.calculatePriority(topic),
        suggestedPath: this.getSuggestedPath(topic.topic),
        estimatedValue: this.estimateValue(topic)
      }))
      .sort((a, b) => b.priority - a.priority);

    return {
      totalRecommendations: recommendations.length,
      recommendations,
      analysisDate: analysis.timestamp,
      existingSkills: existingSkills.length
    };
  }

  /**
   * Gets topics from existing skills
   *
   * @returns {Array<string>} - Existing skill topics
   */
  getExistingSkillTopics() {
    const topics = [];

    try {
      if (!fs.existsSync(this.skillsDir)) {
        return topics;
      }

      const files = this.getAllSkillFiles(this.skillsDir);

      for (const file of files) {
        // Extract topic from filename
        const basename = path.basename(file, '.md');
        const topic = basename.replace(/-/g, ' ');
        topics.push(topic);
      }
    } catch (error) {
      console.error('Error reading skills:', error.message);
    }

    return topics;
  }

  /**
   * Recursively gets all skill files
   *
   * @param {string} dir - Directory to search
   * @returns {Array<string>} - Skill file paths
   */
  getAllSkillFiles(dir) {
    const files = [];

    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);

      if (item.isDirectory()) {
        files.push(...this.getAllSkillFiles(fullPath));
      } else if (item.isFile() && item.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Checks if a skill already exists for the topic
   *
   * @param {string} topic - Topic to check
   * @param {Array<string>} existingSkills - Existing skill topics
   * @returns {boolean} - True if skill exists
   */
  hasExistingSkill(topic, existingSkills) {
    const normalized = this.normalizeSkillName(topic);

    return existingSkills.some(skill => {
      const skillNormalized = skill.toLowerCase().replace(/\s+/g, '-');
      return skillNormalized === normalized || skill.includes(topic);
    });
  }

  /**
   * Normalizes topic into skill name
   *
   * @param {string} topic - Topic string
   * @returns {string} - Normalized skill name
   */
  normalizeSkillName(topic) {
    return topic.toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }

  /**
   * Gets suggested file path for skill
   *
   * @param {string} topic - Skill topic
   * @returns {string} - Suggested path
   */
  getSuggestedPath(topic) {
    const categories = {
      'testing': ['testing', 'unit', 'integration', 'e2e'],
      'development': ['typescript', 'javascript', 'react', 'vue', 'node'],
      'deployment': ['docker', 'kubernetes', 'ci/cd', 'deployment'],
      'database': ['database', 'sql', 'nosql', 'optimization'],
      'security': ['authentication', 'authorization', 'security'],
      'performance': ['performance', 'optimization', 'caching']
    };

    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => topic.includes(keyword))) {
        return path.join(this.skillsDir, category, `${this.normalizeSkillName(topic)}.md`);
      }
    }

    return path.join(this.skillsDir, `${this.normalizeSkillName(topic)}.md`);
  }

  /**
   * Calculates priority for skill recommendation
   *
   * @param {Object} topic - Topic data
   * @returns {number} - Priority score (0-100)
   */
  calculatePriority(topic) {
    // Base score from frequency
    let score = Math.min(topic.frequency * 5, 50);

    // Bonus for high percentage
    if (topic.percentage > 0.1) score += 20;
    if (topic.percentage > 0.2) score += 10;

    // Bonus for having good sample prompts
    if (topic.samples.length >= 3) score += 10;

    // Cap at 100
    return Math.min(score, 100);
  }

  /**
   * Estimates value of creating the skill
   *
   * @param {Object} topic - Topic data
   * @returns {string} - Value estimate (high/medium/low)
   */
  estimateValue(topic) {
    if (topic.frequency >= 10 && topic.percentage >= 0.15) {
      return 'high';
    } else if (topic.frequency >= 5 && topic.percentage >= 0.08) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * Generates skill template from samples
   *
   * @param {Object} recommendation - Skill recommendation
   * @returns {string} - Generated skill content
   */
  generateSkillTemplate(recommendation) {
    const { skillName, topic, samples } = recommendation;

    const lines = [
      `# ${topic.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}`,
      '',
      `Guide for ${topic} based on recurring usage patterns.`,
      '',
      '## Overview',
      '',
      `This skill was automatically recommended based on ${recommendation.frequency} prompts about ${topic}.`,
      '',
      '## Common Patterns',
      '',
      '### Sample Use Cases',
      ''
    ];

    for (const [index, sample] of samples.entries()) {
      lines.push(`${index + 1}. ${sample}`);
    }

    lines.push('');
    lines.push('## Best Practices');
    lines.push('');
    lines.push('*TODO: Add best practices based on common usage*');
    lines.push('');
    lines.push('## Examples');
    lines.push('');
    lines.push('```');
    lines.push('// TODO: Add code examples');
    lines.push('```');
    lines.push('');
    lines.push('## Resources');
    lines.push('');
    lines.push('*TODO: Add relevant resources and documentation links*');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Creates a new skill file
   *
   * @param {Object} recommendation - Skill recommendation
   * @param {boolean} autoGenerate - Auto-generate template
   * @returns {Promise<string>} - Created file path
   */
  async createSkill(recommendation, autoGenerate = true) {
    const filepath = recommendation.suggestedPath;

    // Create directory if needed
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Generate content
    const content = autoGenerate
      ? this.generateSkillTemplate(recommendation)
      : `# ${recommendation.topic}\n\n*TODO: Add skill content*\n`;

    // Write file
    fs.writeFileSync(filepath, content, 'utf-8');

    console.log(`✓ Created skill: ${filepath}`);

    return filepath;
  }
}

module.exports = SkillRecommender;
