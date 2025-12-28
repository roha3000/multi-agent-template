/**
 * DelegationContext - Minimal task-specific context for sub-agents
 *
 * Part of Hierarchy Phase 2 - builds optimized context packages
 * that achieve 67%+ token reduction vs full context.
 *
 * @module delegation-context
 */

const crypto = require('crypto');

// Default constraints
const DEFAULT_CONSTRAINTS = {
  tokenBudget: 8000,
  timeout: 60000,
  mustComplete: false,
  maxRetries: 3,
  qualityThreshold: 70
};

// Default quotas for child agents
const DEFAULT_CHILD_QUOTAS = {
  maxTokens: 8000,
  maxTime: 60000,
  maxChildren: 3
};

/**
 * DelegationContext class for building minimal context for sub-agents
 */
class DelegationContext {
  /**
   * Create a delegation context
   * @param {Object} config - Configuration object
   */
  constructor(config = {}) {
    this.delegationId = config.delegationId || `del-${crypto.randomUUID()}`;
    this.taskId = config.taskId || null;
    this.parentAgentId = config.parentAgentId || null;
    this.childAgentId = config.childAgentId || null;
    this.delegationDepth = config.delegationDepth || 0;

    // Task specification (minimal)
    this.task = {
      title: config.task?.title || '',
      description: config.task?.description || '',
      type: config.task?.type || 'default',
      acceptanceCriteria: (config.task?.acceptanceCriteria || []).slice(0, 5), // Top 5 only
      phase: config.task?.phase || 'implementation'
    };

    // Parent context (reference only)
    this.parentContext = {
      agentId: config.parentAgentId,
      role: config.parentContext?.role || 'coordinator',
      resourcesRemaining: {
        tokens: config.parentContext?.resourcesRemaining?.tokens || DEFAULT_CHILD_QUOTAS.maxTokens,
        time: config.parentContext?.resourcesRemaining?.time || DEFAULT_CHILD_QUOTAS.maxTime,
        children: config.parentContext?.resourcesRemaining?.children || DEFAULT_CHILD_QUOTAS.maxChildren
      }
    };

    // Constraints (hard limits)
    this.constraints = {
      tokenBudget: config.constraints?.tokenBudget || DEFAULT_CONSTRAINTS.tokenBudget,
      deadline: config.constraints?.deadline || new Date(Date.now() + DEFAULT_CONSTRAINTS.timeout),
      mustComplete: config.constraints?.mustComplete || DEFAULT_CONSTRAINTS.mustComplete,
      maxRetries: config.constraints?.maxRetries || DEFAULT_CONSTRAINTS.maxRetries,
      qualityThreshold: config.constraints?.qualityThreshold || DEFAULT_CONSTRAINTS.qualityThreshold
    };

    // Sliced context (~400 tokens)
    this.context = {
      phaseInfo: config.context?.phaseInfo || '',
      relatedArtifacts: (config.context?.relatedArtifacts || []).slice(0, 3), // Top 3 only
      blockingDependencies: config.context?.blockingDependencies || [],
      projectSummary: config.context?.projectSummary || ''
    };

    // Communication channels
    this.communication = {
      channels: {
        instructions: `delegation:${this.delegationId}:instructions`,
        progress: `delegation:${this.delegationId}:progress`,
        result: `delegation:${this.delegationId}:result`,
        error: `delegation:${this.delegationId}:error`,
        heartbeat: `delegation:${this.delegationId}:heartbeat`,
        abort: `delegation:${this.delegationId}:abort`
      },
      timeout: config.communication?.timeout || DEFAULT_CONSTRAINTS.timeout
    };

    // Metadata
    this.metadata = {
      createdAt: new Date(),
      estimatedTokens: 0,
      actualTokens: 0,
      tokenReduction: 0
    };

    // Calculate estimated tokens
    this._estimateTokens();
  }

