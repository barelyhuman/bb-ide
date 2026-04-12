# Local Workspace Editor Button Plan

## Goal

Add a thread header button, similar to the provided "Open in editor" dropdown, when the thread's attached environment is on the user's local host. The primary action opens the thread environment path, which is the managed worktree/clone path for managed environments and the project path for unmanaged environments, in the user's preferred local target.

## Current State

- Thread detail data already loads the thread and its environment in `apps/app/src/views/ThreadDetailView.tsx`.
- Local-host detection already exists through `useHostDaemon().isLocalHost(environment.hostId)`.
- The app already talks directly to the local host daemon through `apps/app/src/lib/api-host-daemon.ts`.
- The local daemon already exposes `/open-path`, implemented in `apps/host-daemon/src/local-api.ts`, but it only opens a path with the OS default app.
- The existing thread header action area is `apps/app/src/views/ThreadDetailHeader.tsx`, which already uses shared `Button`, `DropdownMenu`, and `SplitButton` primitives.

## Product Behavior

- Show the button only when all of these are true:
  - `thread.environmentId` resolves to an environment.
  - `environment.status === "ready"`.
  - `environment.path` is non-null.
  - `isLocalHost(environment.hostId)` is true.
  - The local daemon supports the workspace open-target API.
- Hide the button for cloud/remote hosts, missing paths, provisioning/error/destroyed environments, and browsers that cannot reach the local daemon.
- Primary click opens `environment.path` using the current preferred target.
- Dropdown item click opens with that target and stores it as the new preferred target.
- If the stored preferred target is unavailable on this machine, use the first available target from a stable fallback order, without mutating the stored preference.
- Open failures should be visible as a toast, for example "Could not open workspace in VS Code."

## Target List

Start with a fixed, typed set of known targets:

- `vscode` - VS Code
- `cursor` - Cursor
- `sublime-text` - Sublime Text
- `zed` - Zed
- `windsurf` - Windsurf
- `antigravity` - Antigravity
- `finder` - Finder
- `terminal` - Terminal
- `iterm2` - iTerm2
- `ghostty` - Ghostty
- `xcode` - Xcode

The daemon should return only targets it can reasonably launch on the current platform. Finder and Terminal are macOS-specific. On non-macOS platforms, return supported equivalents only after we have explicit launch commands for them; otherwise the app simply hides the button because no open targets are available.

## Architecture

Keep this as a local daemon capability rather than a server feature:

- The server should not queue a host command for this because the browser is already talking to a local daemon and opening an editor is a host-local primitive.
- The database should not persist editor preference for the first version. Store the preferred target in browser local storage through the existing storage helpers.
- The daemon owns app discovery and launch execution.
- The app owns presentation, preference selection, and deciding whether the current thread environment is local.

## Contract Changes

Update `packages/host-daemon-contract/src/local.ts` and re-export from `packages/host-daemon-contract/src/index.ts`.

Add shared schemas/types:

- `workspaceOpenTargetIdSchema`
- `workspaceOpenTargetKindSchema`
- `workspaceOpenTargetSchema`
- `workspaceOpenTargetsResponseSchema`
- `openWorkspaceRequestSchema`

The request shape should use required fields:

```ts
{
  path: string;
  targetId: WorkspaceOpenTargetId;
}
```

Add local routes:

- `GET /workspace-open-targets` returns `{ targets: WorkspaceOpenTarget[] }`.
- `POST /open-workspace` accepts `{ path, targetId }` and returns `{}`.

Do not add optional request fields for this path. The existing `/open-path` route can remain the default OS opener for existing callers.

## Daemon Implementation

Add a small workspace-open module under `apps/host-daemon/src/`, for example `workspace-open-targets.ts`.

Responsibilities:

- Define the canonical registry of known targets in one place.
- Detect targets available on the host.
- Launch a requested target with no shell interpolation.
- Return typed target metadata to the local API.

Implementation notes:

- Use `execFile` or the existing `open` package with structured arguments, never shell strings.
- For macOS app launches, prefer `open`/LaunchServices semantics using app names or bundle identifiers from the target registry.
- Validate that `path` exists and is a directory before launching.
- Reject unknown or unavailable `targetId` values with a 400 response.
- Keep app discovery best-effort. If detection fails for one target, omit that target and keep returning the rest.
- Keep `/open-path` unchanged so existing file-open behavior in the git diff panel is not coupled to workspace target selection.

Wire this module into `apps/host-daemon/src/local-api.ts`:

- Add optional dependency injection hooks for tests, such as `listWorkspaceOpenTargets` and `openWorkspace`.
- Register the new routes with `typedRoutes<HostDaemonLocalSchema>`.
- Cover route behavior in `apps/host-daemon/src/local-api.test.ts`.

