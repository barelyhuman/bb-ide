# Goal

Allow Beanbag to tear down the per-thread `environment-agent` when a thread has been idle long enough, then recreate it on the next follow-up turn without losing the thread's environment record or breaking normal resume behavior.

The target behavior is:

- a completed turn can leave the thread in an idle, suspended state instead of keeping a hot environment-agent process forever;
- the underlying environment workspace/container remains restorable unless the thread is explicitly archived or deleted;
- a follow-up message lazily recreates the environment-agent, reconnects, and resumes the provider session when possible, with a controlled fallback when provider-side session state is gone.

# Scope

In scope:

- Introduce an explicit "suspend agent, keep environment" lifecycle path for `local`, `worktree`, and `docker`
- Add idle-time suspend policy in the daemon after turn completion
- Route environment-agent access through a lazy ensure/reconnect path instead of assuming the agent is always hot
- Reuse existing persisted `environmentRecord`, replay cursor, and provider-thread resume machinery where possible
- Preserve current destructive cleanup semantics for archive/delete flows
- Add focused tests for suspend, resume, and fallback reprovisioning

Out of scope:

- Changing thread product semantics beyond idle suspend behavior
- Clearing or compacting event history as part of suspend
- Redesigning environment persistence format unless a minimal schema tweak is required
- Solving broader daemon restart/recovery cleanup issues that are not specific to idle suspend

# Implementation Steps

1. Define the lifecycle contract for "suspended environment"

- Treat "environment runtime exists in memory" and "environment workspace is restorable" as separate states.
- Add an explicit environment lifecycle operation for non-destructive agent teardown. This should stop the managed `environment-agent` and live subscriptions without deleting the underlying workspace/container.
- Keep destructive cleanup as a separate path used by archive/delete and any future explicit destroy action.
- Decide whether suspend is represented only in daemon memory or also persisted on the thread record for observability and restart behavior.

2. Refactor `IEnvironment` lifecycle methods so suspend is first-class

- Extend `packages/environment/src/contracts.ts` with a dedicated suspend-capable lifecycle API instead of overloading current `dispose()` semantics.
- Update `local`, `worktree`, and `docker` environment implementations so:
  - suspend stops the managed environment-agent process;
  - destroy keeps the current `dispose()` behavior of removing the workspace/container when applicable;
  - restore remains based on `thread.environmentRecord`.
- Keep the environment contract explicit about which operations are internal/closed lifecycle states versus provider/runtime-owned open sets.

3. Split daemon cleanup paths into suspend vs destroy

- Refactor `EnvironmentService.cleanupEnvironmentRuntime()` so it no longer conflates:
  - dropping in-memory runtime bookkeeping;
  - suspending the environment-agent;
  - destroying the persisted environment.
- Introduce separate internal methods for:
  - runtime detach only;
  - suspend environment-agent but preserve environment record;
  - destroy environment and clear persisted state.
- Update archive/delete paths to continue using destructive cleanup, while idle/thread-stop paths use suspend or detach according to the chosen policy.

4. Add idle suspend policy in the orchestrator

- On `turn/completed`, schedule an idle timeout rather than immediately keeping the environment hot forever.
- Cancel the pending suspend timer on any new thread activity, including follow-up turns, steering, or explicit thread resume.
- Keep the timeout configurable in one place, with a safe default and a clear disabled mode for debugging.
- Emit clear internal events or diagnostics when a thread is auto-suspended so the behavior is inspectable in tests and logs.

5. Centralize lazy environment-agent ensure/reconnect

- Audit all orchestrator paths that call `_withEnvironmentAgentClient()` or directly resolve an environment-agent target.
- Introduce one canonical "ensure environment-agent access" path that:
  - restores the environment from `thread.environmentRecord` when no runtime object is live;
  - prepares the environment if the managed agent is absent;
  - establishes the HTTP client/subscription;
  - replays buffered environment-agent events if needed.
- Remove assumptions that `restoreThreadEnvironment(...).getAgentConnectionTarget()` always succeeds without first ensuring a managed agent is running.

6. Make follow-up turns resume from a suspended state

- Reuse `_ensureProviderSession()` as the primary resume path for follow-up turns after suspend.
- Ensure the first follow-up after suspend:
  - recreates the environment-agent;
  - re-establishes live event subscription;
  - issues provider `thread.resume` against the persisted provider thread id when available.
- Preserve current fallback behavior when provider-side session state has been evicted: reprovision and continue rather than leaving the thread stuck.
- Verify the resumed path works for both "idle but restorable" and "daemon restarted while suspended" cases.

7. Reconcile workspace watches, live clients, and replay cursor handling

- Ensure suspend removes file watchers and live environment-agent subscriptions cleanly so idle threads do not leak process handles.
- Keep `environmentAgentCursor` and replay behavior correct when the agent is stopped and later recreated.
- Decide whether a suspended thread should eagerly recreate workspace status watches on restore or only when the thread becomes active again.
- Confirm duplicate or gap handling remains correct when the recreated environment-agent starts its own sequence stream.

8. Add product and operator guardrails

- Decide whether auto-suspend should apply to every environment kind or only managed environments with meaningful idle cost.
- Decide how explicit user actions like "Stop thread" should behave: suspend-only, destroy, or configurable by environment type.
- Surface enough status to distinguish:
  - active;
  - idle/hot;
  - idle/suspended;
  - archived/destroyed.
- Keep unknown provider/runtime statuses tolerant where the source is open/external, but make internal lifecycle handling exhaustive.

# Validation

- `pnpm --filter @beanbag/environment typecheck`
- `pnpm --filter @beanbag/environment test`
- `pnpm --filter @beanbag/environment-agent test`
- `pnpm --filter @beanbag/agent-server test`
- `pnpm --filter @beanbag/daemon typecheck`
- `pnpm --filter @beanbag/daemon test`

Add focused coverage for:

- idle thread auto-suspends after `turn/completed`
- follow-up turn recreates environment-agent and resumes provider session
- resume falls back cleanly when provider thread state is missing
- archive/delete still destroys workspace/container and clears persisted environment state
- workspace watchers and live client subscriptions do not leak after suspend
- daemon restart with preserved suspended environments still allows later follow-up resume

# Open Questions/Risks

- `local` environment currently uses the project root directly. Suspending its environment-agent is cheap, but the product value of distinguishing "hot local" vs "suspended local" may be lower than for `worktree` or `docker`.
- Event sequencing may need careful handling if a recreated environment-agent starts from a fresh in-memory sequence counter rather than continuing a prior stream. If the current protocol assumes monotonic agent-local sequence numbers across restarts, that contract must be revised or persisted.
- Some orchestration paths outside follow-up turn execution may still assume a live agent for status or diff operations. Those need to be found and routed through the same ensure/reconnect path, or suspend will create intermittent failures.
- Auto-suspend timing can create surprising UX if it races with queued follow-up work or background operations. Timer cancellation and "thread became active again" transitions need to be exact.
- If provider-side resume is not reliable enough, suspend may trade steady-state resource savings for higher follow-up latency and more fallback reprovisioning. That tradeoff should be measured before enabling the behavior broadly.
