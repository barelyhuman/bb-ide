# Goal

Move Beanbag to a disposable `environment-agent` model where:

- the daemon does not own idle suspend timers;
- the `environment-agent` keeps retrying delivery while the daemon is down;
- the `environment-agent` shuts itself down once all local work is finished and all outbound state has been delivered;
- the daemon treats starting a fresh `environment-agent` as the normal recovery path after either side restarts.

This supersedes the earlier daemon-timer-based idle suspend plan.

# Scope

In scope:

- Remove daemon-owned idle environment suspend timers and idle-thread boot sweeps from [orchestrator.ts](/Users/michael/Projects/bb/apps/daemon/src/orchestrator.ts).
- Make `environment-agent` quiescence and self-suspend a first-class concern in [service.ts](/Users/michael/Projects/bb/packages/environment-agent/src/service.ts), [session-supervisor.ts](/Users/michael/Projects/bb/packages/environment-agent/src/session-supervisor.ts), and [runtime.ts](/Users/michael/Projects/bb/packages/environment-agent/src/runtime.ts).
- Keep daemon-to-agent access on a lazy spawn-on-demand path through [environment-service.ts](/Users/michael/Projects/bb/apps/daemon/src/environment-service.ts), [orchestrator.ts](/Users/michael/Projects/bb/apps/daemon/src/orchestrator.ts), and the managed host-agent helpers in [host-environment-agent.ts](/Users/michael/Projects/bb/packages/environment/src/host-environment-agent.ts).
- Preserve the current session/outbox protocol, but harden it for the disposable-agent lifecycle.

Out of scope:

- Redesigning provider RPC semantics.
- Changing user-facing thread product semantics beyond how the background agent is kept alive.
- Full crash-proof persistence of the env-agent outbox unless we decide the current in-memory durability boundary is insufficient.

# Implementation Steps

1. Define the quiescence contract around local agent state, not daemon thread status.

- Treat the env-agent as quiescent only when all of the following are true:
  - no command is currently executing locally;
  - the runtime has no pending provider RPC work;
  - there are no unacked outbound events in the session outbox;
  - there are no pending command results/acks left to flush.
- Keep the choice of immediate exit vs a small local debounce inside the env-agent. That timing must not be a daemon-owned or persisted policy.
- Make this contract explicit in code comments and tests so `turn.completed` is not treated as a sufficient proxy by itself.

2. Add explicit quiescence introspection to the env-agent runtime and session layers.

- Extend [runtime.ts](/Users/michael/Projects/bb/packages/environment-agent/src/runtime.ts) with a small closed internal snapshot for:
  - whether a command is currently executing;
  - whether provider RPC requests are still in flight;
  - whether the provider child is still running.
- Extend [session-runtime.ts](/Users/michael/Projects/bb/packages/environment-agent/src/session-runtime.ts) and [session-store.ts](/Users/michael/Projects/bb/packages/environment-agent/src/session-store.ts) with introspection helpers for:
  - unacked outbox depth;
  - pending command ack/result counts;
  - whether a session is currently bound.
- Keep these helpers exhaustive and typed; do not make quiescence decisions by re-deriving them ad hoc in multiple call sites.

3. Introduce a self-suspend controller inside the env-agent service.

- Add a small controller alongside [EnvironmentAgentSessionSupervisor](/Users/michael/Projects/bb/packages/environment-agent/src/session-supervisor.ts) that:
  - reevaluates quiescence after command completion, event ack, command result flush, provider exit, and session state changes;
  - cancels any pending self-suspend when new local work appears;
  - shuts down the runtime, closes the HTTP server, and exits the process once quiescent.
- Keep daemon-unavailable behavior simple:
  - if there is undelivered outbox/command state, keep retrying with backoff and do not self-suspend;
  - if there is no undelivered state and no work, exit cleanly even if the daemon is down.
- Make graceful self-exit clean up the managed host-agent record eagerly if practical; otherwise ensure stale-record cleanup remains correct on the next spawn.

4. Make “missing env-agent” a normal steady state for the daemon.

