# Server Subtractive Cleanup And Test Trust

## Goal

Make the server smaller, simpler, and easier to trust by removing duplicate
paths, stale compatibility branches, over-broad tests, and weak abstractions
before adding any new structure.

The rule for this work is subtraction first:

- Prefer deleting code over moving it.
- Prefer inlining a weak single-caller abstraction over extracting a new one.
- Prefer collapsing two paths into one existing path over introducing a third.
- Add code only when it removes more code, makes an invariant enforceable, or
  replaces repeated behavior with a smaller canonical implementation.
- Every cleanup slice should target a net reduction in production complexity.
  If a slice needs temporary additions, finish the deletion in the same slice.

## Current Findings

- `apps/server/src` is about 35k lines, with several broad files carrying too
  many decisions:
  - `services/threads/thread-lifecycle.ts`: 1,585 lines
  - `services/threads/timeline.ts`: 1,351 lines
  - `services/terminals/terminal-session-lifecycle.ts`: 1,212 lines
  - `services/threads/thread-provisioning-environment.ts`: 1,189 lines
  - `routes/apps.ts`: 1,564 lines
  - `internal/events.ts`: 844 lines
  - `internal/command-results.ts`: 422 lines
- Server-related tests are abundant, about 78k lines across server/db/domain,
  contract, and fake integration tests. The problem is not test quantity. The
  problem is that many tests are large regression bundles, assert indirect
  details, or preserve behavior after the code has moved on.
- Lifecycle ownership is partially present, but direct mutation still leaks
  through routes, internal ingress handlers, and helper modules.
- Several production paths still contain `legacy`, workaround, and broad
  fallback branches. Some may be permanent compatibility support, but many need
  explicit deletion decisions.

## Non-Goals

- Do not perform a framework rewrite.
- Do not create a new architectural layer just to label old complexity.
- Do not keep tests solely because they exist.
- Do not add broad new test harnesses before pruning false-confidence tests.
- Do not rely on other plan files as source of truth.

## Operating Rules

- Each PR starts with a removal inventory for the chosen area.
- Each PR states what was deleted, what was kept, and why any added code was
  necessary to remove or simplify something else.
- No new optional service arguments to route around existing design problems.
- No generic lifecycle updates through metadata helpers.
- No accepted-but-ignored fields.
- New abstractions are allowed only after two existing paths are collapsed into
  one canonical path.
- Prefer small vertical slices that end in less code and passing targeted tests.

## Phase 0: Make A Deletion Inventory

**Goal:** Find what can be removed before designing replacements.

Work:

- Inventory server production matches for:
  - `legacy`
  - `deprecated`
  - `workaround`
  - `HACK`
  - `TODO`
  - `as unknown`
  - route imports from daemon contracts
  - low-level lifecycle mutators outside their owner area
- For each item, classify it as:
  - delete now;
  - delete after one migration/rejection test;
  - permanent compatibility support;
  - test-only fixture text;
  - unclear, needs incident/data proof.
- Inventory exported functions in the largest server modules and mark:
  - public entry point;
  - same-file helper;
  - single external caller;
  - no caller.
- Inventory the largest tests and mark:
  - protects a current invariant;
  - duplicates another test;
  - asserts implementation detail;
  - regression note with no clear invariant;
  - can be deleted.

Exit criteria:

- A checked-in section in this plan lists the first deletion candidates by area.
- The first implementation slice can start by deleting or inlining code, not by
  adding a new service.
- Each unclear item has a concrete command, SQL query, or production-data check
  needed to decide it.

Validation:

- `rg -n "legacy|deprecated|workaround|HACK|TODO|as unknown" apps/server/src packages/db/src packages/domain/src packages/server-contract/src`
- `rg -n "transitionThreadStatus|markThreadStopRequested|clearThreadStopRequested|setEnvironmentStatus|recordEnvironmentCleanupRequest|clearEnvironmentCleanupRequest" apps/server/src`
- `rg -n "from \"@bb/host-daemon-contract\"|from '@bb/host-daemon-contract'" apps/server/src/routes apps/server/src/services apps/server/src/internal`

### Phase 0 Inventory

Status: complete for the first server lifecycle deletion slice.

Already deleted or collapsed in this cleanup:

- Deleted the outdated protocol roadmap plan.
- Collapsed single-use environment provision command-result wrappers into
  `settleEnvironmentProvisionCommandResult`.
- Collapsed single-use environment destroy command-result wrappers into
  `settleEnvironmentDestroyCommandResult`.
