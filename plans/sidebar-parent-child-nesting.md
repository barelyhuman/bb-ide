# Sidebar: nest threads by parent-child relationship (prototype)

## Goal

Make the sidebar's thread tree nest **purely on `parentThreadId`**, regardless of
`thread.type`. Today nesting is a hardcoded two-level structure keyed on
`type === "manager"`; a manager is always a root and a `standard` thread is
always a leaf. After this change the sidebar builds a recursive tree from the
parent links alone, to arbitrary depth.

Two decisions already made:

- **Arbitrary nesting depth.** Any thread can parent any thread; the tree
  recurses without a fixed level count.
- **Keep the manager marker.** Managers still render their `UserRound` icon.
  `type` no longer drives *nesting*, but it still drives the *leaf glyph*. The
  expand/collapse affordance moves off `type` onto "has children."

This is a prototype: the server, DB schema, `parentThreadId` population, the
`type` field, and manager creation are all untouched. Only the sidebar's
client-side grouping + rendering change.

## Background: how it works today

Server returns a flat `ThreadListEntry[]` per project. All nesting is client-side.

- **`projectThreadGroups.ts`** — `buildProjectThreadGroups()` splits threads into
  `managerThreadGroups` (every `type === "manager"` thread) and `unmanagedItems`.
  `getKnownManagerParentId()` attaches a child to a manager only if the child is
  `standard` **and** its parent is a `manager`. Consequences:
  - Max depth is 1 (manager → child). A manager's own `parentThreadId` is never read.
  - A `standard` thread parented to another `standard` thread is silently
    flattened to the project root (parent link ignored).
- **`ProjectRow.tsx`** — `ProjectThreadTree` renders `managerThreadGroups`
  (via `ManagerThreadGroupRow`) then `unmanagedItems`. Three separate row
  components hardwired to the 2-level shape: `ManagerThreadGroupRow`,
  `ManagedEnvironmentThreadSubGroup`, `EnvironmentThreadGroupRow`.
- **`ThreadRow.tsx`** — the collapse chevron + sticky `manager` tier are gated on
  `options.kind === "manager"` (`ThreadRow.tsx:330`).
- **Indentation** — fixed 4-value enum `root/project-child/nested-child/deep-child`
  → `pl-2/8/14/20` (`sidebarRowClasses.ts:32`). Connector hairlines hardcoded at
  `left-4/10/16`.
- **Sticky tiers** — `theme.css` (~102–261) defines a fixed ladder of four named
  tiers `label → project → manager → environment`, each with a precomputed `top`
  offset (one CSS var per level), a fixed z-index (60/50/40/35, decreasing so
  deeper headers slide under ancestors), and shield `::before`/`::after` heights
  sized to the gaps between named tiers. The Pinned/projectless variant overrides
  `manager → project-top` / `environment → manager-top` (lines 251–261).
- **Collapse state** — `collapsedManagerIdsAtom` (localStorage
  `bb.sidebar.collapsedManagers`), threaded as `collapsedManagerIds` /
  `onToggleManagerCollapsed` through `ProjectList → ProjectRow → PinnedThreadTree`.
  Functionally already just "a set of thread ids."
- **Pinned tree** — `pinnedSidebarThreads.ts` + `PinnedThreadTree.tsx` reuse
  `ManagerThreadGroupRow` and the same 2-level manager/standard assumption
  (`pinnedSidebarThreads.ts:86,123`).

## The hard part: sticky sections

The sticky ladder is the largest risk, and it forces a product decision that no
CSS resolves: **every pinned ancestor reserves a full row of vertical height.**
Today that is capped at 3 (project + manager + environment). Unbounded depth
would try to pin N ancestor headers; on a short viewport they eat the whole pane.

Decision for this prototype: **cap stickiness, not nesting.**

- Nesting (indentation + collapse) is genuinely arbitrary depth.
- Stickiness is capped at the top tiers: the **project** row plus the **first
  parent level** stay sticky. Rows deeper than the cap render **non-sticky** —
  they still nest and collapse, they just scroll normally.

This sidesteps viewport exhaustion and ~80% of the `theme.css` rework while
delivering the requested nesting. Fully depth-driven sticky offsets/z-index/
shields are explicitly out of scope (would still need a pin-cap anyway).

## Plan

### 1. Data model — recursive tree (`projectThreadGroups.ts`)

Replace the manager/standard split with a recursive builder keyed on `parentThreadId`.

- New node type carrying `thread`, recursive `children: ProjectThreadItem[]`, a
  `depth`, and rolled-up `stats` (`childCount`, `getCollapsedChildActivity`).
  Keep `ProjectThreadItem` as the `thread | environment` union so env grouping
  still interleaves per sibling set.
- Build adjacency for **all** threads regardless of `type`.
- Roots = `parentThreadId === null` **or** parent not in this project's set
  (preserve the existing orphan-becomes-root rule).
- Recurse, applying the existing `compareStandardThreads` sort and
  `bucketWorktreeEnvironmentGroups` env-grouping **at every level**.
- **Cycle guard:** a visited set during the walk. Newly reachable now that
  managers' parents are followed (`A.parent=B, B.parent=A`).
