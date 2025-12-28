# Codebase Audit System - Multi-Agent Architecture

**Version:** 1.0
**Date:** 2025-12-27
**Status:** Design Complete

---

## Overview

The Codebase Audit System is a multi-agent system that performs comprehensive analysis of the codebase to identify:
- Unused/orphaned code and components
- Duplicate implementations that should be consolidated
- Stale documentation that doesn't match reality
- Empty/orphaned infrastructure (databases, configs)
- Architecture drift between docs and implementation

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CODEBASE AUDIT SYSTEM                                │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        AUDIT ORCHESTRATOR                              │ │
│  │  • Spawns expert agents in parallel                                    │ │
│  │  • Collects and synthesizes findings                                   │ │
│  │  • Generates consolidated report                                       │ │
│  │  • Creates actionable tasks                                            │ │
│  └───────────────────────────────┬────────────────────────────────────────┘ │
│                                  │                                           │
│         ┌────────────────────────┼────────────────────────┐                 │
│         │                        │                        │                 │
│         ▼                        ▼                        ▼                 │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐          │
│  │ DEAD CODE    │    │  DUPLICATION     │    │  ARCHITECTURE    │          │
│  │ ANALYST      │    │  DETECTIVE       │    │  AUDITOR         │          │
│  │              │    │                  │    │                  │          │
│  │ • Orphaned   │    │ • Similar code   │    │ • Docs vs code   │          │
│  │   modules    │    │   patterns       │    │   comparison     │          │
│  │ • Dead       │    │ • Duplicate      │    │ • Missing docs   │          │
│  │   exports    │    │   implementations│    │ • Stale diagrams │          │
│  │ • Unused     │    │ • Redundant      │    │ • Feature drift  │          │
│  │   imports    │    │   dependencies   │    │                  │          │
│  └──────────────┘    └──────────────────┘    └──────────────────┘          │
│         │                        │                        │                 │
│         ▼                        ▼                        ▼                 │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐          │
│  │ DATABASE     │    │  DOCUMENTATION   │    │  DEPENDENCY      │          │
│  │ INSPECTOR    │    │  REVIEWER        │    │  ANALYZER        │          │
│  │              │    │                  │    │                  │          │
│  │ • Empty DBs  │    │ • Stale docs     │    │ • Unused deps    │          │
│  │ • Orphaned   │    │ • Outdated refs  │    │ • Version issues │          │
│  │   tables     │    │ • Broken links   │    │ • Security vulns │          │
│  │ • Test       │    │ • Missing docs   │    │ • Duplicates     │          │
│  │   artifacts  │    │   for features   │    │                  │          │
│  └──────────────┘    └──────────────────┘    └──────────────────┘          │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         FINDINGS AGGREGATOR                            │ │
│  │                                                                        │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │ │
│  │  │ Audit       │  │ Task        │  │ Architecture│  │ Cleanup     │   │ │
│  │  │ Report      │  │ Generator   │  │ Doc         │  │ Scripts     │   │ │
│  │  │ (markdown)  │  │ (tasks.json)│  │ Updater     │  │ Generator   │   │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Expert Agent Specifications

### 1. Dead Code Analyst

**Purpose:** Identify code that is never used or referenced

**Analysis Methods:**
- Module import graph traversal
- Export usage analysis
- Unreachable code detection
- Deprecated marker detection

**Output:**
```json
{
  "orphanedModules": ["file.js", ...],
  "unusedExports": [{"file": "x.js", "export": "funcName"}, ...],
  "deadCode": [{"file": "x.js", "lines": "10-25", "reason": "unreachable"}],
  "deprecatedInUse": [{"file": "x.js", "deprecated": "oldFunc", "usedBy": [...]}]
}
```

### 2. Duplication Detective

**Purpose:** Find duplicate or highly similar implementations

**Analysis Methods:**
- AST-based similarity detection
- Semantic code comparison
- Pattern recognition across modules
- Concept overlap detection

**Output:**
```json
{
  "duplicateImplementations": [
    {"concept": "usage tracking", "files": ["usage-tracker.js", "claude-limit-tracker.js"], "similarity": 0.85}
  ],
  "similarPatterns": [...],
  "consolidationOpportunities": [...]
}
```

### 3. Architecture Auditor

**Purpose:** Compare documented architecture to actual implementation

**Analysis Methods:**
- Parse architecture diagrams (Mermaid)
- Trace actual code dependencies
- Identify documented-but-not-implemented features
- Identify implemented-but-not-documented features

**Output:**
```json
{
  "documentedNotImplemented": ["VectorStore integration", ...],
  "implementedNotDocumented": ["SwarmController", ...],
  "architectureDrift": [{"doc": "ARCHITECTURE.md", "section": "...", "reality": "..."}],
  "staleDesignDocs": [...]
}
```

