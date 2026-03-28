# Scheduled Tasks & Automations

Post-rebuild feature plan for recurring/scheduled work in BB. This plan captures research and design decisions from an investigation of [Middleman](https://github.com/SawyerHood/middleman) and [Terragon](https://github.com/terragon-labs/terragon-oss) scheduling systems, and how they map to BB's architecture.

**Prerequisite:** Rebuild phases 5–9 complete. Server, host-daemon, and sandbox-host all operational.

---

## Two Use Cases, One Backend

### Use case 1: Manager nudges (ASYNC.md-driven)

The manager agent controls its own schedule by writing a file in its workspace.

- Manager writes `ASYNC.md` with cron frontmatter defining when it wants to be woken up.
- When the manager thread goes idle, the server reads the file and syncs schedules into the DB.
- When a schedule is due, the server queues a `turn.run` on the existing manager thread with a system message like `[bb system] Scheduled nudge: <schedule-name>. Check ASYNC.md.`
- The manager wakes, reads its file, decides whether to act (delegate, notify user) or exit quietly.
- Manager instructions template gets a new section teaching the agent how to write `ASYNC.md` and how to handle nudges.

Example `ASYNC.md`:

```markdown
---
timezone: America/Los_Angeles
schedules:
  - cron: "0 8 * * 1-5"
    name: daily-recap
  - cron: "0 */2 * * *"
    name: deploy-check
    until: 2026-03-26
---

## daily-recap
Summarize yesterday's git activity across all project threads and message the user.

## deploy-check (one-off)
Check if PR #142 has been deployed. If yes, notify the user and remove this entry.
```

### Use case 2: Standalone automations (user-defined via UI)

Users create automations directly in the app, independent of any manager.

- User creates an automation: "every weekday at 8am, start a new thread with this prompt in this project."
- Stored directly in the DB (no file involved).
- When due, the server creates a new thread and queues a `turn.run` to kick it off.
- Thread runs, produces output, goes idle. Each run is its own thread.
- By default, automation threads are auto-archived when they complete (go idle). The `autoArchive` flag on the automation config controls this. When `true` (default), completed threads are immediately archived and only visible through the run history panel. When `false`, threads remain in the normal thread list after completion — useful when the output needs manual review or follow-up.
- Use case: "every morning, comb through my outstanding PRs and give me a summary."

---

## Data Model

One table, discriminated JSON config. Scheduling columns are shared across kinds; kind-specific data lives in a typed JSON `config` column.

```
scheduled_tasks
  id              TEXT PRIMARY KEY
  projectId       TEXT NOT NULL (FK → projects, ON DELETE CASCADE)
  kind            TEXT NOT NULL ("manager-nudge" | "automation")
  name            TEXT NOT NULL
  cron            TEXT NOT NULL
  timezone        TEXT NOT NULL
  enabled         INTEGER NOT NULL DEFAULT 1
  oneShot         INTEGER NOT NULL DEFAULT 0
  nextFireAt      INTEGER NOT NULL (epoch ms, consistent with all other timestamp columns)
  lastFiredAt     INTEGER
  config          TEXT NOT NULL (JSON, discriminated by kind)
  createdAt       INTEGER NOT NULL
  updatedAt       INTEGER NOT NULL

INDEX idx_scheduled_tasks_due ON scheduled_tasks(enabled, nextFireAt)
INDEX idx_scheduled_tasks_project ON scheduled_tasks(projectId)
UNIQUE INDEX idx_scheduled_tasks_sync_key ON scheduled_tasks(projectId, kind, name)
```

Note: `kind` lives only on the top-level column, not duplicated inside `config`. The `config` JSON is discriminated by the sibling `kind` column:

```typescript
type ManagerNudgeConfig = { threadId: string };
type AutomationConfig = { prompt: string; hostId: string; autoArchive: boolean };

// Parsed together with the row's `kind` field
type ScheduledTaskRow = {
  kind: "manager-nudge";
  config: ManagerNudgeConfig;
} | {
  kind: "automation";
  config: AutomationConfig;
};
```

### Design decision: `hostId` instead of `EnvironmentArgs` in automation config

The automation config stores `hostId` (which host to run on) rather than the full `EnvironmentArgs` discriminated union from `@bb/server-contract`. This avoids a wrong-direction dependency (`@bb/domain` → `@bb/server-contract`). The server's automation-run handler resolves the `hostId` into the appropriate environment provisioning flow at execution time, just like normal thread creation does.

### Why this design over alternatives

- **One table with nullable fields:** Schema can't enforce which fields are present per kind. Nullable columns accumulate as kinds diverge. Runtime validation compensates for what types should catch.
- **Multiple tables (one per kind):** Sweep function queries N tables. Shared scheduling logic duplicates or needs a cross-table abstraction. Adding a kind means adding a table.
- **One table with typed JSON (chosen):** Shared scheduling columns queried uniformly by the sweep. Kind-specific data is typed via Zod at the boundary. Adding a kind means adding a union branch. Same pattern already used in `hostDaemonCommands.payload`.

### ID factory

Add `createScheduledTaskId()` to `@bb/db/src/ids.ts` (e.g., prefix `"stsk"`), following the existing pattern for all entity IDs.

---

## ASYNC.md Sync Mechanism

When a manager thread transitions to idle:

1. Server sees: this is a manager-type thread going idle (thread `type` column = `"manager"`).
2. Server issues a `workspace.read_file` command to the daemon to fetch `ASYNC.md` from the manager's workspace path.
3. Server parses frontmatter for schedule entries. If parsing fails (malformed YAML, invalid cron), log a warning and leave existing schedules unchanged — do not delete them on a parse error.
4. Server diffs against existing `manager-nudge` rows for this threadId (matched by `name` within the project+kind, using the unique index).
5. Upserts: add new, update changed crons, delete removed entries.
6. Computes `nextFireAt` for new/changed entries using `cron-parser`.

If the file doesn't exist or has no frontmatter → delete all `manager-nudge` rows for that thread. The manager opted out.

If the file has valid frontmatter but a parse error on a specific schedule entry (e.g., invalid cron expression), skip that entry and sync the rest. Log a warning for the invalid entry.

### Timezone for manager nudges

The `ASYNC.md` frontmatter includes a top-level `timezone` field (IANA). If omitted, default to UTC. Individual schedule entries can optionally override with their own `timezone`.

### Race condition: idle → file read

Between the idle transition and the file read completing, the manager could be woken again (e.g., user sends a message) and modify `ASYNC.md`. This is acceptable — the sync captures a point-in-time snapshot. The next idle transition will sync again with the updated file. Schedule execution is not latency-critical enough for this to cause problems.

**Why server-fetches-separately instead of daemon-reports-on-idle:**
- Keeps the idle event clean — no optional blob that 95% of threads don't use.
- Doesn't couple "thread went idle" (runtime concern) with "sync schedules" (scheduling concern).
- Daemon stays dumb about scheduling. Server decides when it cares.
- The daemon doesn't need to know which threads are managers or where their workspaces are just to populate an event field.
- Extra round-trip is fine — schedule syncing isn't latency-sensitive.

### Idle detection trigger point

The server detects manager-thread-idle when processing inbound events from the daemon. When a turn-completion event arrives for a manager-type thread and the thread transitions to idle status, the server's thread lifecycle handler triggers the ASYNC.md sync. This is part of the event ingestion path, not a separate polling mechanism.

---

## Sweep Function

Runs in the server's main sweep loop alongside existing sweeps, but is qualitatively different — existing sweeps are pure DB maintenance (expire stale rows, close dead sessions), while this sweep has application-level side effects (creates threads, queues commands). Error isolation: the schedule sweep should catch and log errors per-task rather than letting one failed task abort the entire sweep.

### Signature

Follows existing sweep conventions: `sweepDueSchedules(db: DbConnection, notifier: DbNotifier, now?: number)`. Returns `{ nudgesFired: number; automationsStarted: number; errors: number }`.

### Pseudocode

```
sweepDueSchedules(db, notifier, now):
  due = SELECT * FROM scheduled_tasks WHERE enabled = 1 AND nextFireAt <= now
  for each task in due:
    try:
      config = parseScheduledTaskConfig(task.kind, task.config)  // Zod parse
      switch task.kind:
        "manager-nudge":
          // Skip if thread is not idle or doesn't exist
          thread = getThread(db, config.threadId)
          if !thread or thread.status != "idle" or thread.archivedAt != null:
            if !thread or thread.archivedAt != null:
              // Thread gone — clean up orphaned schedule
              deleteScheduledTask(db, task.id)
            continue
          // Skip if there's already a pending turn.run for this thread
          if hasPendingTurnRun(db, config.threadId):
            continue
          queue turn.run on config.threadId with nudge message
        "automation":
          // Full lifecycle: create thread → provision environment → queue turn.run
          // This mirrors normal thread creation flow, not a single atomic step
          startAutomationRun(db, notifier, task)
      if task.oneShot:
        delete task WHERE nextFireAt = task.nextFireAt (optimistic lock)
      else:
        advance nextFireAt using cron-parser WHERE nextFireAt = task.nextFireAt (optimistic lock)
        update lastFiredAt
    catch error:
      log error, continue to next task
```

### Transactional guarantees

The `nextFireAt` advancement and `lastFiredAt` update must happen in the same transaction as the command queue insertion. If the sweep crashes after queuing a command but before advancing `nextFireAt`, the next sweep would fire the same schedule again. Wrapping both in a transaction prevents this — either both happen or neither does.

### Optimistic locking on `nextFireAt`

The `advanceScheduledTaskAfterFire` UPDATE must include a WHERE clause on the expected `nextFireAt` value:

```sql
UPDATE scheduled_tasks
SET nextFireAt = :newFireAt, lastFiredAt = :now, updatedAt = :now
WHERE id = :id AND nextFireAt = :expectedFireAt
```

If another server (or a concurrent sweep) already advanced `nextFireAt`, this updates 0 rows and the fire is skipped. This is a compare-and-swap on a monotonically advancing value — cheap, no new tables, and makes the sweep safe regardless of how many servers run it.

The existing re-check guards (`hasOpenScheduledTaskThread`, `hasPendingThreadTurnCommand`) already prevent duplicate side effects, but optimistic locking prevents even the *attempt* to fire. Both layers are needed: the optimistic lock is the primary gate; the re-checks are defense-in-depth for edge cases where `nextFireAt` hasn't advanced yet within the same transaction.

This pattern works with SQLite today (where it's technically redundant because transactions serialize) and with a shared Postgres in the future (where it's essential).

### Disconnected host handling

If a manager-nudge fires while the target host is offline:
- The `turn.run` command sits in the command queue.
- **Do not accumulate stale nudges.** Before queuing a nudge, check if there's already a pending/fetched `turn.run` for this threadId. If so, skip — the manager will check `ASYNC.md` when it wakes up regardless.
- For automations: same approach — check if a pending automation-created thread already exists for this schedule before creating another.

If a host has been offline for hours and reconnects, it should only see at most one pending nudge per manager, not a backlog.

### Sweep interval and precision

The sweep runs on the server's polling interval (likely 10–30 seconds). Schedules can fire up to one interval late. For typical cron expressions (daily, hourly), this is negligible. The plan does not target sub-second precision.

### DST handling

`cron-parser` handles DST transitions, but this needs explicit test coverage: schedules crossing spring-forward (skipped hour) and fall-back (repeated hour) boundaries. The `timezone` field on each schedule entry is required specifically for this reason — UTC-only would avoid the problem but be a poor user experience.

---

## Automation Run Tracking

Automations need a way to link threads back to the schedule that created them. Without this, dedup and run history are impossible.

### Approach: `scheduledTaskId` column on `threads`

Add a nullable `scheduledTaskId` column to the `threads` table (FK → `scheduled_tasks`, `ON DELETE SET NULL`). When the sweep creates a thread for an automation, it sets this field. This enables:

- **Dedup:** Before creating a new thread, check `SELECT 1 FROM threads WHERE scheduledTaskId = ? AND status IN ('active', 'idle', 'provisioning')`. If one exists, skip.
- **Run history:** `SELECT * FROM threads WHERE scheduledTaskId = ? ORDER BY createdAt DESC`.
- **Run count:** `SELECT COUNT(*) FROM threads WHERE scheduledTaskId = ?` (or maintain a counter on the scheduled_tasks row).

`ON DELETE SET NULL` means deleting a schedule doesn't cascade-delete all the threads it created — those threads have their own lifecycle and may contain valuable output.

### Auto-archive behavior

When a turn completes on an automation-created thread (identified by `scheduledTaskId`) and the thread transitions to idle, the server checks the automation's `config.autoArchive` flag:

- **`autoArchive: true` (default):** Thread is immediately archived. It disappears from the normal thread list and is only visible through the automation's run history panel. This is the right default for fire-and-forget automations like daily summaries.
- **`autoArchive: false`:** Thread remains in the normal thread list after completion. Useful when automation output needs manual review, follow-up conversation, or when the user wants to interact with the results.

The check lives in `applyTurnCompletedEvent`. It must look up the scheduled task to read the config — the thread alone doesn't carry the `autoArchive` flag. If the scheduled task has been deleted (`scheduledTaskId` is set to NULL by the FK cascade), default to archiving (there's no config to consult, and orphaned automation threads shouldn't linger).

---

## Protocol Hardening: Unknown Command Rejection

**This is a prerequisite, not a minor task.** The current daemon exhaustive switch throws on unknown command types, which can error threads and trigger the command sweep retry logic for a permanently unresolvable condition.

### The Zod layer problem

The guard cannot be placed "before `dispatchCommand`" as originally proposed. The `hostDaemonCommandEnvelopeSchema` uses `hostDaemonCommandSchema` which is a `z.discriminatedUnion("type", [...])`. Unknown command types fail at Zod parse time during deserialization — before the dispatch switch is ever reached.

The fix must happen at the raw JSON level, before Zod validation:

1. **Daemon fetch layer** — When the daemon receives command envelopes from the server, inspect each envelope's raw `command.type` string before applying `hostDaemonCommandEnvelopeSchema.parse()`.
2. **Known type check** — If the `type` is not in `HOST_DAEMON_COMMAND_TYPES`, skip Zod parsing entirely and report back immediately with a well-defined error.
3. **Error response** — `{ ok: false, errorCode: "unknown-command", errorMessage: "..." }`.

### What needs to change

1. **`@bb/host-daemon-contract`** — Define `"unknown-command"` as a recognized error code. Consider adding a `HOST_DAEMON_PROTOCOL_VERSION` bump so the server can detect version mismatches proactively.
2. **Daemon command fetch/parse layer** — Raw JSON type check before Zod validation. Report `unknown-command` error for unrecognized types.
3. **Server command result handling** — Recognize `unknown-command` errors. Do not retry. Do not error the associated thread. Log a version-mismatch warning.
4. **Command sweep** — Treat `unknown-command` errors as terminal (no retry), distinct from transient failures.

The exhaustive `never` check inside `dispatchCommand` stays as a compile-time safety net. It should never be reached at runtime once the protocol guard is in place.

---

## Existing Contract Gap: `workspace.read_file`

The server contract already defines `GET /threads/:id/workspace/file` (returns `{ path: string; content: string }`) and `GET /threads/:id/workspace/files` (returns `WorkspaceFile[]`). However, there is **no corresponding daemon command** to actually read files from a workspace. The daemon's 17 command types have no file-read capability — the closest are `workspace.status` and `workspace.diff`, which return git metadata, not file contents.

This is an existing hole in the contract boundaries that predates the scheduling feature. When the server is built (Phase 6), it will need `workspace.read_file` and `workspace.list_files` commands to fulfill its own public API contract. The ASYNC.md sync mechanism piggybacks on this same command — it's not introducing a new requirement, it's exposing one that already exists.

### What's needed

Add to `@bb/host-daemon-contract`:
- `workspace.read_file` — takes `environmentId`, `threadId`, `path`; returns `{ path: string; content: string }` or a not-found error.
- `workspace.list_files` — takes `environmentId`, `threadId`, optional `query`; returns `WorkspaceFile[]`.

These commands should be added during the server build (Phase 6), not deferred to the scheduling feature.

---

## Nudge Message Format

The `turn.run` command carries input as `promptInputSchema` entries. The nudge message will be a `{ type: "text", text: "..." }` input. There is no `system`-role variant in `promptInputSchema` — the nudge arrives as a user-role message at the provider level.

The manager interprets the `[bb system]` prefix convention in the message text. This is consistent with how the manager instructions already handle system messages (line 32 of manager-agent-instructions.md: "Messages prefixed with `[bb system]` are internal context, not direct user requests."). The model doesn't need a provider-level system-role distinction — the text convention is sufficient and already established.

---

## Dependencies

Two small packages:

| Package | Purpose | Size |
|---------|---------|------|
| `cron-parser` | Parse cron expressions, compute next fire times with timezone support | ~5KB, no transitive deps |
| `cronstrue` | Human-readable cron descriptions for UI ("Every weekday at 9:00 AM") | ~15KB |

Both used by Middleman and Terragon. Battle-tested, well-maintained.

---

## Package Changes

### `@bb/domain`
- `ScheduledTask` entity type (the DB row shape)
- `ScheduledTaskKind` union (`"manager-nudge" | "automation"`)
- `ManagerNudgeConfig` and `AutomationConfig` Zod schemas
- `CreateAutomationInput` for the user-facing API (includes `autoArchive: boolean`, default `true`)
- New `ProjectChangeKind`: `"schedules-changed"` (project-scoped, not system-scoped, since schedules belong to projects)

### `@bb/db`
- `scheduled_tasks` table in Drizzle schema (integer timestamps, `ON DELETE CASCADE` for projectId FK)
- `scheduledTaskId` nullable column on `threads` table (FK → `scheduled_tasks`, `ON DELETE SET NULL`)
- Migration (`0004_*.sql`)
- `createScheduledTaskId()` in `ids.ts`
- `schedules.ts` data functions: `listDueTasks`, `upsertManagerSchedules`, automation CRUD
- `sweepDueSchedules` — in its own module (not in `sweeps.ts`), given its orchestration complexity

### `@bb/server-contract`
- New routes for automation CRUD: `GET/POST/DELETE /api/v1/projects/:projectId/automations`
- Manager nudges don't need API routes — driven by the file

### `@bb/host-daemon-contract`
- `unknown-command` error code (protocol hardening)
- `workspace.read_file` and `workspace.list_files` command types (existing contract gap, needed for Phase 6 regardless)

### Server (`apps/server`)
- `sweepDueSchedules` in the sweep loop, with per-task error isolation
- Manager-idle lifecycle hook in event ingestion path: fetch `ASYNC.md`, sync schedules
- Automation CRUD route handlers
- Automation-run lifecycle: create thread → provision environment → queue `turn.run`

### Host daemon (`apps/host-daemon`)
- Protocol guard for unknown command types (at the raw JSON level, before Zod parsing)
- `workspace.read_file` and `workspace.list_files` command handlers

### Manager instructions (`@bb/templates`)
- New section on `ASYNC.md`: format, frontmatter schema (including timezone), how to write/update/remove entries
- New section on handling `[bb system] Scheduled nudge: <name>` messages
- Guidance: if nothing to do, exit quietly; only message the user when there's something worth saying; do not acknowledge nudges to the user unless acting on them

### App (`apps/app`)
- Automation management UI in project view (list, create, edit, enable/disable, delete)
- Schedule display: human-readable cron (via `cronstrue`), next fire time, last fired
- Automation run history: threads linked by `scheduledTaskId`

---

## What Doesn't Change

- Existing sweep functions (`sweepExpiredCommands`, `sweepExpiredLeases`, `sweepManagedEnvironments`) — these are maintenance tasks, not user-defined schedules. They stay as-is, not moved into the cron system.
- `dispatchCommand` internals — the exhaustive switch stays as-is. New command types (`workspace.read_file`, `workspace.list_files`) are added to the switch, not worked around.
- Event buffer, WebSocket protocol, notification hub — unchanged.
- CLI — no CLI surface needed in v1 (automations managed via app UI, manager nudges managed via the manager conversation).

---

## Reference: How Middleman and Terragon Do It

### Middleman (SawyerHood/middleman)
- Polling-based cron scheduler, 30s interval, one `CronSchedulerService` per manager.
- SQLite `middleman_schedules` table with `nextFireAt`, `lastFiredAt`, `enabled`, `oneShot`.
- `cron-parser` for next-fire computation. In-memory `Set` for dedup (resets on restart).
- Fires by injecting a synthetic user message into the manager's long-running conversation via `handleUserMessage()`.
- Message format: `[Scheduled Task: name]\n[scheduleContext] {JSON}\n\n{message}`
- Manager is an LLM agent with a skill doc (`SKILL.md`) teaching it to interpret schedule-fired messages.
- UI: Schedules tab in sidebar with list, detail panel, cron description, next fire time.
- No external queue or job system — pure SQLite + timer polling.

### Terragon (terragon-labs/terragon-oss)
- External cron hits `/api/internal/cron/automations` endpoint (protected by `CRON_SECRET`).
- PostgreSQL `automations` table with trigger types: schedule, PR, issue, GitHub mention, manual.
- Creates a **new thread per automation run** (`sourceType: "automation"`).
- `cron-parser` + `cronstrue` for parsing and human-readable display.
- Rich UI: frequency picker (daily/weekly/monthly/weekdays/custom), time picker, timezone selector.
- Access tier restrictions on automation count and frequency (not applicable to BB, self-hosted).
- Action model: only `user_message` type currently — stores the prompt to send.

### Key takeaway
Middleman's approach maps to our use case 1 (manager nudges into long-running thread). Terragon's approach maps to our use case 2 (standalone automations creating ephemeral threads). Our design unifies both behind one scheduling table and sweep function.

---

## Implementation Notes (from code review)

Issues found during review of the first implementation pass. Address in the next pass.

### Code-level fixes

1. **Cron/timezone validation at API boundary.** `computeNextFireAt` can throw on invalid cron or timezone, producing a 500 instead of 400. Either validate in Zod schemas with `.superRefine()` or wrap route handlers to catch `invalidScheduleError` and return 400.
2. **Logging in `fireManagerNudge` guard clauses.** Five conditions silently return `false` (thread not idle, environment not ready, pending command, etc.). Add `debug`-level logging to each for observability.
3. **`JSON.parse(row.config)` in `parseScheduledTask`.** Wrap with try/catch that includes the task ID for debuggability on DB corruption.
4. **Comment the unique index NULL semantics.** The sync key index uses `json_extract(config, '$.threadId')` which is NULL for automations. SQLite allows multiple NULLs in unique indexes. This is correct but implicit — add a schema comment.
5. **Split `scheduled-tasks.ts`** (~700 lines) into focused modules: `schedule-sweep.ts`, `manager-schedule-sync.ts`, `schedule-helpers.ts`.

### Missing test coverage

1. `oneShot` schedule self-deletion after firing
2. Archived manager thread → schedule cleanup on next sweep
3. `hasPendingThreadTurnCommand` guard skips nudge (dedup for offline hosts)
4. `updateAutomation` / `deleteScheduledTask` with nonexistent ID
5. Empty manager schedules upsert deletes all schedules for that thread

---

## Exit Criteria

- [ ] Protocol hardening: daemon gracefully rejects unknown command types at the raw JSON level with well-defined error code
- [ ] `workspace.read_file` and `workspace.list_files` commands added to host-daemon contract and implemented
- [ ] `scheduled_tasks` table exists with migration, integer timestamps, cascade FK, unique sync index
- [ ] `scheduledTaskId` column on `threads` table for automation run tracking
- [ ] `createScheduledTaskId()` in ID factory
- [ ] Manager-idle lifecycle syncs `ASYNC.md` frontmatter → DB (with error handling for malformed files)
- [ ] Sweep fires manager nudges as `turn.run` on idle manager threads (no backlog accumulation, orphan cleanup)
- [ ] Sweep fires automations by creating new threads with the stored prompt (full lifecycle: create → provision → run)
- [ ] Transactional guarantee: command queue insertion and `nextFireAt` advancement are atomic
- [ ] Optimistic lock: `advanceScheduledTaskAfterFire` uses `WHERE nextFireAt = :expected` to prevent double-fire across concurrent sweeps
- [ ] `cron-parser` computes next fire times correctly across timezones, including DST transitions
- [ ] Manager instructions template covers `ASYNC.md` authoring and nudge handling
- [ ] Automation CRUD API routes work end-to-end
- [ ] App UI: create, list, enable/disable, delete automations; view run history via `scheduledTaskId` join; `autoArchive` toggle
- [ ] Tests: in-memory SQLite, real sweep logic, no mocks except timers; DST edge cases covered
- [ ] `ProjectChangeKind: "schedules-changed"` notifies UI of schedule mutations
