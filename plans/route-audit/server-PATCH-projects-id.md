# `PATCH /api/v1/projects/:id` — Update a project

**Route:** `apps/server/src/routes/projects.ts:98`
**Contract:** `updateProjectRequestSchema -> ProjectResponse` (200)
**Complexity:** Simple CRUD

## Request Params / Body

| Field | Required | Notes |
|---|---|---|
| `:id` | Yes | Project ID from URL path. |
| `name` | Partial (at least one field required) | Updated on the project row. Schema refine ensures at least one field present. |

**All fields consumed. No dead params.**

## Implementation Trace

1. `requireProject(db, id)` -- sync. SELECT by PK. Throws 404 if missing.
2. `updateProject(db, hub, id, payload)` -- sync.
   - UPDATE `projects` SET `name` + `updatedAt` WHERE `id`.
   - SELECT back the updated row.
   - Notifies project `["threads-changed"]`.
   - Returns updated row (or null if vanished).
3. If `updateProject` returns null, throws 404 (race condition guard).
4. `buildProjectResponses(deps, project.id)` -- sync. Re-reads project + sources.

> **-> HTTP 200 returns here.** Fully synchronous.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | SELECT project by PK | `projects` | PK | requireProject |
| 2 | UPDATE project by PK | `projects` | PK | |
| 3 | SELECT project by PK | `projects` | PK | re-read after update |
| 4 | SELECT project by PK | `projects` | PK | buildProjectResponses -> requireProject |
| 5 | SELECT sources WHERE projectId IN(...) | `project_sources` | `project_sources_project_idx` | |

**Total: 5 queries. No N+1.**

## Code Reuse

| Function | Shared With |
|---|---|
| `requireProject` | Most project routes |
| `updateProject` | Only caller |
| `buildProjectResponses` | GET /projects, GET /projects/:id, POST /projects |

## Flags

1. `updateProject` notifies `["threads-changed"]` on a project name change. This is semantically odd -- renaming a project doesn't change threads. Probably a "refresh project" catch-all notification.
2. `requireProject` is called, then `updateProject` does its own null check. The first check is redundant (the row won't vanish between sync calls in SQLite). Harmless but unnecessary.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `updateProject` API fn | `apps/app/src/lib/api.ts:219` | Typed wrapper around `apiClient.projects[":id"].$patch()` |
| `useUpdateProject` hook | `apps/app/src/hooks/useApi.ts:452` | React Query mutation; calls `api.updateProject()` |
| `ProjectList` | `apps/app/src/components/layout/ProjectList.tsx:215` | Inline rename of project name in sidebar |
| `project update` CLI | `apps/cli/src/commands/project.ts:122` | `bb project update <id> --name` command |
| project CRUD test | `apps/server/test/public-projects-hosts.test.ts:75` | Tests PATCH updates project name |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
