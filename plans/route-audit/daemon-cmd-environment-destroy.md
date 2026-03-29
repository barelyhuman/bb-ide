# `environment.destroy` -- Destroy an Environment (Host-Daemon Command)

**Schema:** `packages/host-daemon-contract/src/commands.ts:196`
**Handler:** `apps/host-daemon/src/command-dispatch.ts:107` (inline in dispatch switch)
**Result Schema:** `packages/host-daemon-contract/src/commands.ts:312`
**Workspace Lane:** Yes (serialized per `environmentId` via `CommandRouter.runInEnvironmentLane`)

## Command Payload

| Field | Required | Notes |
|---|---|---|
| `type` | Yes | Literal `"environment.destroy"`. |
| `environmentId` | Yes | Identifies the environment to destroy. Used to look up and remove the runtime entry. |
| `path` | Yes | `z.string().min(1)`. **Not consumed by the handler.** Never read in dispatch or runtime manager. Dead param. |
| `workspaceProvisionType` | Yes | `workspaceProvisionTypeSchema` (`"unmanaged"`, `"managed-worktree"`, `"managed-clone"`). **Not consumed by the handler.** Never read in dispatch or runtime manager. Dead param. |

**Dead params: `path` and `workspaceProvisionType` are accepted but never consumed.**

## Implementation Trace

1. `dispatchCommand` matches `"environment.destroy"` at line 107.
2. Calls `options.runtimeManager.get(command.environmentId)` to check existence (synchronous, no await of pending).
3. If an entry exists, calls `options.runtimeManager.destroyEnvironment(command.environmentId)`:
   - `destroyEnvironment` (runtime-manager.ts:150):
     - Looks up both `entries` and `pendingEntries` -- awaits pending if needed.
     - Deletes the entry from `entries`.
     - Calls `entry.runtime.shutdown()` -- shuts down the agent runtime (kills provider processes).
     - Calls `entry.workspace.destroy()`:
       - **Unmanaged:** no-op (the workspace is not owned by bb).
       - **Managed worktree:** `removeWorktree({ path, force: true })` -- runs `git worktree remove --force`, then `fs.rm` recursive.
       - **Managed clone:** `removeDirectory({ path })` -- `fs.rm` recursive.
4. If no entry exists, silently returns `{}` (idempotent).
5. Returns `{}`.
6. After dispatch, `CommandRouter.dispatchEnvelope` (command-router.ts:70) cleans up the lane: `this.environmentLanes.delete(command.environmentId)`.

## Code Reuse

- `RuntimeManager.destroyEnvironment` is shared with `shutdownAll` (daemon shutdown).
- `removeWorktree` and `removeDirectory` from workspace provisioning are used via the `destroyFn` set during workspace creation.

## Flags

1. **`path` is a dead param.** The schema requires it but the handler never reads it. The destroy logic uses `entry.workspace.path` (set during provision) and does not need the path from the command. Remove from schema or document why it is needed for the server's bookkeeping.
2. **`workspaceProvisionType` is a dead param.** Same issue. The destroy behavior is determined by the `destroyFn` closure set during provision, not by this field. Remove from schema or consume it.
3. **Dispatch checks `runtimeManager.get()` but `destroyEnvironment` also checks.** The `get()` call at line 108 is synchronous and does not await pending entries. But `destroyEnvironment` (line 150-153) does await pending entries. The outer guard `if (existing)` would skip destruction if the environment is still being provisioned (pending but not yet in `entries`). This means a destroy command arriving while provision is in-flight would silently succeed without actually destroying anything. The lane serialization in `CommandRouter` mitigates this for same-environment commands, but it is still a subtle correctness dependency.

## Usages

| Caller | Location | Trigger |
|---|---|---|
| `DELETE /threads/:id` | `apps/server/src/routes/threads/base.ts:78` | Thread deletion. Calls `maybeCleanupEnvironment`, which queues `environment.destroy` if the environment is managed and has no remaining live threads. |
| `POST /threads/:id/archive` | `apps/server/src/routes/threads/actions.ts:250` | Thread archive action. Calls `maybeCleanupEnvironment` after archiving. |
| `POST /environments/:id/actions` (commit, autoArchive) | `apps/server/src/routes/environments.ts:120` | Commit action with `autoArchiveOnSuccess`. Archives the thread, then calls `maybeCleanupEnvironment`. |
| `POST /environments/:id/actions` (squash_merge, autoArchive) | `apps/server/src/routes/environments.ts:149` | Squash-merge action with `autoArchiveOnSuccess`. Archives the thread, then calls `maybeCleanupEnvironment`. |
| Server sweep interval | `apps/server/src/index.ts:48` | 10-second `setInterval` calls `maybeCleanupEnvironment` for each environment returned by `sweepManagedEnvironments`. |
| `handleProvisionResult` (provision-then-destroy) | `apps/server/src/internal/command-result-handlers.ts:122` | When an `environment.provision` result arrives but the environment status is already `"destroying"`, immediately queues `environment.destroy` via `queueEnvironmentDestroyCommand`. |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
