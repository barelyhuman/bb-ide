# Git diff context expansion

Let users expand unchanged context around hunks in the secondary-panel diff (and timeline file-change rows, since they share `GitDiffCard`). Click an up/down arrow in the gap between hunks → reveal more lines.

## Why this is small

`@pierre/diffs` already does the rendering. `FileDiff` accepts `oldFile`/`newFile` (`FileContents = { name, contents, lang? }`) alongside `fileDiff`. When both files are present, the renderer auto-injects expand-up / expand-down / expand-both buttons in every `<HunkSeparator>` between hunks, calls `onHunkExpand(hunkIndex, direction)` on click, and slices the right chunk out of the file contents itself. We don't need to write any expansion UI.

What we need to add is the data path: when the user clicks expand on a file, fetch that file's two sides at the diff's refs, and pass them into `<FileDiff>`.

## Architecture (one-page summary)

```
GitDiffCard (apps/app)
  ├ today: passes only `fileDiff` to <DiffView/FileDiff>
  └ new:   on first expand-attempt for the card, fetch oldFile/newFile via
           react-query, then pass {oldFile, newFile, fileDiff} → expand UI
           lights up automatically.

apps/server  (new route)
  GET /environments/:id/diff/file
    query: { target: working|commit:sha|all:mergeBase, path, side: old|new }
    → { name, contents, truncated }

apps/host-daemon  (new command)
  workspace.show_file
    { workspacePath, workspaceProvisionType, ref, path }
    → { contents, sizeBytes }    ; runs `git show <ref>:<path>` (or reads
                                    the working tree when ref === "WORKTREE")
                                    Throws `file_too_large` like the existing
                                    file-read primitive — no truncation flag.

ref derivation per target:
  working           → old: HEAD,        new: WORKTREE
  commit:<sha>      → old: <sha>^,      new: <sha>
  all:<mergeBase>   → old: <mergeBase>, new: HEAD

For "WORKTREE" the daemon reads the file from disk via the existing
`readFileForTransport` (already jails to the rootPath, already caps at
25 MB for non-images / 10 MB for images, already throws `file_too_large`).
For ref reads it shells `git show` and applies the same 25 MB cap before
materializing the buffer.
```

## Phases (ship incrementally)

### Phase 1 — daemon command + server route

- **Daemon contract** (`packages/host-daemon-contract/src/commands.ts`):
  - Add `workspaceShowFileCommandSchema` next to `workspaceDiffCommandSchema`.
  - Result schema mirrors `host.read_file`'s `fileReadResultSchema` shape (`content`, `contentEncoding`, `sizeBytes`, optional `mimeType`). Reuse the same primitive — diff-context expansion doesn't need its own.
  - Wire into `hostDaemonNonProvisionCommandSchema` discriminated union and the result map.

- **Daemon handler** (`apps/host-daemon/src/command-handlers/workspace-show-file.ts`):
  - Validate `path` is **repo-relative** (no leading `/`, no `..` segments) — reuse the rootPath-jail pattern from `host-files.ts`.
  - When `ref === "WORKTREE"`: call `readFileForTransport({ resolvedPath: workspacePath/path, rootPath: workspacePath, ... })` directly. Cap + jail come for free.
  - Otherwise: `git -C <workspacePath> show <ref>:<path>` via `process-utils`. Read into a buffer, then run it through the same `getContentEncoding`/`getFileSizeLimitBytes` logic as `readFileForTransport` so we throw `file_too_large` consistently and pick utf-8/base64 the same way.
  - Returns the same `ReadFileForTransportResult` shape as `host.read_file`.

- **Server contract** (`packages/server-contract/src/public-api.ts`):
  - Add route `"/environments/:id/diff/file"` with query `EnvironmentDiffFileQuery = { target: ..., path: string, side: "old" | "new" }` and response that mirrors `fileReadResultSchema` (`content`, `contentEncoding`, `sizeBytes`, optional `mimeType`).
  - Reuse `environmentDiffQuerySchema`'s target shape (commit / working / all+mergeBase).
  - On daemon `file_too_large`, surface as `409` with the underlying message; UI disables expand for that file.

- **Server route** (`apps/server/src/routes/environments.ts`):
  - Resolve target → `(oldRef, newRef)` pair.
  - Pick the side, dispatch `workspace.show_file` with that ref.
  - Special case: `target=working & side=new` → `ref = "WORKTREE"`.
  - For `commit` target's `side=old`, ref is `<sha>^` (handle root-commit edge case: if `git rev-parse <sha>^` fails, return empty contents — file didn't exist).
  - Same `COMMAND_TIMEOUT_MS` + `requireReadyEnvironment` guards as `/diff`.

