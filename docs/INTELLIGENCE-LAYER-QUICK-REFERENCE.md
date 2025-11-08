# Intelligence Layer Quick Reference

**Quick reference guide for implementation - see INTELLIGENCE-LAYER-ARCHITECTURE.md for full details**

---

## Component Overview

### VectorStore (.claude/core/vector-store.js)

**Purpose:** Semantic search with Chroma vector database

**Key Methods:**
```javascript
await vectorStore.initialize()
await vectorStore.addOrchestration(id, data)
await vectorStore.searchSimilar(query, options)
await vectorStore.getRecommendations(context, limit)
```

**Fallback Strategy:** Automatically falls back to FTS5-only search if Chroma unavailable

**Dependencies:**
- MemoryStore (for FTS5 fallback)
- chromadb package
- Logger

---

### ContextRetriever (.claude/core/context-retriever.js)

**Purpose:** Token-aware progressive context loading

**Key Methods:**
```javascript
await contextRetriever.retrieveContext(context, options)
await contextRetriever.loadLayer1(query, filters)  // Index only
await contextRetriever.loadLayer2(ids, budget)     // Full details
```

**Progressive Disclosure:**
- **Layer 1:** Lightweight index (~100 tokens)
- **Layer 2:** Full details (on-demand, token-aware)

**Dependencies:**
- MemoryStore
- VectorStore
- TokenCounter

---

### AICategorizationService (.claude/core/ai-categorizer.js)

**Purpose:** AI-powered observation extraction

**Key Methods:**
```javascript
await aiCategorizer.categorizeOrchestration(orchestration)
await aiCategorizer.categorizeOrchestrationsBatch(orchestrations, options)
```

**Fallback Strategy:** Rule-based categorization if AI unavailable

**Dependencies:**
- Anthropic SDK
- Logger

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      Intelligence Layer                         │
│                                                                  │
│  ┌────────────────┐  ┌─────────────────┐  ┌──────────────────┐ │
│  │  VectorStore   │  │ ContextRetriever│  │ AICategorizationService
│  │                │  │                 │  │                  │ │
│  │ Chroma + FTS5  │  │ Progressive     │  │ AI + Rules       │ │
│  │ Hybrid Search  │  │ Token-Aware     │  │ Async Events     │ │
│  └────────┬───────┘  └────────┬────────┘  └────────┬─────────┘ │
│           │                   │                     │           │
└───────────┼───────────────────┼─────────────────────┼───────────┘
            │                   │                     │
┌───────────┼───────────────────┼─────────────────────┼───────────┐
│                         Core Architecture                        │
│           │                   │                     │           │
│  ┌────────▼───────┐  ┌────────▼────────┐  ┌────────▼─────────┐ │
│  │  MemoryStore   │  │ LifecycleHooks  │  │   MessageBus     │ │
│  │  SQLite+FTS5   │  │ beforeExec Hook │  │ orchestrator:    │ │
│  └────────────────┘  └─────────────────┘  │ complete Event   │ │
│                                            └──────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Orchestration Execution → Memory Storage

```
Execute Orchestration
        ↓
afterExecution Hook (sync, guaranteed)
        ↓
MessageBus Event: orchestrator:execution:complete (async, optional)
        ↓
MemoryIntegration Handler
        ↓
┌───────┼───────┬───────────────────────────┐
│       │       │                           │
↓       ↓       ↓                           ↓
Save to Add to  AI Categorization          Update Stats
SQLite  Chroma  (async, non-blocking)
```

### 2. Context Retrieval (Next Orchestration)

```
beforeExecution Hook
        ↓
ContextRetriever.retrieveContext()
        ↓
┌───────────────┴──────────────┐
│                              │
↓                              ↓
Layer 1: Index               Layer 2: Full Details
(VectorStore.searchSimilar)  (MemoryStore.getById)
        ↓                              ↓
Hybrid Search:                   Token-aware loading
- Chroma vectors                 with truncation
- FTS5 keywords
        ↓
Merge & deduplicate
        ↓
Return context to orchestrator
```

---

## Graceful Degradation Matrix

| Component | Failure | Fallback | Impact |
|-----------|---------|----------|--------|
| VectorStore | Chroma down | Use FTS5 only | Less semantic relevance |
| ContextRetriever | Retrieval fails | Empty context | No historical context |
| AICategorizationService | API fails | Rule-based | Lower quality observations |

**All failures are non-fatal - orchestration continues**

---

## Key Configuration Options

### VectorStore

```javascript
const vectorStore = new VectorStore(memoryStore, {
  chromaHost: 'http://localhost:8000',
  collectionName: 'orchestrations',
  embeddingModel: 'all-MiniLM-L6-v2',
  fallbackToFTS: true,           // Enable FTS5 fallback
  batchSize: 10,
  maxRetries: 3
});
```

### ContextRetriever

```javascript
const contextRetriever = new ContextRetriever(memoryStore, vectorStore, TokenCounter, {
  maxTokens: 2000,               // Token budget
  minRelevanceScore: 0.6,        // Similarity threshold
  cacheSize: 100,                // LRU cache size
  cacheTTL: 3600000,             // 1 hour
  enableProgressive: true,       // Layer 1 + Layer 2
  layer1Limit: 3,                // Index entries
  layer2Limit: 5                 // Full details
});
```

