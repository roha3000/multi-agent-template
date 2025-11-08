# Claude-Mem Integration Plan
## Incorporating Persistent Memory into Multi-Agent Framework

**Created**: 2025-01-08
**Status**: Planning Phase
**Estimated Effort**: 6-8 weeks (120-160 hours)
**Strategic Goal**: Transform multi-agent framework with persistent memory capabilities

---

## Executive Summary

This plan outlines the integration of innovative features from claude-mem (persistent memory system) into our existing multi-agent orchestration framework. The goal is to create a **memory-enabled multi-agent system** where agents can:

1. **Remember** previous orchestration patterns and outcomes
2. **Learn** from past agent collaborations and decisions
3. **Retrieve** relevant historical context for better decision-making
4. **Track** agent evolution and improvement over time

---

## Claude-Mem Innovations Analysis

### 🎯 High-Impact Features to Adopt

#### 1. **Persistent Storage Layer** (Priority: CRITICAL)
**Claude-mem feature**: SQLite database with FTS5 full-text search
**Value proposition**: Agents lose all context between sessions currently

**What we'll gain**:
- Agent execution history persists across sessions
- Orchestration patterns can be analyzed and optimized
- Debugging becomes easier with historical data
- Performance metrics tracked over time

#### 2. **Observation Capture System** (Priority: HIGH)
**Claude-mem feature**: Automatic tool usage observation with AI categorization
**Value proposition**: Currently no automated learning from agent interactions

**What we'll gain**:
- Automatic capture of agent decisions and outcomes
- Categorization by type: decision, bugfix, feature, refactor, discovery
- Concept tagging for intelligent retrieval
- Timeline of agent evolution

#### 3. **Progressive Disclosure** (Priority: HIGH)
**Claude-mem feature**: Layered context retrieval with token cost visibility
**Value proposition**: Better token management for agent orchestration

**What we'll gain**:
- Agents can query "what have we done before?" efficiently
- Token-aware context loading
- Smart caching of frequently used patterns
- Cost-optimized memory retrieval

#### 4. **Search & Query Tools** (Priority: MEDIUM)
**Claude-mem feature**: 9 specialized MCP search tools
**Value proposition**: Rich querying of orchestration history

**What we'll gain**:
- Find similar past orchestration patterns
- Query by agent, task type, outcome, timeframe
- Learn from successful patterns
- Avoid repeating failures

#### 5. **Web Viewer Dashboard** (Priority: LOW)
**Claude-mem feature**: Real-time web UI at localhost:37777
**Value proposition**: Visualization and monitoring

**What we'll gain**:
- Visual monitoring of agent orchestrations
- Real-time status dashboard
- Historical pattern visualization
- Debugging interface

#### 6. **Vector Search Integration** (Priority: MEDIUM)
**Claude-mem feature**: Chroma vector database for semantic search
**Value proposition**: Find conceptually similar orchestrations

**What we'll gain**:
- Semantic similarity search across orchestrations
- Find patterns even with different wording
- Better recommendation system
- Intelligent context retrieval

---

## Architecture Integration Design

### Current Multi-Agent Architecture
```
User Request
    ↓
MessageBus (in-memory, ephemeral)
    ↓
AgentOrchestrator (5 patterns: parallel, consensus, debate, review, ensemble)
    ↓
Agent Base Class (stateful during execution, forgotten after)
    ↓
Results (returned, not persisted)
```

### Proposed Memory-Enabled Architecture
```
User Request
    ↓
[NEW] ObservationCapture Layer ← Intercepts all agent activity
    ↓
MessageBus (enhanced with persistence hooks)
    ↓
AgentOrchestrator (patterns + memory retrieval)
    ↓                           ↓
Agent Base Class        [NEW] Memory Query Interface
    ↓                           ↓
Results                 [NEW] SQLite + FTS5 + Chroma
    ↓
[NEW] SummaryGenerator (AI-powered compression)
    ↓
[NEW] Persistent Storage Layer
```

### Key New Components

