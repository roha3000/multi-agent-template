# Auto-Delegation Integration Architecture

**Created**: 2025-12-29
**Status**: Design Complete
**Author**: Expert Agent Ensemble (5 agents)
**Related Documents**:
- AUTO-DELEGATION-UX-DESIGN.md
- AUTO-DELEGATION-TESTING-STRATEGY.md
- AUTO-DELEGATION-CONTROL-INTERFACE.md

---

## Executive Summary

This document presents the architecture for integrating the existing DelegationDecider and hierarchy system with Claude Code's prompt flow. After multi-agent research and analysis, **we recommend a Hook-based approach** as the primary integration mechanism.

---

## 1. The Gap We're Bridging

### Current State

```
┌─────────────────────────────────────────────────────────────────┐
│                         CURRENT FLOW                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User Prompt ──► Claude Code ──► Direct Execution               │
│                      │                                          │
│                      └─► Manual Task tool usage (ad-hoc)        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ UNUSED INFRASTRUCTURE                                    │   │
│  │                                                          │   │
│  │  DelegationDecider ────► NOT CONNECTED                   │   │
│  │  TaskDecomposer ───────► NOT CONNECTED                   │   │
│  │  AgentOrchestrator ────► NOT CONNECTED                   │   │
│  │  HierarchyManager ─────► NOT CONNECTED                   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Target State

```
┌─────────────────────────────────────────────────────────────────┐
│                         TARGET FLOW                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User Prompt                                                    │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ USER-PROMPT-SUBMIT HOOK                                  │   │
│  │                                                          │   │
│  │  1. Intercept prompt                                     │   │
│  │  2. Call DelegationDecider.shouldDelegate()              │   │
│  │  3. Inject delegation hint into context                  │   │
│  └──────────────────────────┬──────────────────────────────┘   │
│                             │                                   │
│                             ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ CLAUDE CODE (with delegation hint)                       │   │
│  │                                                          │   │
│  │  If hint.shouldDelegate AND mode != 'disabled':          │   │
│  │    → Use Task tool with delegation pattern               │   │
│  │    → AgentOrchestrator manages execution                 │   │
│  │  Else:                                                   │   │
│  │    → Execute directly as usual                           │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Integration Approaches Evaluated

### Approach A: Claude Code Hooks (RECOMMENDED)

**How it works**: Claude Code supports custom hooks via `.claude/settings.json`:

```json
{
  "hooks": {
    "user-prompt-submit": [
      {
        "type": "command",
        "command": "node scripts/delegation-hook.js"
      }
    ]
  }
}
```

**Hook types available**:
- `user-prompt-submit` - Runs when user submits a prompt (PERFECT FOR THIS)
- `PreToolUse` - Runs before any tool invocation
- `PostToolUse` - Runs after tool invocation
- `Notification` - For status updates
- `Stop` - For cleanup

**Pros**:
- Native Claude Code integration
- Runs before LLM processes prompt
- Can inject context into the conversation
- Non-blocking (hook output becomes part of context)
- Survives Claude Code updates

**Cons**:
- Limited to stdout/stderr communication
- Cannot modify the prompt directly (only add context)
- Requires external script to run

### Approach B: Skills Integration

**How it works**: Create a `/auto-delegate` skill that wraps task execution.

**Pros**:
- Full Claude Code capabilities
- Can use all tools
- Rich interaction

**Cons**:
- Requires explicit invocation
- Not automatic
- Doesn't intercept prompts

### Approach C: CLAUDE.md Instructions

**How it works**: Add explicit instructions to always consult DelegationDecider.

**Pros**:
- No code changes
- Immediate implementation

**Cons**:
- Relies on LLM following instructions
- Token overhead on every prompt
- Not guaranteed to execute

### Approach D: MCP Server

**How it works**: Run DelegationDecider as an MCP server with tools.

**Pros**:
- Clean separation
- Can expose multiple tools
- Standard protocol

**Cons**:
- Overhead of another server
- Requires MCP configuration
- Not automatic

---

## 3. Recommendation: Hybrid Hook + Skill Approach

Based on the agent research, we recommend a **hybrid approach**:

### Primary: User-Prompt-Submit Hook

The hook runs on every prompt and injects delegation analysis:

```javascript
// scripts/delegation-hook.js
const { DelegationDecider } = require('../.claude/core/delegation-decider');
const { TaskManager } = require('../.claude/core/task-manager');

async function analyzePrompt(prompt) {
  const decider = new DelegationDecider();
  const taskManager = new TaskManager();

  // Check if prompt references a tasks.json task
  const taskMatch = prompt.match(/task[:\s]+([a-z0-9-]+)/i);
  let task = taskMatch
    ? await taskManager.getTask(taskMatch[1])
    : { title: prompt, description: prompt };

  // Get delegation decision
  const decision = decider.shouldDelegate(task, null, {
    skipCache: false,
    includeSubtasks: true
  });

  return decision;
}

// Hook entry point - reads prompt from stdin
(async () => {
  let input = '';
  process.stdin.setEncoding('utf8');

  for await (const chunk of process.stdin) {
    input += chunk;
  }

  const { prompt } = JSON.parse(input);
  const decision = await analyzePrompt(prompt);

  if (decision.shouldDelegate) {
    // Output becomes part of conversation context
    console.log(`
