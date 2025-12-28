#!/usr/bin/env node

/**
 * Codebase Audit Engine
 *
 * Coordinates multiple analysis modules to perform comprehensive codebase audit.
 * Can be run standalone or as part of CI/CD pipeline.
 *
 * Usage:
 *   node scripts/audit/index.js [options]
 *
 * Options:
 *   --scope=full|code|docs|deps  Audit scope (default: full)
 *   --output=path                Output directory (default: docs/audits)
 *   --dry-run                    Don't create tasks or scripts
 *   --json                       Output JSON instead of markdown
 */

const fs = require('fs').promises;
const path = require('path');

// Import analysis modules
const DeadCodeAnalyzer = require('./dead-code-analysis');
const DuplicationDetector = require('./duplication-detection');
const DatabaseInspector = require('./database-inspection');
const DocumentationReviewer = require('./documentation-review');
const DependencyAnalyzer = require('./dependency-analysis');

class AuditEngine {
  constructor(options = {}) {
    this.options = {
      scope: options.scope || 'full',
      outputDir: options.output || 'docs/audits',
      dryRun: options.dryRun || false,
      json: options.json || false,
      projectRoot: options.projectRoot || process.cwd()
    };

    this.findings = {
      deadCode: null,
      duplications: null,
      databases: null,
      documentation: null,
      dependencies: null
    };

    this.summary = {
      totalIssues: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      estimatedEffort: 0,
      potentialSavings: { lines: 0, bytes: 0 }
    };
  }

