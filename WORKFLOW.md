# WORKFLOW.md - Complete Multi-Agent Multi-Model Development Process

## Overview

This workflow combines the power of specialized AI agents with optimal model selection to create a comprehensive development process that follows the Plan → Design → Test → Implement → Validate → Iterate methodology.

## Workflow Phases

### Phase 1: 🔍 Research & Discovery
**Duration**: 30-60 minutes  
**Primary Agent**: Research Analyst (Claude Opus 4)  
**Secondary Agent**: Trend Analyst (GPT-4o)  
**Quality Gate**: 80/100 minimum score

#### Process Flow
```bash
# Start research phase
./scripts/switch-model.sh research
claude

# Clear context for fresh start
/clear

# Execute research command
/research-phase "Your project/feature description"
```

#### Agent Collaboration Pattern
```
Research Analyst (Claude Opus) → Comprehensive Foundation Research
    ↓
Trend Analyst (GPT-4o) → Recent Developments & Alternative Perspectives  
    ↓
Cross-Validation → Integrated Research Report
    ↓
Quality Gate → Research completeness check
```

#### Expected Deliverables
- Technology landscape analysis
- Competitive assessment
- Risk evaluation matrix
- Resource requirement estimation
- Implementation approach recommendations
- Alternative technology options

#### Quality Gate Criteria
- [ ] Technology options thoroughly researched
- [ ] Risks identified and assessed
- [ ] Resource requirements quantified
- [ ] Alternative approaches evaluated
- [ ] Implementation complexity estimated
- [ ] Stakeholder impact analyzed

---

### Phase 2: 📊 Strategic Planning
**Duration**: 45-90 minutes  
**Primary Agent**: Strategic Planner (Claude Opus 4)  
**Validation Agent**: Logic Reviewer (o1-preview simulation)  
**Quality Gate**: 85/100 minimum score

#### Process Flow
```bash
# Switch to planning mode
./scripts/switch-model.sh planning
claude

/clear

# Execute planning with validation
/planning-phase "Project requirements and constraints"
```

#### Agent Collaboration Pattern
```
Strategic Planner (Claude Opus) → Project Roadmap & Resource Allocation
    ↓
Logic Reviewer (o1-preview) → Feasibility Analysis & Dependency Validation
    ↓
Iteration Loop → Plan Refinement Until Logic Gates Pass
    ↓
Quality Gate → Plan approval and commitment
```

#### Expected Deliverables
- Detailed project timeline with milestones
- Resource allocation plan
- Risk mitigation strategies
- Dependency mapping
- Success criteria definition
- Contingency planning

#### Quality Gate Criteria
- [ ] Timeline is realistic and achievable
- [ ] Dependencies properly identified and sequenced
- [ ] Resource allocation is optimal
- [ ] Risk mitigation plans are comprehensive
- [ ] Logic validation passes all checks
- [ ] Success criteria are measurable

---

### Phase 3: 🏗️ Architecture & Design
**Duration**: 60-120 minutes  
**Architecture Agent**: System Architect (Claude Opus 4)  
**Implementation Agent**: Technical Designer (Claude Sonnet 4)  
**Quality Gate**: 85/100 minimum score

#### Process Flow
```bash
# Architecture design
./scripts/switch-model.sh design
claude

/clear

# Execute design phase
/design-phase "Technical requirements and constraints"
```

#### Agent Collaboration Pattern
```
System Architect (Claude Opus) → High-Level Architecture & Technology Selection
    ↓
Technical Designer (Claude Sonnet) → Detailed Specifications & API Contracts
    ↓
Cross-Review → Architecture-Implementation Alignment Validation
    ↓
Security Review → Security architecture validation
    ↓
Quality Gate → Design approval and sign-off
```

#### Expected Deliverables
- System architecture diagrams
- Technology stack selection and rationale
- API contracts and data models
- Component interaction specifications
- Security architecture design
- Performance and scalability considerations
- Implementation guidelines

