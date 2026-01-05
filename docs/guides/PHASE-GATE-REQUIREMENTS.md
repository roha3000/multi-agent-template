# Phase Gate Requirements Matrix

## Overview

This document defines the quality gates, thresholds, expert agent reviews, and enforcement mechanisms for each development phase in the multi-agent system.

---

## Phase Gate Matrix

| Phase | Min Score | Next Phase | Expert Reviewers | Special Checks |
|-------|-----------|------------|------------------|----------------|
| Research | 80/100 | Planning | Strategic Planner | - |
| Planning | 85/100 | Design | Logic Reviewer | - |
| Design | 85/100 | Test-First | System Architect | Architecture compliance |
| Test-First | 90/100 | Implementation | Test Engineer | - |
| Implementation | 90/100 | Validation | Test Engineer, Senior Developer | - |
| Validation | 90/100 | Complete | Review Orchestrator | Multi-agent sign-off |

---

## Phase Details

### Research Phase (80/100 minimum)

**Purpose**: Deep technology research, requirements gathering, competitive analysis

**Criteria & Weights**:
| Criterion | Weight | Description |
|-----------|--------|-------------|
| requirementsComplete | 25% | All functional and non-functional requirements documented |
| technicalAnalysis | 20% | Technology choices researched and justified |
| riskAssessment | 15% | Risks identified with mitigation strategies |
| competitiveAnalysis | 15% | Competitive landscape analyzed |
| feasibilityValidation | 15% | Technical feasibility confirmed |
| stakeholderAlignment | 10% | Stakeholder needs understood and documented |

**Gate Enforcement**:
- Research Analyst (Claude Opus 4.5) performs primary research
- Strategic Planner validates completeness before transition
- Score must reach 80/100 for gate passage

---

### Planning Phase (85/100 minimum)

**Purpose**: Project roadmap, resource allocation, timeline estimation

**Valid Transitions**: Design (forward), Research (backward)

**Required Reviewer**: Logic Reviewer (validates plan feasibility)

**Gate Enforcement**:
- Strategic Planner creates roadmap
- Logic Reviewer validates dependencies and edge cases
- Score must reach 85/100 for gate passage

---

### Design Phase (85/100 minimum)

**Purpose**: System architecture, API contracts, data models, detailed specifications

**Criteria & Weights**:
| Criterion | Weight | Description |
|-----------|--------|-------------|
| architectureComplete | 25% | High-level architecture documented with diagrams |
| apiContracts | 20% | API contracts defined with request/response schemas |
| dataModels | 20% | Data models and database schema designed |
| securityDesign | 15% | Security considerations addressed |
| testabilityDesign | 10% | Testing strategy defined |
| scalabilityPlan | 10% | Scalability and performance considerations |

**Special Check: Architecture Compliance**
- Before approval, verify against `.claude/ARCHITECTURE.md`
- Ensure no duplicate singleton components (dashboard, orchestrator, tracker, database)
- System Architect must sign off

**Gate Enforcement**:
- System Architect (Claude Opus 4.5) provides high-level design
- Technical Designer (Claude Sonnet 4) creates specifications
- Architecture compliance check must pass
- Score must reach 85/100 for gate passage

---

### Test-First Phase (90/100 minimum)

**Purpose**: TDD approach - write tests before implementation

**Valid Transitions**: Implementation (forward), Design (backward)

**Required Reviewer**: Test Engineer

**Gate Enforcement**:
- Test Engineer writes comprehensive test suite
- Tests must cover edge cases and error scenarios
- Quality Analyst validates test completeness
- Score must reach 90/100 for gate passage

---

### Implementation Phase (90/100 minimum)

**Purpose**: Code implementation following design specifications

**Criteria & Weights**:
| Criterion | Weight | Description |
|-----------|--------|-------------|
| codeComplete | 30% | All features implemented per design |
| codeQuality | 20% | Code follows best practices and style guidelines |
| errorHandling | 15% | Comprehensive error handling implemented |
| documentation | 15% | Code documented with comments and JSDoc |
| securityImplementation | 10% | Security measures implemented per design |
| performanceOptimization | 10% | Performance optimizations applied |

