# Remove Multi-Host Product Surface

## Goal

`3b978da2c` (TER-25) collapsed bb to a single primary local host: it removed the
host-join flow and added server-side guards that reject any host other than the
primary local daemon. But it left the *user-facing* host surface in place —
pickers, badges, a settings section, a CLI command, and host columns — all of
which are now dead: there is exactly one host, it is always the local machine,
and the user can never have a second one.

This plan finishes the cleanup. It removes every place the product lets a user
*see, choose, name, or manage* a host, and prunes the now-unused SDK methods and
server routes behind those surfaces. The `hostId` boundary stays in the data
model, persisted events, and internal resolution (the commit kept it
intentionally for future expansion) — we are removing the **product surface**,
not the structural concept.

## Decisions (confirmed)

- **Daemon status in UI:** drop entirely. No connection/online indicator
  survives in the app. Daemon-offline becomes discoverable when an action fails,
  consistent with every other transient backend failure.
- **CLI:** remove the `bb host` command and the host guide; strip now-redundant
  host columns/markers from other command output. `bb status` remains the health
  surface.
- **Depth:** display/UX *and* dead plumbing. Prune SDK host methods and server
  routes that go unused once the UI and CLI are gone.

## Non-Goals

- Do **not** remove `hostId` from project sources, environments, threads,
  replay captures, persisted events, or the daemon session protocol.
- Do **not** remove the server-side primary-host enforcement
  (`apps/server/src/services/hosts/primary-host.ts`) — that is what keeps the
  single-host invariant true.
- Do **not** change how the primary host is resolved or how the daemon opens its
  session.

## Scope Inventory

### A. App frontend (`apps/app`)

Pickers / selectors:
- `src/components/pickers/HostPicker.tsx` (+ `.stories.tsx`) — delete. Already
  only rendered when ≥2 eligible hosts, so it is permanently unreachable.
- `src/components/promptbox/NewThreadPromptBox.tsx` — remove the `HostSlot`
  component (lines ~328-344) and its render site (~303-304); drop the host prop
  threading.
- `src/components/pickers/EnvironmentPicker.tsx` — collapse the host grouping
  (`buildHostSections`, `HostSectionGroup`, per-host menu sections ~51-76,
  ~223-234, ~354-395) into a single implicit-local group. Environment values
  keep encoding `hostId` (the primary host) so request payloads are unchanged,
  but the host is no longer a user-visible axis. Update `.stories.tsx` and
  `NewThreadEnvironmentOptions.stories.tsx`.
- `src/views/RootComposeView.tsx` — `effectiveManagerHostId` becomes the
  resolved primary local host id (no selection); simplify the branch-query host
  scoping (~402, ~591).

Display / badges / labels:
- `src/components/secondary-panel/ThreadMetadataContent.tsx` — remove the
  `HostRow` (~205-223); drop `hostName`/host-status from `EnvironmentRow`
  (~232-288) and from `formatEnvironmentDisplay` call sites.
- `src/components/promptbox/ThreadEnvironmentSummary.tsx` — remove
  `environmentHostLabel` / `environmentHostConnected` props and their render
  (~70-80).
- `src/components/HostStatusIndicator.tsx` (`HostStatusDot`, `HostStatusBadge`)
  — delete once no callers remain.
- `src/components/ui/localhost-badge.tsx` — delete once no callers remain.
- Audit `formatEnvironmentDisplay` (shared util) to drop `isLocalHost`/
  `hostName` parameters once both app and CLI callers stop passing them.

Settings:
- `src/views/AppSettingsView.tsx` — delete the entire "Local Host" section
  (~365-421), the `localHosts`/`useEffectiveHosts` wiring (~284, ~289-293), the
  `renameHost` mutation (~295-305), and the `HostRenameDialog` render (~424-431).
- `src/components/dialogs/HostRenameDialog.tsx` + `.stories.tsx` — delete.
- `src/components/dialogs/HostDeleteDialog.tsx` + `.stories.tsx` — delete.

API client / hooks / atoms:
- `src/lib/api.ts` — delete `listHosts`, `getHost`, `updateHost`, `deleteHost`
  (~1416-1435) if no caller remains after the above. Keep any host read still
  needed to resolve the primary host id for request payloads; if a single
  read is still required, narrow it to that one use.
- `src/hooks/queries/effective-hosts.ts` — delete if unused after settings/
  pickers go.
- `src/hooks/useHostDaemon.ts` — keep `localDaemonHostId`/`pickFolder`/folder
  picking; remove `isLocalHost`/`isLocalDaemonHost`/`hasDaemon`-driven host UI
  helpers that no longer have callers.
- `src/lib/system-config-atoms.ts` — keep `hostDaemonPortAtom` and what folder
  picking needs; remove host-status atoms (`localHostStatusAtom`,
  `localHostDaemonReachableAtom`, etc.) that only fed the deleted status UI.
- `invalidateHostAvailabilityQueries` — remove if only the deleted mutations
  called it.

### B. CLI (`apps/cli`)

- `src/commands/host.ts` — delete the file and its `registerHostCommands`
  registration.
- `src/commands/project.ts` — drop the `(local)` host marker and `hostId`
  column from `printProjectSource`/`printProject`/`printProjectTable`
  (~107-116, ~329-376). A source's host is always the local host; show only
  path/type/default.
- `src/commands/environment.ts` + `environment-helpers.ts` — remove the
  `Host: …` line and the `fetchHost`/`hostName`/`isLocalHost` plumbing
  (~40-61). `bb environment show` no longer prints a host.
