# Lean Integration Roadmap: Memory-Enabled Multi-Agent Framework

**Version**: 2.0 (Refined)
**Date**: 2025-01-08
**Timeline**: 6 weeks, 110 hours core work
**Savings**: 50 hours vs original plan by eliminating overlapping features

---

## 🎯 Philosophy: Leverage Your Strengths, Adopt What's Missing

### What We're KEEPING from Your Framework
✅ MessageBus pub/sub architecture (superior to hooks)
✅ TokenCounter with tiktoken (already implemented)
✅ Interactive CLI with inquirer/chalk/ora (polished)
✅ 5 orchestration patterns (unique value)
✅ Agent collaboration model (core competency)

### What We're ADDING from Claude-Mem
✅ SQLite + FTS5 persistent storage (missing capability)
✅ Chroma vector search (semantic similarity)
✅ Progressive disclosure philosophy (token optimization)
✅ AI-powered observation categorization (intelligence layer)

### What We're SKIPPING from Claude-Mem
❌ Hook-based lifecycle (MessageBus is better)
❌ MCP/Plugin architecture (not relevant)
❌ PM2 process management (unnecessary complexity)
❌ Complex web dashboard (CLI-first approach)

---

## 📋 6-Week Implementation Plan

### Week 1: Storage Foundation (20 hours)

#### Goals
- Persistent storage with SQLite
- FTS5 full-text search
- Basic schema and CRUD operations

#### Tasks
1. **Install Dependencies** (30 min)
   ```bash
   npm install better-sqlite3
   npm install --save-dev @types/better-sqlite3
   ```

2. **Design Database Schema** (3 hours)
   ```sql
   -- Core tables only (simpler than original)
   CREATE TABLE orchestrations (
     id TEXT PRIMARY KEY,
     timestamp INTEGER NOT NULL,
     pattern TEXT NOT NULL,
     task TEXT NOT NULL,
     agent_ids TEXT NOT NULL,
     result_summary TEXT,
     success INTEGER DEFAULT 1,
     duration INTEGER,
     token_count INTEGER,
     metadata TEXT
   );

   CREATE TABLE observations (
     id TEXT PRIMARY KEY,
     orchestration_id TEXT NOT NULL,
     timestamp INTEGER NOT NULL,
     type TEXT NOT NULL,
     content TEXT NOT NULL,
     concepts TEXT,
     importance INTEGER DEFAULT 5,
     FOREIGN KEY (orchestration_id) REFERENCES orchestrations(id)
   );

   -- FTS5 for search
   CREATE VIRTUAL TABLE observations_fts USING fts5(
     content,
     concepts,
     content='observations'
   );

   -- Agent performance tracking
   CREATE TABLE agent_stats (
     agent_id TEXT PRIMARY KEY,
     role TEXT,
     total_executions INTEGER DEFAULT 0,
     successful_executions INTEGER DEFAULT 0,
     total_duration INTEGER DEFAULT 0,
     last_used INTEGER
   );
   ```

3. **Implement MemoryStore Class** (8 hours)
   ```javascript
   // .claude/core/memory-store.js
   const Database = require('better-sqlite3');
   const { createComponentLogger } = require('./logger');

   class MemoryStore {
     constructor(dbPath = '.claude/memory/orchestrations.db') {
       this.logger = createComponentLogger('MemoryStore');
       this.db = new Database(dbPath);
       this._initializeSchema();
     }

     _initializeSchema() {
       // Create tables if not exist
       // Set up indexes
       // Configure FTS5
     }

     // CRUD operations
     async recordOrchestration(data) {
       // Insert orchestration
       // Update agent stats
       // Return orchestration ID
     }

     async recordObservation(orchestrationId, observation) {
       // Insert observation
       // Update FTS5 index
     }

     async searchOrchestrations(query, options = {}) {
       // FTS5 search
       // Apply filters (pattern, agent, date range)
       // Return results with relevance scores
     }

     async getOrchestrationById(id) {
       // Fetch full orchestration with observations
     }

     async getAgentStats(agentId) {
       // Fetch performance metrics
     }

     close() {
       this.db.close();
     }
   }

   module.exports = MemoryStore;
   ```

4. **Write Tests** (5 hours)
   ```javascript
   // __tests__/core/memory-store.test.js
   describe('MemoryStore', () => {
     test('records orchestration successfully');
     test('records observation with FTS5 indexing');
     test('searches by keyword');
     test('filters by pattern type');
     test('retrieves agent statistics');
     test('handles concurrent writes');
   });
   ```

