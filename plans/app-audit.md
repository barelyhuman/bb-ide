# App Audit Plan

Quality audit of `apps/app` based on AGENTS.md guidelines and CODE_REVIEW.md checklist.

## Status

- Completed on `codex/fix-oversized-files`: oversized-file refactors and the follow-up maintainability fixes from review
- Remaining work: replace the last browser dialogs and add the remaining high-value hook tests

## Exit Criteria

- All remaining issues below resolved or explicitly deferred with rationale
- `pnpm exec turbo run build --filter=@bb/app` passes
- `pnpm exec turbo run test --filter=@bb/app` passes
- No new `as` casts, no new arbitrary `text-[Npx]` classes
- All localStorage read/write has a Zod schema defining the expected shape

---

## Completed

### Maintainability — Oversized Files

- `ThreadDetailView.tsx` reduced from 1,327 lines to 763 lines, with git actions and prompt wiring extracted
- `ProjectList.tsx` reduced from 818 lines to 253 lines, with row rendering and action/dialog logic extracted
- `useApi.ts` removed; queries and mutations now import from their owning modules directly
- Query helper concerns split into `query-keys.ts`, `query-cache.ts`, `query-placeholders.ts`, and `query-client.ts`
- Thread mutations split into `thread-runtime-mutations.ts` and `thread-state-mutations.ts`
- Review follow-ups completed: dialog state identity stabilized, duplicated thread-detail mutation types deduplicated, and environment work status helper naming aligned

Validation on current branch head:

- `pnpm exec turbo run build --filter=@bb/app`
- `pnpm exec turbo run test --filter=@bb/app`

---

## Remaining

### AGENTS.md Violations

#### 3 remaining uses of `window.alert` / `window.confirm` / `window.prompt`

**Files:** `views/ThreadDetailView.tsx`, `hooks/useQuickCreateProject.ts`

Blocking, unstyled browser dialogs still remain in archive/delete confirmation flows and quick-create error handling.

**Fix:** Replace `window.confirm` callsites with existing dialog primitives and replace the `window.alert` callsite with toast-based feedback.

## Testing

### Missing direct tests for remaining stateful hooks

The app now has coverage for `useWebSocket`, `useTheme`, `HireManagerModal`, `ImageLightbox`, and query/helper behavior, but two high-value hooks still lack direct tests.

**Fix:** Add tests for these hooks in priority order:

1. `useHostDaemon` — daemon probing, local-host resolution, and open-path/pick-folder availability
2. `useThreadCreationOptions` — localStorage persistence, provider/model fallback, and environment selection reset behavior

---

## Validation

After all fixes:

```bash
pnpm exec turbo run build --filter=@bb/app
pnpm exec turbo run test --filter=@bb/app
```

Grep for regressions:

```bash
rg -n "text-\\[.*px\\]" apps/app/src/
rg -n "window\\.alert|window\\.confirm|window\\.prompt" apps/app/src/
```
