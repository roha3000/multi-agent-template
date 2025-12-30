# Test-First Development - Comprehensive TDD with Multi-Agent Review

Implement Test-Driven Development with comprehensive test coverage and validation.

## Usage
`/test-first-phase "component or feature to implement"`

## Process
Use Claude Sonnet for test implementation, GPT-4o simulation for edge case analysis.

TEST ENGINEER (Claude Sonnet 4): Write comprehensive test suite for {component_description}:

### Test Development Strategy:

1. **Unit Tests**
   - Test each function/method in isolation
   - Cover all public interfaces and behaviors
   - Include boundary conditions and edge cases
   - Mock external dependencies appropriately

2. **Integration Tests**
   - Test component interactions and workflows
   - Verify data flow between components
   - Test external service integrations
   - Validate configuration and environment setup

3. **End-to-End Tests**
   - Test complete user workflows
   - Verify system behavior from user perspective
   - Test critical business processes
   - Include happy path and error scenarios

4. **Performance Tests**
   - Load testing for expected traffic
   - Stress testing for peak conditions
   - Performance regression prevention
   - Resource utilization monitoring

5. **Security Tests**
   - Authentication and authorization testing
   - Input validation and sanitization
   - Security vulnerability scanning
   - Access control verification

### TDD Requirements:
- Be explicit about following Test-Driven Development methodology
- Do NOT write any implementation code at this stage
- Ensure tests fail initially (Red phase of TDD)
- Write tests that will guide the implementation
- Avoid creating mock implementations for functionality that doesn't exist yet

Now for edge case analysis:

QUALITY ANALYST (GPT-4o simulation): Review test suite for completeness:

### Edge Case Analysis:
- **Boundary Conditions**: What happens at min/max values?
- **Error Scenarios**: How does the system handle failures?
- **Race Conditions**: Are there potential concurrency issues?
- **Resource Constraints**: How does it behave under resource pressure?
- **Security Edge Cases**: What about malicious inputs or attacks?
- **Integration Failures**: What if external services are unavailable?

### Test Coverage Validation:
- All requirements have corresponding tests
- Error paths are adequately covered
- Performance characteristics are testable
- Security requirements are validated
- User experience scenarios are included

### Expected Deliverables:
- Comprehensive unit test suite
- Integration test scenarios and setup
- End-to-end test workflows
- Performance test suite and benchmarks
- Security test cases and validation
- Test automation configuration
- Test documentation and guidelines

### Quality Standards:
- All functional requirements have tests
- Edge cases and error scenarios covered
- Security requirements are testable
- Performance characteristics are measurable
- Tests fail appropriately (Red phase)
- Test code is maintainable and documented

Minimum Quality Score Required: 90/100

After test completion:
1. Run tests to confirm they fail (Red phase)
2. Commit test suite with proper documentation
3. Proceed to implementation phase only after test validation

### MANDATORY: Verification Before Completion

**DO NOT mark this task complete until you have:**

1. **Run Tests and Show They Fail (Red Phase)**
   ```bash
   npm test -- --testPathPattern="<new-test-files>"
   ```
   - Paste actual test output showing failures
   - Tests MUST fail (proving they test real behavior)
   - If tests pass, implementation already exists or tests are invalid

2. **Show Test Discovery**
   - Verify test runner finds new test files
   - Show test count increased from baseline

3. **Document Test Coverage**
   - List which acceptance criteria each test covers
   - Identify any gaps in coverage

**Verification Checklist:**
- [ ] Tests executed with actual output shown
- [ ] Tests fail appropriately (Red phase confirmed)
- [ ] Test discovery verified (tests found by runner)
- [ ] Coverage mapped to acceptance criteria

See `docs/guides/AGENT-VERIFICATION-PROTOCOL.md` for full requirements.