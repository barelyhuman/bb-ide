## Goal

Replace the current `Orchestrator`-centered server architecture with a contract-first design driven by explicit external boundaries.

The end state should have:

- no mega `ThreadOrchestrator` interface
- no route family depending on a god object
- explicit, versionable contract modules for each server surface
- Zod validation at every external boundary, including response shapes
- strongly typed internal handler inputs/outputs with no `unknown` or open-ended `Record<string, unknown>` payloads in boundary-facing code
- no legacy/backward-compat branches kept only because of prior data or rollout concerns

## Scope

In scope:

- HTTP API contracts for:
  - `/projects`
  - `/threads`
  - `/environments`
  - `/system`
- env-daemon HTTP ingress contracts under `/environments/:id/env-daemon/*`
- replacement of `ThreadOrchestrator` and related route dependencies with new handler/service contracts
- server composition in `apps/server/src/server.ts` and `apps/server/src/routes/index.ts`
- deletion of obsolete compatibility branches, optional fallbacks, and legacy contract drift once the new system is in place
- updating tests to validate the new contract-first architecture

Out of scope:

- preserving current internal abstractions for their own sake
- incremental bridge layers intended only to support overlapping old/new implementations
- preserving persisted data or legacy behavior that exists only for backward compatibility

Constraints to honor:

- treat this as a flag-day migration
- assume data can be reset or deleted
- prefer architectural clarity over compatibility
- be explicit about every accepted/requested shape

## Implementation Steps

1. Inventory and rationalize the external surfaces.

Create a single contract inventory document in code comments or a design note that enumerates every route and env-daemon ingress path, grouped by actor:

- project management
- thread commands
- thread queries
- workspace/git queries
- environment operations
- system/status/catalog
- env-daemon session lifecycle
- env-daemon event ingress
- env-daemon provider request ingress

For each endpoint, decide one of:

- keep as-is
- rename/restructure
- remove as drift

This is the stage where contract changes are allowed. Do not preserve awkward shapes just because the current `Orchestrator` exposes them.

2. Define dedicated contract modules before reimplementing behavior.

Create boundary modules that export both Zod schemas and inferred types. A suggested layout:

- `apps/server/src/contracts/http/projects.ts`
- `apps/server/src/contracts/http/threads.ts`
- `apps/server/src/contracts/http/environments.ts`
- `apps/server/src/contracts/http/system.ts`
- `apps/server/src/contracts/env-daemon.ts`

For each endpoint or message family, define:

- params schema
- query schema
- body schema
- success response schema
- structured error response schema if the route returns domain errors beyond the common envelope

Rules for these modules:

- use strict object schemas
- prefer discriminated unions over open objects
- forbid `unknown` in route-visible payloads
- avoid `Record<string, unknown>` in boundary-visible shapes
- make nullability explicit
- define response schemas, not just request schemas

3. Replace `ThreadOrchestrator` with route-facing handler contracts.

Delete the idea of one interface serving all callers. Replace it with narrow route-facing contracts that match the actual surfaces. Two acceptable shapes:

- per-route-family interfaces
- per-endpoint handler functions collected into typed dependency objects

Preferred direction:

- `ProjectsApiHandlers`
- `ThreadsApiHandlers`
- `EnvironmentsApiHandlers`
- `SystemApiHandlers`
- `EnvironmentDaemonApiHandlers`

Each handler should have a signature like:

- parsed input type from contract module
- typed return value matching the response contract
- no direct `Hono` context in the application layer

Routes should become thin adapters:

- validate request with Zod
- call a typed handler
- validate or serialize the typed response
- map domain errors to HTTP

4. Rebuild the application layer around use cases, not around the old class.

Implement new services behind the route-facing handlers. Do not split `Orchestrator` mechanically. Start from the new contracts and build only the behavior each contract needs.

Expected service groupings:

- `ThreadCommandService`
  - spawn thread
  - tell thread
  - queue/dequeue/send follow-up
  - archive/unarchive/delete/stop
  - update read state and metadata
- `ThreadQueryService`
  - list/get thread
  - timeline
  - tool-group messages
  - output
  - events
  - default execution options
- `ThreadWorkspaceService`
  - work status
  - merge-base branches
  - git diff
  - open-path resolution
  - primary checkout status
  - promote/demote
- `ProjectService`
  - create/update/delete/list project
  - manager thread creation policy
  - attachment storage contract
  - workspace status
  - project file suggestions
