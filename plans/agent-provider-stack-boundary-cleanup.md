# Agent Provider Stack Boundary Cleanup

## Diagnosis

Three packages — `@bb/agent-providers`, `@bb/agent-provider-auth`, `@bb/agent-provider-audit` — with three distinct jobs: static catalog, OAuth/credential management, and provider event capture/replay tooling. The split is coherent; the contents have drifted in ways that should be cleaned up before more features land.

Three real issues:

1. **Credential state uses nullable fields to conflate two meanings.** In `agent-provider-auth`, `lastRefreshedAt: number | null` and `lastErrorMessage: string | null` let `null` mean both "never attempted" and "attempted with no value." AGENTS.md §Contracts: *"Use `required + nullable` only when `null` has a distinct meaning."* This is the forbidden pattern.

2. **`agent-provider-audit` is production-packaged test infrastructure.** Built-in fixture scenarios, tool fixtures, and replay harnesses ship in the same package that production code imports. The package also depends on `@bb/agent-runtime` — a test-tooling package depending on the thing it tests. The dependency direction and the packaging both signal it's a test concern mislabeled as a utility.

3. **OAuth provider definitions mix protocol, secrets, and business logic.** `agent-provider-auth/src/provider-definitions.ts` has hardcoded OAuth client IDs, hardcoded callback host/port/path values (53692 for Claude, 1455 for Codex), and JWT decode logic repeated between Claude and Codex paths. The duplication is the symptom; the mix is the cause.

## Phase 1: Fix credential nullable-field ambiguity

**Goal:** Eliminate fields where `null` carries two different meanings.

**Changes:**
- In `agent-provider-auth`, update `CloudAuthResolvedCredential` (or its equivalent):
  - Replace `lastRefreshedAt: number | null` with optional: `lastRefreshedAt?: number`. Absence = "never refreshed"; presence = "refreshed at this time."
  - Replace `lastErrorMessage: string | null` with either an optional field or an explicit `lastError?: { at: number; message: string }` struct.
  - If there's state that needs an explicit "failed last time" vs "never attempted" distinction, encode it in a `state` field with named variants, not by abusing nullable.
- Update callers in `apps/server/src/services/cloud-auth/` and any consumers.
- Add a test that exercises the three states that previously collapsed to `null`: never-attempted, attempted-succeeded-no-message, attempted-failed.

**Exit criteria:**
- No field uses `| null` to mean both "unset" and "set to no value."
- Callers handle the three states explicitly.
- `pnpm exec turbo run typecheck --filter=@bb/agent-provider-auth --filter=@bb/server` passes.

## Phase 2: Separate test fixtures from the audit package

**Goal:** Stop shipping test scenarios as production code, and stop having audit tooling depend on `@bb/agent-runtime`.

**Investigation first:** confirm what actually imports `@bb/agent-provider-audit`. If only CLI harnesses and test files import it, the whole package is test infrastructure. If production server code imports it, identify what specifically and treat that as a separate refactor.

**Changes (assuming audit is test-only):**
- Move `BUILT_IN_SCENARIOS`, `ProviderAuditScenario`, `ProviderAuditScenarioOverride`, and tool-fixture types out of the main exports. Two workable shapes:
  - (a) Leave them in `@bb/agent-provider-audit` but behind a `@bb/agent-provider-audit/fixtures` subpath that only the CLI and tests import.
  - (b) Extract to a new `@bb/agent-provider-audit-fixtures` package.
  - Prefer (a) unless the subpath approach is fragile under the current build setup.
- Verify no production code (server, daemon, UI) imports fixture scenarios.

**On the `@bb/agent-runtime` dependency:** if the audit package genuinely needs runtime types (for capture entry shapes), that's a real dependency — keep it. If it only needs them because of the fixture-replay path, that dependency moves with the fixtures in option (a)/(b).

**Exit criteria:**
- Production server/daemon/UI code does not transitively depend on `BUILT_IN_SCENARIOS` or tool fixtures.
- `grep -rn "from.*agent-provider-audit" apps/server apps/host-daemon packages/core-ui packages/ui-core` returns at most incidental type imports, nothing touching fixtures.
- CLI harnesses and tests still work.

## Phase 3: De-duplicate OAuth flow code, then extract secrets

**Goal:** Make the duplication obvious enough to fix, then move configuration out of code.

**Investigation first:** read `provider-definitions.ts` end-to-end. Count the actual lines of duplicated logic between Claude and Codex paths (JWT decode, token exchange, error handling, profile fetching). If duplication is minor (≤20 lines each, clear divergences), skip the abstraction and just move the secrets. If duplication is substantial and the divergences are superficial, proceed with extraction.

**Changes (conditional on investigation):**
- If duplication is real: extract shared OAuth utilities (PKCE generation, token response parsing, JWT decode) into `agent-provider-auth/src/oauth/` with per-provider modules consuming the shared pieces.
- Either way: move hardcoded OAuth client IDs and callback ports out of `provider-definitions.ts` into a config module. Client IDs aren't secrets (public by OAuth design) but they are configuration that doesn't belong mixed with request logic.
- Audit error paths to confirm provider error messages sent back to callers don't include token material. This is not the same as "full stderr redaction" — only verify the user-facing error strings.

**Exit criteria:**
- `grep -E "client_id.*=.*['\"][0-9a-f-]{10,}['\"]" packages/agent-provider-auth/src/provider-definitions.ts` returns nothing.
- `grep -E "53692|1455" packages/agent-provider-auth/src` finds these only in a config module, not scattered.
- If extraction happened: no duplicated JWT decode or token-parsing logic between Claude and Codex paths.
- `pnpm exec turbo run test --filter=@bb/agent-provider-auth` passes.

## Out of scope — considered and declined

- **A full OAuth-provider capability matrix** (e.g., auth provider × runtime capability table). Over-engineered for two auth providers and three runtimes. Revisit if a fourth auth provider gets added.
- **A credential state machine with explicit transition guards.** Phase 1 fixes the nullable ambiguity; a proper state machine is premature until the ambiguity fix reveals whether more structure is needed.
- **Full stderr redaction across the auth package.** The broader `redactProviderDiagnosticLine` was removed from agent-runtime deliberately in a prior commit. Revisiting redaction is a separate security discussion.
- **Consolidating `agent-providers` and `agent-provider-auth` into one package.** They have genuinely distinct concerns (static metadata vs. mutable credential state). The split is right.
- **Runtime material type safety overhaul.** Real but not pressing; `buildCloudAuthRuntimeMaterial` works correctly today.
- **Renaming types for style.** Explicitly off the brief.

## Expected impact

Phase 1 is the highest-value fix and the smallest — a direct AGENTS.md violation gets corrected. Phase 2 is mostly investigation followed by a subpath or package move; low behavioral risk. Phase 3 is gated on investigation; might reduce to "move config constants to a file" if extraction isn't warranted.

All three phases are independent. Phase 1 is a clear win. Phases 2 and 3 are worth doing but not urgent.