#### Quality Gate Criteria
- [ ] Architecture supports all requirements
- [ ] Technology choices are justified
- [ ] API contracts are well-defined
- [ ] Security considerations are addressed
- [ ] Performance requirements are met
- [ ] Implementation guidance is clear
- [ ] Scalability path is defined

---

### Phase 4: 🧪 Test-First Development
**Duration**: 45-90 minutes  
**Primary Agent**: Test Engineer (Claude Sonnet 4)  
**Validation Agent**: Quality Analyst (GPT-4o simulation)  
**Quality Gate**: 90/100 minimum score

#### Process Flow
```bash
# Test-first development
./scripts/switch-model.sh testing
claude

/clear

# Execute TDD workflow
/test-first-phase "Component/feature to implement"
```

#### Agent Collaboration Pattern
```
Test Engineer (Claude Sonnet) → Comprehensive Test Suite Development
    ↓
Quality Analyst (GPT-4o) → Edge Case Analysis & Test Completeness Review
    ↓
Test Execution → Verify Tests Fail (Red Phase)
    ↓
Test Validation → Security and Performance Test Review
    ↓
Quality Gate → Test suite approval
```

#### Expected Deliverables
- Comprehensive unit test suite
- Integration test scenarios
- End-to-end test workflows
- Performance benchmarks
- Security test cases
- Error handling test coverage
- Test automation configuration

#### Quality Gate Criteria
- [ ] All functional requirements have tests
- [ ] Edge cases are properly covered
- [ ] Security scenarios are tested
- [ ] Performance tests are included
- [ ] Error handling is validated
- [ ] Tests fail appropriately (Red phase)
- [ ] Test documentation is complete

---

### Phase 5: ⚡ Implementation
**Duration**: 2-8 hours (varies by complexity)  
**Core Agent**: Senior Developer (Claude Sonnet 4)  
**Support Agent**: Code Assistant (Cursor/Copilot)  
**Quality Gate**: 90/100 minimum score

#### Process Flow
```bash
# Implementation phase
./scripts/switch-model.sh implementation
claude

/clear

# Execute implementation workflow
/implement-phase "Feature/component implementation requirements"
```

#### Agent Collaboration Pattern
```
Senior Developer (Claude Sonnet) → Core Business Logic Implementation
    ↓
Code Assistant (Cursor/Copilot) → Boilerplate & Supporting Code
    ↓
Iterative Development → Test-Code-Refactor Cycles
    ↓
Code Review → Self-review and optimization
    ↓
Quality Gate → Implementation standards validation
```

#### Expected Deliverables
- Production-ready code implementation
- Comprehensive error handling
- Performance-optimized algorithms
- Clean, maintainable code structure
- Inline documentation and comments
- Configuration and deployment scripts

#### Quality Gate Criteria
- [ ] All tests pass (Green phase)
- [ ] Code follows established patterns
- [ ] Error handling is robust
- [ ] Performance meets requirements
- [ ] Security standards are met
- [ ] Code is properly documented
- [ ] No technical debt introduced

---

### Phase 6: ✅ Cross-Agent Validation
**Duration**: 30-60 minutes  
**Coordinator**: Review Orchestrator (Claude Opus 4)  
**Reviewers**: All specialized agents  
**Quality Gate**: 90/100 minimum score

#### Process Flow
```bash
# Validation phase
./scripts/switch-model.sh validation
claude

/clear

# Execute validation workflow
/validate-phase "Implementation to validate"
```

#### Agent Collaboration Pattern
```
Review Orchestrator (Claude Opus) → Validation Coordination
    ↓
System Architect → Architecture Compliance Review
    ↓
Test Engineer → Test Coverage & Quality Validation
    ↓
Security Reviewer → Security Vulnerability Assessment
    ↓
Code Quality Agent → Standards & Maintainability Review
    ↓
Integration Testing → End-to-end system validation
    ↓
Quality Gate → Final approval or iteration requirement
```

#### Expected Deliverables
- Comprehensive validation report
- Security assessment results
- Performance benchmark results
- Code quality metrics
- Architecture compliance verification
- Deployment readiness checklist

