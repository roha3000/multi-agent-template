# tasks.json Schema (CC-ALIGN-001)

This document defines the schema for `.claude/dev-docs/tasks.json` under
the single-source-of-truth operating model.

## Model

`tasks.json` is **non-canonical**. It is a derived execution slice that
Claude Code reads to load context efficiently. The **canonical source of
truth for task state is GitHub Issues**. Every task in `tasks.json` links
back to a GitHub issue via the required `canonicalId` field.

If `tasks.json` disagrees with a GitHub issue, GitHub wins.

## Top-level structure

```json
{
  "version": "1.1.0",
  "project": { "name": "...", "phases": [...] },
  "backlog": { "now": {...}, "next": {...}, "later": {...}, "someday": {...}, "completed": {...} },
  "tasks": {
    "<task-id>": { <task-object> }
  }
}
```

## Task object

| Field         | Type     | Required | Description |
|---------------|----------|----------|-------------|
| `id`          | string   | yes      | Local task id (slug). Internal only. |
| `canonicalId` | string   | **yes**  | Canonical GitHub issue reference. Format: `owner/repo#number` (e.g. `roha3000/ops#6`). |
| `title`       | string   | yes      | Short title. Should match the linked issue title. |
| `description` | string   | yes      | Short description. Source of truth for scope is the linked issue, not this field. |
| `phase`       | enum     | yes      | One of: `research`, `planning`, `design`, `implementation`, `testing`, `validation`, `iteration`. |
| `priority`    | enum     | yes      | `high` \| `medium` \| `low` |
| `estimate`    | string   | no       | e.g. `"4h"`. |
| `tags`        | string[] | no       | Free-form tags. |
| `depends`     | object   | no       | `{ blocks: [id], requires: [id], related: [id] }`. |
| `acceptance`  | string[] | no       | Acceptance criteria. Mirror what's in the issue; do not diverge. |
| `status`      | enum     | yes      | `ready` \| `blocked` \| `in-progress` \| `completed` |
| `assignee`    | string   | no       | |
| `created`     | ISO8601  | yes      | |
| `updated`     | ISO8601  | yes      | |
| `started`     | ISO8601  | no       | |
| `completed`   | ISO8601  | no       | |

### `canonicalId` format

Required pattern: `^[\w.-]+/[\w.-]+#\d+$`

Valid examples:

- `roha3000/ops#6`
- `example-org/example-repo#101`

Invalid:

- `ops#6` (no owner)
- `#6` (no owner/repo)
- `roha3000/ops` (no issue number)
- `GH-6` (wrong format)

### Why `canonicalId` is required

1. It prevents a local-only backlog from silently emerging alongside
   GitHub Issues.
2. It lets `/save` produce a handoff block that writes back to the
   canonical record.
3. It lets the session-start hook
   (`.claude/hooks/canonical-id-check.js`) flag drift automatically.
4. It lets worktree / branch names map back to a canonical issue.

### Exceptions

There should not be routine exceptions. If a task genuinely has no
canonical issue (e.g. a five-minute tactical fix), the correct path is
to file an issue first. If an explicit exception is needed, record the
rationale in the `/save` handoff block so Ron can audit it.

## Example

```json
"auth-oauth-login-1k2m3n": {
  "id": "auth-oauth-login-1k2m3n",
  "canonicalId": "example-org/example-repo#101",
  "title": "Implement OAuth 2.0 login flow",
  "description": "Add OAuth authentication with Google and GitHub providers.",
  "phase": "implementation",
  "priority": "high",
  "estimate": "4h",
  "tags": ["auth", "security", "backend"],
  "depends": { "blocks": [], "requires": [], "related": [] },
  "acceptance": [
    "Users can log in with Google OAuth",
    "All authentication tests passing"
  ],
  "status": "ready",
  "assignee": null,
  "created": "2026-04-17T10:00:00Z",
  "updated": "2026-04-17T10:00:00Z",
  "started": null,
  "completed": null
}
```

## Enforcement

- `/session-init` prompts for `canonicalId` when creating a new task.
- `/save` refuses to complete without a handoff block tied to a
  `canonicalId`.
- `.claude/hooks/canonical-id-check.js` runs on session start and warns
  (non-fatal) about any task missing or with an invalid `canonicalId`.
