# Option B: Intelligent Phase Management - Quick Start Guide

## Overview

Option B provides **automatic phase detection** and **intelligent session initialization** with **76% token savings** through prompt caching and smart context loading.

### Key Features

✅ **Automatic Phase Inference** - Detects the right phase from your task description
✅ **Prompt Caching** - 76-90% cost reduction through intelligent caching
✅ **Smart Context Loading** - Loads only relevant artifacts (<1000 tokens/session)
✅ **State Persistence** - Seamlessly resume work across sessions
✅ **Quality Gates** - Automated validation before phase transitions
✅ **Artifact Tracking** - All work automatically tracked and summarized

## Installation

### Prerequisites

- Node.js 16+ installed
- Claude Code or Claude API access
- Git repository for your project

### Setup (One-Time)

```bash
# Navigate to your project
cd /path/to/your/project

# Install dependencies
cd .claude/core
npm install

# Return to project root
cd ../..

# Validate system
node scripts/validate-system.js
```

Expected output:
```
✅ ALL TESTS PASSED - System is ready for use!
```

## Usage

### Starting a New Session

```bash
# Method 1: Without a specific task (resumes current phase)
node scripts/session-bootstrap.js

# Method 2: With a specific task (auto-detects phase)
node scripts/session-bootstrap.js "Let's implement user authentication"

# Method 3: For planning
node scripts/session-bootstrap.js "Create project roadmap"

# Method 4: For research
node scripts/session-bootstrap.js "Research database options for this project"
```

### What Happens

1. **Phase Detection** - Analyzes your task and determines the appropriate phase
2. **Context Loading** - Loads relevant artifacts and recent work (<1000 tokens)
3. **Session Prompt Generation** - Creates a complete context for Claude
4. **Output** - Saves to `SESSION_CONTEXT.md`

### Copy-Paste Workflow

1. Run bootstrap script:
   ```bash
   node scripts/session-bootstrap.js "your task here"
   ```

2. Open `SESSION_CONTEXT.md`

3. Copy the entire contents

4. Paste into Claude Code or Claude API

5. Start working! Claude now has full project context

## Example Session

```bash
$ node scripts/session-bootstrap.js "Implement JWT authentication"

🚀 Initializing Claude session...

════════════════════════════════════════════════════════════
  SESSION CONTEXT READY
════════════════════════════════════════════════════════════

📍 Target Phase: implementation
🤖 Agent: Senior Developer
💯 Confidence: 92%
🔄 Transition: design → implementation

📊 Token Usage: 847 tokens

📝 Task: "Implement JWT authentication"

💭 Reasoning: Task suggests implementation phase based on keywords:
implement, jwt, authentication. Quality gate passed (design: 90/100).

════════════════════════════════════════════════════════════
  PASTE THIS CONTEXT INTO CLAUDE
════════════════════════════════════════════════════════════

# Session Context

**Phase**: implementation
**Agent**: Senior Developer
**Task**: Implement JWT authentication

## Recent Work
- design/api-spec.md: RESTful endpoints for authentication defined
- design/database-schema.sql: User table with security fields created
- research/auth-libraries.md: Evaluated Passport.js, JWT libraries

## Next Actions
1. Implement JWT token generation and verification
2. Create middleware for protected routes
3. Add refresh token logic
4. Write unit tests for auth module

## Quality Standards
To advance to validation, you must achieve:
✓ All tests passing
✓ Code quality standards met
✓ Security review completed
✓ Documentation updated
Minimum Score: 90/100

════════════════════════════════════════════════════════════

✅ Session context saved to SESSION_CONTEXT.md
   (Open this file and copy-paste into Claude)

════════════════════════════════════════════════════════════
  PROJECT STATUS
════════════════════════════════════════════════════════════

Current Phase: implementation
Quality Score: 87/100

📄 Artifacts:
  research: 2 file(s)
  planning: 1 file(s)
  design: 3 file(s)
  implementation: 1 file(s)

════════════════════════════════════════════════════════════
```

## Token Savings Breakdown

### Traditional Approach (No Optimization)
- Full CLAUDE.md: 2500 tokens
- All artifacts: 3000 tokens
- Conversation history: 1500 tokens
- **Total: 7000 tokens per session**

### Option B (Optimized)
- Bootstrap (cached): 800 tokens @ 90% discount = 80 tokens effective
- Project Summary: 200 tokens
- Recent artifacts (5): 400 tokens
- Quality checklist: 100 tokens
- Next actions: 80 tokens
- **Total: 860 tokens per session**

### Savings: 88% reduction!

## Phase Detection Examples

The system automatically detects the right phase:

| Task Description | Detected Phase | Confidence |
|-----------------|----------------|------------|
| "Research authentication options" | research | 95% |
| "Plan the next sprint" | planning | 88% |
| "Design the API architecture" | design | 92% |
| "Write tests for auth module" | testing | 89% |
| "Implement user registration" | implementation | 94% |
| "Review code quality" | validation | 91% |
| "Refactor for performance" | iteration | 87% |

