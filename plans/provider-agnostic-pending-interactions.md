# Provider-Agnostic Pending Interactions

## Goal

Add a provider-agnostic interaction system that lets an agent pause and wait for
the user to:

- approve or deny a command
- approve or deny a file change
- grant additional permissions
- answer one or more structured questions

The first shipped integration should use this generic system through the Codex
adapter. Claude and any future provider should plug into the same lifecycle
rather than introducing provider-specific product surfaces. The first shipped
operator surface should be the CLI so the backend lifecycle can be exercised in
a closed loop before any app UI work lands.

## Why This Matters

Today bb behaves as if interactive approvals do not exist:

- Codex is started with `approvalPolicy: "never"` in
  [packages/agent-runtime/src/codex/adapter.ts](/Users/michael/.codex/worktrees/250d/bb/packages/agent-runtime/src/codex/adapter.ts)
- Claude Code is started with permission bypass in
  [packages/agent-runtime/src/claude-code/bridge/sdk-session.ts](/Users/michael/.codex/worktrees/250d/bb/packages/agent-runtime/src/claude-code/bridge/sdk-session.ts)
- provider JSON-RPC requests are only routed if they decode as dynamic tool
  calls in
  [packages/agent-runtime/src/runtime.ts](/Users/michael/.codex/worktrees/250d/bb/packages/agent-runtime/src/runtime.ts)
- daemon and server transport only expose a tool-call path today in
  [apps/host-daemon/src/server-client.ts](/Users/michael/.codex/worktrees/250d/bb/apps/host-daemon/src/server-client.ts)
  and
  [apps/server/src/internal/tool-calls.ts](/Users/michael/.codex/worktrees/250d/bb/apps/server/src/internal/tool-calls.ts)
- the public app has no route or UI for resolving blocked interactions in
  [apps/server/src/routes/threads/actions.ts](/Users/michael/.codex/worktrees/250d/bb/apps/server/src/routes/threads/actions.ts)

As a result, the product effectively only supports full access or
failure/bypass. Worse, non-tool provider requests can currently be dropped
without any JSON-RPC response, which can leave the provider hanging while it
waits for a reply.

## Product Shape

### Initial vertical slice

Ship the smallest end-to-end flow that proves the generic lifecycle against a
real provider:

- root thread only
- CLI resolver only
- exactly one active pending interaction per thread
- Codex only
- command approval only, including provider-offered amendment-style approval
  decisions when the provider advertises them as part of command approval
- approvals granted through this flow are session-scoped only
- resolution happens through `bb thread interactions` commands rather than app
  UI
- while a thread has a pending interaction, `send` and `turn/steer` style
  follow-up requests are rejected with `409 awaiting_user_interaction`
- unsupported or concurrent provider interaction requests receive an explicit
  provider-facing rejection or cancel; they must never be dropped or left
  unanswered

This slice is intentionally narrow so the generic lifecycle is proven before bb
expands to more interaction kinds or frontend surfaces.

### Expanded CLI scope

After the vertical slice works end to end, expand the same lifecycle and CLI
surface to:

- Codex ask-user-question
- Codex file-change approval

### Later backend scope

- permission scopes and grant persistence semantics
- thread-level question policy and timeout policy by thread class
- no durable pause/resume for disconnected runs
- Claude parity on top of the same internal lifecycle
- MCP elicitation is explicitly deferred beyond this milestone

### Final app scope

- app query hooks and mutations on top of the same server contract
- first-class app UI for all supported interaction kinds
- thread-level unread indicators that direct the user into the thread-scoped
  interaction UI
- app interaction UI should reuse existing app primitives and styling so it
  looks consistent with the rest of bb rather than introducing a separate
  visual language

## Design Principles

- The lifecycle must be provider-agnostic.
- The server owns the durable interaction lifecycle and policy.
- The daemon owns transport of blocked provider requests and provider response
  submission.
- Providers only translate between provider-native payloads and bb's internal
  interaction contract.
- Thread execution and interaction policy should use separate knobs:
  `sandboxMode` controls what the agent can do directly, while
  `questionPolicy` controls whether the agent should ask the user for more
  information.
- Backend and CLI should form the first closed loop. App UI is a later consumer
  of the same contract, not a prerequisite for proving it.
