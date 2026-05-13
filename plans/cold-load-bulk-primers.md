# Cold-load bulk primers via `?include=` query params

## Goal

Eliminate two cold-load waterfalls without changing the per-entity realtime invalidation model:

1. **Sidebar fan-out.** `ProjectList` fires `GET /api/v1/threads?projectId=X` per project — N requests, scales linearly with project count. Replace with one bundled request that primes each project's per-project thread cache.
2. **Thread page env/host fetches.** `ThreadDetailView` fires `GET /api/v1/threads/X`, then separately `GET /api/v1/environments/Z`, then `GET /api/v1/hosts/H`. Replace with a thread response that includes environment and host snapshots and primes those caches.

Both tracks use the same shape: a bulk endpoint hydrates *individual* per-resource cache keys; existing per-resource hooks remain the steady-state cache reader and the WS-invalidation target. The bundle endpoint plays no role after the initial load.

## Non-goals

- System-wide bootstrap bundle (`GET /api/v1/system/bootstrap`) — separate plan.
- Gate-on-reconnected WS-cascade fix — separate, smaller PR.
- Event replay by cursor — separate plan.
- Removing promote/demote — in progress by someone else; this plan must not depend on its outcome.

## The convention

`?include=` query param, comma-separated, validated against a per-resource allowlist.

- Response shape is unchanged when `include` is absent.
- When present, the response includes the requested fields. For collection endpoints, embedded under each item; for single-resource endpoints, as top-level keys.
- An included field is either the related resource's data or `null` when the relation doesn't exist (e.g., thread with no environment).

Two concrete uses:

```
GET /api/v1/projects?include=threads
→ { projects: [{ ...project, threads: ThreadListEntry[] }] }

GET /api/v1/threads/:id?include=environment,host
→ { ...thread, environment: EnvironmentResponse | null, host: HostResponse | null }
```

### Why this shape

- **Not a new UI-coupled endpoint** (`/api/v1/sidebar`, `/api/v1/threads/:id/full`): proliferates routes and ages badly when the UI shape changes.
- **Not a single cache key for the bundle**: forces a full re-fetch on any per-entity invalidation. Steady-state cost becomes worse than today's fan-out.
- **Not embedding by default**: makes the no-include callers pay a payload tax for data they don't need.

## Track 1 — projects + threads

### Server

- Extend `GET /api/v1/projects` in `apps/server/src/routes/projects.ts` to accept `include` query param.
  - Parse `include?: string`, split on `,`, validate against `{ "threads" }`.
  - When `threads` is requested, fetch all projects' unarchived threads in a single batched query (`WHERE projectId IN (...) AND archived = 0 ORDER BY <existing sidebar order>`), group by `projectId` in memory.
  - Embed each project's threads under `threads`.
- Same URL — no new route.

### Contract

- `packages/server-contract/src/api-types.ts`:
  - `projectIncludeOptionSchema = z.enum(["threads"])`
  - `projectsResponseSchema` extends each project entry with optional `threads: ThreadListEntry[]`.
- `packages/server-contract/src/public-api.ts`: extend route signature with `include` query param.

### App

- New hook `useSidebarBootstrap()` in `apps/app/src/hooks/queries/project-queries.ts`:
  - Calls `api.getProjects({ include: ["threads"] })`.
  - On success, primes individual caches:
    ```ts
    queryClient.setQueryData(projectsQueryKey(), data.projects.map(stripThreads));
    for (const project of data.projects) {
      queryClient.setQueryData(
        threadListQueryKey({ projectId: project.id, archived: false }),
        project.threads,
      );
    }
    ```
  - `staleTime: Infinity`. The bundle is a one-shot primer; downstream invalidation runs through the per-resource keys via existing per-resource endpoints.
- `apps/app/src/components/sidebar/ProjectList.tsx`:
  - Call `useSidebarBootstrap()` at the top.
  - Leave the existing `useQueries({ queries: projectIds.map(id => threadListQueryKey({...})) })` in place — it finds primed cache entries on cold load and doesn't fan out.
  - `useProjects()` also becomes a cache hit because the bootstrap primes `projectsQueryKey()`.

### Tests

- Server contract test: `GET /api/v1/projects?include=threads` returns each project with `threads`; `GET /api/v1/projects` returns the lean shape unchanged.
- Server integration test: response ordering matches the sidebar order.
- App hook test (real `QueryClient`, mocked `fetch`): after `useSidebarBootstrap()` resolves, calling `useThreads({ projectId, archived: false })` returns cached data without firing a network request.

## Track 2 — threads + environment + host

### Server

