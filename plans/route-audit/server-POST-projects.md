# `POST /api/v1/projects` — Create a project with its first source

**Route:** `apps/server/src/routes/projects.ts:79`
**Contract:** `createProjectRequestSchema -> ProjectResponse` (201)
**Complexity:** Simple CRUD

## Request Body

| Field | Required | Notes |
|---|---|---|
| `name` | Yes | Passed to `createProject` as the project name. |
| `hostId` | Yes | Validated via `requireHostWithStatus` (must exist in `hosts` table). Used as the host for the initial source. |
| `sourcePath` | Yes | Stored as `path` on the auto-created `local_path` project source. |

**All 3 fields consumed. No dead params.**

## Implementation Trace

1. `requireHostWithStatus(db, payload.hostId)` -- sync. Looks up host row + checks for an active daemon session. Throws 404 if host missing.
2. `createProject(db, hub, { name })` -- sync.
   - Generates ID via `createProjectId()`.
   - INSERT into `projects`.
   - Notifies system `["environment-created"]`.
   - SELECT back the inserted row.
3. `createProjectSource(db, hub, { projectId, hostId, type: "local_path", path, isDefault: true })` -- sync.
   - SELECT existing sources for the project (always 0 here).
   - Since `isDefault: true` and first source, sets `isDefault = true`.
   - INSERT into `project_sources`.
   - Notifies project `["sources-changed"]`.
   - SELECT back the inserted row.
4. `buildProjectResponses(deps, project.id)` -- sync.
   - `requireProject(db, project.id)` -- SELECT from `projects` by PK.
   - SELECT from `project_sources` WHERE `projectId IN (...)`.
   - Assembles response.

> **-> HTTP 201 returns here.** Fully synchronous.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | SELECT host by PK | `hosts` | PK | requireHostWithStatus |
| 2 | SELECT session by hostId+status | `host_daemon_sessions` | `host_daemon_sessions_host_status_idx` | active session check |
| 3 | INSERT project | `projects` | -- | |
| 4 | SELECT project by PK | `projects` | PK | re-read after insert |
| 5 | SELECT sources for project | `project_sources` | `project_sources_project_idx` | check existing sources count |
| 6 | INSERT project_source | `project_sources` | -- | |
| 7 | SELECT project_source by PK | `project_sources` | PK | re-read after insert |
| 8 | SELECT project by PK | `projects` | PK | buildProjectResponses -> requireProject |
| 9 | SELECT sources WHERE projectId IN(...) | `project_sources` | `project_sources_project_idx` | buildProjectResponses |

**Total: 9 queries. No N+1.**

## Code Reuse

| Function | Shared With |
|---|---|
| `requireHostWithStatus` | POST sources, thread creation |
| `createProject` | Only caller |
| `createProjectSource` | POST sources |
| `buildProjectResponses` | GET /projects, GET /projects/:id, PATCH /projects/:id |

## Flags

1. `createProject` notifies `["environment-created"]` which is misleading -- no environment is created here. Likely a generic "project topology changed" notification reusing the environment channel.
2. The route creates the project and source in two separate statements without an explicit transaction. If the source INSERT fails (e.g., unique constraint on `projectId+hostId`), the project row persists orphaned. Low risk in practice (first source) but worth noting.
3. 9 queries for a single create is somewhat high for simple CRUD. Multiple re-reads after insert could be consolidated.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `createProject` API fn | `apps/app/src/lib/api.ts:203` | Typed wrapper around `apiClient.projects.$post()` |
| `useCreateProject` hook | `apps/app/src/hooks/useApi.ts:396` | React Query mutation; calls `api.createProject()` |
| `useQuickCreateProject` hook | `apps/app/src/hooks/useQuickCreateProject.ts:7` | Wraps `useCreateProject` with folder-picker flow |
| `MainView` | `apps/app/src/views/MainView.tsx:9` | "Create project" action on empty state |
| `AppSidebar` | `apps/app/src/components/layout/AppSidebar.tsx:27` | "New project" button in sidebar |
| `project create` CLI | `apps/cli/src/commands/project.ts:78` | `bb project create --name --root` command |
| integration test | `apps/server/test/integration.test.ts:141` | Setup: creates project for thread tests |
| project CRUD test | `apps/server/test/public-projects-hosts.test.ts:26` | Tests project creation and response shape |
| skeleton test | `apps/server/test/skeleton.test.ts:52` | Tests malformed JSON returns structured error |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
