# Extensible ADE Replatform Plan

## Status

- State: active
- Last updated: 2026-02-26
- Owner: Beanbag core

## Intent

Replatform Beanbag from a task-centric orchestration app into a thread-first, hackable, extensible agentic development environment (ADE), while being intentional about package boundaries and interfaces before introducing a first-class extension runtime.

## Locked Decisions

- Data migration policy: drop task model data completely.
- Trust model: local trusted code only.
- Package naming: rename now (no long-lived legacy package names).
- Repository topology: align folder names with package boundaries now.
- Daemon and agent-server are separate concerns:
  - `@beanbag/agent-server` is a provider RPC/runtime shim layer.
  - `@beanbag/daemon` is the API/WS/orchestration host that depends on `@beanbag/agent-server`.
- Contract gate: package boundaries/API contracts/DB shapes must be strongly typed and documented as part of Phase 5 split.
- Architecture priority: provider/workflow/environment boundaries first, extension type system later.
- Delivery priority: table-stakes product features before scheduler/automation.

## Product Principles

- Thread-first core primitive; no task entity or task-derived UX flows.
- Multi-provider support is table stakes (for example: codex, pi-mono, claude code).
- Multi-environment provisioning support is table stakes (for example: local, worktrees, checkouts, sandbox, cloud sandbox).
- UI primitives should be batteries-included, composable, and replaceable.
- Application layout should support left IA sidebar and center thread surface; right context surfaces are optional composition.
- Prompt input should support modern multimodal workflows (file/image attachments and voice capture).
- Automation/scheduling is important, but follows core table-stakes interaction quality.

## Target Bones (Packages)

### `@beanbag/agent-core`

Provider/workflow/environment agnostic contracts and domain primitives.

- Thread + event domain types
- Provider-neutral normalized message model
- API/protocol contracts
- Capabilities and adapter interfaces
- Shared guards/assertions and decode helpers

### `@beanbag/agent-server`

Runtime bridge over provider backends (for example: `codex app-server`, `pi-mono` RPC mode).

- Provider RPC client lifecycle and protocol mapping
- Environment adapter contracts used by runtime bridge
- Event normalization into `agent-core` envelopes
- Capability discovery and model metadata surfaces

### `@beanbag/daemon`

Orchestration/API host that composes core + runtime bridge + persistence.

- HTTP + WS API contract
- Thread lifecycle orchestration (`spawn/tell/stop/archive`)
- Persistence integration and replay
- Scheduler/automations (later phases)

### `@beanbag/ui-core`

Reusable ADE UI primitives.

- Conversation timeline components
- Prompt composer/input components
- Diff/artifact/operation rendering primitives
- Layout slot primitives for app composition

### `@beanbag/app`

Composed product shell.

- Route composition
- Information architecture
- Default provider/environment wiring
- Default panel and renderer selection

### `@beanbag/db`

Persistence package with schema, repositories, and migrations.

## Folder Topology Target (breaking)

- `packages/core` -> `packages/agent-core`
- `apps/web` -> `apps/app`
- Current mixed `apps/daemon` responsibilities split into:
  - `packages/agent-server` (runtime bridge library)
  - `apps/daemon` (`@beanbag/daemon` host app)

## Boundary-First Interfaces (critical)

No first-class extension loader yet. Start with explicit interfaces and static composition.

### Provider Bridge (`agent-server`)

Responsible for provider protocol mapping and event normalization.

- initialize/start/resume/tell/interrupt
- list models/capabilities
- normalize provider events into persisted core event envelope
- expose provider-specific optional capabilities

### Environment Adapter (`agent-server`)

Responsible for execution context provisioning and cleanup.

- prepare workspace runtime context
- configure shell environment and policies
- support local/worktree/checkout/sandbox/cloud variants
- teardown/cleanup lifecycle

### Thread Orchestrator (`daemon`)

Provider/environment agnostic thread lifecycle coordinator.

- spawn/tell/stop/archive
- event persistence and replay support
- per-thread runtime state handling
- delivery of normalized events to UI/API

### Scheduler Service (`daemon`, later phase)

Durable scheduling for recurring thread operations.

- cron/interval schedule definitions
- trigger thread spawn/tell actions
- run history/status persistence
- guardrails (dedupe, concurrency limit, retry policy)

### UI Contracts (`ui-core`)

Composable rendering and layout seams.

- conversation renderer contracts
- prompt composer contracts
- attachment and voice-input integration seams
- optional right-panel artifact/diff/markdown contracts
- left sidebar IA contracts

## Roadmap

## Phase 1: Task Removal + Package Rename (breaking)

### Goals

- Remove task model and all task-related API/UI/CLI/runtime code.
- Rename package boundaries to new architecture names.

### Completion Snapshot

- Completed in commits:
  - `b169279`, `cc23e63`, `98052fd`, `33f4fbf`
- Task model removed from core/db/daemon/cli/web.
- Thread-first flows validated with green typecheck + tests.

## Phase 2: Boundary Extraction (no extension runtime)

### Goals

- Establish stable provider/environment/workflow boundaries.
- Keep behavior mostly unchanged while moving code to new package architecture.

### Completion Snapshot

