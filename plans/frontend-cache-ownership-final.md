# Frontend Cache Ownership Final Plan

## Problem

Frontend app-domain cache ownership is currently manual. Query keys describe
endpoints, while mutations, realtime handlers, bootstrap readers, and view
providers remember which projections to patch, invalidate, remove, refetch, or
route away from.

This allows stale state to survive whenever a new projection is added but one of
the manual fanout sites is missed. Recent examples include deleted project
route caches, sidebar bootstrap fanout, composer bootstrap seeding, thread app
storage invalidation, and turn summary loading.

The fix is not another helper list. The fix is an enforced owner boundary:
outside cache-owner modules and tests, app code cannot perform raw domain cache
writes or import app-domain query keys for mutation/realtime fanout.

## Non-Negotiable Target

Every app-domain query family has exactly one owner. The owner defines:

- query keys and prefixes it owns;
- source endpoint and data shape;
- bootstrap ingestion rules;
- optimistic mutation transactions and rollback data;
- realtime dirty/refetch/remove behavior;
- deletion/tombstone behavior;
- reconnect behavior;
- dependent projection updates.

Mutation hooks, realtime handlers, bootstrap query functions, and action
providers express typed cache events or call owner facades. They do not call
`queryClient.setQueryData`, `invalidateQueries`, `removeQueries`,
`refetchQueries`, or `cancelQueries` for app-domain data.

## Owner Map

Create `apps/app/src/hooks/cache-owners/` with these owner modules:

- `project-cache-owner.ts`: `projects`, project source/path/default/prompt
  history keys, and project rows inside sidebar bootstrap.
- `thread-list-cache-owner.ts`: `threads`, archived thread lists, pinned and
  manager order projections, thread rows inside sidebar bootstrap.
- `thread-detail-cache-owner.ts`: `thread`, `threadDetailBootstrap`, deleted
  thread tombstones.
- `timeline-cache-owner.ts`: thread timeline, turn summary detail queries,
  optimistic timeline rows.
- `composer-cache-owner.ts`: composer bootstrap, thread default execution
  options, prompt history, queued messages, pending interactions.
- `thread-storage-app-cache-owner.ts`: thread storage file/path/preview caches,
  thread apps, app detail, app markdown preview, HTML app reload tokens.
- `environment-workspace-cache-owner.ts`: environment record, work status,
  merge-base branches, git diff, diff file, environment file preview, and
  thread host file preview caches.
- `terminal-cache-owner.ts`: thread terminal list and terminal mutations.
- `host-system-cache-owner.ts`: host list/detail, system providers, system
  execution options, manager templates, config/version, provider CLI status.
- `internal-cache-owner.ts`: replay/internal tooling cache families.

Each owner exports a descriptor with stable owner id, owned query-key roots,
owned domain events, and public facade functions. Descriptors are collected in
one `cache-owner-registry.ts`.

## Event Contract

Add a typed `FrontendCacheEvent` union in the app package. Use domain change
kinds from `@bb/domain`; add runtime arrays there if the current unions do not
have runtime enumerability.

Event examples:

- `projectCreated`, `projectUpdated`, `projectDeleted`,
  `projectSourcesChanged`, `projectOrderChanged`;
- `threadCreated`, `threadDeleted`, `threadArchivedChanged`,
  `threadPinChanged`, `threadReadStateChanged`, `threadMessageAccepted`;
- `threadStorageChanged`, `threadAppsChanged`;
- `environmentMetadataChanged`, `environmentWorkspaceChanged`,
  `environmentGitRefsChanged`, `environmentDeleted`;
- `hostConnected`, `hostDisconnected`, `systemConfigChanged`,
  `serverReconnected`.

Create a dispatcher:

```ts
dispatchFrontendCacheEvent({ event, queryClient });
```

The dispatcher invokes registered owners. Event translation may know domain
change kinds, but it must not know query keys.

## Optimistic Mutation Contract

Owners expose typed optimistic transaction facades. Mutation hooks may call
these facades, but cannot read or write query data directly.

Examples:

```ts
const transaction = threadListCacheOwner.beginArchiveThread({
  queryClient,
  threadId,
});

threadListCacheOwner.rollbackArchiveThread({
  queryClient,
  transaction,
});

dispatchFrontendCacheEvent({
  queryClient,
  event: { kind: "threadArchivedChanged", threadId },
});
```

Rollback token types live in owner modules. They are not `unknown` and are not
constructed by mutation hooks.

## Bootstrap Contract

Bootstrap endpoints may remain, but query hooks cannot seed arbitrary query
families directly.

Replace direct writes in bootstrap query functions with owner ingestion calls:

- thread detail bootstrap response goes through `threadDetailCacheOwner`,
  `environmentWorkspaceCacheOwner`, `hostSystemCacheOwner`, `timelineCacheOwner`,
  and `composerCacheOwner`;
- sidebar bootstrap response goes through `projectCacheOwner` and
  `threadListCacheOwner`;
- composer bootstrap response goes through `composerCacheOwner`;
- storage/app bootstrap or preview data goes through
  `threadStorageAppCacheOwner`.

The ingestion API is explicit:

```ts
ingestThreadDetailBootstrap({ queryClient, response });
```

The ingest facade owns fanout. Query readers do not import secondary query keys.

## Route And Tombstone Contract

Add a small resource-route owner that consumes the same cache events as local
and remote deletes. Local delete and remote delete must converge:

- deleted active project routes go to root/root compose after the project owner
  has removed project/sidebar projections;
