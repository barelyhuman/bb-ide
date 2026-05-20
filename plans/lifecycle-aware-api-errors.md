# Lifecycle-Aware API Errors

## Goal

When a request fails because a resource is in a non-default lifecycle state — destroyed, archived, pending deletion, still provisioning, suspended, disconnected — the server should say so in a way the frontend can render as a useful, state-specific message. Today we collapse 5+ distinct internal states into one opaque `"Environment is not ready"` 409 (or equivalent), and the frontend renders the raw HTTP string. This plan fixes the class of bug, not the individual instances.

Trigger for this plan: the diff panel on an archived thread shows `HTTP 409: Environment is not ready`. The underlying environment was destroyed by archive cleanup, but neither the server response nor the panel says so.

## TL;DR

- Add a typed `details` channel to `ApiError` (already foreshadowed by `environmentActionApiErrorSchema`).
- Define a closed set of lifecycle error codes (`environment_not_ready`, `thread_not_writable`, `thread_environment_unavailable`, `host_unavailable`, `project_unavailable`) with discriminated-union `details` payloads.
- Fix the `require*` helpers in `apps/server/src/services/lib/entity-lookup.ts` to throw these typed errors. That alone covers ~8 of 25 call sites.
- Convert the remaining ~17 direct throws in `thread-send.ts`, `thread-create.ts`, `thread-turn-dispatch.ts`, `thread-lifecycle.ts`, `queued-drafts.ts`, `pending-interactions.ts`, `environment-provisioning.ts`.
- Introduce a single FE helper `describeLifecycleError(error, context)` that consults the loaded `thread`/`environment`/`project`/`host` to produce a state-aware message. Wire it into the 4 sites that render raw error messages.
- Reference the working pattern at `apps/app/src/components/workspace/workspace-status.tsx:getGitStatusDisplay` — that's the shape we want.

## Scope

### In scope

- The 25 server throw-sites enumerated below.
- The 4 frontend render-sites that show raw `error.message`.
- The shared `ApiError` body schema and the closed enum in `packages/server-contract/src/errors.ts`.

### Out of scope

- Replacing toast/notification UX everywhere. We keep `getMutationErrorMessage` as-is; this plan adds a richer alternative for lifecycle-specific surfaces, not a rewrite of all error UX.
- Internationalization of the new FE messages. English strings only; structure them so i18n is a future drop-in.
- Telemetry/logging changes. Server-side logs already include enough context; this plan is about the wire contract.

## Current State

### Server: 25 call sites collapsing lifecycle into opaque messages

Grouped by helper or service:

**Entity-lookup helpers (`apps/server/src/services/lib/entity-lookup.ts`)** — fix the helper, fix many call sites:

- `requireReadyEnvironment` (line 144) — collapses 5 environment statuses + missing path into one 409. Reached by `GET /environments/:id/diff`, `/diff/file`, `/diff/branches`, `/status`, `POST /environments/:id/actions`. **This is the diff-panel bug.**
- `requirePublicProject` (line 98) — `404 "project_not_found"` even when a delete operation is in flight.
- `requireNonDestroyedHostWithStatus` (line 68) — `404 "host_not_found"` collapses destroyed vs. never-existed.
- `requireConnectedHostSession` (line 79) — `502 "host_disconnected"` collapses suspended vs. disconnected.
- `requireThreadEnvironment` (line 159) — `409 "Thread has no environment"` collapses never-attached vs. cleaned-up.

**Thread send/dispatch/create**:

- `thread-turn-dispatch.ts:50` — `requireReadyThreadEnvironment` (same 5→1 collapse).
- `thread-turn-dispatch.ts:71` — `queueTurnDuringReprovision` (knows `status === "provisioning"` but throws generic).
- `thread-create.ts:224–231` — reuse-environment flow, 3 conditions → 1 message.
- `thread-send.ts:72–94` — `ensureThreadIsWritable` and `resolveSendMode`: archived / stopping / not-active / already-active collapsed.
- `thread-send.ts:103–120` — `ensureRuntimeCanAcceptActiveSend` drops `runtime.displayStatus` granularity.
- `thread-send.ts:130–136` — `senderThreadId must reference a live thread` (deleted vs. non-existent).
- `thread-lifecycle.ts:325–334` — `ensureThreadCanQueueStartRequest`.
- `thread-runtime-config.ts:110` — same `Environment is not ready` text in a different code path.
- `thread-parent.ts:40–56` — collapses archived / deleted / wrong-type / wrong-project into one 400.

**Other**:

- `routes/threads/actions.ts:179` — stop endpoint, `Thread is not active`.
- `queued-drafts.ts:132`, `:234` — `Thread has no environment` again.
- `environment-provisioning.ts:829` — `Environment cannot be reprovisioned automatically` (loses managed vs. wrong-provision-type).
- `pending-interactions.ts:524–540` — partial: two distinct messages but no lifecycle reason.
- `internal/session-state.ts:10` — `Session is not active`.

