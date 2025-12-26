/**
 * Tests for Feature Flags module
 *
 * @module __tests__/core/feature-flags.test
 */

const { FeatureFlags } = require('../../.claude/core/feature-flags');

describe('FeatureFlags', () => {
  let originalEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Constructor and Defaults', () => {
    test('should initialize with all flags enabled by default', () => {
      // Clear any existing flags
      delete process.env.ENABLE_COMPETITIVE_PLANNING;
      delete process.env.ENABLE_COMPLEXITY_DETECTION;
      delete process.env.ENABLE_CONFIDENCE_MONITORING;
      delete process.env.ENABLE_SECURITY_VALIDATION;

      const flags = new FeatureFlags();
      const all = flags.getAll();

      expect(all.competitivePlanning).toBe(true);
      expect(all.complexityDetection).toBe(true);
      expect(all.confidenceMonitoring).toBe(true);
      expect(all.securityValidation).toBe(true);
    });

    test('should allow custom defaults via options', () => {
      delete process.env.ENABLE_COMPETITIVE_PLANNING;

      const flags = new FeatureFlags({
        defaults: {
          competitivePlanning: false,
          complexityDetection: true,
          confidenceMonitoring: true,
          securityValidation: true
        }
      });

      expect(flags.isEnabled('competitivePlanning')).toBe(false);
    });
  });

  describe('Environment Variable Parsing', () => {
    test('should read "true" as enabled', () => {
      process.env.ENABLE_COMPETITIVE_PLANNING = 'true';
      const flags = new FeatureFlags();
      expect(flags.isEnabled('competitivePlanning')).toBe(true);
    });

    test('should read "false" as disabled', () => {
      process.env.ENABLE_COMPETITIVE_PLANNING = 'false';
      const flags = new FeatureFlags();
      expect(flags.isEnabled('competitivePlanning')).toBe(false);
    });

    test('should read "1" as enabled', () => {
      process.env.ENABLE_COMPLEXITY_DETECTION = '1';
      const flags = new FeatureFlags();
      expect(flags.isEnabled('complexityDetection')).toBe(true);
    });

    test('should read "0" as disabled', () => {
      process.env.ENABLE_COMPLEXITY_DETECTION = '0';
      const flags = new FeatureFlags();
      expect(flags.isEnabled('complexityDetection')).toBe(false);
    });

    test('should read "yes" as enabled', () => {
      process.env.ENABLE_CONFIDENCE_MONITORING = 'yes';
      const flags = new FeatureFlags();
      expect(flags.isEnabled('confidenceMonitoring')).toBe(true);
    });

    test('should read "no" as disabled', () => {
      process.env.ENABLE_CONFIDENCE_MONITORING = 'no';
      const flags = new FeatureFlags();
      expect(flags.isEnabled('confidenceMonitoring')).toBe(false);
    });

    test('should read "on" as enabled', () => {
      process.env.ENABLE_SECURITY_VALIDATION = 'on';
      const flags = new FeatureFlags();
      expect(flags.isEnabled('securityValidation')).toBe(true);
    });

    test('should read "off" as disabled', () => {
      process.env.ENABLE_SECURITY_VALIDATION = 'off';
      const flags = new FeatureFlags();
      expect(flags.isEnabled('securityValidation')).toBe(false);
    });

    test('should read "enabled" as enabled', () => {
      process.env.ENABLE_COMPETITIVE_PLANNING = 'enabled';
      const flags = new FeatureFlags();
      expect(flags.isEnabled('competitivePlanning')).toBe(true);
    });

    test('should read "disabled" as disabled', () => {
      process.env.ENABLE_COMPETITIVE_PLANNING = 'disabled';
      const flags = new FeatureFlags();
      expect(flags.isEnabled('competitivePlanning')).toBe(false);
    });

    test('should handle case-insensitivity', () => {
      process.env.ENABLE_COMPETITIVE_PLANNING = 'TRUE';
      process.env.ENABLE_COMPLEXITY_DETECTION = 'FALSE';
      const flags = new FeatureFlags();
      expect(flags.isEnabled('competitivePlanning')).toBe(true);
      expect(flags.isEnabled('complexityDetection')).toBe(false);
    });

    test('should handle whitespace', () => {
      process.env.ENABLE_COMPETITIVE_PLANNING = '  true  ';
      const flags = new FeatureFlags();
      expect(flags.isEnabled('competitivePlanning')).toBe(true);
    });

    test('should return default for invalid values', () => {
      process.env.ENABLE_COMPETITIVE_PLANNING = 'maybe';
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const flags = new FeatureFlags();
      expect(flags.isEnabled('competitivePlanning')).toBe(true); // Default is true
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid value for ENABLE_COMPETITIVE_PLANNING')
      );
      consoleSpy.mockRestore();
    });

    test('should return default for empty string', () => {
      process.env.ENABLE_COMPETITIVE_PLANNING = '';
      const flags = new FeatureFlags();
      expect(flags.isEnabled('competitivePlanning')).toBe(true); // Default
    });
  });

  describe('isEnabled', () => {
    test('should return false for unknown features', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const flags = new FeatureFlags();
      expect(flags.isEnabled('unknownFeature')).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown feature: unknownFeature')
      );
      consoleSpy.mockRestore();
    });

    test('should return correct value for each known feature', () => {
      process.env.ENABLE_COMPETITIVE_PLANNING = 'false';
      process.env.ENABLE_COMPLEXITY_DETECTION = 'true';
      process.env.ENABLE_CONFIDENCE_MONITORING = 'false';
      process.env.ENABLE_SECURITY_VALIDATION = 'true';

      const flags = new FeatureFlags();
      expect(flags.isEnabled('competitivePlanning')).toBe(false);
      expect(flags.isEnabled('complexityDetection')).toBe(true);
      expect(flags.isEnabled('confidenceMonitoring')).toBe(false);
      expect(flags.isEnabled('securityValidation')).toBe(true);
    });
  });

  describe('getAll', () => {
    test('should return all flags', () => {
      const flags = new FeatureFlags();
      const all = flags.getAll();

      expect(all).toHaveProperty('competitivePlanning');
      expect(all).toHaveProperty('complexityDetection');
      expect(all).toHaveProperty('confidenceMonitoring');
      expect(all).toHaveProperty('securityValidation');
    });

    test('should return a copy (not the original)', () => {
      const flags = new FeatureFlags();
      const all = flags.getAll();
      all.competitivePlanning = false;

      // Original should not be affected
      expect(flags.isEnabled('competitivePlanning')).toBe(true);
    });
  });

  describe('getEnabled and getDisabled', () => {
    test('should list enabled features', () => {
      process.env.ENABLE_COMPETITIVE_PLANNING = 'true';
      process.env.ENABLE_COMPLEXITY_DETECTION = 'false';
      process.env.ENABLE_CONFIDENCE_MONITORING = 'true';
      process.env.ENABLE_SECURITY_VALIDATION = 'false';

      const flags = new FeatureFlags();
      const enabled = flags.getEnabled();

      expect(enabled).toContain('competitivePlanning');
      expect(enabled).toContain('confidenceMonitoring');
      expect(enabled).not.toContain('complexityDetection');
      expect(enabled).not.toContain('securityValidation');
    });

    test('should list disabled features', () => {
      process.env.ENABLE_COMPETITIVE_PLANNING = 'false';
      process.env.ENABLE_COMPLEXITY_DETECTION = 'true';
      process.env.ENABLE_CONFIDENCE_MONITORING = 'false';
      process.env.ENABLE_SECURITY_VALIDATION = 'true';

      const flags = new FeatureFlags();
      const disabled = flags.getDisabled();

      expect(disabled).toContain('competitivePlanning');
      expect(disabled).toContain('confidenceMonitoring');
      expect(disabled).not.toContain('complexityDetection');
      expect(disabled).not.toContain('securityValidation');
    });
  });

  describe('setFlag (Runtime Override)', () => {
    test('should override flag at runtime', () => {
      const flags = new FeatureFlags();
      expect(flags.isEnabled('competitivePlanning')).toBe(true);

      flags.setFlag('competitivePlanning', false);
      expect(flags.isEnabled('competitivePlanning')).toBe(false);
    });

    test('should throw for unknown features', () => {
      const flags = new FeatureFlags();
      expect(() => flags.setFlag('unknownFeature', true)).toThrow('Unknown feature: unknownFeature');
    });

    test('should emit flag:changed event when value changes', () => {
      const flags = new FeatureFlags();
      const listener = jest.fn();
      flags.on('flag:changed', listener);

      flags.setFlag('competitivePlanning', false);

      expect(listener).toHaveBeenCalledWith({
        feature: 'competitivePlanning',
        previous: true,
        current: false
      });
    });

    test('should not emit event when value is same', () => {
      const flags = new FeatureFlags();
      const listener = jest.fn();
      flags.on('flag:changed', listener);

      flags.setFlag('competitivePlanning', true); // Same as default

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('reload', () => {
    test('should reload flags from environment', () => {
      // Start with default (true)
      const flags = new FeatureFlags();
      expect(flags.isEnabled('competitivePlanning')).toBe(true);

      // Change environment
      process.env.ENABLE_COMPETITIVE_PLANNING = 'false';

      // Reload
      flags.reload();

      expect(flags.isEnabled('competitivePlanning')).toBe(false);
    });

    test('should emit flags:reloaded event with changes', () => {
      const flags = new FeatureFlags();
      const listener = jest.fn();
      flags.on('flags:reloaded', listener);

      // Change environment
      process.env.ENABLE_COMPETITIVE_PLANNING = 'false';
      process.env.ENABLE_COMPLEXITY_DETECTION = 'false';

      flags.reload();

      expect(listener).toHaveBeenCalledWith({
        changes: expect.arrayContaining([
          { feature: 'competitivePlanning', previous: true, current: false },
          { feature: 'complexityDetection', previous: true, current: false }
        ])
      });
    });

    test('should not emit event if no changes', () => {
      const flags = new FeatureFlags();
      const listener = jest.fn();
      flags.on('flags:reloaded', listener);

      // No changes to env
      flags.reload();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('getSummary', () => {
    test('should return summary object', () => {
      process.env.ENABLE_COMPETITIVE_PLANNING = 'true';
      process.env.ENABLE_COMPLEXITY_DETECTION = 'false';
      process.env.ENABLE_CONFIDENCE_MONITORING = 'true';
      process.env.ENABLE_SECURITY_VALIDATION = 'false';

      const flags = new FeatureFlags();
      const summary = flags.getSummary();

      expect(summary.total).toBe(4);
      expect(summary.enabled).toBe(2);
      expect(summary.disabled).toBe(2);
      expect(summary.flags).toEqual({
        competitivePlanning: true,
        complexityDetection: false,
        confidenceMonitoring: true,
        securityValidation: false
      });
    });
  });

  describe('Singleton Instance', () => {
    test('should export a singleton instance', () => {
      const instance = require('../../.claude/core/feature-flags');
      expect(instance.isEnabled).toBeDefined();
      expect(instance.getAll).toBeDefined();
      expect(instance.getSummary).toBeDefined();
    });

    test('should also export the class', () => {
      const { FeatureFlags } = require('../../.claude/core/feature-flags');
      expect(FeatureFlags).toBeDefined();
      expect(new FeatureFlags()).toBeInstanceOf(FeatureFlags);
    });
  });
});