  /**
   * Build a delegation context from parent agent, task, and subtask
   * @param {Object} parentAgent - Parent agent instance
   * @param {Object} task - Parent task object
   * @param {Object} subtask - Subtask to delegate
   * @param {Object} options - Additional options
   * @returns {DelegationContext}
   */
  static buildDelegationContext(parentAgent, task, subtask, options = {}) {
    const { messageBus, numChildren = 1, fullContextTokens = 7500 } = options;

    // Validate parent can delegate
    if (parentAgent && typeof parentAgent.canDelegate === 'function') {
      if (!parentAgent.canDelegate()) {
        throw new Error('Parent agent cannot delegate: quota or depth limit reached');
      }
    }

    // Calculate token budget
    const parentRemaining = parentAgent?.hierarchyConfig?.quotas?.remainingDelegations
      ? parentAgent.hierarchyConfig.quotas.maxTokensPerDelegation || DEFAULT_CHILD_QUOTAS.maxTokens
      : DEFAULT_CHILD_QUOTAS.maxTokens;

    const parentNeeds = 500; // Reserve for parent
    const tokenBudget = Math.max(500, Math.floor((parentRemaining - parentNeeds) / numChildren));

    // Calculate deadline
    const parentDeadline = task?.deadline ? new Date(task.deadline) : new Date(Date.now() + DEFAULT_CONSTRAINTS.timeout);
    const buffer = 60000; // 60s buffer for parent aggregation
    const elapsed = options.startTime ? Date.now() - options.startTime : 0;
    const deadline = new Date(parentDeadline.getTime() - buffer - elapsed);

    // Select relevant artifacts (top 3 by relevance or recency)
    const relatedArtifacts = DelegationContext._selectRelevantArtifacts(
      options.artifacts || [],
      subtask,
      400 // Max ~400 tokens for artifacts
    );

    // Build the context
    const context = new DelegationContext({
      delegationId: options.delegationId || `del-${parentAgent?.id || 'root'}-${Date.now()}`,
      taskId: subtask?.id || task?.id,
      parentAgentId: parentAgent?.id,
      childAgentId: options.childAgentId,
      delegationDepth: (parentAgent?.hierarchyConfig?.currentDepth || 0) + 1,

      task: {
        title: subtask?.title || task?.title || '',
        description: subtask?.description || task?.description || '',
        type: subtask?.type || task?.type || 'default',
        acceptanceCriteria: subtask?.acceptance || subtask?.acceptanceCriteria || task?.acceptance || [],
        phase: subtask?.phase || task?.phase || 'implementation'
      },

      parentContext: {
        role: parentAgent?.role || 'coordinator',
        resourcesRemaining: {
          tokens: parentRemaining,
          time: Math.max(0, parentDeadline.getTime() - Date.now()),
          children: parentAgent?.hierarchyConfig?.quotas?.remainingChildren || 5
        }
      },

      constraints: {
        tokenBudget,
        deadline,
        mustComplete: subtask?.mustComplete || task?.mustComplete || false,
        maxRetries: options.maxRetries || DEFAULT_CONSTRAINTS.maxRetries,
        qualityThreshold: options.qualityThreshold || DEFAULT_CONSTRAINTS.qualityThreshold
      },

      context: {
        phaseInfo: DelegationContext._summarizePhase(task?.phase),
        relatedArtifacts,
        blockingDependencies: (task?.depends?.requires || []).slice(0, 3),
        projectSummary: options.projectSummary || ''
      },

      communication: {
        timeout: options.timeout || DEFAULT_CONSTRAINTS.timeout
      }
    });

    // Calculate token reduction
    context.metadata.tokenReduction = Math.round(
      ((fullContextTokens - context.metadata.estimatedTokens) / fullContextTokens) * 100
    );

    return context;
  }

