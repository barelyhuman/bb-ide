# `thread.rename` — Rename a Thread (Host-Daemon Command)

**Schema:** `packages/host-daemon-contract/src/commands.ts:121`
**Handler:** `apps/host-daemon/src/command-dispatch.ts:85` (inline in dispatch)
**Result Schema:** `packages/host-daemon-contract/src/commands.ts:304`
**Workspace Lane:** No (runs freely)

## Command Payload

| Field | Required | Notes |
|---|---|---|
| `type` | Yes | Literal `"thread.rename"` |
| `environmentId` | Yes | Identifies the runtime entry. Passed to `requireExistingEnvironment`. |
| `threadId` | Yes | Identifies the thread to rename. Passed to `runtime.renameThread`. |
| `title` | Yes | New title for the thread. Non-empty string. Passed to `runtime.renameThread`. |

**All 4 fields consumed. No dead params.**

## Implementation Trace

1. `dispatchCommand` matches `"thread.rename"`.
2. Calls `requireExistingEnvironment(command.environmentId, options.runtimeManager)`.
   - Throws `CommandDispatchError("unknown_environment", ...)` if no runtime exists.
3. Calls `entry.runtime.renameThread({ threadId: command.threadId, title: command.title })`.
   - Delegates to the provider adapter to update the thread's title.
4. Returns `{}`.

## Code Reuse

- `requireExistingEnvironment` is shared with `thread.stop`.

## Flags

None. Clean.

## Usages

| Caller | Location | Trigger |
|---|---|---|
| `queueThreadRenameCommand` | `apps/server/src/services/thread-commands.ts:249` | Wrapper that builds and queues a `"thread.rename"` command |
| `PATCH /threads/:id` | `apps/server/src/routes/threads/base.ts:61` | Calls `queueThreadRenameCommand` when the request includes a new `title` and the environment is ready |
| `generateAndSetThreadTitle` | `apps/server/src/services/title-generation.ts:124` | Queues `thread.rename` directly via `queueCommand` (does not use the wrapper) after auto-generating a title from conversation content |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
