# Implementation Roadmap - Quality + Multi-Agent Orchestration

**Goal**: Implement essential quality improvements AND true multi-agent collaboration
**Timeline**: 4 weeks (part-time) or 2 weeks (full-time)
**Effort**: ~65 hours total
**Result**: Production-ready framework with competitive multi-agent capabilities

---

## 🎯 What We're Building

### Phase 1: Foundation (Week 1) - 17 hours
Essential quality-of-life improvements that make development easier

### Phase 2: Multi-Agent Core (Week 2-3) - 40 hours
True multi-agent orchestration with parallel execution and collaboration

### Phase 3: Integration & Polish (Week 4) - 8 hours
Put it all together and document

---

## 📅 Detailed Implementation Plan

### Week 1: Foundation & Quality (17 hours)

#### Day 1-2: Testing Infrastructure (8 hours)

**Goal**: Add Jest and write critical tests

**Tasks**:
1. Install and configure Jest (30 min)
2. Write StateManager tests (3 hours)
3. Write PhaseInference tests (2 hours)
4. Write SessionInit tests (2 hours)
5. Set up CI/CD with tests (30 min)

**Deliverables**:
```bash
.
├── jest.config.js
├── package.json (updated with test script)
└── __tests__/
    ├── state-manager.test.js
    ├── phase-inference.test.js
    ├── session-init.test.js
    └── integration.test.js
```

**Commands**:
```bash
npm install --save-dev jest
npm test
```

**Test Coverage Target**: 30-40% (focus on critical paths)

---

#### Day 3: Logging (2 hours)

**Goal**: Replace console.log with Winston

**Tasks**:
1. Install Winston (5 min)
2. Create logger.js module (30 min)
3. Replace console.log in 6 core files (1 hour)
4. Test logging output (15 min)

**Deliverables**:
```bash
.
├── .claude/core/logger.js
└── logs/
    ├── error.log
    └── combined.log
```

**Configuration**:
```javascript
// .claude/core/logger.js
const winston = require('winston');

module.exports = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message} ${
        Object.keys(meta).length ? JSON.stringify(meta) : ''
      }`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.colorize({ all: true })
    }),
    new winston.transports.File({
      filename: '.claude/logs/error.log',
      level: 'error'
    }),
    new winston.transports.File({
      filename: '.claude/logs/combined.log'
    })
  ]
});
```

---

#### Day 4: Interactive CLI (6 hours)

**Goal**: Create menu-driven interface

**Tasks**:
1. Install inquirer, chalk, ora (5 min)
2. Design CLI menu structure (30 min)
3. Implement main menu (2 hours)
4. Add session management flows (2 hours)
5. Add traceability query flows (1 hour)
6. Polish and test (30 min)

**Deliverables**:
```bash
.
└── scripts/
    └── interactive-cli.js
```

**Features**:
- Start new session (with task input)
- View statistics
- Search prompts
- Generate reports
- View artifact history
- Exit

**Usage**:
```bash
node scripts/interactive-cli.js
```

---

#### Day 5: Tokenizer (1 hour)

**Goal**: Accurate token counting

**Tasks**:
1. Install tiktoken (5 min)
2. Create TokenCounter class (20 min)
3. Replace estimation in context-loader (20 min)
4. Test accuracy (15 min)

**Deliverables**:
```bash
.
└── .claude/core/token-counter.js
```

**Implementation**:
```javascript
// .claude/core/token-counter.js
const { encoding_for_model } = require('tiktoken');

class TokenCounter {
  constructor() {
    // Use GPT-4 encoding (close approximation for Claude)
    this.encoding = encoding_for_model('gpt-4');
  }

  count(text) {
    return this.encoding.encode(text).length;
  }

  countWithCache(text, cacheKey) {
    // Add caching for repeated counts
    if (!this._cache) this._cache = new Map();

    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }

    const count = this.count(text);
    this._cache.set(cacheKey, count);
    return count;
  }

  free() {
    this.encoding.free();
  }
}