## App API And Hooks

Update `apps/app/src/lib/api-host-daemon.ts`:

- Add `fetchWorkspaceOpenTargets(port)`.
- Add `openWorkspace(port, request)`.

Update `apps/app/src/hooks/useHostDaemon.ts` or add a focused hook:

- Expose `workspaceOpenTargets`.
- Expose `openWorkspace`.
- Return empty targets and a null opener when the local daemon is unavailable.
- Handle older daemons that return 404 for the new target route by treating the capability as unsupported.

Store preference in a focused module, for example `apps/app/src/lib/workspace-open-target-preference.ts`:

- Use `atomWithStorage`.
- Use `createLocalStorageEnumStorage`.
- Use the exported contract schema as the type guard so stale storage values are ignored.
- Suggested storage key: `bb.workspaceOpenTarget`.

## UI Changes

Add `apps/app/src/components/thread/ThreadWorkspaceOpenButton.tsx`.

Component behavior:

- Props should be defined with named interfaces, not inline types.
- Use the shared `Button` and `DropdownMenu` primitives.
- Match header sizing with the existing `THREAD_HEADER_ACTION_BUTTON_CLASS` style in spirit: `h-7`, compact padding, stable icon dimensions, `rounded-md`.
- Primary button label can be visually icon-only with accessible text, or `Open in {label}` if space allows.
- Dropdown items should show icon, label, and selected state.
- Menu items should set the preferred target and open immediately.
- Disable while an open request is pending to avoid duplicate launches.

Icon plan:

- First version can use a central icon map with bundled small SVG assets where available and generic lucide fallbacks by target kind.
- Keep icon rendering in one component so adding host-derived or better branded icons later does not touch header logic.

Update `apps/app/src/views/ThreadDetailHeader.tsx`:

- Add a `workspaceOpenButton?: ReactNode` prop.
- Render it before git actions and the thread actions menu.

Update `apps/app/src/views/ThreadDetailView.tsx`:

- Compute the local workspace open path from `environment.path` only after the environment is ready and local.
- Create `workspaceOpenButton` only when the local capability is available.
- Pass it into `ThreadDetailHeader`.

## Tests

Contract:

- Add host-daemon local contract coverage for `workspaceOpenTargetSchema`, `workspaceOpenTargetsResponseSchema`, and `openWorkspaceRequestSchema`.

Host daemon:

- `GET /workspace-open-targets` returns injected targets.
- `POST /open-workspace` validates the path and target.
- `POST /open-workspace` delegates to the injected launcher with `{ path, targetId }`.
- Unknown/unavailable targets return 400.
- Non-directory paths return 400.

App:

- `api-host-daemon` tests cover target listing and open requests.
- `useHostDaemon` tests cover:
  - targets/opener are available when the daemon supports the routes.
  - old daemon or unreachable daemon yields no target capability.
- Add a focused component test for `ThreadWorkspaceOpenButton`:
  - primary click opens the resolved preferred target.
  - menu click opens with the selected target and persists it.
  - unavailable stored preference falls back without rewriting storage.
- Add or extend a thread detail/header test if there is an existing harness; otherwise keep the integration logic tested through a small extracted helper that determines whether the button should render.

## Validation Commands

Use Turbo, not package scripts directly:

```sh
pnpm exec turbo run typecheck --filter=@bb/host-daemon-contract --filter=@bb/host-daemon --filter=@bb/app
pnpm exec turbo run test --filter=@bb/host-daemon-contract --filter=@bb/host-daemon --filter=@bb/app
```

Manual validation:

1. Start the dev stack.
2. Open a standard thread whose environment is on the local host and has a ready path.
3. Confirm the editor button appears in the thread header.
4. Click the primary button and confirm the environment path opens in the preferred target.
5. Pick a different target from the dropdown and confirm it opens the same path and becomes the primary target.
6. Open a thread on a non-local host and confirm the button is absent.
7. Stop or disconnect the local daemon and confirm the button disappears or is disabled without a console error.

## Exit Criteria

- The button is visible only for local ready environments with a path and a reachable compatible local daemon.
- The primary action opens `environment.path` in the resolved preferred target.
- The dropdown can change the preferred target and launch immediately.
- Remote/cloud environments never expose a local open action.
- Existing git diff "open file" behavior through `/open-path` still works.
- Tests and typecheck pass with the Turbo commands above.

## Open Decisions

- Exact icon fidelity: start with a central icon map and generic fallbacks unless we want daemon-provided installed app icons.
- Platform scope: this should be macOS-first because the requested menu and current native folder picker support are macOS-shaped. Add Linux/Windows launch targets only when their app detection and launch behavior are explicitly defined.
