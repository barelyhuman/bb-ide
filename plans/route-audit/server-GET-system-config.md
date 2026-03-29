# `GET /api/v1/system/config` — Get System Configuration

**Route:** `apps/server/src/routes/system.ts:34`
**Contract:** `EmptyInput -> SystemConfigResponse` (200)
**Complexity:** Simple CRUD

## Request Body (or Params)

No params.

## Implementation Trace

1. (sync) Returns a static object derived from `deps.config`:
   - `hostDaemonPort`: directly from config.
   - `voiceTranscriptionEnabled`: `!!deps.config.openAiApiKey` — true if the OpenAI API key is configured.

> **-> HTTP 200 returns here.** Fully synchronous. No DB access.

## DB Query Summary

No queries.

**Total: 0 queries.**

## Code Reuse

No shared functions — inline object construction.

## Flags

None. Clean config endpoint.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `loadSystemConfig` | `apps/app/src/lib/atoms.ts:13` | Fetches config via `apiClient.system.config.$get()` on app startup |
| `systemConfigAtom` | `apps/app/src/lib/atoms.ts:24` | Jotai atom that resolves `loadSystemConfig` once; consumed by other atoms |
| `localHostIdAtom` | `apps/app/src/lib/atoms.ts:35` | Reads `systemConfigAtom` to get `hostDaemonPort` for daemon probing |
| `hostDaemonPortAtom` | `apps/app/src/lib/atoms.ts:57` | Reads `systemConfigAtom` to expose `hostDaemonPort` |
| `public-environments-system.test.ts` | `apps/server/test/public-environments-system.test.ts:418` | Tests GET `/system/config` response shape |
| No CLI callers | — | The CLI does not use the system config endpoint |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
