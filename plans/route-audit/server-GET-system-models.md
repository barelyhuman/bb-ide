# `GET /api/v1/system/models` — List Available Models

**Route:** `apps/server/src/routes/system.ts:53`
**Contract:** `{ query?: SystemModelsQuery } -> AvailableModel[]` (200)
**Complexity:** High (resolves host, dispatches 1 or N+1 daemon commands depending on whether `providerId` is specified)

## Request Body (or Params)

| Field | Required | Notes |
|---|---|---|
| `providerId` (query) | Optional | If provided, lists models for that single provider. If omitted, lists all providers first, then fetches models for each — fan-out. |
| `environmentId` (query) | Optional | Used to resolve `hostId` via `requireEnvironment`. Takes priority over `hostId`. |
| `hostId` (query) | Optional | Used directly if `environmentId` is not provided. |

**All 3 fields consumed. No dead params.**

## Implementation Trace

### Path A: `providerId` is provided

1. (sync) `resolveHostId(deps, query)` — same logic as `system/providers`.
2. (async) `queueCommandAndWait` with `provider.list_models` command, passing `providerId`.
3. (sync) Parses result, returns `.models`.

### Path B: `providerId` is NOT provided (fan-out)

1. (sync) `resolveHostId(deps, query)`.
2. (async) `queueCommandAndWait` with `provider.list` — fetches all providers.
3. (sync) Parses providers list.
4. (async) `Promise.all(providers.map(...))` — for each provider, queues a `provider.list_models` command and awaits the result. Commands run in parallel.
5. (sync) Flattens all model arrays and returns.

> **-> HTTP 200 returns here.** No background work.

## DB Query Summary

### Path A (with providerId)

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | Host resolution | varies | varies | See `system/providers` |
| 2 | Session check | `host_daemon_sessions` | `host_daemon_sessions_host_status_idx` | |
| 3-4 | cursor max + INSERT | `host_daemon_commands` | `host_daemon_commands_host_cursor_idx` | Transaction |

### Path B (fan-out)

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | Host resolution | varies | varies | |
| 2-4 | Session + cursor + INSERT for `provider.list` | `host_daemon_sessions` + `host_daemon_commands` | various | First command |
| 5..N | Session + cursor + INSERT for each `provider.list_models` | `host_daemon_sessions` + `host_daemon_commands` | various | One per provider. Each `queueCommandAndWait` does its own session check. |

**Path A total: 3-4 queries. Path B total: 3 + 3*P queries (P = number of providers). Technically N+1 on daemon commands, but this is inherent to the fan-out design and commands execute in parallel.**

## Code Reuse

| Function | Shared? | Other callers |
|---|---|---|
| `resolveHostId` | Shared | `system/providers` route |
| `queueCommandAndWait` | Shared | All daemon-proxying routes |

## Flags

1. **Fan-out N+1 daemon commands** in Path B: for each provider, a separate `queueCommandAndWait` is issued. Each one independently checks the session and computes a cursor inside a transaction. With many providers, this could be slow. However, commands execute in parallel via `Promise.all`, and the number of providers is typically small (2-5), so this is likely acceptable.

2. **Redundant session checks**: each `queueCommandAndWait` call independently queries `host_daemon_sessions` to validate the session. In Path B, this means P+1 identical session lookups. Could be optimized by extracting the session check, but the cost is minimal for small P.

3. **Same `hostId` validation gap** as `system/providers` — passing a non-existent `hostId` produces a misleading 502 error.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `getAvailableModels` API wrapper | `apps/app/src/lib/api.ts:541` | Fetches models, optionally filtered by `providerId` |
| `useAvailableModels` hook | `apps/app/src/hooks/useApi.ts:696` | React Query hook wrapping `getAvailableModels`, 60s stale time |
| `useThreadCreationOptions` | `apps/app/src/hooks/useThreadCreationOptions.ts:323` | Consumes `useAvailableModels` to populate model picker in thread creation |
| `HireManagerModal` | `apps/app/src/components/HireManagerModal.tsx:61` | Consumes `useAvailableModels` to populate model picker when hiring a manager |
| `PromptProviderModelPicker` | `apps/app/src/components/promptbox/PromptProviderModelPicker.tsx:70` | Consumes `useAvailableModels` to show model preview in prompt box |
| CLI `provider models` | `apps/cli/src/commands/provider.ts:47` | Lists models via `client.api.v1.system.models.$get`, optionally filtered by providerId |
| `public-environments-system.test.ts` | `apps/server/test/public-environments-system.test.ts:437` | Tests model listing with `hostId` and `providerId` query params |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
