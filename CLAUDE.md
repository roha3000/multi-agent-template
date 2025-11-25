# CLAUDE.md - Unified Multi-Agent Multi-Model Development System

## Project Overview
Multi-agent development system that combines specialized AI agent personas with strategic model selection for optimal development workflows.

## Session Initialization (Read This First!)

**At the start of every session**, automatically load project context by reading these 3 files:

```
1. PROJECT_SUMMARY.md      # High-level project state and context
2. .claude/dev-docs/plan.md     # Current task breakdown and implementation plan
3. .claude/dev-docs/tasks.md    # Active todo list with progress tracking
```

**Why 3 files?** This is the **Dev-Docs 3-File Pattern** that prevents context drift on long tasks:
- `PROJECT_SUMMARY.md` - What we've built (project history, architecture, quality scores)
- `plan.md` - What we're building (current task breakdown, implementation steps)
- `tasks.md` - What's left to do (todo list, blockers, next actions)

**Token cost**: ~400 tokens total (cached via prompt caching = ~40 tokens effective)

**When you need fresh context or phase inference**:
- User can run `/session-init [task description]` to regenerate context with intelligent phase detection
- This is optional - The 3 dev-docs files provide sufficient context for most work

**Important**:
- If PROJECT_SUMMARY.md doesn't exist, the project is new. Proceed with research phase.
- If dev-docs files don't exist, create them from current task state.

## Multi-Agent Multi-Model Strategy

### Core Philosophy
- **Specialized Agents**: Each agent persona brings unique expertise
- **Optimal Models**: Match AI models to task complexity and requirements
- **Collaborative Validation**: Agents review each other's work across models
- **Iterative Improvement**: Continuous refinement through agent feedback loops

## Agent Personas & Model Assignments

### 🔍 Research Phase
**Primary Agent**: Research Analyst (Claude Opus 4.5)
- **Role**: Deep technology research, competitive analysis, requirement gathering
- **Strengths**: Comprehensive analysis, nuanced understanding
- **Secondary Agent**: Trend Analyst (GPT-4o)
- **Role**: Recent developments, alternative perspectives, community insights
- **Handoff**: Research Analyst provides foundation, Trend Analyst adds current context

### 📊 Planning Phase  
**Primary Agent**: Strategic Planner (Claude Opus 4.5)
- **Role**: Project roadmap, resource allocation, timeline estimation
- **Strengths**: Strategic thinking, complex project coordination
- **Validation Agent**: Logic Reviewer (o1-preview)
- **Role**: Plan validation, dependency analysis, edge case identification
- **Handoff**: Planner creates strategy, Logic Reviewer validates feasibility

### 🏗️ Design Phase
**Architecture Agent**: System Architect (Claude Opus 4.5)
- **Role**: High-level system design, technology selection, scalability planning
- **Strengths**: Architectural vision, technology assessment
- **Implementation Agent**: Technical Designer (Claude Sonnet 4)
- **Role**: Detailed specifications, API contracts, data models
- **Handoff**: Architect provides vision, Designer creates specifications

### 🧪 Testing Phase
**Primary Agent**: Test Engineer (Claude Sonnet 4)
- **Role**: Test implementation, automation, debugging strategies
- **Strengths**: Code generation, test pattern implementation
- **Validation Agent**: Quality Analyst (GPT-4o)
- **Role**: Edge case identification, test completeness review
- **Handoff**: Engineer writes tests, Analyst validates coverage

### ⚡ Implementation Phase
**Core Agent**: Senior Developer (Claude Sonnet 4)
- **Role**: Business logic, algorithms, complex integrations
- **Strengths**: Code generation, debugging, optimization
- **Support Agent**: Code Assistant (Cursor/Copilot)
- **Role**: Boilerplate, UI components, repetitive tasks
- **Handoff**: Developer handles core logic, Assistant supports with scaffolding

### ✅ Validation Phase
**Quality Gate Coordinator**: Review Orchestrator (Claude Opus 4.5)
- **Role**: Cross-agent validation, quality gate enforcement
- **Review Agents**: All previous agents in specialized review capacity
- **Process**: Each agent validates their domain expertise
- **Standards**: Minimum 85/100 quality score to proceed

### 🔄 Iteration Phase
**Strategy Agent**: Innovation Lead (Claude Opus 4.5)
- **Role**: Strategic improvements, architectural changes
- **Execution Agent**: Implementation Specialist (Claude Sonnet 4)
- **Role**: Code improvements, bug fixes, optimizations
- **Cycle**: Strategy guides direction, Specialist executes changes

## Model Selection Rules

### Automatic Model Selection
```bash
# Research & Strategic Planning - Use Opus 4.5
if [task_complexity == "high" && analysis_depth == "deep"]; then
    model = "claude-opus-4.5"
fi

# Code Implementation & Testing  
if [task_type == "coding" || task_type == "debugging"]; then
    model = "claude-sonnet-4-20250514"
fi

# Validation & Alternative Perspectives
if [task_type == "validation" || perspective == "alternative"]; then
    model = "gpt-4o" || "o1-preview"
fi
```

