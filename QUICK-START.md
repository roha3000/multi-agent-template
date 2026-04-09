# Quick Start Guide

Get up and running with the Multi-Agent Template in 5 minutes.

## Create New Project from Template

### Method 1: GitHub Template Button
1. Go to: https://github.com/roha3000/multi-agent-template
2. Click **"Use this template"** → **"Create a new repository"**
3. Name your project and clone it locally

### Method 2: Local Script
```bash
# Clone the template
git clone https://github.com/roha3000/multi-agent-template.git my-new-project
cd my-new-project

# Remove git history and start fresh
rm -rf .git
git init
git add .
git commit -m "Initial commit from multi-agent template"

# Create your own GitHub repo and push
git remote add origin https://github.com/yourusername/your-new-project.git
git push -u origin main
```

## Quick Setup

1. **Open Claude Code in your project directory:**
   ```bash
   cd my-new-project
   claude
   ```

2. **Initialize your session:**
   ```
   /session-init
   ```
   This reads the dev-docs files and detects the current project phase. On a new project, it will prompt you to start with the research phase.

3. **Start Your First Workflow:**
   ```
   /research-phase "your project idea"
   ```

## Example: Building a Todo App

```bash
# 1. Research phase
/research-phase "Modern todo application with React frontend and Node.js backend"

# 2. Planning phase
/planning-phase "Todo app with user authentication, real-time updates, 2-week timeline"

# 3. Design phase
/design-phase "REST API with JWT auth, React frontend, PostgreSQL database"

# 4. Test-first development
/test-first-phase "User registration and authentication system"

# 5. Implementation
/implement-phase "Authentication API endpoints with JWT tokens"

# 6. Validation
/validate-phase "Complete authentication system"

# 7. Iteration
/iterate-phase "Add password reset and email verification features"
```

## Optional: Install Codex

For AI-powered code review and security auditing, install the Codex plugin. See [SETUP.md](SETUP.md) for full installation instructions.

After setup, use:
- `/codex-review` — Static analysis + triage before merging
- `/codex-adversarial` — Security red-team review before production

## Project Types

The template adapts automatically for:
- **Web Apps**: Frontend/fullstack applications
- **APIs**: Backend services and microservices
- **Data Projects**: ML/AI and data analysis
- **Mobile Apps**: React Native, Flutter, etc.
- **Desktop Apps**: Electron, desktop frameworks

## Need Help?

- **Documentation**: [SETUP.md](SETUP.md) | [WORKFLOW.md](WORKFLOW.md)
- **Issues**: https://github.com/roha3000/multi-agent-template/issues
- **Discussions**: https://github.com/roha3000/multi-agent-template/discussions

---

**Ready to build something amazing?**
