# Branch Follow-Up TODO

## Fix First

- Validate env var keys before building `shell_environment_policy.set.*` config paths in Claude, Pi, and Codex adapters. Reject or drop keys that do not match a safe env-var pattern.
- Replace fixture JSON `JSON.parse(... ) as TValue` loaders with shared Zod-backed parsing in `@bb/provider-audit`.
- Remove the `as Record<string, unknown>` mutation path in provider-audit replay and stamp translated events with typed reconstruction.
- Finish Claude and Pi event-boundary parsing so handled SDK events are Zod-validated instead of cast after checking only `{ type: string }`.
- Keep grouped `Worked for ...` rows visually neutral. They should never render destructive/error tone.
- Remove the grouped-work `(${count} items)` suffix.
- Make React exploring-read rows show basenames while CLI keeps full paths.
- Hide Claude `rate_limit_event` rows from both CLI and React by treating them as noise instead of user-visible warnings.
- Investigate and fix Claude/Pi diff rendering so it matches Codex more closely.

## Diff Rendering Investigation

- Current behavior:
  - Codex often provides full unified patches with hunk headers, so `FileEditRow` can render them through `PatchDiff`.
  - Claude/Pi `buildEditDiff()` currently emits headerless `-old/+new` snippets for updates.
  - `FileEditRow.getRenderablePatch()` only sends diffs to `PatchDiff` when they already look like real unified patches or include `@@`.
  - Result: many Claude/Pi edits fall back to plain-text diff rendering instead of the shared `@pierre/diffs` UI.
- Investigate `@pierre/diffs` options:
  - `disableLineNumbers` exists and may let us use the same component when line numbers are synthetic or unknown.
- Proposed direction:
  - synthesize a renderable unified patch for Claude/Pi snippet diffs
  - use `PatchDiff` for those too
  - disable line numbers when the hunk positions are synthetic/unknown
  - keep Codex full patches as-is

## Type Safety And Boundaries

- Replace remaining inline object parameter types introduced on this branch, especially in `to-view-messages.ts`.
- Tighten `ViewOperationMessage` / `ViewThreadOperationMetadata` string fields into explicit unions so operation switches become exhaustiveness-checked.
- Replace remaining branch casts that violate current `AGENTS.md` expectations where practical:
  - Claude adapter raw SDK event handling
  - Pi adapter raw SDK event handling
  - provider-audit replay/import JSON boundaries
- Consider tightening typed tool-argument flows so `toRecord()` is not needed for data we already control structurally.

## UI And Rendering Cleanup

- Move `provider/unhandled` user-visible summary generation out of runtime and into the canonical UI rendering path.
- Extract duplicated user-message dedupe logic in `to-view-messages.ts`.
- Remove the dead conditional spread around `threadOperation` in `parse-operation-message.ts`.
- Deduplicate shared UI helpers:
  - `taskStatusGlyph`
  - `itemStatusToToolStatus` / `itemStatusToFileEditStatus`

## Provider Audit Cleanup

- Extract shared JSON file parsing utilities for `replay.ts` and `fixtures.ts`.
- Deduplicate repeated `isRecord` helpers across provider-audit files.
- Strengthen replay tests with structural assertions:
  - every fixture produces translated events
  - every fixture has zero unexpected untranslated raw events
- Improve Codex `listModels` test assertions to check actual model shape/content.
- Add extra `buildEditDiff()` tests for pure-addition and pure-deletion cases.

## Docs And Hygiene

- Remove superseded `plans/adapter-refactor-audit.md`.
- Fix stale absolute worktree paths in `packages/provider-audit/README.md`.
- Keep this TODO current until the branch is merged or the items are resolved.
