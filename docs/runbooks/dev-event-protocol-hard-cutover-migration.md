# Dev Event Protocol Hard Cutover Migration

This runbook is for the one-off Phase 5 migration of `~/.bb-dev/bb.db`.

Do not mutate the live dev database while the dev server or host daemon is
running. Coordinate with Michael before stopping services or applying the live
migration.

## Dry Run On A Copy

Use SQLite backup semantics to copy the live DB, then run preflight against only
the copy:

```sh
mkdir -p /tmp/bb-event-protocol-cutover
pnpm --filter @bb/server dev:event-protocol-cutover -- \
  --db ~/.bb-dev/bb.db \
  --copy-to /tmp/bb-event-protocol-cutover/bb-preflight.db \
  --preflight-only
```

Then run the mutation against only a copy:

```sh
mkdir -p /tmp/bb-event-protocol-cutover
pnpm --filter @bb/server dev:event-protocol-cutover -- \
  --db ~/.bb-dev/bb.db \
  --copy-to /tmp/bb-event-protocol-cutover/bb.db \
  --apply
```

The command refuses direct preflight access to `~/.bb-dev/bb.db`; use
`--copy-to` for all uncoordinated checks.

Copied and live DBs may have sparse event sequence histories. This is expected:
event pruning deletes retained-history noise and resolved deltas without
resequencing historical events. The migration verifies positive sequence values
and unique `(threadId, sequence)` keys, not density.

Use `--help` to list flags, defaults, and safety gates.

## Live Run

Live execution requires Michael coordination:

1. Stop the dev server and host daemon.
2. Confirm there are no fetched/in-flight old-protocol commands, or wait for the
   old daemon to settle before mutation.
   Terminal historical commands may still contain legacy `eventSequence`; the
   migration strips those fields because they cannot be fetched again.
3. Run:

   ```sh
   pnpm --filter @bb/server dev:event-protocol-cutover -- \
     --db ~/.bb-dev/bb.db \
     --apply \
     --allow-live-mutation \
     --confirm-services-stopped
   ```

The live command creates
`~/.bb-dev/backups/bb-dev-before-event-protocol-hard-cutover-<timestamp>.db`
before mutation. The command also probes `127.0.0.1:3002` and refuses direct
live mutation if the host daemon is still accepting connections.

## Recovery

If preflight fails, the DB is unchanged because mutation has not started. Inspect
the JSON report's `preflight.issues`, fix the reported rows or wait/drain the
reported fetched old-protocol commands, then rerun a copied dry run before a live
retry.

If integrity fails during apply, the mutation transaction rolls back and leaves
the target DB unchanged. For live apply, keep the backup path from the command
output and inspect the JSON report's `integrity.issues`. Fix the root cause on a
copy first, rerun copied preflight and copied apply, then coordinate another live
attempt.

## Post-Run Checks

- The command output should report `preflight.issueCount: 0` and
  `integrity.issueCount: 0`.
- `GET /api/v1/threads/thr_bj3p5vk9py/timeline` should return `200` after the
  server and daemon restart.
- No stored event JSON should contain `clientRequestSequence`.
- No stored daemon command payload should contain `eventSequence`.
