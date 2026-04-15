# Data and Domain Layer Boundary Cleanup

## Diagnosis

`@bb/domain` has a healthy core of genuinely shared business vocabulary: Thread, Project, Environment, Host, execution policies, lifecycle states, realtime change kinds, ThreadEvent discriminated unions. These are correctly placed — ≥2 packages consume each.

Two categories of types have accumulated where they don't belong:

1. **Persistence shapes leaking into domain.** `stored-thread-event.ts` defines `StoredThreadEventData` and row-shaped types that describe how events are stored in SQLite. "What events exist" is a domain concept; "how they're stored" is a db implementation detail. Other packages shouldn't see the storage shape.

2. **JSON-RPC envelope types leaking into domain.** `provider-event.ts` includes `ProviderRawEvent` and `ProviderUnhandledEvent` — JSON-RPC envelopes describing the transport between host-daemon and provider processes. The structured `ProviderEvent` (what a provider did) is domain; the raw envelope is agent-runtime internal.

`@bb/db` itself is healthy — schema migrations are clean, queries use indexed WHERE/JOIN patterns, no load-and-filter-in-JS antipatterns visible.

## Phase 1: Move stored-event shapes from domain to db

**Goal:** Persistence types live with the persistence layer.

**Changes:**
- Move `packages/domain/src/stored-thread-event.ts` to `packages/db/src/internal/stored-events.ts`.
- Export `StoredThreadEventData` and `parseStoredThreadEvent` from db's internal surface (not public — only db's own query helpers consume them).
- Remove from `packages/domain/src/index.ts`.
- Update `packages/db/src/data/events.ts` to import from the new internal location.

**Check first:** `git grep StoredThreadEventData -- packages/*/src` to confirm no non-db package currently imports it. If any do, their consumption is a symptom of a separate wrong-layer issue — surface it before proceeding.

**Exit criteria:**
- `packages/domain/src/index.ts` no longer exports `StoredThreadEventData` or `parseStoredThreadEvent`.
- Only `packages/db` imports them.
- `pnpm exec turbo run typecheck` passes.

## Phase 2: Move JSON-RPC envelope types to agent-runtime

**Goal:** Transport shapes are owned by the package doing the transport.

**Changes:**
- Move `ProviderRawEvent`, `ProviderUnhandledEvent`, and any JSON-RPC-envelope schemas from `packages/domain/src/provider-event.ts` to `packages/agent-runtime/src/internal/provider-raw-event.ts`.
- Keep `ProviderEvent` (the *structured* event the provider produced) in domain. That's the shared concept.
- Update agent-runtime imports to use the internal location.

**Check first:** `git grep ProviderRawEvent -- packages/*/src` to confirm only agent-runtime (and possibly audit tooling) imports it. If server or UI depend on it, they shouldn't — flag before proceeding.

**Exit criteria:**
- `packages/domain/src/provider-event.ts` exports only structured event types.
- `packages/agent-runtime/src/internal/` contains raw envelope types.
- `pnpm exec turbo run typecheck` passes.

## Out of scope — considered and declined

- **Creating a `@bb/ui-contract` package for `ViewMessage`/`ViewTurn`/`TimelineRow`.** These types ARE shared between `core-ui`, `ui-core`, and `apps/app` — they belong in domain by the same "shared vocabulary" test. Splitting them out would cost a new package boundary to no benefit, and a prior draft of this plan proposed re-exports to smooth the transition, which AGENTS.md forbids.
- **Optional-field documentation audits on `ThreadExecutionOptions`, `PendingInteraction*`, etc.** These are fine as-is, or the audit belongs with the server-stack cleanup that actually uses them, not here.
- **`.all()` query audit in db.** Spot-checked; no load-and-filter antipatterns spotted. If a concrete performance issue surfaces, address it then, not preemptively.
- **Dead columns from early migrations (`provisioner_id`, `provisioner_state`).** Unused but harmless. Cleaning them up requires a migration, which is disproportionate.

## Expected impact

Small. Two files move. Import graphs get cleaner: a package that only cares about domain concepts no longer transitively pulls in stored-event row shapes or JSON-RPC envelope types. No behavior change, no tests change materially.

This plan is intentionally small. Domain is mostly fine — don't make work for its own sake.
