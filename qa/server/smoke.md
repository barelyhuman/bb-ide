# Server / Env-Daemon Smoke QA

Use this pass for the fastest high-signal manual validation.

## Goal

Confirm the most important server/env-daemon flows still work end-to-end against the real provider.

## When to run

- before or after changes to server lifecycle logic
- before merging high-risk CLI / server changes when a fast manual pass is needed
- as the first pass before deeper stress or regression coverage

## Suggested runtime

- target: 10-20 minutes once the flow is well-practiced

## Required setup

Use the full setup instructions in:
- [`./standalone-server-qa.md`](./standalone-server-qa.md)

For standalone restart scenarios in this pass, pin the exact Node runtime reported by `start-standalone-server-qa.mjs` or use `scripts/qa/relaunch-standalone-server-qa.mjs` instead of plain `node`.

## Automation entrypoint

For the checked-in automation tiers:

```bash
pnpm qa:server:manual-smoke
pnpm qa:server:smoke
pnpm qa:server:smoke:claude-code
pnpm qa:server:smoke:pi
```

`qa:server:manual-smoke` provisions a disposable standalone server and runs a representative CLI-first pass against the real provider.

`qa:server:smoke` runs the real-provider scripted smoke suite against Codex. `qa:server:smoke:claude-code` and `qa:server:smoke:pi` run the same suite against Claude Code and Pi respectively. Some recovery scenarios still require fake Codex control and are covered separately by `pnpm qa:server:recovery:fake`.

## Required scenarios

### Provider verification
- after spawning a thread and waiting for idle, confirm `thread show` reports the correct `providerId` matching the configured provider
- inspect raw events (`thread status --event-mode raw`) and confirm provider event envelopes carry the expected `providerId`

### Local flow
- start thread
- follow-up
- immediate follow-up after idle
- stop then follow-up

### Worktree flow
- start thread
- follow-up
- immediate follow-up after idle
- stop then follow-up
- promote / demote sanity check

### Restart flow
- blocked restart while active work exists
- forced restart while active work exists
- one surviving-worker recovery path
- one missing-worker error path
- follow-up after restart failure

## Primary invariants covered

- thread state converges cleanly
- idle follow-up starts cleanly
- active restart converges to resumed work or explicit error
- missing-worker failure is visible and recoverable
- control-plane actions keep thread/worktree state coherent

## Pass criteria

- all required scenarios complete without ambiguous hangs
- successful cases return to the expected healthy terminal state
- failure cases surface explicit operator-visible errors
- follow-up after failure or stop still works where expected

## If anything fails

Record:
- scenario name
- thread id
- server log path
- relevant CLI outputs
- whether the failure looks like product bug, flake, or stale QA expectation

Preferred bundle capture:

```bash
node scripts/qa/capture-thread-failure-bundle.mjs <thread-id> --scenario smoke
```

Then continue the remaining smoke scenarios if the server is still usable.
