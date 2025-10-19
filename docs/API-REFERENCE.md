# Multi-Agent System API Reference

## Table of Contents

1. [MessageBus](#messagebus)
2. [Agent](#agent)
3. [AgentOrchestrator](#agentorchestrator)

---

## MessageBus

Event-driven message bus for agent communication using publish/subscribe and request/response patterns.

### Constructor

```javascript
new MessageBus()
```

Creates a new MessageBus instance.

**Example:**
```javascript
const MessageBus = require('./.claude/core/message-bus');
const bus = new MessageBus();
```

---

### Methods

#### subscribe(topic, subscriberId, handler)

Subscribe to messages on a topic.

**Parameters:**
- `topic` (string): The topic to subscribe to
- `subscriberId` (string): Unique identifier for the subscriber
- `handler` (function): Callback function to handle messages
  - Receives: `(message)` where message includes `_metadata` field

**Returns:**
- `function`: Unsubscribe function to remove the subscription

**Example:**
```javascript
const unsubscribe = bus.subscribe('events', 'agent-1', (message) => {
  console.log('Received:', message);
  console.log('From:', message._metadata.publisherId);
  console.log('Timestamp:', message._metadata.timestamp);
});

// Later, to unsubscribe:
unsubscribe();
```

---

#### publish(topic, message, publisherId)

Publish a message to a topic.

**Parameters:**
- `topic` (string): The topic to publish to
- `message` (Object): The message payload
- `publisherId` (string): Identifier of the publisher

**Returns:** `void`

**Side Effects:**
- Adds `_metadata` field to message with:
  - `topic`: The topic name
  - `publisherId`: Publisher identifier
  - `timestamp`: ISO 8601 timestamp
  - `messageId`: Unique message identifier
- Stores message in history (last 1000 messages)
- Emits event to all topic subscribers

**Example:**
```javascript
bus.publish('notifications', {
  type: 'status-update',
  data: { status: 'processing' }
}, 'agent-2');
```

---

#### request(topic, message, requesterId, options)

Send a request and wait for responses (request/response pattern).

**Parameters:**
- `topic` (string): The topic to send request to
- `message` (Object): The request message payload
- `requesterId` (string): Identifier of the requester
- `options` (Object, optional):
  - `timeout` (number): Timeout in ms (default: 30000)
  - `responseCount` (number): Number of responses to wait for (default: 1)

**Returns:**
- `Promise<Array>`: Resolves with array of responses, or rejects on timeout

**Example:**
```javascript
try {
  const responses = await bus.request(
    'query-topic',
    { query: 'What is the status?' },
    'agent-1',
    {
      timeout: 5000,
      responseCount: 2
    }
  );
  console.log('Received responses:', responses);
} catch (error) {
  console.error('Request timed out:', error.message);
}
```

---

#### reply(requestMessage, response, responderId)

Reply to a request message.

**Parameters:**
- `requestMessage` (Object): Original request message (must have `_responseTopic`)
- `response` (Object): Response payload
- `responderId` (string): Identifier of the responder

**Returns:** `void`

**Example:**
```javascript
bus.subscribe('query-topic', 'agent-2', (requestMessage) => {
  const result = processQuery(requestMessage.query);

  bus.reply(requestMessage, {
    success: true,
    result
  }, 'agent-2');
});
```

---

#### getMessageHistory(topic, limit)

Retrieve message history for a topic.

**Parameters:**
- `topic` (string, optional): Filter by topic, or omit for all messages
- `limit` (number, optional): Maximum messages to return (default: 100)

**Returns:**
- `Array<Object>`: Array of message objects with metadata

**Example:**
```javascript
const recent = bus.getMessageHistory('events', 50);
console.log('Last 50 events:', recent);

const allRecent = bus.getMessageHistory(null, 20);
console.log('Last 20 messages across all topics:', allRecent);
```

---

#### getActiveTopics()

Get list of all topics with active subscriptions.

**Returns:**
- `Array<string>`: Array of topic names

**Example:**
```javascript
const topics = bus.getActiveTopics();
console.log('Active topics:', topics);
// Output: ['events', 'notifications', 'agent:agent-1:direct']
```

---

#### clear()

Clear all message history and subscriptions.

**Returns:** `void`

**Example:**
```javascript
bus.clear();
```

---

## Agent

Abstract base class for all agents. Must be extended and implement `execute()` method.

### Constructor

```javascript
new Agent(id, role, messageBus, config)
```

**Parameters:**
- `id` (string): Unique agent identifier
- `role` (string): Agent role/type description
- `messageBus` (MessageBus): MessageBus instance for communication
- `config` (Object, optional):
  - `timeout` (number): Execution timeout in ms (default: 60000)
  - `retries` (number): Retry attempts on failure (default: 3)
  - Additional custom config fields

**Example:**
```javascript
const Agent = require('./.claude/core/agent');

class MyAgent extends Agent {
  constructor(id, messageBus, config = {}) {
    super(id, 'Custom Role', messageBus, {
      timeout: 90000,
      retries: 5,
      ...config
    });
  }

  async execute(task, context = {}) {
    // Implementation required
  }
}
```

---

### Properties

#### id
- Type: `string`
- Description: Unique agent identifier
- Read-only

#### role
- Type: `string`
- Description: Agent role/type
- Read-only

#### state
- Type: `string`
- Description: Current agent state
- Values: `'idle'`, `'working'`, `'completed'`, `'failed'`

#### messageBus
- Type: `MessageBus`
- Description: MessageBus instance
- Read-only

#### config
- Type: `Object`
- Description: Agent configuration
- Read-only

#### logger
- Type: `Logger`
- Description: Winston logger instance for this agent

---

### Methods

#### execute(task, context) [Abstract]

Execute a task. **Must be implemented by subclasses.**

**Parameters:**
- `task` (Object): Task to execute (structure defined by agent implementation)
- `context` (Object, optional): Execution context

**Returns:**
- `Promise<Object>`: Result object (structure defined by agent implementation)

**Should include in result:**
- `success` (boolean): Whether execution succeeded
- `agentId` (string): This agent's ID
- `role` (string): This agent's role

**Example Implementation:**
```javascript
async execute(task, context = {}) {
  this.setState('working');
  const startTime = Date.now();

  try {
    const result = await this.processTask(task);
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
    const duration = Date.now() - startTime;
    this._recordExecution(task, { success: false, error: error.message }, duration);
    this.setState('failed');
    throw error;
  }
}
```

---

#### send(targetAgentId, message)

Send a direct message to another agent and wait for response.

**Parameters:**
- `targetAgentId` (string): Target agent's ID
- `message` (Object): Message payload

**Returns:**
- `Promise<Object|null>`: Response from target agent, or null if timeout

**Example:**
```javascript
const response = await this.send('agent-2', {
  type: 'question',
  question: 'What is your status?'
});

console.log('Agent-2 responded:', response);
```

---

#### broadcast(message)

Broadcast a message to all agents.

**Parameters:**
- `message` (Object): Message payload

**Returns:** `void`

**Example:**
```javascript
this.broadcast({
  type: 'announcement',
  data: 'Task completed successfully'
});
```

---

#### subscribe(topic, handler)

Subscribe to a topic.

**Parameters:**
- `topic` (string): Topic to subscribe to
- `handler` (function): Message handler function

**Returns:** `void`

**Side Effects:**
- Subscription is tracked and cleaned up on `destroy()`

**Example:**
```javascript
this.subscribe('custom-events', (message) => {
  console.log('Custom event:', message);
});
```

---

#### handleDirectMessages(handler)

Register handler for direct messages sent to this agent.

**Parameters:**
- `handler` (async function): Handler function
  - Receives: `(message)`
  - Returns: Response object (sent back to sender automatically)

**Returns:** `void`

**Example:**
```javascript
this.handleDirectMessages(async (message) => {
  if (message.type === 'status-request') {
    return {
      status: this.state,
      timestamp: new Date().toISOString()
    };
  }

  return { error: 'Unknown message type' };
});
```

---

#### handleBroadcasts(handler)

Register handler for broadcast messages.

**Parameters:**
- `handler` (function): Handler function
  - Receives: `(message)`

**Returns:** `void`

**Example:**
```javascript
this.handleBroadcasts((message) => {
  if (message.type === 'shutdown') {
    this.logger.info('Shutdown signal received');
    this.cleanup();
  }
});
```

---

#### setState(newState)

Update agent state and publish state change event.

**Parameters:**
- `newState` (string): New state value

**Returns:** `void`

**Publishes:**
- Topic: `'agent:state-change'`
- Message: `{ agentId, role, oldState, newState }`

**Example:**
```javascript
this.setState('working');
// Publishes: { agentId: 'agent-1', role: 'Researcher', oldState: 'idle', newState: 'working' }
```

---

#### getStats()

Get agent execution statistics.

**Returns:**
- `Object`:
  - `agentId` (string): Agent ID
  - `role` (string): Agent role
  - `state` (string): Current state
  - `totalExecutions` (number): Total executions
  - `successfulExecutions` (number): Successful executions
  - `failedExecutions` (number): Failed executions
  - `successRate` (number): Success percentage (0-100)
  - `avgDuration` (number): Average execution time in ms
  - `executionHistory` (Array): Recent execution records (last 100)

**Example:**
```javascript
const stats = agent.getStats();
console.log(`Success rate: ${stats.successRate}%`);
console.log(`Average duration: ${stats.avgDuration}ms`);
```

---

#### destroy()

Cleanup agent resources (subscriptions, handlers).

**Returns:** `void`

**Side Effects:**
- Unsubscribes from all topics
- Removes all handlers
- Publishes state change to 'destroyed'

**Example:**
```javascript
agent.destroy();
```

---

### Protected Methods

These methods are available to subclasses:

#### _recordExecution(task, result, duration)

Record an execution in history for statistics.

**Parameters:**
- `task` (Object): The task that was executed
- `result` (Object): Execution result (must have `success` field)
- `duration` (number): Execution duration in ms

**Returns:** `void`

**Example:**
```javascript
const startTime = Date.now();
const result = await this.processTask(task);
const duration = Date.now() - startTime;

this._recordExecution(task, result, duration);
```

---

## AgentOrchestrator

Coordinates multiple agents using various collaboration patterns.

### Constructor

```javascript
new AgentOrchestrator(messageBus)
```

**Parameters:**
- `messageBus` (MessageBus): MessageBus instance for agent communication

**Example:**
```javascript
const AgentOrchestrator = require('./.claude/core/agent-orchestrator');
const MessageBus = require('./.claude/core/message-bus');

const messageBus = new MessageBus();
const orchestrator = new AgentOrchestrator(messageBus);
```

---

### Methods

#### registerAgent(agent)

Register an agent with the orchestrator.

**Parameters:**
- `agent` (Agent): Agent instance to register

**Returns:** `void`

**Example:**
```javascript
const agent1 = new MyAgent('agent-1', messageBus);
orchestrator.registerAgent(agent1);
```

---

#### unregisterAgent(agentId)

Unregister and destroy an agent.

**Parameters:**
- `agentId` (string): Agent ID to unregister

**Returns:** `void`

**Side Effects:**
- Calls `agent.destroy()`
- Removes agent from registry

**Example:**
```javascript
orchestrator.unregisterAgent('agent-1');
```

---

#### getAgent(agentId)

Get agent instance by ID.

**Parameters:**
- `agentId` (string): Agent ID

**Returns:**
- `Agent|null`: Agent instance or null if not found

**Example:**
```javascript
const agent = orchestrator.getAgent('agent-1');
if (agent) {
  console.log('Agent state:', agent.state);
}
```

---

#### executeParallel(agentIds, task, options)

Execute task with multiple agents in parallel.

**Parameters:**
- `agentIds` (Array<string>): Agent IDs to execute
- `task` (Object): Task to execute
- `options` (Object, optional):
  - `timeout` (number): Timeout per agent in ms (default: 60000)
  - `retries` (number): Retry attempts per agent (default: 3)
  - `synthesizer` (function): Result synthesis function
    - Receives: `(results, task)` where results is array of agent outputs
    - Returns: Synthesized result object

**Returns:**
- `Promise<Object>`:
  - `success` (boolean): True if at least one agent succeeded
  - `synthesized` (any): Result from synthesizer function
  - `results` (Array): Successful agent results
    - `[{ agentId, result }]`
  - `failures` (Array): Failed agent results
    - `[{ agentId, error }]`
  - `duration` (number): Total execution time in ms

**Example:**
```javascript
const result = await orchestrator.executeParallel(
  ['agent-1', 'agent-2', 'agent-3'],
  {
    type: 'analyze',
    data: 'sample data'
  },
  {
    timeout: 30000,
    retries: 2,
    synthesizer: (results) => {
      return {
        combined: results,
        count: results.length
      };
    }
  }
);

console.log('Success:', result.success);
console.log('Successful agents:', result.results.length);
console.log('Failed agents:', result.failures.length);
console.log('Synthesized:', result.synthesized);
```

---

#### executeWithConsensus(agentIds, task, options)

Execute task and reach consensus through voting.

**Parameters:**
- `agentIds` (Array<string>): Agent IDs to execute
- `task` (Object): Task to execute
- `options` (Object, optional):
  - `strategy` (string): Voting strategy (default: 'majority')
    - `'majority'`: More than threshold percentage
    - `'weighted'`: Weighted voting using agent weights
    - `'unanimous'`: Requires 100% agreement
  - `threshold` (number): Threshold for majority/weighted (default: 0.5)
  - `weights` (Object): Agent weights for weighted voting
    - `{ [agentId]: weight }`
  - `timeout` (number): Timeout in ms (default: 60000)

**Returns:**
- `Promise<Object>`:
  - `success` (boolean): True if consensus reached
  - `result` (any): Winning result
  - `vote` (Object):
    - `winner` (any): Winning vote value
    - `consensus` (boolean): Whether consensus was reached
    - `confidence` (number): Vote confidence (0-1)
    - `votes` (Array): Vote breakdown
      - `[{ value, count }]`
  - `allResults` (Array): All agent results
  - `duration` (number): Total execution time in ms

**Example:**
```javascript
const result = await orchestrator.executeWithConsensus(
  ['agent-1', 'agent-2', 'agent-3'],
  {
    type: 'decide',
    options: ['Option A', 'Option B', 'Option C']
  },
  {
    strategy: 'weighted',
    threshold: 0.6,
    weights: {
      'agent-1': 2,  // Expert agent
      'agent-2': 1,
      'agent-3': 1
    }
  }
);

console.log('Consensus reached:', result.success);
console.log('Winner:', result.result);
console.log('Confidence:', (result.vote.confidence * 100) + '%');
```

---

#### executeDebate(agentIds, topic, rounds, options)

Execute debate with iterative refinement through multiple rounds.

**Parameters:**
- `agentIds` (Array<string>): Agent IDs participating in debate
- `topic` (Object): Topic/task to debate
  - `initialProposal` (string): Starting proposal
- `rounds` (number): Number of debate rounds (default: 3)
- `options` (Object, optional):
  - `timeout` (number): Timeout per round in ms (default: 60000)

**Returns:**
- `Promise<Object>`:
  - `success` (boolean): Always true if completes
  - `finalProposal` (string): Final refined proposal
  - `debateHistory` (Array): History of all rounds
    - `[{ round, proposal, critiques, synthesized }]`
  - `rounds` (number): Number of rounds completed

**How It Works:**
1. Start with `initialProposal`
2. Each agent critiques the current proposal
3. First agent synthesizes critiques into improved proposal
4. Repeat for N rounds
5. Return final proposal

**Example:**
```javascript
const result = await orchestrator.executeDebate(
  ['reviewer-1', 'reviewer-2', 'reviewer-3'],
  {
    initialProposal: 'Use microservices architecture'
  },
  3
);

console.log('Final proposal:', result.finalProposal);

result.debateHistory.forEach((round, idx) => {
  console.log(`Round ${idx + 1}:`);
  console.log('  Proposal:', round.proposal.substring(0, 100) + '...');
  console.log('  Critiques:', round.critiques.results.length);
});
```

---

#### executeReview(creatorId, reviewerIds, task, options)

Execute review pattern: create, critique, revise.

**Parameters:**
- `creatorId` (string): Agent ID for creator
- `reviewerIds` (Array<string>): Agent IDs for reviewers
- `task` (Object): Task to create/review
- `options` (Object, optional):
  - `timeout` (number): Timeout in ms (default: 60000)
  - `revisionRounds` (number): Number of revision rounds (default: 1)

**Returns:**
- `Promise<Object>`:
  - `success` (boolean): Always true if completes
  - `finalWork` (Object): Final revised work
  - `reviewHistory` (Array): History of all rounds
    - `[{ round, reviews, revisedWork }]`
  - `revisionRounds` (number): Number of rounds completed

**How It Works:**
1. Creator produces initial work (task with `phase: 'create'`)
2. Reviewers critique the work (task with `phase: 'review'`)
3. Creator revises based on feedback (task with `phase: 'revise'`)
4. Repeat for N rounds
5. Return final work

**Example:**
```javascript
const result = await orchestrator.executeReview(
  'developer-1',
  ['reviewer-1', 'reviewer-2'],
  {
    type: 'implement-feature',
    feature: 'user authentication'
  },
  {
    revisionRounds: 2
  }
);

console.log('Final work:', result.finalWork);

result.reviewHistory.forEach((round, idx) => {
  console.log(`Revision ${idx + 1}:`);
  console.log('  Reviews received:', round.reviews.length);
});
```

---

#### executeEnsemble(agentIds, task, options)

Execute ensemble: combine multiple agent outputs.

**Parameters:**
- `agentIds` (Array<string>): Agent IDs to execute
- `task` (Object): Task to execute
- `options` (Object, optional):
  - `strategy` (string): Ensemble strategy (default: 'best-of')
    - `'best-of'`: Select single best result using selector
    - `'merge'`: Combine all results into array
    - `'vote'`: Vote for best result (uses majority voting)
  - `timeout` (number): Timeout in ms (default: 60000)
  - `selector` (function): Custom selector for 'best-of' strategy
    - Receives: `(results)` array of agent outputs
    - Returns: Single best result

**Returns:**
- `Promise<Object>`:
  - `success` (boolean): True if at least one agent succeeded
  - `result` (any): Ensemble result (depends on strategy)
  - `strategy` (string): Strategy used
  - `allResults` (Array): All agent results
  - `duration` (number): Total execution time in ms

**Example:**
```javascript
const result = await orchestrator.executeEnsemble(
  ['agent-1', 'agent-2', 'agent-3'],
  {
    type: 'summarize',
    content: 'Long document...'
  },
  {
    strategy: 'best-of',
    selector: (results) => {
      // Select result with most key points
      return results.reduce((best, current) =>
        (current.keyPoints?.length || 0) > (best.keyPoints?.length || 0)
          ? current
          : best
      );
    }
  }
);

console.log('Best result:', result.result);
console.log('All results count:', result.allResults.length);
```

---

#### getStats()

Get orchestrator statistics.

**Returns:**
- `Object`:
  - `totalAgents` (number): Number of registered agents
  - `agents` (Array): Per-agent statistics (from `agent.getStats()`)
  - `topics` (number): Number of active message bus topics

**Example:**
```javascript
const stats = orchestrator.getStats();

console.log('Total agents:', stats.totalAgents);
console.log('Active topics:', stats.topics);

stats.agents.forEach(agentStats => {
  console.log(`${agentStats.agentId}:`);
  console.log('  Success rate:', agentStats.successRate + '%');
  console.log('  Avg duration:', agentStats.avgDuration + 'ms');
});
```

---

#### destroy()

Cleanup orchestrator and all registered agents.

**Returns:** `void`

**Side Effects:**
- Calls `destroy()` on all registered agents
- Clears agent registry

**Example:**
```javascript
orchestrator.destroy();
```

---

## Type Definitions

### Message Structure

All messages published through MessageBus include metadata:

```typescript
{
  // User payload
  ...yourData,

  // Automatically added metadata
  _metadata: {
    topic: string,
    publisherId: string,
    timestamp: string,      // ISO 8601
    messageId: string       // Unique ID
  }
}
```

### Request Message Structure

Request messages include additional fields:

```typescript
{
  // User payload
  ...yourData,

  // Request-specific fields
  _responseTopic: string,   // Where to send response
  _requestId: string,       // Request identifier

  // Metadata
  _metadata: { ... }
}
```

### Task Structure

Tasks passed to agents are agent-specific, but commonly include:

```typescript
{
  type: string,            // Task type
  ...additionalFields     // Agent-specific fields
}
```

### Agent Result Structure

Agent results should follow this structure:

```typescript
{
  success: boolean,
  agentId: string,
  role: string,
  ...additionalFields     // Agent-specific results
}
```

---

## Error Handling

### Common Errors

**AgentNotFoundError**
```javascript
// Thrown when: Agent ID not registered
try {
  await orchestrator.executeParallel(['nonexistent'], task);
} catch (error) {
  // Error: Agent not found: nonexistent
}
```

**ExecutionTimeout**
```javascript
// Thrown when: Agent execution exceeds timeout
try {
  await orchestrator.executeParallel(
    agentIds,
    task,
    { timeout: 1000 } // Very short timeout
  );
} catch (error) {
  // Error: Execution timeout
}
```

**RequestTimeout**
```javascript
// Thrown when: Request doesn't receive responses in time
try {
  await messageBus.request(
    'topic',
    message,
    'requester',
    { timeout: 1000, responseCount: 5 }
  );
} catch (error) {
  // Error: Request timeout: no responses received in 1000ms
}
```

**AbstractMethodError**
```javascript
// Thrown when: execute() not implemented in Agent subclass
const agent = new Agent('id', 'role', messageBus);
try {
  await agent.execute(task);
} catch (error) {
  // Error: Agent id must implement execute() method
}
```

---

## Performance Considerations

### MessageBus

- Message history limited to 1000 messages (FIFO)
- Each subscription creates an event listener
- Clear subscriptions when done to prevent memory leaks

### Agent

- Execution history limited to 100 records per agent (FIFO)
- State changes publish events (subscribe carefully)
- Always call `destroy()` to cleanup resources

### AgentOrchestrator

- Parallel execution uses `Promise.allSettled` (handles partial failures)
- Retry logic uses exponential backoff (2^attempt * 1000ms)
- Large numbers of concurrent agents may impact performance
- Consider batching if executing 100+ agents

---

## Version Compatibility

This API reference is for version 1.0.0 of the multi-agent system.

**Breaking Changes:**
- None (initial release)

**Deprecated Features:**
- None (initial release)

---

## See Also

- [Multi-Agent Usage Guide](./MULTI-AGENT-GUIDE.md) - Comprehensive usage examples
- [Examples Directory](../examples/) - Working code examples
- [Test Suite](../__tests__/core/) - Additional usage examples in tests
