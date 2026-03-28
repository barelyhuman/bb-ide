# Scheduled Tasks & Automations

Post-rebuild feature plan for recurring/scheduled work in BB. This plan captures research and design decisions from an investigation of [Middleman](https://github.com/SawyerHood/middleman) and [Terragon](https://github.com/terragon-labs/terragon-oss) scheduling systems, and how they map to BB's architecture.

**Prerequisite:** Rebuild phases 5–9 complete. Server, host-daemon, and sandbox-host all operational.

---

## Two Use Cases, Two Tables

### Use case 1: Manager nudges (ASYNC.md-driven)

The manager agent controls its own schedule by writing a file in its workspace.

- Manager writes `ASYNC.md` with cron frontmatter defining when it wants to be woken up.
- When the manager thread goes idle, the server reads the file and syncs schedules into the DB.
- When a schedule is due, the server queues a `turn.run` on the existing manager thread with a system message like `[bb system] Scheduled nudge: <schedule-name>. Check ASYNC.md.`
- The manager wakes, reads its file, decides whether to act (delegate, notify user) or exit quietly.
- Manager instructions template gets a new section teaching the agent how to write `ASYNC.md` and how to handle nudges.

Stored in: **`manager_thread_nudges`** table.

Example `ASYNC.md`:

```markdown
---
timezone: America/Los_Angeles
schedules:
  - cron: "0 8 * * 1-5"
    name: daily-recap
  - cron: "0 */2 * * *"
    name: deploy-check
---

## daily-recap
Summarize yesterday's git activity across all project threads and message the user.

## deploy-check
Check if PR #142 has been deployed. If yes, notify the user and remove this entry.
```

### Use case 2: Automations (user-defined, API-driven)

Users create automations via the API, independent of any manager. No UI in v1 — routes only.

- An automation defines *what* to do (action) and *when* to do it (trigger).
- v1 supports one automation type: **scheduled thread** — "create this thread on a schedule."
- When a scheduled automation is due, the server creates a new thread using the **same code path as regular thread creation**. No parallel implementation.
- Each run produces its own thread. The thread is linked back to the automation via `automationId` for run history.

Stored in: **`automations`** table.

### Why two tables instead of one

The previous plan used a single `scheduled_tasks` table with a `kind` discriminator. Review feedback showed this creates friction:

- **Different lifecycles.** Manager nudges are synced from a file and fire on existing threads. Automations are API-managed and create new threads. The only shared columns are cron/timezone/enabled — everything else diverges.
- **Different indexes.** Nudges need a unique index on `(projectId, threadId, name)` for sync dedup. Automations need indexes on `(projectId, triggerType)` and `(nextRunAt)` for sweep queries. A shared table requires awkward composite indexes with NULL columns.
- **Different futures.** Automations will grow trigger types (PR, issue, webhook — like Terragon). Manager nudges won't. A shared table means every automation-specific column is nullable or stuffed into JSON for nudges.
- **Simpler queries.** The sweep queries each table independently with clean WHERE clauses. No `kind` filter needed.

---

## Data Model

### `automations` table

Modeled after [Terragon's automations table](https://github.com/terragon-labs/terragon-oss/blob/main/packages/shared/src/db/schema.ts), adapted for BB's architecture.

```
automations
  id              TEXT PRIMARY KEY
  projectId       TEXT NOT NULL (FK → projects, ON DELETE CASCADE)
  name            TEXT NOT NULL
  enabled         INTEGER NOT NULL DEFAULT 1
  triggerType     TEXT NOT NULL ("schedule")
  triggerConfig   TEXT NOT NULL (JSON, discriminated by triggerType)
  action          TEXT NOT NULL (JSON, discriminated by actionType — v1: only "scheduled-thread")
  autoArchive     INTEGER NOT NULL DEFAULT 1
  nextRunAt       INTEGER (epoch ms, NULL when disabled or non-schedule trigger)
  lastRunAt       INTEGER
  runCount        INTEGER NOT NULL DEFAULT 0
  createdAt       INTEGER NOT NULL
  updatedAt       INTEGER NOT NULL

INDEX idx_automations_project ON automations(projectId)
INDEX idx_automations_due ON automations(enabled, triggerType, nextRunAt)
```

**Trigger config** (discriminated by `triggerType`):

```typescript
// v1: only schedule
type ScheduleTriggerConfig = { cron: string; timezone: string };

// Future: PR, issue, webhook, etc.
```

**Action** (discriminated by `actionType` field inside JSON):

```typescript
// v1: only scheduled-thread
type ScheduledThreadAction = {
  actionType: "scheduled-thread";
  threadRequest: Omit<CreateThreadRequest, "projectId">;
};

// Future: send-message, run-command, etc.
```

The `threadRequest` field stores a `CreateThreadRequest` (from `@bb/server-contract`) minus `projectId` (which comes from the automation row). This is the same shape the `POST /threads` API accepts. When the sweep fires, it reconstructs a full `CreateThreadRequest` by merging `projectId` from the automation row with `threadRequest` from the action, then calls the same `createThreadFromRequest()` function that the API route uses.

This ensures automation thread creation and regular thread creation are **literally the same code path**. The `CreateThreadRequest` already supports all the knobs a user might want: `providerId`, `environment` (reuse/host/sandbox), `input` (prompt), `model`, `serviceTier`, `reasoningLevel`, `sandboxMode`, `spawnInitiator`, etc.

**Design notes:**
- `triggerConfig` and `action` are separate JSON columns because they vary on independent axes — a schedule trigger could fire any action type, and a PR trigger could also create a thread.
- `autoArchive` controls whether completed threads are archived immediately or left visible. Default `true`.
- `runCount`, `lastRunAt`, and `nextRunAt` live on the automation row (like Terragon), not in a separate runs table. Thread history is queryable via the `automationId` FK on threads.
- No `oneShot` — automations are recurring by design. A user who wants a one-time run can disable the automation after it fires, or just create a thread directly.
- No environment type restriction — the `threadRequest` can specify any environment type that `CreateThreadRequest` supports.

### `manager_thread_nudges` table

Purpose-built for ASYNC.md sync. Simpler than automations — no trigger types, no actions, no run tracking.

```
manager_thread_nudges
  id              TEXT PRIMARY KEY
  projectId       TEXT NOT NULL (FK → projects, ON DELETE CASCADE)
  threadId        TEXT NOT NULL (FK → threads, ON DELETE CASCADE)
  name            TEXT NOT NULL
  cron            TEXT NOT NULL
  timezone        TEXT NOT NULL
  enabled         INTEGER NOT NULL DEFAULT 1
  nextFireAt      INTEGER NOT NULL (epoch ms)
  lastFiredAt     INTEGER
  createdAt       INTEGER NOT NULL
  updatedAt       INTEGER NOT NULL

INDEX idx_nudges_due ON manager_thread_nudges(enabled, nextFireAt)
INDEX idx_nudges_project ON manager_thread_nudges(projectId)
UNIQUE INDEX idx_nudges_sync_key ON manager_thread_nudges(projectId, threadId, name)
```

**Design notes:**
- `threadId` FK uses `ON DELETE CASCADE` — if the manager thread is deleted, its nudges are cleaned up automatically. No orphan sweep needed.
- The unique index on `(projectId, threadId, name)` enforces the ASYNC.md sync contract: one schedule per name per manager thread.
- No `config` JSON — all fields are top-level columns. Nudges don't have variable structure.
- No `runCount` or run tracking — nudges fire on existing threads, not new ones. The thread's own event history is the record.

### `automationId` column on `threads`

Add a nullable `automationId` column to the `threads` table (FK → `automations`, `ON DELETE SET NULL`). When an automation creates a thread, it sets this field. This enables:

- **Dedup:** Before creating a new thread, check `SELECT 1 FROM threads WHERE automationId = ? AND status IN ('active', 'idle', 'provisioning') AND archivedAt IS NULL`. If one exists, skip.
- **Run history:** `SELECT * FROM threads WHERE automationId = ? ORDER BY createdAt DESC`.

`ON DELETE SET NULL` means deleting an automation doesn't cascade-delete all the threads it created — those threads have their own lifecycle and may contain valuable output.

### ID factories

Add to `@bb/db/src/ids.ts`:
- `createAutomationId()` (prefix `"auto"`)
- `createManagerThreadNudgeId()` (prefix `"mnge"`)

---

## ASYNC.md Sync Mechanism

When a manager thread transitions to idle:

1. Server sees: this is a manager-type thread going idle (thread `type` column = `"manager"`).
2. Server issues a `workspace.read_file` command to the daemon to fetch `ASYNC.md` from the manager's workspace path.
3. Server parses frontmatter for schedule entries. If parsing fails (malformed YAML, invalid cron), log a warning and leave existing nudges unchanged — do not delete them on a parse error.
4. Server diffs against existing nudge rows for this threadId (matched by `name` within the project+thread, using the unique index).
5. Upserts: add new, update changed crons, delete removed entries. All in one transaction.
6. Computes `nextFireAt` for new/changed entries using `cron-parser`.

If the file doesn't exist or has no frontmatter → delete all nudge rows for that thread. The manager opted out.

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

Two independent sweep functions, both running in the server's main sweep loop. They are qualitatively different from existing sweeps — existing sweeps are pure DB maintenance (expire stale rows, close dead sessions), while these have application-level side effects (create threads, queue commands). Error isolation: each sweep should catch and log errors per-task rather than letting one failed task abort the entire sweep.

### `sweepDueAutomations`

```
sweepDueAutomations(deps, now):
  due = SELECT * FROM automations WHERE enabled = 1 AND triggerType = 'schedule' AND nextRunAt <= now
  for each automation in due:
    try:
      // Dedup: skip if an open thread already exists for this automation
      if hasOpenAutomationThread(db, automation.id):
        continue

      // Create thread using the SAME code path as regular thread creation.
      // This is critical — no parallel implementation allowed.
      request = { projectId: automation.projectId, ...automation.action.threadRequest }
      thread = createThreadFromRequest(deps, request, { automationId: automation.id })

      // Advance schedule (optimistic lock)
      advanceAutomationAfterRun(db, automation)
    catch error:
      log error, continue to next automation
```

### `sweepDueNudges`

```
sweepDueNudges(deps, now):
  due = SELECT * FROM manager_thread_nudges WHERE enabled = 1 AND nextFireAt <= now
  for each nudge in due:
    try:
      thread = getThread(db, nudge.threadId)
      if !thread or thread.archivedAt != null:
        // Thread gone — cascade should have cleaned this up, but be safe
        deleteNudge(db, nudge.id)
        continue
      if thread.status != "idle":
        continue
      if hasPendingTurnRun(db, nudge.threadId):
        continue

      // Queue turn.run with nudge message (in transaction with nextFireAt advance)
      db.transaction:
        if hasPendingTurnRun(tx, nudge.threadId):
          return  // re-check inside txn
        if !advanceNudgeAfterFire(tx, nudge):
          return  // CAS failed, another sweep got it
        queue turn.run on nudge.threadId with nudge message
        insert thread event
    catch error:
      log error, continue to next nudge
```

### Thread creation for automations MUST share the regular code path

This is the most important architectural constraint in this plan. When `sweepDueAutomations` creates a thread, it must call `createThreadFromRequest()` — the same function that the `POST /threads` API route calls. Not a copy. Not a "similar" function. The same function.

The concern is **code drift**: if automation thread creation diverges from regular thread creation, future changes to the thread creation flow (new fields, new validation, new side effects) will silently miss automation-created threads. This has happened in other systems and is expensive to debug.

The automation stores a `CreateThreadRequest` (minus `projectId`) in its `action.threadRequest` field. The sweep reconstructs a full `CreateThreadRequest` and calls `createThreadFromRequest()`. The function shouldn't need to know or care that its caller is a sweep rather than an API route.

`createThreadFromRequest()` currently requires a connected host session for some environment types. The sweep may need to call it when no session exists (host offline). If the function's signature doesn't accommodate this (e.g., it throws on missing session), refactor it to handle the disconnected case gracefully — queue the provisioning command and let it execute when the host reconnects. This refactor is in-scope for this plan.

Additionally, `createThreadFromRequest()` needs to accept an optional `automationId` so the created thread can be linked back for run history and dedup. This should be a minor addition to the function's options, not a separate code path.

### Optimistic locking on schedule advancement

Both `advanceAutomationAfterRun` and `advanceNudgeAfterFire` must use a WHERE clause on the expected next-run/fire time:

```sql
-- For automations:
UPDATE automations
SET nextRunAt = :newRunAt, lastRunAt = :now, runCount = runCount + 1, updatedAt = :now
WHERE id = :id AND nextRunAt = :expectedRunAt

-- For nudges:
UPDATE manager_thread_nudges
SET nextFireAt = :newFireAt, lastFiredAt = :now, updatedAt = :now
WHERE id = :id AND nextFireAt = :expectedFireAt
```

If another sweep already advanced it, this updates 0 rows and the fire/run is skipped. Compare-and-swap on a monotonically advancing value — cheap, no new tables, safe for concurrent execution.

### Transactional guarantees

**For nudges:** The `nextFireAt` advancement and command queue insertion must happen in the same transaction. If the sweep crashes after queuing a command but before advancing, the next sweep would fire the same nudge again. Wrapping both in a transaction prevents this.

**For automations:** The `nextRunAt` advancement and thread creation should be in the same transaction where possible. The dedup check (`hasOpenAutomationThread`) must be re-checked inside the transaction to prevent TOCTOU races.

### Disconnected host handling

If a nudge fires while the target host is offline:
- The `turn.run` command sits in the command queue.
- **Do not accumulate stale nudges.** Before queuing a nudge, check if there's already a pending/fetched `turn.run` for this threadId. If so, skip — the manager will check `ASYNC.md` when it wakes up regardless.
- For automations: same approach — check if an open automation thread already exists before creating another.

If a host has been offline for hours and reconnects, it should only see at most one pending nudge per manager, not a backlog.

### Sweep interval and precision

The sweeps run on the server's polling interval (likely 10–30 seconds). Schedules can fire up to one interval late. For typical cron expressions (daily, hourly), this is negligible. This plan does not target sub-second precision.

### DST handling

`cron-parser` handles DST transitions, but this needs explicit test coverage: schedules crossing spring-forward (skipped hour) and fall-back (repeated hour) boundaries. The `timezone` field on each schedule/nudge is required specifically for this reason — UTC-only would avoid the problem but be a poor user experience.

---

## Auto-Archive Behavior

When a turn completes on an automation-created thread (identified by `automationId`) and the thread transitions to idle, the server checks the automation's `autoArchive` flag:

- **`autoArchive: true` (default):** Thread is immediately archived. Only visible through run history queries.
- **`autoArchive: false`:** Thread remains in the normal thread list after completion. For automations whose output needs manual review.

The check lives in `applyTurnCompletedEvent`. It must look up the automation to read the flag — the thread alone doesn't carry it. If the automation has been deleted (`automationId` is NULL from the FK cascade), default to archiving (no config to consult, orphaned threads shouldn't linger).

---

## Nudge Message Format

The `turn.run` command carries input as `promptInputSchema` entries. The nudge message will be a `{ type: "text", text: "..." }` input. There is no `system`-role variant in `promptInputSchema` — the nudge arrives as a user-role message at the provider level.

The manager interprets the `[bb system]` prefix convention in the message text. This is consistent with how the manager instructions already handle system messages (line 32 of manager-agent-instructions.md: "Messages prefixed with `[bb system]` are internal context, not direct user requests."). The model doesn't need a provider-level system-role distinction — the text convention is sufficient and already established.

---

## Cron Validation

`computeNextRunAt` / `computeNextFireAt` can throw on invalid cron expressions or timezones. At API boundaries (automation CRUD routes), these errors must produce a 400, not a 500. Either:
- Validate cron syntax and timezone in the Zod input schemas with `.superRefine()`, or
- Throw `ApiError(400, ...)` from the computation function and let Hono's error middleware handle it.

The ASYNC.md sync path already handles this gracefully — invalid entries are skipped with a warning.

---

## Dependencies

Two small packages:

| Package | Purpose | Size |
|---------|---------|------|
| `cron-parser` | Parse cron expressions, compute next fire times with timezone support | ~5KB, no transitive deps |
| `gray-matter` | Parse YAML frontmatter from ASYNC.md | ~15KB |

`cronstrue` (human-readable cron descriptions) is not needed in v1 since there's no UI. Add it when the UI is built.

---

## Package Changes

### `@bb/domain`
- `Automation` entity type
- `ManagerThreadNudge` entity type
- `ScheduleTriggerConfig` and `ScheduledThreadAction` Zod schemas
- `CreateAutomationInput` and `UpdateAutomationInput` for the API
- New `ProjectChangeKind`: `"automations-changed"` and `"nudges-changed"`

### `@bb/db`
- `automations` table in Drizzle schema
- `manager_thread_nudges` table in Drizzle schema
- `automationId` nullable column on `threads` table (FK → `automations`, `ON DELETE SET NULL`)
- Migration
- `createAutomationId()` and `createManagerThreadNudgeId()` in `ids.ts`
- `automations.ts` data functions: CRUD, `listDueAutomations`, `advanceAutomationAfterRun`
- `nudges.ts` data functions: `upsertNudges`, `listDueNudges`, `advanceNudgeAfterFire`

### `@bb/server-contract`
- New routes for automation CRUD: `GET/POST /api/v1/projects/:projectId/automations`, `PATCH/DELETE /api/v1/projects/:projectId/automations/:automationId`
- Manager nudges don't need API routes — driven by the file

### Server (`apps/server`)
- `sweepDueAutomations` and `sweepDueNudges` in the sweep loop, with per-task error isolation
- Manager-idle lifecycle hook in event ingestion path: fetch `ASYNC.md`, sync nudges
- Automation CRUD route handlers
- Auto-archive logic in `applyTurnCompletedEvent`
- Thread creation for automations must call the same function as regular thread creation

### Manager instructions (`@bb/templates`)
- New section on `ASYNC.md`: format, frontmatter schema (including timezone), how to write/update/remove entries
- New section on handling `[bb system] Scheduled nudge: <name>` messages
- Guidance: if nothing to do, exit quietly; only message the user when there's something worth saying; do not acknowledge nudges to the user unless acting on them

---

## What Doesn't Change

- Existing sweep functions (`sweepExpiredCommands`, `sweepExpiredLeases`, `sweepManagedEnvironments`) — these are maintenance tasks. They stay as-is.
- `dispatchCommand` internals — the exhaustive switch stays as-is.
- Event buffer, WebSocket protocol, notification hub — unchanged.
- `createThreadFromRequest()` — reused by the automation sweep, not duplicated. May need a minor refactor to accept `automationId` and handle disconnected sessions.
- No UI in v1 — automations managed via API, nudges managed via the manager conversation.

---

## Implementation Notes (from code review of prior branch)

Learnings from three rounds of review on the abandoned `codex/scheduled-tasks` branch. These should be incorporated from the start:

### Architecture
1. **Split service files by concern.** Don't put sweep orchestration, ASYNC.md sync, and cron helpers in one file. Separate into: `automation-sweep.ts`, `nudge-sweep.ts`, `manager-schedule-sync.ts`, `schedule-helpers.ts`.
2. **Log guard clause failures.** Every condition in the nudge sweep that returns false (thread not idle, environment not ready, pending command, etc.) should log at `debug` level with structured fields (reason, thread ID, nudge ID).
3. **Wrap `JSON.parse` of config columns** with try/catch that includes the record ID for debuggability.
4. **Cron/timezone validation** at API boundaries must produce 400, not 500 (see Cron Validation section above).

### Testing
1. Test optimistic lock CAS: manually advance `nextRunAt`/`nextFireAt`, verify the sweep returns false and doesn't fire.
2. Test archived manager thread → nudge cascade deletion.
3. Test pending `turn.run` guard skips nudge.
4. Test `autoArchive: true` (default), `autoArchive: false`, and deleted-automation fallback.
5. Test DST transitions: spring-forward (skipped hour) and fall-back (repeated hour).
6. Test empty ASYNC.md upsert deletes all nudges for that thread.
7. All tests use in-memory SQLite via `createConnection(":memory:")` + `migrate(db)`. Never mock the database.

---

## Reference: How Middleman and Terragon Do It

### Middleman (SawyerHood/middleman)
- Polling-based cron scheduler, 30s interval, one `CronSchedulerService` per manager.
- SQLite `middleman_schedules` table with `nextFireAt`, `lastFiredAt`, `enabled`, `oneShot`.
- `cron-parser` for next-fire computation. In-memory `Set` for dedup (resets on restart).
- Fires by injecting a synthetic user message into the manager's long-running conversation via `handleUserMessage()`.
- Message format: `[Scheduled Task: name]\n[scheduleContext] {JSON}\n\n{message}`
- Manager is an LLM agent with a skill doc (`SKILL.md`) teaching it to interpret schedule-fired messages.
- No external queue or job system — pure SQLite + timer polling.

### Terragon (terragon-labs/terragon-oss)
- External cron hits `/api/internal/cron/automations` endpoint (protected by `CRON_SECRET`).
- PostgreSQL `automations` table with trigger types: schedule, PR, issue, GitHub mention, manual.
- `triggerType` + `triggerConfig` JSONB for type-specific trigger data. `action` JSONB for what to do.
- Creates a **new thread per automation run** (`sourceType: "automation"`).
- Threads have `automationId` FK (`ON DELETE SET NULL`) for run history.
- `runCount`, `lastRunAt`, `nextRunAt` tracked on the automation row — no separate runs table.
- `cron-parser` + `cronstrue` for parsing and human-readable display.
- Rich UI: frequency picker (daily/weekly/monthly/weekdays/custom), time picker, timezone selector.
- Action model: only `user_message` type currently — stores the prompt to send.

### Key takeaway
Middleman's approach maps to our use case 1 (manager nudges into long-running thread). Terragon's approach maps to our use case 2 (automations creating ephemeral threads). We split these into separate tables because their lifecycles, schemas, and growth trajectories are fundamentally different.

---

## Exit Criteria

- [ ] `automations` table exists with migration, indexes, trigger/action JSON schemas
- [ ] `manager_thread_nudges` table exists with migration, indexes, unique sync key
- [ ] `automationId` column on `threads` table for run tracking
- [ ] `createAutomationId()` and `createManagerThreadNudgeId()` in ID factory
- [ ] Manager-idle lifecycle syncs `ASYNC.md` frontmatter → `manager_thread_nudges` (with error handling for malformed files)
- [ ] `sweepDueNudges` fires nudges as `turn.run` on idle manager threads (no backlog accumulation, cascade handles orphans)
- [ ] `sweepDueAutomations` creates threads via the same code path as regular thread creation
- [ ] Optimistic lock: both sweeps use `WHERE nextRunAt/nextFireAt = :expected` to prevent double-fire
- [ ] Transactional guarantee: command queue insertion and schedule advancement are atomic
- [ ] `cron-parser` computes next fire/run times correctly across timezones, including DST transitions
- [ ] Cron/timezone validation at API boundary returns 400 on invalid input
- [ ] Manager instructions template covers `ASYNC.md` authoring and nudge handling
- [ ] Automation CRUD API routes work end-to-end (no UI)
- [ ] Auto-archive: respects `autoArchive` flag, defaults to archive when automation deleted
- [ ] Tests: in-memory SQLite, real sweep logic, no mocks except timers; DST edge cases covered; CAS race test included
- [ ] `ProjectChangeKind`: `"automations-changed"` and `"nudges-changed"` notify consumers of mutations
