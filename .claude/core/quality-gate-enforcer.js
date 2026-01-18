/**
 * QualityGateEnforcer - Programmatic enforcement of quality gates
 *
 * Integrates Jest coverage metrics with phase transition validation.
 * Blocks transitions when quality requirements are not met.
 *
 * @module quality-gate-enforcer
 */

const fs = require('fs');
const path = require('path');
const { createComponentLogger } = require('./logger');

// Create logger instance
const logger = createComponentLogger('QualityGateEnforcer');

/**
 * Phase-specific quality requirements
 * These define what metrics must be met before transitioning TO each phase
 */
const PHASE_REQUIREMENTS = {
  research: {
    // No strict requirements to start research
    minCoverage: null,
    minQualityScore: 0,
    requireTestsPass: false,
    description: 'Research phase - gathering information'
  },
  planning: {
    // Research should be documented
    minCoverage: null,
    minQualityScore: 80,
    requireTestsPass: false,
    description: 'Planning phase - requires research completion'
  },
  design: {
    // Planning should be complete
    minCoverage: null,
    minQualityScore: 85,
    requireTestsPass: false,
    description: 'Design phase - requires approved plan'
  },
  'test-first': {
    // Design should be complete before writing tests
    minCoverage: null,
    minQualityScore: 85,
    requireTestsPass: false,
    description: 'Test-first phase - tests may fail initially (TDD red phase)'
  },
  implementation: {
    // Tests should exist, may not all pass yet
    minCoverage: { branches: 0, functions: 0, lines: 0 },
    minQualityScore: 80,
    requireTestsPass: false,
    description: 'Implementation phase - writing code to pass tests'
  },
  validation: {
    // Implementation must meet coverage thresholds
    minCoverage: { branches: 80, functions: 80, lines: 80 },
    minQualityScore: 90,
    requireTestsPass: true,
    requireIntegrationTests: true,
    description: 'Validation phase - requires passing tests and coverage'
  },
  iteration: {
    // Can iterate if validation identified issues
    minCoverage: null,
    minQualityScore: 85,
    requireTestsPass: true,
    description: 'Iteration phase - improving based on validation feedback'
  }
};

/**
 * Critical path patterns that require higher coverage
 */
const CRITICAL_PATHS = {
  'src/main/services/llm/**/*.ts': {
    minCoverage: { branches: 90, functions: 90, lines: 90 },
    description: 'LLM services - critical AI integration'
  },
  'src/main/database/**/*.ts': {
    minCoverage: { branches: 85, functions: 85, lines: 85 },
    description: 'Database layer - data integrity'
  },
  'src/main/security/**/*.ts': {
    minCoverage: { branches: 95, functions: 95, lines: 95 },
    description: 'Security modules - highest priority'
  }
};

class QualityGateEnforcer {
  /**
   * Creates a QualityGateEnforcer instance
   * @param {string} projectRoot - Absolute path to project root
   * @param {Object} options - Configuration options
   */
  constructor(projectRoot, options = {}) {
    this.projectRoot = projectRoot;
    this.coveragePath = path.join(projectRoot, 'coverage', 'coverage-summary.json');
    this.lastRunPath = path.join(projectRoot, 'test-results', '.last-run.json');
    this.auditPath = path.join(projectRoot, '.claude', 'audit', 'quality-gate-audit.json');

    // Allow custom thresholds via options
    this.phaseRequirements = options.phaseRequirements || PHASE_REQUIREMENTS;
    this.criticalPaths = options.criticalPaths || CRITICAL_PATHS;

    // Enforcement mode: 'strict' blocks, 'warn' only logs
    this.enforcementMode = options.enforcementMode || 'strict';

    logger.info('QualityGateEnforcer initialized', {
      projectRoot,
      enforcementMode: this.enforcementMode
    });
  }

