# Goal

Simplify the daemon `<->` environment-agent architecture to an ephemeral env-agent model:

- env-agents are short-lived per-thread control-plane processes;
- they can survive daemon restarts long enough to finish delivery;
- they exit once local agent work is done and outbound state is drained;
- the daemon treats “no env-agent is running” as a normal state and can always ensure a new one before sending commands.

# Scope

- Define a single lifecycle model for `local`, `worktree`, and `docker` environments.
- Clarify ownership across the daemon, environment layer, and env-agent.
- Replace the current overlapping suspend/recovery responsibilities with one canonical ensure/reconnect path.
- Preserve restart resilience for daemon outages without requiring env-agents to be long-lived background daemons.
- Keep provider RPC semantics and thread product semantics unchanged unless required by the lifecycle simplification.

# Implementation Steps

1. Define ownership boundaries explicitly.

- Daemon owns policy:
  when a thread needs env-agent access, when to ensure one exists, and how to recover after session loss.
- Environment layer owns mechanics:
  spawn, discover, and stop the managed env-agent process for a thread environment.
- Env-agent owns execution and delivery:
  run provider commands, buffer outbound events/results, and expose readiness/drain state.

2. Make “missing env-agent” the normal steady state.

- Collapse daemon access into one path that means:
  ensure an env-agent exists for this thread, open or re-open a session, then send the command.
- Treat the absence of a managed env-agent process as expected for idle threads.
- Remove assumptions that an in-memory runtime object or hot session already exists before daemon operations like `tell`, `resume`, or thread rename.

3. Replace self-suspend policy with an explicit drain-and-exit contract.

- Env-agent may exit on its own only when all of the following are true:
  no command is executing locally, no provider requests are in flight, no outbound events remain unacked, and no command ack/result remains to flush.
- Do not let env-agent exit decisions depend on daemon thread status or daemon-owned timers.
- Keep the exit trigger local and mechanical:
  “drained and idle” is enough, “daemon thinks the thread is idle” is not.

4. Separate lease heartbeats from command retrieval.

- Honor the negotiated `heartbeatIntervalMs` for healthy sessions instead of sending heartbeats on every fast supervisor cycle.
- Treat command retrieval as its own concern:
  either implement real blocking long-poll semantics for `/session/commands`, or use a clearly documented non-blocking/adaptive pull strategy.
- Do not let event flushes, immediate local-work cycles, or self-suspend reevaluation force extra healthy-session heartbeats.

5. Introduce a first-class daemon ensure/reconnect flow.

- On command dispatch, the daemon should:
  resolve the thread environment, discover any existing managed env-agent, connect if present, otherwise spawn a new one and wait for session open.
- On daemon restart, an existing env-agent should be able to reconnect and resume delivery from the daemon cursor.
- If no env-agent survived the restart, the daemon should simply start a new one on demand.

6. Fence stale instances and stale sessions.

- Add a clear generation/instance contract so a late old env-agent cannot continue owning pending commands or deliver stale events after a newer one exists.
- Keep one active session per thread, but make stale session replacement an intentional steady-state path, not an exceptional path.
- Revisit command rebinding semantics so queued work can move to a fresh session cleanly, while already-started work is either resumed explicitly or failed explicitly rather than timing out ambiguously.

7. Simplify managed-process lifecycle in the environment layer.

- Keep a single source of truth for managed env-agent discovery, probably the existing state record plus live health check.
- Avoid detach-and-async-kill races where the daemon reprovisions while an older managed agent is still being terminated.
- Prefer “discover existing and reconnect” over “tear down first and hope restart wins the race.”

8. Align tests and docs with the new model.

- Update architecture docs to describe env-agents as ephemeral, drain-aware processes rather than long-lived managed sidecars.
- Add focused tests for:
  daemon restart reconnect, spawn-on-demand for idle threads, safe env-agent exit after delivery drain, stale-session fencing, and healthy-session heartbeat cadence.
- Keep the short-term regression plan separate and use it to stabilize behavior before or during the simplification.

# Validation

- `pnpm exec vitest run packages/environment-agent/src/session-supervisor.test.ts`
- `pnpm exec vitest run packages/environment-agent/src/service.test.ts`
- `pnpm exec vitest run apps/daemon/src/__tests__/environment-agent-session-service.test.ts`
- `pnpm exec vitest run apps/daemon/src/__tests__/environment-agent-session-command-client.test.ts`
- `pnpm exec vitest run apps/daemon/src/__tests__/orchestrator.test.ts`
- `pnpm exec vitest run apps/daemon/src/__tests__/e2e/environment-agent-restart-roundtrip.test.ts`
- `pnpm exec vitest run apps/daemon/src/__tests__/e2e/thread-worktree-followup-roundtrip.test.ts`
- `pnpm exec turbo run typecheck --filter=@beanbag/environment-agent --filter=@beanbag/environment --filter=@beanbag/daemon --filter=@beanbag/db`

# Open Questions/Risks

- The hardest design edge is not startup; it is the handoff when a session dies after a command is already `received` or `started`.
- The current implementation couples healthy heartbeats to a 250ms supervisor loop and uses immediate-return command pulls, so the transport behavior and the protocol naming need to be realigned.
- If env-agent outbox state stays in memory only, the model is resilient to daemon restart but not to env-agent crash during daemon downtime. That boundary needs to be explicit.
- `local` environments may not benefit much from process churn, but keeping one lifecycle model across environments is still likely simpler than special-casing them.
- Existing code currently splits lifecycle responsibility across the daemon, environment layer, and env-agent. Moving to this model may require deleting behavior, not just adding recovery code.
- This plan supersedes the older env-agent-owned self-suspend direction because that approach keeps too much lifecycle policy inside the env-agent.
