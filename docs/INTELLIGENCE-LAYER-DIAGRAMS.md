# Intelligence Layer Architecture Diagrams

Visual diagrams for the Intelligence Layer components and data flows.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         INTELLIGENCE LAYER                                  │
│                                                                             │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐ │
│  │   VectorStore        │  │  ContextRetriever    │  │  AICategorizationService
│  │                      │  │                      │  │                  │ │
│  │ ┌──────────────┐     │  │ ┌──────────────┐    │  │ ┌──────────────┐ │ │
│  │ │ Chroma DB    │     │  │ │ Layer 1      │    │  │ │ Claude API   │ │ │
│  │ │ Vector Store │     │  │ │ Index (100t) │    │  │ │ Categorizer  │ │ │
│  │ └──────┬───────┘     │  │ └──────┬───────┘    │  │ └──────┬───────┘ │ │
│  │        │ Fallback    │  │        │            │  │        │Fallback │ │
│  │ ┌──────▼───────┐     │  │ ┌──────▼───────┐    │  │ ┌──────▼───────┐ │ │
│  │ │ FTS5 Search  │     │  │ │ Layer 2      │    │  │ │ Rule-based   │ │ │
│  │ │ (Keyword)    │     │  │ │ Details (on- │    │  │ │ Categorizer  │ │ │
│  │ └──────────────┘     │  │ │ demand)      │    │  │ └──────────────┘ │ │
│  │                      │  │ └──────────────┘    │  │                  │ │
│  │ ┌──────────────┐     │  │ ┌──────────────┐    │  │                  │ │
│  │ │ Hybrid       │     │  │ │ LRU Cache    │    │  │                  │ │
│  │ │ Merge Logic  │     │  │ │ (100 entries)│    │  │                  │ │
│  │ └──────────────┘     │  │ └──────────────┘    │  │                  │ │
│  └──────────┬───────────┘  └──────────┬──────────┘  └────────┬─────────┘ │
│             │                         │                      │           │
└─────────────┼─────────────────────────┼──────────────────────┼───────────┘
              │                         │                      │
              │                         │                      │
┌─────────────┼─────────────────────────┼──────────────────────┼───────────┐
│                             CORE ARCHITECTURE                             │
│             │                         │                      │           │
│  ┌──────────▼───────────┐  ┌──────────▼────────────┐  ┌──────▼─────────┐ │
│  │   MemoryStore        │  │  LifecycleHooks       │  │  MessageBus    │ │
│  │                      │  │                       │  │                │ │
│  │ ┌──────────────┐     │  │ ┌───────────────┐    │  │ Topics:        │ │
│  │ │ SQLite DB    │     │  │ │ beforeExec    │    │  │ • orchestrator:│ │
│  │ │ Orchestrations│    │  │ │ (critical)    │    │  │   complete     │ │
│  │ └──────────────┘     │  │ └───────────────┘    │  │ • agent:       │ │
│  │ ┌──────────────┐     │  │ ┌───────────────┐    │  │   state-change │ │
│  │ │ FTS5 Index   │     │  │ │ afterExec     │    │  │ • pattern:     │ │
│  │ │ (observations)│    │  │ │ (guaranteed)  │    │  │   selected     │ │
│  │ └──────────────┘     │  │ └───────────────┘    │  │                │ │
│  │ ┌──────────────┐     │  │ ┌───────────────┐    │  │ Fault-isolated │ │
│  │ │ Statistics   │     │  │ │ onError       │    │  │ subscribers    │ │
│  │ │ (patterns,   │     │  │ │ (recovery)    │    │  │                │ │
│  │ │  agents)     │     │  │ └───────────────┘    │  │                │ │
│  │ └──────────────┘     │  │                       │  │                │ │
│  └──────────────────────┘  └───────────────────────┘  └────────────────┘ │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Orchestration → Memory

