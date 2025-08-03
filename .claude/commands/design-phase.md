# Design Phase - Architecture and Implementation Design

Create comprehensive system design using specialized architectural and implementation agents.

## Usage
`/design-phase "technical requirements and constraints"`

## Process
Use Claude Opus for high-level architecture, Claude Sonnet for detailed implementation design.

SYSTEM ARCHITECT (Claude Opus 4): Design system architecture for {requirements}:

### High-Level Architecture:

1. **System Architecture**
   - Overall system topology and components
   - Service boundaries and responsibilities
   - Data flow and interaction patterns
   - Technology stack selection and rationale

2. **Scalability & Performance Design**
   - Performance requirements and targets
   - Scalability patterns and strategies
   - Load balancing and distribution approach
   - Caching and optimization strategies

3. **Security Architecture**
   - Security model and threat analysis
   - Authentication and authorization design
   - Data protection and encryption approach
   - Security monitoring and incident response

4. **Integration Design**
   - External system integration points
   - API design philosophy and standards
   - Message patterns and protocols
   - Error handling and resilience patterns

Now for detailed implementation design:

TECHNICAL DESIGNER (Claude Sonnet 4): Create detailed technical specifications:

### Implementation Specifications:

1. **API Contracts & Data Models**
   - REST/GraphQL endpoint specifications
   - Request/response schemas and validation
   - Data model definitions and relationships
   - Database schema design and indexing

2. **Component Architecture**
   - Component breakdown and responsibilities
   - Interface definitions and contracts
   - State management patterns
   - Configuration and environment handling

3. **Development Guidelines**
   - Coding standards and conventions
   - Testing strategies and requirements
   - Documentation standards
   - Deployment and DevOps considerations

4. **Quality Attributes**
   - Performance benchmarks and monitoring
   - Reliability and availability targets
   - Maintainability and extensibility design
   - Usability and accessibility requirements

### Cross-Validation Process:
- Architecture supports all functional requirements
- Implementation design aligns with architectural vision
- Security considerations are properly addressed
- Performance requirements can be met
- Design is testable and maintainable

### Expected Deliverables:
- System architecture diagrams and documentation
- Technology stack selection with rationale
- API specifications and data models
- Component design and interaction diagrams
- Security architecture and threat model
- Performance and scalability design
- Implementation guidelines and standards

### Quality Standards:
- Architecture supports all requirements
- Technology choices are well-justified
- Security considerations are comprehensive
- Design is scalable and maintainable
- Implementation guidance is clear

Minimum Quality Score Required: 85/100

Provide integrated design document with both architectural vision and implementation details.