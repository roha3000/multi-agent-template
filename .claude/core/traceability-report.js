/**
 * Traceability Report Generator
 *
 * Generates comprehensive reports showing:
 * - Artifact evolution history
 * - Prompt-to-artifact mapping
 * - Agent contributions
 * - Phase transitions
 * - Quality impact analysis
 *
 * @module traceability-report
 */

const StateManager = require('./state-manager');
const path = require('path');
const fs = require('fs');

class TraceabilityReport {
  /**
   * Creates a TraceabilityReport instance
   * @param {string} projectRoot - Absolute path to project root
   */
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.stateManager = new StateManager(projectRoot);
  }

  /**
   * Generates a full traceability report in Markdown format
   * @param {Object} options - Report options
   * @param {boolean} options.includeStatistics - Include statistics section
   * @param {boolean} options.includeTimeline - Include timeline view
   * @param {boolean} options.includeArtifacts - Include artifact lineage
   * @param {string} options.filterPhase - Filter by specific phase
   * @param {string} options.filterAgent - Filter by specific agent
   * @returns {string} Markdown report
   */
  generateFullReport(options = {}) {
    const {
      includeStatistics = true,
      includeTimeline = true,
      includeArtifacts = true,
      filterPhase = null,
      filterAgent = null
    } = options;

    const state = this.stateManager.load();
    const stats = this.stateManager.getPromptStatistics();

    let report = '# Artifact Traceability Report\n\n';
    report += `**Generated**: ${new Date().toISOString()}\n`;
    report += `**Project**: ${state.metadata?.project_name || 'Unknown'}\n`;
    report += `**Current Phase**: ${state.current_phase}\n\n`;

    report += '---\n\n';

    // Statistics Section
    if (includeStatistics) {
      report += this._generateStatisticsSection(stats, filterPhase, filterAgent);
      report += '\n---\n\n';
    }

    // Timeline Section
    if (includeTimeline) {
      report += this._generateTimelineSection(state, filterPhase, filterAgent);
      report += '\n---\n\n';
    }

    // Artifact Lineage Section
    if (includeArtifacts) {
      report += this._generateArtifactLineageSection(state, filterPhase, filterAgent);
    }

    return report;
  }

  /**
   * Generates statistics section
   * @private
   */
  _generateStatisticsSection(stats, filterPhase, filterAgent) {
    let section = '## 📊 Statistics\n\n';

    section += `### Overview\n\n`;
    section += `- **Total Prompts**: ${stats.totalPrompts}\n`;
    section += `- **Total Sessions**: ${stats.totalSessions}\n`;
    section += `- **Avg Prompts/Session**: ${stats.avgPromptsPerSession}\n`;
    section += `- **Total Artifacts**: ${stats.totalArtifacts}\n`;
    section += `- **Total Modifications**: ${stats.totalModifications}\n\n`;

    // By Phase
    if (Object.keys(stats.byPhase).length > 0) {
      section += `### By Phase\n\n`;
      section += '| Phase | Prompts | Percentage |\n';
      section += '|-------|---------|------------|\n';

      Object.entries(stats.byPhase)
        .sort((a, b) => b[1] - a[1])
        .forEach(([phase, count]) => {
          if (!filterPhase || phase === filterPhase) {
            const pct = ((count / stats.totalPrompts) * 100).toFixed(1);
            section += `| ${phase} | ${count} | ${pct}% |\n`;
          }
        });

      section += '\n';
    }

    // By Agent
    if (Object.keys(stats.byAgent).length > 0) {
      section += `### By Agent\n\n`;
      section += '| Agent | Prompts | Percentage |\n';
      section += '|-------|---------|------------|\n';

      Object.entries(stats.byAgent)
        .sort((a, b) => b[1] - a[1])
        .forEach(([agent, count]) => {
          if (!filterAgent || agent === filterAgent) {
            const pct = ((count / stats.totalPrompts) * 100).toFixed(1);
            section += `| ${agent} | ${count} | ${pct}% |\n`;
          }
        });

      section += '\n';
    }

    return section;
  }

  /**
   * Generates timeline section showing prompt history
   * @private
   */
  _generateTimelineSection(state, filterPhase, filterAgent) {
    let section = '## 📅 Prompt Timeline\n\n';

    const prompts = (state.promptHistory || [])
      .filter(p => (!filterPhase || p.phase === filterPhase) && (!filterAgent || p.agent === filterAgent))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    if (prompts.length === 0) {
      section += '*No prompts recorded yet.*\n';
      return section;
    }

    prompts.forEach((p, idx) => {
      const timestamp = new Date(p.timestamp).toLocaleString();
      section += `### ${idx + 1}. ${timestamp}\n\n`;
      section += `- **ID**: \`${p.id}\`\n`;
      section += `- **Phase**: ${p.phase}\n`;
      section += `- **Agent**: ${p.agent}\n`;
      section += `- **Session**: ${p.sessionId}\n\n`;

      section += `**Prompt**:\n`;
      section += `> ${p.prompt}\n\n`;

      if (p.artifactPath) {
        section += `**Artifact**: \`${p.artifactPath}\`\n\n`;
      }

      if (p.artifactsCreated && p.artifactsCreated.length > 0) {
        section += `**Created**:\n`;
        p.artifactsCreated.forEach(a => {
          section += `- \`${a}\`\n`;
        });
        section += '\n';
      }

      if (p.artifactsModified && p.artifactsModified.length > 0) {
        section += `**Modified**:\n`;
        p.artifactsModified.forEach(a => {
          section += `- \`${a}\`\n`;
        });
        section += '\n';
      }

      if (p.qualityImpact !== undefined) {
        const impact = p.qualityImpact > 0 ? `+${p.qualityImpact}` : `${p.qualityImpact}`;
        section += `**Quality Impact**: ${impact}\n\n`;
      }

      section += '---\n\n';
    });

    return section;
  }

  /**
   * Generates artifact lineage section
   * @private
   */
  _generateArtifactLineageSection(state, filterPhase, filterAgent) {
    let section = '## 📁 Artifact Lineage\n\n';

    const lineages = state.artifactLineage || {};

    if (Object.keys(lineages).length === 0) {
      section += '*No artifacts tracked yet.*\n';
      return section;
    }

    Object.entries(lineages)
      .sort((a, b) => new Date(b[1].created) - new Date(a[1].created))
      .forEach(([artifactPath, lineage]) => {
        // Apply filters
        if (filterPhase && lineage.createdBy.phase !== filterPhase) {
          return;
        }
        if (filterAgent && lineage.createdBy.agent !== filterAgent) {
          return;
        }

        section += `### \`${artifactPath}\`\n\n`;
        section += `**Artifact ID**: \`${lineage.artifactId}\`\n\n`;

        // Creation Info
        const createdDate = new Date(lineage.created).toLocaleString();
        section += `**Created**: ${createdDate}\n`;
        section += `**Created By**: ${lineage.createdBy.agent} (${lineage.createdBy.phase} phase)\n`;
        section += `**Current Version**: v${lineage.currentVersion}\n`;
        section += `**Total Modifications**: ${lineage.totalModifications}\n\n`;

        // Version History
        if (lineage.versions && lineage.versions.length > 0) {
          section += `**Version History**:\n\n`;

          lineage.versions.forEach((version, idx) => {
            const versionDate = new Date(version.timestamp).toLocaleString();
            const changeIcon = this._getChangeIcon(version.changeType);

            section += `${idx + 1}. **v${version.version}** ${changeIcon} ${version.changeType}\n`;
            section += `   - *${versionDate}*\n`;
            section += `   - Agent: ${version.agent}\n`;
            section += `   - Phase: ${version.phase}\n`;
            section += `   - Prompt: "${version.prompt}"\n`;

            if (version.changeSummary) {
              section += `   - Summary: ${version.changeSummary}\n`;
            }

            section += '\n';
          });
        }

        section += '---\n\n';
      });

    return section;
  }

  /**
   * Gets icon for change type
   * @private
   */
  _getChangeIcon(changeType) {
    const icons = {
      'created': '🆕',
      'modified': '✏️',
      'refactored': '♻️',
      'enhanced': '⭐',
      'bug-fix': '🐛'
    };
    return icons[changeType] || '📝';
  }

  /**
   * Generates a report for a specific artifact
   * @param {string} artifactPath - Path to artifact
   * @returns {string|null} Markdown report or null if not found
   */
  generateArtifactReport(artifactPath) {
    const history = this.stateManager.getArtifactHistory(artifactPath);

    if (!history) {
      return null;
    }

    let report = `# Artifact Report: \`${artifactPath}\`\n\n`;
    report += `**Generated**: ${new Date().toISOString()}\n\n`;
    report += '---\n\n';

    // Summary
    report += '## Summary\n\n';
    report += `- **Artifact ID**: \`${history.summary.artifactId}\`\n`;
    report += `- **Created**: ${new Date(history.summary.created).toLocaleString()}\n`;
    report += `- **Created By**: ${history.summary.createdBy}\n`;
    report += `- **Current Version**: v${history.summary.currentVersion}\n`;
    report += `- **Total Versions**: ${history.summary.totalVersions}\n`;
    report += `- **Total Modifications**: ${history.summary.totalModifications}\n`;
    report += `- **Last Modified**: ${new Date(history.summary.lastModified).toLocaleString()}\n\n`;

    report += '---\n\n';

    // Related Prompts
    report += '## Related Prompts\n\n';
    if (history.prompts.length === 0) {
      report += '*No prompts found.*\n\n';
    } else {
      history.prompts.forEach((prompt, idx) => {
        const timestamp = new Date(prompt.timestamp).toLocaleString();
        report += `### ${idx + 1}. ${timestamp}\n\n`;
        report += `- **Agent**: ${prompt.agent}\n`;
        report += `- **Phase**: ${prompt.phase}\n`;
        report += `- **Prompt**: "${prompt.prompt}"\n\n`;
      });
    }

    report += '---\n\n';

    // Version History
    report += '## Version History\n\n';
    if (history.lineage.versions.length === 0) {
      report += '*No versions recorded.*\n\n';
    } else {
      history.lineage.versions.forEach((version, idx) => {
        const timestamp = new Date(version.timestamp).toLocaleString();
        const icon = this._getChangeIcon(version.changeType);

        report += `### v${version.version} ${icon} ${version.changeType}\n\n`;
        report += `- **Date**: ${timestamp}\n`;
        report += `- **Agent**: ${version.agent}\n`;
        report += `- **Phase**: ${version.phase}\n`;
        report += `- **Prompt**: "${version.prompt}"\n`;

        if (version.changeSummary) {
          report += `- **Summary**: ${version.changeSummary}\n`;
        }

        report += '\n';
      });
    }

    return report;
  }

  /**
   * Generates a phase-focused report
   * @param {string} phase - Phase name
   * @returns {string} Markdown report
   */
  generatePhaseReport(phase) {
    const prompts = this.stateManager.getPromptsByPhase(phase);

    let report = `# Phase Report: ${phase}\n\n`;
    report += `**Generated**: ${new Date().toISOString()}\n`;
    report += `**Total Prompts**: ${prompts.length}\n\n`;
    report += '---\n\n';

    if (prompts.length === 0) {
      report += `*No prompts recorded for ${phase} phase.*\n`;
      return report;
    }

    // Group by session
    const bySession = {};
    prompts.forEach(p => {
      if (!bySession[p.sessionId]) {
        bySession[p.sessionId] = [];
      }
      bySession[p.sessionId].push(p);
    });

    report += `## Sessions: ${Object.keys(bySession).length}\n\n`;

    Object.entries(bySession).forEach(([sessionId, sessionPrompts], idx) => {
      report += `### Session ${idx + 1}: \`${sessionId}\`\n\n`;
      report += `**Prompts**: ${sessionPrompts.length}\n\n`;

      sessionPrompts.forEach((p, pIdx) => {
        const timestamp = new Date(p.timestamp).toLocaleString();
        report += `${pIdx + 1}. **${timestamp}** - ${p.agent}\n`;
        report += `   > ${p.prompt}\n\n`;
      });

      report += '---\n\n';
    });

    return report;
  }

  /**
   * Generates an agent-focused report
   * @param {string} agent - Agent name
   * @returns {string} Markdown report
   */
  generateAgentReport(agent) {
    const prompts = this.stateManager.getPromptsByAgent(agent);

    let report = `# Agent Report: ${agent}\n\n`;
    report += `**Generated**: ${new Date().toISOString()}\n`;
    report += `**Total Prompts**: ${prompts.length}\n\n`;
    report += '---\n\n';

    if (prompts.length === 0) {
      report += `*No prompts recorded for ${agent}.*\n`;
      return report;
    }

    // Group by phase
    const byPhase = {};
    prompts.forEach(p => {
      if (!byPhase[p.phase]) {
        byPhase[p.phase] = [];
      }
      byPhase[p.phase].push(p);
    });

    report += `## Phases: ${Object.keys(byPhase).length}\n\n`;

    Object.entries(byPhase).forEach(([phase, phasePrompts]) => {
      report += `### ${phase} (${phasePrompts.length} prompts)\n\n`;

      phasePrompts.forEach((p, idx) => {
        const timestamp = new Date(p.timestamp).toLocaleString();
        report += `${idx + 1}. **${timestamp}**\n`;
        report += `   > ${p.prompt}\n\n`;

        if (p.artifactsCreated && p.artifactsCreated.length > 0) {
          report += `   Created: ${p.artifactsCreated.join(', ')}\n\n`;
        }

        if (p.artifactsModified && p.artifactsModified.length > 0) {
          report += `   Modified: ${p.artifactsModified.join(', ')}\n\n`;
        }
      });

      report += '---\n\n';
    });

    return report;
  }

  /**
   * Saves a report to file
   * @param {string} report - Markdown report content
   * @param {string} filename - Output filename
   * @returns {string} Path to saved file
   */
  saveReport(report, filename) {
    const reportsDir = path.join(this.projectRoot, '.claude', 'reports');

    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const filePath = path.join(reportsDir, filename);
    fs.writeFileSync(filePath, report, 'utf8');

    console.log(`[TraceabilityReport] Report saved: ${filePath}`);
    return filePath;
  }

  /**
   * Generates and saves a full traceability report
   * @param {Object} options - Report options
   * @returns {string} Path to saved report
   */
  generateAndSave(options = {}) {
    const report = this.generateFullReport(options);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `traceability-report-${timestamp}.md`;
    return this.saveReport(report, filename);
  }
}

module.exports = TraceabilityReport;
