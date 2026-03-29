# `GET /api/v1/projects` — List Projects

**Route:** `apps/server/src/routes/projects.ts:77`
**Contract:** `EmptyInput → ProjectResponse[]`
**Complexity:** Simple CRUD read

## Implementation Trace

1. `listProjects(db)` — `SELECT * FROM projects` (full table scan, no WHERE)
2. Bulk-fetch sources — `SELECT * FROM project_sources WHERE project_id IN (...)`
   - Uses `project_sources_project_idx` index on `projectId`
3. Zip sources onto parent projects in JS, return array

> **→ HTTP 200 returns here.** Fully synchronous, no background work.

## DB Query Summary

| # | Query | Table | Index Used | Notes |
|---|-------|-------|-----------|-------|
| 1 | `SELECT * FROM projects` | `projects` | full scan | No filter — returns all rows |
| 2 | `SELECT * FROM project_sources WHERE project_id IN (...)` | `project_sources` | `project_sources_project_idx` | Efficient bulk load |

**Total: 2 queries. No N+1.**

## Params

None (`EmptyInput`).

## Code Reuse

- `buildProjectResponses()` (projects.ts:37-52) is shared by both `GET /projects` and `GET /projects/:id` — the latter passes a `projectId` arg to fetch a single project instead of all.
- `listProjects()` is a thin wrapper over Drizzle — no shared service layer.

## Flags

None. Clean CRUD read.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `listProjects` API fn | `apps/app/src/lib/api.ts:226` | Typed wrapper around `apiClient.projects.$get()` |
| `useProjects` hook | `apps/app/src/hooks/useApi.ts:388` | React Query hook; calls `api.listProjects()` |
| `ProjectMainView` | `apps/app/src/views/ProjectMainView.tsx:26` | Fetches project list to validate current project ID |
| `MainView` | `apps/app/src/views/MainView.tsx:8` | Redirects to first project if none selected |
| `AppLayout` | `apps/app/src/components/layout/AppLayout.tsx:219` | Provides projects to sidebar and layout chrome |
| `ProjectList` | `apps/app/src/components/layout/ProjectList.tsx:116` | Renders the project list sidebar |
| `project list` CLI | `apps/cli/src/commands/project.ts:51` | `bb project list` command |
| integration test | `apps/server/test/integration.test.ts:141` | Setup: creates project before thread tests |
| project CRUD test | `apps/server/test/public-projects-hosts.test.ts:47` | Verifies list returns created projects |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->

