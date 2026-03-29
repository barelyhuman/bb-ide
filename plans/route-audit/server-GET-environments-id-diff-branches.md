# `GET /api/v1/environments/:id/diff/branches` — List Git Branches

**Route:** `apps/server/src/routes/environments.ts:76`
**Contract:** `PathId -> string[]` (200)
**Complexity:** Medium (dispatches daemon command, awaits result)

## Request Body (or Params)

| Field | Required | Notes |
|---|---|---|
| `:id` (path) | Yes | Environment ID. Looked up via `requireReadyEnvironment`. |

**All 1 field consumed. No dead params.**

## Implementation Trace

1. (sync) `requireReadyEnvironment(deps.db, id)` — PK lookup, validates ready status and path.
2. (async) `queueCommandAndWait(deps, {...})` — queues `workspace.list_branches` command with `environmentId`, `environmentStatus`, `workspacePath`. Standard daemon proxy flow.
3. (sync) Parses result with `hostDaemonCommandResultSchemaByType["workspace.list_branches"]`, returns `.branches`.

> **-> HTTP 200 returns here.** No background work.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | `SELECT * FROM environments WHERE id = ?` | `environments` | PK | |
| 2 | `SELECT * FROM host_daemon_sessions WHERE hostId = ? AND status = 'active' AND leaseExpiresAt > ?` | `host_daemon_sessions` | `host_daemon_sessions_host_status_idx` | |
| 3 | `SELECT max(cursor) FROM host_daemon_commands WHERE hostId = ?` | `host_daemon_commands` | `host_daemon_commands_host_cursor_idx` | Inside transaction |
| 4 | `INSERT INTO host_daemon_commands ...` | `host_daemon_commands` | — | Inside same transaction |

**Total: 4 queries. No N+1.**

## Code Reuse

| Function | Shared? | Other callers |
|---|---|---|
| `requireReadyEnvironment` | Shared | status, diff, actions |
| `queueCommandAndWait` | Shared | All daemon-proxying routes |

## Flags

None. Clean daemon proxy.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `getEnvironmentDiffBranches` API wrapper | `apps/app/src/lib/api.ts:463` | Fetches available git branches for an environment |
| `useEnvironmentMergeBaseBranches` hook | `apps/app/src/hooks/useApi.ts:600` | React Query hook wrapping `getEnvironmentDiffBranches` |
| `useGitDiffPanel` | `apps/app/src/views/useGitDiffPanel.ts:97` | Consumes `useEnvironmentMergeBaseBranches` to populate branch picker in diff panel |
| `ThreadDetailView` | `apps/app/src/views/ThreadDetailView.tsx:353` | Uses `useGitDiffPanel` which fetches branches |
| CLI `thread show --merge-base-branches` | `apps/cli/src/commands/thread/show.ts:186` | Fetches branch list when `--merge-base-branches` flag is passed |
| `getEnvironmentBranches` test helper | `tests/integration/helpers/api.ts:220` | Integration test helper wrapping `api.environments[":id"].diff.branches.$get` |
| `smoke.test.ts` | `tests/integration/fake/smoke.test.ts:403` | Verifies branch list after provisioning |
| `provider-smoke.test.ts` | `tests/integration/real/provider-smoke.test.ts:429` | Verifies branch list in real provider tests |
| `public-environments-system.test.ts` | `apps/server/test/public-environments-system.test.ts:167` | Tests branch listing |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