### Cost Optimization Strategy
- **Primary Models**: Claude Opus 4.5 (research/strategy), Claude Sonnet 4 (implementation)
- **Secondary Models**: GPT-4o (validation), o1-preview (reasoning)
- **Token Limits**: Phase-specific limits to control costs
- **Fallback Strategy**: Sonnet 4 as fallback for Sonnet 4.5, GPT-4o for supplementary analysis

## Agent Collaboration Protocols

### 1. Handoff Documentation
Every agent transition requires:
- Work completed summary
- Key decisions and rationale  
- Issues identified and resolution status
- Specific recommendations for next agent
- Files modified with brief descriptions

### 2. Cross-Agent Validation
Before proceeding to next phase:
- Primary agent completes work
- Secondary agent reviews for blind spots
- Quality gate agent validates standards
- Documentation agent updates records

### 3. Conflict Resolution
When agents disagree:
- Lead Architect (Opus 4.5) makes final architectural decisions
- Senior Developer (Sonnet 4) makes implementation decisions
- Project Manager (human) resolves resource/timeline conflicts

## Quality Gates & Standards

### Research Phase Gate
- Comprehensive technology analysis ✓
- Risk assessment completed ✓
- Resource requirements identified ✓
- Alternative approaches evaluated ✓
- Score: ≥ 80/100 to proceed

### Planning Phase Gate  
- Timeline and milestones defined ✓
- Dependencies mapped ✓
- Logic validation passed ✓
- Resource allocation confirmed ✓
- Score: ≥ 85/100 to proceed

### Design Phase Gate
- Architecture approved by Architect Agent ✓
- Implementation details validated ✓
- Security considerations addressed ✓
- Testability confirmed ✓
- Score: ≥ 85/100 to proceed

### Implementation Phase Gate
- All tests passing ✓
- Code quality standards met ✓
- Security review completed ✓
- Documentation updated ✓
- Score: ≥ 90/100 to proceed

## Development Commands & Environment

### Model Environment Variables
```bash
# Primary Models
RESEARCH_MODEL=claude-opus-4.5
PLANNING_MODEL=claude-opus-4.5  
DESIGN_ARCHITECTURE_MODEL=claude-opus-4.5
DESIGN_IMPLEMENTATION_MODEL=claude-sonnet-4-20250514
TESTING_MODEL=claude-sonnet-4-20250514
IMPLEMENTATION_MODEL=claude-sonnet-4-20250514
VALIDATION_MODEL=claude-opus-4.5
ITERATION_STRATEGY_MODEL=claude-opus-4.5
ITERATION_EXECUTION_MODEL=claude-sonnet-4-20250514

# Secondary Models  
RESEARCH_SECONDARY_MODEL=gpt-4o
PLANNING_VALIDATION_MODEL=o1-preview
TESTING_EDGE_CASE_MODEL=gpt-4o

# Token Limits
MAX_TOKENS_RESEARCH=8000
MAX_TOKENS_PLANNING=6000
MAX_TOKENS_DESIGN=4000
MAX_TOKENS_IMPLEMENTATION=3000
MAX_TOKENS_TESTING=2000
```

### Important Project Commands
- Build: `npm run build` or `make build`
- Test: `npm test` or `pytest`
- Lint: `npm run lint` or `flake8`
- Deploy: `npm run deploy` or `./deploy.sh`

### Agent Communication Patterns
- Start each phase with `/clear` to avoid token contamination
- Use agent-specific prompts for role clarity
- Document agent decisions for handoff continuity
- Validate work through cross-agent review

## Workflow Integration Points

### IDE Integration
- VS Code with Claude Code extension for primary development
- Cursor for rapid coding and boilerplate generation
- Multiple terminal windows for parallel agent workflows

### Version Control Integration  
- Git branches for parallel agent work using worktrees
- Structured commit messages identifying agent and phase
- Pull request templates requiring multi-agent sign-off

### CI/CD Integration
- Automated testing triggered by agent implementations
- Quality gate enforcement in pipeline
- Multi-model validation in staging environment

## Emergency Protocols

### Model Unavailability
1. **Opus 4.5 Unavailable**: Fall back to Sonnet 4 for research, extend analysis phase
2. **Sonnet 4 Unavailable**: Use GPT-4o for implementation, increase review cycles
3. **External Models Unavailable**: Continue with Claude models only, document limitations

### Agent Conflicts
1. **Technical Conflicts**: Lead Architect (Opus 4.5) makes binding decisions
2. **Timeline Conflicts**: Prioritize critical path, defer non-essential features
3. **Quality Conflicts**: Never compromise below minimum quality gates

### Quality Gate Failures
1. **Research Gate Failure**: Extend research phase, bring in additional models
2. **Design Gate Failure**: Redesign with simplified architecture
3. **Implementation Gate Failure**: Refactor with Test Engineer and Quality Analyst

Remember: This system prioritizes quality and thorough analysis over speed. Each phase builds upon validated work from previous phases.