#### 1. **MemoryStore** (Core component)
```javascript
class MemoryStore {
  constructor(dbPath) {
    this.db = new SQLiteDB(dbPath);
    this.vectorDB = new ChromaClient();
    this.fts = new FTS5Index();
  }

  async recordOrchestration(orchestrationData) {
    // Store orchestration details
    // Extract observations
    // Generate embeddings
    // Update indexes
  }

  async queryRelevant(context, options = {}) {
    // Hybrid search: FTS5 + vector similarity
    // Progressive disclosure: summary first
    // Token-aware retrieval
  }

  async getOrchestrationHistory(filters) {
    // Query by agent, pattern, outcome, timeframe
  }
}
```

#### 2. **ObservationExtractor** (Agent activity capture)
```javascript
class ObservationExtractor {
  constructor(memoryStore) {
    this.memoryStore = memoryStore;
    this.aiCategorizer = new AICategorizationService();
  }

  async captureOrchestration(agentIds, task, result, metadata) {
    // Extract key decisions
    // Categorize by type (decision, feature, refactor, etc.)
    // Tag with concepts
    // Associate with agents and patterns
    const observation = await this.aiCategorizer.process({
      agentIds,
      task,
      result,
      metadata
    });

    await this.memoryStore.recordObservation(observation);
  }
}
```

#### 3. **ContextRetriever** (Progressive disclosure)
```javascript
class ContextRetriever {
  constructor(memoryStore) {
    this.memoryStore = memoryStore;
  }

  async getRelevantContext(task, options = {}) {
    const { maxTokens = 2000, includeDetails = false } = options;

    // Layer 1: Index of relevant orchestrations (low token cost)
    const index = await this.memoryStore.searchRelevant(task, {
      limit: 10,
      summaryOnly: true
    });

    if (!includeDetails) {
      return { index, tokenCost: this.estimateTokens(index) };
    }

    // Layer 2: Full details on demand (higher token cost)
    const details = await this.memoryStore.getFullDetails(index.ids);

    return { index, details, tokenCost: this.estimateTokens(details) };
  }
}
```

#### 4. **MemorySearchAPI** (Query interface)
```javascript
class MemorySearchAPI {
  // Similar to claude-mem's 9 MCP tools
  async searchOrchestrations(query, filters) {}
  async findByAgent(agentId, timeframe) {}
  async findByPattern(patternType) {}
  async findByConcept(conceptTags) {}
  async getRecentContext(hours = 24) {}
  async getTimeline(orchestrationId) {}
  async getSimilarOrchestrations(orchestrationId) {}
}
```

---

## Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2) - 30 hours

#### Week 1: Storage Layer
**Goal**: Implement SQLite database with FTS5 support

**Tasks**:
1. Install dependencies: `better-sqlite3`, `chromadb-client` (2 hours)
2. Design database schema:
   - `orchestrations` table
   - `observations` table
   - `agents` table
   - `sessions` table
   - FTS5 virtual tables for search (4 hours)
3. Implement `MemoryStore` class (6 hours)
4. Write storage tests (3 hours)

**Deliverables**:
```bash
.claude/core/
├── memory-store.js       # Core storage interface
├── schema.sql            # Database schema
└── __tests__/
    └── memory-store.test.js
```

**Database Schema**:
```sql
-- Orchestrations: Record of each multi-agent execution
CREATE TABLE orchestrations (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  pattern TEXT NOT NULL,  -- parallel, consensus, debate, review, ensemble
  task TEXT NOT NULL,
  agent_ids TEXT NOT NULL,  -- JSON array
  result TEXT,
  metadata TEXT,  -- JSON: duration, success, token_count, etc.
  session_id TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Observations: Extracted learnings from orchestrations
CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  orchestration_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL,  -- decision, bugfix, feature, refactor, discovery, change
  content TEXT NOT NULL,
  concepts TEXT,  -- JSON array of concept tags
  agent_id TEXT,
  importance INTEGER DEFAULT 5,  -- 1-10 scale
  FOREIGN KEY (orchestration_id) REFERENCES orchestrations(id)
);

-- FTS5 for full-text search
CREATE VIRTUAL TABLE observations_fts USING fts5(
  content,
  concepts,
  content='observations',
  content_rowid='rowid'
);

-- Agents: Track agent usage and performance
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  total_executions INTEGER DEFAULT 0,
  successful_executions INTEGER DEFAULT 0,
  avg_duration INTEGER DEFAULT 0,
  last_used INTEGER
);

-- Sessions: Group related orchestrations
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  project_name TEXT,
  description TEXT
);
```

