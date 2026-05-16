# Code Quality Follow-ups

Selected items from the host-daemon, ui, server, and data-domain boundary cleanup reviews. Each phase is independent unless noted.

## Current Status (2026-04-28)

Source review shows Phase 2 has some work landed, and Phase 6 has partial resolved-execution plumbing, but both still miss their exit criteria.

- Phase 2: Partial. Diff byte limits and required dispatch `eventSink` exist; commit policy and file-list policy still need cleanup.
- Phase 3: Open. Workspace watch state still lives in `apps/host-daemon`.
- Phase 4: Open. `thread-view` projections still depend on `getEvent*` field-accessor helpers.
- Phase 5: Complete. Projection state and assistant/reasoning buffering now live outside `build-event-projection.ts`; buffered-text identity is private to `thread-view`.
- Phase 6: Partial. Resolved execution option types exist, but optional route/service inputs and service-side default resolution remain.
- Phase 7: Open. At least one server route still imports `@bb/host-daemon-contract` directly.

## Phase 2: Move policy from host daemon to server

**Goal:** Daemon requires policy inputs from the server; no defaults, no hardcoded behavior.

**Status (2026-04-28):** Partial. `workspace.diff` now requires `maxDiffBytes` and `maxFileListBytes` in the command contract, and server call sites supply them. `CommandDispatchOptions.eventSink` is required and `noopEventSink` exists for tests. Remaining: `workspace.commit` still lacks required server-owned hook policy, and `workspace.list_files` still only takes `query` and `limit`.

**Changes:**

- [x] Remove `SYSTEM_MAX_DIFF_BYTES` and `SYSTEM_MAX_FILE_LIST_BYTES` fallbacks in `apps/host-daemon/src/command-dispatch.ts` for `workspace.diff`; make `maxDiffBytes` and `maxFileListBytes` required on the `workspace.diff` command; update the server to always supply them.
- [ ] Decide whether `workspace.list_files` needs a byte limit in addition to `limit`; if yes, make `maxFileListBytes` required on the command and update server call sites.
- [ ] Add a required `skipHooks: boolean` field on the workspace commit command. Update the server to decide and pass it explicitly. Remove the hardcoded `noVerify: true` in the daemon handler.
- [x] Make `eventSink` required on `CommandDispatchOptions`. Provide a `noopEventSink` for tests that don't care about event flow. Remove the `eventSink?.flush()` / `eventSink?.emit()` optional chains in command dispatch.
- [ ] Remove the optional `eventSink` branch from replay command options, or document why replay has a different boundary than normal command dispatch.

**Exit criteria:**

- `grep -n "SYSTEM_MAX\|noVerify: true\|eventSink?" apps/host-daemon/src/` returns no matches except in comments or tests.
- Command schemas for `workspace.diff`, `workspace.list_files`, `workspace.commit` have the new required fields.
- Server updated to supply them.
- `pnpm exec turbo run test --filter=@bb/host-daemon` passes.

## Phase 3: Consolidate workspace state ownership

**Goal:** One source of truth for "what changed in this workspace and when."

**Status (2026-04-28):** Open. `WorkspaceWatchState` is still defined in `apps/host-daemon/src/runtime-manager.ts`, and runtime-manager still tracks `lastLocalFingerprint` / `lastSharedRefsFingerprint` directly.

**Changes:**

- `RuntimeManager` in `apps/host-daemon/src/` currently owns a `WorkspaceWatchState` map and also orchestrates `HostWorkspace` and `HostWatcher`. Move `WorkspaceWatchState` into `packages/host-workspace` so the package that knows git state also tracks change state.
- Audit `environment-change-reporter` and runtime-manager for duplicated status checks. Pick one site to do the detection; have the other read its result.
- `trackedThreadStorageTargets` stays in RuntimeManager (daemon-level thread routing, not workspace state).

**Exit criteria:**

- `WorkspaceWatchState` defined in `host-workspace`, not `host-daemon`.
- No duplicate `getStatus()` / `lastLocalFingerprint` tracking between reporter and runtime-manager.
- `pnpm exec turbo run test --filter=@bb/host-daemon --filter=@bb/host-workspace` passes.

## Phase 4: Narrow `ThreadEvent` at the boundary, delete field-accessor helpers

**Goal:** Replace `getEventTurnId(event)`-style calls with type-narrowed access to the specific variant.

`thread-view/src/event-decode.ts` exposes helpers like `getEventTurnId`, `getEventProviderThreadId`, `getEventParentToolCallId` that projection modules call throughout the codebase. These helpers walk around `ThreadEvent`'s discriminated union with runtime accessors, erasing the type system's knowledge of which variant carries which field. The right shape is: decode/narrow once at the boundary, then access variant-specific fields directly.

**Status (2026-05-01):** Open. `getEventTurnId`, `getEventProviderThreadId`, and `getEventParentToolCallId` are still imported by `build-event-projection.ts` and other projection/lifecycle modules.

**Changes:**

