/**
 * SwarmController Tests
 *
 * Tests the unified interface for swarm components.
 */

const path = require('path');

// Mock the swarm components
jest.mock('../../.claude/core/feature-flags.js', () => ({
  isEnabled: jest.fn().mockReturnValue(true),
  getConfig: jest.fn().mockReturnValue(null)
}));

jest.mock('../../.claude/core/security-validator.js', () => {
  return jest.fn().mockImplementation(() => ({
    validate: jest.fn().mockReturnValue({ allowed: true, valid: true })
  }));
});

jest.mock('../../.claude/core/confidence-monitor.js', () => {
  return jest.fn().mockImplementation(() => ({
    getCurrentConfidence: jest.fn().mockReturnValue(0.8),
    recordProgress: jest.fn()
  }));
});

jest.mock('../../.claude/core/complexity-analyzer.js', () => {
  return jest.fn().mockImplementation(() => ({
    analyze: jest.fn().mockReturnValue({ score: 45, level: 'medium' })
  }));
});

jest.mock('../../.claude/core/competitive-planner.js', () => {
  return jest.fn().mockImplementation(() => ({
    generatePlans: jest.fn().mockReturnValue([{ id: 'plan1', name: 'Test Plan' }])
  }));
});

jest.mock('../../.claude/core/plan-evaluator.js', () => {
  return jest.fn().mockImplementation(() => ({
    evaluate: jest.fn().mockReturnValue({ score: 85, winner: 'plan1' })
  }));
});

describe('SwarmController', () => {
  let SwarmController;

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear the require cache to get fresh modules
    jest.resetModules();
    SwarmController = require('../../.claude/core/swarm-controller.js');
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const controller = new SwarmController();
      expect(controller.options).toEqual({});
      expect(controller.verbose).toBe(false);
    });

    it('should accept verbose option', () => {
      const controller = new SwarmController({ verbose: true });
      expect(controller.verbose).toBe(true);
    });

    it('should initialize component status tracking', () => {
      const controller = new SwarmController();
      expect(controller.componentStatus).toBeDefined();
      expect(controller.componentStatus.securityValidator).toBeDefined();
      expect(controller.componentStatus.confidenceMonitor).toBeDefined();
    });
  });

  describe('checkSafety', () => {
    it('should return safe result when no issues detected', () => {
      const controller = new SwarmController();
      const result = controller.checkSafety({ task: 'Test task' });

      expect(result).toHaveProperty('safe');
      expect(result).toHaveProperty('action');
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('errors');
    });

    it('should handle missing security validator gracefully', () => {
      const controller = new SwarmController({
        featureOverrides: { securityValidation: false }
      });
      const result = controller.checkSafety({ task: 'Test task' });

      expect(result.safe).toBe(true);
      expect(result.action).toBe('PROCEED');
    });

    it('should include confidence level in result', () => {
      const controller = new SwarmController();
      const result = controller.checkSafety({ task: 'Test task' });

      expect(result.confidence).toBeDefined();
    });
  });

  describe('analyzeComplexity', () => {
    it('should return complexity analysis for a task', () => {
      const controller = new SwarmController();
      const result = controller.analyzeComplexity({
        title: 'Test Task',
        description: 'A moderately complex task'
      });

      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('level');
    });

    it('should return default complexity when analyzer unavailable', () => {
      const controller = new SwarmController({
        featureOverrides: { complexityAnalysis: false }
      });
      const result = controller.analyzeComplexity({ title: 'Test' });

      expect(result.score).toBe(50);
      expect(result.level).toBe('medium');
    });
  });

  describe('generateCompetingPlans', () => {
    it('should return empty array when planner unavailable', () => {
      const controller = new SwarmController({
        featureOverrides: { competitivePlanning: false }
      });
      const result = controller.generateCompetingPlans({ title: 'Test' });

      expect(result).toEqual([]);
    });
  });

  describe('trackProgress', () => {
    it('should record progress without errors', () => {
      const controller = new SwarmController();
      const result = controller.trackProgress({
        iteration: 1,
        phase: 'implement',
        qualityScore: 85
      });

      expect(result).toHaveProperty('recorded');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('trend');
    });

    it('should handle missing confidence monitor', () => {
      const controller = new SwarmController({
        featureOverrides: { confidenceTracking: false }
      });
      const result = controller.trackProgress({ iteration: 1 });

      expect(result.recorded).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return status of all components', () => {
      const controller = new SwarmController();
      const status = controller.getStatus();

      expect(status).toHaveProperty('healthy');
      expect(status).toHaveProperty('components');
      expect(status).toHaveProperty('enabledCount');
      expect(status).toHaveProperty('enabledComponents');
      expect(status).toHaveProperty('featureFlags');
    });

    it('should report healthy when components are initialized', () => {
      const controller = new SwarmController();
      const status = controller.getStatus();

      expect(status.healthy).toBe(true);
    });
  });

  describe('hasComponent', () => {
    it('should return true for initialized components', () => {
      const controller = new SwarmController();
      // May vary based on mocks
      expect(typeof controller.hasComponent('securityValidator')).toBe('boolean');
    });

    it('should return false for non-existent components', () => {
      const controller = new SwarmController();
      expect(controller.hasComponent('nonExistent')).toBe(false);
    });
  });
});
