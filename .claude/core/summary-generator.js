/**
 * Summary Generator - Generates PROJECT_SUMMARY.md
 *
 * Responsibilities:
 * - PROJECT_SUMMARY.md generation
 * - Template-based output
 * - Quality gate integration
 * - Progressive summary updates
 *
 * @module summary-generator
 */

const fs = require('fs');
const path = require('path');

/**
 * Summary template sections
 */
const SUMMARY_TEMPLATE = {
  header: `# Project Summary

**Last Updated**: {timestamp}
**Current Phase**: {current_phase}
**Overall Progress**: {progress}%

---
`,

  overview: `
## Project Overview

{overview_text}

### Key Objectives
{objectives}

---
`,

  phaseProgress: `
## Phase Progress

{phase_table}

---
`,

  qualityMetrics: `
## Quality Metrics

{quality_summary}

### Phase Scores
{score_table}

---
`,

  recentActivity: `
## Recent Activity

{activity_list}

---
`,

  keyDecisions: `
## Key Decisions

{decisions_list}

---
`,

  artifacts: `
## Generated Artifacts

{artifacts_by_phase}

---
`,

  blockers: `
## Active Issues

{blockers_list}

---
`,

  nextSteps: `
## Next Steps

{next_steps_list}

---
`
};

class SummaryGenerator {
  /**
   * Creates a SummaryGenerator instance
   * @param {string} projectRoot - Absolute path to project root
   * @param {Object} stateManager - StateManager instance
   */
  constructor(projectRoot, stateManager) {
    this.projectRoot = projectRoot;
    this.stateManager = stateManager;
    this.summaryPath = path.join(projectRoot, '.claude', 'PROJECT_SUMMARY.md');
  }

  /**
   * Generates complete PROJECT_SUMMARY.md
   * @param {Object} options - Generation options
   * @returns {string} Generated summary content
   */
  generate(options = {}) {
    try {
      console.log('[SummaryGenerator] Generating PROJECT_SUMMARY.md...');

      const state = this.stateManager.load();
      const sections = [];

      // 1. Header
      sections.push(this._generateHeader(state));

      // 2. Overview (if available or provided)
      if (options.overview || this._hasOverview()) {
        sections.push(this._generateOverview(state, options.overview));
      }

      // 3. Phase Progress
      sections.push(this._generatePhaseProgress(state));

      // 4. Quality Metrics
      sections.push(this._generateQualityMetrics(state));

      // 5. Recent Activity
      sections.push(this._generateRecentActivity(state));

      // 6. Key Decisions
      if (state.decisions.length > 0) {
        sections.push(this._generateKeyDecisions(state));
      }

      // 7. Artifacts
      sections.push(this._generateArtifacts(state));

      // 8. Active Blockers
      const unresolvedBlockers = state.blockers.filter(b => !b.resolved);
      if (unresolvedBlockers.length > 0) {
        sections.push(this._generateBlockers(unresolvedBlockers));
      }

      // 9. Next Steps
      sections.push(this._generateNextSteps(state));

      const summary = sections.join('\n');

      // Save to file
      this._saveSummary(summary);

      console.log('[SummaryGenerator] PROJECT_SUMMARY.md generated successfully');
      return summary;

    } catch (error) {
      console.error('[SummaryGenerator] Error generating summary:', error.message);
      return this._generateErrorSummary(error);
    }
  }

  /**
   * Generates header section
   * @param {Object} state - Project state
   * @returns {string} Header markdown
   * @private
   */
  _generateHeader(state) {
    const progress = this._calculateProgress(state);
    const timestamp = new Date().toISOString();

    return SUMMARY_TEMPLATE.header
      .replace('{timestamp}', timestamp)
      .replace('{current_phase}', this._formatPhaseName(state.current_phase))
      .replace('{progress}', progress);
  }

  /**
   * Generates overview section
   * @param {Object} state - Project state
   * @param {string} customOverview - Custom overview text
   * @returns {string} Overview markdown
   * @private
   */
  _generateOverview(state, customOverview = null) {
    const overviewText = customOverview || this._extractOverview() ||
      'Multi-agent development project using intelligent phase management.';

    const objectives = this._extractObjectives() || [
      'Complete all development phases with quality standards',
      'Maintain comprehensive documentation',
      'Deliver production-ready code'
    ];

    const objectivesList = objectives
      .map(obj => `- ${obj}`)
      .join('\n');

    return SUMMARY_TEMPLATE.overview
      .replace('{overview_text}', overviewText)
      .replace('{objectives}', objectivesList);
  }