- In `build-event-projection.ts` and the projection modules it calls, replace calls to `getEventTurnId`, `getEventProviderThreadId`, `getEventParentToolCallId`, and similar accessors with `switch (event.type)` blocks that narrow the union.
- Where a projection genuinely needs "turnId if the event has one" across heterogeneous variants, add a single helper in `thread-view` that returns `string | undefined` with a strongly-typed parameter (`event: Extract<ThreadEvent, { turnId: string }>` or similar). Do not create a parallel union type.
- Delete the `getEvent*` accessors once call sites migrate.

**Exit criteria:**

- `grep -r "getEventTurnId\|getEventProviderThreadId\|getEventParentToolCallId" packages/thread-view/src` returns zero matches outside the file being deleted.
- No new types added that mirror `ThreadEvent`.
- `pnpm exec turbo run test --filter=@bb/thread-view` passes.

## Phase 5: Extract projection state lifecycle from `build-event-projection.ts`

**Goal:** Let the main loop be read top-to-bottom without paging through initialization and finalization helpers.

`build-event-projection.ts` mixes state initialization, the event loop, subsidiary lifecycle handlers (tool activity, operations), and normalization passes.

**Status (2026-05-01):** Complete. `ProjectionState` now lives in `packages/thread-view/src/event-projection-state.ts`, assistant/reasoning buffering lives in `packages/thread-view/src/assistant-event-projection.ts` and `packages/thread-view/src/buffered-text-projection.ts`, and buffered-text identity was moved out of `@bb/domain` into private `thread-view` internals.

**Changes:**

- [x] Create `packages/thread-view/src/event-projection-state.ts`:
  - `ProjectionState` interface (currently declared inline in `build-event-projection.ts`).
  - `createProjectionState()` factory.
  - `finalizeProjectionState({ state, options })` (encapsulates the current `finalizePendingMessages()` logic).
- [x] Have `tool-activity-projection.ts` and `operation-projection.ts` state initialization/teardown flow through `event-projection-state.ts` rather than being set up inline in `build-event-projection.ts`.
- [x] Keep `build-event-projection.ts` readable as: `createProjectionState()` → loop over events → `finalizeProjectionState()` → return.
- [x] Move buffered-text identity out of `@bb/domain`; expose only `compactThreadTimelineSummaryEvents()` from `@bb/thread-view` for the server's summary compaction caller.

**Exit criteria:**

- `build-event-projection.ts` drops below 600 lines (sanity check that the extraction pulled weight, not a prescriptive limit). Completed: 595 lines.
- `ProjectionState` interface has exactly one definition, in `event-projection-state.ts`. Completed.
- `pnpm exec turbo run test --filter=@bb/thread-view` passes. Completed.

## Phase 6: Resolve server contract defaults at the route boundary

**Goal:** Move server policy decisions out of services and into a shared resolver that routes call before dispatching.

Routes accept `model`, `serviceTier`, `reasoningLevel`, `permissionMode` as optional. Services then infer whether missing means "use project default" or "use user's last choice." The contract does not say which.

**Status (2026-04-28):** Partial. `ResolvedThreadExecutionOptions` and related runtime plumbing exist, but `ThreadCreateServiceRequestInput` and `ExecutionOptionsRequest` still expose optional execution fields, and `resolveExecutionOptions()` still performs DB-backed default resolution inside the service layer.

**Changes:**

- Create `apps/server/src/services/lib/execution-defaults.ts` with a pure function:
  ```
  resolveThreadExecutionOptions(
    payload: CreateThreadRequest,
    projectDefaults: ProjectDefaults,
    lastChoice?: ThreadExecutionOptions,
  ): ResolvedThreadExecutionOptions
  ```
  No db calls inside. Takes inputs, returns a fully-resolved value.
- Update `CreateThreadRequest`, `CreateDraftRequest`, `SendMessageRequest` routes to call the resolver before entering service methods.
- Services stop accepting optional `model` / `serviceTier` / etc. — require the resolved shape.

**Exit criteria:**

- One resolver function, one call site per entry-point route.
- Services receive resolved options only; their types no longer mark these fields optional.
- `pnpm exec turbo run test --filter=@bb/server` passes.

## Phase 7: Remove daemon contract leakage from server routes

**Goal:** Routes do not parse daemon response schemas inline.

**Status (2026-04-28):** Open. `apps/server/src/routes/internal-replay.ts` still imports `hostDaemonCommandResultSchemaByType` from `@bb/host-daemon-contract`.

**Changes:**

- Audit `apps/server/src/routes/` for any `@bb/host-daemon-contract` imports.
- For each: move the daemon-contract interaction into a service method with a server-friendly return type.
- Routes call the service; service handles the daemon round-trip and schema parsing.

**Example:** `routes/environments.ts` currently uses `hostDaemonCommandResultSchemaByType["workspace.status"].parse(rawResult)` — move into a `getWorkspaceStatus` service method.

**Exit criteria:**

- `git grep "@bb/host-daemon-contract" apps/server/src/routes/` returns nothing.
- Services that talk to the daemon parse its responses at a single internal seam.
- `pnpm exec turbo run test --filter=@bb/server` passes.