5. **Integration with MessageBus** (3.5 hours)
   ```javascript
   // .claude/core/memory-integration.js
   class MemoryIntegration {
     constructor(messageBus, memoryStore) {
       this.messageBus = messageBus;
       this.memoryStore = memoryStore;
       this._setupListeners();
     }

     _setupListeners() {
       // Listen to orchestration events
       this.messageBus.subscribe(
         'orchestrator:execution:complete',
         this._handleOrchestrationComplete.bind(this)
       );

       // Listen to agent state changes
       this.messageBus.subscribe(
         'agent:state-change',
         this._handleAgentStateChange.bind(this)
       );
     }

     async _handleOrchestrationComplete(event) {
       const { pattern, agentIds, task, result, duration } = event;

       await this.memoryStore.recordOrchestration({
         pattern,
         agentIds,
         task,
         resultSummary: this._summarize(result),
         success: result.success ? 1 : 0,
         duration,
         tokenCount: result.tokenCount || 0,
         metadata: JSON.stringify(result.metadata || {})
       });
     }

     _summarize(result) {
       // Simple summarization (AI categorization comes later)
       const str = JSON.stringify(result);
       return str.length > 500 ? str.substring(0, 500) + '...' : str;
     }
   }

   module.exports = MemoryIntegration;
   ```

#### Deliverables
```
.claude/
├── core/
│   ├── memory-store.js
│   ├── memory-integration.js
│   └── schema.sql
├── memory/
│   └── orchestrations.db (created at runtime)
└── __tests__/
    └── core/
        └── memory-store.test.js
```

---

### Week 2: MessageBus Integration & Basic Search (18 hours)

#### Goals
- Full integration with existing orchestrator
- FTS5 search implementation
- Query API foundation

#### Tasks
1. **Enhance AgentOrchestrator** (6 hours)
   ```javascript
   // Modify .claude/core/agent-orchestrator.js
   class AgentOrchestrator {
     constructor(messageBus, options = {}) {
       this.messageBus = messageBus;
       this.agents = new Map();

       // NEW: Optional memory integration
       if (options.enableMemory !== false) {  // Opt-out, not opt-in
         this.memoryStore = new MemoryStore(options.dbPath);
         this.memoryIntegration = new MemoryIntegration(
           messageBus,
           this.memoryStore
         );
         this.logger.info('Memory enabled', { dbPath: options.dbPath });
       }
     }

     async executeParallel(agentIds, task, options = {}) {
       const startTime = Date.now();

       // BEFORE: Query memory for similar tasks (if enabled)
       let relevantHistory = null;
       if (this.memoryStore && options.useMemory !== false) {
         relevantHistory = await this._queryRelevantHistory(task);
         this.logger.info('Found relevant history', {
           count: relevantHistory.length
         });
       }

       // Execute (existing logic, enhanced with context)
       const context = { relevantHistory, ...options.context };
       const result = await this._executeParallelInternal(
         agentIds,
         task,
         context
       );

       // AFTER: Publish completion event (MemoryIntegration listens)
       this.messageBus.publish('orchestrator:execution:complete', {
         pattern: 'parallel',
         agentIds,
         task,
         result,
         duration: Date.now() - startTime
       }, 'orchestrator');

       return result;
     }

     async _queryRelevantHistory(task) {
       // Simple keyword search for now (vector search comes Week 3)
       const results = await this.memoryStore.searchOrchestrations(task, {
         limit: 5,
         successOnly: true
       });
       return results;
     }

     // Repeat for other patterns: consensus, debate, review, ensemble
   }
   ```

2. **Implement Search API** (6 hours)
   ```javascript
   // .claude/core/memory-search-api.js
   class MemorySearchAPI {
     constructor(memoryStore) {
       this.memoryStore = memoryStore;
     }

     async searchOrchestrations(query, filters = {}) {
       // FTS5 keyword search
       return this.memoryStore.searchOrchestrations(query, filters);
     }

     async findByPattern(patternType) {
       // Get all orchestrations by pattern type
     }

     async findByAgent(agentId, timeframe = {}) {
       // Get orchestrations involving specific agent
     }

     async getRecentContext(hours = 24) {
       // Recent orchestrations
     }

     async getSuccessPatterns(taskKeywords) {
       // Find successful orchestrations matching keywords
       const results = await this.searchOrchestrations(taskKeywords, {
         successOnly: true
       });

       // Analyze patterns
       const patternCounts = {};
       results.forEach(r => {
         patternCounts[r.pattern] = (patternCounts[r.pattern] || 0) + 1;
       });

       return {
         results,
         recommendations: Object.entries(patternCounts)
           .sort((a, b) => b[1] - a[1])
           .map(([pattern, count]) => ({
             pattern,
             successCount: count,
             confidence: count / results.length
           }))
       };
     }
   }

   module.exports = MemorySearchAPI;
   ```

3. **Update All Orchestration Patterns** (4 hours)
   - Add memory hooks to: consensus, debate, review, ensemble
   - Ensure consistent event publishing
   - Add context retrieval to each pattern

