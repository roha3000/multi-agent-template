# Validation Phase - Cross-Agent Comprehensive Review

Perform comprehensive validation using all specialized agents for final quality assurance.

## Usage
`/validate-phase "implementation or system to validate"`

## Process
Coordinate multiple specialized agents for comprehensive validation review.

REVIEW ORCHESTRATOR (Claude Opus 4): Coordinate validation process for {implementation}:

### Validation Coordination:
- Assign validation tasks to specialized review agents
- Ensure comprehensive coverage of all quality dimensions
- Aggregate and synthesize feedback from all agents
- Make final quality determination and recommendations

Now executing specialized reviews:

SYSTEM ARCHITECT REVIEWER: Validate architectural compliance:

### Architecture Review Checklist:
- [ ] Implementation follows architectural design
- [ ] Technology choices align with specifications
- [ ] Component interactions match design
- [ ] Scalability requirements are met
- [ ] Integration patterns are correctly implemented
- [ ] Performance characteristics align with design

TEST ENGINEER REVIEWER: Validate testing and quality:

### Testing Review Checklist:
- [ ] Test coverage meets standards (>80% for critical paths)
- [ ] All test types are implemented and passing
- [ ] Edge cases and error scenarios are covered
- [ ] Performance tests validate requirements
- [ ] Security tests pass all validations
- [ ] Test automation is properly configured

SECURITY REVIEWER: Perform security assessment:

### Security Review Checklist:
- [ ] Input validation is comprehensive
- [ ] Authentication and authorization are properly implemented
- [ ] Data protection measures are in place
- [ ] Security logging and monitoring are configured
- [ ] Vulnerability scanning shows no critical issues
- [ ] Security best practices are followed

CODE QUALITY REVIEWER: Assess maintainability and standards:

### Code Quality Review Checklist:
- [ ] Code follows established conventions and standards
- [ ] Documentation is comprehensive and up-to-date
- [ ] Code complexity is within acceptable limits
- [ ] No code smells or anti-patterns detected
- [ ] Refactoring opportunities are minimal
- [ ] Technical debt is within acceptable bounds

PERFORMANCE REVIEWER: Validate performance characteristics:

### Performance Review Checklist:
- [ ] Performance benchmarks meet requirements
- [ ] Resource utilization is optimized
- [ ] Scalability tests pass validation
- [ ] No performance regressions detected
- [ ] Monitoring and alerting are configured
- [ ] Optimization opportunities are documented

### Integration Testing Validation:
- Execute end-to-end system tests
- Validate all integration points
- Confirm data flow and transformations
- Test error handling and recovery
- Verify configuration and deployment

### Expected Deliverables:
- Comprehensive validation report from each reviewer
- Aggregated quality assessment with scores
- Security vulnerability assessment
- Performance benchmark results
- Code quality metrics and analysis
- Integration test results
- Deployment readiness checklist
- Recommendations for improvements

### Quality Gate Criteria:
- [ ] Architecture compliance: ≥85/100
- [ ] Test coverage and quality: ≥90/100
- [ ] Security assessment: ≥90/100
- [ ] Code quality: ≥85/100
- [ ] Performance validation: ≥85/100
- [ ] Integration tests: 100% passing
- [ ] Documentation: Complete and accurate

### Overall Quality Standards:
- All individual quality gates must pass
- No critical security vulnerabilities
- Performance requirements met or exceeded
- Code quality standards maintained
- Documentation is complete and accurate
- System is ready for deployment

Minimum Overall Quality Score Required: 90/100

If validation fails, provide specific recommendations for remediation and return to appropriate phase for fixes.

### MANDATORY: Verification Before Completion

**DO NOT mark validation complete until you have:**

1. **Run Full Test Suite**
   ```bash
   npm test
   ```
   - Paste actual test output with full pass/fail summary
   - 100% of tests MUST pass for validation to complete

2. **Execute Quality Gate**
   ```bash
   /quality-gate
   ```
   - Show actual quality scores for each dimension
   - All scores MUST meet minimum thresholds

3. **Verify End-to-End Flows**
   - Execute critical user workflows
   - Show actual system responses
   - Confirm data flows correctly end-to-end

4. **Show Integration Evidence**
   - Demonstrate all components work together
   - Paste actual API responses or system output
   - Verify external dependencies are reachable

**Verification Checklist:**
- [ ] Full test suite executed: `npm test` with output shown
- [ ] Quality gate passed with scores displayed
- [ ] E2E workflows demonstrated with actual output
- [ ] Integration verified across all touchpoints
- [ ] No critical issues remaining

See `docs/guides/AGENT-VERIFICATION-PROTOCOL.md` for full requirements.