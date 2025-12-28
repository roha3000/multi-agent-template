/**
 * Duplication Detector
 *
 * Identifies duplicate implementations, redundant databases, and concept overlaps.
 */

const fs = require('fs').promises;
const path = require('path');

class DuplicationDetector {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  async analyze() {
    const findings = {
      duplicateImplementations: [],
      duplicateDatabases: [],
      conceptOverlaps: [],
      summary: {
        duplicateImplementations: 0,
        duplicateDatabases: 0,
        conceptOverlaps: 0,
        consolidationEffort: '0h',
        codeReduction: '0 lines'
      }
    };

    try {
      // Find duplicate implementations by concept
      findings.duplicateImplementations = await this.findDuplicateImplementations();
      findings.summary.duplicateImplementations = findings.duplicateImplementations.length;

      // Find duplicate databases
      findings.duplicateDatabases = await this.findDuplicateDatabases();
      findings.summary.duplicateDatabases = findings.duplicateDatabases.length;

      // Find concept overlaps
      findings.conceptOverlaps = await this.findConceptOverlaps();
      findings.summary.conceptOverlaps = findings.conceptOverlaps.length;

      // Estimate consolidation effort
      const hours = findings.duplicateImplementations.length * 3 +
                   findings.duplicateDatabases.length * 2 +
                   findings.conceptOverlaps.length * 4;
      findings.summary.consolidationEffort = `${hours}h`;

    } catch (error) {
      console.error('Duplication detection error:', error.message);
    }

    return findings;
  }

  async findDuplicateImplementations() {
    const duplicates = [];

    // Define concept patterns to look for
    const concepts = [
      {
        name: 'Usage Tracking',
        patterns: ['usage', 'tracker', 'limit', 'token'],
        files: []
      },
      {
        name: 'Memory Storage',
        patterns: ['memory', 'store', 'database', 'sqlite'],
        files: []
      },
      {
        name: 'Orchestration',
        patterns: ['orchestrat', 'swarm', 'controller'],
        files: []
      },
      {
        name: 'Dashboard',
        patterns: ['dashboard', 'html', 'server'],
        files: []
      },
      {
        name: 'Session Management',
        patterns: ['session', 'registry', 'context'],
        files: []
      }
    ];

    // Scan core files
    const coreDir = path.join(this.projectRoot, '.claude/core');
    try {
      const files = await fs.readdir(coreDir);

      for (const file of files) {
        if (!file.endsWith('.js') || file.includes('.test.')) continue;

        const lowerFile = file.toLowerCase();
        for (const concept of concepts) {
          if (concept.patterns.some(p => lowerFile.includes(p))) {
            concept.files.push({
              file: `.claude/core/${file}`,
              purpose: await this.extractPurpose(path.join(coreDir, file))
            });
          }
        }
      }
    } catch {
      // Directory not found
    }

    // Report concepts with multiple implementations
    for (const concept of concepts) {
      if (concept.files.length > 1) {
        duplicates.push({
          concept: concept.name,
          implementations: concept.files,
          similarity: 0.7, // Would need AST analysis for real similarity
          recommendation: `Consolidate ${concept.files.length} files into single implementation`,
          effort: `${concept.files.length}h`,
          risk: 'medium'
        });
      }
    }

    return duplicates;
  }

  async extractPurpose(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      // Extract first JSDoc comment or first comment
      const docMatch = content.match(/\/\*\*[\s\S]*?\*\//);
      if (docMatch) {
        const lines = docMatch[0].split('\n');
        for (const line of lines) {
          const cleaned = line.replace(/^\s*\*\s*/, '').trim();
          if (cleaned && !cleaned.startsWith('@') && !cleaned.startsWith('/')) {
            return cleaned.substring(0, 100);
          }
        }
      }
      return 'Purpose not documented';
    } catch {
      return 'Could not read file';
    }
  }

  async findDuplicateDatabases() {
    const duplicates = [];
    const databases = [];

    // Find all .db files
    const locations = [
      '.claude/data',
      '.claude/memory'
    ];

    for (const loc of locations) {
      const dir = path.join(this.projectRoot, loc);
      try {
        const files = await fs.readdir(dir);
        for (const file of files) {
          if (file.endsWith('.db')) {
            const stat = await fs.stat(path.join(dir, file));
            databases.push({
              file: `${loc}/${file}`,
              size: stat.size,
              path: path.join(dir, file)
            });
          }
        }
      } catch {
        // Directory not found
      }
    }

    // Group databases with similar names
    const groups = {};
    for (const db of databases) {
      // Normalize name (remove path, test prefix, etc.)
      const baseName = path.basename(db.file, '.db')
        .replace(/^test[-_]?/, '')
        .replace(/[-_]?\d+$/, '');

      groups[baseName] = groups[baseName] || [];
      groups[baseName].push(db);
    }

    // Report groups with duplicates
    for (const [name, dbs] of Object.entries(groups)) {
      if (dbs.length > 1) {
        duplicates.push({
          databases: dbs.map(d => ({
            file: d.file,
            size: `${Math.round(d.size / 1024)} KB`
          })),
          recommendation: `Keep primary, delete ${dbs.length - 1} duplicates`,
          effort: '1h'
        });
      }
    }

    return duplicates;
  }

  async findConceptOverlaps() {
    const overlaps = [];

    // Known overlapping concepts in this codebase
    const knownOverlaps = [
      {
        concepts: ['MemoryStore', 'VectorStore'],
        overlap: 'Both store observations with search capability',
        files: ['.claude/core/memory-store.js', '.claude/core/vector-store.js'],
        recommendation: 'Clarify responsibilities or merge'
      },
      {
        concepts: ['ContinuousLoopOrchestrator', 'AutonomousOrchestrator'],
        overlap: 'Both orchestrate long-running agent sessions',
        files: ['.claude/core/continuous-loop-orchestrator.js', 'autonomous-orchestrator.js'],
        recommendation: 'Deprecated version exists - complete migration'
      }
    ];

    // Check if these files actually exist
    for (const overlap of knownOverlaps) {
      let exists = true;
      for (const file of overlap.files) {
        try {
          await fs.access(path.join(this.projectRoot, file));
        } catch {
          exists = false;
        }
      }
      if (exists) {
        overlaps.push(overlap);
      }
    }

    return overlaps;
  }
}

module.exports = DuplicationDetector;
