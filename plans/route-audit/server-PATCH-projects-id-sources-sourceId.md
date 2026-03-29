# `PATCH /api/v1/projects/:id/sources/:sourceId` — Update a project source

**Route:** `apps/server/src/routes/projects.ts:127`
**Contract:** `updateProjectSourceRequestSchema -> ProjectSource` (200)
**Complexity:** Simple CRUD

## Request Params / Body

| Field | Required | Notes |
|---|---|---|
| `:id` | Yes | Project ID from URL path. Used to verify source ownership. |
| `:sourceId` | Yes | Source ID from URL path. The row to update. |
| `path` | Partial (at least one required) | Updated on the source row. |
| `repoUrl` | Partial (at least one required) | Updated on the source row. |

**All fields consumed. No dead params.**

## Implementation Trace

1. `requireProject(db, id)` -- sync. Throws 404 if missing.
2. `requireProjectSource(deps, { projectId, sourceId })` -- sync. SELECT source by PK, verify `source.projectId === projectId`. Throws 404 if mismatch or missing.
3. `updateProjectSource(db, hub, sourceId, payload)` -- sync.
   - SELECT source by PK (existence check).
   - UPDATE `project_sources` SET fields + `updatedAt`.
   - Notifies project `["sources-changed"]`.
   - SELECT back the updated row.
4. If null returned, throws 404 (race guard).

> **-> HTTP 200 returns here.** Fully synchronous.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | SELECT project by PK | `projects` | PK | requireProject |
| 2 | SELECT source by PK | `project_sources` | PK | requireProjectSource |
| 3 | SELECT source by PK | `project_sources` | PK | updateProjectSource existence check |
| 4 | UPDATE source by PK | `project_sources` | PK | |
| 5 | SELECT source by PK | `project_sources` | PK | re-read after update |

**Total: 5 queries. No N+1.**

## Code Reuse

| Function | Shared With |
|---|---|
| `requireProject` | Most project routes |
| `requireProjectSource` | DELETE sources, local to this file |
| `updateProjectSource` | Only caller |

## Flags

1. The `updateProjectSourceRequestSchema` allows updating `path` and `repoUrl` independently of the source `type`. You could set `repoUrl` on a `local_path` source or `path` on a `github_repo` source. The schema doesn't enforce type-field coherence. Whether this is intentional flexibility or a gap depends on how sources are consumed downstream.
2. Triple-read of the source row (requireProjectSource, updateProjectSource existence check, re-read after update) is redundant but harmless in SQLite.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `updateProjectSource` API fn | `apps/app/src/lib/api.ts:243` | Typed wrapper around `apiClient.projects[":id"].sources[":sourceId"].$patch()` |
| `ProjectList` | `apps/app/src/components/layout/ProjectList.tsx:231` | Updates local source path when user re-picks a folder for an existing source |
| auth regression test | `apps/server/test/public-authorization-regressions.test.ts:78` | Verifies PATCH rejects cross-project source updates |
| source CRUD test | `apps/server/test/public-projects-hosts.test.ts:163` | Tests updating a source's path |

No CLI caller -- source management is only available through the web app.

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