#### Quality Gate Criteria
- [ ] Architecture requirements met
- [ ] Security vulnerabilities addressed
- [ ] Performance benchmarks achieved
- [ ] Code quality standards exceeded
- [ ] Test coverage is adequate
- [ ] Documentation is complete
- [ ] Deployment requirements satisfied

---

### Phase 7: 🔄 Strategic Iteration
**Duration**: 30-90 minutes per cycle  
**Strategy Agent**: Innovation Lead (Claude Opus 4)  
**Execution Agent**: Implementation Specialist (Claude Sonnet 4)  
**Quality Gate**: Continuous improvement

#### Process Flow
```bash
# Iteration phase
./scripts/switch-model.sh iteration
claude

/clear

# Execute iteration workflow
/iterate-phase "Feedback and improvement areas"
```

#### Agent Collaboration Pattern
```
Innovation Lead (Claude Opus) → Strategic Analysis & Improvement Planning
    ↓
Implementation Specialist (Claude Sonnet) → Tactical Improvements & Bug Fixes
    ↓
Feedback Integration → User/Stakeholder Feedback Analysis
    ↓
Priority Assessment → Impact vs Effort Analysis
    ↓
Continuous Cycle → Ongoing refinement until satisfaction
```

#### Expected Deliverables
- Iteration plan with priorities
- Performance improvements
- Bug fixes and optimizations
- User experience enhancements
- Technical debt reduction
- Documentation updates

## Complete Workflow Example

### Real-World Scenario: Building User Authentication System

```bash
# Phase 1: Research (60 minutes)
./scripts/switch-model.sh research
claude
/clear
/research-phase "JWT-based authentication system with role-based access control"

# Results: Technology comparison, security analysis, implementation approaches
# Quality Gate: 85/100 ✓

# Phase 2: Planning (75 minutes)  
./scripts/switch-model.sh planning
claude
/clear
/planning-phase "Authentication system with 3-week timeline, 2 developers"

# Results: Detailed timeline, resource allocation, risk mitigation
# Quality Gate: 88/100 ✓

# Phase 3: Design (90 minutes)
./scripts/switch-model.sh design
claude  
/clear
/design-phase "Microservices architecture with JWT tokens and Redis session store"

# Results: Architecture diagrams, API specs, security design
# Quality Gate: 91/100 ✓

# Phase 4: Test-First (75 minutes)
./scripts/switch-model.sh testing
claude
/clear
/test-first-phase "User registration, login, and authorization components"

# Results: Comprehensive test suite, security tests, performance tests
# Quality Gate: 93/100 ✓

# Phase 5: Implementation (4 hours)
./scripts/switch-model.sh implementation
claude
/clear
/implement-phase "Authentication service with JWT tokens and role-based access"

# Results: Production-ready auth service, comprehensive error handling
# Quality Gate: 92/100 ✓

# Phase 6: Validation (45 minutes)
./scripts/switch-model.sh validation
claude
/clear
/validate-phase "Complete authentication system implementation"

# Results: Security audit passed, performance benchmarks met
# Quality Gate: 94/100 ✓

# Phase 7: Iteration (60 minutes)
./scripts/switch-model.sh iteration
claude
/clear
/iterate-phase "User feedback: need password reset and 2FA support"

# Results: Enhanced system with additional security features
# Continuous improvement cycle established
```

## Advanced Workflow Patterns

### Parallel Agent Workflows

For complex projects, run multiple agent workflows in parallel:

```bash
# Terminal 1: UI Development
git worktree add ../auth-ui feature/auth-ui
cd ../auth-ui
./scripts/switch-model.sh implementation
claude
/clear
# UI-focused agent: "Build React authentication components"

# Terminal 2: API Development  
git worktree add ../auth-api feature/auth-api
cd ../auth-api
./scripts/switch-model.sh implementation
claude
/clear
# Backend-focused agent: "Build authentication REST API"

# Terminal 3: Database Design
git worktree add ../auth-db feature/auth-db
cd ../auth-db
./scripts/switch-model.sh design
claude
/clear
# Database-focused agent: "Design user and role data models"
```

### Cross-Phase Validation

