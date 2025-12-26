# Swarm Integration: Remaining Work Plan

**Created**: 2025-12-25
**Total Estimated Effort**: 8-10 hours
**Priority**: Complete v0.18 feature set

---

## Pre-Requisite: Commit Current Changes

Before starting new work, commit the uncommitted Phase 4 (Dashboard UI) changes.

```bash
git add global-context-manager.js global-dashboard.html
git add __tests__/integration/swarm-api-endpoints.test.js
git add scripts/test-dashboard-swarm-panels.js
git commit -m "[FEAT] Add swarm dashboard UI panels and API endpoints"
```

**Files to commit:**
- `global-context-manager.js` (+122 lines) - 7 new API endpoints
- `global-dashboard.html` (+728 lines) - Confidence gauge, planning panel, complexity badges
- `__tests__/integration/swarm-api-endpoints.test.js` - 22 API tests
- `scripts/test-dashboard-swarm-panels.js` - Manual test script

---

## Phase A: Feature Flags (1 hour)

**Priority**: HIGH (enables gradual rollout and rollback)
**Dependencies**: None

### Tasks

#### A1. Create Feature Flag Configuration (30 min)

**File**: `.claude/core/feature-flags.js`

```javascript
/**
 * Swarm Feature Flags
 *
 * Enable/disable swarm features via environment variables.
 * All features default to TRUE for backward compatibility with v0.18.
 */
class FeatureFlags {
  constructor() {
    this.flags = {
      competitivePlanning: this._getFlag('ENABLE_COMPETITIVE_PLANNING', true),
      complexityDetection: this._getFlag('ENABLE_COMPLEXITY_DETECTION', true),
      confidenceMonitoring: this._getFlag('ENABLE_CONFIDENCE_MONITORING', true),
      securityValidation: this._getFlag('ENABLE_SECURITY_VALIDATION', true)
    };
  }

  _getFlag(envVar, defaultValue) {
    const value = process.env[envVar];
    if (value === undefined) return defaultValue;
    return value.toLowerCase() === 'true';
  }

  isEnabled(feature) {
    return this.flags[feature] ?? false;
  }

  getAll() {
    return { ...this.flags };
  }
}

module.exports = new FeatureFlags();
```

#### A2. Integrate into ContinuousLoopOrchestrator (20 min)

**File**: `.claude/core/continuous-loop-orchestrator.js`

Add conditional initialization:

```javascript
const featureFlags = require('./feature-flags');

// In constructor:
if (featureFlags.isEnabled('complexityDetection')) {
  this.complexityAnalyzer = new ComplexityAnalyzer();
}

if (featureFlags.isEnabled('competitivePlanning')) {
  this.competitivePlanner = new CompetitivePlanner();
  this.planEvaluator = new PlanEvaluator();
}

if (featureFlags.isEnabled('confidenceMonitoring')) {
  this.confidenceMonitor = new ConfidenceMonitor();
}

if (featureFlags.isEnabled('securityValidation')) {
  this.securityValidator = new SecurityValidator();
}
```

#### A3. Write Tests (10 min)

**File**: `__tests__/core/feature-flags.test.js`

- Test default values (all true)
- Test environment variable override
- Test false values
- Test invalid values

### Deliverables

- [ ] `feature-flags.js` created
- [ ] Orchestrator uses feature flags
- [ ] 8+ tests passing
- [ ] Documentation in `.env.example`

---

## Phase B: Database Schema (2 hours)

**Priority**: MEDIUM (enables historical analysis)
**Dependencies**: None

### Tasks

#### B1. Create Schema Extension (30 min)

**File**: `.claude/core/schema-swarm.sql`

```sql
-- Confidence History Table
CREATE TABLE IF NOT EXISTS confidence_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  task_id TEXT,
  phase TEXT,
  confidence REAL NOT NULL,
  level TEXT NOT NULL,
  signals TEXT NOT NULL,  -- JSON: {qualityScore, velocity, iterations, errorRate, historical}
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_confidence_session ON confidence_history(session_id);
CREATE INDEX IF NOT EXISTS idx_confidence_created ON confidence_history(created_at);

-- Complexity Analysis Table
CREATE TABLE IF NOT EXISTS complexity_analysis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  score REAL NOT NULL,
  strategy TEXT NOT NULL,
  dimensions TEXT NOT NULL,  -- JSON: {dependencyDepth, acceptanceCriteria, ...}
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_complexity_task ON complexity_analysis(task_id);

-- Plan Comparison Table
CREATE TABLE IF NOT EXISTS plan_comparisons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  plans TEXT NOT NULL,  -- JSON array of plans
  winner_strategy TEXT,
  winner_score REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plans_task ON plan_comparisons(task_id);
```

