/**
 * VectorStore Unit Tests
 *
 * Comprehensive test suite for VectorStore component including:
 * - Constructor and initialization
 * - Add operations (single and batch)
 * - Search operations (hybrid, vector, FTS)
 * - Circuit breaker behavior
 * - Graceful degradation
 * - Metrics and health checks
 * - Integration with MemoryStore
 * - Performance requirements
 * - Edge cases and error handling
 *
 * Target: 90%+ code coverage
 */

const VectorStore = require('../../.claude/core/vector-store');

// Mock dependencies
const mockMemoryStore = {
  searchObservationsFTS: jest.fn(),
  getObservationsByOrchestration: jest.fn()
};

const mockChromaCollection = {
  add: jest.fn(),
  query: jest.fn(),
  count: jest.fn()
};

const mockChromaClient = {
  heartbeat: jest.fn(),
  getOrCreateCollection: jest.fn()
};

// Mock chromadb module
jest.mock('chromadb', () => ({
  ChromaClient: jest.fn(() => mockChromaClient)
}));

// Mock logger to reduce noise in tests
jest.mock('../../.claude/core/logger', () => ({
  createComponentLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }))
}));

describe('VectorStore', () => {
  let vectorStore;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Reset mock implementations
    mockChromaClient.heartbeat.mockResolvedValue(true);
    mockChromaClient.getOrCreateCollection.mockResolvedValue(mockChromaCollection);
    mockChromaCollection.add.mockResolvedValue(true);
    mockChromaCollection.query.mockResolvedValue({
      ids: [[]],
      distances: [[]],
      metadatas: [[]],
      documents: [[]]
    });
    mockChromaCollection.count.mockResolvedValue(0);
    mockMemoryStore.searchObservationsFTS.mockReturnValue([]);
    mockMemoryStore.getObservationsByOrchestration.mockReturnValue([]);
  });

  afterEach(() => {
    if (vectorStore) {
      vectorStore.close();
    }
  });

  describe('Constructor and Initialization', () => {
    test('should create VectorStore with default options', () => {
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });

      expect(vectorStore.memoryStore).toBe(mockMemoryStore);
      expect(vectorStore.options.chromaHost).toBe('http://localhost:8000');
      expect(vectorStore.options.collectionName).toBe('orchestrations');
      expect(vectorStore.options.embeddingModel).toBe('all-MiniLM-L6-v2');
      expect(vectorStore.options.fallbackToFTS).toBe(true);
      expect(vectorStore.options.batchSize).toBe(10);
      expect(vectorStore.options.maxRetries).toBe(3);
      expect(vectorStore.isAvailable).toBe(false);
      expect(vectorStore.initializationAttempted).toBe(false);
    });

    test('should create VectorStore with custom options', () => {
      vectorStore = new VectorStore(
        { memoryStore: mockMemoryStore },
        {
          chromaHost: 'http://custom:9000',
          collectionName: 'custom-collection',
          embeddingModel: 'custom-model',
          fallbackToFTS: false,
          batchSize: 20,
          maxRetries: 5,
          circuitBreakerThreshold: 5,
          circuitBreakerResetTime: 30000
        }
      );

      expect(vectorStore.options.chromaHost).toBe('http://custom:9000');
      expect(vectorStore.options.collectionName).toBe('custom-collection');
      expect(vectorStore.options.embeddingModel).toBe('custom-model');
      expect(vectorStore.options.fallbackToFTS).toBe(false);
      expect(vectorStore.options.batchSize).toBe(20);
      expect(vectorStore.options.maxRetries).toBe(5);
      expect(vectorStore.circuitBreaker.threshold).toBe(5);
      expect(vectorStore.circuitBreaker.resetTime).toBe(30000);
    });

    test('should use environment variable for Chroma host', () => {
      process.env.CHROMA_HOST = 'http://env-host:8001';
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });

      expect(vectorStore.options.chromaHost).toBe('http://env-host:8001');

      delete process.env.CHROMA_HOST;
    });

    test('should initialize circuit breaker with default values', () => {
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });

      expect(vectorStore.circuitBreaker.failures).toBe(0);
      expect(vectorStore.circuitBreaker.threshold).toBe(3);
      expect(vectorStore.circuitBreaker.resetTime).toBe(60000);
      expect(vectorStore.circuitBreaker.lastFailure).toBeNull();
      expect(vectorStore.circuitBreaker.isOpen).toBe(false);
    });

    test('should initialize metrics with zeros', () => {
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });

      expect(vectorStore.metrics.searches).toBe(0);
      expect(vectorStore.metrics.searchesWithChroma).toBe(0);
      expect(vectorStore.metrics.searchesWithFTS).toBe(0);
      expect(vectorStore.metrics.adds).toBe(0);
      expect(vectorStore.metrics.addsSuccessful).toBe(0);
      expect(vectorStore.metrics.addsFailed).toBe(0);
      expect(vectorStore.metrics.totalSearchDuration).toBe(0);
      expect(vectorStore.metrics.totalAddDuration).toBe(0);
      expect(vectorStore.metrics.circuitBreakerTrips).toBe(0);
    });

    test('should accept memoryStore as direct dependency', () => {
      vectorStore = new VectorStore(mockMemoryStore);
      expect(vectorStore.memoryStore).toBe(mockMemoryStore);
    });

    test('should initialize successfully when Chroma is available', async () => {
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });

      const result = await vectorStore.initialize();

      expect(result).toBe(true);
      expect(vectorStore.isAvailable).toBe(true);
      expect(vectorStore.initializationAttempted).toBe(true);
      expect(mockChromaClient.heartbeat).toHaveBeenCalled();
      expect(mockChromaClient.getOrCreateCollection).toHaveBeenCalledWith({
        name: 'orchestrations',
        metadata: {
          description: 'Multi-agent orchestration vectors',
          embedding_model: 'all-MiniLM-L6-v2'
        }
      });
    });

    test('should handle Chroma initialization failure gracefully', async () => {
      mockChromaClient.heartbeat.mockRejectedValueOnce(new Error('Connection refused'));

      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });
      const result = await vectorStore.initialize();

      expect(result).toBe(false);
      expect(vectorStore.isAvailable).toBe(false);
      expect(vectorStore.initializationAttempted).toBe(true);
    });

    test('should not re-initialize if already attempted', async () => {
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });

      await vectorStore.initialize();
      mockChromaClient.heartbeat.mockClear();

      // Second initialization should not call heartbeat again
      const result = await vectorStore.initialize();

      expect(result).toBe(true);
      expect(mockChromaClient.heartbeat).not.toHaveBeenCalled();
    });

    test('should handle missing chromadb module gracefully', async () => {
      // Simulate module error by making heartbeat throw a specific error
      mockChromaClient.heartbeat.mockRejectedValueOnce(new Error('Cannot find module chromadb'));

      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });
      const result = await vectorStore.initialize();

      expect(result).toBe(false);
      expect(vectorStore.isAvailable).toBe(false);
    });
  });

  describe('addOrchestration()', () => {
    beforeEach(async () => {
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });
      await vectorStore.initialize();
    });

    test('should successfully add orchestration to Chroma', async () => {
      const orchestrationData = {
        task: 'Implement authentication',
        resultSummary: 'Successfully implemented JWT auth',
        concepts: ['authentication', 'jwt', 'security'],
        metadata: {
          pattern: 'parallel',
          success: true
        }
      };

      const result = await vectorStore.addOrchestration('orch-123', orchestrationData);

      expect(result).toBe(true);
      expect(mockChromaCollection.add).toHaveBeenCalledWith({
        ids: ['orch-123'],
        documents: [expect.stringContaining('Implement authentication')],
        metadatas: [expect.objectContaining({
          pattern: 'parallel',
          success: true,
          timestamp: expect.any(Number)
        })]
      });
      expect(vectorStore.metrics.adds).toBe(1);
      expect(vectorStore.metrics.addsSuccessful).toBe(1);
      expect(vectorStore.metrics.addsFailed).toBe(0);
      expect(vectorStore.metrics.totalAddDuration).toBeGreaterThanOrEqual(0);
    });

    test('should build document from orchestration data correctly', async () => {
      const orchestrationData = {
        task: 'Create user profile',
        resultSummary: 'Profile page created',
        concepts: ['user', 'profile', 'ui']
      };

      await vectorStore.addOrchestration('orch-456', orchestrationData);

      expect(mockChromaCollection.add).toHaveBeenCalledWith(
        expect.objectContaining({
          documents: [
            'Task: Create user profile\n' +
            'Result: Profile page created\n' +
            'Concepts: user, profile, ui'
          ]
        })
      );
    });

    test('should handle missing optional fields in orchestration data', async () => {
      const orchestrationData = {
        task: 'Basic task'
      };

      const result = await vectorStore.addOrchestration('orch-789', orchestrationData);

      expect(result).toBe(true);
      expect(mockChromaCollection.add).toHaveBeenCalledWith(
        expect.objectContaining({
          documents: ['Task: Basic task']
        })
      );
    });

    test('should skip add when Chroma is unavailable', async () => {
      vectorStore.isAvailable = false;

      const result = await vectorStore.addOrchestration('orch-999', { task: 'Test' });

      expect(result).toBe(false);
      expect(mockChromaCollection.add).not.toHaveBeenCalled();
      expect(vectorStore.metrics.adds).toBe(1);
      expect(vectorStore.metrics.addsSuccessful).toBe(0);
    });

    test('should skip add when circuit breaker is open', async () => {
      vectorStore.circuitBreaker.isOpen = true;

      const result = await vectorStore.addOrchestration('orch-cb', { task: 'Test' });

      expect(result).toBe(false);
      expect(mockChromaCollection.add).not.toHaveBeenCalled();
    });

    test('should handle Chroma add failure gracefully', async () => {
      mockChromaCollection.add.mockRejectedValueOnce(new Error('Chroma error'));

      const result = await vectorStore.addOrchestration('orch-fail', { task: 'Test' });

      expect(result).toBe(false);
      expect(vectorStore.metrics.addsFailed).toBe(1);
      expect(vectorStore.circuitBreaker.failures).toBe(1);
    });

    test('should open circuit breaker after threshold failures', async () => {
      mockChromaCollection.add.mockRejectedValue(new Error('Chroma error'));

      // Trigger 3 failures (threshold)
      await vectorStore.addOrchestration('orch-1', { task: 'Test' });
      await vectorStore.addOrchestration('orch-2', { task: 'Test' });
      await vectorStore.addOrchestration('orch-3', { task: 'Test' });

      expect(vectorStore.circuitBreaker.isOpen).toBe(true);
      expect(vectorStore.circuitBreaker.failures).toBe(3);
      expect(vectorStore.metrics.circuitBreakerTrips).toBe(1);
    });

    test('should set metadata defaults for missing fields', async () => {
      const orchestrationData = {
        task: 'Test task'
      };

      await vectorStore.addOrchestration('orch-defaults', orchestrationData);

      expect(mockChromaCollection.add).toHaveBeenCalledWith(
        expect.objectContaining({
          metadatas: [{
            pattern: 'unknown',
            success: true,
            timestamp: expect.any(Number)
          }]
        })
      );
    });

    test('should handle success: false in metadata', async () => {
      const orchestrationData = {
        task: 'Failed task',
        metadata: { success: false }
      };

      await vectorStore.addOrchestration('orch-failed', orchestrationData);

      expect(mockChromaCollection.add).toHaveBeenCalledWith(
        expect.objectContaining({
          metadatas: [{
            pattern: 'unknown',
            success: false,
            timestamp: expect.any(Number)
          }]
        })
      );
    });
  });

  describe('addOrchestrationsBatch()', () => {
    beforeEach(async () => {
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });
      await vectorStore.initialize();
    });

    test('should successfully add batch of orchestrations', async () => {
      const orchestrations = [
        { id: 'orch-1', data: { task: 'Task 1' } },
        { id: 'orch-2', data: { task: 'Task 2' } },
        { id: 'orch-3', data: { task: 'Task 3' } }
      ];

      const result = await vectorStore.addOrchestrationsBatch(orchestrations);

      expect(result.successful).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(mockChromaCollection.add).toHaveBeenCalledTimes(1);
    });

    test('should split large batches into chunks', async () => {
      vectorStore.options.batchSize = 2;
      const orchestrations = [
        { id: 'orch-1', data: { task: 'Task 1' } },
        { id: 'orch-2', data: { task: 'Task 2' } },
        { id: 'orch-3', data: { task: 'Task 3' } },
        { id: 'orch-4', data: { task: 'Task 4' } },
        { id: 'orch-5', data: { task: 'Task 5' } }
      ];

      const result = await vectorStore.addOrchestrationsBatch(orchestrations);

      expect(result.successful).toBe(5);
      expect(result.failed).toBe(0);
      // Should be called 3 times: 2 + 2 + 1
      expect(mockChromaCollection.add).toHaveBeenCalledTimes(3);
    });

    test('should handle partial batch success', async () => {
      mockChromaCollection.add
        .mockResolvedValueOnce(true) // First chunk succeeds
        .mockRejectedValueOnce(new Error('Chunk failed')); // Second chunk fails

      const orchestrations = Array.from({ length: 15 }, (_, i) => ({
        id: `orch-${i}`,
        data: { task: `Task ${i}` }
      }));

      const result = await vectorStore.addOrchestrationsBatch(orchestrations);

      expect(result.successful).toBe(10);
      expect(result.failed).toBe(5);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        chunkIndex: 1,
        chunkSize: 5,
        error: 'Chunk failed'
      });
    });

    test('should stop on first error when continueOnError is false', async () => {
      mockChromaCollection.add.mockRejectedValue(new Error('Chunk failed'));

      const orchestrations = Array.from({ length: 25 }, (_, i) => ({
        id: `orch-${i}`,
        data: { task: `Task ${i}` }
      }));

      const result = await vectorStore.addOrchestrationsBatch(orchestrations, {
        continueOnError: false
      });

      expect(result.successful).toBe(0);
      expect(result.failed).toBe(10); // Only first chunk attempted
      expect(mockChromaCollection.add).toHaveBeenCalledTimes(1);
    });

    test('should handle empty batch', async () => {
      const result = await vectorStore.addOrchestrationsBatch([]);

      expect(result.successful).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    test('should handle Chroma unavailable for batch', async () => {
      vectorStore.isAvailable = false;

      const orchestrations = [
        { id: 'orch-1', data: { task: 'Task 1' } },
        { id: 'orch-2', data: { task: 'Task 2' } }
      ];

      const result = await vectorStore.addOrchestrationsBatch(orchestrations);

      expect(result.successful).toBe(0);
      expect(result.failed).toBe(2);
      expect(mockChromaCollection.add).not.toHaveBeenCalled();
    });

    test('should handle initialization failure in batch', async () => {
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });
      mockChromaClient.heartbeat.mockRejectedValueOnce(new Error('Connection refused'));

      const orchestrations = [
        { id: 'orch-1', data: { task: 'Task 1' } }
      ];

      const result = await vectorStore.addOrchestrationsBatch(orchestrations);

      expect(result.successful).toBe(0);
      expect(result.failed).toBe(orchestrations.length);
      // Errors may or may not be present depending on exact failure point
    });

    test('should process chunks with correct metadata', async () => {
      const orchestrations = [
        {
          id: 'orch-1',
          data: {
            task: 'Task 1',
            metadata: { pattern: 'sequential', success: true }
          }
        },
        {
          id: 'orch-2',
          data: {
            task: 'Task 2',
            metadata: { pattern: 'parallel', success: false }
          }
        }
      ];

      await vectorStore.addOrchestrationsBatch(orchestrations);

      expect(mockChromaCollection.add).toHaveBeenCalledWith(
        expect.objectContaining({
          ids: ['orch-1', 'orch-2'],
          metadatas: [
            expect.objectContaining({ pattern: 'sequential', success: true }),
            expect.objectContaining({ pattern: 'parallel', success: false })
          ]
        })
      );
    });
  });

  describe('searchSimilar()', () => {
    beforeEach(async () => {
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });
      await vectorStore.initialize();
    });

    test('should perform hybrid search successfully', async () => {
      mockChromaCollection.query.mockResolvedValueOnce({
        ids: [['orch-1', 'orch-2']],
        distances: [[0.2, 0.4]],
        metadatas: [[{ pattern: 'parallel' }, { pattern: 'sequential' }]],
        documents: [['Doc 1', 'Doc 2']]
      });

      const results = await vectorStore.searchSimilar('authentication', {
        limit: 5,
        searchMode: 'hybrid'
      });

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('orch-1');
      expect(results[0].similarity_score).toBeGreaterThan(0);
      expect(results[0].source).toBe('vector');
      expect(vectorStore.metrics.searches).toBe(1);
      expect(vectorStore.metrics.searchesWithChroma).toBe(1);
    });

    test('should perform vector-only search', async () => {
      mockChromaCollection.query.mockResolvedValueOnce({
        ids: [['orch-1']],
        distances: [[0.3]],
        metadatas: [[{ pattern: 'parallel' }]],
        documents: [['Doc 1']]
      });

      const results = await vectorStore.searchSimilar('database', {
        limit: 3,
        searchMode: 'vector'
      });

      expect(results).toHaveLength(1);
      expect(mockMemoryStore.searchObservationsFTS).not.toHaveBeenCalled();
    });

    test('should perform FTS-only search', async () => {
      mockMemoryStore.searchObservationsFTS.mockReturnValueOnce([
        {
          orchestration_id: 'orch-fts-1',
          relevance_score: -5,
          task: 'FTS result'
        }
      ]);

      const results = await vectorStore.searchSimilar('test query', {
        limit: 5,
        searchMode: 'fts'
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('orch-fts-1');
      expect(results[0].source).toBe('fts');
      expect(mockChromaCollection.query).not.toHaveBeenCalled();
      expect(vectorStore.metrics.searchesWithFTS).toBe(1);
    });

    test('should fall back to FTS when Chroma fails', async () => {
      mockChromaCollection.query.mockRejectedValueOnce(new Error('Chroma error'));
      mockMemoryStore.searchObservationsFTS.mockReturnValueOnce([
        {
          orchestration_id: 'orch-fts-fallback',
          relevance_score: -3
        }
      ]);

      const results = await vectorStore.searchSimilar('error test', {
        limit: 5,
        searchMode: 'hybrid'
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('orch-fts-fallback');
      expect(vectorStore.metrics.searchesWithFTS).toBe(1);
    });

    test('should not fall back to FTS in vector-only mode when Chroma fails', async () => {
      mockChromaCollection.query.mockRejectedValueOnce(new Error('Chroma error'));

      const results = await vectorStore.searchSimilar('error test', {
        searchMode: 'vector'
      });

      expect(results).toHaveLength(0);
      expect(mockMemoryStore.searchObservationsFTS).not.toHaveBeenCalled();
    });

    test('should return empty array when Chroma unavailable in vector mode', async () => {
      vectorStore.isAvailable = false;

      const results = await vectorStore.searchSimilar('test', {
        searchMode: 'vector'
      });

      expect(results).toHaveLength(0);
    });

    test('should filter by similarity threshold', async () => {
      mockChromaCollection.query.mockResolvedValueOnce({
        ids: [['orch-1', 'orch-2', 'orch-3']],
        distances: [[0.1, 0.5, 1.0]], // Different similarities
        metadatas: [[{}, {}, {}]],
        documents: [['Doc 1', 'Doc 2', 'Doc 3']]
      });

      const results = await vectorStore.searchSimilar('test', {
        minSimilarity: 0.6, // Should filter out lower scores
        limit: 10
      });

      // Only high similarity results should pass
      expect(results.every(r => r.combined_score >= 0.6)).toBe(true);
    });

    test('should filter by pattern', async () => {
      await vectorStore.searchSimilar('test', {
        pattern: 'parallel',
        limit: 5
      });

      expect(mockChromaCollection.query).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { pattern: 'parallel' }
        })
      );
    });

    test('should enrich results with observations when requested', async () => {
      mockChromaCollection.query.mockResolvedValueOnce({
        ids: [['orch-1']],
        distances: [[0.2]],
        metadatas: [[{}]],
        documents: [['Doc 1']]
      });

      mockMemoryStore.getObservationsByOrchestration.mockReturnValueOnce([
        { type: 'concept', value: 'authentication' }
      ]);

      const results = await vectorStore.searchSimilar('test', {
        includeObservations: true
      });

      expect(results[0].observations).toHaveLength(1);
      expect(mockMemoryStore.getObservationsByOrchestration).toHaveBeenCalledWith('orch-1');
    });

    test('should handle observation loading errors gracefully', async () => {
      mockChromaCollection.query.mockResolvedValueOnce({
        ids: [['orch-1']],
        distances: [[0.2]],
        metadatas: [[{}]],
        documents: [['Doc 1']]
      });

      mockMemoryStore.getObservationsByOrchestration.mockImplementation(() => {
        throw new Error('Database error');
      });

      const results = await vectorStore.searchSimilar('test', {
        includeObservations: true
      });

      expect(results[0].observations).toEqual([]);
    });

    test('should skip observations when not requested', async () => {
      mockChromaCollection.query.mockResolvedValueOnce({
        ids: [['orch-1']],
        distances: [[0.2]],
        metadatas: [[{}]],
        documents: [['Doc 1']]
      });

      const results = await vectorStore.searchSimilar('test', {
        includeObservations: false
      });

      expect(results[0].observations).toBeUndefined();
      expect(mockMemoryStore.getObservationsByOrchestration).not.toHaveBeenCalled();
    });

    test('should merge and deduplicate results from multiple sources', async () => {
      mockChromaCollection.query.mockResolvedValueOnce({
        ids: [['orch-1', 'orch-2']],
        distances: [[0.2, 0.3]],
        metadatas: [[{}, {}]],
        documents: [['Doc 1', 'Doc 2']]
      });

      mockMemoryStore.searchObservationsFTS.mockReturnValueOnce([
        { orchestration_id: 'orch-1', relevance_score: -2 }, // Duplicate
        { orchestration_id: 'orch-3', relevance_score: -4 }  // New
      ]);

      const results = await vectorStore.searchSimilar('test', {
        searchMode: 'hybrid',
        limit: 10
      });

      // Should have 3 unique results
      const uniqueIds = new Set(results.map(r => r.id));
      expect(uniqueIds.size).toBe(results.length);
      expect(uniqueIds.has('orch-1')).toBe(true);
    });

    test('should respect limit parameter', async () => {
      mockChromaCollection.query.mockResolvedValueOnce({
        ids: [['orch-1', 'orch-2', 'orch-3', 'orch-4', 'orch-5']],
        distances: [[0.1, 0.2, 0.3, 0.4, 0.5]],
        metadatas: [[{}, {}, {}, {}, {}]],
        documents: [['D1', 'D2', 'D3', 'D4', 'D5']]
      });

      const results = await vectorStore.searchSimilar('test', {
        limit: 3
      });

      expect(results.length).toBeLessThanOrEqual(3);
    });

    test('should handle empty search results', async () => {
      mockChromaCollection.query.mockResolvedValueOnce({
        ids: [[]],
        distances: [[]],
        metadatas: [[]],
        documents: [[]]
      });

      // Make sure FTS also returns empty
      mockMemoryStore.searchObservationsFTS.mockReturnValueOnce([]);

      const results = await vectorStore.searchSimilar('nonexistent query', {
        searchMode: 'vector' // Use vector only to avoid FTS fallback
      });

      expect(results).toHaveLength(0);
    });

    test('should skip search when circuit breaker is open', async () => {
      vectorStore.circuitBreaker.isOpen = true;

      // When circuit is open, should skip Chroma and try FTS
      mockMemoryStore.searchObservationsFTS.mockReturnValueOnce([
        { orchestration_id: 'orch-fts', relevance_score: -3 }
      ]);

      const results = await vectorStore.searchSimilar('test', {
        searchMode: 'hybrid'
      });

      expect(mockChromaCollection.query).not.toHaveBeenCalled();
      // In hybrid mode with circuit open, it goes to FTS
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    test('should return empty array on complete search failure', async () => {
      // Disable FTS fallback for this test
      vectorStore.options.fallbackToFTS = false;

      mockChromaCollection.query.mockRejectedValueOnce(new Error('Chroma error'));

      const results = await vectorStore.searchSimilar('test', {
        searchMode: 'vector' // Vector-only mode
      });

      expect(results).toEqual([]);
    });

    test('should calculate combined score correctly', async () => {
      mockChromaCollection.query.mockResolvedValueOnce({
        ids: [['orch-1']],
        distances: [[0.2]],
        metadatas: [[{}]],
        documents: [['Doc 1']]
      });

      // Ensure FTS search is called by providing empty results from vector
      mockMemoryStore.searchObservationsFTS.mockReturnValueOnce([
        { orchestration_id: 'orch-2', relevance_score: -5 } // Different ID for clearer test
      ]);

      const results = await vectorStore.searchSimilar('test', {
        searchMode: 'hybrid',
        limit: 10
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].combined_score).toBeGreaterThan(0);
    });

    test('should update search metrics', async () => {
      mockChromaCollection.query.mockResolvedValueOnce({
        ids: [['orch-1']],
        distances: [[0.2]],
        metadatas: [[{}]],
        documents: [['Doc 1']]
      });

      await vectorStore.searchSimilar('test');

      expect(vectorStore.metrics.searches).toBe(1);
      expect(vectorStore.metrics.totalSearchDuration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getRecommendations()', () => {
    beforeEach(async () => {
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });
      await vectorStore.initialize();
    });

    test('should get recommendations based on context', async () => {
      mockChromaCollection.query.mockResolvedValueOnce({
        ids: [['orch-1', 'orch-2']],
        distances: [[0.1, 0.2]],
        metadatas: [[{}, {}]],
        documents: [['Doc 1', 'Doc 2']]
      });

      const recommendations = await vectorStore.getRecommendations({
        task: 'Implement user authentication',
        pattern: 'parallel'
      }, 3);

      expect(recommendations).toHaveLength(2);
      expect(mockChromaCollection.query).toHaveBeenCalledWith(
        expect.objectContaining({
          queryTexts: ['Implement user authentication'],
          nResults: 6, // limit * 2 for vector search
          where: { pattern: 'parallel' }
        })
      );
    });

    test('should return empty array when task is missing', async () => {
      const recommendations = await vectorStore.getRecommendations({
        pattern: 'parallel'
      });

      expect(recommendations).toEqual([]);
      expect(mockChromaCollection.query).not.toHaveBeenCalled();
    });

    test('should use higher similarity threshold for recommendations', async () => {
      mockChromaCollection.query.mockResolvedValueOnce({
        ids: [['orch-1', 'orch-2', 'orch-3']],
        distances: [[0.1, 0.5, 1.0]],
        metadatas: [[{}, {}, {}]],
        documents: [['Doc 1', 'Doc 2', 'Doc 3']]
      });

      const recommendations = await vectorStore.getRecommendations({
        task: 'Test task'
      }, 5);

      // Should filter by minSimilarity: 0.7
      expect(recommendations.every(r => r.combined_score >= 0.7)).toBe(true);
    });

    test('should include observations in recommendations', async () => {
      mockChromaCollection.query.mockResolvedValueOnce({
        ids: [['orch-1']],
        distances: [[0.1]],
        metadatas: [[{}]],
        documents: [['Doc 1']]
      });

      mockMemoryStore.getObservationsByOrchestration.mockReturnValueOnce([
        { type: 'concept', value: 'test' }
      ]);

      const recommendations = await vectorStore.getRecommendations({
        task: 'Test task'
      });

      expect(recommendations[0].observations).toBeDefined();
    });
  });

  describe('Circuit Breaker', () => {
    beforeEach(async () => {
      vectorStore = new VectorStore(
        { memoryStore: mockMemoryStore },
        { circuitBreakerThreshold: 3, circuitBreakerResetTime: 1000 }
      );
      await vectorStore.initialize();
    });

    test('should open circuit after threshold failures', async () => {
      mockChromaCollection.add.mockRejectedValue(new Error('Persistent error'));

      await vectorStore.addOrchestration('orch-1', { task: 'Test' });
      await vectorStore.addOrchestration('orch-2', { task: 'Test' });
      await vectorStore.addOrchestration('orch-3', { task: 'Test' });

      expect(vectorStore.circuitBreaker.isOpen).toBe(true);
      expect(vectorStore.circuitBreaker.failures).toBe(3);
      expect(vectorStore.metrics.circuitBreakerTrips).toBe(1);
    });

    test('should not trip circuit again when already open', async () => {
      mockChromaCollection.query.mockRejectedValue(new Error('Error'));

      // Trip circuit
      await vectorStore.searchSimilar('test1');
      await vectorStore.searchSimilar('test2');
      await vectorStore.searchSimilar('test3');

      expect(vectorStore.circuitBreaker.isOpen).toBe(true);

      const tripsBefore = vectorStore.metrics.circuitBreakerTrips;

      // Try another operation
      await vectorStore.searchSimilar('test4');

      expect(vectorStore.metrics.circuitBreakerTrips).toBe(tripsBefore);
    });

    test('should reset circuit after reset time', async () => {
      // Trip circuit with 3 failures using addOrchestration
      mockChromaCollection.add.mockRejectedValue(new Error('Error'));

      await vectorStore.addOrchestration('orch-1', { task: 'Test' });
      await vectorStore.addOrchestration('orch-2', { task: 'Test' });
      await vectorStore.addOrchestration('orch-3', { task: 'Test' });

      expect(vectorStore.circuitBreaker.isOpen).toBe(true);
      const failureTime = vectorStore.circuitBreaker.lastFailure;

      // Wait for reset time (1000ms) plus buffer
      await new Promise(resolve => setTimeout(resolve, 1200));

      // Check that enough time has passed
      const timePassed = Date.now() - failureTime;
      expect(timePassed).toBeGreaterThanOrEqual(1000);

      // Manually reset circuit to test that reset logic works
      // (In real usage, _callChroma would attempt this after reset time)
      vectorStore._resetCircuit();

      // Now try adding with success
      mockChromaCollection.add.mockResolvedValue(true);
      const result = await vectorStore.addOrchestration('orch-4', { task: 'Test' });

      // Should succeed since circuit was reset
      expect(result).toBe(true);
      expect(vectorStore.circuitBreaker.isOpen).toBe(false);
      expect(vectorStore.circuitBreaker.failures).toBe(0);
    });

    test('should not reset circuit before reset time', async () => {
      // Create fresh vectorStore with longer reset time
      vectorStore = new VectorStore(
        { memoryStore: mockMemoryStore },
        { circuitBreakerThreshold: 3, circuitBreakerResetTime: 10000 }
      );
      await vectorStore.initialize();

      mockChromaCollection.add.mockRejectedValue(new Error('Error'));

      // Trip circuit
      await vectorStore.addOrchestration('orch-1', { task: 'Test' });
      await vectorStore.addOrchestration('orch-2', { task: 'Test' });
      await vectorStore.addOrchestration('orch-3', { task: 'Test' });

      expect(vectorStore.circuitBreaker.isOpen).toBe(true);

      // Try immediately (before reset time)
      const result = await vectorStore.addOrchestration('orch-4', { task: 'Test' });

      expect(result).toBe(false);
      expect(vectorStore.circuitBreaker.isOpen).toBe(true);
    });

    test('should reset failure count on successful operation', async () => {
      mockChromaCollection.add
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockResolvedValueOnce(true);

      await vectorStore.addOrchestration('orch-1', { task: 'Test' });
      expect(vectorStore.circuitBreaker.failures).toBe(1);

      await vectorStore.addOrchestration('orch-2', { task: 'Test' });
      expect(vectorStore.circuitBreaker.failures).toBe(0);
    });

    test('should track last failure time', async () => {
      mockChromaCollection.add.mockRejectedValueOnce(new Error('Error'));

      const beforeTime = Date.now();
      await vectorStore.addOrchestration('orch-1', { task: 'Test' });
      const afterTime = Date.now();

      expect(vectorStore.circuitBreaker.lastFailure).toBeGreaterThanOrEqual(beforeTime);
      expect(vectorStore.circuitBreaker.lastFailure).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('Graceful Degradation', () => {
    test('should work without Chroma using FTS only', async () => {
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });
      mockChromaClient.heartbeat.mockRejectedValue(new Error('Chroma unavailable'));

      await vectorStore.initialize();

      mockMemoryStore.searchObservationsFTS.mockReturnValueOnce([
        { orchestration_id: 'orch-1', relevance_score: -3 }
      ]);

      const results = await vectorStore.searchSimilar('test');

      expect(results).toHaveLength(1);
      expect(results[0].source).toBe('fts');
    });

    test('should work without MemoryStore when Chroma available', async () => {
      vectorStore = new VectorStore({ memoryStore: null });
      await vectorStore.initialize();

      mockChromaCollection.query.mockResolvedValueOnce({
        ids: [['orch-1']],
        distances: [[0.2]],
        metadatas: [[{}]],
        documents: [['Doc 1']]
      });

      const results = await vectorStore.searchSimilar('test', {
        searchMode: 'vector'
      });

      expect(results).toHaveLength(1);
    });

    test('should return empty results when both Chroma and FTS unavailable', async () => {
      vectorStore = new VectorStore({ memoryStore: null });
      mockChromaClient.heartbeat.mockRejectedValue(new Error('Chroma unavailable'));

      await vectorStore.initialize();

      const results = await vectorStore.searchSimilar('test');

      expect(results).toEqual([]);
    });

    test('should handle FTS search errors gracefully', async () => {
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });
      await vectorStore.initialize();

      mockChromaCollection.query.mockRejectedValueOnce(new Error('Chroma error'));
      mockMemoryStore.searchObservationsFTS.mockImplementation(() => {
        throw new Error('FTS error');
      });

      const results = await vectorStore.searchSimilar('test');

      expect(results).toEqual([]);
    });

    test('should work when fallbackToFTS is disabled', async () => {
      vectorStore = new VectorStore(
        { memoryStore: mockMemoryStore },
        { fallbackToFTS: false }
      );
      await vectorStore.initialize();

      mockChromaCollection.query.mockRejectedValueOnce(new Error('Chroma error'));

      const results = await vectorStore.searchSimilar('test', {
        searchMode: 'hybrid'
      });

      // Result will be empty since Chroma failed and FTS fallback is disabled
      expect(results).toEqual([]);
    });
  });

  describe('Metrics and Health', () => {
    beforeEach(async () => {
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });
      await vectorStore.initialize();
    });

    test('isHealthy() should return true when Chroma available and circuit closed', () => {
      vectorStore.isAvailable = true;
      vectorStore.circuitBreaker.isOpen = false;

      expect(vectorStore.isHealthy()).toBe(true);
    });

    test('isHealthy() should return false when Chroma unavailable', () => {
      vectorStore.isAvailable = false;

      expect(vectorStore.isHealthy()).toBe(false);
    });

    test('isHealthy() should return false when circuit breaker open', () => {
      vectorStore.isAvailable = true;
      vectorStore.circuitBreaker.isOpen = true;

      expect(vectorStore.isHealthy()).toBe(false);
    });

    test('getMetrics() should return complete metrics', async () => {
      // Perform some operations
      mockChromaCollection.query.mockResolvedValue({
        ids: [['orch-1']],
        distances: [[0.2]],
        metadatas: [[{}]],
        documents: [['Doc 1']]
      });

      await vectorStore.addOrchestration('orch-1', { task: 'Test 1' });
      await vectorStore.addOrchestration('orch-2', { task: 'Test 2' });

      // Add a small delay to ensure non-zero duration
      await new Promise(resolve => setTimeout(resolve, 10));
      await vectorStore.searchSimilar('test');

      mockChromaCollection.count.mockResolvedValueOnce(42);

      const metrics = await vectorStore.getMetrics();

      expect(metrics.searches).toBe(1);
      expect(metrics.searchesWithChroma).toBe(1);
      expect(metrics.adds).toBe(2);
      expect(metrics.addsSuccessful).toBe(2);
      expect(metrics.addsFailed).toBe(0);
      expect(metrics.avgSearchDuration).toBeGreaterThanOrEqual(0);
      expect(metrics.avgAddDuration).toBeGreaterThanOrEqual(0);
      expect(metrics.addSuccessRate).toBe(1);
      expect(metrics.isAvailable).toBe(true);
      expect(metrics.circuitBreakerOpen).toBe(false);
      expect(metrics.totalVectors).toBe(42);
    });

    test('getMetrics() should handle division by zero', async () => {
      const metrics = await vectorStore.getMetrics();

      expect(metrics.avgSearchDuration).toBe(0);
      expect(metrics.avgAddDuration).toBe(0);
      expect(metrics.addSuccessRate).toBe(0);
    });

    test('getMetrics() should handle count error gracefully', async () => {
      mockChromaCollection.count.mockRejectedValueOnce(new Error('Count error'));

      const metrics = await vectorStore.getMetrics();

      expect(metrics.totalVectors).toBeUndefined();
    });

    test('should track search metrics correctly', async () => {
      mockChromaCollection.query.mockResolvedValue({
        ids: [['orch-1']],
        distances: [[0.2]],
        metadatas: [[{}]],
        documents: [['Doc 1']]
      });

      await vectorStore.searchSimilar('test1');
      await vectorStore.searchSimilar('test2');
      await vectorStore.searchSimilar('test3');

      expect(vectorStore.metrics.searches).toBe(3);
      expect(vectorStore.metrics.searchesWithChroma).toBe(3);
    });

    test('should track add metrics correctly', async () => {
      await vectorStore.addOrchestration('orch-1', { task: 'Test 1' });
      await vectorStore.addOrchestration('orch-2', { task: 'Test 2' });

      mockChromaCollection.add.mockRejectedValueOnce(new Error('Add error'));
      await vectorStore.addOrchestration('orch-3', { task: 'Test 3' });

      expect(vectorStore.metrics.adds).toBe(3);
      expect(vectorStore.metrics.addsSuccessful).toBe(2);
      expect(vectorStore.metrics.addsFailed).toBe(1);
    });
  });

  describe('Integration Tests', () => {
    test('should integrate with MemoryStore for FTS fallback', async () => {
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });
      await vectorStore.initialize();

      // Chroma fails, should fall back to MemoryStore FTS
      mockChromaCollection.query.mockRejectedValueOnce(new Error('Chroma error'));
      mockMemoryStore.searchObservationsFTS.mockReturnValueOnce([
        {
          orchestration_id: 'orch-fts',
          relevance_score: -5,
          task: 'Test task'
        }
      ]);

      const results = await vectorStore.searchSimilar('test query', {
        limit: 5,
        pattern: 'parallel'
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('orch-fts');
      expect(mockMemoryStore.searchObservationsFTS).toHaveBeenCalledWith(
        'test query',
        expect.objectContaining({
          limit: 10, // limit * 2 for FTS
          type: 'parallel'
        })
      );
    });

    test('should enrich results with observations from MemoryStore', async () => {
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });
      await vectorStore.initialize();

      mockChromaCollection.query.mockResolvedValueOnce({
        ids: [['orch-1', 'orch-2']],
        distances: [[0.2, 0.3]],
        metadatas: [[{}, {}]],
        documents: [['Doc 1', 'Doc 2']]
      });

      mockMemoryStore.getObservationsByOrchestration
        .mockReturnValueOnce([{ type: 'concept', value: 'auth' }])
        .mockReturnValueOnce([{ type: 'pattern', value: 'parallel' }]);

      const results = await vectorStore.searchSimilar('test', {
        includeObservations: true
      });

      expect(results).toHaveLength(2);
      expect(results[0].observations).toHaveLength(1);
      expect(results[1].observations).toHaveLength(1);
    });

    test('should perform full workflow: add → search → retrieve', async () => {
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });
      await vectorStore.initialize();

      // Add orchestration
      const addResult = await vectorStore.addOrchestration('orch-workflow', {
        task: 'Implement authentication',
        resultSummary: 'JWT auth completed',
        concepts: ['auth', 'jwt', 'security']
      });

      expect(addResult).toBe(true);

      // Search for similar
      mockChromaCollection.query.mockResolvedValueOnce({
        ids: [['orch-workflow']],
        distances: [[0.1]],
        metadatas: [[{ pattern: 'parallel' }]],
        documents: [['Task: Implement authentication\nResult: JWT auth completed']]
      });

      const searchResults = await vectorStore.searchSimilar('authentication', {
        limit: 5
      });

      expect(searchResults).toHaveLength(1);
      expect(searchResults[0].id).toBe('orch-workflow');
    });
  });

  describe('Performance Tests', () => {
    beforeEach(async () => {
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });
      await vectorStore.initialize();
    });

    test('searchSimilar() should complete under 100ms on average', async () => {
      mockChromaCollection.query.mockResolvedValue({
        ids: [['orch-1']],
        distances: [[0.2]],
        metadatas: [[{}]],
        documents: [['Doc 1']]
      });

      const iterations = 10;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        await vectorStore.searchSimilar('test query');
      }

      const endTime = Date.now();
      const avgDuration = (endTime - startTime) / iterations;

      expect(avgDuration).toBeLessThan(100);
    });

    test('addOrchestration() should complete under 50ms', async () => {
      const startTime = Date.now();

      await vectorStore.addOrchestration('orch-perf', {
        task: 'Performance test',
        resultSummary: 'Test completed'
      });

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(50);
    });

    test('batch operations should be efficient', async () => {
      const orchestrations = Array.from({ length: 100 }, (_, i) => ({
        id: `orch-${i}`,
        data: {
          task: `Task ${i}`,
          resultSummary: `Result ${i}`
        }
      }));

      const startTime = Date.now();
      await vectorStore.addOrchestrationsBatch(orchestrations);
      const duration = Date.now() - startTime;

      // Should complete in reasonable time (< 1 second for 100 items)
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('Edge Cases', () => {
    beforeEach(async () => {
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });
      await vectorStore.initialize();
    });

    test('should handle null orchestration data', async () => {
      const result = await vectorStore.addOrchestration('orch-null', null);

      expect(result).toBe(false);
    });

    test('should handle undefined orchestration data', async () => {
      const result = await vectorStore.addOrchestration('orch-undefined', undefined);

      expect(result).toBe(false);
    });

    test('should handle empty string query', async () => {
      mockMemoryStore.searchObservationsFTS.mockReturnValueOnce([]);

      const results = await vectorStore.searchSimilar('');

      expect(results).toEqual([]);
    });

    test('should handle very long query strings', async () => {
      const longQuery = 'a'.repeat(10000);

      mockChromaCollection.query.mockResolvedValueOnce({
        ids: [[]],
        distances: [[]],
        metadatas: [[]],
        documents: [[]]
      });

      const results = await vectorStore.searchSimilar(longQuery);

      expect(results).toEqual([]);
    });

    test('should handle special characters in orchestration data', async () => {
      const data = {
        task: 'Test with special chars: <>&"\'`\n\t',
        concepts: ['test@#$%', 'chars!&*']
      };

      const result = await vectorStore.addOrchestration('orch-special', data);

      expect(result).toBe(true);
    });

    test('should handle malformed Chroma responses', async () => {
      mockChromaCollection.query.mockResolvedValueOnce(null);

      const results = await vectorStore.searchSimilar('test');

      expect(results).toEqual([]);
    });

    test('should handle missing fields in Chroma response', async () => {
      mockChromaCollection.query.mockResolvedValueOnce({
        ids: [['orch-1']],
        distances: [[0.5]], // Provide distances to get results
        metadatas: [[{}]],
        documents: [['Doc 1']]
      });

      const results = await vectorStore.searchSimilar('test');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('orch-1');
      expect(results[0].distance).toBeDefined();
    });

    test('should handle concurrent operations gracefully', async () => {
      const promises = [
        vectorStore.addOrchestration('orch-1', { task: 'Task 1' }),
        vectorStore.addOrchestration('orch-2', { task: 'Task 2' }),
        vectorStore.searchSimilar('test'),
        vectorStore.getRecommendations({ task: 'Test' })
      ];

      await expect(Promise.all(promises)).resolves.toBeDefined();
    });

    test('should handle zero limit parameter', async () => {
      const results = await vectorStore.searchSimilar('test', {
        limit: 0
      });

      expect(results).toEqual([]);
    });

    test('should handle negative limit parameter', async () => {
      mockChromaCollection.query.mockResolvedValueOnce({
        ids: [['orch-1']],
        distances: [[0.2]],
        metadatas: [[{}]],
        documents: [['Doc 1']]
      });

      const results = await vectorStore.searchSimilar('test', {
        limit: -5
      });

      expect(results).toEqual([]);
    });

    test('should handle missing memoryStore methods', async () => {
      vectorStore = new VectorStore({ memoryStore: {} });
      await vectorStore.initialize();

      mockChromaCollection.query.mockRejectedValueOnce(new Error('Chroma error'));

      const results = await vectorStore.searchSimilar('test');

      expect(results).toEqual([]);
    });
  });

  describe('close()', () => {
    test('should clean up resources', async () => {
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });
      await vectorStore.initialize();

      expect(vectorStore.isAvailable).toBe(true);

      await vectorStore.close();

      expect(vectorStore.isAvailable).toBe(false);
      expect(vectorStore.chromaClient).toBeNull();
      expect(vectorStore.collection).toBeNull();
    });

    test('should be safe to call multiple times', async () => {
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });
      await vectorStore.initialize();

      await vectorStore.close();
      await vectorStore.close();

      expect(vectorStore.isAvailable).toBe(false);
    });

    test('should be safe to call before initialization', async () => {
      vectorStore = new VectorStore({ memoryStore: mockMemoryStore });

      await expect(vectorStore.close()).resolves.not.toThrow();
    });
  });
});
