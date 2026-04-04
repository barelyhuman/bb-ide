# Phase 8 Follow-up: Sandbox Hardening And Backend Registry

## Goal

Close the valid correctness and maintainability gaps from the Phase 8 review without reopening deferred app UI work. The end state should have:

- sandbox backends resolved through a registry/discovery model instead of ad hoc string checks
- one canonical server-owned path for sandbox policy and daemon environment assembly
- durable cleanup for ephemeral sandbox hosts and provisioning/deletion edge cases
- explicit test coverage for the new lifecycle behavior
- reduced adapter maintenance risk where the review identified real duplication or leak potential

## Non-Goals

- No app-side "Cloud sandbox" selector work in this follow-up
- No change to make `sandboxType` a closed `z.enum(["e2b"])`
- No attempt to solve every historical config `""` convention in this stack
- No broad provider-architecture redesign outside the specific adapter duplication and turn-state leak issues called out in review

## Design Principles

- The server owns product policy. Backend selection, configuration checks, daemon env assembly, and cleanup policy should live on the server side.
- `@bb/sandbox-host` should own backend mechanics, not product decisions.
- There should be one canonical path per concern. If two layers can assemble sandbox env or cleanup state independently, collapse them.
- Persist state when correctness depends on later async work. Do not rely on transient booleans crossing request boundaries.
- Prefer small shared abstractions over copy-pasted behavior, especially in long-lived adapters and lifecycle services.

## Workstream 1: Sandbox Backend Registry

Replace the current "open string + runtime `if (sandboxType !== "e2b")`" pattern with the same model used for providers: open-ended IDs backed by a registry.

### Changes

- Add a sandbox backend registry module with:
  - `listAvailableSandboxBackends(): SandboxBackendInfo[]`
  - `createSandboxBackendForId(id: string): SandboxBackend`
- Keep `sandboxType` as `string` at the contract boundary, but resolve it through the registry instead of inline checks.
- Start with one built-in backend: `e2b`.
- Define backend metadata explicitly:
  - `id`
  - `displayName`
  - `available`
  - capabilities relevant to sandbox lifecycle and workspace provisioning
- Add a server discovery route analogous to `/system/providers`, for example `/system/sandbox-backends`, so CLI/app callers can discover valid backend IDs.
- Move backend-specific validation behind the registry instead of scattering `E2B_API_KEY`, template, and backend support checks across `thread-create.ts`.

### Maintainability Constraints

- The registry must be the single place that maps backend ID to implementation.
- Avoid reintroducing provider-style logic in multiple packages. The server should consume backend info from one place.

### Exit Criteria

- Sandbox backend selection is resolved through the registry, not through inline `if (sandboxType === ...)` checks.
- The initial built-in backend list contains `e2b` and existing sandbox-host flows still work.
- If a discovery route is added, it returns the expected backend metadata without requiring any app-side UI work.

## Workstream 2: Server-Owned Sandbox Policy And Daemon Env

Remove the split ownership between server env assembly and `@bb/sandbox-host` passthrough env behavior.

### Changes

- Stop forwarding provider API keys from `packages/sandbox-host/src/provision.ts` via `process.env`.
- Have the server assemble the full daemon env once, explicitly, including:
  - GitHub auth
  - any provider credentials we intentionally allow inside sandboxes
  - daemon runtime settings
- Keep `@bb/sandbox-host` as a pure transport/mechanics layer that accepts an explicit env object.
- Decide and document the trust model for credentials that are intentionally made available inside sandboxes.
- Make host identity honor the provided sandbox host name:
  - `BB_HOST_NAME` should be read by `apps/host-daemon/src/identity.ts`
  - sandbox hosts should report the intended server-generated name instead of the container hostname
- Replace fragile `import.meta.url`-based `../../` root traversal in sandbox path helpers with a more durable package-root resolution strategy:
  - `packages/sandbox-host/src/daemon-artifacts.ts`
  - `packages/sandbox-image/src/paths.ts`

### Exit Criteria

- There is exactly one code path that decides which env vars enter a sandbox daemon.
- `packages/sandbox-host` no longer reads provider API keys from process env directly.
- A sandbox host opened through the daemon reports the intended `hostName`.

## Workstream 3: Ephemeral Host Cleanup And Destroy Correctness

Fix the real lifecycle bugs around host teardown and orphaned sandboxes.

### Changes

- Make environment cleanup responsible for tearing down ephemeral sandbox hosts after the final managed environment is destroyed.
- Introduce explicit durable cleanup state if needed so destroy work can be retried safely after transient failures.
- Do not mark a host as destroyed unless sandbox teardown actually succeeded.
- Surface destroy failures through logs and timeline/system events instead of swallowing them.
- Keep paused-sandbox reconnect behavior aligned with the E2B SDK contract:
  - `Sandbox.connect()` is the documented manual resume path for paused sandboxes
  - validate and document that assumption in tests rather than adding a redundant resume-before-connect flow
- Ensure the cleanup path handles:
  - successful environment destroy
  - failed sandbox destroy
  - reconnect/sweep retries
  - idempotent repeated cleanup requests

### Maintainability Constraints

