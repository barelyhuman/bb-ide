# Server QA

This surface owns server-side invariants that are primarily about the server itself rather than env-daemon runtime behavior.

Owned areas:

- routing and API behavior
- persisted thread state and resumption
- graceful shutdown and restart behavior from the server's perspective
- server-side reconciliation of existing session state

Default pass:

- [`./core.md`](./core.md)

Deeper pass:

- [`./recovery.md`](./recovery.md)
- [`./invariants.md`](./invariants.md)
- [`./regressions.md`](./regressions.md)

If a scenario is really about multi-provider session runtime, thread isolation inside one daemon, or worker-loss handling mechanics, it likely belongs in `qa/env-daemon/` instead.