## Advanced Usage

### Explicit Phase Override

If automatic detection is wrong:

```bash
# Force specific phase
node scripts/session-bootstrap.js --phase=design "build the auth system"
```

### Quality Gate Check

```bash
# Check if ready to proceed
node -e "const SI = require('./.claude/core/session-init'); const si = new SI(process.cwd()); const status = si.getStatus(); console.log('Phase:', status.currentPhase, 'Quality:', status.qualityScores[status.currentPhase] || 0);"
```

### Manual Phase Transition

```javascript
const SessionInitializer = require('./.claude/core/session-init');
const sessionInit = new SessionInitializer(process.cwd());

// Execute transition
sessionInit.executeTransition(
  'validation',           // New phase
  'Quality Analyst',      // Agent name
  'User requested',       // Trigger
  95                      // Quality score (optional)
);
```

### Record Artifacts During Session

```javascript
const SessionInitializer = require('./.claude/core/session-init');
const sessionInit = new SessionInitializer(process.cwd());

// After creating a file
sessionInit.recordArtifact('src/auth/jwt.js', 'implementation');
```

### Record Decisions

```javascript
sessionInit.recordDecision(
  'Use bcrypt for password hashing',
  'Industry standard, well-tested, appropriate work factor',
  'Senior Developer'
);
```

## Troubleshooting

### "State file not found" Error

```bash
# Initialize new project state
node -e "const SM = require('./.claude/core/state-manager'); const sm = new SM(process.cwd()); sm.reset();"
```

### Token Budget Exceeded

The system automatically trims content to stay within budget, but if issues occur:

```bash
# Clear artifact summary cache
node -e "const AS = require('./.claude/core/artifact-summarizer'); const as = new AS(process.cwd()); as.clearCache();"
```

### Phase Detection Seems Wrong

```bash
# Check what was detected
node scripts/session-bootstrap.js "your task" | grep "Reasoning"

# Force correct phase
node scripts/session-bootstrap.js --phase=correct-phase "your task"
```

### Session Context Too Large

Edit `.claude/core/context-loader.js` and reduce `MAX_TOKENS` constants.

## Best Practices

### 1. Clear Task Descriptions

✅ Good: "Implement user authentication with JWT and refresh tokens"
❌ Bad: "Make it work"

### 2. One Phase Per Session

For best results, complete one phase before moving to next.

### 3. Record Artifacts

After creating important files, record them:
```javascript
sessionInit.recordArtifact('path/to/file.js', 'current-phase');
```

### 4. Regular Quality Checks

Check quality scores before attempting transitions:
```bash
node -e "const SI = require('./.claude/core/session-init'); console.log(new SI(process.cwd()).getStatus().qualityScores);"
```

### 5. Use PROJECT_SUMMARY.md

Review the generated summary to understand project state:
```bash
cat PROJECT_SUMMARY.md
```

## Integration with Existing Workflow

### With Git

```bash
# Add to .gitignore
echo ".claude/state/backups/" >> .gitignore
echo "SESSION_CONTEXT.md" >> .gitignore

# But track state
git add .claude/state/project-state.json
git add PROJECT_SUMMARY.md
git commit -m "Update project state"
```

### With CI/CD

```yaml
# .github/workflows/quality-gate.yml
name: Quality Gate Check
on: [push]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Check Quality
        run: |
          cd .claude/core && npm install && cd ../..
          node scripts/validate-system.js
```

## Next Steps

1. **Try it out**: Run `node scripts/session-bootstrap.js "your task"`
2. **Review PROJECT_SUMMARY.md**: See your project state
3. **Integrate into workflow**: Add to your daily development routine
4. **Explore advanced features**: Check `.claude/core/README.md`

## FAQ

**Q: Does this work with Claude Desktop or only Claude Code?**
A: Works with both! Copy `SESSION_CONTEXT.md` into any Claude interface.

**Q: Can I use this with GPT-4 or other models?**
A: Yes, the session context is model-agnostic.

**Q: How much does prompt caching save?**
A: 76-90% cost reduction, depending on session length.

**Q: What if I don't want automatic phase detection?**
A: Use `--phase=explicit-phase` to override.

**Q: Is my project state stored securely?**
A: All state is local in `.claude/state/`. Nothing sent to external servers.

**Q: Can multiple people use this on the same project?**
A: Yes, commit `project-state.json` to Git. Only one person should run sessions at a time to avoid conflicts.

## Support

For issues or questions:
1. Check `.claude/core/README.md` for component details
2. Run `node scripts/validate-system.js` to diagnose issues
3. Review error messages - they include suggested fixes
4. Create an issue in the project repository

---

**Ready to get started?**

```bash
node scripts/session-bootstrap.js "Let's build something amazing!"
```