- Do not bolt this onto `thread-create.ts` as another local catch block.
- Cleanup ownership should live in the environment/host lifecycle services, not in route handlers.

## Workstream 4: Async Lifecycle Reconciliation

Fix the state machine gaps where deferred async work can revive or preserve resources that the user already chose to remove.

### Changes

- Include provisioning tombstones in reconnect reconciliation so deleted threads cannot be revived by later `environment.provision` success handling.
- Update `handleProvisionCommandResult(...)` to ignore or hard-delete tombstoned threads before attempting transitions back to `idle` or `active`.
- Preserve forced archive cleanup across active-thread stop finalization:
  - persist cleanup intent explicitly
  - do not recompute a destructive cleanup decision as non-destructive later
- Make `waitForHostSession(...)` wait on host-specific notifications rather than any host event.
- Add a backstop for private/non-routable `BB_PUBLIC_URL` values:
  - reject loopback
  - reject RFC1918 IPv4 ranges
  - reject other non-public numeric hosts we can identify deterministically

### Exit Criteria

- Deleting a provisioning thread cannot resurrect it on reconnect or on provision completion.
- `force: true` archive cleanup remains destructive after thread stop finalization.
- Sandbox session waiting no longer wakes on unrelated host events.

## Workstream 5: Tests And Boundary Discipline

Bring the new sandbox behavior under outcome-based tests and tighten boundary assumptions.

### Changes

- Add direct `SandboxHostRegistry.getOrCreate(...)` tests, including concurrent deduplication and eviction interaction.
- Replace CLI source CRUD tests that only assert mock call shapes with tests that also assert user-visible output and exit behavior.
- Reduce raw `as { ... }` response casts in server tests where they bypass contract expectations.
- Decide and document the intended test boundary for server-side sandbox tests:
  - preferred: treat E2B as the true external boundary and keep most behavior tests inside `@bb/sandbox-host`
  - acceptable fallback: explicitly document `@bb/sandbox-host` as the server boundary if we keep mocking it
- Add regression coverage for:
  - host-specific session waiting
  - failed ephemeral-host destroy retry behavior
  - deleted provisioning threads
  - forced archive cleanup after stopping an active thread
  - `BB_HOST_NAME` identity behavior

## Workstream 6: Adapter Maintainability

Address the valid long-term maintenance issues in `claude-code/adapter.ts` and `pi/adapter.ts` without changing provider behavior.

### Changes

- Extract shared turn-state bookkeeping into a shared helper module:
  - assistant message scoping
  - turn start/finish bookkeeping
  - cumulative token accumulation
  - tool item tracking
- Add explicit cleanup or bounded retention for per-thread adapter state.
- Keep provider-specific translation logic in each adapter; only extract clearly shared mechanics.

### Maintainability Constraints

- Do not create an abstraction that hides provider-specific event differences.
- Land shared helpers only if both adapters use them directly and the duplication is materially reduced.

## Explicit Defers / Won't Fix In This Plan

- Keep `sandboxType` as an open string in contracts; the fix is registry-backed resolution, not narrowing to a one-value enum.
- Do not change the existing multi-source project model just to enforce one `github_repo` source per project.
- Do not widen this plan into app UI work.
- Do not treat the current E2B template registry fallback (`templates.json` with `current: null`) as a bug beyond the existing server-side configuration gate.

## Exit Criteria

- A sandbox backend registry exists and the server resolves sandbox backends through it.
- Sandbox daemon env assembly is fully server-owned and explicit.
- Ephemeral sandbox hosts are destroyed as part of managed environment cleanup, with durable handling for teardown failures.
- Deleted provisioning threads cannot be revived by reconciliation or command-result handling.
- Forced archive cleanup is preserved across async stop finalization.
- Host session waiting is host-specific.
- Server, CLI, and sandbox-host tests cover the new lifecycle behavior directly.
- Shared adapter turn-state logic is extracted or the duplication risk is otherwise materially reduced with bounded state retention.

## Validation

Run targeted validation while implementing:

```sh
pnpm exec turbo run test typecheck --filter=@bb/server --filter=@bb/host-daemon --filter=@bb/sandbox-host --filter=@bb/server-contract --filter=@bb/cli --filter=@bb/agent-runtime --force
```

Run full repo validation before landing:

```sh
pnpm exec turbo run test typecheck --force
```

Run focused behavioral checks during implementation:

```sh
pnpm exec turbo run test --filter=@bb/server --filter=@bb/sandbox-host --filter=@bb/cli --filter=@bb/agent-runtime --force
```

If E2B credentials are available locally, run manual sandbox validation:

```sh
pnpm exec tsx scripts/qa/e2b-smoke.mts
```

Manual end-to-end acceptance for this follow-up:

- If `/system/sandbox-backends` exists, verify it returns the expected backend list and availability metadata.
- Create a project with a GitHub repo source.
- Create a `sandbox-host` thread through the CLI or API.
- Verify the host session opens with the intended server-generated host name.
- Archive or delete the last sandbox thread and verify both the managed environment and its ephemeral host are torn down.
- Repeat the archive path with `force: true` on a dirty managed environment and verify the destructive choice is preserved through stop finalization.
