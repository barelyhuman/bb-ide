# Thread Timeline Auto-Scroll Rewrite

## Problem

`useThreadTimelineController` has regressed the "auto-scroll to bottom when pinned" behavior 10+ times in the last ~6 months (see `git log --grep=scroll`). Two current bugs:

1. **Git diff stats banner appearing late**: when `workspaceStatus` resolves after initial mount, the banner renders in the footer, shrinking the scroll viewport. The scroll position does not re-anchor to the new bottom — the banner visually covers the last row(s) of the timeline.
2. **Streaming / expanding tool-group rows**: when an active command's output grows (streaming text, expand/collapse transitions), the scroll position does not track the new bottom, leaving content below the viewport.

## Root cause

The controller infers "content changed, re-pin to bottom" through multiple partial signals:

- `MutationObserver` on the scroll container with `{ subtree: true, childList: true }` — missing `characterData`, silently dropped in commit `1a98adff` (2026-03-29) buried in a 143-file mega-commit. Earlier commit `c400e4b5` explicitly documented that `characterData` was load-bearing.
- Two separate `ResizeObserver`s (container border box + composer border box) with their own "meaningful change" thresholds and previous-value refs.
- Three self-scheduled reconciles inside `scrollToBottom` (immediate, next-RAF, 180ms timeout).
- A reset-to-null dance on every `threadId` change that nulls out previous-size refs, creating a race window where the first post-reset observer fire is treated as "no meaningful change" when it should trigger reconcile.

No single signal is authoritative. Every past fix patched whichever signal missed the symptom of the day. The architecture guarantees recurrence.

## Approach: adopt `use-stick-to-bottom`

We replace the custom observer/reconcile machinery with `use-stick-to-bottom` — a battle-tested library that implements exactly the architecture we'd otherwise hand-roll, but with orders of magnitude more stress-testing.

### Why this library

- **2.15M weekly npm downloads** (week of 2026-04-15). Powers Bolt.new; used by shadcn/ui's AI conversation component — the exact use case.
- **Zero runtime dependencies**, MIT, first-class TypeScript, React 16.8–19 compatible.
- **9 total open issues** across a library with millions of users — small auditable surface.
- API is the architecture: `useStickToBottom()` returns `{ scrollRef, contentRef }`. Detection is a `ResizeObserver` on the content ref (the single authoritative signal for content size). Does NOT require CSS `overflow-anchor` — works in Safari.
- Distinguishes user scrolls from programmatic scrolls natively, which is the exact bug class we keep regressing.

### Known issues to audit before adopting

From the library's open issue tracker:

- **#31 ResizeObserver disconnect on unmount leak** — minor leak, low impact. Note in the wrapper; consider contributing a fix upstream if we hit it.
- **#9 iOS quirks** — relevant if mobile is in scope. Our app runs in mobile browsers, so test iOS Safari before shipping.
- **#32 Safari 85% zoom jitter** — niche; accept.
- **#29 `initial="instant"` doesn't work** — we want instant-on-mount (current behavior); verify this works or use `scrollToBottom()` imperatively on mount.

### What we give up (and why it's fine)

Our current controller captures a specific row's `offsetTop` on scroll-up and restores it through mutations (`captureTimelineScrollAnchorFromViewport`, `getTimelineAnchorOffsetDelta`). The library uses the simpler "stay at bottom OR preserve browser scrollTop" model.

For our use case — new messages/content append below the fold while the user reads history — browser-default scroll position preservation is sufficient: if content only grows at the bottom, the user's reading position (scrollTop from the top) doesn't shift. The only case where explicit row-anchor matters is when content *above* the reading position changes size (e.g., a collapsed tool group above expands). That case is rare and, when it happens today, the row-anchor logic is already fighting against the pin-to-bottom logic. Accept the simpler model.

## Implementation steps

### 1. Add the dependency

```
pnpm --filter @bb/app add use-stick-to-bottom
```