<delegation-analysis>
DELEGATION RECOMMENDED for this task.

Score: ${decision.score}/100
Confidence: ${decision.confidence}%
Pattern: ${decision.suggestedPattern}
Subtasks: ${decision.subtasks?.length || 'TBD'}

Factors:
- Complexity: ${decision.factors.complexity}/100
- Context Usage: ${decision.factors.contextUtilization}%
- Subtask Count: ${decision.factors.subtaskCount}

${decision.reasoning}

INSTRUCTION: You should use the Task tool to delegate this work using the ${decision.suggestedPattern} pattern.
${decision.subtasks ? `\nSuggested subtasks:\n${decision.subtasks.map((s, i) => `${i + 1}. ${s.title}`).join('\n')}` : ''}
</delegation-analysis>
`);
  } else {
    console.log(`
<delegation-analysis>
DIRECT EXECUTION recommended.
Score: ${decision.score}/100 (below threshold)
Reason: ${decision.reasoning}
</delegation-analysis>
`);
  }
})();
```

### Secondary: Control Skills

For explicit user control:

```markdown
<!-- .claude/commands/delegate.md -->
You MUST delegate this task using the Task tool.

$ARGUMENTS will be analyzed and decomposed into subtasks.

Execute using the pattern that best matches the task structure:
- parallel: Independent subtasks
- sequential: Dependent subtasks
- debate: Evaluation/comparison tasks
- review: Create + review tasks
```

```markdown
<!-- .claude/commands/direct.md -->
You MUST execute this task directly WITHOUT delegation.

Do NOT use the Task tool to spawn sub-agents.
Execute $ARGUMENTS in the current context.
```

---

## 4. Architecture Components

### 4.1 Component Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           AUTO-DELEGATION SYSTEM                           │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────────┐ │
│  │  HOOKS LAYER     │    │  DECISION LAYER   │    │  EXECUTION LAYER     │ │
│  │                  │    │                   │    │                      │ │
│  │  delegation-     │───►│  DelegationDecider│───►│  AgentOrchestrator   │ │
│  │  hook.js         │    │  TaskDecomposer   │    │  HierarchyManager    │ │
│  │                  │    │  PatternSelector  │    │  Task tool wrapper   │ │
│  └──────────────────┘    └──────────────────┘    └──────────────────────┘ │
│           │                       │                        │               │
│           │                       │                        │               │
│           ▼                       ▼                        ▼               │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                         CONFIG LAYER                                  │ │
│  │                                                                       │ │
│  │  .claude/config.json    tasks.json (per-task)    Runtime overrides    │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Data Flow

```
1. USER PROMPT
   │
   ├──► [/delegate prefix?] ──► Force delegation mode
   │
   ├──► [/direct prefix?] ──► Force direct mode
   │
   └──► [Normal prompt]
         │
         ▼
2. HOOK INTERCEPT (user-prompt-submit)
   │
   ├──► Parse prompt for task references
   ├──► Load config from .claude/config.json
   ├──► Check for tasks.json task match
   │
   ▼
3. DELEGATION DECISION
   │
   ├──► Calculate complexity score
   ├──► Estimate subtask count
   ├──► Check depth remaining
   ├──► Evaluate pattern indicators
   │
   ▼
4. CONTEXT INJECTION
   │
   ├──► [shouldDelegate: true]
   │      └──► Inject <delegation-analysis> with recommendation
   │
   └──► [shouldDelegate: false]
          └──► Inject brief "direct execution" note
   │
   ▼
5. CLAUDE PROCESSING
   │
   ├──► [Sees delegation recommendation]
   │      └──► Uses Task tool with suggested pattern
   │           └──► AgentOrchestrator manages sub-agents
   │
   └──► [Sees direct execution note]
          └──► Executes in current context
```

### 4.3 Configuration Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                     CONFIG PRECEDENCE                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Command prefix override (/delegate, /direct)                │
│     └──► Highest priority, overrides everything                 │
│                                                                 │
│  2. Per-task config (tasks.json delegationConfig)               │
│     └──► Specific to individual task                            │
│                                                                 │
│  3. Session override (runtime API)                              │
│     └──► Temporary for current session                          │
│                                                                 │
│  4. Project config (.claude/config.json)                        │
│     └──► Project-wide defaults                                  │
│                                                                 │
│  5. System defaults (delegation-decider.js)                     │
│     └──► Fallback values                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Key Design Decisions

### 5.1 Why Hook over Direct LLM Integration?

| Factor | Hook Approach | LLM Instructions Only |
|--------|---------------|----------------------|
| Reliability | 100% execution | LLM may ignore |
| Speed | Pre-computed analysis | Runtime computation |
| Consistency | Same algorithm always | May vary |
| Token cost | One-time injection | Repeated reasoning |
| Updateability | Change script, not prompts | Update all prompts |

### 5.2 Why Not Block on Delegation Decision?

