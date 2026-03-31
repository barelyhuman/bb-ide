# `POST /internal/session/events` — Ingest Provider Event Batch

**Route:** `apps/server/src/internal/events.ts:174`
**Contract:** `hostDaemonEventBatchRequestSchema -> HostDaemonEventBatchResponse` (200)
**Complexity:** High

## Request Body

| Field | Required | Notes |
|---|---|---|
| `sessionId` | Yes | Validated via `requireActiveSession`. Used to resolve `hostId` for ownership check. |
| `events` | Yes | Array of `HostDaemonEventEnvelope`. Each contains: |
| `events[].environmentId` | Yes | Stored on the event row. Not used directly in ownership validation; ownership is checked from `threadId` -> thread environment -> host. |
| `events[].threadId` | Yes | Stored on the event row. Used for ownership validation, side effects, and HWM response. |
| `events[].sequence` | Yes | Per-thread monotonic sequence number. Used as the dedup key via `INSERT OR IGNORE` on unique index `(threadId, sequence)`. |
| `events[].createdAt` | Yes | Forwarded into the stored event row as `createdAt`. |
| `events[].event` | Yes | The typed `threadEventSchema` discriminated union. Decomposed by `toStoredEvent`: `type` extracted, rest serialized as JSON `data`. `resolveProviderIdentifiers` extracts `providerThreadId` and `turnId` based on event type. |

**All envelope fields consumed. No dead params.**

## Implementation Trace

1. **Validate request** (sync) — Zod middleware parses body against `hostDaemonEventBatchRequestSchema`. Each event's `event` field is validated against `threadEventSchema` (large discriminated union).
2. **Require active session** (sync) — `requireActiveSession(db, payload.sessionId)`.
3. **Validate ownership** (sync) — `validateEventBatchOwnership(deps, { hostId, events })`:
   - Collects unique `threadId`s from the batch.
   - SELECT `threads.id` FROM `threads` INNER JOIN `environments` WHERE `threads.id IN (...)` AND `environments.hostId = session.hostId`.
   - If count of owned threads !== count of unique thread IDs, throws 403.
4. **Insert events** (sync) — `insertEvents(db, hub, events.map(toStoredEvent))`:
   - `toStoredEvent` transforms each envelope: extracts `type`, serializes remaining `event` data as JSON, resolves `providerThreadId` and `turnId` via exhaustive switch on event type, and preserves the daemon-supplied `createdAt`.
   - For each event: `INSERT OR IGNORE INTO events (...)` — deduplicates on `(threadId, sequence)` unique index.
   - For each thread that got new events: `hub.notifyThread(threadId, ["events-appended"])` — pushes to subscribed client WebSockets.
5. **Apply side effects** (async) — `applyEventEffects(deps, events)`:
   - Iterates over each event in order. Per-event error handling with try/catch + logger.error (non-fatal).
   - **`turn/started`**: If thread exists and is `idle` or `error`, transition to `active`.
   - **`turn/completed`**: `applyTurnCompletedEvent(deps, ...)`:
     - If `status === "failed"`: transition thread to `error`.
     - If `status === "interrupted"`: transition thread to `idle`.
     - Otherwise (completed): if thread is `active` or `error`, transition to `idle`.
     - Then: if `status === "completed"`, `sendNextQueuedDraftIfPresent(deps, { threadId })` — claims and sends the next queued message for auto-continuation.
   - **`thread/name/updated`**: `updateThread(db, hub, threadId, { title: event.threadName })`.
   - **All other event types**: No side effects.
6. **Compute response** (sync) — `getHighWaterMarks(db, threadIds)`: SELECT `MAX(sequence)` from `events` grouped by `threadId` for all threads in the batch.

> **-> HTTP 200 returns here.** Side effects (`sendNextQueuedDraftIfPresent`) are awaited before response.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | SELECT session | `host_daemon_sessions` | PK | requireActiveSession |
| 2 | SELECT threads JOIN environments for ownership | `threads`, `environments` | `threads_environment_idx`, env PK | Batch ownership |
| 3 | N x INSERT OR IGNORE event | `events` | `events_thread_sequence_idx` (dedup) | Per-event insert |
| 4 | Per-event side effects | `threads` | PK | getThread, tryTransition per turn/started and turn/completed |
| 5 | sendNextQueuedDraftIfPresent | `queued_thread_messages`, `threads`, `environments`, `host_daemon_commands` | various | Only on turn/completed with status=completed |
| 6 | SELECT MAX(sequence) grouped by threadId | `events` | `events_thread_sequence_idx` | HWM response |