Counterexample to follow: `apps/server/src/services/threads/thread-commands.ts:617` (`thread_archive_in_progress`) already uses a specific code. The pattern works; it's just not applied consistently.

### Frontend: 4 sites rendering raw error messages

- `apps/app/src/components/secondary-panel/ThreadSecondaryPanel.tsx:355` — renders `gitDiffError.message` raw. The diff-panel symptom.
- `apps/app/src/components/secondary-panel/ManagerThreadStorageBrowser.tsx:91` — `<EmptyState message={filesError.message} />`.
- `apps/app/src/components/secondary-panel/git-diff/useEnvironmentMergeBase.ts:150` — toast with server message, no transient-vs-real distinction.
- `apps/app/src/components/workspace/workspace-status.tsx:85–92` — partial: handles 404 `path_not_found` but ignores environment status and thread `archivedAt`.

Reference implementation to extend: `getGitStatusDisplay` (same file) already branches on `error` + `workspaceDeleted` to return a state-specific display.

### Existing contract precedent

`packages/server-contract/src/api-types.ts:1101` — `environmentActionApiErrorSchema = apiErrorSchema.extend({ details: ... })` already exists for the commit/squash flow. This plan generalizes that pattern.

## Architectural Approach

Three contract gaps cause the 25 + 4:

1. `ApiError` body has no structured `details` channel — only `code` + `message`. `code` is `invalid_request` for ~all 25.
2. `require*` helpers throw-or-return; no way to surface a typed rejection reason.
3. No FE convention for "fetch failed because resource is mid-lifecycle." Every panel reinvents (or skips) the check.

Fix all three:

1. Extend `ApiErrorBody` with optional `details: unknown`. Define closed schemas per code.
2. Rewrite the helpers (and direct throw sites) to populate `details`.
3. Add `describeLifecycleError` on the FE; wire the 4 render sites.

## Implementation Phases

### Phase 1: Extend the `ApiError` contract

**Goal:** Make typed `details` a first-class part of the error envelope, and define the closed set of lifecycle codes.

**Changes:**

- `apps/server/src/errors.ts`:
  - Add optional `details?: unknown` to `ApiErrorBody`.
  - Extend the `ApiError` constructor to accept an optional `details` arg (`new ApiError(409, "environment_not_ready", "...", { details: {...} })`). Prefer an options-object constructor over a 5th positional to keep call sites readable.
  - `toResponse` already serializes `body` — no change needed.
- `packages/server-contract/src/errors.ts`:
  - Add the new closed codes to `domainErrorCodeSchema`: `environment_not_ready`, `thread_not_writable`, `thread_environment_unavailable`, `host_unavailable`, `project_unavailable`, `parent_thread_invalid`.
  - Add a discriminated-union `lifecycleErrorDetailsSchema` keyed by code, plus per-code envelope schemas (`environmentNotReadyApiErrorSchema = apiErrorSchema.extend({ code: z.literal("environment_not_ready"), details: ... })`).
  - Export the union as `LifecycleApiError`.
- Detail shapes (initial cut — verify against actual call-site needs in Phase 2/3):
  - `environment_not_ready`: `{ environmentStatus: EnvironmentStatus, hasPath: boolean, cleanupRequestedAt: number | null }`
  - `thread_not_writable`: `{ reason: "archived" | "stopping" | "deleted" | "not_started" | "errored" | "already_active", archivedAt: number | null, stopRequestedAt: number | null, threadStatus: ThreadStatus }`
  - `thread_environment_unavailable`: `{ reason: "never_attached" | "destroyed" | "destroying" | "provisioning" | "errored", environmentStatus: EnvironmentStatus | null }`
  - `host_unavailable`: `{ reason: "suspended" | "disconnected" | "destroyed", suspendedAt: number | null, destroyedAt: number | null }`
  - `project_unavailable`: `{ reason: "deleted" | "pending_deletion", deletedAt: number | null }`
  - `parent_thread_invalid`: `{ reason: "not_found" | "archived" | "deleted" | "wrong_project" | "not_a_manager" }`
- Routes that document specific error envelopes (per the public-API style of `EnvironmentActionApiError`) should reference the new envelopes for these codes.

**Exit criteria:**

- `apiErrorSchema` carries optional `details: z.unknown().optional()` and the new per-code envelopes parse via their discriminator.
- `pnpm exec turbo run typecheck --filter=@bb/server-contract --filter=@bb/server` passes.
- No call-site changes yet — just the schema and constructor.

### Phase 2: Rewrite entity-lookup helpers

