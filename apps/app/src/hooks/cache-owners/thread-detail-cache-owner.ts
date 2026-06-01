import type { QueryClient } from "@tanstack/react-query";
import type { Host } from "@bb/domain";
import type {
  ManagerTimelineView,
  ThreadResponse,
  ThreadWithIncludesResponse,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import {
  environmentQueryKey,
  hostQueryKey,
  hostsQueryKey,
  THREAD_DETAIL_BOOTSTRAP_QUERY_KEY,
  THREAD_QUERY_KEY,
  threadComposerBootstrapQueryKey,
  threadQueryKey,
  threadTimelineQueryKey,
} from "../queries/query-keys";
import type { CacheOwnerDescriptor } from "./cache-owner-types";

type HostList = Host[];
type HostListQueryData = HostList | undefined;

interface ThreadTimelinePrefetchPolicy {
  managerTimelineView: ManagerTimelineView | undefined;
}

interface UpsertHostListArgs {
  host: Host;
  hosts: HostListQueryData;
}

export interface ThreadDetailBootstrapIngestionArgs {
  composerBootstrapPrefetch: boolean;
  queryClient: QueryClient;
  thread: ThreadWithIncludesResponse;
  timelinePrefetch: ThreadTimelinePrefetchPolicy | undefined;
}

export const threadDetailCacheOwner = {
  id: "thread-detail",
  ownedQueryRoots: [THREAD_QUERY_KEY, THREAD_DETAIL_BOOTSTRAP_QUERY_KEY],
  handledRealtimeEvents: [
    { entity: "thread", kind: "thread-created" },
    { entity: "thread", kind: "thread-deleted" },
    { entity: "thread", kind: "status-changed" },
    { entity: "thread", kind: "title-changed" },
    { entity: "thread", kind: "archived-changed" },
    { entity: "thread", kind: "pin-state-changed" },
    { entity: "thread", kind: "parent-changed" },
    { entity: "thread", kind: "read-state-changed" },
    { entity: "thread", kind: "manager-assignment-changed" },
  ],
  bootstrapPolicy:
    "Owns thread detail bootstrap ingestion and placeholder-to-detail reconciliation.",
  deletionBehavior:
    "Removes deleted thread detail/bootstrap projections and exposes tombstone state to route reconciliation.",
  reconnectBehavior:
    "Refreshes mounted thread detail and bootstrap projections after reconnect.",
} satisfies CacheOwnerDescriptor;

function stripThreadIncludes(
  thread: ThreadWithIncludesResponse,
): ThreadResponse {
  const { environment, host, ...threadResponse } = thread;
  return threadResponse;
}

function upsertHostList({ host, hosts }: UpsertHostListArgs): HostList {
  if (!hosts) {
    return [host];
  }

  let found = false;
  const nextHosts = hosts.map((candidate) => {
    if (candidate.id !== host.id) {
      return candidate;
    }
    found = true;
    return host;
  });

  return found ? nextHosts : [...hosts, host];
}

export function ingestThreadDetailBootstrap({
  composerBootstrapPrefetch,
  queryClient,
  thread,
  timelinePrefetch,
}: ThreadDetailBootstrapIngestionArgs): void {
  queryClient.setQueryData(
    threadQueryKey(thread.id),
    stripThreadIncludes(thread),
  );

  if (thread.environment) {
    queryClient.setQueryData(
      environmentQueryKey(thread.environment.id),
      thread.environment,
    );
  }

  if (thread.host) {
    const host = thread.host;
    queryClient.setQueryData(hostQueryKey(host.id), host);
    queryClient.setQueryData<HostList>(hostsQueryKey(), (hosts) =>
      upsertHostList({ host, hosts }),
    );
  }

  if (timelinePrefetch) {
    const managerTimelineView =
      thread.type === "manager"
        ? timelinePrefetch.managerTimelineView
        : undefined;
    void queryClient.prefetchQuery({
      queryKey: threadTimelineQueryKey(thread.id, managerTimelineView),
      queryFn: () =>
        api.getThreadTimeline({
          id: thread.id,
          managerTimelineView,
        }),
    });
  }

  if (composerBootstrapPrefetch) {
    const environmentId = thread.environmentId ?? null;
    void queryClient.prefetchQuery({
      queryKey: threadComposerBootstrapQueryKey(thread.id, environmentId),
      queryFn: () => api.getThreadComposerBootstrap(thread.id),
    });
  }
}