- Completed in commit:
  - `07bbe84`
- Added explicit runtime contracts in `@beanbag/agent-core`.
- Daemon composes provider, environment, and scheduler boundaries through registries and interface contracts.

## Phase 3: UI Core Hardening

### Goals

- Deliver high-quality reusable ADE UI components with clear seams.

### Completion Snapshot

- Completed in commit:
  - `50d6ef1`
- Introduced `@beanbag/ui-core` primitives for layout, conversation timeline, prompt composer shell, and context surfaces.
- App currently composes a single-column thread detail by product choice; right context surfaces remain optional composition points.

## Phase 4: Multi-Provider + Multi-Environment First-Party Adapters

### Goals

- Prove interfaces by implementing multiple adapters.

### Completion Snapshot

- Completed in commit:
  - `07bbe84`
- Provider adapters: `codex`, `pi-mono`, `claude-code`.
- Environment adapters: `local`, `worktree`.
- Capability-aware fallback added in server model listing and app prompt options.

## Phase 5: Folder Rename + Daemon/Agent-Server Split (breaking)

### Goals

- Align folders with package boundaries.
- Separate daemon host responsibilities from provider runtime shim responsibilities.

### Scope

- Move folders to target topology:
  - `packages/core` -> `packages/agent-core`
  - `apps/web` -> `apps/app`
  - carve `packages/agent-server` out of current mixed daemon code
- Create `@beanbag/daemon` package in `apps/daemon`.
- Move provider bridge/runtime shim code into `packages/agent-server`.
- Keep API routes/orchestration host in `apps/daemon` and consume exported `agent-server` interfaces.
- Update workspace scripts, Turbo pipeline, Vitest config, docs, and import paths.
- Deliver contract hardening artifacts (see `plans/extensible-ade-contract-hardening.md`):
  - package public API inventory (`agent-core`, `agent-server`, `daemon`, `db`, `ui-core`, `app`)
  - API request/response schema map with typed decode/guard helpers
  - DB table/row shape catalog with ownership and invariants
  - event-table taxonomy: full supported `events.type` list, payload typing source, and lookup/indexing semantics
- Adopt event pipeline boundary:
  - provider-specific event shapes
  - normalization for DB persistence
  - UI projection from normalized events
  - rendering from UI projection model
- Detailed split map: `plans/extensible-ade-phase5-split-map.md`

### Acceptance Criteria

- Folder names and package names are aligned.
- `apps/daemon` imports `@beanbag/agent-server` (no cross-package deep imports).
- Supported thread event types and event payload typing strategy are documented and test-validated.
- Closed internal unions are exhaustively handled with `assertNever`; open external unions use explicit tolerant fallbacks.
- Thread event processing no longer depends on raw provider payload shape in UI projection/render layers.
- `pnpm typecheck` and `pnpm test` pass after moves.

## Phase 6: Table-Stakes Feature Pass

### Goals

- Ship minimum expected ADE capabilities before automation work.

### Scope

- Environment provisioning hardening:
  - local + worktree provisioning UX and lifecycle parity
  - clear provisioning status and errors in thread flow
- Prompt composer improvements:
  - attach files
  - attach/paste images
  - attachment chips + send pipeline + API contract updates
- Voice input:
  - push-to-talk or hold-to-talk capture in web app
  - speech-to-text insertion into composer with graceful fallback
- Detailed execution spec: `plans/extensible-ade-table-stakes-phase6.md`

### Acceptance Criteria

- Users can choose local/worktree execution with predictable provisioning behavior.
- Users can attach files/images in the prompt flow end-to-end.
- Users can use voice input to draft prompt text.
- New capabilities are covered by tests and do not regress existing thread workflows.

## Phase 7: Scheduler/Automations

### Goals

- Add durable scheduling for thread workflows.

### Scope

- Schedule persistence model
- Scheduler service execution and status reporting
- App UI for schedule management and run history

### Acceptance Criteria

- Scheduled thread operations run deterministically and are observable.

## Phase 8: Optional First-Class Extension Runtime

### Goals

- Add a formal extension registration/loading model only after boundaries are stable.

### Scope

- Local trusted extension manifest and loader
- Registration points for provider/environment/panels/renderers/actions
- Versioned extension API contract

### Acceptance Criteria

- Extensions can add behavior without weakening core boundaries.

## Risks and Mitigations

- Risk: boundary leakage during migration.
  - Mitigation: enforce adapter interfaces before adding new capabilities.
- Risk: package/folder rename churn.
  - Mitigation: complete folder moves in one breaking window with focused commit chunks.
- Risk: over-engineering extension model too early.
  - Mitigation: keep static composition until Phase 8.
- Risk: feature debt while refactoring topology.
  - Mitigation: dedicate Phase 6 to table-stakes UX/provisioning before scheduler.

## Definition of Done for Replatform

- Thread-first product with no task model.
- Clear provider/environment/workflow package boundaries.
- Multi-provider and multi-environment adapters proven in production path.
- Reusable UI core powering app shell and thread surface composition.
- Folder topology aligned with package boundaries.
- Table-stakes provisioning + composer (attachments/images/voice) shipped.
- Scheduler/automations implemented for recurring thread workflows.
