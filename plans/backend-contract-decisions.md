# Contract Boundary Realignment Plan

## Goal

Make the current server and env-daemon contract boundary fully typed, internally consistent, and explicitly aligned with the newer `@bb/agent-runtime` architecture.

The most important constraint for this pass:

- the shared server<->env-daemon protocol should be provider agnostic
- provider-specific bridge RPC and SDK wire details should stay inside `@bb/agent-runtime`

## Scope

- Covers the public HTTP and websocket contract in `packages/server-contract`.
- Covers the server-implemented internal routes daemons call in `packages/server-contract`.
- Covers the env-daemon control contract in `packages/env-daemon-contract`.
- Covers the shared server<->env-daemon command, event, and session protocol currently still exported from `packages/server-contract`.
- Covers shared public payload types that currently live in `packages/core-ui`.
- Uses `packages/agent-runtime` as the architectural source of truth for daemon-side execution semantics.
- Allows breaking contract changes within this repo as long as in-repo consumers are updated in the same slice.

Out of scope for this plan:

- environment/execution-target/runtime data-model redesign
- `packages/db` schema redesign
- deciding the final environment-definition taxonomy
- adding new major public API surfaces such as `/system/execution-targets`
- provider SDK or bridge internals inside `@bb/agent-runtime`

## Implementation Steps

### 0. Guiding rules and landing strategy

Use these rules to keep the cleanup coherent:

- `@bb/server-contract` owns routes implemented by the server.
- `@bb/env-daemon-contract` owns routes implemented by the env-daemon plus the shared wire protocol the daemon must understand.
- `@bb/agent-runtime` is not the contract package, but it is the semantic source of truth for daemon-side execution operations.
- The shared server<->env-daemon contract may identify a provider with `providerId` and may carry a provider-owned thread/session identifier with `providerThreadId`.
- The shared server<->env-daemon contract should not expose provider bridge `method` / `params` / `result` tunneling, raw provider notifications, or bridge JSON-RPC envelopes.

Atomic workstreams:

- Workstream A
  Public HTTP/websocket payload cleanup plus immediate consumer updates.

- Workstream B
  Env-daemon protocol realignment around `@bb/agent-runtime`.
  This includes package ownership cleanup and removal of provider-bridge leakage.

- Workstream C
  Env-daemon inspection route retention/removal plus CLI updates.

These workstreams may ship separately from each other, but changes inside each workstream should land atomically.

Recommended landing order: **B → A → C**.
Workstream B (daemon protocol realignment) is the hardest and most architecturally important — landing it first means A and C can consume the clean types. C is the smallest and can clean up last.

### 1. Re-anchor the daemon protocol on `@bb/agent-runtime` [Workstream B]

Treat the public runtime surface in [`packages/agent-runtime/src/types.ts`](../packages/agent-runtime/src/types.ts) as the semantic model for daemon execution behavior.

The shared daemon contract should be expressed in terms of runtime operations like:

- `ensureProvider`
- `startThread`
- `resumeThread`
- `runTurn`
- `steerTurn`
- `stopThread`
- `renameThread`
- `listModels`
- `shutdown`

This means the contract should describe:

- thread lifecycle and turn lifecycle
- provider selection and resume identity
- tool call forwarding
- daemon/session health and control

It should not describe:

- provider SDK request methods
- provider bridge request params
- provider bridge JSON-RPC result envelopes

Recommended shared daemon command set:

- remove `provider.ensure` as an explicit shared command
- keep `thread.start`
- keep `thread.resume`
- keep `turn.run` (matches the runtime's `runTurn()`; the current `RequestedMode: "auto"` maps to `turn.run` with no special flag — "auto" is the default turn behavior)
- add `turn.steer` (matches the runtime's `steerTurn()`; absorbs the current `RequestedMode: "steer"` path)
- keep `thread.stop`
- keep `thread.rename`
- keep `provider.list_models`
- remove `provider.list_catalog`
- keep `workspace.status`
- keep `workspace.diff`

Why:

- `provider.ensure` and provider initialize should be internal env-daemon behavior around `@bb/agent-runtime.ensureProvider()`
- `turn.run` / `turn.steer` match the runtime's `runTurn()` / `steerTurn()` directly; the current `RequestedMode` enum is eliminated — `"auto"` and `"start"` both become `turn.run`, `"steer"` becomes `turn.steer`
- `provider.list_catalog` no longer has a matching runtime-level operation

Capability negotiation impact:

The `ENVIRONMENT_DAEMON_SESSION_CAPABILITY_COMMANDS` array in `session-protocol.ts` and the derived `EnvironmentDaemonSessionCapabilityCommand` type must be updated in the same change. Remove `provider.ensure` and `provider.list_catalog`, add `turn.steer`. The capability negotiation functions (`inferEnvironmentDaemonSessionCapabilities`, `createEnvironmentDaemonSessionCapabilities`, `normalizeEnvironmentDaemonSessionCapabilities`, `negotiateEnvironmentDaemonSessionCapabilities`) will need to be checked for compatibility.

Public API stability note:

The `TellThreadMode` enum on the public `/threads/:id/tell` route (`z.enum(["auto", "start", "steer"])`) is a public API concern and should remain stable. The daemon protocol changes do not affect this enum — the server translates between the public `TellThreadMode` and the daemon commands (`turn.run` / `turn.steer`).

### 2. Remove provider-bridge leakage from the shared daemon protocol [Workstream B]

The current shared daemon protocol still exposes old bridge-oriented shapes in `packages/server-contract/src/environment-daemon-commands.ts` and `packages/server-contract/src/session-protocol.ts`.

These are the main leaks to remove:

- `EnvironmentDaemonInitializeRequest`
  It currently carries `method` and `params`, which mirrors provider bridge RPC rather than a provider-agnostic daemon contract.

- `provider_request` / `provider_response` session messages
  These are generic provider RPC tunnels in the shared server<->env-daemon protocol.

- `provider.event` and `provider.rpc_error` daemon events
  These expose provider bridge behavior directly instead of exposing provider-neutral thread events or daemon diagnostics.

- generic command/result payloads that only make sense because provider RPC is being tunneled through the daemon boundary

Replacement direction:

- If initialization is needed, make it a typed daemon/runtime concept or make it internal to env-daemon + `@bb/agent-runtime`.
- Replace `provider_request` / `provider_response` with explicit tool-call request/response payloads based on `ToolCallRequest` and `ToolCallResponse` from `@bb/domain`.
- Keep provider-neutral lifecycle events and translated thread events, not raw provider method names.
- Keep `providerId` and `providerThreadId` where they are part of durable runtime semantics.

Concrete replacement map:

- `EnvironmentDaemonInitializeRequest`
  Remove it from the shared daemon contract.
  The env-daemon should handle provider/runtime initialization internally through `@bb/agent-runtime.ensureProvider()` and the runtime's own internal initialize flow.

- `EnvironmentDaemonCommandAck.result`
  Remove `result` from the ack envelope.
  Acks should only report delivery state.
  Command outputs should move to typed command-result payloads.
  Also remove the helper `getProviderThreadIdFromCommandResult()` which reads from `ack.result` — consumers must switch to reading `providerThreadId` from the typed command result payload instead.

  Note: the codebase has two parallel ack mechanisms — `EnvironmentDaemonCommandEnvelope`/`EnvironmentDaemonCommandAck` (the non-session command envelope) and the session-based `command_batch`/`command_result` messages. Both carry `result: z.unknown().optional()`. The session-based `command_result` gets the typed result union (per the matrix below). The non-session `EnvironmentDaemonCommandEnvelope`/`EnvironmentDaemonCommandAck`/`EnvironmentDaemonEventEnvelope` types should be retained (they are the underlying transport) but with `result` removed from the ack — only the session-layer `command_result` should carry typed results.

- `EnvironmentDaemonSessionCommandResultPayload.result`
  Replace the generic result blob with a typed result union keyed by daemon command type.
  Recommended command/result matrix:
  - `thread.start`
    input:
    - `threadId`
    - `projectId`
    - `providerId?`
    - `input?`
    - `options?`
    - `dynamicTools?`
    result:
    - `{ providerThreadId: string }`
    dropped fields:
    - `request` (was `SpawnThreadRequest`) — decomposed into the fields above; the server should resolve spawn request data before issuing the command
    - `context` (was `ProviderThreadContext` carrying `serverUrl`, `path`) — should become daemon-internal state, not part of the shared command
    - `initialize` (was `EnvironmentDaemonInitializeRequest`) — removed per bridge leakage cleanup
  - `thread.resume`
    input:
    - `threadId`
    - `projectId?` (currently required in schema; relaxed to optional to match runtime interface — breaking change for command producers)
    - `providerThreadId?`
    - `providerId?`
    - `options?`
    - `resumePath?`
    - `dynamicTools?`
    result:
    - `{ providerThreadId?: string }`
    dropped fields:
    - `context`, `initialize` — same rationale as `thread.start`
  - `turn.run`
    input:
    - `threadId`
    - `input`
    - `options?`
    result:
    - `{}`
    notes:
    - turn progress and completion should come through translated thread events, not the command result
    dropped fields:
    - `providerThreadId` — the runtime's `runTurn()` does not take it; the daemon resolves thread→provider mapping internally
    - `requestedMode` — eliminated; `"auto"`/`"start"` are `turn.run`, `"steer"` is `turn.steer`
    - `activeTurnId` — replaced by `expectedTurnId` on `turn.steer`
    - `initialize` — removed per bridge leakage cleanup
  - `turn.steer`
    input:
    - `threadId`
    - `expectedTurnId`
    - `input`
    result:
    - `{}`
    dropped fields:
    - `providerThreadId`, `options`, `initialize` — the runtime's `steerTurn()` takes only `threadId`, `expectedTurnId`, `input`
  - `thread.stop`
    input:
    - `threadId`
    result:
    - `{}`
    dropped fields:
    - `initialize` — removed per bridge leakage cleanup
  - `thread.rename`
    input:
    - `threadId`
    - `title`
    result:
    - `{}`
    dropped fields:
    - `providerThreadId` — daemon resolves internally
    - `initialize` — removed per bridge leakage cleanup
  - `provider.list_models`
    input:
    - `providerId`
    result:
    - `{ models: AvailableModel[] }`
  - `workspace.status`
    input:
    - `threadId`
    result:
    - `{ workStatus: ThreadWorkStatus | null }`
    notes:
    - current daemon command schema has only `threadId`; `mergeBaseBranch` exists on the public API route but not on the daemon command — do not add it here unless there is a concrete need
  - `workspace.diff`
    input:
    - `threadId`
    result:
    - `{ gitDiff: ThreadGitDiffResponse }`
    notes:
    - current daemon command schema has only `threadId`; `selection` and `mergeBaseBranch` exist on the public API route but not on the daemon command — do not add them here unless there is a concrete need

  In other words, every successful command should have an explicit typed result payload, even when that payload is an empty object.

- `provider_request`
  Replace with a new `tool_call_request` message type.
  The current `provider_request` payload has an optional `toolCall?: ToolCallRequest` field alongside generic `method`/`params` fields. The new `tool_call_request` should carry only the typed `ToolCallRequest` — no generic RPC fields.

- `provider_response`
  Replace with `tool_call_response`.
  Payload should carry a typed `ToolCallResponse` or a typed transport error, not a generic `result`.

- `provider.event`
  Remove it from the shared daemon event union.
  The current `provider.event` payload already carries a `translatedEvents: ThreadEvent[]` field (provider-neutral) alongside the leaky `method` / `normalizedMethod` fields. The clean path is to drop the `provider.event` wrapper and emit `translatedEvents` directly as a typed `thread_event_batch` event.

- `provider.rpc_error`
  Remove it from the shared daemon event union.
  Command/request failures should surface through failed command results.
  Out-of-band runtime health issues should surface through daemon/session health or a provider-neutral degraded/error event.

- `provider.stderr`
  Keep it out of the shared daemon event stream.
  Note: `AgentRuntimeOptions` still exposes `onStderr?: (line: string, threadId?: string) => void`, so the env-daemon will continue to receive stderr through the runtime callback. The daemon should capture it internally and expose it only through debug/inspection surfaces (e.g. the retained `/environments/:id/env-daemon/sessions` route), not as a first-class shared runtime event.

Current-repo note:

- `provider_request` / `provider_response` only appear in the contract surface today.
- tool calls are the real active callback path, via `ToolCallRequest` / `ToolCallResponse` and `@bb/agent-runtime.onToolCall`.

Locked-in session replacement:

- create `tool_call_request` (no such message type exists today — `provider_request` is the only current message and must be replaced):
  payload:
  - `channelId`
  - `request: ToolCallRequest`

- add `tool_call_response`
  payload:
  - `channelId`
  - `requestId`
  - `ok`
  - `response?: ToolCallResponse`
  - `errorCode?: string`
  - `errorMessage?: string`

Rules:

- `tool_call_request` is the only shared session message used for runtime callback work from daemon to server.
- `tool_call_response` is the only shared session message used to answer that callback.
- `requestId` must round-trip from `ToolCallRequest.requestId`.
- when `ok` is `true`, `response` must be present and typed as `ToolCallResponse`
- when `ok` is `false`, `errorCode` and `errorMessage` must be present
- no generic `method`, `params`, or `result` fields remain in this part of the session protocol

### 3. Make package ownership explicit without adding a third package [Workstream B]

Keep the two-package split, but make ownership unambiguous:

- `@bb/server-contract`
  Owns:
  - public HTTP routes
  - public websocket routes
  - server-implemented internal routes that daemons call
  - public and server-route DTOs

- `@bb/env-daemon-contract`
  Owns:
  - daemon control HTTP routes
  - the shared server<->env-daemon command, event, and session protocol
  - protocol constants and daemon delivery/runtime enums
  - daemon-facing launch and connection shapes

Concrete cleanup target:

- remove duplicated ownership of:
  - `ENVIRONMENT_DAEMON_PROTOCOL_VERSION`
  - provider launch wrapper shapes
  - delivery reason/runtime state enums
- move the canonical daemon protocol definitions out of `@bb/server-contract`
- specifically move:
  - `environment-daemon-commands.ts`
  - `session-protocol.ts`

Implementation ordering within Workstream B:

The current `thread.start` command imports `spawnThreadRequestSchema` from `@bb/server-contract/public-api.ts`. This import must be broken before the file can move to `@bb/env-daemon-contract` (which must not depend on `@bb/server-contract`). The command schemas must be reshaped to use decomposed fields (per the command/result matrix in step 2) before or simultaneously with the file move — not after.

Similarly, `internal-api.ts` in `@bb/server-contract` extracts `{ type: "provider_request" }` from the session client message union and uses it to type internal session routes. When `provider_request` is replaced with `tool_call_request`, `internal-api.ts` must be updated in the same change. It should be listed as an explicit migration target.

Dependency direction:

- `@bb/server-contract` may depend on `@bb/env-daemon-contract`
- `@bb/env-daemon-contract` should not depend on `@bb/server-contract`

### 4. Remove `unknown` from exported contract surfaces [Workstream A]

No exported payload in `@bb/server-contract` or `@bb/env-daemon-contract` should remain `unknown`.

Public contract targets:

- `SystemEnvironmentInfo.capabilities` should be added so current app consumers stop depending on undeclared fields.
- `ThreadTimelineResponse.rows` should become a named row type.
- `ThreadToolGroupMessagesResponse.messages` should become a named message type.
- `/system/voice-transcription` should become a named response type.
- the base public error envelope should stop using `details?: unknown`.

Daemon contract targets:

- do not mechanically replace every `unknown` with `JsonValue`
- only use shared JSON types for true extension points that remain intentionally open after the provider-bridge cleanup
- prefer named schemas whenever the shape is now defined by `@bb/agent-runtime` semantics

Chosen generic type rule:

- Do not use `Endpoint<Output = never>` — `never` as a return type semantically means "this endpoint can never successfully return", which is misleading.
- Add a branded sentinel type `Untyped` (e.g. `declare const __untyped: unique symbol; export type Untyped = { readonly [__untyped]: never }`) and change the default to `Endpoint<Output = Untyped>`. Any consumer that tries to use the output without explicitly typing the route gets a `tsc` error — no lint rules needed.
- For routes that intentionally return no body, use `Endpoint<Output = void>`.

### 5. Move shared public payload types out of `@bb/core-ui` [Workstream A]

`ThreadDetailRow` and the current `UIMessage` family are public API payloads in practice, so `@bb/core-ui` should not be their only owner.

Target direction:

Move the shared timeline/message payload types directly into `@bb/domain` and make `@bb/core-ui` consume them.

A phased re-export approach (where `@bb/domain` re-exports from `@bb/core-ui`) is not possible because `@bb/core-ui` already depends on `@bb/domain`, which would create a circular dependency.

This means the full type migration must happen in this slice. `UIMessage` is a 10-variant discriminated union with deep dependencies on sub-types like `CollapsibleTurnMessage`, `UIToolCallMessage`, etc. — all of these must move to `@bb/domain` together. The scope is significant but unavoidable given the dependency constraint.

Constraint:

- `@bb/server-contract` should not depend on `@bb/core-ui`

### 6. Normalize the public error envelope [Workstream A]

The public contract still mixes:

- shared `ApiError`
- bespoke `{ error: string }`
- `null` as an error stand-in
- a closed error-code enum with missing real-world codes

Target direction:

- base envelope:
  - `code: string`
  - `message: string`
  - `retryable?: boolean`
- no generic `details?: unknown` in the base public envelope
- route-specific typed error detail is allowed when actually needed

Immediate cleanup targets:

- `/environments/:id`
- `/environments/:id/operations`
- any public route still returning bespoke JSON errors outside the shared envelope

### 7. Remove unused env-daemon inspection routes and type the retained one [Workstream C]

Keep only the env-daemon inspection routes that have a real caller.

Current repo audit:

- one in-repo caller exists for `/environments/:id/env-daemon/sessions`
- no in-repo callers were found for:
  - `/environments/:id/env-daemon/status`
  - `/threads/:id/env-daemon/status`
  - `/threads/:id/env-daemon/sessions`

Route decision for this slice:

- keep `/environments/:id/env-daemon/sessions`
- remove `/environments/:id/env-daemon/status`
- remove `/threads/:id/env-daemon/status`
- remove `/threads/:id/env-daemon/sessions`

Retained payloads to define:

- `EnvironmentDaemonSessionDebugView`
- `EnvironmentDaemonSessionListResponse`

These should reflect the current session-inspection use case, not a future environment redesign.

### 8. Tighten app and CLI consumers against the exported contract [Workstreams A, B, C]

Once the contract types are corrected, remove local shadow types and undocumented assumptions.

Workstream B targets:

- update internal daemon consumers to import canonical daemon protocol types from `@bb/env-daemon-contract`
- update `internal-api.ts` in `@bb/server-contract` — it extracts `{ type: "provider_request" }` from the session client message union and must switch to `tool_call_request`; also uses `EnvironmentDaemonCommand` type parameter which changes when commands are added/removed
- remove or replace consumers of `getProviderThreadIdFromCommandResult()` — they must read from typed command result payloads instead of the ack blob

Workstream A targets:

- update app code that already expects `SystemEnvironmentInfo.capabilities`
- make app and CLI consume the named timeline/message payloads from the contract

Workstream C targets:

- replace the CLI-local `ThreadSessionsPayload` / `ThreadSessionDebugView` types with contract exports

### 9. Add JSDoc comments to non-obvious route contracts [Workstreams A, B]

Most CRUD routes are self-explanatory, but several routes across all three contract surfaces need a short JSDoc comment explaining what they do and who calls them.

Public API routes to document (`public-api.ts`):

```ts
/** Spawns a new manager thread for this project. A manager is a supervisory
 *  thread (type: "manager") that can coordinate sub-threads and has its own
 *  inspectable workspace via the manager-workspace endpoints. */
"/projects/:id/manager"

/** Sends a prompt message to an active thread. This is the primary way to
 *  interact with a running thread — mode controls whether to start a new turn
 *  ("start"/"auto") or steer the current one ("steer"). Only meaningful when
 *  the thread has an active session. */
"/threads/:id/tell"

/** Enqueues a message for later delivery. Used when composing a message while
 *  the thread is busy — the message is stored in the thread's queuedMessages
 *  array and can be sent later via the /send endpoint. */
"/threads/:id/queue"

/** Sends a previously queued message to the thread. Mode controls turn
 *  behavior: "auto" starts a new turn, "steer-if-active" steers only if a
 *  turn is already running, "steer" always steers. */
"/threads/:id/queue/:queuedMessageId/send"

/** Opens a file or directory from the thread's workspace in the user's
 *  editor. Accepts a path relative to the workspace root, a target type
 *  (file/directory), and an optional editor preference
 *  (vscode/cursor/zed/windsurf/system_default). */
"/threads/:id/open-path"

/** Opens an absolute file or directory path in the user's editor. Same editor
 *  options as the thread-scoped variant but not bound to a workspace. */
"/system/open-path"

/** Returns which thread/environment is the "primary checkout" for the project —
 *  the active working branch whose workspace is synced to the user's editor. */
"/threads/:id/primary-status"

/** Returns candidate git branch names for merge-base diff comparisons. Used by
 *  the diff UI to let the user choose which branch to compare against. */
"/threads/:id/merge-base-branches"

/** Returns the thread's final output string, or null if the thread has not
 *  produced output. */
"/threads/:id/output"

/** Lazily loads detailed tool call/response messages for a specific turn within
 *  a thread. A "tool group" is a collapsed sequence of tool calls within a
 *  turn, identified by the turn ID and source event sequence range. */
"/threads/:id/tool-group-messages"

/** Lists files in a manager thread's internal workspace. Manager threads have
 *  a dedicated workspace for their own working state, separate from the
 *  project's primary checkout. */
"/threads/:id/manager-workspace/files"

/** Returns the content of a single file from a manager thread's workspace. */
"/threads/:id/manager-workspace/file"

/** Performs a git or environment lifecycle operation. Operations are a
 *  discriminated union: "promote_primary" / "demote_primary" (swap which thread
 *  owns the primary checkout), "commit" (create a git commit), or
 *  "squash_merge" (squash-merge the thread's branch). */
"/environments/:id/operations"

/** Opens the OS native folder-picker dialog and returns the selected absolute
 *  path, or null if the user cancels. Used when creating a new project to
 *  select the project root directory. */
"/system/pick-folder"
```

Internal API routes to document (`internal-api.ts`):

The server↔daemon boundary uses HTTP polling, not WebSocket. The daemon is the HTTP client; the server is the HTTP server. This interaction model should be explained at the schema level.

```ts
/**
 * Internal API: server-implemented endpoints called by the env-daemon over HTTP.
 *
 * The daemon connects to the server via a polling loop:
 * 1. Opens a session via /session/open (one-time handshake)
 * 2. Long-polls /session/commands for work (thread.start, turn.run, etc.)
 * 3. Pushes events, tool-call callbacks, and results back via /session/messages
 */

/** Daemon opens a new session with the server. Sends capabilities, worker
 *  metadata, provider info, and its control endpoint (so the server can call
 *  back to /control/* routes). Returns lease TTL, heartbeat interval, and
 *  per-channel cursor sync points. */
"/environments/:id/env-daemon/session/open"

/** Daemon long-polls for queued commands from the server. Returns a batch of
 *  commands with sequence numbers, or 204 No Content when idle. The daemon
 *  tracks the cursor position and resumes from afterCursor on each poll. The
 *  waitMs query param controls the long-poll timeout. */
"/environments/:id/env-daemon/session/commands"

/** Daemon pushes messages back to the server. Accepts a discriminated union of
 *  message types: event_batch (thread lifecycle/execution events), tool-call
 *  requests (provider needs a tool executed), command results/acks. Response
 *  type varies by message: event ack, tool-call response, or 204 No Content. */
"/environments/:id/env-daemon/session/messages"
```

Daemon control routes to document (`@bb/env-daemon-contract` `control.ts`):

```ts
/**
 * Daemon control: daemon-implemented endpoints called by the server.
 *
 * These are the reverse direction — the server calls the daemon's HTTP
 * server using the controlEndpoint provided during session open.
 */

/** Returns a health snapshot: thread count, pending command count, delivery
 *  state (healthy/retrying/stalled), and any active issues. POST (not GET)
 *  because the server authenticates via bearer token in headers. */
"/control/status"

/** Triggers the daemon to re-establish its session with the server — reconnect,
 *  revalidate lease, sync pending state. Returns 202 Accepted because the
 *  resync is async; the server should poll /control/status to verify completion.
 *  Called on server restart or when a stale session is detected. */
"/control/session-sync"

/** Instructs the daemon to shut down gracefully, draining in-flight commands
 *  before exiting. Returns 202 Accepted because shutdown is async. Called when
 *  the system is shutting down or the environment is being torn down. */
"/control/shutdown"
```

This work can be done incrementally alongside each workstream — public API comments land with A, internal API and daemon protocol comments land with B, daemon control comments land with B or C.

## Exit Criteria

### Workstream B — Daemon protocol realignment

- Daemon protocol files (`environment-daemon-commands.ts`, `session-protocol.ts`) live in `@bb/env-daemon-contract`
- `@bb/env-daemon-contract` has zero imports from `@bb/server-contract`
- No `provider_request`, `provider_response`, `provider.event`, `provider.rpc_error`, or `EnvironmentDaemonInitializeRequest` in the shared contract
- All command schemas match the command/result matrix (step 2) — no `initialize`, `context`, or `request` fields remain
- `tool_call_request` and `tool_call_response` are the only callback messages in the session protocol
- `ENVIRONMENT_DAEMON_SESSION_CAPABILITY_COMMANDS` matches the new command set (`provider.ensure` and `provider.list_catalog` removed, `turn.steer` added)
- `getProviderThreadIdFromCommandResult()` is removed; consumers read from typed command result payloads
- `EnvironmentDaemonCommandAck.result` is removed
- `internal-api.ts` uses `tool_call_request` instead of `provider_request`
- `ENVIRONMENT_DAEMON_PROTOCOL_VERSION` exists only in `@bb/env-daemon-contract`
- Internal API routes and daemon control routes have JSDoc comments (step 9 list)

### Workstream A — Public HTTP/websocket payload cleanup

- No `unknown` output types on exported `Endpoint`s (the `Untyped` sentinel catches any remaining untyped routes at compile time)
- `SystemEnvironmentInfo.capabilities` is declared in the contract schema
- `ThreadTimelineResponse.rows` and `ThreadToolGroupMessagesResponse.messages` are named types
- `/system/voice-transcription` has a named response type
- Public error envelope is normalized — no `details?: unknown`, no bespoke `{ error: string }` returns
- `UIMessage` family and `ThreadDetailRow` live in `@bb/domain`; `@bb/core-ui` consumes them
- Non-obvious public API routes have JSDoc comments (step 9 list)

### Workstream C — Inspection route cleanup

- Only `/environments/:id/env-daemon/sessions` remains in the contract
- It has typed `EnvironmentDaemonSessionDebugView` and `EnvironmentDaemonSessionListResponse` payloads
- CLI uses contract-exported types instead of local `ThreadSessionsPayload` / `ThreadSessionDebugView`

### Plan complete

All three workstreams pass their exit criteria, typecheck passes across `@bb/domain`, `@bb/server-contract`, `@bb/env-daemon-contract`, `@bb/agent-runtime`, `@bb/core-ui`, `@bb/app`, and `@bb/cli`, and no `unknown` payloads remain on exported contract surfaces (with the documented exceptions for `ToolCallRequest.arguments` and `DynamicTool.inputSchema`).

## Validation

- `pnpm exec turbo run typecheck --filter=@bb/domain --filter=@bb/server-contract --filter=@bb/env-daemon-contract --filter=@bb/agent-runtime --filter=@bb/core-ui --filter=@bb/app --filter=@bb/cli`
- `pnpm --filter @bb/core-ui test`
- `pnpm --filter @bb/agent-runtime test:unit`
- Run targeted consumer tests if touched:
  - `apps/app/src/hooks/useApi.test.ts`
  - `apps/cli/src/__tests__/command-output.test.ts`
- Confirm removed env-daemon inspection routes are absent from the exported contract and return the expected not-found behavior if the server implementation changes land in the same slice.
- Confirm no exported `unknown` payloads remain in `packages/server-contract` or `packages/env-daemon-contract`, except for domain-level extension points that are `unknown` by design (e.g. `ToolCallRequest.arguments`, `DynamicTool.inputSchema` — these represent arbitrary tool input and JSON Schema respectively).

## Resolved Questions

- **`provider.ensure`**: Make it internal. Zero callers exist in the codebase. The env-daemon should call `@bb/agent-runtime.ensureProvider()` internally.
- **`provider.list_catalog`**: Delete outright. Zero callers, no runtime equivalent.
- **Timeline/message type destination**: Full move into `@bb/domain` (see step 5). Re-export approach is blocked by circular dependency.
- **`tool_call_request` creation**: Must be created from scratch. No `tool_call_request` message type exists today — the current `provider_request` has an optional `toolCall` field but the message type itself is `provider_request`.

## Open Questions/Risks

- Whether `SystemEnvironmentInfo` should keep its current name in this slice or be renamed later.
- Whether any remaining open JSON extension points need shared `JsonValue` / `JsonObject` types after the provider-bridge tunnel is removed.
