# Quality Gate - Comprehensive Quality Assessment

Perform comprehensive quality assessment and gate validation for phase transitions.

## Usage
`/quality-gate` or `/quality-gate --phase "specific-phase"`

## Process
Execute multi-dimensional quality assessment with pass/fail criteria.

QUALITY GATE COORDINATOR (Claude Opus 4): Execute comprehensive quality assessment:

### Quality Assessment Framework:

1. **Functional Quality**
   - Requirements coverage and traceability
   - Feature completeness and correctness
   - User acceptance criteria validation
   - Business logic accuracy

2. **Technical Quality**
   - Code quality and maintainability
   - Architecture compliance
   - Performance characteristics
   - Security implementation

3. **Process Quality**
   - Development methodology adherence
   - Documentation completeness
   - Testing coverage and effectiveness
   - Review and validation processes

### Phase-Specific Quality Gates:

#### Research Phase Gate (80/100 minimum):
- [ ] Technology options thoroughly researched
- [ ] Risks identified and assessed (≥3 major risks documented)
- [ ] Resource requirements quantified
- [ ] Alternative approaches evaluated (≥2 alternatives)
- [ ] Implementation complexity estimated
- [ ] Stakeholder impact analyzed

#### Planning Phase Gate (85/100 minimum):
- [ ] Timeline is realistic and achievable
- [ ] Dependencies properly identified and sequenced
- [ ] Resource allocation is optimal
- [ ] Risk mitigation plans are comprehensive
- [ ] Logic validation passes all checks
- [ ] Success criteria are measurable

#### Design Phase Gate (85/100 minimum):
- [ ] Architecture supports all requirements
- [ ] Technology choices are well-justified
- [ ] Security considerations are comprehensive
- [ ] Design is scalable and maintainable
- [ ] Implementation guidance is clear
- [ ] API contracts are well-defined

#### Testing Phase Gate (90/100 minimum):
- [ ] All functional requirements have tests
- [ ] Edge cases and error scenarios covered (≥80% coverage)
- [ ] Security requirements are testable
- [ ] Performance characteristics are measurable
- [ ] Tests fail appropriately (Red phase confirmed)
- [ ] Test automation is configured

#### Implementation Phase Gate (90/100 minimum):
- [ ] All tests pass (Green phase achieved)
- [ ] Code follows established patterns
- [ ] Error handling is robust and comprehensive
- [ ] Performance meets or exceeds requirements
- [ ] Security standards are implemented
- [ ] No critical technical debt introduced

#### Validation Phase Gate (90/100 minimum):
- [ ] Architecture compliance validated
- [ ] Security vulnerabilities addressed
- [ ] Performance benchmarks achieved
- [ ] Code quality standards exceeded
- [ ] Integration tests pass (100%)
- [ ] Documentation is complete and accurate

### Quality Scoring Matrix:

#### Scoring Criteria (1-10 scale for each dimension):
- **Completeness**: Are all requirements addressed?
- **Correctness**: Does it work as specified?
- **Quality**: Does it meet quality standards?
- **Performance**: Does it meet performance requirements?
- **Security**: Are security requirements met?
- **Maintainability**: Is it sustainable long-term?
- **Documentation**: Is it properly documented?
- **Testing**: Is testing adequate and effective?
- **Compliance**: Does it follow standards and guidelines?
- **Verification**: Has working functionality been demonstrated?

#### Verification Scoring (MANDATORY):
The **Verification** dimension requires evidence that the implementation works:

| Score | Criteria |
|-------|----------|
| 0-2   | No verification evidence provided |
| 3-4   | Only descriptions of expected behavior |
| 5-6   | Partial test execution shown |
| 7-8   | Tests run with output, functionality demonstrated |
| 9-10  | Full verification: tests pass, output shown, integration verified |

**Tasks with Verification score < 7 cannot pass quality gate.**

#### Quality Gate Calculation:
```
Total Score = (Sum of all dimension scores / 10) * 10
Pass Threshold varies by phase:
- Research: ≥80/100
- Planning: ≥85/100  
- Design: ≥85/100
- Testing: ≥90/100
- Implementation: ≥90/100
- Validation: ≥90/100
```

### Gate Decision Framework:

#### PASS Conditions:
- All mandatory criteria are met
- Overall score meets minimum threshold
- No critical issues identified
- Stakeholder acceptance achieved

#### CONDITIONAL PASS Conditions:
- Score within 5 points of threshold
- Minor issues that can be addressed in next phase
- Acceptable risk level for identified issues
- Clear remediation plan exists

#### FAIL Conditions:
- Score below conditional pass range
- Critical issues identified
- Security vulnerabilities present
- Mandatory criteria not met

### Quality Gate Actions:

#### On PASS:
1. Document quality assessment results
2. Approve progression to next phase
3. Archive quality artifacts
4. Communicate success to stakeholders

#### On CONDITIONAL PASS:
1. Document issues and remediation plan
2. Set conditions for next phase
3. Schedule follow-up quality check
4. Monitor risk factors closely

#### On FAIL:
1. Document specific failure reasons
2. Create detailed remediation plan
3. Return to appropriate phase for fixes
4. Schedule re-assessment timeline

### Expected Deliverables:
- Quality assessment report with scores
- Pass/fail determination with rationale
- Issue log with severity classifications
- Remediation recommendations (if needed)
- Risk assessment for proceeding
- Stakeholder communication summary

### Quality Metrics Tracking:
- Quality trend analysis across phases
- Time to resolve quality issues
- Defect density and escape rates
- Customer satisfaction metrics
- Technical debt accumulation

Use this command at the end of each phase or when quality validation is needed.