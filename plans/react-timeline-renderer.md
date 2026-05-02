# React Timeline Renderer Plan

## Goal

Rebuild the React thread timeline renderer so app rendering has one canonical
path over the semantic timeline model, while preserving the behavior polish that
existed in the pre-delete renderer and the structural simplicity from
`backup/timeline-attempt-1`.

The renderer must make timeline behavior consistent by construction: titles,
spacing, colors, expansion, streaming states, lazy turn loading, nested
delegation rendering, and scroll behavior should all flow through shared
components/hooks rather than per-row one-offs.

## Inputs

- Canonical API rows are `TimelineRow[]` from `@bb/server-contract`.
- React calls `buildTimelineViewRows(rows)` from `@bb/thread-view` before
  rendering. This adds display-only `activity-summary` rows.
- React renders `ThreadTimelineViewRow[]`, where rows are one of:
  `conversation`, `system`, `work`, `turn`, or `activity-summary`.
- The renderer must not consume `ViewMessage`, old domain timeline wrapper rows,
  `tool-exploring`, `isShellToolName`, or old `ConversationEntry`.

## Non-Goals

- Do not change the server timeline contract.
- Do not reintroduce API-level group rows.
- Do not convert shell commands into synthetic `read` / `search` / `list` work
  rows.
- Do not use browser validation for this pass unless explicitly requested.
- Do not bring task/todo/plan updates back into the timeline.

## Renderer Shape

Create one recursive renderer:

```text
ThreadTimelineRows
  buildTimelineViewRows(rows)
  TimelineRowsList
    TimelineRowView(row)
      conversation -> ConversationRow
      system -> SystemRow
      turn -> TurnRow
      activity-summary -> ActivitySummaryRow
      work -> WorkRowView(row.workKind)
```

All nested content uses the same `TimelineRowsList`: expanded turn details,
activity-summary children, and delegation children.

## Shared Title System

Add a single title model and a single React title component. Every row title
uses the same spacing, font size, line height, truncation behavior, and tone
mapping.

Title shape:

```ts
interface TimelineTitle {
  plain: string;
  prefix: string | null;
  content: string;
  suffix: TimelineTitleSuffix | null;
  tone: TimelineTitleTone;
  shimmerPrefix: boolean;
  contentTone: TimelineTitleContentTone;
}
```

Rules:

- Prefix is fixed-width behavior: muted, non-truncating.
- Content is the only flexible truncating segment.
- Suffix is muted and non-truncating for short suffixes such as duration.
- Long suffix metadata, such as subagent type, must be shrinkable and
  truncating without forcing content out of the row.
- Diff stats suffix uses add/remove colors, not muted text.
- Assistant step/activity summaries that are intentionally background context
  use extra-muted plain text with no emphasized segment.
- Bundle summaries use muted prefix/suffix and emphasized content.
- Leaf rows use muted prefix/suffix and emphasized content, except exploration
  and web-research leaf content, which is muted.
- Destructive/error rows use destructive tone for every title segment.

## Label Rules

Leaf active wording is derived from the leaf row status and approval status.
Bundle active wording is derived from scope: a bundle uses active wording only
when its enclosing scope is active and the bundle is the tail row in that scope.
This rule applies recursively inside delegation children.

Command rows:

- Preserve command identity.
- Running: `Running <command>`
- Completed: `Ran <command>`
- Error: `Ran <command>` with error status/tone where the label format requires
  status metadata, not `Failed command`.
- Duration appears as suffix only when `durationMs > 1000`.

File-change rows:

- One row per changed file.
- Prefix is `Created`, `Edited`, `Deleted`, `Renamed`, `Changed`, `Applying`,
  `Waiting for approval to edit`, `Permission denied:`, `Failed`, or
  `Interrupted`.
- Content is the display filename/path.
- Diff stat suffix omits zero sides: `+12 -3`, `+12`, or `-3`.

Web rows:

- `Running web search: <queries>`
- `Ran web search: <queries>`
- `Fetching: <url>`
- `Fetched: <url>`
- Web search/fetch leaves are not expandable.
- Activity summary text: `Ran 1 web search, fetched 2 web pages`.

Exploration intent display:

- Command/tool rows with parsed read/list/search intents remain command/tool
  rows.
- Activity-summary can show exploration counts and compact child labels such as
  `Read <path>`, `Listed files in <pattern>`, and
  `Searched for <pattern> in <loc>`.
- These compact labels are muted display text, not replacement data rows.

Delegation rows:

- `Running subagent: <description> <type?>`
- `Ran subagent: <description> <type?> <duration?>`
- React may render subagent type as muted metadata; CLI renders it in
  parentheses.
- Delegation children render recursively through `TimelineRowsList`.
- Delegation output markdown is a fallback detail when there are no child rows
  or no better child progress surface.

Turn rows:

- `Working for <duration>` for active turns when duration is available.
- `Worked for <duration>` for completed turns.
- Count fallback is allowed only when duration is missing.
- Completed turns with `children === null` are lazy detail boundaries.

System rows:

- Error rows keep normalized error titles/details.
- Operation rows keep specialized provisioning, compaction, ownership, prompt,
  and permission-grant detail behavior.
- Debug rows render compactly and expand to truncated/prettified JSON.

## Expansion Rules

Rows that are not expandable:

- `web-search`
- `web-fetch`
- compact exploration display rows for read/list/search details

Rows that are expandable when they have content:

- command/tool rows
- file-change rows with diff/stdout/stderr
- delegation rows with children or fallback output
- system rows with detail
- activity-summary rows with children
- turn rows with inline children, lazy children, loading state, or error state

Expandable rows use one shared `ExpandableTimelineRow` wrapper:

- Chevron appears on hover, while expanded, and on coarse pointers.
- Expansion animates open/closed.
- Expanded wrappers do not let ancestor `group-hover` affect nested rows.
- Collapsed rows do not keep expensive body DOM mounted.
- Rows that are expanded must not remount their body on window resize.

## Streaming And Auto-Expansion

Use a central expansion state hook, not row-local state only:

```ts
useTimelineExpansionState({
  rows,
  activeScope,
  expandErrors,
})
```

The hook tracks:

- automatic expansion candidates
- manual user overrides by stable row id
- rows that were auto-expanded but should close when no longer active
- rows explicitly opened/closed by the user

Rules:

- Pending leaf rows auto-expand.
- Error rows auto-expand when `expandErrors` is true.
- Active tail activity-summary rows auto-expand.
- A manually toggled row keeps the user choice until the row id disappears.
- User choice wins over future automatic expansion changes for that row id.
- Lazy turn rows load details only on expansion.
- Nested delegation timelines use the same expansion rules with their own
  active scope derived from the delegation row status.

## Scroll Behavior

Keep the pre-delete sticky-bottom behavior:

- Terminal output scrolls to bottom while expanded and new output arrives, unless
  the user has scrolled away from the bottom.
- Provisioning transcript detail scrolls to bottom under the same rule.
- Delegation child detail panes should follow the same sticky-bottom behavior
  when the active child stream grows.
- Resizing the window must not reset expanded row state or scroll position for
  still-mounted expanded detail bodies.
- Collapsing a row may unmount body DOM and lose body scroll position; resizing
  must not.

## Detail Rendering Rules

Command/tool detail:

- Body shows `$ <command>` for command rows.
- Command line is clamped in collapsed inner state and expandable inside the
  terminal body.
- ANSI output is preserved.
- `exit code 0` is shown only when output is empty.
- Nonzero/error/interrupted exit codes are visible in expanded detail.

File-change detail:

- Preserve rich patch rendering from the old renderer.
- Support synthetic patches for plain create/delete/update bodies.
- Fallback to plain diff text when patch rendering is not possible.
- Render stdout/stderr when present.

Operation/error detail:

- Preserve provisioning transcript formatting and auto-scroll.
- Preserve prompt-section extraction.
- Preserve missing-project-folder and provisioning-error normalization.
- Preserve permission grant details.

Conversation detail:

- Preserve assistant markdown and local file links.
- Preserve user attachments and image lightbox.
- Preserve long/multiline message expansion behavior.

## Implementation Phases

1. Recreate shared timeline primitives in `@bb/ui-core`.
   - `TimelineTitleView`
   - `ExpandableTimelineRow`
   - `TimelineDetailPanel`
   - `TerminalOutputBlock`
   - `TimelineFileDiffBlock`
   - sticky-bottom and expansion-state hooks

2. Add thread-view title builders for the final row model.
   - One function builds title metadata for every `ThreadTimelineViewRow`.
   - Tests cover plain title text and segment/tone/truncation intent.
   - CLI and React consume the same label rules where applicable.

3. Build the recursive React renderer.
   - Implement `ThreadTimelineRows`, `TimelineRowsList`, and `TimelineRowView`.
   - Add exhaustive work-kind dispatch.
   - Render conversation/system/work/turn/activity-summary rows.

4. Port behavior-heavy detail renderers.
   - Command/tool terminal detail.
   - File diff rendering.
   - Operation/error/detail rows.
   - Delegation child rendering.
   - Lazy turn loading states.

5. Delete unreachable old timeline code.
   - Remove old row components that are not reused by the new renderer.
   - Remove old `ViewMessage` renderer imports from React timeline code.
   - Remove any compatibility exports exposed only for deleted renderers.

6. Add Ladle/domain stories after the renderer exists.
   - One story for mixed timeline rows.
   - One story for active streaming rows.
   - One story for nested delegation rows.
   - One story for file diffs and terminal output.

## Validation

No browser validation for this pass unless explicitly requested.

Required checks:

- `pnpm exec turbo run typecheck --filter=@bb/ui-core`
- `pnpm exec turbo run test --filter=@bb/ui-core`
- `pnpm exec turbo run typecheck --filter=@bb/app`
- `pnpm exec turbo run test --filter=@bb/app`
- `pnpm exec turbo run test --filter=@bb/thread-view`
- CLI/provider-audit snapshot tests that exercise timeline formatting
- `rg "ViewMessage|ConversationEntry|tool-exploring|isShellToolName" packages/ui-core/src/thread-timeline apps/app/src/views packages/thread-view/src`
  must show no production renderer dependency on deleted concepts.

Add regression tests for:

- content-only title truncation with fixed prefix/duration suffix
- long subagent type metadata truncating without overflowing
- assistant/activity summary extra-muted no-emphasis rendering
- active tail bundle label switching from completed to active wording
- leaf row wording based on leaf status
- manual expansion override surviving rerender with the same row id
- expanded row remaining mounted across resize-driven rerenders
- command detail hidden until expansion and exit-code behavior
- file diff hidden until expansion and synthetic patch fallback
- lazy turn expansion calling the loader once
- nested delegation turn rows not using the root lazy-turn cache
- sticky-bottom auto-scroll preserving user scroll-away behavior
- web search/fetch non-expandable labels and web-research summary label

## Exit Criteria

- App timeline rendering enters through one semantic row renderer.
- Every supported row/work kind has an exhaustive render path.
- All title rows share one title component and consistent typography/spacing.
- Expansion, auto-expansion, and sticky-bottom scroll behavior are centralized.
- Manual expansion state is not lost by ordinary rerenders or window resize.
- Old React timeline renderer concepts are deleted or proven unreachable.
- Tests cover the behavior we intentionally preserved from pre-delete and the
  structure we intentionally salvaged from `backup/timeline-attempt-1`.