**Goal:** Fix the diff-panel bug and ~7 other sites by changing 5 helper functions.

**Changes (all in `apps/server/src/services/lib/entity-lookup.ts`):**

- `requireReadyEnvironment` (line 144): throw with code `environment_not_ready` and `details: { environmentStatus, hasPath, cleanupRequestedAt }`. Keep the human message short and generic — the FE owns user-facing copy.
- `requireThreadEnvironment` / `requirePublicThreadEnvironment` (lines 159, 173): when `environmentId` is null, throw `thread_environment_unavailable` with `reason: "never_attached"`. When the environment was destroyed, throw with `reason: "destroyed"` and the real status.
- `requirePublicProject` (line 98): when an active `project_operation { kind: "delete" }` exists, throw `project_unavailable` with `reason: "pending_deletion"`. Keep `404 "project_not_found"` for genuinely missing IDs.
- `requireNonDestroyedHostWithStatus` (line 68): distinguish `404 "host_not_found"` from `host_unavailable` `reason: "destroyed"` when `destroyedAt !== null`.
- `requireConnectedHostSession` (line 79): use `toHostStatus()` (already in the file at lines 17–29) to throw `host_unavailable` with `reason: "suspended" | "disconnected"`.

**Exit criteria:**

- Every `throw new ApiError(...)` in `entity-lookup.ts` either keeps a still-generic code (e.g. true `not_found`) or uses one of the new typed codes with populated `details`.
- Diff panel symptom: hitting `GET /environments/:id/diff` for an archived thread's destroyed environment returns `{ code: "environment_not_ready", details: { environmentStatus: "destroyed", ... } }`. Verify with `curl` against a dev server.
- `pnpm exec turbo run test --filter=@bb/server` passes; update any tests that asserted on the old generic message.
- `pnpm exec turbo run typecheck --filter=@bb/server` passes.

### Phase 3: Convert the remaining direct throw sites

**Goal:** Close the gap on the ~17 sites that don't route through the helpers.

**Changes** — for each site, replace the generic `invalid_request` throw with the appropriate typed code:

- `thread-turn-dispatch.ts:50, 71` — `environment_not_ready` (line 50 mirrors the helper; line 71 has explicit `status === "provisioning"` so emit that reason).
- `thread-create.ts:224, 228, 231` — `environment_not_ready` with the actual status; the three branches map to three distinct detail payloads (provisioning, ready-without-path, error/destroyed).
- `thread-runtime-config.ts:110` — `environment_not_ready`.
- `thread-send.ts:72–94` — split into:
  - `thread_not_writable` reason `"archived"` (line 72).
  - `thread_not_writable` reason `"stopping"` (line 76).
  - `thread_not_writable` reason `"already_active"` (line 85).
  - `thread_not_writable` reason derived from `threadStatus` (line 91).
- `thread-send.ts:103` — `host_unavailable` with `runtime.displayStatus`-derived reason.
- `thread-send.ts:130` — `parent_thread_invalid` reasons (sender-thread case may want its own code if it diverges; otherwise extend `parent_thread_invalid` to cover "sender").
- `thread-send.ts` queued-draft `Thread has no environment` (`queued-drafts.ts:132, 234`) — `thread_environment_unavailable`.
- `thread-parent.ts:40–56` — `parent_thread_invalid` with the 4 distinct reasons.
- `thread-lifecycle.ts:325` — `thread_not_writable` reason `"still_starting"` (add to enum if absent).
- `routes/threads/actions.ts:179` (stop endpoint) — `thread_not_writable` reason derived from `status` + `stopRequestedAt`.
- `environment-provisioning.ts:829` — keep code generic but add `details: { managed, workspaceProvisionType }`.
- `pending-interactions.ts:524, 536` — `thread_environment_unavailable` for both.
- `internal/session-state.ts:10` — internal-only; leave generic unless a daemon path surfaces it to the user.

**Exit criteria:**

- `grep -rn "Environment is not ready" apps/server/src/` returns zero hits (the string is centralized or replaced).
- `grep -rn 'ApiError(.*"invalid_request"' apps/server/src/services/threads apps/server/src/services/environments apps/server/src/services/projects` returns only legitimate cases (validation errors, not lifecycle).
- Server tests updated to assert on `code` + `details.reason` rather than human-string `message`.
- `pnpm exec turbo run test --filter=@bb/server` passes.

### Phase 4: Frontend lifecycle-aware error rendering

**Goal:** Replace the 4 raw-message sites with a single state-aware helper.

**Changes:**