4. **Write Integration Tests** (2 hours)
   ```javascript
   describe('Memory Integration', () => {
     test('records parallel execution automatically');
     test('retrieves relevant history before execution');
     test('updates agent statistics');
     test('searches by pattern type');
   });
   ```

#### Deliverables
- Enhanced AgentOrchestrator with memory
- MemorySearchAPI
- All 5 patterns memory-enabled
- Integration tests passing

---

### Week 3: Vector Search & Semantic Similarity (18 hours)

#### Goals
- Chroma vector database integration
- Semantic search capability
- Hybrid search (FTS5 + vector)

#### Tasks
1. **Install Chroma Client** (30 min)
   ```bash
   npm install chromadb
   ```

2. **Implement Vector Store** (8 hours)
   ```javascript
   // .claude/core/vector-store.js
   const { ChromaClient } = require('chromadb');

   class VectorStore {
     constructor(config = {}) {
       this.client = new ChromaClient({
         path: config.chromaPath || 'http://localhost:8000'
       });
       this.collectionName = config.collectionName || 'orchestrations';
       this.embeddingModel = config.embeddingModel || 'all-MiniLM-L6-v2';
       this._initializeCollection();
     }

     async _initializeCollection() {
       try {
         this.collection = await this.client.getOrCreateCollection({
           name: this.collectionName,
           metadata: { description: 'Multi-agent orchestrations' }
         });
       } catch (error) {
         this.logger.error('Chroma initialization failed', { error });
         this.collection = null;  // Graceful degradation
       }
     }

     async addOrchestration(id, text, metadata = {}) {
       if (!this.collection) return;  // Skip if Chroma unavailable

       await this.collection.add({
         ids: [id],
         documents: [text],
         metadatas: [metadata]
       });
     }

     async searchSimilar(query, options = {}) {
       if (!this.collection) return [];  // Fallback to FTS5 only

       const results = await this.collection.query({
         queryTexts: [query],
         nResults: options.limit || 10,
         where: options.filters || {}
       });

       return results;
     }

     async getSimilarToOrchestration(orchestrationId, limit = 5) {
       if (!this.collection) return [];

       // Find similar orchestrations by vector distance
       const results = await this.collection.query({
         queryIds: [orchestrationId],
         nResults: limit
       });

       return results;
     }
   }

   module.exports = VectorStore;
   ```

3. **Enhance MemoryStore with Vector Search** (5 hours)
   ```javascript
   // Update .claude/core/memory-store.js
   class MemoryStore {
     constructor(dbPath, vectorConfig) {
       this.db = new Database(dbPath);
       this.vectorStore = new VectorStore(vectorConfig);
       this._initializeSchema();
     }

     async recordOrchestration(data) {
       // Existing SQLite insert...
       const id = this._generateId();

       // NEW: Also add to vector store
       const textForEmbedding = `${data.task} ${data.resultSummary}`;
       await this.vectorStore.addOrchestration(id, textForEmbedding, {
         pattern: data.pattern,
         agentIds: data.agentIds,
         success: data.success
       });

       return id;
     }

     async hybridSearch(query, options = {}) {
       // Combine FTS5 keyword search + vector semantic search
       const keywordResults = await this.searchOrchestrations(query, options);
       const vectorResults = await this.vectorStore.searchSimilar(query, options);

       // Merge and deduplicate
       return this._mergeResults(keywordResults, vectorResults);
     }

     _mergeResults(keywordResults, vectorResults) {
       // Simple merge: combine results, deduplicate by ID
       const merged = new Map();

       keywordResults.forEach(r => {
         merged.set(r.id, { ...r, score: r.ftsScore || 1.0, source: 'keyword' });
       });

       vectorResults.ids?.[0]?.forEach((id, idx) => {
         const distance = vectorResults.distances?.[0]?[idx] || 1.0;
         const vectorScore = 1.0 - distance;  // Convert distance to similarity

         if (merged.has(id)) {
           // Boost score if found by both methods
           merged.get(id).score += vectorScore;
           merged.get(id).source = 'hybrid';
         } else {
           merged.set(id, {
             id,
             score: vectorScore,
             source: 'vector',
             ...vectorResults.metadatas?.[0]?[idx]
           });
         }
       });

       // Sort by combined score
       return Array.from(merged.values())
         .sort((a, b) => b.score - a.score)
         .slice(0, options.limit || 10);
     }
   }
   ```

4. **Add Semantic Search to SearchAPI** (2 hours)
   ```javascript
   // Update .claude/core/memory-search-api.js
   class MemorySearchAPI {
     async searchSemantic(query, options = {}) {
       // Pure vector search
       return this.memoryStore.vectorStore.searchSimilar(query, options);
     }

     async searchHybrid(query, options = {}) {
       // Best of both worlds
       return this.memoryStore.hybridSearch(query, options);
     }

     async findSimilarOrchestrations(orchestrationId, limit = 5) {
       // "Show me orchestrations like this one"
       return this.memoryStore.vectorStore.getSimilarToOrchestration(
         orchestrationId,
         limit
       );
     }
   }
   ```

