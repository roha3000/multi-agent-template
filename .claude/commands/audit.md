---
name: Codebase Audit
description: Multi-agent comprehensive codebase audit for unused code, duplicates, stale docs, and architecture drift
tags: audit, cleanup, maintenance, architecture
---

# Codebase Audit - Multi-Agent Analysis

Execute a comprehensive codebase audit using specialized expert agents running in parallel.

## Audit Scope

This audit analyzes:
1. **Dead Code** - Orphaned modules, unused exports, unreachable code
2. **Duplications** - Duplicate implementations, redundant databases, concept overlaps
3. **Architecture Drift** - Docs vs reality, undocumented features, stale designs
4. **Database Health** - Empty DBs, orphaned test artifacts, duplicate schemas
5. **Documentation** - Stale docs, broken links, missing coverage
6. **Dependencies** - Unused packages, security issues, outdated versions

## Execution Protocol

### Phase 1: Launch Expert Agents in Parallel

Spawn 6 expert agents simultaneously using the Task tool:

**Agent 1: Dead Code Analyst**
```
Read the agent definition at .claude/agents/audit/dead-code-analyst.md

Analyze all JavaScript files in the codebase (excluding node_modules, tests):
1. Build complete import/export graph for .claude/core/*.js, scripts/*.js, root *.js
2. Identify orphaned modules (not imported anywhere)
3. Find unused exports (exported but never imported)
4. Detect deprecated code still in use
5. Return findings as structured JSON per the agent spec
```

**Agent 2: Duplication Detective**
```
Read the agent definition at .claude/agents/audit/duplication-detective.md

Analyze for duplicate implementations:
1. Map all files to concepts (usage tracking, memory storage, orchestration, etc.)
2. Identify duplicate implementations of same concept
3. Find duplicate databases with same schemas
4. Identify consolidation opportunities
5. Return findings as structured JSON per the agent spec
```

**Agent 3: Architecture Auditor**
```
Read the agent definition at .claude/agents/audit/architecture-auditor.md

Compare documented vs actual architecture:
1. Parse all architecture docs (docs/*ARCHITECTURE*.md, docs/*DESIGN*.md)
2. Extract documented components and relationships
3. Analyze actual code structure and dependencies
4. Identify documented-but-not-implemented features
5. Identify implemented-but-not-documented components
6. Generate current-state Mermaid diagram
7. Return findings as structured JSON per the agent spec
```

**Agent 4: Database Inspector**
```
Read the agent definition at .claude/agents/audit/database-inspector.md

Analyze all SQLite databases:
1. Find all .db files (excluding node_modules)
2. For each: count tables, count rows, check last modified
3. Identify empty databases
4. Identify duplicate schemas across DBs
5. Find orphaned test databases
6. Return findings as structured JSON per the agent spec
```

**Agent 5: Documentation Reviewer**
```
Read the agent definition at .claude/agents/audit/documentation-reviewer.md

Analyze all documentation:
1. Inventory all .md files in docs/, root, .claude/
2. Calculate freshness score for each
3. Validate all internal links
4. Check code references still exist
5. Identify archive candidates
6. Return findings as structured JSON per the agent spec
```

**Agent 6: Dependency Analyzer**
```
Read the agent definition at .claude/agents/audit/dependency-analyzer.md

Analyze package dependencies:
1. Parse package.json and package-lock.json
2. Search codebase for actual usage of each dependency
3. Identify unused dependencies
4. Check for security vulnerabilities (npm audit style)
5. Find outdated packages
6. Return findings as structured JSON per the agent spec
```

### Phase 2: Synthesize Findings

After all agents complete:

1. **Collect all agent outputs** into unified findings object
2. **Deduplicate overlapping findings** (e.g., same file flagged by multiple agents)
3. **Prioritize by impact**:
   - Critical: Security issues, major architecture drift
   - High: Duplicate implementations, empty infrastructure
   - Medium: Stale docs, unused dependencies
   - Low: Minor cleanup opportunities

4. **Calculate metrics**:
   - Total issues found
   - Estimated cleanup effort (hours)
   - Code reduction potential (lines)
   - Storage savings (MB)

### Phase 3: Generate Outputs

Create the following artifacts:

**1. Audit Report** → `docs/audits/AUDIT-REPORT-{YYYY-MM-DD}.md`
```markdown
# Codebase Audit Report - {date}

## Executive Summary
- Total Issues: X
- Critical: X | High: X | Medium: X | Low: X
- Estimated Cleanup: Xh
- Potential Savings: X lines code, X MB storage

## Critical Findings
{top issues requiring immediate attention}

## Dead Code
{orphaned modules, unused exports}

## Duplications
{duplicate implementations, databases}

## Architecture
{drift between docs and reality}

## Documentation
{stale docs, archive candidates}

## Dependencies
{unused, outdated, security issues}

## Recommended Actions
{prioritized cleanup tasks}
```

**2. Updated Architecture Doc** → `docs/ARCHITECTURE-CURRENT.md`
```markdown
# Current Architecture - Auto-Generated

{Mermaid diagrams from actual code}
{Component inventory}
{Data flow based on reality}
```

**3. Cleanup Tasks** → Add to `.claude/dev-docs/tasks.json`

Add tasks with:
```json
{
  "id": "audit-cleanup-{issue}",
  "title": "{description}",
  "priority": "{critical|high|medium|low}",
  "effort": "{Xh}",
  "category": "cleanup",
  "generatedBy": "audit-{date}",
  "status": "pending"
}
```

**4. Cleanup Scripts** → `scripts/audit-cleanup-{date}.js`

Generate executable cleanup script for:
- Deleting orphaned files
- Removing empty databases
- Archiving stale docs

### Phase 4: Summary Report

Output to user:
- Count of issues by severity
- Top 5 quick wins (high impact, low effort)
- Top 3 major refactoring opportunities
- Link to full audit report

## Options

- `--quick` : Only run critical checks (dead code, security)
- `--scope=docs` : Only audit documentation
- `--scope=code` : Only audit code
- `--scope=deps` : Only audit dependencies
- `--dry-run` : Generate report but don't create tasks/scripts
- `--auto-fix` : Automatically apply safe fixes (unused deps, test artifacts)

## Scheduling

This audit can be triggered:
- Manually via `/audit` command
- Weekly via GitHub Actions (see `.github/workflows/weekly-audit.yml`)
- Pre-release via version hook