- Phase 1 supports exactly one active pending interaction per thread. Queueing
  multiple interactions is a later enhancement.
- Every provider request must receive an explicit resolution or an explicit
  provider-facing rejection. No provider request may be dropped silently.
- Do not encode this lifecycle in `thread.status` or other unrelated resource
  state.
- Do not fake this as ordinary timeline text. It needs first-class state,
  routing, and resolution APIs.
- Authorization for listing and resolving interactions must match authorization
  for the owning thread.
- Root-thread-only support is acceptable for the first ship if it is enforced
  explicitly and documented.

## Proposed Internal Model

Introduce a new server-owned lifecycle module and shared contract centered on a
generic `PendingInteraction`.

### Thread interaction policy controls

Keep interaction policy separate from pending-interaction lifecycle state.

Minimum thread/runtime controls:

- `sandboxMode`
  - existing execution constraint knob
- `questionPolicy`
  - provider-agnostic thread-level intent for whether the agent should ask the
    user clarifying questions or request structured answers
  - initial values:
    - `allow`
    - `avoid`
    - `deny`

The first implementation should map `questionPolicy` per provider rather than
overloading `sandboxMode` or `approvalPolicy`:

- Codex:
  - control `request_user_input` availability and instructions separately from
    approval policy
  - `deny` must include a server-side rejection backstop if Codex still sends
    `item/tool/requestUserInput`
- Claude:
  - control `AskUserQuestion` availability separately from permission prompts
  - `deny` should remove or block `AskUserQuestion`, not just rely on prompts
- extension-backed or host-owned harnesses:
  - some integrations may not have a provider-native "ask the user" callback
  - in those cases, `questionPolicy` should be enforced by host-owned tool
    availability, host UI exposure, and runtime blocking rather than by a
    provider-native pending-interaction request
  - `deny` should mean the question tool or extension is unavailable, plus a
    host-side rejection if the agent still attempts to invoke it

Default thread-class policy:

- regular persistent host-daemon thread:
  - `questionPolicy: allow`
  - no pending-interaction timeout
- sandbox-hosted thread:
  - `questionPolicy: avoid`
  - explicit opt-in may loosen this to `allow`
  - pending interactions time out after 10 minutes
- automation thread:
  - `questionPolicy: avoid`
  - explicit opt-in may loosen this to `allow`, but this is expected to be
    less useful than foreground runs
- manager-owned thread:
  - `questionPolicy: avoid`
  - root-thread-only pending-interaction enforcement remains a backstop for
    child threads

### Shared interaction shape

Add domain types for:

- `PendingInteraction`
- `PendingInteractionKind`
- `PendingInteractionStatus`
- `PendingInteractionPayload`
- `PendingInteractionResolution`

`PendingInteractionKind` should be a discriminated union with these values:

- `command_approval`
- `file_change_approval`
- `permission_request`
- `user_input_request`

If MCP ever becomes worth supporting again, it should be added later as a new
interaction kind rather than shaping the first milestone now.

Each interaction should carry:

- stable interaction id
- thread id
- optional turn id
- provider id
- provider request id or callback id
- created-at and resolved-at timestamps
- kind-specific payload
- explicit status owned by the interaction lifecycle

This lifecycle should be separate from thread status and turn status.

`PendingInteractionStatus` should be an explicit lifecycle state owned by the
server module:

- `pending`
- `resolved`
- `rejected`
- `interrupted`
- `expired`

### Persistence

Add a durable store for pending interactions and their resolutions.

Minimum requirements:

- one row per interaction
- durable raw provider correlation identifiers
- durable normalized payload
- durable resolution payload
- ability to query pending interactions by thread id
- an invariant of at most one active `pending` interaction per thread in phase 1

### Recovery Semantics

These semantics must be designed before implementation starts, even if later
phases improve them:

- app refresh:
  - pending interactions remain queryable and resolvable from persisted state
- duplicate request creation:
  - duplicate create attempts for the same provider callback identity resolve to
    the existing pending interaction only while that interaction is still
    `pending`
  - reusing a provider callback identity after it already reached a terminal
    state is rejected and requires the provider to send a new request id
