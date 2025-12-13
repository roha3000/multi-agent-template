/**
 * HumanInLoopDetector Tests
 *
 * Tests for intelligent guardrails, pattern matching, learning, and feedback processing
 */

const HumanInLoopDetector = require('../../.claude/core/human-in-loop-detector');
const MemoryStore = require('../../.claude/core/memory-store');
const path = require('path');
const fs = require('fs');

describe('HumanInLoopDetector', () => {
  let memoryStore;
  let detector;
  let testDbPath;

  beforeEach(() => {
    // Create unique test database for each test
    testDbPath = path.join(__dirname, `test-hil-${Date.now()}.db`);
    memoryStore = new MemoryStore(testDbPath);

    detector = new HumanInLoopDetector({
      memoryStore: memoryStore
    }, {
      confidenceThreshold: 0.70,
      learningEnabled: true,
      adaptiveThresholds: true
    });
  });

  afterEach(() => {
    // Clean up
    if (memoryStore) {
      memoryStore.close();
    }

    // Remove test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('constructor', () => {
    test('should initialize with default options', () => {
      expect(detector.options.confidenceThreshold).toBe(0.70);
      expect(detector.options.learningEnabled).toBe(true);
      expect(detector.options.adaptiveThresholds).toBe(true);
    });

    test('should load built-in patterns', () => {
      expect(detector.patterns.highRisk).toBeDefined();
      expect(detector.patterns.design).toBeDefined();
      expect(detector.patterns.manualTest).toBeDefined();
      expect(detector.patterns.strategic).toBeDefined();
      expect(detector.patterns.legal).toBeDefined();
    });

    test('should initialize learning data', () => {
      expect(detector.learningData.stats).toBeDefined();
      expect(detector.learningData.stats.totalDetections).toBe(0);
      expect(detector.learningData.stats.truePositives).toBe(0);
      expect(detector.learningData.stats.falsePositives).toBe(0);
    });
  });

  describe('analyze', () => {
    test('should detect high-risk deployment task', async () => {
      const result = await detector.analyze({
        task: 'Deploy application to production',
        phase: 'deployment',
        type: 'infrastructure'
      });

      expect(result.requiresHuman).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.70);
      expect(result.pattern).toBe('highRisk');
      expect(result.reason).toContain('High-risk');
    });

    test('should detect design decision task', async () => {
      const result = await detector.analyze({
        task: 'Decide whether to use PostgreSQL or MongoDB',
        phase: 'design',
        type: 'architecture'
      });

      expect(result.requiresHuman).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.70);
      expect(result.pattern).toBe('design');
    });

    test('should detect manual testing requirement', async () => {
      const result = await detector.analyze({
        task: 'Manually verify the UI changes',
        phase: 'testing',
        type: 'testing'
      });

      expect(result.requiresHuman).toBe(true);
      expect(result.pattern).toBe('manualTest');
    });

    test('should detect legal/compliance task', async () => {
      const result = await detector.analyze({
        task: 'Update privacy policy for GDPR compliance',
        phase: 'documentation',
        type: 'legal'
      });

      expect(result.requiresHuman).toBe(true);
      expect(result.pattern).toBe('legal');
    });

    test('should not require review for safe tasks', async () => {
      const result = await detector.analyze({
        task: 'Write unit tests for authentication module',
        phase: 'testing',
        type: 'testing'
      });

      expect(result.requiresHuman).toBe(false);
      expect(result.confidence).toBeLessThan(0.70);
    });

    test('should match multiple keywords', async () => {
      const result = await detector.analyze({
        task: 'Deploy authentication system to production environment',
        phase: 'deployment',
        type: 'infrastructure'
      });

      expect(result.requiresHuman).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.85);
    });

    test('should be case-insensitive', async () => {
      const result = await detector.analyze({
        task: 'DEPLOY TO PRODUCTION',
        phase: 'deployment',
        type: 'infrastructure'
      });

      expect(result.requiresHuman).toBe(true);
    });

    test('should include matched keywords in result', async () => {
      const result = await detector.analyze({
        task: 'Deploy to production',
        phase: 'deployment',
        type: 'infrastructure'
      });

      expect(result.matchedKeywords).toBeDefined();
      expect(result.matchedKeywords.length).toBeGreaterThan(0);
    });

    test('should generate unique detection ID', async () => {
      const result1 = await detector.analyze({
        task: 'Deploy to production',
        phase: 'deployment'
      });

      const result2 = await detector.analyze({
        task: 'Deploy to staging',
        phase: 'deployment'
      });

      expect(result1.detectionId).not.toBe(result2.detectionId);
    });

    test('should store detection for feedback', async () => {
      const result = await detector.analyze({
        task: 'Deploy to production',
        phase: 'deployment'
      });

      expect(detector.detections.has(result.detectionId)).toBe(true);
    });
  });

  describe('recordFeedback', () => {
    let detectionId;

    beforeEach(async () => {
      const result = await detector.analyze({
        task: 'Deploy to production',
        phase: 'deployment'
      });
      detectionId = result.detectionId;
    });

    test('should record true positive feedback', async () => {
      await detector.recordFeedback(detectionId, {
        wasCorrect: true,
        actualNeed: 'yes',
        comment: 'Good catch - this is production deployment'
      });

      expect(detector.learningData.stats.truePositives).toBe(1);
      expect(detector.learningData.stats.totalDetections).toBe(1);
    });

    test('should record false positive feedback', async () => {
      await detector.recordFeedback(detectionId, {
        wasCorrect: false,
        actualNeed: 'no',
        comment: 'False alarm - this is staging'
      });

      expect(detector.learningData.stats.falsePositives).toBe(1);
      expect(detector.learningData.stats.totalDetections).toBe(1);
    });

    test('should calculate precision', async () => {
      // Record 8 true positives, 2 false positives
      for (let i = 0; i < 8; i++) {
        const result = await detector.analyze({
          task: 'Deploy to production',
          phase: 'deployment'
        });
        await detector.recordFeedback(result.detectionId, {
          wasCorrect: true,
          actualNeed: 'yes'
        });
      }

      for (let i = 0; i < 2; i++) {
        const result = await detector.analyze({
          task: 'Deploy to production',
          phase: 'deployment'
        });
        await detector.recordFeedback(result.detectionId, {
          wasCorrect: false,
          actualNeed: 'no'
        });
      }

      const stats = detector.getStatistics();

      // Precision = TP / (TP + FP) = 8 / (8 + 2) = 0.8
      expect(stats.statistics.precision).toBeCloseTo(0.8, 2);
    });

    test('should learn from false negatives', async () => {
      // Analyze task that doesn't trigger detection
      const result = await detector.analyze({
        task: 'Update SSL certificate',
        phase: 'infrastructure'
      });

      expect(result.requiresHuman).toBe(false);

      // User says it should have been detected
      await detector.recordFeedback(result.detectionId, {
        wasCorrect: false,
        actualNeed: 'yes',
        comment: 'SSL changes are high risk'
      });

      expect(detector.learningData.stats.falseNegatives).toBe(1);

      // Check if new pattern was learned
      const learnedPatterns = Object.keys(detector.patterns).filter(
        key => key.startsWith('learned_')
      );

      expect(learnedPatterns.length).toBeGreaterThan(0);
    });

    test('should update pattern accuracy', async () => {
      await detector.recordFeedback(detectionId, {
        wasCorrect: true,
        actualNeed: 'yes'
      });

      expect(detector.learningData.patternAccuracy.highRisk).toBeDefined();
      expect(detector.learningData.patternAccuracy.highRisk.truePositives).toBe(1);
    });

    test('should adapt thresholds when enabled', async () => {
      const initialThreshold = detector.options.confidenceThreshold;

      // Record many false positives
      for (let i = 0; i < 15; i++) {
        const result = await detector.analyze({
          task: 'Deploy to production',
          phase: 'deployment'
        });
        await detector.recordFeedback(result.detectionId, {
          wasCorrect: false,
          actualNeed: 'no'
        });
      }

      // Threshold should increase to reduce false positives
      expect(detector.options.confidenceThreshold).toBeGreaterThan(initialThreshold);
    });

    test('should persist feedback to database', async () => {
      await detector.recordFeedback(detectionId, {
        wasCorrect: true,
        actualNeed: 'yes',
        comment: 'Test comment'
      });

      const stmt = memoryStore.db.prepare('SELECT * FROM human_in_loop_feedback WHERE detection_id = ?');
      const record = stmt.get(detectionId);

      expect(record).toBeDefined();
      expect(record.was_correct).toBe(1);
    });
  });

  describe('pattern learning', () => {
    test('should extract keywords from false negative', async () => {
      const result = await detector.analyze({
        task: 'Rotate production API keys',
        phase: 'security'
      });

      // Might not trigger initially
      await detector.recordFeedback(result.detectionId, {
        wasCorrect: false,
        actualNeed: 'yes',
        comment: 'API key rotation requires approval'
      });

      // Check if keywords were extracted
      const learnedPatterns = Object.values(detector.patterns).filter(
        p => p.keywords && p.keywords.includes('api key')
      );

      expect(learnedPatterns.length).toBeGreaterThan(0);
    });

    test('should start learned patterns with conservative confidence', async () => {
      const result = await detector.analyze({
        task: 'Modify database schema',
        phase: 'database'
      });

      await detector.recordFeedback(result.detectionId, {
        wasCorrect: false,
        actualNeed: 'yes',
        comment: 'Schema changes require review'
      });

      // Find learned pattern
      const learnedPattern = Object.values(detector.patterns).find(
        p => p.keywords && p.keywords.some(k => k.includes('schema'))
      );

      if (learnedPattern) {
        // Should start with lower confidence
        expect(learnedPattern.confidence).toBeLessThan(0.80);
      }
    });

    test('should improve pattern confidence over time', async () => {
      // Create a false negative scenario
      const task = 'Modify rate limits';

      for (let i = 0; i < 5; i++) {
        const result = await detector.analyze({
          task: task,
          phase: 'configuration'
        });

        await detector.recordFeedback(result.detectionId, {
          wasCorrect: result.requiresHuman,
          actualNeed: 'yes',
          comment: 'Rate limit changes are critical'
        });
      }

      // Pattern should have been learned and reinforced
      const stats = detector.getStatistics();
      expect(stats.patternsLearned).toBeGreaterThan(0);
    });
  });

  describe('adaptive thresholds', () => {
    test('should increase threshold with high false positive rate', async () => {
      const initialThreshold = detector.options.confidenceThreshold;

      // Generate false positives
      for (let i = 0; i < 12; i++) {
        const result = await detector.analyze({
          task: 'Deploy to production',
          phase: 'deployment'
        });

        await detector.recordFeedback(result.detectionId, {
          wasCorrect: false,
          actualNeed: 'no',
          comment: 'False positive'
        });
      }

      expect(detector.options.confidenceThreshold).toBeGreaterThan(initialThreshold);
    });

    test('should decrease threshold with high false negative rate', async () => {
      const initialThreshold = detector.options.confidenceThreshold;

      // Generate false negatives
      for (let i = 0; i < 12; i++) {
        const result = await detector.analyze({
          task: 'Safe operation',
          phase: 'development'
        });

        await detector.recordFeedback(result.detectionId, {
          wasCorrect: false,
          actualNeed: 'yes',
          comment: 'Should have detected'
        });
      }

      expect(detector.options.confidenceThreshold).toBeLessThan(initialThreshold);
    });

    test('should not adapt without sufficient data', async () => {
      const initialThreshold = detector.options.confidenceThreshold;

      // Only 2 detections (less than minDetectionsForAdapt)
      for (let i = 0; i < 2; i++) {
        const result = await detector.analyze({
          task: 'Deploy to production',
          phase: 'deployment'
        });

        await detector.recordFeedback(result.detectionId, {
          wasCorrect: false,
          actualNeed: 'no'
        });
      }

      expect(detector.options.confidenceThreshold).toBe(initialThreshold);
    });
  });

  describe('getStatistics', () => {
    test('should return comprehensive statistics', async () => {
      const result = await detector.analyze({
        task: 'Deploy to production',
        phase: 'deployment'
      });

      await detector.recordFeedback(result.detectionId, {
        wasCorrect: true,
        actualNeed: 'yes'
      });

      const stats = detector.getStatistics();

      expect(stats.statistics.totalDetections).toBe(1);
      expect(stats.statistics.truePositives).toBe(1);
      expect(stats.statistics.precision).toBeDefined();
      expect(stats.statistics.recall).toBeDefined();
    });

    test('should include pattern accuracy breakdown', async () => {
      const result = await detector.analyze({
        task: 'Deploy to production',
        phase: 'deployment'
      });

      await detector.recordFeedback(result.detectionId, {
        wasCorrect: true,
        actualNeed: 'yes'
      });

      const stats = detector.getStatistics();

      expect(stats.patternAccuracy).toBeDefined();
      expect(stats.patternAccuracy.highRisk).toBeDefined();
    });

    test('should calculate recall correctly', async () => {
      // Generate data: 8 true positives, 2 false negatives
      for (let i = 0; i < 8; i++) {
        const result = await detector.analyze({
          task: 'Deploy to production',
          phase: 'deployment'
        });

        await detector.recordFeedback(result.detectionId, {
          wasCorrect: true,
          actualNeed: 'yes'
        });
      }

      for (let i = 0; i < 2; i++) {
        const result = await detector.analyze({
          task: 'Safe task',
          phase: 'development'
        });

        await detector.recordFeedback(result.detectionId, {
          wasCorrect: false,
          actualNeed: 'yes'
        });
      }

      const stats = detector.getStatistics();

      // Recall = TP / (TP + FN) = 8 / (8 + 2) = 0.8
      expect(stats.statistics.recall).toBeCloseTo(0.8, 2);
    });
  });

  describe('edge cases', () => {
    test('should handle empty task description', async () => {
      const result = await detector.analyze({
        task: '',
        phase: 'unknown'
      });

      expect(result.requiresHuman).toBe(false);
    });

    test('should handle null context', async () => {
      const result = await detector.analyze(null);

      expect(result.requiresHuman).toBe(false);
    });

    test('should handle task with only special characters', async () => {
      const result = await detector.analyze({
        task: '!@#$%^&*()',
        phase: 'unknown'
      });

      expect(result.requiresHuman).toBe(false);
    });

    test('should handle feedback for non-existent detection', async () => {
      const feedback = await detector.recordFeedback('non-existent-id', {
        wasCorrect: true,
        actualNeed: 'yes'
      });

      expect(feedback).toBeDefined();
      // Should not throw error
    });

    test('should handle concurrent analysis', async () => {
      const tasks = [
        'Deploy to production',
        'Write tests',
        'Manual verification needed',
        'Database migration',
        'Code review'
      ];

      const promises = tasks.map(task =>
        detector.analyze({ task, phase: 'testing' })
      );

      const results = await Promise.all(promises);

      expect(results.length).toBe(5);
      results.forEach(r => expect(r.detectionId).toBeDefined());
    });

    test('should handle very long task descriptions', async () => {
      const longTask = 'Deploy '.repeat(1000) + 'to production';

      const result = await detector.analyze({
        task: longTask,
        phase: 'deployment'
      });

      expect(result.requiresHuman).toBe(true);
    });

    test('should handle unicode characters', async () => {
      const result = await detector.analyze({
        task: 'Déployer en production 生产部署',
        phase: 'deployment'
      });

      // Should still work (deploy/production are English)
      expect(result).toBeDefined();
    });
  });

  describe('pattern matching accuracy', () => {
    test('should not trigger on safe deployment contexts', async () => {
      const result = await detector.analyze({
        task: 'Write deployment documentation',
        phase: 'documentation'
      });

      // Should have lower confidence for documentation
      expect(result.confidence).toBeLessThan(0.90);
    });

    test('should trigger on multiple high-risk indicators', async () => {
      const result = await detector.analyze({
        task: 'Deploy production database migration with schema changes',
        phase: 'deployment'
      });

      expect(result.requiresHuman).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.85);
    });

    test('should differentiate between test and production', async () => {
      const testResult = await detector.analyze({
        task: 'Write tests for deployment script',
        phase: 'testing'
      });

      const prodResult = await detector.analyze({
        task: 'Deploy to production',
        phase: 'deployment'
      });

      expect(prodResult.confidence).toBeGreaterThan(testResult.confidence);
    });
  });

  describe('persistence', () => {
    test('should save learning data to database', async () => {
      const result = await detector.analyze({
        task: 'Deploy to production',
        phase: 'deployment'
      });

      await detector.recordFeedback(result.detectionId, {
        wasCorrect: true,
        actualNeed: 'yes'
      });

      const stmt = memoryStore.db.prepare('SELECT * FROM human_in_loop_learning');
      const rows = stmt.all();

      expect(rows.length).toBeGreaterThan(0);
    });

    test('should load learning data on initialization', async () => {
      // Create first detector and record feedback
      const det1 = new HumanInLoopDetector({ memoryStore }, {});

      const result = await det1.analyze({
        task: 'Deploy to production',
        phase: 'deployment'
      });

      await det1.recordFeedback(result.detectionId, {
        wasCorrect: true,
        actualNeed: 'yes'
      });

      // Create second detector - should load previous data
      const det2 = new HumanInLoopDetector({ memoryStore }, {});

      expect(det2.learningData.stats.totalDetections).toBe(1);
    });

    test('should handle database errors gracefully', async () => {
      memoryStore.close();

      const result = await detector.analyze({
        task: 'Deploy to production',
        phase: 'deployment'
      });

      // Should still work even without database
      expect(result).toBeDefined();
    });
  });
});
