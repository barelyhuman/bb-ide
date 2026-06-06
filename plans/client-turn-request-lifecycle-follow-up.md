# Client turn request lifecycle follow-up

## Remaining Scope

The durable `client_turn_requests` table now prevents completed `thread.start`
and `turn.submit` commands from leaving timeline-visible request rows
permanently pending, but two parts of the original lifecycle plan are still not
complete:

- Runtime settlement is not exact. Command success currently settles a pending
  request as `status: "accepted"` with `reasonCode: "command_succeeded"` when
  no native `turn/input/accepted` event arrives. That records command
  completion, but it does not prove provider-native input acceptance.

## Exit Criteria

- Runtime/adapters guarantee every persisted `client/turn/requested` backed by
  `thread.start` or `turn.submit` reaches exactly one lifecycle outcome:
  native accepted, command failed/expired, runtime canceled, provider detached,
  provider restarted, superseded, or stale target.
- Command-success-only settlement remains distinguishable from native provider
  acceptance for diagnostics and timeline analysis.
- Any future diagnostic query wired to production has a real caller and avoids
  full scans of the hot `events` table.

## Validation

- Add regression coverage for a command success with no native
  `turn/input/accepted` and assert the lifecycle reason is
  `command_succeeded`.
- Add failure/expiry coverage proving terminal failed requests do not render as
  pending steers.
- Add adapter/runtime coverage for queued provider request ids that are cleared
  without native acceptance.
- Re-run:
  `pnpm exec turbo run typecheck test --filter=@bb/server --filter=@bb/host-daemon --filter=@bb/agent-runtime --filter=@bb/thread-view --filter=@bb/db`
