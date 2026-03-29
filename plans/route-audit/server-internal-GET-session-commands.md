# `GET /internal/session/commands` — Long-Poll Pending Commands

**Route:** `apps/server/src/internal/commands.ts:23`
**Contract:** `hostDaemonCommandsQuerySchema -> HostDaemonCommandBatch` (200) | `undefined` (204)
**Complexity:** Medium

## Request Params (Query)

| Field | Required | Notes |
|---|---|---|
| `sessionId` | Yes | Validated via `requireActiveSession` — must match an active, non-expired session. Used to resolve `hostId` for the command fetch. |
| `afterCursor` | Yes | String-encoded non-negative integer. Commands with `cursor > afterCursor` are returned. The daemon tracks its own cursor and sends the last-seen value. |
| `limit` | Yes | String-encoded non-negative integer. Max number of commands to return. |
| `waitMs` | Yes | String-encoded non-negative integer. If > 0 and no commands are immediately available, the route long-polls via `hub.waitForCommands` up to this duration. If 0, returns immediately. |

**All 4 fields consumed. No dead params.**

## Implementation Trace

1. **Validate query params** (sync) — `typedRoutes` Zod middleware validates query string against `hostDaemonCommandsQuerySchema`. All fields are `z.string().regex(/^\d+$/)`.
2. **Require active session** (sync) — `requireActiveSession(db, query.sessionId)` — SELECT from `host_daemon_sessions` WHERE id, status="active", leaseExpiresAt > now. Throws 401 if not found.
3. **Parse integer params** (sync) — `waitMs`, `afterCursor`, `limit` parsed via `parseInteger`.
4. **Fetch pending commands** (sync) — `fetchCommands(db, hub, { hostId, afterCursor, limit })`:
   - In a transaction: SELECT from `host_daemon_commands` WHERE `hostId`, `state="pending"`, `cursor > afterCursor`, ORDER BY cursor, LIMIT.
   - Marks returned commands as `state="fetched"`, sets `fetchedAt`.
   - Re-selects each command by PK to return updated rows.
5. **Long-poll if empty** (async) — If `commands.length === 0 && waitMs > 0`:
   - `hub.waitForCommands(hostId, waitMs)` creates a `CommandWaiter` promise with a timeout.
   - Resolves when either: (a) `hub.notifyCommand(hostId)` is called (new command queued), or (b) timeout expires.
   - After resolve, re-calls `fetchPending()` — same `fetchCommands` call as step 4.
6. **Return response**:
   - If still empty after wait and `waitMs > 0`: returns raw `204 No Content`.
   - If still empty and `waitMs === 0`: returns `{ commands: [] }` (200).
   - If commands found: maps each to `{ id, cursor, command }` where `command` is re-parsed from stored JSON payload via `hostDaemonCommandSchema.parse(JSON.parse(command.payload))`.

> **-> HTTP 200/204 returns here.** The long-poll await is the only async operation.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | SELECT session by PK + status + lease | `host_daemon_sessions` | PK (id), filtered by status/lease | Session validation |
| 2 | SELECT pending commands for host after cursor | `host_daemon_commands` | `host_daemon_commands_host_state_idx` + `host_daemon_commands_host_cursor_idx` | Main fetch |
| 3 | N x UPDATE command state to "fetched" | `host_daemon_commands` | PK | Per-command state update |
| 4 | N x SELECT command by PK | `host_daemon_commands` | PK | Re-select after update |

**Total: 2 + 2N queries per fetch call. Called once or twice (if long-poll triggers). The per-command UPDATE + re-SELECT is N+1 — could be batched into a single UPDATE ... WHERE id IN (...) + single re-SELECT.**

## Code Reuse

- `requireActiveSession` — shared guard used by all session routes.
- `fetchCommands` — shared DB function (only caller is this route).
- `hub.waitForCommands` — hub waiter pattern, woken by `hub.notifyCommand` which is called from `queueCommand`.
- `hostDaemonCommandSchema.parse` — re-validates stored JSON payloads on the way out.

## Flags

1. **N+1 in `fetchCommands`**: The DB function updates and re-selects each command individually in a loop (lines 99-114 in commands.ts). For large batches this is suboptimal. Could batch the UPDATE and use a single `WHERE id IN (...)` SELECT.
2. **Re-parsing stored payloads**: `hostDaemonCommandSchema.parse(JSON.parse(command.payload))` re-validates the command on every fetch. This is defensive but adds CPU cost. If the server wrote the payload, it was already valid.
3. **204 bypasses Hono serialization**: `return new Response(null, { status: 204 })` is a raw Response, not `context.json(...)`. This is intentional (no body on 204) but worth noting as the only route that returns a raw Response.
4. **`parseInteger` is local**: Defined inline in the commands file, not shared with the validation utility in `services/validation.ts` which has `parseOptionalInteger`.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `createServerClient().fetchCommands` | `apps/host-daemon/src/server-client.ts:211` | GETs `/session/commands` with cursor, limit, and waitMs to long-poll for pending commands |
| `createCommandFetchLoop` | `apps/host-daemon/src/app.ts:173` | Wires `serverClient.fetchCommands` into the daemon's command fetch loop |
| `createDaemonApp` (fetchCommands arg) | `apps/host-daemon/src/app.ts:29-43` | Consumes fetched commands, re-fetching when cursor advances |
| `HostDaemonInternalSchema["/session/commands"]` | `packages/host-daemon-contract/src/session.ts:143` | Type-level contract definition for the endpoint |
| `createHostDaemonClient` | `packages/host-daemon-contract/src/session.ts:174` | Typed Hono RPC client used by integration tests |
| Test: command fetch | `apps/server/test/internal-session.test.ts:123` | Tests fetching commands after cursor |
| Test: long-poll 204 | `apps/server/test/internal-session.test.ts:152` | Tests 204 response when no commands available after wait |
| Test: correctness | `apps/server/test/internal-session-correctness.test.ts:222` | Tests command fetch correctness in end-to-end session flow |
| Test: fake test-server | `apps/host-daemon/test/helpers/test-server.ts:130` | Fake server stub for host-daemon unit tests |
| Test: contract URL | `packages/host-daemon-contract/test/contract.test.ts:501` | Verifies typed client produces correct URL path |

---

## Review Comments

<!-- Flag 1 (N+1) is the most actionable performance issue. Flag 2 is a design choice — re-parsing prevents corrupted payloads from reaching the daemon, but costs CPU. -->
