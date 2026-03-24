# Rebuild Plan

Implementation plan for the bb server, host-daemon, and supporting infrastructure. See `plans/architecture.md` for the full architecture and data model. See `plans/environment-package.md` for the workspace and host design.

## Context

The old server, environment-daemon, environment, core, and api-contract packages have been deleted. The contract packages (`@bb/domain`, `@bb/server-contract`, `@bb/env-daemon-contract`) have been consolidated. This plan rebuilds the backend from those contracts.

### What exists today

| Package | State |
|---|---|
| `@bb/domain` | Done — entity types, event types, Zod schemas. Needs updates (renames, new types, dead type removal). |
| `@bb/server-contract` | Done — public API routes, internal API, WS protocol, error types. Needs updates (route renames, new routes, type renames). |
| `@bb/env-daemon-contract` | Done — needs rename to `@bb/host-daemon-contract` + full rewrite for new session protocol. |
| `@bb/db` | Partial — schema + migrations + connection + IDs exist. Needs full rewrite (clean slate). |
| `@bb/agent-runtime` | Done — provider adapters (codex, claude-code, pi), registry, runtime. Leave as-is. |
| `@bb/templates` | Done — untouched |
| `@bb/core-ui` | Done — view transforms. Needs import updates after domain renames. |
| `@bb/ui-core` | Done — shared React components |
| `@bb/tsconfig` | Done — untouched |
| `apps/app` | Exists — needs import updates + new UI for hosts, sources, environment creation |
| `apps/cli` | Exists — needs import updates |
| `apps/server` | Empty — needs to be created |
| `@bb/workspace` | Does not exist — needs to be created |
| `apps/host-daemon` | Does not exist — needs to be created |

### Architecture summary

```
App/CLI  <--HTTP-->  Server (cloud)  <--HTTP-->  Host-daemon (per machine)
         <--WS(notifications)-->     <--WS(notifications)-->
                                                    |
                                              Provider processes (via agent-runtime, one per thread)
```

- Server is stateless (DB is the state). Can hot-reload.
- Host-daemon is long-lived, one per machine. Manages everything: environments, provider processes, git operations.
- Provider processes are children of the daemon (one per active thread). They die on daemon restart — threads resume via `thread.resume`.
- WS is notification-only everywhere. All data flows over HTTP.
- WS notifications are automatic — fired by the data mutation layer, not route handlers.

### Sequencing philosophy

Build and test packages with complex behavior **before** wiring them into the server/daemon. Same approach as `@bb/agent-runtime`: iterate on design, build the package, test it heavily in isolation with real scenarios, then integrate.

The risk in this system is in `@bb/workspace` (real git operations, edge cases) and `apps/host-daemon` (session management, reconnection, command routing) — not in the server (mostly CRUD routing).

---

## Implementation Principles

These apply to all code written during the rebuild. The previous codebase suffered from tangled god-objects, over-configured DI, leaky package boundaries, and constant rewrites when data model assumptions changed. These principles exist to prevent that.

### Module design

- **One clear responsibility per module.** If you can't describe what a file does in one sentence, it's doing too much — split it. File length is a signal, not a rule: a long file should trigger a pause to reconsider structure.
- **Prefer plain functions over classes.** Use classes only when you genuinely need instance state (a running server, a WS connection manager, a `Workspace` representing a directory). Route handlers, business logic, data transformations, validators — all functions.
- **No god objects.** No single class/module that takes 10 dependencies and has 20 methods. Instead: focused modules composed at the entry point.

### Dependencies

- **No DI framework or container.** Dependencies are plain function parameters. If a module needs the DB, it takes `db: DbConnection`. If it needs a logger, it takes `logger: Logger`.
- **Wire once at the entry point.** `index.ts` creates dependencies, passes them to modules, starts the server. The dependency graph is visible by reading that one file.
- **Declare what you use.** Package dependencies in `package.json` must be explicit.

### Package boundaries

- **Export only through `src/index.ts`.** Internal modules are implementation details.
- **Boundary test:** if you can rename/delete an internal file and only the package's own code breaks, the boundary is clean.
- **Contracts are contracts.** `@bb/domain`, `@bb/server-contract`, `@bb/host-daemon-contract` define the interfaces. Implementation packages implement them. Contract packages never import from implementation packages.

### Data model stability

- **The architecture doc is settled.** Don't revisit relationships during a build step.
- **Code for the general case.** Even if v1 has one source per project, write queries that handle many.

### Testing

