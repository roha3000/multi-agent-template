/**
 * Session Initializer - Orchestrates all core components
 *
 * Responsibilities:
 * - Orchestrates all core components
 * - Handles new vs existing projects
 * - Builds session prompts
 * - Phase inference and transition
 *
 * @module session-init
 */

const fs = require('fs');
const path = require('path');

// Import all core components
const StateManager = require('./state-manager');
const PhaseInference = require('./phase-inference');
const ContextLoader = require('./context-loader');
const ArtifactSummarizer = require('./artifact-summarizer');
const SummaryGenerator = require('./summary-generator');

/**
 * Session initialization modes
 */
const INIT_MODES = {
  NEW: 'new',           // New project, first session
  EXISTING: 'existing', // Existing project, continuation
  RESUME: 'resume',     // Resume after break
  EXPLICIT: 'explicit'  // Explicit phase specified by user
};

class SessionInitializer {
  /**
   * Creates a SessionInitializer instance
   * @param {string} projectRoot - Absolute path to project root
   */
  constructor(projectRoot) {
    this.projectRoot = projectRoot;

    // Initialize all core components
    this.stateManager = new StateManager(projectRoot);
    this.phaseInference = new PhaseInference(this.stateManager);
    this.contextLoader = new ContextLoader(projectRoot, this.stateManager);
    this.artifactSummarizer = new ArtifactSummarizer(projectRoot);
    this.summaryGenerator = new SummaryGenerator(projectRoot, this.stateManager);

    console.log('[SessionInit] Initialized all core components');
  }

  /**
   * Initializes a session based on user input
   * @param {string} userInput - User's message or command
   * @param {Object} options - Initialization options
   * @returns {Object} Session initialization result
   */
  initialize(userInput = '', options = {}) {
    try {
      console.log('[SessionInit] Starting session initialization...');

      // 1. Determine initialization mode
      const mode = this._determineMode(options);
      console.log(`[SessionInit] Mode: ${mode}`);

      // 2. Load or create project state
      const state = this.stateManager.load();

      // 3. Infer target phase (now returns full inference info)
      const inferenceResult = this._inferTargetPhaseWithDetails(userInput, state, options);
      const targetPhase = inferenceResult.phase;
      console.log(`[SessionInit] Target phase: ${targetPhase}`);

      // 4. Validate phase transition
      const transitionValidation = this._validateTransition(state.current_phase, targetPhase);

      if (!transitionValidation.valid && !options.force) {
        return this._createTransitionError(transitionValidation, state);
      }

      // 5. Load context for target phase
      const context = this.contextLoader.loadContext(targetPhase);

      // 6. Update project summary if needed
      if (mode !== INIT_MODES.NEW) {
        this._updateProjectSummary(state);
      }

      // 7. Build session prompt
      const sessionPrompt = this._buildSessionPrompt(context, state, targetPhase, userInput);

      // 8. Prepare transition (if phase changed)
      const willTransition = targetPhase !== state.current_phase;

      // 9. Build result with inference details
      const result = {
        success: true,
        mode: mode,
        currentPhase: state.current_phase,
        targetPhase: targetPhase,
        agent: inferenceResult.agent,
        confidence: inferenceResult.confidence,
        reasoning: inferenceResult.reasoning,
        willTransition: willTransition,
        phaseTransition: willTransition ? { from: state.current_phase, to: targetPhase } : null,
        transitionValidation: transitionValidation,
        context: context,
        sessionPrompt: sessionPrompt,
        state: state,
        recommendations: this._generateRecommendations(state, targetPhase),
        metadata: {
          timestamp: new Date().toISOString(),
          tokenCount: context.totalTokens,
          userInput: userInput
        }
      };

      console.log('[SessionInit] Session initialized successfully');
      return result;

    } catch (error) {
      console.error('[SessionInit] Initialization failed:', error.message);
      return this._createErrorResult(error);
    }
  }

