#!/usr/bin/env python3
"""
Insert Learning Systems section into FRAMEWORK-OVERVIEW.md
"""

# Read the current overview file
with open('docs/FRAMEWORK-OVERVIEW.md', 'r', encoding='utf-8') as f:
    content = f.read()

# Find insertion point (before "## Usage Analytics")
insertion_marker = "## Usage Analytics"
insertion_point = content.find(insertion_marker)

if insertion_point == -1:
    print("ERROR: Could not find '## Usage Analytics' section")
    exit(1)

# Learning Systems content
learning_systems_section = """## Learning Systems

The framework includes **six interconnected learning systems** that enable agents to continuously improve by capturing, analyzing, and leveraging historical execution data.

### Overview of Learning Systems

**Six Core Learning Systems**:

1. **Persistent Memory System** (MemoryStore) - Saves all orchestration history
2. **Semantic Search System** (VectorStore) - Finds similar past work by meaning
3. **Intelligent Context Loading** (ContextRetriever) - Loads relevant history efficiently
4. **AI Observation Extraction** (AICategorizationService) - Extracts key learnings
5. **Pattern Recommendation** (PatternRecommender) - Suggests best patterns/teams
6. **Usage Analytics** (UsageTracker) - Learns cost-efficient approaches

These systems work together to create a **continuously improving agent framework** where each execution makes the system smarter.

### 1. Persistent Memory System (MemoryStore)

**Purpose**: Save complete history of all orchestrations for future learning

**Technology**: SQLite with FTS5 full-text search

**What Gets Stored**:
- Pattern used (parallel, consensus, debate, etc.)
- Agents involved (IDs, roles, configurations)
- Task details (type, parameters, context)
- Results (outputs, success/failure, performance)
- Observations (key learnings, decisions made)
- Token usage and costs
- Timestamps and execution metadata

**Search Capabilities**:
- **Keyword Search**: Fast FTS5 search with BM25 ranking (<10ms)
- **Filtered Queries**: By agent, pattern, date range, success/failure
- **Analytics Queries**: Success rates, cost analysis, usage patterns

**Performance**:
- SQLite WAL mode enables concurrent reads
- FTS5 index provides near-instant keyword search
- Automatic cleanup of old records (configurable retention)

**Learning Value**:
- Complete audit trail of all work
- Foundation for all other learning systems
- Enables "what worked before?" queries

### 2. Semantic Search System (VectorStore)

**Purpose**: Find similar past orchestrations by **meaning**, not just keywords

**Technology**: Chroma vector database with embeddings

**How It Works**:
1. After orchestration completes, vectorize task + result
2. Store embedding in Chroma with metadata
3. On new task, vectorize and search for similar embeddings
4. Return most relevant past orchestrations by semantic similarity

**Search Types**:
- **Pure Vector Search**: Cosine similarity on embeddings
- **Hybrid Search** (Default): 70% vector + 30% keywords (best of both)
- **Filtered Vector Search**: Semantic search within specific agents/patterns

**Performance**:
- ~100ms typical search time
- Circuit breaker pattern (fallback to FTS5 if Chroma fails)
- Handles 10,000+ embeddings efficiently
- Async vectorization (doesn't block main execution)

**Learning Value**:
- Finds conceptually similar work, even with different wording
- Understands intent, not just exact terms
- Example: "analyze competitor landscape" matches "research market positioning"

**Graceful Degradation**:
```
VectorStore available → Hybrid search (best)
VectorStore fails → FTS5-only search (good)
Both fail → Empty results (graceful)
```

### 3. Intelligent Context Loading (ContextRetriever)

**Purpose**: Load **relevant** historical context within **token budgets**

**Challenge**: Can't load entire history (too expensive in tokens/cost)

**Solution**: Progressive disclosure in 2 layers

**Layer 1 - Index (Lightweight)**:
- Orchestration IDs and brief summaries
- Relevance scores
- ~5-10 tokens per item
- Shows "what's available"

**Layer 2 - Details (On-Demand)**:
- Full orchestration records
- Complete observations and insights
- ~100-500 tokens per item
- Load only what's needed

**Token Budget Management**:
- Default: 2000 tokens
- Configurable per execution
- 20% safety buffer
- Smart truncation (preserves high-value data)

**Caching**:
- LRU cache (100 entries, 5min TTL)
- Cache hit rate >70% after warmup
- Reduces database queries

**Learning Value**:
- Provides agents with relevant past experiences
- Stays within token budgets (cost-efficient)
- Scales to thousands of orchestrations

**Example**:
```
Task: "Research AI frameworks 2025"
Context Retrieved:
  - 3 similar research orchestrations (Layer 1 index)
  - 1 most relevant full details (Layer 2)
  - Total: 350 tokens (under budget)
```

### 4. AI-Powered Observation Extraction (AICategorizationService)

**Purpose**: Automatically extract **key learnings** from orchestration results

**Problem**: Results are long/complex - what should we remember?

**Solution**: AI analyzes results and extracts structured observations

**Categorization Types**:
- `decision` - Strategic choices made
- `bugfix` - Bug resolution patterns
- `feature` - New functionality added
- `pattern-usage` - Multi-agent pattern effectiveness
- `discovery` - New insights or learnings
- `refactor` - Code improvement approaches

**Extraction Process**:
1. Analyze orchestration result (task + outputs)
2. Identify key observations
3. Categorize each observation
4. Extract important concepts/tags
5. Generate per-agent insights
6. Assign importance score (1-10)

**AI Model**: Claude 3.5 Sonnet (configurable)

**Fallback Strategy**:
- Try Claude API first (high quality)
- Fall back to rule-based keyword matching (fast)
- Skip if both fail (graceful, doesn't block)

**Learning Value**:
- Converts raw results → structured knowledge
- Identifies what matters for future reference
- Per-agent insights (what each agent learned)
- Importance scoring (prioritize valuable learnings)

### 5. Pattern Recommendation System (PatternRecommender)

**Purpose**: Suggest **best orchestration pattern** and **agent teams** based on historical success

**How It Works**:
1. User provides task description
2. Analyze historical orchestrations for similar tasks
3. Calculate success rates by pattern
4. Recommend pattern + agent team with highest success likelihood

**Analysis Factors**:
- Historical success rate per pattern
- Task similarity (semantic matching)
- Agent team effectiveness
- Cost efficiency
- Execution time

**Learning Value**:
- Learn which patterns work best for which tasks
- Identify effective agent combinations
- Predict success likelihood
- Optimize for cost and time

**Continuous Improvement**:
- Gets smarter with every execution
- Learns from both successes and failures
- Adapts recommendations based on recent trends

### 6. Usage Analytics & Cost Learning (UsageTracker)

**Purpose**: Learn **cost-efficient** approaches through usage analytics

**What Gets Tracked**:
- Token usage (input, output, cache)
- Cost per orchestration
- Cost per agent
- Cost per pattern
- Time per execution
- Success/failure rates

**Budget Management**:
- Daily/monthly budget limits
- Real-time tracking
- Alert thresholds (warning at 80%, critical at 95%)
- Automatic cleanup of old records

**Cost Learning**:
- Identifies most cost-efficient agents
- Finds most cost-efficient patterns
- Calculates ROI (value vs cost)
- Recommends budget-friendly alternatives

**Reporting**:
- Daily/monthly usage reports
- Pattern cost analysis
- Agent efficiency rankings
- Cost projections
- Budget status

**Learning Value**:
- Optimize spending over time
- Identify expensive patterns/agents
- Learn cost/quality tradeoffs
- Make budget-aware recommendations

### How Learning Systems Work Together

**Example: Research Task**

1. **User Request**: "Research AI frameworks for production use"

2. **Pattern Recommendation** (PatternRecommender):
   - Analyzes: "This is a research task needing multiple perspectives"
   - Recommends: Parallel pattern with 3 research agents
   - Confidence: 0.88 (based on 15 similar past tasks)

3. **Context Loading** (ContextRetriever):
   - Searches: Similar research tasks (MemoryStore + VectorStore)
   - Finds: 3 past framework research tasks
   - Loads: Layer 1 index + top 1 full details
   - Budget: 350 tokens of 2000 allowed

4. **Execution**: Parallel pattern with historical context

5. **Memory Save** (MemoryStore):
   - Stores: Complete orchestration record
   - Indexes: For fast keyword search

6. **Semantic Indexing** (VectorStore):
   - Vectorizes: Task + results
   - Stores: Embedding for future similarity search

7. **AI Observation Extraction** (AICategorizationService):
   - Analyzes: Results from 3 agents
   - Extracts: Key decisions, insights, comparisons
   - Categories: 2 decisions, 3 discoveries, 1 pattern-usage
   - Importance: Scores 6-9 (high value)

8. **Usage Tracking** (UsageTracker):
   - Records: 4,500 tokens, $0.14 cost
   - Updates: Pattern stats, agent stats
   - Checks: Budget status (15% of daily budget used)

9. **Learning Outcome**:
   - System now "knows" this framework comparison
   - Future similar tasks will reference this work
   - Pattern recommendation updated with success data
   - Cost data improves budget predictions

### Benefits of Learning Systems

**1. Continuous Improvement**:
- Every execution makes the system smarter
- No manual knowledge management needed
- Learns from both successes and failures

**2. Context Preservation**:
- Agents never start from zero
- Historical context always available
- Organizational knowledge builds over time

**3. Cost Optimization**:
- Learns cost-efficient approaches
- Identifies expensive patterns
- Provides budget-aware recommendations

**4. Quality Enhancement**:
- Learn what works, what doesn't
- Recommend proven patterns
- Leverage past successes

**5. Scalability**:
- Progressive disclosure handles large history
- Semantic search finds relevant work efficiently
- Token budgets prevent runaway costs

**6. Transparency**:
- Full audit trail of all work
- Understand why recommendations made
- Track improvement over time

### Performance Characteristics

| System | Operation | Avg Time | Cost Impact |
|--------|-----------|----------|-------------|
| MemoryStore | Save orchestration | <10ms | None |
| MemoryStore | Keyword search | <10ms | None |
| VectorStore | Semantic search | ~100ms | None |
| VectorStore | Add embedding | ~50ms | None |
| ContextRetriever | Layer 1 load | <50ms | ~100 tokens |
| ContextRetriever | Layer 2 load | <200ms | ~500 tokens |
| AICategorizationService | AI extract | ~2s | ~$0.002 |
| AICategorizationService | Rule-based | <1ms | None |
| PatternRecommender | Analyze + recommend | <100ms | None |
| UsageTracker | Track usage | <5ms | None |

**Total Overhead Per Orchestration**:
- Time: ~1-2s (mostly async)
- Tokens: ~100-500 (context loading)
- Cost: ~$0.002-0.003 (AI categorization optional)

### Configuration

All learning systems are **opt-in** with sensible defaults:

```javascript
const orchestrator = new AgentOrchestrator(messageBus, {
  // Memory System
  enableMemory: true,  // Default: true
  dbPath: '.claude/memory/orchestrations.db',

  // Semantic Search
  vectorStore: new VectorStore(),  // Default: enabled

  // Context Loading
  contextTokenBudget: 2000,  // Default: 2000 tokens

  // AI Categorization
  enableAI: false,  // Default: false (requires API key)

  // Usage Analytics
  enableCostTracking: true,  // Default: true
  dailyBudget: 10.00,  // USD
  monthlyBudget: 200.00,  // USD

  // Pattern Recommendation
  enablePatternRecommendation: true  // Default: true
});
```

**Graceful Degradation**:
- All learning systems are optional
- System works without any learning enabled
- Each system has fallback strategies
- No single point of failure

---

"""

# Insert the section
new_content = content[:insertion_point] + learning_systems_section + content[insertion_point:]

# Write to new file
with open('docs/FRAMEWORK-OVERVIEW-new.md', 'w', encoding='utf-8') as f:
    f.write(new_content)

print("SUCCESS: Created docs/FRAMEWORK-OVERVIEW-new.md")
print(f"Inserted Learning Systems section before Usage Analytics")
print(f"Original file: {len(content)} characters")
print(f"New file: {len(new_content)} characters")
print(f"Learning Systems section: {len(learning_systems_section)} characters")
