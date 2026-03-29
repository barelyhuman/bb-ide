# `POST /internal/session/command-result` — Report Command Completion

**Route:** `apps/server/src/internal/command-result-route.ts:22`
**Contract:** `hostDaemonCommandResultReportSchema -> { ok: true }` (200)
**Complexity:** High

## Request Body

| Field | Required | Notes |
|---|---|---|
| `sessionId` | Yes | Validated via `requireActiveSession`. Guards that only an active daemon can report results. |
| `commandId` | Yes | PK lookup in `host_daemon_commands`. Also verified that `command.hostId === session.hostId` (ownership check). |
| `cursor` | Yes | Sent by daemon but **not consumed** by the handler — only `commandId` is used for lookup. |
| `completedAt` | Yes | Sent by daemon but **not consumed** — the server sets its own `completedAt` timestamp in `reportCommandResult`. |
| `type` | Yes | Command type discriminator (e.g., "environment.provision"). Used to dispatch side effects in `handleCommandResultSideEffects`. |
| `ok` | Yes | `true` for success, `false` for error. Determines which result branch is taken. |
| `result` | If ok=true | Type-specific result object. Stored as JSON in `resultPayload`. Used by side-effect handlers. |
| `errorCode` | If ok=false | Stored in `resultPayload` JSON. |
| `errorMessage` | If ok=false | Stored in `resultPayload` JSON. |

**8/10 fields consumed. `cursor` and `completedAt` are accepted but ignored — the server derives both internally.**

## Implementation Trace

1. **Validate request** (sync) — Zod middleware parses body against `hostDaemonCommandResultReportSchema` (large discriminated union by type x ok).
2. **Require active session** (sync) — `requireActiveSession(db, payload.sessionId)`.
3. **Ownership check** (sync) — SELECT command by PK from `host_daemon_commands`. If not found or `command.hostId !== session.hostId`, throw 404.
4. **Handle result** (async) — `handleCommandResult(deps, payload)`:
   - a. **SELECT command again** (sync) — redundant SELECT by PK (same as step 3).
   - b. **Idempotency guard** — if command is already `success` or `error`, returns the existing row without changes.
   - c. **Persist result** (sync) — `reportCommandResult(db, hub, { commandId, state, resultPayload })`: UPDATE command with `state`, `resultPayload`, `completedAt=Date.now()`. Re-SELECT by PK.
   - d. **Side effects** (async) — `handleCommandResultSideEffects(deps, report, updatedCommand)`:
     - **`environment.provision`** (async):
       - On success: `updateEnvironment` -> status="ready", set path/git props. For each bound thread: update `mergeBaseBranch` if needed, append provisioning event, transition to idle, look up the stored start event, queue `thread.start` command, transition to active.
       - On failure: `updateEnvironment` -> status="error". For each bound thread: append provisioning+error events, transition to error.
       - Special: if environment was already "destroying" during provision success, queues `environment.destroy` instead.
     - **`environment.destroy`**: On success, transitions environment from "destroying" to "destroyed".
     - **`thread.stop`**: On success, transitions thread from "active" to "idle", appends interrupted event.
     - **All other types**: No side effects.
   - e. **Advance host cursor** (sync) — `advanceHostCursor(deps, hostId)`: In a transaction, walks all commands for the host in cursor order, advancing the cursor past contiguous completed commands. Upserts `host_daemon_cursors`.
   - f. **Cache result in hub** (sync) — `hub.recordCommandResult(commandId, response)`: Stores result in in-memory cache (TTL=5min), resolves any `CommandResultWaiter` promises.

> **-> HTTP 200 returns here.** Side effects (provision flow, thread start queueing) run before the response.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | SELECT session | `host_daemon_sessions` | PK | requireActiveSession |
| 2 | SELECT command by PK | `host_daemon_commands` | PK | Ownership check (route) |
| 3 | SELECT command by PK | `host_daemon_commands` | PK | Redundant re-select in handleCommandResult |
| 4 | UPDATE command result | `host_daemon_commands` | PK | reportCommandResult |
| 5 | SELECT command by PK | `host_daemon_commands` | PK | Re-select after update |
| 6+ | Side-effect queries | varies | varies | See provision flow: getEnvironment, select bound threads, updateEnvironment, per-thread updates, event inserts, queueCommand |
| N | advanceHostCursor transaction | `host_daemon_commands`, `host_daemon_cursors` | `host_daemon_commands_host_cursor_idx` | Cursor advancement |

**Total: 5 base + variable side-effect queries. The command is selected 3 times (steps 2, 3, 5). Provision success path is the heaviest — per bound thread: ~5-8 queries.**