Verify it lands in `apps/app/package.json` and lockfile. No peer-dep conflicts expected (React 18/19 supported).

### 2. Replace the scroll machinery in PageShell

`apps/app/src/components/layout/PageShell.tsx`:

- Accept an optional `scrollBehavior` prop with a discriminated union: `"static"` (current behavior) or `"stick-to-bottom"` (new). Default `"static"` so other callers are unaffected.
- When `"stick-to-bottom"`, render the scroll area using the library's `useStickToBottom` hook, attaching `scrollRef` to the scroll container and `contentRef` to the inner content wrapper (line 41 div).
- Add `[overflow-anchor:none]` Tailwind class on the scroll container as defensive measure (browser scroll anchoring can fight the library's logic).
- Remove the `scrollRef` and `onScroll` props from `PageShell`'s public API — they're no longer threaded through for this mode.

### 3. Delete `useThreadTimelineController`'s scroll code

The hook currently mixes two responsibilities: scroll orchestration and tool-group message loading. Separate them.

- Extract the thread-domain logic (`toolGroupMessagesById`, `loadingToolGroupIds`, `handleLoadToolGroupMessages`, `shouldLoadToolGroupMessages`) into a small `useToolGroupMessageLoading` hook in the same file or a new sibling file.
- Delete everything else in `useThreadTimelineController.ts`: `MutationObserver`, both `ResizeObserver`s, `scrollToBottom`'s RAF chain, `captureTimelineScrollAnchor*`, `restoreAnchorPosition`, `reconcileScrollPosition`, `syncScrollState`, `modeRef`, all the timing-window refs, the reset-to-null block, and the `promptComposerRef` export.
- The hook's public API shrinks to: `{ handleLoadToolGroupMessages, loadingToolGroupIds, toolGroupMessagesById }`. Scroll-related returns move to consumer components via library hooks.

### 4. Rewire the scroll-to-bottom button

`ThreadTimelineScrollToBottomButton` currently takes an `onClick`. Replace that with reading from `useStickToBottomContext()`:

- The button is rendered inside the `<StickToBottom>` subtree (or wherever the hook's context is available).
- It reads `{ isAtBottom, scrollToBottom }` from context and renders only when `!isAtBottom`. Click calls `scrollToBottom()`.
- The atom `threadTimelineShowScrollToBottomAtom` becomes redundant — delete it and its setter. `isAtBottom` from context is the source of truth.

### 5. Drop `promptComposerRef` plumbing

The composer ref existed only to feed the composer `ResizeObserver`. With the library's content-ref-based detection, the composer is no longer observed separately (the library detects viewport changes via its internal scroll-ref observer and content growth via the content-ref observer).

- Remove the `promptComposerRef` prop from `ThreadDetailPromptArea` and `ThreadFollowUpComposer`.
- Remove `<div ref={composer.composerRef}>` wrapper in `ThreadFollowUpComposer.tsx:292` — the inner children render directly.
- Update `ThreadDetailPromptArea.test.tsx` to drop the `promptComposerRef` fixture field.

### 6. Trim helpers

In `apps/app/src/views/threadTimelineControllerHelpers.ts`, delete:

- `hasMeaningfulComposerHeightChange`
- `hasMeaningfulTimelineContainerResize`
- `captureTimelineScrollAnchorFromViewport`
- `getTimelineAnchorOffsetDelta`
- `resolveTimelineScrollMode`
- `isTimelineNearBottom` (if unused after removal — verify)
- `shouldShowTimelineScrollToBottom` (replaced by library's `isAtBottom`)
- All `TimelineScrollMode`, `TimelineScrollAnchor`, `TimelineViewportSnapshot`, etc. types

Keep `shouldLoadToolGroupMessages` and its associated `ToolGroupLoadState` type — they're thread-domain, not scroll.

Update `threadTimelineControllerHelpers.test.ts` to cover only what remains.

### 7. Warning comment

Add a header comment at the top of the new thin controller file:

```
// Auto-scroll behavior is owned by the `use-stick-to-bottom` library. Do not
// reintroduce custom ResizeObserver / MutationObserver / scroll-reconcile
// machinery here. Past regressions: see git log --grep=scroll before
// 2026-04-22.
```

### 8. iOS audit

Before merging: open the dev build on iOS Safari, reproduce both bug scenarios (banner appearing late + streaming tool-group growth), verify they're fixed. Check the library's issue #9 symptoms while testing.

## Out of scope

- **`useStickyBottomAutoScroll`** in `packages/ui-core/src/thread-timeline/rows/shared.tsx` has the same class of fragility (relies on caller-passed `scrollDep`). If it proves to have the same bugs, migrate it to `use-stick-to-bottom` as a follow-up.
- **E2E harness**: none exists; adding one is a separate project.
- **Smooth-scroll animation**: use the library's default spring animation. If users don't like it, set `initial="instant"` or override via the `behavior` option.

## Fallback if the library doesn't fit

If iOS audit surfaces blocking issues, or reading-history anchor fidelity proves insufficient, fall back to the hand-rolled architecture originally drafted here: two `ResizeObserver`s (content wrapper + scroll container) feeding a single `enforceInvariant` function, with mode transitions driven purely by user scroll events and explicit actions. Same goal — one authoritative signal, one invariant — just without the library. Keep this section as a parenthetical note; do not implement unless the library is rejected.

## Exit criteria

All of the following must hold:

1. Both reported bugs fixed, verified manually:
   - Open a thread with an active git-diff state that resolves >200ms after mount → banner appears after initial render → viewport remains pinned to the bottom row.
   - Open a thread with an active streaming command → output grows → viewport remains pinned to the bottom.
   - Toggle a tool-group row open while pinned → scroll tracks the expanded row's new bottom.
2. Scrolling up during a live thread leaves the view at the reading position; new content streaming in does not snap the view back to bottom.
3. The scroll-to-bottom button appears exactly when the user is not at bottom, and re-pins cleanly.
4. iOS Safari verified: no jitter, no stuck scroll, both bug scenarios pass.
5. `pnpm exec turbo run typecheck --filter=@bb/app` passes.
6. `pnpm exec turbo run test --filter=@bb/app > /tmp/timeline-test.txt 2>&1` passes; read the file to confirm.
7. Net line count in `apps/app/src/views/useThreadTimelineController.ts` drops from ~570 to ~60 (thread-domain logic only), and `threadTimelineControllerHelpers.ts` drops from ~162 to ~25.
8. No references remain to `MutationObserver`, `promptComposerRef`, `previousComposerHeightRef`, `previousContainerSizeRef`, `postJumpTimeoutRef`, `layoutTransitionUntilRef`, `pendingReasonsRef`, or the deleted helpers anywhere in `apps/app/src/`.

## Validation instructions

Manual:

1. `pnpm install` (picks up `use-stick-to-bottom`).
2. Start dev: frontend at `:5173`, server at `:3334`.
3. In a thread with a dirty working tree, open the thread from the sidebar. Observe the git banner appearing after initial load — the timeline bottom stays in view.
4. Trigger a tool that streams output (long-running bash command). Output grows — viewport tracks the bottom.
5. Scroll up mid-stream; verify the view holds position and the scroll-to-bottom button appears.
6. Click the scroll-to-bottom button; verify pinning resumes.
7. Open a tool-group row that was collapsed while pinned; verify the viewport tracks the expansion.
8. Repeat steps 3–5 on iOS Safari (real device or simulator) before declaring done.

Automated:

- `pnpm exec turbo run typecheck --filter=@bb/app`
- `pnpm exec turbo run test --filter=@bb/app > /tmp/timeline-test.txt 2>&1` then read `/tmp/timeline-test.txt`.

## Delete this plan once shipped

Per `AGENTS.md`: delete `plans/timeline-auto-scroll-rewrite.md` after the change lands and exit criteria are verified.
