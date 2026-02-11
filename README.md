# Beanbag

Beanbag is a local-first AI coding agent workspace.

It includes:

- **Daemon (`apps/daemon`)**: Hono + WebSocket server that manages provider sessions (Codex), threads, and events
- **Web app (`apps/web`)**: React + Vite UI for projects, threads, and live conversation updates
- **CLI (`apps/cli`)**: `bb` command for daemon and thread operations
- **Core package (`packages/core`)**: shared API/event/message types and schemas
- **DB package (`packages/db`)**: SQLite + Drizzle schema, migrations, and repositories

## Prerequisites

- Node.js (current LTS recommended)
- pnpm `9.x`
- Codex CLI available on your `PATH` (daemon runs `codex app-server`)

## Quick start

```bash
pnpm install
pnpm dev
```

Then open:

- Web UI: `http://localhost:5173`
- Daemon API: `http://localhost:3333/api/v1`

> The Vite dev server proxies `/api` and `/ws` to the daemon.

## Useful commands

```bash
pnpm typecheck
pnpm test
pnpm drizzle-studio
```

## CLI examples

```bash
pnpm --filter @beanbag/cli build
node apps/cli/dist/index.js daemon status
node apps/cli/dist/index.js thread list
```

## Database

Default database path:

```text
~/.beanbag/beanbag.db
```

You can override daemon DB location with:

```bash
node apps/daemon/dist/index.js --db /path/to/beanbag.db
```
