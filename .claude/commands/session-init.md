---
description: Initialize session with intelligent phase detection and context loading
---

# Session Initialization

Run the intelligent phase management system to detect the appropriate phase and load relevant context.

## Usage

```
/session-init [optional: task description]
```

## Examples

```
/session-init Implement user authentication
/session-init Plan the next sprint
/session-init Research database options
/session-init
```

## What This Does

1. **Analyzes your task** (if provided) to automatically detect the appropriate phase
2. **Loads relevant context** from project state (artifacts, decisions, quality scores)
3. **Generates optimized prompt** with <1000 tokens
4. **Updates PROJECT_SUMMARY.md** with current state

## When to Use

✅ **Use `/session-init` when**:
- Starting work on a new task that might need a different phase
- You want explicit phase inference and reasoning
- You need fresh context about recent artifacts
- Beginning a major new feature or refactoring

✅ **Skip `/session-init` when**:
- Continuing work in current phase
- PROJECT_SUMMARY.md already has what you need
- Making small incremental changes

## Behind the Scenes

This command executes:
```bash
node scripts/session-bootstrap.js "your task description"
```

And presents you with:
- **Target Phase**: Recommended phase (research/planning/design/implementation/testing/validation/iteration)
- **Agent**: Appropriate agent persona for that phase
- **Confidence**: How confident the system is (0-100%)
- **Reasoning**: Why this phase was selected
- **Context**: Recent artifacts, decisions, next actions

## Output Example

```
📍 Target Phase: implementation
🤖 Agent: Senior Developer (Claude Sonnet 4)
💯 Confidence: 94%

📝 Task: "Implement user authentication"

💭 Reasoning: Task suggests implementation phase based on keywords:
implement, user, authentication. Quality gate passed (design: 90/100).

## Recent Work
- design/api-spec.md: RESTful endpoints for authentication
- design/database-schema.sql: User table with security fields
- research/auth-libraries.md: Evaluated Passport.js and JWT

## Next Actions
1. Implement JWT token generation
2. Create middleware for protected routes
3. Write unit tests for auth module

📊 Token Usage: 847 tokens
```

## How It Works

### Phase Detection

The system uses keyword analysis to detect phases:

| Keywords | Detected Phase |
|----------|----------------|
| research, analyze, investigate, evaluate | research |
| plan, roadmap, timeline, estimate | planning |
| design, architecture, schema, api | design |
| implement, code, build, develop | implementation |
| test, verify, validate, coverage | testing |
| review, quality gate, approve | validation |
| improve, refactor, optimize, fix | iteration |

**Confidence scoring** based on:
- Keyword matches (stronger = higher confidence)
- Context from current phase
- Quality gate validation
- Recent artifact patterns

### Transition Validation

Before recommending a phase change, the system checks:
- ✅ Is the transition valid? (forward requires quality gate pass)
- ✅ Are quality gates met for current phase?
- ✅ Are there blockers preventing transition?

**If transition is invalid**, you'll get a warning:
```
⚠️ Cannot proceed to testing. Current quality: 75/100.
Required: 90/100

Complete these tasks first:
- All tests must pass
- Security review needed
```

## Token Optimization

This command achieves **85% token savings** through:
- Prompt caching (bootstrap.md cached)
- Smart artifact summarization
- Sliding window (last 5 artifacts only)
- Priority-based loading

**Traditional approach**: 7000 tokens
**With `/session-init`**: 850-1000 tokens

## Troubleshooting

### "Phase detection seems wrong"

Check the reasoning output. If confidence is <70%, the task might be ambiguous. Try:
```
/session-init --phase=correct-phase Your task description
```

### "Context is stale"

Run `/session-init` without arguments to refresh:
```
/session-init
```

### "Session context too large"

The system automatically trims to <1000 tokens. If issues persist, check:
```bash
node -e "const SI = require('./.claude/core/session-init'); console.log(new SI(process.cwd()).getStatus());"
```

## Integration with Workflow

### After creating artifacts:
```javascript
const SessionInitializer = require('./.claude/core/session-init');
const sessionInit = new SessionInitializer(process.cwd());
sessionInit.recordArtifact('path/to/file.js', 'implementation');
```

### After making decisions:
```javascript
sessionInit.recordDecision(
  'Use PostgreSQL for data storage',
  'Better suited for relational data with ACID compliance',
  'System Architect'
);
```

### Check quality scores:
```javascript
const status = sessionInit.getStatus();
console.log('Current quality:', status.qualityScores[status.currentPhase]);
```

## Technical Details

For implementation details, see:
- `.claude/core/session-init.js` - Session orchestrator
- `.claude/core/phase-inference.js` - Phase detection engine
- `.claude/core/context-loader.js` - Context assembly
- `scripts/session-bootstrap.js` - CLI wrapper

---

**Pro tip**: You rarely need to run `/session-init` manually. PROJECT_SUMMARY.md (auto-loaded) provides sufficient context for most work. Use `/session-init` when starting significant new tasks or when you want explicit phase guidance.
