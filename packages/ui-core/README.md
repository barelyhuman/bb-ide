# @bb/ui-core

`@bb/ui-core` is the shared React UI package for BB. It has two kinds of code:

- `src/primitives/`: generic design-system primitives.
- `src/thread-timeline/` and other named feature folders: pure BB domain
  presentation shared by multiple consumers.

The package should not become a dumping ground for app components. Before moving
or adding a component here, answer the relevant checks below.

## Primitives

Use `src/primitives/` for generic UI building blocks. A primitive must satisfy
all of these:

- No product data dependencies: no queries, atoms, routing, server calls, or BB
  lifecycle concepts.
- No `@bb/domain` types in its public API.
- Generic local interaction state is okay. Browser persistence, app preferences,
  and product policy belong in app wrappers.
- Replacing it would feel like a design-system change, not a feature change.

Examples: `Button`, `Dialog`, `DropdownMenu`, `Pill`, `DetailCard`,
`ExpandablePanel`, `ThreePaneLayout`.

## Domain Presentation

Use named feature folders for canonical rendering of BB domain concepts. These
components are still pure presentation:

- Props in, JSX out.
- No queries, atoms, routing, storage, or API calls.
- Drivable from fixture data.
- Used by at least two consumers, or clearly on the path to be shared.

Example: `thread-timeline/`.

## App Code

Keep components in `apps/app` when they are integration code or single-consumer
feature UI:

- Router, React Query, Jotai, local storage, cookies, or user preference wiring.
- App-specific containers and layout policy.
- Components with no expected reuse outside the app.

Thin app wrappers are expected when a primitive needs app policy. For example,
ui-core owns the generic `Toaster`, while the app owns `AppToaster` because it
injects the preferred theme.

## Litmus Test

Before adding code to ui-core, ask:

1. Is it a generic design-system primitive?
2. If not, is it a pure BB domain renderer used by multiple consumers?

If both answers are no, keep it in the app.
