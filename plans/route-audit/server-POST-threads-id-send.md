# `POST /api/v1/threads/:id/send` — Send Message to Thread

**Route:** `apps/server/src/routes/threads/actions.ts:74`
**Contract:** `sendMessageRequestSchema -> { ok: true }` (200)
**Complexity:** High

## Request Body (or Params)

| Field            | Required | Notes                                                                                                                          |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `input`          | Yes      | `PromptInput[]` (min 1). Passed through to the appended event and the daemon command payload.                                  |
| `model`          | No       | Overrides stored model for this turn. Falls through to `resolveExecutionOptions` which checks last event, then errors if none. |
| `serviceTier`    | No       | Overrides stored tier. Defaults to `"flex"` if no prior value.                                                                 |
| `reasoningLevel` | No       | Overrides stored level. Defaults to `"medium"` if no prior value.                                                              |
| `sandboxMode`    | No       | Overrides stored mode. Defaults to `"danger-full-access"` if no prior value.                                                   |
| `mode`           | Yes      | `"auto"                                                                                                                        | "start" | "steer"`. `resolveSendMode`maps`auto`based on`thread.status`. `start`rejects if already active;`steer` rejects if not active. |

**All 6 fields consumed. No dead params.**

## Implementation Trace

1. **`requireThreadEnvironment(db, id)`** (sync) -- fetches thread by PK, then environment by PK. Throws 404/409.
2. **`ensureThreadIsWritable(thread)`** (sync) -- rejects if `thread.archivedAt` is set (409).
3. **`resolveSendMode(thread.status, payload.mode)`** (sync) -- resolves `"auto"` to `"start"` or `"steer"` based on `thread.status`. Throws 409 on conflict.
4. **`buildExecutionOptions(deps, payload, { threadId }, "client/turn/requested")`** (async)
   - Calls `resolveExecutionOptions` which reads `getLastExecutionOptions` from the `events` table (scan for latest `client/thread/start | client/turn/requested | client/turn/start` event, ordered by sequence DESC, LIMIT 1).
   - Merges requested overrides with last-stored values and applies defaults.
5. **`queueTurnDuringReprovision({...})`** (sync) -- checks if environment is NOT ready.
   - If environment is managed and in a reprovisionable state, queues a reprovision command and appends a `client/turn/requested` event. Returns `true` -> route returns `{ ok: true }` immediately.
   - If environment IS ready, returns `false` -> continues to step 6.
6. **`requireReadyThreadEnvironment(environment)`** (sync) -- asserts `status === "ready"` and `path` is non-null.
7. **`appendClientTurnEvent(deps, {...})`** (sync)
   - Runs in a transaction: reads `MAX(sequence)` from events for this thread, inserts new event at `sequence + 1`.
   - Event type: `"client/turn/requested"`, data includes `input`, `execution`, `direction: "outbound"`, `source: "tell"`, `initiator: "user"`.
   - Notifies hub: `notifyThread(threadId, ["events-appended"])`.
8. **If mode === "start":**
   - **`queueReadyThreadTurnCommand(deps, {...})`** (async)
     - Calls `getLastProviderThreadId(deps, thread.id)` -- scans events for latest non-null `providerThreadId` (DESC LIMIT 1).
     - If providerThreadId exists: dispatches `turn.run` command (existing provider session).
     - If no providerThreadId: dispatches `thread.start` command (new provider session).
     - Both paths:
       - Call `resolveThreadRuntimeCommandConfig` which reads `getProject`.
       - For manager threads, `resolveThreadRuntimeCommandConfig` also reads the active host session to derive `managerWorkspacePath = <dataDir>/workspace/<threadId>` and synchronously fetches `PREFERENCES.md` via a bounded `host.read_file` command with `rootPath = managerWorkspacePath` before queueing the actual turn command.
       - Call `requireConnectedHostSession` -- queries `host_daemon_sessions` for active session with valid lease.
       - Call `queueCommand` -- transactional insert into `host_daemon_commands` with monotonic cursor.
     - `turn.run` also transitions thread to "active" if currently "idle".
   - **`tryTransition(db, hub, thread.id, "active")`** (sync) -- attempts `transitionThreadStatus`; swallows errors.