- Decide rollup semantics for a collapsed parent: roll up **all descendants**
  (recursive activity), not just direct children, so a collapsed subtree's
  glyph reflects anything inside it.
- Keep manager reorder (`sortKey`) working for the existing top-level-manager
  case; out of scope to make arbitrary interior nodes reorderable.

### 2. Rendering — one recursive row (`ProjectRow.tsx`)

- Collapse `ManagerThreadGroupRow` / `ManagedEnvironmentThreadSubGroup` /
  `EnvironmentThreadGroupRow` into a single recursive component taking `depth`
  and a tree node; it renders the row then maps its children recursively.
- Move the chevron/expand affordance off `kind: "manager"` onto **"has
  children."** A manager keeps `UserRound` as its leaf glyph (icon and expand
  affordance become independent in `ThreadRow.tsx`).
- Env subgroups render at any depth via the same recursion.

### 3. Indentation — depth-driven (`sidebarRowClasses.ts`, `ThreadRow.tsx`)

- Replace the `root/project-child/nested-child/deep-child` enum + `pl-2/8/14/20`
  with a depth-driven `paddingLeft` (inline style or `--depth` custom property +
  `calc()`).
- Connector hairlines (`left-4/10/16`) likewise derive from depth.

### 4. Sticky — depth cap (`theme.css`, `ProjectRow.tsx`, `sidebar.tsx`)

- Keep `SidebarStickyGroup` containing-block nesting (already recursion-friendly).
- Apply the `data-sidebar-sticky-tier` only to rows within the cap (project +
  first parent level). Deeper rows render without the sticky tier attribute, so
  they scroll normally.
- Generalize the Pinned/projectless override: the section variant starts its
  depth counter one lower rather than relying on per-name CSS overrides.
- Confirm z-index/shield values still read correctly for the capped tiers.

### 5. Collapse state — rename (`sidebarCollapsedAtoms.ts` + threading)

- Rename `collapsedManagerIdsAtom` → `collapsedThreadIdsAtom` (and the
  `bb.sidebar.collapsedManagers` storage key → `collapsedThreads`), plus
  `collapsedManagerIds` / `onToggleManagerCollapsed` props through
  `ProjectList.tsx`, `ProjectRow.tsx`, `PinnedThreadTree.tsx`,
  `ProjectRow.stories.tsx` (~20 sites). Per AGENTS.md, rename every identifier in
  the same commit, not just the type.

### 6. Memo comparators (`ProjectRow.tsx:1484`, `:1495`)

- `hasCollapsedManagerStateChanged` filters `thread.type !== "manager"`. Change
  to "thread has children" so collapse toggles on non-manager parents re-render.

### 7. Pinned tree (`pinnedSidebarThreads.ts`, `PinnedThreadTree.tsx`)

- Rebuild pinned roots on the generic tree. Drop the `type === "manager"` filters
  (`pinnedSidebarThreads.ts:86,123`); a pinned root is any pinned thread whose
  parent is not itself an effective pinned root. Reuse the recursive row.

### 8. Tests & stories

- Rewrite `projectThreadGroups.test.ts` to cover: multi-level nesting,
  standard→standard parenting, orphan-becomes-root, cycle guard, env grouping at
  depth, descendant activity rollup.
- Update `ProjectRow.stories.tsx` with a deep-nesting fixture (≥3 levels, mixed
  manager/standard parents, a worktree group nested mid-tree).

## Out of scope

- Server, daemon, DB schema, `parentThreadId` population, `type` field, manager
  creation flow.
- Fully depth-driven **sticky** offsets/z-index/shields for unbounded depth
  (capped instead — see "The hard part").
- Making arbitrary interior nodes drag-reorderable (top-level manager reorder
  stays as-is).

## Exit criteria

- A `standard` thread parented to another `standard` thread renders nested under
  it (today it flattens to the project root).
- Nesting renders correctly to ≥3 levels with correct indentation and connector
  lines; any thread with children shows the expand/collapse chevron; managers
  still show the `UserRound` glyph.
- Collapsing any parent (manager or not) hides its whole subtree and persists
  across reload via the renamed atom.
- Env worktree groups still form (≥2 sharing an environment) and interleave by
  recency at every level.
- Project + first parent level stay sticky on scroll; deeper rows scroll
  normally without the pane filling with pinned headers.
- Pinned section nests the same way.
- No remaining `collapsedManager*` identifiers; no `type === "manager"` checks
  driving *nesting* (only the leaf glyph).

## Validation

- `pnpm exec turbo run typecheck --filter=@bb/app`
- `pnpm exec turbo run test --filter=@bb/app --force > /tmp/sidebar-test.txt 2>&1`
  then read `/tmp/sidebar-test.txt` (don't grep inline).
- Storybook: open `ProjectRow` stories, exercise the deep-nesting fixture —
  expand/collapse at each level, scroll to verify the sticky cap, confirm a
  worktree group nested mid-tree.
- Manual in `pnpm dev`: create a manager, a child thread under it, then a thread
  whose parent is that child (depth 3), and confirm the sidebar nests all three.

## Cleanup

Delete this file once the prototype lands or is abandoned.
