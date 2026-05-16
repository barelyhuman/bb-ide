# User Message Origin Badge Plan

Status: Product decisions signed off. Implementation not yet started.

## Goal

User messages in the thread timeline can come from three sources:

- The human user via the UI/API.
- Another agent thread via `bb thread tell` (cross-thread agent message).
- The bb system (e.g., scheduled nudges).

Today the only UI signal that distinguishes these is a prefix baked into the message text:

- Agent: `[bb message from thread:<id>; reply with \`bb thread tell <id> "<your response>"\`]\n\n<body>` — emitted by `buildAgentThreadMessageText` in `apps/server/src/services/threads/thread-send.ts:144`.
- System: `[bb system] Scheduled nudge: <name>. Check ASYNC.md.` — emitted by `buildScheduledNudgeInput` in `apps/server/src/services/scheduling/nudge-sweep-runner.ts:126`.

The renderer treats this as plain text. The prefix is necessary for the model (the agent learns the reply command from reading it) but it's noise in the UI.

This plan replaces the raw prefix in the UI with a structured badge, without changing what the model sees.

## Approach

Option 2 from the design discussion: keep the prefix in the persisted text for the model, render a badge in the UI, and hide the prefix line at render time.

The agent's reply contract is unchanged: persisted events still carry the prefix verbatim, so the model still sees the `bb thread tell <id> ...` instruction. Only the timeline-row presentation changes.

## What We Already Have

The persisted `client/turn/requested` event already records the initiator structurally:

- Schema: `packages/domain/src/thread-events.ts:28-30, 88-101`
  - `threadTurnInitiatorSchema = z.enum(["user", "agent", "system"])`
  - `turnRequestEventDataSchema` has `initiator: threadTurnInitiatorSchema.optional()`
- Write sites:
  - `apps/server/src/services/threads/thread-send.ts:209` — sets `"user"` or `"agent"`
  - `apps/server/src/services/scheduling/nudge-sweep-runner.ts:543` — sets `"system"`

So the projection layer in `packages/thread-view/src/user-message-parsing.ts` can read the initiator directly from the event. No classifier, no regex, no prefix parsing.

## Gaps To Close

1. **`initiator` is `.optional()` but always written.** Every write path sets it (`"user"`, `"agent"`, `"system"`). Per AGENTS.md "Optional contract fields are allowed only when leaving the field out has its own real semantic meaning. Do not use optional fields to hide defaults" — this should be required on `turnRequestEventDataSchema` and on its persisted counterpart `storedTurnRequestEventDataSchema` in `packages/domain/src/stored-thread-event.ts:88-99`.

2. **Sender thread id for the agent case is only in the prefix string.** The event carries `initiator: "agent"` but not the structured sender thread reference — that lives inside the prefix template substitution. For the badge to say "from <thread>" without parsing, the sender thread id must be a structural field on the event (and on the timeline row).

3. **`TimelineUserConversationRow` has no `initiator` field.** Contract is at `packages/server-contract/src/thread-timeline.ts:96-103`.

## Contract Changes

### Event schema

In `packages/domain/src/thread-events.ts`:

- Change `initiator: threadTurnInitiatorSchema.optional()` to `initiator: threadTurnInitiatorSchema` (required).
- Add `senderThreadId: z.string().nullable()` (or a structured `senderRef` if a richer shape is warranted — see open question). Required field; `null` when `initiator !== "agent"`.

Mirror the same changes in `storedTurnRequestEventDataSchema` (`packages/domain/src/stored-thread-event.ts:88-99`).

The current `source: z.enum(["spawn", "tell"])` field stays. `source === "tell"` and `initiator === "agent"` are related but distinct (the human user can also `bb thread tell` from the CLI, which would be `source: "tell"` + `initiator: "user"`); the badge keys off `initiator`, not `source`.

### Timeline row contract

In `packages/server-contract/src/thread-timeline.ts:96-103`, extend `timelineUserConversationRowSchema`:

```ts
{
  // ... existing fields (id, threadId, turnId, text, attachments, role, userRequest, ...)
  initiator: threadTurnInitiatorSchema,          // required
  senderThreadId: z.string().nullable(),         // required, null unless initiator === "agent"
}
```

Both fields are required. There is no "unknown initiator" case — the event always records one.

### Server-contract dependency

`packages/server-contract` already depends on `@bb/domain` for `threadTurnInitiatorSchema`; the new field reuses that import — no new package dependency.

## Projection

In `packages/thread-view/src/user-message-parsing.ts:289`:

- Read `initiator` and `senderThreadId` from the `client/turn/requested` event data.
- Populate them on the produced `TimelineUserConversationRow`.
- Do **not** modify `text` — the prefix stays in the row's text field so any downstream consumer (search, export, copy-from-server-contract) gets the same bytes as the model.

