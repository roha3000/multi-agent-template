/**
 * SwarmController - Unified Interface for All Swarm Components
 *
 * Part of the Orchestrator Unification effort.
 * Provides a single access point for:
 * - SecurityValidator: Operation safety validation
 * - ConfidenceMonitor: Progress and confidence tracking
 * - ComplexityAnalyzer: Task complexity analysis
 * - CompetitivePlanner: Multi-strategy plan generation
 * - PlanEvaluator: Plan quality evaluation
 *
 * All components are conditionally loaded based on feature flags.
 */

const path = require('path');
const fs = require('fs');

// Lazy-load components to handle missing files gracefully
let SecurityValidator = null;
let ConfidenceMonitor = null;
let ComplexityAnalyzer = null;
let CompetitivePlanner = null;
let PlanEvaluator = null;
let FeatureFlags = null;

/**
 * Safely require a module, returning null if it doesn't exist
 */
function safeRequire(modulePath) {
    try {
        return require(modulePath);
    } catch (error) {
        if (error.code === 'MODULE_NOT_FOUND') {
            return null;
        }
        throw error;
    }
}

/**
 * Load all component modules
 */
function loadModules() {
    const basePath = __dirname;

    FeatureFlags = safeRequire(path.join(basePath, 'feature-flags.js'));
    SecurityValidator = safeRequire(path.join(basePath, 'security-validator.js'));
    ConfidenceMonitor = safeRequire(path.join(basePath, 'confidence-monitor.js'));
    ComplexityAnalyzer = safeRequire(path.join(basePath, 'complexity-analyzer.js'));
    CompetitivePlanner = safeRequire(path.join(basePath, 'competitive-planner.js'));
    PlanEvaluator = safeRequire(path.join(basePath, 'plan-evaluator.js'));
}

// Load modules on first import
loadModules();

/**
 * SwarmController class - unified interface for swarm components
 */
class SwarmController {
    constructor(options = {}) {
        this.options = options;
        this.verbose = options.verbose || false;

        // Initialize feature flags
        this.featureFlags = this._initializeFeatureFlags(options.featureOverrides);

        // Component instances
        this.components = {
            securityValidator: null,
            confidenceMonitor: null,
            complexityAnalyzer: null,
            competitivePlanner: null,
            planEvaluator: null
        };

        // Component status tracking
        this.componentStatus = {
            securityValidator: { enabled: false, initialized: false, error: null },
            confidenceMonitor: { enabled: false, initialized: false, error: null },
            complexityAnalyzer: { enabled: false, initialized: false, error: null },
            competitivePlanner: { enabled: false, initialized: false, error: null },
            planEvaluator: { enabled: false, initialized: false, error: null }
        };

        // Initialize components
        this._initializeComponents();
    }

    _initializeFeatureFlags(overrides = {}) {
        if (!FeatureFlags) {
            return {
                isEnabled: (flag) => overrides[flag] !== false,
                getConfig: (key) => overrides[key] || null
            };
        }

        if (Object.keys(overrides).length > 0) {
            const originalIsEnabled = FeatureFlags.isEnabled.bind(FeatureFlags);
            return {
                isEnabled: (flag) => {
                    if (flag in overrides) return overrides[flag];
                    return originalIsEnabled(flag);
                },
                getConfig: FeatureFlags.getConfig ? FeatureFlags.getConfig.bind(FeatureFlags) : () => null
            };
        }

        return FeatureFlags;
    }

    _initializeComponents() {
        // SecurityValidator
        this._initSecurityValidator();

        // ConfidenceMonitor
        if (this.featureFlags.isEnabled('confidenceTracking')) {
            this._initConfidenceMonitor();
        }

        // ComplexityAnalyzer
        if (this.featureFlags.isEnabled('complexityAnalysis')) {
            this._initComplexityAnalyzer();
        }

        // CompetitivePlanner & PlanEvaluator
        if (this.featureFlags.isEnabled('competitivePlanning')) {
            this._initCompetitivePlanner();
            this._initPlanEvaluator();
        }
    }

    _initSecurityValidator() {
        try {
            if (SecurityValidator) {
                this.components.securityValidator = new SecurityValidator(this.options.securityConfig || {});
                this.componentStatus.securityValidator = { enabled: true, initialized: true, error: null };
            }
        } catch (error) {
            this.componentStatus.securityValidator.error = error.message;
        }
    }

    _initConfidenceMonitor() {
        try {
            if (ConfidenceMonitor) {
                this.components.confidenceMonitor = new ConfidenceMonitor(this.options.confidenceConfig || {});
                this.componentStatus.confidenceMonitor = { enabled: true, initialized: true, error: null };
            }
        } catch (error) {
            this.componentStatus.confidenceMonitor.error = error.message;
        }
    }