- Collapsed single-use thread start/stop command-result wrappers into
  `settleThreadStartCommandResult` and `settleThreadStopCommandResult`.
- Deleted dead `recordThreadProvisionWorkspaceReady`.
- Inlined the single-use thread archive forwarding helper into
  `queueArchivedThreadProviderArchiveCommand`.
- Deleted unused nullable `getWorkspaceCommandTarget`.
- Routed non-owner thread status transitions through thread transition helpers.
- Removed redundant notification-spy assertions where response bodies,
  persisted rows, or filesystem state already proved the invariant.
- Made file-local helpers private where they were not imported elsewhere.

Remaining delete-now candidates:

- Remaining same-file wrappers in lifecycle/command modules only when inlining
  removes repeated lookups or duplicate branches. Do not inline helpers that make
  the owning function harder to read.
- Tests that assert notification spies when another assertion already proves the
  persisted state, queued command, or response shape.

Keep for now:

- `legacyScheduleDefinitionSchema` and
  `legacyAutomationScheduleTriggerSchema`; these parse stored automation data and
  need a migration/rejection decision before deletion.
- `LEGACY_EXPIRED_COMMAND_ATTEMPT_ID`; expired-command repair still names this
  compatibility path.
- `legacyTurnRequestTargetForType`; this reads old persisted thread events.
- Provider-event legacy request-sequence rejection checks; these are boundary
  rejection logic, not compatibility acceptance.
- SQLite maintenance legacy comments/branches; these support older databases.

Phase 2 ownership decisions from this slice:

- Direct `transitionThreadStatus` usage is now limited to
  `thread-lifecycle.ts` and the `thread-transitions.ts` wrapper.
- Direct environment status/cleanup mutation is limited to the environment
  provisioning and cleanup lifecycle modules.
- Route-local `updateThread` remains metadata-only; the DB input does not carry
  lifecycle fields such as `status` or `stopRequestedAt`.

Needs later contract cleanup:

- Public route imports from `@bb/host-daemon-contract`, especially file-list and
  branch-list limits in route modules.
- Optional execution/default fields that are still resolved below the route
  boundary.

## Phase 1: Delete Dead And Duplicated Server Code

**Goal:** Remove obvious complexity before touching architecture.

Status: complete for the first server lifecycle deletion slice.

Work:

- Delete unused exports, dead helpers, obsolete compatibility branches, and
  unreachable route branches.
- Inline single-caller wrappers that only rename another helper or pass through
  arguments.
- Collapse duplicate validation and parsing helpers into the smallest existing
  implementation.
- Remove route-local code that duplicates service behavior when the service path
  is already canonical.
- Delete tests that only prove mocks/spies were called or preserve deleted
  behavior.

Exit criteria:

- Net production LOC decreases for each slice unless a clearly documented
  deletion-enabling test was added.
- No user-visible behavior changes except removal of explicitly obsolete inputs
  or branches.
- Deleted tests are either redundant with stronger tests or tied to behavior that
  no longer exists.

Validation:

- `pnpm exec turbo run typecheck --filter=@bb/server --filter=@bb/db --filter=@bb/domain`
- `pnpm exec turbo run test --filter=@bb/server --filter=@bb/db --filter=@bb/domain`
- For any deleted route behavior, add or keep one route-contract assertion for
  the current accepted behavior.

Completed work:

- Deleted the outdated protocol roadmap plan.
- Removed single-use command-result settlement wrappers in environment
  provisioning, environment cleanup, and thread lifecycle.
- Removed dead thread provisioning and workspace-command-target helpers.
- Reduced exported helper surface to functions imported outside their module.
- Collapsed archive helpers that wrapped single values in result objects.
- Deleted environment cleanup convenience wrappers and duplicate cleanup
  predicates.
- Deleted the thread stop/finalize wrapper and made delete flows call the
  lifecycle steps directly.
- Collapsed project deletion staging helpers into the deletion begin/advance
  flows.
- Removed unused released-child result collection from manager-thread archive.
- Made local-only lifecycle, cleanup, provisioning, archive, queued-message, and
  ownership helper types private.
- Collapsed duplicated terminal lifecycle close/publish paths for deleted
  threads, archived threads, and destroyed environments while preserving the
  daemon-close-before-DB-exit order.
- Deleted the thread provisioning context save wrapper and call
  `upsertThreadProvisionOperation` directly at the mutation sites.
- Deleted global app list signature get/set wrappers and inlined the map update
  where the list is refreshed.
- Removed command-result owner identity wrappers while keeping the typed owner
  registry as the single dispatch table.
