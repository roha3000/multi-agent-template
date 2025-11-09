# Agent Library

This directory contains all specialized agents in YAML + Markdown format.

## Structure

```
agents/
  research/          # Research & Analysis agents
  planning/          # Planning & Strategy agents
  design/            # Architecture & Design agents
  development/       # Implementation agents
  testing/           # Testing & QA agents
  validation/        # Quality & Review agents
  iteration/         # Improvement agents
  quality/           # Quality assurance agents
  devops/            # DevOps & Infrastructure agents
  diet103/           # diet103 specialized agents
```

## Agent Format

Each agent is a Markdown file with YAML frontmatter:

```yaml
---
name: agent-name
display_name: Human Readable Name
model: claude-sonnet-4-5
temperature: 0.7
max_tokens: 8000
capabilities:
  - capability-1
  - capability-2
tools:
  - Read
  - Grep
category: research
priority: high
tags:
  - tag1
  - tag2
---

# Agent Instructions

Your agent instructions here...
```

## Auto-Discovery

Agents are automatically discovered by `AgentLoader` when the framework starts.

## Adding New Agents

1. Create a new `.md` file in the appropriate category directory
2. Add YAML frontmatter with metadata
3. Write agent instructions
4. The agent will be auto-loaded on next run

## Total Agents

- Your specialized agents: 16
- diet103 agents: 10
- orchestr8 agents: 80+ (future)

Total: 100+ specialized agents