## Write-Site Updates

- `apps/server/src/services/threads/thread-send.ts:209` — pass `senderThreadId` when `initiator === "agent"`; pass `null` otherwise.
- `apps/server/src/services/scheduling/nudge-sweep-runner.ts:543` — pass `senderThreadId: null`.
- Any other place that writes `client/turn/requested` events — audit during implementation.

## Renderer

In `apps/app/src/components/thread/timeline/ConversationMessageContent.tsx:391` (`UserConversationMessage`):

- Add `initiator` and `senderThreadId` to the row prop type.
- Branch on `initiator`:
  - `"user"`: no chip, no slicing — render exactly as today.
  - `"agent"`: render a chip above the bubble reading `from <title>`, where `<title>` is a `NavLink` to the sender thread. Title is read from the cached project thread list (`useThreads({ projectId })`). If the sender thread isn't in cache, fall back to a truncated id; the link still points at the thread route. Slice the agent prefix from the displayed text.
  - `"system"`: render a chip above the bubble reading `bb system` with a neutral icon (`Bell` or `Cog` — pick during implementation). Slice the system prefix from the displayed text.
- The chip sits in the same right-aligned column as the bubble (`ml-auto w-fit max-w-[80%]`), above it. Reuse existing typography tokens — no arbitrary `text-[Npx]`.
- Slicing uses the known prefix format keyed by `initiator`, computed in a small renderer-local helper. The helper is the only place that knows the prefix shape; it imports the prefix constant (`SCHEDULED_NUDGE_PREFIX`) and the `agentThreadMessage` template body directly so the dependency is structural.
- Copy-to-clipboard uses the sliced display text — users should not paste the prefix.

The prefix-slicing helper lives next to `UserConversationMessage` (renderer-local). It is **not** the rejected `classifyUserMessageOrigin` proposal — it does not classify, it slices given an already-known `initiator`.

Badge/chip component: a small new primitive colocated with `UserConversationMessage`. Reuses existing typography tokens, Lucide icons, and link styling (match the manager/managed-by `NavLink` pattern from [[plans/thread-prompt-context-banner.md]]). No new shared primitive unless a second caller appears.

## Signed-Off Product Decisions

1. **Agent sender display: "From <title>" where the title is the link to the sender thread.**
   - Badge text reads `from <sender thread title>`; the title text itself is the `NavLink` to the sender thread (matches the manager-children/managed-by pattern from [[plans/thread-prompt-context-banner.md]]).
   - Title resolution is **client-side** from the cached project thread list (`useThreads({ projectId })` — same data the sidebar uses). No projection join, no contract change when titles are edited.
   - Fallback if the sender thread isn't in cache (cross-project, archived, deleted): render `from <truncated id>` with the id still linking to the thread route. Renderer must not throw on a missing title.
   - Contract: `senderThreadId: string | null` — bare id is sufficient because title is resolved client-side.

2. **Badge placement: chip above the bubble.**
   - Small chip rendered above the right-aligned user bubble, right-aligned to match the bubble's column. The chip sits in the same `ml-auto w-fit max-w-[80%]` column as the bubble itself.
   - No badge for `initiator === "user"` — only agent and system messages get a chip.

3. **System badge copy: "bb system".**
   - Generic label, neutral icon (`Bell` or `Cog` — pick during implementation). No structured `systemKind` field on the event for now.
   - If/when a second system source ships, add `systemKind` to the event then.

4. **`userRequest` overlap is a bug, not a coexistence case.**
   - `userRequest` describes a human-driven action on a turn; `initiator !== "user"` rows should never carry it. Verify during slice 2 implementation; if any path produces an overlap, fix the producer rather than reconciling at render.

## Implementation Slices After Sign-Off

1. **Domain + persisted-event schema.**
   - Make `initiator` required on `turnRequestEventDataSchema` and `storedTurnRequestEventDataSchema` in `packages/domain/`.
   - Add `senderThreadId: string | null` (required) to both schemas.
   - Update all write sites to pass `senderThreadId` (`thread-send.ts`, `nudge-sweep-runner.ts`, plus any others surfaced by typecheck after the schema change).
   - Decision: existing persisted events in the dev DB have `initiator` optional and no `senderThreadId`. Per [[feedback-no-legacy-data]] we don't ship legacy data; this work proceeds without backfill and existing dev rows can be discarded if needed.