#### Week 2: Observation Capture
**Goal**: Automatic capture of agent orchestration data

**Tasks**:
1. Implement `ObservationExtractor` class (4 hours)
2. Add hooks to `AgentOrchestrator` for automatic capture (4 hours)
3. Create AI categorization service (placeholder for now) (3 hours)
4. Write observation capture tests (3 hours)
5. Integration testing with existing orchestrator (4 hours)

**Deliverables**:
```bash
.claude/core/
├── observation-extractor.js
├── ai-categorizer.js
└── __tests__/
    └── observation-extractor.test.js
```

**Integration Points**:
```javascript
// Modified AgentOrchestrator
class AgentOrchestrator {
  constructor(messageBus, options = {}) {
    this.messageBus = messageBus;
    this.agents = new Map();

    // NEW: Memory integration
    if (options.enableMemory) {
      this.memoryStore = new MemoryStore(options.dbPath);
      this.observationExtractor = new ObservationExtractor(this.memoryStore);
      this.contextRetriever = new ContextRetriever(this.memoryStore);
    }
  }

  async executeParallel(agentIds, task, options = {}) {
    // BEFORE execution: Retrieve relevant context
    let context = {};
    if (this.contextRetriever) {
      context = await this.contextRetriever.getRelevantContext(task, {
        maxTokens: options.maxContextTokens || 1000
      });
      logger.info('Retrieved context', {
        relevantOrchestrations: context.index.length,
        tokenCost: context.tokenCost
      });
    }

    // Execute (existing logic)
    const result = await this._executeParallelInternal(agentIds, task, context);

    // AFTER execution: Capture observations
    if (this.observationExtractor) {
      await this.observationExtractor.captureOrchestration(
        agentIds,
        task,
        result,
        { pattern: 'parallel', duration: result.duration }
      );
    }

    return result;
  }
}
```

---

### Phase 2: Search & Retrieval (Weeks 3-4) - 35 hours

#### Week 3: Vector Search Integration
**Goal**: Add semantic search with Chroma vector database

**Tasks**:
1. Set up Chroma client and collection (3 hours)
2. Implement embedding generation (use existing AI or OpenAI API) (4 hours)
3. Create vector indexing on orchestration capture (4 hours)
4. Implement hybrid search (FTS5 + vector similarity) (6 hours)
5. Write search tests (3 hours)

**Deliverables**:
```bash
.claude/core/
├── vector-store.js
├── embedding-generator.js
└── __tests__/
    └── vector-store.test.js
```

#### Week 4: Search API & Query Tools
**Goal**: Implement rich query interface

**Tasks**:
1. Create `MemorySearchAPI` class with 7-9 search methods (8 hours)
2. Implement progressive disclosure logic (4 hours)
3. Add token cost estimation (2 hours)
4. Write comprehensive search tests (3 hours)

**Search Methods to Implement**:
```javascript
class MemorySearchAPI {
  // 1. General search across all orchestrations
  async searchOrchestrations(query, filters = {}) {
    // Hybrid: FTS5 + vector search
    // Filters: pattern, agent, date range, success/failure
  }

  // 2. Find by specific agent
  async findByAgent(agentId, options = {}) {
    // All orchestrations involving this agent
    // Performance metrics
    // Common patterns
  }

  // 3. Find by orchestration pattern
  async findByPattern(patternType) {
    // parallel, consensus, debate, review, ensemble
    // Success rates
    // Typical durations
  }

  // 4. Find by concept tags
  async findByConcept(conceptTags) {
    // e.g., "authentication", "API design", "error handling"
  }

  // 5. Recent context (last N hours/days)
  async getRecentContext(timeframe = { hours: 24 }) {
    // Recent orchestrations
    // Trending patterns
  }

  // 6. Timeline of related orchestrations
  async getTimeline(orchestrationId) {
    // What led to this?
    // What came after?
    // Related decision chain
  }

  // 7. Similar orchestrations (semantic)
  async getSimilarOrchestrations(orchestrationId, limit = 10) {
    // Vector similarity search
    // "We did something like this before..."
  }

  // 8. Success pattern analysis
  async getSuccessPatterns(taskType) {
    // What patterns worked best for similar tasks?
    // Agent combinations that succeeded
  }

  // 9. Failure analysis
  async getFailurePatterns(taskType) {
    // What to avoid
    // Common failure modes
  }
}
```

