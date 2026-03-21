# Environment-Daemon Session Protocol Cleanup

## Goal

Clean up the env-daemon session protocol:
1. Move internal routes to `/internal/*` with auth enforcement.
2. Create `@bb/env-daemon-contract` package — Zod-first contract, typed `hc()` client replaces hand-rolled HTTP client.
3. Rename `agent*` fields to `environmentDaemon*` to avoid confusion with AI agents.
4. Remove the `channelId` abstraction in favor of direct `threadId` usage.

Parts are independent and can be landed separately, but the recommended order is 1 → 2 → 3 → 4 (each builds on the prior).

---

## Part 1: Move Internal Routes to `/internal/*` with Auth

### Motivation

The env-daemon session routes are currently mounted on `/api/v1/environments/:id/env-daemon/*` — the same prefix as public API routes, with **no server-side auth validation**. The daemon sends a `Bearer` token but nothing checks it. This is a security gap: any client that can reach the server can open sessions, push events, and dispatch commands.

### What Changes

**New route prefix:**
- Move env-daemon routes from `/api/v1/environments/:id/env-daemon/*` to `/internal/environments/:id/env-daemon/*`
- Keep public API routes on `/api/v1/*`

**Add auth middleware on `/internal/*`:**
- Validate `Authorization: Bearer <token>` header against the expected daemon auth token
- Reject with 401 if missing/invalid
- The token is already configured via `EnvironmentDaemonServerConnectionConfig.authToken` on the daemon side

**Server changes:**
- `routes/index.ts`: mount env-daemon routes under a new `/internal` Hono app with auth middleware, not under `/api/v1`
- `routes/environment-daemon.ts`: no changes to route handlers themselves, just the mount point
- Add auth middleware (simple bearer token check)

**Daemon client changes:**
- `session-http-client.ts`: update URL paths from `/api/v1/environments/...` to `/internal/environments/...`
  - Or: make the base path configurable and change the default

**`@bb/api-contract` changes:**
- Remove the env-daemon route type stubs (currently typed as `unknown` anyway)

### Implementation Steps

1. Create auth middleware for `/internal/*` routes (bearer token validation).
2. Mount env-daemon routes under `/internal` in `routes/index.ts`.
3. Update daemon HTTP client paths.
4. Remove env-daemon stubs from `@bb/api-contract` schema.
5. Update tests.

---

## Part 2: Create `@bb/env-daemon-contract` Package

### Motivation

The env-daemon protocol types and Zod schemas currently live in `@bb/environment-daemon`. The hand-rolled `session-http-client.ts` (~250 lines) duplicates what Hono's `hc()` typed client provides for free. The Zod schemas are the real contract — they should live in a dedicated contract package that both server and daemon depend on.

### What Changes

**New package: `packages/env-daemon-contract`**
- Exports Zod schemas for all env-daemon session messages (moved from `@bb/environment-daemon/session-protocol.ts`)
- Exports inferred TypeScript types via `z.infer<>`
- Exports Hono route type definition (like `@bb/api-contract` does for public routes)
- Exports a typed `hc()` client factory

**Move from `@bb/environment-daemon` into `@bb/env-daemon-contract`:**
- All Zod schemas (`environmentDaemonSessionOpenPayloadSchema`, `environmentDaemonSessionClientMessageSchema`, etc.)
- All session protocol types (`EnvironmentDaemonSessionOpenPayload`, `EnvironmentDaemonSessionWelcomeMessage`, etc.)
- Command/event type definitions (`EnvironmentDaemonCommand`, `EnvironmentDaemonEvent`, etc.) + their Zod schemas

**Delete from `@bb/environment-daemon`:**
- `session-http-client.ts` (~250 lines) — replaced by `hc()` client from contract package
- `session-http-client.test.ts`
- Re-export types from `@bb/env-daemon-contract` for backward compat (or update all consumers)

**Server changes:**
- `routes/environment-daemon.ts`: import schemas from `@bb/env-daemon-contract` instead of `@bb/environment-daemon`
- Route definitions become the Hono type source for the contract

**Daemon changes:**
- `session-supervisor.ts`, `session-sync.ts`: use `hc()` client from `@bb/env-daemon-contract`
- Remove all `EnvironmentDaemonSessionHttpClient` usage

### Package Structure

```
packages/env-daemon-contract/
  src/
    index.ts           — public exports
    schemas.ts         — all Zod schemas (single source of truth)
    types.ts           — z.infer<> derived types
    routes.ts          — Hono route type definition
    client.ts          — hc() client factory
  package.json
  tsconfig.json
```

### Implementation Steps

1. Create `packages/env-daemon-contract` with package scaffolding.
2. Move Zod schemas + types from `@bb/environment-daemon` session-protocol.ts and protocol.ts.
3. Define Hono route types matching the server's env-daemon routes.
4. Create `hc()` client factory.
5. Update server routes to import from `@bb/env-daemon-contract`.
6. Replace `session-http-client.ts` usage in daemon with `hc()` client.
7. Delete `session-http-client.ts` and its tests.
8. Update all remaining imports.

---

## Part 3: Rename `agent*` → `environmentDaemon*`

### Motivation

"Agent" is heavily overloaded — it primarily refers to the AI agent (threads, turns, tool calls). In the session protocol, `agentId`/`agentInstanceId` refer to the daemon process identity.

### Renames

| Current | New |
|---|---|
| `agentId` | `environmentDaemonId` |
| `agentInstanceId` | `environmentDaemonInstanceId` |
| `agentObservedAt` | `environmentDaemonObservedAt` |
| `agent_shutdown` | `daemon_shutdown` |

### Affected Areas

