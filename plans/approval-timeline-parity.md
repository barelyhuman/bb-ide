# Approval Timeline Parity Plan

## Goal

Make approval lifecycle rows feel like the regular command and file-edit timeline rows:

- `Waiting for approval to run X` expands like a command row.
- `Permission denied: X` expands like the same command row.
- Approved command/file-change flows look like the provider had permission up front once execution continues.
- File-change approvals use the same row language and detail surfaces as file edits where the provider gives enough data, and degrade honestly when it does not.

This plan assumes the provider-neutral approval model from this branch remains the foundation:

- command approvals approve commands only.
- file-change approvals approve edits/writes only.
- permission-grant approvals grant permissions only.
- provider-native quirks stay in adapters.

## Current State

- Server persists pending interactions and appends `system/operation` rows with `rawOperation: "approval"`.
- Pending command approval copy is now `Waiting for approval to run X`.
- Denied command approval copy is now `Permission denied: X`.
- Pending file-change approval copy is semantic but generic: `Waiting for approval to edit files`.
- Approval operation rows include `metadata.subjectKind` and `metadata.itemId`.
- Approval rows do not yet reuse regular command/file-edit row rendering.
- Approval rows do not yet carry enough structured target detail to expand like command rows.
- File-change approval payloads intentionally do not pretend to include a diff.

## Design Principles

- Keep one semantic source of truth: approval rows are approval lifecycle rows, not fake exec/file-edit rows.
- Reuse the existing command/file-edit row presentation where the approved subject has the same information.
- Do not invent diffs. If a provider approval lacks file-change details, render a useful approval row and correlate to later file-edit rows by `itemId`.
- Preserve provider neutrality in the domain/server contracts. Any Codex/Claude-specific decoding stays in adapters.
- Prefer shared core-ui projection tests before app rendering tests.

## Phase 1: Add Structured Approval Target Metadata

### Implementation

Extend approval timeline metadata in `apps/server/src/services/interactions/pending-interaction-timeline.ts`:

- For `subject.kind === "command"`, include:
  - `subjectKind: "command"`
  - `itemId`
  - `command`
  - `cwd`
- For `subject.kind === "file_change"`, include:
  - `subjectKind: "file_change"`
  - `itemId`
- For `subject.kind === "permission_grant"`, include:
  - `subjectKind: "permission_grant"`
  - `itemId`
  - `toolName`
  - permission summaries only if needed for timeline display, not raw provider data.

If the domain has a typed metadata shape for `system/operation`, add a typed approval metadata variant instead of free-form object access.

### Tests

Update `apps/server/test/public/public-thread-interactions.test.ts` to assert:

- pending command approval timeline row includes command/cwd metadata.
- denied command approval timeline row includes command/cwd metadata.
- file-change approval timeline row includes `subjectKind` and `itemId`, but no fake diff.

### Exit Criteria

- Server timeline events contain enough semantic metadata for core-ui to render command approval rows with command details.
- No provider-specific metadata names enter server/domain contracts.

## Phase 2: Project Approval Rows Into Command-Like View Messages

### Implementation

Update core-ui timeline projection, likely in:

- `packages/core-ui/src/parse-operation-message.ts`
- `packages/core-ui/src/to-view-messages.ts`
- `packages/core-ui/src/thread-detail-rows.ts`

Add approval-aware operation parsing:

- `rawOperation === "approval"` and `metadata.subjectKind === "command"` should project to an operation row with a command-detail payload.
- The row title/detail should come from the approval lifecycle message:
  - pending: `Waiting for approval to run X`
  - denied: `Permission denied: X`
  - approved/resolving: current lifecycle copy unless we decide to collapse it.
- The expandable body should reuse the same command display primitives as exec rows:
  - command
  - cwd
  - output area present only if correlated execution output exists, otherwise absent/empty.

Do not convert approval rows into actual exec rows if that would blur lifecycle semantics. Instead, add a shared presentation sub-shape such as `commandPreview` or `approvalTarget` that the UI can render using the same command details component.

### Tests

Add/extend `packages/core-ui/test/to-view-messages.test.ts`:

- pending command approval projects to an operation row with approval metadata and command preview.
- denied command approval projects to an operation row with command preview.
- approved command approval and later exec rows can coexist without duplicate collapsing.

Add/extend `packages/core-ui/test/thread-detail-rows.test.ts`:

- command approval operation row has an expandable detail model matching command rows.
- row ordering stays stable:
  - waiting approval
  - delivering/approved
  - running command
  - ran command

### Exit Criteria

- Core-ui can represent command approval rows with the same expandable command details as command execution rows.
- Tests prove projection without requiring React rendering.

## Phase 3: File-Change Approval Presentation And Correlation

### Implementation

For file-change approvals:

- Render pending/denied approval rows as file-change approval rows, not generic operations.
- Use `itemId` to correlate with later provider file-edit/file-change items when available.
- If correlated details exist, reuse the normal file-edit detail renderer.
- If details do not exist, show an honest expandable body:
  - `File change approval`
  - `Item: <itemId>`
  - optional provider reason
  - no fake diff.

Investigate whether existing provider file-edit events carry stable `itemId` matching approval `itemId`. If not, document the missing provider correlation and avoid heuristic matching by path/content unless it is already established elsewhere.

### Tests

Add core-ui tests for:

- pending file-change approval without diff renders a file-change approval row with item id.
- denied file-change approval renders `Permission denied: file changes`.
- file-change approval with correlated later file-edit details links or groups details without duplicating unrelated rows.

Add server test only if additional metadata is needed beyond `itemId`.

### Exit Criteria

- File-change approvals feel like file-edit timeline rows where real details are available.
- Missing provider diff/detail data is visible as a limitation, not papered over.

## Phase 4: UI Rendering Without Browser-Only Coverage

### Implementation

Prefer CLI/core-ui presentation tests first. For app components, reuse existing row components and shared primitives.

Update the app timeline renderer so approval rows with command/file-change target details render:

- same disclosure/expand affordance as command/file-edit rows.
- same command/file-edit detail components where possible.
- no card-inside-card regressions.

If a CLI timeline rendering path exists, add CLI snapshot/text tests to verify:

- `Waiting for approval to run X`
- command detail is present in expanded/verbose output if supported.
- denied approval retains command detail.

Skip Playwright/browser tests unless the row behavior cannot be validated through core-ui/app component tests.

### Tests

Add app component tests only at the row-rendering layer if such tests already exist and do not require browser automation.

Add CLI tests if the CLI timeline command renders thread timeline rows.

### Exit Criteria

- App timeline rows visually share affordances with command/file-edit rows.
- Non-browser tests cover the rendering model.

## Phase 5: Lifecycle Row Collapsing Decision

### Question

Should approval lifecycle rows remain separate:

- `Waiting for approval to run X`
- `Command approved`
- `Running X`
- `Ran X`

or should approval lifecycle rows collapse into one row once resolved?

### Recommended Default

Keep them separate initially. It is clearer and avoids making approval rows masquerade as execution rows. After parity lands, consider collapsing only noisy intermediate rows such as `Delivering user response to provider`.

### Tests

If collapsing is added:

- Add core-ui tests proving pending/resolving/resolved approval lifecycle rows collapse deterministically.
- Keep denied approval rows visible.
- Never collapse away the only evidence that the user denied an approval.

### Exit Criteria

- Product decision is explicit.
- Timeline projection tests lock in whichever behavior we choose.

## Validation

Run these after implementation:

```bash
pnpm exec turbo run typecheck --filter=@bb/core-ui --filter=@bb/app --filter=@bb/server --filter=@bb/cli
pnpm exec turbo run test --filter=@bb/core-ui -- --run test/to-view-messages.test.ts test/thread-detail-rows.test.ts test/format-timeline-text.test.ts
pnpm exec turbo run test --filter=@bb/server -- --run test/public/public-thread-interactions.test.ts
pnpm exec turbo run test --filter=@bb/app -- --run src/components/thread
pnpm exec turbo run test --filter=@bb/cli -- --run src/__tests__/command-output.test.ts
```

If provider correlation behavior changes, also run:

```bash
pnpm exec turbo run test:integration --filter=@bb/agent-runtime
```

## Done Criteria

- Command approval timeline rows have the requested copy and expandable command details.
- Denied command approval rows retain expandable command details.
- File-change approval rows use file-edit-like presentation where details exist and honest item-level presentation where they do not.
- Once approval is granted, subsequent command/file-edit execution rows look the same as auto-permitted execution rows.
- No provider-specific approval shape leaks into server/app/CLI/domain contracts.
- Tests cover server event metadata, core-ui projection, and non-browser rendering paths.