5. **Write Vector Search Tests** (2.5 hours)
   ```javascript
   describe('Vector Search', () => {
     test('adds orchestration to Chroma');
     test('finds semantically similar orchestrations');
     test('hybrid search combines FTS5 and vector results');
     test('gracefully degrades if Chroma unavailable');
   });
   ```

#### Deliverables
- VectorStore class
- Hybrid search in MemoryStore
- Semantic search API methods
- Graceful degradation if Chroma unavailable

---

### Week 4: Progressive Disclosure & Token Optimization (18 hours)

#### Goals
- Layer context retrieval (summary → details)
- Token-aware loading using existing TokenCounter
- Smart caching

#### Tasks
1. **Implement ContextRetriever** (8 hours)
   ```javascript
   // .claude/core/context-retriever.js
   const TokenCounter = require('./token-counter');

   class ContextRetriever {
     constructor(memoryStore) {
       this.memoryStore = memoryStore;
       this.tokenCounter = new TokenCounter();  // Use existing!
       this.cache = new Map();
     }

     async getRelevantContext(task, options = {}) {
       const {
         maxTokens = 2000,
         minRelevance = 0.5,
         includeFullDetails = false
       } = options;

       // Layer 1: Get index of relevant orchestrations
       const index = await this._getContextIndex(task, minRelevance);

       const indexTokens = this.tokenCounter.count(JSON.stringify(index));
       this.logger.debug('Context index', {
         orchestrations: index.length,
         tokens: indexTokens
       });

       if (!includeFullDetails || indexTokens >= maxTokens) {
         // Return just the index (low token cost)
         return {
           layer: 'index',
           orchestrations: index,
           tokenCost: indexTokens,
           canLoadMore: indexTokens < maxTokens
         };
       }

       // Layer 2: Load full details within token budget
       const remainingTokens = maxTokens - indexTokens;
       const details = await this._loadDetails(
         index,
         remainingTokens
       );

       return {
         layer: 'details',
         index,
         details,
         tokenCost: indexTokens + details.tokenCost
       };
     }

     async _getContextIndex(task, minRelevance) {
       // Hybrid search with scoring
       const results = await this.memoryStore.hybridSearch(task, {
         limit: 20  // Get more initially, filter by relevance
       });

       // Return condensed index
       return results
         .filter(r => r.score >= minRelevance)
         .map(r => ({
           id: r.id,
           pattern: r.pattern,
           task: r.task.substring(0, 100),  // Truncate
           success: r.success,
           timestamp: r.timestamp,
           relevanceScore: r.score,
           estimatedTokens: 200  // Rough estimate for full details
         }));
     }

     async _loadDetails(index, tokenBudget) {
       const details = [];
       let tokensUsed = 0;

       // Load highest relevance first
       const sorted = index.sort((a, b) => b.relevanceScore - a.relevanceScore);

       for (const item of sorted) {
         if (tokensUsed + item.estimatedTokens > tokenBudget) {
           break;  // Token budget exhausted
         }

         // Check cache first
         let detail = this.cache.get(item.id);

         if (!detail) {
           detail = await this.memoryStore.getOrchestrationById(item.id);
           this.cache.set(item.id, detail);
         }

         const detailTokens = this.tokenCounter.count(JSON.stringify(detail));
         tokensUsed += detailTokens;
         details.push(detail);

         this.logger.debug('Loaded detail', {
           id: item.id,
           tokens: detailTokens,
           totalTokens: tokensUsed
         });
       }

       return {
         orchestrations: details,
         tokenCost: tokensUsed,
         loaded: details.length,
         skipped: sorted.length - details.length
       };
     }

     // Smart caching with LRU eviction
     _cacheCleanup() {
       if (this.cache.size > 100) {
         // Remove oldest entries
         const entries = Array.from(this.cache.entries());
         entries.slice(0, 50).forEach(([key]) => this.cache.delete(key));
       }
     }
   }

   module.exports = ContextRetriever;
   ```

2. **Integrate with AgentOrchestrator** (4 hours)
   ```javascript
   // Update .claude/core/agent-orchestrator.js
   class AgentOrchestrator {
     constructor(messageBus, options = {}) {
       // ... existing setup ...

       if (options.enableMemory !== false) {
         this.memoryStore = new MemoryStore(options.dbPath, options.vectorConfig);
         this.contextRetriever = new ContextRetriever(this.memoryStore);
         this.memoryIntegration = new MemoryIntegration(
           messageBus,
           this.memoryStore
         );
       }
     }

     async executeParallel(agentIds, task, options = {}) {
       let context = {};

       // Progressive disclosure: start with index
       if (this.contextRetriever && options.useMemory !== false) {
         const relevantContext = await this.contextRetriever.getRelevantContext(
           task,
           {
             maxTokens: options.maxContextTokens || 1000,
             includeFullDetails: options.includeFullDetails || false
           }
         );

         context.history = relevantContext;

         this.logger.info('Retrieved context', {
           layer: relevantContext.layer,
           orchestrations: relevantContext.orchestrations?.length || 0,
           tokenCost: relevantContext.tokenCost
         });
       }

       // Execute with context
       const result = await this._executeParallelInternal(agentIds, task, context);

       // ... rest of method ...
     }
   }
   ```

