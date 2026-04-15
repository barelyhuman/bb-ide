# UI Stack Boundary Cleanup

## Diagnosis

Four real issues across `@bb/core-ui`, `@bb/ui-core`, and `apps/app`:

1. **Event decoding is done via ad-hoc field accessors.** `core-ui/src/event-decode.ts` exposes helpers like `getEventTurnId`, `getEventProviderThreadId`, `getEventParentToolCallId` that projection modules call scattered throughout the codebase. These helpers exist because `ThreadEvent` is a discriminated union with many variants that don't all carry every field — but walking around that with runtime accessors erases the type system's knowledge of which variant carries which field. The right shape is: decode/narrow once at the boundary, then access variant-specific fields directly. A prior draft proposed a parallel `ThreadEventDecoded` type — that would duplicate the domain union and is wrong. The fix is to use the existing union correctly with type narrowing, not to mirror it.

2. **User-message deduplication is spread across three concerns with one unresolved asymmetry.** `user-message-dedup.ts` (signature-counts for client-start, client-thread-start, provider-native events) and `pending-client-requested-messages.ts` (correlation-id-keyed queue for client-requested messages) exist side-by-side because only `client/turn/requested` currently carries a `clientRequestSequence` correlation id. The other event types (`client/thread/start`, `client/turn/start`, Codex's native user-message echo) still need string-signature dedup. This is a symptom of user-message content being spread across multiple event types; a cleaner fix is to either (a) extend `clientRequestSequence` through all user-message-carrying event types or (b) consolidate so only `client/turn/requested` carries user-message content.

3. **`threadDetailActivity.ts` lives in `@bb/ui-core` but does projection work.** Functions like `findLatestActivityMessageId` and `shouldPreferOngoingLabelsForRow` reach into `ViewMessage` discriminated unions to classify rendering intent. That's projection logic, and projection logic lives in `core-ui`. `ui-core` should be rendering, not classification.

4. **`to-view-messages.ts` at 852 lines mixes concerns.** State initialization, event loop, subsidiary lifecycle handlers (tool activity, operations), and normalization passes are all co-located. Extracting the projection state's lifecycle into its own module would let the main loop be read as "decode event → advance state → emit messages" without scrolling past initialization helpers.

## Phase 1: Narrow `ThreadEvent` at the boundary, delete field-accessor helpers

**Goal:** Replace `getEventTurnId(event)`-style calls with type-narrowed access to the specific variant.

**Changes:**
- In `to-view-messages.ts` and the projection modules it calls, replace calls to `getEventTurnId`, `getEventProviderThreadId`, `getEventParentToolCallId`, and similar accessors with `switch (event.type)` blocks that narrow the union.
- Where a projection genuinely needs "turnId if the event has one" across heterogeneous variants, add a single helper in `core-ui` that returns `string | undefined` with a strongly-typed parameter (`event: Extract<ThreadEvent, { turnId: string }>` or similar). Don't create a parallel union type.
- Delete the `getEvent*` accessors once call sites migrate.

**Exit criteria:**
- `grep -r "getEventTurnId\|getEventProviderThreadId\|getEventParentToolCallId" packages/core-ui/src` returns zero matches outside the file being deleted.
- No new types added that mirror `ThreadEvent`.
- `pnpm exec turbo run test --filter=@bb/core-ui` passes.

## Phase 2: Pick a direction for user-message dedup

**Goal:** Eliminate the signature/correlation-id split. This is a design call, not a refactor — make the call before coding.

**The call to make:**
- **Option A: Extend `clientRequestSequence` to every user-message-carrying event type.** Requires adding the field to `client/thread/start` and `client/turn/start` schemas, threading it through the server's event construction, and having Codex's adapter attach it to the provider's native user-message echo. Once done, `user-message-dedup.ts` can drop to a single correlation-id-keyed queue; the signature system disappears.
- **Option B: Consolidate user-message content into `client/turn/requested` only.** `client/thread/start` and `client/turn/start` become pure lifecycle events with no user-message payload. Provider-native user messages from Codex are treated as echoes of an already-represented client request. Larger schema change, cleaner end state.

Option B is architecturally better but affects persisted events and the server's event-construction paths. Option A is behaviorally smaller. **Write the plan for both and pick based on how much you want to touch the event schema.**

**Exit criteria:**
- Decision recorded in this plan with reasoning.
- `user-message-dedup.ts` has one consistent dedup mechanism (ids, not signatures) when done.
- `userMessageSignature` removed.

## Phase 3: Move `threadDetailActivity` from `ui-core` to `core-ui`

**Goal:** Projection logic lives with the other projection logic.

**Changes:**
- Move `packages/ui-core/src/thread-timeline/threadDetailActivity.ts` to `packages/core-ui/src/thread-detail-activity.ts`.
- Export from `core-ui/src/index.ts`.
- Update import sites in `ui-core` and `apps/app` to import from `core-ui`.

**Exit criteria:**
- File no longer in `ui-core/src`.
- `grep -r "threadDetailActivity" packages/ui-core/src` returns no matches.
- `pnpm exec turbo run test --filter=@bb/core-ui --filter=@bb/ui-core` passes.

## Phase 4: Extract projection state lifecycle from `to-view-messages.ts`

**Goal:** Let the main loop be read top-to-bottom without mental paging through initialization and finalization helpers.

**Changes:**
- Create `packages/core-ui/src/projection-state.ts`:
  - `ProjectionState` interface (currently declared inline in `to-view-messages.ts`)
  - `initProjectionState()` factory
  - `finalizeProjectionState(state, options)` (encapsulates the current `finalizePendingMessages()` logic)
- Have `tool-activity-projection.ts` and `operation-projection.ts` register their state initialization/teardown through `projection-state.ts` rather than being set up inline in `to-view-messages.ts`.
- `to-view-messages.ts` becomes: `initProjectionState()` → loop over events → `finalizeProjectionState()` → return.

**Exit criteria:**
- `to-view-messages.ts` drops below 600 lines (not a prescriptive limit — a sanity check that the extraction actually pulled weight).
- `ProjectionState` interface has exactly one definition, in `projection-state.ts`.
- `pnpm exec turbo run test --filter=@bb/core-ui` passes.

## Out of scope — considered and declined

- **Creating a `ThreadEventDecoded` parallel type.** Explicitly rejected; the fix is better use of narrowing, not a mirror type.
- **Renaming `semantic-view-messages.ts` → `projection-grouping.ts`** or similar style renames. Brief forbids rename-for-style.
- **Auditing `ui-core/src/thread-timeline/rows/*.tsx` for speculative projection leaks.** Do this when Phase 3 completes if something surfaces; don't create work preemptively.
- **Creating a `@bb/ui-contract` package.** The UI view types are legitimately shared vocabulary; splitting them out loses nothing.
- **Extracting `ViewMessage` union variants into subtypes.** Minor DX improvement, no boundary violation.

## Expected impact

Phase 1 is cosmetic-looking but restores type-system help — meaningful. Phase 2 is the biggest architectural call; do it carefully. Phase 3 is a file move. Phase 4 is a focused refactor of one large file. Phases 1, 3, 4 are independent; Phase 2 is gated on making the design call first.
