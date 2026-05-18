# At-Mention Improvements

## Goal

Improve prompt `@` mentions so they use fuzzy search consistently, can mention
folders, and can mention manager thread-storage paths.

This plan owns the prompt mention behavior and the folder-aware path suggestion
contract. It does not own the secondary-panel **Open file** tab UI, which is
tracked in [arbitrary-file-preview-secondary-panel.md](arbitrary-file-preview-secondary-panel.md).

## Current State

- `usePromptMentions` combines file suggestions and optional thread suggestions.
- Workspace file suggestions call `useProjectFileSuggestions`, backed by
  `/projects/:id/files`.
- Thread-storage file listing exists through `useThreadStorageFiles`, backed by
  `/threads/:id/thread-storage/files`, but prompt mentions do not query it.
- Project file search and thread-storage file search both proxy
  `host.list_files`.
- `host.list_files` recursively walks paths and uses `@bb/fuzzy-match` when a
  query is supplied.
- `host.list_files` returns files only; folders are traversed but not returned.
- Thread suggestions are filtered locally with case-insensitive substring checks
  against title/id, not the same fuzzy matcher used for files.
- Prompt mention insertion is text-only: selected suggestions insert values such
  as `@src/file.ts` or `@thread:thr_abc`.

## Target UX

Typing `@` in the prompt should show one suggestion menu that can include:

- threads
- workspace files
- workspace folders
- manager thread-storage files
- manager thread-storage folders

Rules:

- Fuzzy ranking should feel consistent across paths and threads.
- Workspace files should keep the same insertion text as today.
- Workspace folders should insert a folder path with a trailing slash, such as
  `@src/components/`.
- Thread suggestions should keep the `@thread:<id>` insertion format.
- Thread-storage suggestions should use an unambiguous source-qualified format.
  Recommended format: `@thread-storage:<path>` for files and
  `@thread-storage:<path>/` for folders.
- Thread-storage suggestions should appear only when the current thread is a
  manager thread.
- Suggestion rows should visually distinguish source and kind when needed:
  Workspace, Thread storage, File, Folder, Thread, Manager.
- Empty, loading, and hint copy should not imply that only files are searchable.

The secondary-panel **Open file** tab should be able to reuse the path
suggestion contract with folders disabled, but folder results are not part of
that tab's UX.

## Implementation Plan

### Phase 1 - Folder-Aware Path Suggestion Contracts

Goal: the server/daemon search path can return folders when asked, while
preserving file-only behavior for existing callers.

Scope:

- Refactor the current `host.list_files` walker/finalizer into a shared
  path-listing implementation.
- Add a neutral `host.list_paths` command that accepts required
  `includeFiles` and `includeDirectories` booleans.
- Return typed path entries with required `kind: "file" | "directory"`,
  `path`, `name`, `score`, and `positions`.
- Keep `host.list_files` as a file-only wrapper around the shared
  implementation with `includeFiles: true` and `includeDirectories: false`.
- Add neutral path-suggestion routes for project workspace paths and
  thread-storage paths. Keep the existing `/files` routes file-only.
- Add app API/query wrappers that always pass whether directories are included.

Exit criteria:

- Project path suggestions can return files only.
- Project path suggestions can return files and directories.
- Thread-storage path suggestions can return files only.
- Thread-storage path suggestions can return files and directories.
- Existing storage browser and file-preview callers remain file-only.
- Contract/server/daemon tests cover directory inclusion, directory exclusion,
  truncation, and fuzzy ranking.

### Phase 2 - Shared Path Search Hook

Goal: one typed path search model backs prompt mentions and can be reused by the
secondary-panel **Open file** tab.

Scope:

- Add shared result types for workspace and thread-storage path results.
- Include `source`, `entryKind`, `path`, `name`, score, and match positions in
  the client model.
- Wrap the workspace/project path suggestion query.
- Wrap the thread-storage path suggestion query.
- Enable thread-storage querying only when the current thread is a manager.
- Support a caller option for `includeDirectories`.
- Debounce input consistently with current mention search.
- Preserve placeholder-data behavior so results do not flicker while typing.
- Oversample per source, then merge and limit results deterministically.

Exit criteria:

- Unit tests cover workspace-only path search.
- Unit tests cover manager path search with both workspace and thread-storage
  results.
- Unit tests cover non-manager threads not querying thread storage.
- Unit tests cover directories included for mentions and excluded for file-only
  callers.
- Existing workspace file mention behavior is unchanged.

### Phase 3 - Fuzzy Thread Suggestions

Goal: thread suggestions use shared fuzzy behavior instead of local substring
filtering.

Scope:

- Add a text-oriented matcher to `@bb/fuzzy-match`, or an equivalent shared
  helper in that package, for thread title/id ranking.
- Update `usePromptMentions` to fuzzy-rank thread suggestions.
- Preserve current thread suggestion modes: none, managers, all.
- Continue excluding the current thread from thread suggestions.

Exit criteria:

- Thread title/id suggestions use fuzzy matching and ranking.
- Manager-only mode still returns only manager threads.
- All-threads mode still returns manager and standard threads.
- Tests cover non-contiguous/fuzzy title queries, id queries, current-thread
  exclusion, and deterministic ordering.

### Phase 4 - Mention Suggestion UI And Insertion

Goal: prompt mentions render and insert files, folders, storage paths, and
threads unambiguously.

Scope:

- Update `PromptMentionSuggestion` to model path source and entry kind.
- Update `usePromptMentions` to use the shared path-search hook with
  `includeDirectories: true`.
- Render folder suggestions in `MentionMenu`.
- Render source labels for workspace and thread-storage path suggestions when
  both sources are available or ambiguous.
- Update hint/loading/empty copy so it describes searchable mentions, not just
  files.
- Insert workspace folder mentions with a trailing slash.
- Insert thread-storage mentions with the source-qualified format selected in
  this plan.
- If downstream parsing treats mentions specially, parse the storage-qualified
  format end to end in the same change.

Exit criteria:

- Standard thread mentions still show workspace path results.
- Manager thread mentions show workspace and thread-storage path results.
- Folder suggestions appear in prompt mentions.
- Selecting a workspace file mention inserts the same text as today.
- Selecting a workspace folder mention inserts an unambiguous folder path.
- Selecting a storage file or folder mention inserts an unambiguous
  representation.
- Tests cover mixed file, folder, storage, and thread suggestions.

### Phase 5 - Validation

Run:

```sh
pnpm exec turbo run test --filter=@bb/fuzzy-match
pnpm exec turbo run test --filter=@bb/host-daemon-contract
pnpm exec turbo run test --filter=@bb/server-contract
pnpm exec turbo run test --filter=@bb/server
pnpm exec turbo run typecheck --filter=@bb/app
pnpm exec turbo run test --filter=@bb/app
```

Manual smoke:

- project prompt with workspace file suggestions
- project prompt with workspace folder suggestions
- standard thread prompt with manager thread suggestions
- manager thread prompt with all thread suggestions
- manager thread prompt with workspace and thread-storage file suggestions
- manager thread prompt with workspace and thread-storage folder suggestions
- manager thread with no thread-storage matches
- thread-title search with non-contiguous/fuzzy query text
- storage path mention insertion and prompt submission

## Out Of Scope

- Secondary-panel **Open file** tab UI.
- Flexible panel layouts.
- Terminal placement changes.
- Workspace tree/sidebar.
- Arbitrary absolute host-path input.
- Rootless host-file browsing by typed path.