  /**
   * Generates phase progress section
   * @param {Object} state - Project state
   * @returns {string} Phase progress markdown
   * @private
   */
  _generatePhaseProgress(state) {
    const phases = [
      'research',
      'planning',
      'design',
      'test-first',
      'implementation',
      'validation',
      'iteration'
    ];

    const rows = [];
    rows.push('| Phase | Status | Quality Score | Artifacts |');
    rows.push('|-------|--------|---------------|-----------|');

    for (const phase of phases) {
      const status = this._getPhaseStatus(phase, state);
      const score = state.quality_scores[phase] || 'N/A';
      const artifactCount = (state.artifacts[phase] || []).length;
      const currentMarker = phase === state.current_phase ? ' 👉' : '';

      const scoreDisplay = typeof score === 'number' ? `${score}/100` : score;

      rows.push(`| ${this._formatPhaseName(phase)}${currentMarker} | ${status} | ${scoreDisplay} | ${artifactCount} |`);
    }

    return SUMMARY_TEMPLATE.phaseProgress.replace('{phase_table}', rows.join('\n'));
  }

  /**
   * Generates quality metrics section
   * @param {Object} state - Project state
   * @returns {string} Quality metrics markdown
   * @private
   */
  _generateQualityMetrics(state) {
    const scores = state.quality_scores;
    const scoreCount = Object.keys(scores).length;

    if (scoreCount === 0) {
      return SUMMARY_TEMPLATE.qualityMetrics
        .replace('{quality_summary}', 'No quality scores recorded yet.')
        .replace('{score_table}', '');
    }

    // Calculate averages
    const scoreValues = Object.values(scores);
    const averageScore = scoreValues.reduce((sum, s) => sum + s, 0) / scoreValues.length;
    const minScore = Math.min(...scoreValues);
    const maxScore = Math.max(...scoreValues);

    const summary = [
      `**Average Score**: ${averageScore.toFixed(1)}/100`,
      `**Highest Score**: ${maxScore}/100`,
      `**Lowest Score**: ${minScore}/100`,
      `**Phases Completed**: ${scoreCount}/7`
    ].join('  \n');

    // Score table
    const rows = [];
    rows.push('| Phase | Score | Status |');
    rows.push('|-------|-------|--------|');

    for (const [phase, score] of Object.entries(scores)) {
      const status = this._getScoreStatus(score, phase);
      rows.push(`| ${this._formatPhaseName(phase)} | ${score}/100 | ${status} |`);
    }

    return SUMMARY_TEMPLATE.qualityMetrics
      .replace('{quality_summary}', summary)
      .replace('{score_table}', rows.join('\n'));
  }

  /**
   * Generates recent activity section
   * @param {Object} state - Project state
   * @returns {string} Recent activity markdown
   * @private
   */
  _generateRecentActivity(state) {
    const history = state.phase_history.slice(-10).reverse(); // Last 10 transitions

    if (history.length === 0) {
      return SUMMARY_TEMPLATE.recentActivity
        .replace('{activity_list}', '- No activity recorded yet');
    }

    const activities = history.map(entry => {
      const timestamp = new Date(entry.timestamp).toLocaleString();
      const scoreText = entry.score ? ` (Score: ${entry.score}/100)` : '';
      return `- **${this._formatPhaseName(entry.phase)}** by ${entry.agent}${scoreText}  \n  _${timestamp}_`;
    });

    return SUMMARY_TEMPLATE.recentActivity
      .replace('{activity_list}', activities.join('\n\n'));
  }

  /**
   * Generates key decisions section
   * @param {Object} state - Project state
   * @returns {string} Key decisions markdown
   * @private
   */
  _generateKeyDecisions(state) {
    const decisions = state.decisions.slice(-10).reverse(); // Last 10 decisions

    const decisionsList = decisions.map((decision, index) => {
      const timestamp = new Date(decision.timestamp).toLocaleString();
      return [
        `### ${index + 1}. ${decision.decision}`,
        '',
        `**Phase**: ${this._formatPhaseName(decision.phase)}  `,
        `**Agent**: ${decision.agent || 'Unknown'}  `,
        `**When**: ${timestamp}`,
        '',
        `**Rationale**: ${decision.rationale}`,
        ''
      ].join('\n');
    });

    return SUMMARY_TEMPLATE.keyDecisions
      .replace('{decisions_list}', decisionsList.join('\n'));
  }

