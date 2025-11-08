# Memory System Documentation

**Status**: Core Implementation Complete (60%)
**Architecture**: Hybrid Hooks + MessageBus
**Version**: 1.0.0

---

## Overview

The Memory System provides **persistent storage** and **intelligent context retrieval** for multi-agent orchestrations. It combines the reliability of lifecycle hooks with the flexibility of event-driven messaging.

### Key Features

✅ **Persistent Storage**: SQLite database with FTS5 full-text search
✅ **Hybrid Architecture**: Hooks for critical ops, events for optional
✅ **Agent Performance Tracking**: Success rates, duration, token usage
✅ **Pattern Analytics**: Which orchestration patterns work best
✅ **Graceful Degradation**: System continues even if components fail
✅ **Opt-Out Design**: Memory enabled by default, can be disabled

---

## Quick Start

### Basic Usage

```javascript
const { MessageBus, AgentOrchestrator } = require('./.claude/core');

// Create orchestrator with memory enabled (default)
const messageBus = new MessageBus();
const orchestrator = new AgentOrchestrator(messageBus, {
  enableMemory: true,  // Default: true (opt-out, not opt-in)
  dbPath: '.claude/memory/orchestrations.db'
});

// Register agents
orchestrator.registerAgent(architectAgent);
orchestrator.registerAgent(securityAgent);

// Execute - memory is automatic!
const result = await orchestrator.executeParallel(
  ['architect', 'security'],
  { task: 'Design authentication system' }
);

// Memory is automatically:
// - Loaded before execution (relevant context)
// - Saved after execution (for future reference)
// - Searchable via FTS5 (keyword search)
```

### Disable Memory

```javascript
// Disable memory entirely
const orchestrator = new AgentOrchestrator(messageBus, {
  enableMemory: false
});

// Or disable per execution
const result = await orchestrator.executeParallel(
  ['architect', 'security'],
  task,
  { useMemory: false }  // Skip context loading for this execution
);
```

---

## Architecture

### Hybrid Design

The memory system uses **two complementary patterns**:

#### 1. Lifecycle Hooks (Critical Operations)

**Purpose**: Guarantee execution of MUST-complete operations

**Characteristics**:
- Synchronous execution
- Sequential ordering
- Error propagation (fail-fast)
- Guaranteed completion

