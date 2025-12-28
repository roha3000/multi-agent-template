/**
 * Dead Code Analyzer
 *
 * Identifies orphaned modules, unused exports, and dead code.
 */

const fs = require('fs').promises;
const path = require('path');

class DeadCodeAnalyzer {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
    this.importGraph = new Map(); // file -> imports
    this.exportGraph = new Map(); // file -> exports
  }

  async analyze() {
    const findings = {
      orphanedModules: [],
      unusedExports: [],
      deadCode: [],
      deprecatedInUse: [],
      summary: {
        totalOrphaned: 0,
        totalUnusedExports: 0,
        totalDeadCode: 0,
        totalDeprecatedInUse: 0,
        estimatedCleanupLines: 0
      }
    };

    try {
      // Build import/export graph
      await this.buildModuleGraph();

      // Find orphaned modules
      findings.orphanedModules = await this.findOrphanedModules();
      findings.summary.totalOrphaned = findings.orphanedModules.length;

      // Find unused exports
      findings.unusedExports = await this.findUnusedExports();
      findings.summary.totalUnusedExports = findings.unusedExports.length;

      // Find deprecated code still in use
      findings.deprecatedInUse = await this.findDeprecatedInUse();
      findings.summary.totalDeprecatedInUse = findings.deprecatedInUse.length;

      // Estimate cleanup
      findings.summary.estimatedCleanupLines =
        findings.orphanedModules.reduce((sum, m) => sum + (m.lineCount || 100), 0);

    } catch (error) {
      console.error('Dead code analysis error:', error.message);
    }

    return findings;
  }

  async buildModuleGraph() {
    const coreFiles = await this.findJsFiles('.claude/core');
    const scriptFiles = await this.findJsFiles('scripts');
    const rootFiles = await this.findRootJsFiles();

    const allFiles = [...coreFiles, ...scriptFiles, ...rootFiles];

    for (const file of allFiles) {
      await this.analyzeFile(file);
    }
  }

  async findJsFiles(dir) {
    const fullPath = path.join(this.projectRoot, dir);
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      return entries
        .filter(e => e.isFile() && e.name.endsWith('.js') && !e.name.includes('.test.'))
        .map(e => path.join(dir, e.name));
    } catch {
      return [];
    }
  }

  async findRootJsFiles() {
    try {
      const entries = await fs.readdir(this.projectRoot, { withFileTypes: true });
      return entries
        .filter(e => e.isFile() && e.name.endsWith('.js') && !e.name.includes('.test.'))
        .map(e => e.name);
    } catch {
      return [];
    }
  }

  async analyzeFile(file) {
    const fullPath = path.join(this.projectRoot, file);
    try {
      const content = await fs.readFile(fullPath, 'utf8');

      // Extract requires
      const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
      const imports = [];
      let match;
      while ((match = requireRegex.exec(content)) !== null) {
        imports.push(match[1]);
      }
      this.importGraph.set(file, imports);

      // Extract exports
      const exports = [];
      if (content.includes('module.exports')) {
        exports.push('default');
      }
      const namedExportRegex = /exports\.(\w+)\s*=/g;
      while ((match = namedExportRegex.exec(content)) !== null) {
        exports.push(match[1]);
      }
      this.exportGraph.set(file, exports);

    } catch (error) {
      // File read error, skip
    }
  }

  async findOrphanedModules() {
    const orphaned = [];
    const allImports = new Set();

    // Collect all imported modules
    for (const imports of this.importGraph.values()) {
      imports.forEach(i => allImports.add(i));
    }

    // Check each file
    for (const [file, _] of this.importGraph) {
      // Skip entry points
      if (this.isEntryPoint(file)) continue;

      // Check if imported anywhere
      const baseName = path.basename(file, '.js');
      const relativePath = './' + file.replace(/\\/g, '/');

      const isImported = Array.from(allImports).some(imp =>
        imp.includes(baseName) || imp === relativePath
      );

      if (!isImported) {
        const stat = await this.getFileStat(file);
        orphaned.push({
          file,
          reason: 'Not imported by any module',
          lastModified: stat?.mtime?.toISOString() || 'unknown',
          lineCount: await this.countLines(file),
          recommendation: 'DELETE or ARCHIVE'
        });
      }
    }

    return orphaned;
  }

  isEntryPoint(file) {
    const entryPoints = [
      'autonomous-orchestrator.js',
      'task-cli.js',
      'start-continuous-loop.js',
      'global-context-manager.js',
      'index.js'
    ];
    return entryPoints.some(ep => file.endsWith(ep));
  }

  async findUnusedExports() {
    // Simplified: check if index.js exports match actual module exports
    const unused = [];
    const indexPath = path.join(this.projectRoot, '.claude/core/index.js');

    try {
      const indexContent = await fs.readFile(indexPath, 'utf8');

      for (const [file, exports] of this.exportGraph) {
        if (!file.includes('.claude/core/')) continue;
        if (file.includes('index.js')) continue;

        const baseName = path.basename(file, '.js');
        if (!indexContent.includes(baseName) && exports.length > 0) {
          unused.push({
            file,
            exportName: 'module',
            exportType: 'module',
            recommendation: 'ADD to index.js or DELETE'
          });
        }
      }
    } catch {
      // index.js not found
    }

    return unused;
  }

  async findDeprecatedInUse() {
    const deprecated = [];
    const deprecatedDir = path.join(this.projectRoot, '.claude/core/deprecated');

    try {
      const entries = await fs.readdir(deprecatedDir);

      for (const entry of entries) {
        if (!entry.endsWith('.js')) continue;

        const deprecatedFile = path.join('.claude/core/deprecated', entry);

        // Check if any file imports from deprecated
        for (const [file, imports] of this.importGraph) {
          if (imports.some(i => i.includes('deprecated'))) {
            deprecated.push({
              file: deprecatedFile,
              usedBy: [file],
              deprecatedSince: 'unknown',
              recommendation: 'MIGRATE consumers to new implementation'
            });
          }
        }
      }
    } catch {
      // No deprecated directory
    }

    return deprecated;
  }

  async getFileStat(file) {
    try {
      return await fs.stat(path.join(this.projectRoot, file));
    } catch {
      return null;
    }
  }

  async countLines(file) {
    try {
      const content = await fs.readFile(path.join(this.projectRoot, file), 'utf8');
      return content.split('\n').length;
    } catch {
      return 0;
    }
  }
}

module.exports = DeadCodeAnalyzer;
