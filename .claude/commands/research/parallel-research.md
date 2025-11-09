---
description: Run parallel research on multiple approaches simultaneously
---

# Parallel Research

Execute multiple research approaches in parallel to accelerate decision-making by 5x.

## Usage

```
/research-parallel <research-question> [options]
```

## Examples

```bash
# Research state management libraries
/research-parallel "Best state management library for React 2025" --approaches "Redux,Zustand,Jotai"

# Research database options
/research-parallel "Which database for social media app?" --approaches "PostgreSQL,MongoDB,Cassandra" --depth deep

# Research deployment strategies
/research-parallel "Kubernetes vs Docker Swarm vs ECS" --depth quick
```

## Options

- `--approaches` - Comma-separated list of approaches to research (auto-detected if not provided)
- `--depth` - Research depth: `quick` (5min), `medium` (15min), `deep` (30min)
- `--agents` - Number of parallel agents (default: 3, max: 5)
- `--format` - Output format: `markdown` (default), `json`, `comparison-table`

## How It Works

### 1. Approach Detection (if not specified)

The system analyzes your research question and identifies 3-5 viable approaches:

**Example:** "Best authentication library for Node.js"
- Detected approaches: Passport.js, Auth0, JWT from scratch, OAuth2orize, Keycloak

### 2. Parallel Agent Spawn

For each approach, spawns a specialized research agent:

```
Agent 1 (Research Analyst) → Passport.js
  - Community adoption
  - Documentation quality
  - Recent updates
  - Integration examples

Agent 2 (Research Analyst) → Auth0
  - Pricing model
  - Feature set
  - Enterprise support
  - Migration path

Agent 3 (Research Analyst) → JWT from scratch
  - Development effort
  - Security considerations
  - Flexibility
  - Maintenance burden
```

### 3. Simultaneous Execution

All agents run in parallel (not sequential):

```
Traditional (Serial):     ████ ████ ████      (90 minutes)
Parallel (5x faster):     ████                (18 minutes)
```

### 4. Result Synthesis

Automatically combines findings into structured comparison:

## Output Format

### Comparison Table

```markdown
| Criteria          | Redux      | Zustand    | Jotai      |
|-------------------|------------|------------|------------|
| Learning Curve    | Steep      | Easy       | Easy       |
| Bundle Size       | 11.2 KB    | 1.1 KB     | 3.2 KB     |
| Performance       | Good       | Excellent  | Excellent  |
| DevTools          | Excellent  | Good       | Good       |
| Community         | Excellent  | Growing    | Growing    |
| TypeScript        | Excellent  | Excellent  | Excellent  |
| **Recommendation**| Enterprise | Small/Med  | Modern Apps|
```

### Detailed Findings

For each approach:
- **Pros**: Key advantages
- **Cons**: Limitations and drawbacks
- **Use Cases**: Best fit scenarios
- **Migration**: From current setup
- **Resources**: Official docs, tutorials, examples

### Final Recommendation

Based on your specific context (project size, team experience, requirements):

```
🏆 Recommended: Zustand

Reasoning:
1. Smallest learning curve for team
2. Minimal bundle size impact
3. Excellent TypeScript support
4. Growing community and ecosystem
5. Easy migration from Redux if needed

⚠️ Consider Redux if:
- Enterprise-scale application
- Need mature DevTools ecosystem
- Team already familiar with Redux patterns
```

## Advanced Usage

### Custom Research Criteria

```bash
/research-parallel "Best CI/CD tool" \
  --approaches "GitHub Actions,GitLab CI,CircleCI" \
  --criteria "cost,speed,features,integrations" \
  --weight "cost=high,speed=medium"
```

### Domain-Specific Research

```bash
# Backend frameworks
/research-parallel "Node.js backend framework" \
  --domain backend \
  --approaches "Express,Fastify,NestJS,Hapi"

# Frontend libraries
/research-parallel "React component library" \
  --domain frontend \
  --approaches "MUI,Chakra UI,Ant Design,Tailwind+Headless"
```

### Team Context

```bash
/research-parallel "State management" \
  --team-size 5 \
  --team-experience junior \
  --project-complexity medium
```

## Time Savings

### Traditional Approach (Serial)
```
Research Option 1:  30 min
Research Option 2:  30 min
Research Option 3:  30 min
Comparison:         15 min
Decision:           15 min
─────────────────────────
Total:              120 min (2 hours)
```

### Parallel Research (This Command)
```
Parallel Research:  20 min (all options simultaneously)
Comparison:         5 min (auto-generated)
Decision:           5 min (with clear recommendation)
─────────────────────────
Total:              30 min (4x faster)
```

## Integration with Memory

All research is stored in the memory system:

- **Vector Search**: Find similar past research
- **Pattern Learning**: Improve recommendations over time
- **Team Knowledge**: Share findings across projects

## Behind the Scenes

This command uses:

1. **AgentOrchestrator** - Parallel agent execution
2. **Research Agents** - Specialized research personas (22 available)
3. **VectorStore** - Semantic search for past research
4. **MemoryStore** - Persistent research history
5. **Synthesis Agent** - Combines findings into comparison

## Configuration

Create `.claude/research-config.json`:

```json
{
  "parallelResearch": {
    "maxAgents": 5,
    "defaultDepth": "medium",
    "defaultFormat": "markdown",
    "autoDetectApproaches": true,
    "storeResults": true,
    "synthesisAgent": "research-synthesizer"
  }
}
```

## See Also

- `/research-synthesize` - Combine existing research findings
- `/research-compare` - Compare two specific options in depth
- `/research-history` - View past research and decisions

---

**Pro Tip**: Use this for any "which X should I use?" decision. The 5x speedup compounds over multiple decisions in a project.
