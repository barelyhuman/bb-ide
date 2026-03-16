# Environment Abstraction Cleanup

## Goal

Make "environment" a strong, first-class abstraction for thread creation. A thread's environment is specified via exactly one of three methods:

1. **`environmentId`** — reuse an existing environment by UUID
2. **`environmentDescriptor`** — find-or-create an unmanaged environment matching a descriptor
3. **`environmentCreationArgs`** — create a new managed environment

Eliminate the legacy `environmentKind` string path and all the dual-nature confusion around `environmentId` sometimes being a UUID and sometimes a kind string.

## Scope

### What changes

- **API contract** (`SpawnThreadRequest`, `spawnThreadSchema`)
- **Orchestrator** (`_resolveEnvironmentSelection`, spawn flow)
- **EnvFactory** (`reserveThreadEnvironment`)
- **Web UI** (ProjectMainView environment selector)
- **CLI** (thread spawn `--environment` flag)
- **Display/icon helpers** (`formatEnvironmentDisplayName`, `getEnvironmentIconInfo`)
- **Managed artifact reconciler** (legacy `environmentId` kind-string comparisons)
- **Transcript helpers** (`to-ui-messages.ts` worktree special-casing)

### What stays

- `EnvironmentRecord` schema/table — already correct
- `thread_environment_attachments` table — already correct
- `thread.environmentId` FK column — keeps its role as persistent historical reference
- `environmentAgentSessions` / `environmentAgentCommands` / `environmentAgentCursors` — unchanged
- `SandboxMode` — orthogonal, not part of this work

## Current State (What's Wrong)

### 1. `environmentKind` is a loose string passed through the entire stack

The API accepts `environmentKind?: string` ("local", "worktree", "docker") as a peer to `environmentId`. The orchestrator has two completely different code paths depending on which one is set. This is the old way of specifying environments before first-class environment records existed.

### 2. Web UI naming confusion

`ProjectMainView.tsx:247` has a variable called `environmentId` that is passed as `environmentKind` to the API:
```typescript
...(environmentId ? { environmentKind: environmentId } : {}),
```

### 3. CLI sniffs kind vs UUID

`apps/cli/src/commands/thread.ts:317-320` checks if the `--environment` value is in `["worktree", "local", "docker"]` to decide whether to send `environmentKind` or `environmentId`. Fragile — breaks if a new kind is added.

### 4. `formatEnvironmentDisplayName` maps kind strings, not UUIDs

It switches on `id` values like `"local"`, `"worktree"`, `"docker"` — these are kind strings that ended up stored as `environmentId` on old threads before first-class environments existed.

### 5. `managed-artifact-reconciler.ts:227` compares `environmentId` to kind strings

```typescript
environmentId === "worktree" || environmentId === "docker"
```

This only works for legacy threads where `environmentId` was a kind string, not a UUID.

### 6. `to-ui-messages.ts:941-945` special-cases `environmentId === "worktree"`

Legacy transcript handling that won't work for first-class environment records.

### 7. `envFactory.reserveThreadEnvironment` conflates descriptor and kind