```
                           ORCHESTRATION EXECUTION
                                     │
                                     │
                    ┌────────────────▼────────────────┐
                    │   AgentOrchestrator.executeParallel()
                    │                                 │
                    │   1. Execute agents             │
                    │   2. Collect results            │
                    │   3. Synthesize output          │
                    └────────────────┬────────────────┘
                                     │
                    ┌────────────────▼────────────────┐
                    │   LIFECYCLE HOOK: afterExecution│
                    │   (SYNCHRONOUS, GUARANTEED)     │
                    │                                 │
                    │   • Ensures critical operations │
                    │   • Blocks until complete       │
                    └────────────────┬────────────────┘
                                     │
                    ┌────────────────▼────────────────┐
                    │   MessageBus.publish()          │
                    │   Topic: orchestrator:complete  │
                    │   (ASYNCHRONOUS, OPTIONAL)      │
                    │                                 │
                    │   • Fire-and-forget             │
                    │   • Fault-isolated              │
                    └────────────────┬────────────────┘
                                     │
                    ┌────────────────▼────────────────┐
                    │   MemoryIntegration Handler     │
                    │   _handleOrchestrationComplete()│
                    └────────────────┬────────────────┘
                                     │
           ┌─────────────────────────┼─────────────────────────┐
           │                         │                         │
           ▼                         ▼                         ▼
┌──────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│  MemoryStore     │   │  VectorStore         │   │  AICategorizationService
│  .recordOrchestration()   .addOrchestration()    .categorizeOrchestration()
│                  │   │                      │   │                      │
│  [SYNC]          │   │  [ASYNC]             │   │  [ASYNC]             │
│  SQLite write    │   │  Chroma embedding    │   │  Claude API call     │
│  FTS5 index      │   │  Vector insert       │   │  Observation extract │
│  Stats update    │   │  Fallback to FTS5    │   │  Rule-based fallback │
│                  │   │  on error            │   │  on error            │
└──────────────────┘   └──────────┬───────────┘   └──────────┬───────────┘
                                  │                          │
                                  │ (on failure)             │
                                  ▼                          ▼
                       ┌──────────────────┐     ┌──────────────────────┐
                       │  Log warning     │     │  MemoryStore         │
                       │  Continue        │     │  .recordObservation()│
                       └──────────────────┘     │                      │
                                                │  Save extracted      │
                                                │  observation         │
                                                └──────────────────────┘
```

---

## Data Flow: Context Retrieval

```
                      NEXT ORCHESTRATION STARTS
                                │
                                │
               ┌────────────────▼────────────────┐
               │   LIFECYCLE HOOK: beforeExecution
               │   (SYNCHRONOUS, CRITICAL PATH)  │
               └────────────────┬────────────────┘
                                │
               ┌────────────────▼────────────────┐
               │   ContextRetriever              │
               │   .retrieveContext()            │
               │                                 │
               │   Input: { task, agents, pattern }
               └────────────────┬────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   Check LRU Cache     │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │   Cache Hit?          │
                    └───┬───────────────┬───┘
                 YES    │               │ NO
                        │               │
                        ▼               ▼
              ┌─────────────┐   ┌──────────────────┐
              │ Return      │   │  Progressive     │
              │ Cached      │   │  Disclosure      │
              │ Context     │   └──────┬───────────┘
              └─────────────┘          │
                                       │
                    ┌──────────────────▼──────────────────┐
                    │   LAYER 1: Load Index (Lightweight) │
                    └──────────────────┬──────────────────┘
                                       │
                    ┌──────────────────▼──────────────────┐
                    │   VectorStore.searchSimilar()       │
                    │                                     │
                    │   Hybrid Search:                    │
                    │   ┌─────────────┐  ┌─────────────┐ │
                    │   │ Chroma      │  │ FTS5        │ │
                    │   │ Vector      │  │ Keyword     │ │
                    │   │ Similarity  │  │ Match       │ │
                    │   └──────┬──────┘  └──────┬──────┘ │
                    │          │                │        │
                    │          └────────┬───────┘        │
                    │                   ▼                │
                    │          ┌─────────────────┐       │
                    │          │ Merge & Rank    │       │
                    │          │ by Relevance    │       │
                    │          └─────────────────┘       │
                    └──────────────────┬──────────────────┘
                                       │
                    ┌──────────────────▼──────────────────┐
                    │   Results:                          │
                    │   [{id, task, summary, relevance}]  │
                    │                                     │
                    │   Token Count: ~100 tokens          │
                    └──────────────────┬──────────────────┘
                                       │
                    ┌──────────────────▼──────────────────┐
                    │   Calculate Remaining Token Budget  │
                    │                                     │
                    │   Budget = maxTokens - layer1Tokens │
                    └──────────────────┬──────────────────┘
                                       │
                    ┌──────────────────▼──────────────────┐
                    │   Budget > 500 tokens?              │
                    └──────┬───────────────────┬──────────┘
                     YES   │                   │ NO
                           ▼                   ▼
          ┌────────────────────────┐   ┌──────────────┐
          │  LAYER 2: Load Details │   │ Skip Layer 2 │
          │  (Full Orchestrations) │   │ (token limit)│
          └────────────┬───────────┘   └──────┬───────┘
                       │                      │
          ┌────────────▼───────────┐          │
          │  MemoryStore.getById() │          │
          │                        │          │
          │  For each top result:  │          │
          │  • Load full orch      │          │
          │  • Include observations│          │
          │  • Respect token budget│          │
          │  • Truncate if needed  │          │
          └────────────┬───────────┘          │
                       │                      │
                       └──────────┬───────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │   Format Final Context     │
                    │                            │
                    │   {                        │
                    │     layer1: { ... },       │
                    │     layer2: { ... },       │
                    │     tokenCount: N,         │
                    │     retrievalTime: T       │
                    │   }                        │
                    └─────────────┬──────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │   Store in LRU Cache       │
                    └─────────────┬──────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │   Return Context           │
                    │   to Orchestrator          │
                    └────────────────────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │   Agents receive enriched  │
                    │   task with memoryContext  │
                    └────────────────────────────┘
```

