# Architecture

## Overview

bb is a local-first coding-agent workspace built as a pnpm/Turbo monorepo.
The server is the durable coordinator: it owns the HTTP and WebSocket surface,
persists state in SQLite, manages environments, and coordinates provider work
through per-thread environment-daemons.

At a high level:

1. The app and CLI talk to the server.
2. The server persists projects, threads, events, attachments, environments,
   and environment-daemon session state through `@bb/db`.
3. Each thread runs in an environment such as `local`, `worktree`, or `docker`.
4. Managed environments start a per-thread environment-daemon alongside the
   provider runtime.
5. The environment-daemon and server communicate through a leased session
   protocol with heartbeats, event batches, command delivery, and command
   results.
6. The server applies durable state changes, then emits targeted invalidations
   to the UI.

## Main packages

### `apps/app`

React 19 + Vite frontend.

- Reads and mutates state through the server HTTP API only.
- Uses React Query plus a small invalidation-oriented WebSocket layer.
- Renders threads through shared projection helpers from `@bb/core` and shared
  primitives from `@bb/ui-core`.

### `apps/cli`

The `bb` CLI.

- Uses the same server-backed model as the app.
- Supports project, thread, queue, archive, and git-oriented operations.
- Can run inside agent shells with `BB_PROJECT_ID`, `BB_THREAD_ID`,
  `BB_ENVIRONMENT_ID`, and `BB_SERVER_URL` injected.

### `apps/server`

The system coordinator.

- Owns the route surface under `apps/server/src/routes/**`.
- Orchestrates thread lifecycle, environment lifecycle, manager threads,
  provider interaction, and restart/shutdown policy.
- Applies environment-daemon events, persists durable state, and emits
  WebSocket invalidations.

### `packages/core`

Shared contracts and projection helpers.

- Domain types for projects, threads, events, and API payloads.
- Shared schemas and decoders.
- Event normalization and UI projection helpers.
- The main type boundary shared by app, server, CLI, environments, and
  provider adapters.

### `packages/db`

SQLite persistence layer built on Drizzle.

- Schema definitions live in `packages/db/src/schema.ts`.
- Repository invariants live in `packages/db/src/repositories.ts` and
  `packages/db/src/environment-daemon-repositories.ts`.

### `packages/environment`

Environment implementations that decide where thread work runs.

- Built-in environment kinds are `local`, `worktree`, and `docker`.
- Environments prepare or restore workspaces, start the environment-daemon,
  and expose workspace/git inspection used by the server.

### `packages/environment-daemon`

The per-thread environment-daemon runtime.

- Manages provider runtime interaction.
- Speaks the server-hosted session protocol.
- Exposes a small local control surface for status and session sync.
- Builds the bundled `environment-daemon.bundle.mjs` artifact used by managed
  environments.

### `packages/provider-adapters`

Built-in provider integration layer.

- Registry and adapter selection.
- Shared provider launch metadata and helper logic.
- Current built-in providers are `codex`, `claude-code`, and `pi`.

### `packages/ui-core`

Shared UI primitives used by the app.

### Supporting packages

- `packages/templates`: checked-in instruction and prompt templates.
- `packages/provider-adapters/src/bridges/claude-code`: Claude Code bridge runtime.
- `packages/provider-adapters/src/bridges/pi`: PI bridge runtime.
- `packages/tsconfig`: shared TypeScript config.

## Thread model

Persisted thread statuses are:

- `created`
- `provisioning`
- `provisioned`
- `provisioning_failed`
- `idle`
- `active`
- `error`

Transition rules are centralized in
`apps/server/src/thread-status-machine.ts`.

Thread types are:

- `standard`
- `manager`

Manager threads are project-scoped coordinators. They maintain a BB-managed
workspace for plans, notes, and user-facing deliverables, and they expose a
different UI/tool surface than standard coding threads.

## Where to look for truth

This doc is intentionally high level. For concrete inventories, use the code:

- HTTP routes: `apps/server/src/routes/**`
- Request/response types: `packages/core/src/api-types.ts`
- Zod request schemas: `packages/core/src/schemas.ts`
- Thread and event types: `packages/core/src/types.ts`
- Event normalization: `packages/core/src/thread-event-normalization.ts`
- DB schema and repository invariants: `packages/db/src/**`
- Environment-daemon protocol: `packages/environment-daemon/src/session-protocol.ts`

When this file and code disagree, the code wins.
