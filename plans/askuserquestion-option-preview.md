# AskUserQuestion option `preview` support

Status: deferred follow-up (split out of the AskUserQuestion redesign on 2026-05-19).

## Context

Claude's built-in `AskUserQuestion` tool lets each option carry an optional
`preview` — freeform content (mockups, code snippets, visual comparisons) meant
to help the user compare options. Today bb **drops it**: the bridge forwards it,
but `buildClaudeUserQuestionPayload` only maps `value/label/description`, and the
domain option schema has no `preview` field, so it never reaches the UI.

The AskUserQuestion redesign shipped without preview to avoid coupling a contract
change to the UI work. This plan covers adding it afterward.

## Motivation

Without preview, an option's only decision aid is its `description`. For choices
that are best shown rather than told (a layout mockup, a diff, a code snippet),
preview is the difference between an informed pick and a guess. Surfacing it
closes the last gap vs. using the provider's AskUserQuestion directly.

## Current state

- `packages/agent-runtime/src/claude-code/interactive-contract.ts` —
  `claudeUserQuestionOptionSchema` already accepts `preview` (optional). Input
  side needs no change.
- `packages/agent-runtime/src/claude-code/adapter.ts` —
  `buildClaudeUserQuestionPayload` maps `value/label/description` only and drops
  `preview`; `buildClaudeUserQuestion` (domain → Claude output) likewise omits it.
- `packages/domain/src/pending-interactions.ts` —
  `pendingInteractionUserQuestionOptionSchema` has no `preview`.
- Frontend option row and CLI render `label`/`description` only.

## Proposed changes

1. **Domain** (`packages/domain/src/pending-interactions.ts`)
   - Add `preview` (optional, non-blank string) to
     `pendingInteractionUserQuestionOptionSchema`. Decide on a max length
     (previews can be large — suggest a generous cap, e.g. 8192, defined as a
     `USER_QUESTION_MAX_OPTION_PREVIEW_LENGTH` constant alongside the others).
   - Flows automatically into `PendingInteractionUserQuestionOption`, the
     question payload, and persisted events.

2. **Adapter** (`packages/agent-runtime/src/claude-code/adapter.ts`)
   - `buildClaudeUserQuestionPayload`: carry `preview` through when present.
   - `buildClaudeUserQuestion`: pass `preview` back for round-trip fidelity.

3. **Frontend** (`UserQuestionInteractionContent.tsx`)
   - Render the preview as a sibling block under the option (a `<pre>` cannot
     nest inside the option `<button>`).
   - Monospace, `text-xs`, bordered card, `max-height` + scroll — reuse the
     approval command-block typography for consistency.

4. **CLI** (`apps/cli/src/commands/thread/interactions.ts`)
   - Print a `Preview:` block per option so the CLI surface matches.

5. **Tests**
   - Domain: schema accepts `preview`, rejects blank, enforces the max.
   - Adapter: `preview` survives `buildClaudeUserQuestionPayload` and the
     round-trip through `buildClaudeUserQuestion`.
   - A story/fixture demonstrating an option with a preview.

## UX decisions to resolve before building

These are the real cost; the plumbing above is mechanical.

- **When to show it.** Claude's intent is "rendered when the option is
  *focused*" — to compare *before* choosing. Options:
  - show only when the option is **selected** (simplest, bounded height);
  - show on **hover/focus** (closest to intent, more complex, touch-device gap);
  - show **always** under each option (tallest; likely too much).
  Recommend: reveal on **focus or selection**.
- **How to render.** Treat as preformatted monospace (safe, generic) vs. parse
  markdown. Recommend: preformatted mono first; revisit markdown only if needed.
- **Height.** Cap with `max-height` + scroll so a long preview can't dominate
  the banner.

## Exit criteria

- A provider option with `preview` round-trips through the domain payload and is
  visible in the app option row and the CLI.
- Blank/oversized previews are rejected at the domain boundary.
- New domain + adapter tests pass; existing AskUserQuestion tests still pass.
- `pnpm exec turbo run typecheck test --filter=@bb/domain --filter=@bb/agent-runtime --filter=@bb/app` is green.

## Validation

1. Drive an `AskUserQuestion` whose option includes a `preview` (fake adapter
   script or a real Claude turn) and confirm the preview renders in the banner.
2. `pnpm bb thread show <id>` shows the preview in the CLI.
3. Inspect the persisted event payload to confirm `preview` is stored.

## Out of scope

- Markdown/rich rendering of preview content (mono only for v1).
- Preview for the approval/permission interaction type.
