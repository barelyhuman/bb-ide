# Goal

Stabilize and simplify the daemon `<->` environment-agent lifecycle so idle threads can safely have no running env-agent, while replacing brittle implementation-detail tests with a smaller set of durable contract and lifecycle regression coverage.

# Scope

In scope:

- Collapse daemon lifecycle access into one canonical ensure or reconnect path before command dispatch
- Remove remaining env-agent lifecycle policy that depends on daemon-owned thread state
- Clarify ownership between daemon policy, environment process management, and env-agent execution or delivery
- Prune low-value tests in the daemon and environment-agent suites that fail on harmless refactors
- Replace deleted test coverage with durable protocol, lifecycle, and roundtrip assertions where needed

Out of scope:

- Broad provider protocol changes beyond what lifecycle simplification requires
- UI-facing behavior changes
- A full redesign of environment provisioning abstractions unrelated to env-agent lifecycle

# Implementation Steps

1. Define and document the canonical lifecycle path.

- Introduce one daemon-side path that means:
  ensure env-agent access for the thread, reconnect if a valid session already exists, otherwise spawn and wait for a new session, then dispatch the command.
- Route the main entry points through that path:
  `tell`, follow-up dispatch, resume or reconnect, and daemon restart recovery.
- Remove special-case fast paths that trust stale in-memory session or provider-thread state without validation.

2. Reduce env-agent lifecycle responsibility to local mechanics only.

- Keep env-agent responsible for:
  local command execution, event or result buffering, delivery cursors, heartbeat emission on the negotiated cadence, and exit when locally drained.
- Remove remaining policy that derives shutdown or lifecycle decisions from daemon-owned thread activity state.
- Keep the env-agent exit rule purely local:
  no local work in flight and no undelivered outbound state.

3. Make missing env-agent state normal in the daemon.

- Treat “no env-agent process” and “no active session” as normal idle states for a thread.
- Ensure daemon command paths can always recover from that state by provisioning or reconnecting instead of assuming a hot runtime object already exists.
- Tighten stale-session and stale-instance fencing so late old agents cannot continue to own commands or delivery after replacement.

4. Simplify environment-layer process management around discovery first.

- Prefer discover-existing-and-reconnect over detach-then-kill-then-recreate.
- Keep one source of truth for whether a managed env-agent is alive enough to reuse.
- Remove or narrow races where the daemon can rebind to a process that is already being torn down.

5. Prune implementation-detail tests as behavior is covered elsewhere.

- Audit the current lifecycle-related tests and classify them as:
  keep, transitional, or delete.
- Delete tests whose primary assertion is exact helper call counts, private sequencing, or poll-loop choreography that is not the product contract.
- Start with the highest-coupling files:
  `packages/environment-agent/src/session-supervisor.test.ts`,
  `apps/daemon/src/__tests__/environment-agent-session-command-client.test.ts`,
  and the most brittle lifecycle slices in `apps/daemon/src/__tests__/environment-service.test.ts`.

6. Replace deleted coverage with durable contract tests.

- Keep or add focused contract tests for:
  negotiated heartbeat cadence, long-poll command retrieval behavior, replay from cursor, stale-session rejection, drain-before-close, and command recovery after session loss.
- Keep lower-level transport and session tests focused on observable protocol behavior rather than internal scheduling details.
- Prefer assertions on persisted state, externally visible API behavior, queued work state, replay cursor position, and delivered events or results.

7. Build a small shared lifecycle regression matrix.

- Add a reusable daemon `<->` env-agent scenario harness that covers the main lifecycle guarantees:
  spawn on demand, reconnect after daemon restart, safe exit after drain, stale-session fencing, follow-up dispatch, and failure while work is queued or active.
- Use this matrix as the default place for future lifecycle regressions instead of adding more one-off mock-heavy tests.
- Keep environment-specific tests only for provisioning and reachability facts that the shared lifecycle matrix cannot prove.

8. Remove superseded planning and update docs when the code lands.

- This plan supersedes the broader direction in `plans/ephemeral-env-agent-lifecycle.md` and `plans/testing-foundation-environment-agent.md`.
- After implementation, delete this plan and update architecture docs to reflect the simplified ownership model and the new test hierarchy.

# Validation

- `pnpm exec turbo run typecheck --filter=@beanbag/environment-agent --filter=@beanbag/environment --filter=@beanbag/daemon --filter=@beanbag/db`
- `pnpm --filter @beanbag/environment-agent test -- --run src/session-supervisor.test.ts src/session-sync.test.ts src/service.test.ts`
- `pnpm --filter @beanbag/daemon test -- --run src/__tests__/environment-agent-session-service.test.ts src/__tests__/environment-agent-session-command-client.test.ts src/__tests__/environment-agent-delivery-modules.test.ts src/__tests__/environment-service.test.ts src/__tests__/environment-agent-session-orchestrator-roundtrip.test.ts`
- `pnpm --filter @beanbag/daemon test:e2e`

# Open Questions/Risks

- The hardest remaining boundary is work that has already started when a session dies; that path still needs clear rules for rebind versus explicit failure.
- A smaller test suite only helps if replacement contract coverage lands in the same slice; deleting tests before durable behavior coverage exists would reduce confidence.
- The environment layer may still contain assumptions that local environments deserve special treatment; those should be justified explicitly or removed.
- If the shared lifecycle matrix becomes too coupled to today’s transport details, it will recreate the same maintenance problem under a different name.
