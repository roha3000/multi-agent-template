# Architecture - Canonical Components & Standards

## Purpose

This file defines:
1. **Single canonical implementations** for major system components
2. **Documentation organization standards**
3. **Design phase requirements**

**CHECK THIS FILE DURING DESIGN PHASE** - Before designing any new component, verify it doesn't duplicate existing functionality.

---

## Single Implementation Rule

These components have ONE implementation. **NEVER create parallels.**

### Dashboard
| Attribute | Value |
|-----------|-------|
| **Canonical File** | `global-context-manager.js` |
| **Port** | 3033 |
| **Rule** | ALL dashboard features, APIs, and UI go here |
| **Violations** | Do NOT create new Express servers, dashboard-*.js files, or alternative ports |

### Orchestrator
| Attribute | Value |
|-----------|-------|
| **Canonical File** | `autonomous-orchestrator.js` |
| **Rule** | ALL task orchestration, Claude Code spawning, phase execution goes here |
| **Violations** | Do NOT create new *-orchestrator.js files or parallel execution engines |

### Context Tracking
| Attribute | Value |
|-----------|-------|
| **Canonical File** | `.claude/core/global-context-tracker.js` |
| **Rule** | ALL context window tracking, token counting, usage monitoring goes here |
| **Violations** | Do NOT create new *-context-tracker.js or *-context-*.js files |

### Database (MemoryStore)
| Attribute | Value |
|-----------|-------|
| **Canonical Path** | `.claude/data/memory.db` |
| **Rule** | ALL MemoryStore consumers use this single path |
| **Violations** | Do NOT hardcode alternative DB paths in new code |

### Safety/Validation
| Attribute | Value |
|-----------|-------|
| **Canonical File** | `.claude/core/swarm-controller.js` |
| **Components** | SecurityValidator, ComplexityAnalyzer, ConfidenceMonitor, PlanEvaluator |
| **Rule** | ALL safety checks go through SwarmController |
| **Violations** | Do NOT create parallel safety/validation systems |

---

## Documentation Organization Standards

### Project Root (/) - Only These Files

| File | Purpose |
|------|---------|
| `README.md` | Project overview, getting started |
| `SETUP.md` | Installation and environment setup |
| `QUICK-START.md` | Fast-track usage guide |
| `CLAUDE.md` | Claude Code instructions (auto-loaded) |
| `PROJECT_SUMMARY.md` | Current session state |
| `SESSION_CONTEXT.md` | Session context handoff |
| `CONTRIBUTING.md` | Contribution guidelines (if open source) |
| `LICENSE` | License file |
| `CHANGELOG.md` | Version history |

**Rule**: Everything else goes in `docs/` or `.claude/`.

### docs/ Folder Structure

```
docs/
├── architecture/           # System design documents
│   ├── SYSTEM-OVERVIEW.md
│   ├── DASHBOARD-ARCHITECTURE.md
│   └── DATABASE-SCHEMA.md
│
├── guides/                 # How-to guides
│   ├── INTEGRATION-GUIDE.md
│   ├── MULTI-AGENT-GUIDE.md
│   └── USAGE-GUIDE.md
│
├── features/               # Feature documentation
│   ├── DASHBOARD-FEATURES.md
│   ├── CONTEXT-TRACKING.md
│   └── TASK-CLAIMING.md
│
├── research/               # Research and analysis
│   ├── DASHBOARD-V3-RESEARCH.md
│   └── PATTERNS-RESEARCH.md
│
├── api/                    # API documentation
│   ├── API-REFERENCE.md
│   └── ENDPOINTS.md
│
├── audits/                 # Audit results
│   └── audit-YYYY-MM-DD.json
│
└── archive/                # Completed/stale docs
    ├── MIGRATION-PLAN.md
    └── OLD-ROADMAP.md
```

### .claude/ Folder Structure

