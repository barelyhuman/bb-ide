# `POST /internal/session/tool-call` — Execute Server-Side Tool

**Route:** `apps/server/src/internal/tool-calls.ts:20`
**Contract:** `hostDaemonToolCallRequestSchema -> HostDaemonToolCallResponse` (200)
**Complexity:** Simple

## Request Body

| Field | Required | Notes |
|---|---|---|
| `sessionId` | Yes | Validated via `requireActiveSession`. Used to verify host ownership of the thread. |
| `threadId` | Yes | Used to look up the thread and its environment. Verified that `environment.hostId === session.hostId`. Also passed to `appendThreadEvent` for the `message_user` tool. |
| `turnId` | Yes | Passed through to `appendThreadEvent` as the event's `turnId`. |
| `callId` | Yes | Stored in the `system/manager/user_message` event data as `toolCallId`. |
| `tool` | Yes | Tool name string. Currently only `"message_user"` is implemented. All other values return `{ success: false }`. |
| `arguments` | No (optional) | Tool-specific arguments. For `message_user`: parsed via `messageUserToolArgumentsSchema`, which accepts `{ text?: string, message?: string }`, requires one of them, and transforms to `{ text }`. |

**All endpoint fields consumed. No dead params.**

## Implementation Trace

1. **Validate request** (sync) — Zod middleware parses body against `hostDaemonToolCallRequestSchema`, which picks `threadId`, `turnId`, `callId`, `tool`, and `arguments` from `toolCallRequestSchema` and adds `sessionId`.
2. **Require active session** (sync) — `requireActiveSession(db, payload.sessionId)`.
3. **Require thread environment** (sync) — `requireThreadEnvironment(db, payload.threadId)`:
   - `requireThread` — SELECT thread by PK, throw 404 if missing.
   - Checks `thread.environmentId` is set, throw 409 if null.
   - `requireEnvironment` — SELECT environment by PK, throw 404 if missing.
4. **Ownership check** (sync) — If `environment.hostId !== session.hostId`, throw 403.
5. **Tool dispatch** (sync):
   - **`message_user`**:
     - Parse `payload.arguments` via `messageUserToolArgumentsSchema` (Zod). Throws 400 on invalid.
     - `appendThreadEvent(deps, { threadId, turnId, type: "system/manager/user_message", data: { text, toolCallId, turnId } })`:
       - In a transaction: SELECT MAX(sequence), INSERT event with next sequence.
       - `hub.notifyThread(threadId, ["events-appended"])`.
     - Returns `{ success: true, contentItems: [{ type: "inputText", text: "Message delivered" }] }`.
   - **Any other tool**: Returns `{ success: false, contentItems: [{ type: "inputText", text: "Unsupported tool: ..." }] }`.

> **-> HTTP 200 returns here.** Everything is synchronous.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | SELECT session | `host_daemon_sessions` | PK | requireActiveSession |
| 2 | SELECT thread by PK | `threads` | PK | requireThread |
| 3 | SELECT environment by PK | `environments` | PK | requireEnvironment |
| 4 | SELECT MAX(sequence) + INSERT event (txn) | `events` | `events_thread_sequence_idx` | appendThreadEvent |

**Total: 4 queries. No N+1. Clean.**

## Code Reuse

- `requireActiveSession` — shared guard.
- `requireThreadEnvironment` — shared entity-lookup function.
- `parseValue` — shared validation wrapper.
- `appendThreadEvent` — shared event insertion function used by many services.

## Flags

1. **Only one tool implemented**: `message_user` is the sole server-side tool. All other tool names return `{ success: false }`. There is no logging for unsupported tool calls — the daemon gets a generic failure message.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `createServerClient().callTool` | `apps/host-daemon/src/server-client.ts:333` | POSTs tool call request to `/session/tool-call` for server-side tool execution |
| `createDaemonApp` (onToolCall) | `apps/host-daemon/src/app.ts:151` | Wires `serverClient.callTool` as the default `onToolCall` handler for the runtime manager |
| `HostDaemonInternalSchema["/session/tool-call"]` | `packages/host-daemon-contract/src/session.ts:164` | Type-level contract definition for the endpoint |
| `createHostDaemonClient` | `packages/host-daemon-contract/src/session.ts:175` | Typed Hono RPC client used by integration tests |
| Test: tool-call regressions | `apps/server/test/internal-tool-call-regressions.test.ts:36` | Tests tool-call authorization and validation |
| Test: event + tool-call routes | `apps/server/test/internal-events-tool-calls.test.ts:162` | Tests message_user tool call |
| Test: unsupported tool | `apps/server/test/internal-events-tool-calls.test.ts:208` | Tests unsupported tool returns `{ success: false }` |
| Test: fake test-server | `apps/host-daemon/test/helpers/test-server.ts:201` | Fake server stub for host-daemon unit tests |

---

## Review Comments

<!-- This file is current as long as server-side tool support remains limited to `message_user`. -->
