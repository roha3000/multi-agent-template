# Multi-Agent Orchestration Guide

## Overview

The multi-agent orchestration system enables complex collaborative workflows between specialized AI agents. This guide covers the core concepts, patterns, and practical usage examples.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Components](#core-components)
3. [Orchestration Patterns](#orchestration-patterns)
4. [Creating Custom Agents](#creating-custom-agents)
5. [Best Practices](#best-practices)
6. [Examples](#examples)

---

## Architecture Overview

The multi-agent system consists of three main layers:

```
┌─────────────────────────────────────────┐
│     Agent Orchestrator (Patterns)       │
│  - Parallel    - Debate    - Ensemble   │
│  - Consensus   - Review                 │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│        Agent Layer (Specialized)         │
│  - Research  - CodeReview  - Custom...  │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│       MessageBus (Communication)         │
│  - Pub/Sub  - Request/Response          │
└─────────────────────────────────────────┘
```

### Design Principles

- **Loose Coupling**: Agents communicate via MessageBus, not direct references
- **Specialized Roles**: Each agent has a specific expertise domain
- **Composable Patterns**: Orchestration patterns can be combined
- **Fault Tolerance**: Partial failures don't break the entire workflow

---

## Core Components

### MessageBus

The MessageBus provides event-driven communication between agents.

**Key Features:**
- Topic-based pub/sub messaging
- Request/response with timeout handling
- Message history tracking
- Automatic message metadata

**Basic Usage:**

```javascript
const MessageBus = require('./.claude/core/message-bus');

const bus = new MessageBus();

// Subscribe to a topic
const unsubscribe = bus.subscribe('events', 'agent1', (message) => {
  console.log('Received:', message);
});

// Publish a message
bus.publish('events', { data: 'Hello' }, 'agent2');

// Request/response pattern
const responses = await bus.request(
  'query-topic',
  { query: 'What is the status?' },
  'requester-id',
  { timeout: 5000, responseCount: 1 }
);

// Cleanup
unsubscribe();
```

### Agent Base Class

All agents extend the `Agent` base class, which provides:
- Messaging capabilities (send, broadcast, subscribe)
- State management (idle, working, completed, failed)
- Execution history tracking
- Statistics collection

**Creating a Basic Agent:**

```javascript
const Agent = require('./.claude/core/agent');

class MyAgent extends Agent {
  constructor(id, messageBus, config = {}) {
    super(id, 'My Role', messageBus, {
      timeout: 60000,
      retries: 3,
      ...config
    });
  }

  async execute(task, context = {}) {
    this.setState('working');

    try {
      // Your agent logic here
      const result = await this.processTask(task);

      this.setState('completed');
      return {
        success: true,
        agentId: this.id,
        role: this.role,
        result
      };
    } catch (error) {
      this.setState('failed');
      throw error;
    }
  }

  async processTask(task) {
    // Implement your task processing
    return { data: 'processed' };
  }
}
```

### AgentOrchestrator

The orchestrator coordinates multiple agents using predefined patterns.

**Basic Setup:**

```javascript
const AgentOrchestrator = require('./.claude/core/agent-orchestrator');
const MessageBus = require('./.claude/core/message-bus');

const messageBus = new MessageBus();
const orchestrator = new AgentOrchestrator(messageBus);

// Create and register agents
const agent1 = new MyAgent('agent-1', messageBus);
const agent2 = new MyAgent('agent-2', messageBus);

orchestrator.registerAgent(agent1);
orchestrator.registerAgent(agent2);
```

---

## Orchestration Patterns

### 1. Parallel Execution

Run multiple agents simultaneously on the same task.

**Use Cases:**
- Gathering multiple perspectives
- Speed up independent computations
- Redundancy for critical tasks

**Example:**

```javascript
const result = await orchestrator.executeParallel(
  ['researcher-1', 'researcher-2', 'researcher-3'],
  {
    type: 'analyze',
    data: 'market trends for AI products',
    focus: 'competitive landscape'
  },
  {
    timeout: 30000,
    retries: 2,
    synthesizer: (results) => {
      // Combine results from all agents
      return {
        insights: results.flatMap(r => r.insights || []),
        consensus: results.length
      };
    }
  }
);

console.log('Successful agents:', result.results.length);
console.log('Failed agents:', result.failures.length);
console.log('Synthesized result:', result.synthesized);
```

**Result Structure:**

```javascript
{
  success: true,
  synthesized: { /* combined results */ },
  results: [
    { agentId: 'researcher-1', result: { /* agent output */ } },
    { agentId: 'researcher-2', result: { /* agent output */ } }
  ],
  failures: [
    { agentId: 'researcher-3', error: 'timeout' }
  ],
  duration: 1523 // milliseconds
}
```

### 2. Consensus Voting

Reach agreement through voting mechanisms.

**Use Cases:**
- Decision making
- Selecting best option from alternatives
- Validating results

**Voting Strategies:**
- `majority`: > threshold percentage (default 50%)
- `weighted`: Uses agent-specific weights
- `unanimous`: Requires 100% agreement

**Example:**

```javascript
const result = await orchestrator.executeWithConsensus(
  ['agent-1', 'agent-2', 'agent-3'],
  {
    type: 'compare',
    options: ['React', 'Vue', 'Angular'],
    criteria: 'ease of use and community support'
  },
  {
    strategy: 'majority',
    threshold: 0.6, // 60% required
    weights: {
      'agent-1': 2, // Senior agent, double weight
      'agent-2': 1,
      'agent-3': 1
    }
  }
);

console.log('Consensus reached:', result.success);
console.log('Winner:', result.result);
console.log('Confidence:', result.vote.confidence);
console.log('Vote breakdown:', result.vote.votes);
```

**Result Structure:**

```javascript
{
  success: true,
  result: { /* winning result */ },
  vote: {
    winner: { /* most voted result */ },
    consensus: true,
    confidence: 0.75,
    votes: [
      { value: 'React', count: 3 },
      { value: 'Vue', count: 1 }
    ]
  },
  allResults: [ /* all agent results */ ]
}
```

### 3. Debate (Iterative Refinement)

Refine proposals through multiple rounds of critique.

**Use Cases:**
- Architecture decisions
- Design refinement
- Proposal improvement

**Example:**

```javascript
const result = await orchestrator.executeDebate(
  ['reviewer-1', 'reviewer-2', 'reviewer-3'],
  {
    initialProposal: 'Use microservices architecture for the new platform'
  },
  3, // number of rounds
  {
    timeout: 60000
  }
);

console.log('Final proposal:', result.finalProposal);
console.log('Debate rounds:', result.rounds);

// View debate evolution
result.debateHistory.forEach((round, idx) => {
  console.log(`Round ${idx + 1}:`);
  console.log('  Proposal:', round.proposal);
  console.log('  Critiques:', round.critiques.results.length);
});
```

**How It Works:**

1. Start with initial proposal
2. Each agent critiques the current proposal
3. First agent synthesizes critiques into improved proposal
4. Repeat for N rounds
5. Return final refined proposal

**Result Structure:**

```javascript
{
  success: true,
  finalProposal: 'Use microservices architecture with API gateway...',
  debateHistory: [
    {
      round: 1,
      proposal: '...',
      critiques: { results: [...] },
      synthesized: { improvedProposal: '...' }
    }
  ],
  rounds: 3
}
```

### 4. Review (Create/Critique/Revise)

Collaborative creation with review cycles.

**Use Cases:**
- Code development with review
- Document creation
- Design iteration

**Example:**

```javascript
const result = await orchestrator.executeReview(
  'developer-1',           // Creator agent
  ['reviewer-1', 'reviewer-2'], // Reviewer agents
  {
    type: 'implement-feature',
    feature: 'user authentication module'
  },
  {
    revisionRounds: 2,
    timeout: 60000
  }
);

console.log('Final work:', result.finalWork);
console.log('Revision rounds:', result.revisionRounds);

// View review history
result.reviewHistory.forEach((round, idx) => {
  console.log(`Round ${idx + 1}:`);
  console.log('  Reviews:', round.reviews.length);
  console.log('  Revised work:', round.revisedWork);
});
```

**How It Works:**

1. Creator produces initial work
2. Reviewers critique the work
3. Creator revises based on feedback
4. Repeat for N rounds
5. Return final revised work

**Result Structure:**

```javascript
{
  success: true,
  finalWork: { /* final revised output */ },
  reviewHistory: [
    {
      round: 1,
      reviews: [ /* reviewer feedback */ ],
      revisedWork: { /* work after revision */ }
    }
  ],
  revisionRounds: 2
}
```

### 5. Ensemble (Combine Outputs)

Combine multiple agent outputs using various strategies.

**Use Cases:**
- Selecting best result
- Merging complementary outputs
- Voting on alternatives

**Strategies:**
- `best-of`: Select single best result
- `merge`: Combine all results
- `vote`: Vote for best result

**Example:**

```javascript
const result = await orchestrator.executeEnsemble(
  ['researcher-1', 'researcher-2', 'researcher-3'],
  {
    type: 'summarize',
    content: 'Long technical document...',
    maxLength: 150
  },
  {
    strategy: 'best-of',
    selector: (results) => {
      // Custom selection logic
      return results.reduce((best, current) =>
        (current.keyPoints?.length || 0) > (best.keyPoints?.length || 0)
          ? current
          : best
      );
    }
  }
);

console.log('Selected result:', result.result);
console.log('All results:', result.allResults);
```

**Result Structure:**

```javascript
{
  success: true,
  result: { /* best/merged result */ },
  strategy: 'best-of',
  allResults: [ /* all agent outputs */ ],
  duration: 2341
}
```

---

## Creating Custom Agents

### Step 1: Define Your Agent Class

```javascript
const Agent = require('./.claude/core/agent');

class CustomAgent extends Agent {
  constructor(id, messageBus, config = {}) {
    super(id, 'Custom Role', messageBus, {
      timeout: 60000,
      retries: 3,
      ...config
    });

    // Add custom configuration
    this.customConfig = config.customParam || 'default';
  }

  async execute(task, context = {}) {
    this.setState('working');
    const startTime = Date.now();

    try {
      this.logger.info('Starting task', { taskType: task.type });

      // Route to appropriate handler
      let result;
      switch (task.type) {
        case 'analyze':
          result = await this._analyzeTask(task);
          break;
        case 'process':
          result = await this._processTask(task);
          break;
        default:
          throw new Error(`Unknown task type: ${task.type}`);
      }

      const duration = Date.now() - startTime;
      this._recordExecution(task, result, duration);

      this.setState('completed');

      return {
        success: true,
        agentId: this.id,
        role: this.role,
        ...result
      };

    } catch (error) {
      this.logger.error('Task failed', { error: error.message });
      this.setState('failed');

      const duration = Date.now() - startTime;
      this._recordExecution(task, { success: false, error: error.message }, duration);

      throw error;
    }
  }

  async _analyzeTask(task) {
    // Your analysis logic
    return {
      analysis: 'result',
      confidence: 0.9
    };
  }

  async _processTask(task) {
    // Your processing logic
    return {
      processed: true,
      data: task.data
    };
  }
}

module.exports = CustomAgent;
```

### Step 2: Add Messaging Capabilities

```javascript
class CollaborativeAgent extends Agent {
  constructor(id, messageBus, config = {}) {
    super(id, 'Collaborative', messageBus, config);

    // Subscribe to broadcasts
    this.handleBroadcasts((message) => {
      this.logger.info('Received broadcast', { from: message._metadata.publisherId });
    });

    // Handle direct messages
    this.handleDirectMessages(async (message) => {
      // Process and respond
      return {
        response: 'processed',
        originalMessage: message
      };
    });

    // Subscribe to custom topics
    this.subscribe('custom-event', (message) => {
      this.logger.info('Custom event received', { message });
    });
  }

  async notifyOthers(data) {
    // Broadcast to all agents
    this.broadcast({
      type: 'notification',
      data
    });
  }

  async askAgent(targetId, question) {
    // Send direct message and wait for response
    const response = await this.send(targetId, {
      type: 'question',
      question
    });
    return response;
  }
}
```

### Step 3: Add Specialized Behavior

```javascript
class DataAnalysisAgent extends Agent {
  constructor(id, messageBus, config = {}) {
    super(id, 'Data Analyst', messageBus, config);

    this.expertise = config.expertise || 'general';
    this.analysisHistory = [];
  }

  async execute(task, context = {}) {
    this.setState('working');

    try {
      const result = await this._performAnalysis(task);

      // Track analysis history
      this.analysisHistory.push({
        timestamp: new Date().toISOString(),
        task,
        result
      });

      this.setState('completed');
      return {
        success: true,
        agentId: this.id,
        expertise: this.expertise,
        ...result
      };

    } catch (error) {
      this.setState('failed');
      throw error;
    }
  }

  async _performAnalysis(task) {
    const { data, analysisType } = task;

    // Perform different analyses based on expertise
    if (this.expertise === 'statistical') {
      return this._statisticalAnalysis(data);
    } else if (this.expertise === 'predictive') {
      return this._predictiveAnalysis(data);
    } else {
      return this._generalAnalysis(data);
    }
  }

  async _statisticalAnalysis(data) {
    // Statistical analysis implementation
    return {
      mean: 42,
      median: 40,
      stdDev: 5.2,
      confidence: 0.95
    };
  }

  // Additional methods...

  getAnalysisHistory() {
    return {
      agentId: this.id,
      expertise: this.expertise,
      totalAnalyses: this.analysisHistory.length,
      history: this.analysisHistory,
      stats: this.getStats()
    };
  }
}
```

---

## Best Practices

### 1. Agent Design

**Single Responsibility**
```javascript
// Good: Focused agent
class CodeReviewAgent extends Agent {
  async execute(task) {
    return this._reviewCode(task.code);
  }
}

// Bad: Too many responsibilities
class SuperAgent extends Agent {
  async execute(task) {
    // Don't mix unrelated tasks in one agent
    if (task.type === 'review') return this._review();
    if (task.type === 'database') return this._queryDB();
    if (task.type === 'email') return this._sendEmail();
  }
}
```

**State Management**
```javascript
async execute(task) {
  this.setState('working'); // Always set state

  try {
    const result = await this.processTask(task);
    this.setState('completed'); // Set on success
    return result;
  } catch (error) {
    this.setState('failed'); // Set on failure
    throw error;
  }
}
```

**Execution History**
```javascript
async execute(task, context) {
  const startTime = Date.now();

  try {
    const result = await this.doWork(task);
    const duration = Date.now() - startTime;

    // Record execution for stats
    this._recordExecution(task, result, duration);

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    this._recordExecution(task, { success: false, error: error.message }, duration);
    throw error;
  }
}
```

### 2. Orchestration Pattern Selection

| Pattern | Use When | Avoid When |
|---------|----------|------------|
| **Parallel** | Independent tasks, speed matters | Tasks have dependencies |
| **Consensus** | Need agreement, multiple valid options | Clear single answer exists |
| **Debate** | Complex decisions, refinement needed | Simple yes/no decisions |
| **Review** | Quality matters, iterative improvement | One-shot tasks |
| **Ensemble** | Want best of multiple attempts | Single perspective sufficient |

### 3. Error Handling

**Graceful Degradation**
```javascript
const result = await orchestrator.executeParallel(
  ['agent-1', 'agent-2', 'agent-3'],
  task,
  {
    synthesizer: (results) => {
      // Handle partial results
      if (results.length === 0) {
        return { error: 'All agents failed', fallback: true };
      }

      // Use available results
      return {
        combined: results,
        confidence: results.length / 3
      };
    }
  }
);

// Check for partial failures
if (result.failures.length > 0) {
  console.warn('Some agents failed:', result.failures);
}
```

**Timeout Configuration**
```javascript
// Set appropriate timeouts for different tasks
const quickAnalysis = await orchestrator.executeParallel(
  agentIds,
  task,
  { timeout: 5000 } // 5 seconds for quick tasks
);

const deepResearch = await orchestrator.executeParallel(
  agentIds,
  task,
  { timeout: 120000 } // 2 minutes for research
);
```

### 4. Resource Management

**Always Cleanup**
```javascript
const messageBus = new MessageBus();
const orchestrator = new AgentOrchestrator(messageBus);

try {
  // Use orchestrator
  const result = await orchestrator.executeParallel(...);
} finally {
  // Always cleanup
  orchestrator.destroy();
  messageBus.clear();
}
```

**Limit Concurrent Agents**
```javascript
// Don't create too many agents at once
const MAX_AGENTS = 10;

if (agentIds.length > MAX_AGENTS) {
  // Batch the execution
  const batches = chunk(agentIds, MAX_AGENTS);

  for (const batch of batches) {
    await orchestrator.executeParallel(batch, task);
  }
}
```

---

## Examples

### Example 1: Research & Analysis Workflow

```javascript
const MessageBus = require('./.claude/core/message-bus');
const AgentOrchestrator = require('./.claude/core/agent-orchestrator');
const ResearchAgent = require('./examples/agents/research-agent');

async function researchWorkflow() {
  const messageBus = new MessageBus();
  const orchestrator = new AgentOrchestrator(messageBus);

  // Create specialized researchers
  const techResearcher = new ResearchAgent('tech-research', messageBus, {
    expertise: 'technology'
  });

  const bizResearcher = new ResearchAgent('biz-research', messageBus, {
    expertise: 'business'
  });

  const uxResearcher = new ResearchAgent('ux-research', messageBus, {
    expertise: 'user-experience'
  });

  orchestrator.registerAgent(techResearcher);
  orchestrator.registerAgent(bizResearcher);
  orchestrator.registerAgent(uxResearcher);

  // Phase 1: Parallel research
  console.log('Phase 1: Gathering perspectives...');
  const research = await orchestrator.executeParallel(
    ['tech-research', 'biz-research', 'ux-research'],
    {
      type: 'investigate',
      topic: 'AI-powered code assistants',
      depth: 'comprehensive'
    }
  );

  // Phase 2: Reach consensus on recommendation
  console.log('Phase 2: Building consensus...');
  const consensus = await orchestrator.executeWithConsensus(
    ['tech-research', 'biz-research', 'ux-research'],
    {
      type: 'compare',
      options: ['GitHub Copilot', 'Claude Code', 'Cursor'],
      criteria: 'overall value proposition'
    },
    {
      strategy: 'weighted',
      threshold: 0.6,
      weights: {
        'tech-research': 2, // Technical analysis weighs more
        'biz-research': 1,
        'ux-research': 1
      }
    }
  );

  console.log('Research complete!');
  console.log('Consensus:', consensus.result);
  console.log('Confidence:', (consensus.vote.confidence * 100).toFixed(1) + '%');

  orchestrator.destroy();
  messageBus.clear();

  return {
    research: research.results,
    recommendation: consensus.result,
    confidence: consensus.vote.confidence
  };
}

researchWorkflow().catch(console.error);
```

### Example 2: Code Review Workflow

```javascript
const MessageBus = require('./.claude/core/message-bus');
const AgentOrchestrator = require('./.claude/core/agent-orchestrator');
const CodeReviewAgent = require('./examples/agents/code-review-agent');

async function codeReviewWorkflow(code) {
  const messageBus = new MessageBus();
  const orchestrator = new AgentOrchestrator(messageBus);

  // Create specialized reviewers
  const developer = new CodeReviewAgent('developer', messageBus, {
    severity: 'balanced'
  });

  const securityReviewer = new CodeReviewAgent('security', messageBus, {
    severity: 'strict',
    focusAreas: ['security', 'input validation', 'authentication']
  });

  const performanceReviewer = new CodeReviewAgent('performance', messageBus, {
    severity: 'balanced',
    focusAreas: ['performance', 'scalability', 'optimization']
  });

  orchestrator.registerAgent(developer);
  orchestrator.registerAgent(securityReviewer);
  orchestrator.registerAgent(performanceReviewer);

  // Use review pattern: create, critique, revise
  console.log('Starting code review workflow...');

  const result = await orchestrator.executeReview(
    'developer',                            // Creator
    ['security', 'performance'],            // Reviewers
    {
      type: 'implement-feature',
      feature: 'user login API',
      requirements: {
        authentication: 'JWT',
        rateLimit: true,
        logging: true
      }
    },
    {
      revisionRounds: 2
    }
  );

  console.log('Code review complete!');
  console.log('Final code quality score:', result.finalWork.overallRating || 'N/A');

  // Show review progression
  result.reviewHistory.forEach((round, idx) => {
    console.log(`\nRevision ${idx + 1}:`);
    round.reviews.forEach(review => {
      console.log(`  ${review.agentId}: ${review.result.approvalStatus}`);
    });
  });

  orchestrator.destroy();
  messageBus.clear();

  return result.finalWork;
}

codeReviewWorkflow().catch(console.error);
```

### Example 3: Combining Multiple Patterns

```javascript
async function complexWorkflow() {
  const messageBus = new MessageBus();
  const orchestrator = new AgentOrchestrator(messageBus);

  // Setup agents...
  const researchers = ['r1', 'r2', 'r3'];
  const reviewers = ['rev1', 'rev2'];

  // Phase 1: Parallel research
  const research = await orchestrator.executeParallel(
    researchers,
    { type: 'investigate', topic: 'New feature feasibility' }
  );

  // Phase 2: Debate on approach
  const approach = await orchestrator.executeDebate(
    reviewers,
    { initialProposal: 'Based on research, propose microservices architecture' },
    3
  );

  // Phase 3: Consensus on final decision
  const decision = await orchestrator.executeWithConsensus(
    [...researchers, ...reviewers],
    {
      type: 'decide',
      proposal: approach.finalProposal,
      criteria: 'technical feasibility and business value'
    },
    { strategy: 'majority', threshold: 0.7 }
  );

  // Phase 4: Implementation with review
  if (decision.success) {
    const implementation = await orchestrator.executeReview(
      'r1', // Lead researcher implements
      reviewers,
      {
        type: 'implement',
        spec: decision.result
      },
      { revisionRounds: 2 }
    );

    return {
      research: research.results,
      approach: approach.finalProposal,
      decision: decision.result,
      implementation: implementation.finalWork
    };
  }

  orchestrator.destroy();
  messageBus.clear();
}
```

---

## Advanced Topics

### Custom Synthesizers

Create custom logic for combining parallel results:

```javascript
const customSynthesizer = (results, task) => {
  // Extract all insights
  const allInsights = results.flatMap(r => r.insights || []);

  // Remove duplicates
  const uniqueInsights = [...new Set(allInsights)];

  // Calculate average confidence
  const avgConfidence = results.reduce((sum, r) => sum + (r.confidence || 0), 0) / results.length;

  return {
    insights: uniqueInsights,
    confidence: avgConfidence,
    agentCount: results.length,
    task: task.type
  };
};

const result = await orchestrator.executeParallel(
  agentIds,
  task,
  { synthesizer: customSynthesizer }
);
```

### Custom Selectors for Ensemble

Define custom logic for selecting the best result:

```javascript
const qualitySelector = (results) => {
  // Score each result
  const scored = results.map(result => ({
    result,
    score: calculateQualityScore(result)
  }));

  // Sort by score
  scored.sort((a, b) => b.score - a.score);

  // Return best
  return scored[0].result;
};

function calculateQualityScore(result) {
  let score = 0;
  if (result.completeness) score += 30;
  if (result.accuracy) score += 40;
  if (result.clarity) score += 30;
  return score;
}

const result = await orchestrator.executeEnsemble(
  agentIds,
  task,
  {
    strategy: 'best-of',
    selector: qualitySelector
  }
);
```

### Monitoring and Statistics

Track agent performance:

```javascript
// Get orchestrator stats
const stats = orchestrator.getStats();

console.log('Total agents:', stats.totalAgents);
console.log('Active topics:', stats.topics);

stats.agents.forEach(agentStats => {
  console.log(`\n${agentStats.agentId}:`);
  console.log('  Total executions:', agentStats.totalExecutions);
  console.log('  Success rate:', agentStats.successRate + '%');
  console.log('  Average duration:', agentStats.avgDuration + 'ms');
});

// Get individual agent stats
const agent = orchestrator.getAgent('researcher-1');
const agentStats = agent.getStats();

console.log('Agent state:', agentStats.state);
console.log('Execution history:', agentStats.executionHistory);
```

---

## Troubleshooting

### Common Issues

**Issue: Agents timing out**

```javascript
// Solution: Increase timeout and retries
const result = await orchestrator.executeParallel(
  agentIds,
  task,
  {
    timeout: 120000,  // 2 minutes
    retries: 5        // More retry attempts
  }
);
```

**Issue: Memory leaks from subscriptions**

```javascript
// Solution: Always cleanup
const unsubscribe = messageBus.subscribe('topic', 'id', handler);

// Later...
unsubscribe(); // Don't forget!

// Or use agent.destroy() which cleans up all subscriptions
agent.destroy();
```

**Issue: Consensus never reached**

```javascript
// Solution: Lower threshold or use weighted voting
const result = await orchestrator.executeWithConsensus(
  agentIds,
  task,
  {
    strategy: 'majority',
    threshold: 0.51  // Just over 50%
  }
);

// Or give more weight to key agents
const result = await orchestrator.executeWithConsensus(
  agentIds,
  task,
  {
    strategy: 'weighted',
    weights: { 'expert-agent': 3, 'agent-2': 1, 'agent-3': 1 }
  }
);
```

---

## Next Steps

- See [API Reference](./API-REFERENCE.md) for detailed API documentation
- Check [examples/](../examples/) for complete working examples
- Run `npm run demo` to see all patterns in action

---

## Support

For issues or questions:
- Check the examples in `examples/`
- Review test cases in `__tests__/core/`
- Read the implementation in `.claude/core/`
