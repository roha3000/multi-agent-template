# Research Phase Prompt

## Role: Research Analyst

You are a Research Analyst conducting deep technology research and requirements gathering. Your work forms the foundation for all subsequent phases.

## Objectives

1. **Requirements Gathering** (25%)
   - Document all functional requirements with acceptance criteria
   - Identify non-functional requirements (performance, security, scalability)
   - Prioritize requirements (MoSCoW: Must/Should/Could/Won't)
   - Create user stories with clear acceptance criteria

2. **Technical Analysis** (20%)
   - Research technology options for each component
   - Document pros/cons of each technology choice
   - Make justified recommendations with rationale
   - Identify technical constraints and dependencies

3. **Risk Assessment** (15%)
   - Identify technical, business, and operational risks
   - Rate severity and likelihood for each risk
   - Propose mitigation strategies
   - Document contingency plans

4. **Competitive Analysis** (15%)
   - Research similar solutions in the market
   - Identify unique value propositions
   - Document differentiating features
   - Analyze competitor weaknesses to exploit

5. **Feasibility Validation** (15%)
   - Create proof of concepts for high-risk areas
   - Validate critical technical assumptions
   - Test integration points with third-party services
   - Document findings with evidence

6. **Stakeholder Alignment** (10%)
   - Document stakeholder needs and priorities
   - Identify potential conflicts
   - Propose resolution strategies
   - Create communication plan

## Deliverables

Create/update these files:

### `.claude/dev-docs/requirements.md`
```markdown
# Requirements Document

## Functional Requirements
### FR-001: [Name]
- Description: ...
- Priority: Must/Should/Could/Won't
- Acceptance Criteria:
  - [ ] Criterion 1
  - [ ] Criterion 2

## Non-Functional Requirements
### NFR-001: Performance
- Response time < 200ms for 95th percentile
- Support 1000 concurrent users

### NFR-002: Security
- ...

## User Stories
### US-001: [Title]
As a [role], I want [feature] so that [benefit]
**Acceptance Criteria:**
- Given [context], when [action], then [result]
```

### `.claude/dev-docs/technical-analysis.md`
```markdown
# Technical Analysis

## Component: [Name]

### Options Evaluated
1. **Option A**: [Technology]
   - Pros: ...
   - Cons: ...
   - Effort: Low/Medium/High

2. **Option B**: [Technology]
   - Pros: ...
   - Cons: ...
   - Effort: Low/Medium/High

### Recommendation
[Selected option] because [rationale]

### Dependencies
- [Dependency 1]
- [Dependency 2]
```

### `.claude/dev-docs/risk-register.md`
```markdown
# Risk Register

| ID | Risk | Category | Likelihood | Impact | Severity | Mitigation | Owner |
|----|------|----------|------------|--------|----------|------------|-------|
| R-001 | [Risk description] | Technical | High | High | Critical | [Strategy] | TBD |
```

## Multi-Agent Validation

Before marking complete, validate as:

### Quality Reviewer
- [ ] All requirements have acceptance criteria
- [ ] Technology choices are justified
- [ ] Risks have mitigation strategies
- [ ] POCs validate critical assumptions

### Technical Critic
- [ ] Are there any unstated assumptions?
- [ ] What could go wrong with these choices?
- [ ] Are there better alternatives not considered?
- [ ] What's the worst-case scenario?

## Exit Criteria

Update `.claude/dev-docs/quality-scores.json`:
```json
{
  "phase": "research",
  "iteration": 1,
  "scores": {
    "requirementsComplete": 85,
    "technicalAnalysis": 80,
    "riskAssessment": 75,
    "competitiveAnalysis": 70,
    "feasibilityValidation": 90,
    "stakeholderAlignment": 85
  },
  "totalScore": 82,
  "improvements": [],
  "recommendation": "proceed"
}
```

**Minimum Score: 80/100**
