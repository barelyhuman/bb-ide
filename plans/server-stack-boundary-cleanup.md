# Server Stack Boundary Cleanup

## Diagnosis

The server has genuine layering drift, but it's concentrated in three places. A prior draft of this plan proposed a server-wide refactor of every large service into state-machine/effects/orchestration trios. That's an architectural bet that should be proven on one service before being rolled out, not committed to up front.

Real problems:

1. **Route handlers do multi-step orchestration.** `actions.ts`, `environments.ts`, `automations.ts` each mix authorization, validation, business decisions, and daemon command queueing inline. A new reader can't tell where the policy decision ends and the effect begins.

2. **Optional fields hide server defaults.** `CreateThreadRequest`, `SendMessageRequest`, and friends accept `model`, `serviceTier`, `reasoningLevel`, `permissionMode` as optional. Services then infer whether missing means "use project default" or "use user's last choice." The contract doesn't say. `SendDraftRequest: z.object({})` is the extreme case — an accepted-but-ignored body.

3. **Lifecycle state manipulated from multiple layers.** `LifecycleOperationState` (`requested` / `queued` / `fetched` / `completed` / `failed`) is read and transitioned by routes, services, and internal event/command-result handlers. No single module owns the state machine, so invariants live in reviewers' heads.

The large files (`thread-provisioning.ts` 1240 LOC, `environment-provisioning.ts` 680 LOC, `command-result-handlers.ts` 598 LOC, `events.ts` 553 LOC) are symptoms, not the problem. Size alone isn't a design issue; mixed-responsibility size is.

## Phase 1: Resolve contract defaults at the route boundary

**Goal:** Move server policy decisions out of services and into a shared resolver that routes call before dispatching.

**Changes:**
- Create `apps/server/src/services/lib/execution-defaults.ts` with a pure function:
  ```
  resolveThreadExecutionOptions(
    payload: CreateThreadRequest,
    projectDefaults: ProjectDefaults,
    lastChoice?: ThreadExecutionOptions
  ): ResolvedThreadExecutionOptions
  ```
  No db calls inside. Takes inputs, returns a fully-resolved value.
- Update `CreateThreadRequest`, `CreateDraftRequest`, `SendMessageRequest` routes to call the resolver before entering service methods.
- Services stop accepting optional `model`/`serviceTier`/etc — require the resolved shape.
- For `SendDraftRequest: z.object({})`: either delete the body schema and change to a parameterless POST, or add fields that reflect what the endpoint actually does. Don't keep an empty schema as a placeholder.

**Exit criteria:**
- One resolver function, one call site per entry-point route.
- Services receive resolved options only; their types no longer mark these fields optional.
- `SendDraftRequest` schema reflects its actual input.
- `pnpm exec turbo run test --filter=@bb/server` passes.

## Phase 2: Pilot — extract ONE lifecycle state machine

**Goal:** Prove that explicit lifecycle state ownership improves the code, before committing to doing it nine more times.

**Pick one:** `thread-provisioning` is the biggest and messiest. `environment-cleanup` is smaller and may be a better first pilot. **Choose `environment-cleanup` as the pilot** — it's bounded, exercises all the interesting patterns (request/queue/complete/fail transitions, command-result handling, reconnect reconciliation), and its size (~500 LOC) makes the before/after comparable.

**Changes:**
- Create `apps/server/src/services/environments/environment-cleanup-state.ts`:
  - Owns `requestEnvironmentCleanup`, `markCleanupQueued`, `completeCleanup`, `failCleanup`.
  - All `LifecycleOperationState` transitions for cleanup go through this module.
  - All db calls related to cleanup state live here.
  - Returns side-effect lists (commands to queue, notifications to send) to the caller rather than executing them directly.
- Keep `environment-cleanup.ts` as the orchestrator: calls into the state module, applies the returned effects, handles error cases.
- Update `internal/command-result-handlers.ts` to call `environmentCleanupState.completeCleanup(commandId)` instead of manipulating state directly for cleanup results.

**Explicit gate on Phase 3:** after the pilot, answer honestly:
- Is the code clearer or just more files?
- Did the side-effects-as-return-value pattern help or add ceremony?
- Would a new reader trace cleanup flow faster now than before?

If the answers are yes, proceed to Phase 3. If no, revise the pattern or abandon the approach — the other large services don't get the same treatment just because the first one did.

**Exit criteria:**
- `environment-cleanup-state.ts` is the sole owner of cleanup lifecycle transitions.
- `grep -r "markEnvironmentOperationRecordQueued\|markEnvironmentOperationRecordCompleted" apps/server/src/ | grep -v environment-cleanup-state` returns nothing.
- Before/after code is subjectively easier to read (not a CI-checkable criterion; requires human judgment).
- `pnpm exec turbo run test --filter=@bb/server` passes.

## Phase 3 (conditional on Phase 2 pilot): Apply the pattern to thread provisioning

**Only execute if the Phase 2 pilot demonstrably improved the code.**

**Changes:**
- Same pattern applied to `thread-provisioning.ts`:
  - `thread-provisioning-state.ts` owns the state machine.
  - `thread-provisioning.ts` orchestrates.
- Update `command-result-handlers.ts` to call the new state module for thread operations.
- Don't touch `environment-provisioning.ts` or other services yet — wait for two data points, not one.

**Exit criteria:**
- Same as Phase 2 but for thread provisioning.
- Explicit re-evaluation before applying to any further service.

## Phase 4: Remove daemon contract leakage from routes

**Goal:** Routes don't parse daemon response schemas inline.

**Changes:**
- Audit `apps/server/src/routes/` for any `@bb/host-daemon-contract` imports.
- For each: move the daemon-contract interaction into a service method with a server-friendly return type.
- Routes call the service; service handles the daemon round-trip and schema parsing.

**Example:** `routes/environments.ts` currently uses `hostDaemonCommandResultSchemaByType["workspace.status"].parse(rawResult)` — move into a `getWorkspaceStatus` service method.

**Exit criteria:**
- `git grep "@bb/host-daemon-contract" apps/server/src/routes/` returns nothing.
- Services that talk to the daemon parse its responses at a single internal seam.
- `pnpm exec turbo run test --filter=@bb/server` passes.

## Out of scope — considered and declined

- **Line-count rules ("no route > 200 LOC, no service > 500 LOC").** A prior draft proposed these; they're arbitrary. Size is a symptom of mixed responsibilities, not the problem. If the phases above are done well, sizes fall. If they don't, the work wasn't what mattered.
- **Full server-wide rollout of the state-machine pattern.** Explicitly gated on the Phase 2 pilot. Do not pre-commit.
- **Splitting `internal/events.ts` and `internal/command-result-handlers.ts` into sub-modules.** They're large but their size is mostly case-handling for different event types; splitting them won't clarify ownership unless the lifecycle state work (Phase 2/3) changes what they need to do.
- **Renaming types, consolidating validation, framework migrations, performance work, test rewrites.**
- **Relocating types from `@bb/domain`.**

## Expected impact

Phase 1 is low-risk and high-value — it cleans up the contract surface without architectural commitment.

Phase 2 is the architectural bet, bounded to one service. Either it proves a pattern worth applying or teaches you it's not right — both outcomes are useful.

Phase 3 is conditional. Phase 4 is independent of the others.

**Most important:** do not skip the gate between Phase 2 and Phase 3. A plan that commits to refactoring nine services because the first one went OK is how this branch accumulates in the first place.