The hook outputs analysis but doesn't block execution because:
1. User maintains control - they see the recommendation
2. LLM can override if context suggests otherwise
3. No "magic" happening behind the scenes
4. Transparency builds trust

### 5.3 Modes of Operation

| Mode | Hook Behavior | LLM Behavior |
|------|---------------|--------------|
| `disabled` | No output | Direct execution |
| `suggest` | Shows analysis | User/LLM decides |
| `auto` | Shows analysis + strong instruction | Follows recommendation |
| `smart` | Auto for high-confidence, suggest for others | Adaptive |

---

## 6. Implementation Files

### 6.1 New Files to Create

```
scripts/
├── delegation-hook.js          # Main hook script
├── delegation-bridge.js        # Bridge between hook and DelegationDecider
└── install-hooks.js            # Setup script for .claude/settings.json

.claude/
├── config.json                 # Delegation configuration (create/update)
├── commands/
│   ├── delegate.md             # Force delegation skill
│   ├── direct.md               # Force direct execution skill
│   └── delegation-status.md    # View delegation status skill
└── settings.json               # Hook registration (create/update)
```

### 6.2 Files to Modify

```
.claude/core/
├── delegation-decider.js       # Add getQuickHint() for fast analysis
├── task-decomposer.js          # Ensure quick decomposition mode
└── agent-orchestrator.js       # Add executeWithDelegationHint()
```

---

## 7. Integration with Existing Infrastructure

### 7.1 TaskManager Integration

When a prompt references a task from tasks.json:

```javascript
// In delegation-hook.js
const taskMatch = prompt.match(/task[:\s]+([a-z0-9-]+)/i);
if (taskMatch) {
  const task = await taskManager.getTask(taskMatch[1]);
  // Use task's acceptance criteria for subtask generation
  // Use task's estimate for effort calculation
  // Use task's delegationConfig if present
}
```

### 7.2 Dashboard Integration

Delegation events flow to dashboard via existing SSE:

```javascript
// In AgentOrchestrator when delegation starts
this.emit('delegation:started', {
  taskId,
  pattern,
  subtaskCount,
  estimatedDuration
});

// Dashboard listens and updates UI
dashboard.sse.on('delegation:started', (data) => {
  this.updateDelegationPanel(data);
});
```

### 7.3 Hierarchy Manager Integration

Sub-agents created through Task tool use HierarchyManager:

```javascript
// Task tool implementation recognizes delegation context
if (contextHas('delegation-analysis')) {
  // Register parent-child relationship
  hierarchyManager.registerChild(parentAgentId, newAgentId);
  // Apply depth tracking
  hierarchyManager.setDepth(newAgentId, parentDepth + 1);
}
```

---

## 8. Why Hooks Are Best for This Use Case

### 8.1 Technical Advantages

1. **Pre-computation**: Analysis runs before LLM processes, saving tokens
2. **Deterministic**: Same prompt always gets same analysis
3. **Testable**: Hook is a regular Node.js script with unit tests
4. **Isolated**: Hook failures don't break Claude Code
5. **Configurable**: JSON config, no prompt engineering

### 8.2 User Experience Advantages

1. **Transparent**: User sees the analysis as part of conversation
2. **Controllable**: Modes (disabled/suggest/auto/smart)
3. **Predictable**: Consistent behavior across sessions
4. **Fast**: No waiting for LLM to "think" about delegation

### 8.3 Maintenance Advantages

1. **Separate concerns**: Hook logic separate from LLM prompts
2. **Versioned**: Hook script in git, not baked into prompts
3. **Testable**: Integration tests for hook behavior
4. **Evolvable**: Can improve algorithm without changing prompts

---

## 9. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Hook execution overhead | Cache decisions, optimize script startup |
| False positives (over-delegation) | Tune thresholds, add confidence floor |
| False negatives (under-delegation) | Lower thresholds, add complexity signals |
| User confusion | Clear UX with reasoning panel |
| Hook failures | Graceful degradation to direct execution |

---

## 10. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Hook latency | < 200ms | Timer in script |
| Decision accuracy | > 85% | User override rate |
| Token savings | > 30% | Before/after comparison |
| User satisfaction | > 4/5 | Feedback survey |
| Delegation success rate | > 90% | Completion tracking |

---

## Related Documents

- [UX Design](AUTO-DELEGATION-UX-DESIGN.md) - Full user journey maps and UI specifications
- [Testing Strategy](AUTO-DELEGATION-TESTING-STRATEGY.md) - Comprehensive test plan with mocks
- [Control Interface](AUTO-DELEGATION-CONTROL-INTERFACE.md) - API specifications and configuration schema

---

## Appendix: Alternative Considered - MCP Server

We also considered running DelegationDecider as an MCP server:

```json
{
  "mcpServers": {
    "delegation": {
      "command": "node",
      "args": ["./mcp-delegation-server.js"]
    }
  }
}
```

This would expose tools like `delegation_analyze` and `delegation_execute`, but was rejected because:
1. Requires MCP configuration per project
2. Adds server management overhead
3. Not automatic - still requires explicit tool calls
4. Hook approach is simpler and achieves the goal

The MCP approach may be valuable later for advanced scenarios like cross-project delegation or enterprise deployments.
