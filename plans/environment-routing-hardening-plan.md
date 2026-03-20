# Goal

Get shared-environment, multi-thread, multi-provider execution into a fail-closed, environment-scoped architecture. The target state is:

- one env-daemon per environment
- one environment-scoped session between server and env-daemon
- many threads per environment, each with its own provider identity and provider-thread identity
- managed vs unmanaged lifecycle keyed only by `environmentId` and persisted environment metadata
- no request, event, tool call, resume, suspend, archive, or provider discovery path may route through a guessed thread or provider
- ambiguity must surface as a clear error, never as a hang or silent fallback

# Scope

In scope:

- server orchestration and lifecycle code in `apps/server/src/orchestrator.ts`, `apps/server/src/environment-service.ts`, `apps/server/src/environment-daemon-session-service.ts`, `apps/server/src/environment-daemon-command-dispatcher.ts`, `apps/server/src/server.ts`, and `apps/server/src/routes/environment-daemon.ts`
- env-daemon runtime and session sync/supervision in `packages/environment-daemon/src/runtime.ts`, `packages/environment-daemon/src/service.ts`, `packages/environment-daemon/src/session-supervisor.ts`, and `packages/environment-daemon/src/session-sync.ts`
- managed env-daemon launch and reuse in `packages/environment/src/host-environment-daemon.ts` and sibling environment implementations
- coverage and QA under `apps/server/src/__tests__/**`, `packages/environment-daemon/src/*.test.ts`, and `qa/**`

Out of scope unless directly required by correctness:

- UI polish
- new provider features beyond restoring correctness for `codex`, `claude-code`, and `pi`
- compatibility work for legacy thread-owned environment behavior beyond explicit migration/reprovision rules

# Implementation Steps

1. Write and enforce cross-layer invariants first.

- Add a short architecture doc under `docs/` or `qa/env-daemon/` that defines the hard ownership boundaries:
  - environment owns daemon runtime and daemon session
  - thread owns command routing, provider session state, and provider-thread identity
  - provider child owns only the runtime process for a provider spec, never environment ownership
- Make “fail closed on ambiguity” an explicit invariant in code comments and test names.
- Use the same vocabulary everywhere: remove “owner thread”, “originating thread”, “representative thread”, and similar terms from environment-scoped paths.

2. Remove representative-thread routing from server orchestration.

- Replace `_resolveEnvironmentCommandTransportThread()` in `apps/server/src/orchestrator.ts` with an environment-scoped command transport model. It currently still selects a single attached thread to piggyback environment commands.
- Delete `_resolveEnvironmentSessionTransportThread()` in `apps/server/src/orchestrator.ts`. Its current `[0]` selection is a direct expression of the old special-thread model.
- Refactor `_listProviderModelsFromEnvironmentDaemon()` and `_listProviderCatalogFromEnvironmentDaemon()` so they route by `environmentId` and explicit `providerId` instead of requiring a chosen attached thread.
- Introduce explicit errors for:
  - no active env-daemon session for the environment
  - provider requested without a unique thread binding when a thread binding is required
  - multiple matching attached threads for a provider

3. Remove fail-open notification routing.

- Replace `_resolveNotificationThreadId()` in `apps/server/src/orchestrator.ts` with strict identity resolution.
- Delete the current fallback path that returns the current thread when `matchingThreadIds.length === 0 && providerScopedThreadIds.length === 1`; this is exactly the class of silent misrouting you described.
- Require provider notifications and provider tool calls to resolve through a canonical routing record:
  - `environmentId`
  - `threadId`
  - `providerId`
  - `providerThreadId`
- If provider-thread identity is missing or ambiguous, emit a typed internal error and fail the affected turn/thread instead of dropping into an unresponsive state.

4. Collapse env-daemon runtime routing into one explicit routing table.

- Refactor `packages/environment-daemon/src/runtime.ts` so `threadIdToChild`, `threadIdToProviderId`, and `threadIdByProviderThreadKey` become one coherent routing structure with explicit ownership metadata.
- Remove the remaining process-wide fallback behavior:
  - `resolveCommandChild()` falling back to `ensureProviderRunning()` when no explicit routing exists
  - `resolveProviderEventThreadId()` falling back to “whatever child emitted the event” when the event lacks enough identity
  - `resolveAnyRoutableThreadId()` and any code path that derives readiness/degradation from an arbitrary thread
