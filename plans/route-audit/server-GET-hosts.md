# `GET /api/v1/hosts` — List All Hosts With Connection Status

**Route:** `apps/server/src/routes/hosts.ts:9`
**Contract:** `EmptyInput -> Host[]` (200)
**Complexity:** Simple CRUD

## Request Body (or Params)

No params.

## Implementation Trace

1. (sync) `listHostsWithStatus(deps.db)` called.
   - Calls `listHosts(db)` — full table scan on `hosts`, returns all rows.
   - Queries `host_daemon_sessions` for all active sessions with `leaseExpiresAt > Date.now()` — builds a `Set<hostId>` of connected hosts.
   - Maps each host row into a `Host` domain object, setting `status` to `"connected"` or `"disconnected"` based on set membership.

> **-> HTTP 200 returns here.** Fully synchronous.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | `SELECT * FROM hosts` | `hosts` | full scan | No filter, returns all rows |
| 2 | `SELECT hostId FROM host_daemon_sessions WHERE status='active' AND leaseExpiresAt > now` | `host_daemon_sessions` | `host_daemon_sessions_host_status_idx` (partial — filters on `status`) | Batch lookup for connected host IDs |

**Total: 2 queries. No N+1.** The connected-host lookup is batched into one query and materialized as a Set.

## Code Reuse

| Function | Shared? | Other callers |
|---|---|---|
| `listHostsWithStatus` | One-off | Only this route |
| `listHosts` | Shared | DB data layer |
| `toHostRecord` | Shared | Also used by `requireHostWithStatus` |

## Flags

None. Clean CRUD.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `listHosts` API wrapper | `apps/app/src/lib/api.ts:555` | Fetches all hosts from the server |
| `useHosts` hook | `apps/app/src/hooks/useApi.ts:378` | React Query hook wrapping `listHosts`, 30s stale time |
| `useHostDaemon` hook | `apps/app/src/hooks/useHostDaemon.ts:22` | Consumes `useHosts` to find the local host for daemon interactions |
| `ProjectMainView` | `apps/app/src/views/ProjectMainView.tsx:28` | Uses `useHostDaemon` (which depends on `useHosts`) to get `localHostId` |
| `ThreadDetailView` | `apps/app/src/views/ThreadDetailView.tsx:376` | Uses `useHostDaemon` (which depends on `useHosts`) to determine if environment is local |
| `ProjectList` | `apps/app/src/components/layout/ProjectList.tsx:127` | Uses `useHostDaemon` (which depends on `useHosts`) for project creation |
| `useQuickCreateProject` | `apps/app/src/hooks/useQuickCreateProject.ts:8` | Uses `useHostDaemon` (which depends on `useHosts`) for quick project creation |
| `getHosts` test helper | `tests/integration/helpers/api.ts:260` | Integration test helper wrapping `api.hosts.$get` |
| `waitForConnectedHost` assertion | `tests/integration/helpers/assertions.ts:160` | Polls `api.hosts.$get` until a host is connected |
| `smoke.test.ts` | `tests/integration/fake/smoke.test.ts:134` | Verifies hosts list after daemon connection |
| `multi-thread.test.ts` | `tests/integration/fake/multi-thread.test.ts:611` | Verifies each harness sees one host |
| `skeleton.test.ts` | `apps/server/test/skeleton.test.ts:14` | Directly requests `/api/v1/hosts` to verify route exists |
| `public-projects-hosts.test.ts` | `apps/server/test/public-projects-hosts.test.ts:220` | Tests host listing and filtering |
| CLI `provider list` | `apps/cli/src/commands/provider.ts:27` | Not a direct caller — included for completeness; CLI uses `/system/providers` instead |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
