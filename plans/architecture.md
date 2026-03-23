# bb Architecture

Reference document for the bb system architecture, data model, and feature set.

---

## System Overview

```
App/CLI  <--HTTP-->  Server (cloud)  <--HTTP-->  Host-daemon (per machine)
         <--WS(notifications)-->     <--WS(notifications)-->
                                                    |
                                              Provider processes (via agent-runtime, one per thread)
```

| Component | Where | Lifecycle | Role |
|---|---|---|---|
| **Server** | Cloud (or local for dev) | Always on, stateless (DB is the state) | HTTP API, DB, WebSocket hub, routes commands to hosts |
| **Host-daemon** | On each machine | Long-lived, started by CLI/app or as a service | Registers host, provisions environments, runs provider processes, does git operations, relays events to server |
| **App / CLI** | User's machine | Ephemeral | Pure clients, talk only to server |

The host-daemon manages everything on the machine: one `AgentRuntime` instance per environment (from `@bb/agent-runtime`), provider processes (one per active thread), git workspace operations, and environment provisioning. No separate env worker processes.

All connections use the same pattern: **HTTP for data, WebSocket for notifications only.** WS never carries payloads — just change hints so clients know to refetch. WS notifications are fired automatically by the server's data mutation layer, not by route handlers.

---

## Data Model

### Projects

A project knows what the code is and where it can be found.

```
projects:       id, name, createdAt, updatedAt
project_sources: id, projectId, type, hostId, path, repoUrl, timestamps
```

Source types: `local_path` (v1), `github_repo` (future). In v1, a project has exactly one source. All code paths needing "the project root" resolve this single source. Multi-source support adds a `primary` flag later.

### Hosts

A host is a machine that can run environments.

```
hosts: id, name, type, provider, externalId, lastSeenAt, timestamps
```

