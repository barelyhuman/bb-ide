# Beanbag

Beanbag is a local-first coding-agent workspace. A local daemon runs
`codex app-server`, persists threads/events in SQLite, and serves both a web UI
and a CLI.

## Monorepo Layout

```text
apps/
  daemon/   Hono REST + WebSocket server, provider runtime orchestration
  web/      React + Vite frontend
  cli/      bb CLI for daemon/thread operations
packages/
  core/     Shared types/schemas + event -> UI message projection
  db/       Drizzle schema, migrations, repositories (SQLite)
```

## Quick Start

```bash
pnpm install
pnpm dev
```

Endpoints:

- Web UI: `http://localhost:5173`
- API base: `http://localhost:3333/api/v1`
- WebSocket: `ws://localhost:3333/ws`

`apps/web` dev server proxies `/api` and `/ws` to daemon `:3333`.

## CLI and Daemon Run Modes

Development (source + watch):

```bash
pnpm install
pnpm dev

# run CLI from source in dev
pnpm bb:dev --help
pnpm bb:dev daemon status
```

Production (built `dist`):

```bash
pnpm build

# run built daemon and built CLI
pnpm daemon --help
pnpm bb --help
pnpm bb daemon start
```

Notes:

- `dist/` output is generated for `@beanbag/core`, `@beanbag/db`, `@beanbag/daemon`, and `@beanbag/cli`.
- `bb daemon start` prefers `apps/daemon/dist/index.js` when available; if not built, it falls back to `apps/daemon/src/index.ts` via `tsx` for local development.
- `pnpm dev` starts the daemon on `:3333`; stop any already-running background daemon first (`pnpm bb daemon stop`) to avoid `EADDRINUSE`.

## Build, Typecheck, Test

Workspace:

```bash
pnpm build
pnpm typecheck
pnpm test
```

UI consistency checklist for frontend changes:

- Reuse shared primitives (`PageShell`, `DetailCard`/`DetailRow`, `CollapsibleHeader`, status pills).
- Keep the canonical message rendering path (`ConversationEntry` + `ConversationWorkingIndicator`).
- Use `ui-text-*` typography utilities instead of arbitrary `text-[Npx]` classes.
- Keep light/dark typography tokens aligned unless a divergence is intentionally documented.

## Union Handling

When working with string domains:

- `closed_internal`: Beanbag-owned values. Use exhaustive `switch` handling and `assertNever`.
- `open_external`: provider/runtime-owned values. Keep tolerant fallback branches with a comment that unknown values are intentional.

`assertNever` is exported from `@beanbag/core`.

## Thread Lifecycle

Persisted status model:

`created -> provisioning -> idle|active|provisioning_failed`

Transition rules are centralized in
`apps/daemon/src/thread-status-machine.ts` (XState-based).

- `spawn`: creates a DB thread, then provisions async.
- `tell`: sends `turn/start` or `turn/steer` (`mode=auto|start|steer`).
- `archive`: stops process/runtime and sets `archivedAt`.
- daemon boot: reconciles persisted active/provisioning threads.

## CLI Context Env

Thread execution context is exposed to agent shells as:

- `BB_PROJECT_ID`
- `BB_TASK_ID` (task-linked threads)
- `BB_THREAD_ID`

`bb` is also kept on `PATH` for agent shell commands.

CLI commands that need project context accept `--project`, or fall back to
`BB_PROJECT_ID` when the flag is omitted.

## Typed Codex Event Schema

`packages/core` derives thread event types from generated Codex app-server
TypeScript schemas in:

- `packages/core/src/generated/codex-app-server/schema/`
- `packages/core/src/generated/codex-app-server/index.ts`

Regenerate:

```bash
pnpm --filter @beanbag/core gen:codex-event-types
```

## Database and Local State

Default daemon DB:

```text
~/.beanbag/beanbag.db
```

CLI daemon PID file:

```text
~/.beanbag/daemon.pid
```

Drizzle Studio:

```bash
pnpm drizzle-studio
```

`packages/db/drizzle.config.ts` uses `BEANBAG_DB_PATH` when set; otherwise
`~/.beanbag/beanbag.db`.
