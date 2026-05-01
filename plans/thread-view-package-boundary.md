# Thread View Salvage Plan

## Goal

Keep the good work already on `main`, salvage the useful architecture from
`codex/timeline-bundle-unification`, and end with one thread timeline path:

```text
ThreadEvent[]
  -> ThreadViewProjection
  -> ThreadTimeline
  -> React renderer | CLI text renderer | audit output
```

The frontend must render timeline rows through one generic path. Old
per-message row components are deleted as the generic row renderer takes over.

## Locked Decisions

- `@bb/thread-view` is the only shared package for thread timeline projection,
  grouping, labels, and text formatting.
- `@bb/core-ui` is deleted. Its remaining helpers move to concrete owners or
  are inlined.
- We do not reset to the abandoned branch. We port its good ideas into the
  current `@bb/thread-view` boundary.
- Semantic grouped timeline rows are the stable server response shape.
- Grouping lives in `ThreadTimeline`, not in React.
- React uses one generic timeline row renderer for conversation, work, system,
  group, and turn rows.
- Renderer layout decides truncation. Shared model/presenter decides facts and
  wording.
- Tasks/todo/plan updates are not timeline rows unless a real producer and
  product requirement reintroduces them end to end.
- Existing useful fixture/audit coverage stays. Deleted row tests must either
  be preserved or replaced by behavior tests that catch the same regressions.

## Salvage From Main

- Provider audit fixture improvements and dev replay captures.
- File changes split so each changed file is one source row.
- Delegation rows with child progress.
- Command/delegation semantic projection cleanup.
- `@bb/thread-view` package boundary and Turbo wiring.
- CLI snapshot coverage and provider-audit artifacts.

## Salvage From Abandoned Branch

- Semantic row contract:
  conversation rows, work rows, system rows, group rows, and turn rows.
- Source projection before grouping.
- Turn rows with lazy `children: null` for collapsed completed turns.
- Single React renderer that switches on semantic row kind.
- Work row details for commands, file diffs, generic tools, and delegation
  children.
- Step-summary and semantic-bundle grouping rules, adjusted to match the locked
  decisions here.

## Reject From Abandoned Branch

- Keeping timeline ownership in `@bb/core-ui`.
- Deleting targeted tests without equivalent replacement.
- Presentation DSL as a public API.
- Caller-controlled truncation flags in shared model data.
- Unrelated DB/app/server churn mixed into timeline rendering.
- Special-case semantic bundle rules that exclude delegations or contradict
  the active-turn grouping rules.

## Implementation Steps

1. Delete `@bb/core-ui`.
   - Inline or move `assertNever`, error extraction, environment display,
     duration, and pending-interaction helpers.
   - Remove `@bb/core-ui` dependencies and package files.
   - Commit once no imports remain.

2. Introduce semantic `ThreadTimeline` rows in `@bb/thread-view`.
   - Add source rows for conversation, work, and system facts.
   - Add grouped rows for turns and work groups.
   - Port useful abandoned-branch model tests without losing current regression
     coverage.

3. Serve semantic timeline rows from the server.
   - Keep `ThreadTimelineResponse` stable and explicit.
   - Preserve `activeThinking` and `contextWindowUsage`.
   - Keep lazy turn details behavior.

4. Move CLI and provider audit to semantic rows.
   - CLI output uses shared thread-view text formatting.
   - Audit snapshots stay readable and focused on structure.

5. Replace frontend timeline rendering with one generic renderer.
   - Delete `ConversationEntry` branching over old `ViewMessage` rows.
   - Delete old row components as they become unreachable:
     command/tool/web/file/delegation/operation/error/debug/tasks/bundle rows.
   - Keep user, assistant, terminal output, diff, markdown, and shared
     disclosure primitives where they are still useful.

6. Remove old projection/grouping code.
   - Delete old `ViewMessage` timeline grouping path once no consumers remain.
   - Remove old helper exports from `@bb/thread-view`.
   - Rename remaining public types to match the final pipeline.

## Exit Criteria

- `rg "@bb/core-ui"` returns no product imports and the package is gone.
- `ThreadTimelineResponse.rows` is the semantic row tree used by app, CLI, and
  audit.
- React timeline rendering enters through one generic row renderer.
- Old row components for obsolete message kinds are deleted.
- Tasks/todo/plan rows are absent from timeline projection and rendering.
- CLI/provider-audit snapshots still cover app and CLI formatting.
- Focused tests cover source projection, grouping, lazy turn children, command
  rows, file-change rows, delegation rows, and active-tail grouping.
- The completed plan file is deleted.

## Validation

Run:

```bash
pnpm exec turbo run typecheck test --filter=@bb/thread-view --force
pnpm exec turbo run typecheck test --filter=@bb/ui-core --force
pnpm exec turbo run typecheck test --filter=@bb/agent-provider-audit --force
pnpm exec turbo run typecheck --filter=@bb/server --force
pnpm exec turbo run typecheck --filter=@bb/cli --force
pnpm exec turbo run typecheck --filter=@bb/app --force
git diff --check
```
