# Auto-Delegation Implementation Plan

**Created**: 2025-12-29
**Status**: Ready for Implementation
**Prerequisites**: Design documents complete

---

## Implementation Phases

### Phase 1: Core Hook Infrastructure

**Goal**: Get the basic hook working and injecting analysis into prompts

**Tasks**:

| Task | Description | Files |
|------|-------------|-------|
| 1.1 | Create delegation-hook.js script | `scripts/delegation-hook.js` |
| 1.2 | Create delegation-bridge.js module | `scripts/delegation-bridge.js` |
| 1.3 | Add getQuickHint() to DelegationDecider | `.claude/core/delegation-decider.js` |
| 1.4 | Create hook installer script | `scripts/install-hooks.js` |
| 1.5 | Create initial config schema | `.claude/config.json` |
| 1.6 | Register hook in settings | `.claude/settings.json` |

**Acceptance Criteria**:
- Hook executes on every prompt submission
- Analysis output appears in conversation
- Config can enable/disable hook
- Hook completes in < 200ms

**Tests**: `__tests__/core/delegation-bridge.test.js`

---

### Phase 2: Decision Integration

**Goal**: Connect hook to full DelegationDecider and TaskDecomposer

**Tasks**:

| Task | Description | Files |
|------|-------------|-------|
| 2.1 | Integrate TaskDecomposer for subtask generation | `scripts/delegation-bridge.js` |
| 2.2 | Add pattern selection logic | `scripts/delegation-bridge.js` |
| 2.3 | Implement tasks.json task lookup | `scripts/delegation-hook.js` |
| 2.4 | Add per-task delegationConfig support | `.claude/core/task-manager.js` |
| 2.5 | Implement caching for repeated prompts | `scripts/delegation-bridge.js` |

**Acceptance Criteria**:
- Complex prompts get accurate delegation recommendations
- Tasks from tasks.json are recognized and enriched
- Per-task config overrides global settings
- Repeated prompts use cached decisions

**Tests**: `__tests__/integration/auto-delegation.integration.test.js`

---

### Phase 3: Control Skills

**Goal**: Give users explicit control over delegation

**Tasks**:

| Task | Description | Files |
|------|-------------|-------|
| 3.1 | Create /delegate skill | `.claude/commands/delegate.md` |
| 3.2 | Create /direct skill | `.claude/commands/direct.md` |
| 3.3 | Create /delegation-status skill | `.claude/commands/delegation-status.md` |
| 3.4 | Create /delegation-config skill | `.claude/commands/delegation-config.md` |
| 3.5 | Document skills in CLAUDE.md | `CLAUDE.md` |

**Acceptance Criteria**:
- /delegate forces delegation for any prompt
- /direct forces direct execution
- /delegation-status shows active delegations
- /delegation-config allows runtime config changes

**Tests**: Manual testing with skill invocations

---

### Phase 4: Execution Integration

**Goal**: Make delegated tasks actually execute through the orchestration system

**Tasks**:

| Task | Description | Files |
|------|-------------|-------|
| 4.1 | Add executeWithDelegationHint() to orchestrator | `.claude/core/agent-orchestrator.js` |
| 4.2 | Wire Task tool calls to AgentOrchestrator | `scripts/delegation-bridge.js` |
| 4.3 | Implement parallel pattern execution | `.claude/core/agent-orchestrator.js` |
| 4.4 | Implement sequential pattern execution | `.claude/core/agent-orchestrator.js` |
| 4.5 | Implement debate pattern execution | `.claude/core/agent-orchestrator.js` |
| 4.6 | Add HierarchyManager integration | `.claude/core/hierarchy-manager.js` |

**Acceptance Criteria**:
- Delegated tasks spawn real sub-agents via Task tool
- Parallel pattern runs subtasks concurrently
- Sequential pattern respects dependencies
- Hierarchy is tracked correctly

**Tests**: `__tests__/integration/hierarchy-delegation.integration.test.js`

---

### Phase 5: Dashboard Integration

**Goal**: Provide visibility into delegation activity

**Tasks**:

| Task | Description | Files |
|------|-------------|-------|
| 5.1 | Add delegation SSE events | `.claude/core/agent-orchestrator.js` |
| 5.2 | Create delegation panel component | Dashboard UI |
| 5.3 | Add delegation history endpoint | `.claude/core/dashboard-server.js` |
| 5.4 | Create delegation settings UI | Dashboard UI |
| 5.5 | Implement real-time progress updates | Dashboard SSE |

