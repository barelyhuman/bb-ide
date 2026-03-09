# Goal

Land the environment-agent architecture in a mergeable state by moving from a daemon-only reconnect model to a hybrid delivery model:

- environment-agent actively retries delivery back to the daemon, Terragon-style
- daemon still reconnects, nudges active environments, and replays from cursor as a backstop

The codebase must end this phase in a cleaner state than it starts:

- production auth must exist for environment-agent HTTP endpoints
- transition-only transport code should be removed or clearly quarantined
- environment/daemon recovery behavior should be understandable and testable end to end

# Scope

In scope:

- Add authenticated daemon ingress endpoints for environment-agent event delivery
- Add environment-agent outbound delivery/retry against daemon callbacks
- Keep daemon-initiated `status` / `replay` / `ack` / wake-up behavior as a recovery path
- Define one canonical event log / ack / replay model shared by push and pull delivery
- Tighten environment-agent lifecycle and stale-record cleanup
- Remove production reliance on legacy stdio transport paths where the managed HTTP agent is now the intended architecture
- Consolidate duplicated compatibility/test scaffolding introduced during migration

Out of scope:

- E2B-specific implementation work
- External distributed queues or third-party messaging systems
- Full UI redesign beyond surfacing new environment-agent health/delivery state where needed
- Solving every unrelated environment abstraction leak

# Implementation Steps

1. Add real environment-agent auth

- Add optional server-side auth enforcement to `packages/environment-agent`
- Require a bearer token or equivalent shared secret for all HTTP control/data endpoints
- Generate/store a per-managed-agent secret in the host-managed agent record
- Pass the secret to:
  - environment-agent at launch time
  - daemon environment-agent client when connecting
- Keep loopback binding as the default transport posture even after auth exists

2. Add daemon ingress for environment-agent delivery

- Define daemon HTTP endpoints for environment-agent event batch delivery and delivery acknowledgements
- Reuse the existing sequence/ack model rather than introducing a second delivery state machine
- Persist and dedupe inbound events by sequence/idempotency rules
- Ensure daemon ingress can safely accept repeated deliveries after retries or reboot

3. Add outbound delivery/retry in environment-agent

- Extend `packages/environment-agent` runtime so it can:
  - hold daemon callback config
  - attempt POST delivery of live event batches to the daemon
  - retry with bounded backoff while daemon is unavailable
  - keep local unacked events until acknowledged
- Preserve daemon pull/replay support; push is additive, not a replacement for the event log

4. Add daemon boot nudging and recovery reconciliation

- On daemon boot:
  - enumerate active thread environments
  - restore/connect to managed environment-agents
  - nudge each agent to retry delivery immediately
  - reconcile with `status` / `replay` if callback delivery is behind or broken
- Treat callback push and daemon pull as two delivery strategies over one canonical log
- Prefer explicit recovery states over silent status healing when reconnect fails

5. Remove or quarantine stdio fallback paths

- Remove `command-stdio` from production environment targets if auth+managed HTTP is complete
- If full removal is too risky in one pass:
  - keep stdio only in tests/debug helpers
  - move it behind explicitly non-production utilities
- Delete now-dead branches in:
  - daemon environment-agent session connection logic
  - agent-server child-process session transport setup
  - environment-agent child-process client/transport helpers if no longer needed in production

6. Clean up the codebase for merge

- Collapse duplicated test responders/fixtures further now that the target protocol is clearer
- Remove dead exports and transition helpers that no longer have production callers
- Document supported env vars and mark test-only ones explicitly
- Re-audit package surfaces so production exports reflect the intended architecture instead of the migration path
- Delete this plan once the landing work is complete or replace it with a smaller follow-up plan

# Validation

- `pnpm --filter @beanbag/environment-agent build`
- `pnpm --filter @beanbag/environment-agent test`
- `pnpm --filter @beanbag/environment build`
- `pnpm --filter @beanbag/environment typecheck`
- `pnpm --filter @beanbag/environment test`
- `pnpm --filter @beanbag/agent-server build`
- `pnpm --filter @beanbag/agent-server typecheck`
- `pnpm --filter @beanbag/agent-server test`
- `pnpm --filter @beanbag/daemon typecheck`
- `pnpm --filter @beanbag/daemon test`

Focused behavioral coverage:

- managed `local`, `worktree`, and `docker` agents require auth and reject missing/invalid tokens
- environment-agent retries delivery while daemon endpoints are unavailable
- daemon boot nudges active environments and catches up if push delivery is stalled
- daemon replay remains correct when push delivery partially succeeds or duplicates
- archive/dispose/remove operations stop managed agents and remove persisted agent secrets/records
- stdio transport is either gone from production code or isolated to clearly non-production code paths

# Open Questions/Risks

- If we remove stdio entirely, test ergonomics may regress unless HTTP test helpers are made lightweight and reusable.
- Daemon callback auth and environment-agent control-plane auth should likely share a model, but not necessarily the same token. Decide whether one token or two is cleaner.
- Environment-agent callback configuration must survive daemon restart without becoming a stale trust relationship. Rotating daemon auth without stranding agents is the main design risk.
- Push delivery and daemon replay must converge against the same sequence/ack rules. Any drift here will create duplicate or missing events that are hard to debug.
- If daemon boot becomes too aggressive about reconnecting every active environment, startup time and noisy error handling may worsen. Bounded nudging and clear status reporting are important.
