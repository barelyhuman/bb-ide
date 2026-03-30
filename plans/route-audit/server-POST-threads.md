# `POST /api/v1/threads` — Create Thread

**Route:** `apps/server/src/routes/threads/base.ts:39-41`
**Contract:** `createThreadRequestSchema → Thread` (201)
**Complexity:** High — environment routing, daemon commands, background AI call

## Request Body

| Field | Required | Notes |
|---|---|---|
| `projectId` | yes | — |
| `providerId` | yes | — |
| `type` | yes | `"standard" \| "manager"` — see **Flag 1** below |
| `title` | optional | Used in thread record + `buildManagedBranchName()` for worktree/clone branch naming (e.g. `bb/<slug>/<threadId>`) |
| `input` | yes | Array of prompt messages. Drives: initial event payload, daemon `thread.start` command, title generation |
| `model` | yes | Forwarded to execution options → daemon command |
| `serviceTier` | optional | Defaults to `"flex"` via `resolveExecutionOptions` fallback chain |
| `reasoningLevel` | optional | Defaults to `"medium"` via same chain |
| `sandboxMode` | optional | Defaults to `"danger-full-access"` via same chain — see **Flag 2** |
| `environment` | yes | Discriminated union (`"reuse"` / `"host"` / `"sandbox-host"`) that determines the entire execution path |
| `parentThreadId` | optional | Stored on thread record. Creates parent→child relationship (FK, `ON DELETE SET NULL`) |

**All 11 fields consumed. No dead params.**

## Implementation Trace

1. **Validate project exists** — `requireProject(db, projectId)` (PK lookup, 1 query)
2. **Route by `environment.type`:**

   **Path A: `"reuse"`** (reuse existing environment)
   - `getEnvironment(db, environmentId)` — PK lookup
   - Validates env belongs to same project, status is `"ready"` or `"provisioning"`
   - Falls through to `createThreadInEnvironment()` (step 3)

   **Path B: `"host"` + `"unmanaged"`** (direct workspace path)
   - `requireConnectedHostSession(db, hostId)` — looks up active session (indexed: `host_daemon_sessions_host_status_idx`)
   - `requireDefaultSource(db, projectId)` — fetches default source (scan `project_sources` filtered by `projectId` + `isDefault`)
   - Resolves `unmanagedPath` from request or falls back to default source path
   - `maybeReuseUnmanagedEnvironment()`:
     - `findEnvironmentByHostPath(db, hostId, path)` — unique index lookup (`environments_host_path_idx`)
     - If found + same project + `"ready"`: reuses via `createThreadInEnvironment()` with `threadStatus: "idle"`
     - If found + same project + `"provisioning"`: reuses with `threadStatus: "provisioning"`
     - If found + different project: **409 error**
     - If found + other status (error/destroyed): **409 error**
     - If not found: falls through to Path C

   **Path C: New environment creation** (managed-worktree, managed-clone, or new unmanaged)
   - `createEnvironment(db, hub, {..., status: "provisioning"})` — INSERT into `environments`
   - Continues to step 3

3. **Create thread record** — `createThread(db, hub, {...})`
   - INSERT into `threads` table
   - Notifies hub: `"thread-created"` + `"threads-changed"`
   - `transitionThreadStatus(db, hub, threadId, status)` — UPDATE status

4. **Build execution options** — `buildExecutionOptions(deps, request, {threadId}, "client/thread/start")`
   - **Shared helper** — also used by `POST /threads/:id/send`, `POST /threads/:id/drafts`, `POST /threads/:id/drafts/:draftId/send` (via `sendClaimedDraft`)
   - `resolveExecutionOptions()` internally:
     - `getLastExecutionOptions(deps, threadId)` — queries `events` table for most recent event of type `client/thread/start | client/turn/requested | client/turn/start`, ordered by `sequence DESC LIMIT 1` (uses `events_thread_sequence_idx`)
     - For a brand new thread this returns `null`, so request values are used directly (model required, others fall back to defaults)
   - Marked `async` but contains no awaits — effectively synchronous

5. **Append events** (synchronous DB inserts):
   - `appendClientTurnEvent()` — INSERT into `events` with type `"client/thread/start"`, payload includes `input`, `execution`, `initiator`
   - `appendProvisioningEvent()` — INSERT into `events` with type `"system/provisioning"`, status `"started"`

