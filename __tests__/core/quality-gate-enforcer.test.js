/**
 * Unit tests for QualityGateEnforcer
 */

const fs = require('fs');
const path = require('path');

// Mock fs module before requiring the enforcer
jest.mock('fs');

// Mock the logger to avoid console output during tests
jest.mock('../../.claude/core/logger', () => ({
  createComponentLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

const QualityGateEnforcer = require('../../.claude/core/quality-gate-enforcer');

describe('QualityGateEnforcer', () => {
  let enforcer;
  const projectRoot = '/test/project';

  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});

    enforcer = new QualityGateEnforcer(projectRoot);
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      expect(enforcer.projectRoot).toBe(projectRoot);
      expect(enforcer.enforcementMode).toBe('strict');
    });

    it('should accept custom enforcement mode', () => {
      const customEnforcer = new QualityGateEnforcer(projectRoot, {
        enforcementMode: 'warn'
      });
      expect(customEnforcer.enforcementMode).toBe('warn');
    });

    it('should accept custom phase requirements', () => {
      const customRequirements = {
        implementation: {
          minCoverage: { branches: 50 },
          minQualityScore: 70
        }
      };
      const customEnforcer = new QualityGateEnforcer(projectRoot, {
        phaseRequirements: customRequirements
      });
      expect(customEnforcer.phaseRequirements).toBe(customRequirements);
    });
  });

  describe('validateTransition', () => {
    it('should pass when transitioning to phase with no requirements', () => {
      const result = enforcer.validateTransition('planning', 'research', null);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should pass when quality score meets minimum', () => {
      const result = enforcer.validateTransition('research', 'planning', 85);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.metrics.qualityScore).toBe(85);
    });

    it('should fail when quality score is below minimum', () => {
      const result = enforcer.validateTransition('research', 'planning', 70);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Quality score 70/100 < 80/100'))).toBe(true);
    });

    it('should pass when coverage meets requirements', () => {
      // Mock coverage file
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({
        total: {
          branches: { pct: 85 },
          functions: { pct: 90 },
          lines: { pct: 88 },
          statements: { pct: 87 }
        }
      }));

      const result = enforcer.validateTransition('implementation', 'validation', 92);

      expect(result.valid).toBe(true);
      expect(result.metrics.coverage).toBeDefined();
      expect(result.metrics.coverage.branches).toBe(85);
    });

    it('should fail when coverage is below requirements', () => {
      // Mock low coverage
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({
        total: {
          branches: { pct: 60 },
          functions: { pct: 65 },
          lines: { pct: 70 },
          statements: { pct: 68 }
        }
      }));

      const result = enforcer.validateTransition('implementation', 'validation', 92);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Branch coverage 60.0% < 80% required'))).toBe(true);
      expect(result.errors.some(e => e.includes('Function coverage 65.0% < 80% required'))).toBe(true);
    });

    it('should warn but not fail when coverage file is missing', () => {
      fs.existsSync.mockReturnValue(false);

      const result = enforcer.validateTransition('implementation', 'validation', 92);

      expect(result.warnings.some(w => w.includes('Coverage data not available'))).toBe(true);
      // Should not fail due to missing coverage - only quality score errors
      expect(result.errors.filter(e => e.toLowerCase().includes('coverage'))).toEqual([]);
    });

    it('should check test pass status when required', () => {
      // Mock passing coverage
      fs.existsSync.mockImplementation((filePath) => {
        if (filePath.includes('coverage-summary.json')) return true;
        if (filePath.includes('.last-run.json')) return true;
        return false;
      });

      fs.readFileSync.mockImplementation((filePath) => {
        if (filePath.includes('coverage-summary.json')) {
          return JSON.stringify({
            total: {
              branches: { pct: 85 },
              functions: { pct: 90 },
              lines: { pct: 88 },
              statements: { pct: 87 }
            }
          });
        }
        if (filePath.includes('.last-run.json')) {
          return JSON.stringify({
            numTotalTests: 100,
            numPassedTests: 100,
            numFailedTests: 0,
            numPendingTests: 2,
            success: true
          });
        }
        return '';
      });

      const result = enforcer.validateTransition('implementation', 'validation', 92);

      expect(result.valid).toBe(true);
      expect(result.metrics.tests).toBeDefined();
      expect(result.metrics.tests.failures).toBe(0);
    });

    it('should fail when tests are failing and required to pass', () => {
      fs.existsSync.mockReturnValue(true);

      fs.readFileSync.mockImplementation((filePath) => {
        if (filePath.includes('coverage-summary.json')) {
          return JSON.stringify({
            total: {
              branches: { pct: 85 },
              functions: { pct: 90 },
              lines: { pct: 88 },
              statements: { pct: 87 }
            }
          });
        }
        if (filePath.includes('.last-run.json')) {
          return JSON.stringify({
            numTotalTests: 100,
            numPassedTests: 95,
            numFailedTests: 5,
            numPendingTests: 0,
            success: false
          });
        }
        return '';
      });

      const result = enforcer.validateTransition('implementation', 'validation', 92);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('5 test(s) failing'))).toBe(true);
    });

    it('should include canForce: true in result', () => {
      const result = enforcer.validateTransition('research', 'planning', 70);

      expect(result.canForce).toBe(true);
    });

    it('should return phase requirements in result', () => {
      const result = enforcer.validateTransition('research', 'planning', 85);

      expect(result.requirements).toBeDefined();
      expect(result.requirements.minQualityScore).toBe(80);
    });
  });

  describe('getCoverageMetrics', () => {
    it('should return null when coverage file does not exist', () => {
      fs.existsSync.mockReturnValue(false);

      const result = enforcer.getCoverageMetrics();

      expect(result).toBeNull();
    });

    it('should parse coverage file correctly', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({
        total: {
          branches: { pct: 75.5 },
          functions: { pct: 80.2 },
          lines: { pct: 82.1 },
          statements: { pct: 81.5 }
        }
      }));

      const result = enforcer.getCoverageMetrics();

      expect(result).toEqual({
        branches: 75.5,
        functions: 80.2,
        lines: 82.1,
        statements: 81.5
      });
    });

    it('should return null when coverage file is malformed', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('invalid json');

      const result = enforcer.getCoverageMetrics();

      expect(result).toBeNull();
    });

    it('should return null when total section is missing', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({
        someFile: { branches: { pct: 100 } }
      }));

      const result = enforcer.getCoverageMetrics();

      expect(result).toBeNull();
    });
  });

  describe('getTestStatus', () => {
    it('should return null when test results file does not exist', () => {
      fs.existsSync.mockReturnValue(false);

      const result = enforcer.getTestStatus();

      expect(result).toBeNull();
    });

    it('should parse test results correctly', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({
        numTotalTests: 150,
        numPassedTests: 145,
        numFailedTests: 3,
        numPendingTests: 2,
        success: false
      }));

      const result = enforcer.getTestStatus();

      expect(result).toEqual({
        total: 150,
        passed: 145,
        failures: 3,
        skipped: 2,
        success: false
      });
    });
  });

  describe('getFileCoverage', () => {
    it('should return empty object when coverage file does not exist', () => {
      fs.existsSync.mockReturnValue(false);

      const result = enforcer.getFileCoverage('src/**/*.ts');

      expect(result).toEqual({});
    });

    it('should filter files by pattern', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({
        total: { branches: { pct: 80 } },
        'C:/project/src/main/services/llm/LLMService.ts': {
          branches: { pct: 90 },
          functions: { pct: 95 },
          lines: { pct: 92 },
          statements: { pct: 91 }
        },
        'C:/project/src/main/services/other/OtherService.ts': {
          branches: { pct: 70 },
          functions: { pct: 75 },
          lines: { pct: 72 },
          statements: { pct: 71 }
        }
      }));

      // Use a simpler pattern that matches the path structure
      const result = enforcer.getFileCoverage('services/llm');

      // Should match LLM service
      expect(Object.keys(result).some(k => k.includes('LLMService'))).toBe(true);
    });
  });

  describe('recordForcedBypass', () => {
    it('should create audit entry for forced bypass', () => {
      fs.existsSync.mockReturnValue(false);

      const params = {
        fromPhase: 'implementation',
        toPhase: 'validation',
        reason: 'Critical deadline',
        actor: 'test-user',
        errors: ['Coverage below threshold'],
        metrics: { coverage: { branches: 60 } }
      };

      const entry = enforcer.recordForcedBypass(params);

      expect(entry.action).toBe('FORCED_TRANSITION');
      expect(entry.reason).toBe('Critical deadline');
      expect(entry.severity).toBe('high');

      // Verify file write was called
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should append to existing audit log', () => {
      const existingAudit = [
        { action: 'PREVIOUS_ENTRY', timestamp: '2024-01-01' }
      ];

      fs.existsSync.mockImplementation((p) => {
        if (p.includes('audit')) return true;
        return false;
      });
      fs.readFileSync.mockReturnValue(JSON.stringify(existingAudit));

      enforcer.recordForcedBypass({
        fromPhase: 'implementation',
        toPhase: 'validation',
        reason: 'Test',
        actor: 'test-user'
      });

      const writeCall = fs.writeFileSync.mock.calls[0];
      const writtenData = JSON.parse(writeCall[1]);

      expect(writtenData.length).toBe(2);
      expect(writtenData[0].action).toBe('PREVIOUS_ENTRY');
      expect(writtenData[1].action).toBe('FORCED_TRANSITION');
    });
  });

  describe('getPhaseRequirements', () => {
    it('should return requirements for valid phase', () => {
      const requirements = enforcer.getPhaseRequirements('validation');

      expect(requirements).toBeDefined();
      expect(requirements.minQualityScore).toBe(90);
      expect(requirements.requireTestsPass).toBe(true);
    });

    it('should return null for unknown phase', () => {
      const requirements = enforcer.getPhaseRequirements('unknown');

      expect(requirements).toBeNull();
    });
  });

  describe('generateReport', () => {
    it('should generate report with coverage data', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockImplementation((filePath) => {
        if (filePath.includes('coverage-summary.json')) {
          return JSON.stringify({
            total: {
              branches: { pct: 70 },
              functions: { pct: 75 },
              lines: { pct: 78 },
              statements: { pct: 77 }
            }
          });
        }
        if (filePath.includes('.last-run.json')) {
          return JSON.stringify({
            numTotalTests: 100,
            numPassedTests: 98,
            numFailedTests: 2,
            numPendingTests: 0
          });
        }
        if (filePath.includes('audit')) {
          return JSON.stringify([]);
        }
        return '';
      });

      const report = enforcer.generateReport();

      expect(report.coverage.branches).toBe(70);
      expect(report.tests.failures).toBe(2);
      expect(report.recommendations.some(r => r.includes('Increase branch coverage'))).toBe(true);
      expect(report.recommendations.some(r => r.includes('Fix 2 failing test'))).toBe(true);
    });

    it('should recommend running tests when coverage unavailable', () => {
      fs.existsSync.mockReturnValue(false);

      const report = enforcer.generateReport();

      expect(report.coverage.available).toBe(false);
      expect(report.recommendations.some(r => r.includes('Run npm test --coverage'))).toBe(true);
    });
  });
});
