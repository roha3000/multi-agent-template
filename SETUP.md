# SETUP.md - Installation and Configuration Guide

## Prerequisites

### 1. Required Accounts & Subscriptions
- **Anthropic Account**: With Claude Max subscription ($100-200/month recommended)
- **OpenAI Account**: For GPT-4o and o1-preview access (optional but recommended)
- **GitHub Account**: For version control and CI/CD integration

### 2. System Requirements
- **Operating System**: macOS, Linux, or Windows with WSL2
- **Terminal**: Modern terminal with color support
- **Git**: Version 2.20+ for worktree support
- **Node.js**: 16+ (if working with JavaScript projects)
- **Python**: 3.8+ (for external model integration)

## Installation Steps

### Step 1: Install Claude Code
```bash
# Install Claude Code CLI
curl -sSL https://install.anthropic.com/claude-code | sh

# Verify installation
claude --version

# Authenticate with Anthropic
claude auth login
```

### Step 2: Clone System Templates
```bash
# Create new project with unified system
mkdir my-project && cd my-project
git init

# Download system files (replace with your preferred method)
curl -O https://raw.githubusercontent.com/[your-repo]/claude-unified-system/main/CLAUDE.md
curl -O https://raw.githubusercontent.com/[your-repo]/claude-unified-system/main/.env.template

# Create directory structure
mkdir -p docs .claude/commands scripts templates
```

### Step 3: Configure Environment Variables
```bash
# Copy template and configure
cp .env.template .env

# Edit with your API keys
nano .env
```

Add your API keys to `.env`:
```bash
# API Keys
ANTHROPIC_API_KEY=your_anthropic_key_here
OPENAI_API_KEY=your_openai_key_here

# Model Configurations
RESEARCH_MODEL=claude-sonnet-4.5
PLANNING_MODEL=claude-sonnet-4.5
DESIGN_ARCHITECTURE_MODEL=claude-sonnet-4.5
DESIGN_IMPLEMENTATION_MODEL=claude-sonnet-4-20250514
TESTING_MODEL=claude-sonnet-4-20250514
IMPLEMENTATION_MODEL=claude-sonnet-4-20250514
VALIDATION_MODEL=claude-sonnet-4.5
ITERATION_STRATEGY_MODEL=claude-sonnet-4.5
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

# Cost Management
ENABLE_COST_TRACKING=true
DAILY_TOKEN_LIMIT=50000
ALERT_THRESHOLD=0.8
```

### Step 4: Install Scripts and Dependencies
```bash
# Download script files
cd scripts/

# Model switching script
cat > switch-model.sh << 'EOF'
#!/bin/bash
# switch-model.sh - Model switching automation
PHASE=$1
case $PHASE in
  "research"|"planning"|"design"|"validation"|"iteration")
    export CLAUDE_MODEL="claude-sonnet-4.5"
    echo "Switched to Claude Sonnet 4.5 for $PHASE phase"
    ;;
  "testing"|"implementation"|"debug")
    export CLAUDE_MODEL="claude-sonnet-4-20250514"
    echo "Switched to Claude Sonnet 4 for $PHASE phase"
    ;;
  *)
    echo "Usage: $0 {research|planning|design|testing|implementation|debug|validation|iteration}"
    exit 1
    ;;
esac
claude --model $CLAUDE_MODEL
EOF

# Make executable
chmod +x switch-model.sh

# Install Python dependencies for external models
pip install openai requests python-dotenv
```

### Step 5: Create Command Templates
```bash
cd ../.claude/commands/

# Download all command templates (or create manually)
# research-phase.md, planning-phase.md, etc.
```

### Step 6: IDE Integration Setup

#### VS Code Setup
```bash
# Install Claude Code extension
code --install-extension anthropic.claude-code

# Configure VS Code settings
mkdir -p .vscode
cat > .vscode/settings.json << 'EOF'
{
  "claude.enableMultiModel": true,
  "claude.defaultModel": "claude-sonnet-4-20250514",
  "claude.researchModel": "claude-sonnet-4.5",
  "claude.planningModel": "claude-sonnet-4.5",
  "terminal.integrated.defaultProfile.osx": "bash",
  "files.associations": {
    "CLAUDE.md": "markdown",
    "*.claude": "markdown"
  }
}
EOF
```

#### Cursor Setup (Optional)
```bash
# Install Cursor if desired for rapid coding phases
# Configure as secondary IDE for implementation support
```

### Step 7: Git Configuration
```bash
# Configure git for multi-agent workflows
git config --local commit.template .gitmessage

# Create commit message template
cat > .gitmessage << 'EOF'
[AGENT] [PHASE]: Brief description

Agent: [Research Analyst|Strategic Planner|System Architect|Test Engineer|Senior Developer|etc.]
Phase: [Research|Planning|Design|Testing|Implementation|Validation|Iteration]
Model: [claude-sonnet-4.5|claude-sonnet-4-20250514|gpt-4o|o1-preview]

Detailed description:
- What was accomplished
- Key decisions made
- Next steps required

Quality Score: __/100
Reviewed by: [Agent names]
EOF

# Configure branch naming for agent work
git config --local branch.autosetupmerge always
git config --local branch.autosetuprebase always
```

