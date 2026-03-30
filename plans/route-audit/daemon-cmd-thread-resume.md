# `thread.resume` — Resume a Thread (Host-Daemon Command)

**Status: Deleted.**

The `thread.resume` command has been fully removed. Thread resume is now handled implicitly by the auto-resume path inside `ensureThreadRuntime` (used by `turn.run` and `turn.steer`). When a daemon restarts between turns, `turn.run`/`turn.steer` silently re-establish the provider session using `runtime.resumeThread` via `ensureThreadRuntime`. There is no longer a separate explicit resume command.

See `daemon-cmd-turn-run.md` for the auto-resume implementation details.