## Code Reuse

- `requireActiveSession` — shared guard.
- `handleCommandResult` — extracted into `command-results.ts`, not used elsewhere.
- `handleCommandResultSideEffects` / `advanceHostCursor` — extracted into `command-result-handlers.ts`.
- `reportCommandResult` — shared DB function.
- `hub.recordCommandResult` — hub pattern shared with `waitForCommandResult`.
- `tryTransition`, `appendProvisioningEvent`, `appendSystemErrorEvent`, `queueThreadStartCommand` — shared service functions.

## Flags

1. **`cursor` and `completedAt` are dead params**: The schema requires them, the daemon sends them, but neither is used. The server computes its own `completedAt` via `Date.now()` and uses `commandId` for lookup rather than cursor. These should either be consumed or removed from the contract.
2. **Triple command SELECT**: The command is fetched by PK three times (route ownership check, handleCommandResult entry, reportCommandResult return). The first two could share the same row.
3. **Provision side effects are synchronous w.r.t. HTTP response**: The entire provision flow (environment update, per-thread events, queueing thread.start) runs before returning 200. For environments with many threads, this could be slow.
4. **`advanceHostCursor` scans all commands for the host**: The cursor advancement reads all commands for the host (`WHERE hostId = ?`) ordered by cursor. For long-lived hosts with many historical commands, this grows unbounded. Should filter to `cursor > currentCursor` or add a lower bound.
5. **Error path in provision result**: When provision fails and thread is in `created` status, it first tries `created -> provisioning`, then immediately tries `provisioning -> error`. The intermediate transition to "provisioning" on failure seems semantically odd — the thread was never actually provisioning at that point.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `createServerClient().reportCommandResult` | `apps/host-daemon/src/server-client.ts:272` | POSTs command completion (success/error) with retry logic via `pRetry` |
| `reportUnknownCommand` (closure) | `apps/host-daemon/src/server-client.ts:146` | Reports error result for unrecognized command types during fetch |
| `CommandRouter.reportResult` | `apps/host-daemon/src/app.ts:161` | Wires `serverClient.reportCommandResult` into the command router's result callback |
| `HostDaemonInternalSchema["/session/command-result"]` | `packages/host-daemon-contract/src/session.ts:149` | Type-level contract definition for the endpoint |
| `createHostDaemonClient` | `packages/host-daemon-contract/src/session.ts:174` | Typed Hono RPC client used by integration tests |
| Test: success result | `apps/server/test/internal-session.test.ts:213` | Tests reporting a successful command result |
| Test: failure result | `apps/server/test/internal-session.test.ts:272` | Tests reporting a failed command result |
| Test: provision side effects | `apps/server/test/internal-session.test.ts:366` | Tests environment provision side effects on result |
| Test: thread start queueing | `apps/server/test/internal-session.test.ts:489` | Tests thread.start command queued after provision success |
| Test: destroy side effects | `apps/server/test/internal-session.test.ts:603` | Tests environment destroy side effects |
| Test: replaced session result | `apps/server/test/internal-session.test.ts:721` | Tests result reporting after session replacement |
| Test: idempotent result | `apps/server/test/internal-session.test.ts:770` | Tests idempotent re-reporting of completed commands |
| Test: authorization regression | `apps/server/test/internal-authorization-regressions.test.ts:74` | Tests cross-session ownership check on command result |
| Test: correctness | `apps/server/test/internal-session-correctness.test.ts:139` | Tests command result correctness in end-to-end flow |
| Test: integration | `apps/server/test/integration.test.ts:174` | Uses typed client to report results in integration tests |
| Test: stale result (integration) | `tests/integration/fake/recovery.test.ts:286` | Tests reporting a stale command result after session replacement |
| Test: fake test-server | `apps/host-daemon/test/helpers/test-server.ts:163` | Fake server stub for host-daemon unit tests |
| Test: contract URL | `packages/host-daemon-contract/test/contract.test.ts:503` | Verifies typed client produces correct URL path |
| Test: integration harness | `tests/integration/helpers/harness.ts:398` | Creates typed client for integration test harness |
| Test: helpers/commands | `apps/server/test/helpers/commands.ts:83` | Shared test helper for posting command results |

---

## Review Comments

<!-- Flag 1 is a contract violation per AGENTS.md: "Accepted-but-ignored route or command fields are forbidden." Both `cursor` and `completedAt` should be deleted from the schema or implemented. Flag 4 could become a performance issue on long-lived hosts. -->