3. **Add Context Summary Formatting** (3 hours)
   ```javascript
   // .claude/core/context-formatter.js
   class ContextFormatter {
     static formatIndexForPrompt(index) {
       // Format context index for agent consumption
       if (!index || index.length === 0) {
         return "No relevant historical context found.";
       }

       const lines = [
         "Relevant past orchestrations:",
         ""
       ];

       index.forEach((item, idx) => {
         lines.push(
           `${idx + 1}. [${item.pattern}] ${item.task}`,
           `   Result: ${item.success ? '✓ Success' : '✗ Failed'}`,
           `   Date: ${new Date(item.timestamp).toLocaleDateString()}`,
           `   Relevance: ${(item.relevanceScore * 100).toFixed(0)}%`,
           ""
         );
       });

       lines.push(
         `Token cost to load full details: ~${index.reduce((sum, i) => sum + i.estimatedTokens, 0)} tokens`
       );

       return lines.join('\n');
     }

     static formatDetailsForPrompt(details) {
       // Format full details for agent consumption
       // Include observations, agent performance, etc.
     }
   }

   module.exports = ContextFormatter;
   ```

4. **Write Progressive Disclosure Tests** (3 hours)
   ```javascript
   describe('ContextRetriever', () => {
     test('returns index within token budget');
     test('loads details progressively');
     test('respects token limits');
     test('caches frequently accessed orchestrations');
     test('formats context for agent consumption');
   });
   ```

#### Deliverables
- ContextRetriever with progressive disclosure
- Token-aware loading
- Smart caching
- Context formatting utilities

---

### Week 5: AI Categorization & Observation Extraction (18 hours)

#### Goals
- AI-powered observation extraction
- Categorization by type and concept
- Agent-aware insights

#### Tasks
1. **Implement AI Categorizer** (10 hours)
   ```javascript
   // .claude/core/ai-categorizer.js
   const Anthropic = require('@anthropic-ai/sdk');
   const { createComponentLogger } = require('./logger');

   class AICategorizationService {
     constructor(apiKey) {
       this.anthropic = new Anthropic({ apiKey });
       this.logger = createComponentLogger('AICategorizationService');
       this.model = 'claude-sonnet-4-20250514';  // Fast + cheap
     }

     async categorizeOrchestration(orchestrationData) {
       const prompt = this._buildCategorizationPrompt(orchestrationData);

       try {
         const response = await this.anthropic.messages.create({
           model: this.model,
           max_tokens: 800,
           messages: [{ role: 'user', content: prompt }]
         });

         const result = JSON.parse(response.content[0].text);
         return this._enhanceWithAgentInsights(result, orchestrationData);

       } catch (error) {
         this.logger.error('Categorization failed', { error: error.message });
         return this._fallbackCategorization(orchestrationData);
       }
     }

     _buildCategorizationPrompt(data) {
       return `Analyze this multi-agent orchestration and extract key learnings:

**Pattern Used**: ${data.pattern}
**Task**: ${data.task}
**Agents Involved**: ${data.agentIds.join(', ')}
**Outcome**: ${data.success ? 'Success' : 'Failed'}
**Duration**: ${data.duration}ms
**Result Summary**: ${data.resultSummary}

Extract the following as JSON:
{
  "type": "<decision|bugfix|feature|refactor|discovery|change>",
  "concepts": ["<keyword1>", "<keyword2>", ...],
  "observation": "<1-2 sentence key learning>",
  "importance": <1-10>,
  "recommendations": "<future guidance for similar tasks>"
}

