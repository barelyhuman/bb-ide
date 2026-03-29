# `GET /api/v1/projects/:id` — Get a single project with sources

**Route:** `apps/server/src/routes/projects.ts:94`
**Contract:** `PathProjectId -> ProjectResponse` (200)
**Complexity:** Simple CRUD

## Request Params

| Field | Required | Notes |
|---|---|---|
| `:id` | Yes | Project ID from URL path. Passed to `buildProjectResponses`. |

**All 1 param consumed. No dead params.**

## Implementation Trace

1. `buildProjectResponses(deps, context.req.param("id"))` -- sync.
   - `requireProject(db, id)` -- SELECT from `projects` by PK. Throws 404 if missing.
   - SELECT from `project_sources` WHERE `projectId IN (...)`.
   - Assembles single-element array, returns `[0]`.

> **-> HTTP 200 returns here.** Fully synchronous.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | SELECT project by PK | `projects` | PK | requireProject |
| 2 | SELECT sources WHERE projectId IN(...) | `project_sources` | `project_sources_project_idx` | |

**Total: 2 queries. No N+1.**

## Code Reuse

| Function | Shared With |
|---|---|
| `buildProjectResponses` | GET /projects, POST /projects, PATCH /projects/:id |
| `requireProject` | Most project routes |

## Flags

None. Clean CRUD.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `project show` CLI | `apps/cli/src/commands/project.ts:99` | `bb project show <id>` command |
| `status` CLI | `apps/cli/src/commands/status.ts:62` | Fetches project name for status display |
| project CRUD test | `apps/server/test/public-projects-hosts.test.ts:57` | Verifies GET returns created project |

No frontend app caller -- the app uses `useProjects` (list) and filters client-side rather than fetching individual projects.

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