- **Test the public interface, not internals.**
- **Quality over quantity.** One real-scenario integration test > five mock-heavy unit tests.
- **Real DB in tests.** `createConnection(":memory:")` + `migrate(db)`, not mock repositories.
- **Assert outcomes, not call sequences.**

### Scope discipline

- **No backward-compat aliases.** When renaming a type, route, or function, use only the new name. Don't export the old name as an alias "for convenience" — it creates two names for one thing and defers cleanup that never happens.
- **No speculative API surface.** Don't declare schemas, routes, or types until the feature that uses them is being built. A contract package should contain exactly what's needed by the code that exists today.
- **Domain types are persisted records.** Types in `@bb/domain` represent the shape of data as stored in the DB or transmitted over the wire. Runtime-only view state (work status, provisioning readiness, attached environment details, built-in actions, default execution options) belongs in the consuming layer (server views, UI projections), not in the domain type.
- **Ignore downstream consumers during package rebuilds.** Changes to `packages/*` will break `apps/server`, `apps/cli`, `apps/app`. That is expected — those consumers are rebuilt in later phases. Don't add shims, re-exports, or weakened types to keep them compiling. The passing bar for a package phase is: every package under `packages/` typechecks and its own tests pass.
- **Simplest correct implementation.** Prefer module-level singletons over factory functions with injectable parameters unless testing genuinely requires it. Prefer standard library/framework patterns (e.g., `pino-roll` for log rotation) over custom implementations. Don't add configurability, error classes, or abstraction layers until a second use case demands them.

---

## Stubs and Not-Implemented Boundaries

| Feature | Where it's stubbed | What the stub does |
|---|---|---|
| **GitHub repo source** | `project_sources.type = "github_repo"` | Server rejects with 400 "not implemented" |
| **E2B provisioner** | `@bb/workspace` or server | `isAvailable()` returns false unless `BB_E2B_API_KEY` is set |
| **Ephemeral hosts** | `hosts.type = "ephemeral"` | Server rejects creating ephemeral hosts |
| **Multi-machine** | `project_sources` with different `hostId` | Only one host in v1, data model is ready |
| **Remote host open-path** | `apps/app` | Disabled state with clear message |

---

## Phase 1: Foundation

Two parallel tracks: (1a → 1b) and (1c → 1d + 1e).

### 1a. Create `@bb/config`

Typed env var configuration with `envsafe`. Scoped exports per consumer.

```
packages/config/src/
  common.ts           -- BB_DATA_DIR, BB_LOG_LEVEL, BB_SECRET_TOKEN, dev defaults
  server.ts           -- BB_SERVER_PORT, BB_DATABASE_URL, BB_E2B_API_KEY (optional)
  host-daemon.ts      -- BB_SERVER_URL
  cli.ts              -- BB_SERVER_URL
```

**Exports:** `@bb/config/common`, `@bb/config/server`, `@bb/config/host-daemon`, `@bb/config/cli`

**Validation:**
- [ ] Package typechecks
- [ ] Required vars validated on import, fail fast in production
- [ ] `BB_DATA_DIR` defaults to `~/.bb`, all paths derive from it

### 1b. Create `@bb/logger` (after 1a)

Wraps `pino` with per-component log files and built-in rotation.

**API:**
```typescript
const log = createLogger({ component: "server" });
const threadLog = log.child({ threadId: "thr_abc123" });
threadLog.info("turn started");
```

**Features:** structured JSON to files, child loggers, size-based rotation (10MB/5 files), `pino-pretty` for dev, error serialization with `.cause` chains.

**Validation:**
- [ ] Writes structured JSON to `$BB_DATA_DIR/logs/<component>.log`
- [ ] Child logger inherits parent context
- [ ] Log rotation works
- [ ] `pino-pretty` works for dev

### 1c. Update `@bb/domain`

Full list of changes in `plans/architecture.md` sections "Data Model", "Type Renames", "Route Renames".

**Key changes:**
- Remove dead types (environment descriptor/properties/capabilities, old provisioning event types)
- Add new types: `ProjectSource`, `Host`, `EnvironmentStatus`
- Update: `Project` (slim down), `Environment` (hostId/path/provisionerId model), `ThreadStatus` (5 states), `ThreadExecutionOptions` (drop dead fields)
- Type renames: `ThreadDetailRow` → `TimelineRow`, `ThreadWorkStatus` → `WorkspaceStatus`, all `UI*` → `View*`, etc.
- Consolidate provisioning events: 6 types → 1 `system/provisioning` with delta-based entries
- Remove workspace events from thread events (`system/worktree/*` → these are environment actions, not thread events)

**Validation:**
- [ ] Package typechecks
- [ ] Downstream breakage expected (server-contract, host-daemon-contract, core-ui, db)