Focus on:
- What pattern worked/didn't work
- Why this agent combination was effective
- What to remember for next time`;
     }

     _enhanceWithAgentInsights(aiResult, orchestrationData) {
       // Add agent-specific analysis (unique to your framework!)
       return {
         ...aiResult,

         // Agent performance breakdown
         agentInsights: this._analyzeAgentContributions(orchestrationData),

         // Pattern effectiveness
         patternEffectiveness: orchestrationData.success ? 0.9 : 0.3,

         // Contextualized recommendation
         contextualGuidance: this._generateGuidance(
           orchestrationData.pattern,
           aiResult.type,
           orchestrationData.success
         )
       };
     }

     _analyzeAgentContributions(data) {
       // Analyze which agents contributed to success/failure
       // This is unique capability vs claude-mem!
       return data.agentIds.map(agentId => ({
         agentId,
         estimatedContribution: 'high',  // Could be enhanced with metrics
         recommendForSimilarTasks: data.success
       }));
     }

     _generateGuidance(pattern, type, success) {
       const guidance = {
         parallel: {
           decision: success
             ? "Parallel execution effective for independent analysis tasks"
             : "Consider consensus pattern when decisions need agreement",
           feature: "Parallel works well for multi-faceted feature development"
         },
         consensus: {
           decision: "Best for critical decisions requiring agreement",
           bugfix: "May be overkill for simple bugs, consider single agent"
         },
         // ... more pattern-type combinations
       };

       return guidance[pattern]?.[type] || "Pattern applied successfully";
     }

     _fallbackCategorization(data) {
       // Simple rule-based fallback if AI fails
       return {
         type: 'discovery',
         concepts: this._extractKeywords(data.task),
         observation: `${data.pattern} execution for: ${data.task.substring(0, 100)}`,
         importance: data.success ? 6 : 4,
         recommendations: data.success
           ? "Pattern worked well, consider for similar tasks"
           : "Consider alternative pattern for similar tasks",
         source: 'fallback'
       };
     }

     _extractKeywords(text) {
       // Simple keyword extraction
       return text
         .toLowerCase()
         .split(/\s+/)
         .filter(word => word.length > 4)
         .slice(0, 5);
     }

     async batchCategorize(orchestrations, options = {}) {
       // Process multiple orchestrations with rate limiting
       const results = [];

       for (const orch of orchestrations) {
         const result = await this.categorizeOrchestration(orch);
         results.push(result);

         // Rate limiting (5 requests per second)
         if (options.rateLimit) {
           await this._delay(200);
         }
       }

       return results;
     }

     _delay(ms) {
       return new Promise(resolve => setTimeout(resolve, ms));
     }
   }

   module.exports = AICategorizationService;
   ```

2. **Integrate with MemoryIntegration** (4 hours)
   ```javascript
   // Update .claude/core/memory-integration.js
   class MemoryIntegration {
     constructor(messageBus, memoryStore, options = {}) {
       this.messageBus = messageBus;
       this.memoryStore = memoryStore;

       // NEW: AI categorization (optional)
       if (options.aiApiKey) {
         this.aiCategorizer = new AICategorizationService(options.aiApiKey);
       }

       this._setupListeners();
     }

     async _handleOrchestrationComplete(event) {
       // Record orchestration (as before)
       const orchestrationId = await this.memoryStore.recordOrchestration({
         pattern: event.pattern,
         agentIds: event.agentIds,
         task: event.task,
         resultSummary: this._summarize(event.result),
         success: event.result.success ? 1 : 0,
         duration: event.duration,
         tokenCount: event.result.metadata?.tokenCount || 0,
         metadata: JSON.stringify(event.result.metadata || {})
       });

       // NEW: AI categorization (if enabled)
       if (this.aiCategorizer) {
         this._categorizeAsync(orchestrationId, event);  // Don't block
       }
     }

     async _categorizeAsync(orchestrationId, eventData) {
       try {
         const categorization = await this.aiCategorizer.categorizeOrchestration({
           pattern: eventData.pattern,
           agentIds: eventData.agentIds,
           task: eventData.task,
           resultSummary: this._summarize(eventData.result),
           success: eventData.result.success,
           duration: eventData.duration
         });

         // Store observations
         await this.memoryStore.recordObservation(orchestrationId, {
           type: categorization.type,
           content: categorization.observation,
           concepts: JSON.stringify(categorization.concepts),
           importance: categorization.importance
         });

         this.logger.info('Observation extracted', {
           orchestrationId,
           type: categorization.type,
           concepts: categorization.concepts.join(', ')
         });

       } catch (error) {
         this.logger.error('Categorization failed', {
           orchestrationId,
           error: error.message
         });
       }
     }
   }
   ```

3. **Write AI Categorization Tests** (4 hours)
   ```javascript
   describe('AICategorizationService', () => {
     test('categorizes orchestration with AI');
     test('extracts concepts and keywords');
     test('provides agent-aware insights');
     test('falls back to rule-based if AI fails');
     test('batch processes with rate limiting');
   });
   ```

#### Deliverables
- AICategorizationService
- Integration with MemoryIntegration
- Agent-aware insights (unique capability)
- Fallback categorization

---

### Week 6: Enhanced CLI & Documentation (18 hours)

#### Goals
- Memory commands in existing CLI
- Pattern recommendation engine
- Comprehensive documentation

