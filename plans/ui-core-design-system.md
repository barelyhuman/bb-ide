# ui-core as a Coherent Design System

## Problem

`packages/ui-core` is at risk of becoming a dumping ground for any stateless
component. Statelessness is necessary but not sufficient for membership — without
admission criteria, ui-core will accumulate one-off presentational components and
stop being a coherent set of primitives that the rest of the codebase can rely on.

At the same time, a lot of UI work in `apps/app` is becoming state-heavy and hard
to iterate on visually. We want a Ladle harness so designers and engineers can
preview components in isolation. Ladle is easy to add to ui-core (pure components,
no providers) and hard to add to `apps/app` (Router, React Query, Jotai atoms,
WebSocket). The right answer is to push more presentational logic into ui-core —
**but only the components that genuinely belong there.**

## Goal

1. Establish a clear three-layer model for where React UI lives, with explicit
   admission criteria.
2. Reorganize `packages/ui-core/src/` to make the layers visible.
3. Stand up Ladle in `packages/ui-core` with two example stories that prove the
   pattern (one primitive, one domain composition).
4. Extract a first batch of components from `apps/app` into the correct ui-core
   folder, with a story added in the same change.

Non-goal: standing up a Ladle harness with mocked providers inside `apps/app`.
Defer that until we've exhausted the simpler approach.

## The three-layer model

### Layer 1 — `packages/ui-core/src/primitives/` (design system)

Generic, reusable, no BB-domain types in the API. If you swapped BB for a
different product, these would still make sense.

**Admission criteria — must satisfy all:**

- Pure props in, JSX out. No queries, atoms, routing, or storage.
- API references zero domain types from `@bb/domain`.
- Aligned with a sanctioned visual pattern (page shell, detail card/rows,
  collapsible header, status pill, etc. — see `AGENTS.md` "UI Consistency").
- Replacing it would feel like a design system change, not a feature change.

### Layer 2 — `packages/ui-core/src/{feature}/` (domain compositions)

Pure presentation, but the API references BB domain concepts. Reusable across BB
consumers (`apps/app`, `packages/provider-audit`, future packages).

**Admission criteria — must satisfy all:**

- Pure props in, JSX out. No queries, atoms, routing, or storage.
- Drivable from fixture data alone.
- **Used by ≥2 consumers, or clearly destined to be.** Cross-package reuse is the
  whole point of the package.
- Encodes a canonical rendering of a domain concept that we don't want forking.

### Layer 3 — `apps/app/src/components/`

Stateless components that don't meet Layer 1 or Layer 2 criteria stay here. Used
in exactly one place, no expected reuse, no design-system status — they don't
need to move just because they're stateless.

### The litmus test

Before adding anything to ui-core, ask: **"Is this a design-system primitive, or
is it used in ≥2 places?"** If neither, leave it in `apps/app`.

## Design

### Reorganized `packages/ui-core/src/`

```
packages/ui-core/src/
├── primitives/
│   ├── pill.tsx
│   ├── status-pill.tsx
│   ├── detail-card.tsx
│   ├── disclosure.tsx
│   ├── event-content.tsx
│   ├── three-pane-layout.tsx
│   ├── page-shell.tsx          (extracted from apps/app)
│   ├── empty-state.tsx         (extracted from apps/app)
│   ├── form-error.tsx          (extracted from apps/app)
│   ├── settings-section.tsx    (extracted from apps/app)
│   ├── scroll-to-bottom-button.tsx  (extracted from apps/app)
│   ├── scroll.ts
│   └── utils.ts
├── thread-timeline/            (existing — domain composition)
│   └── ...
├── prompt-composer/            (promoted from prompt-composer.tsx)
│   └── prompt-composer-shell.tsx
├── context-panel/              (promoted from context-panel.tsx)
│   └── context-panel.tsx
└── index.ts                    (re-exports unchanged for consumers)
```

`index.ts` continues to flat-export everything so consumers don't notice the
reorganization. Internal imports update to the new paths.

### `packages/ui-core/README.md`

Short README that names the three layers, lists the admission criteria for each,
and gives the litmus test. This is the governance — code review enforces it, the
README gives reviewers a citation.

### Ladle setup

Mirror `packages/provider-audit`:

- `.ladle/config.mjs` — points at `stories/**/*.stories.tsx`, dark theme default
- `.ladle/components.tsx` — single `GlobalProvider` applying the dark class
- `.ladle/ladle.css` — imports the shared theme CSS, with `@source` directives for
  ui-core source paths
- `vite.config.ts` — `@tailwindcss/vite` plugin
- `package.json` — `ladle` and `ladle:build` scripts
- Stories use **hand-written mock props**. No `export-ladle-data` step.

**One refactor while we're here:** the shared theme CSS currently lives at
`apps/app/src/app.css`, and `provider-audit` reaches across the monorepo to import
it. Extract the theme block into a small file (e.g.
`packages/ui-core/src/primitives/theme.css`) that both `apps/app/src/app.css` and
the two `.ladle/ladle.css` files import. This removes the cross-package CSS
dependency and gives ui-core ownership of the design tokens.

### Story style by layer

- **Primitives** → visual catalogs. Every variant of `Pill`, every state of
  `CollapsibleHeader`. These double as documentation and a forcing function for
  visual consistency.
- **Domain compositions** → scenario-driven. "Timeline with a long tool call
  followed by an error", "ContextPanel with no items", etc. These exist for
  iteration on real product surfaces.

## Steps

### Step 1 — Reorganize ui-core into layers

1. Create `packages/ui-core/src/primitives/` and move existing primitives into it
   (`pill`, `status-pill`, `detail-card`, `disclosure`, `event-content`,
   `three-pane-layout`, `scroll`, `utils`).
2. Promote `prompt-composer.tsx` and `context-panel.tsx` into their own folders so
   future related files have a home.
3. Update `index.ts` re-exports to the new paths. Keep the public surface
   identical.
4. Update internal imports inside `ui-core` to the new paths.
5. Write `packages/ui-core/README.md` describing the three layers, admission
   criteria, and litmus test.

**Validation:**

- `pnpm exec turbo run build --filter=@bb/ui-core` passes.
- `pnpm exec turbo run typecheck --filter=@bb/app` passes (consumers see no
  change).
- `git grep -l "from \"@bb/ui-core\"" apps/app packages` produces the same
  results as before the change.

### Step 2 — Extract shared theme CSS

1. Create `packages/ui-core/src/primitives/theme.css` containing the `@theme`
   block currently in `apps/app/src/app.css`.
2. Update `apps/app/src/app.css` to `@import` it.
3. Update `packages/provider-audit/.ladle/ladle.css` to import the new theme file
   directly instead of reaching into `apps/app/src/app.css`.

**Validation:**

- `apps/app` renders identically (visual spot-check on a thread detail page).
- `pnpm --filter @bb/provider-audit ladle` (run by the user) shows the same
  styling as before.

### Step 3 — Scaffold Ladle in ui-core

1. Add `.ladle/config.mjs`, `.ladle/components.tsx`, `.ladle/ladle.css`.
2. Add `vite.config.ts` with `@tailwindcss/vite`.
3. Add `ladle` and `ladle:build` scripts to `packages/ui-core/package.json`.
4. Add Ladle to `devDependencies`.
5. Write **two example stories**:
   - `stories/primitives/status-pill.stories.tsx` — visual catalog of every
     variant. Validates the trivial end of the pattern.
   - `stories/thread-timeline/tool-call-row.stories.tsx` — a handful of realistic
     `ToolCallRow` states (running, succeeded, failed, with output, without
     output). Validates the complex end.

**Validation:**

- `pnpm --filter @bb/ui-core ladle` (run by the user) opens with both stories
  visible and rendering correctly.
- `pnpm exec turbo run build --filter=@bb/ui-core` still passes.

### Step 4 — Extract first batch of primitives

For each of these, move the file into `packages/ui-core/src/primitives/`, update
`apps/app` imports, and add a story in the same PR:

- `PageShell` (apps/app `components/layout/PageShell.tsx`)
- `EmptyState` (apps/app `components/shared/EmptyState.tsx`)
- `FormError` (apps/app `components/shared/FormError.tsx`)
- `SettingsSection` (apps/app `components/settings/SettingsSection.tsx`)
- `ScrollToBottomButton` (apps/app `components/shared/ScrollToBottomButton.tsx`)