---

### Phase 3: Progressive Disclosure (Week 5) - 20 hours

**Goal**: Implement token-aware context loading

**Tasks**:
1. Create `ContextRetriever` class (5 hours)
2. Implement layered disclosure (summary → details → full) (5 hours)
3. Add token cost calculation (3 hours)
4. Create smart caching for frequent queries (4 hours)
5. Write retrieval tests (3 hours)

**Progressive Disclosure Strategy**:
```javascript
// Layer 1: Index/Summary (Low token cost ~50-200 tokens)
{
  relevantOrchestrations: [
    {
      id: "orch-123",
      pattern: "parallel",
      task: "Design authentication system",
      agents: ["architect", "security"],
      outcome: "success",
      timestamp: "2025-01-05",
      summary: "Successfully designed JWT-based auth with 2FA",
      tokenCost: 15  // To fetch full details
    },
    // ... more results
  ],
  totalResults: 5,
  tokenCost: 75
}

// Layer 2: Details on demand (Medium cost ~200-1000 tokens)
{
  fullObservations: [
    {
      type: "decision",
      content: "Chose JWT over session-based auth due to...",
      concepts: ["authentication", "JWT", "security"],
      reasoning: "...",
      outcome: "Implemented successfully, 30% faster than sessions"
    }
  ],
  agentDialogue: "...",  // Optional: agent message history
  tokenCost: 450
}

// Layer 3: Complete transcript (High cost ~1000+ tokens)
// Only fetched when explicitly requested
```

---

### Phase 4: AI Categorization (Week 6) - 25 hours

**Goal**: Intelligent observation extraction and categorization

**Tasks**:
1. Design categorization prompt templates (3 hours)
2. Implement AI categorizer using Claude API (6 hours)
3. Add concept extraction and tagging (5 hours)
4. Implement importance scoring (1-10 scale) (3 hours)
5. Create batch processing for historical data (4 hours)
6. Write categorization tests (4 hours)

**AI Categorization Implementation**:
```javascript
class AICategorizationService {
  constructor(apiKey) {
    this.anthropic = new Anthropic({ apiKey });
  }

  async categorizeObservation(orchestrationData) {
    const prompt = `
Analyze this multi-agent orchestration and extract key learnings:

**Pattern**: ${orchestrationData.pattern}
**Task**: ${orchestrationData.task}
**Agents**: ${orchestrationData.agentIds.join(', ')}
**Result**: ${orchestrationData.result}
**Duration**: ${orchestrationData.metadata.duration}ms

Extract:
1. Type: decision, bugfix, feature, refactor, discovery, change
2. Key concepts/tags (3-7 keywords)
3. Main learning/observation (1-2 sentences)
4. Importance (1-10, where 10 is critically important)
5. Recommendations for future similar tasks

Format as JSON:
{
  "type": "...",
  "concepts": ["...", "..."],
  "observation": "...",
  "importance": N,
  "recommendations": "..."
}
`;

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    });

    return JSON.parse(response.content[0].text);
  }

  async batchCategorize(orchestrations, options = {}) {
    // Process multiple orchestrations efficiently
    // Use rate limiting and batch API if available
  }
}
```

---

### Phase 5: Web Dashboard (Week 7) - 25 hours

**Goal**: Build monitoring and visualization interface

**Tasks**:
1. Set up Express server (3 hours)
2. Create REST API endpoints for data access (5 hours)
3. Build HTML/CSS/JS frontend (8 hours)
4. Implement real-time updates with SSE (4 hours)
5. Add filtering and search UI (3 hours)
6. Write integration tests (2 hours)

