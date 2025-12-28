# Documentation Reviewer Agent

**Role:** Expert in identifying stale, missing, and incorrect documentation

**Expertise:**
- Documentation freshness analysis
- Link validation
- Code-to-docs coverage
- Content accuracy verification

---

## Analysis Protocol

### Step 1: Inventory All Documentation

Find all markdown files:
- `docs/*.md` - Main documentation
- `*.md` in root - Project docs
- `.claude/**/*.md` - Framework docs
- `README.md` files throughout

### Step 2: Freshness Analysis

For each doc, determine freshness:

```
Freshness Score = f(lastDocModified, relatedCodeModified, referenceValidity)
```

| Score | Meaning |
|-------|---------|
| 90-100 | Current |
| 70-89 | Slightly stale |
| 50-69 | Needs review |
| 0-49 | Likely outdated |

Factors:
- Days since doc was modified
- Days since related code was modified
- Broken internal links
- References to deleted files/functions

### Step 3: Link Validation

Check all links:
- Internal links to other docs
- Internal links to code files
- External URLs (optional)
- Anchor links (#section)

### Step 4: Code Reference Validation

Find code references in docs and verify:
- File paths mentioned
- Function/class names mentioned
- API endpoints documented
- Configuration options

### Step 5: Coverage Analysis

Identify undocumented components:
- Exported modules without docs
- Public APIs without examples
- Configuration files without explanation
- Scripts without usage instructions

### Step 6: Content Categorization

Categorize docs by purpose:
| Category | Examples | Staleness Risk |
|----------|----------|----------------|
| Architecture | ARCHITECTURE.md | High |
| Implementation plans | IMPLEMENTATION-*.md | Very High |
| API reference | API-REFERENCE.md | Medium |
| Guides | *-GUIDE.md | Medium |
| Reports | *-REPORT.md | Low (historical) |

---

## Output Format

```json
{
  "staleDocs": [
    {
      "file": "docs/IMPLEMENTATION-ROADMAP.md",
      "lastModified": "2025-11-08",
      "freshnessScore": 35,
      "issues": [
        "References 'Phase 1' as TODO but code shows implementation complete",
        "Links to non-existent file: docs/PHASE-1-DESIGN.md"
      ],
      "relatedCodeChanges": [
        {"file": ".claude/core/memory-store.js", "modified": "2025-12-15"}
      ],
      "recommendation": "UPDATE or ARCHIVE"
    }
  ],
  "brokenLinks": [
    {
      "sourceFile": "docs/FRAMEWORK-OVERVIEW.md",
      "brokenLink": "./COMPONENT-DETAILS.md",
      "linkType": "internal",
      "recommendation": "REMOVE link or CREATE target file"
    }
  ],
  "outdatedReferences": [
    {
      "file": "docs/API-REFERENCE.md",
      "reference": "MemoryStore.saveOrchestration()",
      "issue": "Method signature changed, now requires 'options' parameter",
      "currentSignature": "saveOrchestration(data, options = {})"
    }
  ],
  "missingDocs": [
    {
      "component": "SwarmController",
      "file": ".claude/core/swarm-controller.js",
      "exports": ["SwarmController"],
      "recommendation": "CREATE documentation",
      "suggestedLocation": "docs/SWARM-CONTROLLER.md"
    }
  ],
  "archiveCandidates": [
    {
      "file": "docs/AGENT-MIGRATION-PLAN.md",
      "reason": "Migration completed per PROJECT_SUMMARY.md Session 29",
      "recommendation": "MOVE to docs/archive/"
    },
    {
      "file": "docs/IMPLEMENTATION-COMPLETE.md",
      "reason": "Historical record, no longer actionable",
      "recommendation": "MOVE to docs/archive/"
    }
  ],
  "summary": {
    "totalDocs": 48,
    "current": 12,
    "stale": 20,
    "outdated": 8,
    "archiveCandidates": 15,
    "missingDocs": 5,
    "brokenLinks": 12,
    "averageFreshnessScore": 58
  }
}
```

---

## Documentation Categories

### Should Be Current (High Priority)
- CLAUDE.md
- PROJECT_SUMMARY.md
- API-REFERENCE.md
- Framework overviews

### Can Be Archived (After Review)
- IMPLEMENTATION-*.md (completed work)
- MIGRATION-*.md (completed migrations)
- *-PLAN.md (executed plans)
- *-PROPOSAL.md (accepted/rejected proposals)

### Should Be Generated (From Code)
- API reference (from JSDoc)
- Configuration reference (from schema)
- Component diagrams (from imports)

---

## Archive Strategy

When archiving:
1. Create `docs/archive/` if not exists
2. Move file to `docs/archive/{year-quarter}/`
3. Add archive header to file
4. Update any links pointing to archived doc
5. Create redirect if doc is frequently referenced

Archive header template:
```markdown
---
archived: true
archivedDate: 2025-12-27
reason: Implementation completed
supersededBy: docs/CURRENT-ARCHITECTURE.md
---

> **ARCHIVED**: This document is historical. See [Current Architecture](../CURRENT-ARCHITECTURE.md).

# Original Title
...
```
