# Multi-Agent Framework - Comprehensive Overview

**Version**: 1.0.0
**Last Updated**: 2025-11-09
**Target Audience**: Framework adopters, developers, architects

---

## Executive Summary

The **Multi-Agent Framework** is a production-grade system for coordinating multiple AI agents in sophisticated workflows. Built on proven enterprise patterns, it combines intelligent orchestration, persistent memory, semantic search, and comprehensive analytics to enable AI agents to collaborate effectively and learn from experience.

**Key Capabilities**:
- 🤝 **5 Orchestration Patterns**: Parallel, Consensus, Debate, Review, Ensemble
- 🧠 **Intelligent Memory**: Persistent storage with semantic search and historical learning
- 📊 **Usage Analytics**: Token tracking, cost calculation, budget management
- 🎯 **Smart Selection**: Automatic pattern detection from natural language
- 🔄 **Agent Library**: 28+ specialized agents with auto-discovery
- 🛡️ **Production Ready**: Comprehensive error handling, graceful degradation, monitoring

---

## Table of Contents

1. [What is the Multi-Agent Framework?](#what-is-the-multi-agent-framework)
2. [Core Architecture](#core-architecture)
3. [Key Features](#key-features)
4. [Framework Components](#framework-components)
5. [Orchestration Patterns](#orchestration-patterns)
6. [Intelligence Layer](#intelligence-layer)
7. [Agent System](#agent-system)
8. [Skills Framework](#skills-framework)
9. [Learning Systems](#learning-systems)
10. [Usage Analytics](#usage-analytics)
11. [Design Philosophy](#design-philosophy)
12. [Getting Started](#getting-started)
13. [Use Cases](#use-cases)
14. [Performance & Scalability](#performance--scalability)
15. [Further Reading](#further-reading)

---

## What is the Multi-Agent Framework?

### Problem Statement

Modern AI development often requires:
- Multiple AI agents working together on complex tasks
- Learning from past experiences to improve over time
- Managing costs and token usage effectively
- Coordinating diverse workflows (research, consensus, review, etc.)
- Maintaining context across long-running projects

Traditional approaches treat each AI interaction as isolated, losing valuable context and requiring manual coordination.

### Solution

The Multi-Agent Framework provides:

**1. Structured Orchestration**
Five proven patterns for multi-agent collaboration, from parallel execution to iterative debate.

**2. Persistent Memory**
SQLite-based storage with full-text and semantic search enables agents to learn from history.

**3. Intelligent Context Loading**
Progressive disclosure system loads relevant past experiences within token budgets.

**4. Cost Management**
Comprehensive token tracking and cost calculation across multiple AI models.

**5. Graceful Degradation**
System continues functioning even when optional components fail.

---

## Core Architecture

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    USER APPLICATION LAYER                        │
│  - CLI Tools          - Demo Applications      - Your Code       │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│               ORCHESTRATION & COORDINATION LAYER                 │
│                                                                  │
│  ┌──────────────────────┐      ┌────────────────────────────┐  │
│  │  AgentOrchestrator   │◄────►│  IntelligentOrchestrator   │  │
│  │  • 5 Patterns        │      │  • Auto Pattern Selection   │  │
│  │  • Agent Coordination│      │  • NLP Analysis            │  │
│  │  • Retry Logic       │      │  • Smart Recommendations   │  │
│  └──────────┬───────────┘      └────────────────────────────┘  │
│             │                                                    │
│  ┌──────────▼───────────┐      ┌────────────────────────────┐  │
│  │  LifecycleHooks      │      │  MessageBus                │  │
│  │  • beforeExecution   │◄────►│  • Pub/Sub Events          │  │
│  │  • afterExecution    │      │  • Request/Response        │  │
│  │  • onError           │      │  • Message History         │  │
│  └──────────┬───────────┘      └────────────────────────────┘  │
└─────────────┼──────────────────────────────────────────────────┘
              │
┌─────────────▼──────────────────────────────────────────────────┐
│                    MEMORY & INTELLIGENCE LAYER                   │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │  MemoryStore     │  │  VectorStore     │  │  Context     │ │
│  │  (SQLite+FTS5)   │  │  (Chroma)        │  │  Retriever   │ │
│  │  • Persistence   │  │  • Semantic      │  │  • Layer 1+2 │ │
│  │  • Keywords      │  │  • Hybrid Search │  │  • Token Mgmt│ │
│  │  • Analytics     │  │  • Circuit Break │  │  • LRU Cache │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │  AICategorizatio │  │  MemorySearchAPI │  │  Pattern     │ │
│  │  nService        │  │  • 9 Query Types │  │  Recommender │ │
│  │  • AI Extract    │  │  • Hybrid Search │  │  • Success   │ │
│  │  • Rule Fallback │  │  • Analytics     │  │    Analysis  │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
└─────────────┬──────────────────────────────────────────────────┘
              │
┌─────────────▼──────────────────────────────────────────────────┐
│                     AGENT & ANALYTICS LAYER                      │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │  AgentLoader     │  │  CostCalculator  │  │  Usage       │ │
│  │  • Auto-Discover │  │  • Multi-Model   │  │  Tracker     │ │
│  │  • YAML Agents   │  │  • Cache Savings │  │  • Budget    │ │
│  │  • 28+ Agents    │  │  • Projections   │  │  • Per-Agent │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │  Agent Base      │  │  Usage Reporter  │                    │
│  │  • State Mgmt    │  │  • Daily/Monthly │                    │
│  │  • Messaging     │  │  • CLI Output    │                    │
│  │  • Metrics       │  │  • CSV Export    │                    │
│  └──────────────────┘  └──────────────────┘                    │
└──────────────────────────────────────────────────────────────────┘
```

### Architectural Principles

**1. Hybrid Synchronous + Asynchronous**
- **Lifecycle Hooks** (synchronous): Guaranteed execution for critical operations
- **MessageBus Events** (asynchronous): Optional notifications that don't block

**2. Graceful Degradation**
Every layer has fallback strategies:
- VectorStore → FTS5 → Empty results
- AI Categorization → Rule-based → Skip
- Memory enabled → Memory disabled → Continue

**3. Progressive Disclosure**
Load context in layers to manage token budgets:
- Layer 1: Lightweight index (summaries, IDs)
- Layer 2: Full details (on-demand)

**4. Circuit Breaker Pattern**
Prevent cascade failures from external services (Chroma, Claude API)

**5. Token-First Design**
Every component is aware of token costs and manages budgets

---

## Key Features

### 1. Multi-Agent Orchestration

**5 Proven Collaboration Patterns**:

| Pattern | Purpose | Min Agents | Use Case |
|---------|---------|------------|----------|
| **Parallel** | Execute simultaneously | 2 | Research, comprehensive analysis |
| **Consensus** | Vote on decisions | 3 | Framework selection, approvals |
| **Debate** | Iterative refinement | 2 | Architecture proposals, innovation |
| **Review** | Create/critique/revise | 2 | Code review, document editing |
| **Ensemble** | Combine outputs | 2 | Best-of selection, aggregation |

**Smart Pattern Selection**:
- Automatic detection from natural language prompts
- Confidence-based recommendations
- Historical success rate analysis

### 2. Persistent Memory

**What Gets Remembered**:
- Complete orchestration history (pattern, agents, tasks, results)
- Success/failure patterns
- Agent performance statistics
- Collaboration effectiveness
- Token usage and costs

**Search Capabilities**:
- **Keyword Search**: FTS5 full-text search with BM25 ranking
- **Semantic Search**: Vector similarity via Chroma embeddings
- **Hybrid Search**: Combines both (70% vector, 30% keywords)
- **Filtered Queries**: By agent, pattern, date range, success/failure

**Benefits**:
- Agents learn from past experiences
- Avoid repeating mistakes
- Leverage successful patterns
- Build organizational knowledge

### 3. Intelligence Layer

**Context Retrieval**:
- Progressive disclosure (Layer 1 index + Layer 2 details)
- Token budget management (default: 2000 tokens)
- LRU caching (100 entries, 5min TTL)
- Smart truncation preserving valuable data

**AI-Powered Categorization**:
- Extracts observations, concepts, insights
- 6 categorization types (decision, bugfix, feature, etc.)
- Falls back to rule-based heuristics
- Per-agent insights

**Pattern Recommendation**:
- Analyzes historical success rates
- Recommends optimal patterns
- Suggests agent teams
- Predicts success likelihood

### 4. Usage Analytics

**Cost Tracking**:
- Multi-model pricing (Claude Sonnet 4.5, GPT-4o, o1-preview, etc.)
- Cache token savings (90% discount)
- Per-orchestration costs
- Per-agent and per-pattern breakdowns

**Budget Management**:
- Daily/monthly budget tracking
- Threshold alerts (warning, critical)
- Cost projections
- Real-time monitoring

**Reporting**:
- Daily/monthly usage reports
- Pattern cost analysis
- Agent efficiency rankings
- Billing window reports (5-hour periods)
- CLI-formatted or CSV export

### 5. Agent System

**YAML-Based Agent Format**:
```yaml
---
name: research-analyst
display_name: Research Analyst
model: claude-sonnet-4-5
temperature: 0.7
max_tokens: 8000
capabilities:
  - deep-research
  - competitive-analysis
category: research
phase: research
---

# Agent Instructions
[Markdown instructions...]
```

**Auto-Discovery**:
- Recursively scans `.claude/agents/` directory
- Parses YAML frontmatter
- Infers category from folder structure
- Validates required fields

**Rich Query API**:
- By category, phase, capability, tag, model
- Best match for task criteria
- Agent statistics and metadata

**Current Library**: 28+ specialized agents

### 6. Production Features

**Error Handling**:
- Comprehensive try/catch at every layer
- Graceful degradation on failures
- Retry logic with exponential backoff
- Error hooks for logging

**Monitoring**:
- Hook execution metrics
- Component-specific performance tracking
- Message bus statistics
- Cache hit rates

**Logging**:
- Winston-based structured logging
- Configurable log levels
- Error context preservation
- Performance benchmarks

**Resource Management**:
- Connection pooling (database, vector store)
- LRU caching (context, search results)
- Token budget enforcement
- Memory cleanup

---

## Framework Components

### Core Components (9 components)

| Component | Purpose | Lines | Key Features |
|-----------|---------|-------|--------------|
| **MessageBus** | Event-driven pub/sub | 348 | Supports 100+ agents, request/response |
| **Agent** | Base class for agents | 512 | State management, messaging, history |
| **AgentOrchestrator** | Multi-agent coordination | 791 | 5 patterns, memory integration |
| **LifecycleHooks** | Guaranteed execution points | 366 | Priority-based, sequential pipeline |
| **MemoryStore** | SQLite persistence | 582 | FTS5 search, analytics, WAL mode |
| **MemoryIntegration** | Hybrid hooks + events | 683 | Critical ops, optional notifications |
| **TokenCounter** | Accurate token counting | 245 | Tiktoken, multi-model support |
| **Logger** | Structured logging | 178 | Winston, configurable levels |
| **CLI** | Interactive interface | 423 | Inquirer, rich menus |

### Intelligence Layer (5 components)

| Component | Purpose | Lines | Key Features |
|-----------|---------|-------|--------------|
| **VectorStore** | Semantic search | 962 | Chroma, hybrid search, circuit breaker |
| **ContextRetriever** | Progressive disclosure | 867 | Layer 1+2, token-aware, LRU cache |
| **AICategorizationService** | Observation extraction | 700 | AI + rule-based, 6 types |
| **MemorySearchAPI** | Query interface | 730 | 9 query types, hybrid search |
| **PatternRecommender** | Pattern selection | 640 | Success analysis, predictions |

### Analytics Layer (3 components)

| Component | Purpose | Lines | Key Features |
|-----------|---------|-------|--------------|
| **CostCalculator** | Multi-model pricing | 352 | 5+ models, cache savings |
| **UsageTracker** | Budget tracking | 849 | Per-agent/pattern, alerts |
| **UsageReporter** | Reporting | 730 | Daily/monthly, CLI/CSV export |

### Agent System (2 components)

| Component | Purpose | Lines | Key Features |
|-----------|---------|-------|--------------|
| **AgentLoader** | Auto-discovery | 350 | YAML parsing, rich queries |
| **Agent Format** | YAML + Markdown | N/A | Frontmatter + instructions |

**Total**: 19 production components, ~9,500 lines of code

---

## Orchestration Patterns

### Pattern Selection Guide

**When to use each pattern**:

```
┌─────────────────────────────────────────────────────────────────┐
│ PARALLEL: Independent tasks, multiple perspectives              │
│ Examples: Research, market analysis, risk assessment            │
│ Agents: 2-10 | Speed: Fast | Agreement: Not required            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ CONSENSUS: Democratic decisions, approval workflows             │
│ Examples: Framework selection, architecture approval            │
│ Agents: 3-10 | Speed: Fast | Agreement: Required (threshold)    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ DEBATE: Iterative refinement, challenge proposals               │
│ Examples: Architecture design, strategic planning               │
│ Agents: 2-5 | Speed: Slow (rounds) | Agreement: Convergence     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ REVIEW: Quality assurance, iterative improvement                │
│ Examples: Code review, document editing, design iteration       │
│ Agents: 2-6 | Speed: Slow (rounds) | Agreement: Creator decides │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ ENSEMBLE: Quality selection, output aggregation                 │
│ Examples: Summarization, classification, predictions            │
│ Agents: 2-10 | Speed: Fast | Agreement: Selector decides        │
└─────────────────────────────────────────────────────────────────┘
```

### Pattern Capabilities

**All patterns support**:
- Memory integration (historical context)
- Token tracking and cost calculation
- Retry logic with exponential backoff
- Comprehensive error handling
- Performance metrics
- Custom configuration

**Pattern-specific features**:

**Consensus**:
- 3 voting strategies (majority, weighted, unanimous)
- Configurable threshold (0.5-1.0)
- Per-agent vote weights
- Confidence scoring

**Debate**:
- Configurable rounds (typically 3-5)
- Full debate history tracking
- First agent as synthesizer (customizable)
- Critique + synthesis cycle

**Review**:
- Create → Critique → Revise workflow
- Multiple revision rounds
- Role separation (creator vs reviewers)
- Review history per round

**Ensemble**:
- 3 strategies (best-of, merge, vote)
- Custom selector functions
- All alternatives returned
- Quality-based selection

---

## Intelligence Layer

### Memory Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                    MEMORY INTEGRATION                          │
│                                                                │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  HOOKS (Synchronous - Critical Operations)            │  │
│  │                                                        │  │
│  │  beforeExecution:                                      │  │
│  │    ├─ Load historical context (ContextRetriever)      │  │
│  │    ├─ Search similar orchestrations (VectorStore)     │  │
│  │    └─ Enrich task with memory                         │  │
│  │                                                        │  │
│  │  afterExecution:                                       │  │
│  │    ├─ Save orchestration (MemoryStore)                │  │
│  │    ├─ Track usage/costs (UsageTracker)                │  │
│  │    └─ Update statistics                               │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                                │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  EVENTS (Asynchronous - Optional Operations)          │  │
│  │                                                        │  │
│  │  execution:complete:                                   │  │
│  │    ├─ Vectorize for semantic search (VectorStore)     │  │
│  │    ├─ AI categorization (AICategorizationService)     │  │
│  │    └─ Analytics updates                               │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

### Search Capabilities

**1. Keyword Search (FTS5)**:
- Full-text search with BM25 ranking
- Fast (<1ms typical)
- Exact term matching
- No external dependencies

**2. Semantic Search (Chroma)**:
- Vector similarity matching
- Understands meaning and context
- Finds conceptually similar content
- ~100ms typical

**3. Hybrid Search** (Default):
- Combines vector (70%) + keywords (30%)
- Best of both approaches
- Weighted score merging
- Graceful fallback to FTS5 only

**4. Filtered Queries**:
- By agent IDs
- By pattern types
- By date range
- By success/failure
- By concepts/tags

### Context Loading

**Progressive Disclosure**:

**Layer 1** (Index - Lightweight):
- Orchestration IDs
- Brief summaries
- Relevance scores
- Timestamp metadata
- ~5-10 tokens per item

**Layer 2** (Details - On-Demand):
- Full orchestration records
- Complete observations
- Result summaries
- Agent insights
- ~100-500 tokens per item

**Benefits**:
- Faster initial queries
- Lower token costs
- Load details only when needed
- Better scalability

**Token Budget Management**:
- Default: 2000 tokens
- Configurable per query
- 20% safety buffer
- Smart truncation (preserves valuable data)

### AI Categorization

**Extraction Process**:
1. Analyze orchestration result
2. Extract key observations
3. Categorize by type (decision/bugfix/feature/etc.)
4. Identify important concepts
5. Generate agent-specific insights
6. Assign importance score (1-10)

**Categorization Types**:
- `decision`: Strategic choices made
- `bugfix`: Bug resolution
- `feature`: New functionality added
- `pattern-usage`: Multi-agent pattern application
- `discovery`: New insight or learning
- `refactor`: Code improvement

**Fallback Strategy**:
- Try Claude API first (claude-3-5-sonnet)
- Fall back to rule-based keyword matching
- Skip if both fail (graceful)
- Quality indicator in output

---

## Agent System

### Agent Directory Structure

```
.claude/agents/
├── research/
│   ├── research-analyst.md
│   ├── competitive-analyst.md
│   ├── trend-analyst.md
│   └── tech-evaluator.md
├── planning/
│   ├── strategic-planner.md
│   ├── logic-reviewer.md
│   └── roadmap-planner.md
├── design/
│   ├── system-architect.md
│   ├── technical-designer.md
│   └── api-designer.md
├── development/
│   ├── senior-developer.md
│   ├── code-assistant.md
│   └── backend-specialist.md
├── testing/
│   ├── test-engineer.md
│   ├── quality-analyst.md
│   └── e2e-tester.md
└── validation/
    ├── review-orchestrator.md
    ├── code-reviewer.md
    └── security-auditor.md
```

### Agent Format Example

```yaml
---
# Required Fields
name: research-analyst
display_name: Research Analyst

# Model Configuration
model: claude-sonnet-4-5
temperature: 0.7
max_tokens: 8000

# Capabilities & Classification
capabilities:
  - deep-research
  - competitive-analysis
  - risk-assessment
category: research
phase: research
priority: high

# Tools Available to Agent
tools:
  - Read
  - Grep
  - WebSearch
  - WebFetch

# Tags for Discovery
tags:
  - analysis
  - research
  - strategy
---

# Research Analyst Agent

## Role
Deep technology research and competitive analysis specialist.

## Expertise
- Comprehensive technology analysis
- Competitive landscape assessment
- Risk identification and mitigation
- Alternative approach evaluation

## Instructions
[Detailed markdown instructions for the agent...]
```

### Agent Discovery

**Auto-Discovery Process**:
1. Recursively walk `.claude/agents/` directory
2. Find all `.md` files
3. Parse YAML frontmatter
4. Extract instructions (content after frontmatter)
5. Infer category from folder structure
6. Validate required fields
7. Register with metadata indexes

**Query Examples**:
```javascript
// By category
loader.getAgentsByCategory('research')

// By phase
loader.getAgentsByPhase('implementation')

// By capability
loader.getAgentsByCapability('code-generation')

// By tag
loader.getAgentsByTag('architecture')

// By model
loader.getAgentsByModel('claude-sonnet-4-5')

// Best match
loader.getBestAgentForTask({
  type: 'research',
  complexity: 'high',
  phase: 'planning'
})
```

### Current Agent Inventory

**Total**: 28+ specialized agents

**Categories**:
- **Research** (6 agents): Deep analysis, competitive intelligence, trends
- **Planning** (4 agents): Strategy, roadmaps, logic validation
- **Design** (5 agents): Architecture, API design, data modeling
- **Development** (6 agents): Implementation, debugging, optimization
- **Testing** (4 agents): Unit, integration, E2E, performance
- **Validation** (3 agents): Code review, quality assurance, security

## Skills Framework

### What is the Skills Framework?

The Skills Framework provides **reusable knowledge modules** that can be automatically activated when relevant to a task. Skills are markdown documents containing domain-specific best practices, code examples, and guidelines that enhance agent capabilities.

**Key Concepts**:
- **Skills**: Markdown documents with specialized knowledge (API testing, TypeScript, Docker, etc.)
- **Auto-Activation** (Planned): Skills automatically activate based on task relevance
- **Context Enhancement**: Loaded skills provide agents with domain expertise
- **Extensible**: Easy to add new skills for any domain

### Skills Architecture

```
.claude/skills/
├── testing/
│   └── api-testing.md           # REST/GraphQL testing patterns
├── development/
│   └── typescript-guide.md      # TypeScript best practices
└── deployment/
    └── docker-deployment.md     # Docker containerization
```

### Current Skills Library

**1. API Testing** (`.claude/skills/testing/api-testing.md`)
- REST API testing patterns (GET, POST, PUT, PATCH, DELETE)
- GraphQL testing with queries and mutations
- Authentication methods (Bearer tokens, API keys, OAuth2)
- Error handling and validation
- Testing best practices and common patterns

**2. TypeScript Guide** (`.claude/skills/development/typescript-guide.md`)
- Basic and advanced types
- Interfaces, classes, and generics
- Utility types (Partial, Required, Pick, Omit, etc.)
- Type guards and narrowing
- TypeScript best practices
- Common patterns and anti-patterns

**3. Docker Deployment** (`.claude/skills/deployment/docker-deployment.md`)
- Dockerfile creation and optimization
- Multi-stage builds
- Docker Compose for multi-container apps
- Environment configuration
- Security best practices
- Production deployment strategies

### How Skills Work

**Planned Auto-Activation**:
When a user prompt mentions relevant keywords, the system will automatically load corresponding skills:

```
User: "Help me test my REST API endpoints"
→ Auto-loads: .claude/skills/testing/api-testing.md

User: "Write TypeScript interfaces for my data models"
→ Auto-loads: .claude/skills/development/typescript-guide.md

User: "Containerize this application with Docker"
→ Auto-loads: .claude/skills/deployment/docker-deployment.md
```

**Manual Activation**:
Skills can be manually referenced in agent configurations:

```yaml
---
name: api-tester
display_name: API Testing Specialist
capabilities:
  - api-testing
skills:
  - testing/api-testing.md    # Load this skill automatically
---
```

### Skills vs Agents

| Aspect | Skills | Agents |
|--------|--------|--------|
| **Nature** | Knowledge modules | Task executors |
| **Activity** | Passive (loaded as context) | Active (perform work) |
| **Reusability** | Used across multiple agents | Single role/responsibility |
| **Content** | Best practices, examples, patterns | Instructions, orchestration logic |

### Creating Custom Skills

**Skill Format**:
````markdown
# Skill Name

Brief description of what this skill provides.

## Core Concepts

Explanation of key concepts...

## Best Practices

### Practice 1
- Description
- When to use
```javascript
// Code example
```

## Common Patterns

### Pattern 1
```javascript
// Implementation example
```

## Anti-Patterns

What NOT to do and why...

## References

Links to documentation, articles, etc.
````

**Adding New Skills**:
1. Create markdown file in appropriate category (`.claude/skills/category/`)
2. Follow skill format template
3. Include code examples and best practices
4. Skills are automatically discovered (when auto-activation implemented)

**Skill Categories**:
- `testing/` - Testing strategies and patterns
- `development/` - Programming languages and frameworks
- `deployment/` - Infrastructure and DevOps
- `security/` - Security best practices (planned)
- `architecture/` - Design patterns (planned)
- `data/` - Data modeling and databases (planned)

### Future Skills Roadmap

**Planned Skills**:
- **Security Auditing** (`security/security-audit.md`)
- **Performance Optimization** (`development/performance-optimization.md`)
- **Database Design** (`data/database-design.md`)
- **React Patterns** (`development/react-patterns.md`)
- **Kubernetes Deployment** (`deployment/kubernetes.md`)
- **CI/CD Pipelines** (`deployment/cicd-pipelines.md`)
- **AWS Best Practices** (`deployment/aws-deployment.md`)
- **Code Review Guidelines** (`development/code-review.md`)

### Benefits of Skills Framework

**1. Knowledge Reuse**:
- Write once, use across all agents
- Consistent best practices
- Easier to maintain and update

**2. Enhanced Agent Capabilities**:
- Agents gain domain expertise instantly
- No need to retrain or reconfigure
- Modular knowledge composition

**3. Extensibility**:
- Easy to add new domains
- Community can contribute skills
- Supports any markdown content

**4. Context Efficiency**:
- Load only relevant skills
- Skills cached and reused
- Token-efficient knowledge transfer

**5. Developer Experience**:
- Familiar markdown format
- Easy to read and update
- Version controlled with code

---

---

## Learning Systems

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

## Usage Analytics

### Cost Tracking

**Supported Models**:

| Model | Input ($/1M) | Output ($/1M) | Cache Create | Cache Read |
|-------|--------------|---------------|--------------|------------|
| Claude Sonnet 4.5 | $3.00 | $15.00 | $3.75 | $0.30 |
| Claude Sonnet 4 | $3.00 | $15.00 | $3.75 | $0.30 |
| Claude Opus 4 | $15.00 | $75.00 | $18.75 | $1.50 |
| GPT-4o | $5.00 | $15.00 | N/A | N/A |
| o1-preview | $15.00 | $60.00 | N/A | N/A |

**Cache Savings**:
- Claude models offer 90% discount on cache reads
- Significant savings on repeated context
- Automatic calculation in UsageTracker

### Budget Management

**Features**:
- Daily/monthly budget limits
- Per-agent cost tracking
- Per-pattern cost tracking
- Real-time session monitoring
- Threshold alerts (warning, critical)
- Automatic cleanup of old records

**Alert Levels**:
- **Warning**: 80% of budget consumed
- **Critical**: 95% of budget consumed
- Configurable thresholds

### Reporting

**Report Types**:

**1. Daily Usage Report**:
- Total tokens and cost
- Per-agent breakdown
- Per-pattern breakdown
- Top consumers
- Hourly distribution

**2. Monthly Usage Report**:
- Monthly totals
- Daily trend analysis
- Budget status
- Cost projections
- Top agents/patterns

**3. Pattern Cost Analysis**:
- Cost per pattern type
- Average orchestration cost
- Efficiency metrics
- Success rate correlation

**4. Agent Cost Analysis**:
- Cost per agent
- Agent rankings
- Usage frequency
- Efficiency scores

**5. Billing Window Report**:
- 5-hour billing periods (like ccusage)
- Per-window costs
- Peak usage times

**Output Formats**:
- CLI-formatted (human-readable)
- JSON (programmatic access)
- CSV (spreadsheet import)

---

## Design Philosophy

### 1. Reliability Over Features

**Principle**: Critical operations must complete; optional features shouldn't block.

**Implementation**:
- Lifecycle hooks for guaranteed execution
- MessageBus events for optional notifications
- Graceful degradation at every layer
- Comprehensive error handling

**Example**:
- Memory save uses hooks (guaranteed)
- AI categorization uses events (optional)
- System continues even if AI categorization fails

### 2. Progressive Enhancement

**Principle**: Start simple, add intelligence over time.

**Layers**:
1. **Base**: Orchestration without memory
2. **Memory**: Add persistent storage
3. **Search**: Add FTS5 keyword search
4. **Semantic**: Add vector search
5. **AI**: Add intelligent categorization
6. **Analytics**: Add cost tracking

Each layer is optional and independent.

### 3. Token-First Design

**Principle**: Every component aware of token costs.

**Features**:
- Token budget enforcement
- Progressive disclosure (Layer 1 + 2)
- Smart truncation
- Cache optimization
- Cost tracking

**Example**:
- Context retriever respects token budgets
- Loads index first (cheap)
- Loads details on-demand (expensive)
- Always stays within budget

### 4. Developer Experience

**Principle**: Make the right thing easy, the wrong thing hard.

**Design Choices**:
- Memory enabled by default (opt-out)
- Auto-discovery of agents
- Smart pattern selection
- Comprehensive error messages
- Rich logging and metrics

**Example**:
- Don't manually register agents
- Don't manually select patterns
- Don't manually track costs
- Framework handles it automatically

### 5. Production Ready

**Principle**: Built for real-world deployment, not just demos.

**Features**:
- Comprehensive test coverage (96%+)
- Resource management (pooling, caching)
- Monitoring and observability
- Graceful degradation
- Security considerations

**Example**:
- Circuit breakers prevent cascade failures
- Retry logic with exponential backoff
- Connection pooling for databases
- LRU caching for performance

---

## Getting Started

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/multi-agent-framework.git
cd multi-agent-framework

# Install dependencies
npm install

# Run tests
npm test

# Run demo
npm run demo
```

### Basic Usage

```javascript
const MessageBus = require('./.claude/core/message-bus');
const AgentOrchestrator = require('./.claude/core/agent-orchestrator');

// Create components
const messageBus = new MessageBus();
const orchestrator = new AgentOrchestrator(messageBus, {
  enableMemory: true,  // Optional: enable persistent memory
  dbPath: '.claude/memory/orchestrations.db'
});

// Load agents
const loader = new AgentLoader('.claude/agents');
const agents = loader.getAgentsByCategory('research');

// Register agents
agents.forEach(agent => orchestrator.registerAgent(agent));

// Execute pattern
const result = await orchestrator.executeParallel(
  ['research-analyst', 'competitive-analyst'],
  {
    type: 'analyze',
    topic: 'AI development frameworks 2025'
  }
);

console.log('Results:', result.results);
console.log('Cost:', result.usage?.totalCost);
```

### Intelligent Orchestration

```javascript
const IntelligentOrchestrator = require('./.claude/core/intelligent-orchestrator');

const orchestrator = new IntelligentOrchestrator(messageBus);

// Natural language pattern selection
const result = await orchestrator.execute(
  'Research this topic from multiple expert perspectives',
  ['research-analyst', 'trend-analyst', 'tech-evaluator'],
  { topic: 'Quantum computing applications' }
);

// Framework automatically:
// 1. Detected 'parallel' pattern (confidence: 0.88)
// 2. Loaded relevant historical context
// 3. Executed agents in parallel
// 4. Saved results to memory
// 5. Tracked costs
```

### Configuration

```javascript
const orchestrator = new AgentOrchestrator(messageBus, {
  // Memory Options
  enableMemory: true,
  dbPath: '.claude/memory/orchestrations.db',

  // Intelligence Options
  enableAI: false,  // AI categorization (requires API key)
  contextTokenBudget: 2000,  // Max tokens for context

  // Analytics Options
  enableCostTracking: true,
  dailyBudget: 10.00,  // USD
  monthlyBudget: 200.00,  // USD

  // Performance Options
  retryAttempts: 3,
  retryDelay: 1000,  // ms
  timeout: 60000,  // ms per agent
});
```

---

## Use Cases

### 1. Research & Analysis

**Scenario**: Comprehensive market research on emerging technologies

**Pattern**: Parallel

**Agents**:
- Research Analyst (deep analysis)
- Competitive Analyst (competitive landscape)
- Trend Analyst (market trends)
- Tech Evaluator (technical assessment)

**Workflow**:
1. Load historical research on similar topics
2. Execute all agents in parallel
3. Each provides unique perspective
4. Synthesize findings
5. Save to memory for future reference

**Benefits**:
- 4x faster than sequential
- Comprehensive coverage
- Diverse perspectives
- Builds knowledge base

### 2. Architecture Decisions

**Scenario**: Select authentication framework for new application

**Pattern**: Consensus

**Agents**:
- System Architect (overall design)
- Security Expert (security implications)
- Performance Expert (performance impact)
- Developer (implementation complexity)

**Workflow**:
1. Present options (OAuth2, JWT, SAML)
2. Each agent evaluates based on expertise
3. Weighted voting (security expert = 2x weight)
4. Reach consensus with 70% threshold
5. Record decision and rationale

**Benefits**:
- Democratic decision-making
- Expert input valued appropriately
- Clear decision trail
- Documented rationale

### 3. Code Review

**Scenario**: Review and improve pull request implementation

**Pattern**: Review

**Agents**:
- Senior Developer (creator)
- Tech Lead (reviewer)
- QA Engineer (reviewer)

**Workflow**:
1. Developer implements feature
2. Tech Lead + QA review in parallel
3. Provide feedback
4. Developer revises based on feedback
5. Second review round if needed
6. Approve when quality met

**Benefits**:
- Structured review process
- Multiple perspectives
- Iterative improvement
- Quality gates enforced

### 4. Strategic Planning

**Scenario**: Develop product roadmap for next quarter

**Pattern**: Debate

**Agents**:
- Strategic Planner (overall strategy)
- Market Analyst (market insights)
- Tech Lead (technical feasibility)

**Workflow**:
1. Initial roadmap proposal
2. Round 1: Critique and identify gaps
3. Synthesize improvements
4. Round 2: Challenge assumptions
5. Synthesize refinements
6. Round 3: Final validation
7. Approved roadmap

**Benefits**:
- Rigorous vetting
- Challenges assumptions
- Identifies risks early
- High-quality output

### 5. Content Generation

**Scenario**: Generate product documentation

**Pattern**: Ensemble

**Agents**:
- Technical Writer (variant 1)
- Developer Advocate (variant 2)
- Product Manager (variant 3)

**Workflow**:
1. All agents write documentation
2. Evaluate based on quality metrics
3. Select best version (most comprehensive)
4. Return alternatives for comparison

**Benefits**:
- Multiple attempts
- Quality-based selection
- Reduced uncertainty
- Best output guaranteed

---

## Performance & Scalability

### Performance Metrics

**Component Performance**:

| Component | Operation | Avg Time | Notes |
|-----------|-----------|----------|-------|
| VectorStore | searchSimilar() | <100ms | With Chroma |
| VectorStore | addOrchestration() | <50ms | Async processing |
| ContextRetriever | retrieveContext() | <200ms | Cached queries |
| ContextRetriever | loadLayer1() | <50ms | Cached, <150ms uncached |
| AICategorizationService | AI categorize | <2s | Claude API |
| AICategorizationService | Rule-based | <1ms | Local processing |
| MemoryStore | searchOrchestrations() | <10ms | FTS5 search |
| MessageBus | publish() | <1ms | In-memory |

**System Performance**:
- **Parallel Pattern**: ~1-2s overhead (context loading + saving)
- **Memory Overhead**: ~15MB (database + caches)
- **Token Budget**: 2000 tokens default (~$0.006 per execution)
- **Cache Hit Rate**: >70% after warmup

### Scalability

**Horizontal Scalability**:
- MessageBus supports 100+ concurrent agents
- SQLite WAL mode enables concurrent reads
- Vector store handles 10,000+ embeddings
- LRU caches prevent memory growth

**Vertical Scalability**:
- Token budget adjustable per execution
- Context loading respects token limits
- Progressive disclosure reduces memory usage
- Cleanup policies prevent unbounded growth

**Production Deployment**:
- SQLite database (single file, easy backup)
- Optional Chroma server (Docker container)
- No external dependencies required
- Easy horizontal scaling (multiple processes)

### Optimization Tips

**1. Tune Token Budgets**:
```javascript
// Low-context task (fast, cheap)
contextTokenBudget: 500

// High-context task (slower, expensive)
contextTokenBudget: 5000
```

**2. Disable Optional Features**:
```javascript
// Skip AI categorization (faster)
enableAI: false

// Skip vector search (FTS5 only)
vectorStore: null
```

**3. Adjust Cache Settings**:
```javascript
// More aggressive caching
contextRetriever: new ContextRetriever(memoryStore, vectorStore, {
  cacheSize: 500,      // More entries
  cacheTTL: 3600000    // 1 hour TTL
})
```

**4. Batch Operations**:
```javascript
// Process multiple tasks in one orchestration
await orchestrator.executeParallel(
  agentIds,
  { type: 'batch', tasks: [task1, task2, task3] }
)
```

---

## Further Reading

### Documentation

- **[Framework Components Guide](FRAMEWORK-COMPONENTS-GUIDE.md)** - Detailed component reference
- **[Interaction Patterns Guide](INTERACTION-PATTERNS-GUIDE.md)** - Usage patterns and examples
- **[API Reference](API-REFERENCE.md)** - Complete API documentation
- **[Multi-Agent Guide](MULTI-AGENT-GUIDE.md)** - Comprehensive usage guide
- **[Development Roadmap](ROADMAP.md)** - Implementation roadmap

### Architecture Documents

- **[Intelligence Layer Architecture](INTELLIGENCE-LAYER-ARCHITECTURE.md)** - Intelligence layer design
- **[Hooks vs MessageBus Research](HOOKS-VS-MESSAGEBUS-RESEARCH-SYNTHESIS.md)** - Hybrid architecture rationale
- **[Usage Analytics Architecture](USAGE-ANALYTICS-ARCHITECTURE.md)** - Analytics system design

### Examples

- **[Orchestration Demo](../examples/orchestration-demo.js)** - All 5 patterns demonstrated
- **[Memory Integration Demo](../examples/memory-integration-demo.js)** - Memory system usage
- **[Intelligent Orchestration Demo](../examples/intelligent-orchestration-demo.js)** - Smart pattern selection

### Source Code

- **Core**: `.claude/core/` - All framework components
- **Agents**: `.claude/agents/` - 28+ specialized agents
- **Tests**: `__tests__/` - Comprehensive test suite
- **Scripts**: `scripts/` - CLI tools and utilities

---

## Support & Community

### Getting Help

- **GitHub Issues**: Report bugs and request features
- **Documentation**: Comprehensive guides and references
- **Examples**: Working demos and use cases
- **Tests**: 96%+ coverage demonstrates usage

### Contributing

Contributions welcome! See areas:
- Additional agents (`.claude/agents/`)
- New orchestration patterns
- Performance optimizations
- Documentation improvements
- Bug fixes

### License

MIT License - Free to use for any project.

---

**Version**: 1.0.0
**Last Updated**: 2025-11-09
**Maintained By**: Multi-Agent Framework Team
