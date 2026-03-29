# `thread.resume` — Reconnect Provider Session After Daemon Restart (Host-Daemon Command)

**Schema:** `packages/host-daemon-contract/src/commands.ts:93`
**Handler:** `apps/host-daemon/src/command-handlers/thread.ts:30`
**Result Schema:** `packages/host-daemon-contract/src/commands.ts:296`
**Workspace Lane:** No (runs freely)

## Command Payload

| Field | Required | Notes |
|---|---|---|
| `type` | Yes | Literal `"thread.resume"` |
| `environmentId` | Yes | Target environment. Used to look up or create a `RuntimeEntry`. |
| `threadId` | Yes | BB-side thread identifier. Passed to `runtime.resumeThread`. |
| `workspacePath` | Yes | Filesystem path. Passed to `ensureEnvironment` for workspace provisioning. |
| `projectId` | Yes | Passed through to `runtime.resumeThread`. |
| `providerId` | Yes | Selects which AI provider adapter to reconnect with. |
| `providerThreadId` | Yes | The provider's internal thread ID from a prior session. Used to reconnect/rehydrate the provider session. |
| `options` | Yes | `HostDaemonExecutionOptions` — required `model`, `serviceTier`, `reasoningLevel`, `sandboxMode`. |
| `instructions` | Yes | System instructions for the resumed session. |
| `dynamicTools` | Yes | Array of `DynamicTool`. Re-registered with the provider on resume. |

**All 10 fields consumed. No dead params.**

## Implementation Trace

1. `dispatchCommand` matches `"thread.resume"`.
2. No `seedThreadHighWaterMarkIfPresent` call (resume has no `eventSequence` — it doesn't start a turn).
3. Calls `resumeThread(command, options)` in `command-handlers/thread.ts`.
4. Inside `resumeThread`:
   1. Calls `runtimeManager.ensureEnvironment({ environmentId, workspacePath })`.
      - Creates or reuses the runtime entry.
   2. Calls `entry.runtime.resumeThread({ threadId, projectId, providerThreadId, providerId, options, instructions, resumePath: workspacePath, dynamicTools })`.
      - Reconnects to an existing provider thread. Does NOT start a new turn.
      - Returns `{ providerThreadId }`.
   3. Calls `runtimeManager.markThreadActive(environmentId, threadId, providerThreadId)`.
5. Returns `{ providerThreadId }`.

## Code Reuse

- `ensureEnvironment` shared with `startThread` and `ensureThreadRuntime`.
- `markThreadActive` shared across all thread-starting commands.
- The same `runtime.resumeThread` call is reused internally by `ensureThreadRuntime` (turn.run/turn.steer auto-resume path).

## Flags

1. **`resumePath` is `workspacePath`.** The handler passes `command.workspacePath` as `resumePath` to `runtime.resumeThread`. This field name mismatch is cosmetic but worth noting — the runtime interface accepts `resumePath?` as optional, while the command always provides it.

## Usages

| Caller | Location | Trigger |
|---|---|---|
| *(no server-side callers)* | — | The server never explicitly queues `thread.resume`. Instead, the daemon's `ensureThreadRuntime` (used by `turn.run` and `turn.steer`) auto-resumes internally when it finds the environment exists but the thread is not registered. |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