---

## VectorStore: Hybrid Search Flow

```
                        SEARCH QUERY: "implement authentication"
                                      │
                        ┌─────────────▼─────────────┐
                        │  VectorStore              │
                        │  .searchSimilar()         │
                        │                           │
                        │  Options:                 │
                        │  • limit: 5               │
                        │  • searchMode: 'hybrid'   │
                        │  • minSimilarity: 0.6     │
                        └─────────────┬─────────────┘
                                      │
                        ┌─────────────▼─────────────┐
                        │  Is Chroma available?     │
                        └───┬───────────────────┬───┘
                      YES   │                   │ NO
                            │                   │
               ┌────────────▼────────┐          │
               │  VECTOR SEARCH      │          │
               │                     │          │
               │  1. Generate        │          │
               │     embedding for   │          │
               │     query           │          │
               │                     │          │
               │  2. Chroma.query()  │          │
               │     similarity      │          │
               │     search          │          │
               │                     │          │
               │  3. Get top N*2     │          │
               │     results         │          │
               └────────────┬────────┘          │
                            │                   │
               ┌────────────▼────────────────┐  │
               │  Vector Results:            │  │
               │                             │  │
               │  [{id, score: 0.85}, ...]   │  │
               └────────────┬────────────────┘  │
                            │                   │
                            └───────┬───────────┘
                                    │
                        ┌───────────▼───────────┐
                        │  KEYWORD SEARCH (FTS5)│
                        │                       │
                        │  MemoryStore          │
                        │  .searchObservationsFTS()
                        │                       │
                        │  MATCH: "implement"   │
                        │         "authentication"
                        └───────────┬───────────┘
                                    │
                        ┌───────────▼───────────┐
                        │  FTS5 Results:        │
                        │                       │
                        │  [{id, bm25: 3.2}, ...]│
                        └───────────┬───────────┘
                                    │
                        ┌───────────▼───────────┐
                        │  MERGE RESULTS        │
                        │                       │
                        │  Strategy:            │
                        │  1. Normalize scores  │
                        │  2. Combine by ID     │
                        │  3. Weighted avg      │
                        │     (vector: 0.7,     │
                        │      keyword: 0.3)    │
                        │  4. Deduplicate       │
                        │  5. Sort by combined  │
                        │     score             │
                        │  6. Filter < 0.6      │
                        │  7. Take top N        │
                        └───────────┬───────────┘
                                    │
                        ┌───────────▼───────────┐
                        │  Final Results:       │
                        │                       │
                        │  [                    │
                        │    {                  │
                        │      id: "123",       │
                        │      similarity: 0.87,│
                        │      relevance: 0.82, │
                        │      task: "...",     │
                        │      ...              │
                        │    },                 │
                        │    ...                │
                        │  ]                    │
                        └───────────────────────┘
```

---

## AICategorizationService: Processing Flow

