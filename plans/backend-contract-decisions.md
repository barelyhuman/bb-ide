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

### 1. Re-anchor the daemon protocol on `@bb/agent-runtime`

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

Immediate implication:

- `provider.list_catalog` looks stale relative to `@bb/agent-runtime` and should be removed or explicitly re-justified, because the runtime exposes `listModels()` but not a matching catalog operation.

Recommended shared daemon command set:

- remove `provider.ensure` as an explicit shared command
- keep `thread.start`
- keep `thread.resume`
- replace `turn.run` with `turn.start`
- add `turn.steer`
- keep `thread.stop`
- keep `thread.rename`
- keep `provider.list_models`
- remove `provider.list_catalog`
- keep `workspace.status`
- keep `workspace.diff`

Why:

- `provider.ensure` and provider initialize should be internal env-daemon behavior around `@bb/agent-runtime.ensureProvider()`
- `turn.start` / `turn.steer` match the runtime and provider-adapter model directly
- `provider.list_catalog` no longer has a matching runtime-level operation

### 2. Remove provider-bridge leakage from the shared daemon protocol

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
  Remove it from the ack envelope.
  Acks should only report delivery state.
  Command outputs should move to typed command-result payloads.

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
  - `thread.resume`
    input:
    - `threadId`
    - `projectId?`
    - `providerThreadId?`
    - `providerId?`
    - `options?`
    - `resumePath?`
    - `dynamicTools?`
    result:
    - `{ providerThreadId?: string }`
  - `turn.start`
    input:
    - `threadId`
    - `input`
    - `options?`
    result:
    - `{}`
    notes:
    - turn progress and completion should come through translated thread events, not the command result
  - `turn.steer`
    input:
    - `threadId`
    - `expectedTurnId`
    - `input`
    result:
    - `{}`
  - `thread.stop`
    input:
    - `threadId`
    result:
    - `{}`
  - `thread.rename`
    input:
    - `threadId`
    - `title`
    result:
    - `{}`
  - `provider.list_models`
    input:
    - `providerId`
    result:
    - `{ models: AvailableModel[] }`
  - `workspace.status`
    input:
    - `threadId`
    - `mergeBaseBranch?`
    result:
    - `{ workStatus: ThreadWorkStatus | null }`
  - `workspace.diff`
    input:
    - `threadId`
    - `selection?`
    - `mergeBaseBranch?`
    result:
    - `{ gitDiff: ThreadGitDiffResponse }`

  In other words, every successful command should have an explicit typed result payload, even when that payload is an empty object.

- `provider_request`
  Replace with `tool_call_request`.
  Payload should be a typed wrapper around `ToolCallRequest`, plus only the routing metadata the session layer actually needs.

- `provider_response`
  Replace with `tool_call_response`.
  Payload should carry a typed `ToolCallResponse` or a typed transport error, not a generic `result`.

- `provider.event`
  Remove it from the shared daemon event union.
  Emit provider-neutral `ThreadEvent` data directly, either as individual typed events or a typed `thread_event_batch`.

- `provider.rpc_error`
  Remove it from the shared daemon event union.
  Command/request failures should surface through failed command results.
  Out-of-band runtime health issues should surface through daemon/session health or a provider-neutral degraded/error event.

- `provider.stderr`
  Keep it out of the shared daemon event stream.
  If it is still needed, expose it only through debug/inspection surfaces rather than as a first-class shared runtime event.

Current-repo note:

- `provider_request` / `provider_response` only appear in the contract surface today.
- tool calls are the real active callback path, via `ToolCallRequest` / `ToolCallResponse` and `@bb/agent-runtime.onToolCall`.

Locked-in session replacement:

- add `tool_call_request`
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

### 3. Make package ownership explicit without adding a third package

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

Dependency direction:

- `@bb/server-contract` may depend on `@bb/env-daemon-contract`
- `@bb/env-daemon-contract` should not depend on `@bb/server-contract`

### 4. Remove `unknown` from exported contract surfaces

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

- change `Endpoint<Output = unknown>` to `Endpoint<Output = never>` in both contract packages

### 5. Move shared public payload types out of `@bb/core-ui`

`ThreadDetailRow` and the current `UIMessage` family are public API payloads in practice, so `@bb/core-ui` should not be their only owner.

Target direction:

- move the shared timeline/message payload types into a neutral package
- the practical destination for this slice is `@bb/domain`
- export Zod schemas with those types so runtime validation remains in the contract
- make `@bb/core-ui` consume those types rather than own them

Constraint:

- `@bb/server-contract` should not depend on `@bb/core-ui`

### 6. Normalize the public error envelope

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

### 7. Remove unused env-daemon inspection routes and type the retained one

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

### 8. Tighten app and CLI consumers against the exported contract

Once the contract types are corrected, remove local shadow types and undocumented assumptions.

Immediate cleanup targets:

- update app code that already expects `SystemEnvironmentInfo.capabilities`
- replace the CLI-local `ThreadSessionsPayload` / `ThreadSessionDebugView` types with contract exports
- make app and CLI consume the named timeline/message payloads from the contract
- update internal daemon consumers to import canonical daemon protocol types from `@bb/env-daemon-contract`

## Validation

- `pnpm exec turbo run typecheck --filter=@bb/domain --filter=@bb/server-contract --filter=@bb/env-daemon-contract --filter=@bb/agent-runtime --filter=@bb/core-ui --filter=@bb/app --filter=@bb/cli`
- `pnpm --filter @bb/core-ui test`
- `pnpm --filter @bb/agent-runtime test:unit`
- Run targeted consumer tests if touched:
  - `apps/app/src/hooks/useApi.test.ts`
  - `apps/cli/src/__tests__/command-output.test.ts`
- Confirm removed env-daemon inspection routes are absent from the exported contract and return the expected not-found behavior if the server implementation changes land in the same slice.
- Confirm no exported `unknown` payloads remain in `packages/server-contract` or `packages/env-daemon-contract`.

## Open Questions/Risks

- Whether `provider.ensure` stays as an explicit shared daemon command or becomes implicit env-daemon behavior around `@bb/agent-runtime.ensureProvider()`.
- Whether `provider.list_catalog` should be deleted outright or replaced with a provider-neutral capability/listing concept.
- Whether `SystemEnvironmentInfo` should keep its current name in this slice or be renamed later.
- Whether the moved timeline/message payloads should live directly in `@bb/domain` or in a smaller neutral submodule there.
- Whether any remaining open JSON extension points need shared `JsonValue` / `JsonObject` types after the provider-bridge tunnel is removed.
