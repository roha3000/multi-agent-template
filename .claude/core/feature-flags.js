/**
 * Feature Flags for Swarm Components
 *
 * Enable/disable swarm features via environment variables.
 * All features default to TRUE for backward compatibility with v0.18.
 *
 * Environment Variables:
 * - ENABLE_COMPETITIVE_PLANNING (default: true)
 * - ENABLE_COMPLEXITY_DETECTION (default: true)
 * - ENABLE_CONFIDENCE_MONITORING (default: true)
 * - ENABLE_SECURITY_VALIDATION (default: true)
 *
 * @module feature-flags
 */

const EventEmitter = require('events');

class FeatureFlags extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      defaults: {
        competitivePlanning: true,
        complexityDetection: true,
        confidenceMonitoring: true,
        securityValidation: true
      },
      ...options
    };

    this.flags = this._loadFlags();
    this._logInitialization();
  }

  /**
   * Load feature flags from environment variables
   * @private
   * @returns {Object} Feature flags
   */
  _loadFlags() {
    return {
      competitivePlanning: this._getFlag('ENABLE_COMPETITIVE_PLANNING', this.options.defaults.competitivePlanning),
      complexityDetection: this._getFlag('ENABLE_COMPLEXITY_DETECTION', this.options.defaults.complexityDetection),
      confidenceMonitoring: this._getFlag('ENABLE_CONFIDENCE_MONITORING', this.options.defaults.confidenceMonitoring),
      securityValidation: this._getFlag('ENABLE_SECURITY_VALIDATION', this.options.defaults.securityValidation)
    };
  }

  /**
   * Get a single flag value from environment
   * @private
   * @param {string} envVar - Environment variable name
   * @param {boolean} defaultValue - Default value if not set
   * @returns {boolean} Flag value
   */
  _getFlag(envVar, defaultValue) {
    const value = process.env[envVar];

    if (value === undefined || value === '') {
      return defaultValue;
    }

    // Handle various truthy/falsy string values
    const normalized = value.toLowerCase().trim();

    if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) {
      return true;
    }

    if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) {
      return false;
    }

    // Invalid value - return default and warn
    console.warn(`[FeatureFlags] Invalid value for ${envVar}: "${value}". Using default: ${defaultValue}`);
    return defaultValue;
  }

  /**
   * Log initialization status
   * @private
   */
  _logInitialization() {
    const enabled = Object.entries(this.flags)
      .filter(([, v]) => v)
      .map(([k]) => k);

    const disabled = Object.entries(this.flags)
      .filter(([, v]) => !v)
      .map(([k]) => k);

    if (disabled.length > 0) {
      console.log(`[FeatureFlags] Enabled: ${enabled.join(', ') || 'none'}`);
      console.log(`[FeatureFlags] Disabled: ${disabled.join(', ')}`);
    }
  }

  /**
   * Check if a feature is enabled
   * @param {string} feature - Feature name (camelCase)
   * @returns {boolean} Whether the feature is enabled
   */
  isEnabled(feature) {
    if (!(feature in this.flags)) {
      console.warn(`[FeatureFlags] Unknown feature: ${feature}`);
      return false;
    }
    return this.flags[feature];
  }

  /**
   * Get all feature flags
   * @returns {Object} All feature flags
   */
  getAll() {
    return { ...this.flags };
  }

  /**
   * Get enabled features
   * @returns {string[]} List of enabled feature names
   */
  getEnabled() {
    return Object.entries(this.flags)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name);
  }

  /**
   * Get disabled features
   * @returns {string[]} List of disabled feature names
   */
  getDisabled() {
    return Object.entries(this.flags)
      .filter(([, enabled]) => !enabled)
      .map(([name]) => name);
  }

  /**
   * Override a feature flag at runtime (for testing)
   * @param {string} feature - Feature name
   * @param {boolean} enabled - Whether to enable
   */
  setFlag(feature, enabled) {
    if (!(feature in this.flags)) {
      throw new Error(`Unknown feature: ${feature}`);
    }

    const previous = this.flags[feature];
    this.flags[feature] = enabled;

    if (previous !== enabled) {
      this.emit('flag:changed', { feature, previous, current: enabled });
    }
  }

  /**
   * Reset all flags to environment values
   */
  reload() {
    const previous = { ...this.flags };
    this.flags = this._loadFlags();

    const changes = Object.entries(this.flags)
      .filter(([key, value]) => previous[key] !== value)
      .map(([key, value]) => ({ feature: key, previous: previous[key], current: value }));

    if (changes.length > 0) {
      this.emit('flags:reloaded', { changes });
    }
  }

  /**
   * Get summary for dashboard/logging
   * @returns {Object} Summary object
   */
  getSummary() {
    return {
      total: Object.keys(this.flags).length,
      enabled: this.getEnabled().length,
      disabled: this.getDisabled().length,
      flags: this.getAll()
    };
  }
}

// Export singleton instance for easy use
const instance = new FeatureFlags();

// Also export class for testing
module.exports = instance;
module.exports.FeatureFlags = FeatureFlags;