module.exports = TokenCounter;
```

---

### Week 2-3: Multi-Agent Orchestration (40 hours)

#### Day 6-7: Architecture & Message Bus (12 hours)

**Goal**: Design system and implement communication layer

**Tasks**:
1. Design orchestrator architecture (2 hours)
2. Create message bus (4 hours)
3. Define agent interface (2 hours)
4. Implement agent registry (2 hours)
5. Write tests (2 hours)

**Deliverables**:
```bash
.
└── .claude/core/
    ├── message-bus.js
    ├── agent-interface.js
    ├── agent-registry.js
    └── orchestrator.js (skeleton)
```

**Key Classes**:

```javascript
// message-bus.js
class MessageBus {
  constructor() {
    this.subscribers = new Map();
    this.messageQueue = [];
  }

  subscribe(topic, handler) {
    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, []);
    }
    this.subscribers.get(topic).push(handler);
  }

  publish(topic, message) {
    const handlers = this.subscribers.get(topic) || [];
    handlers.forEach(handler => handler(message));
  }

  async publishAsync(topic, message) {
    const handlers = this.subscribers.get(topic) || [];
    return Promise.all(handlers.map(h => h(message)));
  }
}

// agent-interface.js
class Agent {
  constructor(id, role, config = {}) {
    this.id = id;
    this.role = role;
    this.config = config;
    this.messageBus = null;
  }

  setMessageBus(bus) {
    this.messageBus = bus;
    this._subscribe();
  }

  _subscribe() {
    // Subscribe to relevant topics
    this.messageBus.subscribe(`agent.${this.id}`, this.handleMessage.bind(this));
    this.messageBus.subscribe('agent.broadcast', this.handleBroadcast.bind(this));
  }

  async execute(task, context = {}) {
    // To be implemented by specific agents
    throw new Error('execute() must be implemented by subclass');
  }

  async handleMessage(message) {
    // Handle direct messages
  }

  async handleBroadcast(message) {
    // Handle broadcast messages
  }

  send(targetAgentId, message) {
    this.messageBus.publish(`agent.${targetAgentId}`, {
      from: this.id,
      ...message
    });
  }

  broadcast(message) {
    this.messageBus.publish('agent.broadcast', {
      from: this.id,
      ...message
    });
  }
}
```

---

#### Day 8-10: Parallel Execution (12 hours)

**Goal**: Execute multiple agents simultaneously

**Tasks**:
1. Implement parallel execution strategy (3 hours)
2. Add result synthesis (3 hours)
3. Error handling and retries (2 hours)
4. Timeout management (2 hours)
5. Write tests (2 hours)

**Implementation**:

```javascript
// orchestrator.js
class AgentOrchestrator {
  constructor() {
    this.messageBus = new MessageBus();
    this.registry = new AgentRegistry();
    this.activeExecutions = new Map();
  }

  registerAgent(agent) {
    agent.setMessageBus(this.messageBus);
    this.registry.add(agent);
  }

  async executeParallel(agentIds, task, options = {}) {
    const {
      timeout = 120000, // 2 minutes
      retries = 2
    } = options;

    logger.info('Starting parallel execution', {
      agentIds,
      task: task.substring(0, 100)
    });

    const executionId = this._generateExecutionId();
    const agents = agentIds.map(id => this.registry.get(id));

    try {
      // Execute all agents in parallel with timeout
      const results = await Promise.race([
        Promise.all(
          agents.map(agent =>
            this._executeWithRetry(agent, task, retries)
          )
        ),
        this._timeout(timeout, executionId)
      ]);

      // Synthesize results
      const synthesized = await this._synthesize(results, task);

      logger.info('Parallel execution completed', {
        executionId,
        agentCount: agentIds.length,
        resultLength: synthesized.length
      });

      return {
        success: true,
        result: synthesized,
        individualResults: results,
        metadata: {
          executionId,
          duration: Date.now() - this.activeExecutions.get(executionId).startTime,
          agentCount: agentIds.length
        }
      };

    } catch (error) {
      logger.error('Parallel execution failed', {
        executionId,
        error: error.message
      });
      throw error;
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  async _executeWithRetry(agent, task, retries) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await agent.execute(task);
        return { agentId: agent.id, result, success: true };
      } catch (error) {
        lastError = error;
        logger.warn('Agent execution failed, retrying', {
          agentId: agent.id,
          attempt,
          error: error.message
        });

        if (attempt < retries) {
          await this._delay(1000 * Math.pow(2, attempt)); // Exponential backoff
        }
      }
    }

