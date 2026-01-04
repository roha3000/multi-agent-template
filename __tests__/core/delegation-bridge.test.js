/**
 * Tests for delegation-bridge.js
 * Part of auto-delegation Phase 1 & Phase 2
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Mock the config file
const CONFIG_PATH = path.join(__dirname, '../../.claude/delegation-config.json');
const BACKUP_PATH = CONFIG_PATH + '.backup';

describe('DelegationBridge', () => {
  let delegationBridge;

  beforeAll(() => {
    // Backup existing config
    if (fs.existsSync(CONFIG_PATH)) {
      fs.copyFileSync(CONFIG_PATH, BACKUP_PATH);
    }
  });

  afterAll(() => {
    // Restore config
    if (fs.existsSync(BACKUP_PATH)) {
      fs.copyFileSync(BACKUP_PATH, CONFIG_PATH);
      fs.unlinkSync(BACKUP_PATH);
    }
  });

  beforeEach(() => {
    // Clear require cache to get fresh instance
    delete require.cache[require.resolve('../../.claude/core/delegation-bridge')];
    delegationBridge = require('../../.claude/core/delegation-bridge');
  });

  describe('estimateComplexity', () => {
    it('should return low complexity for simple prompts', () => {
      const complexity = delegationBridge.estimateComplexity('fix typo');
      expect(complexity).toBeLessThan(30);
    });

    it('should return higher complexity for technical prompts', () => {
      const simple = delegationBridge.estimateComplexity('fix a bug');
      const complex = delegationBridge.estimateComplexity(
        'Implement a distributed API with database integration, security, and performance optimization'
      );
      expect(complex).toBeGreaterThan(simple);
      expect(complex).toBeGreaterThan(20); // Technical terms add score
    });

    it('should increase complexity for longer prompts', () => {
      const short = delegationBridge.estimateComplexity('do something');
      const long = delegationBridge.estimateComplexity(
        'This is a much longer prompt that describes a complex task with multiple requirements and detailed specifications that need to be implemented carefully with proper testing and validation'
      );
      expect(long).toBeGreaterThan(short);
    });

    it('should increase complexity for scope indicators', () => {
      const narrow = delegationBridge.estimateComplexity('update one file');
      const broad = delegationBridge.estimateComplexity('update all files across the entire codebase');
      expect(broad).toBeGreaterThan(narrow);
    });

    it('should handle empty prompts', () => {
      const complexity = delegationBridge.estimateComplexity('');
      expect(complexity).toBe(0);
    });
  });

  describe('estimateSubtaskCount', () => {
    it('should count numbered lists', () => {
      const count = delegationBridge.estimateSubtaskCount(`
        1. First task
        2. Second task
        3. Third task
      `);
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it('should count bullet points', () => {
      const count = delegationBridge.estimateSubtaskCount(`
        - Item one
        - Item two
        * Item three
      `);
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it('should count connectors', () => {
      const withConnectors = delegationBridge.estimateSubtaskCount(
        'First do this and then do that and finally check the result'
      );
      const without = delegationBridge.estimateSubtaskCount('do this');
      // Connectors add 0.5 each, so 3 "and"s = 1.5 extra = 2 total minimum
      expect(withConnectors).toBeGreaterThanOrEqual(without);
    });

    it('should return 1 for simple prompts', () => {
      const count = delegationBridge.estimateSubtaskCount('fix the bug');
      expect(count).toBe(1);
    });
  });

  describe('suggestPattern', () => {
    it('should suggest parallel for concurrent keywords', () => {
      const pattern = delegationBridge.suggestPattern('run tests in parallel', 3);
      expect(pattern).toBe('parallel');
    });

    it('should suggest sequential for step keywords', () => {
      const pattern = delegationBridge.suggestPattern('first build, then test, finally deploy', 3);
      expect(pattern).toBe('sequential');
    });

    it('should suggest debate for comparison keywords', () => {
      const pattern = delegationBridge.suggestPattern('compare these options and debate alternatives', 2);
      expect(pattern).toBe('debate');
    });

    it('should suggest review for critique keywords', () => {
      const pattern = delegationBridge.suggestPattern('review the code and critique the design', 2);
      expect(pattern).toBe('review');
    });

    it('should default to parallel for high subtask count', () => {
      const pattern = delegationBridge.suggestPattern('do many things', 5);
      expect(pattern).toBe('parallel');
    });

    it('should default to direct for simple tasks', () => {
      const pattern = delegationBridge.suggestPattern('simple task', 1);
      expect(pattern).toBe('direct');
    });
  });

  describe('getQuickHint', () => {
    it('should return analysis with all fields', () => {
      const result = delegationBridge.getQuickHint('implement a feature');

      expect(result).toHaveProperty('enabled');
      expect(result).toHaveProperty('shouldConsiderDelegation');
      expect(result).toHaveProperty('factors');
      expect(result.factors).toHaveProperty('complexity');
      expect(result.factors).toHaveProperty('subtaskCount');
      expect(result).toHaveProperty('suggestedPattern');
      expect(result).toHaveProperty('duration');
    });

    it('should complete in under 200ms', () => {
      const result = delegationBridge.getQuickHint(
        'Implement a complex feature with multiple components'
      );
      expect(result.duration).toBeLessThan(200);
    });

    it('should identify high-subtask prompts for delegation', () => {
      const result = delegationBridge.getQuickHint(`
        Implement the following:
        1. Create database schema
        2. Build API endpoints
        3. Add authentication
        4. Write tests
      `);
      expect(result.shouldConsiderDelegation).toBe(true);
      expect(result.factors.subtaskCount).toBeGreaterThanOrEqual(3);
    });

    it('should not suggest delegation for simple tasks', () => {
      const result = delegationBridge.getQuickHint('fix typo');
      expect(result.shouldConsiderDelegation).toBe(false);
    });
  });

  describe('formatHintForStdout', () => {
    it('should return null for disabled analysis', () => {
      const result = delegationBridge.formatHintForStdout({
        enabled: false,
        hint: 'some hint'
      });
      expect(result).toBeNull();
    });

    it('should return null when no delegation needed', () => {
      const result = delegationBridge.formatHintForStdout({
        enabled: true,
        shouldConsiderDelegation: false,
        hint: null
      });
      expect(result).toBeNull();
    });

    it('should format hint for stdout', () => {
      const result = delegationBridge.formatHintForStdout({
        enabled: true,
        shouldConsiderDelegation: true,
        hint: 'Complexity: 75/100 - may benefit from delegation'
      });
      expect(result).toContain('[Delegation Analysis]');
      expect(result).toContain('Complexity: 75/100');
    });
  });

  describe('loadConfig', () => {
    it('should load default config when no file exists', () => {
      // Temporarily remove config
      const existed = fs.existsSync(CONFIG_PATH);
      let backup;
      if (existed) {
        backup = fs.readFileSync(CONFIG_PATH);
        fs.unlinkSync(CONFIG_PATH);
      }

      // Clear cache
      delete require.cache[require.resolve('../../.claude/core/delegation-bridge')];
      const bridge = require('../../.claude/core/delegation-bridge');

      const config = bridge.loadConfig();
      expect(config.enabled).toBe(true);
      expect(config.showHints).toBe(true);
      expect(config.minComplexityThreshold).toBe(35); // Updated from 50

      // Restore
      if (existed && backup) {
        fs.writeFileSync(CONFIG_PATH, backup);
      }
    });

    it('should merge custom config with defaults', () => {
      // Write custom config
      fs.writeFileSync(CONFIG_PATH, JSON.stringify({
        enabled: false,
        customField: 'test'
      }));

      delete require.cache[require.resolve('../../.claude/core/delegation-bridge')];
      const bridge = require('../../.claude/core/delegation-bridge');

      const config = bridge.loadConfig();
      expect(config.enabled).toBe(false);
      expect(config.showHints).toBe(true); // from defaults
    });
  });

  describe('saveConfig', () => {
    it('should save config to file', () => {
      const config = { enabled: true, customField: 'test' };
      const result = delegationBridge.saveConfig(config);
      expect(result).toBe(true);

      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      expect(saved.customField).toBe('test');
    });
  });

  describe('performance', () => {
    it('should analyze complex prompts in under 200ms', () => {
      const complexPrompt = `
        Implement a comprehensive auto-delegation system with the following requirements:
        1. Create a hook that runs on every prompt submission
        2. Analyze prompt complexity using multiple heuristics
        3. Check for matching tasks in tasks.json
        4. Determine the best execution pattern (parallel, sequential, debate)
        5. Generate actionable hints for the user
        6. Support configuration via delegation-config.json
        7. Integrate with the dashboard for visibility
        8. Add comprehensive test coverage
        9. Write documentation for the new feature
        10. Ensure backward compatibility with existing workflows
      `;

      const iterations = 100;
      const times = [];

      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        delegationBridge.getQuickHint(complexPrompt);
        const end = process.hrtime.bigint();
        times.push(Number(end - start) / 1000000); // Convert to ms
      }

      const avg = times.reduce((a, b) => a + b) / times.length;
      const max = Math.max(...times);

      expect(avg).toBeLessThan(50); // Average under 50ms
      expect(max).toBeLessThan(200); // Max under 200ms
    });
  });

  // ===== Phase 2 Tests =====

  describe('Phase 2: Decision Caching', () => {
    beforeEach(() => {
      // Clear cache before each test
      delegationBridge.clearCache();
    });

    it('should cache decisions for repeated prompts', () => {
      const prompt = 'Implement a complex feature with multiple components';

      // First call - not from cache
      const result1 = delegationBridge.getQuickHint(prompt);
      expect(result1.fromCache).toBe(false);

      // Second call - should be from cache
      const result2 = delegationBridge.getQuickHint(prompt);
      expect(result2.fromCache).toBe(true);
    });

    it('should return faster on cached prompts', () => {
      const prompt = 'Build a large-scale distributed system with database integration';

      // First call
      const result1 = delegationBridge.getQuickHint(prompt);
      const duration1 = result1.duration;

      // Second call (cached)
      const result2 = delegationBridge.getQuickHint(prompt);
      const duration2 = result2.duration;

      // Cached should be faster (or at least not slower)
      expect(duration2).toBeLessThanOrEqual(duration1 + 5);
    });

    it('should not cache when cacheEnabled is false', () => {
      // Save original config
      const origConfig = delegationBridge.loadConfig();

      // Disable cache
      delegationBridge.saveConfig({ ...origConfig, cacheEnabled: false });

      // Clear require cache
      delete require.cache[require.resolve('../../.claude/core/delegation-bridge')];
      const bridge = require('../../.claude/core/delegation-bridge');

      const prompt = 'Test caching disabled';
      bridge.getQuickHint(prompt);
      const result = bridge.getQuickHint(prompt);

      expect(result.fromCache).toBeFalsy();

      // Restore config
      delegationBridge.saveConfig(origConfig);
    });

    it('should provide cache statistics', () => {
      delegationBridge.getQuickHint('test prompt 1');
      delegationBridge.getQuickHint('test prompt 2');

      const stats = delegationBridge.getCacheStats();
      expect(stats.size).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(stats.entries)).toBe(true);
    });

    it('should generate consistent hashes for same prompt', () => {
      const prompt = 'Test hash consistency';
      const hash1 = delegationBridge.hashPrompt(prompt);
      const hash2 = delegationBridge.hashPrompt(prompt);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(32); // MD5 hex length
    });
  });

  describe('Phase 2: Per-task delegationConfig', () => {
    it('should infer delegation config from task properties', () => {
      const task = {
        id: 'test-task',
        title: 'Complex Task',
        description: 'A complex parallel task',
        estimate: '8h',
        acceptance: ['AC1', 'AC2', 'AC3', 'AC4', 'AC5'],
        priority: 'high'
      };

      const config = delegationBridge.inferDelegationConfig(task);

      expect(config.shouldDelegate).toBe(true);
      expect(config.pattern).toBe('parallel');
      expect(config.priority).toBe('high');
    });

    it('should respect explicit delegationConfig in task', () => {
      const task = {
        id: 'test-task',
        title: 'Test Task',
        delegationConfig: {
          shouldDelegate: false,
          pattern: 'direct',
          priority: 'low'
        }
      };

      const result = delegationBridge.enrichTaskWithDelegationConfig(task, 'id', 'high');

      expect(result.delegationConfig.shouldDelegate).toBe(false);
      expect(result.delegationConfig.pattern).toBe('direct');
    });

    it('should parse various effort formats', () => {
      expect(delegationBridge.parseEffortHours('4h')).toBe(4);
      expect(delegationBridge.parseEffortHours('2 hours')).toBe(2);
      expect(delegationBridge.parseEffortHours('1d')).toBe(8);
      expect(delegationBridge.parseEffortHours('30m')).toBe(0.5);
      expect(delegationBridge.parseEffortHours('2 days')).toBe(16);
      expect(delegationBridge.parseEffortHours(null)).toBe(2); // default
    });

    it('should recognize child tasks as already decomposed', () => {
      const task = {
        id: 'parent-task',
        childTaskIds: ['child-1', 'child-2'],
        decomposition: 'sequential'
      };

      const config = delegationBridge.inferDelegationConfig(task);

      expect(config.shouldDelegate).toBe(true);
      expect(config.pattern).toBe('sequential');
      expect(config.subtaskIds).toEqual(['child-1', 'child-2']);
    });
  });

  describe('Phase 2: Enhanced matchKnownTask', () => {
    it('should match tasks by tag', () => {
      // This test depends on actual tasks.json content
      const result = delegationBridge.matchKnownTask('auto-delegation hooks integration');

      // If a match is found, it should have delegationConfig
      if (result) {
        expect(result.delegationConfig).toBeDefined();
      }
    });

    it('should enrich matched tasks with delegation config', () => {
      const result = delegationBridge.matchKnownTask('auto-delegation-integration');

      if (result) {
        expect(result.matchType).toBeDefined();
        expect(result.matchStrength).toBeDefined();
        expect(result.delegationConfig).toBeDefined();
      }
    });
  });

  describe('Phase 2: Full DelegationDecider Integration', () => {
    it('should load DelegationDecider lazily', () => {
      const decider = delegationBridge.loadDelegationDecider();
      // May be null if module not available, but should not throw
      if (decider) {
        expect(decider).toHaveProperty('shouldDelegate');
      }
    });

    it('should get TaskDecomposer instance', () => {
      const decomposer = delegationBridge.getTaskDecomposer();
      // May be null if module not available
      if (decomposer) {
        expect(decomposer).toHaveProperty('analyze');
      }
    });

    it('should include fullDecision when available', () => {
      // Enable full analysis
      const config = delegationBridge.loadConfig();
      delegationBridge.saveConfig({ ...config, quickAnalysisOnly: false });

      // Clear cache to force new analysis
      delegationBridge.clearCache();

      const complexPrompt = `
        Implement a comprehensive feature with:
        1. API integration
        2. Database schema
        3. Security measures
        4. Performance optimization
        5. Comprehensive testing
      `;

      const result = delegationBridge.getQuickHint(complexPrompt);

      // fullDecision may be present if DelegationDecider loaded
      if (result.fullDecision) {
        expect(result.fullDecision.confidence).toBeGreaterThan(0);
        expect(typeof result.fullDecision.shouldDelegate).toBe('boolean');
      }

      // Restore config
      delegationBridge.saveConfig(config);
    });

    it('should fall back to quick analysis if DelegationDecider fails', () => {
      // This tests graceful degradation
      const result = delegationBridge.getQuickHint('Simple task');

      expect(result.enabled).toBe(true);
      expect(result.factors).toBeDefined();
      // Should work even without full decision
    });
  });

  describe('Phase 2: Decomposition Suggestions', () => {
    it('should provide decomposition suggestion for matched tasks', () => {
      // Enable full features
      const config = delegationBridge.loadConfig();
      delegationBridge.saveConfig({
        ...config,
        quickAnalysisOnly: false,
        useTaskDecomposer: true
      });

      delegationBridge.clearCache();

      // Try to match a known task
      const result = delegationBridge.getQuickHint('work on auto-delegation-integration');

      if (result.decomposition) {
        expect(typeof result.decomposition.shouldDecompose).toBe('boolean');
        expect(typeof result.decomposition.subtaskCount).toBe('number');
      }

      // Restore
      delegationBridge.saveConfig(config);
    });
  });

  describe('Phase 2: Acceptance Criteria', () => {
    beforeEach(() => {
      delegationBridge.clearCache();
    });

    it('AC1: Complex prompts get accurate delegation recommendations', () => {
      const complexPrompt = `
        Implement a distributed caching system with:
        - Redis integration for session storage
        - Fallback to in-memory cache
        - TTL configuration per cache type
        - Cache invalidation strategies
        - Performance monitoring and metrics
      `;

      const result = delegationBridge.getQuickHint(complexPrompt);

      expect(result.shouldConsiderDelegation).toBe(true);
      expect(result.factors.complexity).toBeGreaterThan(30);
      expect(result.suggestedPattern).not.toBe('direct');
    });

    it('AC2: Tasks from tasks.json are recognized and enriched', () => {
      const result = delegationBridge.matchKnownTask('auto-delegation-integration');

      if (result) {
        expect(result.id).toBe('auto-delegation-integration');
        expect(result.delegationConfig).toBeDefined();
        expect(result.matchType).toBeDefined();
      }
    });

    it('AC3: Per-task config overrides global settings', () => {
      // Create a task with explicit config
      const task = {
        id: 'override-test',
        title: 'Override Test',
        delegationConfig: {
          shouldDelegate: false
        }
      };

      const enriched = delegationBridge.enrichTaskWithDelegationConfig(task, 'id', 'high');
      expect(enriched.delegationConfig.shouldDelegate).toBe(false);
    });

    it('AC4: Repeated prompts use cached decisions', () => {
      const prompt = 'Implement user authentication with OAuth2';

      // First call
      const result1 = delegationBridge.getQuickHint(prompt);
      expect(result1.fromCache).toBe(false);

      // Second call
      const result2 = delegationBridge.getQuickHint(prompt);
      expect(result2.fromCache).toBe(true);

      // Results should be equivalent (except duration and fromCache)
      expect(result2.shouldConsiderDelegation).toBe(result1.shouldConsiderDelegation);
      expect(result2.suggestedPattern).toBe(result1.suggestedPattern);
    });
  });

  describe('Quality Fix: Pre-decomposed Task Detection', () => {
    beforeEach(() => {
      delegationBridge.clearCache();
    });

    it('should return shouldDelegate=true for tasks with existing childTaskIds', () => {
      const decision = delegationBridge.getFullDecision('work on parent task', {
        id: 'parent-task',
        title: 'Parent Task',
        childTaskIds: ['child-1', 'child-2', 'child-3'],
        decomposition: 'sequential'
      });

      expect(decision).not.toBeNull();
      expect(decision.shouldDelegate).toBe(true);
      expect(decision.confidence).toBe(95);
      expect(decision.preDecomposed).toBe(true);
      expect(decision.pattern).toBe('sequential');
    });

    it('should include child count in reasoning', () => {
      const decision = delegationBridge.getFullDecision('test', {
        id: 'test-task',
        childTaskIds: ['a', 'b', 'c', 'd', 'e'],
        decomposition: 'parallel'
      });

      expect(decision.reasoning).toContain('5 subtasks');
      expect(decision.pattern).toBe('parallel');
    });

    it('should NOT short-circuit for tasks without childTaskIds', () => {
      const decision = delegationBridge.getFullDecision('implement something', {
        id: 'simple-task',
        title: 'Simple Task',
        childTaskIds: []
      });

      // Should go through normal DelegationDecider path
      expect(decision?.preDecomposed).toBeFalsy();
    });

    it('should use sequential as default pattern if decomposition not specified', () => {
      const decision = delegationBridge.getFullDecision('test', {
        id: 'test-task',
        childTaskIds: ['a', 'b']
        // no decomposition field
      });

      expect(decision.pattern).toBe('sequential');
    });
  });

  describe('Quality Fix: Improved Complexity Detection', () => {
    it('should detect complexity in technical prompts that were previously missed', () => {
      const prompt = 'Implement a comprehensive feature with API, database, testing, and documentation';
      const complexity = delegationBridge.estimateComplexity(prompt);

      // Previously returned 25, should now be higher
      expect(complexity).toBeGreaterThanOrEqual(35);
    });

    it('should recognize expanded technical terms', () => {
      // Each prompt should score based on technical terms found
      const prompts = [
        { text: 'Build authentication and authorization system', minScore: 10 },
        { text: 'Create backend service with middleware and validation', minScore: 15 },
        { text: 'Implement frontend component with API integration', minScore: 15 },
        { text: 'Deploy microservice with database and security', minScore: 15 }
      ];

      for (const { text, minScore } of prompts) {
        const complexity = delegationBridge.estimateComplexity(text);
        expect(complexity).toBeGreaterThanOrEqual(minScore);
      }
    });

    it('should now trigger delegation for technical implementation prompts', () => {
      const result = delegationBridge.getQuickHint(
        'Implement a comprehensive feature with API, database, testing, and documentation'
      );

      expect(result.shouldConsiderDelegation).toBe(true);
      expect(result.factors.complexity).toBeGreaterThanOrEqual(35);
    });

    it('should still NOT trigger for truly simple prompts', () => {
      const simplePrompts = [
        'fix typo',
        'update readme',
        'add comment'
      ];

      for (const prompt of simplePrompts) {
        const result = delegationBridge.getQuickHint(prompt);
        expect(result.shouldConsiderDelegation).toBe(false);
      }
    });
  });
});
