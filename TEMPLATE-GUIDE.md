# Template Customization Guide

This guide explains how to customize the multi-agent template for different project types and team configurations.

## 🎯 Project Type Customizations

### Web Development Projects

#### CLAUDE.md Changes:
```markdown
## Project Overview
Web application development using modern frameworks and best practices.

### 🔍 Research Phase Specializations:
- Frontend frameworks comparison (React, Vue, Svelte)
- State management patterns (Redux, Zustand, Context)
- Styling approaches (CSS-in-JS, Tailwind, CSS Modules)
- Performance optimization strategies
- Accessibility standards and testing
```

#### Custom Commands:
Create `.claude/commands/ui-component-phase.md`:
```markdown
# UI Component Development Phase

Execute component-driven development with design system integration.

## Usage
`/ui-component-phase "component name and requirements"`

## Process
Focus on reusable, accessible, and performant UI components.
```

### API Development Projects

#### CLAUDE.md Changes:
```markdown
## Project Overview  
RESTful API development with focus on scalability, security, and documentation.

### 🔍 Research Phase Specializations:
- API design patterns (REST, GraphQL, gRPC)
- Authentication strategies (JWT, OAuth, API keys)
- Database design and optimization
- Caching strategies (Redis, CDN)
- API documentation (OpenAPI, Postman)
```

### Data Science Projects

#### CLAUDE.md Changes:
```markdown
## Project Overview
Data science and machine learning project with focus on data quality and model performance.

### 🔍 Research Phase Specializations:
- Data source evaluation and acquisition
- Exploratory data analysis patterns
- Feature engineering techniques
- Model selection and validation
- Deployment and monitoring strategies
```

## 👥 Team Size Adaptations

### Solo Developer Template

#### .env additions:
```bash
# Solo Developer Mode
SOLO_MODE=true
SKIP_PEER_REVIEW=true
FAST_ITERATION=true
SIMPLIFIED_HANDOFFS=true
REDUCED_DOCUMENTATION=true
```

#### CLAUDE.md modifications:
```markdown
### Agent Collaboration Protocols

#### Solo Mode Adjustments:
- Single agent per phase (no cross-validation)
- Simplified handoff documentation
- Reduced quality gate thresholds (75/100 minimum)
- Fast iteration cycles
```

### Large Team Template (6+ developers)

#### .env additions:
```bash
# Large Team Mode
TEAM_SIZE=large
FORMAL_REVIEW_PROCESS=true
DOCUMENTATION_REQUIRED=true
ARCHITECTURAL_REVIEW_BOARD=true
COMPLIANCE_CHECKS=true
```

#### CLAUDE.md modifications:
```markdown
### Agent Collaboration Protocols

#### Large Team Adjustments:
- Multiple agents per phase with formal reviews
- Comprehensive documentation requirements
- Higher quality gate thresholds (90/100 minimum)
- Formal architectural decision records
- Compliance and audit trail requirements
```

## 🛠 Technology Stack Customizations

### Node.js/JavaScript Stack

#### CLAUDE.md updates:
```markdown
### Important Project Commands
- Build: `npm run build`
- Test: `npm test` or `npm run test:coverage`
- Lint: `npm run lint` or `npm run lint:fix`
- Dev: `npm run dev`
- Deploy: `npm run deploy`
```

### Python Stack

#### CLAUDE.md updates:
```markdown
### Important Project Commands
- Build: `python setup.py build`
- Test: `pytest` or `python -m pytest --cov`
- Lint: `flake8` or `black . && isort .`
- Dev: `python -m flask run` or `uvicorn main:app --reload`
- Deploy: `docker build . -t app && docker run -p 8000:8000 app`
```

### Go Stack

#### CLAUDE.md updates:
```markdown
### Important Project Commands
- Build: `go build ./...`
- Test: `go test ./... -v`
- Lint: `golangci-lint run`
- Dev: `go run main.go`
- Deploy: `go build -o app && ./app`
```

## 🏢 Industry-Specific Adaptations

### Healthcare/Medical Software

#### Additional quality gates:
```markdown
### Compliance Phase Gate
- HIPAA compliance validated ✓
- Medical device regulations checked ✓
- Clinical workflow integration tested ✓
- Data privacy audit completed ✓
- Score: ≥ 95/100 to proceed
```

### Financial Services

#### Enhanced security focus:
```markdown
### Security Phase Gate (Enhanced)
- PCI DSS compliance validated ✓
- SOX compliance requirements met ✓
- Fraud detection capabilities tested ✓
- Regulatory reporting verified ✓
- Score: ≥ 95/100 to proceed
```

### E-commerce

#### User experience focus:
```markdown
### User Experience Phase Gate
- Conversion funnel optimized ✓
- Mobile responsiveness validated ✓
- Payment flow security tested ✓
- Performance benchmarks met ✓
- A/B testing framework ready ✓
- Score: ≥ 90/100 to proceed
```

## 🔧 Custom Agent Personas

### Creating Domain-Specific Agents

#### Example: E-commerce Conversion Specialist
```markdown
### 💰 Conversion Optimization Phase
**Primary Agent**: Conversion Specialist (Claude Opus 4)
- **Role**: User journey optimization, conversion rate analysis
- **Strengths**: UX psychology, A/B testing, funnel analysis
- **Focus Areas**: Checkout flow, product pages, user onboarding
```

#### Example: DevOps Infrastructure Specialist  
```markdown
### 🚀 Infrastructure Phase
**Primary Agent**: DevOps Engineer (Claude Sonnet 4)
- **Role**: Infrastructure as code, deployment automation
- **Strengths**: Container orchestration, monitoring, scaling
- **Focus Areas**: CI/CD pipelines, cloud architecture, observability
```

## 📝 Template File Structure

### Minimal Template (Solo Developer)
```
project-root/
├── CLAUDE.md               # Simplified configuration
├── README.md              # Basic setup instructions
├── .env.template          # Essential environment variables
└── .claude/commands/      # Core commands only (5-6 files)
```

### Full Template (Team/Enterprise)
```
project-root/
├── CLAUDE.md               # Full configuration
├── SETUP.md               # Detailed setup guide
├── WORKFLOW.md            # Complete workflow docs
├── TEMPLATE-GUIDE.md      # This customization guide
├── docs/                  # Additional documentation
├── .claude/commands/      # All 10+ commands
├── scripts/               # Automation tools
└── templates/             # Documentation templates
```

## 🚀 Quick Customization Steps

1. **Choose Your Base Template**:
   ```bash
   # Copy the multi-agent template
   cp -r multi-agent-template my-new-project-template
   ```

2. **Update CLAUDE.md**:
   - Change project overview
   - Customize agent personas
   - Adjust quality gates
   - Update technology stack

3. **Modify Commands**:
   - Edit existing command files
   - Add domain-specific commands
   - Remove unused commands

4. **Update Scripts**:
   - Customize workflow orchestrator
   - Add project-specific automation
   - Update model switching logic

5. **Test Template**:
   ```bash
   ./scripts/create-project.sh "test-project" "web" "../test"
   cd ../test/test-project
   ./scripts/workflow-orchestrator.sh "test-project" "test description"
   ```

This customization system allows you to create specialized templates for any domain while maintaining the core multi-agent workflow structure.