    return {
      agentId: agent.id,
      error: lastError.message,
      success: false
    };
  }

  async _synthesize(results, originalTask) {
    // Combine multiple agent results
    const successfulResults = results.filter(r => r.success);

    if (successfulResults.length === 0) {
      throw new Error('All agents failed to execute');
    }

    // Simple concatenation strategy (can be enhanced)
    const combined = successfulResults
      .map(r => `[${r.agentId}]: ${r.result}`)
      .join('\n\n---\n\n');

    return `Multiple agent perspectives on: "${originalTask}"\n\n${combined}`;
  }

  _timeout(ms, executionId) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Execution ${executionId} timed out after ${ms}ms`));
      }, ms);
    });
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _generateExecutionId() {
    const id = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.activeExecutions.set(id, { startTime: Date.now() });
    return id;
  }
}
```

---

#### Day 11-12: Consensus & Voting (8 hours)

**Goal**: Agents reach consensus on decisions

**Tasks**:
1. Implement voting mechanisms (3 hours)
2. Consensus strategies (2 hours)
3. Conflict resolution (2 hours)
4. Write tests (1 hour)

**Implementation**:

```javascript
class AgentOrchestrator {
  // ... existing methods ...

  async executeWithConsensus(agentIds, task, options = {}) {
    const {
      threshold = 0.7, // 70% agreement required
      votingStrategy = 'majority',
      maxRounds = 3
    } = options;

    logger.info('Starting consensus execution', { agentIds, threshold });

    let round = 0;
    let proposal = task;

    while (round < maxRounds) {
      // Get responses from all agents
      const responses = await this.executeParallel(agentIds, proposal);

      // Vote on responses
      const vote = await this._vote(
        responses.individualResults,
        votingStrategy
      );

      if (vote.consensus >= threshold) {
        logger.info('Consensus reached', {
          round,
          consensus: vote.consensus,
          winner: vote.winner.substring(0, 100)
        });

        return {
          success: true,
          result: vote.winner,
          consensus: vote.consensus,
          rounds: round + 1,
          votes: vote.breakdown
        };
      }

      // Refine proposal based on feedback
      proposal = await this._refineProposal(proposal, responses, vote);
      round++;
    }

    // Consensus not reached, return best option
    logger.warn('Consensus not reached, returning majority', {
      maxRounds,
      finalConsensus: vote.consensus
    });

    return {
      success: false,
      result: vote.winner,
      consensus: vote.consensus,
      rounds: maxRounds,
      message: 'Consensus threshold not reached'
    };
  }

  async _vote(results, strategy) {
    const successfulResults = results.filter(r => r.success);

    switch (strategy) {
      case 'majority':
        return this._majorityVote(successfulResults);

      case 'weighted':
        return this._weightedVote(successfulResults);

      case 'unanimous':
        return this._unanimousVote(successfulResults);

      default:
        return this._majorityVote(successfulResults);
    }
  }

  _majorityVote(results) {
    // Simple majority: most common response wins
    const votes = new Map();

    results.forEach(r => {
      const normalized = this._normalizeResponse(r.result);
      votes.set(normalized, (votes.get(normalized) || 0) + 1);
    });

    const winner = Array.from(votes.entries())
      .sort((a, b) => b[1] - a[1])[0];

    const totalVotes = results.length;
    const winnerVotes = winner[1];

    return {
      winner: winner[0],
      consensus: winnerVotes / totalVotes,
      breakdown: Object.fromEntries(votes)
    };
  }

  _normalizeResponse(response) {
    // Normalize responses for comparison
    return response.trim().toLowerCase();
  }

  async _refineProposal(original, responses, vote) {
    // Use dissenting opinions to refine the proposal
    const dissenters = responses.individualResults
      .filter(r => r.success && this._normalizeResponse(r.result) !== vote.winner);

    if (dissenters.length === 0) {
      return original;
    }

    // Incorporate feedback
    const feedback = dissenters.map(d => d.result).join('\n');
    return `${original}\n\nConsider these alternative perspectives:\n${feedback}`;
  }
}
```

---

#### Day 13-14: Collaboration Patterns (8 hours)

**Goal**: Implement debate, review, and ensemble patterns

