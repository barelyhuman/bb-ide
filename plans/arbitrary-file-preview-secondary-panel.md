# Arbitrary File Preview In Secondary Panel

## Goal

Add an explicit way to open a known readable file in the fixed secondary panel
without turning the secondary panel into a full file browser.

The UX should be tab-native:

- a trailing plus button in the secondary tab strip
- a small dropdown menu with one action for now: **Open file**
- an **Open file** tab whose content is a focused fuzzy file picker
- selecting a result replaces that tab with the selected file preview

This plan should build on the current generic fixed-panel tab state. It should
not add Dockview, split panes, terminal movement, or flexible layouts.

## Current State

The codebase already has most of the preview and search plumbing:

- generic fixed-panel tabs now back the fixed secondary and bottom regions
- `useThreadFileTabs` opens workspace, thread-storage, and host-file preview
  tabs through generic fixed-panel state
- `ThreadSecondaryPanel` renders the fixed secondary panel tab strip
- workspace file previews use `useEnvironmentFilePreview`, backed by
  `/environments/:id/diff/file`
- thread-storage previews use `useThreadStorageFilePreview`, backed by
  `/threads/:id/thread-storage/content`
- host-file previews use `useThreadHostFilePreview`, backed by
  `/threads/:id/host-files/content`
- workspace file suggestions use `useProjectFileSuggestions`, backed by
  `/projects/:id/files`
- thread storage already has a searchable file-list route through
  `useThreadStorageFiles`
- project file search and thread-storage file search both proxy
  `host.list_files`
- `host.list_files` uses `@bb/fuzzy-match` path matching when a query is
  supplied, but it currently returns files only

The missing user-facing piece is an explicit tab-strip affordance for opening a
file by search, independent of model output, markdown links, or the manager
storage browser.

## Target UX

### Tab Strip Plus Button

Add a plus icon button at the trailing edge of the secondary tab strip.

Rules:

- The button is visually part of the tab strip.
- The button remains visible even when the tab list overflows horizontally.
- The tab list itself may keep horizontal overflow/scroll behavior.
- The button opens a dropdown menu.
- The dropdown has one menu item for now: **Open file**.

Clicking **Open file** should:

- open the fixed secondary panel if it is closed
- create or focus a single transient **Open file** tab
- focus the search input inside the tab
- preserve existing tab order as much as possible

Do not put this action in the thread header as the primary entry point for this
plan.

### Open File Tab

The **Open file** tab is a temporary tab. Its body is a compact fuzzy search UI:

- focused input at the top
- keyboard navigation through results
- empty, loading, and error states
- concise unavailable state when there is no searchable source

Selecting a file result should replace the **Open file** tab in-place:

- workspace result -> `workspace-file-preview` tab
- manager thread-storage result -> `thread-storage-file-preview` tab

If the selected file is already open, focus the existing preview tab and remove
the transient **Open file** tab instead of duplicating the preview.

The search tab should not be durable across reloads. If the tab state is
persisted, normalize it out during serialization or restore.

### Search Sources

The search UI should use fuzzy file search.

Sources:

- workspace/project files wherever current project file search supports them
  today
- thread storage files in addition when the current thread is a manager

The **Open file** tab must request files only. It should not show folders even
if the shared path-suggestion contract added by
[at-mention-improvements.md](at-mention-improvements.md) supports them.

The search result model should carry both:

- `source`: workspace or thread storage
- `entryKind`: file

Manager search results should make the source visually clear, for example with
subtle section labels or a small secondary label:

- Workspace
- Thread storage

Avoid a tree browser in this plan. Results should stay list-based and optimized
for typing.

## Relationship To Mention Improvements

The `@`-mention-specific work is tracked separately in
[at-mention-improvements.md](at-mention-improvements.md).

If that plan lands first, this plan should consume its shared path-suggestion
hook with directories disabled. If this plan lands first, add a narrow
file-only search adapter around existing workspace and thread-storage file
queries, then migrate it to the shared path-suggestion hook later.

This plan should not change prompt `@`-mention behavior, thread suggestion
ranking, folder mentions, or storage mention insertion syntax.

## Implementation Plan

### Phase 1 - File-Only Search Model

Goal: one typed file search model backs the **Open file** tab.

Scope:

- Add result types for workspace and thread-storage file results.
- Include `source`, `entryKind: "file"`, `path`, and `name` in the client
  model.
- Wrap the workspace/project file suggestion query.
- Wrap the thread-storage file suggestion query.
- Enable thread-storage querying only when the current thread is a manager.
- Debounce input consistently with existing file suggestions.
- Preserve placeholder-data behavior so results do not flicker while typing.
- Merge and limit results deterministically.
- Do not return directory results from this model.

Exit criteria:

- Unit tests cover workspace-only file search.
- Unit tests cover manager file search with both workspace and thread-storage
  results.
- Unit tests cover non-manager threads not querying thread storage.
- Tests assert directory results are excluded if the shared path-suggestion hook
  is used underneath.
- Existing prompt mention behavior is unchanged.

### Phase 2 - Transient Open File Tab State

Goal: the secondary tab group can host a temporary file-search tab.

Scope:

- Add an `open-file-search` fixed secondary tab kind or equivalent transient tab
  state.
- Ensure it is not restored after reload.
- Add actions to create/focus the search tab.
- Add actions to replace the search tab with a selected preview tab.
- Deduplicate selected preview tabs.

Exit criteria:

- Opening **Open file** twice focuses the existing search tab.
- Selecting an already-open file focuses the existing preview tab.
- The search tab is removed after selection.
- Reload does not restore the search tab.

### Phase 3 - Secondary Tab Plus Menu

Goal: expose the entry point in the secondary tab strip.

Scope:

- Add the trailing plus icon button beside the secondary tabs.
- Keep the plus button outside the horizontally scrollable tab list so it is
  always visible.
- Add a dropdown menu with **Open file**.
- Wire the menu item to create/focus the transient search tab.
- Keep existing Info, Diff, and file-tab behavior unchanged.

Exit criteria:

- Plus button remains visible with many tabs open.
- Menu opens with keyboard and pointer.
- **Open file** opens the secondary panel and focuses the search tab.
- Compact viewport uses the existing drawer path.

### Phase 4 - Open File Tab UI

Goal: implement the fuzzy picker inside the transient tab.

Scope:

- Build the tab content using the file-only search model.
- Autofocus the search input when the tab opens.
- Support keyboard navigation and selection.
- Render loading, empty, error, and unavailable states.
- Replace the tab with the selected workspace or thread-storage preview.

Exit criteria:

- Selecting a workspace result opens/focuses a workspace preview.
- Selecting a manager thread-storage result opens/focuses a storage preview.
- Invalid/unavailable source states do not create preview tabs.
- The selected preview appears in the same secondary panel.

### Phase 5 - Validation

Run:

```sh
pnpm exec turbo run typecheck --filter=@bb/app
pnpm exec turbo run test --filter=@bb/app
```

Manual smoke:

- standard thread with ready environment
- manager thread with workspace files and thread storage files
- manager thread with no thread storage matches
- thread without a searchable environment
- many secondary tabs causing tab overflow
- compact viewport drawer
- missing file selected from stale results
- unsupported/binary preview result

## Out Of Scope

- Dockview or flexible layout work.
- Terminal placement changes.
- Workspace tree/sidebar.
- Prompt `@`-mention changes.
- Folder search results.
- Arbitrary absolute host-path input.
- Rootless host-file browsing by typed path.
- Free-form path linkification in terminal output or error strings.