#### Tasks
1. **Enhance Interactive CLI** (8 hours)
   ```javascript
   // Update existing scripts/cli.js or create new memory-cli.js
   const inquirer = require('inquirer');
   const chalk = require('chalk');
   const ora = require('ora');

   async function memoryMenu(memoryStore, searchAPI) {
     const { action } = await inquirer.prompt([
       {
         type: 'list',
         name: 'action',
         message: 'Memory Operations:',
         choices: [
           '1. Search orchestrations',
           '2. View pattern statistics',
           '3. Agent performance report',
           '4. Get recommendations for task',
           '5. Export memory data',
           '6. Clear old data',
           new inquirer.Separator(),
           '7. Back to main menu'
         ]
       }
     ]);

     switch (action) {
       case '1. Search orchestrations':
         await searchOrchestrations(searchAPI);
         break;
       case '2. View pattern statistics':
         await viewPatternStats(memoryStore);
         break;
       case '3. Agent performance report':
         await agentPerformanceReport(memoryStore);
         break;
       case '4. Get recommendations for task':
         await getRecommendations(searchAPI);
         break;
       // ... more cases
     }
   }

   async function searchOrchestrations(searchAPI) {
     const { query } = await inquirer.prompt([
       {
         type: 'input',
         name: 'query',
         message: 'Search query:'
       }
     ]);

     const spinner = ora('Searching...').start();

     try {
       const results = await searchAPI.searchHybrid(query, { limit: 10 });
       spinner.succeed(`Found ${results.length} results`);

       // Display results
       results.forEach((r, idx) => {
         console.log(chalk.cyan(`\n${idx + 1}. [${r.pattern}] ${r.task.substring(0, 80)}`));
         console.log(chalk.gray(`   ${r.success ? '✓' : '✗'} ${new Date(r.timestamp).toLocaleDateString()}`));
         console.log(chalk.yellow(`   Relevance: ${(r.score * 100).toFixed(0)}%`));
       });

     } catch (error) {
       spinner.fail('Search failed');
       console.error(chalk.red(error.message));
     }
   }

   async function getRecommendations(searchAPI) {
     const { task } = await inquirer.prompt([
       {
         type: 'input',
         name: 'task',
         message: 'Describe your task:'
       }
     ]);

     const spinner = ora('Analyzing history...').start();

     const patterns = await searchAPI.getSuccessPatterns(task);
     spinner.succeed('Recommendations ready');

     console.log(chalk.bold('\nRecommended patterns:'));
     patterns.recommendations.forEach((rec, idx) => {
       console.log(chalk.green(
         `${idx + 1}. ${rec.pattern} (${(rec.confidence * 100).toFixed(0)}% confidence, ${rec.successCount} successful uses)`
       ));
     });
   }

   // Add to existing CLI menu structure
   module.exports = { memoryMenu };
   ```

2. **Pattern Recommendation Engine** (5 hours)
   ```javascript
   // .claude/core/pattern-recommender.js
   class PatternRecommender {
     constructor(memoryStore, searchAPI) {
       this.memoryStore = memoryStore;
       this.searchAPI = searchAPI;
     }

     async recommendPattern(task, options = {}) {
       // Find similar past tasks
       const similar = await this.searchAPI.searchHybrid(task, {
         limit: 20,
         successOnly: true
       });

       if (similar.length === 0) {
         return this._defaultRecommendation(task);
       }

       // Analyze pattern distribution
       const patternStats = this._analyzePatterns(similar);

       // Generate recommendation
       return {
         recommended: patternStats[0].pattern,
         confidence: patternStats[0].successRate,
         reasoning: this._buildReasoning(patternStats[0], similar),
         alternatives: patternStats.slice(1, 3),
         basedOn: {
           similarTasks: similar.length,
           historicalData: `${similar.length} orchestrations analyzed`
         }
       };
     }

     _analyzePatterns(orchestrations) {
       const stats = {};

       orchestrations.forEach(orch => {
         if (!stats[orch.pattern]) {
           stats[orch.pattern] = {
             pattern: orch.pattern,
             count: 0,
             successes: 0,
             totalDuration: 0
           };
         }

         const s = stats[orch.pattern];
         s.count++;
         if (orch.success) s.successes++;
         s.totalDuration += orch.duration || 0;
       });

       // Convert to array and calculate metrics
       return Object.values(stats)
         .map(s => ({
           pattern: s.pattern,
           successRate: s.successes / s.count,
           avgDuration: s.totalDuration / s.count,
           sampleSize: s.count
         }))
         .sort((a, b) => b.successRate - a.successRate);
     }

     _buildReasoning(topPattern, similar) {
       const examples = similar
         .filter(s => s.pattern === topPattern.pattern)
         .slice(0, 2)
         .map(s => `"${s.task.substring(0, 60)}..."`);

       return `Pattern "${topPattern.pattern}" has ${(topPattern.successRate * 100).toFixed(0)}% success rate for similar tasks. ` +
         `Based on ${topPattern.sampleSize} past orchestrations. ` +
         `Examples: ${examples.join(', ')}`;
     }

     _defaultRecommendation(task) {
       // No historical data - provide sensible defaults
       const keywords = task.toLowerCase();

       if (keywords.includes('decide') || keywords.includes('choose')) {
         return {
           recommended: 'consensus',
           confidence: 0.6,
           reasoning: 'Decision-making tasks typically benefit from consensus',
           alternatives: [
             { pattern: 'debate', reasoning: 'For complex decisions needing discussion' }
           ]
         };
       }

       // More heuristics...
       return {
         recommended: 'parallel',
         confidence: 0.5,
         reasoning: 'Default recommendation - parallel execution is versatile',
         alternatives: []
       };
     }
   }

   module.exports = PatternRecommender;
   ```