- New module `apps/app/src/lib/lifecycle-errors.ts`:
  - Re-export the per-code envelope types from `@bb/server-contract`.
  - Function `parseLifecycleError(error: unknown): LifecycleApiError | null` — narrows `HttpError.body` against the union schema; returns `null` for non-lifecycle errors.
  - Function `describeLifecycleError(error, context)` returning `{ title: string, body: string, severity: "info" | "warning" | "error" }`. `context` carries the already-loaded `thread`, `environment`, `project`, `host` (each optional) so the message can reach for `thread.archivedAt`, `environment.cleanupRequestedAt`, etc. Each code/reason combo gets a tested branch.
- Wire the helper:
  - `ThreadSecondaryPanel.tsx:355` — replace the raw render with `describeLifecycleError({ error: gitDiffError, context: { thread, environment } })`. If `parseLifecycleError` returns null, fall back to today's `getMutationErrorMessage` fallback.
  - `ManagerThreadStorageBrowser.tsx:91` — same swap, with `{ thread }` context.
  - `useEnvironmentMergeBase.ts:150` — when the error is a `environment_not_ready` with reason "provisioning", suppress the toast (it's transient); for other lifecycle reasons, use `describeLifecycleError`.
  - `workspace-status.tsx:getGitStatusDisplay` — extend its existing switch to consume `parseLifecycleError`; keep its `workspaceDeleted` flag for non-error states. This is mostly absorption, not rewrite.
- Do not retrofit toasts everywhere. `getMutationErrorMessage` keeps working for mutations that aren't lifecycle-driven; the new helper is opt-in for surfaces where state-aware copy matters.

**Exit criteria:**

- `apps/app/src/lib/lifecycle-errors.ts` exists with unit tests covering each code and each reason; tests are colocated and run under `pnpm exec turbo run test --filter=@bb/app`.
- The diff panel on an archived thread shows e.g. *"This workspace was cleaned up when the thread was archived."* — not `HTTP 409: ...`.
- `grep -n "error\.message" apps/app/src/components/secondary-panel/ apps/app/src/components/workspace/` returns no hits in render JSX (lib internals are fine).

### Phase 5: Validation

**Automated:**

- `pnpm exec turbo run typecheck --filter=@bb/server --filter=@bb/server-contract --filter=@bb/app`
- `pnpm exec turbo run test --filter=@bb/server --filter=@bb/app --force > /tmp/lifecycle-errors-test.log 2>&1` then read the log (per AGENTS.md testing guidance).
- New server test per affected route asserting the `code` + `details.reason` for each lifecycle branch. Real DB via `createConnection(":memory:") + migrate(db)`; no mocked DBs.

**Manual smoke** (each via the app URL and data dir printed by `pnpm dev`):

1. Create a managed-worktree thread; archive it; wait for cleanup sweep to destroy the env (`sqlite3 <data>/bb.db "SELECT id, status FROM environments WHERE id = '...';"` to confirm `status = "destroyed"`). Navigate to the archived thread's diff panel. **Expected:** state-specific message, not `HTTP 409`.
2. While an environment is still provisioning, send a message to its thread. **Expected:** banner says "still provisioning," not a generic 409 toast.
3. Suspend the host (or simulate it via DB write). Try to send a message. **Expected:** "Host is paused" — distinct from "Host lost connection."
4. Delete a project (or mark `project_operation { kind: "delete", state: "pending" }`). Hit any project-scoped route. **Expected:** "Project is being deleted," not "project not found."
5. Try to create a thread with `parentThreadId` pointing at an archived manager. **Expected:** "Parent manager thread is archived," not the four-condition generic 400.

## Risks and Open Questions

- **Detail shape churn.** The initial detail schemas in Phase 1 are a guess. Lock them in Phase 2 as the first helpers get wired; renames before Phase 3 are cheap, after are not.
- **Old clients seeing new codes.** The base `apiErrorSchema` already accepts open `code: z.string()`, so clients that don't recognize a new code degrade to the `message` string — same UX as today. Safe.
- **Test churn.** Many server tests assert on `body.message` strings. Phase 2/3 will need to convert those to `body.code` + `body.details` assertions. Worth doing — it makes the tests structural instead of brittle-by-copy.
- **Should `senderThreadId` share `parent_thread_invalid` or get its own code?** Decide during Phase 3 — they share three of four reasons but the user-facing copy differs.
- **i18n.** The FE strings in `describeLifecycleError` will be the eventual translation keys. Structure them centrally so a future i18n pass is a single-file change.

## Done When

- All 25 server throw-sites use typed codes with populated `details`, verified by tests asserting on the structured fields.
- All 4 frontend render-sites consume `describeLifecycleError`; none renders raw `error.message`.
- The original symptom (archived-thread diff panel) shows a state-specific message in dev.
- `pnpm exec turbo run typecheck` and `pnpm exec turbo run test` pass across `@bb/server`, `@bb/server-contract`, `@bb/app`.
- `grep -rn "Environment is not ready" apps/` returns zero non-comment matches.

Delete this file once shipped.