6. **Queue `environment.provision` command** — `queueEnvironmentProvision()`
   - `queueCommand(db, hub, {...})` — INSERT into `host_daemon_commands` with state `"pending"`, inside a transaction that computes the next monotonic cursor
   - `hub.notifyCommand(hostId)` — wakes any long-polling daemon request + sends WebSocket nudge
   - **Returns immediately (sync DB insert, no await).** Daemon picks this up asynchronously via `GET /internal/session/commands` long-poll.
   - For unmanaged: sends `{ path }`
   - For managed-worktree/clone: sends `{ sourcePath, targetPath, branchName }`

7. **Conditionally queue `thread.start` command** (only on Path A/B when env is `"ready"`)
   - `startQueuedThreadIfNeeded()`:
     - Only fires if `hasThreadStartInput(request)` (always true for standard threads, always false for manager threads) AND `threadStatus === "idle"` (env already ready)
     - `resolveThreadRuntimeCommandConfig()` — resolves workspace path, instructions, dynamic tools (see Code Reuse below)
     - `queueCommand(db, hub, { type: "thread.start", ... })` — same async queue mechanism as step 6
     - `transitionThreadStatus(db, hub, threadId, "active")`
     - **On failure: `deleteThread(db, hub, threadId)`** — cleans up, no orphans
   - **Not reached on Path C** (env is provisioning, not ready). The daemon's provision-complete callback triggers the start later.

8. **Fire-and-forget: `generateThreadTitle()`** (only if no explicit `title` and has input)
   - Called with `void` — not awaited, does not block the HTTP response
   - Flow:
     - `deriveTitleFallback(input)` — extracts first 80 chars of user text as fallback
     - Early-exit if thread already has a title (deduplication guard)
     - `parseInferenceModel(config.inferenceModel)` — reads `BB_INFERENCE_MODEL` env var (default: `"openai/gpt-4o-mini"`)
     - `complete(model, { messages: [{ role: "user", content: prompt }] })` — calls AI provider via `@mariozechner/pi-ai` library
     - Prompt template (`generateThreadMetadata`): asks for JSON `{ title, branchName }` — title in Title Case, 3-7 words
     - `parseGeneratedTitle()` — parses JSON response
     - **Second deduplication check**: re-fetches thread, aborts if title was set by another caller in the meantime
     - `updateThread(db, hub, threadId, { title })` — UPDATE threads SET title
     - `appendThreadTitleUpdatedEvent()` — INSERT event `"system/thread-title/updated"`
     - If thread is active (not created/provisioning): `queueCommand({ type: "thread.rename", ... })` — notifies daemon of new title
   - **On any error: logs warning, swallows.** Thread keeps `titleFallback` — acceptable degradation.

> **→ HTTP 201 returns here** (after step 6, before steps 7-8 complete on the daemon side). Thread status is `"provisioning"` for new environments, `"active"` if env was already ready, or `"idle"` for reused envs without input. Title generation runs fully in the background.

## DB Query Summary

| # | Query | Table | Index | Notes |
|---|-------|-------|-------|-------|
| 1 | Validate project | `projects` | PK | — |
| 2 | Look up session | `host_daemon_sessions` | `host_status_idx` | Path B/C only |
| 3 | Default source | `project_sources` | `project_idx` | Path B/C only, filtered by `isDefault` in app code |
| 4 | Find reusable env | `environments` | `host_path_idx` (unique) | Path B only |
| 5 | INSERT environment | `environments` | — | Path C only |
| 6 | INSERT thread | `threads` | — | — |
| 7 | UPDATE thread status | `threads` | PK | — |
| 8 | Last execution options | `events` | `thread_sequence_idx` | `ORDER BY sequence DESC LIMIT 1` |
| 9 | INSERT client turn event | `events` | — | — |
| 10 | INSERT provisioning event | `events` | — | — |
| 11 | INSERT command (txn) | `host_daemon_commands` | `host_cursor_idx` | Monotonic cursor in transaction |
| 12 | INSERT thread.start cmd | `host_daemon_commands` | `host_cursor_idx` | Only if env ready |
| 13 | Re-fetch thread | `threads` | PK | Return value |

