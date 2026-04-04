# DB Boundary Cleanup

Follow-up planning for a separate PR that tightens the boundary between `apps/server` and `packages/db`.

## Problem

The current codebase mixes two patterns:

- `@bb/db` owns schema, IDs, and many core CRUD/query helpers.
- `apps/server` still contains a large amount of raw Drizzle query and transaction code.

That split is hard to reason about and conflicts with the intended design discipline in `AGENTS.md`:

- reuse before duplicating
- separate concerns
- keep storage/query concerns behind shared boundaries where possible

The goal of this follow-up is not to move every line of persistence code out of the server. The goal is to make the boundary coherent and predictable.

## Scope For The Follow-Up PR

This plan now targets only older server-owned DB access that predates the scheduled-tasks work on this branch.

The branch already extracted the new scheduled-task DB helpers for:

- `apps/server/src/services/automation-sweep.ts`
- `apps/server/src/services/manager-schedule-sync.ts`
- `apps/server/src/services/nudge-sweep.ts`
- `apps/server/src/services/thread-commands.ts`
- `apps/server/src/services/environment-provisioning.ts`
- `apps/server/src/services/thread-events.ts`
- supporting query fragments in `apps/server/src/internal/events.ts`

Those files should stay out of scope for the separate cleanup PR unless a later review finds new boundary issues.

## Boundary Rule

Use this rule for the cleanup PR:

- `@bb/db` should own reusable data access: raw `select`/`insert`/`update`/`delete` helpers, transactional row mutation helpers, and cross-feature query primitives.
- `apps/server` should own product policy and orchestration: validation, scheduling, daemon interaction, notifications, and event-driven workflows.

In practice:

- Move raw query fragments and transactions into `@bb/db` when they can be named as domain-level data operations.
- Keep logic in the server when it coordinates DB state with daemon commands, websocket side effects, scheduling, or product-policy decisions.

## Cases That Still Make Sense Outside `@bb/db`

These are acceptable server-owned cases even after cleanup:

### 1. Event-driven orchestration

Example:

- `apps/server/src/internal/events.ts`

Why it stays in the server:

- It decides which side effects to apply for daemon events.
- It coordinates thread status changes, manager schedule sync, draft sending, and automation auto-archive.
- The policy of *when* to apply those effects belongs to the server, even if some supporting DB reads can be extracted.

### 2. Session/runtime reconciliation

Examples:

- `apps/server/src/ws/daemon-protocol.ts`
- `apps/server/src/internal/reconciliation.ts`

Why it stays in the server:

- These flows reconcile daemon runtime state with persisted state.
- They decide how to react to disconnects, active-thread mismatches, and interrupted work.
- That is runtime policy, not just data access.

### 3. Command-result orchestration

Example:

- `apps/server/src/internal/command-result-handlers.ts`

Why it stays in the server:

- It coordinates DB updates with daemon result semantics and follow-up actions like queueing `thread.start` or `environment.destroy`.
- The “what happens after this command succeeds/fails” policy belongs to the server.

### 4. Route-level composition

Examples:

- request validation
- shaping API responses
- deciding which DB helpers to call based on request semantics

Why it stays in the server:

- Routes should not contain raw ad hoc SQL, but they should still compose the higher-level operations that implement the API.

## Cleanup Targets

### Group A: Clear Moves Into `@bb/db`

These should be the first targets.

- `apps/server/src/services/thread-data.ts`
  - Move event row listing/query helpers into `@bb/db`.
- `apps/server/src/services/entity-lookup.ts`
  - Move host/session/environment/thread lookup queries into `@bb/db`.
  - Keep `ApiError` wrappers in the server if needed.
- `apps/server/src/internal/session-state.ts`
  - Move active-session lookup into `@bb/db`.
- `apps/server/src/internal/command-results.ts`
  - Move command lookup-by-id into `@bb/db`.
- `apps/server/src/internal/command-result-route.ts`
  - Reuse the same shared command lookup helper instead of route-local SQL.
- `apps/server/src/routes/projects.ts`
  - Move project-source list/get/count helpers into `@bb/db`.

### Group B: Extract Reusable Query Fragments From Server Workflows

Keep the workflows in `apps/server`, but push the DB operations down.

- `apps/server/src/services/environment-cleanup.ts`
  - pending thread shutdown lookup
  - pending environment command lookup

### Group C: Intentionally Server-Owned, Only Extract Supporting Helpers

Do not try to move these whole modules into `@bb/db`.

- `apps/server/src/internal/reconciliation.ts`
- `apps/server/src/ws/daemon-protocol.ts`
- `apps/server/src/internal/command-result-handlers.ts`

For these files, only extract the DB-shaped subroutines when there is a clean, reusable data helper to name.

## Proposed PR Shape

Keep the cleanup PR narrow and staged.

### Phase 1: Foundation helpers

- Add missing shared read/query helpers to `packages/db/src/data/*`.
- Add tests for new DB helpers in `packages/db/test/data/*`.
- Do not change server behavior yet.

### Phase 2: Replace clear server-side query modules

- Migrate `thread-data.ts`, `entity-lookup.ts`, `session-state.ts`, and the simple command/source lookup paths.
- Keep server wrappers where `ApiError` conversion is still useful.

### Phase 3: Extract duplicated query fragments from workflows

- Replace legacy server-local pending-command and status lookup SQL with `@bb/db` helpers.
- Only extract transaction blocks when the helper has a clear domain name and stable contract.

### Phase 4: Cleanup and boundary pass

- Remove now-unused Drizzle imports/tables from server modules.
- Check for duplicate query shapes that should now share a DB helper.
- Update any touched tests to rely on the shared helpers rather than route-local assumptions.

## Non-Goals

- Do not move daemon/runtime policy into `@bb/db`.
- Do not collapse all server workflows into the DB package.
- Do not rewrite scheduling, event ingestion, or reconciliation logic unless required by the boundary extraction.
- Do not combine this cleanup with unrelated product behavior changes.

## Exit Criteria

- The legacy data-access modules listed in Group A no longer contain raw Drizzle queries in `apps/server`.
- Shared query fragments used by multiple server modules have a named `@bb/db` helper instead of duplicated SQL.
- Route files do not own ad hoc row-level source/command queries when a shared DB helper would suffice.
- Server-owned orchestration modules still own policy and daemon coordination, but their raw data access is reduced to only the cases justified above.
- No user-visible behavior changes beyond harmless refactor effects.

## Validation

Run:

```sh
pnpm exec turbo run test typecheck --filter=@bb/db --filter=@bb/server --force
```

At minimum, confirm coverage for:

- `packages/db/test/data/*.test.ts` suites touched by new helpers
- `apps/server/test/public-projects*.test.ts`
- `apps/server/test/public-threads.test.ts`
- `apps/server/test/internal-event-side-effects.test.ts`
- `apps/server/test/internal-session*.test.ts`

## Follow-Up Notes

- If the cleanup reveals a cleaner long-term rule, document it in `AGENTS.md` after the separate PR lands.
- Prefer several small helper extractions over one sweeping “move all DB logic” refactor.
