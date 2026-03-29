# `POST /api/v1/projects/:id/managers` — Create a manager thread

**Route:** `apps/server/src/routes/projects.ts:214`
**Contract:** `createManagerThreadRequestSchema -> Thread` (201)
**Complexity:** High (thread + environment provisioning, async background work)

## Request Params / Body

| Field | Required | Notes |
|---|---|---|
| `:id` | Yes | Project ID from URL path. Used as `projectId` for the thread. |
| `name` | No | If provided, passed as `title` to `createThreadFromRequest`. If absent, title is omitted (may be auto-generated). |
| `providerId` | Yes | Provider identifier for the thread. Passed through to thread creation. |
| `model` | Yes | Model identifier for the thread. Passed through to thread creation. |
| `reasoningLevel` | Yes | Reasoning level enum. Passed through to thread creation. |

**All 5 fields consumed. No dead params.**

## Implementation Trace

1. `requireProject(db, id)` -- sync. Throws 404 if missing.
2. `getDefaultProjectSource(db, id)` -- sync. SELECT from `project_sources`. Throws 409 if no default source.
3. `createThreadFromRequest(deps, { projectId, providerId, type: "manager", title?, model, reasoningLevel, environment: { type: "host", hostId, workspace: { type: "managed-worktree" } } })` -- **async**. This is the full thread creation flow:
   - `requireProjectExists(deps, projectId)` -- sync. Redundant with step 1.
   - `requireConnectedHostSession(deps, hostId)` -- sync. Throws 502 if host disconnected.
   - `requireDefaultSource(deps, projectId)` -- sync. Re-reads default source. Throws 409 if missing or no path.
   - Since workspace type is `managed-worktree`:
     - Verify `defaultSource.hostId === hostId` (same host). Throws 409 if different.
     - `createEnvironment(db, hub, { projectId, hostId, managed: true, workspaceProvisionType: "managed-worktree", status: "provisioning" })` -- sync. INSERT environment.
     - `createThreadRecord(deps, request, environment.id, mergeBaseBranch=null)` -- sync. INSERT thread with status `"created"`.
     - `transitionThreadStatus(db, hub, thread.id, "provisioning")` -- sync. UPDATE thread status.
     - `buildExecutionOptions(deps, request, ...)` -- **async**. Resolves model/provider options.
     - `appendClientTurnEvent(deps, { type: "client/thread/start", ... })` -- sync. INSERT event. (No `input` since manager threads have no initial input.)
     - `appendProvisioningEvent(deps, { status: "started", ... })` -- sync. INSERT provisioning event.
     - `queueEnvironmentProvision(deps, { workspaceProvisionType: "managed-worktree", sourcePath, targetPath, branchName })` -- sync.
       - `requireConnectedHostSession` -- checks session again.
       - INSERT command into `host_daemon_commands`.
     - Since no `input` on manager threads, `hasThreadStartInput` returns false. No title generation triggered, no immediate start.
   - `getThreadSafe(deps, thread.id)` -- sync. SELECT thread by PK.

> **-> HTTP 201 returns here.** Environment provisioning continues in background via the queued command. The thread is returned in `provisioning` status.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | SELECT project by PK | `projects` | PK | requireProject (route) |
| 2 | SELECT source by projectId+isDefault | `project_sources` | `project_sources_project_idx` | getDefaultProjectSource (route) |
| 3 | SELECT project by PK | `projects` | PK | requireProjectExists (redundant) |
| 4 | SELECT active session | `host_daemon_sessions` | `host_daemon_sessions_host_status_idx` | requireConnectedHostSession |
| 5 | SELECT source by projectId+isDefault | `project_sources` | `project_sources_project_idx` | requireDefaultSource (redundant) |
| 6 | INSERT environment | `environments` | -- | |
| 7 | INSERT thread | `threads` | -- | |
| 8 | UPDATE thread status | `threads` | PK | transition to provisioning |
| 9 | INSERT event (client/thread/start) | `events` | -- | |
| 10 | INSERT event (provisioning) | `events` | -- | |
| 11 | SELECT active session | `host_daemon_sessions` | `host_daemon_sessions_host_status_idx` | requireConnectedHostSession (provision cmd) |
| 12 | INSERT command | `host_daemon_commands` | -- | environment.provision |
| 13 | SELECT thread by PK | `threads` | PK | getThreadSafe |

**Total: 13 queries. No N+1. Some redundant reads (project x2, default source x2, session x2).**

## Code Reuse

| Function | Shared With |
|---|---|
| `requireProject` | Most project routes |
| `getDefaultProjectSource` | GET /files, thread-create-helpers |
| `createThreadFromRequest` | POST /threads (the main thread creation route) |
| `createThreadRecord` | Internal to thread-create |
| `queueEnvironmentProvision` | Internal to thread-create |
| `buildExecutionOptions` | Thread send/start flows |

## Flags

1. **Redundant lookups**: The route calls `requireProject` and `getDefaultProjectSource`, then `createThreadFromRequest` internally calls `requireProjectExists` and `requireDefaultSource` again. That's 4 extra queries for data already in hand. The service function could accept pre-fetched data.
2. **`reasoningLevel` is required** in `createManagerThreadRequestSchema` but optional in `createThreadRequestSchema`. This means manager threads always specify reasoning level while standard threads can omit it. This is an intentional design choice but creates an asymmetry worth noting.
3. The `name` field is mapped to `title` in the request: `...(payload.name ? { title: payload.name } : {})`. When `name` is absent, `title` is `undefined` (omitted). Since `hasThreadStartInput` returns false for manager threads (no `input`), auto-title generation is never triggered. Manager threads without a `name` will have `title: null` permanently.
4. The route hardcodes `workspace: { type: "managed-worktree" }`. Manager threads always get worktree environments. This policy lives in the route, not in a central config.
5. The manager thread is created without `input`, so it starts in `provisioning` status and never transitions to `active` during this request. The actual work begins when the environment provision completes and the daemon sends back a result. The thread's first turn must be triggered separately.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `hireProjectManager` API fn | `apps/app/src/lib/api.ts:207` | Typed wrapper around `apiClient.projects[":id"].managers.$post()` |
| `useHireProjectManager` hook | `apps/app/src/hooks/useApi.ts:406` | React Query mutation; calls `api.hireProjectManager()` |
| `HireManagerModal` | `apps/app/src/components/HireManagerModal.tsx:135` | Modal form to hire a manager thread |
| `AppLayout` | `apps/app/src/components/layout/AppLayout.tsx:220` | Triggers manager hiring from layout-level actions |
| `manager hire` CLI | `apps/cli/src/commands/manager.ts:63` | `bb manager hire` command |
| manager thread test | `apps/server/test/public-threads.test.ts:908` | Tests manager creation returns provisioning thread |
| contract test | `packages/server-contract/test/contract.test.ts:218` | Verifies URL generation for the route |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
