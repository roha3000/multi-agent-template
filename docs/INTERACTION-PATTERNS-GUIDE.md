# Interaction Patterns & Usage Guide

**Version**: 1.0.0
**Last Updated**: 2025-11-09
**Target Audience**: Framework adopters, developers

---

## Table of Contents

1. [Quick Start Examples](#quick-start-examples)
2. [Orchestration Patterns in Depth](#orchestration-patterns-in-depth)
3. [Memory Integration Patterns](#memory-integration-patterns)
4. [Agent Communication Patterns](#agent-communication-patterns)
5. [Cost Optimization Patterns](#cost-optimization-patterns)
6. [Error Handling Patterns](#error-handling-patterns)
7. [Advanced Patterns](#advanced-patterns)
8. [Best Practices](#best-practices)
9. [Common Recipes](#common-recipes)

---

## Quick Start Examples

### Example 1: Basic Parallel Execution

**Use Case**: Research a topic from multiple expert perspectives

```javascript
const MessageBus = require('./.claude/core/message-bus');
const AgentOrchestrator = require('./.claude/core/agent-orchestrator');
const AgentLoader = require('./.claude/core/agent-loader');

// Setup
const messageBus = new MessageBus();
const orchestrator = new AgentOrchestrator(messageBus);
const loader = new AgentLoader();

// Load agents
await loader.initialize();
const agents = loader.getAgentsByCategory('research');
agents.forEach(agent => orchestrator.registerAgent(agent));

// Execute parallel research
const result = await orchestrator.executeParallel(
  ['research-analyst', 'competitive-analyst', 'trend-analyst'],
  {
    type: 'research',
    topic: 'AI development frameworks 2025',
    requirements: 'Comprehensive analysis with pros/cons'
  }
);

console.log('Findings:', result.results);
console.log('Cost:', result.usage?.totalCost);
```

### Example 2: Consensus Decision Making

**Use Case**: Select the best framework with team vote

```javascript
const result = await orchestrator.executeWithConsensus(
  ['architect', 'security-expert', 'performance-expert'],
  {
    type: 'framework-selection',
    question: 'Which database for our application?',
    options: ['PostgreSQL', 'MongoDB', 'MySQL'],
    criteria: {
      performance: 'high',
      scalability: 'medium',
      compliance: 'HIPAA required'
    }
  },
  {
    strategy: 'weighted',
    threshold: 0.7,
    weights: {
      'security-expert': 2.0,      // Security critical
      'architect': 1.5,
      'performance-expert': 1.0
    }
  }
);

console.log('Decision:', result.winner);
console.log('Confidence:', result.confidence);
console.log('Vote breakdown:', result.votes);
```

### Example 3: Code Review Workflow

**Use Case**: Implement feature with review cycles

```javascript
const result = await orchestrator.executeReview(
  'senior-developer',                        // Creator
  ['tech-lead', 'security-auditor', 'qa'],  // Reviewers
  {
    type: 'implement-feature',
    feature: 'two-factor authentication',
    requirements: 'TOTP-based, secure storage, rate limiting'
  },
  {
    revisionRounds: 2,
    useMemory: true  // Learn from past implementations
  }
);

console.log('Final implementation:', result.finalWork);
console.log('Review history:', result.rounds);
```

### Example 4: With Memory & Cost Tracking

**Use Case**: Full-featured orchestration with all bells and whistles

```javascript
const orchestrator = new AgentOrchestrator(messageBus, {
  // Enable memory
  enableMemory: true,
  dbPath: '.claude/memory/orchestrations.db',

  // Enable AI categorization
  enableAI: true,

  // Cost tracking
  enableCostTracking: true,
  dailyBudget: 10.00,
  monthlyBudget: 200.00,

  // Context settings
  contextTokenBudget: 2000
});

await orchestrator.initialize();

const result = await orchestrator.executeParallel(
  ['research-analyst', 'competitive-analyst'],
  {
    type: 'market-analysis',
    topic: 'Enterprise AI adoption trends'
  }
);

// Memory automatically loaded similar past research
// Results automatically saved
// Costs automatically tracked
// AI categorization happens async

console.log('Historical context used:', result.memoryContext?.orchestrations.length);
console.log('Total cost:', result.usage?.totalCost);
```

---

## Orchestration Patterns in Depth

### Pattern 1: Parallel Execution

**When to Use**:
- Tasks are independent (no inter-dependencies)
- Need multiple perspectives on same problem
- Speed is priority (concurrent execution)
- Comprehensive coverage desired

**Example Use Cases**:
- Market research from multiple angles
- Risk assessment (technical, legal, financial)
- Code review by multiple specialists
- Competitive analysis

**Basic Usage**:
```javascript
const result = await orchestrator.executeParallel(
  agentIds,
  task,
  options
);
```

**Advanced Usage with Custom Synthesizer**:
```javascript
const result = await orchestrator.executeParallel(
  ['agent-1', 'agent-2', 'agent-3'],
  {
    type: 'summarize',
    document: longDocument
  },
  {
    // Custom result synthesis
    synthesizer: (results) => {
      // Extract key points from all results
      const allKeyPoints = results.flatMap(r => r.keyPoints || []);

      // Deduplicate
      const unique = [...new Set(allKeyPoints)];

      // Rank by frequency
      const ranked = unique.sort((a, b) => {
        const countA = allKeyPoints.filter(p => p === a).length;
        const countB = allKeyPoints.filter(p => p === b).length;
        return countB - countA;
      });

      return {
        summary: 'Combined analysis from multiple agents',
        topKeyPoints: ranked.slice(0, 10),
        agentCount: results.length
      };
    },

    // Load historical context
    useMemory: true,
    contextTokenBudget: 2000,

    // Retry configuration
    retryAttempts: 3,
    retryDelay: 1000
  }
);
```

**Error Handling**:
```javascript
try {
  const result = await orchestrator.executeParallel(agentIds, task);

  // Check for partial failures
  if (result.failures.length > 0) {
    console.warn('Some agents failed:', result.failures);
  }

  // Success if at least one agent succeeded
  if (result.success) {
    console.log('Successful results:', result.results);
  }
} catch (error) {
  // All agents failed
  console.error('Complete failure:', error);
}
```

---

### Pattern 2: Consensus Voting

**When to Use**:
- Need team agreement on decision
- Multiple valid options to choose from
- Democratic or weighted voting appropriate
- Validation or approval workflow

**Voting Strategies**:

**1. Majority** (Simple majority, threshold 0.5):
```javascript
const result = await orchestrator.executeWithConsensus(
  agentIds,
  {
    type: 'decide',
    question: 'Approve this design?',
    options: ['Approve', 'Reject', 'Revise']
  },
  {
    strategy: 'majority',
    threshold: 0.5  // >50% required
  }
);
```

**2. Weighted** (Experts have more influence):
```javascript
const result = await orchestrator.executeWithConsensus(
  ['architect', 'developer', 'intern'],
  {
    type: 'technical-decision',
    question: 'Which pattern to use?',
    options: ['Microservices', 'Monolith', 'Modular Monolith']
  },
  {
    strategy: 'weighted',
    threshold: 0.6,
    weights: {
      'architect': 3.0,    // Senior architect = 3x
      'developer': 1.5,    // Developer = 1.5x
      'intern': 0.5        // Intern = 0.5x
    }
  }
);

// Vote calculation:
// architect votes "Microservices" → 3.0 points
// developer votes "Microservices" → 1.5 points
// intern votes "Monolith" → 0.5 points
// Total: 5.0 points
// Microservices: 4.5 / 5.0 = 90% → WINS
```

**3. Unanimous** (All must agree):
```javascript
const result = await orchestrator.executeWithConsensus(
  ['security', 'legal', 'compliance'],
  {
    type: 'security-approval',
    question: 'Approve data handling approach?',
    proposal: 'Store PII encrypted at rest and in transit'
  },
  {
    strategy: 'unanimous',
    threshold: 1.0  // 100% required
  }
);

// All agents must vote the same way
// If any disagrees, consensus = false
```

**Custom Voting Logic**:
```javascript
const result = await orchestrator.executeWithConsensus(
  agentIds,
  task,
  {
    strategy: 'weighted',
    threshold: 0.7,
    weights: agentWeights,

    // Custom vote extractor
    voteExtractor: (agentResult) => {
      // Extract vote from agent's result
      return agentResult.recommendation || agentResult.choice;
    },

    // Custom consensus checker
    consensusChecker: (votes, totalWeight) => {
      // Custom logic to determine consensus
      const winner = getMostVoted(votes);
      const winnerVotes = votes.get(winner);
      const confidence = winnerVotes / totalWeight;

      return {
        consensus: confidence >= 0.7,
        winner,
        confidence
      };
    }
  }
);
```

---

### Pattern 3: Debate (Iterative Refinement)

**When to Use**:
- Proposal needs rigorous vetting
- Complex problem requiring iteration
- Want to identify flaws and risks
- Need innovative solutions through challenge

**Basic Debate**:
```javascript
const result = await orchestrator.executeDebate(
  ['architect', 'security', 'performance'],
  {
    initialProposal: `
      Use microservices architecture with:
      - Event-driven communication
      - Shared database per bounded context
      - API gateway for external access
    `,
    domain: 'system architecture'
  },
  3  // 3 rounds of critique → synthesis
);

// Round 1:
//   Critiques identify issues (shared DB anti-pattern, etc.)
//   Synthesis improves proposal
// Round 2:
//   Critiques challenge improvements
//   Synthesis refines further
// Round 3:
//   Final validation and polish
```

**Custom Debate Configuration**:
```javascript
const result = await orchestrator.executeDebate(
  ['agent-1', 'agent-2', 'agent-3'],
  {
    initialProposal: 'Starting proposal...',
    domain: 'API design'
  },
  5,  // 5 rounds
  {
    // First agent synthesizes (default: agent-1)
    synthesizerAgentId: 'agent-1',

    // Custom critique prompt
    critiquePrompt: (proposal, round) => ({
      type: 'critique',
      phase: 'debate',
      round: round,
      task: `Critique this proposal (Round ${round}):\n${proposal}`,
      focus: round === 1 ? 'architecture' : 'security'
    }),

    // Custom synthesis prompt
    synthesisPrompt: (proposal, critiques, round) => ({
      type: 'synthesize',
      phase: 'debate',
      round: round,
      proposal: proposal,
      critiques: critiques,
      task: 'Improve proposal based on critiques'
    }),

    // Early stopping
    earlyStop: (proposal, round) => {
      // Stop if no major critiques after round 3
      if (round >= 3 && proposal.criticalIssues === 0) {
        return true;
      }
      return false;
    },

    // Load similar debates
    useMemory: true
  }
);
```

**Debate History Analysis**:
```javascript
const result = await orchestrator.executeDebate(...);

// Analyze evolution
result.rounds.forEach((round, idx) => {
  console.log(`\nRound ${round.round}:`);
  console.log('Proposal:', round.proposal.substring(0, 100) + '...');
  console.log('Critiques:', round.critiques.length);

  // Track improvement
  if (idx > 0) {
    const prevLength = result.rounds[idx - 1].proposal.length;
    const currLength = round.proposal.length;
    console.log('Refinement:', currLength > prevLength ? 'Expanded' : 'Condensed');
  }
});

console.log('\nFinal proposal:', result.finalProposal);
```

---

### Pattern 4: Review (Create/Critique/Revise)

**When to Use**:
- Creation requires quality assurance
- Iterative improvement through feedback
- Clear role separation (creator vs reviewers)
- Multiple revision cycles needed

**Basic Review Workflow**:
```javascript
const result = await orchestrator.executeReview(
  'developer',                    // Creator
  ['tech-lead', 'security', 'qa'], // Reviewers
  {
    type: 'implement-feature',
    feature: 'password reset flow',
    requirements: `
      - Email-based verification
      - Time-limited reset tokens
      - Rate limiting
      - Audit logging
    `
  },
  {
    revisionRounds: 2
  }
);

// Workflow:
// 1. Developer creates initial implementation
// 2. Tech-lead + Security + QA review (parallel)
// 3. Developer revises based on feedback
// 4. Second review round
// 5. Final revision
```

**Multi-Round Review with Escalation**:
```javascript
const result = await orchestrator.executeReview(
  'developer',
  ['tech-lead', 'security'],  // Initial reviewers
  task,
  {
    revisionRounds: 3,

    // Add more reviewers each round if needed
    escalationRounds: {
      2: ['architect'],        // Add architect in round 2
      3: ['compliance-officer'] // Add compliance in round 3
    },

    // Custom review prompt per round
    reviewPrompt: (work, round) => ({
      type: 'review',
      phase: 'review',
      round: round,
      work: work,
      focus: round === 1 ? 'functionality' : 'security'
    }),

    // Early approval
    earlyApproval: (reviews, round) => {
      // If all reviewers approve in round 1, skip round 2
      const allApproved = reviews.every(r => r.approved === true);
      return allApproved && round === 1;
    }
  }
);
```

**Review Quality Gates**:
```javascript
const result = await orchestrator.executeReview(
  'developer',
  reviewers,
  task,
  {
    revisionRounds: 2,

    // Quality gate per round
    qualityGate: (work, reviews, round) => {
      // Calculate quality score
      const scores = reviews.map(r => r.qualityScore || 0);
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

      // Require 8/10 minimum
      if (avgScore < 8.0) {
        return {
          passed: false,
          reason: `Quality score ${avgScore} below threshold 8.0`,
          requiredImprovements: reviews.flatMap(r => r.issues || [])
        };
      }

      return { passed: true };
    }
  }
);
```

---

### Pattern 5: Ensemble (Combine Outputs)

**When to Use**:
- Multiple attempts, pick best
- Quality-based selection needed
- Want to combine/merge outputs
- Reduce uncertainty through redundancy

**Strategy 1: Best-Of Selection**:
```javascript
const result = await orchestrator.executeEnsemble(
  ['summarizer-1', 'summarizer-2', 'summarizer-3'],
  {
    type: 'summarize',
    document: longDocument,
    maxLength: 500
  },
  {
    strategy: 'best-of',

    // Custom selector function
    selector: (results) => {
      // Score each summary
      const scored = results.map(r => ({
        result: r,
        score: calculateQuality(r)
      }));

      // Return best
      return scored.reduce((best, curr) =>
        curr.score > best.score ? curr : best
      ).result;
    }
  }
);

function calculateQuality(summary) {
  let score = 0;

  // Length penalty (prefer concise)
  score += Math.max(0, 10 - summary.length / 50);

  // Keyword coverage (prefer comprehensive)
  const keywords = ['AI', 'framework', 'multi-agent', 'orchestration'];
  score += keywords.filter(k => summary.includes(k)).length * 2;

  // Structure bonus
  if (summary.includes('- ')) score += 5;  // Has bullet points

  return score;
}
```

**Strategy 2: Merge Outputs**:
```javascript
const result = await orchestrator.executeEnsemble(
  ['analyst-1', 'analyst-2', 'analyst-3'],
  {
    type: 'risk-assessment',
    project: projectDetails
  },
  {
    strategy: 'merge',

    // Custom merge function
    merger: (results) => {
      // Collect all risks from all analysts
      const allRisks = results.flatMap(r => r.risks || []);

      // Deduplicate by risk description
      const uniqueRisks = deduplicateRisks(allRisks);

      // Rank by severity (average if multiple analysts identified)
      const ranked = uniqueRisks.sort((a, b) => b.severity - a.severity);

      return {
        combinedAnalysis: true,
        totalRisks: ranked.length,
        topRisks: ranked.slice(0, 10),
        analystCount: results.length
      };
    }
  }
);
```

**Strategy 3: Voting**:
```javascript
const result = await orchestrator.executeEnsemble(
  ['classifier-1', 'classifier-2', 'classifier-3', 'classifier-4'],
  {
    type: 'classify',
    item: dataItem,
    categories: ['Category A', 'Category B', 'Category C']
  },
  {
    strategy: 'vote',

    // Voting configuration
    voteConfig: {
      threshold: 0.5,  // Majority required
      tiebreaker: (tied) => tied[0]  // Pick first if tie
    }
  }
);

// Each classifier votes for a category
// Most votes wins
// Returns winning category + vote distribution
```

---

## Memory Integration Patterns

### Pattern 1: Learning from History

**Automatic Context Loading**:
```javascript
// Memory enabled by default
const orchestrator = new AgentOrchestrator(messageBus, {
  enableMemory: true,
  dbPath: '.claude/memory/orchestrations.db',
  contextTokenBudget: 2000
});

// First execution - no history
const result1 = await orchestrator.executeParallel(
  ['architect', 'security'],
  {
    type: 'design',
    feature: 'authentication system'
  }
);

console.log('Memory context:', result1.memoryContext);
// → { loaded: false, orchestrations: [] }

// Second execution - learns from first
const result2 = await orchestrator.executeParallel(
  ['architect', 'security'],
  {
    type: 'design',
    feature: 'API authentication with OAuth2'
  }
);

console.log('Memory context:', result2.memoryContext);
// → {
//     loaded: true,
//     orchestrations: [result1],  // Relevant history
//     tokenCost: 150
//   }
```

**Querying Memory**:
```javascript
const { MemorySearchAPI } = require('./.claude/core/memory-search-api');

const searchAPI = new MemorySearchAPI(memoryStore, vectorStore);

// Find similar past work
const similar = await searchAPI.findSimilar(
  'authentication security',
  {
    limit: 5,
    minScore: 0.7,
    mode: 'hybrid'  // vector + keywords
  }
);

// Find by agent
const agentWork = await searchAPI.findByAgent('security-expert', {
  success: true,
  limit: 10
});

// Find by pattern
const parallelWork = await searchAPI.findByPattern('parallel', {
  startDate: '2025-01-01'
});

// Analyze success patterns
const successes = await searchAPI.analyzeSuccessPatterns({
  pattern: 'parallel',
  minSuccessRate: 0.8
});
```

---

### Pattern 2: Pattern Recommendations

**Automatic Pattern Selection**:
```javascript
const { PatternRecommender } = require('./.claude/core/pattern-recommender');

const recommender = new PatternRecommender(memoryStore);

// Get recommendation based on task
const recommendation = await recommender.recommendPattern({
  taskType: 'research',
  agentCount: 3,
  complexity: 'high',
  timeConstraint: 'moderate'
});

console.log('Recommended pattern:', recommendation.pattern);
console.log('Confidence:', recommendation.confidence);
console.log('Success rate:', recommendation.historicalSuccessRate);
console.log('Similar past tasks:', recommendation.similarTasks.length);

// Get team recommendation
const team = await recommender.recommendTeam({
  taskType: 'architecture',
  pattern: 'debate',
  minAgents: 2,
  maxAgents: 4
});

console.log('Recommended agents:', team.agents);
console.log('Success rate:', team.expectedSuccessRate);
```

---

### Pattern 3: Cost-Aware Execution

**Budget Management**:
```javascript
const { UsageTracker } = require('./.claude/core/usage-tracker');

const tracker = new UsageTracker(memoryStore, costCalculator, {
  dailyBudget: 10.00,
  monthlyBudget: 200.00
});

// Check budget before expensive operation
const status = await tracker.getBudgetStatus();

if (status.daily.status === 'critical') {
  console.warn('Approaching daily budget limit!');

  // Use cheaper configuration
  contextTokenBudget = 500;  // Reduce context
  enableAI = false;          // Skip AI categorization
} else {
  // Normal configuration
  contextTokenBudget = 2000;
  enableAI = true;
}

// Execute with adjusted settings
const result = await orchestrator.executeParallel(
  agentIds,
  task,
  { contextTokenBudget, enableAI }
);

// Track usage
await tracker.recordUsage({
  orchestrationId: result.id,
  ...result.usage
});
```

**Cost Analysis**:
```javascript
// Get cost breakdown
const costs = await tracker.getPatternCosts({
  startDate: '2025-01-01',
  endDate: '2025-01-31'
});

costs.forEach(pattern => {
  console.log(`${pattern.pattern}:`);
  console.log(`  Total: $${pattern.totalCost}`);
  console.log(`  Average: $${pattern.averageCost}`);
  console.log(`  Count: ${pattern.orchestrationCount}`);
  console.log(`  Efficiency: ${pattern.costPerSuccess}`);
});
```

---

## Agent Communication Patterns

### Pattern 1: Direct Messaging

**Agent-to-Agent Communication**:
```javascript
class CollaborativeAgent extends Agent {
  async execute(task, context) {
    // Ask another agent for information
    const response = await this.sendMessage('expert-agent', {
      type: 'query',
      question: 'What are security best practices for this?'
    });

    // Use response in processing
    const result = await this.process(task, response);

    return result;
  }
}
```

### Pattern 2: Broadcasting

**Announce to All Agents**:
```javascript
class CoordinatorAgent extends Agent {
  async execute(task, context) {
    // Broadcast status update
    this.broadcast({
      type: 'status',
      phase: 'analysis-complete',
      findings: preliminaryFindings
    });

    // Continue processing
    const final = await this.finalizeAnalysis();

    return final;
  }
}
```

### Pattern 3: Request-Response

**Query Multiple Agents**:
```javascript
// Orchestrator uses MessageBus request-response
const responses = await messageBus.request(
  'query:agent:capabilities',
  { taskType: 'security-audit' },
  {
    timeout: 5000,
    expectedResponses: 5  // Wait for 5 agents
  }
);

// Filter capable agents
const capableAgents = responses
  .filter(r => r.capable === true)
  .map(r => r.agentId);

// Execute with capable agents only
const result = await orchestrator.executeParallel(
  capableAgents,
  task
);
```

---

## Cost Optimization Patterns

### Pattern 1: Progressive Context Loading

**Start Small, Expand as Needed**:
```javascript
// Initial execution with minimal context
const result = await orchestrator.executeParallel(
  agentIds,
  task,
  {
    contextTokenBudget: 500,  // Small budget
    includeDetails: false      // Layer 1 only
  }
);

// If more context needed, retry with more
if (result.confidence < 0.7) {
  const retryResult = await orchestrator.executeParallel(
    agentIds,
    task,
    {
      contextTokenBudget: 2000,  // Larger budget
      includeDetails: true        // Layer 1 + 2
    }
  );
}
```

### Pattern 2: Selective AI Features

**Enable AI Only When Necessary**:
```javascript
// Disable AI categorization for routine tasks
const routineResult = await orchestrator.executeParallel(
  agentIds,
  routineTask,
  {
    enableAI: false,           // Skip AI categorization
    enableVectorStore: false   // Skip vectorization
  }
);

// Enable for important tasks
const importantResult = await orchestrator.executeParallel(
  agentIds,
  importantTask,
  {
    enableAI: true,            // Full AI categorization
    enableVectorStore: true    // Vectorize for search
  }
);
```

### Pattern 3: Cache Optimization

**Leverage Prompt Caching**:
```javascript
// Reuse context across executions
const sharedContext = {
  projectBackground: largeContextDocument,
  guidelines: companyGuidelines
};

// First call creates cache
const result1 = await agent.execute({
  task: task1,
  context: sharedContext  // Cached
});

// Subsequent calls use cache (90% cheaper)
const result2 = await agent.execute({
  task: task2,
  context: sharedContext  // Cache hit!
});

// Track savings
const savings = costCalculator.calculateCacheSavings({
  model: 'claude-sonnet-4-5',
  cacheReadTokens: sharedContext.length,
  cacheCreationTokens: sharedContext.length
});
```

---

## Error Handling Patterns

### Pattern 1: Graceful Degradation

**Fallback Strategies**:
```javascript
async function robustExecution(orchestrator, agentIds, task) {
  try {
    // Try with full features
    return await orchestrator.executeParallel(agentIds, task, {
      enableMemory: true,
      enableAI: true,
      enableVectorStore: true
    });
  } catch (memoryError) {
    console.warn('Memory failed, retrying without:', memoryError);

    try {
      // Fallback: No memory
      return await orchestrator.executeParallel(agentIds, task, {
        enableMemory: false,
        enableAI: false,
        enableVectorStore: false
      });
    } catch (orchestrationError) {
      console.error('Orchestration failed:', orchestrationError);

      // Fallback: Sequential execution
      return await sequentialFallback(agentIds, task);
    }
  }
}

async function sequentialFallback(agentIds, task) {
  const results = [];

  for (const agentId of agentIds) {
    try {
      const result = await agent.execute(task);
      results.push({ success: true, result });
    } catch (error) {
      results.push({ success: false, error });
    }
  }

  return {
    success: results.some(r => r.success),
    results: results.filter(r => r.success).map(r => r.result),
    failures: results.filter(r => !r.success)
  };
}
```

### Pattern 2: Retry with Backoff

**Exponential Backoff**:
```javascript
async function retryWithBackoff(fn, options = {}) {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffFactor = 2
  } = options;

  let attempt = 0;
  let delay = initialDelay;

  while (attempt < maxAttempts) {
    try {
      return await fn();
    } catch (error) {
      attempt++;

      if (attempt >= maxAttempts) {
        throw error;
      }

      console.warn(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await sleep(delay);

      delay = Math.min(delay * backoffFactor, maxDelay);
    }
  }
}

// Usage
const result = await retryWithBackoff(
  () => orchestrator.executeParallel(agentIds, task),
  { maxAttempts: 3, initialDelay: 1000 }
);
```

### Pattern 3: Circuit Breaker

**Prevent Cascade Failures**:
```javascript
class CircuitBreaker {
  constructor(threshold = 3, timeout = 60000) {
    this.threshold = threshold;
    this.timeout = timeout;
    this.failures = 0;
    this.state = 'closed';
    this.nextAttempt = null;
  }

  async execute(fn) {
    if (this.state === 'open') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is open');
      }
      this.state = 'half-open';
    }

    try {
      const result = await fn();

      // Success - reset
      this.failures = 0;
      this.state = 'closed';

      return result;
    } catch (error) {
      this.failures++;

      if (this.failures >= this.threshold) {
        this.state = 'open';
        this.nextAttempt = Date.now() + this.timeout;
      }

      throw error;
    }
  }
}

// Usage
const breaker = new CircuitBreaker(3, 60000);

const result = await breaker.execute(() =>
  orchestrator.executeParallel(agentIds, task)
);
```

---

## Advanced Patterns

### Pattern 1: Nested Orchestration

**Orchestration within Orchestration**:
```javascript
async function complexWorkflow(orchestrator) {
  // Phase 1: Research (parallel)
  const research = await orchestrator.executeParallel(
    ['research-1', 'research-2', 'research-3'],
    { type: 'research', topic: 'AI frameworks' }
  );

  // Phase 2: Analysis (debate on findings)
  const analysis = await orchestrator.executeDebate(
    ['analyst-1', 'analyst-2'],
    {
      initialProposal: research.results.combined,
      task: 'Analyze research findings'
    },
    3
  );

  // Phase 3: Decision (consensus)
  const decision = await orchestrator.executeWithConsensus(
    ['architect', 'tech-lead', 'developer'],
    {
      type: 'decide',
      question: 'Which framework to use?',
      analysis: analysis.finalProposal
    },
    { strategy: 'weighted', threshold: 0.7 }
  );

  // Phase 4: Implementation (review)
  const implementation = await orchestrator.executeReview(
    'developer',
    ['tech-lead', 'qa'],
    {
      type: 'implement',
      framework: decision.winner,
      requirements: analysis.requirements
    },
    { revisionRounds: 2 }
  );

  return {
    research,
    analysis,
    decision,
    implementation
  };
}
```

### Pattern 2: Dynamic Agent Selection

**Choose Agents Based on Task**:
```javascript
async function dynamicExecution(orchestrator, loader, task) {
  // Analyze task requirements
  const requirements = analyzeTask(task);

  // Find best agents
  const agents = requirements.capabilities.map(capability =>
    loader.getBestAgentForTask({
      requiredCapabilities: [capability],
      phase: requirements.phase,
      complexity: requirements.complexity
    })
  );

  // Select pattern based on task
  const pattern = selectPattern(requirements);

  // Execute with dynamic configuration
  if (pattern === 'parallel') {
    return await orchestrator.executeParallel(
      agents.map(a => a.name),
      task
    );
  } else if (pattern === 'consensus') {
    return await orchestrator.executeWithConsensus(
      agents.map(a => a.name),
      task,
      { strategy: 'weighted', threshold: 0.7 }
    );
  }
  // etc...
}
```

### Pattern 3: Streaming Results

**Process Results as They Arrive**:
```javascript
async function streamingExecution(orchestrator, agentIds, task) {
  const results = [];

  // Subscribe to agent completion events
  const subscription = messageBus.subscribe(
    'agent:execution:complete',
    'result-streamer',
    (event) => {
      if (agentIds.includes(event.agentId)) {
        console.log('Agent completed:', event.agentId);
        results.push(event.result);

        // Process immediately
        processResult(event.result);
      }
    }
  );

  // Execute
  await orchestrator.executeParallel(agentIds, task);

  // Cleanup
  messageBus.unsubscribe('agent:execution:complete', 'result-streamer');

  return results;
}
```

---

## Best Practices

### 1. Agent Selection

**DO**:
- Use specialized agents for their expertise
- Match agent capabilities to task requirements
- Consider agent performance history
- Use AgentLoader for auto-discovery

**DON'T**:
- Use generic agents for specialized tasks
- Ignore agent priority and phase
- Register agents manually when auto-discovery works

### 2. Pattern Selection

**DO**:
- Use Parallel for independent tasks
- Use Consensus for decisions requiring agreement
- Use Debate for proposals needing refinement
- Use Review for creation with feedback
- Use Ensemble for quality selection

**DON'T**:
- Use Debate when simple Parallel suffices
- Use Consensus when decision is obvious
- Use Review when no revision needed

### 3. Memory Usage

**DO**:
- Enable memory by default
- Set appropriate token budgets
- Query memory for similar tasks
- Clean old records periodically

**DON'T**:
- Disable memory unless necessary
- Load excessive context
- Ignore cache hit rates
- Let database grow unbounded

### 4. Cost Management

**DO**:
- Set daily/monthly budgets
- Monitor budget status
- Use cache when possible
- Disable AI for routine tasks

**DON'T**:
- Ignore cost tracking
- Load full context unnecessarily
- Enable all features always
- Forget to check budget alerts

### 5. Error Handling

**DO**:
- Handle partial failures gracefully
- Implement retry logic
- Use circuit breakers
- Log errors comprehensively

**DON'T**:
- Assume all agents succeed
- Retry indefinitely
- Let failures cascade
- Ignore error patterns

---

## Common Recipes

### Recipe 1: Research Report

```javascript
async function generateResearchReport(topic) {
  // 1. Parallel research
  const research = await orchestrator.executeParallel(
    ['research-analyst', 'competitive-analyst', 'trend-analyst'],
    { type: 'research', topic }
  );

  // 2. Synthesize findings
  const synthesis = await orchestrator.executeEnsemble(
    ['writer-1', 'writer-2'],
    {
      type: 'synthesize',
      findings: research.results
    },
    { strategy: 'best-of' }
  );

  return synthesis.selected;
}
```

### Recipe 2: Code Review Pipeline

```javascript
async function codeReviewPipeline(pullRequest) {
  // 1. Automated checks
  const checks = await orchestrator.executeParallel(
    ['linter', 'security-scanner', 'test-runner'],
    { type: 'check', code: pullRequest.code }
  );

  // 2. Human review
  const review = await orchestrator.executeReview(
    'author',
    ['tech-lead', 'senior-dev'],
    {
      type: 'review-code',
      code: pullRequest.code,
      checks: checks.results
    },
    { revisionRounds: 2 }
  );

  // 3. Approval decision
  const decision = await orchestrator.executeWithConsensus(
    ['tech-lead', 'senior-dev'],
    {
      type: 'approve',
      finalCode: review.finalWork
    },
    { strategy: 'unanimous' }
  );

  return decision;
}
```

### Recipe 3: Architecture Decision

```javascript
async function architectureDecision(requirements) {
  // 1. Generate proposals
  const proposals = await orchestrator.executeParallel(
    ['architect-1', 'architect-2', 'architect-3'],
    { type: 'propose-architecture', requirements }
  );

  // 2. Debate each proposal
  const debates = await Promise.all(
    proposals.results.map(proposal =>
      orchestrator.executeDebate(
        ['architect', 'security', 'performance'],
        { initialProposal: proposal, domain: 'architecture' },
        3
      )
    )
  );

  // 3. Select best
  const selection = await orchestrator.executeWithConsensus(
    ['architect', 'tech-lead', 'cto'],
    {
      type: 'select-architecture',
      options: debates.map(d => d.finalProposal)
    },
    { strategy: 'weighted', threshold: 0.7 }
  );

  return selection.winner;
}
```

---

**Version**: 1.0.0
**Last Updated**: 2025-11-09