**Tasks**:
1. Debate pattern (3 hours)
2. Review/critique pattern (2 hours)
3. Ensemble pattern (2 hours)
4. Write tests (1 hour)

**Implementation**:

```javascript
class AgentOrchestrator {
  // ... existing methods ...

  async executeDebate(agentIds, topic, rounds = 3) {
    logger.info('Starting debate', { agentIds, topic, rounds });

    let currentProposal = topic;
    const debateHistory = [];

    for (let round = 0; round < rounds; round++) {
      // Each agent critiques current proposal
      const critiques = await this.executeParallel(
        agentIds,
        `Critique this proposal and suggest improvements:\n${currentProposal}`
      );

      debateHistory.push({
        round: round + 1,
        proposal: currentProposal,
        critiques: critiques.individualResults
      });

      // Refine based on critiques
      currentProposal = await this._synthesizeDebate(
        currentProposal,
        critiques.individualResults
      );

      logger.info('Debate round completed', {
        round: round + 1,
        proposalLength: currentProposal.length
      });
    }

    return {
      success: true,
      finalProposal: currentProposal,
      debateHistory: debateHistory,
      rounds: rounds
    };
  }

  async executeReview(creatorAgentId, reviewerAgentIds, task) {
    logger.info('Starting review process', {
      creator: creatorAgentId,
      reviewers: reviewerAgentIds
    });

    // Creator produces initial work
    const creator = this.registry.get(creatorAgentId);
    const initialWork = await creator.execute(task);

    // Reviewers critique
    const reviews = await this.executeParallel(
      reviewerAgentIds,
      `Review this work and provide specific feedback:\n\n${initialWork.result}`
    );

    // Creator revises based on feedback
    const revision = await creator.execute(
      `Revise your work based on this feedback:\n\n` +
      `Original: ${initialWork.result}\n\n` +
      `Feedback: ${reviews.result}`
    );

    return {
      success: true,
      original: initialWork.result,
      reviews: reviews.individualResults,
      revised: revision.result,
      metadata: {
        reviewerCount: reviewerAgentIds.length
      }
    };
  }

  async executeEnsemble(agentIds, task, ensembleStrategy = 'best-of') {
    logger.info('Starting ensemble execution', {
      agentIds,
      strategy: ensembleStrategy
    });

    // All agents work independently
    const results = await this.executeParallel(agentIds, task);

    let finalResult;

    switch (ensembleStrategy) {
      case 'best-of':
        // Pick the best result (can use quality scoring)
        finalResult = await this._selectBest(results.individualResults, task);
        break;

      case 'merge':
        // Merge all results
        finalResult = results.result;
        break;

      case 'vote':
        // Vote on best result
        const vote = await this._vote(results.individualResults, 'majority');
        finalResult = vote.winner;
        break;

      default:
        finalResult = results.result;
    }

    return {
      success: true,
      result: finalResult,
      allResults: results.individualResults,
      strategy: ensembleStrategy
    };
  }

  async _synthesizeDebate(currentProposal, critiques) {
    // Combine critiques to improve proposal
    const improvements = critiques
      .filter(c => c.success)
      .map(c => c.result)
      .join('\n\n');

    // In real implementation, this would use an LLM to synthesize
    return `${currentProposal}\n\n[Refined based on feedback:\n${improvements}]`;
  }

  async _selectBest(results, originalTask) {
    // Simple heuristic: longest response (can be enhanced with quality scoring)
    const best = results
      .filter(r => r.success)
      .sort((a, b) => b.result.length - a.result.length)[0];

    return best ? best.result : results[0].result;
  }
}
```

---

### Week 4: Integration & Documentation (8 hours)

#### Day 15: Integration (4 hours)

**Goal**: Wire everything together

**Tasks**:
1. Create concrete agent implementations (2 hours)
2. Update session-init to use orchestrator (1 hour)
3. Add CLI commands for multi-agent features (1 hour)

**Example Agent Implementation**:

