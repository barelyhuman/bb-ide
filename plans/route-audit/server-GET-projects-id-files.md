# `GET /api/v1/projects/:id/files` — Search files in the project workspace

**Route:** `apps/server/src/routes/projects.ts:158`
**Contract:** `projectFilesQuerySchema -> ProjectFileSuggestion[]` (200)
**Complexity:** High (daemon command round-trip)

## Request Params / Query

| Field | Required | Notes |
|---|---|---|
| `:id` | Yes | Project ID from URL path. |
| `query` | No | Search string passed to `workspace.list_files` command. Omitted from command payload if absent. |
| `limit` | No | String-encoded integer. Parsed via `parseOptionalInteger`. Used to slice results client-side after the command returns. |

**All 3 fields consumed. No dead params.**

## Implementation Trace

1. `requireProject(db, id)` -- sync. Throws 404 if missing.
2. `getDefaultProjectSource(db, id)` -- sync. SELECT from `project_sources` WHERE `projectId` AND `isDefault = true`.
3. If no source or source has no `path`, throws 409.
4. `ensureProjectSourceEnvironment(deps, { hostId, path, projectId })` -- **async**.
   - `findEnvironmentByHostPath(db, hostId, path)` -- SELECT from `environments` using `environments_host_path_idx`.
   - If existing environment is `ready`, return it.
   - Otherwise create or reuse a `provisioning` environment.
   - `queueCommandAndWait(deps, { type: "environment.provision", ... })` -- queues `environment.provision` command to host daemon and waits up to 30s.
   - On result, UPDATE environment to `ready` with workspace metadata.
5. `queueCommandAndWait(deps, { type: "workspace.list_files", ... })` -- **async**. Queues command to host daemon and waits up to 30s.
   - Requires connected host session.
   - INSERT into `host_daemon_commands`.
   - Waits for result via `hub.waitForCommandResult`.
6. Parse result via `hostDaemonCommandResultSchemaByType["workspace.list_files"]`.
7. `parseOptionalInteger(query.limit, "limit")` -- sync. Parse limit.
8. Slice results array to `limit`, map each through `workspaceFileSchema.parse`.

> **-> HTTP 200 returns here.** Steps 4 and 5 involve async daemon round-trips (up to 30s each).

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | SELECT project by PK | `projects` | PK | requireProject |
| 2 | SELECT source by projectId+isDefault | `project_sources` | `project_sources_project_idx` | getDefaultProjectSource |
| 3 | SELECT env by hostId+path | `environments` | `environments_host_path_idx` | findEnvironmentByHostPath |
| 4 | (conditional) INSERT environment | `environments` | -- | only if no existing env |
| 5 | SELECT active session | `host_daemon_sessions` | `host_daemon_sessions_host_status_idx` | requireConnectedHostSession (provision) |
| 6 | (conditional) INSERT command (provision) | `host_daemon_commands` | -- | only if env needs provisioning |
| 7 | (conditional) UPDATE environment | `environments` | PK | set to ready after provision |
| 8 | SELECT active session | `host_daemon_sessions` | `host_daemon_sessions_host_status_idx` | requireConnectedHostSession (list_files) |
| 9 | INSERT command (list_files) | `host_daemon_commands` | -- | |

**Total: 5-9 queries depending on environment state. No N+1.**

## Code Reuse

| Function | Shared With |
|---|---|
| `requireProject` | Most project routes |
| `getDefaultProjectSource` | POST /managers, thread-create-helpers |
| `ensureProjectSourceEnvironment` | Only caller |
| `queueCommandAndWait` | Many routes (files, status, diff, actions) |
| `parseOptionalInteger` | Thread routes (events, timeline) |

## Flags

1. The `limit` field is validated by the schema as `z.string().regex(/^\d+$/)` but is then re-parsed by `parseOptionalInteger`. The regex already ensures it's a valid integer string, so the double-parse is redundant (but harmless).
2. The `workspaceFileSchema.parse(file)` call inside `.map()` re-validates every file returned by the daemon. This is defensive but means N Zod parse calls. For large file lists this could be slow. Consider `z.array(workspaceFileSchema).parse(result.files.slice(...))` for a single parse pass.
3. `ensureProjectSourceEnvironment` creates an unmanaged environment for the project's default source path if one doesn't exist. This side effect on a GET route is unusual -- a read-only file search can create environment rows. This is likely intentional (lazy provisioning) but worth documenting.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `searchProjectFiles` API fn | `apps/app/src/lib/api.ts:267` | Typed wrapper around `apiClient.projects[":id"].files.$get()` |
| `useProjectFileSuggestions` hook | `apps/app/src/hooks/useApi.ts:477` | React Query hook; calls `api.searchProjectFiles()` |
| `usePromptMentions` hook | `apps/app/src/hooks/usePromptMentions.ts:60` | Wraps `useProjectFileSuggestions` for @-mention autocomplete |
| `ProjectMainView` | `apps/app/src/views/ProjectMainView.tsx:31` | File mention suggestions in new-thread prompt box |
| `ThreadDetailView` | `apps/app/src/views/ThreadDetailView.tsx:255` | File mention suggestions in thread reply prompt box |
| files test | `apps/server/test/public-projects-hosts.test.ts:273` | Tests file search via daemon command round-trip |

No CLI caller.

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