  async run() {
    console.log('🔍 Starting Codebase Audit...\n');
    const startTime = Date.now();

    try {
      // Phase 1: Run analyzers in parallel
      await this.runAnalyzers();

      // Phase 2: Synthesize findings
      this.synthesizeFindings();

      // Phase 3: Generate outputs
      await this.generateOutputs();

      // Phase 4: Report summary
      this.reportSummary(Date.now() - startTime);

      return {
        success: true,
        summary: this.summary,
        findings: this.findings
      };

    } catch (error) {
      console.error('❌ Audit failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async runAnalyzers() {
    const { scope } = this.options;
    const analyzers = [];

    console.log('📊 Running analyzers in parallel...\n');

    if (scope === 'full' || scope === 'code') {
      analyzers.push(
        this.runAnalyzer('Dead Code', DeadCodeAnalyzer, 'deadCode'),
        this.runAnalyzer('Duplication', DuplicationDetector, 'duplications'),
        this.runAnalyzer('Database', DatabaseInspector, 'databases')
      );
    }

    if (scope === 'full' || scope === 'docs') {
      analyzers.push(
        this.runAnalyzer('Documentation', DocumentationReviewer, 'documentation')
      );
    }

    if (scope === 'full' || scope === 'deps') {
      analyzers.push(
        this.runAnalyzer('Dependencies', DependencyAnalyzer, 'dependencies')
      );
    }

    await Promise.all(analyzers);
  }

  async runAnalyzer(name, AnalyzerClass, key) {
    try {
      console.log(`  ⏳ ${name} analysis...`);
      const analyzer = new AnalyzerClass(this.options.projectRoot);
      this.findings[key] = await analyzer.analyze();
      console.log(`  ✅ ${name} analysis complete`);
    } catch (error) {
      console.log(`  ⚠️  ${name} analysis failed: ${error.message}`);
      this.findings[key] = { error: error.message };
    }
  }

  synthesizeFindings() {
    console.log('\n🔄 Synthesizing findings...\n');

    // Aggregate counts
    if (this.findings.deadCode?.summary) {
      const dc = this.findings.deadCode.summary;
      this.summary.high += dc.totalOrphaned || 0;
      this.summary.medium += dc.totalUnusedExports || 0;
      this.summary.potentialSavings.lines += dc.estimatedCleanupLines || 0;
    }

    if (this.findings.duplications?.summary) {
      const dup = this.findings.duplications.summary;
      this.summary.high += dup.duplicateImplementations || 0;
      this.summary.high += dup.duplicateDatabases || 0;
    }

    if (this.findings.databases?.summary) {
      const db = this.findings.databases.summary;
      this.summary.medium += db.emptyDatabases || 0;
      this.summary.low += db.orphanedTestDBs || 0;
      this.summary.potentialSavings.bytes += (db.totalCleanupSize || 0) * 1024;
    }

    if (this.findings.documentation?.summary) {
      const doc = this.findings.documentation.summary;
      this.summary.medium += doc.stale || 0;
      this.summary.low += doc.archiveCandidates || 0;
      this.summary.medium += doc.brokenLinks || 0;
    }

    if (this.findings.dependencies?.summary) {
      const dep = this.findings.dependencies.summary;
      this.summary.critical += dep.securityHigh || 0;
      this.summary.medium += dep.securityMedium || 0;
      this.summary.low += dep.unusedDeps || 0;
    }

    this.summary.totalIssues =
      this.summary.critical +
      this.summary.high +
      this.summary.medium +
      this.summary.low;

    // Estimate effort (rough: 15min per low, 30min per medium, 1h per high, 2h per critical)
    this.summary.estimatedEffort =
      this.summary.critical * 2 +
      this.summary.high * 1 +
      this.summary.medium * 0.5 +
      this.summary.low * 0.25;
  }

  async generateOutputs() {
    console.log('📝 Generating outputs...\n');

    const date = new Date().toISOString().split('T')[0];

    // Ensure output directory exists
    await fs.mkdir(this.options.outputDir, { recursive: true });

    // Generate markdown report
    if (!this.options.json) {
      const report = this.generateMarkdownReport(date);
      const reportPath = path.join(this.options.outputDir, `AUDIT-REPORT-${date}.md`);
      await fs.writeFile(reportPath, report);
      console.log(`  ✅ Report: ${reportPath}`);
    }

    // Generate JSON output
    const jsonPath = path.join(this.options.outputDir, `audit-${date}.json`);
    await fs.writeFile(jsonPath, JSON.stringify({
      date,
      summary: this.summary,
      findings: this.findings
    }, null, 2));
    console.log(`  ✅ JSON: ${jsonPath}`);

    // Update tasks.json (unless dry-run)
    if (!this.options.dryRun) {
      await this.updateTasks(date);
    }
  }

  generateMarkdownReport(date) {
    const { summary, findings } = this;

    return `# Codebase Audit Report - ${date}

## Executive Summary

| Metric | Value |
|--------|-------|
| **Total Issues** | ${summary.totalIssues} |
| **Critical** | ${summary.critical} |
| **High** | ${summary.high} |
| **Medium** | ${summary.medium} |
| **Low** | ${summary.low} |
| **Estimated Effort** | ${summary.estimatedEffort.toFixed(1)}h |
| **Potential Code Reduction** | ${summary.potentialSavings.lines} lines |
| **Potential Storage Savings** | ${(summary.potentialSavings.bytes / 1024 / 1024).toFixed(2)} MB |

---

## Critical Findings

${summary.critical > 0 ? this.formatCriticalFindings() : '_No critical issues found._'}

---

## Dead Code Analysis

${findings.deadCode?.error ? `_Error: ${findings.deadCode.error}_` : this.formatDeadCodeFindings()}

---

## Duplication Detection

${findings.duplications?.error ? `_Error: ${findings.duplications.error}_` : this.formatDuplicationFindings()}

---

## Database Health

${findings.databases?.error ? `_Error: ${findings.databases.error}_` : this.formatDatabaseFindings()}

---

## Documentation Review

${findings.documentation?.error ? `_Error: ${findings.documentation.error}_` : this.formatDocumentationFindings()}

---

## Dependency Analysis

${findings.dependencies?.error ? `_Error: ${findings.dependencies.error}_` : this.formatDependencyFindings()}

---

## Recommended Actions

### Quick Wins (< 1 hour)
${this.formatQuickWins()}

### Major Refactoring Opportunities
${this.formatMajorRefactoring()}

---

_Generated by Codebase Audit Engine on ${new Date().toISOString()}_
`;
  }

  formatCriticalFindings() {
    const critical = [];

    if (this.findings.dependencies?.securityIssues) {
      this.findings.dependencies.securityIssues
        .filter(i => i.severity === 'high' || i.severity === 'critical')
        .forEach(issue => {
          critical.push(`- **Security**: ${issue.package} - ${issue.vulnerability}`);
        });
    }

    return critical.length > 0 ? critical.join('\n') : '_No critical issues._';
  }

  formatDeadCodeFindings() {
    const dc = this.findings.deadCode;
    if (!dc || !dc.orphanedModules) return '_No dead code analysis available._';

    let output = `### Orphaned Modules (${dc.orphanedModules?.length || 0})\n\n`;

    if (dc.orphanedModules?.length > 0) {
      output += '| File | Reason | Recommendation |\n|------|--------|----------------|\n';
      dc.orphanedModules.slice(0, 10).forEach(m => {
        output += `| \`${m.file}\` | ${m.reason} | ${m.recommendation} |\n`;
      });
      if (dc.orphanedModules.length > 10) {
        output += `\n_...and ${dc.orphanedModules.length - 10} more_\n`;
      }
    }

    return output;
  }

  formatDuplicationFindings() {
    const dup = this.findings.duplications;
    if (!dup) return '_No duplication analysis available._';

    let output = '';

    if (dup.duplicateImplementations?.length > 0) {
      output += `### Duplicate Implementations\n\n`;
      dup.duplicateImplementations.forEach(d => {
        output += `#### ${d.concept}\n`;
        output += `- Files: ${d.implementations.map(i => `\`${i.file}\``).join(', ')}\n`;
        output += `- Similarity: ${(d.similarity * 100).toFixed(0)}%\n`;
        output += `- Recommendation: ${d.recommendation}\n\n`;
      });
    }

    if (dup.duplicateDatabases?.length > 0) {
      output += `### Duplicate Databases\n\n`;
      dup.duplicateDatabases.forEach(d => {
        output += `- ${d.databases.map(db => `\`${db.file}\``).join(', ')}\n`;
        output += `  - Recommendation: ${d.recommendation}\n`;
      });
    }

    return output || '_No duplications found._';
  }

  formatDatabaseFindings() {
    const db = this.findings.databases;
    if (!db || !db.databases) return '_No database analysis available._';

    let output = '| Database | Size | Tables | Rows | Status |\n|----------|------|--------|------|--------|\n';

    db.databases.forEach(d => {
      output += `| \`${d.path}\` | ${d.size} | ${d.tables} | ${d.totalRows} | ${d.status} |\n`;
    });

    if (db.cleanupTargets?.length > 0) {
      output += `\n### Cleanup Targets\n\n`;
      db.cleanupTargets.forEach(t => {
        output += `- \`${t.path}\`: ${t.reason} (${t.action})\n`;
      });
    }

    return output;
  }

  formatDocumentationFindings() {
    const doc = this.findings.documentation;
    if (!doc) return '_No documentation analysis available._';

    let output = `### Summary\n\n`;
    output += `- Total docs: ${doc.summary?.totalDocs || 0}\n`;
    output += `- Current: ${doc.summary?.current || 0}\n`;
    output += `- Stale: ${doc.summary?.stale || 0}\n`;
    output += `- Archive candidates: ${doc.summary?.archiveCandidates || 0}\n`;
    output += `- Broken links: ${doc.summary?.brokenLinks || 0}\n\n`;

    if (doc.archiveCandidates?.length > 0) {
      output += `### Archive Candidates\n\n`;
      doc.archiveCandidates.slice(0, 10).forEach(a => {
        output += `- \`${a.file}\`: ${a.reason}\n`;
      });
    }

    return output;
  }

  formatDependencyFindings() {
    const dep = this.findings.dependencies;
    if (!dep) return '_No dependency analysis available._';

    let output = '';

    if (dep.unusedDependencies?.length > 0) {
      output += `### Unused Dependencies\n\n`;
      dep.unusedDependencies.forEach(d => {
        output += `- \`${d.package}\` (${d.type})\n`;
      });
      output += '\n';
    }

    if (dep.securityIssues?.length > 0) {
      output += `### Security Issues\n\n`;
      output += '| Package | Severity | Issue |\n|---------|----------|-------|\n';
      dep.securityIssues.forEach(s => {
        output += `| \`${s.package}\` | ${s.severity} | ${s.vulnerability} |\n`;
      });
    }

    return output || '_No dependency issues found._';
  }

  formatQuickWins() {
    const wins = [];

    // Test database cleanup
    if (this.findings.databases?.cleanupTargets?.length > 0) {
      wins.push('- Delete orphaned test databases (saves ~5MB)');
    }

    // Unused dependencies
    if (this.findings.dependencies?.unusedDependencies?.length > 0) {
      wins.push(`- Remove ${this.findings.dependencies.unusedDependencies.length} unused dependencies`);
    }

    // Stale docs archival
    if (this.findings.documentation?.archiveCandidates?.length > 0) {
      wins.push(`- Archive ${this.findings.documentation.archiveCandidates.length} stale docs`);
    }

    return wins.length > 0 ? wins.join('\n') : '_No quick wins identified._';
  }

  formatMajorRefactoring() {
    const refactors = [];

    // Duplicate implementations
    if (this.findings.duplications?.duplicateImplementations?.length > 0) {
      this.findings.duplications.duplicateImplementations.forEach(d => {
        refactors.push(`- **${d.concept}**: ${d.recommendation} (${d.effort})`);
      });
    }

    // Empty infrastructure
    if (this.findings.databases?.emptyDatabases > 0) {
      refactors.push('- **Database consolidation**: Multiple empty DBs suggest unused infrastructure');
    }

    return refactors.length > 0 ? refactors.join('\n') : '_No major refactoring needed._';
  }

  async updateTasks(date) {
    const tasksPath = path.join(this.options.projectRoot, '.claude/dev-docs/tasks.json');

    try {
      const tasksContent = await fs.readFile(tasksPath, 'utf8');
      const tasks = JSON.parse(tasksContent);

      // Add cleanup tasks based on findings
      const newTasks = this.generateCleanupTasks(date);

      if (newTasks.length > 0) {
        // Add to backlog
        tasks.backlog = tasks.backlog || { later: [] };
        tasks.backlog.later = tasks.backlog.later || [];
        tasks.backlog.later.push(...newTasks);

        await fs.writeFile(tasksPath, JSON.stringify(tasks, null, 2));
        console.log(`  ✅ Added ${newTasks.length} cleanup tasks to tasks.json`);
      }
    } catch (error) {
      console.log(`  ⚠️  Could not update tasks.json: ${error.message}`);
    }
  }

  generateCleanupTasks(date) {
    const tasks = [];

    if (this.findings.databases?.cleanupTargets?.length > 0) {
      tasks.push({
        id: `audit-db-cleanup-${date}`,
        title: 'Delete orphaned test databases',
        priority: 'low',
        effort: '15m',
        category: 'cleanup',
        generatedBy: `audit-${date}`,
        status: 'pending'
      });
    }

    if (this.findings.duplications?.duplicateDatabases?.length > 0) {
      tasks.push({
        id: `audit-db-consolidate-${date}`,
        title: 'Consolidate duplicate databases',
        priority: 'high',
        effort: '2h',
        category: 'cleanup',
        generatedBy: `audit-${date}`,
        status: 'pending'
      });
    }

    if (this.findings.documentation?.archiveCandidates?.length > 5) {
      tasks.push({
        id: `audit-docs-archive-${date}`,
        title: `Archive ${this.findings.documentation.archiveCandidates.length} stale documents`,
        priority: 'medium',
        effort: '1h',
        category: 'cleanup',
        generatedBy: `audit-${date}`,
        status: 'pending'
      });
    }

    return tasks;
  }

  reportSummary(durationMs) {
    console.log('\n' + '='.repeat(60));
    console.log('📊 AUDIT COMPLETE');
    console.log('='.repeat(60));
    console.log(`
Total Issues: ${this.summary.totalIssues}
  Critical: ${this.summary.critical}
  High:     ${this.summary.high}
  Medium:   ${this.summary.medium}
  Low:      ${this.summary.low}

Estimated Cleanup Effort: ${this.summary.estimatedEffort.toFixed(1)} hours
Potential Savings: ${this.summary.potentialSavings.lines} lines, ${(this.summary.potentialSavings.bytes / 1024 / 1024).toFixed(2)} MB

Duration: ${(durationMs / 1000).toFixed(1)}s
`);
    console.log('='.repeat(60));
  }
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};

  args.forEach(arg => {
    if (arg.startsWith('--scope=')) options.scope = arg.split('=')[1];
    if (arg.startsWith('--output=')) options.output = arg.split('=')[1];
    if (arg === '--dry-run') options.dryRun = true;
    if (arg === '--json') options.json = true;
  });

  const engine = new AuditEngine(options);
  engine.run().then(result => {
    process.exit(result.success ? 0 : 1);
  });
}

module.exports = AuditEngine;
