# `POST /api/v1/projects` — Create a project with its first source

**Route:** `apps/server/src/routes/projects.ts:79`
**Contract:** `createProjectRequestSchema -> ProjectResponse` (201)
**Complexity:** Simple CRUD

## Request Body

> **Updated 2026-03-29:** Schema changed from `{ name, hostId, sourcePath }` to `{ name, source: { type, hostId, path|repoUrl } }` — discriminated union matching `createProjectSourceRequestSchema`.

| Field            | Required                    | Notes                                                                           |
| ---------------- | --------------------------- | ------------------------------------------------------------------------------- |
| `name`           | Yes                         | Passed to `createProject` as the project name.                                  |
| `source.type`    | Yes                         | Discriminated union: `"local_path"` or `"github_repo"`.                         |
| `source.hostId`  | Yes                         | Validated via `requireHostWithStatus`. Used as the host for the initial source. |
| `source.path`    | Yes (when type=local_path)  | Stored as `path` on the auto-created project source.                            |
| `source.repoUrl` | Yes (when type=github_repo) | Stored as `repoUrl` on the auto-created project source.                         |

**All fields consumed. No dead params.**

## Implementation Trace

1. `requireHostWithStatus(db, payload.hostId)` -- sync. Looks up host row + checks for an active daemon session. Throws 404 if host missing.
2. `createProject(db, hub, { name })` -- sync.
   - Generates ID via `createProjectId()`.
   - INSERT into `projects` (RETURNING).
   - Notifies project `["project-created"]`.
3. `createProjectSource(db, hub, { projectId, hostId, type: "local_path", path, isDefault: true })` -- sync.
   - SELECT existing sources for the project (always 0 here).
   - Since `isDefault: true` and first source, sets `isDefault = true`.
   - INSERT into `project_sources` (RETURNING).
   - Notifies project `["project-sources-changed"]`.
4. `buildProjectResponses(deps, project.id)` -- sync.
   - `requireProject(db, project.id)` -- SELECT from `projects` by PK.
   - SELECT from `project_sources` WHERE `projectId IN (...)`.
   - Assembles response.

> **-> HTTP 201 returns here.** Fully synchronous.

## DB Query Summary

| #   | Query                                  | Table                  | Index                                  | Notes                                   |
| --- | -------------------------------------- | ---------------------- | -------------------------------------- | --------------------------------------- |
| 1   | SELECT host by PK                      | `hosts`                | PK                                     | requireHostWithStatus                   |
| 2   | SELECT session by hostId+status        | `host_daemon_sessions` | `host_daemon_sessions_host_status_idx` | active session check                    |
| 3   | INSERT project (RETURNING)             | `projects`             | --                                     |                                         |
| 4   | SELECT sources for project             | `project_sources`      | `project_sources_project_idx`          | check existing sources count            |
| 5   | INSERT project_source (RETURNING)      | `project_sources`      | --                                     |                                         |
| 6   | SELECT project by PK                   | `projects`             | PK                                     | buildProjectResponses -> requireProject |
| 7   | SELECT sources WHERE projectId IN(...) | `project_sources`      | `project_sources_project_idx`          | buildProjectResponses                   |

> **Updated 2026-03-29:** DB functions now use RETURNING — post-write re-reads eliminated.

**Total: 7 queries. No N+1.**

## Code Reuse

| Function                | Shared With                                           |
| ----------------------- | ----------------------------------------------------- |
| `requireHostWithStatus` | POST sources, thread creation                         |
| `createProject`         | Only caller                                           |
| `createProjectSource`   | POST sources                                          |
| `buildProjectResponses` | GET /projects, GET /projects/:id, PATCH /projects/:id |

## Flags

> **Updated 2026-03-29:** Schema changed to discriminated union. Notification fixed — `createProject` now notifies `"project-created"` instead of `["environment-created"]`. `createProjectSource` notifies `"project-sources-changed"`.

1. ~~`createProject` notifies `["environment-created"]` which is misleading -- no environment is created here.~~ **Fixed** — now notifies `"project-created"`.
2. ~~The route creates the project and source in two separate statements without an explicit transaction. If the source INSERT fails (e.g., unique constraint on `projectId+hostId`), the project row persists orphaned. Low risk in practice (first source) but worth noting.~~ **Fixed** — source INSERT is wrapped in try/catch; on failure, `deleteProject` cleans up the project row before re-throwing.
3. ~~9 queries for a single create is somewhat high for simple CRUD. Multiple re-reads after insert could be consolidated.~~ **Fixed** — DB functions now use RETURNING; down to 7 queries.

## Usages

| Caller                       | Location                                            | Purpose                                           |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------------- |
| `createProject` API fn       | `apps/app/src/lib/api.ts:203`                       | Typed wrapper around `apiClient.projects.$post()` |
| `useCreateProject` hook      | `apps/app/src/hooks/useApi.ts:396`                  | React Query mutation; calls `api.createProject()` |
| `useQuickCreateProject` hook | `apps/app/src/hooks/useQuickCreateProject.ts:7`     | Wraps `useCreateProject` with folder-picker flow  |
| `MainView`                   | `apps/app/src/views/MainView.tsx:9`                 | "Create project" action on empty state            |
| `AppSidebar`                 | `apps/app/src/components/layout/AppSidebar.tsx:27`  | "New project" button in sidebar                   |
| `project create` CLI         | `apps/cli/src/commands/project.ts:78`               | `bb project create --name --root` command         |
| integration test             | `apps/server/test/integration.test.ts:141`          | Setup: creates project for thread tests           |
| project CRUD test            | `apps/server/test/public-projects-hosts.test.ts:26` | Tests project creation and response shape         |
| skeleton test                | `apps/server/test/skeleton.test.ts:52`              | Tests malformed JSON returns structured error     |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->

Can we address flag 2 and 3 too?
