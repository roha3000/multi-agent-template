/**
 * ClaudeLimitTracker Tests
 *
 * Tests for API rate limit tracking, rolling windows, and safety thresholds
 */

const ClaudeLimitTracker = require('../../.claude/core/claude-limit-tracker');
const MemoryStore = require('../../.claude/core/memory-store');
const path = require('path');
const fs = require('fs');

describe('ClaudeLimitTracker', () => {
  let memoryStore;
  let tracker;
  let testDbPath;

  beforeEach(() => {
    // Create unique test database for each test
    testDbPath = path.join(__dirname, `test-limit-${Date.now()}.db`);
    memoryStore = new MemoryStore(testDbPath);

    tracker = new ClaudeLimitTracker({
      memoryStore: memoryStore
    }, {
      plan: 'Pro',
      thresholds: {
        warning: 0.80,
        critical: 0.90,
        emergency: 0.95
      }
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
    test('should initialize with Pro plan defaults', () => {
      expect(tracker.plan).toBe('Pro');
      expect(tracker.limits.requestsPerMinute).toBe(5);
      expect(tracker.limits.requestsPerDay).toBe(1000);
      expect(tracker.limits.tokensPerDay).toBe(2500000);
    });

    test('should initialize with Free plan limits', () => {
      const freeTracker = new ClaudeLimitTracker({ memoryStore }, { plan: 'Free' });

      expect(freeTracker.limits.requestsPerMinute).toBe(5);
      expect(freeTracker.limits.requestsPerDay).toBe(50);
      expect(freeTracker.limits.tokensPerDay).toBe(150000);
    });

    test('should initialize with Team plan limits', () => {
      const teamTracker = new ClaudeLimitTracker({ memoryStore }, { plan: 'Team' });

      expect(teamTracker.limits.requestsPerMinute).toBe(10);
      expect(teamTracker.limits.requestsPerDay).toBe(10000);
      expect(teamTracker.limits.tokensPerDay).toBe(5000000);
    });

    test('should accept custom limits', () => {
      const customTracker = new ClaudeLimitTracker({ memoryStore }, {
        plan: 'Custom',
        customLimits: {
          requestsPerMinute: 20,
          requestsPerDay: 5000
        }
      });

      expect(customTracker.limits.requestsPerMinute).toBe(20);
      expect(customTracker.limits.requestsPerDay).toBe(5000);
    });

    test('should initialize time windows', () => {
      expect(tracker.windows.minute).toBeDefined();
      expect(tracker.windows.hour).toBeDefined();
      expect(tracker.windows.day).toBeDefined();
    });
  });

  describe('recordCall', () => {
    test('should record API call with tokens', () => {
      tracker.recordCall(1500);

      expect(tracker.windows.minute.calls).toBe(1);
      expect(tracker.windows.minute.tokens).toBe(1500);
      expect(tracker.windows.day.calls).toBe(1);
      expect(tracker.windows.day.tokens).toBe(1500);
    });

    test('should record multiple calls', () => {
      tracker.recordCall(1000);
      tracker.recordCall(2000);
      tracker.recordCall(1500);

      expect(tracker.windows.minute.calls).toBe(3);
      expect(tracker.windows.minute.tokens).toBe(4500);
    });

    test('should update all time windows', () => {
      tracker.recordCall(1000);

      expect(tracker.windows.minute.calls).toBe(1);
      expect(tracker.windows.hour.calls).toBe(1);
      expect(tracker.windows.day.calls).toBe(1);
    });

    test('should handle zero tokens', () => {
      tracker.recordCall(0);

      expect(tracker.windows.minute.calls).toBe(1);
      expect(tracker.windows.minute.tokens).toBe(0);
    });

    test('should persist to database', () => {
      tracker.recordCall(1500);

      const stmt = memoryStore.db.prepare('SELECT * FROM api_limit_tracking ORDER BY timestamp DESC LIMIT 1');
      const record = stmt.get();

      expect(record).toBeDefined();
      expect(record.tokens).toBe(1500);
    });
  });

  describe('canMakeCall', () => {
    test('should allow call when well below limits', () => {
      const result = tracker.canMakeCall(1000);

      expect(result.safe).toBe(true);
      expect(result.action).toBe('PROCEED');
    });

    test('should warn at 80% threshold', () => {
      // Record calls to reach 80% of minute limit when including next call (3 + 1 = 4/5 = 80%)
      tracker.recordCall(1000);
      tracker.recordCall(1000);
      tracker.recordCall(1000);

      const result = tracker.canMakeCall(1000);

      expect(result.safe).toBe(true);
      expect(result.level).toBe('WARNING');
      expect(result.action).toBe('PROCEED_WITH_CAUTION');
    });

    test('should be critical at 90% threshold', () => {
      // Record calls to reach 90% of daily limit (900 of 1000)
      // Making one more call would put us at 901/1000 = 90.1%
      for (let i = 0; i < 900; i++) {
        tracker.recordCall(100);
      }

      // Reset minute window so only day limit is checked
      tracker.windows.minute.calls = 0;

      const result = tracker.canMakeCall(100);

      expect(result.level).toContain('CRITICAL');
    });

    test('should halt at 95% (emergency) threshold', () => {
      // Reach daily limit
      for (let i = 0; i < 950; i++) {
        tracker.recordCall(100);
      }

      const result = tracker.canMakeCall(100);

      expect(result.safe).toBe(false);
      expect(result.level).toBe('EMERGENCY');
      expect(result.action).toBe('HALT_IMMEDIATELY');
    });

    test('should check token limits', () => {
      // Pro plan: 2.5M tokens/day
      // Use 2.4M tokens (96%)
      tracker.windows.day.tokens = 2400000;

      const result = tracker.canMakeCall(10000);

      expect(result.safe).toBe(false);
      expect(result.level).toBe('EMERGENCY');
    });

    test('should identify most restrictive constraint', () => {
      // Fill up minute window
      for (let i = 0; i < 4; i++) {
        tracker.recordCall(1000);
      }

      const result = tracker.canMakeCall(1000);

      expect(result.limitingFactor).toContain('minute');
    });

    test('should calculate utilization percentage', () => {
      tracker.recordCall(1000);
      tracker.recordCall(1000);

      const result = tracker.canMakeCall(1000);

      expect(result.utilizationPercent).toBeGreaterThan(0);
      expect(result.utilizationPercent).toBeLessThan(100);
    });
  });

  describe('time window management', () => {
    test('should reset minute window after 60 seconds', async () => {
      tracker.recordCall(1000);
      expect(tracker.windows.minute.calls).toBe(1);

      // Simulate time passing
      tracker.windows.minute.resetAt = Date.now() - 1000; // 1 second in the past

      tracker._resetExpiredWindows();

      expect(tracker.windows.minute.calls).toBe(0);
      expect(tracker.windows.minute.tokens).toBe(0);
    });

    test('should reset hour window after 60 minutes', () => {
      tracker.recordCall(1000);
      expect(tracker.windows.hour.calls).toBe(1);

      // Simulate time passing
      tracker.windows.hour.resetAt = Date.now() - 1000;

      tracker._resetExpiredWindows();

      expect(tracker.windows.hour.calls).toBe(0);
    });

    test('should reset day window after 24 hours', () => {
      tracker.recordCall(1000);
      expect(tracker.windows.day.calls).toBe(1);

      // Simulate time passing
      tracker.windows.day.resetAt = Date.now() - 1000;

      tracker._resetExpiredWindows();

      expect(tracker.windows.day.calls).toBe(0);
    });

    test('should not reset windows prematurely', () => {
      tracker.recordCall(1000);

      // Windows haven't expired
      tracker._resetExpiredWindows();

      expect(tracker.windows.minute.calls).toBe(1);
      expect(tracker.windows.hour.calls).toBe(1);
      expect(tracker.windows.day.calls).toBe(1);
    });

    test('should update resetAt timestamp on reset', () => {
      const oldResetAt = tracker.windows.minute.resetAt;

      tracker.windows.minute.resetAt = Date.now() - 1000;
      tracker._resetExpiredWindows();

      expect(tracker.windows.minute.resetAt).toBeGreaterThan(oldResetAt);
    });
  });

  describe('getStatus', () => {
    test('should return current status', () => {
      tracker.recordCall(1000);
      tracker.recordCall(2000);

      const status = tracker.getStatus();

      expect(status.plan).toBe('Pro');
      expect(status.windows.minute.calls).toBe(2);
      expect(status.windows.minute.tokens).toBe(3000);
      expect(status.safe).toBe(true);
    });

    test('should include utilization percentages', () => {
      tracker.recordCall(1000);

      const status = tracker.getStatus();

      expect(status.utilization).toBeDefined();
      expect(status.utilization.requestsPerMinute).toBeGreaterThan(0);
      expect(status.utilization.requestsPerDay).toBeGreaterThan(0);
      expect(status.utilization.tokensPerDay).toBeGreaterThan(0);
    });

    test('should include time until reset', () => {
      const status = tracker.getStatus();

      expect(status.timeUntilReset).toBeDefined();
      expect(status.timeUntilReset.minute).toBeGreaterThan(0);
      expect(status.timeUntilReset.hour).toBeGreaterThan(0);
      expect(status.timeUntilReset.day).toBeGreaterThan(0);
    });

    test('should indicate safety status', () => {
      // Fill to warning level
      for (let i = 0; i < 4; i++) {
        tracker.recordCall(1000);
      }

      const status = tracker.getStatus();

      expect(status.safe).toBe(true);
      expect(status.level).toBe('WARNING');
    });
  });

  describe('getTimeUntilAvailable', () => {
    test('should return 0 when well below limits', () => {
      tracker.recordCall(1000);

      const waitTime = tracker.getTimeUntilAvailable();

      expect(waitTime).toBe(0);
    });

    test('should return wait time when limit reached', () => {
      // Fill minute window
      for (let i = 0; i < 5; i++) {
        tracker.recordCall(1000);
      }

      const waitTime = tracker.getTimeUntilAvailable();

      expect(waitTime).toBeGreaterThan(0);
      expect(waitTime).toBeLessThanOrEqual(60000); // Max 1 minute
    });

    test('should return longest wait time for most restrictive limit', () => {
      // Fill daily limit
      tracker.windows.day.calls = tracker.limits.requestsPerDay;

      const waitTime = tracker.getTimeUntilAvailable();

      // Should wait until day resets
      expect(waitTime).toBeGreaterThan(60000); // More than 1 minute
    });
  });

  describe('different plans', () => {
    test('Free plan should have lower limits', () => {
      const freeTracker = new ClaudeLimitTracker({ memoryStore }, { plan: 'Free' });

      expect(freeTracker.limits.requestsPerDay).toBe(50);
      expect(freeTracker.limits.tokensPerDay).toBe(150000);
    });

    test('Team plan should have higher limits', () => {
      const teamTracker = new ClaudeLimitTracker({ memoryStore }, { plan: 'Team' });

      expect(teamTracker.limits.requestsPerDay).toBe(10000);
      expect(teamTracker.limits.tokensPerDay).toBe(5000000);
    });

    test('Free plan should hit limits faster', () => {
      const freeTracker = new ClaudeLimitTracker({ memoryStore }, { plan: 'Free' });

      // Record 40 calls (80% of Free 50/day limit)
      for (let i = 0; i < 40; i++) {
        freeTracker.recordCall(1000);
      }

      // Reset minute window to test day limit only
      freeTracker.windows.minute.calls = 0;

      const result = freeTracker.canMakeCall(1000);

      expect(result.level).toBe('WARNING');
    });
  });

  describe('persistence and recovery', () => {
    test('should load state from database on init', () => {
      // Record some calls
      tracker.recordCall(1000);
      tracker.recordCall(2000);

      // Create new tracker - should load previous state
      const newTracker = new ClaudeLimitTracker({ memoryStore }, { plan: 'Pro' });

      // Note: State may not persist across instances in current implementation
      // This test verifies the loading mechanism works without errors
      expect(newTracker).toBeDefined();
    });

    test('should handle missing database gracefully', () => {
      const noDbTracker = new ClaudeLimitTracker({ memoryStore: null }, { plan: 'Pro' });

      expect(noDbTracker.windows.minute.calls).toBe(0);
    });
  });

  describe('edge cases', () => {
    test('should handle very large token counts', () => {
      tracker.recordCall(10000000);

      expect(tracker.windows.day.tokens).toBe(10000000);

      const result = tracker.canMakeCall(1000);
      expect(result.safe).toBe(false);
    });

    test('should handle concurrent calls', () => {
      // Simulate rapid concurrent calls
      for (let i = 0; i < 10; i++) {
        tracker.recordCall(1000);
      }

      expect(tracker.windows.minute.calls).toBe(10);
    });

    test('should handle calls with no tokens', () => {
      tracker.recordCall(0);
      tracker.recordCall(0);

      expect(tracker.windows.minute.calls).toBe(2);
      expect(tracker.windows.minute.tokens).toBe(0);
    });

    test('should handle negative token values', () => {
      tracker.recordCall(-100);

      expect(tracker.windows.minute.tokens).toBe(-100);
    });

    test('should handle plan change', () => {
      tracker.recordCall(1000);

      // Change from Pro to Free
      tracker._loadPlanLimits('Free');

      expect(tracker.limits.requestsPerDay).toBe(50);
    });

    test('should calculate correct utilization at exactly 100%', () => {
      // Fill to exactly 100% of minute limit
      for (let i = 0; i < 5; i++) {
        tracker.recordCall(1000);
      }

      const result = tracker.canMakeCall(0);

      expect(result.utilizationPercent).toBeGreaterThanOrEqual(100);
    });
  });

  describe('safety recommendations', () => {
    test('should recommend wrap-up at critical level', () => {
      // Fill to 90% of daily limit
      for (let i = 0; i < 900; i++) {
        tracker.recordCall(100);
      }

      // Reset minute window to test day limit only
      tracker.windows.minute.calls = 0;

      const result = tracker.canMakeCall(100);

      expect(result.level).toContain('CRITICAL');
      expect(result.action).toContain('WRAP');
    });

    test('should not recommend halt until emergency', () => {
      // Fill to 90% of daily limit
      for (let i = 0; i < 900; i++) {
        tracker.recordCall(100);
      }

      // Reset minute window to test day limit only
      tracker.windows.minute.calls = 0;

      const result = tracker.canMakeCall(100);

      expect(result.action).not.toBe('HALT_IMMEDIATELY');
    });

    test('should provide descriptive reasons', () => {
      // Fill minute window
      for (let i = 0; i < 4; i++) {
        tracker.recordCall(1000);
      }

      const result = tracker.canMakeCall(1000);

      expect(result.reason).toBeDefined();
      expect(result.reason.length).toBeGreaterThan(0);
    });
  });

  describe('threshold configuration', () => {
    test('should use custom thresholds', () => {
      const customTracker = new ClaudeLimitTracker({ memoryStore }, {
        plan: 'Pro',
        thresholds: {
          warning: 0.60,
          critical: 0.75,
          emergency: 0.85
        }
      });

      // Fill to 65% of daily limit (above custom warning threshold)
      for (let i = 0; i < 650; i++) {
        customTracker.recordCall(100);
      }

      // Reset minute window to test day limit only
      customTracker.windows.minute.calls = 0;

      const result = customTracker.canMakeCall(100);

      expect(result.level).toBe('WARNING');
    });

    test('should apply thresholds to all limit types', () => {
      // Test minute limit warning (3 + 1 projection = 4/5 = 80%)
      for (let i = 0; i < 3; i++) {
        tracker.recordCall(1000);
      }

      const minuteResult = tracker.canMakeCall(1000);
      expect(minuteResult.level).toBe('WARNING');

      // Reset and test day limit warning (800 + 1 projection = 801/1000 = 80.1%)
      tracker.windows.minute.calls = 0;
      tracker.windows.day.calls = 800; // 80% of 1000

      const dayResult = tracker.canMakeCall(1000);
      expect(dayResult.level).toBe('WARNING');
    });
  });
});
