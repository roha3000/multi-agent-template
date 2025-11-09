/**
 * UsageTracker Tests
 *
 * Tests for token usage tracking, budget monitoring, and cost analytics
 */

const UsageTracker = require('../../.claude/core/usage-tracker');
const MemoryStore = require('../../.claude/core/memory-store');
const path = require('path');
const fs = require('fs');

describe('UsageTracker', () => {
  let memoryStore;
  let tracker;
  let testDbPath;

  beforeEach(() => {
    // Create unique test database for each test
    testDbPath = path.join(__dirname, `test-usage-${Date.now()}.db`);
    memoryStore = new MemoryStore(testDbPath);
    tracker = new UsageTracker(memoryStore);
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
      expect(tracker.options.enableTracking).toBe(true);
      expect(tracker.options.enableBudgetAlerts).toBe(false);
      expect(tracker.sessionUsage).toBeDefined();
      expect(tracker.sessionUsage.totalTokens).toBe(0);
      expect(tracker.sessionUsage.totalCost).toBe(0);
    });

    test('should accept custom options', () => {
      const customTracker = new UsageTracker(memoryStore, {
        enableBudgetAlerts: true,
        dailyBudgetUSD: 50.00,
        monthlyBudgetUSD: 1000.00
      });

      expect(customTracker.options.enableBudgetAlerts).toBe(true);
      expect(customTracker.options.dailyBudgetUSD).toBe(50.00);
      expect(customTracker.options.monthlyBudgetUSD).toBe(1000.00);
    });

    test('should throw error if memoryStore not provided', () => {
      expect(() => new UsageTracker(null)).toThrow('MemoryStore is required');
    });

    test('should initialize cost calculator', () => {
      expect(tracker.costCalculator).toBeDefined();
      expect(tracker.costCalculator.calculateCost).toBeDefined();
    });
  });

  describe('recordUsage', () => {
    test('should record basic usage data', async () => {
      const usageId = await tracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 500
      });

      expect(usageId).toBeTruthy();
      expect(typeof usageId).toBe('string');

      // Verify it was stored in database
      const stmt = memoryStore.db.prepare('SELECT * FROM token_usage WHERE id = ?');
      const record = stmt.get(usageId);

      expect(record).toBeDefined();
      expect(record.orchestration_id).toBe('orch-1');
      expect(record.model).toBe('claude-sonnet-4.5');
      expect(record.input_tokens).toBe(1000);
      expect(record.output_tokens).toBe(500);
      expect(record.total_cost).toBeGreaterThan(0);
    });

    test('should calculate cost correctly', async () => {
      const usageId = await tracker.recordUsage({
        orchestrationId: 'orch-2',
        model: 'claude-sonnet-4.5',
        inputTokens: 1_000_000,
        outputTokens: 500_000
      });

      const stmt = memoryStore.db.prepare('SELECT * FROM token_usage WHERE id = ?');
      const record = stmt.get(usageId);

      // $3.00 for 1M input + $7.50 for 500k output = $10.50
      expect(record.total_cost).toBeCloseTo(10.50, 2);
      expect(record.input_cost).toBeCloseTo(3.00, 2);
      expect(record.output_cost).toBeCloseTo(7.50, 2);
    });

    test('should handle cache tokens', async () => {
      const usageId = await tracker.recordUsage({
        orchestrationId: 'orch-3',
        model: 'claude-sonnet-4.5',
        inputTokens: 100_000,
        outputTokens: 50_000,
        cacheCreationTokens: 50_000,
        cacheReadTokens: 500_000
      });

      const stmt = memoryStore.db.prepare('SELECT * FROM token_usage WHERE id = ?');
      const record = stmt.get(usageId);

      expect(record.cache_creation_tokens).toBe(50_000);
      expect(record.cache_read_tokens).toBe(500_000);
      expect(record.cache_savings).toBeGreaterThan(0);
      expect(record.cache_savings_percent).toBeGreaterThan(0);
    });

    test('should update session cache', async () => {
      await tracker.recordUsage({
        orchestrationId: 'orch-4',
        model: 'claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 500
      });

      const session = tracker.getSessionUsage();

      expect(session.totalTokens).toBe(1500);
      expect(session.orchestrationCount).toBe(1);
      expect(session.totalCost).toBeGreaterThan(0);
    });

    test('should track per-agent usage', async () => {
      const usageId = await tracker.recordUsage({
        orchestrationId: 'orch-5',
        model: 'claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 500,
        agentId: 'agent-1'
      });

      const stmt = memoryStore.db.prepare('SELECT * FROM token_usage WHERE id = ?');
      const record = stmt.get(usageId);

      expect(record.agent_id).toBe('agent-1');
    });

    test('should track pattern and session', async () => {
      const usageId = await tracker.recordUsage({
        orchestrationId: 'orch-6',
        model: 'claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 500,
        pattern: 'parallel',
        workSessionId: 'session-123'
      });

      const stmt = memoryStore.db.prepare('SELECT * FROM token_usage WHERE id = ?');
      const record = stmt.get(usageId);

      expect(record.pattern).toBe('parallel');
      expect(record.work_session_id).toBe('session-123');
    });

    test('should handle missing required fields', async () => {
      const usageId = await tracker.recordUsage({
        // Missing orchestrationId
        model: 'claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 500
      });

      expect(usageId).toBeNull();
    });

    test('should not throw on database errors', async () => {
      // Close database to simulate error
      memoryStore.close();

      const usageId = await tracker.recordUsage({
        orchestrationId: 'orch-7',
        model: 'claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 500
      });

      expect(usageId).toBeNull();
    });

    test('should return null when tracking disabled', async () => {
      const disabledTracker = new UsageTracker(memoryStore, {
        enableTracking: false
      });

      const usageId = await disabledTracker.recordUsage({
        orchestrationId: 'orch-8',
        model: 'claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 500
      });

      expect(usageId).toBeNull();
    });

    test('should handle unknown model gracefully', async () => {
      const usageId = await tracker.recordUsage({
        orchestrationId: 'orch-9',
        model: 'unknown-model',
        inputTokens: 1000,
        outputTokens: 500
      });

      expect(usageId).toBeTruthy();

      const stmt = memoryStore.db.prepare('SELECT * FROM token_usage WHERE id = ?');
      const record = stmt.get(usageId);

      expect(record.total_cost).toBe(0);
    });
  });

  describe('getUsageSummary', () => {
    beforeEach(async () => {
      // Add some test data
      await tracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 500,
        pattern: 'parallel'
      });

      await tracker.recordUsage({
        orchestrationId: 'orch-2',
        model: 'gpt-4o',
        inputTokens: 2000,
        outputTokens: 1000,
        pattern: 'consensus'
      });
    });

    test('should aggregate usage for day', async () => {
      const summary = await tracker.getUsageSummary('day');

      expect(summary.period).toBe('day');
      expect(summary.orchestrationCount).toBe(2);
      expect(summary.totalTokens).toBeGreaterThan(0);
      expect(summary.totalCost).toBeGreaterThan(0);
    });

    test('should filter by model', async () => {
      const summary = await tracker.getUsageSummary('day', {
        model: 'claude-sonnet-4.5'
      });

      expect(summary.orchestrationCount).toBe(1);
    });

    test('should filter by pattern', async () => {
      const summary = await tracker.getUsageSummary('day', {
        pattern: 'parallel'
      });

      expect(summary.orchestrationCount).toBe(1);
    });

    test('should handle custom date range', async () => {
      const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const endDate = new Date();

      const summary = await tracker.getUsageSummary('day', {
        startDate,
        endDate
      });

      expect(summary.startDate).toEqual(startDate);
      expect(summary.endDate).toEqual(endDate);
    });

    test('should include model breakdown', async () => {
      const summary = await tracker.getUsageSummary('day');

      expect(summary.modelBreakdown).toBeDefined();
      expect(Array.isArray(summary.modelBreakdown)).toBe(true);
    });

    test('should return empty summary on error', async () => {
      memoryStore.close();

      const summary = await tracker.getUsageSummary('day');

      expect(summary.orchestrationCount).toBe(0);
      expect(summary.totalTokens).toBe(0);
      expect(summary.totalCost).toBe(0);
    });
  });

  describe('getSessionUsage', () => {
    test('should return session usage', () => {
      const session = tracker.getSessionUsage();

      expect(session).toHaveProperty('totalTokens');
      expect(session).toHaveProperty('totalCost');
      expect(session).toHaveProperty('orchestrationCount');
      expect(session).toHaveProperty('duration');
    });

    test('should track multiple orchestrations', async () => {
      await tracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 500
      });

      await tracker.recordUsage({
        orchestrationId: 'orch-2',
        model: 'claude-sonnet-4.5',
        inputTokens: 2000,
        outputTokens: 1000
      });

      const session = tracker.getSessionUsage();

      expect(session.orchestrationCount).toBe(2);
      expect(session.totalTokens).toBe(4500);
    });

    test('should track model breakdown', async () => {
      await tracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 500
      });

      await tracker.recordUsage({
        orchestrationId: 'orch-2',
        model: 'gpt-4o',
        inputTokens: 1000,
        outputTokens: 500
      });

      const session = tracker.getSessionUsage();

      expect(session.modelBreakdown['claude-sonnet-4.5']).toBeDefined();
      expect(session.modelBreakdown['gpt-4o']).toBeDefined();
    });
  });

  describe('checkBudgetStatus', () => {
    test('should return status when no budget set', async () => {
      const status = await tracker.checkBudgetStatus('day');

      expect(status.limit).toBeNull();
      expect(status.exceeded).toBe(false);
      expect(status.warning).toBe(false);
    });

    test('should detect budget exceeded', async () => {
      const budgetTracker = new UsageTracker(memoryStore, {
        dailyBudgetUSD: 1.00
      });

      // Record usage over budget
      await budgetTracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4.5',
        inputTokens: 1_000_000,
        outputTokens: 500_000
      });

      const status = await budgetTracker.checkBudgetStatus('day');

      expect(status.limit).toBe(1.00);
      expect(status.exceeded).toBe(true);
      expect(status.percentUsed).toBeGreaterThan(100);
    });

    test('should detect budget warning', async () => {
      const budgetTracker = new UsageTracker(memoryStore, {
        dailyBudgetUSD: 10.00,
        dailyWarningThreshold: 0.8
      });

      // Record usage at 85% of budget
      await budgetTracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4.5',
        inputTokens: 800_000,
        outputTokens: 500_000
      });

      const status = await budgetTracker.checkBudgetStatus('day');

      expect(status.warning).toBe(true);
      expect(status.exceeded).toBe(false);
    });

    test('should calculate remaining budget', async () => {
      const budgetTracker = new UsageTracker(memoryStore, {
        dailyBudgetUSD: 100.00
      });

      await budgetTracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4.5',
        inputTokens: 1_000_000,
        outputTokens: 500_000
      });

      const status = await budgetTracker.checkBudgetStatus('day');

      expect(status.remaining).toBeLessThan(100.00);
      expect(status.remaining).toBeGreaterThan(0);
    });

    test('should project monthly cost', async () => {
      const budgetTracker = new UsageTracker(memoryStore, {
        monthlyBudgetUSD: 1000.00
      });

      await budgetTracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4.5',
        inputTokens: 1_000_000,
        outputTokens: 500_000
      });

      const status = await budgetTracker.checkBudgetStatus('month');

      expect(status.projection).toBeDefined();
      expect(status.projection).toBeGreaterThan(0);
    });
  });

  describe('getCostByModel', () => {
    beforeEach(async () => {
      await tracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4.5',
        inputTokens: 1_000_000,
        outputTokens: 500_000
      });

      await tracker.recordUsage({
        orchestrationId: 'orch-2',
        model: 'claude-sonnet-4.5',
        inputTokens: 500_000,
        outputTokens: 250_000
      });

      await tracker.recordUsage({
        orchestrationId: 'orch-3',
        model: 'gpt-4o',
        inputTokens: 1_000_000,
        outputTokens: 500_000
      });
    });

    test('should aggregate by model', async () => {
      const breakdown = await tracker.getCostByModel();

      expect(breakdown.length).toBe(2);
      expect(breakdown.find(m => m.model === 'claude-sonnet-4.5')).toBeDefined();
      expect(breakdown.find(m => m.model === 'gpt-4o')).toBeDefined();
    });

    test('should calculate total cost per model', async () => {
      const breakdown = await tracker.getCostByModel();

      const sonnet = breakdown.find(m => m.model === 'claude-sonnet-4.5');

      expect(sonnet.orchestrationCount).toBe(2);
      expect(sonnet.totalCost).toBeGreaterThan(0);
    });

    test('should sort by cost descending by default', async () => {
      const breakdown = await tracker.getCostByModel();

      // Should be sorted by cost (highest first)
      if (breakdown.length > 1) {
        expect(breakdown[0].totalCost).toBeGreaterThanOrEqual(breakdown[1].totalCost);
      }
    });

    test('should filter by pattern', async () => {
      await tracker.recordUsage({
        orchestrationId: 'orch-4',
        model: 'claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 500,
        pattern: 'parallel'
      });

      const breakdown = await tracker.getCostByModel({
        pattern: 'parallel'
      });

      expect(breakdown.length).toBeGreaterThan(0);
    });

    test('should limit results', async () => {
      const breakdown = await tracker.getCostByModel({
        limit: 1
      });

      expect(breakdown.length).toBe(1);
    });

    test('should return empty array on error', async () => {
      memoryStore.close();

      const breakdown = await tracker.getCostByModel();

      expect(breakdown).toEqual([]);
    });
  });

  describe('cleanupOldRecords', () => {
    test('should delete old records', async () => {
      // Insert old record
      const oldTimestamp = Date.now() - (100 * 24 * 60 * 60 * 1000); // 100 days ago
      memoryStore.db.prepare(`
        INSERT INTO token_usage (id, orchestration_id, timestamp, model, input_tokens, output_tokens, total_tokens, total_cost)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('old-1', 'orch-old', oldTimestamp, 'claude-sonnet-4.5', 1000, 500, 1500, 0.05);

      // Insert recent record
      await tracker.recordUsage({
        orchestrationId: 'orch-new',
        model: 'claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 500
      });

      const deletedCount = await tracker.cleanupOldRecords(90);

      expect(deletedCount).toBe(1);

      // Verify old record deleted
      const oldRecord = memoryStore.db.prepare('SELECT * FROM token_usage WHERE id = ?').get('old-1');
      expect(oldRecord).toBeUndefined();

      // Verify new record still exists
      const newRecord = memoryStore.db.prepare('SELECT * FROM token_usage WHERE orchestration_id = ?').get('orch-new');
      expect(newRecord).toBeDefined();
    });

    test('should return 0 if no records deleted', async () => {
      await tracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4.5',
        inputTokens: 1000,
        outputTokens: 500
      });

      const deletedCount = await tracker.cleanupOldRecords(90);

      expect(deletedCount).toBe(0);
    });

    test('should handle errors gracefully', async () => {
      memoryStore.close();

      const deletedCount = await tracker.cleanupOldRecords(90);

      expect(deletedCount).toBe(0);
    });
  });

  describe('budget alerts', () => {
    test('should trigger budget alert when enabled', async () => {
      const budgetTracker = new UsageTracker(memoryStore, {
        enableBudgetAlerts: true,
        dailyBudgetUSD: 1.00
      });

      // Record usage over budget
      await budgetTracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4.5',
        inputTokens: 1_000_000,
        outputTokens: 500_000
      });

      // Check if alert was recorded
      const alerts = memoryStore.db.prepare('SELECT * FROM budget_alerts').all();

      expect(alerts.length).toBeGreaterThan(0);
    });

    test('should not trigger duplicate alerts', async () => {
      const budgetTracker = new UsageTracker(memoryStore, {
        enableBudgetAlerts: true,
        dailyBudgetUSD: 1.00
      });

      // Record multiple usages over budget
      await budgetTracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4.5',
        inputTokens: 500_000,
        outputTokens: 250_000
      });

      await budgetTracker.recordUsage({
        orchestrationId: 'orch-2',
        model: 'claude-sonnet-4.5',
        inputTokens: 500_000,
        outputTokens: 250_000
      });

      // Should only trigger alert once per day
      const alerts = memoryStore.db.prepare("SELECT * FROM budget_alerts WHERE alert_type LIKE 'daily%'").all();

      // May have warning + exceeded, but not duplicates of same type
      const exceededAlerts = alerts.filter(a => a.alert_type === 'daily_exceeded');
      expect(exceededAlerts.length).toBeLessThanOrEqual(1);
    });
  });

  describe('edge cases', () => {
    test('should handle zero token counts', async () => {
      const usageId = await tracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4.5',
        inputTokens: 0,
        outputTokens: 0
      });

      expect(usageId).toBeTruthy();

      const record = memoryStore.db.prepare('SELECT * FROM token_usage WHERE id = ?').get(usageId);
      expect(record.total_cost).toBe(0);
    });

    test('should handle very large token counts', async () => {
      const usageId = await tracker.recordUsage({
        orchestrationId: 'orch-1',
        model: 'claude-sonnet-4.5',
        inputTokens: 100_000_000,
        outputTokens: 50_000_000
      });

      expect(usageId).toBeTruthy();

      const record = memoryStore.db.prepare('SELECT * FROM token_usage WHERE id = ?').get(usageId);
      expect(record.total_cost).toBeGreaterThan(1000);
    });

    test('should handle concurrent usage recording', async () => {
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(tracker.recordUsage({
          orchestrationId: `orch-${i}`,
          model: 'claude-sonnet-4.5',
          inputTokens: 1000,
          outputTokens: 500
        }));
      }

      const results = await Promise.all(promises);

      expect(results.every(r => r !== null)).toBe(true);
      expect(results.length).toBe(10);
    });
  });
});
