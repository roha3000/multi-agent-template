/**
 * Documentation Reviewer
 *
 * Identifies stale, missing, and incorrect documentation.
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

class DocumentationReviewer {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  async analyze() {
    const findings = {
      staleDocs: [],
      brokenLinks: [],
      outdatedReferences: [],
      missingDocs: [],
      archiveCandidates: [],
      summary: {
        totalDocs: 0,
        current: 0,
        stale: 0,
        outdated: 0,
        archiveCandidates: 0,
        missingDocs: 0,
        brokenLinks: 0,
        averageFreshnessScore: 0
      }
    };

    try {
      // Find all markdown files
      const docs = await this.findMarkdownFiles();
      findings.summary.totalDocs = docs.length;

      // Analyze each document
      let totalFreshness = 0;
      for (const doc of docs) {
        const analysis = await this.analyzeDocument(doc);

        if (analysis.freshnessScore < 50) {
          findings.staleDocs.push(analysis);
          findings.summary.stale++;
        } else if (analysis.freshnessScore >= 80) {
          findings.summary.current++;
        }

        if (analysis.isArchiveCandidate) {
          findings.archiveCandidates.push({
            file: doc,
            reason: analysis.archiveReason,
            recommendation: 'MOVE to docs/archive/'
          });
          findings.summary.archiveCandidates++;
        }

        findings.brokenLinks.push(...analysis.brokenLinks);
        totalFreshness += analysis.freshnessScore;
      }

      findings.summary.brokenLinks = findings.brokenLinks.length;
      findings.summary.averageFreshnessScore =
        docs.length > 0 ? Math.round(totalFreshness / docs.length) : 0;

      // Find undocumented components
      findings.missingDocs = await this.findMissingDocs();
      findings.summary.missingDocs = findings.missingDocs.length;

    } catch (error) {
      console.error('Documentation review error:', error.message);
    }

    return findings;
  }

  async findMarkdownFiles() {
    const docs = [];
    const searchDirs = ['docs', '.claude', ''];

    for (const dir of searchDirs) {
      await this.scanForMarkdown(dir, docs);
    }

    return docs;
  }

  async scanForMarkdown(dir, docs, depth = 0) {
    if (depth > 5) return; // Limit recursion

    const fullPath = dir ? path.join(this.projectRoot, dir) : this.projectRoot;

    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip node_modules, .git, etc.
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        const entryPath = dir ? path.join(dir, entry.name) : entry.name;

        if (entry.isDirectory()) {
          await this.scanForMarkdown(entryPath, docs, depth + 1);
        } else if (entry.name.endsWith('.md')) {
          docs.push(entryPath);
        }
      }
    } catch {
      // Directory not found
    }
  }

  async analyzeDocument(docPath) {
    const fullPath = path.join(this.projectRoot, docPath);
    const analysis = {
      file: docPath,
      freshnessScore: 100,
      issues: [],
      brokenLinks: [],
      isArchiveCandidate: false,
      archiveReason: null
    };

    try {
      const content = await fs.readFile(fullPath, 'utf8');
      const stat = await fs.stat(fullPath);

      // Check age
      const daysSinceModified = (Date.now() - stat.mtime) / (1000 * 60 * 60 * 24);

      if (daysSinceModified > 90) {
        analysis.freshnessScore -= 30;
        analysis.issues.push(`Not modified in ${Math.round(daysSinceModified)} days`);
      } else if (daysSinceModified > 30) {
        analysis.freshnessScore -= 10;
      }

      // Check for archive candidate patterns
      const archivePatterns = [
        { pattern: /IMPLEMENTATION[-_]?(COMPLETE|DONE)/i, reason: 'Implementation completed' },
        { pattern: /MIGRATION[-_]?(COMPLETE|DONE|PLAN)/i, reason: 'Migration completed' },
        { pattern: /PROPOSAL/i, reason: 'Proposal - likely accepted/rejected' },
        { pattern: /ROADMAP/i, reason: 'Roadmap - may be outdated' },
        { pattern: /v\d+\.md$/i, reason: 'Versioned doc - may be superseded' }
      ];

      for (const { pattern, reason } of archivePatterns) {
        if (pattern.test(docPath) || pattern.test(content.substring(0, 500))) {
          analysis.isArchiveCandidate = true;
          analysis.archiveReason = reason;
          break;
        }
      }

      // Check for broken internal links
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let match;
      while ((match = linkRegex.exec(content)) !== null) {
        const linkTarget = match[2];

        // Skip external links and anchors
        if (linkTarget.startsWith('http') || linkTarget.startsWith('#')) continue;

        // Check if target exists
        const targetPath = path.resolve(path.dirname(fullPath), linkTarget);
        try {
          await fs.access(targetPath);
        } catch {
          // Also try with .md extension
          try {
            await fs.access(targetPath + '.md');
          } catch {
            analysis.brokenLinks.push({
              sourceFile: docPath,
              brokenLink: linkTarget,
              linkType: 'internal'
            });
            analysis.freshnessScore -= 5;
          }
        }
      }

      // Check for code references
      const codeRefRegex = /`([^`]+\.js)`|`\.claude\/[^`]+`/g;
      while ((match = codeRefRegex.exec(content)) !== null) {
        const codeRef = match[1] || match[0].replace(/`/g, '');
        const codePath = path.join(this.projectRoot, codeRef);
        try {
          await fs.access(codePath);
        } catch {
          analysis.freshnessScore -= 5;
          analysis.issues.push(`References non-existent: ${codeRef}`);
        }
      }

    } catch (error) {
      analysis.freshnessScore = 0;
      analysis.issues.push(`Could not analyze: ${error.message}`);
    }

    return analysis;
  }

  async findMissingDocs() {
    const missing = [];

    // Check for core modules without documentation
    const coreDir = path.join(this.projectRoot, '.claude/core');
    try {
      const files = await fs.readdir(coreDir);
      const jsFiles = files.filter(f => f.endsWith('.js') && !f.includes('.test.'));

      for (const file of jsFiles) {
        const baseName = file.replace('.js', '');
        const docName = baseName.toUpperCase().replace(/-/g, '_');

        // Check if there's a doc for this module
        const possibleDocs = [
          `docs/${docName}.md`,
          `docs/${baseName}.md`,
          `.claude/core/${baseName}.md`
        ];

        let hasDoc = false;
        for (const doc of possibleDocs) {
          try {
            await fs.access(path.join(this.projectRoot, doc));
            hasDoc = true;
            break;
          } catch {
            // Doc not found
          }
        }

        // Check if it's exported from index (public API)
        if (!hasDoc) {
          const indexPath = path.join(coreDir, 'index.js');
          try {
            const indexContent = await fs.readFile(indexPath, 'utf8');
            if (indexContent.includes(baseName)) {
              missing.push({
                component: baseName,
                file: `.claude/core/${file}`,
                exports: ['module'],
                recommendation: 'CREATE documentation',
                suggestedLocation: `docs/${docName}.md`
              });
            }
          } catch {
            // No index.js
          }
        }
      }
    } catch {
      // Core directory not found
    }

    return missing;
  }
}

module.exports = DocumentationReviewer;