  /**
   * Validate quality metrics before phase transition
   * @param {string} fromPhase - Current phase
   * @param {string} toPhase - Target phase
   * @param {number|null} qualityScore - Quality score from phase review
   * @param {Object} options - Additional validation options
   * @returns {Object} Validation result with pass/fail and details
   */
  validateTransition(fromPhase, toPhase, qualityScore = null, options = {}) {
    const requirements = this.phaseRequirements[toPhase];

    if (!requirements) {
      logger.warn('No requirements defined for phase', { toPhase });
      return {
        valid: true,
        reason: `No requirements defined for ${toPhase} phase`,
        warnings: [`Phase ${toPhase} has no defined quality gates`],
        metrics: {}
      };
    }

    const errors = [];
    const warnings = [];
    const metrics = {
      fromPhase,
      toPhase,
      timestamp: new Date().toISOString()
    };

    // 1. Check coverage metrics if required
    if (requirements.minCoverage) {
      const coverageResult = this._validateCoverage(requirements.minCoverage);
      metrics.coverage = coverageResult.metrics;

      if (!coverageResult.valid) {
        errors.push(...coverageResult.errors);
      }
      if (coverageResult.warnings) {
        warnings.push(...coverageResult.warnings);
      }
    }

    // 2. Check quality score
    if (qualityScore !== null && requirements.minQualityScore !== undefined) {
      metrics.qualityScore = qualityScore;
      metrics.requiredQualityScore = requirements.minQualityScore;

      if (qualityScore < requirements.minQualityScore) {
        errors.push(
          `Quality score ${qualityScore}/100 < ${requirements.minQualityScore}/100 required for ${toPhase} phase`
        );
      }
    }

    // 3. Check test pass status
    if (requirements.requireTestsPass) {
      const testResult = this._validateTestStatus();
      metrics.tests = testResult.metrics;

      if (!testResult.valid) {
        errors.push(...testResult.errors);
      }
      if (testResult.warnings) {
        warnings.push(...testResult.warnings);
      }
    }

    // 4. Check critical paths if transitioning to validation
    if (toPhase === 'validation') {
      const criticalResult = this._validateCriticalPaths();
      metrics.criticalPaths = criticalResult.metrics;

      if (!criticalResult.valid) {
        // Critical path failures are warnings for now, not blocking
        warnings.push(...criticalResult.errors);
      }
    }

    // Build result
    const isValid = errors.length === 0;

    if (!isValid) {
      logger.warn('Quality gate validation failed', {
        fromPhase,
        toPhase,
        errors,
        metrics
      });
    } else {
      logger.info('Quality gate validation passed', {
        fromPhase,
        toPhase,
        warnings: warnings.length > 0 ? warnings : undefined
      });
    }

    return {
      valid: isValid,
      reason: isValid
        ? `Quality gate passed for ${toPhase} phase`
        : `Quality gate failed for ${toPhase} phase`,
      errors,
      warnings,
      metrics,
      requirements,
      canForce: true, // Always allow force with documentation
      enforcementMode: this.enforcementMode
    };
  }

  /**
   * Validate coverage against minimum requirements
   * @param {Object} minCoverage - Minimum coverage thresholds
   * @returns {Object} Validation result
   * @private
   */
  _validateCoverage(minCoverage) {
    const coverage = this.getCoverageMetrics();
    const errors = [];
    const warnings = [];

    if (!coverage) {
      warnings.push('Coverage data not available - run npm test --coverage first');
      return {
        valid: true, // Don't block if coverage unavailable
        metrics: null,
        errors: [],
        warnings
      };
    }

    // Check each metric
    if (minCoverage.branches !== undefined && coverage.branches < minCoverage.branches) {
      errors.push(
        `Branch coverage ${coverage.branches.toFixed(1)}% < ${minCoverage.branches}% required`
      );
    }

    if (minCoverage.functions !== undefined && coverage.functions < minCoverage.functions) {
      errors.push(
        `Function coverage ${coverage.functions.toFixed(1)}% < ${minCoverage.functions}% required`
      );
    }

    if (minCoverage.lines !== undefined && coverage.lines < minCoverage.lines) {
      errors.push(
        `Line coverage ${coverage.lines.toFixed(1)}% < ${minCoverage.lines}% required`
      );
    }

    return {
      valid: errors.length === 0,
      metrics: coverage,
      errors,
      warnings
    };
  }

