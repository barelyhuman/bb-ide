# Dead Params Cleanup & Command Cursor Simplification

**Created:** 2026-03-31
**Status:** Draft — reviewed, findings incorporated

## Background

A route audit of the four internal daemon endpoints (`session/open`, `session/events`, `session/tool-call`, `session/command-result`) found 7 dead params — fields accepted by the server schema but never consumed by the handler. Per AGENTS.md: "Accepted-but-ignored route or command fields are forbidden."

Investigation into the `cursor` field on command-result led to a broader finding: the entire server-side cursor tracking system (`host_daemon_cursors` table, `advanceHostCursor`) is write-only dead code, and the daemon-side cursor persistence is redundant with the existing `state = 'pending'` filter + `sweepExpiredCommands` recovery mechanism.

This plan covers both the dead params fix and the cursor simplification.

---

## Part 1: Dead Params — Use or Delete

### 1A. `events[].createdAt` — USE the daemon's timestamp (with caveat)

**Problem:** The daemon captures `createdAt` when the event enters the buffer (close to actual occurrence). The server discards it and uses `Date.now()` at insertion time. The gap includes buffer debounce (up to 100ms), network latency, and server processing. Since `createdAt` is used downstream for timeline ordering and duration display, the server's timestamp inflates perceived durations.

**Clock skew caveat:** Server-originated events for the same thread (via `appendThreadEvent` in `thread-events.ts:57`) will continue to use server `Date.now()`. This means a single thread's event timeline will mix two clock domains: daemon time for provider events, server time for system events (provisioning, error, thread-title, ownership-change, interrupted, client turn requests). If the daemon host and server have clock drift, `createdAt`-based ordering and duration display could become inconsistent.

**Options:**
- **(a) Use daemon timestamps anyway** — accept the skew tradeoff. In practice, NTP keeps clocks within ~10ms on modern machines, and the current server-side `Date.now()` already introduces 100ms+ of artificial delay. Net improvement for the common case, with a documented risk for unusual clock drift scenarios. Note: E2B/Firecracker microVMs inherit the host clock at boot and typically don't run NTP; for short-lived sandboxes drift is negligible, but long-running sessions could accumulate skew.
- **(b) Normalize at the server boundary** — server uses daemon timestamp as `daemonCreatedAt` (store in event data JSON for debugging) but continues to use `Date.now()` as the canonical `createdAt`. No clock mixing, but loses the accuracy benefit.
- **(c) Use daemon timestamps and also switch `appendThreadEvent` to accept an optional timestamp** — fullest solution but scope creep since `appendThreadEvent` is used in many places.

**Recommendation:** Option (a) for now. The accuracy improvement outweighs the skew risk. Add a comment in `toStoredEvent` noting the mixed-clock tradeoff.

**Change:** Pass `envelope.createdAt` through `toStoredEvent` and use it in `insertEvents`.

