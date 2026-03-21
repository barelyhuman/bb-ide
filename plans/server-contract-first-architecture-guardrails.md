## Purpose

This is the companion guardrails document for the server contract-first migration.

These principles are intended to prevent the replacement architecture from drifting back toward the current `Orchestrator` shape.

## Guardrails

1. Design interfaces from the outside in.

Define contracts around real callers and boundaries:

- HTTP route families
- env-daemon ingress
- startup/maintenance entrypoints

Do not define a convenience umbrella interface and ask every caller to depend on it.

2. Separate commands, queries, and ingress.

Do not mix:

- state-changing use cases
- read-model queries
- provider/env-daemon ingress
- maintenance and boot logic

If a contract serves more than one of those categories, it is probably already too broad.

3. Routes are adapters, not application services.

Route modules should:

- validate request shapes
- call a typed handler
- serialize a typed response
- map domain errors to HTTP

Route modules should not:

- probe capabilities with casts
- hydrate domain objects
- read filesystem state for domain behavior
- reassemble data models from multiple stores

4. Every external request and response gets an explicit schema.

Boundary modules must define:

- params schema
- query schema
- body schema
- success response schema
- structured error payload schema where needed

No route-visible `unknown`. No route-visible open `Record<string, unknown>`.

5. Response shapes are part of the contract.

Validation pressure should apply to outputs too, not only inputs.

If a route can return multiple shapes, that must be represented as an explicit union, not as ad hoc branching.

6. Optionality must mean one thing.

Optional arguments, optional dependencies, and optional chaining are only acceptable when the absence represents a real, intentional domain state.

Acceptable examples:

- optional query parameter that the API intentionally supports
- optional field in a discriminated union where the schema defines when it is present
- nullable lookup result when “not found” is a real state

Unacceptable examples:

- optional dependency because the system is half-wired
- optional method because the contract is too broad
- optional chaining used to avoid deciding whether something is guaranteed
- optional fallback behavior that exists only because of legacy model drift

Rule of thumb:

- if the code makes you ask “when is this actually absent?”, the contract is underspecified
- if the answer is “tests sometimes” or “maybe in some setups”, model that explicitly with separate builders, variants, or test-only factories

7. Prefer explicit variants over optional service dependencies.

Do not write production services or route builders that accept large bags of optional deps.

Prefer:

- separate constructors
- separate route builders
- discriminated config objects
- explicit test factories

Avoid patterns like:

- `deps?: { ... }`
- `service?: X`
- `handler as X & { optionalMethod?: ... }`

unless absence is itself part of the intended runtime contract.

8. Prefer explicit variants over optional methods.

If some callers need `listAsync` and others do not, do not put `listAsync?` on a broad interface and feature-probe it.

Instead:

- split the interface
- expose a separate handler group
- or choose one authoritative behavior and remove the other

9. One concept, one authoritative model.

Do not preserve dual representations of the same concept.

Examples to avoid:

- primary source plus fallback source for the same relation
- route-level hydration that recomputes the same association differently
- legacy fields kept alive alongside newer canonical records

When a concept has two sources of truth, bugs become “normal” and optionality spreads everywhere.

10. Composition belongs at the top.

`server.ts` should be the composition root.

Application services should not construct their own major collaborators, registries, or controllers. They should receive fully-formed collaborators through explicit dependencies.

11. Runtime coordination state must be named and scoped.

If in-memory state is necessary, group it by purpose:

- command serialization state
- provider session state
- projection cache state
- maintenance lock state

Do not accumulate unrelated `Map` and `Set` fields on one class without an explicit model of what state machine they belong to.

12. Swallowing errors is a contract smell.

Do not convert unknown failures into:

- `undefined`
- `null`
- silent fallbacks

unless that is explicitly the contract.

If an operation can fail, model failure explicitly.

13. Infrastructure concerns stay in infrastructure services.

Filesystem access, process spawning, env var lookup, websocket delivery, and provider RPC plumbing should live behind infrastructure-oriented collaborators.

They should not leak into route files or general-purpose application services.

14. Query shaping belongs in query services/projectors.

Timeline building, read-model hydration, detail-row assembly, and UI-facing enrichment should live in explicit query-side components.

They should not be mixed into command coordinators.

15. Use typed config instead of ambient process state.

Do not pass `process.env` through the application layer.

Parse config once at the edge into typed config objects, then inject those.

16. Delete drift instead of abstracting around it.

If a branch exists only because:

- there are no users yet
- data can be reset
- compatibility is not needed

then prefer deletion over preservation.

Do not build new abstractions that protect accidental legacy behavior.

17. Test seams should not distort production contracts.

If a constructor or interface exists mainly so tests can partially wire things, fix the test setup.

Do not make the production surface ambiguous just to make tests easier.

Prefer:

- dedicated test builders
- fixture factories
- fake implementations of narrow contracts

18. If a caller has to cast, the contract is wrong.

Type assertions such as:

- `service as X & { optionalMethod?: ... }`
- route-level capability probing

are architecture smells, not just typing issues.

The caller is telling us the advertised contract is not the real one.

## Current Smells These Guardrails Address

These guardrails are motivated by current package issues such as:

- mega-interface drift in [`server-contracts.ts`](/Users/michael/Projects/bb/apps/server/src/server-contracts.ts#L45)
- route-level capability probing in [`routes/index.ts`](/Users/michael/Projects/bb/apps/server/src/routes/index.ts#L38) and [`routes/threads.ts`](/Users/michael/Projects/bb/apps/server/src/routes/threads.ts#L333)
- broad optional dependency bags in [`routes/projects.ts`](/Users/michael/Projects/bb/apps/server/src/routes/projects.ts#L226), [`routes/threads.ts`](/Users/michael/Projects/bb/apps/server/src/routes/threads.ts#L187), and [`routes/system.ts`](/Users/michael/Projects/bb/apps/server/src/routes/system.ts#L188)
- dual/fallback data modeling in [`orchestrator.ts`](/Users/michael/Projects/bb/apps/server/src/orchestrator.ts#L1162)
- application-level composition and state accumulation in [`orchestrator.ts`](/Users/michael/Projects/bb/apps/server/src/orchestrator.ts#L637)
- open-ended provider/event typing in [`provider-session-controller.ts`](/Users/michael/Projects/bb/apps/server/src/provider-session-controller.ts#L76)

## Review Checklist

When reviewing new server architecture code, ask:

1. Is this contract shaped around a real caller/boundary?
2. Does this type make absence explicit and intentional?
3. If something is optional, can we say exactly why and in which runtime variant?
4. Are request and response shapes both explicit and validated?
5. Is this route just adapting HTTP, or is it doing application work?
6. Is there one source of truth for this concept?
7. Is this service constructing collaborators that should be composed above it?
8. Would a new engineer be able to tell, from types alone, what is guaranteed here?
