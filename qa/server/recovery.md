# Server Recovery QA

Use this pass when the change affects server restart, shutdown, or persisted resume behavior in ways that need deeper failure-path coverage.

## Focus

- server restarts while threads exist
- persisted thread state remains coherent across restart boundaries
- resumed threads remain inspectable and recoverable
- server-visible failure states are explicit rather than ambiguous

## Recovery scenarios

- blocked restart while active work exists
- forced restart while active work exists
- restart after a thread has already returned to `idle`
- follow-up after restart failure clears `error` back to a healthy terminal state
- restart during `provisioning` or `provisioned` before the first real `turn/started`

## Notes

- Many historical recovery scenarios are still documented in the legacy umbrella docs while ownership is being split.
- If the scenario is fundamentally about env-daemon liveness, worker replacement, or multi-session runtime behavior, prefer `qa/env-daemon/recovery.md`.

## Related docs

- [`../legacy/server/standalone-server-qa.md`](../legacy/server/standalone-server-qa.md)
- [`./invariants.md`](./invariants.md)
- [`./regressions.md`](./regressions.md)
