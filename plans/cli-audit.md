# CLI Audit Plan

Quality audit of `apps/cli` based on AGENTS.md guidelines and CODE_REVIEW.md checklist.

## Exit Criteria

- All issues below resolved or explicitly deferred with rationale
- `pnpm exec turbo run build --filter=@bb/cli` passes
- `pnpm exec turbo run test --filter=@bb/cli` passes
- No new `as` casts, no new duplicated utilities

---

## Performance

### `--recent-events` fetches all events then slices

**File:** `commands/thread/show.ts:111-119`

All events are fetched (query is `{}`), then sliced client-side. Wasteful for threads with thousands of events.

**Fix:** Add a `limit` query parameter to the timeline endpoint. Wire it through from the CLI's `--recent-events` flag.

---

## Validation

After all fixes:

```bash
pnpm exec turbo run build --filter=@bb/cli
pnpm exec turbo run test --filter=@bb/cli
```