### 4. Database Inspector

**Purpose:** Analyze database health and identify cleanup targets

**Analysis Methods:**
- Table row counts
- Schema comparison across DBs
- Identify duplicate databases
- Find orphaned test databases

**Output:**
```json
{
  "emptyDatabases": ["orchestrations.db", ...],
  "duplicateDatabases": [{"primary": "memory.db", "duplicate": "memory-store.db"}],
  "orphanedTestDBs": ["test-parser.db", ...],
  "unusedTables": [...]
}
```

### 5. Documentation Reviewer

**Purpose:** Identify stale, missing, or incorrect documentation

**Analysis Methods:**
- Last-modified vs code-modified comparison
- Broken link detection
- Code reference validation
- Coverage analysis

**Output:**
```json
{
  "staleDocs": [{"file": "x.md", "lastModified": "...", "relatedCodeChanged": "..."}],
  "brokenLinks": [...],
  "outdatedReferences": [...],
  "missingDocs": ["SwarmController has no documentation"]
}
```

### 6. Dependency Analyzer

**Purpose:** Analyze npm dependencies for issues

**Analysis Methods:**
- Unused dependency detection
- Duplicate dependency detection
- Security vulnerability scan
- Version analysis

**Output:**
```json
{
  "unusedDependencies": ["package-name", ...],
  "duplicateDependencies": [...],
  "securityIssues": [...],
  "outdatedPackages": [...]
}
```

## Execution Flow

```
┌──────────────┐
│  /audit      │
│  command     │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│  Phase 1: Parallel Agent Execution                       │
│                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ Dead     │ │ Dup      │ │ Arch     │ │ DB       │   │
│  │ Code     │ │ Detective│ │ Auditor  │ │ Inspector│   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘   │
│       │            │            │            │          │
│       └────────────┴─────┬──────┴────────────┘          │
│                          │                               │
└──────────────────────────┼───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│  Phase 2: Findings Synthesis                             │
│                                                          │
│  • Deduplicate overlapping findings                      │
│  • Prioritize by impact (high/medium/low)                │
│  • Group related issues                                  │
│  • Identify quick wins vs major refactors                │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│  Phase 3: Output Generation                              │
│                                                          │
│  1. AUDIT-REPORT-{date}.md      → Detailed findings      │
│  2. ARCHITECTURE-CURRENT.md     → Updated arch diagram   │
│  3. tasks.json updates          → Cleanup tasks added    │
│  4. scripts/cleanup-{issue}.js  → Auto-fix scripts       │
└──────────────────────────────────────────────────────────┘
```

## Output Artifacts

### 1. Audit Report (docs/audits/AUDIT-REPORT-{date}.md)

```markdown
# Codebase Audit Report - 2025-12-27

## Executive Summary
- **Total Issues Found:** 47
- **Critical:** 3 | **High:** 12 | **Medium:** 20 | **Low:** 12
- **Estimated Cleanup Effort:** ~8 hours

## Critical Findings

### 1. Empty Infrastructure (databases never populated)
- orchestrations.db: 0 records across all tables
- VectorStore: ChromaDB never initialized
- ContextRetriever: Never called in production

**Recommendation:** Remove or implement. Currently wasted complexity.

### 2. Duplicate Implementations
| Concept | Files | Recommendation |
|---------|-------|----------------|
| Usage tracking | usage-tracker.js, claude-limit-tracker.js | Consolidate |
| Memory storage | 4 different DB files | Consolidate to 1 |

...
```

### 2. Architecture Document Update

Auto-generates current reality:
- Mermaid diagrams from actual code
- Component inventory
- Dependency graph
- Data flow based on actual usage

### 3. Cleanup Tasks

Added to tasks.json with proper metadata:

```json
{
  "id": "cleanup-empty-dbs",
  "title": "Remove empty database infrastructure",
  "priority": "high",
  "effort": "2h",
  "category": "cleanup",
  "generatedBy": "audit-2025-12-27",
  "files": ["orchestrations.db", "memory-store.db"]
}
```

## Scheduling

| Trigger | Frequency | Scope |
|---------|-----------|-------|
| `/audit` command | On-demand | Full audit |
| `/audit --quick` | On-demand | Critical issues only |
| GitHub Actions | Weekly | Full audit with PR |
| Pre-release hook | Before version bump | Full audit, block if critical |

## Integration Points

- **tasks.json:** Cleanup tasks auto-added
- **PROJECT_SUMMARY.md:** Audit summary appended
- **GitHub Actions:** Weekly scheduled audit
- **Pre-commit hook:** Quick audit on large changes