**Files:**
- `apps/server/src/internal/events.ts:75-85` — `toStoredEvent()`: include `createdAt` from envelope in the returned object
- `packages/db/src/data/events.ts:8-16` — add optional `createdAt` to `InsertEventInput` type
- `packages/db/src/data/events.ts:30-40` — `insertEvents()`: use per-event `createdAt` instead of generating a single `now`. Fall back to `Date.now()` if missing (defensive, shouldn't happen)

### 1B. `events[].id` — DELETE from contract and sender

**Problem:** The daemon generates `${threadId}:${sequence}:${createdAt}` as an envelope ID. The server ignores it and generates its own via `createEventId()`. The daemon's ID carries no information the server doesn't already have. Dedup is handled by the `(threadId, sequence)` unique index.

**Change:** Remove `id` from the event envelope schema and from the daemon's event buffer.

**Files:**
- `packages/host-daemon-contract/src/session.ts:65` — remove `id` field from `hostDaemonEventEnvelopeSchema`
- `apps/host-daemon/src/event-buffer.ts:5-11` — remove `id` from `BufferedEventInput`
- `apps/host-daemon/src/event-buffer.ts:12-17` — remove `id` from `BufferedEvent`
- `apps/host-daemon/src/event-buffer.ts:27` — remove `createId` from `CreateEventBufferOptions`
- `apps/host-daemon/src/event-buffer.ts:51-54` — remove `createId` default function
- `apps/host-daemon/src/event-buffer.ts:107` — remove `id` assignment in `push()`
- Tests: update any test fixtures that include `id` in event envelopes

### 1C. `completedAt` in command-result — USE the daemon's timestamp

**Problem:** Same pattern as events. The daemon captures `completedAt` at the exact moment `dispatchCommand()` resolves. The server discards it and uses `Date.now()`. With `pRetry` (5 retries, up to 2s backoff each), the server could record a timestamp 10+ seconds after actual completion. If the daemon was temporarily offline, the gap could be much larger.

**Change:** Pass the daemon's `completedAt` through to `reportCommandResult`.

**Files:**
- `packages/db/src/data/commands.ts:102-106` — add `completedAt` to `ReportCommandResultInput`
- `packages/db/src/data/commands.ts:116-121` — use `input.completedAt` instead of `Date.now()` in the UPDATE
- `apps/server/src/internal/command-results.ts:38-42` — `handleCommandResult` constructs `ReportCommandResultInput` here; add `completedAt: report.completedAt` to the object passed to `reportCommandResult`
- `apps/server/src/internal/command-result-route.ts` — ensure `completedAt` is forwarded from the validated payload through to `handleCommandResult`

### 1D. `requestId` in tool-call — DELETE from daemon contract

**Problem:** `requestId` is a bridge-internal auto-incrementing counter for JSON-RPC request/response correlation. It leaked into the daemon contract because `hostDaemonToolCallRequestSchema` intersects the full `toolCallRequestSchema`. The server has no use for it — the bridge matches responses by HTTP request/response pairing, not by `requestId`.

**Change:** Don't intersect the full `toolCallRequestSchema` in the daemon contract. Pick only the fields the server needs.

**Files:**
- `packages/host-daemon-contract/src/session.ts:121-128` — redefine `hostDaemonToolCallRequestSchema` to explicitly list the needed fields (`sessionId`, `threadId`, `turnId`, `callId`, `tool`, `arguments`) instead of intersecting `toolCallRequestSchema`
- Tests: update any test fixtures that include `requestId` in tool call payloads sent to the server

**Note:** `toolCallRequestSchema` in `packages/domain/src/provider-types.ts` is unchanged — it's used by the provider runtime independently. The daemon's `callTool()` in `server-client.ts` spreads `...request` (which includes `requestId`) into the Zod parse — Zod's default strip mode will silently drop `requestId`, so no daemon-side code change is needed beyond the schema.

### 1E. `activeThreads[].providerThreadId` and `activeThreads[].environmentId` — DELETE from contract

**Problem:** `reconcileSessionThreads` only uses `threadId`. It already knows which environment each thread belongs to via `JOIN environments WHERE hostId = ?`. There's no `providerThreadId` column on the `threads` table, so reconciliation can't use it even if it wanted to.

**Change:** Simplify the active thread schema to just `threadId`.

**Files:**
- `packages/host-daemon-contract/src/session.ts:19-24` — change `hostDaemonActiveThreadSchema` to just `z.object({ threadId: z.string().min(1) })`, or replace with `z.array(z.string().min(1))` (array of thread IDs)
- `apps/host-daemon/src/server-client.ts` — update `openSession()` to send only `threadId` per active thread
- `apps/host-daemon/src/runtime-manager.ts` or wherever `activeThreads` is constructed — simplify to only include `threadId`
- `apps/server/src/internal/reconciliation.ts:12` — update to match new shape (may simplify the `.map()`)
- `apps/host-daemon/test/connection/server-connection.test.ts:315-321` — constructs `HostDaemonActiveThread[]` with `providerThreadId`; update to new shape
- Tests: `internal-reconciliation-idle-active-regression.test.ts:41-46`, `internal-session.test.ts:73` — update fixtures

### 1F. `cursor` in command-result report — DELETE from contract

**Problem:** The server looks up commands by `commandId`, not by `cursor`. The daemon already knows the cursor from the command envelope it received — it doesn't need to round-trip it through the server. The daemon currently uses the cursor from its own result object to update `cursorState.value`, but it can read it from the envelope directly.

**Change:** Remove `cursor` from the result report schema. See Part 2 for the broader cursor simplification that makes this field unnecessary on the daemon side too.

**Files:**
- `packages/host-daemon-contract/src/commands.ts:383-388` — remove `cursor` from `hostDaemonCommandResultReportBaseSchema`
- `apps/host-daemon/src/command-router.ts:134-138` — remove `cursor` from `baseResult`
- `apps/host-daemon/src/server-client.ts:132-176` — update `reportUnknownCommand` which manually constructs result payloads with `cursor`; remove the `cursor === undefined` early-return guard
- `apps/host-daemon/src/app.ts:162` — read cursor from the envelope, not from the result (interim, before Part 2 removes cursor persistence entirely)
- `apps/server/test/helpers/commands.ts:86-95,108-121` — `reportQueuedCommandSuccess` and `reportQueuedCommandError` hardcode `cursor: queued.row.cursor`; remove
- `apps/host-daemon/test/helpers/test-server.ts:184` — does `completedCommandCursors.add(payload.cursor)` to track completed commands; **will break** since `payload.cursor` no longer exists. Rewrite to track by `payload.commandId` instead
- `apps/server/test/internal-session-correctness.test.ts:143-201` — multiple test cases hardcode `cursor` in result payloads; remove
- `tests/integration/fake/recovery.test.ts:354-358` — update command result fixture

---

## Part 2: Command Cursor System Simplification

### Thesis

The command cursor system was designed to provide reliable resumption: the daemon persists a cursor to disk so that after restart, it can fetch only commands it hasn't seen. However, the actual correctness is provided by two simpler mechanisms that already exist:

1. **`state = 'pending'` filter** — `fetchCommands` only returns pending commands. Completed commands (`success`/`error`) and in-flight commands (`fetched`) are excluded.
2. **`sweepExpiredCommands`** — runs every 10 seconds. If a command stays in `fetched` state past its TTL (60s standard, 20min provision), it's re-queued to `pending` (first retry) or moved to `error` (second retry). This handles the crash-after-fetch scenario.

The cursor adds no correctness. The `afterCursor` filter in `fetchCommands` is redundant with `state = 'pending'` because any command with `cursor <= N` has already been fetched (state != pending). The cursor only acts as a query optimization, but the pending set is always small (0-5 commands), so the optimization is unnecessary.

### What to remove

#### 2A. Server-side cursor tracking (dead code)

The `host_daemon_cursors` table and `advanceHostCursor` function are write-only. The server-side cursor high-water mark is never read for any decision, never sent to the daemon, never returned in any API response.

**Files:**
- `apps/server/src/internal/command-result-handlers.ts:33-91` — delete `advanceHostCursor` function
- `apps/server/src/internal/command-result-handlers.ts:6` — remove `hostDaemonCursors` import
- `apps/server/src/internal/command-results.ts:9,49` — remove import and call to `advanceHostCursor`
- `packages/db/src/data/cursors.ts` — delete entire file
- `packages/db/src/data/index.ts:79` — remove `getCursor`, `setCursor` exports
- `packages/db/src/schema.ts:256-262` — remove `hostDaemonCursors` table definition
- `packages/db/test/data/cursors.test.ts` — delete entire test file
- `apps/server/test/internal-session-correctness.test.ts:6,157-206` — remove cursor assertions from test
- Migration: remove `hostDaemonCursors` from the drizzle schema, then run `drizzle-kit generate` to produce a new numbered migration that drops the table. Follow the existing pattern in `packages/db/drizzle/`.

#### 2B. Daemon-side cursor persistence

The daemon persists its cursor to disk so it can resume after restart. But `fetchCommands` with `afterCursor: 0` returns the same results as `afterCursor: N` because both filter `state = 'pending'`. Commands that were fetched and completed are in `success`/`error` state. Commands that were fetched but not completed are in `fetched` state and will be swept back to `pending` by `sweepExpiredCommands`.

**Files:**
- `apps/host-daemon/src/command-cursor.ts` — delete entire file
- `apps/host-daemon/src/command-cursor.test.ts` — delete entire test file
- `apps/host-daemon/src/app.ts:1` — remove `readCommandCursor`, `writeCommandCursor` import
- `apps/host-daemon/src/app.ts:16-18` — remove `CursorState` interface
- `apps/host-daemon/src/app.ts:95-96` — remove `readCursor`/`writeCursor` from options type
- `apps/host-daemon/src/app.ts:117-119` — remove `cursorState` initialization
- `apps/host-daemon/src/app.ts:157` — remove `initialCursor` from `CommandRouter` options
- `apps/host-daemon/src/app.ts:162-165` — remove cursor update and disk write from `reportResult`
- `apps/host-daemon/src/app.ts:172` — remove `getCursor` from fetch loop options
- `apps/host-daemon/src/app.ts:191` — remove `lastCommandCursor` from heartbeat payload
- `apps/host-daemon/src/test/index.ts:3` — remove `readCommandCursor` export from test helpers
- `apps/host-daemon/test/integration/daemon.integration.test.ts:39,231` — remove `waitForCursor` / `readCommandCursor` assertions
- `tests/integration/fake/recovery.test.ts:269-300` — **rewrite** "preserves cursor continuity" test. This test's core assertion (`cursorAfter > cursorBefore`) is about cursor persistence. Rewrite to validate restart behavior via command state (e.g., verify pending commands are re-fetched and completed after restart) rather than cursor values on disk.

#### 2C. Remove ordered reporting, keep retry queue

`flushCompleted` serves two purposes that must be separated:

1. **Ordered reporting** — reports results in strict cursor order so the persisted cursor stays contiguous. This is no longer needed without cursor persistence.
2. **In-memory retry queue** — if `reportResult()` throws (after `pRetry` exhausts its 5 retries), the entry stays in `completedResults` and is retried on the next `flushCompleted()` call (triggered by any subsequent command completion). Without this, a transient POST failure would drop the result from memory, deferring recovery to `sweepExpiredCommands` (60s+ delay and possible duplicate execution after requeue).

**Change:** Remove the ordering constraint but keep a retry mechanism. Replace the cursor-keyed `completedResults` map with a simple pending-results queue. Keep the `reportingPromise` serialization chain to avoid concurrent `reportResult` calls (the server is idempotent, but parallel retrying reporters are unnecessarily complex). On each command completion, chain onto `reportingPromise`: drain pending retries first, then report the new result. On failure, push to the pending queue for next drain.

**Files:**
- `apps/host-daemon/src/command-router.ts:30` — replace `completedResults` map with a `pendingResults: RoutedCommandResult[]` array
- `apps/host-daemon/src/command-router.ts:31` — remove `lastReportedCursor`
- `apps/host-daemon/src/command-router.ts:38` — remove `initialCursor` from constructor
- `apps/host-daemon/src/command-router.ts:73-82` — simplify `dispatchEnvelope`: report result immediately, on failure push to `pendingResults`, then drain pending
- `apps/host-daemon/src/command-router.ts:85-113` — replace `recordCompletedResult` and `flushCompleted` with `drainPending` (iterate `pendingResults`, report each, remove on success)
- `apps/host-daemon/src/command-router.ts:15` — remove `initialCursor` from `CommandRouterOptions`
- Tests: `command-router.test.ts` — rewrite ordered-reporting tests to verify immediate reporting and retry-on-failure behavior

#### 2D. Remove `afterCursor` from fetch loop and server contract

Without cursor state, `afterCursor` is always `0`, which makes the `cursor > 0` filter a no-op (all cursors are ≥ 1). Remove it end to end rather than leaving a permanently-zero param.

**Files:**
- `apps/host-daemon/src/app.ts:29` — remove `afterCursor` from `fetchCommands` type
- `apps/host-daemon/src/app.ts:38,44` — remove `afterCursor: args.getCursor()`
- `apps/host-daemon/src/server-client.ts:76,208` — stop sending `afterCursor` in the query string
- `packages/host-daemon-contract/src/session.ts:51` — remove `afterCursor` from `hostDaemonCommandsQuerySchema`
- `apps/server/src/internal/commands.ts:22` — remove `afterCursor` parsing from the handler
- `packages/db/src/data/commands.ts:59,72,83` — remove `afterCursor` from `FetchCommandsOptions` and the `gt(cursor, afterCursor)` WHERE clause

**Keep:** The `cursor` column on `host_daemon_commands` stays — it provides deterministic `ORDER BY cursor` for fetch ordering and enforces uniqueness via the `host_daemon_commands_host_cursor_idx` index.

#### 2E. `lastCommandCursor` in heartbeat

The daemon sends `lastCommandCursor` in heartbeat messages. The server validates the schema but never reads the value (confirmed dead param in the WebSocket daemon protocol audit).

**Files:**
- `packages/host-daemon-contract/src/session.ts:91-94` — remove `lastCommandCursor` from heartbeat payload schema
- `packages/host-daemon-contract/src/session.ts:115` — remove `lastCommandCursor` from `hostDaemonDaemonWsMessageSchema`
- `apps/host-daemon/src/server-connection.ts:242` — remove `lastCommandCursor` from default heartbeat payload
- `apps/host-daemon/src/app.ts:191` — remove `lastCommandCursor` from heartbeat payload
- `apps/host-daemon/test/helpers/test-server.ts:69-71,91,237` — remove `lastCommandCursor` from heartbeat type and handler
- Tests: update heartbeat fixtures in `server-connection.test.ts`, `internal-session-correctness.test.ts`, `contract.test.ts`

### What to keep

- **`cursor` column on `host_daemon_commands`** — provides monotonic ordering for `fetchCommands`. `ORDER BY cursor` is cleaner than alternatives.
- **`cursor` field in `HostDaemonCommandEnvelope`** (server -> daemon) — tells the daemon what order commands were queued. Useful for logging/debugging.
- **`host_daemon_commands_host_cursor_idx`** unique index — enforces `(hostId, cursor)` uniqueness on insert.
- **`sweepExpiredCommands`** — this is the actual recovery mechanism. No changes.

---

## Execution Order

### Phase 1a: Use daemon timestamps (Part 1A + 1C)

Behavioral change: more accurate timestamps. Two sub-items.

1. 1A: Use daemon's `createdAt` for events
2. 1C: Use daemon's `completedAt` for command results

### Phase 1b: Remove dead contract fields (Part 1B + 1D + 1E + 1F)

Pure deletion of unused fields. Four sub-items, many test helpers.

1. 1B: Delete `events[].id` from contract
2. 1D: Delete `requestId` from daemon tool-call contract
3. 1E: Delete `providerThreadId` and `environmentId` from active threads
4. 1F: Delete `cursor` from command-result report contract

### Phase 2: Server-side cursor cleanup (Part 2A)

This is the safest piece of Part 2 — it removes dead code with zero behavioral change.

1. Delete `advanceHostCursor` and its call site
2. Delete `getCursor`/`setCursor` and `cursors.ts`
3. Drop `host_daemon_cursors` table (migration)
4. Update tests

### Phase 3: Daemon-side cursor simplification (Parts 2B-2E)

This changes daemon behavior. Should be a separate commit with careful test validation.

1. Remove cursor persistence (disk read/write)
2. Simplify `CommandRouter` to report immediately (remove ordered flushing)
3. Always fetch with `afterCursor: 0`
4. Remove `lastCommandCursor` from heartbeat
5. Update all tests

---

## Validation

### Phase 1a (use daemon timestamps)

**Automated:**
- `pnpm exec turbo run typecheck --force`
- `pnpm exec turbo run test --filter=@bb/server --force`
- `pnpm exec turbo run test --filter=@bb/db --force`

**Manual verification:**
- Add a temporary `console.log` in `insertEvents` to confirm `createdAt` is coming from the envelope, not `Date.now()`. Post an event batch, verify the logged timestamp matches the daemon's value (not server receipt time).
- Add a temporary `console.log` in `reportCommandResult` to confirm `completedAt` is coming from the report payload. Complete a command, verify the logged timestamp matches the daemon's value.

### Phase 1b (delete dead fields)

**Automated:**
- `pnpm exec turbo run typecheck --force` — this is the primary gate; removed fields will cause type errors in any code that still references them
- `pnpm exec turbo run test --filter=@bb/server --force`
- `pnpm exec turbo run test --filter=@bb/host-daemon --force`
- `pnpm exec turbo run test --filter=@bb/host-daemon-contract --force`

**Manual verification:**
- Grep for each deleted field name across the codebase to confirm no stale references:
  - `rg 'providerThreadId' packages/host-daemon-contract/` (should be gone from active thread schema)
  - `rg '\.cursor' apps/host-daemon/test/helpers/test-server.ts` (should no longer access `payload.cursor`)
  - `rg 'requestId' packages/host-daemon-contract/src/session.ts` (should be gone)

### Phase 2 (server-side cursor cleanup)

**Automated:**
- `pnpm exec turbo run typecheck --force`
- `pnpm exec turbo run test --filter=@bb/server --force`
- `pnpm exec turbo run test --filter=@bb/db --force`

**Manual verification:**
- Confirm `host_daemon_cursors` table no longer exists: run the migration against a fresh DB and `SELECT name FROM sqlite_master WHERE name = 'host_daemon_cursors'` returns empty.
- `rg 'advanceHostCursor|getCursor|setCursor' apps/server/src/ packages/db/src/` returns nothing.

### Phase 3 (daemon-side cursor simplification)

**Automated:**
- `pnpm exec turbo run typecheck --force`
- `pnpm exec turbo run test --filter=@bb/server --force`
- `pnpm exec turbo run test --filter=@bb/host-daemon --force`
- `pnpm exec turbo run test --filter=@bb/host-daemon-contract --force`
- `pnpm exec turbo run test --filter=@bb/integration-tests --force`

**Manual verification — daemon restart recovery:**
1. Start server and daemon
2. Create a thread that triggers command queueing (e.g., provision an environment)
3. Kill the daemon process mid-execution (`kill -9`)
4. Wait >60 seconds (sweep TTL for standard commands)
5. Restart the daemon
6. Verify: the swept command is re-fetched and completes successfully
7. Verify: no `command-cursor` file is created in the data directory

**Manual verification — retry queue:**
1. Start server and daemon
2. Temporarily block the `/session/command-result` endpoint (e.g., add a 503 response)
3. Execute a command that completes on the daemon side
4. Observe: daemon logs retry failures from `pRetry`
5. Unblock the endpoint
6. Execute another command — when it completes, verify both results are reported (the retried one and the new one)

**Manual verification — no stale references:**
- `rg 'readCommandCursor|writeCommandCursor|command-cursor|cursorState|lastCommandCursor' apps/host-daemon/src/` returns nothing (test files excluded)
- `rg 'lastReportedCursor|flushCompleted|completedResults|initialCursor' apps/host-daemon/src/command-router.ts` returns nothing

---

## Risks and Mitigations

### Phase 1: Low risk
- Schema changes are additive (using existing fields) or removing unused fields
- No behavioral change except more accurate timestamps

### Phase 2: Zero risk
- Removing write-only dead code
- No downstream consumer reads the cursor value

### Phase 3: Medium risk
- **Risk:** Without cursor persistence, daemon restart fetches all pending commands. If there are many pending commands, this could be slower.
  - **Mitigation:** The pending set is always small (0-5). Commands move to `fetched` immediately on retrieval. This is a non-issue.
- **Risk:** Without ordered reporting, commands are reported out of order. Could the server have an implicit ordering dependency?
  - **Mitigation:** `advanceHostCursor` (deleted in Phase 2) was the only consumer of ordering, and it was dead code. The server's `handleCommandResult` handles each result independently by `commandId`.
- **Risk:** `sweepExpiredCommands` has a 60-second TTL. After a daemon crash, there's a 60-second window where fetched commands are invisible (not pending, not swept yet).
  - **Mitigation:** This window already exists today with or without the cursor system. The cursor doesn't help here — it only affects which commands the daemon *requests*, not the server's state machine. The sweep is the recovery mechanism in both cases.
- **Risk:** Removing `lastCommandCursor` from heartbeat removes a debugging signal.
  - **Mitigation:** Low value — server never stored or displayed it. If needed for future monitoring, add it back as an optional field.

---

## Documentation Updates

- **`plans/architecture.md`** — ~10 sections reference the cursor system: per-host monotonic cursor (line 216), daemon cursor persistence (line 221), `host_daemon_cursors` table (lines 223-230), `afterCursor` fetch path (line 250), delivery semantics (lines 252-256), cursor advancement (line 281), heartbeat `lastCommandCursor` (line 305), disk resilience invariant (lines 320-321), restart flow (lines 457-462), data dir layout (line 550). Update all to reflect the simplified model in Phase 3.
- **Route audit docs** in `plans/route-audit/` — mark the dead param flags as resolved after Phase 1.

---

## Review Findings (2026-03-31)

Adversarial review verified all core claims. Key findings incorporated above:

1. **`reportUnknownCommand` missing** (blocker) — `server-client.ts:132-176` manually constructs command-result payloads with `cursor`. Added to 1F file list.
2. **`recovery.test.ts` needs rewrite** (blocker) — test asserts cursor persistence across restarts. Added explicit callout to 2B.
3. **`CreateEventBufferOptions.createId` missing** (nit) — removing envelope `id` makes this factory option unnecessary. Added to 1B file list.
4. **1D is simpler** (simplification) — Zod strip mode handles `requestId` removal; no daemon-side `callTool` change needed. Updated 1D.
5. **Migration workflow** (concern) — specified drizzle-kit workflow in 2A.
6. **`plans/architecture.md` needs updates** (concern) — added Documentation Updates section.
7. **Concurrent reporting is safe** (verified) — `handleCommandResultSideEffects` operates on per-environment/per-thread state. Commands for different environments already execute in parallel today. No new race introduced by removing ordered reporting.
8. **60-second recovery gap is identical** (verified) — with or without cursor, a crash-after-fetch leaves the command in `fetched` state until the sweep resets it. The cursor system doesn't help here because `fetchCommands` filters on `state = 'pending'` regardless.
9. **Retry queue must be preserved** (blocker, second review) — `flushCompleted` doubles as an in-memory retry queue: failed `reportResult` calls leave entries in `completedResults` for retry on next completion. Replacing with a direct `reportResult` call would drop this path, deferring recovery to sweep (60s+). Updated 2C to keep a retry mechanism while removing ordered reporting.
10. **`reportUnknownCommand` already in plan** (confirmed, second review) — the unknown-command path in `server-client.ts:132-176` was already added to 1F in the first review pass.
11. **Mixed clock domains for event timestamps** (concern, second review) — using daemon `createdAt` for provider events while `appendThreadEvent` uses server `Date.now()` for system events means a single thread's timeline mixes two clocks. Updated 1A with tradeoff analysis and options.

### Round 2 (2026-03-31)

12. **1C missing `handleCommandResult`** (blocker) — `command-results.ts:38-42` constructs `ReportCommandResultInput` without `completedAt`. Added explicit callout to 1C file list.
13. **Test helpers with `cursor` in payloads** (blocker) — `apps/server/test/helpers/commands.ts:86-121` hardcodes `cursor` in `reportQueuedCommandSuccess`/`Error`. `test-server.ts:184` accesses `payload.cursor` to track completions — will break. Added to 1F.
14. **`server-connection.test.ts` constructs `HostDaemonActiveThread`** (blocker) — `server-connection.test.ts:315-321` builds active thread objects with `providerThreadId`. Added to 1E.
15. **2C serialization** (concern) — plan now specifies keeping the `reportingPromise` chain to serialize reporting, avoiding concurrent retry storms.
16. **Phase 1 split** (concern) — split into Phase 1a (timestamp changes) and Phase 1b (field deletions) for easier bisection.
17. **`InsertEventInput` type** (nit) — added to 1A file list.
18. **E2B clock skew** (nit) — added Firecracker/NTP note to 1A options.

---

## Exit Criteria

### Phase 1a
- [ ] `insertEvents` uses per-event `createdAt` from the daemon envelope
- [ ] `reportCommandResult` uses `completedAt` from the daemon report
- [ ] Typecheck passes; server, db tests pass

### Phase 1b
- [ ] `events[].id` removed from `hostDaemonEventEnvelopeSchema` and event buffer
- [ ] `requestId` removed from `hostDaemonToolCallRequestSchema`
- [ ] `providerThreadId` and `environmentId` removed from `hostDaemonActiveThreadSchema`
- [ ] `cursor` removed from `hostDaemonCommandResultReportBaseSchema`
- [ ] No dead params remain across the four audited routes
- [ ] Typecheck passes; server, host-daemon, host-daemon-contract tests pass

### Phase 2
- [ ] `host_daemon_cursors` table dropped (migration applied)
- [ ] `advanceHostCursor`, `getCursor`, `setCursor` deleted
- [ ] `cursors.ts` and `cursors.test.ts` deleted
- [ ] Typecheck passes; server, db tests pass

### Phase 3
- [ ] `readCommandCursor`, `writeCommandCursor`, `command-cursor.ts` deleted
- [ ] `CommandRouter` reports results immediately with serialized retry queue (no ordered flushing)
- [ ] Daemon fetches commands with `afterCursor: 0`
- [ ] `lastCommandCursor` removed from heartbeat schema and payload
- [ ] `command-cursor` file no longer created on disk
- [ ] Typecheck passes; all tests pass including integration
- [ ] Daemon restart recovery verified manually (commands re-fetched via sweep)
- [ ] `plans/architecture.md` updated to reflect simplified model
