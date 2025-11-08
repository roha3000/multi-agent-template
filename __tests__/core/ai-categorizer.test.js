/**
 * AICategorizationService Unit Tests
 *
 * Comprehensive test suite for AICategorizationService component including:
 * - Constructor and initialization (with/without API key)
 * - categorizeOrchestration (AI success, AI failure, rule-based fallback)
 * - categorizeOrchestrationsBatch (full success, partial success, complete failure)
 * - AI client integration (API calls, timeouts, parsing)
 * - Rule-based categorization (all 6 types)
 * - Keyword detection and priority
 * - Error handling and graceful degradation
 * - Metrics tracking
 * - Health checks
 * - Integration tests
 * - Performance tests
 * - Edge cases
 *
 * Target: 85%+ code coverage
 */

const AICategorizationService = require('../../.claude/core/ai-categorizer');

// Mock Anthropic SDK
const mockAnthropicMessages = {
  create: jest.fn()
};

const mockAnthropicClient = {
  messages: mockAnthropicMessages
};

// Mock the Anthropic SDK module
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn(() => mockAnthropicClient);
});

// Mock logger to reduce noise in tests
jest.mock('../../.claude/core/logger', () => ({
  createComponentLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }))
}));

describe('AICategorizationService', () => {
  let categorizer;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Reset mock implementations
    mockAnthropicMessages.create.mockResolvedValue({
      content: [{
        text: JSON.stringify({
          type: 'feature',
          observation: 'Test observation',
          concepts: ['test', 'feature'],
          importance: 7,
          agentInsights: { 'agent-1': 'Test insight' },
          recommendations: 'Test recommendations'
        })
      }]
    });
  });

  describe('Constructor and Initialization', () => {
    test('should create categorizer with API key from deps object', () => {
      categorizer = new AICategorizationService(
        { apiKey: 'test-api-key' }
      );

      expect(categorizer.options.apiKey).toBe('test-api-key');
      expect(categorizer.isAvailable).toBe(true);
      expect(categorizer.anthropic).toBeDefined();
    });

    test('should create categorizer with API key as string', () => {
      categorizer = new AICategorizationService('test-api-key');

      expect(categorizer.options.apiKey).toBe('test-api-key');
      expect(categorizer.isAvailable).toBe(true);
    });

    test('should create categorizer with pre-configured client', () => {
      categorizer = new AICategorizationService({
        anthropicClient: mockAnthropicClient
      });

      expect(categorizer.anthropic).toBe(mockAnthropicClient);
      expect(categorizer.isAvailable).toBe(false); // No API key, but has client
    });

    test('should create categorizer without API key (rules-only mode)', () => {
      delete process.env.ANTHROPIC_API_KEY;

      categorizer = new AICategorizationService({});

      expect(categorizer.options.apiKey).toBeUndefined();
      expect(categorizer.isAvailable).toBe(false);
      expect(categorizer.anthropic).toBeNull();
    });

    test('should use environment variable for API key', () => {
      process.env.ANTHROPIC_API_KEY = 'env-api-key';

      categorizer = new AICategorizationService({});

      expect(categorizer.options.apiKey).toBe('env-api-key');
      expect(categorizer.isAvailable).toBe(true);

      delete process.env.ANTHROPIC_API_KEY;
    });

    test('should create categorizer with default options', () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });

      expect(categorizer.options.model).toBe('claude-3-5-sonnet-20241022');
      expect(categorizer.options.maxTokens).toBe(500);
      expect(categorizer.options.temperature).toBe(0.3);
      expect(categorizer.options.timeout).toBe(10000);
      expect(categorizer.options.fallbackToRules).toBe(true);
      expect(categorizer.options.retries).toBe(2);
      expect(categorizer.options.concurrency).toBe(3);
    });

    test('should create categorizer with custom options', () => {
      categorizer = new AICategorizationService(
        { apiKey: 'test-key' },
        {
          model: 'claude-3-opus-20240229',
          maxTokens: 1000,
          temperature: 0.5,
          timeout: 20000,
          fallbackToRules: false,
          retries: 5,
          concurrency: 5
        }
      );

      expect(categorizer.options.model).toBe('claude-3-opus-20240229');
      expect(categorizer.options.maxTokens).toBe(1000);
      expect(categorizer.options.temperature).toBe(0.5);
      expect(categorizer.options.timeout).toBe(20000);
      expect(categorizer.options.fallbackToRules).toBe(false);
      expect(categorizer.options.retries).toBe(5);
      expect(categorizer.options.concurrency).toBe(5);
    });

    test('should initialize metrics with zeros', () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });

      expect(categorizer.metrics.totalRequests).toBe(0);
      expect(categorizer.metrics.successful).toBe(0);
      expect(categorizer.metrics.failed).toBe(0);
      expect(categorizer.metrics.fallbacks).toBe(0);
      expect(categorizer.metrics.totalDuration).toBe(0);
      expect(categorizer.metrics.avgDuration).toBe(0);
      expect(categorizer.metrics.aiCalls).toBe(0);
      expect(categorizer.metrics.ruleBasedCalls).toBe(0);
    });

    test('should handle Anthropic SDK initialization error gracefully', () => {
      // Force require error by mocking with error
      jest.doMock('@anthropic-ai/sdk', () => {
        throw new Error('Module not found');
      });

      // Should not throw
      expect(() => {
        categorizer = new AICategorizationService({ apiKey: 'test-key' });
      }).not.toThrow();
    });
  });

  describe('categorizeOrchestration()', () => {
    test('should successfully categorize with AI', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });

      // Mock pre-configured client
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      mockAnthropicMessages.create.mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            type: 'feature',
            observation: 'Authentication feature implemented',
            concepts: ['authentication', 'jwt', 'security'],
            importance: 8,
            agentInsights: { 'agent-1': 'Led implementation' },
            recommendations: 'Use JWT for future auth tasks'
          })
        }]
      });

      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        agentIds: ['agent-1', 'agent-2'],
        task: 'Implement authentication',
        resultSummary: 'JWT auth implemented',
        success: true,
        duration: 5000
      });

      expect(result.type).toBe('feature');
      expect(result.observation).toBe('Authentication feature implemented');
      expect(result.concepts).toEqual(['authentication', 'jwt', 'security']);
      expect(result.importance).toBe(8);
      expect(result.source).toBe('ai');
      expect(categorizer.metrics.successful).toBe(1);
      expect(categorizer.metrics.aiCalls).toBe(1);
      expect(mockAnthropicMessages.create).toHaveBeenCalledWith({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 500,
        temperature: 0.3,
        messages: [{
          role: 'user',
          content: expect.stringContaining('Implement authentication')
        }]
      });
    });

    test('should fall back to rules when AI unavailable', async () => {
      categorizer = new AICategorizationService({}, { fallbackToRules: true });

      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        agentIds: ['agent-1'],
        task: 'Fix authentication bug',
        resultSummary: 'Bug resolved',
        success: true,
        duration: 3000
      });

      expect(result.type).toBe('bugfix');
      expect(result.source).toBe('rule-based');
      expect(result.observation).toContain('Bug fix');
      expect(categorizer.metrics.fallbacks).toBe(1);
      expect(categorizer.metrics.ruleBasedCalls).toBe(1);
    });

    test('should fall back to rules when AI fails', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      mockAnthropicMessages.create.mockRejectedValueOnce(new Error('API error'));

      const result = await categorizer.categorizeOrchestration({
        pattern: 'sequential',
        agentIds: ['agent-1'],
        task: 'Refactor database layer',
        resultSummary: 'Code improved',
        success: true,
        duration: 4000
      });

      expect(result.type).toBe('refactor');
      expect(result.source).toBe('rule-based');
      expect(categorizer.metrics.failed).toBe(1);
      expect(categorizer.metrics.fallbacks).toBe(1);
    });

    test('should throw error when AI fails and fallback disabled', async () => {
      categorizer = new AICategorizationService(
        { apiKey: 'test-key' },
        { fallbackToRules: false }
      );
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      mockAnthropicMessages.create.mockRejectedValueOnce(new Error('API error'));

      await expect(
        categorizer.categorizeOrchestration({
          pattern: 'parallel',
          task: 'Test',
          success: true
        })
      ).rejects.toThrow('API error');
    });

    test('should handle JSON with markdown code blocks', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      mockAnthropicMessages.create.mockResolvedValueOnce({
        content: [{
          text: '```json\n' + JSON.stringify({
            type: 'decision',
            observation: 'Strategic decision made',
            concepts: ['strategy', 'decision'],
            importance: 9
          }) + '\n```'
        }]
      });

      const result = await categorizer.categorizeOrchestration({
        pattern: 'consensus',
        task: 'Decide on architecture',
        success: true
      });

      expect(result.type).toBe('decision');
      expect(result.source).toBe('ai');
    });

    test('should handle malformed JSON response', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      mockAnthropicMessages.create.mockResolvedValueOnce({
        content: [{
          text: 'This is not JSON'
        }]
      });

      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test task',
        success: true
      });

      // Should fall back to rules
      expect(result.source).toBe('rule-based');
      expect(categorizer.metrics.fallbacks).toBe(1);
    });

    test('should update metrics after categorization', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test',
        success: true
      });

      expect(categorizer.metrics.totalRequests).toBe(1);
      expect(categorizer.metrics.successful).toBe(1);
      expect(categorizer.metrics.totalDuration).toBeGreaterThanOrEqual(0);
      expect(categorizer.metrics.avgDuration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('AI Categorization', () => {
    beforeEach(() => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;
    });

    test('should build correct prompt with all orchestration details', async () => {
      await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        agentIds: ['agent-1', 'agent-2'],
        task: 'Implement feature X',
        resultSummary: 'Feature completed',
        success: true,
        duration: 5000
      });

      const prompt = mockAnthropicMessages.create.mock.calls[0][0].messages[0].content;

      expect(prompt).toContain('parallel');
      expect(prompt).toContain('agent-1, agent-2');
      expect(prompt).toContain('Implement feature X');
      expect(prompt).toContain('Feature completed');
      expect(prompt).toContain('Yes');
      expect(prompt).toContain('5000ms');
    });

    test('should handle missing optional orchestration fields', async () => {
      await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Basic task',
        success: true,
        duration: 1000
      });

      const prompt = mockAnthropicMessages.create.mock.calls[0][0].messages[0].content;

      expect(prompt).toContain('unknown');
      expect(prompt).toContain('No summary');
    });

    test('should throw error when Anthropic client not initialized', async () => {
      categorizer.anthropic = null;

      await expect(
        categorizer._categorizeWithAI({
          pattern: 'parallel',
          task: 'Test',
          success: true
        })
      ).rejects.toThrow('Anthropic client not initialized');
    });

    test('should validate categorization response', async () => {
      mockAnthropicMessages.create.mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            type: 'feature',
            observation: 'Test',
            concepts: ['test'],
            importance: 5,
            agentInsights: {},
            recommendations: ''
          })
        }]
      });

      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test',
        success: true
      });

      expect(result.type).toBe('feature');
      expect(result.observation).toBe('Test');
      expect(result.concepts).toEqual(['test']);
      expect(result.importance).toBe(5);
    });

    test('should normalize invalid type to default', async () => {
      mockAnthropicMessages.create.mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            type: 'invalid-type',
            observation: 'Test',
            concepts: [],
            importance: 5
          })
        }]
      });

      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test',
        success: true
      });

      expect(result.type).toBe('pattern-usage');
    });

    test('should clamp importance to valid range', async () => {
      mockAnthropicMessages.create.mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            type: 'feature',
            observation: 'Test',
            concepts: [],
            importance: 15 // Invalid (too high)
          })
        }]
      });

      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test',
        success: true
      });

      expect(result.importance).toBe(10);
    });

    test('should normalize non-array concepts', async () => {
      mockAnthropicMessages.create.mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            type: 'feature',
            observation: 'Test',
            concepts: 'not-an-array',
            importance: 5
          })
        }]
      });

      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test',
        success: true
      });

      expect(Array.isArray(result.concepts)).toBe(true);
      expect(result.concepts).toEqual([]);
    });

    test('should handle missing required fields', async () => {
      mockAnthropicMessages.create.mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            type: 'feature'
            // Missing observation, concepts, importance
          })
        }]
      });

      // Should fall back to rules when validation fails
      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test',
        success: true
      });

      expect(result.source).toBe('rule-based');
      expect(categorizer.metrics.fallbacks).toBe(1);
    });
  });

  describe('Rule-Based Categorization', () => {
    beforeEach(() => {
      categorizer = new AICategorizationService({}, { fallbackToRules: true });
    });

    test('should detect decision type', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'consensus',
        task: 'Decide on the best architecture approach',
        resultSummary: 'Decision made to use microservices',
        success: true
      });

      expect(result.type).toBe('decision');
      expect(result.concepts).toContain('decision-making');
      expect(result.importance).toBe(6);
    });

    test('should detect discovery type', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Discover performance bottlenecks',
        resultSummary: 'Found that database queries are slow',
        success: true
      });

      expect(result.type).toBe('discovery');
      expect(result.concepts).toContain('learning');
      expect(result.importance).toBe(7);
    });

    test('should detect refactor type', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'sequential',
        task: 'Refactor authentication module',
        resultSummary: 'Code cleaned and optimized',
        success: true
      });

      expect(result.type).toBe('refactor');
      expect(result.concepts).toContain('code-improvement');
      expect(result.importance).toBe(5);
    });

    test('should detect feature type', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Implement new user dashboard',
        resultSummary: 'Dashboard feature created',
        success: true
      });

      expect(result.type).toBe('feature');
      expect(result.concepts).toContain('feature-development');
      expect(result.importance).toBe(6);
    });

    test('should detect bugfix type', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'sequential',
        task: 'Fix login crash on invalid credentials',
        resultSummary: 'Bug resolved',
        success: true
      });

      expect(result.type).toBe('bugfix');
      expect(result.concepts).toContain('debugging');
      expect(result.importance).toBe(7);
    });

    test('should default to pattern-usage type', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Execute standard workflow',
        resultSummary: 'Workflow completed',
        success: true
      });

      expect(result.type).toBe('pattern-usage');
    });

    test('should avoid false positive on "prefix" for bugfix detection', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'sequential',
        task: 'Add prefix to all variable names',
        success: true
      });

      expect(result.type).not.toBe('bugfix');
    });

    test('should reduce importance for failed orchestrations', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Implement feature X',
        success: false
      });

      expect(result.importance).toBeLessThanOrEqual(4); // Base 6 - 2
      expect(result.concepts).toContain('failure-analysis');
    });

    test('should include pattern in concepts', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'consensus',
        task: 'Make decision',
        success: true
      });

      expect(result.concepts).toContain('consensus');
    });

    test('should limit concepts to 5 maximum', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel-sequential-hybrid-pattern-with-long-name',
        task: 'Do something',
        success: true
      });

      expect(result.concepts.length).toBeLessThanOrEqual(5);
    });

    test('should build agent insights', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        agentIds: ['agent-1', 'agent-2'],
        task: 'Implement feature',
        success: true
      });

      expect(result.agentInsights['agent-1']).toContain('parallel');
      expect(result.agentInsights['agent-2']).toContain('parallel');
    });

    test('should build recommendations for success', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'sequential',
        task: 'Refactor code',
        success: true
      });

      expect(result.recommendations).toContain('Consider using');
      expect(result.recommendations).toContain('sequential');
    });

    test('should build recommendations for failure', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Implement feature',
        success: false
      });

      expect(result.recommendations).toContain('Review');
      expect(result.recommendations).toContain('parallel');
    });

    test('should handle empty task and result summary', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        success: true
      });

      expect(result.type).toBe('pattern-usage');
      expect(result.observation).toBeDefined();
    });

    test('should truncate long task descriptions in observation', async () => {
      const longTask = 'a'.repeat(200);

      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: longTask,
        success: true
      });

      expect(result.observation.length).toBeLessThan(longTask.length + 50);
    });
  });

  describe('Keyword Detection', () => {
    beforeEach(() => {
      categorizer = new AICategorizationService({}, { fallbackToRules: true });
    });

    test('should prioritize decision keywords', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'consensus',
        task: 'Choose the best implementation and fix any bugs',
        success: true
      });

      expect(result.type).toBe('decision');
    });

    test('should check discovery before feature', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Discover new optimization patterns and implement them',
        success: true
      });

      expect(result.type).toBe('discovery');
    });

    test('should check refactor before feature', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'sequential',
        task: 'Improve code structure and add new features',
        success: true
      });

      expect(result.type).toBe('refactor');
    });

    test('should be case-insensitive', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'REFACTOR THE MODULE',
        success: true
      });

      expect(result.type).toBe('refactor');
    });

    test('should search in both task and result summary', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'sequential',
        task: 'Work on authentication',
        resultSummary: 'Discovered a security vulnerability',
        success: true
      });

      expect(result.type).toBe('discovery');
    });
  });

  describe('categorizeOrchestrationsBatch()', () => {
    test('should process batch with full success', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      const orchestrations = [
        { id: 'orch-1', pattern: 'parallel', task: 'Task 1', success: true },
        { id: 'orch-2', pattern: 'sequential', task: 'Task 2', success: true },
        { id: 'orch-3', pattern: 'consensus', task: 'Task 3', success: true }
      ];

      const results = await categorizer.categorizeOrchestrationsBatch(orchestrations);

      expect(results).toHaveLength(3);
      expect(results.every(r => r.success)).toBe(true);
      expect(results[0].orchestrationId).toBe('orch-1');
      expect(results[0].result.type).toBeDefined();
    });

    test('should handle partial batch success', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      let callCount = 0;
      mockAnthropicMessages.create.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error('API error'));
        }
        return Promise.resolve({
          content: [{
            text: JSON.stringify({
              type: 'feature',
              observation: 'Test',
              concepts: ['test'],
              importance: 5
            })
          }]
        });
      });

      categorizer.options.fallbackToRules = false;

      const orchestrations = [
        { id: 'orch-1', pattern: 'parallel', task: 'Task 1', success: true },
        { id: 'orch-2', pattern: 'sequential', task: 'Task 2', success: true },
        { id: 'orch-3', pattern: 'consensus', task: 'Task 3', success: true }
      ];

      const results = await categorizer.categorizeOrchestrationsBatch(orchestrations);

      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      expect(successful.length).toBe(2);
      expect(failed.length).toBe(1);
      expect(failed[0].error).toBeDefined();
    });

    test('should handle complete batch failure', async () => {
      categorizer = new AICategorizationService({}, { fallbackToRules: false });

      const orchestrations = [
        { id: 'orch-1', pattern: 'parallel', task: 'Task 1', success: true },
        { id: 'orch-2', pattern: 'sequential', task: 'Task 2', success: true }
      ];

      const results = await categorizer.categorizeOrchestrationsBatch(orchestrations);

      expect(results.every(r => !r.success)).toBe(true);
    });

    test('should respect concurrency limit', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' }, { concurrency: 2 });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      let concurrent = 0;
      let maxConcurrent = 0;

      mockAnthropicMessages.create.mockImplementation(() => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);

        return new Promise(resolve => {
          setTimeout(() => {
            concurrent--;
            resolve({
              content: [{
                text: JSON.stringify({
                  type: 'feature',
                  observation: 'Test',
                  concepts: ['test'],
                  importance: 5
                })
              }]
            });
          }, 10);
        });
      });

      const orchestrations = Array.from({ length: 5 }, (_, i) => ({
        id: `orch-${i}`,
        pattern: 'parallel',
        task: `Task ${i}`,
        success: true
      }));

      await categorizer.categorizeOrchestrationsBatch(orchestrations);

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    test('should override concurrency via options', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' }, { concurrency: 3 });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      const orchestrations = Array.from({ length: 2 }, (_, i) => ({
        id: `orch-${i}`,
        pattern: 'parallel',
        task: `Task ${i}`,
        success: true
      }));

      const results = await categorizer.categorizeOrchestrationsBatch(
        orchestrations,
        { concurrency: 1 }
      );

      expect(results).toHaveLength(2);
    });

    test('should handle empty batch', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });

      const results = await categorizer.categorizeOrchestrationsBatch([]);

      expect(results).toHaveLength(0);
    });

    test('should track batch metrics', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      const orchestrations = [
        { id: 'orch-1', pattern: 'parallel', task: 'Task 1', success: true },
        { id: 'orch-2', pattern: 'sequential', task: 'Task 2', success: true }
      ];

      await categorizer.categorizeOrchestrationsBatch(orchestrations);

      expect(categorizer.metrics.totalRequests).toBe(2);
      expect(categorizer.metrics.successful).toBe(2);
    });
  });

  describe('Error Handling and Graceful Degradation', () => {
    test('should handle API timeout', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      mockAnthropicMessages.create.mockRejectedValueOnce(new Error('Request timeout'));

      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test timeout',
        success: true
      });

      expect(result.source).toBe('rule-based');
    });

    test('should handle network errors', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      mockAnthropicMessages.create.mockRejectedValueOnce(new Error('Network error'));

      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test network error',
        success: true
      });

      expect(result.source).toBe('rule-based');
    });

    test('should handle empty response', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      mockAnthropicMessages.create.mockResolvedValueOnce({
        content: []
      });

      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test',
        success: true
      });

      expect(result.source).toBe('rule-based');
    });

    test('should handle invalid JSON in response', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      mockAnthropicMessages.create.mockResolvedValueOnce({
        content: [{
          text: '{invalid json}'
        }]
      });

      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test',
        success: true
      });

      expect(result.source).toBe('rule-based');
    });

    test('should handle null orchestration data', async () => {
      categorizer = new AICategorizationService({});

      await expect(
        categorizer.categorizeOrchestration(null)
      ).rejects.toThrow();
    });

    test('should handle undefined orchestration data', async () => {
      categorizer = new AICategorizationService({});

      await expect(
        categorizer.categorizeOrchestration(undefined)
      ).rejects.toThrow();
    });

    test('should increment failure metrics on error', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      mockAnthropicMessages.create.mockRejectedValueOnce(new Error('Test error'));

      await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test',
        success: true
      });

      expect(categorizer.metrics.failed).toBe(1);
    });
  });

  describe('Metrics and Health', () => {
    test('isHealthy() should return true when AI available', () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.isAvailable = true;

      expect(categorizer.isHealthy()).toBe(true);
    });

    test('isHealthy() should return false when AI unavailable', () => {
      categorizer = new AICategorizationService({});

      expect(categorizer.isHealthy()).toBe(false);
    });

    test('getMetrics() should return complete metrics', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test 1',
        success: true
      });

      await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test 2',
        success: true
      });

      const metrics = categorizer.getMetrics();

      expect(metrics.totalRequests).toBe(2);
      expect(metrics.successful).toBe(2);
      expect(metrics.failed).toBe(0);
      expect(metrics.fallbacks).toBe(0);
      expect(metrics.isAvailable).toBe(true);
      expect(metrics.fallbackEnabled).toBe(true);
      expect(metrics.successRate).toBe(1);
      expect(metrics.fallbackRate).toBe(0);
      expect(metrics.aiUsageRate).toBe(1);
    });

    test('should calculate success rate correctly', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      mockAnthropicMessages.create
        .mockResolvedValueOnce({
          content: [{
            text: JSON.stringify({
              type: 'feature',
              observation: 'Test',
              concepts: ['test'],
              importance: 5
            })
          }]
        })
        .mockRejectedValueOnce(new Error('Error'));

      await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test 1',
        success: true
      });

      await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test 2',
        success: true
      });

      const metrics = categorizer.getMetrics();

      expect(metrics.successRate).toBe(0.5);
      expect(metrics.fallbackRate).toBe(0.5);
    });

    test('should track average duration', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test',
        success: true
      });

      expect(categorizer.metrics.avgDuration).toBeGreaterThanOrEqual(0);
      expect(categorizer.metrics.totalDuration).toBeGreaterThanOrEqual(0);
    });

    test('should handle division by zero in metrics', () => {
      categorizer = new AICategorizationService({});

      const metrics = categorizer.getMetrics();

      expect(metrics.successRate).toBe(0);
      expect(metrics.fallbackRate).toBe(0);
      expect(metrics.aiUsageRate).toBe(0);
    });
  });

  describe('Integration Tests', () => {
    test('should complete full AI categorization workflow', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      mockAnthropicMessages.create.mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            type: 'feature',
            observation: 'Successfully implemented user authentication using JWT',
            concepts: ['authentication', 'jwt', 'security', 'tokens'],
            importance: 8,
            agentInsights: {
              'agent-1': 'Led implementation of JWT logic',
              'agent-2': 'Implemented token validation'
            },
            recommendations: 'Use similar JWT pattern for authorization features'
          })
        }]
      });

      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        agentIds: ['agent-1', 'agent-2'],
        task: 'Implement user authentication with JWT',
        resultSummary: 'Authentication system implemented successfully',
        success: true,
        duration: 5500
      });

      expect(result.type).toBe('feature');
      expect(result.observation).toContain('authentication');
      expect(result.concepts).toContain('jwt');
      expect(result.importance).toBe(8);
      expect(result.agentInsights['agent-1']).toBeDefined();
      expect(result.recommendations).toContain('JWT');
      expect(result.source).toBe('ai');

      const metrics = categorizer.getMetrics();
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.successful).toBe(1);
      expect(metrics.aiCalls).toBe(1);
    });

    test('should complete full rule-based workflow', async () => {
      categorizer = new AICategorizationService({}, { fallbackToRules: true });

      const result = await categorizer.categorizeOrchestration({
        pattern: 'sequential',
        agentIds: ['agent-1', 'agent-2'],
        task: 'Refactor database connection layer to improve performance',
        resultSummary: 'Connection pooling implemented, 50% faster queries',
        success: true,
        duration: 4200
      });

      expect(result.type).toBe('refactor');
      expect(result.observation).toContain('Code improvement');
      expect(result.concepts).toContain('code-improvement');
      expect(result.importance).toBe(5);
      expect(result.agentInsights['agent-1']).toContain('sequential');
      expect(result.recommendations).toContain('sequential');
      expect(result.source).toBe('rule-based');

      const metrics = categorizer.getMetrics();
      expect(metrics.ruleBasedCalls).toBe(1);
    });

    test('should fall back from AI to rules on error', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      mockAnthropicMessages.create.mockRejectedValueOnce(new Error('Rate limit exceeded'));

      const result = await categorizer.categorizeOrchestration({
        pattern: 'consensus',
        agentIds: ['agent-1', 'agent-2', 'agent-3'],
        task: 'Decide on database migration strategy',
        resultSummary: 'Chose to use phased migration approach',
        success: true,
        duration: 8000
      });

      expect(result.type).toBe('decision');
      expect(result.source).toBe('rule-based');

      const metrics = categorizer.getMetrics();
      expect(metrics.failed).toBe(1);
      expect(metrics.fallbacks).toBe(1);
      expect(metrics.ruleBasedCalls).toBe(1);
    });

    test('should process batch with mixed AI and rule-based results', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      let callCount = 0;
      mockAnthropicMessages.create.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error('API error'));
        }
        return Promise.resolve({
          content: [{
            text: JSON.stringify({
              type: 'feature',
              observation: 'Test',
              concepts: ['test'],
              importance: 5
            })
          }]
        });
      });

      const orchestrations = [
        { id: 'orch-1', pattern: 'parallel', task: 'Implement feature A', success: true },
        { id: 'orch-2', pattern: 'sequential', task: 'Fix bug in module B', success: true },
        { id: 'orch-3', pattern: 'consensus', task: 'Decide on approach C', success: true }
      ];

      const results = await categorizer.categorizeOrchestrationsBatch(orchestrations);

      const aiResults = results.filter(r => r.success && r.result.source === 'ai');
      const ruleResults = results.filter(r => r.success && r.result.source === 'rule-based');

      expect(aiResults.length).toBeGreaterThan(0);
      expect(ruleResults.length).toBeGreaterThan(0);
    });
  });

  describe('Performance Tests', () => {
    test('rule-based categorization should complete under 100ms', async () => {
      categorizer = new AICategorizationService({});

      const startTime = Date.now();

      await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test task',
        resultSummary: 'Result',
        success: true,
        duration: 1000
      });

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(100);
    });

    test('batch processing should handle concurrency efficiently', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' }, { concurrency: 3 });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      mockAnthropicMessages.create.mockImplementation(() => {
        return new Promise(resolve => {
          setTimeout(() => {
            resolve({
              content: [{
                text: JSON.stringify({
                  type: 'feature',
                  observation: 'Test',
                  concepts: ['test'],
                  importance: 5
                })
              }]
            });
          }, 10);
        });
      });

      const orchestrations = Array.from({ length: 9 }, (_, i) => ({
        id: `orch-${i}`,
        pattern: 'parallel',
        task: `Task ${i}`,
        success: true
      }));

      const startTime = Date.now();
      await categorizer.categorizeOrchestrationsBatch(orchestrations);
      const duration = Date.now() - startTime;

      // With concurrency 3, 9 items should take ~40ms (3 batches * 10ms + overhead)
      // Without concurrency, it would take ~90ms
      expect(duration).toBeLessThan(100);
    });

    test('rule-based categorization should be very fast', async () => {
      categorizer = new AICategorizationService({});

      const iterations = 100;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        await categorizer.categorizeOrchestration({
          pattern: 'parallel',
          task: `Task ${i}`,
          success: true
        });
      }

      const duration = Date.now() - startTime;
      const avgDuration = duration / iterations;

      expect(avgDuration).toBeLessThan(1); // <1ms per categorization
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      categorizer = new AICategorizationService({});
    });

    test('should handle orchestration with no task', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: '',
        success: true
      });

      expect(result.type).toBe('pattern-usage');
      expect(result.source).toBe('rule-based');
    });

    test('should handle orchestration with null fields', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: null,
        agentIds: null,
        task: null,
        resultSummary: null,
        success: true
      });

      expect(result.type).toBeDefined();
    });

    test('should handle orchestration with empty arrays', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        agentIds: [],
        task: 'Test',
        success: true
      });

      expect(result.agentInsights).toEqual({});
    });

    test('should handle very long task descriptions', async () => {
      const longTask = 'a'.repeat(5000);

      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: longTask,
        success: true
      });

      expect(result.observation.length).toBeLessThan(5000);
    });

    test('should handle special characters in text', async () => {
      const result = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test with <>&"\'`\n\t special chars',
        resultSummary: 'Result with émojis 😀🎉',
        success: true
      });

      expect(result.observation).toBeDefined();
    });

    test('should handle concurrent categorizations', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      const promises = [
        categorizer.categorizeOrchestration({ pattern: 'parallel', task: 'Task 1', success: true }),
        categorizer.categorizeOrchestration({ pattern: 'sequential', task: 'Task 2', success: true }),
        categorizer.categorizeOrchestration({ pattern: 'consensus', task: 'Task 3', success: true })
      ];

      await expect(Promise.all(promises)).resolves.toBeDefined();
    });

    test('should handle orchestration with boolean success', async () => {
      const result1 = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test',
        success: true
      });

      const result2 = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test',
        success: false
      });

      expect(result1.importance).toBeGreaterThan(result2.importance);
    });

    test('should handle missing pattern', async () => {
      const result = await categorizer.categorizeOrchestration({
        task: 'Test task',
        success: true
      });

      expect(result.observation).toBeDefined();
    });

    test('should handle all categorization types', async () => {
      const types = [
        { task: 'Decide on approach', expected: 'decision' },
        { task: 'Fix the bug', expected: 'bugfix' },
        { task: 'Add new feature', expected: 'feature' },
        { task: 'Refactor code', expected: 'refactor' },
        { task: 'Discover insights', expected: 'discovery' },
        { task: 'Execute task', expected: 'pattern-usage' }
      ];

      for (const { task, expected } of types) {
        const result = await categorizer.categorizeOrchestration({
          pattern: 'parallel',
          task,
          success: true
        });

        expect(result.type).toBe(expected);
      }
    });

    test('should handle importance boundary values', async () => {
      categorizer = new AICategorizationService({ apiKey: 'test-key' });
      categorizer.anthropic = mockAnthropicClient;
      categorizer.isAvailable = true;

      // Test minimum boundary
      mockAnthropicMessages.create.mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            type: 'feature',
            observation: 'Test',
            concepts: [],
            importance: 0
          })
        }]
      });

      const result1 = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test',
        success: true
      });

      expect(result1.importance).toBeGreaterThanOrEqual(1);

      // Test maximum boundary
      mockAnthropicMessages.create.mockResolvedValueOnce({
        content: [{
          text: JSON.stringify({
            type: 'feature',
            observation: 'Test',
            concepts: [],
            importance: 100
          })
        }]
      });

      const result2 = await categorizer.categorizeOrchestration({
        pattern: 'parallel',
        task: 'Test',
        success: true
      });

      expect(result2.importance).toBeLessThanOrEqual(10);
    });
  });
});
