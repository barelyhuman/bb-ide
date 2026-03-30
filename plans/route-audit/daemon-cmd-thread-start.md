# `thread.start` — Start a New Thread with Initial Input (Host-Daemon Command)

**Schema:** `packages/host-daemon-contract/src/commands.ts:84`
**Handler:** `apps/host-daemon/src/command-handlers/thread.ts:5`
**Result Schema:** `packages/host-daemon-contract/src/commands.ts:293`
**Workspace Lane:** No (not serialized per environment; runs freely)

## Command Payload

| Field | Required | Notes |
|---|---|---|
| `type` | Yes | Literal `"thread.start"` |
| `environmentId` | Yes | Target environment for the thread. Used to look up or create a `RuntimeEntry`. |
| `threadId` | Yes | BB-side thread identifier. Passed to `runtime.startThread` and used by `markThreadActive`. |
| `workspaceContext` | Yes | Object with `workspacePath` and `workspaceProvisionType`. Replaces flat `workspacePath`. Passed to `ensureEnvironment` to provision workspace with correct managed type if needed after daemon restart. |
| `projectId` | Yes | Passed through to `runtime.startThread` for provider session context. |
| `providerId` | Yes | Selects which AI provider adapter to use. |
| `options` | Yes | `HostDaemonExecutionOptions` — extends `ThreadExecutionOptions` with required `model`, `serviceTier`, `reasoningLevel`, `sandboxMode`. Passed to `runtime.startThread`. |
| `instructions` | Yes | System instructions for the AI session. Passed to `runtime.startThread`. |
| `dynamicTools` | Yes | Array of `DynamicTool` (`name`, `description`, `inputSchema`). Registered with the provider session. |
| `eventSequence` | Yes | Non-negative int. Seeded into the high-water mark tracker via `seedThreadHighWaterMark` before dispatch. |
| `input` | Yes | Non-empty array of `PromptInput` (text, image, localImage, localFile). The initial user message. |

**All 11 fields consumed. No dead params.**

## Implementation Trace

1. `dispatchCommand` matches `"thread.start"`.
2. `seedThreadHighWaterMarkIfPresent` is called with `command.eventSequence` and `command.threadId`, seeding the high-water mark for event deduplication on the server side.
3. Calls `startThread(command, options)` in `command-handlers/thread.ts`.
4. Inside `startThread`:
   1. Calls `runtimeManager.ensureEnvironment({ environmentId, workspacePath })`.
      - If the environment already exists, returns the cached `RuntimeEntry`.
      - Otherwise, provisions a workspace (unmanaged) and creates an `AgentRuntime` with event/tool-call callbacks.
   2. Calls `entry.runtime.startThread({ threadId, projectId, providerId, input, options, instructions, dynamicTools })`.
      - This starts a new provider session (e.g., spawns a Codex subprocess).
      - The provider emits events via `onEvent` callback, which are forwarded to the server.
      - Returns `{ providerThreadId }` once the provider session is established.
   3. Calls `runtimeManager.markThreadActive(environmentId, threadId, providerThreadId)`.
      - Records the thread in the runtime entry's `threads` map with status `"active"`.
5. Returns `{ providerThreadId }` to the caller.

## Code Reuse

- `ensureEnvironment` is shared with `ensureThreadRuntime` (turn.run/turn.steer).
- `markThreadActive` is shared across all thread-starting commands and also called internally by the `RuntimeManager.onEvent` callback for `thread/identity` events.
- `seedThreadHighWaterMarkIfPresent` is shared with `turn.run` and `turn.steer`.

## Flags

1. **No workspace lane serialization.** Thread commands are not gated by `requiresWorkspaceLane` (only `environment.*` and `workspace.*` are). Two concurrent `thread.start` commands for the same environment could race through `ensureEnvironment`. The `pendingEntries` dedup in `RuntimeManager` handles this correctly, but it's worth noting the design intent.

## Usages

| Caller | Location | Trigger |
|---|---|---|
| `queueThreadStartCommand` | `apps/server/src/services/thread-commands.ts:72` | Wrapper that builds runtime config and calls `queueCommand` with `"thread.start"` |
| `startQueuedThreadIfNeeded` | `apps/server/src/services/thread-create.ts:177` | Calls `queueThreadStartCommand`; triggered by `POST /threads` when environment is already ready |
| `queueReadyThreadTurnCommand` | `apps/server/src/services/thread-commands.ts:119` | Falls back to `queueThreadStartCommand` when no `providerThreadId` exists (fresh thread, no prior provider session) |
| `handleProvisionCommandResult` | `apps/server/src/internal/command-result-handlers.ts:191` | Calls `queueThreadStartCommand` after `environment.provision` succeeds, for each bound thread that has a pending start/turn event |
| `POST /threads/:id/send` | `apps/server/src/routes/threads/actions.ts:112` | Calls `queueReadyThreadTurnCommand` (which may fall through to `queueThreadStartCommand`) when `mode === "start"` |
| `sendQueuedDraft` | `apps/server/src/services/queued-drafts.ts:114` | Calls `queueReadyThreadTurnCommand` (which may fall through to `queueThreadStartCommand`) when draft send mode is `"start"` |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
