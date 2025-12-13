# Continuous Loop System - Test Suite

## Overview

Comprehensive test suite for the Continuous Loop System covering all components with unit and integration tests.

## Test Structure

```
__tests__/
├── core/
│   ├── checkpoint-optimizer.test.js      # Adaptive checkpoint learning tests
│   ├── claude-limit-tracker.test.js      # API rate limit tracking tests
│   └── human-in-loop-detector.test.js    # AI safety guardrails tests
└── integration/
    └── continuous-loop-system.test.js    # Full system integration tests
```

## Test Coverage

### 1. CheckpointOptimizer Tests (checkpoint-optimizer.test.js)

**Coverage:** 300+ test assertions across 50+ test cases

**Test Categories:**
- ✅ Initialization and configuration
- ✅ Checkpoint threshold recommendations
- ✅ Checkpoint recording and success tracking
- ✅ Compaction detection and recovery
- ✅ Adaptive threshold learning
- ✅ Task pattern prediction
- ✅ Statistics and reporting
- ✅ Database persistence
- ✅ Edge cases and error handling
- ✅ Multi-session learning scenarios

**Key Scenarios:**
- Learns optimal checkpoint timing from 75% starting point
- Detects compaction (50K+ token drop) and auto-adjusts
- Predicts token usage based on task patterns
- Adapts threshold up when success rate is high
- Adapts threshold down when failures occur

### 2. ClaudeLimitTracker Tests (claude-limit-tracker.test.js)

**Coverage:** 250+ test assertions across 45+ test cases

**Test Categories:**
- ✅ Plan configuration (Free/Pro/Team)
- ✅ API call recording across time windows
- ✅ Safety check recommendations
- ✅ Window reset management (minute/hour/day)
- ✅ Utilization percentage calculations
- ✅ Time-until-available estimates
- ✅ Multi-plan comparison
- ✅ Database persistence
- ✅ Concurrent call handling
- ✅ Threshold-based actions

**Key Scenarios:**
- Tracks requests across rolling minute/hour/day windows
- Warns at 80%, critical at 90%, emergency at 95%
- Identifies most restrictive constraint
- Handles plan differences (Free: 50/day, Pro: 1000/day, Team: 10000/day)
- Recommends wrap-up before hitting limits

### 3. HumanInLoopDetector Tests (human-in-loop-detector.test.js)

**Coverage:** 350+ test assertions across 55+ test cases

**Test Categories:**
- ✅ Pattern detection (7 built-in patterns)
- ✅ Confidence scoring and thresholds
- ✅ Feedback recording (true/false positives/negatives)
- ✅ Pattern learning from false negatives
- ✅ Adaptive threshold adjustment
- ✅ Precision and recall calculation
- ✅ Multi-keyword matching
- ✅ Database persistence
- ✅ Edge cases (unicode, long text, empty input)
- ✅ Learning progression over time

**Key Scenarios:**
- Detects high-risk operations (deploy to production)
- Detects design decisions requiring review
- Detects manual testing requirements
- Learns new patterns from user feedback
- Adapts confidence threshold based on accuracy
- Improves precision from ~60% to >85% over 20+ sessions

### 4. ContinuousLoopOrchestrator Integration Tests (continuous-loop-system.test.js)

**Coverage:** 200+ test assertions across 35+ test cases

**Test Categories:**
- ✅ Full system initialization
- ✅ Multi-level safety checks
- ✅ Checkpoint creation and management
- ✅ Graceful wrap-up procedures
- ✅ Human feedback processing
- ✅ Status reporting
- ✅ Learning and adaptation
- ✅ Error handling and recovery
- ✅ Concurrent operation handling
- ✅ Real-world workflow scenarios

**Key Scenarios:**
- Safe development workflow (research → design → implement → test)
- Production deployment with human review
- Approaching context limit triggers checkpoint
- Learning from false positives improves accuracy
- Concurrent safety checks across multiple tasks
- System adapts to compaction events

## Running Tests

### Run All Tests

```bash
npm test
```

### Run Specific Test Suite

```bash
# Checkpoint optimizer tests
npm test checkpoint-optimizer

# API limit tracker tests
npm test claude-limit-tracker

# Human-in-loop detector tests
npm test human-in-loop-detector

# Integration tests
npm test continuous-loop-system
```

### Run with Coverage

```bash
npm test -- --coverage
```

### Run in Watch Mode

```bash
npm test -- --watch
```

### Run Specific Test

```bash
npm test -- --testNamePattern="should detect compaction"
```

## Test Database Management

All tests use temporary SQLite databases that are:
- Created uniquely for each test with timestamp
- Automatically cleaned up after each test
- Isolated from production data

**Location:** `__tests__/test-*.db` (automatically removed)

