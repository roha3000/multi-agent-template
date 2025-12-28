/**
 * Dependency Analyzer
 *
 * Analyzes npm dependencies for issues and optimization opportunities.
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

class DependencyAnalyzer {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  async analyze() {
    const findings = {
      unusedDependencies: [],
      unusedDevDependencies: [],
      duplicateFunctionality: [],
      securityIssues: [],
      outdatedPackages: [],
      summary: {
        totalDependencies: 0,
        unusedDeps: 0,
        unusedDevDeps: 0,
        securityHigh: 0,
        securityMedium: 0,
        majorUpdatesAvailable: 0,
        potentialSavingsKB: 0
      }
    };

    try {
      // Read package.json
      const packageJson = await this.readPackageJson();
      if (!packageJson) return findings;

      const deps = Object.keys(packageJson.dependencies || {});
      const devDeps = Object.keys(packageJson.devDependencies || {});

      findings.summary.totalDependencies = deps.length + devDeps.length;

      // Find unused dependencies
      findings.unusedDependencies = await this.findUnusedDeps(deps, 'dependency');
      findings.unusedDevDependencies = await this.findUnusedDeps(devDeps, 'devDependency');

      findings.summary.unusedDeps = findings.unusedDependencies.length;
      findings.summary.unusedDevDeps = findings.unusedDevDependencies.length;

      // Find duplicate functionality
      findings.duplicateFunctionality = this.findDuplicateFunctionality(deps);

      // Run npm audit
      findings.securityIssues = await this.runSecurityAudit();
      findings.summary.securityHigh = findings.securityIssues.filter(i =>
        i.severity === 'high' || i.severity === 'critical'
      ).length;
      findings.summary.securityMedium = findings.securityIssues.filter(i =>
        i.severity === 'moderate' || i.severity === 'medium'
      ).length;

      // Check for outdated packages
      findings.outdatedPackages = await this.findOutdatedPackages();
      findings.summary.majorUpdatesAvailable = findings.outdatedPackages.filter(p =>
        p.majorVersionsBehind > 0
      ).length;

    } catch (error) {
      console.error('Dependency analysis error:', error.message);
    }

    return findings;
  }

  async readPackageJson() {
    try {
      const content = await fs.readFile(
        path.join(this.projectRoot, 'package.json'),
        'utf8'
      );
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async findUnusedDeps(deps, type) {
    const unused = [];
    const searchDirs = ['.claude', 'scripts', 'examples', 'tests', '__tests__', ''];

    for (const dep of deps) {
      let isUsed = false;

      // Search for require or import of this package
      for (const dir of searchDirs) {
        if (isUsed) break;

        const searchPath = dir
          ? path.join(this.projectRoot, dir)
          : this.projectRoot;

        try {
          const found = await this.searchInDirectory(searchPath, dep);
          if (found) isUsed = true;
        } catch {
          // Directory not found
        }
      }

      // Check if used in package.json scripts
      const packageJson = await this.readPackageJson();
      if (packageJson?.scripts) {
        const scriptsStr = JSON.stringify(packageJson.scripts);
        if (scriptsStr.includes(dep)) isUsed = true;
      }

      if (!isUsed) {
        unused.push({
          package: dep,
          type,
          recommendation: 'REMOVE from package.json'
        });
      }
    }

    return unused;
  }

  async searchInDirectory(dir, packageName, depth = 0) {
    if (depth > 3) return false;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          const found = await this.searchInDirectory(fullPath, packageName, depth + 1);
          if (found) return true;
        } else if (entry.name.endsWith('.js') || entry.name.endsWith('.ts')) {
          const content = await fs.readFile(fullPath, 'utf8');
          // Check for require('package') or from 'package'
          if (
            content.includes(`require('${packageName}')`) ||
            content.includes(`require("${packageName}")`) ||
            content.includes(`from '${packageName}'`) ||
            content.includes(`from "${packageName}"`)
          ) {
            return true;
          }
        }
      }
    } catch {
      // Error reading directory
    }

    return false;
  }

  findDuplicateFunctionality(deps) {
    const duplicates = [];

    // Known overlapping packages
    const overlaps = [
      {
        packages: ['moment', 'dayjs', 'date-fns', 'luxon'],
        functionality: 'Date manipulation',
        recommendation: 'Keep one (dayjs recommended - smallest)'
      },
      {
        packages: ['lodash', 'underscore', 'ramda'],
        functionality: 'Utility functions',
        recommendation: 'Keep one (lodash-es for tree-shaking)'
      },
      {
        packages: ['axios', 'node-fetch', 'got', 'superagent'],
        functionality: 'HTTP client',
        recommendation: 'Keep one (native fetch in Node 18+)'
      },
      {
        packages: ['winston', 'pino', 'bunyan', 'log4js'],
        functionality: 'Logging',
        recommendation: 'Keep one'
      },
      {
        packages: ['uuid', 'nanoid', 'cuid'],
        functionality: 'ID generation',
        recommendation: 'Keep one (nanoid is smallest)'
      }
    ];

    for (const overlap of overlaps) {
      const installed = overlap.packages.filter(p => deps.includes(p));
      if (installed.length > 1) {
        duplicates.push({
          packages: installed,
          functionality: overlap.functionality,
          recommendation: overlap.recommendation
        });
      }
    }

    return duplicates;
  }

  async runSecurityAudit() {
    const issues = [];

    try {
      // Run npm audit --json
      const result = execSync('npm audit --json 2>/dev/null', {
        cwd: this.projectRoot,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024
      });

      const audit = JSON.parse(result);

      if (audit.vulnerabilities) {
        for (const [pkg, vuln] of Object.entries(audit.vulnerabilities)) {
          issues.push({
            package: pkg,
            severity: vuln.severity,
            vulnerability: vuln.via?.[0]?.title || 'Unknown vulnerability',
            fixedIn: vuln.fixAvailable?.version || 'No fix available',
            recommendation: vuln.fixAvailable ? 'UPDATE' : 'EVALUATE alternatives'
          });
        }
      }
    } catch (error) {
      // npm audit failed or returned non-zero (has vulnerabilities)
      try {
        const output = error.stdout || error.message;
        if (output.includes('{')) {
          const audit = JSON.parse(output.substring(output.indexOf('{')));
          if (audit.vulnerabilities) {
            for (const [pkg, vuln] of Object.entries(audit.vulnerabilities)) {
              issues.push({
                package: pkg,
                severity: vuln.severity || 'unknown',
                vulnerability: vuln.via?.[0]?.title || 'Vulnerability detected',
                recommendation: 'REVIEW'
              });
            }
          }
        }
      } catch {
        // Could not parse audit output
      }
    }

    return issues;
  }

  async findOutdatedPackages() {
    const outdated = [];

    try {
      const result = execSync('npm outdated --json 2>/dev/null', {
        cwd: this.projectRoot,
        encoding: 'utf8'
      });

      const packages = JSON.parse(result || '{}');

      for (const [pkg, info] of Object.entries(packages)) {
        const currentMajor = parseInt(info.current?.split('.')[0] || '0');
        const latestMajor = parseInt(info.latest?.split('.')[0] || '0');

        outdated.push({
          package: pkg,
          currentVersion: info.current,
          latestVersion: info.latest,
          majorVersionsBehind: latestMajor - currentMajor,
          recommendation: latestMajor > currentMajor ? 'EVALUATE upgrade path' : 'UPDATE'
        });
      }
    } catch {
      // npm outdated failed or no outdated packages
    }

    return outdated;
  }
}

module.exports = DependencyAnalyzer;