9. **If mode === "steer":**
   - **`getLastTurnId(deps, thread.id)`** (sync) -- scans events for latest non-null `turnId` (DESC LIMIT 1). Throws 409 if null.
   - **`queueTurnSteerCommand(deps, {...})`** (async)
     - Same runtime config resolution as `turn.run`.
     - Dispatches `turn.steer` command with `expectedTurnId`.

> **-> HTTP 200 returns here.** The `turn.run` / `turn.steer` / `thread.start` command is queued in `host_daemon_commands` and picked up asynchronously by the daemon on its next poll.

## DB Query Summary

| #   | Query                               | Table                  | Index                                  | Notes                                                                                      |
| --- | ----------------------------------- | ---------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | SELECT thread by PK                 | `threads`              | PK                                     | `getThread`                                                                                |
| 2   | SELECT environment by PK            | `environments`         | PK                                     | `getEnvironment`                                                                           |
| 3   | SELECT latest execution event       | `events`               | `events_thread_sequence_idx`           | `getLastExecutionOptions` -- WHERE threadId + type IN (...) ORDER BY sequence DESC LIMIT 1 |
| 4   | SELECT MAX(sequence) + INSERT event | `events`               | `events_thread_sequence_idx`           | `appendThreadEvent` in transaction                                                         |
| 5   | SELECT latest providerThreadId      | `events`               | `events_thread_sequence_idx`           | `getLastProviderThreadId` (start mode only)                                                |
| 6   | SELECT active session               | `host_daemon_sessions` | `host_daemon_sessions_host_status_idx` | `getActiveSession` / `requireConnectedHostSession`; manager threads do this again when deriving `managerWorkspacePath` |
| 7   | SELECT project                      | `projects`             | PK                                     | `resolveThreadRuntimeCommandConfig`                                                        |
| 8   | Manager only: SELECT MAX(cursor) + INSERT `host.read_file` command | `host_daemon_commands` | `host_daemon_commands_host_cursor_idx` | `queueCommandAndWait` inside `readManagerPreferences`                                      |
| 9   | SELECT MAX(cursor) + INSERT command | `host_daemon_commands` | `host_daemon_commands_host_cursor_idx` | `queueCommand` in transaction                                                              |
| 10  | SELECT + UPDATE thread status       | `threads`              | PK                                     | `transitionThreadStatus` (start mode) or skipped (steer mode)                              |
| 11  | SELECT latest turnId                | `events`               | `events_thread_sequence_idx`           | `getLastTurnId` (steer mode only)                                                          |

**Total: 8-11 queries plus one synchronous daemon round-trip for manager threads. No N+1.**

## Code Reuse

| Function                      | Shared with                         |
| ----------------------------- | ----------------------------------- |
| `requireThreadEnvironment`    | drafts/send, stop, archive          |
| `ensureThreadIsWritable`      | drafts, drafts/send                 |
| `buildExecutionOptions`       | drafts, queued-drafts               |
| `appendClientTurnEvent`       | queued-drafts, thread-turn-dispatch |
| `queueReadyThreadTurnCommand` | queued-drafts                       |
| `queueTurnSteerCommand`       | queued-drafts                       |
| `tryTransition`               | queued-drafts                       |
| `getLastTurnId`               | queued-drafts                       |
| `queueTurnDuringReprovision`  | queued-drafts                       |

## Flags