- Inlined one-use thread stop payload/reason helpers, the provision-to-start
  handoff helper, the managed-thread failure notification action builder, and
  small thread-command wrappers for workspace context, cascade-risk checks, and
  manager provider validation.
- Removed event-ingress container wrappers around atomic event insertion,
  follow-up results, follow-up batch execution, and response assembly while
  keeping the named event filtering and notification grouping steps.
- Removed empty app-route argument interfaces and changed route-segment helpers
  to take the application id directly.
- Inlined the single-use `createTurnSubmitCommandPayload` wrapper so turn-submit
  queuing shows preparation and request-id finalization in one flow.
- Made managed-thread notification argument types private.
- Simplified voice transcription availability so the model config is parsed
  once and provider availability is checked directly.

## Phase 2: Collapse Lifecycle Mutation Paths

**Goal:** Remove alternate ways to change lifecycle state.

Status: complete for the first server lifecycle deletion slice.

Work:

- Pick one lifecycle field group at a time:
  - `threads.status`
  - `threads.stopRequestedAt`
  - environment `status`
  - environment `cleanupRequestedAt`
  - environment `cleanupMode`
  - command result settlement state
  - pending interaction lifecycle state
- For each group, find every production writer.
- Delete or redirect duplicate writers to the smallest existing canonical path.
- Remove generic update inputs that can carry lifecycle fields.
- If a route or ingress handler needs lifecycle behavior and no canonical path
  exists, first try to reuse an existing lifecycle function. Add a new function
  only when it lets multiple direct mutations disappear.

Exit criteria:

- Each lifecycle field group has one production owner path.
- Route handlers request lifecycle work; they do not assemble lifecycle state
  transitions directly.
- Internal daemon ingress appends/accepts data and delegates lifecycle effects;
  it does not grow independent state policy.
- Generic metadata update helpers cannot accept lifecycle fields.

Validation:

- The lifecycle mutator grep from Phase 0 shrinks to owner modules and DB
  repository internals.
- `pnpm exec turbo run test --filter=@bb/server --force > /tmp/bb-server-test.txt 2>&1`
  then inspect `/tmp/bb-server-test.txt`.
- `pnpm exec turbo run test --filter=@bb/integration-tests --force > /tmp/bb-integration-test.txt 2>&1`
  then inspect `/tmp/bb-integration-test.txt`.

Completed work:

- Redirected queued-message, turn-submit, and turn-completed status updates
  through the thread transition helpers instead of direct DB mutators.
- Verified environment lifecycle mutators are only used by environment cleanup
  and provisioning lifecycle modules.
- Verified pending interactions and command-result settlement remain owned by
  their lifecycle/settlement modules rather than route-local metadata helpers.
- Narrowed thread command-environment lookup to the field it actually reads
  instead of requiring full thread records.

## Phase 3: Shrink Tests Until They Protect Real Invariants

**Goal:** Make test failures useful by deleting weak coverage and keeping tests
that prove outcomes.

Status: complete for the first server lifecycle deletion slice.

Work:

- For each large regression file, list the invariants it actually protects.
- Delete cases that duplicate another test or assert call order/spies without a
  user-visible or persisted outcome.
- Replace broad setup with smaller existing builders only when it makes the test
  shorter and closer to the invariant.
- Prefer assertions on:
  - persisted DB state;
  - response body/status;
  - queued command rows;
  - stored events;
  - public contract shape;
  - observable hub result when notification behavior itself is the contract.
- Run a sabotage check on critical invariants: locally break the invariant and
  verify the intended test fails. Do not commit sabotage changes.

Exit criteria:

- The largest server test files either shrink or have a short invariant table at
  the top explaining why the breadth is necessary.
- Important lifecycle behavior has direct owner-level tests instead of only
  route-level regression coverage.
- Deleted tests are documented in the PR as redundant, implementation-detail
  assertions, or obsolete behavior.

Validation:

- `pnpm exec turbo run test --filter=@bb/server --force > /tmp/bb-server-test.txt 2>&1`
  then inspect `/tmp/bb-server-test.txt`.
- `pnpm exec turbo run test --filter=@bb/db --filter=@bb/domain --filter=@bb/server-contract`

Completed work:

- Deleted redundant notification-spy assertions from public app, thread pinning,
  and queued-message ordering tests.
- Kept notification-spy tests where notification payloads, websocket behavior,
  or ordering relative to persisted state are the actual contract.
- Confirmed the lifecycle cleanup remains covered by server, integration, DB,
  domain, and server-contract suites.