For `"local"`, it finds-or-creates an environment with the project root path. For anything else, it creates a managed environment with the project root path as descriptor (which is wrong — a worktree's descriptor should be the worktree path, not the project root).

### 8. No way to specify an `environmentDescriptor` through the API

The descriptor concept exists on `EnvironmentRecord` but callers can't pass one when spawning a thread. The only way to target a specific path is to know the environment UUID.

## Implementation Steps

### Phase 1: Define the new API contract

**Files:** `packages/core/src/api-types.ts`, `packages/core/src/schemas.ts`, `packages/core/src/types.ts`

1. Add `EnvironmentCreationArgs` type:
   ```typescript
   export interface EnvironmentCreationArgs {
     runtimeKind: string; // "worktree", "docker", etc.
     // future: hostname, containerImage, etc.
   }
   ```

2. Update `SpawnThreadRequest`:
   ```typescript
   export interface SpawnThreadRequest {
     projectId: string;
     // ... existing fields ...

     // Environment specification (at most one):
     environmentId?: string;              // reuse existing by UUID
     environmentDescriptor?: EnvironmentDescriptor; // find-or-create unmanaged
     environmentCreationArgs?: EnvironmentCreationArgs; // create new managed

     // DEPRECATED — remove after migration:
     // environmentKind?: string;
   }
   ```

3. Update `spawnThreadSchema` to validate mutual exclusivity (at most one of the three).

### Phase 2: Update orchestrator environment resolution

**Files:** `apps/server/src/orchestrator.ts`, `apps/server/src/env-factory.ts`

1. Replace `_resolveEnvironmentSelection` with a clearer method that handles the three cases:

   - **`environmentId`**: Look up existing `EnvironmentRecord`, validate it belongs to the project, derive runtime kind from it. Attach thread to it.
   - **`environmentDescriptor`**: Call `environmentRepo.findByProjectDescriptor()`. If found, reuse it. If not found, create a new unmanaged environment record with this descriptor. Derive runtime kind from the descriptor (local if path === project root, worktree if it's a different checkout). Attach thread to it.
   - **`environmentCreationArgs`**: Create a new managed environment record. The descriptor will be populated later when provisioning completes (the actual worktree/container path isn't known yet). Attach thread to it.
   - **None specified**: Default to `environmentDescriptor: { type: "path", path: projectRootPath }` (equivalent to "use project root" / unmanaged / "local").

2. `envFactory.reserveThreadEnvironment` should be updated or replaced to support these three paths cleanly. The current `requestedEnvironmentId: string` parameter should become the structured input.

3. Remove `_resolveRequestedEnvironmentId` indirection — runtime kind resolution should happen in one place.

### Phase 3: Update env-factory descriptor handling

**Files:** `apps/server/src/env-factory.ts`

1. When `environmentCreationArgs` is used, the initial descriptor can be a placeholder (project root path) with `managed: true`. When provisioning completes and the actual worktree/container path is known, update the descriptor to reflect the real path.

2. `syncThreadEnvironmentAttachment` already partially does this — clean it up to be the canonical path for updating descriptors post-provisioning.

3. `derivePersistedEnvironmentRecordFromDescriptor` should remain as a utility for inferring runtime kind from a path-based descriptor.

### Phase 4: Update Web UI

**Files:** `apps/app/src/views/ProjectMainView.tsx`

1. Replace the environment selector to map options to the new API fields. Labels should be:
   - "Direct" → `environmentDescriptor: { type: "path", path: projectRootPath }` (or omit, since it's the default)
   - "New Worktree" → `environmentCreationArgs: { runtimeKind: "worktree" }`
   - "New Docker Sandbox" → `environmentCreationArgs: { runtimeKind: "docker" }`

2. Fix the `environmentId` variable naming confusion — rename to match what it actually represents.

3. Future: add UI for reusing environments via `environmentId` (out of scope for now, but the API will support it).

### Phase 5: Update CLI

**Files:** `apps/cli/src/commands/thread.ts`, `apps/cli/src/context-env.ts`

1. Update `--environment` flag to accept:
   - A UUID → sends `environmentId`
   - A path → sends `environmentDescriptor: { type: "path", path }`
   - A kind keyword like `worktree`, `docker` → sends `environmentCreationArgs: { runtimeKind: "worktree" }`

2. Discrimination logic: if it looks like a UUID, use `environmentId`. If it looks like a path (contains `/`), use `environmentDescriptor`. If it's a known kind keyword, use `environmentCreationArgs`. This is more robust than the current hardcoded `KNOWN_ENVIRONMENT_KINDS` list.

3. Consider separate flags for clarity: `--environment <uuid-or-path>` and `--new-environment <kind>`.

### Phase 6: Clean up display/icon helpers

**Files:** `packages/core/src/environment-display-name.ts`, `apps/app/src/lib/environment-icon.ts`, `apps/app/src/views/ThreadDetailView.tsx`

1. `formatEnvironmentDisplayName`: The kind-string mapping (`"local"` → "Direct", etc.) should move to a `formatRuntimeKind` helper or similar. Display name resolution for threads should primarily use `attachedEnvironment.descriptor` and `attachedEnvironment.managed`, not legacy kind strings.

2. `getEnvironmentIconInfo`: Already partially capability-based. Remove the `id === "docker"` special case — this should be based on `requestedRuntimeKind` or a capability flag.

3. `ThreadDetailView.tsx` label logic (below the promptbox, bottom-right of thread timeline): Derive from the environment record:
   - If descriptor path === project root → "Primary"
   - If environment is a worktree (managed or unmanaged) → "Worktree"
   - If environment is docker → "Docker"
   - For managed environments, can additionally show the last path segment or branch name for disambiguation.

### Phase 7: Clean up legacy kind-string references

**Files:** `apps/server/src/managed-artifact-reconciler.ts`, `packages/core/src/to-ui-messages.ts`

1. `managed-artifact-reconciler.ts:227`: Replace `environmentId === "worktree" || environmentId === "docker"` with a check on the environment record's `managed` flag (via join or lookup).

2. `to-ui-messages.ts:941-945`: Remove `environmentId === "worktree"` special-casing. Use environment record data instead.

### Phase 8: Remove `environmentKind` from API

1. Remove `environmentKind` from `SpawnThreadRequest` and `spawnThreadSchema`.
2. Remove the `environmentKind` code path from `_resolveEnvironmentSelection`.
3. Remove `resolveRequestedEnvironmentId` from `EnvironmentService` (or repurpose it as an internal-only runtime kind validator).

### Phase 9: Managed environment cleanup policy

**Files:** `apps/server/src/environment-service.ts`, `apps/server/src/managed-artifact-reconciler.ts`

1. Verify that cleanup only happens for `managed: true` environments.
2. When all threads attached to a managed environment are archived, clean up the environment (worktree deletion, container teardown, etc.).
3. When all threads attached to an unmanaged environment are archived, do NOT clean up — the user created/manages this workspace.
4. This should already mostly work via the `managed` flag, but audit all cleanup paths.

## Validation

- [ ] Spawning a thread with no environment specified defaults to project root (unmanaged)
- [ ] Spawning with `environmentDescriptor` pointing to project root reuses the existing unmanaged environment record
- [ ] Spawning with `environmentDescriptor` pointing to a user-created worktree creates/reuses an unmanaged environment for that path
- [ ] Spawning with `environmentCreationArgs: { runtimeKind: "worktree" }` creates a managed worktree environment
- [ ] Spawning with `environmentId` (UUID) reuses that environment
- [ ] Archiving all threads on an unmanaged environment does NOT delete the worktree
- [ ] Archiving all threads on a managed environment DOES clean up the worktree
- [ ] Web UI "project root" option works (unmanaged)
- [ ] Web UI "new worktree" option works (managed)
- [ ] CLI `--environment /path/to/worktree` works (unmanaged)
- [ ] CLI `--environment <uuid>` works (reuse)
- [ ] CLI `--new-environment worktree` works (managed)
- [ ] Legacy threads with kind-string `environmentId` values still display correctly
- [ ] `formatEnvironmentDisplayName` handles both legacy kind strings and new environment records
- [ ] E2E tests pass

## Decisions

1. **No backfill for legacy threads**: Old threads with kind-string `environmentId` values ("worktree", "docker") will not be migrated. Display helpers will continue to handle both kind strings and UUIDs.

2. **CLI uses multiple flags**: Separate flags for clarity (`--environment <uuid-or-path>`, `--new-environment <kind>`).

3. **Keep `thread.environmentId` column**: It's a cheap denormalized cache that serves as a historical breadcrumb (used for log path resolution and error reporting after attachment deletion). Not worth removing — the attachment table is the source of truth for active state, but `thread.environmentId` stays as a write-once reference set when the attachment is created. Stop using it as a primary lookup path; always prefer the attachment table.

## Open Questions / Risks

1. **Descriptor placeholder for managed environments**: When creating a managed environment, the actual path isn't known until provisioning completes. What should the initial descriptor be? Options: (a) placeholder with project root path, (b) null/empty descriptor populated post-provisioning. Current code uses (a).

2. **Multi-machine descriptors**: The plan mentions future support for `hostname` in descriptors. The `EnvironmentDescriptor` type is currently `{ type: "path", path: string }`. Adding a `host` field is additive but we should make sure the find-by-descriptor logic is ready for it (exact match on all fields).
