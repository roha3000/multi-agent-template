/**
 * Database Inspector
 *
 * Analyzes SQLite database health, usage, and cleanup opportunities.
 */

const fs = require('fs').promises;
const path = require('path');

class DatabaseInspector {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  async analyze() {
    const findings = {
      databases: [],
      duplicateSchemas: [],
      cleanupTargets: [],
      summary: {
        totalDatabases: 0,
        activeWithData: 0,
        emptyDatabases: 0,
        orphanedTestDBs: 0,
        totalCleanupSize: 0,
        duplicateSchemaGroups: 0
      }
    };

    try {
      // Find all databases
      const databases = await this.findDatabases();
      findings.databases = databases;
      findings.summary.totalDatabases = databases.length;

      // Categorize databases
      for (const db of databases) {
        if (db.status === 'EMPTY') findings.summary.emptyDatabases++;
        if (db.status === 'ACTIVE') findings.summary.activeWithData++;
        if (db.status === 'ORPHANED_TEST') {
          findings.summary.orphanedTestDBs++;
          findings.cleanupTargets.push({
            path: db.path,
            reason: 'Orphaned test artifact',
            size: db.size,
            action: 'DELETE'
          });
          findings.summary.totalCleanupSize += this.parseSize(db.size);
        }
      }

      // Find duplicate schemas
      findings.duplicateSchemas = await this.findDuplicateSchemas(databases);
      findings.summary.duplicateSchemaGroups = findings.duplicateSchemas.length;

    } catch (error) {
      console.error('Database inspection error:', error.message);
    }

    return findings;
  }

  async findDatabases() {
    const databases = [];
    const locations = [
      { path: '.claude/data', type: 'production' },
      { path: '.claude/memory', type: 'production' },
      { path: '__tests__', type: 'test' },
      { path: 'tests', type: 'test' }
    ];

    for (const loc of locations) {
      await this.scanDirectory(loc.path, loc.type, databases);
    }

    return databases;
  }

  async scanDirectory(dir, type, databases) {
    const fullPath = path.join(this.projectRoot, dir);
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await this.scanDirectory(entryPath, type, databases);
        } else if (entry.name.endsWith('.db')) {
          const dbInfo = await this.analyzeDatabase(entryPath, type);
          databases.push(dbInfo);
        }
      }
    } catch {
      // Directory not found
    }
  }

  async analyzeDatabase(dbPath, type) {
    const fullPath = path.join(this.projectRoot, dbPath);
    let stat;

    try {
      stat = await fs.stat(fullPath);
    } catch {
      return {
        path: dbPath,
        size: '0 KB',
        tables: 0,
        totalRows: 0,
        lastModified: 'unknown',
        status: 'ERROR',
        usedBy: [],
        issues: ['Could not stat file']
      };
    }

    const size = this.formatSize(stat.size);
    const lastModified = stat.mtime.toISOString().split('T')[0];

    // Determine status
    let status = 'UNKNOWN';
    let tables = 0;
    let totalRows = 0;

    try {
      // Try to open with better-sqlite3
      const Database = require('better-sqlite3');
      const db = new Database(fullPath, { readonly: true });

      // Count tables
      const tableList = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      ).all();
      tables = tableList.length;

      // Count total rows
      for (const table of tableList) {
        try {
          const count = db.prepare(`SELECT COUNT(*) as c FROM "${table.name}"`).get();
          totalRows += count.c;
        } catch {
          // Table might have issues
        }
      }

      db.close();

      // Determine status
      if (type === 'test') {
        status = 'ORPHANED_TEST';
      } else if (totalRows === 0) {
        status = 'EMPTY';
      } else {
        status = 'ACTIVE';
      }

    } catch (error) {
      // Could not open database
      if (type === 'test') {
        status = 'ORPHANED_TEST';
      } else {
        status = 'ERROR';
      }
    }

    // Find what code uses this database
    const usedBy = await this.findUsages(path.basename(dbPath));

    return {
      path: dbPath,
      size,
      tables,
      totalRows,
      lastModified,
      status,
      usedBy,
      issues: status === 'EMPTY' ? ['All tables empty'] : []
    };
  }

  async findUsages(dbName) {
    const usages = [];
    const searchDirs = ['.claude/core', 'scripts'];

    for (const dir of searchDirs) {
      const fullDir = path.join(this.projectRoot, dir);
      try {
        const files = await fs.readdir(fullDir);
        for (const file of files) {
          if (!file.endsWith('.js')) continue;
          const content = await fs.readFile(path.join(fullDir, file), 'utf8');
          if (content.includes(dbName)) {
            usages.push(`${dir}/${file}`);
          }
        }
      } catch {
        // Directory not found
      }
    }

    return usages;
  }

  async findDuplicateSchemas(databases) {
    const duplicates = [];
    const schemaMap = new Map();

    for (const db of databases) {
      if (db.status === 'ERROR' || db.status === 'ORPHANED_TEST') continue;

      try {
        const Database = require('better-sqlite3');
        const fullPath = path.join(this.projectRoot, db.path);
        const database = new Database(fullPath, { readonly: true });

        // Get all table names as schema signature
        const tables = database.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).all().map(t => t.name);

        database.close();

        const signature = tables.join(',');

        if (!schemaMap.has(signature)) {
          schemaMap.set(signature, []);
        }
        schemaMap.get(signature).push(db.path);

      } catch {
        // Skip databases we can't open
      }
    }

    // Find schemas with multiple databases
    for (const [schema, paths] of schemaMap) {
      if (paths.length > 1) {
        duplicates.push({
          databases: paths,
          sharedTables: schema.split(','),
          recommendation: `Keep one, delete ${paths.length - 1} duplicates`
        });
      }
    }

    return duplicates;
  }

  formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  parseSize(sizeStr) {
    const match = sizeStr.match(/([\d.]+)\s*(B|KB|MB|GB)/i);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();

    switch (unit) {
      case 'B': return value / 1024;
      case 'KB': return value;
      case 'MB': return value * 1024;
      case 'GB': return value * 1024 * 1024;
      default: return 0;
    }
  }
}

module.exports = DatabaseInspector;