- deleted active thread routes go to root compose with the previous project
  selection preserved when available;
- missing/deleted detail bootstrap cannot resurrect removed resources from stale
  list/sidebar placeholders.

This route owner may use navigation APIs. Cache owners must not.

## Enforcement

Add CI-blocking static tests using the TypeScript compiler API, not regex.

Required tests:

- `cache-owner-query-key-coverage.test.ts`: every exported app-domain
  `*_QUERY_KEY` root in `query-keys.ts` is listed by exactly one owner.
- `cache-owner-event-coverage.test.ts`: every domain realtime change kind and
  every mutation cache event is handled by at least one owner or is explicitly
  marked `no-cache-effect` with a reason.
- `cache-owner-boundary.test.ts`: outside `cache-owners/`, query reader modules
  that only call `useQuery`, and tests, no app-domain file may call
  `queryClient.setQueryData`, `setQueriesData`, `invalidateQueries`,
  `removeQueries`, `refetchQueries`, or `cancelQueries`.
- `cache-owner-import-boundary.test.ts`: mutation hooks, realtime modules, and
  action providers may not import app-domain query key factories directly.
  They may import the cache-event dispatcher and owner facades only.
- `cache-owner-registry-shape.test.ts`: every owner descriptor declares owned
  query roots, handled events, reconnect behavior, deletion behavior, and
  bootstrap policy.

Allowlist rules must be narrow and reviewed. An allowlist entry for a production
mutation, realtime, or action-provider file blocks plan completion.

## Implementation Sequence

1. Add owner registry, event union, dispatcher, and static enforcement tests.
   Keep tests failing until all current surfaces are assigned.
2. Move shared invalidation groups from `cache-invalidation-groups.ts` into the
   appropriate owner modules. Delete group helpers that only rename key lists.
3. Move bootstrap ingestion out of query readers and into owner facades.
4. Migrate project mutations and project realtime to `projectCacheOwner`.
5. Migrate thread list/sidebar/archive/pin/read/delete mutations and realtime to
   `thread-list-cache-owner` and `thread-detail-cache-owner`.
6. Migrate timeline, turn summary detail, pending interaction, queued-message,
   prompt-history, and composer mutations to `timeline-cache-owner` and
   `composer-cache-owner`.
7. Migrate storage/app/environment/host-file-preview behavior to
   `thread-storage-app-cache-owner` and `environment-workspace-cache-owner`.
8. Migrate terminal mutations and realtime to `terminal-cache-owner`.
9. Migrate host/system/reconnect behavior to `host-system-cache-owner`.
10. Add the route/tombstone owner and make local and remote deletes use the same
    event path.
11. Remove direct domain cache writes from non-owner production files. Remove
    stale helper modules or turn them into owner-private utilities.
12. Turn static enforcement tests from migration mode to strict mode.

Do not merge the branch until the strict mode passes. Intermediate commits may
exist on the branch, but the branch is not a partial deliverable.

## Required Behavior Tests

Add or update focused tests for:

- local project delete removes `projects` and `sidebarBootstrap` before route
  navigation;
- remote project delete while viewing that project follows the same route/cache
  behavior as local delete;
- local thread delete removes thread detail, bootstrap, timeline, turn summary,
  composer, storage/app, host-file-preview, terminal, and list/sidebar caches;
- remote thread delete while viewing that thread follows the same route/cache
  behavior as local delete;
- archive/unarchive, pin/unpin, reorder, mark read/unread, manager assignment,
  pending interaction, and queued-message mutations update exactly through
  owner transactions;
- thread detail bootstrap ingestion seeds only through owner facades;
- sidebar bootstrap ingestion seeds only through owner facades;
- composer bootstrap initial data is owned by `composer-cache-owner`;
- thread storage changes invalidate storage/app/detail/markdown/HTML reload
  projections;
- environment workspace changes invalidate work status, git diff, diff files,
  file previews, and thread host-file previews for that environment;
- host reconnect and server reconnect use owner-declared reconnect policy;
- terminal create/rename/close updates terminal caches only through
  `terminal-cache-owner`.

## Exit Criteria

The issue is fixed only when all of these are true:

- production raw app-domain cache writes are limited to owner modules and owner
  private utilities;
- mutation hooks, realtime modules, query readers, and action providers pass the
  import boundary tests;
- every query-key root has exactly one owner;
- every realtime change kind and mutation cache event has owner coverage;
- local and remote deletes share the same cache/route behavior;
- bootstrap ingestion is owner-mediated;
- reconnect invalidation is owner-declared;
- `cache-invalidation-groups.ts` is deleted or reduced to owner-private
  mechanical utilities with no app-domain policy;
- no broad allowlist remains for production app files.

## Validation

Run:

```sh
pnpm exec turbo run typecheck --filter=@bb/app
pnpm exec turbo run test --filter=@bb/app
```

If app tests are slow, run them through a file:

```sh
pnpm exec turbo run test --filter=@bb/app --force > /tmp/bb-app-cache-owner-tests.txt 2>&1
```

Then inspect `/tmp/bb-app-cache-owner-tests.txt`.

## Explicit Non-Goals

- Do not normalize the entire client read model unless owner enforcement proves
  impossible without it.
- Do not add server notification metadata just to avoid frontend ownership.
- Do not accept a branch that only moves key arrays into larger helper files.
- Do not close this issue while production mutations or realtime handlers still
  perform raw app-domain cache writes.