Implement continuous validation across phases:

```bash
# After each phase completion
/quality-gate

# This command triggers:
# 1. Current phase quality assessment
# 2. Integration check with previous phases
# 3. Readiness validation for next phase
# 4. Risk assessment update
# 5. Timeline and resource revalidation
```

### Emergency Workflows

When issues arise, use emergency protocols:

```bash
# Critical bug discovered
./scripts/switch-model.sh debug
claude
/clear

# Emergency agent response:
SENIOR DEVELOPER (Claude Sonnet): Immediate bug analysis and hotfix
    ↓
SECURITY REVIEWER: Security impact assessment
    ↓
TEST ENGINEER: Regression test validation
    ↓
DEPLOYMENT SPECIALIST: Hotfix deployment strategy
```

## Quality Management

### Continuous Quality Monitoring

```bash
# Quality tracking throughout workflow
echo "Phase: Research, Score: 85/100, Agent: Research Analyst" >> quality-log.txt
echo "Phase: Planning, Score: 88/100, Agent: Strategic Planner" >> quality-log.txt
echo "Phase: Design, Score: 91/100, Agent: System Architect" >> quality-log.txt

# Generate quality report
python scripts/quality-report.py --generate-summary
```

### Agent Performance Tracking

Monitor which agents and models perform best for your project types:

```bash
# Track agent effectiveness
{
  "research_phase": {
    "agent": "Research Analyst",
    "model": "claude-opus-4",
    "avg_score": 87.3,
    "time_efficiency": "excellent",
    "cost_efficiency": "moderate"
  },
  "implementation_phase": {
    "agent": "Senior Developer", 
    "model": "claude-sonnet-4",
    "avg_score": 91.7,
    "time_efficiency": "excellent",
    "cost_efficiency": "excellent"
  }
}
```

### Workflow Optimization

Based on performance data, optimize your workflows:

```bash
# High-performing pattern identified
if [project_type == "web_api" && complexity == "medium"]; then
    research_time = 45  # Reduced from 60
    planning_time = 60  # Reduced from 75
    design_time = 75    # Reduced from 90
    # More time allocated to implementation and testing
fi
```

## Integration Patterns

### CI/CD Integration

Integrate the workflow with your deployment pipeline:

```bash
# .github/workflows/claude-workflow.yml
name: Claude Multi-Agent Workflow
on:
  push:
    branches: [feature/*]

jobs:
  validate-implementation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run Claude Validation
        run: |
          claude --model claude-opus-4 \
            -p "Validate this implementation against our architecture standards"
          
  cross-agent-review:
    runs-on: ubuntu-latest
    steps:
      - name: Multi-Agent Code Review
        run: |
          /validate-phase "$(git diff HEAD~1)"
```

### Team Collaboration

For team environments, coordinate agent workflows:

```bash
# Team coordination file: .claude/team-config.md
## Agent Assignment Matrix

| Developer | Primary Phases | Preferred Models | Specialization |
|-----------|----------------|------------------|----------------|
| Alice     | Research, Design | Claude Opus | Architecture |
| Bob       | Implementation, Testing | Claude Sonnet | Backend |
| Carol     | Validation, Iteration | Mixed Models | QA & UX |

## Handoff Protocols
- Research → Planning: Research summary required
- Design → Implementation: Architecture approval needed  
- Implementation → Validation: Code review completed
```

### External Tool Integration

Connect with existing development tools:

```bash
# Jira integration
python scripts/jira-sync.py --phase "implementation" --status "in-progress"

# Slack notifications  
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"Phase 4 (Testing) completed. Quality score: 93/100. Ready for implementation."}' \
  $SLACK_WEBHOOK_URL

# Documentation updates
python scripts/doc-generator.py --phase "design" --update-confluence
```

## Troubleshooting Workflows

### Common Workflow Issues

#### Agent Context Confusion
```bash
# Symptoms: Agents giving inconsistent advice
# Solution: Use /clear more frequently and provide explicit context

/clear
I am now switching to [SPECIFIC AGENT] role for [SPECIFIC PHASE].
Previous context: [BRIEF SUMMARY]
Current task: [SPECIFIC TASK]
```