- Keep child-local request/response routing, but stop treating `providerChild` as an acceptable implicit default outside narrowly isolated bootstrap code.
- Make provider initialization state child-scoped and keyed by the routed child/spec, not by mutable global pointers.

5. Rework env-daemon bootstrap and supervision to be environment-native.

- Remove `BB_THREAD_ID` / `initialThreadIds` as a meaningful part of env-daemon identity:
  - `packages/environment-daemon/src/service.ts`
  - `packages/environment-daemon/src/session-supervisor.ts`
  - `packages/environment/src/host-environment-daemon.ts`
- Allow env-daemon to start with zero or many bound channels and attach channels as threads are resumed or discovered.
- Replace “bootstrap from the first thread” behavior with explicit channel attach/detach operations in the session flow.
- Audit `session-supervisor.ts` and `session-sync.ts` for single-thread shortcuts such as `threadIds[0]` and keep only the limited optimization for cursor reuse where it is provably safe and does not affect routing semantics.

6. Make environment attachments the only runtime authority.

- Audit `apps/server/src/environment-service.ts`, `apps/server/src/orchestrator.ts`, and `apps/server/src/server.ts` to ensure attachment rows, not `threads.environmentId`, are authoritative whenever `threadEnvironmentAttachmentRepo` exists.
- Remove any remaining runtime logic that falls back to `thread.environmentId` in attached-environment flows.
- Add strict helpers for:
  - resolve attached environment for thread
  - list attached threads for environment
  - assert thread belongs to environment
  - assert environment has no ambiguous provider binding
- Missing attachment state in shared-environment flows should fail as data corruption or invalid state, not degrade into legacy behavior.

7. Harden managed vs unmanaged lifecycle semantics.

- Make `managed` the sole switch for setup/cleanup behavior in `apps/server/src/environment-service.ts` and provisioning helpers.
- Confirm cleanup decisions are keyed by:
  - `environmentId`
  - environment attachment membership
  - `managed`
  - archive state of all attached threads
- Remove thread-derived bootstrap metadata from managed env-daemon launch/reuse where it still leaks through environment variables and cached records.
- Allow old thread-shaped managed artifact assumptions to be discarded rather than preserved. Prefer reprovision over compatibility branches if the old shape conflicts with environment-scoped ownership.

8. Split environment-scoped and thread-scoped commands at the protocol boundary.

- Review the environment-daemon command protocol and classify every command:
  - environment-scoped: `provider.list_catalog`
  - provider-scoped within an environment: `provider.list_models`
  - thread-scoped: `thread.start`, `thread.resume`, `thread.stop`, `turn.run`, `thread.rename`, workspace queries tied to a thread context
- Stop tunneling environment-scoped commands through thread-scoped dispatch machinery unless the protocol explicitly carries environment identity and the dispatcher enforces it.
- Extend typed errors in server and env-daemon layers so “wrong environment”, “wrong provider”, and “ambiguous thread mapping” are distinct operator-visible failures.

9. Remove stale naming and state that encode the old architecture.

- Rename variables, comments, and test fixtures that still imply a privileged thread:
  - `ownerThreadId`
  - `initialThreadIds` when it actually means bootstrap channels
  - any “originating”/“initiating” thread value used as environment authority rather than audit metadata
- Keep `initiatingThreadId` only where the operation is genuinely initiated by a thread and never where environment identity should stand on its own.
- Sweep for env-daemon log/session/bootstrap code that still threads per-thread identity into environment-scoped process metadata.

10. Rebuild coverage around the actual failure matrix.