3. **Documentation** (5 hours)
   - Update README.md with memory features
   - Create MEMORY-GUIDE.md
   - Add API documentation
   - Write usage examples

   ```markdown
   # Memory Guide

   ## Quick Start

   Enable memory in your orchestrator:

   \`\`\`javascript
   const orchestrator = new AgentOrchestrator(messageBus, {
     enableMemory: true,
     dbPath: '.claude/memory/orchestrations.db',
     vectorConfig: {
       chromaPath: 'http://localhost:8000'
     },
     aiApiKey: process.env.ANTHROPIC_API_KEY
   });
   \`\`\`

   ## Features

   ### Automatic Memory Capture
   All orchestrations are automatically recorded with:
   - Pattern used
   - Agents involved
   - Task description
   - Results and outcomes
   - Duration and token usage

   ### Smart Context Retrieval
   Before execution, relevant history is retrieved:

   \`\`\`javascript
   const result = await orchestrator.executeParallel(
     ['architect', 'security'],
     'Design authentication system',
     { maxContextTokens: 1000 }  // Token budget for context
   );
   \`\`\`

   ### Pattern Recommendations
   Get AI-powered pattern recommendations:

   \`\`\`javascript
   const recommendation = await patternRecommender.recommendPattern(
     'Implement user authorization'
   );

   console.log(\`Recommended: \${recommendation.recommended}\`);
   console.log(\`Confidence: \${recommendation.confidence}\`);
   console.log(\`Reasoning: \${recommendation.reasoning}\`);
   \`\`\`

   ## CLI Commands

   \`\`\`bash
   npm run cli

   # Then select "Memory Operations" for:
   - Search past orchestrations
   - View pattern statistics
   - Agent performance reports
   - Get pattern recommendations
   - Export/import data
   \`\`\`
   ```

#### Deliverables
- Enhanced CLI with memory operations
- PatternRecommender
- Comprehensive documentation
- Usage examples

---

## 📊 Summary: What You Get

### Core Capabilities (110 hours)
✅ **Persistent Storage**: SQLite + FTS5 (never lose context)
✅ **Vector Search**: Semantic similarity with Chroma
✅ **Progressive Disclosure**: Token-aware context loading
✅ **AI Categorization**: Intelligent observation extraction
✅ **Hybrid Search**: Keyword + semantic combined
✅ **MessageBus Integration**: Seamless with existing architecture
✅ **Enhanced CLI**: Memory operations in interactive interface
✅ **Pattern Recommendations**: AI-powered pattern suggestions

### Unique Features (Your Advantage)
🆕 **Agent-Aware Insights**: Performance tracking per agent
🆕 **Pattern Effectiveness Analysis**: Success rates by pattern
🆕 **Multi-Agent Context**: Captures agent collaboration dynamics
🆕 **Token Optimization**: Built on your existing TokenCounter

### What We Skipped (50 hours saved)
❌ Hook-based lifecycle (using MessageBus instead)
❌ MCP protocol (not needed for framework)
❌ PM2 complexity (in-process by default)
❌ Complex web UI (CLI-first approach)

---

## 🚀 Getting Started

### This Week: Start Phase 1

```bash
# 1. Install dependencies
npm install better-sqlite3

# 2. Create memory directory
mkdir -p .claude/memory

# 3. Run tests
npm test
```

### Configuration

```javascript
// Enable memory (add to your initialization)
const orchestrator = new AgentOrchestrator(messageBus, {
  enableMemory: true,  // Default: true (opt-out if needed)
  dbPath: '.claude/memory/orchestrations.db',

  // Optional: Vector search (Week 3)
  vectorConfig: {
    chromaPath: 'http://localhost:8000'
  },

  // Optional: AI categorization (Week 5)
  aiApiKey: process.env.ANTHROPIC_API_KEY
});
```

---

## Next Steps

**Ready to implement Week 1 (Storage Foundation)?**

I can start by:
1. Creating the database schema
2. Implementing the MemoryStore class
3. Setting up MessageBus integration
4. Writing tests

**Which would you like to start with?**