**Typical path (new managed env): ~11 queries. No N+1. All indexed or PK lookups.**

**Background (title gen, not blocking response): +3-5 queries + 1 AI inference call.**

## Code Reuse

| Function | Also used by |
|---|---|
| `createThreadFromRequest()` | `POST /projects/:id/managers` — identical code path, hard-codes `type: "manager"`, `workspace: "managed-worktree"`, omits `input` |
| `createThreadInEnvironment()` | Internal helper shared between reuse path (A/B) within this same route |
| `buildExecutionOptions()` | `POST /threads/:id/send`, `POST /threads/:id/drafts`, `POST /threads/:id/drafts/:draftId/send` |
| `resolveThreadRuntimeCommandConfig()` | `queueThreadStartCommand()` (used here) + `queueTurnRunCommand()` (used by send/draft-send) |
| `queueCommand()` | Used across the entire command dispatch system — all daemon interactions |
| `generateThreadTitle()` | Only called from thread creation (two call sites within this file, both paths) |

## Flags

1. **`type` field accepted from client but the only consumer-facing route that should create managers is `POST /projects/:id/managers`.**
   - The manager route hard-codes `type: "manager"` and calls `createThreadFromRequest()` internally.
   - Accepting `type` on `POST /threads` means a client could create a `"manager"` thread directly, bypassing the manager route's guardrails (which hard-codes `workspace: "managed-worktree"` and omits `input`).
   - Is there a reason the public thread creation route allows `type: "manager"`? If not, this should be restricted to `"standard"` only.

2. **`sandboxMode` defaults to `"danger-full-access"`** — least restrictive possible. This is filled in server-side by `resolveExecutionOptions()` when the client doesn't send it.
   - Intentional product decision? Worth an explicit confirmation.

3. **`"sandbox-host"` environment type accepted by schema but throws 501 at runtime.**
   - Per AGENTS.md: "Accepted-but-ignored route or command fields are forbidden."
   - Arguably a 501 is "handling" it, but the schema advertises a capability that doesn't exist.

4. **`isDefault` source lookup is filtered in application code, not DB.**
   - `requireDefaultSource` fetches sources by `projectId` (indexed) then filters `isDefault` in JS.
   - Not a bug — small table, low volume — but there's no partial unique index enforcing "one default per project" either (comment in schema acknowledges this).

## Usages

| Caller | Location | Purpose |
|---|---|---|
| `api.createThread()` | `apps/app/src/lib/api.ts:307` | Frontend API client — wraps `apiClient.threads.$post()` |
| `useCreateThread()` hook | `apps/app/src/hooks/useApi.ts:714` | React Query mutation hook wrapping `api.createThread` |
| `ProjectMainView` | `apps/app/src/views/ProjectMainView.tsx:27,182` | Main thread creation flow — user submits prompt from project view |
| CLI `thread spawn` | `apps/cli/src/commands/thread/spawn.ts:163` | Creates a new thread from CLI with prompt, model, environment options |
| `POST /projects/:id/managers` | `apps/server/src/routes/projects.ts:220` | Manager creation route — calls `createThreadFromRequest()` with `type: "manager"` |
| `createHostThread()` | `tests/integration/helpers/api.ts:148` | Integration test helper — creates a host-environment thread via `api.threads.$post()` |
| `createReuseThread()` | `tests/integration/helpers/api.ts:174` | Integration test helper — creates a reuse-environment thread via `api.threads.$post()` |
| Server test | `apps/server/test/public-threads.test.ts:102-391` | Multiple test cases exercising thread creation (various environment types, error cases) |
| Server test | `apps/server/test/public-thread-lifecycle-regressions.test.ts:30-255` | Lifecycle regression tests covering duplicate creation, concurrent paths |
| Server test | `apps/server/test/public-authorization-regressions.test.ts:110` | Authorization test — validates thread creation respects auth rules |
| Server test | `apps/server/test/internal-authorization-regressions.test.ts:194` | Internal auth regression test creating threads |
| Contract test | `packages/server-contract/test/contract.test.ts:77,164` | Validates `createThreadRequestSchema` parsing of valid/invalid payloads |

---

> **Updated 2026-03-29:** DB functions now use RETURNING — post-write re-reads eliminated.

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->