**Dashboard Features**:
- Real-time orchestration monitoring
- Historical pattern visualization
- Agent performance metrics
- Search and filter interface
- Timeline view
- Export functionality

**Server Structure**:
```bash
.claude/
├── server/
│   ├── index.js           # Express server
│   ├── routes/
│   │   ├── api.js         # REST API
│   │   └── sse.js         # Server-Sent Events
│   └── public/
│       ├── index.html     # Dashboard UI
│       ├── styles.css
│       └── app.js
```

---

### Phase 6: Integration & Polish (Week 8) - 25 hours

**Goal**: Complete integration and documentation

**Tasks**:
1. Update all orchestration patterns with memory (6 hours)
2. Add CLI commands for memory management (4 hours)
3. Create migration script for existing data (3 hours)
4. Write comprehensive documentation (6 hours)
5. Create usage examples and tutorials (4 hours)
6. Performance optimization and testing (2 hours)

**New CLI Commands**:
```bash
# Memory management
npm run memory:status          # Show storage stats
npm run memory:search "query"  # Search orchestrations
npm run memory:export          # Export database
npm run memory:clear           # Clear old data
npm run memory:analyze         # Generate insights

# Dashboard
npm run dashboard             # Start web viewer
npm run dashboard:stop        # Stop web viewer
```

---

## Priority Matrix

### Impact vs Effort Analysis

```
High Impact, Low Effort (DO FIRST):
✓ SQLite storage layer (15h)
✓ Basic observation capture (12h)
✓ FTS5 search (8h)

High Impact, Medium Effort (DO SECOND):
✓ Vector search integration (17h)
✓ Progressive disclosure (20h)
✓ Search API (12h)

High Impact, High Effort (DO THIRD):
✓ AI categorization (25h)
✓ Web dashboard (25h)

Low Impact, Variable Effort (OPTIONAL):
- Advanced analytics
- Machine learning recommendations
- Multi-database support
```

### Recommended Implementation Order

**Sprint 1 (Weeks 1-2): Storage Foundation**
- SQLite + FTS5 setup
- Basic observation capture
- Integration with orchestrator

**Sprint 2 (Weeks 3-4): Search Capabilities**
- Vector search with Chroma
- Hybrid search implementation
- Query API development

**Sprint 3 (Weeks 5-6): Intelligence Layer**
- Progressive disclosure
- AI categorization
- Smart caching

**Sprint 4 (Weeks 7-8): Polish & Dashboard**
- Web viewer
- Documentation
- Performance optimization

---

## Migration Strategy

### For Existing Multi-Agent Projects

**Step 1: Non-Breaking Addition**
```javascript
// Memory is opt-in initially
const orchestrator = new AgentOrchestrator(messageBus, {
  enableMemory: true,  // NEW: Enable memory features
  dbPath: '.claude/memory/orchestrations.db'
});
```

**Step 2: Gradual Adoption**
```javascript
// Use memory only for specific patterns
const result = await orchestrator.executeParallel(
  agentIds,
  task,
  {
    useMemory: true,  // Query past similar orchestrations
    recordMemory: true  // Save this orchestration
  }
);
```

**Step 3: Full Integration**
```javascript
// Default behavior includes memory
// Opt-out if needed
const result = await orchestrator.executeDebate(
  agentIds,
  topic,
  3,
  { useMemory: false }  // Explicit opt-out
);
```

---

## Success Metrics

### Technical Metrics
- [ ] Storage layer passes all tests (100% coverage)
- [ ] Query response time < 100ms for index, < 500ms for details
- [ ] Vector search accuracy > 80% relevance
- [ ] Token cost reduction > 30% through smart caching
- [ ] Zero data loss across sessions

### User Experience Metrics
- [ ] Agents find relevant past orchestrations > 70% of the time
- [ ] Progressive disclosure reduces unnecessary token usage by > 40%
- [ ] Dashboard provides actionable insights
- [ ] Setup time < 5 minutes for new projects

### Business Metrics
- [ ] Orchestration success rate improves by > 15%
- [ ] Development velocity increases by > 20%
- [ ] Bug recurrence decreases by > 30%
- [ ] Documentation quality improves (measured by completeness)

