# Multi-Agent Development System Bootstrap

## Agent Personas

### Research Analyst (Sonnet 4.5)
**Expertise**: Deep technology research, competitive analysis, requirement gathering
**Quality Gate**: 80/100 minimum
**Deliverables**: Research report, comparison matrix, risk assessment

### Strategic Planner (Sonnet 4.5)
**Expertise**: Project roadmap, resource allocation, timeline estimation
**Quality Gate**: 85/100 minimum
**Deliverables**: Project plan, milestone timeline, dependency map

### System Architect (Sonnet 4.5)
**Expertise**: High-level design, technology selection, scalability planning
**Quality Gate**: 85/100 minimum
**Deliverables**: Architecture document, system diagrams, API contracts

### Test Engineer (Sonnet 4)
**Expertise**: Test implementation, automation, debugging strategies
**Quality Gate**: 90/100 minimum
**Deliverables**: Test suite, coverage report, testing strategy

### Senior Developer (Sonnet 4)
**Expertise**: Business logic, algorithms, complex integrations
**Quality Gate**: 90/100 minimum
**Deliverables**: Production code, documentation, integration tests

### Quality Analyst (Sonnet 4.5)
**Expertise**: Code review, quality assurance, edge case identification
**Quality Gate**: 85/100 minimum
**Deliverables**: Quality report, issue list, improvement recommendations

### Innovation Lead (Sonnet 4.5)
**Expertise**: Strategic improvements, architectural changes, optimization
**Quality Gate**: 85/100 minimum
**Deliverables**: Improvement plan, refactoring strategy, innovation roadmap

## Phase Definitions

### 1. Research Phase
**Agent**: Research Analyst
**Purpose**: Comprehensive technology research and requirement analysis
**Triggers**: "research", "investigate", "analyze technology", "evaluate options"
**Outputs**: Research report, technology comparison, risk assessment
**Next Phase**: Planning

### 2. Planning Phase
**Agent**: Strategic Planner
**Purpose**: Project roadmap and resource planning
**Triggers**: "plan", "roadmap", "timeline", "milestones", "estimate"
**Outputs**: Project plan, timeline, resource allocation
**Next Phase**: Design

### 3. Design Phase
**Agent**: System Architect
**Purpose**: System architecture and technical design
**Triggers**: "design", "architecture", "system design", "technical spec"
**Outputs**: Architecture document, API contracts, data models
**Next Phase**: Test-First

### 4. Test-First Phase
**Agent**: Test Engineer
**Purpose**: Test strategy and test implementation
**Triggers**: "test", "TDD", "test-first", "test strategy", "coverage"
**Outputs**: Test suite, testing strategy, automation framework
**Next Phase**: Implementation

### 5. Implementation Phase
**Agent**: Senior Developer
**Purpose**: Core feature development and integration
**Triggers**: "implement", "code", "develop", "build", "create feature"
**Outputs**: Production code, documentation, integration tests
**Next Phase**: Validation

### 6. Validation Phase
**Agent**: Quality Analyst
**Purpose**: Quality assurance and cross-validation
**Triggers**: "validate", "review", "QA", "quality check", "verify"
**Outputs**: Quality report, issue list, approval or rejection
**Next Phase**: Iteration or Complete

### 7. Iteration Phase
**Agent**: Innovation Lead
**Purpose**: Continuous improvement and optimization
**Triggers**: "improve", "optimize", "refactor", "enhance", "iterate"
**Outputs**: Improvement plan, refactored code, performance gains
**Next Phase**: Validation (for re-check) or Complete

## Quality Gate Rules

### Scoring Criteria
- **Completeness**: All deliverables present and complete (30%)
- **Quality**: Code quality, documentation clarity, best practices (30%)
- **Correctness**: Functionality works as expected, no critical bugs (25%)
- **Standards**: Follows project conventions and architecture (15%)

### Gate Enforcement
- **Below Threshold**: Phase fails, require revision before proceeding
- **At Threshold**: Phase passes with notes, can proceed
- **Above Threshold**: Phase passes with commendation

### Transition Rules
1. Cannot skip phases in sequence (Research → Planning → Design → Test → Implement → Validate)
2. Can return to any earlier phase from Validation
3. Iteration phase can loop back to Validation multiple times
4. Emergency Debug can interrupt any phase, returns to same phase after resolution

## State Management

### Project State Schema
```json
{
  "current_phase": "string (research|planning|design|test-first|implementation|validation|iteration)",
  "phase_history": ["array of phase transitions with timestamps"],
  "quality_scores": {"phase_name": "score/100"},
  "artifacts": {"phase_name": ["list of artifact paths"]},
  "decisions": ["array of key decisions with rationale"],
  "blockers": ["array of current blockers"],
  "last_updated": "ISO timestamp"
}
```

### Transition Validation
- Verify previous phase quality gate passed
- Confirm all required artifacts exist
- Check no critical blockers present
- Validate agent assignment matches phase

## Context Loading Strategy

### Token Budget Allocation
- **Bootstrap**: 800 tokens (this file, cached)
- **Current Phase Prompt**: 1500 tokens (full detail)
- **Adjacent Phase Prompts**: 500 tokens each (2 phases = 1000 tokens)
- **Recent Artifacts**: 2000 tokens (sliding window)
- **Project Summary**: 1000 tokens
- **Session State**: 700 tokens
- **Total**: ~7500 tokens (well within limits for optimal caching)

### Artifact Window Rules
- Load last 3 artifacts from current phase (full)
- Load summaries of artifacts from previous phase
- Skip artifacts from phases 3+ steps back
- Always include PROJECT_SUMMARY.md if exists

## Emergency Protocols

### Quality Gate Failure
1. Document failure reasons
2. Return to current phase with feedback
3. Require revision before re-validation
4. Escalate if 3 consecutive failures

### Agent Conflict
1. Lead Architect decides architecture conflicts
2. Senior Developer decides implementation conflicts
3. Human escalation for resource/timeline conflicts

### Model Unavailability
1. Fallback to Sonnet 4 for all phases
2. Document limitation in session notes
3. Increase review cycles for affected phases
