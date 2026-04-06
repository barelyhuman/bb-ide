# Handler Registry: Decouple Internal Orchestrators

## Problem

`internal/events.ts` and `internal/command-result-handlers.ts` are manual dispatch
tables that import 8+ service modules each. Every new event type or command result
type requires editing these central files and adding cross-domain imports. They
couple threads, environments, scheduling, and hosts together through a single
bottleneck.

## Goal

Each domain owns its own event-effect and command-result handlers. The internal
dispatch files become thin routers that iterate a registry — they no longer import
any service module directly.

## Design

### Registry types

```ts
// src/internal/handler-registry.ts

interface EventEffectHandler {
  /** Event types this handler responds to. */
  eventTypes: ReadonlySet<string>;
  handle(
    deps: Pick<AppDeps, "db" | "hub" | "logger">,
    event: HostDaemonEventEnvelope,
  ): Promise<void>;
}

interface CommandResultHandler {
  /** Command types this handler responds to. */
  commandTypes: ReadonlySet<string>;
  handle(
    deps: Pick<AppDeps, "config" | "db" | "hub" | "logger" | "sandboxRegistry">,
    report: HostDaemonCommandResultReport,
    commandRow: typeof hostDaemonCommands.$inferSelect,
  ): Promise<void>;
}

interface HandlerRegistry {
  registerEventHandler(handler: EventEffectHandler): void;
  registerCommandResultHandler(handler: CommandResultHandler): void;
  applyEventEffects(
    deps: Pick<AppDeps, "db" | "hub" | "logger">,
    events: HostDaemonEventEnvelope[],
  ): Promise<void>;
  applyCommandResultSideEffects(
    deps: Pick<AppDeps, "config" | "db" | "hub" | "logger" | "sandboxRegistry">,
    report: HostDaemonCommandResultReport,
    commandRow: typeof hostDaemonCommands.$inferSelect,
  ): Promise<void>;
}
```

`applyEventEffects` iterates handlers in registration order, calling each whose
`eventTypes` matches the event. `applyCommandResultSideEffects` does the same for
command types.

### Registry lives in AppDeps

Add `handlerRegistry: HandlerRegistry` to `AppDeps`. Registration happens in
`createApp()` before routes are mounted — explicit, ordered, visible in one place.

### Domain-owned handlers

Each domain module exports a handler constant. No new files needed in most cases —
the handler can live alongside the existing service code.

#### Threads

**Event handler** — owns `turn/started`, `turn/completed`, `thread/name/updated`:

- `turn/started`: transition thread to `active` (currently in `applyEventEffects`)
- `turn/completed`: apply turn-completed logic, drain queued drafts, sync manager
  schedules, archive automation threads (currently the largest branch in
  `applyEventEffects`). This handler calls into scheduling and environments for the
  post-turn-completed chain — that cross-domain call is explicit and contained.
- `thread/name/updated`: update thread title

Source: new export in `services/threads/thread-event-effects.ts`

**Command result handler** — owns `thread.start`, `thread.stop`, `turn.run`,
`turn.steer`:

- `thread.start`: complete or fail thread start operation, transition to error on
  failure
- `thread.stop`: complete or fail thread stop, finalize stopped thread
- `turn.run`, `turn.steer`: transition to error on failure

Source: new export in `services/threads/thread-command-result-handler.ts`

#### Environments

**Command result handler** — owns `environment.provision`, `environment.destroy`:

- `environment.provision`: the large `handleProvisionCommandResult` function moves
  here intact (it's 120 lines of orchestration that should stay as one unit)
- `environment.destroy`: complete/fail destroy, clean up ephemeral hosts

Source: new export in `services/environments/environment-command-result-handler.ts`

#### Hosts / Workspace

**Command result handler** — owns `workspace.commit`, `workspace.squash_merge`,
`workspace.promote`, `workspace.demote`:

- Notify environment hub on successful workspace mutations

Source: new export in `services/hosts/workspace-command-result-handler.ts`

### What stays in `internal/`

- **`events.ts`**: Session auth, event batch validation, `insertEvents`, call
  `registry.applyEventEffects()`, prune candidates. All the event-storage and
  batch-validation logic stays — only `applyEventEffects` dispatches through the
  registry.
- **`command-result-route.ts` / `command-results.ts`**: Session auth, command
  lookup, `reportCommandResult`, call `registry.applyCommandResultSideEffects()`.
  Replaces the direct call to `handleCommandResultSideEffects`.
- **`command-result-handlers.ts`**: Deleted entirely once all handlers are migrated.
- **`turn-completed-events.ts`**: Moves into threads domain (it's already
  thread-specific logic).
- **`reconciliation.ts`**: Unchanged — it's session-reconnect logic, not event
  dispatch.

## Steps

### Step 1: Introduce the registry (no behavior change)

1. Create `src/internal/handler-registry.ts` with `HandlerRegistry` interface,
   `EventEffectHandler` / `CommandResultHandler` types, and
   `createHandlerRegistry()` factory.
2. Add `handlerRegistry` to `AppDeps`.
3. Create the registry in `createApp()` and pass it through deps.
4. No handlers registered yet — the existing dispatch code still runs.

**Validation**: typecheck passes, all existing tests pass unchanged.

### Step 2: Migrate command result handlers

This is the cleaner side — the switch in `handleCommandResultSideEffects` has
clear per-type boundaries with minimal cross-domain effects.

1. Create `services/threads/thread-command-result-handler.ts`:
   - Move `handleThreadStartResult`, `handleThreadStopResult`,
     `handleThreadCommandFailure` from `command-result-handlers.ts`.
   - Export `threadCommandResultHandler: CommandResultHandler`.

2. Create `services/environments/environment-command-result-handler.ts`:
   - Move `handleProvisionCommandResult`, `handleEnvironmentDestroyResult` from
     `command-result-handlers.ts`.
   - Export `environmentCommandResultHandler: CommandResultHandler`.

3. Create `services/hosts/workspace-command-result-handler.ts`:
   - Move `handleWorkspaceMutationResult` from `command-result-handlers.ts`.
   - Export `workspaceCommandResultHandler: CommandResultHandler`.

4. Register all three in `createApp()`.

5. Replace `handleCommandResultSideEffects` call in `command-results.ts` with
   `deps.handlerRegistry.applyCommandResultSideEffects(deps, report, commandRow)`.

6. Delete `command-result-handlers.ts`.

**Validation**: all `internal-command-result-*.test.ts` tests pass. Specifically:
- `internal-command-result-environment-notifications.test.ts`
- `internal-command-result-idempotency.test.ts`
- `internal-command-result-thread-failure.test.ts`

### Step 3: Migrate event effect handlers

1. Create `services/threads/thread-event-effects.ts`:
   - Move `turn/started` branch, `turn/completed` branch (including
     `archiveCompletedAutomationThreadIfNeeded`), and `thread/name/updated` branch.
   - Move `turn-completed-events.ts` content into this file or keep as a local
     helper imported by the handler.
   - Export `threadEventEffectHandler: EventEffectHandler`.

2. Register in `createApp()`.

3. Replace `applyEventEffects` call in `events.ts` with
   `deps.handlerRegistry.applyEventEffects(deps, eventsToApply)`.

4. Delete the `applyEventEffects` function and `archiveCompletedAutomationThreadIfNeeded`
   from `events.ts`. Remove now-unused service imports.

**Validation**: all `internal-event-*.test.ts` tests pass. Specifically:
- `internal-event-side-effects.test.ts`
- `internal-event-envelope-threadid-regression.test.ts`

### Step 4: Clean up

1. Verify `events.ts` no longer imports any `services/` module (only `@bb/db`,
   `@bb/host-daemon-contract`, and `internal/` siblings).
2. Verify `command-result-handlers.ts` is deleted.
3. Verify `turn-completed-events.ts` is either deleted or moved into
   `services/threads/`.
4. Remove `handleCommandResultSideEffects` export if any stale references remain.
5. Update any test helpers that directly import moved functions.

**Validation**: full `pnpm exec turbo run test --filter=@bb/server --force` passes.

## Exit Criteria

- [ ] `internal/events.ts` imports zero `services/` modules
- [ ] `internal/command-result-handlers.ts` is deleted
- [ ] `internal/command-results.ts` dispatches through the registry
- [ ] Each domain (threads, environments, hosts) owns its handlers in `services/`
- [ ] Handler registration is explicit and ordered in `createApp()`
- [ ] All existing server tests pass with no test changes beyond import paths
- [ ] No new test files required (existing integration tests cover all paths)

## Risks / Decisions

**Ordering**: `turn/completed` triggers a chain: thread transition → queue drain →
manager schedule sync → automation archive → environment cleanup. This stays as a
single handler in the threads domain that explicitly calls into scheduling and
environments. If the chain grows further, we can split into ordered sub-handlers
later.

**`handleProvisionCommandResult` complexity**: This 120-line function iterates
bound threads, replays start events, and requests thread starts. It moves to
`environments/` as a single unit. Do not split it across handlers.

**`reconciliation.ts`**: Left unchanged. It's session-reconnect logic that
queries and mutates directly, not event dispatch. It could adopt the registry
pattern later but doesn't need to in this change.

**Registry vs. event bus**: The registry is a simple ordered array, not a pub/sub
system. Handlers are called synchronously in order. This is intentional — we want
explicit control flow, not decoupled async events that are hard to reason about.
