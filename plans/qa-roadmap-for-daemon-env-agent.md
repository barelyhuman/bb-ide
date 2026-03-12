# Goal

Make daemon/env-agent QA faster, more reliable, and more trustworthy after the lifecycle rewrite lands.

# Scope

- Improve QA ergonomics for manual and scripted end-to-end passes.
- Improve observability for session/liveness state during restart and worker-loss scenarios.
- Reduce reliance on ad hoc shell parsing and direct SQLite inspection for common checks.
- Add a path to keep the standalone QA matrix aligned with real lifecycle behavior as the architecture evolves.

# Implementation Steps

1. Add machine-readable CLI output for the core inspection commands used in QA.
   - `bb daemon health --json`
   - `bb project list --json`
   - `bb thread show --json`
   - `bb thread status --json`
   - `bb thread log --json`
   - `bb thread output --json`

2. Add CLI wait primitives for common lifecycle polling.
   - `bb thread wait <id> --status <status> --timeout <seconds>`
   - `bb thread wait <id> --event <normalized-event-type> --timeout <seconds>`
   - return stable exit codes for timeout vs invalid request vs success

3. Add daemon/CLI inspection for env-agent session state.
   - `bb thread sessions <id> --json`
   - include session id, status, close reason, control endpoint, last heartbeat, lease expiry
   - optionally add `bb daemon sessions --active`

4. Add a checked-in QA harness for the standalone daemon matrix.
   - encode the scenarios from `docs/standalone-daemon-qa.md`
   - verify API output, SQLite state, and daemon logs together
   - support both local and worktree flows
   - support hard worker-loss simulation, not only graceful shutdown

5. Split QA into tiers.
   - smoke pass: start/follow-up/stop/basic restart
   - lifecycle stress pass: immediate follow-ups, queued work, restart/liveness, provisioning edge cases
   - regression pass: previously discovered bugs with stable repros

6. Add targeted QA commands or helpers for recovery-heavy cases.
   - a helper to print the active thread/worktree/session summary
   - a helper to print the current daemon log path
   - a helper to capture a concise failure bundle for one thread

7. Keep the QA docs aligned with architecture semantics.
   - update the doc whenever worker lifecycle semantics change
   - explicitly separate “expected live session during run” from “session state after final idle”
   - remove stale assumptions quickly so future passes do not test the wrong thing

# Validation

- Run the standalone QA matrix using only the CLI/API surfaces intended for operators, without shell parsing of human-readable output.
- Verify the harness can reproduce:
  - immediate follow-up after idle
  - surviving restart
  - hard missing-worker restart
  - idle restart with fresh session
  - worktree promote/demote
- Verify a new engineer can run the documented pass without needing direct SQLite knowledge for the common path.

# Open Questions/Risks

- How much CLI surface do we want to expose for low-level env-agent session data versus keeping that daemon/API-only?
- Do we want a dedicated QA harness under `scripts/` or as an end-to-end test target under the daemon package?
- Some restart/liveness scenarios are inherently timing-sensitive with the real provider; the harness should prefer durable invariants over exact timing expectations.