  /**
   * Validate test pass status
   * @returns {Object} Validation result
   * @private
   */
  _validateTestStatus() {
    const testStatus = this.getTestStatus();
    const errors = [];
    const warnings = [];

    if (!testStatus) {
      warnings.push('Test status not available - run npm test first');
      return {
        valid: true, // Don't block if status unavailable
        metrics: null,
        errors: [],
        warnings
      };
    }

    if (testStatus.failures > 0) {
      errors.push(
        `${testStatus.failures} test(s) failing - all tests must pass for this transition`
      );
    }

    if (testStatus.skipped > 10) {
      warnings.push(`${testStatus.skipped} tests skipped - consider enabling more tests`);
    }

    return {
      valid: errors.length === 0,
      metrics: testStatus,
      errors,
      warnings
    };
  }

  /**
   * Validate critical path coverage
   * @returns {Object} Validation result
   * @private
   */
  _validateCriticalPaths() {
    const errors = [];
    const metrics = {};

    for (const [pattern, requirements] of Object.entries(this.criticalPaths)) {
      const pathCoverage = this.getFileCoverage(pattern);
      metrics[pattern] = {
        coverage: pathCoverage,
        required: requirements.minCoverage,
        description: requirements.description
      };

      // Check if any files match this pattern and have low coverage
      for (const [filePath, coverage] of Object.entries(pathCoverage)) {
        if (coverage.lines < requirements.minCoverage.lines) {
          errors.push(
            `Critical path ${path.basename(filePath)}: ${coverage.lines.toFixed(1)}% < ${requirements.minCoverage.lines}% required (${requirements.description})`
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      metrics,
      errors
    };
  }

  /**
   * Parse Jest coverage summary
   * @returns {Object|null} Coverage metrics or null if unavailable
   */
  getCoverageMetrics() {
    try {
      if (!fs.existsSync(this.coveragePath)) {
        logger.debug('Coverage file not found', { path: this.coveragePath });
        return null;
      }

      const coverage = JSON.parse(fs.readFileSync(this.coveragePath, 'utf8'));
      const total = coverage.total;

      if (!total) {
        logger.warn('Coverage file missing total section');
        return null;
      }

      return {
        branches: total.branches.pct,
        functions: total.functions.pct,
        lines: total.lines.pct,
        statements: total.statements.pct
      };
    } catch (error) {
      logger.error('Failed to read coverage', { error: error.message });
      return null;
    }
  }

  /**
   * Get test pass/fail status from last run
   * @returns {Object|null} Test status or null if unavailable
   */
  getTestStatus() {
    try {
      if (!fs.existsSync(this.lastRunPath)) {
        logger.debug('Last run file not found', { path: this.lastRunPath });
        return null;
      }

      const lastRun = JSON.parse(fs.readFileSync(this.lastRunPath, 'utf8'));

      return {
        total: lastRun.numTotalTests || 0,
        passed: lastRun.numPassedTests || 0,
        failures: lastRun.numFailedTests || 0,
        skipped: lastRun.numPendingTests || 0,
        success: lastRun.success !== false
      };
    } catch (error) {
      logger.error('Failed to read test status', { error: error.message });
      return null;
    }
  }

  /**
   * Get coverage for files matching a pattern
   * @param {string} pattern - Glob-like pattern to match
   * @returns {Object} Map of file paths to coverage metrics
   */
  getFileCoverage(pattern) {
    try {
      if (!fs.existsSync(this.coveragePath)) {
        return {};
      }

      const coverage = JSON.parse(fs.readFileSync(this.coveragePath, 'utf8'));
      const matches = {};

      // Convert glob pattern to regex-compatible pattern
      const regexPattern = pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/\\\\]*')
        .replace(/\//g, '[/\\\\]');
      const regex = new RegExp(regexPattern);

      for (const [filePath, data] of Object.entries(coverage)) {
        if (filePath === 'total') continue;

        // Normalize path for comparison
        const normalizedPath = filePath.replace(/\\/g, '/');

        if (regex.test(normalizedPath)) {
          matches[filePath] = {
            branches: data.branches.pct,
            functions: data.functions.pct,
            lines: data.lines.pct,
            statements: data.statements.pct
          };
        }
      }

      return matches;
    } catch (error) {
      logger.error('Failed to get file coverage', { error: error.message, pattern });
      return {};
    }
  }

  /**
   * Log audit entry for quality gate events
   * @param {Object} entry - Audit entry
   */
  logAuditEntry(entry) {
    try {
      const auditDir = path.dirname(this.auditPath);
      if (!fs.existsSync(auditDir)) {
        fs.mkdirSync(auditDir, { recursive: true });
      }

      let audit = [];
      if (fs.existsSync(this.auditPath)) {
        audit = JSON.parse(fs.readFileSync(this.auditPath, 'utf8'));
      }

      audit.push({
        ...entry,
        timestamp: new Date().toISOString()
      });

      // Keep last 200 entries
      if (audit.length > 200) {
        audit = audit.slice(-200);
      }

      fs.writeFileSync(this.auditPath, JSON.stringify(audit, null, 2));
      logger.debug('Audit entry logged', { action: entry.action });
    } catch (error) {
      logger.error('Failed to log audit entry', { error: error.message });
    }
  }

  /**
   * Record a forced bypass of quality gates
   * @param {Object} params - Bypass parameters
   * @param {string} params.fromPhase - Current phase
   * @param {string} params.toPhase - Target phase
   * @param {string} params.reason - Reason for bypass
   * @param {string} params.actor - Who initiated the bypass
   * @param {Array} params.errors - Quality gate errors being bypassed
   * @param {Object} params.metrics - Current metrics at time of bypass
   */
  recordForcedBypass(params) {
    const entry = {
      action: 'FORCED_TRANSITION',
      fromPhase: params.fromPhase,
      toPhase: params.toPhase,
      reason: params.reason,
      actor: params.actor || 'unknown',
      errors: params.errors || [],
      metrics: params.metrics || {},
      severity: 'high'
    };

    this.logAuditEntry(entry);

    logger.warn('Quality gate bypassed', entry);

    return entry;
  }

  /**
   * Get phase requirements
   * @param {string} phase - Phase name
   * @returns {Object|null} Phase requirements or null
   */
  getPhaseRequirements(phase) {
    return this.phaseRequirements[phase] || null;
  }

  /**
   * Get all phase requirements
   * @returns {Object} All phase requirements
   */
  getAllPhaseRequirements() {
    return { ...this.phaseRequirements };
  }

  /**
   * Get audit log
   * @param {number} limit - Maximum entries to return
   * @returns {Array} Audit entries
   */
  getAuditLog(limit = 50) {
    try {
      if (!fs.existsSync(this.auditPath)) {
        return [];
      }

      const audit = JSON.parse(fs.readFileSync(this.auditPath, 'utf8'));
      return audit.slice(-limit);
    } catch (error) {
      logger.error('Failed to read audit log', { error: error.message });
      return [];
    }
  }

  /**
   * Generate quality report for current state
   * @returns {Object} Quality report
   */
  generateReport() {
    const coverage = this.getCoverageMetrics();
    const testStatus = this.getTestStatus();
    const auditLog = this.getAuditLog(10);

    const report = {
      timestamp: new Date().toISOString(),
      coverage: coverage || { available: false },
      tests: testStatus || { available: false },
      recentAudit: auditLog,
      recommendations: []
    };

    // Generate recommendations
    if (coverage) {
      if (coverage.branches < 80) {
        report.recommendations.push(
          `Increase branch coverage from ${coverage.branches.toFixed(1)}% to 80%`
        );
      }
      if (coverage.functions < 80) {
        report.recommendations.push(
          `Increase function coverage from ${coverage.functions.toFixed(1)}% to 80%`
        );
      }
      if (coverage.lines < 80) {
        report.recommendations.push(
          `Increase line coverage from ${coverage.lines.toFixed(1)}% to 80%`
        );
      }
    } else {
      report.recommendations.push('Run npm test --coverage to generate coverage data');
    }

    if (testStatus && testStatus.failures > 0) {
      report.recommendations.push(`Fix ${testStatus.failures} failing test(s)`);
    }

    return report;
  }
}

module.exports = QualityGateEnforcer;
