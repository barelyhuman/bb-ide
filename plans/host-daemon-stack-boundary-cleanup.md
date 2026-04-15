# Host Daemon Stack Boundary Cleanup

## Diagnosis

The host daemon stack has three real drift problems, all matching the "server owns policy, daemon owns host primitives" rule in AGENTS.md:

1. **Policy baked into the daemon.** `apps/host-daemon/src/command-dispatch.ts` applies `SYSTEM_MAX_DIFF_BYTES` and `SYSTEM_MAX_FILE_LIST_BYTES` fallback defaults when the server doesn't specify limits. It also hardcodes `noVerify: true` on workspace commits. Both are product policy the server should own. The daemon should execute, not decide.

2. **`eventSink` optional in production dispatch options.** `command-dispatch-support.ts:44` declares `eventSink?: EventSink`. The recent stop-race fix relies on `options.eventSink?.flush()`. In production `eventSink` is always wired, so the fix works — but the `?` encodes "tests construct dispatch without one" as a production-legible contract. AGENTS.md §Contracts forbids optional fields without semantic meaning.

3. **Contract file mixes three unrelated concerns.** `packages/host-daemon-contract` currently defines (a) the server↔daemon WebSocket session/command/event protocol, (b) local HTTP routes for CLI↔daemon bindings (`/health`, `/status`, `/open`, `/workspace-open-targets`), and (c) command payloads that embed agent-runtime specifics (`providerId`, `instructionMode`, etc.). A caller of (a) has no reason to see (b) or (c).

`env-daemon-contract` appears to be dead — no source files visible, only `dist/`. Verify and delete.

The package split across `host-workspace`, `host-watcher`, `host-runtime-material`, `sandbox-host` is otherwise coherent.

## Phase 1: Split `host-daemon-contract` internally

**Goal:** Organize the contract so callers of the server-daemon protocol don't see local CLI routes, and vice versa.

**Changes:**
- Within `packages/host-daemon-contract/src/`, split exports by concern:
  - `server-protocol.ts` — session, command, event types used by the server↔daemon WebSocket
  - `local-api.ts` — HTTP routes used by the CLI and local tools
- Update `packages/host-daemon-contract/src/index.ts` to re-export both, so existing imports don't break, but update the server to import from `server-protocol` and the CLI to import from `local-api`.
- Verify `env-daemon-contract` has no sources; if dead, remove the package from pnpm-workspace.yaml and tsconfig references.

**Deliberately not a new package.** A prior draft proposed creating `@bb/host-local-api-contract`. That's disproportionate for six HTTP routes. A file split inside the existing package achieves the same isolation without a new package boundary.

**Exit criteria:**
- `server-protocol.ts` has zero HTTP route types.
- `local-api.ts` has zero command/event types.
- Server and CLI each import from the appropriate file (not the barrel).
- `env-daemon-contract` either removed or confirmed still needed (document why).
- `pnpm exec turbo run typecheck` passes.

## Phase 2: Move policy from daemon to server

**Goal:** Daemon requires policy inputs from the server; no defaults, no hardcoded behavior.

**Changes:**
- Remove `SYSTEM_MAX_DIFF_BYTES` and `SYSTEM_MAX_FILE_LIST_BYTES` fallbacks in `command-dispatch.ts`. Make `maxDiffBytes` and `maxFileListBytes` required on the `workspace.diff` and `workspace.list_files` commands. Update the server to always supply them.
- Add a required `skipHooks: boolean` field on the workspace commit command. Update the server to decide and pass it explicitly. Remove the hardcoded `noVerify: true` in the daemon handler.
- Make `eventSink` required on `CommandDispatchOptions`. Provide a `noopEventSink` for tests that don't care about event flow. Remove the `eventSink?.flush()` / `eventSink?.emit()` optional chains.

**Exit criteria:**
- `grep -n "SYSTEM_MAX\|noVerify: true\|eventSink?" apps/host-daemon/src/` returns no matches except in comments or tests.
- Command schemas for `workspace.diff`, `workspace.list_files`, `workspace.commit` have the new required fields.
- Server updated to supply them.
- `pnpm exec turbo run test --filter=@bb/host-daemon` passes.

## Phase 3: Consolidate workspace state ownership

**Goal:** One source of truth for "what changed in this workspace and when."

**Changes:**
- `RuntimeManager` in `apps/host-daemon/src/` currently owns a `WorkspaceWatchState` map and also orchestrates `HostWorkspace` and `HostWatcher`. Move `WorkspaceWatchState` into `packages/host-workspace` so the package that knows git state also tracks change state.
- Audit `environment-change-reporter` and runtime-manager for duplicated status checks. Pick one site to do the detection; have the other read its result.
- `trackedThreadStorageTargets` stays in RuntimeManager (it's about daemon-level thread routing, not workspace state).

**Exit criteria:**
- `WorkspaceWatchState` defined in `host-workspace`, not `host-daemon`.
- No duplicate `getStatus()` / `lastLocalFingerprint` tracking between reporter and runtime-manager.
- `pnpm exec turbo run test --filter=@bb/host-daemon --filter=@bb/host-workspace` passes.

## Out of scope — considered and declined

- **Creating `@bb/host-local-api-contract` as a new package.** Disproportionate to a file split (addressed in Phase 1).
- **Sandbox-host relationship audit.** `sandbox-host` isn't imported by the daemon (verified via `package.json`). Not a layering issue.
- **Documentation updates to AGENTS.md.** Documentation can follow real changes; proposing a phase for doc alone is padding.
- **Renaming command types or fields for consistency.** Explicitly against the brief.
- **Refactoring command payloads to use `environmentId + threadId` lookups instead of explicit provider/instruction fields.** The current fields are server policy; the server correctly owns these decisions. That the daemon sees them is the intended shape, not a leak.

## Expected impact

Three PRs, each small-to-medium. Phase 1 is mechanical file split. Phase 2 is the most behaviorally significant (changes several schemas) but its effects are localized. Phase 3 moves one map and consolidates detection; no behavior change.