- `ProviderCatalogService`
  - list models
  - provider info
  - provider catalog
  - environment catalog
- `EnvironmentOperationService`
  - commit
  - squash merge
  - primary promotion/demotion if kept here instead of `ThreadWorkspaceService`
- `EnvironmentDaemonIngressService`
  - session open
  - command polling
  - heartbeat
  - event batch ingest
  - command ack/result
  - provider request handling
  - session invalidation handling
- `ServerMaintenanceService`
  - boot cleanup
  - interrupted provisioning recovery
  - managed artifact reconciliation
  - detach/shutdown cleanup

These services may share lower-level collaborators, but callers should not see a single umbrella contract.

5. Standardize typed low-level collaborators where the current code is overly loose.

Introduce or tighten explicit internal types for:

- provider thread identifiers
- active turn state
- queued follow-up state
- provisioning lifecycle state
- timeline projection state
- env-daemon session and command payloads
- provider event payloads currently treated as open envelopes

Specific cleanup goals:

- eliminate route-visible optional capability probing like `threadManager as ThreadOrchestrator & { ... }`
- eliminate constructor unions like `ProviderSessionController | ProviderAdapter`
- replace raw `process.env` reads in the application layer with typed config objects
- move response shaping logic into explicit query services or projectors instead of mixed command classes

6. Rewrite route composition around the new handler contracts.

Update `apps/server/src/routes/*.ts` so each route file depends only on the handler contract it needs.

Update `apps/server/src/routes/index.ts` to compose route modules from these handler groups rather than from one `threadManager`.

Update `apps/server/src/server.ts` so it becomes the composition root:

- build repositories and infrastructure clients
- build typed config
- build application services
- build route handlers from those services
- wire routes

The composition root should own object creation. Application services should stop creating large collaborators internally.

7. Remove obsolete code paths aggressively.

Once the new handler graph is in place:

- delete `ThreadOrchestrator` from `apps/server/src/server-contracts.ts`
- delete `Orchestrator`
- delete route fallback branches that exist only because the old interface was too broad or too optional
- delete legacy attachment/environment fallback branches that are only supporting previous persistence layouts, if no longer part of the intended model
- delete unused dependencies and stale abstractions such as any scheduler plumbing that no longer serves a real boundary

8. Tighten tests around contracts instead of around the old class surface.

Shift testing emphasis to:

- route contract tests per endpoint
- schema tests for request/response validation
- service tests for each application service
- env-daemon ingress tests against explicit typed payloads
- end-to-end smoke coverage for the major thread lifecycle paths

Avoid preserving test helpers that assume the presence of `Orchestrator`.

## Validation

Validation should prove the new architecture, not just compile.

Required checks:

- route-level tests for every HTTP endpoint with both valid and invalid payloads
- route-level tests asserting response bodies conform to the new response contracts
- env-daemon ingress tests for all accepted message variants
- package typecheck with `pnpm exec turbo run typecheck --filter=@bb/server`
- targeted server test suite updates for thread lifecycle, environment operations, and env-daemon session flow

Recommended validation matrix:

1. `/projects` routes
2. `/threads` command routes
3. `/threads` query routes
4. `/environments` operation routes
5. `/system` routes
6. env-daemon session open / poll / message ingress
7. end-to-end thread spawn, tell, archive/unarchive, queue, and git/workspace flows

Architecture acceptance criteria:

- no remaining callers depend on `ThreadOrchestrator`
- no route file reaches into a mega service and feature-probes optional methods
- all external request and response shapes are defined in explicit Zod-backed contract modules
- no boundary-facing `unknown` payloads remain
- `server.ts` is the composition root and application services do not construct their own major collaborators

## Open Questions/Risks

- Provider event envelopes may currently rely on intentionally open-ended method sets. If we want “no unknowns” at the boundary, we need to decide whether to:
  - enumerate all currently supported provider event/message variants and reject the rest
  - or introduce a smaller typed internal normalization boundary before events enter application logic

- Some current HTTP behavior may be accidental rather than intentional, especially around manager-thread surfaces and attachment/environment fallbacks. During the contract inventory step, those behaviors should be treated as candidates for deletion, not defaults to preserve.

- Route response validation will expose inconsistencies that the current code hides. That is expected and should be treated as useful pressure to normalize shapes rather than patched around.