**Contract schemas (now in `@bb/env-daemon-contract`):**
- `EnvironmentDaemonSessionOpenPayload`: `agentId`, `agentInstanceId` fields + Zod schema
- `EnvironmentDaemonSessionHeartbeatPayload`: `agentObservedAt` field + Zod schema
- `EnvironmentDaemonSessionCloseReason`: `"agent_shutdown"` literal

Note: the protocol is JSON over HTTP, validated with Zod. No binary encoding or schema registry — the rename is a straightforward coordinated code change.

**Database (packages/db):**
- `environmentDaemonSessions` table columns: `agent_id`, `agent_instance_id`
- Index: `environment_daemon_sessions_agent_status_idx`
- `EnvironmentDaemonSessionRecord` and `CreateEnvironmentDaemonSessionInput` interfaces
- Requires a new migration to rename columns

**Server:**
- `environment-daemon-session-manager.ts`: session creation/comparison
- `environment-daemon-session-service.ts`: close reason type
- `routes/environment-daemon.ts`: debug view mapping + close reason type

**Daemon client:**
- `session-supervisor.ts`: options + initialization, close reason
- `session-sync.ts`: open payload, heartbeat payload, close reason

**CLI:**
- `apps/cli/src/commands/thread.ts`: close reason type

**Tests (~20+ assertions across 7+ files)**

### Implementation Steps

1. Add DB migration renaming columns + index.
2. Update `packages/db` schema + repository types.
3. Update Zod schemas + types in `@bb/env-daemon-contract`.
4. Update daemon-side code (supervisor, sync).
5. Update server-side code (session-manager, session-service, routes).
6. Update CLI types.
7. Update all tests.

---

## Part 4: Remove `channelId` Abstraction

### Motivation

The `channelId` abstraction supports two channel kinds:
- **Thread channels**: `channelId` = `threadId`
- **Environment channel**: `channelId` = `"environment:<environmentId>"`

The environment channel is effectively unused:
- `environment.ready` and `environment.degraded` events route through thread channels (they carry a `threadId`).
- No commands are dispatched to the environment channel.
- DB cursors are already keyed by `threadId`.
- The channel is initialized and registered but nothing flows through it.

### What Changes

**Replace `channelId` with `threadId` in all protocol types (in `@bb/env-daemon-contract`):**

| Type | Field Change |
|---|---|
| `EnvironmentDaemonSessionChannelBootstrap` | `channelId` → `threadId` |
| `EnvironmentDaemonSessionWelcomeChannel` | `channelId` → `threadId` |
| `EnvironmentDaemonSessionHeartbeatChannel` | `channelId` → `threadId` |
| `EnvironmentDaemonSessionEventBatchChannel` | `channelId` → `threadId` |
| `EnvironmentDaemonSessionEventAckChannel` | `channelId` → `threadId` |
| `EnvironmentDaemonSessionCommandBatchItem` | `channelId` → `threadId` |
| `EnvironmentDaemonSessionCommandAckItem` | `channelId` → `threadId` |
| `EnvironmentDaemonSessionCommandResultPayload` | `channelId` → `threadId` |
| `EnvironmentDaemonSessionProviderRequestPayload` | `channelId` → `threadId` (stays optional, for cross-thread routing) |

**Delete `session-channels.ts` from `@bb/environment-daemon`:**
- `getEnvironmentDaemonEnvironmentChannelId()` — removed
- `resolveEnvironmentIdForEnvironmentDaemonChannel()` — removed

**Simplify server:**
- `listAllowedChannelIds()` → `listAllowedThreadIds()` — remove environment channel
- `resolveAttachedEnvironmentId()` — use only `threadEnvironmentAttachmentRepo`

**Simplify daemon supervisor:**
- Remove environment channel init
- Channel bootstraps only include real thread IDs

**Command dispatcher:**
- Rename `channelId` params to `threadId`
- Remove `resolveEnvironmentId` special handling for `"environment:*"` format

**No DB changes needed** — cursors and commands already use `threadId`.

### Implementation Steps

1. Delete `session-channels.ts`, remove all imports (4 files).
2. Rename `channelId` → `threadId` in contract schemas + types.
3. Update `session-supervisor.ts`: remove environment channel init.
4. Update `session-sync.ts`: rename all references.
5. Update `environment-daemon-session-service.ts`: simplify allowed-thread logic.
6. Update `environment-daemon-command-dispatcher.ts`: rename params, simplify resolver.
7. Update `environment-daemon-event-applier.ts`: rename field.
8. Update `server.ts`: simplify `resolveAttachedEnvironmentId`.
9. Update all tests (~50-60 assertions across 10 test files).

---

## Validation

- `pnpm exec turbo run typecheck --filter=@bb/env-daemon-contract --filter=@bb/environment-daemon --filter=@bb/server --filter=@bb/db`
- Run env-daemon test suites: `pnpm --filter @bb/environment-daemon test`, `pnpm --filter @bb/server test`
- QA pass per `qa/env-daemon/` surface docs

## Open Questions / Risks

- **Auth token source**: `BB_ENV_DAEMON_AUTH_TOKEN` is already read from `.env` in `orchestrator.ts:4478` and sent as `Authorization: Bearer` to the daemon. The `/internal/*` middleware just needs to validate inbound requests against the same env var. Shared secret, both directions.
- **Part 2 — backward compat**: Should `@bb/environment-daemon` re-export types from `@bb/env-daemon-contract`, or should all consumers be updated? Re-exporting is less churn but adds indirection.
- **Part 4 — session open with no threads**: After removing the environment channel, sessions open with `channels: []`. Need to verify this path works (threads get added dynamically when they attach).
- **Part 4 — shared-environment provider requests**: The optional `threadId` override on `provider_request` is real functionality. Renaming is fine; routing logic must be preserved.