**Acceptance Criteria**:
- Dashboard shows active delegations
- Progress updates in real-time
- Settings can be changed from dashboard
- History shows past delegations

**Tests**: Dashboard E2E tests

---

### Phase 6: Polish and Documentation

**Goal**: Production-ready implementation

**Tasks**:

| Task | Description | Files |
|------|-------------|-------|
| 6.1 | Add comprehensive error handling | All files |
| 6.2 | Implement graceful degradation | `scripts/delegation-hook.js` |
| 6.3 | Add telemetry/logging | `scripts/delegation-bridge.js` |
| 6.4 | Write user documentation | `docs/AUTO-DELEGATION-USER-GUIDE.md` |
| 6.5 | Update CLAUDE.md with usage instructions | `CLAUDE.md` |
| 6.6 | Performance optimization | All files |

**Acceptance Criteria**:
- Hook failures don't break Claude Code
- Errors are logged with context
- Documentation is complete
- Performance meets targets

---

## Implementation Order Recommendation

```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5 ──► Phase 6
  │           │           │           │           │           │
  │           │           │           │           │           │
  ▼           ▼           ▼           ▼           ▼           ▼
  Hook      Decision    Skills    Execution   Dashboard   Production
  Works     Accurate    Control   Real Agents   UI         Ready
```

**Rationale**:
1. **Phase 1 first**: Foundation - nothing works without the hook
2. **Phase 2 second**: Decision quality determines usefulness
3. **Phase 3 third**: User control before automated execution
4. **Phase 4 fourth**: Real execution requires validated decisions
5. **Phase 5 fifth**: Visibility requires working execution
6. **Phase 6 last**: Polish requires complete implementation

---

## Quick Start (Phase 1 Only)

For rapid validation, implement just Phase 1:

```javascript
// scripts/delegation-hook.js (minimal version)
const { DelegationDecider } = require('../.claude/core/delegation-decider');

(async () => {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  const { prompt } = JSON.parse(input);
  const decider = new DelegationDecider();

  // Quick hint without full analysis
  const hint = decider.getQuickHint({ description: prompt });

  if (hint.shouldConsiderDelegation) {
    console.log(`<delegation-hint>
This task may benefit from delegation.
Complexity signals: ${hint.quickFactors.complexity}
Subtask potential: ${hint.quickFactors.subtaskPotential}
</delegation-hint>`);
  }
})();
```

```json
// .claude/settings.json
{
  "hooks": {
    "user-prompt-submit": [{
      "type": "command",
      "command": "node scripts/delegation-hook.js"
    }]
  }
}
```

This minimal implementation lets you validate the hook mechanism works before investing in the full implementation.

---

## Risk Mitigation

| Risk | Mitigation | Phase |
|------|------------|-------|
| Hook breaks Claude Code | Graceful error handling, timeout | 1 |
| Wrong delegation decisions | Tunable thresholds, manual override | 2, 3 |
| Sub-agent failures | Retry logic, partial success handling | 4 |
| Performance degradation | Caching, async where possible | 2, 6 |
| User confusion | Clear UX, documentation | 3, 6 |

---

## Testing Strategy Summary

| Phase | Test Type | Coverage Target |
|-------|-----------|-----------------|
| 1 | Unit tests | 90% |
| 2 | Integration tests | 85% |
| 3 | Manual testing | All skills |
| 4 | E2E tests | All patterns |
| 5 | E2E tests | Dashboard flows |
| 6 | Performance tests | All metrics |

See [AUTO-DELEGATION-TESTING-STRATEGY.md](AUTO-DELEGATION-TESTING-STRATEGY.md) for detailed test specifications.

---

## Definition of Done

The auto-delegation feature is complete when:

- [ ] Hook runs on every prompt and injects analysis
- [ ] DelegationDecider accurately identifies complex tasks
- [ ] User can force/prevent delegation with skills
- [ ] Delegated tasks execute through AgentOrchestrator
- [ ] Dashboard shows delegation activity
- [ ] All tests pass (400+ tests total)
- [ ] Documentation is complete
- [ ] Performance targets met (< 200ms hook, < 500ms decision)