**Total: 3 + N (inserts) + variable side-effect queries. Not N+1 for inserts (each is independent), but the per-event side effect loop could be N+1 for batches with many turn events.**

## Code Reuse

- `requireActiveSession` — shared guard.
- `insertEvents` / `getHighWaterMarks` — shared DB functions.
- `resolveProviderIdentifiers` — local to events.ts, exhaustive switch.
- `toStoredEvent` — local to events.ts.
- `applyTurnCompletedEvent` — in `turn-completed-events.ts`, also used by `handleTurnCompletedEvents`.
- `tryTransition` — shared utility.
- `sendNextQueuedDraftIfPresent` — shared service, also used by draft send flow.
- `updateThread` — shared DB function.

## Flags

1. **`environmentId` is trusted from the payload**: Ownership is checked only from `threadId`. If the daemon ever sent a mismatched `environmentId` and `threadId`, the route would still store the provided `environmentId`.
2. **Side effects are non-transactional with inserts**: Events are inserted first, then side effects run in a separate loop. If the server crashes mid-side-effects, events are persisted but effects (thread transitions, queued draft sends) may be lost. The `INSERT OR IGNORE` dedup means re-sending the batch will not re-trigger side effects for already-inserted events.
3. **`sendNextQueuedDraftIfPresent` is awaited in the hot path**: For `turn/completed` with `status=completed`, the route awaits the full draft send flow (claim, build execution options, queue command, transition). This blocks the HTTP response for potentially expensive work.
4. **Ownership check uses `inArray` for thread IDs**: For very large batches with many distinct threads, the `IN (...)` clause could be large. Unlikely in practice (batches are usually for 1-2 threads).
5. **Error swallowing in `applyEventEffects`**: Side-effect errors are logged but not propagated. This means the route returns 200 even if thread transitions fail. This is intentional (events are persisted regardless) but could mask systematic issues.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `createServerClient().postEvents` | `apps/host-daemon/src/server-client.ts:310` | POSTs event batch to `/session/events`, returns thread high-water marks |
| `createEventBuffer` | `apps/host-daemon/src/event-buffer.ts:153` | Calls `postEvents` to flush buffered provider events to the server |
| `createDaemonApp` | `apps/host-daemon/src/app.ts:139` | Wires `serverClient.postEvents` into the event buffer |
| `RuntimeManager.onEvent` | `apps/host-daemon/src/app.ts:144` | Pushes runtime events into the event buffer, which flushes via `postEvents` |
| `HostDaemonInternalSchema["/session/events"]` | `packages/host-daemon-contract/src/session.ts:157` | Type-level contract definition for the endpoint |
| `createHostDaemonClient` | `packages/host-daemon-contract/src/session.ts:175` | Typed Hono RPC client used by integration tests |
| Test: event envelope threadId regression | `apps/server/test/internal-event-envelope-threadid-regression.test.ts:45` | Tests threadId validation in event envelopes |
| Test: event + tool-call routes | `apps/server/test/internal-events-tool-calls.test.ts:34` | Tests event ingestion and side effects |
| Test: event side effects | `apps/server/test/internal-event-side-effects.test.ts:50` | Tests turn/started and turn/completed side effects |
| Test: authorization regression | `apps/server/test/internal-authorization-regressions.test.ts:136` | Tests cross-session ownership check on event posting |
| Test: fake test-server | `apps/host-daemon/test/helpers/test-server.ts:188` | Fake server stub for host-daemon unit tests |
| Test: event buffer | `apps/host-daemon/src/event-buffer.test.ts:35` | Tests event buffer flush behavior with mocked `postEvents` |

---

## Review Comments

<!-- Flag 1 is the main contract-risk detail left in this route. Flags 2-5 are reliability and performance tradeoffs. -->