```
.claude/
├── ARCHITECTURE.md         # This file - canonical components
├── dev-docs/               # Development state
│   ├── plan.md
│   ├── tasks.json
│   └── archives/
├── core/                   # Core modules (no docs here except README.md)
├── agents/                 # Agent definitions
├── commands/               # Slash commands
└── skills/                 # Skill definitions
```

### Document Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Architecture | `*-ARCHITECTURE.md` | `DASHBOARD-ARCHITECTURE.md` |
| Design | `*-DESIGN.md` | `FEATURE-DESIGN.md` |
| Guide | `*-GUIDE.md` | `INTEGRATION-GUIDE.md` |
| Research | `*-RESEARCH.md` | `PATTERNS-RESEARCH.md` |
| Implementation Plan | `*-IMPLEMENTATION-PLAN.md` | `V3-IMPLEMENTATION-PLAN.md` |
| Specification | `*-SPECIFICATION.md` or `*-SPEC.md` | `API-SPEC.md` |

### When to Archive

Move to `docs/archive/` when:
- Migration/roadmap is complete
- Feature has shipped and doc is superseded
- Document references deleted components
- Content is >6 months old and not referenced

### Document Lifecycle

```
1. RESEARCH    → docs/research/FEATURE-RESEARCH.md
2. DESIGN      → docs/architecture/FEATURE-DESIGN.md
3. IMPLEMENT   → (code, not docs)
4. DOCUMENT    → docs/features/FEATURE.md or docs/guides/FEATURE-GUIDE.md
5. ARCHIVE     → docs/archive/FEATURE-DESIGN.md (after superseded)
```

---

## Design Phase Checklist

**BEFORE designing any new component:**

1. **Search for existing functionality**
   ```bash
   # Search for similar components
   grep -r "similar-keyword" --include="*.js" .claude/core/
   grep -r "similar-keyword" --include="*.js" *.js
   ```

2. **Check this file** - Is there a canonical implementation?

3. **If similar exists** → Design an EXTENSION to the existing component
   - Add methods to existing class
   - Add endpoints to existing server
   - Add fields to existing database

4. **If truly new** → Update this file
   - Add new entry to this registry
   - Document why it can't be part of existing component
   - Get design review before implementation

---

## Implementation Phase Double-Check

Before creating new files, verify:

- [ ] File name doesn't match singleton patterns (dashboard, orchestrator, tracker, etc.)
- [ ] Functionality isn't already in a canonical component
- [ ] If adding to canonical component, editing existing file instead of creating new

---

## Why This Matters

**Problem this solves:** Without architectural constraints, parallel implementations get created:
- 3 context trackers instead of 1
- 2 dashboard servers instead of 1
- 2 orchestrators instead of 1
- 4 database paths instead of 1

**Cost of parallel implementations:**
- Code duplication (~5,500 lines in our case)
- Feature fragmentation (features split across files)
- Maintenance burden (fix bugs in multiple places)
- Confusion (which one to use?)
- Integration complexity (systems don't talk to each other)

---

## Adding New Canonical Components

When a genuinely new singleton is needed:

1. **Justify** - Document why existing components can't be extended
2. **Design** - Create design doc with clear boundaries
3. **Register** - Add entry to this file BEFORE implementation
4. **Implement** - Create the single canonical implementation
5. **Document** - Update CLAUDE.md if it affects workflows

---

## Historical Context

This file was created after discovering significant duplication in the codebase (audit 2025-12-29). The consolidation task `context-tracker-consolidation` is cleaning up:

| Before | After |
|--------|-------|
| 3 context trackers | 1 (GlobalContextTracker) |
| 2 dashboards (ports 3030, 3033) | 1 (port 3033) |
| 2 orchestrators | 1 (autonomous-orchestrator.js) |
| 4 database paths | 1 (.claude/data/memory.db) |

**Lesson learned:** Check architecture FIRST, design SECOND, implement THIRD.
