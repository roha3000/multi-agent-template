# Implementation Phase - Multi-Model Code Development

Implement production-ready code following TDD methodology with specialized support.

## Usage
`/implement-phase "feature or component implementation requirements"`

## Process
Use Claude Sonnet for core implementation, with support tools for supplementary code.

SENIOR DEVELOPER (Claude Sonnet 4): Implement production-ready code for {implementation_requirements}:

### Implementation Strategy:

1. **Core Business Logic**
   - Implement complex algorithms and business rules
   - Handle data processing and transformation
   - Implement integration logic and workflows
   - Ensure proper error handling and validation

2. **Performance Optimization**
   - Optimize critical code paths
   - Implement efficient data structures
   - Add appropriate caching mechanisms
   - Monitor and profile performance hotspots

3. **Error Handling & Resilience**
   - Comprehensive error handling strategies
   - Graceful degradation patterns
   - Circuit breaker and retry mechanisms
   - Logging and monitoring integration

4. **Security Implementation**
   - Input validation and sanitization
   - Authentication and authorization logic
   - Secure data handling and storage
   - Security logging and audit trails

### TDD Implementation Rules:
- Do NOT modify the existing tests
- Write code to make tests pass (Green phase)
- Refactor code for quality while keeping tests green
- Keep iterating until ALL tests pass
- Add additional tests only if gaps are discovered

### Code Quality Standards:
- Follow established coding conventions
- Write self-documenting code with clear naming
- Include appropriate inline documentation
- Ensure code is maintainable and extensible
- Optimize for readability and performance

For supporting code and boilerplate:

CODE ASSISTANT (Cursor/Copilot/External Tools): Handle supplementary development:
- Generate boilerplate code and templates
- Create configuration files and setup scripts
- Implement repetitive UI components
- Generate documentation and README files

### Implementation Workflow:
1. Start with failing tests (Red phase confirmed)
2. Implement minimal code to make tests pass
3. Refactor and optimize while maintaining green tests
4. Add error handling and edge case support
5. Optimize performance and security
6. Document implementation decisions and patterns

### Expected Deliverables:
- Production-ready implementation
- Comprehensive error handling
- Performance-optimized code
- Security-compliant implementation
- Clean, maintainable code structure
- Inline documentation and comments
- Configuration and deployment scripts

### Quality Standards:
- All tests pass (Green phase achieved)
- Code follows established patterns and conventions
- Error handling is robust and comprehensive
- Performance meets or exceeds requirements
- Security standards are implemented
- Code is properly documented
- No technical debt introduced

Minimum Quality Score Required: 90/100

Continue iterating with the test-code-refactor cycle until all tests pass and quality standards are met.