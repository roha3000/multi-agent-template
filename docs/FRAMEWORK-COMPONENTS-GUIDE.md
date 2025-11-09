# Framework Components Guide

**Version**: 1.0.0
**Last Updated**: 2025-11-09
**Target Audience**: Framework adopters, developers

---

## Table of Contents

1. [Core Components](#core-components)
2. [Intelligence Layer Components](#intelligence-layer-components)
3. [Analytics Components](#analytics-components)
4. [Agent System Components](#agent-system-components)
5. [Component Interaction](#component-interaction)
6. [Configuration Reference](#configuration-reference)
7. [API Reference](#api-reference)

---

## Core Components

### 1. MessageBus

**File**: `.claude/core/message-bus.js` (348 lines)

**Purpose**: Event-driven pub/sub communication backbone for multi-agent collaboration

#### Features

- EventEmitter-based with support for 100+ concurrent agents
- Topic-based publish/subscribe pattern
- Request-response pattern with timeout control
- Message history tracking (last 1000 messages)
- Subscription management and debugging
- Metadata enrichment (timestamp, messageId, publisherId)

#### API

**Publishing Messages**:
```javascript
const messageBus = new MessageBus();

// Publish to topic
messageBus.publish('agent:task:assigned', {
  agentId: 'researcher-1',
  task: { type: 'analyze', data: '...' }
});

// Metadata automatically added:
// - timestamp
// - messageId (UUID)
// - publisherId (optional)
```

**Subscribing to Topics**:
```javascript
// Subscribe to specific topic
messageBus.subscribe('agent:task:assigned', 'subscriber-id', (event) => {
  console.log('Task assigned:', event.agentId);
});

// Wildcard subscriptions
messageBus.subscribe('agent:*', 'subscriber-id', (event) => {
  console.log('Any agent event:', event);
});

// Unsubscribe
messageBus.unsubscribe('agent:task:assigned', 'subscriber-id');
```

**Request-Response Pattern**:
```javascript
// Make request (wait for responses)
const responses = await messageBus.request(
  'query:agent:status',
  { agentIds: ['agent-1', 'agent-2'] },
  {
    timeout: 5000,      // Max wait time
    expectedResponses: 2  // How many responses to expect
  }
);

// Respond to request
messageBus.onRequest('query:agent:status', async (request) => {
  return { status: 'idle', agentId: 'agent-1' };
});
```

**Message History**:
```javascript
// Get recent messages
const history = messageBus.getMessageHistory('agent:*', 50);

// Get all subscriptions
const subs = messageBus.getSubscriptions();
```

#### Configuration

```javascript
const messageBus = new MessageBus({
  historySize: 1000,        // Max messages to keep
  enableDebug: false        // Debug logging
});
```

#### Use Cases

- Agent-to-agent messaging
- Orchestrator broadcasting tasks
- Event notifications (execution complete, state changes)
- Distributed request-response (query multiple agents)

---

### 2. Agent (Base Class)

**File**: `.claude/core/agent.js` (512 lines)

**Purpose**: Foundation for all agents with core functionality

#### Features

- State management (idle, working, completed, failed)
- Direct messaging between agents
- Broadcast messaging to all agents
- Topic subscription management
- Execution history tracking (last 100 executions)
- Performance statistics (success rate, avg duration)
- Configurable timeout and retry logic

#### API

**Creating Custom Agent**:
```javascript
const Agent = require('./.claude/core/agent');

class ResearchAgent extends Agent {
  constructor(id, messageBus, config = {}) {
    super(id, 'Research Specialist', messageBus, {
      timeout: 60000,       // 60s timeout
      retries: 3,           // 3 retry attempts
      ...config
    });
  }

  async execute(task, context = {}) {
    this.setState('working');

    try {
      // Your agent logic here
      const result = await this.performResearch(task);

      this.setState('completed');

      return {
        success: true,
        agentId: this.id,
        role: this.role,
        data: result
      };
    } catch (error) {
      this.setState('failed');
      throw error;
    }
  }

  async performResearch(task) {
    // Custom implementation
    return { findings: '...' };
  }
}
```

**State Management**:
```javascript
// Get current state
const state = agent.getState();  // 'idle', 'working', 'completed', 'failed'

// Set state (publishes state change event)
agent.setState('working');
```

**Messaging**:
```javascript
// Send direct message to another agent
await agent.sendMessage('other-agent-id', {
  type: 'request-info',
  data: { topic: 'architecture' }
});

// Broadcast to all agents
agent.broadcast({
  type: 'announcement',
  message: 'Analysis complete'
});

// Subscribe to topics
agent.subscribe('agent:task:assigned', (event) => {
  console.log('New task:', event.task);
});
```

**Execution History**:
```javascript
// Get recent executions
const history = agent.getExecutionHistory(10);

// Get statistics
const stats = agent.getStatistics();
// Returns:
// {
//   totalExecutions: 42,
//   successfulExecutions: 40,
//   failedExecutions: 2,
//   successRate: 0.95,
//   averageDuration: 1250  // ms
// }
```

#### Configuration

```javascript
const agent = new ResearchAgent('researcher-1', messageBus, {
  timeout: 60000,        // Max execution time (ms)
  retries: 3,            // Retry attempts on failure
  retryDelay: 1000,      // Delay between retries (ms)
  expertise: 'technology'  // Custom config
});
```

#### Lifecycle Events

Agents automatically publish events:
- `agent:created` - Agent instantiated
- `agent:state-change` - State updated
- `agent:execution:start` - Execution began
- `agent:execution:complete` - Execution succeeded
- `agent:execution:failed` - Execution failed

---

### 3. AgentOrchestrator

**File**: `.claude/core/agent-orchestrator.js` (791 lines)

**Purpose**: Coordinates multiple agents for collaborative tasks

#### Features

- 5 orchestration patterns (Parallel, Consensus, Debate, Review, Ensemble)
- Hybrid hooks + MessageBus architecture
- Memory integration for historical context
- Agent auto-discovery from directory
- Retry logic with exponential backoff
- Pattern effectiveness tracking
- Graceful degradation when memory unavailable

#### API

**Initialization**:
```javascript
const AgentOrchestrator = require('./.claude/core/agent-orchestrator');

const orchestrator = new AgentOrchestrator(messageBus, {
  // Memory Options
  enableMemory: true,
  dbPath: '.claude/memory/orchestrations.db',

  // Intelligence Options
  enableAI: false,
  contextTokenBudget: 2000,

  // Performance Options
  retryAttempts: 3,
  retryDelay: 1000,
  timeout: 60000
});
```

**Agent Registration**:
```javascript
// Register individual agent
orchestrator.registerAgent(agent);

// Auto-discover from directory
await orchestrator.discoverAgents('.claude/agents/');

// Get registered agents
const agents = orchestrator.getRegisteredAgents();
```

**Pattern 1: Parallel Execution**:
```javascript
const result = await orchestrator.executeParallel(
  ['agent-1', 'agent-2', 'agent-3'],  // Agent IDs
  {
    type: 'analyze',
    data: 'market research'
  },
  {
    useMemory: true,          // Load historical context
    contextTokenBudget: 2000,  // Max tokens for context
    synthesizer: (results) => {
      // Custom result synthesis
      return { combined: results };
    }
  }
);

// Result structure:
// {
//   success: true,
//   pattern: 'parallel',
//   results: [...],           // Individual agent results
//   failures: [],             // Failed agents
//   duration: 1250,           // Total time (ms)
//   usage: {...},             // Token usage
//   memoryContext: {...}      // Historical context loaded
// }
```

**Pattern 2: Consensus Voting**:
```javascript
const result = await orchestrator.executeWithConsensus(
  ['agent-1', 'agent-2', 'agent-3'],
  {
    type: 'decide',
    question: 'Best database?',
    options: ['PostgreSQL', 'MongoDB', 'MySQL']
  },
  {
    strategy: 'weighted',     // 'majority', 'weighted', 'unanimous'
    threshold: 0.6,           // 60% required
    weights: {
      'agent-1': 2,           // Expert weight
      'agent-2': 1.5,
      'agent-3': 1
    }
  }
);

// Result structure:
// {
//   success: true,
//   consensus: true,          // Threshold met?
//   winner: 'PostgreSQL',     // Chosen option
//   confidence: 0.75,         // Confidence score
//   votes: {                  // Vote breakdown
//     'PostgreSQL': 3.5,
//     'MongoDB': 1,
//     'MySQL': 0
//   }
// }
```

**Pattern 3: Debate (Iterative Refinement)**:
```javascript
const result = await orchestrator.executeDebate(
  ['reviewer-1', 'reviewer-2'],  // Debaters
  {
    initialProposal: 'Use microservices architecture',
    domain: 'system design'
  },
  3,  // Number of rounds
  {
    useMemory: true
  }
);

// Result structure:
// {
//   success: true,
//   finalProposal: '...',     // Refined proposal
//   rounds: [                 // History per round
//     {
//       round: 1,
//       proposal: '...',
//       critiques: [...],
//       synthesis: '...'
//     },
//     // ...
//   ]
// }
```

**Pattern 4: Review (Create/Critique/Revise)**:
```javascript
const result = await orchestrator.executeReview(
  'developer-1',                   // Creator
  ['tech-lead', 'qa-engineer'],    // Reviewers
  {
    type: 'implement-feature',
    feature: 'user authentication'
  },
  {
    revisionRounds: 2,             // Review iterations
    useMemory: true
  }
);

// Result structure:
// {
//   success: true,
//   finalWork: {...},          // Final version
//   rounds: [                  // Review history
//     {
//       round: 1,
//       creation: {...},
//       reviews: [...],
//       revision: {...}
//     },
//     // ...
//   ]
// }
```

**Pattern 5: Ensemble (Combine Outputs)**:
```javascript
const result = await orchestrator.executeEnsemble(
  ['agent-1', 'agent-2', 'agent-3'],
  {
    type: 'summarize',
    content: longDocument
  },
  {
    strategy: 'best-of',       // 'best-of', 'merge', 'vote'
    selector: (results) => {
      // Custom quality selector
      return results.reduce((best, curr) =>
        curr.score > best.score ? curr : best
      );
    }
  }
);

// Result structure:
// {
//   success: true,
//   selected: {...},           // Best result
//   alternatives: [...],       // Other results
//   strategy: 'best-of'
// }
```

#### Configuration Options

```javascript
const orchestrator = new AgentOrchestrator(messageBus, {
  // Memory Configuration
  enableMemory: true,                  // Enable persistent memory
  dbPath: '.claude/memory/orchestrations.db',
  enableAI: false,                     // AI categorization
  contextTokenBudget: 2000,            // Max tokens for context

  // Performance Configuration
  retryAttempts: 3,                    // Retry failed agents
  retryDelay: 1000,                    // Initial retry delay (ms)
  timeout: 60000,                      // Agent timeout (ms)

  // Analytics Configuration
  enableCostTracking: true,            // Track token costs
  dailyBudget: 10.00,                  // USD
  monthlyBudget: 200.00,               // USD

  // Logging Configuration
  logLevel: 'info'                     // 'error', 'warn', 'info', 'debug'
});
```

---

### 4. LifecycleHooks

**File**: `.claude/core/lifecycle-hooks.js` (366 lines)

**Purpose**: Guaranteed execution points for critical operations

#### Features

- 6 hook points for orchestration lifecycle
- Sequential execution with predictable ordering
- Priority-based handler execution (lower = earlier)
- Isolated execution mode for non-critical hooks
- Pipeline transformation (handlers chain outputs)
- Comprehensive metrics tracking
- Enable/disable individual handlers

#### API

**Hook Points**:

1. **beforeExecution**: Before pattern execution starts
2. **afterExecution**: After pattern completes successfully
3. **onError**: When pattern execution fails
4. **beforeAgentExecution**: Before individual agent executes
5. **afterAgentExecution**: After individual agent completes
6. **beforePatternSelection**: Before pattern auto-selection
7. **afterPatternSelection**: After pattern selected

**Registering Hook Handlers**:
```javascript
const LifecycleHooks = require('./.claude/core/lifecycle-hooks');

const hooks = new LifecycleHooks();

// Register beforeExecution handler
hooks.register('beforeExecution', 'load-context', async (context) => {
  // Load historical context
  const memory = await loadMemory(context.task);

  return {
    ...context,
    memoryContext: memory
  };
}, {
  priority: 10,        // Lower = runs earlier
  isolated: false      // Errors propagate
});

// Register afterExecution handler
hooks.register('afterExecution', 'save-results', async (result) => {
  // Save to database
  await saveToMemory(result);

  return result;  // Pass through
}, {
  priority: 90,        // Lower = runs earlier
  isolated: false
});

// Register error handler
hooks.register('onError', 'log-error', async (error, context) => {
  console.error('Orchestration failed:', error);
  return { error, context };
}, {
  priority: 50
});
```

**Executing Hooks**:
```javascript
// Execute hook pipeline
const enrichedContext = await hooks.execute('beforeExecution', {
  task: { type: 'analyze' },
  agents: ['agent-1', 'agent-2']
});

// Result is output of last handler in pipeline
// Each handler receives output of previous handler
```

**Managing Handlers**:
```javascript
// Unregister handler
hooks.unregister('beforeExecution', 'load-context');

// Get all handlers for hook
const handlers = hooks.getHandlers('beforeExecution');

// Get metrics
const metrics = hooks.getMetrics();
// Returns:
// {
//   beforeExecution: {
//     executions: 42,
//     successes: 40,
//     failures: 2,
//     totalDuration: 1250
//   },
//   // ...
// }
```

**Configuration**:
```javascript
const hooks = new LifecycleHooks({
  trackMetrics: true,      // Track execution metrics
  logErrors: true          // Log handler errors
});
```

#### Handler Priority Guidelines

- **1-20**: Early initialization (setup, validation)
- **21-50**: Core operations (memory load, context prep)
- **51-80**: Optional enhancements (metrics, logging)
- **81-100**: Cleanup and finalization (save, notify)

#### Isolated vs Non-Isolated Handlers

**Non-Isolated** (default):
- Errors propagate to caller
- Execution stops on error
- Use for critical operations

**Isolated**:
- Errors caught and logged
- Execution continues
- Use for optional operations

---

### 5. MemoryStore

**File**: `.claude/core/memory-store.js` (582 lines)

**Purpose**: SQLite-based persistent storage for orchestration history

#### Features

- SQLite with WAL mode for concurrency
- FTS5 full-text search with BM25 ranking
- Agent performance tracking (success rates, duration)
- Pattern effectiveness analytics
- Collaboration insights (which agents work well together)
- JSON field support for complex data
- Automatic statistics calculation
- Graceful degradation on failure

#### Schema

**Tables**:
```sql
-- Core orchestration records
CREATE TABLE orchestrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,
  agents TEXT NOT NULL,  -- JSON array
  task TEXT NOT NULL,    -- JSON object
  result TEXT,           -- JSON object
  success BOOLEAN NOT NULL,
  duration INTEGER,      -- milliseconds
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Key learnings and insights
CREATE TABLE observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orchestration_id INTEGER,
  type TEXT,             -- decision, bugfix, feature, etc.
  observation TEXT,
  concepts TEXT,         -- JSON array
  importance INTEGER,    -- 1-10
  agent_insights TEXT,   -- JSON object
  FOREIGN KEY (orchestration_id) REFERENCES orchestrations(id)
);

-- Full-text search index
CREATE VIRTUAL TABLE observations_fts USING fts5(
  observation,
  concepts,
  content=observations
);

-- Agent performance statistics
CREATE TABLE agent_stats (
  agent_id TEXT PRIMARY KEY,
  total_executions INTEGER DEFAULT 0,
  successful_executions INTEGER DEFAULT 0,
  failed_executions INTEGER DEFAULT 0,
  total_duration INTEGER DEFAULT 0,
  average_duration REAL,
  success_rate REAL
);

-- Pattern effectiveness
CREATE TABLE pattern_stats (
  pattern TEXT PRIMARY KEY,
  total_uses INTEGER DEFAULT 0,
  successful_uses INTEGER DEFAULT 0,
  failed_uses INTEGER DEFAULT 0,
  average_duration REAL,
  success_rate REAL
);

-- Successful agent collaborations
CREATE TABLE agent_collaborations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agents TEXT NOT NULL,        -- JSON array (sorted)
  pattern TEXT,
  success_count INTEGER DEFAULT 0,
  total_count INTEGER DEFAULT 0,
  success_rate REAL
);
```

#### API

**Initialization**:
```javascript
const MemoryStore = require('./.claude/core/memory-store');

const memoryStore = new MemoryStore({
  dbPath: '.claude/memory/orchestrations.db',
  enableFTS: true,        // Enable full-text search
  cacheSize: 64 * 1024    // 64MB cache
});

await memoryStore.initialize();
```

**Recording Orchestrations**:
```javascript
// Record orchestration
const id = memoryStore.recordOrchestration({
  pattern: 'parallel',
  agents: ['agent-1', 'agent-2'],
  task: { type: 'analyze', data: '...' },
  result: { findings: '...' },
  success: true,
  duration: 1250,  // ms
  metadata: { userId: '123' }
});

// Add observations (learnings)
memoryStore.addObservation(id, {
  type: 'decision',
  observation: 'Chose PostgreSQL for better ACID compliance',
  concepts: ['database', 'postgres', 'acid'],
  importance: 8,
  agentInsights: {
    'agent-1': 'Recommended for reliability',
    'agent-2': 'Confirmed performance adequate'
  }
});
```

**Searching Orchestrations**:
```javascript
// Keyword search (FTS5)
const results = memoryStore.searchOrchestrations({
  query: 'authentication security',
  limit: 10,
  minScore: 0.5
});

// Filter by criteria
const results = memoryStore.searchOrchestrations({
  pattern: 'parallel',
  agents: ['agent-1'],
  success: true,
  startDate: '2025-01-01',
  endDate: '2025-12-31',
  limit: 50
});

// Get by ID
const orchestration = memoryStore.getOrchestration(id);
```

**Statistics & Analytics**:
```javascript
// Agent performance
const agentStats = memoryStore.getAgentStats('agent-1');
// Returns:
// {
//   totalExecutions: 42,
//   successfulExecutions: 40,
//   failedExecutions: 2,
//   averageDuration: 1250,
//   successRate: 0.95
// }

// All agents
const allStats = memoryStore.getAgentStats();

// Pattern effectiveness
const patternStats = memoryStore.getPatternStats('parallel');

// Best collaborations
const collabs = memoryStore.getCollaborations({
  minSuccessRate: 0.8,
  minCount: 5
});
```

**Maintenance**:
```javascript
// Clean old records
memoryStore.cleanup({
  olderThan: '2024-01-01',  // Delete before this date
  keepMinimum: 100          // Always keep at least 100 records
});

// Rebuild FTS index
memoryStore.rebuildFTSIndex();

// Get database statistics
const stats = memoryStore.getDatabaseStats();
```

#### Performance Optimizations

- **WAL Mode**: Concurrent reads during writes
- **64MB Cache**: Faster queries
- **FTS5**: Optimized full-text search
- **Prepared Statements**: Reusable queries
- **NORMAL Synchronous**: Balance safety/performance

---

### 6. MemoryIntegration

**File**: `.claude/core/memory-integration.js` (683 lines)

**Purpose**: Hybrid bridge connecting hooks and MessageBus for memory operations

#### Features

- Hybrid hooks + MessageBus architecture
- Hooks for critical operations (memory save/load)
- Events for optional operations (AI categorization, metrics)
- Automatic coordination and setup
- Graceful degradation on component failures
- Usage tracking integration
- Comprehensive metrics

#### API

**Initialization**:
```javascript
const MemoryIntegration = require('./.claude/core/memory-integration');

const memoryIntegration = new MemoryIntegration(messageBus, {
  dbPath: '.claude/memory/orchestrations.db',
  enableMemory: true,
  enableAI: false,                    // AI categorization
  enableVectorStore: true,            // Semantic search
  contextTokenBudget: 2000,
  chromaUrl: 'http://localhost:8000'  // Optional
});

await memoryIntegration.initialize();
```

**Registering with Orchestrator**:
```javascript
const orchestrator = new AgentOrchestrator(messageBus);

// Memory integration automatically registers hooks and events
memoryIntegration.registerWithOrchestrator(orchestrator);

// Orchestrator now has:
// - beforeExecution hook → loads context
// - afterExecution hook → saves results
// - MessageBus event listeners → vectorization, AI categorization
```

**Manual Hook Execution** (Advanced):
```javascript
// Load context before execution
const enrichedContext = await memoryIntegration.loadContext({
  task: { type: 'analyze', topic: 'architecture' },
  agents: ['agent-1', 'agent-2'],
  tokenBudget: 2000
});

// Save results after execution
await memoryIntegration.saveResults({
  pattern: 'parallel',
  agents: ['agent-1', 'agent-2'],
  task: {...},
  result: {...},
  success: true,
  duration: 1250
});
```

**Statistics**:
```javascript
const stats = memoryIntegration.getStats();
// Returns:
// {
//   memoryStore: { enabled: true, recordCount: 42 },
//   vectorStore: { enabled: true, embeddingCount: 42 },
//   aiCategorizer: { enabled: false },
//   usageTracker: { enabled: true, totalCost: 1.25 },
//   cacheHitRate: 0.75
// }
```

#### Hook Registration Details

**beforeExecution Hook**:
- Priority: 10 (runs early)
- Loads relevant historical context
- Uses ContextRetriever for progressive disclosure
- Respects token budget
- Enriches task with memory context

**afterExecution Hook**:
- Priority: 90 (runs late)
- Saves orchestration to MemoryStore
- Tracks usage/costs via UsageTracker
- Returns result unchanged

**Event Subscriptions**:
- `orchestrator:execution:complete` → Vectorization + AI categorization (async)
- `agent:state-change` → Agent lifecycle tracking
- `orchestrator:pattern:selected` → Pattern selection logging

---

## Intelligence Layer Components

### 7. VectorStore

**File**: `.claude/core/vector-store.js` (962 lines)

**Purpose**: Semantic search using Chroma vector database

#### Features

- Chroma integration for vector similarity search
- Hybrid search (vector + FTS5 keywords)
- Circuit breaker pattern for resilience
- Graceful degradation (Chroma → FTS5 → Empty)
- Batch operations with partial success handling
- Lazy initialization with connection pooling
- Performance metrics tracking

#### API

**Initialization**:
```javascript
const VectorStore = require('./.claude/core/vector-store');

const vectorStore = new VectorStore(memoryStore, {
  chromaUrl: 'http://localhost:8000',
  collectionName: 'orchestrations',
  embeddingModel: 'all-MiniLM-L6-v2',
  circuitBreakerThreshold: 3,    // Failures before open
  circuitBreakerTimeout: 60000    // Reset after 60s
});

await vectorStore.initialize();
```

**Adding Orchestrations**:
```javascript
// Add single orchestration
await vectorStore.addOrchestration(orchestrationId, {
  pattern: 'parallel',
  task: { type: 'analyze', data: '...' },
  result: { findings: '...' },
  observations: ['Key insight 1', 'Key insight 2']
});

// Batch add
await vectorStore.addOrchestrationsBatch([
  { id: 1, ... },
  { id: 2, ... },
  { id: 3, ... }
]);
```

**Searching**:
```javascript
// Semantic similarity search
const results = await vectorStore.searchSimilar(
  'authentication security best practices',
  {
    limit: 10,
    threshold: 0.7,      // Min similarity score
    mode: 'hybrid'       // 'vector', 'fts', 'hybrid'
  }
);

// Returns:
// [
//   {
//     id: 42,
//     score: 0.85,
//     orchestration: {...}
//   },
//   // ...
// ]

// Vector-only search
const results = await vectorStore.searchSimilar(query, {
  mode: 'vector',
  limit: 10
});

// FTS-only search (faster, keyword-based)
const results = await vectorStore.searchSimilar(query, {
  mode: 'fts',
  limit: 10
});
```

**Maintenance**:
```javascript
// Get statistics
const stats = vectorStore.getStats();
// Returns:
// {
//   totalEmbeddings: 42,
//   circuitState: 'closed',
//   lastError: null,
//   cacheSize: 15
// }

// Clear cache
vectorStore.clearCache();

// Reset circuit breaker
vectorStore.resetCircuitBreaker();
```

#### Search Modes

**Hybrid** (default):
- Combines vector similarity (70%) + FTS5 keywords (30%)
- Best of both approaches
- Weighted score merging

**Vector**:
- Pure semantic similarity
- Understands meaning and context
- ~100ms per query

**FTS**:
- Keyword-based search
- Fast (<1ms)
- Exact term matching

#### Circuit Breaker States

**Closed** (normal):
- All requests processed
- Chroma calls allowed

**Open** (failure mode):
- Chroma calls blocked
- Falls back to FTS5 only
- Auto-reset after timeout

**Half-Open** (testing):
- Next request tests Chroma
- Success → close circuit
- Failure → reopen circuit

---

### 8. ContextRetriever

**File**: `.claude/core/context-retriever.js` (867 lines)

**Purpose**: Intelligent context loading with progressive disclosure

#### Features

- Progressive disclosure (Layer 1: Index, Layer 2: Details)
- Token-aware loading with 20% safety buffer
- LRU cache with TTL expiration (100 entries, 5min TTL)
- Smart truncation preserving valuable data
- Integration with VectorStore and MemoryStore
- Performance metrics (cache hit rate, duration)

#### API

**Initialization**:
```javascript
const ContextRetriever = require('./.claude/core/context-retriever');

const retriever = new ContextRetriever(memoryStore, vectorStore, {
  defaultTokenBudget: 2000,
  tokenSafetyBuffer: 0.2,    // 20% buffer
  cacheSize: 100,
  cacheTTL: 300000           // 5 minutes
});
```

**Retrieving Context**:
```javascript
// Retrieve context for task
const context = await retriever.retrieveContext(
  { type: 'analyze', topic: 'authentication' },
  {
    maxTokens: 2000,
    agentIds: ['agent-1', 'agent-2'],
    includeDetails: true,     // Load Layer 2
    minRelevance: 0.7
  }
);

// Returns:
// {
//   orchestrations: [
//     {
//       id: 42,
//       summary: '...',           // Layer 1
//       relevanceScore: 0.85,
//       details: {...}            // Layer 2 (if includeDetails)
//     },
//     // ...
//   ],
//   tokenCost: 1500,
//   fromCache: false,
//   loadedDetails: true
// }
```

**Layer-Specific Loading**:
```javascript
// Load Layer 1 only (index)
const layer1 = await retriever.loadLayer1(task, {
  maxTokens: 500,
  limit: 20
});

// Load Layer 2 (details) for specific IDs
const layer2 = await retriever.loadLayer2([42, 43, 44], {
  maxTokens: 1500
});
```

**Cache Management**:
```javascript
// Get cache statistics
const stats = retriever.getCacheStats();
// Returns:
// {
//   size: 15,
//   maxSize: 100,
//   hitRate: 0.75,
//   hits: 30,
//   misses: 10
// }

// Clear cache
retriever.clearCache();
```

#### Progressive Disclosure Strategy

**Layer 1** (Index - Cheap):
- Orchestration IDs
- Brief summaries (1-2 sentences)
- Relevance scores
- Metadata (pattern, agents, date)
- ~5-10 tokens per item

**Layer 2** (Details - Expensive):
- Full orchestration records
- Complete observations
- Result summaries
- Agent insights
- ~100-500 tokens per item

**Loading Strategy**:
1. Always load Layer 1 first (cheap overview)
2. Calculate remaining token budget
3. Load Layer 2 for most relevant items
4. Truncate if budget exceeded

#### Token Budget Management

**Budget Calculation**:
```
effectiveBudget = maxTokens * (1 - safetyBuffer)
                = 2000 * 0.8
                = 1600 tokens
```

**Truncation Priority** (preserve in order):
1. Core fields (id, pattern, agents, success)
2. Observations (key learnings)
3. Result summary
4. Metadata

---

### 9. AICategorizationService

**File**: `.claude/core/ai-categorizer.js` (700 lines)

**Purpose**: Extract structured observations using AI with rule-based fallback

#### Features

- AI-powered observation extraction using Claude API
- Rule-based fallback for reliability
- Batch processing with concurrency control (3 concurrent)
- 6 categorization types (decision, bugfix, feature, etc.)
- Comprehensive error handling
- Metrics tracking (AI vs rule-based usage)
- Structured JSON output validation

#### API

**Initialization**:
```javascript
const AICategorizationService = require('./.claude/core/ai-categorizer');

const categorizer = new AICategorizationService({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-3-5-sonnet-20241022',
  temperature: 0.3,           // Low for consistency
  maxTokens: 1024,
  concurrency: 3,             // Parallel requests
  fallbackToRules: true       // Use rules if API fails
});
```

**Categorizing Orchestrations**:
```javascript
// Categorize single orchestration
const observations = await categorizer.categorize({
  pattern: 'parallel',
  task: { type: 'analyze', topic: 'authentication' },
  result: { findings: '...', decision: 'Use OAuth2' },
  agents: ['agent-1', 'agent-2']
});

// Returns array of observations:
// [
//   {
//     type: 'decision',
//     observation: 'Chose OAuth2 for better security',
//     concepts: ['authentication', 'oauth2', 'security'],
//     importance: 8,
//     quality: 'ai',  // or 'rule-based'
//     agentInsights: {
//       'agent-1': 'Recommended for compliance',
//       'agent-2': 'Confirmed ease of integration'
//     }
//   },
//   // ...
// ]
```

**Batch Categorization**:
```javascript
// Process multiple orchestrations
const results = await categorizer.categorizeBatch([
  { pattern: 'parallel', task: {...}, result: {...} },
  { pattern: 'consensus', task: {...}, result: {...} },
  { pattern: 'debate', task: {...}, result: {...} }
]);

// Returns array of observation arrays
// Respects concurrency limit (3 parallel)
```

**Statistics**:
```javascript
const stats = categorizer.getStats();
// Returns:
// {
//   totalCategorizations: 42,
//   aiCategorizations: 38,
//   ruleBased: 4,
//   failures: 0,
//   averageDuration: 1850  // ms
// }
```

#### Categorization Types

1. **decision**: Strategic choices made
   - Keywords: "decided", "chose", "selected"
   - Example: "Decided to use PostgreSQL for better ACID compliance"

2. **bugfix**: Bug resolution
   - Keywords: "fixed", "resolved", "bug"
   - Example: "Fixed authentication token expiration issue"

3. **feature**: New functionality added
   - Keywords: "added", "implemented", "new feature"
   - Example: "Implemented two-factor authentication"

4. **pattern-usage**: Multi-agent pattern application
   - Keywords: "parallel", "consensus", "debate"
   - Example: "Used consensus pattern for framework selection"

5. **discovery**: New insight or learning
   - Keywords: "learned", "discovered", "insight"
   - Example: "Discovered performance bottleneck in API calls"

6. **refactor**: Code improvement
   - Keywords: "refactored", "improved", "optimized"
   - Example: "Refactored authentication module for better maintainability"

#### Fallback Strategy

**AI Categorization** (preferred):
- Uses Claude API
- Comprehensive analysis
- Agent-specific insights
- ~2s per orchestration

**Rule-Based Categorization** (fallback):
- Keyword matching
- Pattern recognition
- Always available
- <1ms per orchestration

**Quality Indicator**:
- `quality: 'ai'` - AI-generated
- `quality: 'rule-based'` - Fallback used

---

## Analytics Components

### 10. CostCalculator

**File**: `.claude/core/cost-calculator.js` (352 lines)

**Purpose**: Calculate costs for AI model token usage

#### Features

- Multi-model pricing (Claude, GPT-4o, o1-preview)
- Cache token pricing (creation/read)
- Savings calculation (cache vs no-cache)
- Monthly cost projection with confidence levels
- Model cost comparison
- Custom pricing overrides
- Currency formatting

#### API

**Initialization**:
```javascript
const CostCalculator = require('./.claude/core/cost-calculator');

const calculator = new CostCalculator({
  // Optional: Override default pricing
  customPricing: {
    'claude-sonnet-4-5': {
      input: 3.00,
      output: 15.00,
      cacheCreation: 3.75,
      cacheRead: 0.30
    }
  }
});
```

**Calculating Costs**:
```javascript
// Calculate cost for single execution
const cost = calculator.calculateCost({
  model: 'claude-sonnet-4-5',
  inputTokens: 1000,
  outputTokens: 500,
  cacheCreationTokens: 800,
  cacheReadTokens: 200
});

// Returns:
// {
//   inputCost: 0.003,
//   outputCost: 0.0075,
//   cacheCreationCost: 0.003,
//   cacheReadCost: 0.00006,
//   totalCost: 0.01356,
//   cacheSavings: 0.0024,  // vs no cache
//   formatted: '$0.0136'
// }
```

**Cache Savings**:
```javascript
// Calculate savings from cache usage
const savings = calculator.calculateCacheSavings({
  model: 'claude-sonnet-4-5',
  cacheReadTokens: 1000,
  cacheCreationTokens: 200
});

// Returns:
// {
//   withoutCache: 0.003,      // Cost if no cache
//   withCache: 0.00135,       // Actual cost
//   savings: 0.00165,         // Saved amount
//   savingsPercent: 55,       // Percentage saved
//   formatted: '$0.00165 saved (55%)'
// }
```

**Cost Projections**:
```javascript
// Project monthly cost
const projection = calculator.projectMonthlyCost({
  dailyCosts: [1.25, 1.50, 1.30, 1.40, 1.35],  // Last 5 days
  confidence: 'medium'  // 'low', 'medium', 'high'
});

// Returns:
// {
//   projectedMonthlyCost: 41.40,
//   confidence: 'medium',
//   daysAnalyzed: 5,
//   averageDailyCost: 1.38,
//   formatted: '$41.40/month (medium confidence)'
// }
```

**Model Comparison**:
```javascript
// Compare costs across models
const comparison = calculator.compareModels(
  ['claude-sonnet-4-5', 'claude-sonnet-4', 'gpt-4o'],
  {
    inputTokens: 1000,
    outputTokens: 500
  }
);

// Returns array sorted by cost:
// [
//   {
//     model: 'claude-sonnet-4',
//     cost: 0.0105,
//     formatted: '$0.0105'
//   },
//   {
//     model: 'claude-sonnet-4-5',
//     cost: 0.0105,
//     formatted: '$0.0105'
//   },
//   {
//     model: 'gpt-4o',
//     cost: 0.0125,
//     formatted: '$0.0125'
//   }
// ]
```

#### Supported Models

| Model | Input $/1M | Output $/1M | Cache Create | Cache Read |
|-------|------------|-------------|--------------|------------|
| claude-sonnet-4-5 | 3.00 | 15.00 | 3.75 | 0.30 |
| claude-sonnet-4 | 3.00 | 15.00 | 3.75 | 0.30 |
| claude-opus-4 | 15.00 | 75.00 | 18.75 | 1.50 |
| gpt-4o | 5.00 | 15.00 | N/A | N/A |
| o1-preview | 15.00 | 60.00 | N/A | N/A |

---

### 11. UsageTracker

**File**: `.claude/core/usage-tracker.js` (849 lines)

**Purpose**: Budget tracking and usage monitoring

#### Features

- Records token usage per orchestration with cost calculation
- Tracks budget consumption with configurable alerts
- Per-agent and per-pattern cost breakdowns
- Real-time session monitoring (in-memory cache)
- Budget threshold detection (daily/monthly)
- Automatic cleanup of old records
- Graceful degradation on failures

#### API

**Initialization**:
```javascript
const UsageTracker = require('./.claude/core/usage-tracker');

const tracker = new UsageTracker(memoryStore, costCalculator, {
  dailyBudget: 10.00,        // USD
  monthlyBudget: 200.00,     // USD
  warningThreshold: 0.8,     // 80% = warning
  criticalThreshold: 0.95,   // 95% = critical
  retentionDays: 90          // Keep 90 days
});
```

**Recording Usage**:
```javascript
// Record usage for orchestration
await tracker.recordUsage({
  orchestrationId: 42,
  model: 'claude-sonnet-4-5',
  inputTokens: 1000,
  outputTokens: 500,
  cacheCreationTokens: 800,
  cacheReadTokens: 200,
  pattern: 'parallel',
  agents: ['agent-1', 'agent-2'],
  metadata: { userId: '123' }
});

// Automatically calculates cost and checks budgets
```

**Checking Budgets**:
```javascript
// Get budget status
const status = await tracker.getBudgetStatus();

// Returns:
// {
//   daily: {
//     budget: 10.00,
//     spent: 7.50,
//     remaining: 2.50,
//     percentUsed: 75,
//     status: 'ok',  // 'ok', 'warning', 'critical', 'exceeded'
//     projectedTotal: 9.80
//   },
//   monthly: {
//     budget: 200.00,
//     spent: 145.00,
//     remaining: 55.00,
//     percentUsed: 72.5,
//     status: 'ok'
//   }
// }

// Check if within budget
const withinBudget = tracker.isWithinBudget();  // boolean
```

**Cost Breakdowns**:
```javascript
// By agent
const agentCosts = await tracker.getAgentCosts({
  startDate: '2025-01-01',
  endDate: '2025-01-31'
});

// Returns:
// [
//   {
//     agentId: 'agent-1',
//     totalCost: 12.50,
//     orchestrationCount: 42,
//     averageCost: 0.30,
//     totalTokens: 125000
//   },
//   // ...
// ]

// By pattern
const patternCosts = await tracker.getPatternCosts({
  startDate: '2025-01-01',
  endDate: '2025-01-31'
});
```

**Session Monitoring**:
```javascript
// Get current session usage
const session = tracker.getSessionUsage();

// Returns:
// {
//   orchestrationCount: 5,
//   totalCost: 1.25,
//   totalTokens: 25000,
//   startTime: '2025-01-15T10:00:00Z',
//   duration: 3600000  // ms
// }

// Reset session
tracker.resetSession();
```

**Cleanup**:
```javascript
// Clean old records
const deleted = await tracker.cleanup({
  olderThan: 90  // days
});

console.log(`Deleted ${deleted} old records`);
```

#### Budget Alerts

**Status Levels**:
- **ok**: <80% of budget used
- **warning**: 80-95% of budget used
- **critical**: 95-100% of budget used
- **exceeded**: >100% of budget used

**Alert Events**:
Tracker publishes MessageBus events:
- `usage:budget:warning` - 80% threshold crossed
- `usage:budget:critical` - 95% threshold crossed
- `usage:budget:exceeded` - Budget exceeded

---

## Agent System Components

### 12. AgentLoader

**File**: `.claude/core/agent-loader.js` (350 lines)

**Purpose**: Auto-discovery and loading of YAML-based agents

#### Features

- Recursively walks `.claude/agents/` directory
- Parses YAML frontmatter from `.md` files
- Extracts instructions (content after frontmatter)
- Infers category from directory structure
- Validates required fields
- Generates agent statistics
- Rich query API

#### API

**Initialization**:
```javascript
const AgentLoader = require('./.claude/core/agent-loader');

const loader = new AgentLoader({
  agentsDir: '.claude/agents/',
  autoLoad: true,                    // Load on init
  validateSchema: true               // Validate YAML
});

await loader.initialize();
```

**Loading Agents**:
```javascript
// Load all agents
const agents = await loader.loadAll();

// Returns map:
// {
//   'research-analyst': {
//     name: 'research-analyst',
//     displayName: 'Research Analyst',
//     model: 'claude-sonnet-4-5',
//     temperature: 0.7,
//     maxTokens: 8000,
//     capabilities: ['deep-research', 'competitive-analysis'],
//     category: 'research',
//     phase: 'research',
//     priority: 'high',
//     instructions: '# Research Analyst Agent\n...',
//     tools: ['Read', 'Grep', 'WebSearch'],
//     tags: ['analysis', 'research']
//   },
//   // ...
// }

// Reload agents (hot-reload)
await loader.reload();
```

**Querying Agents**:
```javascript
// By category
const researchAgents = loader.getAgentsByCategory('research');

// By phase
const planningAgents = loader.getAgentsByPhase('planning');

// By capability
const analysisAgents = loader.getAgentsByCapability('deep-research');

// By tag
const architectureAgents = loader.getAgentsByTag('architecture');

// By model
const sonnetAgents = loader.getAgentsByModel('claude-sonnet-4-5');

// Get single agent
const agent = loader.getAgent('research-analyst');
```

**Best Match Selection**:
```javascript
// Find best agent for task
const agent = loader.getBestAgentForTask({
  type: 'research',
  complexity: 'high',
  phase: 'planning',
  requiredCapabilities: ['deep-research'],
  preferredModel: 'claude-sonnet-4-5'
});

// Returns agent with highest match score
```

**Statistics**:
```javascript
const stats = loader.getStatistics();

// Returns:
// {
//   totalAgents: 28,
//   byCategory: {
//     research: 6,
//     planning: 4,
//     design: 5,
//     // ...
//   },
//   byPhase: {
//     research: 6,
//     planning: 4,
//     // ...
//   },
//   byModel: {
//     'claude-sonnet-4-5': 18,
//     'claude-sonnet-4': 10
//   }
// }
```

#### Agent YAML Format

```yaml
---
# Required Fields
name: agent-id                    # Unique identifier
display_name: Human Name          # Display name

# Model Configuration
model: claude-sonnet-4-5          # AI model to use
temperature: 0.7                  # 0.0-1.0
max_tokens: 8000                  # Max response tokens

# Capabilities & Classification
capabilities:                     # What agent can do
  - capability-1
  - capability-2
category: research                # Agent category
phase: research                   # Development phase
priority: high                    # low, medium, high

# Tools Available
tools:                            # Claude Code tools
  - Read
  - Grep
  - WebSearch

# Discovery Tags
tags:                             # Searchable tags
  - tag1
  - tag2
---

# Agent Instructions
[Markdown instructions for the agent...]
```

---

## Component Interaction

### Execution Flow

```
1. USER REQUEST
   ↓
2. AgentOrchestrator.executeParallel()
   ↓
3. LifecycleHooks.beforeExecution
   ├─ MemoryIntegration.loadContext()
   ├─ ContextRetriever.retrieveContext()
   │  ├─ VectorStore.searchSimilar() → [Try Vector] → [Fallback FTS]
   │  └─ MemoryStore.searchOrchestrations()
   ↓
4. [Context returned to orchestrator]
   ↓
5. MessageBus.publish('task', agents)
   ↓
6. Agents execute tasks (parallel/sequential)
   ↓
7. LifecycleHooks.afterExecution
   ├─ MemoryStore.recordOrchestration()
   ├─ UsageTracker.recordUsage()
   └─ Return result
   ↓
8. MessageBus.publish('execution:complete') [async]
   ├─ VectorStore.addOrchestration() [vectorization]
   └─ AICategorizationService.categorize() [observations]
   ↓
9. RESULT RETURNED TO USER
```

### Data Flow

```
User Input
  ↓
Task Definition
  ↓
[beforeExecution Hook]
  ↓
Historical Context (from VectorStore + MemoryStore)
  ↓
Enriched Task (task + memory context)
  ↓
Agent Execution
  ↓
Raw Results
  ↓
[afterExecution Hook]
  ↓
Persistence (MemoryStore, UsageTracker)
  ↓
[Async Events]
  ↓
Vectorization + AI Categorization
  ↓
Final Result (with usage stats)
```

---

## Configuration Reference

### Global Configuration

**Environment Variables**:
```bash
# AI API Keys
ANTHROPIC_API_KEY=sk-ant-...

# Database Paths
MEMORY_DB_PATH=.claude/memory/orchestrations.db

# Vector Store
CHROMA_URL=http://localhost:8000

# Budget Limits
DAILY_BUDGET=10.00
MONTHLY_BUDGET=200.00

# Logging
LOG_LEVEL=info
LOG_FILE=.claude/logs/orchestrator.log
```

### Component-Specific Configuration

See each component's API section above for detailed configuration options.

---

## API Reference

For complete API documentation, see:
- **[API Reference](API-REFERENCE.md)** - Full API documentation
- **[Multi-Agent Guide](MULTI-AGENT-GUIDE.md)** - Usage examples
- **Source Code** - `.claude/core/` directory

---

**Version**: 1.0.0
**Last Updated**: 2025-11-09
