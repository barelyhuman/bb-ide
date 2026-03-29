# `GET /api/v1/hosts/:id` — Get Single Host With Connection Status

**Route:** `apps/server/src/routes/hosts.ts:11`
**Contract:** `PathId -> Host` (200)
**Complexity:** Simple CRUD

## Request Body (or Params)

| Field | Required | Notes |
|---|---|---|
| `:id` (path) | Yes | Host ID. Used to look up the host row and check for an active session. |

**All 1 field consumed. No dead params.**

## Implementation Trace

1. (sync) `requireHostWithStatus(deps.db, id)` called.
   - Calls `getHost(db, id)` — `SELECT * FROM hosts WHERE id = ?`. Returns row or `null`.
   - If `null`, throws `ApiError(404, "host_not_found")`.
   - Calls `toHostStatus(db, host.id)` — queries `host_daemon_sessions` for a single active session with `hostId = id AND status = 'active' AND leaseExpiresAt > now`. Returns `"connected"` if found, else `"disconnected"`.
   - Assembles `Host` domain object via `toHostRecord`.

> **-> HTTP 200 returns here.** Fully synchronous.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | `SELECT * FROM hosts WHERE id = ?` | `hosts` | PK | |
| 2 | `SELECT id FROM host_daemon_sessions WHERE hostId = ? AND status = 'active' AND leaseExpiresAt > ?` | `host_daemon_sessions` | `host_daemon_sessions_host_status_idx` | `.get()` — returns first match |

**Total: 2 queries. No N+1.**

## Code Reuse

| Function | Shared? | Other callers |
|---|---|---|
| `requireHostWithStatus` | One-off | Only this route |
| `getHost` | Shared | DB data layer, used elsewhere |
| `toHostStatus` | Shared internally | Used by `requireHostWithStatus` only |
| `toHostRecord` | Shared internally | Used by both `listHostsWithStatus` and `requireHostWithStatus` |

## Flags

None. Clean CRUD.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `readHost` assertion helper | `tests/integration/helpers/assertions.ts:72` | Reads a single host by ID during integration test assertions |
| `public-projects-hosts.test.ts` | `apps/server/test/public-projects-hosts.test.ts:244` | Directly requests `/api/v1/hosts/:id` to test single host retrieval |
| No app or CLI callers | — | The web app uses `useHosts` (list route) and the CLI does not fetch individual hosts |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