2. **Server-contract row + projection.**
   - Extend `timelineUserConversationRowSchema` in `packages/server-contract/src/thread-timeline.ts` with `initiator` and `senderThreadId`.
   - Populate both in `packages/thread-view/src/user-message-parsing.ts` from the event.
   - Tests in `packages/thread-view/test/` covering all three initiator values + senderThreadId presence/absence.

3. **Renderer.**
   - Add badge component + prefix-slicing helper next to `UserConversationMessage`.
   - Branch on `initiator`; render badge; slice display text; copy-to-clipboard uses sliced text.
   - No new shared primitive unless a second caller appears.

4. **Verification.**
   - Turbo typecheck across affected packages.
   - Manual app verification: human message, agent-to-agent message, scheduled-nudge message all render with correct badge and clean body.

## Exit Criteria

Planning exit criteria:

1. ✅ This plan is committed under `plans/`.
2. ✅ Michael signed off on the open product decisions (see "Signed-Off Product Decisions" above).

Implementation exit criteria:

1. `turnRequestEventDataSchema` and `storedTurnRequestEventDataSchema` declare `initiator` as required (no `.optional()`).
2. Both schemas declare `senderThreadId: string | null` as a required field.
3. Every write site for `client/turn/requested` events passes `senderThreadId` explicitly (typecheck-enforced).
4. `timelineUserConversationRowSchema` declares `initiator` and `senderThreadId` as required fields.
5. The timeline projection populates `initiator` and `senderThreadId` from the event without reading or parsing the row's text.
6. Given a user-initiated message, the renderer shows no origin chip and renders the message text as-is.
7. Given an agent-initiated message whose sender thread is in the cached project thread list, the renderer shows a chip above the bubble reading `from <title>` where `<title>` is a `NavLink` to the sender thread, and the message body has the agent prefix sliced off.
8. Given an agent-initiated message whose sender thread is **not** in the cached project thread list, the renderer falls back to `from <truncated id>` with the id still linking to the thread route — the renderer does not throw and does not block the message body.
9. Given a system-initiated message (scheduled nudge), the renderer shows a chip above the bubble reading `bb system` with a neutral icon, and the message body has the system prefix sliced off.
10. Given `initiator !== "user"`, the row carries no `userRequest`. (Audit + fix at the producer if any path violates this.)
11. Copy-to-clipboard from a non-user message yields the sliced body, not the prefix.
12. The persisted event's `input` text still contains the prefix verbatim — the agent's reply contract is unchanged.
13. Turbo typecheck passes for `@bb/domain`, `@bb/server-contract`, `@bb/thread-view`, `@bb/server`, and `@bb/app`.
14. Targeted tests pass for `@bb/thread-view` (projection) and `@bb/app` (renderer behavior, if a logic-bearing test is warranted per [[feedback-test-quality-bar]]).

## Validation Instructions After Implementation

Run targeted checks with Turbo:

```sh
pnpm exec turbo run typecheck --filter=@bb/domain
pnpm exec turbo run typecheck --filter=@bb/server-contract
pnpm exec turbo run typecheck --filter=@bb/thread-view
pnpm exec turbo run typecheck --filter=@bb/server
pnpm exec turbo run typecheck --filter=@bb/app
pnpm exec turbo run test --filter=@bb/thread-view
```

Manual app scenarios:

- Send a follow-up message in a normal thread: no badge, no body change.
- From thread A, run `bb thread tell B "hello"`: thread B's timeline shows an origin badge identifying A, body reads "hello" with the prefix hidden.
- Trigger a scheduled nudge on a manager: the manager's timeline shows a "bb system" badge, body reads the nudge text without the `[bb system] Scheduled nudge:` prefix.
- Inspect the SQLite `events` table for one of those rows: confirm the raw event input still contains the prefix verbatim.
- Inspect the agent's persisted prompt in the daemon transcript: confirm the prefix is still present so the agent learns the reply command.
- Copy a non-user message from the UI: clipboard contains the sliced body, not the prefix.

## AGENTS.md Review Notes

- Plan only: no implementation before sign-off.
- Contract change: `initiator` becomes required (no optional-hiding-default). New `senderThreadId` is required + nullable, where `null` has a real semantic meaning ("not an agent-to-agent message").
- The renderer-local prefix-slicing helper is not a classifier; it slices based on already-known `initiator`. It does not belong in `@bb/templates` (template data only) or `@bb/domain` (types/schemas only). See [[feedback-templates-package-scope]] and [[feedback-no-domain-functions]].
- No backward-compat shims for old events without `initiator` / `senderThreadId`. Per [[feedback-no-legacy-data]] we don't ship legacy data.
- Persisted text is unchanged so the agent's reply instruction (`bb thread tell <id> ...`) remains in the model's view of the conversation.
- Use Turbo for typecheck and tests.