```javascript
// .claude/agents/research-agent.js
const { Agent } = require('../core/agent-interface');
const logger = require('../core/logger');

class ResearchAgent extends Agent {
  constructor(config = {}) {
    super('research-analyst', 'Research Analyst', config);
  }

  async execute(task, context = {}) {
    logger.info('Research agent executing', { task: task.substring(0, 50) });

    // Simulate LLM call (replace with actual Anthropic API call)
    const prompt = `As a Research Analyst, analyze this task:\n${task}`;

    // TODO: Replace with actual LLM call
    const response = await this._callLLM(prompt);

    return {
      agentId: this.id,
      role: this.role,
      result: response,
      success: true
    };
  }

  async _callLLM(prompt) {
    // Placeholder - replace with actual Anthropic API
    return `[Research Analyst perspective on: ${prompt.substring(0, 50)}...]`;
  }
}

module.exports = ResearchAgent;
```

---

#### Day 16: Documentation (4 hours)

**Goal**: Document new features

**Tasks**:
1. Update CLAUDE.md with multi-agent patterns (1 hour)
2. Create MULTI-AGENT-GUIDE.md (2 hours)
3. Add code examples and recipes (1 hour)

**Documentation Outline**:

```markdown
# Multi-Agent Guide

## Quick Start

### Parallel Execution
```javascript
const orchestrator = new AgentOrchestrator();
orchestrator.registerAgent(new ResearchAgent());
orchestrator.registerAgent(new PlanningAgent());

const result = await orchestrator.executeParallel(
  ['research-analyst', 'planning-agent'],
  'Design a new authentication system'
);
```

### Consensus Decision
```javascript
const decision = await orchestrator.executeWithConsensus(
  ['research-analyst', 'architect', 'security-expert'],
  'Should we use OAuth2 or JWT?',
  { threshold: 0.8 }
);
```

### Debate
```javascript
const refined = await orchestrator.executeDebate(
  ['senior-dev', 'architect', 'qa-engineer'],
  'Propose an API design for user management',
  3 // rounds
);
```

### Code Review
```javascript
const reviewed = await orchestrator.executeReview(
  'senior-dev', // creator
  ['code-reviewer', 'security-expert'], // reviewers
  'Implement user login endpoint'
);
```
```

---

## 📊 Progress Tracking

### Week 1 Milestones:
- [ ] Jest tests running (`npm test`)
- [ ] Winston logging in all core files
- [ ] Interactive CLI works
- [ ] Accurate token counts

### Week 2-3 Milestones:
- [ ] Message bus operational
- [ ] Agents can execute in parallel
- [ ] Consensus voting works
- [ ] Debate pattern functional

### Week 4 Milestones:
- [ ] Concrete agents implemented
- [ ] SessionInit uses orchestrator
- [ ] Documentation complete
- [ ] End-to-end demo works

---

## 🧪 Testing Strategy

### Unit Tests (Week 1):
- StateManager (CRUD operations)
- PhaseInference (keyword detection)
- SessionInit (initialization modes)

### Integration Tests (Week 2-3):
- MessageBus (pub/sub)
- Parallel execution (timeout, retries)
- Consensus voting (majority, weighted)

### End-to-End Tests (Week 4):
- Complete workflow with multiple agents
- Error handling
- Performance benchmarks

---

## 🚀 Getting Started

I can help you implement any of these pieces. Which would you like to start with?

**Quick Wins (Start Here)**:
1. **Testing** - Highest ROI, prevents future bugs
2. **Logging** - Makes debugging 10x easier
3. **Tokenizer** - Easy 1-hour win

**Big Feature (After Quick Wins)**:
4. **Multi-Agent Orchestrator** - Transform your framework

**Order I Recommend**:
```
Day 1-2: Testing (8h)
Day 3: Logging (2h)
Day 4: CLI (6h)
Day 5: Tokenizer (1h)
--- Week 1 Complete (17h) ---

Day 6-7: Message Bus + Architecture (12h)
Day 8-10: Parallel Execution (12h)
Day 11-12: Consensus (8h)
Day 13-14: Collaboration Patterns (8h)
--- Week 2-3 Complete (40h) ---

Day 15: Integration (4h)
Day 16: Documentation (4h)
--- Week 4 Complete (8h) ---
```

**Total**: 65 hours = 4 weeks part-time or 2 weeks full-time

---

## 💡 Implementation Options

**Option A - Full Assistance**: I implement everything step-by-step with you
**Option B - Guidance**: I provide code, you implement and test
**Option C - Hybrid**: I implement complex parts, you do simpler parts

Which approach works best for you?

Let me know which piece you'd like to start with, and I'll help you build it!