    _initComplexityAnalyzer() {
        try {
            if (ComplexityAnalyzer) {
                this.components.complexityAnalyzer = new ComplexityAnalyzer(this.options.complexityConfig || {});
                this.componentStatus.complexityAnalyzer = { enabled: true, initialized: true, error: null };
            }
        } catch (error) {
            this.componentStatus.complexityAnalyzer.error = error.message;
        }
    }

    _initCompetitivePlanner() {
        try {
            if (CompetitivePlanner) {
                this.components.competitivePlanner = new CompetitivePlanner(this.options.plannerConfig || {});
                this.componentStatus.competitivePlanner = { enabled: true, initialized: true, error: null };
            }
        } catch (error) {
            this.componentStatus.competitivePlanner.error = error.message;
        }
    }

    _initPlanEvaluator() {
        try {
            if (PlanEvaluator) {
                this.components.planEvaluator = new PlanEvaluator(this.options.evaluatorConfig || {});
                this.componentStatus.planEvaluator = { enabled: true, initialized: true, error: null };
            }
        } catch (error) {
            this.componentStatus.planEvaluator.error = error.message;
        }
    }

    /**
     * Check safety of an operation
     */
    checkSafety(operation = {}) {
        const result = { safe: true, action: 'PROCEED', warnings: [], errors: [] };

        // Security validation
        if (this.components.securityValidator) {
            try {
                const secResult = this.components.securityValidator.validate(operation);
                // SecurityValidator returns { valid, sanitized, threats } not { allowed }
                if (!secResult.valid) {
                    result.safe = false;
                    const threatMessages = (secResult.threats || []).map(t => t.message).join(', ');
                    result.errors.push(threatMessages || 'Security check failed');
                }
            } catch (error) {
                result.warnings.push(`Security check error: ${error.message}`);
            }
        }

        // Confidence check
        if (this.components.confidenceMonitor) {
            try {
                const confidence = this.components.confidenceMonitor.getCurrentConfidence?.() || 1;
                result.confidence = confidence < 0.3 ? 'critical' : confidence < 0.5 ? 'low' : 'ok';
                if (confidence < 0.2) {
                    result.safe = false;
                    result.action = 'HALT_IMMEDIATELY';
                }
            } catch (error) {
                result.warnings.push(`Confidence check error: ${error.message}`);
            }
        }

        return result;
    }

    /**
     * Analyze complexity of a task
     */
    analyzeComplexity(task) {
        if (!this.components.complexityAnalyzer) {
            return { score: 50, level: 'medium' };
        }

        try {
            const analysis = this.components.complexityAnalyzer.analyze?.(task);
            return analysis || { score: 50, level: 'medium' };
        } catch (error) {
            return { score: 50, level: 'medium', error: error.message };
        }
    }

    /**
     * Generate competing plans for a task
     */
    generateCompetingPlans(task, count = 3) {
        if (!this.components.competitivePlanner) {
            return [];
        }

        try {
            return this.components.competitivePlanner.generatePlans?.(task, count) || [];
        } catch (error) {
            return [];
        }
    }

    /**
     * Track progress and update confidence
     */
    trackProgress(progress) {
        const result = { recorded: false, confidence: { level: 'ok' }, trend: 'stable' };

        if (this.components.confidenceMonitor) {
            try {
                this.components.confidenceMonitor.recordProgress?.(progress);
                result.recorded = true;
                const conf = this.components.confidenceMonitor.getCurrentConfidence?.() || 1;
                result.confidence.level = conf < 0.3 ? 'critical' : conf < 0.5 ? 'low' : 'ok';
            } catch (error) {
                result.error = error.message;
            }
        }

        return result;
    }

    /**
     * Get status of all components
     */
    getStatus() {
        const enabledComponents = Object.entries(this.componentStatus)
            .filter(([_, status]) => status.enabled)
            .map(([name]) => name);

        return {
            healthy: enabledComponents.length > 0,
            components: this.componentStatus,
            enabledCount: enabledComponents.length,
            enabledComponents,
            featureFlags: {
                confidenceTracking: this.featureFlags.isEnabled('confidenceTracking'),
                complexityAnalysis: this.featureFlags.isEnabled('complexityAnalysis'),
                competitivePlanning: this.featureFlags.isEnabled('competitivePlanning')
            }
        };
    }

    hasComponent(name) {
        return this.componentStatus[name]?.initialized === true;
    }
}

module.exports = SwarmController;