**Required Reviewers**: Test Engineer + Senior Developer (dual sign-off)

**Gate Enforcement**:
- Senior Developer implements core logic
- Test Engineer verifies all tests pass
- Both must approve before gate passage
- Score must reach 90/100 for gate passage

---

### Validation Phase (90/100 minimum)

**Purpose**: Cross-agent validation, quality gate enforcement

**Criteria & Weights**:
| Criterion | Weight | Description |
|-----------|--------|-------------|
| unitTests | 25% | Unit tests with >80% coverage |
| integrationTests | 20% | Integration tests for critical paths |
| edgeCases | 15% | Edge cases and error scenarios tested |
| securityTesting | 15% | Security vulnerabilities checked |
| performanceTesting | 15% | Performance benchmarks validated |
| documentationReview | 10% | Documentation reviewed and updated |

**Special Check: Multi-Agent Sign-off**
- All previous phase agents must validate their domain
- Review Orchestrator coordinates validation
- Minimum 3 agent approvals required

**Gate Enforcement**:
- Review Orchestrator coordinates all reviews
- Each specialized agent validates their domain
- Multi-agent sign-off required (minimum 3 agents)
- Score must reach 90/100 for gate passage

---

## Parent-Child Task Gates

### Hierarchy Enforcement Rules

1. **Parent tasks cannot advance** until all children pass their gates
2. **Children are validated independently** but roll up to parent
3. **Blocking propagates upward** - any blocked child blocks parent
4. **Quality scores aggregate** - parent score is weighted average of children

### Gate Check Order

```
1. Check all child tasks have passed their phase gates
2. Verify child quality scores meet thresholds
3. Aggregate child scores for parent
4. Apply parent-level quality criteria
5. Require expert reviewer approval
6. Record in audit trail
```

---

## Valid Phase Transitions

```
research    → planning
planning    → design, research (back)
design      → test-first, research (back), planning (back)
test-first  → implementation, design (back)
implementation → validation, test-first (back)
validation  → iteration, any phase (back)
iteration   → validation
```

**Emergency Transitions**: Can always return to `research` or `planning` from any phase.

---

## Enforcement Mechanisms

### Quality Score Calculation

```javascript
function calculatePhaseScore(phase, evaluations) {
  let weightedScore = 0;
  for (const [criterion, config] of Object.entries(PHASES[phase].criteria)) {
    const score = evaluations[criterion] ?? 0;
    weightedScore += (score * config.weight) / 100;
  }
  return Math.round(weightedScore);
}
```

### Gate Validation

Gates are enforced at:
1. **Phase transitions** - Score must meet minimum before advancing
2. **Task completion** - All criteria must be evaluated
3. **Parent task updates** - Children must pass before parent can complete

### Audit Trail

All gate decisions are recorded with:
- Timestamp
- Phase and task ID
- Action (approve/reject/bypass)
- Approver (agent ID, type, model)
- Score vs threshold
- Evidence (artifacts, test results)
- Comments

---

## Quick Reference

### Minimum Scores by Phase
```
research:       80
planning:       85
design:         85
test-first:     90
implementation: 90
validation:     90
```

### Required Reviewers by Phase
```
research       → Strategic Planner
planning       → Logic Reviewer
design         → System Architect
test-first     → Test Engineer
implementation → Test Engineer + Senior Developer
validation     → Review Orchestrator + 3 agents
```

### Special Checks
```
design     → Architecture compliance (ARCHITECTURE.md)
validation → Multi-agent sign-off (min 3 agents)
```

---

## Related Files

- `quality-gates.js` - Core quality gate definitions
- `.claude/core/phase-inference.js` - Phase transition logic
- `.claude/ARCHITECTURE.md` - Singleton component registry
- `autonomous-orchestrator.js` - Phase advancement logic
