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

apps/host-daemon  (extend existing command)
  host.read_file gains an optional `ref?: string`.
    omitted → today's behavior (read from disk under rootPath jail).
    set     → `git cat-file -s <ref>:<rel>` to size-probe, then
              `git cat-file blob <ref>:<rel>` for bytes; same caps,
              same encoding logic, same `file_too_large` throw.
  No new command, no new result schema.

ref derivation per target (server-internal):
  working           → old: HEAD,        new: <omit ref> (read from disk)
  commit:<sha>      → old: <sha>^,      new: <sha>
  all:<mergeBase>   → old: <mergeBase>, new: HEAD

For the working-tree side, the server simply omits `ref` and the existing
`readFileForTransport` path runs (already jails, already caps at 25 MB for
non-images / 10 MB for images, already throws `file_too_large`).
For ref reads, the same caps + `getContentEncoding` apply post-read.
```

## Phases (ship incrementally)

### Phase 1 — extend host.read_file + server route

- **Daemon contract** (`packages/host-daemon-contract/src/commands.ts`):
  - Add `ref: z.string().min(1).optional()` to `hostReadFileCommandSchema`.
  - Result schema is unchanged — keep using `fileReadResultSchema`.
  - JSDoc on the schema updated to note that when `ref` is set, the file is read from git history at that ref instead of from disk; rootPath is then interpreted as the repo root rather than just a jail.

- **Daemon handler** (`apps/host-daemon/src/command-handlers/host-files.ts`):
  - When `ref` absent: existing path unchanged.
  - When `ref` present:
    1. Sanitize `ref` against a whitelist regex (git ref grammar — letters, digits, `_-./`, no `..`, no leading `-`) to refuse anything that could escape the `git` arg.
    2. Compute `relativePath = path.relative(rootPath, args.path)` and reject if it starts with `..` (same jail invariant, just enforced before invoking git).
    3. Probe size: `git -C <rootPath> cat-file -s <ref>:<relativePath>` via `process-utils`. If the object is missing (e.g. file didn't exist at that ref), return `{ content: "", contentEncoding: "utf8", sizeBytes: 0 }` — the UI treats empty as "no context to expand on this side".
    4. Apply the same `getFileSizeLimitBytes(mimeType)` cap as the disk path. Exceeded → throw `CommandDispatchError("file_too_large", ...)` with the same message shape.
    5. Read bytes: `git -C <rootPath> cat-file blob <ref>:<relativePath>`. Run through `getContentEncoding` / mimeType lookup as today.
  - Returns the same `ReadFileForTransportResult`.

- **Server contract** (`packages/server-contract/src/public-api.ts`):
  - Add route `"/environments/:id/diff/file"` with query `EnvironmentDiffFileQuery = { target: ..., path: string, side: "old" | "new" }` and response that mirrors `fileReadResultSchema` (`content`, `contentEncoding`, `sizeBytes`, optional `mimeType`).
  - Reuse `environmentDiffQuerySchema`'s target shape (commit / working / all+mergeBase).
  - On daemon `file_too_large`, surface as `409` with the underlying message; UI disables expand for that file.

- **Server route** (`apps/server/src/routes/environments.ts`):
  - Resolve target → `(oldRef, newRef | null)` pair (null = working tree on the new side).
  - Build the `host.read_file` command:
    - `path` = absolute (workspacePath joined with the query's relative path)
    - `rootPath` = `environment.path`
    - `ref` = the chosen ref, or omit when reading the working tree (`target=working & side=new`).
  - For `commit` target's `side=old`, ref is `<sha>^`; on root-commit edge case (the cat-file probe returns missing-object), the daemon already returns empty content, so no special-casing needed at the server.
  - Same `COMMAND_TIMEOUT_MS` + `requireReadyEnvironment` guards as `/diff`.

**Exit criteria for Phase 1:**
- `host.read_file` accepts `ref` and returns the right contents end-to-end against a real workspace; existing callers (no `ref`) keep working unchanged.
- `curl 'http://localhost:3334/api/v1/environments/<env>/diff/file?target=working&path=apps/app/src/...&side=old'` returns the HEAD contents of that file.
- For renamed files, caller must use the source path on `side=old` and destination path on `side=new` (server doesn't auto-translate — the diff already exposes both names via `prevName`/`name`).
- Existing `host.read_file` integration tests still pass; new tests cover the `ref` branch.

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

- Unit:
  - `host.read_file` ref-branch handler picks correct command shape, sanitizes ref, throws `file_too_large` past the cap.
  - Server route picks correct ref per target (working / commit / all+mergeBase), including the missing-object case for root-commit `<sha>^`.
- Integration (`integration-tests`): real workspace, real daemon, fetch a file at HEAD and at a commit; assert contents match `git show`. Existing `host.read_file` tests (no `ref`) unchanged.
- Manual: open a real thread's diff, expand around a hunk in a long file. Try the rename fixture in the story. Try a 30 MB file (cap path → 409 → UI disables expand for that card).

## Out of scope for this plan

- "View full file" toggle (option 2 from the design discussion).
- Side-by-side file-open panel (option 3).
- Inline expand on timeline file-change rows — needs a different data model (per-edit-event old/new content), not a separate ref pair.
