# Strong Typing + Exhaustive Union Handling Plan

## Goal

Raise type safety across the codebase by:

1. Auditing for additional stringly-typed shapes that should be discriminated unions or closed enums.
2. Converting closed-union handling to exhaustive `switch` statements with `assertNever`, so new union members fail fast at compile time.

## Scope

- `apps/daemon`, `apps/web`, `apps/cli`, `packages/core`, `packages/db`.
- Internal domain types and app-managed events/statuses.
- Compile-time guarantees first; runtime behavior should remain unchanged.
- Generated code under `packages/core/src/generated/**` is excluded.

## Out of Scope

- Making externally-owned protocols fully closed unions when providers can add new values at runtime.
- Reworking API behavior beyond typing and exhaustive handling.
- Schema/protocol redesign of Codex app-server payloads.

## Investigation Snapshot (Current Code)

- `apps/cli/src/commands/thread.ts` has `statusIcon(status: string)` with a permissive default branch.
- `apps/cli/src/commands/task.ts` already accepts `TaskStatus`, but still has an unreachable `default` fallback.
- `apps/web/src/hooks/useWebSocket.ts` switches on `RealtimeEntity` and is functionally exhaustive, but has no explicit `assertNever` guard.
- `apps/web/src/components/shared/StatusBadge.tsx` uses `Record<string, ...>` and fallback semantics for `ThreadStatus`.
- `apps/web/src/lib/ws.ts` casts arbitrary string segments to `RealtimeEntity` in `parseSubKey`.
- `apps/daemon/src/routes/error-response.ts` maps `code: string` to HTTP status even though `DomainErrorCode` is a closed union in `apps/daemon/src/domain-errors.ts`.
- `apps/daemon/src/thread-manager.ts` contains multiple casts from `unknown`/`Record<string, unknown>` for provider event payloads and execution options.
- `packages/db/src/repositories.ts` has multiple normalization paths (`string` -> union) and legacy fallback behavior.
- `packages/core/src/to-ui-messages.ts` has high-value parser logic with repeated `Record<string, unknown>` decoding and event-type normalization.
- Existing plan item "`TaskStatusIcon` in `ProjectList.tsx`" is stale; that symbol is not present in current code.

## Classification Rubric

- `closed_internal`: Value set is controlled by Beanbag code and should be exhaustive now.
- `open_external`: Value set can expand at runtime (provider/external input); keep tolerant fallback with explicit comment.
- `defer`: Useful but lower value or higher churn; track, do not block current sweep.

## Audit Inventory (Initial)

| Priority | Area | File / Function | Classification | Current Risk | Planned Action |
| --- | --- | --- | --- | --- | --- |
| P0 | CLI | `apps/cli/src/commands/thread.ts` `statusIcon` | `closed_internal` | `string` input hides missing statuses | Type as `ThreadStatus`, exhaustive switch + `assertNever` |
| P1 | CLI | `apps/cli/src/commands/task.ts` `statusIcon` | `closed_internal` | Unreachable default masks future drift | Remove permissive default, use exhaustive pattern |
| P0 | Web | `apps/web/src/hooks/useWebSocket.ts` `switch(entity)` | `closed_internal` | New entity could be ignored silently | Add exhaustive guard with `assertNever` |
| P1 | Web | `apps/web/src/components/shared/StatusBadge.tsx` | `closed_internal` | `Record<string, ...>` fallback hides missing thread statuses | Narrow map to `Record<ThreadStatus, ...>` or exhaustive switch |
| P1 | Web | `apps/web/src/lib/ws.ts` `parseSubKey` | `closed_internal` at API boundary | Unsafe casts to `RealtimeEntity` | Add parser/guard returning validated entity union |
| P1 | Web | `apps/web/src/components/layout/ProjectList.tsx` `isBusyThreadStatus` | `closed_internal` | Partial checks may drift as statuses evolve | Switch-based explicit inclusion with compile-time guard |
| P0 | Daemon | `apps/daemon/src/routes/error-response.ts` `statusFromCode` | `closed_internal` (+ one internal fallback) | `string` code weakens mapping correctness | Type to `DomainErrorCode` plus explicit `"internal_error"` handling |
| P0 | Daemon | `apps/daemon/src/thread-manager.ts` provider event decoding | `open_external` | Broad casts can couple runtime parsing to assumptions | Introduce decode helpers; keep tolerant fallback for unknown provider fields |
| P1 | Daemon | `apps/daemon/src/codex-provider-adapter.ts` event/status helpers | `open_external` | String-based event matching may drift | Keep tolerant event normalization; document open-set behavior |
| P0 | DB | `packages/db/src/repositories.ts` status/type normalizers | mixed (`closed_internal` + legacy/open) | Legacy DB values and broad strings are mixed into domain paths | Split closed-internal paths from legacy/open normalization, document fallback contract |
| P1 | DB | `packages/db/src/repositories.ts` event lookup field derivation | `open_external` | Provider event names are open and normalized ad hoc | Keep tolerant parsing; isolate normalization helper with explicit open-set comments |
| P0 | Core | `packages/core/src/to-ui-messages.ts` parser helpers | mixed | Repeated untyped record parsing across event families | Add focused decode helpers for known event families; keep open fallbacks where needed |
| P2 | Core | `packages/core/src/types.ts` + `packages/core/src/api-types.ts` duplicate unions | `defer` | Potential future drift between duplicated aliases | Track follow-up to consolidate single source of truth |