1. **`resolveSendMode` logic diverges from queued-draft send.** The route exposes `mode: "auto" | "start" | "steer"` with explicit validation, while `resolveQueuedDraftSendMode` in `queued-drafts.ts` is always "auto" (no user override). This is likely intentional but worth noting -- a draft cannot request `mode: "start"` explicitly.
2. **`queueReadyThreadTurnCommand` dispatches `thread.start` when no `providerThreadId` exists, even in mode="start".** This means a re-started idle thread that already has a provider session will get `turn.run` not `thread.start`. The `tryTransition` to "active" in the route is redundant with `queueTurnRunCommand`'s internal transition -- but harmless since `tryTransition` swallows errors.
3. **No explicit archived-check on the environment.** `ensureThreadIsWritable` only checks `thread.archivedAt`. If the environment is somehow in a bad state, `requireReadyThreadEnvironment` or `queueTurnDuringReprovision` will catch it, but the error messages differ.

## Usages

| Caller                                            | Location                                                                           | Purpose                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `sendMessageRequestSchema` / `SendMessageRequest` | `packages/server-contract/src/api-types.ts`                                        | Contract definition for the request body                                   |
| Public API type `"/threads/:id/send"`             | `packages/server-contract/src/public-api.ts:192`                                   | Typed route definition consumed by API clients                             |
| `api.sendThreadMessage`                           | `apps/app/src/lib/api.ts:378`                                                      | App-level API wrapper calling `threads[":id"].send.$post`                  |
| `useSendThreadMessage`                            | `apps/app/src/hooks/useApi.ts:753`                                                 | React mutation hook wrapping `api.sendThreadMessage`                       |
| `sendMessage.mutateAsync`                         | `apps/app/src/views/ThreadDetailView.tsx:241,540,886`                              | UI: send user message (new turn or steer) from thread detail view          |
| `postThreadMessage` (CLI `tell` command)          | `apps/cli/src/commands/thread/actions.ts:263`                                      | CLI: `bb thread tell <id> <message>` sends via `threads[":id"].send.$post` |
| `sendTextMessage` (integration helper)            | `tests/integration/helpers/api.ts:326`                                             | Integration test helper wrapping `threads[":id"].send.$post`               |
| Integration tests (fake)                          | `tests/integration/fake/smoke.test.ts`, `multi-thread.test.ts`, `recovery.test.ts` | Fake-provider integration tests via `sendTextMessage`                      |
| Integration tests (real)                          | `tests/integration/real/provider-smoke.test.ts`                                    | Real-provider smoke tests via `sendTextMessage`                            |
| Integration tests (direct)                        | `tests/integration/fake/smoke.test.ts:520,725,735,774`                             | Direct `threads[":id"].send.$post` calls (archive-reject, steer scenarios) |
| Server unit tests                                 | `apps/server/test/public-threads.test.ts:506,541,600,619,968`                      | Unit tests for send route (mode resolution, steer, manager sends)          |
| Server integration test                           | `apps/server/test/integration.test.ts:480`                                         | Integration test via `publicClient.threads[":id"].send.$post`              |
| Contract tests                                    | `packages/server-contract/test/contract.test.ts:94,183,214`                        | Schema parse tests and URL generation tests                                |

---

> **Updated 2026-03-29:** DB functions now use RETURNING — post-write re-reads eliminated.

## Review Comments

> 2. **`queueReadyThreadTurnCommand` dispatches `thread.start` when no `providerThreadId` exists, even in mode="start".** This means a re-started idle thread that already has a provider session will get `turn.run` not `thread.start`. The `tryTransition` to "active" in the route is redundant with `queueTurnRunCommand`'s internal transition -- but harmless since `tryTransition` swallows errors.

tell me more about this

> `queueReadyThreadTurnCommand` ignores the `mode` parameter. It checks `getLastProviderThreadId()`:
> - No provider session → `thread.start` (new session)
> - Has provider session → `turn.run` (reuse session)
>
> An idle thread that already ran a turn always has a `providerThreadId` in events, so it always gets `turn.run` regardless of mode. This is correct — `turn.run` on an idle thread works because the daemon's `ensureThreadRuntime` handles reconnection transparently.
>
> The `tryTransition` in the route is redundant for the `turn.run` path (which does its own idle→active transition) but needed for `thread.start` (which doesn't). Harmless since `tryTransition` swallows errors.