Each must satisfy the Layer 1 admission criteria — if any of these turn out to
reference domain types or app context on closer inspection, drop them from this
step and reconsider.

**Validation:**

- `pnpm exec turbo run typecheck --filter=@bb/app` passes.
- `pnpm exec turbo run build --filter=@bb/ui-core --filter=@bb/app` passes.
- Each extracted primitive has a story rendering at least its happy path and one
  edge case.
- A grep for the old import paths in `apps/app` returns nothing.

### Step 5 — Domain composition extractions (criteria-gated)

For each candidate from the audit, before moving, confirm: **does this have ≥2
consumers, or is it imminently planned to?** If no, leave it in `apps/app`.

Likely yes (worth moving with stories):

- `ConversationStatusIndicator`, `ConversationWorkingIndicator` →
  `thread-timeline/`
- `ThreadContextWindowIndicator` → `thread-timeline/` (move `useHoverPopover`
  alongside or inline it)

Probably no for now (single consumer, no imminent reuse):

- `HostStatusIndicator`, `WorkspaceChangesList`. Revisit when a second consumer
  appears.

**Validation:**

- Same as Step 4 for any moved component.
- For each component left behind, write down (in the PR description, not the
  code) which criterion failed.

### Step 6 — Defer

The following are explicitly out of scope for this plan:

- **PromptBox container/presenter split** — high-value but a substantial
  refactor on its own. Track separately.
- **Mocked-providers Ladle harness in `apps/app`** — only build this if a
  Layer-2 extraction proves impossible for a component we genuinely need to
  iterate on.
- **Splitting ui-core into `@bb/design-system` + `@bb/ui-core` packages** —
  folder structure + README + code review is enough governance for now.
  Splitting is a one-way door; do it only when the primitives layer has its own
  release cadence and design review process.

## Exit Criteria

- [ ] `packages/ui-core/src/primitives/` exists and contains all generic
      primitives. Domain compositions live in named feature folders.
- [ ] `packages/ui-core/README.md` documents the three-layer model, admission
      criteria, and litmus test.
- [ ] Shared theme CSS lives in `packages/ui-core/`. Neither `apps/app` nor
      `packages/provider-audit` reaches across the monorepo for it.
- [ ] `packages/ui-core/.ladle/` exists. `pnpm --filter @bb/ui-core ladle`
      starts and shows working stories.
- [ ] At least one primitive story (visual catalog style) and one domain story
      (scenario style) exist.
- [ ] Five primitives are extracted from `apps/app` into
      `ui-core/src/primitives/`, each with a story.
- [ ] Domain compositions are moved only when they meet the ≥2-consumer
      criterion. Components that don't qualify are documented (in PR
      descriptions) as intentionally staying in `apps/app`.
- [ ] App and ui-core builds pass:
      `pnpm exec turbo run build --filter=@bb/app --filter=@bb/ui-core --filter=@bb/provider-audit`.
- [ ] `apps/app` visually unchanged (spot-check thread detail, settings, project
      list).

## Risks / Decisions

**Re-exports stay flat.** `index.ts` keeps re-exporting everything so consumers
don't break. Internal folder reorganization is invisible from outside the
package.

**Don't split into separate packages yet.** Splitting `@bb/design-system` from
`@bb/ui-core` is tempting but premature. The folder structure + admission
criteria README gives most of the value with none of the per-package overhead
(extra `package.json`, extra Turbo target, extra import path to remember). When
the primitives layer is mature enough to warrant its own release cadence and
design review, revisit.

**Reuse, not statelessness, is the admission criterion for Layer 2.** The
biggest risk to the plan is criterion drift — engineers moving things into
ui-core "because they can." Defend this in code review by pointing at the README
and asking the litmus question.

**Ladle scope creep into apps/app.** Tempting to mock providers and story
everything. Resist. The cost of mocked atoms and a fake QueryClient is real,
and most of what we'd want to story should be moved into ui-core anyway. Treat
mocked-providers Ladle as a last resort.

**`useHoverPopover` and other small hooks.** Moving `ThreadContextWindowIndicator`
will probably surface a need for hooks like `useHoverPopover` to also live in
ui-core. Inline trivially, or add a `primitives/hooks/` folder if more than one
hook needs to move. Don't create a separate hooks package.