### 1d. Rewrite `@bb/db` (after 1c)

**Clean slate.** Drop all existing migrations, fresh schema.

```
hosts, projects, project_sources, environments (with isGitRepo, branchName, provisionerState),
threads, events, queued_thread_messages,
host_daemon_sessions, host_daemon_commands (with retryCount integer default 0), host_daemon_cursors
```

**Validation:**
- [ ] `createConnection(":memory:")` + `migrate(db)` succeeds
- [ ] All FK constraints valid
- [ ] ID generation functions work

### 1e. Update `@bb/core-ui` (after 1c)

Update imports for domain renames. Update provisioning helpers for new event model.

**Validation:**
- [ ] Package typechecks
- [ ] Existing tests pass

---

## Phase 2: Contracts

**2b must complete before 2a** (server-contract imports from host-daemon-contract).

### 2b. Rewrite `@bb/host-daemon-contract` (first)

Rename from `env-daemon-contract`. Simplified session protocol. 18 commands including workspace operations (`workspace.status`, `workspace.diff`, `workspace.commit`, `workspace.squash_merge`, `workspace.reset`, `workspace.checkpoint`, `workspace.export`, `workspace.import`, `workspace.reattach`).

See `plans/architecture.md` "Host-Daemon Protocol" for full spec.

**Validation:**
- [ ] All schemas parse valid/invalid data correctly
- [ ] Hono typed client works

### 2a. Update `@bb/server-contract` (after 2b)

Route renames, type renames, new routes, WebSocket protocol changes. See `plans/architecture.md` "Route Renames" and "Type Renames".

**Validation:**
- [ ] `createPublicApiClient()` and `createInternalApiClient()` typed correctly
- [ ] All Zod schemas validate

---

## Phase 3: `@bb/workspace`

**Build and test in isolation before integrating.** Same approach as `@bb/agent-runtime`.

See `plans/environment-package.md` for the full design.

### 3a. Workspace class — core git operations

```
packages/workspace/src/
  workspace.ts        -- Workspace class (constructed with path)
  index.ts            -- barrel export
```

The `Workspace` class represents a directory on the local machine:

```typescript
class Workspace {
  readonly path: string;
  constructor(path: string);

  // Queries
  get exists(): Promise<boolean>;
  get isGitRepo(): Promise<boolean>;
  get currentBranch(): Promise<string | undefined>;
  getStatus(): Promise<WorkspaceStatus>;
  getDiff(options: DiffOptions): Promise<DiffResult>;
  getBranches(): Promise<string[]>;

  // Mutations
  commit(options: CommitOptions): Promise<CommitResult>;
  reset(): Promise<void>;
  fetch(options?: FetchOptions): Promise<void>;
  checkpoint(options: CheckpointOptions): Promise<CheckpointResult>;

  // Branch operations (primitives for promote/demote)
  checkoutBranch(branchName: string): Promise<void>;
  detachHead(): Promise<void>;
  stash(message?: string): Promise<string | null>;
  stashPop(ref?: string): Promise<void>;

  // Squash merge (uses temp worktree internally)
  squashMergeInto(options: SquashMergeOptions): Promise<SquashMergeResult>;
}
```

**Testing:** Integration tests with real git repos (temp directories). Test every operation against actual git state:
- [ ] `getStatus()` on clean repo, dirty repo, untracked files
- [ ] `getDiff()` with various merge-base branches
- [ ] `commit()` stages and commits, returns sha
- [ ] `reset()` discards all changes
- [ ] `squashMergeInto()` uses temp worktree, handles missing target branch (fetch first)
- [ ] `checkoutBranch()` / `detachHead()` / `stash()` / `stashPop()` — the promote primitives
- [ ] `checkpoint()` commits and pushes (test with a local bare remote)
- [ ] Non-git directory: `isGitRepo` returns false, git operations throw clear errors

### 3b. Provisioning functions

```
packages/workspace/src/
  provisioning.ts     -- createWorktree, createClone, runSetupScript, removeWorktree, removeDirectory
```

Standalone functions (not on the Workspace class — these create/destroy workspaces):

```typescript
createWorktree({ sourcePath, targetPath, branchName, onProgress? })
createClone({ sourcePath, targetPath, branchName, onProgress? })
runSetupScript({ workspacePath, scriptName?, timeoutMs?, onProgress? })
removeWorktree({ path, force? })
removeDirectory({ path })
```

`onProgress` callback reports `ProvisioningTranscriptEntry` deltas for streaming provisioning status to the thread timeline.