- duplicate resolution:
  - resolution is idempotent and first terminal resolution wins
- daemon restart or provider-process exit in phase 1:
  - the pending interaction transitions to `interrupted`
  - the blocked provider request is not resumed automatically
  - the user must retry the turn manually
- no durable pause/resume:
  - pending interaction rows remain durable for audit and UI purposes
  - disconnected or expired runs do not resume automatically from stored
    interaction state alone
  - if the daemon or provider process goes away, the user retries manually
- expired interactions:
  - unresolved interactions can be marked `expired` by the lifecycle module
  - expiry produces an explicit user-visible reason rather than silently
    disappearing
- lost daemon results or reconnect:
  - reconciliation is defined by the lifecycle module rather than ad hoc in
    transport code
- concurrent interactions in phase 1:
  - one active pending interaction per thread
  - additional interaction requests from the same thread receive an explicit
    provider-facing rejection or cancel

### Eventing

Keep the timeline readable, but do not rely on timeline rows as the source of
truth.

Recommended:

- add provider or system events for interaction requested and interaction
  resolved
- keep the persisted interaction record as the canonical state
- render timeline summaries from that canonical state

## Work Plan

### Phase 0: Define the generic contract

1. Add shared domain types for pending interactions and resolutions.
2. Commit the phase 1 lifecycle semantics in the plan and contracts:
   - Codex command approval only
   - one active pending interaction per thread
   - `send` and `turn/steer` requests return `409 awaiting_user_interaction`
   - unsupported or concurrent provider requests receive an explicit
     provider-facing rejection or cancel
   - approvals granted through this flow are session-scoped only
   - list and resolve authorization matches the owning thread
   - daemon restart or provider-process exit marks the interaction
     `interrupted`
3. Add server and daemon contract types for:
   - reporting a provider request that needs user interaction
   - listing pending interactions
   - resolving an interaction
   - cancelling or expiring an interaction if needed
4. Define dedupe and idempotency keys for create and resolve operations.
5. Define the phase 1 runtime callback name and contract:
   - `onInteractiveRequest`

Exit condition:

- a provider-agnostic type contract exists in shared packages
- the contract does not mention Codex or Claude in its public names
- the lifecycle semantics for reconnect, duplicate requests, expiry, provider
  exit, and `turn/steer` while pending are written down before implementation

### Phase 1: Fix the runtime transport boundary

1. Extend `@bb/agent-runtime` so provider JSON-RPC requests are not treated as
   "tool call or drop".
2. Add a provider request decoding layer for:
   - dynamic tool calls
   - interactive requests
3. Add a runtime callback surface parallel to `onToolCall`:
   - `onInteractiveRequest`
4. Keep provider request-response correlation explicit and typed.
5. Preserve current dynamic tool behavior.
6. For unsupported provider request kinds, return an explicit JSON-RPC error or
   provider-facing rejection rather than dropping the request.

Exit condition:

- the runtime can receive a provider request that is not `item/tool/call`
- unsupported requests are answered explicitly rather than hanging the provider

### Phase 2: Build the server-owned lifecycle module and internal plumbing

1. Introduce a dedicated server lifecycle module for pending interactions.
2. Centralize:
   - creation
   - lookup
   - resolution
   - cancellation
   - expiry
   - audit logging
   - phase 1 policy enforcement
3. Add persistence for pending interactions and their resolutions.
4. Add a new internal daemon-to-server route family for interactive requests and
   resolutions, implemented on top of the lifecycle module.
5. The daemon should:
   - send normalized interactive requests to the server
   - block the provider request until the server returns a resolution
6. The server should:
   - validate and persist the interaction through the lifecycle module
   - accept a later resolution and reply to the daemon
7. Make create and resolve operations idempotent.

Exit condition:

- a provider request can pause in the daemon, persist on the server, and later
  resume with a typed resolution
- interaction lifecycle rules live in one server-owned module
- thread and turn state do not own this lifecycle

### Phase 3: Ship the Codex command-approval CLI vertical slice

1. Stop hardcoding `approvalPolicy: "never"` for the Codex path needed by the
   command-approval slice.
2. Map Codex command-approval requests into `PendingInteraction`, including
   provider-offered amendment decisions carried by the command-approval
   payload.