- `id` is stable, generated once per machine, persisted at `$BB_DATA_DIR/host-id`
- `name` is auto-populated from the OS (e.g., `scutil --get ComputerName` on macOS), user can rename
- `type`: `persistent` (user's machine) or `ephemeral` (cloud sandbox like E2B)
- Auto-registered when a host-daemon connects to the server

### Threads

Threads are where work gets done.

```
threads: id, projectId, environmentId, providerId, type, title, status,
         mergeBaseBranch, parentThreadId, archivedAt, lastReadAt, timestamps
```

**Types:** `standard` (regular work) and `manager` (delegation-oriented, durable workspace, special rendering — users only see messages sent via a special tool).

**Ownership:** Threads are managed by the user (unparented) or by another thread (`parentThreadId`). This is a handoff primitive — user → manager or manager → user. When a managed thread reaches a terminal state (idle, error), its manager is notified.

**Statuses:** `created → provisioning → idle ↔ active → error`. Provisioning failures set status to `error` with a distinguishing error code.

**Features:**
- Archive/unarchive — inbox model. Unarchived = active work. Archived = done.
- Read/unread (`lastReadAt`) — for user-managed threads. Manager threads track read state based on new user messages or errors only.
- Queued messages — queue-then-send two-step for preparing messages before sending.
- Tell modes — `auto`, `start`, `steer`.

**Execution options:** model, serviceTier, reasoningLevel, sandboxMode. sandboxMode controls the Codex adapter's sandbox policy (read-only / workspace-write / danger-full-access), defaults to `danger-full-access`.

### Environments

An environment is where a thread runs — a filesystem path on a specific host.

```
environments: id, projectId, hostId, path, managed, isGitRepo, provisionerId, provisionerState, status, timestamps
```

**Environment statuses:** `provisioning → ready → error | destroying`

Multiple threads can share one environment. Managed environments (created by the system) are cleaned up only when zero non-archived threads reference them. Unmanaged environments (user-provided paths) are never cleaned up by the system.

**Creation strategies:**

| Strategy | What happens | Managed? | Handled by |
|---|---|---|---|
| **Existing path** | Point at any path on a host. No provisioning. | No | **Server** — creates env record directly with `status: ready` |
| **Managed worktree** | System creates worktree + branch, runs setup script. | Yes | **Host-daemon** — via `environment.provision` command |
| **E2B sandbox** | Creates ephemeral cloud sandbox, clones repo, starts host-daemon inside. | Yes | **Server** — calls E2B API directly (stubbed in v1) |

Provisioners run where they need access: managed worktree needs the host filesystem (runs on daemon), E2B needs an API key (runs on server), existing path needs nothing (server creates the DB record). The `environment.provision` command is only for daemon-side provisioners.

**Actions (environment-scoped, extensible later):** commit, squash merge, promote to primary checkout (server-orchestrated via workspace export/import, not a single daemon command). Future: run workflow, open PR.

**Thread actions (thread-scoped):** archive/unarchive, follow-up/stop, assign/unassign to another thread.

---

## Host-Daemon Protocol

### Session lifecycle

1. Daemon starts, reads `$BB_DATA_DIR/host-id` (creates if missing)
2. Opens session: `POST /internal/session/open` with hostId, instanceId (ephemeral, per-process), hostName, hostType, protocolVersion
3. Server returns sessionId, heartbeatIntervalMs, leaseTimeoutMs
4. Daemon maintains WS connection for notifications and sends periodic heartbeats
5. If existing session for same hostId, server closes old WS with `{ type: "session-close", reason: "replaced" }`

Auth: `BB_SECRET_TOKEN` env var, sent as `Authorization: Bearer` on HTTP and as query param on WS.

**Session replacement:** When a new session opens for the same hostId, the server invalidates the old session ID. All HTTP requests from the old session are rejected (401). The old WS gets `{ type: "session-close", reason: "replaced" }`. This prevents overlapping daemon instances from both fetching commands or posting events.

### Commands (server → daemon)

Server queues commands in DB, sends `{ type: "commands-available" }` over WS. Daemon fetches via `GET /internal/session/commands?afterCursor={N}`. Reports results via `POST /internal/session/command-result`.

**Delivery semantics: at-least-once.** Daemon persists cursor to disk after reporting command results, not after fetching. This ensures at-least-once delivery — if the daemon crashes after fetch but before reporting, it re-fetches the same commands on restart. All commands must be idempotent:
- `thread.start` — checks if a provider process already exists for this thread before spawning
- `environment.provision` — checks if the target path already exists before creating
- `environment.destroy` — no-op if path doesn't exist
- All others are naturally idempotent (sending input, querying status)

18 command types:
```
// Thread/provider
thread.start, thread.resume, turn.run, turn.steer, thread.stop, thread.rename,
provider.list_models

// Environment lifecycle
environment.provision, environment.destroy

// Workspace (git repos only)
workspace.status, workspace.diff, workspace.commit, workspace.squash_merge,
workspace.export, workspace.import, workspace.reattach, workspace.reset, workspace.checkpoint
```

Each command batch item includes `environmentId` (nullable for `provider.list_models`) so the daemon can route to the correct `AgentRuntime` instance.

**Provisioning timeout:** `environment.provision` has a configurable timeout (default: 5 minutes, much longer than the generic 60s command TTL) because large repo checkouts and setup scripts can be slow. Other commands use the standard 60s TTL.

### Events (daemon → server)

Daemon posts batches via `POST /internal/session/events`. Each event carries `environmentId`, `threadId`, `sequence`. Server acks with per-thread high-water marks.

**Event flow:** Provider processes emit events via stdout → agent-runtime translates them → daemon buffers and posts to server via HTTP. Server acks with per-thread high-water marks. Daemon discards acked events from its buffer. Server deduplicates by `(threadId, sequence)` for safety on retries.

### Tool calls

Synchronous: daemon posts `POST /internal/session/tool-call`, blocks on HTTP response. No retries — tool calls may have side effects.

**Timeout chain:**
- Provider → daemon: provider has its own tool call timeout (provider-specific, typically 30-60s)
- Daemon → server: HTTP with 120s timeout. If exceeded, daemon returns `ok: false` to provider.
- Server processing: should complete well within 120s for any tool call.

**Failure modes:**
- Server restarts mid-call → daemon gets connection error → returns `ok: false` to provider → provider handles failure
- Daemon crashes mid-call → provider process dies (child of daemon) → turn interrupted

### WS notifications

**Server → Daemon:** `commands-available`, `session-close` (with reason)
**Daemon → Server:** `heartbeat` (with bufferDepth, lastCommandCursor)

### Reconnection

Daemon-driven, server never nudges. On WS drop:
1. Buffer events, retry HTTP with exponential backoff + jitter
2. Reconnect WS with backoff + jitter
3. If WS down >5s, fall back to polling commands every ~10s
4. On WS reconnect, fetch from last cursor, stop polling

### Resilience invariants

- **Event ingestion is idempotent** on `(threadId, sequence)`. Server silently accepts already-seen events.
- **Command cursor persisted to disk.** Daemon writes to `$BB_DATA_DIR/command-cursor` after reporting command results (atomic write: write to temp, rename). On restart, reads from disk and re-fetches from that cursor.
- **Command TTL.** Server tracks commands that were fetched but never got a `command-result`. Standard commands: 60s timeout. `environment.provision`: 5 minute timeout. Abandoned commands re-queue once, then error the thread.
- **Protocol version mismatch** → 400 rejection with supported versions.
- **File locking.** Daemon acquires an exclusive lock on `$BB_DATA_DIR/daemon.lock` at startup. If lock is held, another daemon instance is running — the new instance waits or exits.

### State reconciliation on reconnect

When the daemon reconnects after a network partition or restart, the server and daemon may have diverged. Reconciliation happens during session open:

1. **Daemon reports active provider sessions** as part of session open: `{ activeThreads: [{ environmentId, threadId, providerThreadId }] }`
2. **Server compares** against its DB state:
   - Thread in `error` (due to lease timeout) but daemon reports it active → server transitions thread back to `active`
   - Thread in `active` but daemon has no session for it → server transitions thread to `idle` and re-queues `thread.resume`
   - Environment in `provisioning` but daemon reports no provisioning in progress → server marks environment as `error`, thread as `error`
3. **Server responds** with any commands the daemon should have (re-queued abandoned commands)

This ensures that after any failure, a single reconnect brings the system back to a consistent state.

### Environment provisioning handshake

1. Client calls `POST /threads` with creation args (provisioner, host, optional path)
2. Server creates environment record (status: provisioning) and thread
3. Server queues `environment.provision` command
4. Daemon runs provisioner, reports result
5. Server updates environment (sets path, status → ready) or errors the thread
6. If thread has pending input, server queues `thread.start`

For existing environments: skip provisioning, just queue `thread.start`.

**Provisioning failure cleanup:**
- If provisioner fails (e.g., setup script errors), the provisioner's `provision()` method is responsible for rolling back partial state (deleting the worktree it created). The provisioner owns its own cleanup on failure.
- If daemon crashes mid-provisioning, the command TTL expires and the server marks the thread as `error`. The partially-created worktree is cleaned up when the environment record is eventually deleted (triggers `environment.destroy`, which the provisioner handles idempotently).
- `environment.provision` is idempotent — provisioner checks if the target path already exists. If it does and is valid, it reports success. If it exists but is invalid (partial state), it cleans up and re-provisions.

---

## Host-Daemon Lifecycle

### What the daemon manages

The host-daemon is a single process that manages everything on the machine:

```
Host-daemon
  ├── AgentRuntime for Environment A (workspacePath: /path/to/env-a)
  │     ├── Provider process for Thread 1 (child process, stdio)
  │     └── Provider process for Thread 2 (child process, stdio)
  ├── AgentRuntime for Environment B (workspacePath: /path/to/env-b)
  │     └── Provider process for Thread 3 (child process, stdio)
  ├── Workspace class (git status, diff, commit, merge, export/import — per-environment instance)
  └── Provisioners (create/destroy managed environments)
```

One `AgentRuntime` instance per environment (since `workspacePath` is per-environment). Multiple threads on the same environment share one runtime. Provider processes are child processes of the daemon, communicating over stdio.

### Restart (dev code reloading)

**Provider processes are children of the daemon — they die on restart.** This is the accepted tradeoff for architectural simplicity.

**State on disk:** `$BB_DATA_DIR/command-cursor`

**Restart flow:**
1. Daemon spawns a new instance of itself (detached)
2. Old process exits — all provider processes die
3. New daemon reads `command-cursor` from disk, reconnects WS to server
4. Server detects reconnect, runs state reconciliation
5. Server transitions active threads to `idle` (interrupted, not errored)
6. Server re-queues `thread.resume` commands for threads that need provider sessions re-established
7. Daemon spawns new provider processes, sessions resume

**Impact on active threads:** turns in progress are interrupted. The thread goes to `idle`, not `error`. The user can send another message to start a new turn. Events from the interrupted turn that were already posted to the server are preserved. Events that were buffered in the daemon but not yet posted are lost (small window).

**Impact on idle threads:** seamless. `thread.resume` re-establishes the provider session. User doesn't notice.

**Future improvement:** a socket shim process between daemon and provider could make provider processes survive daemon restarts. Deferred — not needed for v1.

### Failure detection

Server detects daemon death via WS drop + lease timeout (no heartbeat). Marks host disconnected, threads on that host transition to `error`.

**Host statuses:**
```
Host statuses:
  connected — daemon has active session, heartbeat is current
  disconnected — WS dropped + lease timeout exceeded (any host)
  suspended — cloud host intentionally paused to save cost (server-initiated)

Transitions:
  connected → disconnected (heartbeat timeout — unintentional, e.g., crash, laptop sleep)
  connected → suspended (server suspends cloud host on idle)
  disconnected → connected (daemon reconnects)
  suspended → connected (server resumes cloud host on command)
```

---

## Configuration

**Package: `@bb/config`** — uses `envsafe` with scoped exports per consumer.

| Scope | Import | Key vars |
|---|---|---|
| Common | `@bb/config/common` | `BB_DATA_DIR`, `BB_LOG_LEVEL`, `BB_SECRET_TOKEN` |
| Server | `@bb/config/server` | `BB_SERVER_PORT`, `BB_DATABASE_URL`, `BB_E2B_API_KEY` (optional), `BB_E2B_TEMPLATE` (optional) |
| Host-daemon | `@bb/config/host-daemon` | `BB_SERVER_URL` |
| CLI | `@bb/config/cli` | `BB_SERVER_URL` |

`BB_DATA_DIR` is used by both server and host-daemon. Server: `bb.db`, `logs/server.log`. Host-daemon: `host-id`, `command-cursor`, `daemon.lock`, `logs/host-daemon.log`.

Config sources: env vars and `.env` files. `~/.bb/config.json` deferred (easy to add — just merge into `process.env` before envsafe runs). No per-project settings in DB.

---

## Logger

**Package: `@bb/logger`** — wraps `pino` with per-component log files and built-in rotation. Replaces the old custom rotating JSON line writer (deleted in clean-slate). Less code, better features.

```
$BB_DATA_DIR/logs/
  server.log, host-daemon.log
```

**API:**
```typescript
import { createLogger } from "@bb/logger";

// Root logger — writes to file + optionally stdout
const log = createLogger({ component: "server" });

// Child logger — inherits file destination, adds context fields
const threadLog = log.child({ threadId: "thr_abc123" });
threadLog.info("turn started");  // includes { component: "server", threadId: "thr_abc123" }
```

**Features:**
- Structured JSON to files (one JSON object per line, greppable)
- `pino-pretty` for dev terminal output (controlled by `BB_LOG_FORMAT=json|pretty`)
- Size-based rotation via `pino-roll` (configurable max size + file count, defaults: 10MB / 5 files)
- Child loggers with inherited context (threadId, environmentId, hostId, etc.)
- Standard log levels: `trace`, `debug`, `info`, `warn`, `error`, `fatal`
- Error serialization with stack traces (pino handles this natively, including `.cause` chains)

**What it does NOT have** (not needed for v1):
- Async context propagation / trace IDs (was in an unmerged branch, never shipped)
- HTTP request logging middleware (add later if needed)
- Console interception (the old system hijacked console.log — fragile, unnecessary with pino)
- Performance monitoring hooks (add later if needed)

**Dependencies:** `pino`, `pino-roll`, `pino-pretty` (dev). Minimal surface.

---

## Instance Isolation

All state lives under `BB_DATA_DIR` (default: `~/.bb`). Concurrent isolated instances via different `BB_DATA_DIR` + `BB_SERVER_PORT`:

```bash
BB_DATA_DIR=/tmp/bb-test-1 BB_SERVER_PORT=3001 bb start
BB_DATA_DIR=/tmp/bb-test-2 BB_SERVER_PORT=3002 bb start
```

Each gets its own DB, logs, host identity. Tests use temp dirs + in-memory SQLite.

---

## Real-time / WebSocket (App/CLI)

Subscribe/unsubscribe per entity, server pushes change-kind arrays. Notification-only — client refetches via HTTP.

| Entity | Change kinds |
|---|---|
| **Thread** (by ID) | thread-created, thread-deleted, events-appended, status-changed, title-changed, queue-changed, work-status-changed, archived-changed, read-state-changed |
| **System** (global) | host-connected, host-disconnected, environment-created, environment-deleted |
| **Project** (by ID) | sources-changed, threads-changed |

---

## System / Operational

**Client-side (app/CLI handles directly):** pick-folder (native dialog), open-path (open in editor). Disabled with clear error states for threads on remote hosts.

**Host status in UI:** connection status (connected/disconnected/reconnecting), manual restart button.

**Server-side:** health report, shutdown with blocking thread detection, voice transcription, file attachment upload.

---

## Providers

Three built-in: codex, claude-code, pi. Process-based via `@bb/agent-runtime` (mostly done, left as-is). Extensions system deferred. Capabilities: `supportsRename`, `supportsServiceTier`.

---

## Package Map

| Package | Purpose | Dependencies |
|---|---|---|
| `@bb/domain` | Entity types, event types, Zod schemas | zod |
| `@bb/config` | Typed env var config, scoped exports | envsafe |
| `@bb/logger` | Structured logging, rotation, per-component files | pino, pino-roll, @bb/config |
| `@bb/db` | Schema, migrations, connection, IDs | @bb/domain, drizzle, better-sqlite3 |
| `@bb/server-contract` | Public + internal API routes, WS protocol, error types, hc() clients | @bb/domain, zod, hono |
| `@bb/host-daemon-contract` | Commands, events, session protocol, hc() client | @bb/domain, zod, hono |
| `@bb/agent-runtime` | Provider adapters, registry, runtime | @bb/domain, @bb/templates |
| `@bb/templates` | Prompt templates | gray-matter, handlebars |
| `@bb/core-ui` | View transforms (toUIMessages, formatTimeline, detail rows) | @bb/domain, @bb/templates |
| `@bb/workspace` | Provisioning (worktree, clone), git operations (status, diff, commit, merge, promote), setup scripts | @bb/domain |
| `@bb/ui-core` | Shared React components | react |
| `@bb/tsconfig` | Shared TS config | — |
| `apps/server` | Server implementation | @bb/domain, @bb/config, @bb/logger, @bb/db, @bb/server-contract, @bb/host-daemon-contract |
| `apps/host-daemon` | Host-daemon implementation | @bb/domain, @bb/config, @bb/logger, @bb/host-daemon-contract, @bb/agent-runtime, @bb/workspace |
| `apps/app` | Electron/web app | @bb/domain, @bb/core-ui, @bb/ui-core, @bb/server-contract |
| `apps/cli` | CLI | @bb/domain, @bb/core-ui, @bb/server-contract |

---

## Route Renames

Taking this opportunity to clean up route naming for clarity and consistency.

### Routes to remove
- `/system/pick-folder` — client-side now
- `/system/open-path` — client-side now
- `/threads/:id/open-path` — client-side now
- `/system/restart-policy` — dropped
- `/system/environments` — replaced by hosts + provisioners
- `/system/provider` (singular) — redundant with `/system/providers`
- `/environments/:id/env-daemon/sessions` — replaced by host-scoped sessions

### Routes to rename

| Current | New | Why |
|---|---|---|
| `/threads/:id/tell` | `/threads/:id/send` | "tell" is jargon, "send" is universal |
| `/threads/:id/queue` | `/threads/:id/drafts` | "queue" sounds like a job system, "drafts" matches the UX |
| `/threads/:id/queue/:queuedMessageId/send` | `/threads/:id/drafts/:draftId/send` | follows from above |
| `/threads/:id/queue/:queuedMessageId` | `/threads/:id/drafts/:draftId` | follows from above |
| `/projects/:id/workspace-status` | `/projects/:id/work-status` | consistency with thread work-status |
| `/projects/:id/manager` | `/projects/:id/managers` | plural, POST to collection |
| `/threads/:id/tool-group-messages` | `/threads/:id/timeline/tool-details` | sub-resource of timeline |
| `/threads/:id/git-diff` | `/threads/:id/diff` | shorter, clear enough |
| `/threads/:id/merge-base-branches` | `/threads/:id/diff/branches` | sub-resource of diff |
| `/threads/:id/primary-status` | `/environments/:id/primary-status` | environment concern, not thread |
| `/environments/:id/operations` | `/environments/:id/actions` | matches "environment actions" terminology |

---

## Type Renames

### Domain types

**Timeline/view types (rename from "Detail" to "Timeline"):**

| Current | New |
|---|---|
| `ThreadDetailRow` | `TimelineRow` |
| `ThreadDetailToolGroupRow` | `TimelineToolGroupRow` |
| `ThreadDetailToolGroupStatus` | `TimelineToolGroupStatus` |
| `ThreadDetailMessageRow` | `TimelineMessageRow` |

**Workspace types (rename from "Work" to "Workspace"):**

| Current | New |
|---|---|
| `ThreadWorkStatus` | `WorkspaceStatus` |
| `ThreadWorkState` | `WorkspaceState` |
| `ThreadWorkFileChange` | `WorkspaceFileChange` |

**Event data types (clarify what they represent):**

| Current | New |
|---|---|
| `ClientOutboundStartEventData` | `TurnRequestEventData` |
| `ClientExecutionOptionsSnapshot` | `TurnRequestOptions` |
| `AppThreadEventType` | `SystemEventType` |

**Provider event types (drop redundant "Thread"):**

| Current | New |
|---|---|
| `ProviderThreadEvent` | `ProviderEvent` |
| `SystemThreadEvent` | `SystemEvent` |

Keep `ThreadEvent` as-is (union type — "event on a thread" is correct). Keep all `ThreadEvent*` sub-types (e.g., `ThreadEventItem`, `ThreadEventFileChange`, `ThreadEventTokenUsage`) — the `Thread` prefix is meaningful to distinguish from future `EnvironmentEvent*` types.

**UI types (rename prefix from "UI" to "View"):**

| Current | New |
|---|---|
| `UIMessage` | `ViewMessage` |
| `UIUserMessage` | `ViewUserMessage` |
| `UIAssistantTextMessage` | `ViewAssistantTextMessage` |
| `UIAssistantReasoningMessage` | `ViewAssistantReasoningMessage` |
| `UIToolCallMessage` | `ViewToolCallMessage` |
| `UIToolExploringMessage` | `ViewToolExploringMessage` |
| `UIToolCallSummary` | `ViewToolCallSummary` |
| `UIToolParsedIntent` | `ViewToolParsedIntent` |
| `UIWebSearchMessage` | `ViewWebSearchMessage` |
| `UIFileEditMessage` | `ViewFileEditMessage` |
| `UIFileEditChange` | `ViewFileEditChange` |
| `UIOperationMessage` | `ViewOperationMessage` |
| `UIErrorMessage` | `ViewErrorMessage` |
| `UIDebugRawEventMessage` | `ViewDebugRawEventMessage` |
| `UIMessageBase` | `ViewMessageBase` |
| `UIMessageStatus` | `ViewMessageStatus` |
| `UIProvisioningMetadata` | `ViewProvisioningMetadata` |
| `ToUIMessagesOptions` | `ToViewMessagesOptions` |

### Server-contract types

| Current | New | Why |
|---|---|---|
| `SpawnThreadRequest` | `CreateThreadRequest` | matches REST (`POST /threads`) |
| `TellThreadRequest` | `SendMessageRequest` | matches route rename |
| `TellThreadMode` | `SendMessageMode` | follows |
| `EnqueueThreadMessageRequest` | `CreateDraftRequest` | matches route rename |
| `SendQueuedThreadMessageRequest` | `SendDraftRequest` | follows |
| `SendQueuedThreadMessageResponse` | `SendDraftResponse` | follows |
| `ThreadToolGroupMessagesRequest` | `TimelineToolDetailsRequest` | matches route rename |
| `ThreadToolGroupMessagesResponse` | `TimelineToolDetailsResponse` | follows |
| `EnvironmentOperationRequest` | `EnvironmentActionRequest` | matches terminology |
| `EnvironmentOperationType` | `EnvironmentActionType` | follows |
| `EnvironmentOperationResponse` | `EnvironmentActionResponse` | follows |
| `EnvironmentOperationApiError` | `EnvironmentActionApiError` | follows |
| `EnvironmentOperationFailureDetails` | `EnvironmentActionFailureDetails` | follows |
| `SystemHealthEnvironmentDaemon*` | `SystemHealthDaemon*` | shorter, daemon is always host-daemon now |
| All `SystemRestart*` / `SystemRestartPolicy` types | remove | restart policy dropped |
| `ThreadOperationRequest` / `ThreadOperationType` | remove | now environment actions |

### Host-daemon-contract types

Full rewrite — strip `environmentDaemon*` prefix entirely. Types become `Command`, `CommandType`, `Event`, `EventEnvelope`, etc. scoped under `@bb/host-daemon-contract`.

---

## Out of scope (v1)

- GitHub repo project sources
- Multi-machine (data model ready, only local host in v1)
- Docker environments
- Extensions system
- Per-project DB settings