### AICategorizationService

```javascript
const aiCategorizer = new AICategorizationService(apiKey, {
  model: 'claude-3-5-sonnet-20241022',
  maxTokens: 500,
  temperature: 0.3,
  fallbackToRules: true,         // Rule-based fallback
  retries: 2
});
```

---

## Integration with MemoryIntegration

### Enhanced beforeExecution Hook

```javascript
async _hookBeforeExecution(context) {
  if (options?.useMemory === false) {
    return context;
  }

  // Use ContextRetriever for smart loading
  const memoryContext = await this.contextRetriever.retrieveContext({
    task: context.task,
    agentIds: context.agentIds,
    pattern: context.pattern
  });

  return {
    ...context,
    memoryContext  // Available to agents during execution
  };
}
```

### Enhanced Event Handler

```javascript
async _handleOrchestrationComplete(event) {
  // 1. Save to SQLite (sync)
  const orchestrationId = this.memoryStore.recordOrchestration(data);

  // 2. Add to VectorStore (async, non-blocking)
  this.vectorStore.addOrchestration(orchestrationId, data)
    .catch(err => this.logger.warn('Vector store failed', { error: err.message }));

  // 3. AI Categorization (async, non-blocking)
  if (this.aiCategorizer) {
    this.aiCategorizer.categorizeOrchestration(data)
      .then(categorization => {
        this.memoryStore.recordObservation(orchestrationId, {
          type: categorization.type,
          content: categorization.observation,
          concepts: categorization.concepts,
          importance: categorization.importance,
          agentInsights: categorization.agentInsights,
          recommendations: categorization.recommendations
        });
      })
      .catch(err => this.logger.warn('AI categorization failed', { error: err.message }));
  }
}
```

---

## Testing Checklist

### VectorStore Tests
- [ ] Chroma connection (success + failure)
- [ ] Hybrid search (vector + FTS5)
- [ ] Fallback to FTS5 on Chroma failure
- [ ] Batch add with partial failures
- [ ] Search result merging and deduplication
- [ ] Circuit breaker pattern

### ContextRetriever Tests
- [ ] Progressive disclosure (Layer 1 + Layer 2)
- [ ] Token budget enforcement
- [ ] LRU cache (hit + miss + eviction)
- [ ] Cache expiration
- [ ] Truncation logic
- [ ] Empty context on failure

### AICategorizationService Tests
- [ ] AI categorization (successful)
- [ ] Rule-based fallback
- [ ] Batch processing with concurrency
- [ ] Retry logic
- [ ] Response validation
- [ ] API rate limiting handling

### Integration Tests
- [ ] Full orchestration → memory → retrieval cycle
- [ ] Context enrichment during execution
- [ ] Graceful degradation scenarios
- [ ] Performance benchmarks

---

## Performance Targets

| Operation | Target | Max |
|-----------|--------|-----|
| VectorStore.searchSimilar() | <100ms | <500ms |
| ContextRetriever.retrieveContext() | <200ms | <1s |
| AICategorizationService.categorize() | <2s | <5s |
| Full orchestration overhead | <300ms | <1.5s |

---

## Common Patterns

### Error Handling

```javascript
// Try-Fallback-Log pattern
try {
  return await primaryStrategy();
} catch (error) {
  logger.warn('Primary failed, using fallback', { error: error.message });
  try {
    return await fallbackStrategy();
  } catch (fallbackError) {
    logger.error('All strategies failed', { error: fallbackError.message });
    return defaultValue;
  }
}
```

### Lazy Initialization

```javascript
async _ensureInitialized() {
  if (this.initializationPromise) {
    return this.initializationPromise;
  }
  this.initializationPromise = this.initialize();
  return this.initializationPromise;
}
```

### Batch Processing

```javascript
const chunks = this._chunkArray(items, batchSize);
for (const chunk of chunks) {
  try {
    await this._processChunk(chunk);
  } catch (error) {
    logger.warn('Chunk failed', { error: error.message });
    // Continue with next chunk
  }
}
```

---

## Implementation Order

1. **VectorStore** (2-3 days)
   - Core class structure
   - Chroma integration
   - Hybrid search
   - Tests

2. **ContextRetriever** (2-3 days)
   - Core class structure
   - Progressive disclosure
   - LRU cache
   - Tests

3. **AICategorizationService** (2-3 days)
   - Core class structure
   - Claude API integration
   - Rule-based fallback
   - Tests

4. **Integration** (2 days)
   - MemoryIntegration updates
   - End-to-end tests
   - Performance testing
   - Documentation

**Total: 8-11 days**

---

## Dependencies to Install

```bash
npm install chromadb @anthropic-ai/sdk
```

---

## File Locations

```
.claude/core/
├── vector-store.js           # NEW - VectorStore implementation
├── context-retriever.js      # NEW - ContextRetriever implementation
├── ai-categorizer.js         # NEW - AICategorizationService implementation
├── memory-integration.js     # MODIFY - Add intelligence layer
├── memory-store.js           # EXISTING - No changes needed
├── lifecycle-hooks.js        # EXISTING - No changes needed
├── token-counter.js          # EXISTING - Used by ContextRetriever
└── logger.js                 # EXISTING - Used by all components
```

---

For complete architectural details, see: **INTELLIGENCE-LAYER-ARCHITECTURE.md**