- Unit/integration coverage to add or tighten:
  - `packages/environment-daemon/src/runtime.test.ts`
    - mixed providers in one environment with interleaved resume, follow-up, tool calls, stop
    - same provider across two threads in one environment
    - child exit only invalidates owned requests and owned threads
    - notification without unique routing identity fails explicitly
  - `packages/environment-daemon/src/session-supervisor.test.ts`
    - session opens with multiple channels and no primary thread
    - channel attach/detach after startup
    - command polling does not derive behavior from the first channel
  - `apps/server/src/__tests__/orchestrator.test.ts`
    - provider event ambiguity throws instead of selecting a sibling
    - provider catalog/model queries do not use arbitrary attached threads
    - attached-environment operations ignore stale `threads.environmentId`
  - `apps/server/src/__tests__/environment-service.test.ts`
    - archive/unarchive/cleanup with shared managed vs unmanaged environments
    - resume after cleanup when one sibling archived and one active
- E2E coverage to add or harden:
  - extend `thread-multi-provider-shared-environment.scenario.ts` with archive/resume/restart branches
  - extend `thread-multi-thread-stress.scenario.ts` to include mixed providers and explicit failure assertions
  - add a scenario where two threads in one environment use the same provider but distinct provider-thread identities
  - add a scenario that asserts an explicit error when routing metadata is missing or stale rather than waiting for idle forever

11. Turn QA into a real gate for this subsystem.

- Add a surface-owned QA pass for “shared environment routing” under `qa/env-daemon/` or `qa/server/` instead of burying it in ad hoc e2e notes.
- Make the required final gate for this refactor:
  - `qa/env-daemon/core`
  - `qa/env-daemon/recovery`
  - `qa/server/core`
  - `qa/environments/core`
  - `qa/e2e/smoke`
  - a dedicated multi-provider shared-environment scripted pass
- Include both real-provider and deterministic fake-provider coverage. Fake coverage should prove routing invariants; real coverage should prove no provider-specific bridge breaks the model.

12. Execute in slices that preserve control-plane correctness.

- Slice A: invariants doc, naming cleanup, and strict error helpers
- Slice B: server routing refactor for environment-scoped vs thread-scoped transport
- Slice C: env-daemon runtime routing table refactor
- Slice D: session bootstrap/supervisor/channel model refactor
- Slice E: lifecycle and managed/unmanaged cleanup refactor
- Slice F: coverage + QA gate completion
- Do not mix broad behavior changes across all layers without landing the tests for each slice first.

# Validation

- Typecheck after each slice:
  - `pnpm exec turbo run typecheck --filter=@bb/environment-daemon`
  - `pnpm exec turbo run typecheck --filter=@bb/environment`
  - `pnpm exec turbo run typecheck --filter=@bb/provider-adapters`
  - `pnpm exec turbo run typecheck --filter=@bb/server`
- Run focused tests after each slice:
  - environment-daemon runtime/session tests
  - orchestrator tests
  - environment-service tests
  - command/session service tests
- End-to-end acceptance criteria:
  - no environment-scoped operation selects an arbitrary attached thread
  - no provider event or request routes to a thread without an explicit unique mapping
  - same-environment mixed-provider activity completes without cross-thread contamination
  - same-environment same-provider activity completes without cross-thread contamination
  - managed environments clean up only when the last archived attachment semantics say they should
  - unmanaged environments never run managed setup/cleanup flows
  - failures surface as explicit errors, not hangs
- Final repo sweep before calling this complete:
  - grep for `[0]`/first-thread selection in environment-scoped code paths
  - grep for `BB_THREAD_ID` use in env-daemon launch/bootstrap
  - grep for `ownerThreadId`, `originatingThreadId`, and representative-thread terminology in runtime code

# Open Questions/Risks

- The current protocol mixes environment-scoped and thread-scoped concerns. You may need a protocol revision rather than only internal cleanup if you want environment-scoped commands to stop piggybacking on thread dispatch.
- Real-provider bridges may still have provider-specific identity gaps. Pi already needed thread-scoped isolation in `runtime.ts`; Codex and Claude may have their own hidden assumptions once routing gets stricter.
- There is already meaningful drift between code and the deleted earlier plan. Expect more hidden single-thread assumptions in tests and fixtures than in production paths.
- This should be treated as one coordinated reliability refactor. Small local fixes in only server or only env-daemon will keep recreating the same phantom failures because the wrong assumption currently exists in both layers.
