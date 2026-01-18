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
const QualityGateEnforcer = require('./quality-gate-enforcer');

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
    this.phaseInference = new PhaseInference(this.stateManager, { projectRoot });
    this.contextLoader = new ContextLoader(projectRoot, this.stateManager);
    this.artifactSummarizer = new ArtifactSummarizer(projectRoot);
    this.summaryGenerator = new SummaryGenerator(projectRoot, this.stateManager);
    this.qualityGateEnforcer = new QualityGateEnforcer(projectRoot);

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

      // 2.5. Auto-archive completed tasks to keep tasks.json lean
      this._autoArchiveCompletedTasks();

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
   * Executes phase transition with quality gate validation
   * @param {string} newPhase - New phase to transition to
   * @param {string} agent - Agent executing the phase
   * @param {string} trigger - What triggered the transition
   * @param {number} score - Quality score for previous phase (if applicable)
   * @param {Object} options - Transition options
   * @param {boolean} options.force - Force transition even if gates fail
   * @param {string} options.forceReason - Required reason when forcing
   * @param {boolean} options.skipGates - Skip quality gate validation entirely
   * @returns {Object} Transition result
   */
  executeTransition(newPhase, agent, trigger, score = null, options = {}) {
    try {
      const state = this.stateManager.load();
      const fromPhase = state.current_phase;

      console.log(`[SessionInit] Executing transition from ${fromPhase} to ${newPhase}...`);

      // Validate quality gates unless explicitly skipped
      if (!options.skipGates) {
        const gateResult = this.phaseInference.validateTransitionWithGates(
          fromPhase,
          newPhase,
          {
            qualityScore: score,
            force: options.force,
            forceReason: options.forceReason,
            actor: agent
          }
        );

        if (!gateResult.valid) {
          console.warn(`[SessionInit] Quality gate validation failed for ${newPhase}`);
          return {
            success: false,
            error: 'quality_gate_failed',
            message: gateResult.reason,
            errors: gateResult.errors,
            warnings: gateResult.warnings,
            metrics: gateResult.metrics,
            requirements: gateResult.requirements,
            canForce: gateResult.canForce,
            timestamp: new Date().toISOString()
          };
        }

        // Log warnings even on success
        if (gateResult.warnings && gateResult.warnings.length > 0) {
          gateResult.warnings.forEach(w => console.warn(`[SessionInit] Warning: ${w}`));
        }

        // Log if transition was forced
        if (gateResult.forced) {
          console.warn(`[SessionInit] Transition FORCED: ${options.forceReason}`);
        }
      }

      // Update state with new phase
      const updatedState = this.stateManager.transitionPhase(newPhase, agent, trigger, score);

      // Update project summary
      this.summaryGenerator.update();

      // Clean expired cache
      this.artifactSummarizer.cleanExpiredCache();

      console.log(`[SessionInit] Successfully transitioned to ${newPhase}`);

      return {
        success: true,
        phase: newPhase,
        state: updatedState,
        timestamp: new Date().toISOString(),
        forced: options.force && options.forceReason ? true : false
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
   * Get quality gate report for current state
   * @returns {Object} Quality report with coverage, tests, and recommendations
   */
  getQualityReport() {
    return this.qualityGateEnforcer.generateReport();
  }

  /**
   * Get quality gate audit log
   * @param {number} limit - Maximum entries to return
   * @returns {Array} Audit entries
   */
  getQualityAuditLog(limit = 50) {
    return this.qualityGateEnforcer.getAuditLog(limit);
  }

  /**
   * Records an artifact
   * @param {string} artifactPath - Relative path to artifact
   * @param {string} phase - Phase that generated the artifact
   * @param {Object} promptInfo - Optional prompt tracking information
   * @param {string} promptInfo.prompt - The prompt that created this artifact
   * @param {string} promptInfo.agent - Agent that created the artifact
   * @param {string} promptInfo.changeType - Type of change (created|modified|refactored|enhanced|bug-fix)
   * @param {string} promptInfo.changeSummary - Summary of changes
   * @returns {Object} Result
   */
  recordArtifact(artifactPath, phase = null, promptInfo = null) {
    try {
      const state = this.stateManager.load();
      const targetPhase = phase || state.current_phase;

      this.stateManager.addArtifact(targetPhase, artifactPath);

      // Generate summary for the artifact
      this.artifactSummarizer.summarize(artifactPath);

      // Track prompt if provided
      if (promptInfo && promptInfo.prompt) {
        const agent = promptInfo.agent || this._getAgentForPhase(targetPhase);
        this.stateManager.recordPrompt(promptInfo.prompt, {
          artifactPath: artifactPath,
          phase: targetPhase,
          agent: agent,
          artifactsCreated: [artifactPath],
          changeType: promptInfo.changeType || 'created',
          changeSummary: promptInfo.changeSummary
        });
      }

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
   * Auto-archive completed tasks to keep tasks.json lean
   * Runs the archive logic inline to avoid spawning a subprocess
   * @private
   */
  _autoArchiveCompletedTasks() {
    try {
      const tasksPath = path.join(this.projectRoot, '.claude', 'dev-docs', 'tasks.json');
      const archivePath = path.join(this.projectRoot, '.claude', 'dev-docs', 'archives', 'tasks-archive.json');

      if (!fs.existsSync(tasksPath)) return;

      const tasksData = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
      if (!tasksData.archival?.autoArchive) return;

      const maxCompleted = tasksData.archival.maxCompleted || 5;
      const completedIds = tasksData.backlog?.completed?.tasks || [];

      // Find all completed task definitions
      const allCompletedDefs = Object.entries(tasksData.tasks || {})
        .filter(([id, task]) => task.status === 'completed')
        .map(([id, task]) => ({ id, task, parentTaskId: task.parentTaskId }));

      // Get completed parents with timestamps
      const completedParents = completedIds
        .map(id => {
          const task = tasksData.tasks[id];
          if (!task) return null;
          return {
            id,
            task,
            completedAt: task.completedAt ? new Date(task.completedAt).getTime() :
                         task.completed ? new Date(task.completed).getTime() : 0
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.completedAt - a.completedAt);

      const parentsToKeep = completedParents.slice(0, maxCompleted);
      const parentsToArchive = completedParents.slice(maxCompleted);
      const archiveParentIds = new Set(parentsToArchive.map(t => t.id));

      // Find children to archive (completed children of completed parents)
      const childrenToArchive = allCompletedDefs.filter(({ id, parentTaskId }) => {
        if (!parentTaskId) return false;
        const parent = tasksData.tasks[parentTaskId];
        if (parent && parent.status === 'completed') return true;
        if (archiveParentIds.has(parentTaskId)) return true;
        return false;
      });

      const tasksToArchive = [
        ...parentsToArchive,
        ...childrenToArchive.map(({ id, task }) => ({ id, task }))
      ];

      if (tasksToArchive.length === 0 && parentsToKeep.length <= maxCompleted) {
        return; // Nothing to archive
      }

      // Load or create archive
      let archive = { archivedAt: new Date().toISOString(), tasks: {} };
      if (fs.existsSync(archivePath)) {
        archive = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
      }

      // Archive tasks
      tasksToArchive.forEach(({ id, task }) => {
        archive.tasks[id] = task;
        delete tasksData.tasks[id];
      });

      // Slim down kept completed parents
      parentsToKeep.forEach(({ id, task }) => {
        archive.tasks[id + '_full'] = task;
        tasksData.tasks[id] = {
          id: task.id,
          title: task.title,
          description: task.description?.substring(0, 100) + (task.description?.length > 100 ? '...' : ''),
          phase: task.phase,
          status: task.status,
          completedAt: task.completedAt || task.completed,
          completionNotes: task.completionNotes,
          childTaskIds: task.childTaskIds,
          parentTaskId: task.parentTaskId
        };
      });

      // Slim completed children of in-progress parents
      Object.entries(tasksData.tasks).forEach(([id, task]) => {
        if (task.status === 'completed' && task.parentTaskId) {
          const parent = tasksData.tasks[task.parentTaskId];
          if (parent && parent.status !== 'completed') {
            archive.tasks[id + '_full'] = task;
            tasksData.tasks[id] = {
              id: task.id,
              title: task.title,
              phase: task.phase,
              status: task.status,
              parentTaskId: task.parentTaskId,
              completedAt: task.completedAt,
              completionNotes: task.completionNotes
            };
          }
        }
      });

      // Update backlog
      tasksData.backlog.completed.tasks = parentsToKeep.map(t => t.id);
      tasksData.archival.lastArchived = new Date().toISOString();

      // Ensure archive directory exists
      const archiveDir = path.dirname(archivePath);
      if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true });
      }

      // Write files
      fs.writeFileSync(archivePath, JSON.stringify(archive, null, 2));
      fs.writeFileSync(tasksPath, JSON.stringify(tasksData, null, 2));

      if (tasksToArchive.length > 0) {
        console.log(`[SessionInit] Auto-archived ${tasksToArchive.length} completed tasks`);
      }
    } catch (error) {
      console.warn('[SessionInit] Auto-archive warning:', error.message);
      // Non-fatal - continue with session init
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
        artifacts: state.artifacts,
        totalArtifacts: Object.values(state.artifacts).reduce((sum, arr) => sum + arr.length, 0),
        unresolvedBlockers: unresolvedBlockers.length,
        criticalBlockers: unresolvedBlockers.filter(b => b.severity === 'critical').length,
        decisions: state.decisions,
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
   * @param {string} outputDir - Optional directory to export to. If not provided, returns data without writing files.
   * @returns {Object} Export result
   */
  export(outputDir = null) {
    try {
      // Get state and summary
      const state = this.stateManager.load();
      const summaryPath = path.join(this.projectRoot, '.claude', 'PROJECT_SUMMARY.md');
      let summary = null;

      if (fs.existsSync(summaryPath)) {
        summary = fs.readFileSync(summaryPath, 'utf8');
      }

      // If no outputDir, return data without writing files
      if (!outputDir) {
        return {
          success: true,
          state: state,
          summary: summary
        };
      }

      // Write to files
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Export state
      const stateJson = this.stateManager.export();
      const statePath = path.join(outputDir, 'project-state.json');
      fs.writeFileSync(statePath, stateJson, 'utf8');

      // Copy PROJECT_SUMMARY.md
      if (summary) {
        const exportSummaryPath = path.join(outputDir, 'PROJECT_SUMMARY.md');
        fs.writeFileSync(exportSummaryPath, summary, 'utf8');
      }

      console.log(`[SessionInit] Exported to ${outputDir}`);

      return {
        success: true,
        state: state,
        summary: summary,
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

  // ============================================================================
  // PROMPT TRACEABILITY METHODS
  // ============================================================================

  /**
   * Gets the appropriate agent for a phase
   * @param {string} phase - Phase name
   * @returns {string} Agent name
   * @private
   */
  _getAgentForPhase(phase) {
    const agentMap = {
      'research': 'Research Analyst',
      'planning': 'Strategic Planner',
      'design': 'System Architect',
      'test-first': 'Test Engineer',
      'implementation': 'Senior Developer',
      'validation': 'Quality Analyst',
      'iteration': 'Innovation Lead'
    };
    return agentMap[phase] || 'Unknown Agent';
  }

  /**
   * Records a prompt for session tracking
   * @param {string} prompt - The user prompt or task
   * @param {Object} options - Tracking options
   * @param {string} options.phase - Phase when prompt was given
   * @param {string} options.agent - Agent processing the prompt
   * @param {Array<string>} options.artifactsCreated - Artifacts created
   * @param {Array<string>} options.artifactsModified - Artifacts modified
   * @param {number} options.qualityImpact - Impact on quality (+/-)
   * @returns {Object} Result with prompt entry
   */
  recordPrompt(prompt, options = {}) {
    try {
      const state = this.stateManager.load();

      const promptOptions = {
        phase: options.phase || state.current_phase,
        agent: options.agent || this._getAgentForPhase(options.phase || state.current_phase),
        artifactsCreated: options.artifactsCreated || [],
        artifactsModified: options.artifactsModified || [],
        qualityImpact: options.qualityImpact
      };

      const promptEntry = this.stateManager.recordPrompt(prompt, promptOptions);

      console.log(`[SessionInit] Recorded prompt: ${promptEntry.id}`);

      return {
        success: true,
        promptEntry: promptEntry
      };

    } catch (error) {
      console.error('[SessionInit] Failed to record prompt:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Records an artifact modification with prompt tracking
   * @param {string} artifactPath - Path to artifact
   * @param {string} prompt - Prompt that caused modification
   * @param {Object} options - Additional options
   * @param {string} options.changeType - Type of change
   * @param {string} options.changeSummary - Summary of changes
   * @param {string} options.agent - Agent making changes
   * @returns {Object} Result
   */
  recordArtifactModification(artifactPath, prompt, options = {}) {
    try {
      const state = this.stateManager.load();
      const phase = options.phase || state.current_phase;
      const agent = options.agent || this._getAgentForPhase(phase);

      // Record the prompt with artifact modification info
      this.stateManager.recordPrompt(prompt, {
        artifactPath: artifactPath,
        phase: phase,
        agent: agent,
        artifactsModified: [artifactPath],
        changeType: options.changeType || 'modified',
        changeSummary: options.changeSummary
      });

      console.log(`[SessionInit] Recorded artifact modification: ${artifactPath}`);

      return {
        success: true,
        artifact: artifactPath,
        phase: phase
      };

    } catch (error) {
      console.error('[SessionInit] Failed to record modification:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Gets the complete history of an artifact
   * @param {string} artifactPath - Path to artifact
   * @returns {Object|null} Artifact history or null
   */
  getArtifactHistory(artifactPath) {
    try {
      return this.stateManager.getArtifactHistory(artifactPath);
    } catch (error) {
      console.error('[SessionInit] Failed to get artifact history:', error.message);
      return null;
    }
  }

  /**
   * Gets all prompts for current session
   * @returns {Array} Array of prompt entries
   */
  getSessionPrompts() {
    try {
      return this.stateManager.getSessionPrompts();
    } catch (error) {
      console.error('[SessionInit] Failed to get session prompts:', error.message);
      return [];
    }
  }

  /**
   * Gets prompts by phase
   * @param {string} phase - Phase name
   * @returns {Array} Array of prompt entries
   */
  getPromptsByPhase(phase) {
    try {
      return this.stateManager.getPromptsByPhase(phase);
    } catch (error) {
      console.error('[SessionInit] Failed to get prompts by phase:', error.message);
      return [];
    }
  }

  /**
   * Gets prompt statistics
   * @returns {Object} Statistics object
   */
  getPromptStatistics() {
    try {
      return this.stateManager.getPromptStatistics();
    } catch (error) {
      console.error('[SessionInit] Failed to get prompt statistics:', error.message);
      return null;
    }
  }

  /**
   * Searches prompts by keyword
   * @param {string} keyword - Search keyword
   * @returns {Array} Matching prompts
   */
  searchPrompts(keyword) {
    try {
      return this.stateManager.searchPrompts(keyword);
    } catch (error) {
      console.error('[SessionInit] Failed to search prompts:', error.message);
      return [];
    }
  }
}

module.exports = SessionInitializer;
