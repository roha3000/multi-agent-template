# Agent Task Verification Protocol

> **Purpose**: Ensure agents demonstrate task functionality before marking tasks complete.
> **Created**: 2025-12-27
> **Status**: Active

## Problem Statement

Tasks were being marked complete by agents without actual verification. Agents would:
- Claim code was written without running it
- Mark tests as "passing" without executing them
- State APIs were "working" without making requests
- Complete integration tasks without testing integration points

This led to silent failures discovered later in the development cycle.

## Protocol Requirements

### Before Marking ANY Task Complete

Agents MUST perform and document these verification steps:

#### 1. Run Relevant Tests
```bash
# For code changes
npm test -- --testPathPattern="<affected-test-files>"

# For specific components
npm test -- --testNamePattern="<component-name>"

# Show actual output with pass/fail counts
```

**Required Output**: Test summary showing pass/fail counts and duration.

#### 2. Show Working Output
- **For APIs**: Make actual HTTP requests and show responses
- **For CLI tools**: Run commands and show output
- **For UI components**: Describe visual verification or provide screenshot path
- **For data changes**: Query and display actual data

**Required Output**: Actual execution results, not descriptions of expected behavior.

#### 3. Verify Integration Points
- Test component interactions with real dependencies
- Verify data flows end-to-end
- Confirm configuration is correct

**Required Output**: Evidence that integrations work in situ.

## Verification Checklist Template

Copy and complete this checklist in task completion notes:

```markdown
## Verification Checklist

### Tests Executed
- [ ] Unit tests run: `npm test -- [pattern]`
- [ ] Test result: X passed, Y failed, Z skipped
- [ ] Coverage: X% (if applicable)

### Working Output Demonstrated
- [ ] Functionality executed: [describe action]
- [ ] Output observed: [paste actual output or describe]
- [ ] Matches expected behavior: Yes/No

### Integration Verified
- [ ] Integration point 1: [describe] - Status: Working/Broken
- [ ] Integration point 2: [describe] - Status: Working/Broken
- [ ] End-to-end flow tested: Yes/No

### Verification Evidence
[Paste actual command output, API responses, or logs here]
```

## Phase-Specific Verification

### Research Phase
- **Verify**: Sources accessed and documented
- **Show**: Actual quotes/data from sources
- **Test**: N/A (no code changes)

### Design Phase
- **Verify**: Design documents created and accessible
- **Show**: Architecture diagrams or specification excerpts
- **Test**: Design validates against requirements

### Implementation Phase
- **Verify**: Code compiles/transpiles without errors
- **Show**: `npm run build` output (no errors)
- **Test**: Unit tests pass: `npm test -- <pattern>`
- **Show**: Actual test output with results

### Testing Phase
- **Verify**: Test files created and discoverable
- **Show**: Test runner finds new tests
- **Test**: Tests fail appropriately (Red phase in TDD)
- **Show**: Actual failure output proving tests execute

### Validation Phase
- **Verify**: All quality gates pass
- **Show**: Quality scores from `/quality-gate`
- **Test**: Integration tests pass
- **Show**: E2E test results

## Forbidden Completion Patterns

Agents MUST NOT use these phrases when marking tasks complete:

| Forbidden Pattern | Why It's Wrong | What To Do Instead |
|-------------------|----------------|---------------------|
| "Tests should pass" | Speculative, not verified | Run tests, paste output |
| "This will work" | Assumption, not proof | Execute and show results |
| "I've implemented X" | No verification shown | Show X running |
| "The API returns..." | Hypothetical response | Make request, show response |
| "Integration is complete" | Unverified claim | Test integration, show proof |

## Enforcement Mechanisms

### 1. Quality Gate Integration
The `/quality-gate` command now includes verification status:
- Tasks without verification evidence score 0 on "Verification" dimension
- Minimum verification score required: 80/100

### 2. Task Completion File Requirements
The `task-completion.json` file MUST include:
```json
{
  "taskId": "example-task",
  "status": "completed",
  "verification": {
    "testsRun": true,
    "testCommand": "npm test -- --testNamePattern='example'",
    "testResults": "15 passed, 0 failed",
    "outputDemonstrated": true,
    "outputEvidence": "API returned 200 OK with expected payload",
    "integrationVerified": true,
    "integrationPoints": ["database", "auth-service"]
  },
  "completedAt": "2025-12-27T..."
}
```

### 3. Automated Verification Hooks
The `after-code-change.js` hook can be configured to require tests pass before task completion is allowed.

Configuration file: `.claude/hooks/build-check-config.json`
```json
{
  "enabled": true,
  "runBuild": true,
  "runTests": true,
  "blockOnTestFailure": true,
  "verification": {
    "requireTestEvidence": true,
    "requireOutputEvidence": true,
    "requireIntegrationCheck": true
  }
}
```

**Hook Behavior:**
- Runs after any code file changes (`.js`, `.ts`, etc.)
- Executes build command and blocks on errors
- Executes test command and blocks on failures
- Logs verification status for audit trail

**Future Enhancement Considerations:**
- Pre-commit hook to require verification evidence in commit messages
- GitHub Actions check that validates task-completion.json has verification section
- Dashboard integration to show verification status per task
- Automated screenshot capture for UI verification

## Examples

### Good Verification
```
Task: Add /api/health endpoint

## Verification

### Tests Run
$ npm test -- --testNamePattern="health"
PASS  __tests__/api/health.test.js
  Health Endpoint
    ✓ GET /api/health returns 200 (15 ms)
    ✓ includes uptime in seconds (8 ms)
    ✓ includes memory usage (12 ms)

Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total

### Output Demonstrated
$ curl http://localhost:3033/api/health
{
  "status": "ok",
  "uptime": 3421,
  "memory": { "heapUsed": 45234567, "heapTotal": 89456123 }
}

### Integration Verified
- Express server: Endpoint registered and responding
- Memory API: process.memoryUsage() returning valid data
```

### Bad Verification (DO NOT DO THIS)
```
Task: Add /api/health endpoint

## Verification
I've implemented the health endpoint. It should return status, uptime,
and memory usage. Tests have been written that will verify this behavior.
```

## Quick Reference

| Phase | Must Run | Must Show | Must Verify |
|-------|----------|-----------|-------------|
| Research | N/A | Source excerpts | Sources accessible |
| Design | N/A | Design artifacts | Requirements coverage |
| Implementation | `npm test` | Test output | Build succeeds |
| Testing | `npm test` | Tests fail (Red) | Tests are discovered |
| Validation | `/quality-gate` | Quality scores | All gates pass |

## Summary

**The Three Rules of Verification:**

1. **Run It** - Execute actual commands, not theoretical ones
2. **Show It** - Paste real output, not descriptions
3. **Prove It** - Demonstrate integration works in situ

Tasks marked complete without verification evidence will be rejected and returned to the agent for proper verification.