#### B2. Create Migration Script (30 min)

**File**: `.claude/core/migrations/001-swarm-features.js`

```javascript
const fs = require('fs');
const path = require('path');

module.exports = {
  version: 1,
  name: 'swarm-features',

  up: async (db) => {
    const schema = fs.readFileSync(
      path.join(__dirname, '../schema-swarm.sql'),
      'utf8'
    );

    const statements = schema.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      await db.run(stmt);
    }

    console.log('[Migration] Swarm tables created');
  },

  down: async (db) => {
    await db.run('DROP TABLE IF EXISTS confidence_history');
    await db.run('DROP TABLE IF EXISTS complexity_analysis');
    await db.run('DROP TABLE IF EXISTS plan_comparisons');
    console.log('[Migration] Swarm tables dropped');
  }
};
```

#### B3. Extend MemoryStore (45 min)

**File**: `.claude/core/memory-store.js` (extend existing)

Add methods:
- `recordConfidence(sessionId, taskId, phase, confidence, level, signals)`
- `getConfidenceHistory(sessionId, limit = 100)`
- `getConfidenceTrend(sessionId, minutes = 30)`
- `recordComplexity(taskId, score, strategy, dimensions)`
- `recordPlanComparison(taskId, plans, winner)`

#### B4. Write Tests (15 min)

**File**: `.claude/core/memory-store.swarm.test.js`

- Test confidence recording
- Test confidence retrieval
- Test complexity recording
- Test plan comparison recording
- Test empty database handling

### Deliverables

- [ ] `schema-swarm.sql` created
- [ ] `migrations/001-swarm-features.js` created
- [ ] MemoryStore extended with 5 new methods
- [ ] 15+ tests passing
- [ ] Migration runs on startup

---

## Phase C: Documentation (3-4 hours)

**Priority**: LOW (can be done last)
**Dependencies**: All features complete

### Tasks

#### C1. COMPETITIVE_PLANNING.md (1.5 hours)

**File**: `docs/COMPETITIVE_PLANNING.md`

Structure:
```markdown
# Competitive Planning

## Overview
- What is competitive planning?
- When does it activate? (complexity >= 40)

## How It Works
1. Complexity Analysis
2. Plan Generation (3 strategies)
3. Plan Evaluation (5 criteria)
4. Winner Selection

## Configuration
- COMPLEXITY_SIMPLE_MAX (default: 40)
- PLAN_GENERATION_TIMEOUT (default: 500ms)

## API Reference
- analyzeTaskComplexity(task)
- generateCompetingPlans(task, options)
- comparePlans(plans)

## Dashboard Integration
- Screenshots of planning panel
- How to interpret results

## Examples
- Simple task (fast path)
- Complex task (competitive)

## Troubleshooting
- Common issues
- Debug logging
```

#### C2. CONFIDENCE_MONITORING.md (1 hour)

**File**: `docs/CONFIDENCE_MONITORING.md`

Structure:
```markdown
# Confidence Monitoring

## Overview
- What is confidence monitoring?
- Why track agent confidence?

## Signal Sources
1. Quality Score (30% weight)
2. Velocity (25% weight)
3. Iterations (20% weight)
4. Error Rate (15% weight)
5. Historical Success (10% weight)

## Alert Thresholds
- Healthy: >= 60
- Warning: 40-59
- Critical: 25-39
- Emergency: < 25

## Configuration
- CONFIDENCE_ALERT_THRESHOLD
- CONFIDENCE_CRITICAL_THRESHOLD

## API Reference
- trackProgress(progress)
- getConfidenceState()
- Events: confidence:updated, confidence:warning, etc.

## Dashboard Integration
- Gauge interpretation
- Trend analysis

## Integration with Notifications
- How alerts trigger notifications
```

#### C3. SECURITY_GUIDE.md (1 hour)

**File**: `docs/SECURITY_GUIDE.md`

Structure:
```markdown
# Security Guide

## Overview
- Security layer purpose
- Defense in depth approach

## Threat Protection
1. Prompt Injection Detection
   - Pattern list
   - Examples blocked
2. Path Traversal Prevention
   - Blocked patterns
3. Command Allowlisting
   - Default allowed commands
   - How to extend

## Operating Modes
- Audit Mode (log only)
- Enforce Mode (block threats)

## Configuration
- SECURITY_MODE=audit|enforce
- Custom patterns

## API Reference
- validateInput(input, type)
- validatePrompt(prompt)
- validatePath(path)
- validateCommand(command)

## Incident Response
- What to do when threats detected
- Log analysis

## Best Practices
- Input sanitization
- Output encoding
```

