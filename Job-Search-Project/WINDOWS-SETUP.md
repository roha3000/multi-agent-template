# Windows Setup Guide for Job Search Project

## 🖥️ Windows-Specific Instructions

### Prerequisites
- Claude Code CLI installed and authenticated
- Git for Windows installed
- Node.js 18+ (if you plan to develop the actual application)

### Project Setup After Moving

1. **Move the project to Claude Projects folder:**
   ```cmd
   cd "C:\Users\roha3\Claude Projects"
   xcopy "Multi-agent\Job-Search-Project" "Job-Search-Project" /E /I /H
   ```

2. **Navigate to your project:**
   ```cmd
   cd "C:\Users\roha3\Claude Projects\Job-Search-Project"
   ```

3. **Configure environment:**
   ```cmd
   copy .env.template .env
   notepad .env
   REM Add your API keys to the .env file
   ```

## 🤖 Using Multi-Agent Workflow on Windows

### Method 1: Direct Claude Code Commands (Recommended)
```cmd
# For research phase (uses Claude Opus)
claude --model claude-opus-4
# Then in Claude Code, type: /research-phase "your project description"

# For implementation phase (uses Claude Sonnet)
claude --model claude-sonnet-4-20250514
# Then in Claude Code, type: /implement-phase "your requirements"
```

### Method 2: Use Windows Batch Files
```cmd
# Switch models easily
scripts\switch-model.bat research
scripts\switch-model.bat implementation
scripts\switch-model.bat testing

# Run complete workflow
scripts\workflow-orchestrator.bat "Job-Search-Platform" "AI-powered job search platform"
```

## 🚀 Quick Start Workflow

### 1. Start with Research
```cmd
# Switch to research model
scripts\switch-model.bat research

# This opens Claude Code with Opus model
# Then execute: /research-phase "comprehensive job search platform with AI matching"
```

### 2. Continue to Planning
```cmd
# Switch to planning model  
scripts\switch-model.bat planning

# In Claude Code: /planning-phase "6-month timeline, full-stack team, MVP then premium features"
```

### 3. Design Phase
```cmd
# Switch to design model
scripts\switch-model.bat design

# In Claude Code: /design-phase "scalable job platform with search, matching, and ATS features"
```

### 4. Implementation Phase
```cmd
# Switch to implementation model
scripts\switch-model.bat implementation

# In Claude Code: /implement-phase "job CRUD API, user profiles, advanced search"
```

## 📋 Available Windows Scripts

### switch-model.bat
**Usage:** `scripts\switch-model.bat [phase]`

**Available phases:**
- `research` - Claude Opus for deep analysis
- `planning` - Claude Opus for strategic planning
- `design` - Claude Opus for architecture  
- `testing` - Claude Sonnet for test development
- `implementation` - Claude Sonnet for coding
- `validation` - Claude Opus for quality review
- `iteration` - Claude Opus for improvements
- `debug` - Claude Sonnet for debugging

### workflow-orchestrator.bat
**Usage:** `scripts\workflow-orchestrator.bat "project-name" "description"`

**Example:**
```cmd
scripts\workflow-orchestrator.bat "Job-Search-Platform" "AI-powered job search platform with advanced matching"
```

## 🎯 Job Search Project Development

### Recommended Development Flow:
1. **Research** → Analyze job market and competitors
2. **Planning** → Create detailed roadmap and milestones  
3. **Design** → Architecture for scalable job platform
4. **Testing** → TDD approach with comprehensive tests
5. **Implementation** → Build core features (auth, search, applications)
6. **Validation** → Quality gates and cross-agent review
7. **Iteration** → Continuous improvement and feature additions

### Key Features to Implement:
- **Job Seekers**: Smart search, AI recommendations, application tracking
- **Employers**: ATS, candidate matching, job posting, analytics
- **AI Features**: Semantic job search, resume parsing, salary insights

## 🔧 Troubleshooting

### If batch files don't work:
1. Make sure you're in the correct directory
2. Check that Claude Code is installed and in your PATH
3. Use direct commands instead:
   ```cmd
   claude --model claude-opus-4
   claude --model claude-sonnet-4-20250514
   ```

### If commands don't execute:
1. Ensure Claude Code is authenticated: `claude auth status`
2. Check your internet connection
3. Verify API keys in .env file

## 📚 Next Steps

1. Move project to main Claude Projects folder
2. Set up .env with your API keys
3. Start with research phase using Windows commands
4. Follow the multi-agent workflow through all phases
5. Build your AI-powered job search platform!

---

**Ready to build on Windows?** 🖥️🚀