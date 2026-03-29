# `thread.stop` — Stop a Running Thread (Host-Daemon Command)

**Schema:** `packages/host-daemon-contract/src/commands.ts:117`
**Handler:** `apps/host-daemon/src/command-dispatch.ts:72` (inline in dispatch)
**Result Schema:** `packages/host-daemon-contract/src/commands.ts:303`
**Workspace Lane:** No (runs freely)

## Command Payload

| Field | Required | Notes |
|---|---|---|
| `type` | Yes | Literal `"thread.stop"` |
| `environmentId` | Yes | Identifies the runtime entry. Passed to `requireExistingEnvironment` and `markThreadInactive`. |
| `threadId` | Yes | Identifies the thread to stop. Passed to `runtime.stopThread` and `markThreadInactive`. |

**All 3 fields consumed. No dead params.**

## Implementation Trace

1. `dispatchCommand` matches `"thread.stop"`.
2. Calls `requireExistingEnvironment(command.environmentId, options.runtimeManager)`.
   - Uses `runtimeManager.getOrAwait(environmentId)`. If no entry exists (not even pending), throws `CommandDispatchError("unknown_environment", ...)`.
3. Calls `entry.runtime.stopThread({ threadId: command.threadId })`.
   - Signals the provider to cancel/stop the running turn for this thread.
4. Calls `runtimeManager.markThreadInactive(command.environmentId, command.threadId)`.
   - Updates the thread's status from `"active"` to `"idle"` in the runtime entry's `threads` map.
   - Does NOT remove the thread — it remains in the map as idle.
5. Returns `{}`.

## Code Reuse

- `requireExistingEnvironment` is shared with `thread.rename`.
- `markThreadInactive` is also called internally by the `RuntimeManager.onEvent` callback when `turn/completed` events arrive.

## Flags

1. **Requires existing environment.** Unlike `thread.start`/`turn.run` which call `ensureEnvironment`, this uses `requireExistingEnvironment` which throws if the environment doesn't exist. This is correct — you can't stop a thread that was never started.
2. **Thread left in map as idle.** After stop, the thread entry remains in `entry.threads` with status `"idle"`. This is not cleaned up until `environment.destroy` or process exit. Not a bug — idle threads may be resumed later.

## Usages

| Caller | Location | Trigger |
|---|---|---|
| `queueThreadStopCommand` | `apps/server/src/services/thread-commands.ts:273` | Wrapper that builds and queues a `"thread.stop"` command. Not called by any other service — currently orphaned (see below). |
| `POST /threads/:id/stop` | `apps/server/src/routes/threads/actions.ts:192` | Queues `thread.stop` directly via `queueCommandAndWait` (does not use the wrapper) |
| `POST /threads/:id/archive` | `apps/server/src/routes/threads/actions.ts:239` | Queues `thread.stop` via `queueCommandAndWait` as a pre-step when the thread is active before archiving |
| `handleThreadStopResult` | `apps/server/src/internal/command-result-handlers.ts:263` | Result handler — transitions thread to `"idle"` and appends an interrupted event on success |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
