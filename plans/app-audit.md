# App Audit Plan

Quality audit of `apps/app` based on AGENTS.md guidelines and CODE_REVIEW.md checklist.

## Exit Criteria

- All issues below resolved or explicitly deferred with rationale
- `pnpm exec turbo run build --filter=@bb/app` passes
- `pnpm exec turbo run test --filter=@bb/app` passes
- No new `as` casts, no new arbitrary `text-[Npx]` classes
- All localStorage read/write has a Zod schema defining the expected shape

---

## AGENTS.md Violations

### 13+ uses of `window.alert` / `window.confirm` / `window.prompt`

**Files:** `components/layout/ProjectList.tsx`, `views/ThreadDetailView.tsx`, `hooks/useQuickCreateProject.ts`

Blocking, unstyled browser dialogs. The codebase already has proper dialog components.

**Fix:** Replace all `window.confirm` callsites with the existing `AlertDialog` primitive. Replace `window.prompt` callsites with small modal forms. Replace `window.alert` callsites with toast notifications.

---

## Correctness

### Queued messages never displayed

**Files:** `views/threadQueuedMessages.ts`, `views/ThreadFollowUpComposer.tsx`

The server does not include `queuedMessages` in the `GET /threads/:id` response. `extractThreadQueuedMessages` always returns `[]`, so the `QueuedFollowUpList` component never shows any items. The create/send/delete draft endpoints work, but the UI has no way to fetch and display drafts.

**Fix:** Add a `GET /threads/:id/drafts` route to the server (the `listDrafts` DB function and `toQueuedMessage` converter already exist). Add a `useThreadDrafts` query hook in the app. Invalidate on `queue-changed` WS notifications. Replace `extractThreadQueuedMessages` with the query hook.

---

## Maintainability — Oversized Files

### ThreadDetailView.tsx — 1,327 lines

Contains ~200 lines of helper functions, then a single 1,100+ line component with ~25 hooks, ~15 state variables, and ~20 callback definitions.

**Fix:** Extract into focused modules:
- Git action handlers → `useThreadGitActions.ts`
- Prompt/composer state wiring → colocate with `ThreadDetailPromptArea`

### useApi.ts — 1,094 lines

All 30+ query and mutation hooks in a single file.

**Fix:** Split by domain:
- `hooks/queries/project-queries.ts`
- `hooks/queries/thread-queries.ts`
- `hooks/queries/environment-queries.ts`
- `hooks/queries/system-queries.ts`
- `hooks/mutations/thread-mutations.ts`
- `hooks/mutations/environment-mutations.ts`
- `hooks/queries/shared.ts` for query key factories and `useApiClient`

### ProjectList.tsx — 818 lines

Mixes project CRUD, thread archive/rename/delete flows, sidebar rendering, and three dialog states. `renderThreadRow` alone is ~150 lines of inline JSX.

**Fix:** Extract `ThreadRow` and `ProjectRow` as standalone components. Move dialog state into dedicated hooks.

---

## Testing

### No component or hook tests

Zero tests for React components or hooks. The hooks contain behavioral complexity (reconnection, caching, localStorage sync) that is untested.

**Fix:** Add tests for these hooks in priority order:
1. `useWebSocket` — connection lifecycle, reconnection, message routing
2. `useHostDaemon` — daemon probing, fallback behavior
3. `useThreadCreationOptions` — option persistence, provider/model resolution

---

## Validation

After all fixes:

```bash
pnpm exec turbo run build --filter=@bb/app
pnpm exec turbo run test --filter=@bb/app
```

Grep for regressions:
```bash
grep -rn "text-\[.*px\]" apps/app/src/
grep -rn "window\.alert\|window\.confirm\|window\.prompt" apps/app/src/
```
