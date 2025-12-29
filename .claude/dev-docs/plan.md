# Current Plan
**Phase**: IMPLEMENTATION
**Status**: Session-Task Claiming System - Ready to Start

---

## Primary Focus: Session-Task Claiming

**Goal**: Fix dashboard showing same task for all sessions by implementing atomic task claiming.

**Design Doc**: `docs/SESSION-TASK-CLAIMING-DESIGN.md`

---

## Implementation Phases

### Phase 1: Core Infrastructure - READY
**Task**: `session-task-claiming-phase1` (3h)
- Add `task_claims` table to CoordinationDB
- Implement `claimTask()`, `releaseClaim()`, `refreshClaim()`
- Add cleanup timer for expired claims
- Unit tests

### Phase 2: TaskManager Integration - BLOCKED (Phase 1)
**Task**: `session-task-claiming-phase2` (2h)
- Add `claim` field to task schema
- Implement `claimNextTask()` atomic operation
- Handle orphaned claims on session cleanup

### Phase 3: Dashboard API - BLOCKED (Phase 2)
**Task**: `session-task-claiming-phase3` (2h)
- 7 new API endpoints for claim management
- SSE events for real-time updates

### Phase 4: Dashboard UI - BLOCKED (Phase 3)
**Task**: `session-task-claiming-phase4` (2h)
- Per-session task display in session cards
- Claim badges in task queue
- Stale claim indicators

---

## Progress: 0% (0 of 4 phases)

---

## Key Deliverables

| Component | Changes |
|-----------|---------|
| CoordinationDB | `task_claims` table, atomic claim methods |
| TaskManager | `claim` field, `claimNextTask()` |
| SessionRegistry | `currentTaskId` field |
| Dashboard API | 7 new endpoints, 4 SSE event types |
| Dashboard UI | Per-session task display, claim badges |

---

## Next Steps

1. Start `session-task-claiming-phase1`
2. Add `task_claims` table to coordination-db.js
3. Implement atomic claim/release operations
4. Write unit tests