**Exit criteria for Phase 1:**
- New daemon command runs end-to-end against a real workspace.
- `curl 'http://localhost:3334/api/v1/environments/<env>/diff/file?target=working&path=apps/app/src/...&side=old'` returns the HEAD contents of that file.
- For renamed files, caller must use the source path on `side=old` and destination path on `side=new` (server doesn't auto-translate — the diff already exposes both names via `prevName`/`name`).

### Phase 2 — react-query hook + GitDiffCard wiring

- **Hook** (`apps/app/src/hooks/queries/environment-queries.ts`):
  - `useEnvironmentDiffFile({ environmentId, target, path, side })` — same shape as `useEnvironmentGitDiff`, lazy via `enabled`.
  - Query key includes target + path + side. Cache stays warm across collapses.
  - For `target=working`, use the same staleness/invalidation hooks as `useEnvironmentGitDiff` so the diff and its expanded files refresh as a pair (matches today's behavior — neither surface auto-refreshes on user edits to disk, both refresh together when the user retriggers).
  - Decode utf-8 vs base64 in the hook based on `contentEncoding`. `@pierre/diffs` wants a UTF-8 string; if the response is base64, we treat it as binary and resolve the promise as `null` so the card knows to skip expand for that file.

- **GitDiffCard** (`apps/app/src/components/git-diff/GitDiffCard.tsx`):
  - Accept new optional callback prop `onRequestFileContents?: (path: string, side: "old" | "new") => Promise<FileContents | null>`. Card stays presentational — no fetching logic inside.
  - Track local state: `{ oldFile?: FileContents, newFile?: FileContents, status: "idle" | "loading" | "loaded" | "error" }`.
  - On `<DiffView onHunkExpand>` callback (already triggered by library button clicks):
    - If files not loaded yet, kick off `Promise.all([onRequestFileContents(prevName ?? name, "old"), onRequestFileContents(name, "new")])`.
    - Once resolved, set state → re-render passes `oldFile`/`newFile` to `<DiffView>`. The library re-runs the click that triggered the load (or user clicks again — both are fine since the buttons stay there).
  - Pass `oldFile`/`newFile` only after both load. Until then, `<DiffView>` renders today's hunk-only view.

- **ThreadSecondaryPanel + GitDiffPanelState plumbing**:
  - Compose `onRequestFileContents` from the hook + the panel's known target.
  - Pass into each `<GitDiffCard>` mapped from `parsedGitDiffFileEntries`.

- **Timeline (TimelineFileDiffBlock)**:
  - **Skip for v1.** Timeline rows are per-file-edit slices, not full diffs against a ref pair — there's no "old ref" to read from. Pass `onRequestFileContents={undefined}`; expand UI stays disabled (`@pierre/diffs` only renders the buttons when `oldFile`/`newFile` are present).

**Exit criteria for Phase 2:**
- In `secondary-panel/Diff/Overview` story (with a stub `onRequestFileContents` returning fixture contents), expand-up / expand-down buttons appear between hunks and reveal real lines.
- In a live thread, clicking expand against a real env fetches once, caches, and reveals.
- Renamed files (e.g. the `RENAME_DIFF` story fixture) load using `prevName` for old side, `name` for new side.
- Closing + re-opening the diff card doesn't re-fetch (react-query cache hit).

## Resolved before Phase 1

1. **Size cap.** Reuse `readFileForTransport`'s existing 25 MB non-image / 10 MB image caps and the existing `file_too_large` throw — no new constant, no `truncated` flag. UI surfaces "file too large" tooltip on the affected card.
2. **Binary files.** Non-issue: `parsePatchFiles` doesn't produce hunks for binaries, so `@pierre/diffs` never renders expand buttons on a binary file's card. The hook still defensively returns `null` for `contentEncoding === "base64"` so any future code path that asks gets a clean signal instead of garbled text.
3. **WORKTREE side under sandbox/remote hosts.** Daemon owns its host, so `readFileForTransport` works against whichever filesystem the daemon is on. No extra plumbing.
4. **Working-tree staleness with `target=working`.** Match the diff endpoint's existing staleness — file-content queries share the diff's invalidation lifecycle. Neither today's diff nor tomorrow's expanded-file content auto-refreshes mid-edit; both refresh together when the user retriggers.

## Validation

- Unit: handler picks correct ref per target (working / commit / all+mergeBase), including root-commit edge case.
- Integration (`integration-tests`): real workspace, real daemon, fetch a file at HEAD and at a commit; assert contents match `git show`.
- Manual: open a real thread's diff, expand around a hunk in a long file. Try the rename fixture in the story. Try a 2 MB file (truncation path).

## Out of scope for this plan

- "View full file" toggle (option 2 from the design discussion).
- Side-by-side file-open panel (option 3).
- Inline expand on timeline file-change rows — needs a different data model (per-edit-event old/new content), not a separate ref pair.
