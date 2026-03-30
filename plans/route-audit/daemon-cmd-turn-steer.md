# `turn.steer` — Steer an In-Progress Turn (Host-Daemon Command)

**Schema:** `packages/host-daemon-contract/src/commands.ts:108`
**Handler:** `apps/host-daemon/src/command-dispatch.ts:61` (inline dispatch) + `apps/host-daemon/src/command-handlers/thread.ts:56` (`ensureThreadRuntime`)
**Result Schema:** `packages/host-daemon-contract/src/commands.ts:300`
**Workspace Lane:** No (runs freely)

## Command Payload

| Field | Required | Notes |
|---|---|---|
| `type` | Yes | Literal `"turn.steer"` |
| `environmentId` | Yes | Target environment. Used to look up or create runtime, and to check thread registration. |
| `threadId` | Yes | BB-side thread identifier. Passed to `runtime.steerTurn`. |
| `eventSequence` | Yes | Non-negative int. Seeded into the high-water mark before dispatch. |
| `expectedTurnId` | Yes | Non-empty string. Identifies the specific in-progress turn to steer. Passed to `runtime.steerTurn` as a guard to ensure the steer targets the correct turn. |
| `input` | Yes | Non-empty array of `PromptInput`. The steering input injected into the current turn. |
| `options` | Yes | `HostDaemonExecutionOptions` — required `model`, `serviceTier`, `reasoningLevel`, `sandboxMode`. Passed to `runtime.steerTurn` and auto-resume. |
| `resumeContext` | Yes | Object containing session resume fields (see below). |

### `resumeContext`

| Field | Required | Notes |
|---|---|---|
| `workspaceContext` | Yes | Object with `workspacePath` and `workspaceProvisionType`. Replaces flat `workspacePath`. Used by `ensureEnvironment` with correct managed type if needed, and `workspacePath` used as `resumePath` for auto-resume. |
| `projectId` | Yes | Passed to `runtime.resumeThread` during auto-resume. |
| `providerId` | Yes | Selects which provider adapter. Used during auto-resume. |
| `providerThreadId` | Yes | Provider's internal thread ID. Required for auto-resume. |
| `instructions` | Yes | System instructions. Passed to `runtime.steerTurn` and auto-resume. |
| `dynamicTools` | Yes | Array of `DynamicTool`. Used during auto-resume. |

**All fields consumed. No dead params.**

## Implementation Trace

1. `dispatchCommand` matches `"turn.steer"`.
2. `seedThreadHighWaterMarkIfPresent` seeds the high-water mark with `command.eventSequence` and `command.threadId`.
3. Calls `ensureThreadRuntime(command, options)` — same auto-resume logic as `turn.run` (see that audit for details).
4. Calls `entry.runtime.steerTurn({ threadId, expectedTurnId, input, options, instructions })`.
   - Injects the steering input into the currently running turn.
   - `expectedTurnId` acts as a guard — if the turn has already completed or a different turn is running, the provider can reject the steer.
   - The provider continues streaming events via `onEvent`.
5. Returns `{}`.

## Code Reuse

- `ensureThreadRuntime` is shared with `turn.run`.
- `seedThreadHighWaterMarkIfPresent` is shared with `thread.start` and `turn.run`.
- Auto-resume path identical to `turn.run`. The explicit `thread.resume` command has been deleted; this is the only resume mechanism.

## Flags

1. **Same `dynamicTools` caveat as `turn.run`.** `steerTurn` on the runtime interface does not accept `dynamicTools`. They are only applied during auto-resume (via `resumeContext`), not if the thread is already registered. Same concern as flag #1 on `turn.run`.
2. **`expectedTurnId` validation is provider-side.** The daemon does not validate whether `expectedTurnId` matches a currently running turn — it passes it through to the runtime. If the runtime/provider rejects, it surfaces as an error. This is clean separation of concerns but means steer errors are only caught at the provider level.

## Usages

| Caller | Location | Trigger |
|---|---|---|
| `queueTurnSteerCommand` | `apps/server/src/services/thread-commands.ts:200` | Wrapper that resolves runtime config, requires a `providerThreadId` and `expectedTurnId`, and queues `"turn.steer"` |
| `POST /threads/:id/send` | `apps/server/src/routes/threads/actions.ts:129` | Calls `queueTurnSteerCommand` when `mode === "steer"` (thread is active, user sends steering input) |
| `sendQueuedDraft` | `apps/server/src/services/queued-drafts.ts:131` | Calls `queueTurnSteerCommand` when draft send mode is `"steer"` |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