  /**
   * Executes phase transition
   * @param {string} newPhase - New phase to transition to
   * @param {string} agent - Agent executing the phase
   * @param {string} trigger - What triggered the transition
   * @param {number} score - Quality score for previous phase (if applicable)
   * @returns {Object} Transition result
   */
  executeTransition(newPhase, agent, trigger, score = null) {
    try {
      console.log(`[SessionInit] Executing transition to ${newPhase}...`);

      // Update state with new phase
      const state = this.stateManager.transitionPhase(newPhase, agent, trigger, score);

      // Update project summary
      this.summaryGenerator.update();

      // Clean expired cache
      this.artifactSummarizer.cleanExpiredCache();

      console.log(`[SessionInit] Successfully transitioned to ${newPhase}`);

      return {
        success: true,
        phase: newPhase,
        state: state,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('[SessionInit] Transition failed:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Records an artifact
   * @param {string} artifactPath - Relative path to artifact
   * @param {string} phase - Phase that generated the artifact
   * @returns {Object} Result
   */
  recordArtifact(artifactPath, phase = null) {
    try {
      const state = this.stateManager.load();
      const targetPhase = phase || state.current_phase;

      this.stateManager.addArtifact(targetPhase, artifactPath);

      // Generate summary for the artifact
      this.artifactSummarizer.summarize(artifactPath);

      console.log(`[SessionInit] Recorded artifact: ${artifactPath} (${targetPhase})`);

      return {
        success: true,
        artifact: artifactPath,
        phase: targetPhase
      };

    } catch (error) {
      console.error('[SessionInit] Failed to record artifact:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Records a decision
   * @param {string} decision - Decision description
   * @param {string} rationale - Rationale
   * @param {string} agent - Agent who made the decision
   * @returns {Object} Result
   */
  recordDecision(decision, rationale, agent) {
    try {
      const state = this.stateManager.load();
      this.stateManager.addDecision(decision, rationale, state.current_phase, agent);

      console.log('[SessionInit] Recorded decision');

      return {
        success: true,
        decision: decision
      };

    } catch (error) {
      console.error('[SessionInit] Failed to record decision:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Determines initialization mode
   * @param {Object} options - Initialization options
   * @returns {string} Mode constant
   * @private
   */
  _determineMode(options) {
    if (options.mode) {
      return options.mode;
    }

    // Check if state exists
    const statePath = path.join(this.projectRoot, '.claude', 'state', 'project-state.json');

    if (!fs.existsSync(statePath)) {
      return INIT_MODES.NEW;
    }

    // Check if user explicitly specified a phase
    if (options.explicitPhase) {
      return INIT_MODES.EXPLICIT;
    }

    return INIT_MODES.EXISTING;
  }

  /**
   * Infers target phase from user input and state
   * @param {string} userInput - User input
   * @param {Object} state - Project state
   * @param {Object} options - Options
   * @returns {string} Target phase
   * @private
   */
  _inferTargetPhase(userInput, state, options) {
    // 1. Explicit phase override
    if (options.explicitPhase) {
      return options.explicitPhase;
    }

    // 2. Infer from user input if provided
    if (userInput && userInput.trim().length > 0) {
      const inference = this.phaseInference.infer(userInput, state.current_phase);

      if (inference.phase && inference.confidence >= 0.6) {
        console.log(`[SessionInit] Inferred phase: ${inference.phase} (confidence: ${inference.confidence})`);
        return inference.phase;
      }

      // Log suggestions if inference wasn't confident
      if (inference.suggestions.length > 0) {
        console.log('[SessionInit] Phase suggestions:', inference.suggestions);
      }
    }

    // 3. Fall back to current phase
    return state.current_phase;
  }

  /**
   * Infer target phase with full details (agent, confidence, reasoning)
   * @param {string} userInput - User input
   * @param {Object} state - Current project state
   * @param {Object} options - Options
   * @returns {Object} Full inference result with phase, agent, confidence, reasoning
   * @private
   */
  _inferTargetPhaseWithDetails(userInput, state, options) {
    const AGENT_MAP = {
      'research': 'Research Analyst',
      'planning': 'Strategic Planner',
      'design': 'System Architect',
      'test-first': 'Test Engineer',
      'implementation': 'Senior Developer',
      'validation': 'Quality Analyst',
      'iteration': 'Innovation Lead'
    };

    // 1. Explicit phase override
    if (options.explicitPhase) {
      return {
        phase: options.explicitPhase,
        agent: AGENT_MAP[options.explicitPhase] || 'Unknown Agent',
        confidence: 100,
        reasoning: 'Explicitly specified by user'
      };
    }

    // 2. Infer from user input if provided
    if (userInput && userInput.trim().length > 0) {
      const inference = this.phaseInference.infer(userInput, state.current_phase);

      if (inference.phase && inference.confidence >= 0.6) {
        console.log(`[SessionInit] Inferred phase: ${inference.phase} (confidence: ${Math.round(inference.confidence * 100)}%)`);
        return {
          phase: inference.phase,
          agent: AGENT_MAP[inference.phase] || 'Unknown Agent',
          confidence: Math.round(inference.confidence * 100),
          reasoning: inference.reasoning
        };
      }

      // Log suggestions if inference wasn't confident
      if (inference.suggestions.length > 0) {
        console.log('[SessionInit] Phase suggestions:', inference.suggestions);
      }
    }

    // 3. Fall back to current phase
    const currentPhase = state.current_phase;
    return {
      phase: currentPhase,
      agent: AGENT_MAP[currentPhase] || 'Unknown Agent',
      confidence: 100,
      reasoning: userInput ? 'Low confidence in inference, continuing current phase' : 'Resuming current phase'
    };
  }

  /**
   * Validates phase transition
   * @param {string} fromPhase - Current phase
   * @param {string} toPhase - Target phase
   * @returns {Object} Validation result
   * @private
   */
  _validateTransition(fromPhase, toPhase) {
    // Same phase is always valid
    if (fromPhase === toPhase) {
      return {
        valid: true,
        reason: 'Continuing current phase'
      };
    }

    // Check if transition is valid
    const isValid = this.phaseInference._isValidTransition(fromPhase, toPhase);

    if (isValid) {
      return {
        valid: true,
        reason: `Valid transition from ${fromPhase} to ${toPhase}`
      };
    }

    const validNext = this.phaseInference.getValidNextPhases(fromPhase);

    return {
      valid: false,
      reason: `Invalid transition from ${fromPhase} to ${toPhase}`,
      validTransitions: validNext,
      suggestion: validNext.length > 0 ? validNext[0] : null
    };
  }

  /**
   * Updates project summary
   * @param {Object} state - Project state
   * @private
   */
  _updateProjectSummary(state) {
    try {
      // Only update if state has meaningful progress
      if (state.phase_history.length > 0 || Object.keys(state.quality_scores).length > 0) {
        this.summaryGenerator.update();
      }
    } catch (error) {
      console.error('[SessionInit] Failed to update project summary:', error.message);
      // Non-critical, continue
    }
  }

  /**
   * Builds complete session prompt
   * @param {Object} context - Loaded context
   * @param {Object} state - Project state
   * @param {string} targetPhase - Target phase
   * @param {string} userInput - User input
   * @returns {string} Complete session prompt
   * @private
   */
  _buildSessionPrompt(context, state, targetPhase, userInput) {
    const sections = [];

    // 1. System context (bootstrap + project summary + state)
    sections.push('# SYSTEM CONTEXT\n');
    sections.push(this.contextLoader.assemblePrompt(context));

    // 2. Phase-specific guidance
    sections.push('\n# CURRENT PHASE GUIDANCE\n');
    sections.push(`You are now operating in the **${this._formatPhaseName(targetPhase)}** phase.`);
    sections.push('');

    // 3. User input context
    if (userInput && userInput.trim().length > 0) {
      sections.push('\n# USER REQUEST\n');
      sections.push(userInput);
      sections.push('');
    }

    // 4. Action items
    const actionItems = this._generateActionItems(state, targetPhase);
    if (actionItems.length > 0) {
      sections.push('\n# RECOMMENDED ACTIONS\n');
      sections.push(actionItems.map((item, i) => `${i + 1}. ${item}`).join('\n'));
      sections.push('');
    }

    // 5. Blockers warning
    const unresolvedBlockers = state.blockers.filter(b => !b.resolved);
    const criticalBlockers = unresolvedBlockers.filter(b => b.severity === 'critical');

    if (criticalBlockers.length > 0) {
      sections.push('\n# ⚠️ CRITICAL BLOCKERS\n');
      criticalBlockers.forEach(blocker => {
        sections.push(`- ${blocker.blocker}`);
      });
      sections.push('');
    }

    return sections.join('\n');
  }

  /**
   * Generates action items for current session
   * @param {Object} state - Project state
   * @param {string} targetPhase - Target phase
   * @returns {Array} Array of action item strings
   * @private
   */
  _generateActionItems(state, targetPhase) {
    const items = [];

    // Check if current phase needs quality gate
    const currentScore = state.quality_scores[targetPhase];
    if (currentScore === undefined) {
      items.push(`Complete ${this._formatPhaseName(targetPhase)} phase deliverables`);
    }

    // Check for missing artifacts
    const artifacts = state.artifacts[targetPhase] || [];
    if (artifacts.length === 0) {
      items.push(`Generate artifacts for ${this._formatPhaseName(targetPhase)} phase`);
    }

    // Check for blockers
    const unresolvedBlockers = state.blockers.filter(b => !b.resolved);
    if (unresolvedBlockers.length > 0) {
      items.push(`Address ${unresolvedBlockers.length} unresolved blocker(s)`);
    }

    return items;
  }

  /**
   * Generates recommendations
   * @param {Object} state - Project state
   * @param {string} targetPhase - Target phase
   * @returns {Object} Recommendations
   * @private
   */
  _generateRecommendations(state, targetPhase) {
    const recommendations = {
      immediate: [],
      shortTerm: [],
      longTerm: []
    };

    // Immediate recommendations
    const unresolvedBlockers = state.blockers.filter(b => !b.resolved);
    const criticalBlockers = unresolvedBlockers.filter(b => b.severity === 'critical');

    if (criticalBlockers.length > 0) {
      recommendations.immediate.push('Resolve critical blockers before proceeding');
    }

    const currentScore = state.quality_scores[targetPhase];
    if (currentScore !== undefined && currentScore < 80) {
      recommendations.immediate.push('Improve quality score before moving to next phase');
    }

    // Short-term recommendations
    const nextPhase = this.phaseInference.suggestNextPhase(state);
    if (nextPhase.phase !== targetPhase) {
      recommendations.shortTerm.push(`Consider transitioning to ${nextPhase.phase} phase: ${nextPhase.reasoning}`);
    }

    recommendations.shortTerm.push('Keep PROJECT_SUMMARY.md updated');
    recommendations.shortTerm.push('Document key decisions and rationale');

    // Long-term recommendations
    recommendations.longTerm.push('Maintain comprehensive test coverage');
    recommendations.longTerm.push('Regular code reviews and quality checks');
    recommendations.longTerm.push('Update documentation as project evolves');

    return recommendations;
  }

  /**
   * Creates transition error result
   * @param {Object} validation - Validation result
   * @param {Object} state - Project state
   * @returns {Object} Error result
   * @private
   */
  _createTransitionError(validation, state) {
    return {
      success: false,
      error: 'invalid_transition',
      message: validation.reason,
      currentPhase: state.current_phase,
      attemptedPhase: validation.toPhase,
      validTransitions: validation.validTransitions,
      suggestion: validation.suggestion,
      canForce: true
    };
  }

  /**
   * Creates error result
   * @param {Error} error - Error object
   * @returns {Object} Error result
   * @private
   */
  _createErrorResult(error) {
    return {
      success: false,
      error: 'initialization_failed',
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Formats phase name for display
   * @param {string} phase - Phase name
   * @returns {string} Formatted name
   * @private
   */
  _formatPhaseName(phase) {
    const names = {
      'research': 'Research',
      'planning': 'Planning',
      'design': 'Design',
      'test-first': 'Test-First',
      'implementation': 'Implementation',
      'validation': 'Validation',
      'iteration': 'Iteration'
    };

    return names[phase] || phase;
  }

  /**
   * Gets current project status
   * @returns {Object} Status object
   */
  getStatus() {
    try {
      const state = this.stateManager.load();
      const unresolvedBlockers = state.blockers.filter(b => !b.resolved);
      const cacheStats = this.artifactSummarizer.getCacheStats();

      return {
        currentPhase: state.current_phase,
        phaseHistory: state.phase_history.length,
        qualityScores: state.quality_scores,
        totalArtifacts: Object.values(state.artifacts).reduce((sum, arr) => sum + arr.length, 0),
        unresolvedBlockers: unresolvedBlockers.length,
        criticalBlockers: unresolvedBlockers.filter(b => b.severity === 'critical').length,
        decisions: state.decisions.length,
        cacheStats: cacheStats,
        lastUpdated: state.last_updated
      };

    } catch (error) {
      console.error('[SessionInit] Failed to get status:', error.message);
      return {
        error: error.message
      };
    }
  }

  /**
   * Exports project state and summary
   * @param {string} outputDir - Directory to export to
   * @returns {Object} Export result
   */
  export(outputDir) {
    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Export state
      const stateJson = this.stateManager.export();
      const statePath = path.join(outputDir, 'project-state.json');
      fs.writeFileSync(statePath, stateJson, 'utf8');

      // Copy PROJECT_SUMMARY.md
      const summaryPath = path.join(this.projectRoot, '.claude', 'PROJECT_SUMMARY.md');
      if (fs.existsSync(summaryPath)) {
        const summaryContent = fs.readFileSync(summaryPath, 'utf8');
        const exportSummaryPath = path.join(outputDir, 'PROJECT_SUMMARY.md');
        fs.writeFileSync(exportSummaryPath, summaryContent, 'utf8');
      }

      console.log(`[SessionInit] Exported to ${outputDir}`);

      return {
        success: true,
        files: [statePath, path.join(outputDir, 'PROJECT_SUMMARY.md')]
      };

    } catch (error) {
      console.error('[SessionInit] Export failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Resets project state (use with caution)
   * @param {boolean} confirm - Must be true to execute
   * @returns {Object} Reset result
   */
  reset(confirm = false) {
    if (!confirm) {
      return {
        success: false,
        error: 'Reset requires explicit confirmation'
      };
    }

    try {
      this.stateManager.reset();
      this.artifactSummarizer.clearCache();

      console.log('[SessionInit] Project state reset');

      return {
        success: true,
        message: 'Project state has been reset to default'
      };

    } catch (error) {
      console.error('[SessionInit] Reset failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = SessionInitializer;