**Use For**:
- ✅ Memory saves (can't afford to lose data)
- ✅ Context loading (must happen before execution)
- ✅ Error recording (critical for analysis)

**Example**:
```javascript
// Hooks are registered automatically by MemoryIntegration
orchestrator.lifecycleHooks.registerHook('beforeExecution', async (context) => {
  // This WILL execute before orchestration begins
  const historicalContext = await loadRelevantContext(context.task);
  return { ...context, historicalContext };
}, { priority: 10 });
```

#### 2. MessageBus Events (Optional Operations)

**Purpose**: Enable flexible, fault-isolated features

**Characteristics**:
- Asynchronous notification
- Fault isolation
- Multiple independent subscribers
- Optional processing

**Use For**:
- ✅ AI categorization (expensive, optional)
- ✅ Metrics collection (nice-to-have)
- ✅ Logging (observability)
- ✅ Third-party integrations (plugins)

**Example**:
```javascript
// Subscribe to orchestration completion
messageBus.subscribe('orchestrator:execution:complete', async (event) => {
  // This runs asynchronously, failures won't crash orchestration
  await sendMetricsToAnalytics(event);
});
```

### Execution Flow

```
User calls executeParallel()
         ↓
┌────────────────────────────────┐
│   HOOK: beforeExecution        │ ← CRITICAL (guaranteed)
│   - Load historical context    │
│   - Enrich task with memory    │
└────────────────────────────────┘
         ↓
┌────────────────────────────────┐
│   Execute Agents               │
│   - Parallel execution         │
│   - With memory context        │
└────────────────────────────────┘
         ↓
┌────────────────────────────────┐
│   HOOK: afterExecution         │ ← CRITICAL (guaranteed)
│   - Ensure critical ops done   │
└────────────────────────────────┘
         ↓
┌────────────────────────────────┐
│   EVENT: execution:complete    │ ← OPTIONAL (fault-isolated)
│   - Save to database           │
│   - AI categorization (async)  │
│   - Metrics, logging, etc.     │
└────────────────────────────────┘
         ↓
Return result to user
```

---

## Components

### 1. LifecycleHooks

**File**: `.claude/core/lifecycle-hooks.js`

**Purpose**: Provide guaranteed execution points for critical operations.

**Hook Points**:
- `beforeExecution`: Load context before orchestration
- `afterExecution`: Save results after orchestration
- `onError`: Handle orchestration failures
- `beforeAgentExecution`: Agent-level pre-processing
- `afterAgentExecution`: Agent-level post-processing
- `beforePatternSelection`: Pattern selection logic
- `afterPatternSelection`: Pattern selection confirmation

**API**:
```javascript
const hooks = new LifecycleHooks();

// Register handler
const unregister = hooks.registerHook('beforeExecution', async (context) => {
  // Transform context
  return { ...context, modified: true };
}, {
  priority: 10,      // Lower = earlier execution
  id: 'my-handler',  // Unique identifier
  name: 'My Handler' // Human-readable name
});

// Execute hook pipeline
const result = await hooks.executeHook('beforeExecution', initialContext);

// Unregister handler
unregister();

// Get metrics
const metrics = hooks.getMetrics();
console.log(metrics.executions);
console.log(metrics.successRate);
```

**Features**:
- ✅ Sequential execution (predictable ordering)
- ✅ Priority-based execution
- ✅ Execution metrics
- ✅ Error isolation modes
- ✅ Enable/disable handlers dynamically

---

### 2. MemoryStore

**File**: `.claude/core/memory-store.js`
**Schema**: `.claude/core/schema.sql`

**Purpose**: Persistent storage with SQLite + FTS5 full-text search.

**API**:

#### Record Orchestration
```javascript
const store = new MemoryStore('.claude/memory/orchestrations.db');

const orchestrationId = store.recordOrchestration({
  pattern: 'parallel',
  agentIds: ['architect', 'security'],
  task: 'Design authentication system',
  resultSummary: 'OAuth 2.0 with JWT tokens',
  success: true,
  duration: 3500,      // milliseconds
  tokenCount: 2400,
  metadata: { priority: 'high' }
});
```

#### Search Orchestrations
```javascript
// Keyword search (FTS5)
const results = store.searchOrchestrations({
  pattern: 'parallel',
  successOnly: true,
  minTimestamp: Date.now() - 86400000,  // Last 24 hours
  limit: 10
});

// Full-text search across observations
const searchResults = store.searchObservationsFTS('authentication jwt', {
  type: 'decision',
  limit: 5
});
```

#### Get Statistics
```javascript
// Agent performance
const agentStats = store.getAgentStats('architect');
console.log(`Success rate: ${agentStats.success_rate * 100}%`);
console.log(`Avg duration: ${agentStats.avg_duration}ms`);

// Pattern effectiveness
const patternStats = store.getPatternStats('parallel');
console.log(`Total executions: ${patternStats.total_executions}`);
console.log(`Success rate: ${patternStats.success_rate * 100}%`);

// Successful collaborations
const collabs = store.getSuccessfulCollaborations('parallel', 0.8);
// Returns agent combinations with 80%+ success rate
```

#### Database Tables

| Table | Purpose |
|-------|---------|
| `orchestrations` | Main execution records |
| `observations` | AI-extracted learnings |
| `observations_fts` | Full-text search index (FTS5) |
| `agent_stats` | Agent performance metrics |
| `agent_collaborations` | Team effectiveness tracking |
| `pattern_stats` | Pattern success rates |
| `work_sessions` | Project grouping |
| `context_cache` | Fast context retrieval |

**Features**:
- ✅ SQLite with WAL mode (performance)
- ✅ FTS5 full-text search (fast keyword search)
- ✅ Foreign key constraints (data integrity)
- ✅ Automatic statistics updates
- ✅ Views for common queries
- ✅ Transaction support

---

### 3. MemoryIntegration

**File**: `.claude/core/memory-integration.js`

**Purpose**: Bridge lifecycle hooks and MessageBus events.

**Responsibilities**:

1. **Hook Setup**: Register memory hooks with lifecycle manager
2. **Event Listening**: Subscribe to MessageBus events
3. **Memory Operations**: Coordinate save/load operations
4. **AI Integration**: Optional AI-powered categorization

**API**:
```javascript
const integration = new MemoryIntegration(
  messageBus,
  memoryStore,
  {
    enableAI: true,               // Enable AI categorization
    aiApiKey: process.env.ANTHROPIC_API_KEY,
    asyncCategorization: true     // Don't block on AI
  }
);

// Set up hooks automatically
integration.setupLifecycleHooks(lifecycleHooks);

// Get statistics
const stats = integration.getStats();
console.log(stats.memoryStore);
console.log(stats.aiEnabled);
```

**Hook Handlers** (registered automatically):

1. `beforeExecution` (priority 10):
   - Load relevant historical context
   - Enrich task with memory
   - Return enhanced context

2. `afterExecution` (priority 90):
   - Ensure critical operations complete
   - Wait for synchronous saves (future)

3. `onError`:
   - Record failure for analysis
   - Log error details

**Event Handlers**:

1. `orchestrator:execution:complete`:
   - Save orchestration to database
   - Trigger AI categorization (async)
   - Update statistics

2. `agent:state-change`:
   - Track agent state transitions
   - (Future: State analytics)

3. `orchestrator:pattern:selected`:
   - Track pattern selection decisions
   - (Future: Improve recommendations)

---

### 4. Enhanced AgentOrchestrator

**File**: `.claude/core/agent-orchestrator.js` (modified)

**Changes**:
- ✅ Constructor accepts memory options
- ✅ Lifecycle hooks integrated into execution
- ✅ Memory context passed to agents
- ✅ Event publishing for notifications
- ✅ Graceful degradation

**New Constructor Options**:
```javascript
new AgentOrchestrator(messageBus, {
  // Memory options (opt-out, not opt-in)
  enableMemory: true,  // Default: enabled
  dbPath: '.claude/memory/orchestrations.db',

  // AI features (opt-in)
  enableAI: true,
  aiApiKey: process.env.ANTHROPIC_API_KEY,

  // Vector search (future)
  vectorConfig: {
    chromaPath: 'http://localhost:8000'
  }
});
```

**New Execution Options**:
```javascript
await orchestrator.executeParallel(
  ['architect', 'security'],
  task,
  {
    useMemory: true,          // Load historical context (default: true)
    maxContextTokens: 1000,   // Token budget for context (future)
    includeFullDetails: false // Progressive disclosure (future)
  }
);
```

---

## Configuration

### Environment Variables

```bash
# Optional: Anthropic API key for AI categorization
ANTHROPIC_API_KEY=sk-ant-...

# Optional: Chroma vector database URL (future)
CHROMA_URL=http://localhost:8000
```

### File Locations

```
.claude/
├── memory/
│   ├── orchestrations.db       # Main database (auto-created)
│   ├── orchestrations.db-wal   # Write-ahead log
│   └── orchestrations.db-shm   # Shared memory
└── core/
    ├── lifecycle-hooks.js
    ├── memory-store.js
    ├── memory-integration.js
    ├── schema.sql
    └── agent-orchestrator.js
```

---

## Usage Patterns

### Pattern 1: Basic Usage (Memory Enabled)

```javascript
const orchestrator = new AgentOrchestrator(messageBus);  // Memory on by default

const result = await orchestrator.executeParallel(
  ['architect', 'security'],
  { task: 'Design authentication' }
);

// Memory automatically:
// 1. Loads relevant context
// 2. Saves orchestration
// 3. Updates statistics
```

### Pattern 2: Disable Memory Globally

```javascript
const orchestrator = new AgentOrchestrator(messageBus, {
  enableMemory: false  // Opt-out
});

// No memory operations
const result = await orchestrator.executeParallel(...);
```

### Pattern 3: Disable Memory Per Execution

```javascript
const orchestrator = new AgentOrchestrator(messageBus);  // Memory enabled

// Execute with memory
const result1 = await orchestrator.executeParallel(['agent1'], task1);

// Execute without memory
const result2 = await orchestrator.executeParallel(
  ['agent2'],
  task2,
  { useMemory: false }  // Skip for this execution
);
```

### Pattern 4: Query History

```javascript
const memoryStore = orchestrator.memoryStore;

// Find similar past tasks
const similar = memoryStore.searchOrchestrations({
  pattern: 'parallel',
  successOnly: true,
  limit: 5
});

// Analyze agent performance
const agentStats = memoryStore.getAgentStats();
agentStats.forEach(stats => {
  console.log(`${stats.agent_id}: ${stats.success_rate * 100}% success`);
});

// Check pattern effectiveness
const patternStats = memoryStore.getPatternStats();
const bestPattern = patternStats.reduce((best, current) =>
  current.success_rate > best.success_rate ? current : best
);

console.log(`Best pattern: ${bestPattern.pattern} (${bestPattern.success_rate * 100}%)`);
```

### Pattern 5: Custom Hooks

```javascript
const orchestrator = new AgentOrchestrator(messageBus);

// Add custom pre-execution logic
orchestrator.lifecycleHooks.registerHook('beforeExecution', async (context) => {
  console.log('Custom logic before execution');

  // Add custom context
  return {
    ...context,
    customData: await loadCustomData()
  };
}, { priority: 5 });  // Execute early (low priority number)

// Add custom post-execution logic
orchestrator.lifecycleHooks.registerHook('afterExecution', async (result) => {
  console.log('Custom logic after execution');

  // Send to external system
  await sendToExternalSystem(result);

  return result;
}, { priority: 95 });  // Execute late (high priority number)
```

### Pattern 6: Event Subscribers

```javascript
// Subscribe to orchestration completions
messageBus.subscribe('orchestrator:execution:complete', async (event) => {
  console.log(`Orchestration completed: ${event.pattern}`);

  // Custom processing (failure here won't crash orchestration)
  await customProcessing(event);
}, 'my-subscriber');

// Subscribe to errors
messageBus.subscribe('orchestrator:error', async (event) => {
  console.error('Orchestration failed:', event.error);

  // Send alert
  await sendAlert(event);
}, 'error-alerter');
```

---

## Testing

### Run Demo

```bash
node examples/memory-integration-demo.js
```

This demo shows:
1. First execution (no history)
2. Second execution (with history)
3. Memory queries
4. Agent statistics
5. Pattern analytics
6. Hook inspection

### Manual Testing

```javascript
const { MemoryStore } = require('./.claude/core');

// Test database
const store = new MemoryStore(':memory:');  // In-memory for testing

// Record test data
const id = store.recordOrchestration({
  pattern: 'parallel',
  agentIds: ['agent1', 'agent2'],
  task: 'Test task',
  success: true,
  duration: 1000
});

// Query
const results = store.searchOrchestrations({ successOnly: true });
console.log(results);

// Stats
const stats = store.getStats();
console.log(stats);
```

---

## Troubleshooting

### Issue: Database locked

**Cause**: Multiple processes accessing database simultaneously

**Solution**: SQLite uses WAL mode for concurrent access, but write operations are exclusive

```javascript
// Option 1: Use separate databases for concurrent processes
const orchestrator1 = new AgentOrchestrator(mb1, { dbPath: 'db1.db' });
const orchestrator2 = new AgentOrchestrator(mb2, { dbPath: 'db2.db' });

// Option 2: Disable memory for concurrent tests
const orchestrator = new AgentOrchestrator(mb, { enableMemory: false });
```

### Issue: Memory not loading context

**Cause**: Not enough historical data, or task keywords don't match

**Solution**: Check database has data

```javascript
const stats = orchestrator.memoryStore.getStats();
console.log(`Total orchestrations: ${stats.total_orchestrations}`);

// If 0, memory is empty - need to run some orchestrations first
```

### Issue: AI categorization not working

**Cause**: No API key or AI not enabled

**Solution**: Enable AI and provide key

```javascript
const orchestrator = new AgentOrchestrator(messageBus, {
  enableAI: true,
  aiApiKey: process.env.ANTHROPIC_API_KEY
});
```

---

## Future Enhancements

### Coming Soon

- [ ] **VectorStore**: Semantic search with Chroma
- [ ] **ContextRetriever**: Progressive disclosure (token-aware)
- [ ] **AICategorizationService**: Extract learnings automatically
- [ ] **MemorySearchAPI**: Query interface
- [ ] **PatternRecommender**: Suggest best patterns

### Roadmap

**Week 3-4**: Intelligence Layer
- VectorStore with Chroma integration
- ContextRetriever with progressive disclosure
- AICategorizationService implementation

**Week 5-6**: API & Recommendations
- MemorySearchAPI (query interface)
- PatternRecommender (intelligent suggestions)
- Enhanced CLI with memory commands

---

## API Reference

See [API_REFERENCE.md](./API_REFERENCE.md) for detailed API documentation.

---

## Contributing

When adding memory-related features:

1. **Use hooks for critical operations** (memory saves, context loads)
2. **Use events for optional features** (metrics, logging, AI)
3. **Always support graceful degradation**
4. **Test with memory enabled AND disabled**
5. **Update documentation**

---

## License

MIT
