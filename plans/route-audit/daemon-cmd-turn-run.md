# `turn.run` — Run a Conversation Turn (Host-Daemon Command)

**Schema:** `packages/host-daemon-contract/src/commands.ts:100`
**Handler:** `apps/host-daemon/src/command-dispatch.ts:49` (inline dispatch) + `apps/host-daemon/src/command-handlers/thread.ts:56` (`ensureThreadRuntime`)
**Result Schema:** `packages/host-daemon-contract/src/commands.ts:299`
**Workspace Lane:** No (runs freely)

## Command Payload

| Field | Required | Notes |
|---|---|---|
| `type` | Yes | Literal `"turn.run"` |
| `environmentId` | Yes | Target environment. Used to look up or create runtime, and to check thread registration. |
| `threadId` | Yes | BB-side thread identifier. Passed to `runtime.runTurn`. |
| `eventSequence` | Yes | Non-negative int. Seeded into the high-water mark before dispatch. |
| `input` | Yes | Non-empty array of `PromptInput`. The user message for this turn. |
| `options` | Yes | `HostDaemonExecutionOptions` — required `model`, `serviceTier`, `reasoningLevel`, `sandboxMode`. Passed to `runtime.runTurn` and also to auto-resume. |
| `resumeContext` | Yes | Object containing session resume fields (see below). |

### `resumeContext`

| Field | Required | Notes |
|---|---|---|
| `workspaceContext` | Yes | Object with `workspacePath` and `workspaceProvisionType`. Replaces flat `workspacePath`. Used by `ensureEnvironment` with correct managed type if runtime doesn't exist, and `workspacePath` used as `resumePath` for auto-resume. |
| `projectId` | Yes | Passed to `runtime.resumeThread` during auto-resume if the thread is not registered. |
| `providerId` | Yes | Selects which provider adapter. Used during auto-resume. |
| `providerThreadId` | Yes | Provider's internal thread ID. Required for auto-resume if the daemon lost thread state. |
| `instructions` | Yes | System instructions. Passed to `runtime.runTurn` and auto-resume. |
| `dynamicTools` | Yes | Array of `DynamicTool`. Used during auto-resume to re-register tools. |

**All fields consumed. No dead params.**

## Implementation Trace

1. `dispatchCommand` matches `"turn.run"`.
2. `seedThreadHighWaterMarkIfPresent` seeds the high-water mark with `command.eventSequence` and `command.threadId`.
3. Calls `ensureThreadRuntime(command, options)` in `command-handlers/thread.ts`.
   1. Checks `runtimeManager.get(environmentId)` for an existing entry.
   2. If no entry, calls `runtimeManager.ensureEnvironment({ environmentId, workspacePath })` to create one.
   3. Checks `runtimeManager.hasThread(environmentId, threadId)`.
   4. If thread is NOT registered:
      - Validates `command.providerThreadId` is present; throws `CommandDispatchError("unknown_thread_runtime", ...)` if missing.
      - Calls `entry.runtime.resumeThread({ threadId, projectId, providerThreadId, providerId, options, instructions, resumePath: workspacePath, dynamicTools })` to auto-reconnect.
      - Calls `runtimeManager.markThreadActive(environmentId, threadId, providerThreadId)`.
   5. Returns the `RuntimeEntry`.
4. Calls `entry.runtime.runTurn({ threadId, input, options, instructions })`.
   - Sends the user input to the provider.
   - The provider streams events (tool calls, assistant messages, turn completion) via `onEvent`.
   - `runTurn` awaits until the turn completes (all tool calls resolved, final assistant response emitted).
5. Returns `{}`.

## Code Reuse

- `ensureThreadRuntime` is shared with `turn.steer`.
- `seedThreadHighWaterMarkIfPresent` is shared with `thread.start` and `turn.steer`.
- The auto-resume path inside `ensureThreadRuntime` calls `runtime.resumeThread` internally. The explicit `thread.resume` daemon command has been fully deleted; auto-resume via `ensureThreadRuntime` is the only resume path.

## Flags

1. **`dynamicTools` not passed to `runTurn`.** The `runtime.runTurn` interface does not accept `dynamicTools`. They are only registered during `startThread` or `resumeThread` (via `resumeContext`). If tools change between turns, the auto-resume path picks them up, but if the thread is already registered and tools changed since the last turn, the new tools are NOT applied. This could be intentional (tools are session-scoped) but worth verifying.
2. **Auto-resume is implicit.** If the daemon restarts between turns, `turn.run` silently auto-resumes the provider session using `ensureThreadRuntime`. The explicit `thread.resume` command has been deleted; auto-resume via `ensureThreadRuntime` is now the only resume mechanism.

## Usages

| Caller | Location | Trigger |
|---|---|---|
| `queueTurnRunCommand` | `apps/server/src/services/thread-commands.ts:154` | Wrapper that resolves runtime config, requires a `providerThreadId`, and queues `"turn.run"` |
| `queueReadyThreadTurnCommand` | `apps/server/src/services/thread-commands.ts:104` | Calls `queueTurnRunCommand` when a `providerThreadId` exists (existing provider session) |
| `POST /threads/:id/send` | `apps/server/src/routes/threads/actions.ts:112` | Calls `queueReadyThreadTurnCommand` when `mode === "start"` (which delegates to `queueTurnRunCommand` if provider session exists) |
| `sendQueuedDraft` | `apps/server/src/services/queued-drafts.ts:114` | Calls `queueReadyThreadTurnCommand` when draft send mode is `"start"` (same delegation path) |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