```
                    ORCHESTRATION COMPLETE
                              │
              ┌───────────────▼───────────────┐
              │  MessageBus Event Fired       │
              │  (async, non-blocking)        │
              └───────────────┬───────────────┘
                              │
              ┌───────────────▼───────────────┐
              │  AICategorizationService      │
              │  .categorizeOrchestration()   │
              │                               │
              │  Input:                       │
              │  • pattern: "parallel"        │
              │  • agentIds: [...]            │
              │  • task: "implement auth"     │
              │  • resultSummary: "..."       │
              │  • success: true              │
              └───────────────┬───────────────┘
                              │
                ┌─────────────▼─────────────┐
                │  Is AI available?         │
                │  (API key configured?)    │
                └───┬───────────────────┬───┘
              YES   │                   │ NO
                    │                   │
       ┌────────────▼────────┐          │
       │  AI CATEGORIZATION  │          │
       │                     │          │
       │  1. Build Prompt    │          │
       │     ┌─────────────┐ │          │
       │     │ ORCHESTRATION│          │
       │     │ DETAILS:    │ │          │
       │     │ - Pattern   │ │          │
       │     │ - Agents    │ │          │
       │     │ - Task      │ │          │
       │     │ - Result    │ │          │
       │     │             │ │          │
       │     │ EXTRACT:    │ │          │
       │     │ - Type      │ │          │
       │     │ - Learning  │ │          │
       │     │ - Concepts  │ │          │
       │     │ - Importance│ │          │
       │     │ - Insights  │ │          │
       │     └─────────────┘ │          │
       │                     │          │
       │  2. Call Claude API │          │
       │     (with retry)    │          │
       │                     │          │
       │  3. Parse JSON      │          │
       │     response        │          │
       │                     │          │
       │  4. Validate fields │          │
       └────────────┬────────┘          │
                    │ Success           │ (API failed)
                    │                   │
                    │    ┌──────────────▼──────────────┐
                    │    │  RULE-BASED CATEGORIZATION  │
                    │    │                             │
                    │    │  Heuristics:                │
                    │    │  • "bug" → bugfix           │
                    │    │  • "decide" → decision      │
                    │    │  • "feature" → feature      │
                    │    │  • "refactor" → refactor    │
                    │    │  • "discover" → discovery   │
                    │    │  • default → pattern-usage  │
                    │    │                             │
                    │    │  Importance:                │
                    │    │  • Adjust by success        │
                    │    │  • Add pattern as concept   │
                    │    └──────────────┬──────────────┘
                    │                   │
                    └───────────┬───────┘
                                │
                    ┌───────────▼───────────┐
                    │  Categorization Result│
                    │                       │
                    │  {                    │
                    │    type: "feature",   │
                    │    observation: "...",│
                    │    concepts: [...],   │
                    │    importance: 7,     │
                    │    agentInsights: {},  │
                    │    recommendations: "..."
                    │  }                    │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │  MemoryStore          │
                    │  .recordObservation() │
                    │                       │
                    │  Save to database:    │
                    │  • observation table  │
                    │  • FTS5 index         │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │  VectorStore          │
                    │  .addOrchestration()  │
                    │                       │
                    │  Add concepts to      │
                    │  vector embedding     │
                    └───────────────────────┘
```

---

## Progressive Disclosure: Token Budget Management

```
┌────────────────────────────────────────────────────────────┐
│  Token Budget: 2000 tokens                                 │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ LAYER 1: INDEX (Lightweight)                         │ │
│  │                                                      │ │
│  │ Load top 3 orchestrations (index only):             │ │
│  │                                                      │ │
│  │ 1. {                                                 │ │
│  │      id: "123",                                      │ │
│  │      task: "implement auth... (truncated)",          │ │
│  │      summary: "Successfully... (truncated)",         │ │
│  │      relevance: 0.87,                                │ │
│  │      pattern: "parallel",                            │ │
│  │      agentIds: ["agent-1", "agent-2"]                │ │
│  │    }                                                 │ │
│  │ 2. { ... }                                           │ │
│  │ 3. { ... }                                           │ │
│  │                                                      │ │
│  │ Token Cost: ~100 tokens                              │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  Remaining Budget: 2000 - 100 = 1900 tokens                │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ LAYER 2: FULL DETAILS (On-Demand)                   │ │
│  │                                                      │ │
│  │ If budget > 500:                                     │ │
│  │                                                      │ │
│  │ Load top 2 orchestrations (full):                   │ │
│  │                                                      │ │
│  │ 1. {                                                 │ │
│  │      id: "123",                                      │ │
│  │      pattern: "parallel",                            │ │
│  │      task: "implement authentication... (full)",     │ │
│  │      result_summary: "Successfully... (full)",       │ │
│  │      observations: [                                 │ │
│  │        {                                             │ │
│  │          type: "feature",                            │ │
│  │          content: "JWT auth implemented",            │ │
│  │          concepts: ["auth", "jwt", "security"],      │ │
│  │          importance: 8,                              │ │
│  │          recommendations: "Use refresh tokens"       │ │
│  │        }                                             │ │
│  │      ],                                              │ │
│  │      metadata: { ... }                               │ │
│  │    }                 Token Cost: ~800 tokens         │ │
│  │                                                      │ │
│  │ 2. { ... }          Token Cost: ~700 tokens         │ │
│  │                                                      │ │
│  │ 3rd orchestration would exceed budget - SKIP         │ │
│  │                                                      │ │
│  │ Token Cost: 800 + 700 = 1500 tokens                  │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  Total Used: 100 + 1500 = 1600 tokens                      │
│  Remaining: 400 tokens (buffer for prompts)                │
│                                                            │
└────────────────────────────────────────────────────────────┘

Benefits:
• Always get some context (Layer 1) even with tight budgets
• Expensive details loaded only when budget allows
• Token-aware truncation prevents overflow
• Graceful degradation: Layer 1 only → better than nothing
```