#### Quality Gate Failures
```bash
# Symptoms: Repeated quality gate failures
# Solution: Break down into smaller phases

# Instead of:
/implement-phase "Complete authentication system"

# Do:
/implement-phase "User registration endpoint only"
/implement-phase "Login endpoint only"  
/implement-phase "JWT token validation middleware only"
```

#### Model Performance Issues
```bash
# Symptoms: Slow or low-quality responses
# Solution: Switch models or adjust parameters

# Check current model performance
claude usage --model-performance

# Switch to alternative model
export FALLBACK_MODEL="gpt-4o"
./scripts/switch-model.sh implementation --fallback
```

### Workflow Recovery

When workflows go off-track:

```bash
# Save current state
claude export-context --file "recovery-point-$(date +%Y%m%d-%H%M).json"

# Reset to known good state
git checkout HEAD~1
claude import-context --file "last-known-good-state.json"

# Resume from quality gate
/quality-gate --resume-from "design-phase"
```

## Performance Optimization

### Workflow Speed Optimization

```bash
# Fast-track for experienced teams
export CLAUDE_FAST_MODE=true
export SKIP_REDUNDANT_VALIDATIONS=true

# Reduced quality gates for prototyping
export PROTOTYPE_MODE=true
export MIN_QUALITY_SCORE=70
```

### Cost Optimization

```bash
# Use Sonnet for more tasks, Opus only when necessary
export COST_OPTIMIZATION=true
export PREFER_SONNET=true

# Batch operations to reduce API calls
claude batch-mode --commands "research,planning,design"
```

### Resource Management

```bash
# Parallel processing where safe
export MAX_PARALLEL_AGENTS=3
export ENABLE_WORKTREE_ISOLATION=true

# Memory management for large projects
export CLAUDE_MEMORY_LIMIT=8GB
export AUTO_CONTEXT_CLEANUP=true
```

## Workflow Customization

### Domain-Specific Adaptations

#### Web Development
```bash
# Frontend-focused workflow
RESEARCH_FOCUS="UI/UX patterns, accessibility, performance"
DESIGN_FOCUS="Component architecture, state management"
TESTING_FOCUS="Unit, integration, e2e, visual regression"
```

#### API Development
```bash
# Backend-focused workflow  
RESEARCH_FOCUS="API design patterns, security, scalability"
DESIGN_FOCUS="REST/GraphQL design, data modeling"
TESTING_FOCUS="API testing, load testing, security testing"
```

#### Data Science
```bash
# Data-focused workflow
RESEARCH_FOCUS="Data sources, ML algorithms, statistical methods"
DESIGN_FOCUS="Data pipeline, model architecture"
TESTING_FOCUS="Data validation, model testing, performance metrics"
```

### Team Size Adaptations

#### Solo Developer
```bash
# Streamlined workflow for individual work
export SOLO_MODE=true
export SKIP_PEER_REVIEW=true
export FAST_ITERATION=true
```

#### Small Team (2-5 developers)
```bash
# Collaborative but agile workflow
export TEAM_SIZE=small
export REQUIRE_PEER_REVIEW=true
export DAILY_STANDUPS=true
```

#### Large Team (6+ developers)
```bash
# Structured workflow with formal processes
export TEAM_SIZE=large
export FORMAL_REVIEW_PROCESS=true
export DOCUMENTATION_REQUIRED=true
export ARCHITECTURAL_REVIEW_BOARD=true
```

---

This comprehensive workflow provides a structured approach to development that scales from simple scripts to complex enterprise applications. The key is to start simple, build confidence with the system, and gradually adopt more sophisticated patterns as your team becomes comfortable with multi-agent collaboration.

## Next Steps

1. **Start with a simple project** to learn the workflow
2. **Measure and optimize** your specific use cases
3. **Customize agent personas** for your domain
4. **Integrate with existing tools** and processes
5. **Share learnings** with the community

Remember: The goal is not to follow this workflow rigidly, but to use it as a foundation for building your own optimized development process.