  /**
   * Generates artifacts section
   * @param {Object} state - Project state
   * @returns {string} Artifacts markdown
   * @private
   */
  _generateArtifacts(state) {
    const artifactsByPhase = [];

    for (const [phase, artifacts] of Object.entries(state.artifacts)) {
      if (artifacts.length === 0) continue;

      artifactsByPhase.push(`### ${this._formatPhaseName(phase)}`);
      artifactsByPhase.push('');

      for (const artifact of artifacts) {
        artifactsByPhase.push(`- \`${artifact}\``);
      }

      artifactsByPhase.push('');
    }

    if (artifactsByPhase.length === 0) {
      return SUMMARY_TEMPLATE.artifacts
        .replace('{artifacts_by_phase}', 'No artifacts generated yet.');
    }

    return SUMMARY_TEMPLATE.artifacts
      .replace('{artifacts_by_phase}', artifactsByPhase.join('\n'));
  }

  /**
   * Generates blockers section
   * @param {Array} blockers - Array of unresolved blockers
   * @returns {string} Blockers markdown
   * @private
   */
  _generateBlockers(blockers) {
    const blockersList = blockers.map(blocker => {
      const timestamp = new Date(blocker.timestamp).toLocaleString();
      const severityEmoji = {
        low: '🟢',
        medium: '🟡',
        high: '🟠',
        critical: '🔴'
      }[blocker.severity] || '⚪';

      return [
        `### ${severityEmoji} ${blocker.severity.toUpperCase()}: ${blocker.blocker}`,
        '',
        `**Phase**: ${this._formatPhaseName(blocker.phase)}  `,
        `**Reported**: ${timestamp}`,
        ''
      ].join('\n');
    });

    return SUMMARY_TEMPLATE.blockers
      .replace('{blockers_list}', blockersList.join('\n'));
  }

  /**
   * Generates next steps section
   * @param {Object} state - Project state
   * @returns {string} Next steps markdown
   * @private
   */
  _generateNextSteps(state) {
    const steps = this._inferNextSteps(state);

    const stepsList = steps.map((step, index) => {
      return `${index + 1}. ${step}`;
    });

    return SUMMARY_TEMPLATE.nextSteps
      .replace('{next_steps_list}', stepsList.join('\n'));
  }

  /**
   * Calculates overall project progress percentage
   * @param {Object} state - Project state
   * @returns {number} Progress percentage
   * @private
   */
  _calculateProgress(state) {
    const phaseOrder = [
      'research', 'planning', 'design', 'test-first',
      'implementation', 'validation', 'iteration'
    ];

    const currentIndex = phaseOrder.indexOf(state.current_phase);
    const completedPhases = Object.keys(state.quality_scores).length;

    // Base progress on completed phases
    const baseProgress = (completedPhases / phaseOrder.length) * 100;

    // Add partial credit for current phase
    const currentProgress = currentIndex >= 0 ? (currentIndex / phaseOrder.length) * 10 : 0;

    return Math.min(100, Math.round(baseProgress + currentProgress));
  }

  /**
   * Gets phase status (Not Started | In Progress | Completed)
   * @param {string} phase - Phase name
   * @param {Object} state - Project state
   * @returns {string} Status string
   * @private
   */
  _getPhaseStatus(phase, state) {
    if (state.current_phase === phase) {
      return '🔄 In Progress';
    }

    if (state.quality_scores[phase] !== undefined) {
      return '✅ Completed';
    }

    // Check if phase has been visited
    const visited = state.phase_history.some(h => h.phase === phase);
    if (visited) {
      return '⏸️ Started';
    }

    return '⏳ Not Started';
  }