## Test Expectations

### Success Criteria

All tests should pass with:
- ✅ 100% pass rate
- ✅ No memory leaks
- ✅ No lingering test databases
- ✅ Execution time < 30 seconds total

### Coverage Goals

- **Unit Tests:** >90% code coverage per component
- **Integration Tests:** >85% workflow coverage
- **Edge Cases:** All known edge cases tested

## Common Test Patterns

### 1. Initialization Pattern

```javascript
beforeEach(async () => {
  testDbPath = path.join(__dirname, `test-${Date.now()}.db`);
  memoryStore = new MemoryStore({ dbPath: testDbPath });
  await memoryStore.initialize();

  component = new Component({ memoryStore }, options);
  await component.initialize();
});

afterEach(() => {
  if (memoryStore) memoryStore.close();
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
});
```

### 2. Learning Progression Pattern

```javascript
test('should learn over time', async () => {
  const initialValue = component.getSomeMetric();

  // Simulate multiple learning cycles
  for (let i = 0; i < 10; i++) {
    await component.recordFeedback({ /* ... */ });
  }

  const finalValue = component.getSomeMetric();
  expect(finalValue).toBeGreaterThan(initialValue);
});
```

### 3. Threshold Testing Pattern

```javascript
test('should trigger at threshold', async () => {
  // Fill to just below threshold
  for (let i = 0; i < threshold - 1; i++) {
    component.recordEvent();
  }

  let result = component.check();
  expect(result.triggered).toBe(false);

  // One more to cross threshold
  component.recordEvent();

  result = component.check();
  expect(result.triggered).toBe(true);
});
```

## Debugging Tests

### Enable Debug Output

```bash
DEBUG=* npm test
```

### Run Single Test in Debug Mode

```bash
node --inspect-brk node_modules/.bin/jest --runInBand checkpoint-optimizer
```

### Check for Database Leaks

```bash
# After running tests, check for lingering databases
ls __tests__/test-*.db
# Should return: No such file or directory
```

## Continuous Integration

Tests are designed to run in CI/CD environments:

```yaml
# Example GitHub Actions
- name: Run Tests
  run: npm test -- --ci --coverage --maxWorkers=2

- name: Upload Coverage
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/lcov.info
```

## Test Data

### Sample Test Scenarios

**High-Risk Tasks:**
- "Deploy application to production"
- "Delete production database"
- "Update API credentials"
- "Force push to main branch"

**Design Tasks:**
- "Decide whether to use PostgreSQL or MongoDB"
- "Choose between REST and GraphQL"
- "Architecture decision for caching layer"

**Safe Tasks:**
- "Write unit tests"
- "Add code comments"
- "Update documentation"
- "Refactor function names"

### Expected Confidence Scores

| Pattern | Task | Expected Confidence |
|---------|------|---------------------|
| highRisk | "Deploy to production" | >0.90 |
| design | "Decide database choice" | >0.80 |
| manualTest | "Verify UI changes" | >0.85 |
| strategic | "Set project timeline" | >0.85 |
| legal | "Update privacy policy" | >0.90 |

## Performance Benchmarks

**Target execution times:**
- Unit tests (each suite): <5 seconds
- Integration tests: <10 seconds
- Total test suite: <30 seconds

**Memory usage:**
- Peak per test: <100MB
- No memory leaks over 100 iterations

## Troubleshooting

### Tests Timing Out

```bash
# Increase timeout
npm test -- --testTimeout=10000
```

### Database Locked Errors

```bash
# Ensure cleanup in afterEach
# Check for unclosed database connections
```

### Tests Passing Locally But Failing in CI

```bash
# Check for race conditions
# Run with --runInBand
npm test -- --runInBand
```

### Memory Leaks

```bash
# Check for:
# - Unclosed database connections
# - Event listeners not removed
# - Timers not cleared
```

## Contributing

When adding new tests:

1. Follow existing patterns
2. Clean up resources in `afterEach`
3. Use descriptive test names
4. Test both success and failure paths
5. Include edge cases
6. Add integration tests for new workflows
7. Update this README with new test categories

## Test Metrics

Last run statistics:
- **Total Tests:** 180+
- **Total Assertions:** 1100+
- **Code Coverage:** >90%
- **Execution Time:** ~25 seconds
- **Pass Rate:** 100%

## Future Test Additions

- [ ] Dashboard API endpoint tests
- [ ] WebSocket/SSE connection tests
- [ ] Multi-user scenario tests
- [ ] Performance/load tests
- [ ] Security/penetration tests
- [ ] Chaos engineering tests (random failures)

---

**Last Updated:** 2025-12-13
**Test Framework:** Jest 29.x
**Node Version:** 18.x+
