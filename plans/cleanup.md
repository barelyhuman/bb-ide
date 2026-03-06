# Goal

Track non-critical cleanup work that is worth doing, but should not distract from getting the environment boundary right first.

# Scope

This plan is for opportunistic cleanup only. It does not include boundary-defining refactors that are already tracked in [environment-abstraction-leaks-plan.md](/Users/michael/Projects/bb/plans/environment-abstraction-leaks-plan.md).

Examples of work that belongs here:
- collapsing obvious multi-command shell workflows into a single chained command
- naming cleanup
- dead code cleanup
- low-risk API ergonomics improvements
- test cleanup that does not change the architecture

# Implementation Steps

1. Audit obvious multi-command shell workflows and collapse the safe ones into single chained commands.
   Candidates:
   - `git reset --hard && git clean -fd`
   - setup/probe/execute flows that can be expressed as one shell block
   - small git metadata helpers that currently spawn multiple sequential subprocesses for one result

2. Keep reducing stale naming from pre-refactor terminology.
   Candidates:
   - remaining “session” wording where the code now manages `IEnvironment`
   - outdated “worktree” names on logic that is now capability-driven

3. Remove dead compatibility or helper code that is no longer referenced.
   Candidates:
   - old transport/helper utilities discovered during boundary cleanup
   - redundant tests that only covered deleted legacy paths

4. Tighten tests and internal helpers when they are causing friction.
   Candidates:
   - brittle expectations tied to removed parameters
   - mocks that no longer match the current environment contract cleanly

# Validation

- Run the smallest focused package/test command that covers the touched cleanup.
- Prefer targeted validation over full-repo validation for cleanup-only changes.
- Do not mix cleanup validation with boundary-refactor validation unless the code paths overlap.

# Open Questions/Risks

- Chaining commands can reduce subprocess overhead, but it can also make typed error handling and output parsing worse if overused.
- Some “cleanup” ideas are actually boundary changes in disguise; those should stay in [environment-abstraction-leaks-plan.md](/Users/michael/Projects/bb/plans/environment-abstraction-leaks-plan.md) instead.