3. Add thread-scoped server routes for:
   - list pending interactions
   - get a pending interaction
   - resolve a pending interaction
4. Ensure those routes enforce the same authorization boundary as the owning
   thread.
5. Add a `bb thread interactions` CLI command group with subcommands for:
   - list
   - show
   - approve
   - deny
6. Enforce the phase 1 behavior that a thread with a pending interaction
   rejects `send` and `turn/steer` with `409 awaiting_user_interaction`.
7. Add targeted tests for request correlation, duplicate resolve attempts, and
   provider-process exit while a request is pending.

Exit condition:

- a user can resolve a Codex command approval from the CLI and the same blocked
  turn resumes or fails as designed
- the vertical slice is live through the generic pending-interaction lifecycle

### Phase 4: Expand Codex CLI interaction kinds

1. Add Codex ask-user-question support.
2. Add Codex file-change approval support.
3. Extend `bb thread interactions` to render and resolve those typed payloads.
4. Add timeline summaries backed by canonical interaction state.

Exit condition:

- the same lifecycle and CLI surface support at least command approval,
  ask-user-question, and file-change approval for Codex threads

### Phase 5: Add later backend-only kinds and parity

1. Add permission-request support with explicit grant scope handling.
2. Extend the CLI and server routes to support those payloads.
3. Introduce a provider-agnostic `questionPolicy` on thread execution/runtime
   configuration.
4. Map `questionPolicy` onto provider-specific controls and backstops:
   - Codex `request_user_input` availability and explicit rejection handling
   - Claude `AskUserQuestion` tool availability or denial
   - extension-backed or host-owned integrations use host-owned question tools
     or extension gates rather than provider-native callbacks
5. Remove Claude's unconditional permission bypass for supported interaction
   modes.
6. Map Claude approval and question callbacks onto the same generic lifecycle.
7. Finalize non-durable background interaction policy:
   - persistent host-daemon threads do not time out
   - sandbox-hosted threads time out after 10 minutes
   - daemon restart or provider exit interrupts the interaction and requires a
     manual retry
   - no durable pause/resume is introduced in this phase
8. Keep these kinds on the same lifecycle model and authorization boundary.

Exit condition:

- permission requests, `questionPolicy`, and Claude use the same
  pending-interaction lifecycle and backend contract
- `questionPolicy` is implementable both for provider-native question callbacks
  and for host-owned question tools or extensions
- background and sandbox runs have explicit non-durable timeout behavior rather
  than implicit waiting forever
- phase 5 is fully implementable and verifiable through daemon + server + CLI
  without depending on any phase 6 app work

### Phase 6: Add the app surface last

1. Reuse the thread-scoped list, get, and resolve routes from phase 3.
2. Add app query hooks and mutations on top of the canonical server contract.
3. Add first-class app UI for command approval, ask-user-question,
   file-change approval, and permission requests.
4. Add thread-level unread indicators that reflect pending interactions without
   introducing a separate global inbox route.
5. Reuse the same lifecycle rules, authorization rules, and dedupe semantics
   already proven through the CLI.
6. Reuse existing app shell, detail, status, and action primitives so the
   interaction UI is stylistically aligned with the rest of the application.

Exit condition:

- the app can display and resolve the same pending interactions already
  supported by the backend and CLI
- app UI does not introduce a second lifecycle or provider-specific product
  path
- app interaction surfaces are visually and structurally consistent with
  existing app components

## Open Questions

1. Should later phases add queued interactions per thread, or keep the invariant
   of one active interaction per thread even after phase 1?

## Exit Criteria

This plan is complete only when all of the following are true:

- bb has a provider-agnostic pending interaction contract and lifecycle
- Codex uses that lifecycle for the supported first-ship interaction kinds
- the CLI can list and resolve pending interactions through first-class server
  routes and commands
- thread execution policy distinguishes at least `sandboxMode` and
  `questionPolicy`
- the app can later display and resolve those same interactions through
  first-class API routes and UI
- the daemon and server correctly recover pending interactions across reconnects
- unsupported interaction kinds fail explicitly and predictably
- Claude can be integrated later without changing the product model or API
  shape

## Validation

### Automated

#### Phase 5