#### C4. Update .env.example (15 min)

**File**: `.env.example`

Add new variables:
```bash
# Claude-Swarm Feature Flags
ENABLE_COMPETITIVE_PLANNING=true
ENABLE_COMPLEXITY_DETECTION=true
ENABLE_CONFIDENCE_MONITORING=true
ENABLE_SECURITY_VALIDATION=true

# Complexity Thresholds
COMPLEXITY_SIMPLE_MAX=40

# Confidence Thresholds
CONFIDENCE_ALERT_THRESHOLD=60
CONFIDENCE_CRITICAL_THRESHOLD=40

# Security Mode
SECURITY_MODE=enforce
```

### Deliverables

- [ ] `docs/COMPETITIVE_PLANNING.md` created
- [ ] `docs/CONFIDENCE_MONITORING.md` created
- [ ] `docs/SECURITY_GUIDE.md` created
- [ ] `.env.example` updated

---

## Phase D: Performance Testing (2 hours)

**Priority**: MEDIUM
**Dependencies**: Phases A-B complete

### Tasks

#### D1. Performance Benchmarks (1 hour)

**File**: `scripts/benchmark-swarm.js`

Benchmarks to run:
- Complexity analysis latency (target: <10ms)
- Plan generation latency (target: <100ms per plan)
- Plan evaluation latency (target: <5ms)
- Confidence calculation latency (target: <1ms)
- Security validation latency (target: <5ms)

Output format:
```
=== Swarm Performance Benchmarks ===
Complexity Analysis:  avg=8ms   p95=12ms  p99=18ms  ✅
Plan Generation:      avg=85ms  p95=120ms p99=150ms ✅
Plan Evaluation:      avg=3ms   p95=5ms   p99=8ms   ✅
Confidence Calc:      avg=0.5ms p95=1ms   p99=2ms   ✅
Security Validation:  avg=2ms   p95=4ms   p99=6ms   ✅
```

#### D2. Load Testing (1 hour)

**File**: `scripts/load-test-swarm.js`

Tests:
- 100 rapid complexity analyses
- 50 concurrent plan comparisons
- 1000 confidence updates in 10 seconds
- Memory usage tracking
- No memory leaks after 5 minutes

### Deliverables

- [ ] `scripts/benchmark-swarm.js` created
- [ ] `scripts/load-test-swarm.js` created
- [ ] Performance within targets
- [ ] No memory leaks

---

## Implementation Order

```
┌─────────────────────────────────────────────────────────┐
│  Step 0: Commit Dashboard UI (5 min)                    │
│  └─> git commit current uncommitted changes             │
└─────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  Step 1: Feature Flags (1 hour)                         │
│  └─> Enables safe rollback if issues found              │
└─────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  Step 2: Database Schema (2 hours)                      │
│  └─> Enables historical data for confidence trends      │
└─────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  Step 3: Performance Testing (2 hours)                  │
│  └─> Validate system performance before documenting     │
└─────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  Step 4: Documentation (3-4 hours)                      │
│  └─> Document verified, working features                │
└─────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  Step 5: Final Commit & Tag v0.18.1 (5 min)             │
│  └─> Tag complete feature set                           │
└─────────────────────────────────────────────────────────┘
```

---

## Success Criteria

| Metric | Target | How to Verify |
|--------|--------|---------------|
| Feature flags working | 4 flags | `npm test -- feature-flags` |
| Database tables created | 3 tables | Run migration |
| Historical data stored | Yes | Query confidence_history |
| Documentation complete | 3 docs | Files exist with content |
| Performance benchmarks | All pass | `node scripts/benchmark-swarm.js` |
| Load test | No leaks | `node scripts/load-test-swarm.js` |
| All tests passing | 1200+ | `npm test` |

---

## Rollback Plan

If issues are discovered:

```bash
# Disable all swarm features
export ENABLE_COMPETITIVE_PLANNING=false
export ENABLE_COMPLEXITY_DETECTION=false
export ENABLE_CONFIDENCE_MONITORING=false
export ENABLE_SECURITY_VALIDATION=false

# System continues to work as before v0.18
npm run autonomous
```

---

## Estimated Timeline

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Commit Dashboard | 5 min | 5 min |
| Feature Flags | 1 hour | 1h 5min |
| Database Schema | 2 hours | 3h 5min |
| Performance Testing | 2 hours | 5h 5min |
| Documentation | 3-4 hours | 8-9 hours |
| Final Commit | 5 min | ~9 hours |

**Total: 8-10 hours** (can be split across multiple sessions)