## Workstream A: Build a Tracked Audit

### A1. Baseline and Query Pass

- Run baseline checks before refactors:
  - `pnpm typecheck`
  - `pnpm -r test`
- Re-run targeted queries and snapshot counts:
  - `rg -n "statusIcon\\(|switch \\(|default:|Record<string, unknown>|as Record<string, unknown>|normalize[A-Za-z]+\\(" apps packages`
  - `rg -n "ThreadStatus|TaskStatus|TaskEventType|ThreadEventType|RealtimeEntity" apps packages`

### A2. Checklist Artifact

- Maintain checklist in this plan file under a new section `## Audit Checklist`.
- For each row include:
  - file/function
  - classification (`closed_internal` / `open_external` / `defer`)
  - planned change
  - test impact
  - status (`todo` / `in_progress` / `done`)

### A3. Prioritization Rules

- Start with `P0` `closed_internal` call sites used across app boundaries.
- Then cover `P1` UX-facing formatters and web/cli render helpers.
- Finally harden parser-heavy `open_external` paths with explicit tolerance boundaries.

## Workstream B: Standardize Exhaustive Union Pattern

### B1. Shared Helper

- Add `assertNever(value: never, message?: string): never` in `packages/core`.
- Export it from `packages/core/src/index.ts`.

### B2. Canonical Usage

- Closed union:
  - `switch (x) { ... default: return assertNever(x); }`
- Open external set:
  - Keep explicit fallback branch with a comment:
  - `// Open provider/runtime set: tolerate unknown values intentionally.`

### B3. Guardrails

- No bare `default` in closed-union switches.
- No `Record<string, ...>` maps keyed by known unions unless keyed as `Record<MyUnion, ...>`.
- Prefer small, typed decode helpers over inline casts in parser code.

## Workstream C: Package-by-Package Plan

### C1. CLI (`apps/cli`)

- Convert `thread` and `task` status icon helpers to exhaustive closed-union handling.
- Update tests in `apps/cli/src/__tests__/helpers.test.ts`:
  - remove runtime "unknown status" assertions for closed-union helper
  - add assertions for every legal `ThreadStatus`/`TaskStatus` value

### C2. Web (`apps/web`)

- Add exhaustive handling for `RealtimeEntity` in `apps/web/src/hooks/useWebSocket.ts`.
- Replace `Record<string, ...>` thread-status variant map in `apps/web/src/components/shared/StatusBadge.tsx` with union-safe mapping.
- Harden `parseSubKey` in `apps/web/src/lib/ws.ts` with a runtime entity guard.
- Make `isBusyThreadStatus` in `apps/web/src/components/layout/ProjectList.tsx` explicitly union-aware.

### C3. Daemon (`apps/daemon`)