---

## Error Handling: Graceful Degradation Cascade

```
┌────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATION STARTS                        │
└────────────────────────┬───────────────────────────────────────┘
                         │
         ┌───────────────▼───────────────┐
         │  ContextRetriever             │
         │  .retrieveContext()           │
         └───────────────┬───────────────┘
                         │
         ┌───────────────▼───────────────┐
         │  VectorStore.searchSimilar()  │
         └───┬───────────────────────┬───┘
     SUCCESS │                       │ FAILURE
             │                       │
             │         ┌─────────────▼─────────────┐
             │         │  Chroma connection failed │
             │         │  Circuit breaker open     │
             │         └─────────────┬─────────────┘
             │                       │
             │         ┌─────────────▼─────────────┐
             │         │  FALLBACK: FTS5-only      │
             │         │  MemoryStore.searchFTS()  │
             │         └─────────────┬─────────────┘
             │                       │
             │         ┌─────────────▼─────────────┐
             │         │  FTS5 returns results     │
             │         │  (keyword-based only)     │
             │         └─────────────┬─────────────┘
             │                       │
             └───────────┬───────────┘
                         │
         ┌───────────────▼───────────────┐
         │  Results merged (or FTS-only) │
         └───────────────┬───────────────┘
                         │
         ┌───────────────▼───────────────┐
         │  ContextRetriever.loadLayer2()│
         └───┬───────────────────────┬───┘
     SUCCESS │                       │ FAILURE
             │                       │
             │         ┌─────────────▼─────────────┐
             │         │  Database read error      │
             │         │  Observation query failed │
             │         └─────────────┬─────────────┘
             │                       │
             │         ┌─────────────▼─────────────┐
             │         │  FALLBACK: Layer 1 only   │
             │         │  Skip detailed loading    │
             │         └─────────────┬─────────────┘
             │                       │
             └───────────┬───────────┘
                         │
         ┌───────────────▼───────────────┐
         │  Context returned to          │
         │  orchestrator                 │
         │                               │
         │  Best case: Full context      │
         │  Good case: Layer 1 only      │
         │  Worst case: Empty context    │
         └───────────────┬───────────────┘
                         │
         ┌───────────────▼───────────────┐
         │  ORCHESTRATION CONTINUES      │
         │  (never fails due to memory)  │
         └───────────────────────────────┘

Key Principles:
• Each layer has fallback strategy
• Failures are logged but not propagated
• Orchestration ALWAYS proceeds
• Quality degrades gracefully:
  - Full context (vector + FTS + observations)
  - Partial context (FTS + observations)
  - Minimal context (FTS only)
  - No context (empty, but execution continues)
```

---

## LRU Cache: Eviction Strategy