**Testing:** Integration tests with real git repos:
- [ ] `createWorktree()` creates worktree at target path with correct branch
- [ ] `createWorktree()` idempotent — returns success if path already exists and is valid
- [ ] `createWorktree()` failure rollback — if setup script fails, worktree is cleaned up
- [ ] `createClone()` clones and creates branch
- [ ] `runSetupScript()` runs script, streams output via `onProgress`, respects timeout
- [ ] `runSetupScript()` no-op if script doesn't exist
- [ ] `removeWorktree()` removes worktree, force mode for uncommitted changes
- [ ] Path conventions: `$BB_DATA_DIR/worktrees/<projectId>/<envId>/`

### 3c. Promote/demote via export/import

Promote is server-orchestrated between two daemons. The `@bb/workspace` package provides the building blocks, not the orchestration.

**Export** (called on the source workspace's host):
```typescript
// Source daemon detaches the worktree and returns changeset info
async function exportWorkspace(workspace: Workspace): Promise<WorkspaceExport> {
  const branch = await workspace.currentBranch;
  await workspace.detachHead();
  return { type: "branch", branch };
}
// For cross-machine: checkpoint first, then export with remote info
```

**Import** (called on the target/primary checkout's host):
```typescript
// Target daemon applies the changeset to the primary checkout
async function importWorkspace(primary: Workspace, exportData: WorkspaceExport): Promise<ImportResult> {
  if (await primary.getStatus().then(s => s.hasChanges)) throw new Error("primary has uncommitted changes");
  if (exportData.remote) await primary.fetch({ remote: exportData.remote, branch: exportData.branch });
  const previousBranch = await primary.currentBranch;
  await primary.checkoutBranch(exportData.branch);
  return { previousBranch };
}
```

**Testing:**
- [ ] Export detaches worktree HEAD, returns branch info
- [ ] Import fails loudly if primary has uncommitted changes
- [ ] Import switches branch when primary is clean
- [ ] Import with remote: fetches before switching
- [ ] Demote (import back to original branch) works
- [ ] Promoted state derived: check primary's current branch matches an env branch

---

## Phase 4: `apps/host-daemon`

**Build and test against a mock server or in-memory server.** The daemon is the most complex component — session management, reconnection, command routing, AgentRuntime lifecycle.

### 4a. Daemon skeleton + identity (after Phase 2)

```
apps/host-daemon/src/
  index.ts            -- entrypoint: config, logger, lock, daemon, start
  daemon.ts           -- main lifecycle
  identity.ts         -- $BB_DATA_DIR/host-id, OS hostname
```

**Validation:**
- [ ] Acquires `$BB_DATA_DIR/daemon.lock`
- [ ] Generates/reads host ID
- [ ] Gets OS computer name

### 4b. Session management (after Phase 2)

```
apps/host-daemon/src/
  session.ts          -- server connection, WS, reconnection with backoff + jitter
  command-cursor.ts   -- persist/read $BB_DATA_DIR/command-cursor (atomic write)
  event-buffer.ts     -- buffer events, post to server, track acks
```

**Validation:**
- [ ] Opens session, heartbeat works
- [ ] Reconnects with backoff + jitter
- [ ] Falls back to polling commands when WS is down
- [ ] Command cursor persisted atomically
- [ ] Events buffered, posted, acked events discarded
- [ ] Reports active provider sessions on reconnect for state reconciliation

### 4c. Command routing + AgentRuntime (after 5e — needs server internal API)

```
apps/host-daemon/src/
  command-router.ts   -- fetch commands, dispatch by environmentId
  runtime-manager.ts  -- create/get/destroy AgentRuntime per environment
```

One `AgentRuntime` per environment. Commands map directly to runtime methods:
```
thread.start    → runtime.startThread()
thread.resume   → runtime.resumeThread()
turn.run        → runtime.runTurn()
turn.steer      → runtime.steerTurn()
thread.stop     → runtime.stopThread()
thread.rename   → runtime.renameThread()
provider.list_models → runtime.listModels()
```

Workspace commands dispatch to `@bb/workspace`:
```
workspace.status     → workspace.getStatus()
workspace.diff       → workspace.getDiff()
workspace.commit     → workspace.commit()
workspace.squash_merge → workspace.squashMergeInto()
workspace.reset      → workspace.reset()
workspace.checkpoint → workspace.checkpoint()
workspace.export     → exportWorkspace(workspace)
workspace.import     → importWorkspace(primary, exportData)
workspace.reattach   → workspace.checkoutBranch(branch)
```

Environment commands dispatch to provisioning functions:
```
environment.provision → createWorktree() or createClone() + runSetupScript()
environment.destroy   → removeWorktree() or removeDirectory()
```

**Validation:**
- [ ] Commands routed to correct runtime/workspace by environmentId
- [ ] New runtime created for new environments
- [ ] Provider events flow: provider → runtime → event buffer → server
- [ ] Tool calls: provider → daemon → server → daemon → provider
- [ ] Command results reported to server
- [ ] Idempotent: replayed commands don't duplicate side effects

### 4d. Daemon restart

```
apps/host-daemon/src/
  restart.ts          -- self-relaunch: spawn new instance (detached), exit
```

**Validation:**
- [ ] Spawns new instance, exits cleanly
- [ ] Server sees reconnect (same hostId, new instanceId)
- [ ] Active threads → idle (interrupted), resume via `thread.resume`
- [ ] No commands lost (cursor on disk)

---

## Phase 5: `apps/server`

By this point, `@bb/workspace` and `apps/host-daemon` are solid and well-tested. The server is mostly plumbing: CRUD routes, command queuing, event ingestion, WS hub.

### 5a. Server skeleton

```
apps/server/src/
  index.ts, server.ts, db.ts
```

### 5b. WebSocket notification hub

```
apps/server/src/ws/
  hub.ts, client-protocol.ts, daemon-protocol.ts
```

**Validation:**
- [ ] Clients subscribe/receive notifications
- [ ] Daemon receives `commands-available`
- [ ] Clean disconnect, no leaks

### 5c. Data layer

```
apps/server/src/data/
  projects.ts, threads.ts, environments.ts, hosts.ts, events.ts, commands.ts
```

Every mutation publishes to NotificationHub automatically.

**Validation:**
- [ ] CRUD with in-memory SQLite
- [ ] Notifications reach WS clients on mutation
- [ ] Thread status transitions validated
- [ ] Managed environment cleanup rule
- [ ] Event dedup on (threadId, sequence)
- [ ] Command TTL sweep

### 5d. Public API routes (parallel with 5e)

```
apps/server/src/routes/
  projects.ts, threads.ts, environments.ts, hosts.ts, system.ts
```

### 5e. Internal API routes (parallel with 5d)

```
apps/server/src/internal/
  session.ts, commands.ts, events.ts, tool-calls.ts, reconciliation.ts
```

Auth: `Authorization: Bearer <BB_SECRET_TOKEN>`.

---

## Phase 6: Consumers

### 6a. Update `apps/app`

Import updates, route updates, new UI (host status, source management, environment creation), stubs for unimplemented features.

### 6b. Update `apps/cli`

Import and route updates.

---

## Phase 7: Integration & QA

**All tests automated.**

### 7a. End-to-end smoke test

Start server + daemon → create project → create thread with managed worktree → send message → see events → commit → archive → verify logs.

### 7b. Restart resilience

Kill server → daemon reconnects. Kill daemon → threads interrupted → resume.

### 7c. Multi-instance isolation

Two instances with different `BB_DATA_DIR` + `BB_SERVER_PORT`, concurrent smoke tests, no interference.

---

## Dependency Graph

```
Phase 1 (foundation):
  Track A: 1a (config) → 1b (logger)
  Track B: 1c (domain) → 1d (db) + 1e (core-ui)
  Parallel tracks.

Phase 2 (contracts, after Phase 1):
  2b (host-daemon-contract) → 2a (server-contract)

Phase 3 (@bb/workspace, after Phase 2):
  3a (Workspace class) → 3b (provisioning) → 3c (promote/export/import)
  Tested in isolation with real git repos.

Phase 4 (host-daemon, partially parallel with Phase 3):
  4a, 4b can start after Phase 2.
  4c needs Phase 3 (workspace) + Phase 5e (server internal API).
  4d after 4c.

Phase 5 (server, after Phase 2):
  5a → 5b → 5c → 5d + 5e (parallel)
  Can start in parallel with Phase 3.

Phase 6 (consumers, after Phase 4 + 5):
  6a, 6b parallel.

Phase 7 (integration, after Phase 6):
  7a, 7b, 7c.
```

**Critical path:** Phase 1 → Phase 2 → (Phase 3 + Phase 5 in parallel) → Phase 4c (needs both) → Phase 6 → Phase 7.

---

## Out of Scope

- E2B sandbox provisioner (stubbed — data model and interface ready)
- GitHub repo project sources (stubbed — schema and API ready)
- Multi-machine support (data model ready, only local host in v1)
- Extensions system
- Docker environments (cut)
- Async context / trace ID propagation in logger (deferred)
- HTTP request logging middleware (deferred)