  /**
   * Select task-relevant artifacts only
   * @private
   */
  static _selectRelevantArtifacts(artifacts, subtask, maxTokens) {
    if (!artifacts || artifacts.length === 0) return [];

    // Score artifacts by relevance
    const scored = artifacts.map(artifact => {
      let relevance = 0;

      // Check for keyword matches in title/description
      const subtaskText = `${subtask?.title || ''} ${subtask?.description || ''}`.toLowerCase();
      const artifactText = `${artifact.path || ''} ${artifact.summary || ''}`.toLowerCase();

      const keywords = subtaskText.split(/\s+/).filter(w => w.length > 3);
      for (const keyword of keywords) {
        if (artifactText.includes(keyword)) relevance += 0.2;
      }

      // Boost recent artifacts
      if (artifact.timestamp) {
        const age = Date.now() - new Date(artifact.timestamp).getTime();
        if (age < 3600000) relevance += 0.3; // Less than 1 hour
        else if (age < 86400000) relevance += 0.1; // Less than 1 day
      }

      return { ...artifact, relevance: Math.min(1, relevance) };
    });

    // Sort by relevance and take top 3
    scored.sort((a, b) => b.relevance - a.relevance);
    const selected = scored.slice(0, 3);

    // Truncate content to fit token budget
    const tokensPerArtifact = Math.floor(maxTokens / selected.length);
    return selected.map(a => ({
      path: a.path,
      summary: DelegationContext._truncateToTokens(a.summary || a.content || '', tokensPerArtifact),
      relevance: a.relevance
    }));
  }

  /**
   * Summarize phase info (not full prompt)
   * @private
   */
  static _summarizePhase(phase) {
    const summaries = {
      research: 'Research phase: analyze, investigate, evaluate options',
      planning: 'Planning phase: create roadmap, estimate resources, map dependencies',
      design: 'Design phase: architect system, define APIs, create specifications',
      implementation: 'Implementation phase: write code, build features, integrate components',
      testing: 'Testing phase: write tests, verify functionality, ensure quality',
      validation: 'Validation phase: review work, check quality gates, approve changes',
      iteration: 'Iteration phase: refine, optimize, improve based on feedback'
    };
    return summaries[phase] || `Phase: ${phase}`;
  }

  /**
   * Truncate text to approximate token limit
   * @private
   */
  static _truncateToTokens(text, maxTokens) {
    if (!text) return '';
    // Rough estimate: 1 token ~= 4 characters
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) return text;
    return text.substring(0, maxChars - 3) + '...';
  }

  /**
   * Estimate tokens in the context
   * @private
   */
  _estimateTokens() {
    // Rough token estimation (1 token ~= 4 characters)
    const json = JSON.stringify({
      delegationId: this.delegationId,
      task: this.task,
      parentContext: this.parentContext,
      constraints: this.constraints,
      context: this.context,
      communication: this.communication
    });

    this.metadata.estimatedTokens = Math.ceil(json.length / 4);
    return this.metadata.estimatedTokens;
  }

  /**
   * Serialize context for transmission
   * @returns {Object}
   */
  toJSON() {
    return {
      delegationId: this.delegationId,
      taskId: this.taskId,
      parentAgentId: this.parentAgentId,
      childAgentId: this.childAgentId,
      delegationDepth: this.delegationDepth,
      task: this.task,
      parentContext: this.parentContext,
      constraints: this.constraints,
      context: this.context,
      communication: this.communication,
      metadata: this.metadata
    };
  }

  /**
   * Get the instruction channel topic
   */
  getInstructionChannel() {
    return this.communication.channels.instructions;
  }

  /**
   * Get the result channel topic
   */
  getResultChannel() {
    return this.communication.channels.result;
  }

  /**
   * Check if deadline has passed
   */
  isExpired() {
    return new Date() > new Date(this.constraints.deadline);
  }

  /**
   * Get remaining time in milliseconds
   */
  getRemainingTime() {
    return Math.max(0, new Date(this.constraints.deadline).getTime() - Date.now());
  }

  /**
   * Check if quality threshold is met
   * @param {number} score - Quality score to check
   */
  meetsQualityThreshold(score) {
    return score >= this.constraints.qualityThreshold;
  }
}

module.exports = { DelegationContext, DEFAULT_CONSTRAINTS, DEFAULT_CHILD_QUOTAS };
