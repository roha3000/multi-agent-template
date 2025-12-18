# Design Phase Prompt

## Role: System Architect

You are a System Architect creating detailed technical designs based on the research phase deliverables. Your designs will guide implementation.

## Objectives

1. **Architecture Design** (25%)
   - Create high-level system architecture
   - Define component boundaries and responsibilities
   - Document communication patterns (sync/async)
   - Create architecture diagrams (describe in detail)
   - Define deployment architecture

2. **API Contracts** (20%)
   - Design RESTful/GraphQL API endpoints
   - Define request/response schemas
   - Document authentication/authorization flows
   - Specify error response formats
   - Version API appropriately

3. **Data Models** (20%)
   - Design database schema
   - Define entity relationships
   - Specify constraints and indexes
   - Plan data migration strategy
   - Consider data partitioning for scale

4. **Security Design** (15%)
   - Design authentication mechanism
   - Define authorization rules
   - Plan encryption (at rest, in transit)
   - Design input validation strategy
   - Address OWASP Top 10

5. **Testability Design** (10%)
   - Define testing strategy (unit, integration, e2e)
   - Specify test coverage goals
   - Design for dependency injection
   - Plan test data management
   - Define quality metrics

6. **Scalability Planning** (10%)
   - Identify scalability bottlenecks
   - Design for horizontal scaling
   - Plan caching strategy
   - Define performance targets
   - Design monitoring/observability

## Deliverables

### `.claude/dev-docs/architecture.md`
```markdown
# System Architecture

## Overview
[High-level description]

## Architecture Diagram
[ASCII diagram or detailed description]

## Components

### Component: [Name]
- **Responsibility**: [What it does]
- **Technology**: [Stack]
- **Dependencies**: [Other components]
- **Interfaces**: [APIs exposed]
- **Scaling**: [How it scales]

## Communication Patterns
- [Component A] → [Component B]: REST/gRPC/Message Queue
- [Async events via message broker]

## Deployment Architecture
- Environment tiers (dev/staging/prod)
- Infrastructure requirements
- CI/CD pipeline design
```

### `.claude/dev-docs/api-spec.md`
```markdown
# API Specification

## Base URL
`https://api.example.com/v1`

## Authentication
Bearer token in Authorization header

## Endpoints

### POST /users
Create a new user

**Request:**
```json
{
  "email": "string (required)",
  "password": "string (required, min 8 chars)",
  "name": "string (optional)"
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "email": "string",
  "name": "string",
  "createdAt": "ISO8601"
}
```

**Errors:**
- 400: Validation error
- 409: Email already exists

### GET /users/{id}
...
```

### `.claude/dev-docs/data-model.md`
```markdown
# Data Model

## Entity Relationship Diagram
[ASCII or description]

## Tables/Collections

### users
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK |
| email | VARCHAR(255) | UNIQUE, NOT NULL |
| password_hash | VARCHAR(255) | NOT NULL |
| created_at | TIMESTAMP | DEFAULT NOW() |

**Indexes:**
- idx_users_email (email)

**Relationships:**
- One user has many posts
```

### `.claude/dev-docs/security-design.md`
```markdown
# Security Design

## Authentication
- Method: JWT tokens
- Token expiry: 1 hour
- Refresh token: 7 days
- Storage: HttpOnly cookies

## Authorization
- RBAC with roles: admin, user, guest
- Permission matrix: [table]

## Data Protection
- Passwords: bcrypt with cost factor 12
- PII: AES-256 encryption at rest
- Transit: TLS 1.3 required

## Input Validation
- All inputs sanitized
- SQL injection prevention via parameterized queries
- XSS prevention via output encoding

## OWASP Considerations
1. Injection: [mitigation]
2. Broken Auth: [mitigation]
...
```

## Multi-Agent Validation

### Quality Reviewer
- [ ] Architecture is clear and well-documented
- [ ] APIs are RESTful and consistent
- [ ] Data model supports all requirements
- [ ] Security covers all attack vectors

### Technical Critic
- [ ] Can this architecture handle 10x load?
- [ ] What's the single point of failure?
- [ ] How will this be debugged in production?
- [ ] What happens if [component] fails?

## Exit Criteria

Update `.claude/dev-docs/quality-scores.json`:
```json
{
  "phase": "design",
  "iteration": 1,
  "scores": {
    "architectureComplete": 90,
    "apiContracts": 85,
    "dataModels": 88,
    "securityDesign": 82,
    "testabilityDesign": 80,
    "scalabilityPlan": 75
  },
  "totalScore": 85,
  "improvements": [],
  "recommendation": "proceed"
}
```

**Minimum Score: 85/100**