---

## Risk Assessment & Mitigation

### Technical Risks

**Risk 1: SQLite Performance at Scale**
- *Likelihood*: Medium
- *Impact*: High
- *Mitigation*:
  - Implement database sharding for large projects
  - Add data archival for old orchestrations
  - Monitor and optimize indexes

**Risk 2: Vector Database Dependencies**
- *Likelihood*: Low
- *Impact*: Medium
- *Mitigation*:
  - Make Chroma optional (FTS5 fallback)
  - Document installation requirements clearly
  - Provide Docker setup for easy deployment

**Risk 3: AI Categorization Costs**
- *Likelihood*: Medium
- *Impact*: Medium
- *Mitigation*:
  - Batch processing to reduce API calls
  - Caching of common patterns
  - Optional manual categorization fallback

### Integration Risks

**Risk 4: Breaking Changes to Existing Code**
- *Likelihood*: Low
- *Impact*: High
- *Mitigation*:
  - Opt-in memory features (backward compatible)
  - Comprehensive testing
  - Deprecation warnings for any changes

**Risk 5: Learning Curve for Users**
- *Likelihood*: Medium
- *Impact*: Medium
- *Mitigation*:
  - Extensive documentation and examples
  - Progressive feature introduction
  - Video tutorials and guides

---

## Cost Analysis

### Development Costs
- **Engineer Time**: 160 hours @ $100/hr = $16,000
- **AI API Usage** (for categorization): ~$50-100/month for medium usage
- **Infrastructure**: Minimal (SQLite is free, Chroma can run locally)

### Operational Costs
- **Storage**: ~100MB per 10,000 orchestrations
- **Vector DB**: Local deployment = $0, or $20-50/month hosted
- **AI Categorization**: ~$0.01-0.02 per orchestration

### ROI Projection
- **Time Saved**: 20% faster development = ~$3,000/month for small team
- **Quality Improvement**: 30% fewer bugs = ~$2,000/month in reduced rework
- **Break-even**: ~3-4 months

---

## Next Steps

### Immediate Actions (This Week)

1. **Review and approve this plan** (1 hour)
2. **Set up development environment** (2 hours)
   - Install SQLite dependencies
   - Configure test database
   - Set up project structure

3. **Start Phase 1, Week 1** (15 hours)
   - Implement storage layer
   - Write database schema
   - Basic tests

### Decision Points

**Decision 1: Chroma Integration Timing**
- Option A: Include in Phase 2 (recommended)
- Option B: Defer to Phase 4 (lower priority)
- **Recommendation**: Option A - semantic search is high value

**Decision 2: AI Categorization Service**
- Option A: Use Claude API (best quality, costs money)
- Option B: Use local LLM (free, lower quality)
- Option C: Manual categorization initially (no cost, high effort)
- **Recommendation**: Option A with Option C fallback

**Decision 3: Dashboard Complexity**
- Option A: Full-featured dashboard (Week 7)
- Option B: Basic monitoring UI (reduced scope)
- Option C: CLI-only initially (defer dashboard)
- **Recommendation**: Option B initially, upgrade to A later

---

## Questions for Discussion

1. **Timeline**: Is 8 weeks acceptable, or do we need to accelerate?
2. **Scope**: Are there any features we should add/remove?
3. **Resources**: Do we need additional developers or can one person handle this?
4. **Priority**: Which phase should we start with? (Recommendation: Phase 1)
5. **Budget**: What's the budget for AI API usage?

---

## Conclusion

Integrating claude-mem's innovations will transform our multi-agent framework from a stateless orchestration system into an **intelligent, learning system** that improves over time. The persistent memory capabilities will:

- **Reduce repetitive work** through learning from past orchestrations
- **Improve decision quality** through historical pattern analysis
- **Accelerate development** through smart context retrieval
- **Enable continuous improvement** through automated observation capture

**Recommended Action**: Proceed with Phase 1 (Storage Foundation) immediately. This provides immediate value (data persistence) while being low-risk and foundational for all other features.

---

**Ready to start implementation? Let me know which phase you'd like to begin with!**