- Tighten `statusFromCode` typing in `apps/daemon/src/routes/error-response.ts` around `DomainErrorCode`.
- Refactor provider event decoding in `apps/daemon/src/thread-manager.ts`:
  - isolate decode helpers for known fields
  - keep tolerant handling for open provider event payloads
- Review adapter methods in `apps/daemon/src/codex-provider-adapter.ts` and `apps/daemon/src/provider-adapter.ts`:
  - identify closed-union branches vs open provider branches
  - enforce exhaustive handling only for closed sets

### C4. Core (`packages/core`)

- Add and export `assertNever`.
- Incrementally refactor `packages/core/src/to-ui-messages.ts`:
  - extract typed helpers for high-traffic event families (`exec`, `file-change`, `web-search`)
  - reduce repeated `as Record<string, unknown>` casts for known payload shapes
  - preserve tolerant behavior for unknown/unversioned provider payloads
- Extend `packages/core/test/to-ui-messages.test.ts` with coverage for:
  - unknown external event forms (tolerant behavior retained)
  - closed internal projections remaining exhaustive

### C5. DB (`packages/db`)

- Split normalization intent in `packages/db/src/repositories.ts`:
  - explicit closed union conversions for internal writes/reads
  - explicit legacy/open fallback for old DB/event payloads
- Keep backward-compatibility branches (`running` thread status, legacy task-chat event types), but mark as intentionally tolerant.
- Add first-pass repository tests if none exist, focused on normalization and fallback behavior.

## Workstream D: Verification and Regression Safety

### D1. Required Validation Commands

- `pnpm typecheck`
- `pnpm -r test`
- Package-focused runs while iterating:
  - `pnpm --filter @beanbag/core test`
  - `pnpm --filter @beanbag/cli test`
  - `pnpm --filter @beanbag/daemon test`
  - `pnpm --filter @beanbag/web test` (where relevant)

### D2. Regression Checklist

- Thread and task status renderers show unchanged icons/labels.
- WebSocket invalidation still triggers for thread/task changes.
- Route error code to HTTP status mapping is unchanged for all known `DomainErrorCode`s.
- UI projection (`toUIMessages`) remains deterministic and stable for fixture replay.
- Legacy DB/task event compatibility behavior remains intact.

## Execution Plan (Incremental PRs)

### PR 1 (Small): Pattern Foundation

- Add `assertNever` in core and export it.
- Add short doc section in `docs/` or `README` on closed vs open unions.
- Convert 2-3 low-risk closed-union call sites (`CLI status icons`, `web RealtimeEntity switch`).

### PR 2 (Medium): Web + Daemon Closed-Union Sweep

- Tighten `StatusBadge`, `ProjectList` status helper, and route error code mapping.
- Add/adjust tests for touched helpers and route mapping.

### PR 3 (Medium): Parser and Adapter Hardening

- Refactor high-value decode paths in `thread-manager` and `to-ui-messages`.
- Keep explicit comments where open external fallback is required.

### PR 4 (Small/Medium): DB Normalization and Cleanup

- Clarify closed vs legacy/open normalization branches in repository code.
- Add/extend tests around normalization and compatibility behavior.
- Close checklist items marked `closed_internal`; leave `defer` items tracked.

## Risks and Mitigations

- Provider protocol drift: keep `open_external` fallbacks with explicit comments and tests.
- Legacy data compatibility regressions: preserve existing fallback semantics and add targeted tests before refactor.
- Over-tightening externally-owned values: require explicit classification before using `assertNever`.
- Large parser refactors in one pass: split by event family and validate incrementally.

## Acceptance Criteria

- Closed internal union handlers are exhaustive and guarded with `assertNever`.
- No new `status: string`/`type: string` patterns are introduced for Beanbag-owned closed sets.
- High-value parser paths avoid repeated blind record casts when payload shape is known.
- Tolerant fallback branches remain only in explicitly classified `open_external` paths.
- `pnpm typecheck` passes and relevant package tests pass.
- Audit checklist entries for `P0` and selected `P1` targets are complete or explicitly deferred.

## Deliverables

- Updated plan (`plans/typing-audit-and-exhaustive-unions.md`) with:
  - investigation-backed inventory
  - classification and prioritization
  - phased execution and validation details
- A maintained checklist section tracking each audited hotspot through completion.