- `src/commands/replay.ts` — drop the "Host" column from `printCaptureTable`
  (~50-81).
- `src/commands/manager.ts`, `src/commands/thread/spawn.ts` — keep
  `resolveLocalHostId()` for building environment payloads (structural), but
  ensure no host is *printed*.
- `src/daemon.ts` — keep `fetchLocalHostId`/`resolveLocalHostId` (used to fill
  the primary host id into payloads).

### C. Guide / templates / docs

- `packages/templates/src/templates/bb-guide-hosts.md` — delete; remove `hosts`
  from the guide index in `bb-guide-overview.md` (~16, ~43) and from the
  `bb guide` available-chapters string.
- `packages/templates/src/templates/manager-agent-instructions.md` — remove the
  `bb host list` reference and host-as-a-thing framing (~9, ~30, ~35, ~37, ~142
  may stay as a structural `{{hostId}}` runtime var only if still injected;
  otherwise drop).
- `packages/templates/src/generated/templates.generated.ts` — regenerate from
  the source templates (do not hand-edit).
- `docs/multiple-devices.md` — already updated by the commit; re-read and ensure
  no dangling host-management references.

### D. SDK + server routes (dead plumbing)

- `packages/sdk/src/areas/hosts.ts` — remove `update`, `delete`, `createJoin`,
  `cancelJoin`. Keep `list`/`get` only if a remaining consumer (primary-host
  resolution for payloads, or `bb status`) needs them; otherwise reduce to the
  minimum read still used.
- `apps/server/src/routes/hosts.ts` — remove `PATCH /hosts/:id`,
  `DELETE /hosts/:id`, `POST /hosts/join`, `DELETE /hosts/:id/join`. Keep
  `GET /hosts` / `GET /hosts/:id` only if still consumed. Removing the join
  routes lets `rejectAdditionalHostJoin` and the join-server-url helper go too;
  removing delete lets `assertPrimaryHostNotDeleted` go. Re-check
  `primary-host.ts` and delete any guard left with no route caller.
- `packages/server-contract` — remove `UpdateHostRequest`, host-join request/
  response schemas, and any join types that lose their last route. Keep `Host`
  and `ReplayCaptureHostSummary.hostId` (structural).
- Regenerate any generated contract `.d.ts` from source; never hand-edit
  generated files.

## Sequencing

1. App display/pickers/settings first (largest surface; unlocks dead client
   methods and atoms).
2. Delete now-orphaned app components, hooks, atoms, stories.
3. CLI commands + output columns; regenerate templates.
4. SDK area + server routes + contract types last (verify zero remaining
   callers from steps 1-3 before deleting).
5. Tidy `formatEnvironmentDisplay` and any shared util whose host params are now
   unused across both app and CLI.

After each step, typecheck the touched package(s) so dead-reference fallout
surfaces incrementally rather than all at once.

## Validation / Exit Criteria

Mechanical:
- `pnpm exec turbo run typecheck --filter=@bb/app --filter=@bb/cli --filter=@bb/server --filter=@bb/sdk --filter=@bb/server-contract --filter=@bb/templates`
  passes.
- `pnpm exec turbo run test --filter=@bb/cli` passes; update
  `apps/cli/src/__tests__/command-output.test.ts` so the removed `bb host list`
  tests are deleted and the host-column assertions in project/environment/status
  output are removed (not merely relaxed). Pipe output to a file, then read it.
- `pnpm exec turbo run test --filter=@bb/server` passes; the public host route
  tests for the removed routes are deleted, and primary-host enforcement tests
  still pass.
- Storybook builds with no references to deleted stories.
- Repo-wide grep confirms no dangling identifiers:
  `HostPicker`, `HostRenameDialog`, `HostDeleteDialog`, `HostStatusBadge`,
  `HostStatusDot`, `LocalhostBadge`, `useEffectiveHosts`, `updateHost`,
  `deleteHost`, `createHostJoin`, `cancelHostJoin`, `UpdateHostRequest`,
  `bb-guide-hosts`. (Type-only deletions compile, but stale string/query-key/
  template identifiers do not error — grep is required.)

Behavioral:
- Settings page renders with no "Local Host" section and no console errors.
- New-thread / compose flows let you pick an environment with **no** host axis;
  spawning a thread still works and the resulting environment is bound to the
  local host.
- Thread metadata and environment summary render with no host name/badge.
- `bb host` is gone (`bb host list` errors as unknown command); `bb project
  list`, `bb environment show <id>`, `bb status`, and `bb replay` print no host
  column/line and read cleanly.
- `bb guide` no longer lists a `hosts` chapter.
- Creating a project source and spawning a thread via CLI still succeed (host id
  resolved internally).

## Risks / Watchpoints

- **Hidden callers of the SDK/route deletions.** Delete bottom-up only after
  grepping for callers; the daemon session protocol and primary-host resolution
  must keep whatever read they depend on. If `GET /hosts` is still needed to
  resolve the primary host id, keep it and only drop the mutation/join routes.
- **`formatEnvironmentDisplay` shared by app + CLI.** Change its signature once,
  for both callers, in the same change (per AGENTS rename discipline).
- **Generated files** (`templates.generated.ts`, contract `.d.ts`) must be
  regenerated from source, not edited by hand.
- **Folder picking** depends on the daemon (`useHostDaemon`/`hostDaemonPortAtom`)
  — preserve that path; only remove host *status/identity* UI, not the local API
  plumbing it shares.

## Cleanup

Delete this plan file once all exit criteria pass and the change is merged.