## Verification & Testing

### Test Basic Claude Code Functionality
```bash
# Test basic Claude Code connection
claude --version
claude auth status

# Test model switching
./scripts/switch-model.sh research
./scripts/switch-model.sh implementation

# Test custom commands (after creating them)
claude
> /help
> /research-phase "test topic"
```

### Test External Model Integration
```bash
# Test Python script functionality
cd scripts/
python external-models.py research "test authentication patterns"
python external-models.py planning "simple web application"
```

### Test Multi-Agent Workflow
```bash
# Start a simple test workflow
./scripts/workflow-orchestrator.sh "test-project" "simple todo application"

# Follow the guided process through each phase
```

## Project Initialization

### For New Projects
```bash
# Create project structure
mkdir my-new-project && cd my-new-project

# Copy unified system files
cp -r /path/to/claude-unified-system/* .

# Initialize git
git init
git add .
git commit -m "[SETUP] [INITIALIZATION]: Initial project setup with unified Claude system

Agent: System Administrator
Phase: Initialization
Model: N/A

- Copied unified multi-agent multi-model system
- Configured environment variables
- Set up development workflow structure
- Ready for research phase

Quality Score: N/A
Reviewed by: Human Developer"

# Start first workflow
./scripts/workflow-orchestrator.sh "$(basename $PWD)" "Your project description here"
```

### For Existing Projects
```bash
# Navigate to existing project
cd existing-project

# Add unified system (backup first!)
cp -r /path/to/claude-unified-system/.claude .
cp /path/to/claude-unified-system/CLAUDE.md .
cp /path/to/claude-unified-system/scripts .
cp /path/to/claude-unified-system/.env.template .env

# Update CLAUDE.md with your project specifics
nano CLAUDE.md

# Configure environment
nano .env

# Test integration
claude
> /help
```

## Troubleshooting Installation

### Common Issues

#### Claude Code Installation Fails
```bash
# Check internet connectivity
curl -I https://install.anthropic.com

# Manual installation
wget https://install.anthropic.com/claude-code
chmod +x claude-code
sudo mv claude-code /usr/local/bin/claude
```

#### Authentication Issues
```bash
# Clear authentication cache
claude auth logout
claude auth login

# Check API key validity
curl -H "x-api-key: $ANTHROPIC_API_KEY" \
     https://api.anthropic.com/v1/messages \
     -d '{"model":"claude-sonnet-4-20250514","max_tokens":10,"messages":[{"role":"user","content":"test"}]}'
```

#### Permission Issues
```bash
# Fix script permissions
chmod +x scripts/*.sh

# Fix Python script permissions
chmod +x scripts/*.py

# Set up sudo-free Docker (if using containers)
sudo usermod -aG docker $USER
```

#### Model Switching Issues
```bash
# Debug model configuration
echo $CLAUDE_MODEL
echo $ANTHROPIC_API_KEY

# Test manual model selection
claude --model claude-sonnet-4.5
claude --model claude-sonnet-4-20250514
```

### Performance Optimization

#### Reduce Token Usage
```bash
# Use /clear command frequently
# Set conservative token limits in .env
# Use Sonnet 4 for most tasks, Sonnet 4.5 only for complex analysis

# Monitor usage
claude usage --daily
claude usage --monthly
```

#### Speed Up Workflows
```bash
# Use parallel git worktrees for multi-agent work
git worktree add ../feature-ui feature/ui
git worktree add ../feature-api feature/api

# Skip permissions for trusted environments
claude --dangerously-skip-permissions
```

#### Cost Management
```bash
# Set up usage alerts
export ANTHROPIC_DAILY_LIMIT=100
export ANTHROPIC_ALERT_EMAIL=your-email@domain.com

# Use cost tracking script
python scripts/cost-tracker.py --daily-report
```

## Next Steps

After successful setup:

1. **Read WORKFLOW.md** - Understand the complete development process
2. **Review MODEL-STRATEGY.md** - Learn when to use which models
3. **Start with a simple project** - Test the system end-to-end
4. **Customize for your needs** - Adapt agent personas and workflows
5. **Join the community** - Share experiences and improvements

## Support

### Getting Help
- **Documentation**: Read all .md files in docs/ directory
- **Community**: Join Claude Code Discord/Forums
- **Issues**: Check TROUBLESHOOTING.md for common problems
- **Updates**: Follow @AnthropicAI for Claude Code updates

### Contributing Improvements
- Fork the unified system repository
- Submit improvements via pull requests
- Share custom agent personas and workflows
- Document your adaptations for different project types

---

You're now ready to use the unified multi-agent multi-model development system! Start with a simple project to get familiar with the workflows, then gradually adopt more advanced patterns as you become comfortable with the system.
