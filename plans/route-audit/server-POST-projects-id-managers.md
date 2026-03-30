# `POST /api/v1/projects/:id/managers` — Create a manager thread

**Route:** `apps/server/src/routes/projects.ts:214`
**Contract:** `createManagerThreadRequestSchema -> Thread` (201)
**Complexity:** High (thread + environment provisioning, async background work)

## Request Params / Body

| Field            | Required | Notes                                                                                                             |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `:id`            | Yes      | Project ID from URL path. Used as `projectId` for the thread.                                                     |
| `name`           | No       | If provided, passed as `title` to `createThreadFromRequest`. If absent, title is omitted (may be auto-generated). |
| `providerId`     | Yes      | Provider identifier for the thread. Passed through to thread creation.                                            |
| `model`          | Yes      | Model identifier for the thread. Passed through to thread creation.                                               |
| `reasoningLevel` | Yes      | Reasoning level enum. Passed through to thread creation.                                                          |

**All 5 fields consumed. No dead params.**

## Implementation Trace

1. `requireProject(db, id)` -- sync. Throws 404 if missing.
2. `getDefaultProjectSource(db, id)` -- sync. SELECT from `project_sources`. Throws 409 if no default source.
3. `createThreadFromRequest(deps, { projectId, providerId, type: "manager", title?, model, reasoningLevel, environment: { type: "host", hostId, workspace: { type: "unmanaged", path: source.path } } })` -- **async**. This is the full thread creation flow:
   - `requireProjectExists(deps, projectId)` -- sync. Redundant with step 1.
   - `requireConnectedHostSession(deps, hostId)` -- sync. Throws 502 if host disconnected.
   - `requireDefaultSource(deps, projectId)` -- sync. Re-reads default source. Throws 409 if missing or no path.
   - Since workspace type is `unmanaged`:
     - `maybeReuseUnmanagedEnvironment()` -- looks for an existing environment at the same host+path (indexed: `environments_host_path_idx`). If found and ready, reuses it; if found and provisioning, reuses with provisioning status; if not found, creates a new environment.
     - `createEnvironment(db, hub, { projectId, hostId, managed: false, workspaceProvisionType: "unmanaged", status: "provisioning" })` -- sync. INSERT environment (if not reused).
     - `createThreadRecord(deps, request, environment.id, mergeBaseBranch=null)` -- sync. INSERT thread with status `"created"`.
     - `transitionThreadStatus(db, hub, thread.id, ...)` -- sync. UPDATE thread status.
     - `buildExecutionOptions(deps, request, ...)` -- **async**. Resolves model/provider options.
     - `appendClientTurnEvent(deps, { type: "client/thread/start", input: [...], ... })` -- sync. INSERT event with the welcome message as input.
     - `appendProvisioningEvent(deps, { status: "started", ... })` -- sync. INSERT provisioning event.
     - `queueEnvironmentProvision(deps, { workspaceProvisionType: "unmanaged", path: source.path })` -- sync (if env is new).
       - `requireConnectedHostSession` -- checks session again.
       - INSERT command into `host_daemon_commands`.
     - Manager threads now include `input` (the rendered `systemMessageManagerWelcome` template), so `hasThreadStartInput` returns true. Title generation is skipped because `title` is always provided.
     - `queueThreadStartCommand` is called with `isThreadCreation: true`, which causes `resolveThreadRuntimeCommandConfig` to skip the daemon round-trip for reading PREFERENCES.md. Manager creation returns immediately without blocking on preferences. Preferences are read on subsequent turns.
   - `getThreadSafe(deps, thread.id)` -- sync. SELECT thread by PK.

> **-> HTTP 201 returns here.** Environment provisioning continues in background via the queued command. The thread is returned in `provisioning` status.

## DB Query Summary

| #   | Query                                | Table                  | Index                                  | Notes                                       |
| --- | ------------------------------------ | ---------------------- | -------------------------------------- | ------------------------------------------- |
| 1   | SELECT project by PK                 | `projects`             | PK                                     | requireProject (route)                      |
| 2   | SELECT source by projectId+isDefault | `project_sources`      | `project_sources_project_idx`          | getDefaultProjectSource (route)             |
| 3   | SELECT project by PK                 | `projects`             | PK                                     | requireProjectExists (redundant)            |
| 4   | SELECT active session                | `host_daemon_sessions` | `host_daemon_sessions_host_status_idx` | requireConnectedHostSession                 |
| 5   | SELECT source by projectId+isDefault | `project_sources`      | `project_sources_project_idx`          | requireDefaultSource (redundant)            |
| 5b  | SELECT env by host+path              | `environments`         | `environments_host_path_idx` (unique)  | maybeReuseUnmanagedEnvironment              |
| 6   | INSERT environment (if not reused)   | `environments`         | --                                     |                                             |
| 7   | INSERT thread                        | `threads`              | --                                     |                                             |
| 8   | UPDATE thread status                 | `threads`              | PK                                     | transition to provisioning                  |
| 9   | INSERT event (client/thread/start)   | `events`               | --                                     |                                             |
| 10  | INSERT event (provisioning)          | `events`               | --                                     |                                             |
| 11  | SELECT active session                | `host_daemon_sessions` | `host_daemon_sessions_host_status_idx` | requireConnectedHostSession (provision cmd) |
| 12  | INSERT command                       | `host_daemon_commands` | --                                     | environment.provision                       |
| 13  | SELECT thread by PK                  | `threads`              | PK                                     | getThreadSafe                               |

