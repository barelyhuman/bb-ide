# `POST /internal/session/tool-call` — Execute Server-Side Tool

**Route:** `apps/server/src/internal/tool-calls.ts:20`
**Contract:** `hostDaemonToolCallRequestSchema -> HostDaemonToolCallResponse` (200)
**Complexity:** Simple

## Request Body

| Field | Required | Notes |
|---|---|---|
| `sessionId` | Yes | Validated via `requireActiveSession`. Used to verify host ownership of the thread. |
| `requestId` | Yes | From `toolCallRequestSchema`. **Not consumed** by the handler — accepted but ignored. |
| `threadId` | Yes | Used to look up the thread and its environment. Verified that `environment.hostId === session.hostId`. Also passed to `appendThreadEvent` for the `message_user` tool. |
| `turnId` | Yes | Passed through to `appendThreadEvent` as the event's `turnId`. |
| `callId` | Yes | Stored in the `system/manager/user_message` event data as `toolCallId`. |
| `tool` | Yes | Tool name string. Currently only `"message_user"` is implemented. All other values return `{ success: false }`. |
| `arguments` | No (optional) | Tool-specific arguments. For `message_user`: parsed via `messageUserToolArgumentsSchema` which expects `{ text?: string, message?: string }` with a refinement that at least one is present. |

**6/7 fields consumed. `requestId` is accepted but ignored.**

## Implementation Trace

1. **Validate request** (sync) — Zod middleware parses body against `hostDaemonToolCallRequestSchema` (intersection of `toolCallRequestSchema` and `{ sessionId }`).
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

1. **`requestId` is a dead param**: Comes from `toolCallRequestSchema` but is never read by the handler. The daemon sends it, the server ignores it. Should be consumed (e.g., for idempotency or logging) or removed from the schema intersection.
2. **Only one tool implemented**: `message_user` is the sole server-side tool. All other tool names silently return `{ success: false }`. There is no logging for unsupported tool calls — the daemon gets a generic failure message.
3. **`text` field resolution**: `messageUserToolArgumentsSchema` accepts either `text` or `message` (with a refinement that one must be present). The handler only reads `args.text`. If the daemon sends `{ message: "hello" }` without `text`, the refinement produces `text` via a transform — worth verifying the schema refinement handles this correctly.

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `createServerClient().callTool` | `apps/host-daemon/src/server-client.ts:333` | POSTs tool call request to `/session/tool-call` for server-side tool execution |
| `createDaemonApp` (onToolCall) | `apps/host-daemon/src/app.ts:151` | Wires `serverClient.callTool` as the default `onToolCall` handler for the runtime manager |
| `HostDaemonInternalSchema["/session/tool-call"]` | `packages/host-daemon-contract/src/session.ts:163` | Type-level contract definition for the endpoint |
| `createHostDaemonClient` | `packages/host-daemon-contract/src/session.ts:174` | Typed Hono RPC client used by integration tests |
| Test: tool-call regressions | `apps/server/test/internal-tool-call-regressions.test.ts:36` | Tests tool-call authorization and validation |
| Test: event + tool-call routes | `apps/server/test/internal-events-tool-calls.test.ts:162` | Tests message_user tool call |
| Test: unsupported tool | `apps/server/test/internal-events-tool-calls.test.ts:208` | Tests unsupported tool returns `{ success: false }` |
| Test: fake test-server | `apps/host-daemon/test/helpers/test-server.ts:201` | Fake server stub for host-daemon unit tests |

---

## Review Comments

<!-- Flag 1 is a contract violation per AGENTS.md. Flag 2 is fine for now but should be documented — when new server-side tools are added, this is where they go. -->
