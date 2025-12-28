# Agent Handoff - Structured Transition Documentation

Document work completion and transition between agents for seamless collaboration.

## Usage
`/agent-handoff --from "current-agent" --to "next-agent" --phase "current-phase"`

## Process
Create comprehensive handoff documentation for agent transitions.

CURRENT AGENT: Document handoff to next agent:

### Handoff Documentation Template:

#### Agent Transition Details:
- **From Agent**: {current_agent_name} ({current_agent_model})
- **To Agent**: {next_agent_name} ({next_agent_model})
- **Phase Transition**: {current_phase} → {next_phase}
- **Handoff Date**: {current_timestamp}
- **Session Duration**: {time_spent}

#### Work Completed Summary:

1. **Primary Accomplishments**
   - Major deliverables completed
   - Key milestones achieved
   - Critical decisions made
   - Problems solved

2. **Detailed Work Log**
   - Specific tasks completed
   - Code files modified/created
   - Documentation updated
   - Configuration changes made

3. **Key Decisions and Rationale**
   - Technical decisions with reasoning
   - Trade-offs evaluated and choices made
   - Alternative approaches considered
   - Impact assessment of decisions

4. **Quality Assessment**
   - Current quality score: __/100
   - Quality criteria met/pending
   - Testing status and results
   - Code review status

#### Current State Analysis:

1. **System State**
   - Current functionality status
   - Known working features
   - Features in progress
   - Blocked or pending items

2. **Technical State**
   - Codebase structure and organization
   - Dependencies and integrations
   - Configuration and environment
   - Performance characteristics

3. **Testing State**
   - Tests passing/failing
   - Coverage metrics
   - Test environments status
   - Automated testing setup

#### Issues and Challenges:

1. **Resolved Issues**
   - Problems encountered and solved
   - Workarounds implemented
   - Performance optimizations made
   - Bug fixes completed

2. **Outstanding Issues**
   - Known bugs or defects
   - Performance bottlenecks
   - Technical debt identified
   - Unresolved design questions

3. **Blocked Items**
   - Dependencies waiting on external factors
   - Decisions pending stakeholder input
   - Resources or access needed
   - Technical limitations encountered

#### Recommendations for Next Agent:

1. **Immediate Priorities**
   - Most critical next steps
   - High-impact tasks to focus on
   - Quick wins and low-hanging fruit
   - Risk mitigation activities

2. **Technical Guidance**
   - Code patterns to follow
   - Architecture decisions to respect
   - Performance considerations
   - Security requirements to maintain

3. **Process Recommendations**
   - Testing approaches to use
   - Documentation standards to follow
   - Review processes to implement
   - Deployment considerations

4. **Potential Pitfalls**
   - Common mistakes to avoid
   - Complex areas requiring extra attention
   - Integration challenges to watch for
   - Performance or security risks

#### Context for Next Phase:

1. **Requirements and Constraints**
   - Functional requirements to address
   - Non-functional requirements to meet
   - Business constraints to respect
   - Technical constraints to work within

2. **Success Criteria**
   - Definition of done for next phase
   - Quality standards to achieve
   - Performance targets to meet
   - Acceptance criteria to satisfy

3. **Stakeholder Expectations**
   - Delivery timeline expectations
   - Quality and performance expectations
   - Feature and functionality expectations
   - Communication and reporting needs

#### Handoff Checklist:

- [ ] All work completed and documented
- [ ] Code committed and pushed to repository
- [ ] Tests updated and passing
- [ ] Documentation updated
- [ ] Configuration changes documented
- [ ] Known issues logged and prioritized
- [ ] Next steps clearly defined
- [ ] Quality assessment completed
- [ ] Stakeholder communication sent
- [ ] Handoff documentation reviewed

#### MANDATORY: Verification Evidence

**Before handoff, agent MUST provide:**

1. **Test Execution Evidence**
   - Paste actual `npm test` output
   - Show pass/fail counts and duration
   - All relevant tests must pass

2. **Functionality Demonstration**
   - Show actual execution output (API responses, CLI output)
   - Include timestamps and real data
   - Do NOT describe expected behavior

3. **Integration Verification**
   - Evidence that components work together
   - Show actual integration test results
   - Confirm external dependencies work

**Example Verification Block:**
```
## Verification Evidence

### Tests Run
$ npm test -- --testNamePattern="feature-name"
PASS  __tests__/feature.test.js (15 tests, 0 failures)
Time: 2.4s

### Feature Demonstrated
$ curl http://localhost:3033/api/feature
{"status":"ok","data":[...]}

### Integration Confirmed
- Database connection: Working (query returned 5 rows)
- External API: Responding (200 OK in 142ms)
```

See `docs/AGENT-VERIFICATION-PROTOCOL.md` for full requirements.

#### Files and Resources:

1. **Modified Files**
   - List of all files changed
   - Purpose of each modification
   - Important implementation details
   - Dependencies between changes

2. **New Files Created**
   - Purpose and functionality
   - Integration points
   - Configuration requirements
   - Testing and validation needs

3. **External Resources**
   - APIs or services integrated
   - Third-party libraries added
   - Configuration or credentials needed
   - Documentation and support resources

#### Communication Notes:

1. **Stakeholder Updates**
   - Progress communicated to stakeholders
   - Feedback received and incorporated
   - Outstanding questions or decisions
   - Next communication schedule

2. **Team Coordination**
   - Coordination with other team members
   - Dependencies on other work streams
   - Shared resources or conflicts
   - Collaboration needs going forward

### Validation Requirements:

Before handoff is complete, ensure:
- All deliverables are documented and accessible
- Next agent has sufficient context to continue
- No critical information is missing
- Quality standards are maintained
- Transition risks are identified and mitigated

### Next Agent Acknowledgment:

NEXT AGENT: Acknowledge handoff reception:
- [ ] Handoff documentation reviewed and understood
- [ ] Current state verified and validated  
- [ ] Issues and recommendations noted
- [ ] Next steps planned and prioritized
- [ ] Any clarification questions resolved
- [ ] Ready to proceed with assigned work

This handoff ensures continuity and quality across agent transitions while maintaining project momentum and knowledge preservation.