  /**
   * Gets score status based on quality thresholds
   * @param {number} score - Quality score
   * @param {string} phase - Phase name
   * @returns {string} Status emoji/text
   * @private
   */
  _getScoreStatus(score, phase) {
    const thresholds = {
      research: 80,
      planning: 85,
      design: 85,
      'test-first': 90,
      implementation: 90,
      validation: 85,
      iteration: 85
    };

    const threshold = thresholds[phase] || 80;

    if (score >= threshold + 10) return '🌟 Excellent';
    if (score >= threshold) return '✅ Passed';
    if (score >= threshold - 5) return '⚠️ Marginal';
    return '❌ Below Standard';
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
   * Infers next steps based on current state
   * @param {Object} state - Project state
   * @returns {Array} Array of next step strings
   * @private
   */
  _inferNextSteps(state) {
    const steps = [];
    const currentPhase = state.current_phase;

    // Check for blockers
    const unresolvedBlockers = state.blockers.filter(b => !b.resolved);
    const criticalBlockers = unresolvedBlockers.filter(b => b.severity === 'critical');

    if (criticalBlockers.length > 0) {
      steps.push(`⚠️ Resolve ${criticalBlockers.length} critical blocker(s)`);
    }

    // Current phase suggestions
    const currentScore = state.quality_scores[currentPhase];
    if (currentScore === undefined) {
      steps.push(`Complete ${this._formatPhaseName(currentPhase)} phase deliverables`);
      steps.push(`Run quality gate check for ${this._formatPhaseName(currentPhase)}`);
    }

    // Next phase suggestions
    const phaseOrder = ['research', 'planning', 'design', 'test-first', 'implementation', 'validation', 'iteration'];
    const currentIndex = phaseOrder.indexOf(currentPhase);

    if (currentScore !== undefined && currentIndex < phaseOrder.length - 1) {
      const nextPhase = phaseOrder[currentIndex + 1];
      steps.push(`Transition to ${this._formatPhaseName(nextPhase)} phase`);
    }

    // Default suggestions
    if (steps.length === 0) {
      steps.push('Continue current phase work');
      steps.push('Update artifacts and documentation');
      steps.push('Run validation checks');
    }

    return steps;
  }

  /**
   * Checks if overview exists in existing summary
   * @returns {boolean} Whether overview exists
   * @private
   */
  _hasOverview() {
    try {
      if (!fs.existsSync(this.summaryPath)) return false;

      const content = fs.readFileSync(this.summaryPath, 'utf8');
      return content.includes('## Project Overview');

    } catch (error) {
      return false;
    }
  }

  /**
   * Extracts overview from existing summary
   * @returns {string|null} Overview text or null
   * @private
   */
  _extractOverview() {
    try {
      if (!fs.existsSync(this.summaryPath)) return null;

      const content = fs.readFileSync(this.summaryPath, 'utf8');
      const match = content.match(/## Project Overview\s+([\s\S]+?)(?=###|##|\n---)/);

      return match ? match[1].trim() : null;

    } catch (error) {
      return null;
    }
  }

  /**
   * Extracts objectives from existing summary
   * @returns {Array|null} Array of objectives or null
   * @private
   */
  _extractObjectives() {
    try {
      if (!fs.existsSync(this.summaryPath)) return null;

      const content = fs.readFileSync(this.summaryPath, 'utf8');
      const match = content.match(/### Key Objectives\s+([\s\S]+?)(?=###|##|\n---)/);

      if (!match) return null;

      const objectives = match[1]
        .split('\n')
        .filter(line => line.trim().startsWith('-'))
        .map(line => line.replace(/^-\s*/, '').trim());

      return objectives.length > 0 ? objectives : null;

    } catch (error) {
      return null;
    }
  }

  /**
   * Saves summary to file
   * @param {string} content - Summary content
   * @private
   */
  _saveSummary(content) {
    try {
      fs.writeFileSync(this.summaryPath, content, 'utf8');
      console.log(`[SummaryGenerator] Saved to ${this.summaryPath}`);
    } catch (error) {
      console.error('[SummaryGenerator] Error saving summary:', error.message);
      throw error;
    }
  }

  /**
   * Generates error summary when generation fails
   * @param {Error} error - Error object
   * @returns {string} Error summary
   * @private
   */
  _generateErrorSummary(error) {
    return `# Project Summary

**Error**: Failed to generate summary

\`\`\`
${error.message}
${error.stack}
\`\`\`

Please check the project state and try again.
`;
  }

  /**
   * Updates existing summary (incremental update)
   * @returns {boolean} Success status
   */
  update() {
    try {
      this.generate();
      return true;
    } catch (error) {
      console.error('[SummaryGenerator] Error updating summary:', error.message);
      return false;
    }
  }
}

module.exports = SummaryGenerator;
