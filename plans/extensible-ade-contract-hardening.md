# Extensible ADE Contract Hardening Plan

## Purpose

Define and enforce strongly typed, documented contracts across package boundaries, API surfaces, and database shapes while executing the Phase 5 split.

This is a Phase 5 gate, not optional follow-up work.

## Status

- State: completed
- Completed on: 2026-02-26
- Deliverables landed:
  - `docs/contracts/packages.md`
  - `docs/contracts/http-api.md`
  - `docs/contracts/db-shapes.md`
  - `docs/contracts/thread-events.md`
- Implementation landed:
  - typed provider event envelope + decode helpers in `@beanbag/agent-core`
  - daemon ingestion writes normalized provider envelopes
  - DB lookup extraction reads normalized envelopes with legacy fallback
  - UI projection unwraps normalized envelopes before rendering

## Goals

- Make package boundaries explicit and stable.
- Remove ambiguous runtime `unknown` handling at boundary crossings.
- Document exactly which thread events are persisted and rendered.
- Keep tolerant parsing only where values are provider-owned/open-external.

## Scope

- `@beanbag/agent-core`: domain/event unions, guards, decode helpers.
- `@beanbag/agent-server`: provider/environment runtime bridge contracts.
- `@beanbag/daemon`: HTTP/WS contracts and orchestration boundaries.
- `@beanbag/db`: persisted shapes, invariants, and lookup semantics.
- `@beanbag/app` and `@beanbag/ui-core`: API consumption contracts (typed by core).

## Contract Inventory (Artifacts)

- `docs/contracts/packages.md`
  - public exports per package
  - allowed dependency direction between packages
- `docs/contracts/http-api.md`
  - endpoint request/response schemas
  - error envelope taxonomy
- `docs/contracts/db-shapes.md`
  - tables, columns, ownership, migration notes
  - repository mapping rules
- `docs/contracts/thread-events.md`
  - full supported `events.type` taxonomy
  - payload typing source and normalization behavior
  - persistence/index lookup semantics

## Event Table Contract (Required)

Source today:

- `ThreadEventType` in `@beanbag/agent-core` (`CodexServerNotificationMethod | AppThreadEventType`)
- persisted row shape in `packages/db/src/schema.ts` (`events` table)

Required deliverables:

- Canonical event taxonomy grouped by category:
  - provider notifications (open-external, generated from codex schema)
  - app-defined events (`client/thread/start`, `client/turn/start`, `system/error`)
- Field semantics for `events` columns:
  - `type`, `norm_type`, `turn_id`, `provider_thread_id`
  - `is_turn_lifecycle`, `is_thread_identity`
  - `data` payload constraints and decoder ownership
- Decoder policy:
  - strict typed decoders for closed internal events
  - explicit tolerant parsing notes for provider-owned/open-external events

## Event Pipeline Target Architecture (Required)

Current pain:

- Provider raw event payloads are effectively persisted and interpreted downstream.
- UI projection logic still needs to reason about provider-flavored shape variations.

Target pipeline:

1. Provider-specific event shapes (open-external, runtime-owned)
2. Normalization into canonical persisted event shape (closed-internal, core-owned)
3. UI projection from canonical persisted shape (closed-internal)
4. Rendering from stable UI message model (closed-internal)

Design requirements:

- Provider-specific parsing lives in `@beanbag/agent-server`.
- Persisted event schema and discriminants live in `@beanbag/agent-core` and `@beanbag/db`.
- UI projection (`toUIMessages`) consumes canonical normalized events, not provider-specific raw payload assumptions.
- Unknown provider payload changes should be contained to normalization boundaries.

Proposed event contract layers:

- `ProviderEventEnvelope` (open-external): adapter input/output around provider runtime.
- `NormalizedThreadEvent` (closed-internal): canonical persisted event model.
- `UIMessage` (closed-internal): rendering projection model.

Migration strategy:

- Introduce canonical normalized event model and writer path first.
- Preserve compatibility read path for legacy rows during rollout.
- Add version marker for persisted payload format (for example `event_format_version` metadata).
- Remove legacy projection branches after migration window and test confidence.

## Type-Hardening Workstreams

## 1) Union classification and ownership

- Mark each union domain as:
  - `closed_internal`: owned by Beanbag, exhaustive handling required
  - `open_external`: provider/runtime owned, tolerant fallback allowed
- Apply to:
  - event categories
  - thread status and orchestrator states
  - realtime protocol entities and message discriminants

## 2) Decode helpers at boundaries

- Add/reuse typed decode helpers in `@beanbag/agent-core` for:
  - event payload parsing
  - persisted JSON payload decode paths in repositories
  - API body/query decode where schema coercion is needed
- Replace repeated record-casting utilities where feasible with typed helpers.

## 3) Exhaustiveness enforcement

- Require `assertNever` in closed internal discriminated switches.
- For open external values, require explicit fallback branch with comment that unknowns are expected.

## 4) DB contract and repository mapping

- Document and test repository invariants:
  - event sequence monotonicity per thread
  - `norm_type` normalization strategy
  - turn/thread identity extraction behavior
- Add targeted tests for contract invariants and decode failures.
- Validate that repository read APIs return canonical normalized events.

## 5) Contract drift prevention

- Add CI-visible checks:
  - typecheck coverage for all packages
  - tests for event taxonomy and schema mapping
- Add a lightweight script/test that fails when documented internal event types diverge from type definitions.

## Acceptance Criteria

- Contract docs exist for package APIs, HTTP schemas, DB shapes, and thread events.
- Event-table taxonomy is explicit, current, and validated by tests.
- Closed internal unions use exhaustive handling.
- Open external fallbacks are deliberate and documented.
- No untyped cross-package boundary is left undocumented.

## Suggested Implementation Order

1. Write contract docs from current code (baseline snapshot).
2. Add/centralize decode helpers in `agent-core`.
3. Update repository/API code to consume helpers.
4. Add event taxonomy tests and drift checks.
5. Complete folder split and daemon/agent-server extraction with contracts already pinned.