**Total: 13 queries. No N+1. Some redundant reads (project x2, default source x2, session x2).**

## Code Reuse

| Function                    | Shared With                                    |
| --------------------------- | ---------------------------------------------- |
| `requireProject`            | Most project routes                            |
| `getDefaultProjectSource`   | GET /files, thread-create-helpers              |
| `createThreadFromRequest`   | POST /threads (the main thread creation route). Manager route passes `workspace: { type: "unmanaged", path: source.path }` |
| `createThreadRecord`        | Internal to thread-create                      |
| `queueEnvironmentProvision` | Internal to thread-create                      |
| `buildExecutionOptions`     | Thread send/start flows                        |

## Flags

1. **Redundant lookups**: The route calls `requireProject` and `getDefaultProjectSource`, then `createThreadFromRequest` internally calls `requireProjectExists` and `requireDefaultSource` again. That's 4 extra queries for data already in hand. The service function could accept pre-fetched data.
2. **`reasoningLevel` is required** in `createManagerThreadRequestSchema` but optional in `createThreadRequestSchema`. This means manager threads always specify reasoning level while standard threads can omit it. This is an intentional design choice but creates an asymmetry worth noting.
3. ~~The `name` field is mapped to `title` in the request. When `name` is absent, `title` is `undefined` (omitted). Since `hasThreadStartInput` returns false for manager threads (no `input`), auto-title generation is never triggered.~~ **Fixed:** Name defaults to "Manager" / "Manager N", and manager threads now have input (welcome message).
4. ~~The route hardcodes `workspace: { type: "managed-worktree" }`. Manager threads always get worktree environments.~~ **Fixed:** Managers now use `{ type: "unmanaged", path: source.path }`.
~~5. The manager thread is created without `input`, so it starts in `provisioning` status and never transitions to `active` during this request. The actual work begins when the environment provision completes and the daemon sends back a result. The thread's first turn must be triggered separately.~~

## Usages

| Caller                       | Location                                             | Purpose                                                           |
| ---------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| `hireProjectManager` API fn  | `apps/app/src/lib/api.ts:207`                        | Typed wrapper around `apiClient.projects[":id"].managers.$post()` |
| `useHireProjectManager` hook | `apps/app/src/hooks/useApi.ts:406`                   | React Query mutation; calls `api.hireProjectManager()`            |
| `HireManagerModal`           | `apps/app/src/components/HireManagerModal.tsx:135`   | Modal form to hire a manager thread                               |
| `AppLayout`                  | `apps/app/src/components/layout/AppLayout.tsx:220`   | Triggers manager hiring from layout-level actions                 |
| `manager hire` CLI           | `apps/cli/src/commands/manager.ts:63`                | `bb manager hire` command                                         |
| manager thread test          | `apps/server/test/public-threads.test.ts:908`        | Tests manager creation returns provisioning thread                |
| contract test                | `packages/server-contract/test/contract.test.ts:218` | Verifies URL generation for the route                             |

---

> **Updated 2026-03-29:** DB functions now use RETURNING — post-write re-reads eliminated.

## Review Comments

> **`reasoningLevel` is required** in `createManagerThreadRequestSchema` but optional in `createThreadRequestSchema`. This means manager threads always specify reasoning level while standard threads can omit it. This is an intentional design choice but creates an asymmetry worth noting.

~~we should fix this to make reasoningLevel optional here too for consistency~~ **Fixed:** `reasoningLevel` is now `.optional()` in `createManagerThreadRequestSchema`.

> 3. The `name` field is mapped to `title` in the request: `...(payload.name ? { title: payload.name } : {})`. When `name` is absent, `title` is `undefined` (omitted). Since `hasThreadStartInput` returns false for manager threads (no `input`), auto-title generation is never triggered. Manager threads without a `name` will have `title: null` permanently.

~~the manager name should default to "Manager" or "Manager <numManagers>" if the project has any existing managers~~ **Fixed:** When `name` is absent, the route now defaults to "Manager" (if no existing managers) or "Manager N" (where N = existing count + 1).

> 4. ~~The route hardcodes `workspace: { type: "managed-worktree" }`. Manager threads always get worktree environments. This policy lives in the route, not in a central config.~~

**Fixed:** Managers now use `{ type: "unmanaged", path: source.path }`, working directly in the project's primary checkout instead of creating a managed worktree.

> ~~5. The manager thread is created without `input`, so it starts in `provisioning` status and never transitions to `active` during this request. The actual work begins when the environment provision completes and the daemon sends back a result. The thread's first turn must be triggered separately.~~

**Fixed:** Manager threads now start with the `systemMessageManagerWelcome` template rendered as input (`[{ type: "text", text: "[bb system] Welcome!" }]`). This means `hasThreadStartInput` returns true, the `client/thread/start` event includes the welcome message, and the thread will transition to `active` once its environment is ready.