```
┌──────────────────────────────────────────────────────────────┐
│  LRU CACHE (Max Size: 100 entries)                           │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Current State: 98 entries                              │ │
│  │                                                        │ │
│  │ Entry 1: { key: "ctx_a1b2c3", accessTime: 100000 }    │ │ ← Oldest
│  │ Entry 2: { key: "ctx_d4e5f6", accessTime: 105000 }    │ │
│  │ Entry 3: { key: "ctx_g7h8i9", accessTime: 110000 }    │ │
│  │ ...                                                    │ │
│  │ Entry 98: { key: "ctx_x9y8z7", accessTime: 195000 }   │ │ ← Newest
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ NEW REQUEST: retrieveContext(...)                      │ │
│  │ Cache Key: "ctx_j1k2l3"                                │ │
│  └────────────────────┬───────────────────────────────────┘ │
│                       │                                      │
│         ┌─────────────▼─────────────┐                        │
│         │  Cache Miss (not found)   │                        │
│         └─────────────┬─────────────┘                        │
│                       │                                      │
│         ┌─────────────▼─────────────┐                        │
│         │  Load context from DB     │                        │
│         └─────────────┬─────────────┘                        │
│                       │                                      │
│         ┌─────────────▼─────────────┐                        │
│         │  Attempt to cache         │                        │
│         │  Size: 98/100             │                        │
│         │  Space available!         │                        │
│         └─────────────┬─────────────┘                        │
│                       │                                      │
│  ┌────────────────────▼────────────────────────────────────┐ │
│  │ Cache updated: 99 entries                              │ │
│  │                                                        │ │
│  │ Entry 1: { key: "ctx_a1b2c3", accessTime: 100000 }    │ │
│  │ ...                                                    │ │
│  │ Entry 99: { key: "ctx_j1k2l3", accessTime: 200000 }   │ │ ← New
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ NEXT REQUEST: retrieveContext(...)                     │ │
│  │ Cache Key: "ctx_m4n5o6"                                │ │
│  └────────────────────┬───────────────────────────────────┘ │
│                       │                                      │
│         ┌─────────────▼─────────────┐                        │
│         │  Cache Miss               │                        │
│         │  Load context from DB     │                        │
│         └─────────────┬─────────────┘                        │
│                       │                                      │
│         ┌─────────────▼─────────────┐                        │
│         │  Attempt to cache         │                        │
│         │  Size: 99/100             │                        │
│         │  Space available!         │                        │
│         └─────────────┬─────────────┘                        │
│                       │                                      │
│  ┌────────────────────▼────────────────────────────────────┐ │
│  │ Cache updated: 100 entries (FULL)                      │ │
│  │                                                        │ │
│  │ Entry 1: { key: "ctx_a1b2c3", accessTime: 100000 }    │ │
│  │ ...                                                    │ │
│  │ Entry 100: { key: "ctx_m4n5o6", accessTime: 205000 }  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ NEXT REQUEST: retrieveContext(...)                     │ │
│  │ Cache Key: "ctx_p7q8r9"                                │ │
│  └────────────────────┬───────────────────────────────────┘ │
│                       │                                      │
│         ┌─────────────▼─────────────┐                        │
│         │  Cache Miss               │                        │
│         │  Load context from DB     │                        │
│         └─────────────┬─────────────┘                        │
│                       │                                      │
│         ┌─────────────▼─────────────┐                        │
│         │  Attempt to cache         │                        │
│         │  Size: 100/100 (FULL!)    │                        │
│         │  EVICTION NEEDED          │                        │
│         └─────────────┬─────────────┘                        │
│                       │                                      │
│         ┌─────────────▼─────────────┐                        │
│         │  Find LRU Entry           │                        │
│         │  Oldest access: 100000    │                        │
│         │  Key: "ctx_a1b2c3"        │                        │
│         └─────────────┬─────────────┘                        │
│                       │                                      │
│         ┌─────────────▼─────────────┐                        │
│         │  EVICT "ctx_a1b2c3"       │                        │
│         │  Log: Entry evicted (LRU) │                        │
│         └─────────────┬─────────────┘                        │
│                       │                                      │
│  ┌────────────────────▼────────────────────────────────────┐ │
│  │ Cache updated: 100 entries                             │ │
│  │                                                        │ │
│  │ Entry 1: { key: "ctx_d4e5f6", accessTime: 105000 }    │ │ ← Now oldest
│  │ ...                                                    │ │
│  │ Entry 100: { key: "ctx_p7q8r9", accessTime: 210000 }  │ │ ← New
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘

Algorithm:
1. On cache access: Update accessTime to current timestamp
2. On cache full: Find entry with minimum accessTime
3. Evict LRU entry and insert new entry
4. Log eviction for debugging
```

---

For complete implementation details, see:
- **INTELLIGENCE-LAYER-ARCHITECTURE.md** (full specs)
- **INTELLIGENCE-LAYER-QUICK-REFERENCE.md** (quick guide)