- Extend `GET /api/v1/threads/:id` in `apps/server/src/routes/threads.ts` to accept `include` query param.
  - Parse and validate against `{ "environment", "host" }`.
  - When `environment` is requested and thread has `environmentId`, fetch and embed.
  - When `host` is requested, fetch the host for the included environment (or `null`).
- One DB query per included resource, all in the same response.

### Contract

- `packages/server-contract/src/api-types.ts`:
  - `threadIncludeOptionSchema = z.enum(["environment", "host"])`
  - `threadResponseSchema` extends with optional `environment: EnvironmentResponse | null` and `host: HostResponse | null`.
- `packages/server-contract/src/public-api.ts`: extend route signature.

### App

- Extend `useThread(id, options?)` in `apps/app/src/hooks/queries/thread-queries.ts`:
  ```ts
  useThread(id, { include: ["environment", "host"] })
  ```
- `queryKey` does NOT incorporate `include` — the existing key stays canonical. The include is a hydration mechanism, not a cache-key dimension.
- On query success, prime sibling caches:
  ```ts
  if (data.environment) {
    queryClient.setQueryData(environmentQueryKey(data.environment.id), data.environment);
  }
  if (data.host) {
    queryClient.setQueryData(hostQueryKey(data.host.id), data.host);
  }
  ```
- `apps/app/src/views/thread-detail/ThreadDetailView.tsx`: pass `{ include: ["environment", "host"] }`.
- Other `useThread(id)` callers (without includes) stay as-is and continue to get the lean payload.

### Tests

- Server contract test: `GET /api/v1/threads/:id?include=environment,host` embeds both; no-include case is unchanged.
- Server contract test: `host: null` when environment has no resolvable host; `environment: null` when thread has no `environmentId`.
- App hook test: after `useThread(id, { include: [...] })` resolves, `useEnvironment(envId)` and `useHost(hostId)` return cached data without a network request.

## Exit criteria

- Cold-load HAR for project page (≥ 3 projects with threads) shows:
  - One `GET /api/v1/projects?include=threads`
  - Zero `GET /api/v1/threads?projectId=X` during initial load
- Cold-load HAR for thread page shows:
  - One `GET /api/v1/threads/:id?include=environment,host`
  - Zero separate `GET /api/v1/environments/:id` and `GET /api/v1/hosts/:id` during initial load
- WS-driven invalidation behavior unchanged in steady state:
  - `thread:status-changed` for project P → refetches `/api/v1/threads?projectId=P` only
  - `environment:changed` for env Z → refetches `/api/v1/environments/Z` only
  - `host:changed` for host H → refetches `/api/v1/hosts/H` only
- `pnpm exec turbo run typecheck --filter=@bb/server --filter=@bb/server-contract --filter=@bb/app` passes.
- `pnpm exec turbo run test --filter=@bb/server --filter=@bb/server-contract --filter=@bb/app` passes.

## Validation

1. Start the dev server.
2. Open Chrome DevTools → Network tab.
3. Hard-reload `/projects/<projectId>` with the sidebar showing ≥ 3 projects. Export HAR. Confirm exit-criteria shape.
4. Hard-reload `/threads/<threadId>`. Export HAR. Confirm exit-criteria shape.
5. With the thread page open, run `pnpm bb thread update <threadId> --title 'test'` (or any mutation that fires a `thread:*` WS event). Confirm only the targeted thread's queries refetch — not the bundle.
6. With the project page open and the sidebar showing multiple projects, trigger a thread creation in one project (e.g., via CLI). Confirm only that project's threads refetch.

## Open questions

1. **Pagination on bundled threads.** `useThreads({ projectId, archived: false })` returns a flat array today. If a project has hundreds of unarchived threads the bundle inflates. Defer pagination until it bites; if needed later, add a `limit` knob to the include.
2. **Ordering.** Server must return threads in the order the sidebar currently uses, so cache-primed data renders identically to today's per-project fetch. Pin this in a test.
3. **Environments without hosts.** Sandbox environments may not have a resolvable host. Schema must allow `host: null` and the client must handle it (it already does for the standalone `useHost` query).
4. **Archived counts.** Today's sidebar shows only unarchived. If a future indicator needs "(N archived)" per project, extend the bundle. Out of scope here.

## Rollout

Two independently shippable PRs, one per track. No ordering dependency between them — they touch different routes, contracts, hooks, and components. Recommend Track 1 first (savings scale with project count) and Track 2 second (fixed savings, but unblocks the thread page perf story).

## Cleanup

Delete this plan file once both tracks have landed and HAR validation has been confirmed.