- Audit all orchestrator paths that require env-agent access and ensure they go through the existing lazy ensure path in [orchestrator.ts](/Users/michael/Projects/bb/apps/daemon/src/orchestrator.ts).
- Tighten the contract around [EnvironmentAgentCommandDispatcher](/Users/michael/Projects/bb/apps/daemon/src/environment-agent-command-dispatcher.ts) so waiting for an active session is paired with “make sure an env-agent is being started,” rather than assuming one is already hot.
- Keep fresh-session open as the normal recovery path:
  - daemon restarts can accept a reconnect from an existing env-agent;
  - if no env-agent exists, the daemon simply starts a new one and waits for its session.

5. Remove daemon-owned idle suspend policy and boot reconciliation for idle agents.

- Delete the idle suspend timer machinery and related timeout env var handling from [orchestrator.ts](/Users/michael/Projects/bb/apps/daemon/src/orchestrator.ts).
- Remove the boot-time idle-thread scan and the repository query added only to reconstruct those timers.
- Keep archived-environment cleanup if it is still needed, but stop treating daemon boot as the place where idle env-agents are reaped.
- Simplify shutdown/restart behavior so “preserve environments” means detach daemon memory and let surviving env-agents either reconnect or self-exit based on their own local state.

6. Harden the session lifecycle around disposable agents.

- Keep `inactive_session` as the explicit signal for dead leases, and preserve the current env-agent behavior of dropping stale sessions and opening fresh ones.
- Make sure generic transport failures continue to back off, so daemon downtime does not produce tight-loop heartbeat spam.
- Audit session open/close/replaced flows in [environment-agent-session-service.ts](/Users/michael/Projects/bb/apps/daemon/src/environment-agent-session-service.ts) and [session-sync.ts](/Users/michael/Projects/bb/packages/environment-agent/src/session-sync.ts) for assumptions that an agent is long-lived.
- Ensure a self-suspending env-agent can exit without leaving the daemon in a permanently waiting state for commands that were never delivered to an active session.

7. Decide and document the durability boundary explicitly.

- Phase 1 recommendation:
  - keep the env-agent session store in memory;
  - rely on the env-agent staying alive while undelivered work exists;
  - treat agent process death during daemon downtime as a separate failure mode.
- If that boundary is not acceptable, add a second phase that persists the outbox and command receipts locally so a restarted env-agent can resume delivery after its own crash.
- Either way, document the boundary in code and tests so “resilient to daemon down” and “resilient to env-agent crash” are not conflated.

# Validation

- Add focused env-agent tests for:
  - quiescence stays false while outbox events or command results remain unacked;
  - daemon-down transport failures back off but do not trigger self-suspend while pending work exists;
  - env-agent self-suspends once local work is finished and delivery is drained;
  - `inactive_session` still causes session reset/reopen instead of permanent retry on a dead lease.
- Add daemon tests for:
  - follow-up work starts a fresh env-agent when no active one exists;
  - boot no longer scans idle threads to rebuild suspend timers;
  - preserved environments still work after daemon restart by reconnecting an existing agent or spawning a new one on demand.
- Run:
  - `pnpm exec vitest run packages/environment-agent/src/session-supervisor.test.ts packages/environment-agent/src/session-sync.test.ts packages/environment-agent/src/runtime.test.ts`
  - `pnpm exec vitest run apps/daemon/src/__tests__/environment-agent-session-orchestrator-roundtrip.test.ts apps/daemon/src/__tests__/environment-service.test.ts apps/daemon/src/__tests__/orchestrator.test.ts --config apps/daemon/vitest.config.ts`
  - `pnpm exec turbo run typecheck --filter=@beanbag/environment-agent --filter=@beanbag/environment --filter=@beanbag/daemon --filter=@beanbag/db`

# Open Questions/Risks

- `turn.completed` may arrive before every follow-on provider event has been emitted, so quiescence must be defined against actual local queues, not event types alone.
- The current env-agent session store is in-memory. That is enough for daemon downtime only if the env-agent process itself survives until delivery drains.
- Self-exiting agents must not race with daemon-side spawn-on-demand in a way that causes duplicate managed processes or confusing stale state files.
- Some daemon read paths may still assume a hot env-agent or in-memory runtime object. Those paths need to be audited before removing the daemon timer/reconciliation fallback.
- `local` environments gain less from self-suspend than isolated workspaces, but using one lifecycle model across `local` and `worktree` is still likely simpler than special-casing them.
