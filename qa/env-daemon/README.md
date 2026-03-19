# Env-Daemon QA

This surface owns runtime supervision behavior inside the environment daemon.

Owned areas:

- multiple providers and multiple threads in one daemon
- isolation when one thread or provider misbehaves
- non-blocking behavior across sessions
- reconnect and replacement behavior
- cleanup, leak, and long-lived runtime health

Default pass:

- [`./core.md`](./core.md)

Deeper pass:

- [`./recovery.md`](./recovery.md)
- [`./invariants.md`](./invariants.md)
- [`./regressions.md`](./regressions.md)
