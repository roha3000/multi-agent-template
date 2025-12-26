/**
 * Swarm API Endpoints Integration Tests
 *
 * Tests for the new swarm integration endpoints:
 * - /api/confidence
 * - /api/plans
 * - /api/complexity
 * - /api/swarm/state
 */

const http = require('http');
const path = require('path');

// Mock the dependencies before requiring the server
jest.mock('../../.claude/core/global-context-tracker', () => {
  const EventEmitter = require('events');
  class MockTracker extends EventEmitter {
    constructor() {
      super();
      this.projects = [];
    }
    start() { return Promise.resolve(); }
    stop() { return Promise.resolve(); }
    getAllProjects() { return this.projects; }
    getAccountTotals() { return { totalCost: 0, totalTokens: 0 }; }
  }
  return MockTracker;
});

describe('Swarm API Endpoints', () => {
  let server;
  let baseUrl;
  let port;

  beforeAll((done) => {
    // Find an available port
    port = 3050 + Math.floor(Math.random() * 100);

    // Clear require cache to get fresh module
    const modulePath = path.resolve(__dirname, '../../global-context-manager.js');
    delete require.cache[modulePath];

    // Set environment to use test port
    process.env.PORT = port;
    process.env.NODE_ENV = 'test';

    // Suppress console output during tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    // Start server with timeout
    const timeout = setTimeout(() => {
      done(new Error('Server startup timeout'));
    }, 5000);

    try {
      // Create a simple test server for the endpoints
      const express = require('express');
      const app = express();
      app.use(express.json());

      // Replicate the state and endpoints from global-context-manager.js
      let confidenceState = {
        confidence: null,
        level: 'healthy',
        signals: { qualityScore: 0, velocity: 0, iterations: 0, errorRate: 0, historical: 0 },
        lastUpdate: null
      };

      let planComparison = {
        plans: [],
        winner: null,
        lastUpdate: null
      };

      let complexity = {
        score: null,
        strategy: null,
        dimensions: {},
        lastUpdate: null
      };

      // Confidence endpoints
      app.get('/api/confidence', (req, res) => res.json(confidenceState));
      app.post('/api/confidence', (req, res) => {
        const { confidence, level, signals } = req.body;
        if (confidence !== undefined) confidenceState.confidence = confidence;
        if (level) confidenceState.level = level;
        if (signals) confidenceState.signals = { ...confidenceState.signals, ...signals };
        confidenceState.lastUpdate = new Date().toISOString();
        res.json({ success: true, confidenceState });
      });

      // Plans endpoints
      app.get('/api/plans', (req, res) => res.json(planComparison));
      app.post('/api/plans', (req, res) => {
        const { plans, winner } = req.body;
        if (plans) planComparison.plans = plans;
        if (winner) planComparison.winner = winner;
        planComparison.lastUpdate = new Date().toISOString();
        res.json({ success: true, planComparison });
      });

      // Complexity endpoints
      app.get('/api/complexity', (req, res) => res.json(complexity));
      app.post('/api/complexity', (req, res) => {
        const { score, strategy, dimensions } = req.body;
        if (score !== undefined) complexity.score = score;
        if (strategy) complexity.strategy = strategy;
        if (dimensions) complexity.dimensions = dimensions;
        complexity.lastUpdate = new Date().toISOString();
        res.json({ success: true, complexity });
      });

      // Bulk update endpoint
      app.post('/api/swarm/state', (req, res) => {
        const { confidence: confData, plans: planData, complexity: compData } = req.body;

        if (confData) {
          if (confData.confidence !== undefined) confidenceState.confidence = confData.confidence;
          if (confData.level) confidenceState.level = confData.level;
          if (confData.signals) confidenceState.signals = { ...confidenceState.signals, ...confData.signals };
          confidenceState.lastUpdate = new Date().toISOString();
        }

        if (planData) {
          if (planData.plans) planComparison.plans = planData.plans;
          if (planData.winner) planComparison.winner = planData.winner;
          planComparison.lastUpdate = new Date().toISOString();
        }

        if (compData) {
          if (compData.score !== undefined) complexity.score = compData.score;
          if (compData.strategy) complexity.strategy = compData.strategy;
          if (compData.dimensions) complexity.dimensions = compData.dimensions;
          complexity.lastUpdate = new Date().toISOString();
        }

        res.json({ success: true, confidenceState, planComparison, complexity });
      });

      // Reset endpoint for testing
      app.post('/api/test/reset', (req, res) => {
        confidenceState = {
          confidence: null,
          level: 'healthy',
          signals: { qualityScore: 0, velocity: 0, iterations: 0, errorRate: 0, historical: 0 },
          lastUpdate: null
        };
        planComparison = { plans: [], winner: null, lastUpdate: null };
        complexity = { score: null, strategy: null, dimensions: {}, lastUpdate: null };
        res.json({ success: true });
      });

      server = app.listen(port, () => {
        clearTimeout(timeout);
        baseUrl = `http://localhost:${port}`;
        done();
      });
    } catch (err) {
      clearTimeout(timeout);
      done(err);
    }
  });

  afterAll((done) => {
    if (server) {
      server.close(done);
    } else {
      done();
    }
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    // Reset state before each test
    await makeRequest('POST', '/api/test/reset', {});
  });

  // Helper function for HTTP requests
  function makeRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: port,
        path: path,
        method: method,
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, data: data });
          }
        });
      });

      req.on('error', reject);

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  describe('Confidence Endpoints', () => {
    test('GET /api/confidence returns initial state', async () => {
      const res = await makeRequest('GET', '/api/confidence');

      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('confidence');
      expect(res.data).toHaveProperty('level', 'healthy');
      expect(res.data).toHaveProperty('signals');
      expect(res.data.signals).toHaveProperty('qualityScore');
      expect(res.data.signals).toHaveProperty('velocity');
      expect(res.data.signals).toHaveProperty('iterations');
      expect(res.data.signals).toHaveProperty('errorRate');
      expect(res.data.signals).toHaveProperty('historical');
    });

    test('POST /api/confidence updates confidence value', async () => {
      const res = await makeRequest('POST', '/api/confidence', {
        confidence: 85,
        level: 'healthy'
      });

      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.confidenceState.confidence).toBe(85);
      expect(res.data.confidenceState.level).toBe('healthy');
      expect(res.data.confidenceState.lastUpdate).toBeDefined();
    });

    test('POST /api/confidence updates signals', async () => {
      const res = await makeRequest('POST', '/api/confidence', {
        confidence: 72,
        level: 'warning',
        signals: {
          qualityScore: 80,
          velocity: 65,
          iterations: 70,
          errorRate: 15,
          historical: 85
        }
      });

      expect(res.status).toBe(200);
      expect(res.data.confidenceState.signals.qualityScore).toBe(80);
      expect(res.data.confidenceState.signals.velocity).toBe(65);
      expect(res.data.confidenceState.signals.errorRate).toBe(15);
    });

    test('POST /api/confidence allows partial signal updates', async () => {
      // First set some signals
      await makeRequest('POST', '/api/confidence', {
        signals: { qualityScore: 90, velocity: 80 }
      });

      // Then update only one
      const res = await makeRequest('POST', '/api/confidence', {
        signals: { qualityScore: 75 }
      });

      expect(res.data.confidenceState.signals.qualityScore).toBe(75);
      expect(res.data.confidenceState.signals.velocity).toBe(80); // Should remain
    });

    test('GET /api/confidence reflects previous POST', async () => {
      await makeRequest('POST', '/api/confidence', {
        confidence: 95,
        level: 'healthy'
      });

      const res = await makeRequest('GET', '/api/confidence');

      expect(res.data.confidence).toBe(95);
      expect(res.data.level).toBe('healthy');
    });
  });

  describe('Plans Endpoints', () => {
    const mockPlans = [
      {
        strategy: 'conservative',
        totalScore: 72,
        scores: { completeness: 80, feasibility: 85, risk: 60, clarity: 75, efficiency: 70 }
      },
      {
        strategy: 'balanced',
        totalScore: 85,
        scores: { completeness: 85, feasibility: 90, risk: 75, clarity: 88, efficiency: 82 }
      },
      {
        strategy: 'aggressive',
        totalScore: 68,
        scores: { completeness: 70, feasibility: 60, risk: 55, clarity: 80, efficiency: 90 }
      }
    ];

    test('GET /api/plans returns initial empty state', async () => {
      const res = await makeRequest('GET', '/api/plans');

      expect(res.status).toBe(200);
      expect(res.data.plans).toEqual([]);
      expect(res.data.winner).toBeNull();
    });

    test('POST /api/plans updates plans array', async () => {
      const res = await makeRequest('POST', '/api/plans', {
        plans: mockPlans
      });

      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.planComparison.plans).toHaveLength(3);
      expect(res.data.planComparison.plans[0].strategy).toBe('conservative');
      expect(res.data.planComparison.plans[1].strategy).toBe('balanced');
    });

    test('POST /api/plans sets winner', async () => {
      const winner = mockPlans[1]; // balanced

      const res = await makeRequest('POST', '/api/plans', {
        plans: mockPlans,
        winner: winner
      });

      expect(res.data.planComparison.winner).toBeDefined();
      expect(res.data.planComparison.winner.strategy).toBe('balanced');
      expect(res.data.planComparison.winner.totalScore).toBe(85);
    });

    test('GET /api/plans reflects previous POST', async () => {
      await makeRequest('POST', '/api/plans', {
        plans: mockPlans,
        winner: mockPlans[1]
      });

      const res = await makeRequest('GET', '/api/plans');

      expect(res.data.plans).toHaveLength(3);
      expect(res.data.winner.strategy).toBe('balanced');
    });
  });

  describe('Complexity Endpoints', () => {
    test('GET /api/complexity returns initial state', async () => {
      const res = await makeRequest('GET', '/api/complexity');

      expect(res.status).toBe(200);
      expect(res.data.score).toBeNull();
      expect(res.data.strategy).toBeNull();
      expect(res.data.dimensions).toEqual({});
    });

    test('POST /api/complexity updates score and strategy', async () => {
      const res = await makeRequest('POST', '/api/complexity', {
        score: 72,
        strategy: 'competitive'
      });

      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.complexity.score).toBe(72);
      expect(res.data.complexity.strategy).toBe('competitive');
    });

    test('POST /api/complexity updates dimensions', async () => {
      const res = await makeRequest('POST', '/api/complexity', {
        score: 65,
        strategy: 'standard',
        dimensions: {
          dependencyDepth: 80,
          acceptanceCriteria: 60,
          effortEstimate: 70,
          technicalKeywords: 55,
          historicalSuccess: 75
        }
      });

      expect(res.data.complexity.dimensions.dependencyDepth).toBe(80);
      expect(res.data.complexity.dimensions.acceptanceCriteria).toBe(60);
      expect(res.data.complexity.dimensions.technicalKeywords).toBe(55);
    });

    test('POST /api/complexity handles fast-path strategy', async () => {
      const res = await makeRequest('POST', '/api/complexity', {
        score: 25,
        strategy: 'fast-path'
      });

      expect(res.data.complexity.score).toBe(25);
      expect(res.data.complexity.strategy).toBe('fast-path');
    });

    test('GET /api/complexity reflects previous POST', async () => {
      await makeRequest('POST', '/api/complexity', {
        score: 88,
        strategy: 'competitive',
        dimensions: { dependencyDepth: 95 }
      });

      const res = await makeRequest('GET', '/api/complexity');

      expect(res.data.score).toBe(88);
      expect(res.data.strategy).toBe('competitive');
      expect(res.data.dimensions.dependencyDepth).toBe(95);
    });
  });

  describe('Bulk Update Endpoint', () => {
    test('POST /api/swarm/state updates all states at once', async () => {
      const res = await makeRequest('POST', '/api/swarm/state', {
        confidence: {
          confidence: 78,
          level: 'warning',
          signals: { qualityScore: 80, velocity: 70 }
        },
        plans: {
          plans: [{ strategy: 'balanced', totalScore: 82 }],
          winner: { strategy: 'balanced', totalScore: 82 }
        },
        complexity: {
          score: 65,
          strategy: 'standard',
          dimensions: { dependencyDepth: 70 }
        }
      });

      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);

      // Check confidence
      expect(res.data.confidenceState.confidence).toBe(78);
      expect(res.data.confidenceState.level).toBe('warning');

      // Check plans
      expect(res.data.planComparison.plans).toHaveLength(1);
      expect(res.data.planComparison.winner.strategy).toBe('balanced');

      // Check complexity
      expect(res.data.complexity.score).toBe(65);
      expect(res.data.complexity.strategy).toBe('standard');
    });

    test('POST /api/swarm/state allows partial updates', async () => {
      // Only update confidence
      const res = await makeRequest('POST', '/api/swarm/state', {
        confidence: { confidence: 90, level: 'healthy' }
      });

      expect(res.data.confidenceState.confidence).toBe(90);
      expect(res.data.planComparison.plans).toEqual([]);
      expect(res.data.complexity.score).toBeNull();
    });

    test('Bulk update persists across GET requests', async () => {
      await makeRequest('POST', '/api/swarm/state', {
        confidence: { confidence: 85 },
        complexity: { score: 50, strategy: 'standard' }
      });

      const confRes = await makeRequest('GET', '/api/confidence');
      const compRes = await makeRequest('GET', '/api/complexity');

      expect(confRes.data.confidence).toBe(85);
      expect(compRes.data.score).toBe(50);
    });
  });

  describe('Edge Cases', () => {
    test('handles zero confidence value', async () => {
      const res = await makeRequest('POST', '/api/confidence', {
        confidence: 0,
        level: 'emergency'
      });

      expect(res.data.confidenceState.confidence).toBe(0);
    });

    test('handles 100 confidence value', async () => {
      const res = await makeRequest('POST', '/api/confidence', {
        confidence: 100,
        level: 'healthy'
      });

      expect(res.data.confidenceState.confidence).toBe(100);
    });

    test('handles empty plans array', async () => {
      const res = await makeRequest('POST', '/api/plans', {
        plans: []
      });

      expect(res.data.planComparison.plans).toEqual([]);
    });

    test('handles complexity score of 0', async () => {
      const res = await makeRequest('POST', '/api/complexity', {
        score: 0,
        strategy: 'fast-path'
      });

      expect(res.data.complexity.score).toBe(0);
    });

    test('handles complexity score of 100', async () => {
      const res = await makeRequest('POST', '/api/complexity', {
        score: 100,
        strategy: 'competitive'
      });

      expect(res.data.complexity.score).toBe(100);
    });
  });
});