- Current tracked diff for this cleanup is net negative: 1,906 deleted lines and
  568 added lines before any commit splitting.

Completed validation on 2026-06-03:

- `pnpm exec turbo run typecheck --filter=@bb/server --filter=@bb/db --filter=@bb/domain`
- `pnpm exec turbo run test --filter=@bb/server --force > /tmp/bb-server-test.txt 2>&1`
  passed: 92 files, 903 tests.
- `pnpm exec turbo run test --filter=@bb/integration-tests --force > /tmp/bb-integration-test.txt 2>&1`
  passed: 21 files, 49 tests.
- `pnpm exec turbo run test --filter=@bb/db --filter=@bb/domain --filter=@bb/server-contract --force > /tmp/bb-db-domain-contract-test.txt 2>&1`
  passed: DB 29 files / 307 tests, domain 15 files / 67 tests, server-contract
  1 file / 18 tests.
- `git diff --check`

## Phase 4: Split Files Only After Deleting First

**Goal:** Improve readability without creating more total code.

Work:

- Only split a large file after unused branches, duplicate helpers, and
  single-caller wrappers have already been removed.
- Split by deletion-proven boundaries, not by aspirational architecture.
- Good split candidates after pruning:
  - lifecycle request eligibility;
  - command-result settlement;
  - reconciliation/recovery;
  - event ingress append/dedupe;
  - deferred follow-ups;
  - app manifest parsing;
  - app data storage;
  - timeline row selection;
  - timeline pagination/windowing.
- Avoid extracting tiny modules that only hide local complexity.

Exit criteria:

- The split leaves less or equal production LOC after imports and tests are
  counted.
- Each new file has one reason to change.
- No concept has two rendering or mutation paths after the split.

Validation:

- `pnpm exec turbo run typecheck --filter=@bb/server`
- `pnpm exec turbo run test --filter=@bb/server`
- For lifecycle splits: `pnpm exec turbo run test --filter=@bb/integration-tests`

## Phase 5: Remove Contract Ambiguity

**Goal:** Delete implicit defaults and compatibility paths that make behavior
hard to reason about.

Work:

- Audit optional and nullable fields in server contracts, daemon contracts,
  domain types, and lifecycle operation payloads.
- Delete optional fields when omission has no real semantic meaning.
- Fill defaults once at the server boundary, then pass explicit values
  internally.
- Remove route imports of daemon contract details by deleting leaked constants or
  moving parsing behind existing server services.
- Prefer rejecting old payloads with clear errors over preserving ambiguous
  legacy parsing forever.

Exit criteria:

- Service entry types require resolved values instead of optional defaults.
- Public route modules do not expose daemon protocol details.
- Legacy branches have deletion dates/conditions or are marked permanent
  compatibility with a reason.

Validation:

- `pnpm exec turbo run typecheck --filter=@bb/server --filter=@bb/server-contract --filter=@bb/host-daemon-contract`
- `pnpm exec turbo run test --filter=@bb/server --filter=@bb/server-contract --filter=@bb/host-daemon-contract`

## Phase 6: Add Only Small Confidence Tools

**Goal:** Add narrowly scoped checks only where they replace recurring manual
debugging or prevent new workaround code.

Allowed additions:

- A read-only SQL audit for inconsistent lifecycle state.
- A small guard test preventing lifecycle fields from flowing through metadata
  helpers.
- A focused contract test for rejected obsolete payloads.
- Structured logs/counters for stale command results, rejected lifecycle
  transitions, deferred follow-ups, and recovery reconciliation.

Not allowed:

- Broad new test harnesses before pruning existing tests.
- New lifecycle state machines beside existing operation rows.
- New route/service wrappers that do not delete an older path.

Exit criteria:

- Every addition replaces repeated manual debugging or deletes an old workaround.
- The net direction of the server remains smaller and easier to inspect.

Validation:

- Run the narrow package suite for the added check.
- If adding an audit, test it against one seeded bad-state database and one clean
  database.

## First Slice

Start with thread lifecycle because it intersects most server breakage:

1. Inventory every production writer of `threads.status` and
   `threads.stopRequestedAt`.
2. Delete or inline dead wrappers in `thread-lifecycle.ts`.
3. Remove any route/internal direct lifecycle mutations that already have an
   existing lifecycle function.
4. Delete tests that only assert lifecycle notification spies when persisted
   state or queued commands already prove the behavior.
5. Run the server and integration suites through Turbo.

Do not split `thread-lifecycle.ts` until this deletion pass is done.