These checks must be sufficient to ship phase 5 before any app work exists:

- `pnpm exec turbo run typecheck --filter=@bb/domain --filter=@bb/db --filter=@bb/server-contract --filter=@bb/host-daemon-contract --filter=@bb/agent-runtime --filter=@bb/server --filter=@bb/host-daemon --filter=@bb/cli`
- `pnpm exec turbo run test --filter=@bb/domain --filter=@bb/db --filter=@bb/server-contract --filter=@bb/host-daemon-contract --filter=@bb/agent-runtime --filter=@bb/server --filter=@bb/host-daemon --filter=@bb/cli --force`

Add or update tests for:

- permission-request registration, persistence, resolution, and grant-scope handling
- Codex `request_user_input` allow and deny behavior under `questionPolicy`
- Claude `AskUserQuestion` allow and deny behavior under `questionPolicy`
- explicit rejection when `questionPolicy: deny` blocks a question request
- timeout behavior with injectable clocks or timers:
  - sandbox-hosted threads expire after 10 minutes
  - persistent host-daemon threads do not auto-expire
- daemon restart and provider-process exit while an interaction is pending
- CLI list, show, approve, deny, and answer flows for permission and question payloads
- Codex adapter request and response mapping
- Claude adapter request and response mapping once phase 5 lands
- no phase 5 test should depend on `@bb/app`

#### Phase 6

Add app-specific checks on top of the phase 5 baseline:

- `pnpm exec turbo run typecheck --filter=@bb/app`
- `pnpm exec turbo run test --filter=@bb/app --force`

Add or update tests for:

- app query and resolve flows
- thread-level unread indicator behavior for pending interactions
- app UI behavior for the same interaction kinds already proven in phase 5
- reuse of existing app primitives rather than a parallel interaction-specific
  UI path where applicable

### Manual

#### Phase 5

Run these scenarios against a local CLI + server + daemon. None of these checks
should require the phase 6 app UI:

1. Start a Codex-backed thread configured to allow interactive requests and
   `questionPolicy: allow`.
2. Trigger a command approval request and confirm it appears in
   `bb thread interactions list`.
3. Deny the request through the CLI and verify the provider receives a denial
   and the turn continues or fails as designed.
4. Trigger an ask-user-question request with multiple questions and verify the
   CLI answer path resumes the same turn.
5. Trigger a file-change approval request and verify the CLI can inspect and
   resolve the payload correctly.
6. Trigger a permission request and verify the CLI applies the documented grant
   scope semantics.
7. Start a thread with `questionPolicy: deny`, trigger a question request, and
   verify the request is rejected explicitly rather than becoming a pending
   interaction.
8. Run the same approval and question flows on a Claude-backed thread once
   phase 5 lands.
9. Restart the daemon while a request is pending and verify the lifecycle
   recovers or fails in the documented way.
10. Kill the provider process while a request is pending and verify the
   interaction transitions to `interrupted` with the documented recovery path.
11. Verify sandbox-hosted timeout behavior with a dev/test timeout override so
    the expiry path can be exercised quickly, while automated tests still
    assert the production default remains 10 minutes.
12. Verify unsupported kinds produce an explicit user-visible explanation
    rather than disappearing.

#### Phase 6

Repeat the relevant UI checks once phase 6 lands:

1. Refresh the app while a request is pending and verify the interaction is
   still visible and resolvable there.
2. Resolve the same kind through the app and confirm the server and daemon
   behavior matches the CLI path.
3. Verify thread-level unread indicators reflect pending interactions and clear
   after resolution.
4. Compare the interaction UI against existing app surfaces and verify it uses
   the same layout, status, and action patterns rather than a one-off design.

### Manual Comparison Checklist

- pending interactions are visible without reading raw timeline data
- CLI resolution is sufficient to exercise the lifecycle before app UI lands
- phase 5 verification is complete without depending on app hooks or app UI
- resolutions are correlated to the correct provider request
- the same internal contract can represent both Codex and Claude requests
- `questionPolicy` can also be enforced for extension-backed harnesses without
  inventing a provider-specific product surface
- no thread status or turn status field is overloaded to represent this
  lifecycle
- root-thread-only restrictions are enforced intentionally, not accidentally
