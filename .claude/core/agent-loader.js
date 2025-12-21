/**
 * Agent Auto-Discovery and Loading System
 *
 * Discovers agents from .claude/agents/ directory
 * Parses YAML frontmatter
 * Registers agents for orchestration
 *
 * @module agent-loader
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { createComponentLogger } = require('./logger');

const logger = createComponentLogger('AgentLoader');

class AgentLoader {
  /**
   * Create an AgentLoader
   * @param {string} agentsDir - Directory containing agent files
   */
  constructor(agentsDir = '.claude/agents') {
    this.agentsDir = agentsDir;
    this.agents = new Map();
    this.categories = new Set();
    this.capabilities = new Set();
    this.tags = new Set();
  }

  /**
   * Load all agents from directory
   * @returns {Promise<Map<string, Object>>} Map of agent name to agent config
   */
  async loadAll() {
    try {
      const agentFiles = this._discoverAgentFiles();
      logger.info(`Discovered ${agentFiles.length} agent files`);

      let successCount = 0;
      let failureCount = 0;

      for (const file of agentFiles) {
        try {
          const agent = await this._loadAgent(file);
          this.agents.set(agent.name, agent);

          // Track metadata for querying
          if (agent.category) this.categories.add(agent.category);
          if (agent.capabilities) {
            agent.capabilities.forEach(cap => this.capabilities.add(cap));
          }
          if (agent.tags) {
            agent.tags.forEach(tag => this.tags.add(tag));
          }

          successCount++;
          logger.debug(`Loaded agent: ${agent.name}`);
        } catch (error) {
          failureCount++;
          logger.warn(`Failed to load agent from ${file}:`, error.message);
        }
      }

      logger.info(`Agent loading complete: ${successCount} succeeded, ${failureCount} failed`);
      logger.info(`Total agents: ${this.agents.size}`);
      logger.info(`Categories: ${Array.from(this.categories).join(', ')}`);

      return this.agents;
    } catch (error) {
      logger.error('Failed to load agents:', error);
      throw error;
    }
  }

  /**
   * Discover agent files using recursive directory walk
   * @private
   * @returns {string[]} Array of agent file paths
   */
  _discoverAgentFiles() {
    const files = [];

    const walk = (dir) => {
      if (!fs.existsSync(dir)) {
        logger.warn(`Directory does not exist: ${dir}`);
        return;
      }

      const items = fs.readdirSync(dir);

      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          // Skip node_modules and hidden directories
          if (!item.startsWith('.') && item !== 'node_modules') {
            walk(fullPath);
          }
        } else if (item.endsWith('.md') && item !== 'README.md') {
          files.push(fullPath);
        }
      }
    };

    walk(this.agentsDir);
    return files;
  }

  /**
   * Load and parse agent file
   * @private
   * @param {string} filepath - Path to agent file
   * @returns {Object} Parsed agent configuration
   */
  async _loadAgent(filepath) {
    const content = fs.readFileSync(filepath, 'utf8');

    // Extract YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      throw new Error(`No YAML frontmatter found in ${filepath}`);
    }

    let metadata;
    try {
      metadata = yaml.load(frontmatterMatch[1]);
    } catch (error) {
      throw new Error(`Invalid YAML in ${filepath}: ${error.message}`);
    }

    // Validate required fields
    if (!metadata.name) {
      throw new Error(`Missing required field 'name' in ${filepath}`);
    }

    // Extract instructions (everything after frontmatter)
    const instructions = content.slice(frontmatterMatch[0].length).trim();

    // Determine category from directory structure if not specified
    const relativePath = path.relative(this.agentsDir, filepath);
    const dirParts = relativePath.split(path.sep);
    const categoryFromPath = dirParts.length > 1 ? dirParts[0] : 'general';

    return {
      ...metadata,
      instructions,
      filepath,
      category: metadata.category || categoryFromPath,
      // Set defaults
      model: metadata.model || 'claude-sonnet-4',
      temperature: metadata.temperature !== undefined ? metadata.temperature : 0.7,
      max_tokens: metadata.max_tokens || 4000,
      priority: metadata.priority || 'medium',
      capabilities: metadata.capabilities || [],
      tools: metadata.tools || [],
      tags: metadata.tags || []
    };
  }

  /**
   * Get agent by name
   * @param {string} name - Agent name
   * @returns {Object|undefined} Agent configuration
   */
  getAgent(name) {
    return this.agents.get(name);
  }

  /**
   * Get all agents as array
   * @returns {Object[]} Array of agent configurations
   */
  getAllAgents() {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents by category
   * @param {string} category - Category name (research, planning, design, etc.)
   * @returns {Object[]} Array of matching agents
   */
  getAgentsByCategory(category) {
    return Array.from(this.agents.values())
      .filter(agent => agent.category === category);
  }

  /**
   * Get agents by capability
   * @param {string} capability - Capability name
   * @returns {Object[]} Array of matching agents
   */
  getAgentsByCapability(capability) {
    return Array.from(this.agents.values())
      .filter(agent => agent.capabilities?.includes(capability));
  }

  /**
   * Get agents by tag
   * @param {string} tag - Tag name
   * @returns {Object[]} Array of matching agents
   */
  getAgentsByTag(tag) {
    return Array.from(this.agents.values())
      .filter(agent => agent.tags?.includes(tag));
  }

  /**
   * Get agents by phase
   * @param {string} phase - Phase name (research, planning, design, etc.)
   * @returns {Object[]} Array of matching agents
   */
  getAgentsByPhase(phase) {
    return Array.from(this.agents.values())
      .filter(agent => agent.phase === phase);
  }

  /**
   * Get agents by model
   * @param {string} model - Model identifier
   * @returns {Object[]} Array of matching agents
   */
  getAgentsByModel(model) {
    return Array.from(this.agents.values())
      .filter(agent => agent.model === model);
  }

  /**
   * Find best agent for task based on criteria
   * @param {Object} criteria - Search criteria
   * @param {string} criteria.phase - Preferred phase
   * @param {string[]} criteria.capabilities - Required capabilities
   * @param {string[]} criteria.tags - Preferred tags
   * @param {string} criteria.category - Preferred category
   * @returns {Object|null} Best matching agent or null
   */
  findAgentForTask(criteria) {
    let candidates = Array.from(this.agents.values());

    // Filter by phase if specified
    if (criteria.phase) {
      const phaseMatches = candidates.filter(a => a.phase === criteria.phase);
      if (phaseMatches.length > 0) {
        candidates = phaseMatches;
      }
    }

    // Filter by category if specified
    if (criteria.category) {
      const categoryMatches = candidates.filter(a => a.category === criteria.category);
      if (categoryMatches.length > 0) {
        candidates = categoryMatches;
      }
    }

    // Score by capability matches
    if (criteria.capabilities && criteria.capabilities.length > 0) {
      candidates = candidates.map(agent => {
        const matches = criteria.capabilities.filter(cap =>
          agent.capabilities?.includes(cap)
        ).length;
        return { agent, capabilityScore: matches };
      });

      // Keep only agents with at least one capability match
      candidates = candidates.filter(c => c.capabilityScore > 0);

      // Sort by capability score descending
      candidates.sort((a, b) => b.capabilityScore - a.capabilityScore);

      // Extract agents
      candidates = candidates.map(c => c.agent);
    }

    // Score by tag matches if specified
    if (criteria.tags && criteria.tags.length > 0) {
      candidates = candidates.map(agent => {
        const matches = criteria.tags.filter(tag =>
          agent.tags?.includes(tag)
        ).length;
        return { agent, tagScore: matches };
      });

      // Keep only agents with at least one tag match
      candidates = candidates.filter(c => c.tagScore > 0);

      // Sort by tag score descending
      candidates.sort((a, b) => b.tagScore - a.tagScore);

      // Extract agents
      candidates = candidates.map(c => c.agent);
    }

    // Sort by priority (high > medium > low)
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    candidates.sort((a, b) => {
      const priorityA = priorityOrder[a.priority] || 0;
      const priorityB = priorityOrder[b.priority] || 0;
      return priorityB - priorityA;
    });

    // Return best match
    return candidates.length > 0 ? candidates[0] : null;
  }

  /**
   * Get statistics about loaded agents
   * @returns {Object} Agent statistics
   */
  getStatistics() {
    const stats = {
      totalAgents: this.agents.size,
      byCategory: {},
      byPhase: {},
      byModel: {},
      byPriority: {},
      categories: Array.from(this.categories),
      capabilities: Array.from(this.capabilities),
      tags: Array.from(this.tags)
    };

    // Count by category
    for (const agent of this.agents.values()) {
      stats.byCategory[agent.category] = (stats.byCategory[agent.category] || 0) + 1;
      if (agent.phase) {
        stats.byPhase[agent.phase] = (stats.byPhase[agent.phase] || 0) + 1;
      }
      stats.byModel[agent.model] = (stats.byModel[agent.model] || 0) + 1;
      stats.byPriority[agent.priority] = (stats.byPriority[agent.priority] || 0) + 1;
    }

    return stats;
  }

  /**
   * Reload agents from disk
   * Useful for hot-reloading in development
   * @returns {Promise<Map<string, Object>>} Reloaded agents
   */
  async reload() {
    logger.info('Reloading agents from disk...');
    this.agents.clear();
    this.categories.clear();
    this.capabilities.clear();
    this.tags.clear();
    return await this.loadAll();
  }
}

module.exports = AgentLoader;
