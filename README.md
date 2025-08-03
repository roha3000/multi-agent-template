# Multi-Agent Development System Template

A comprehensive template for multi-agent AI development workflows combining specialized agent personas with strategic model selection.

## 🚀 Quick Start

### For New Projects
```bash
# Option 1: Use as GitHub template
# 1. Click "Use this template" on GitHub
# 2. Clone your new repository
# 3. Follow setup instructions below

# Option 2: Manual setup
git clone https://github.com/yourusername/multi-agent-template.git my-new-project
cd my-new-project
rm -rf .git
git init
```

### Setup Instructions
```bash
# 1. Configure environment
cp .env.template .env
# Edit .env with your API keys

# 2. Make scripts executable (Unix/Linux/Mac)
chmod +x scripts/*.sh
chmod +x scripts/*.py

# 3. Test the system
./scripts/switch-model.sh research
```

## 📋 What's Included

- **Multi-Agent Workflows**: 10+ specialized agent commands
- **Model Optimization**: Automatic model selection based on task complexity
- **Quality Gates**: Comprehensive quality assurance framework
- **Automation Scripts**: Model switching and workflow orchestration
- **Templates**: Standardized documentation and handoff procedures

## 🛠 Customization

### For Different Project Types

#### Web Development
```bash
# Update CLAUDE.md with web-specific agents
RESEARCH_FOCUS="UI/UX patterns, accessibility, performance"
DESIGN_FOCUS="Component architecture, state management" 
TESTING_FOCUS="Unit, integration, e2e, visual regression"
```

#### API Development  
```bash
# Update CLAUDE.md for backend focus
RESEARCH_FOCUS="API design patterns, security, scalability"
DESIGN_FOCUS="REST/GraphQL design, data modeling"
TESTING_FOCUS="API testing, load testing, security testing"
```

#### Data Science
```bash
# Update CLAUDE.md for data focus
RESEARCH_FOCUS="Data sources, ML algorithms, statistical methods"
DESIGN_FOCUS="Data pipeline, model architecture"
TESTING_FOCUS="Data validation, model testing, performance metrics"
```

### Team Size Adaptations

#### Solo Developer
```bash
export SOLO_MODE=true
export SKIP_PEER_REVIEW=true
export FAST_ITERATION=true
```

#### Large Team (6+ developers)
```bash
export TEAM_SIZE=large
export FORMAL_REVIEW_PROCESS=true
export DOCUMENTATION_REQUIRED=true
```

## 📖 Usage

### Basic Workflow
```bash
# Start with research
/research-phase "your project description"

# Continue through phases
/planning-phase "project requirements"
/design-phase "technical requirements"
/test-first-phase "component to build"
/implement-phase "implementation requirements"
/validate-phase "system to validate"
```

### Automated Workflow
```bash
./scripts/workflow-orchestrator.sh "project-name" "project description"
```

## 🔧 Project Structure

```
project-root/
├── CLAUDE.md                    # Main configuration
├── SETUP.md                     # Setup instructions
├── WORKFLOW.md                  # Process documentation
├── .env.template               # Environment configuration
├── .claude/commands/           # Custom agent commands
├── scripts/                    # Automation tools
└── templates/                  # Documentation templates
```

## 📚 Documentation

- **[SETUP.md](SETUP.md)** - Detailed installation guide
- **[WORKFLOW.md](WORKFLOW.md)** - Complete workflow documentation
- **[CLAUDE.md](CLAUDE.md)** - Agent configuration and model strategy

## 🤝 Contributing

1. Fork this template repository
2. Customize for your domain/use case
3. Share improvements via pull requests
4. Document your adaptations

## 📚 Documentation Access

### Local Documentation Server
```bash
# Serve docs locally at http://localhost:8000
python scripts/serve-docs.py
```

### File Locations
- **Setup Guide**: [SETUP.md](SETUP.md)
- **Workflow Process**: [WORKFLOW.md](WORKFLOW.md)  
- **Template Customization**: [TEMPLATE-GUIDE.md](TEMPLATE-GUIDE.md)
- **Agent Configuration**: [CLAUDE.md](CLAUDE.md)
- **Command Reference**: [.claude/commands/](.claude/commands/)

### Online Documentation
- **GitHub Pages**: [Deploy to gh-pages for public access]
- **Notion/Confluence**: [Import markdown files to your team wiki]
- **GitBook**: [Connect repository for automatic updates]

## 📄 License

MIT License - feel free to use this template for any project.

---

**Ready to start?** Copy this template and customize the agent personas in `CLAUDE.md` for your specific domain and project requirements.