import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { assertNever } from "@bb/core-ui";
import {
  createDebouncedCallbackScheduler,
  type EnvironmentChangeKind,
  type Thread,
  type ThreadChangeKind,
} from "@bb/domain";
import { createBufferedEnvironmentInvalidator } from "./buffered-environment-invalidator";
import { wsManager } from "../lib/ws";
import {
  getCachedEnvironmentRefWorkspaceStateInvalidationQueryKeys,
  getEnvironmentBranchListInvalidationQueryKeys,
  getEnvironmentRecordInvalidationQueryKeys,
  getEnvironmentWorkspaceStateInvalidationQueryKeys,
  updateCachedThreadListPendingInteractionState,
} from "./queries/query-cache";
import {
  allAvailableModelsQueryKeyPrefix,
  allHostQueryKeyPrefix,
  allThreadDraftsQueryKeyPrefix,
  allThreadPendingInteractionsQueryKeyPrefix,
  allThreadQueryKeyPrefix,
  allThreadTimelineQueryKeyPrefix,
  hostsQueryKey,
  projectsQueryKey,
  statusQueryKey,
  systemProvidersQueryKey,
  threadStorageFilesQueryKey,
  threadStorageFilePreviewQueryKeyPrefix,
  threadDraftsQueryKey,
  threadPendingInteractionsQueryKey,
  threadQueryKey,
  threadTimelineQueryKeyPrefix,
  threadsQueryKey,
} from "./queries/query-keys";
import * as api from "../lib/api";

// Keep this paired with daemon-side event batching so a single provider burst
// still maps to a single app invalidation window.
const INVALIDATION_DEBOUNCE_MS = 50;
const INVALIDATION_MAX_WAIT_MS = 200;
const ENVIRONMENT_INVALIDATION_DEBOUNCE_MS = 250;
const ENVIRONMENT_INVALIDATION_MAX_WAIT_MS = 500;
const PERSISTED_ENVIRONMENT_CHANGE_KINDS: readonly EnvironmentChangeKind[] = [
  "environment-created",
  "environment-deleted",
  "metadata-changed",
  "status-changed",
];
const WORKSPACE_STATE_CHANGE_KINDS: readonly EnvironmentChangeKind[] = [
  "environment-created",
  "environment-deleted",
  "metadata-changed",
  "status-changed",
  "work-status-changed",
];
const REF_DERIVED_WORKSPACE_STATE_CHANGE_KINDS: readonly EnvironmentChangeKind[] =
  ["git-refs-changed"];
const BRANCH_LIST_CHANGE_KINDS: readonly EnvironmentChangeKind[] = [
  "environment-created",
  "environment-deleted",
  "metadata-changed",
  "status-changed",
  "git-refs-changed",
];

interface ThreadChangeFlags {
  interactionsChanged: boolean;
  listChanged: boolean;
  queueChanged: boolean;
  threadChanged: boolean;
  timelineChanged: boolean;
  statusChanged: boolean;
}

function toThreadChangeFlags(
  changes: readonly ThreadChangeKind[],
): ThreadChangeFlags {
  const flags: ThreadChangeFlags = {
    interactionsChanged: false,
    listChanged: false,
    queueChanged: false,
    threadChanged: false,
    timelineChanged: false,
    statusChanged: false,
  };

  for (const change of changes) {
    switch (change) {
      case "thread-created":
      case "thread-deleted":
      case "archived-changed":
      case "read-state-changed":
      case "title-changed":
        flags.listChanged = true;
        flags.threadChanged = true;
        if (change === "thread-created" || change === "thread-deleted") {
          flags.timelineChanged = true;
        }
        break;
      case "queue-changed":
        flags.queueChanged = true;
        flags.threadChanged = true;
        break;
      case "interactions-changed":
        flags.interactionsChanged = true;
        flags.threadChanged = true;
        flags.timelineChanged = true;
        break;
      case "status-changed":
        flags.listChanged = true;
        flags.threadChanged = true;
        flags.timelineChanged = true;
        flags.statusChanged = true;
        break;
      case "events-appended":
        // Provider events (for example compaction) can update thread metadata
        // without emitting a dedicated thread change kind. Keep thread detail
        // metadata fresh when new events arrive.
        flags.threadChanged = true;
        flags.timelineChanged = true;
        break;
      default:
        assertNever(change);
    }
  }

  return flags;
}

export function shouldFlushThreadChangesImmediately(
  changes: readonly ThreadChangeKind[],
): boolean {
  return toThreadChangeFlags(changes).statusChanged;
}

function collectCachedThreadIdsForEnvironment(
  queryClient: QueryClient,
  environmentId: string,
): string[] {
  const threadIds = new Set<string>();
  for (const [, thread] of queryClient.getQueriesData<Thread>({
    queryKey: allThreadQueryKeyPrefix(),
  })) {
    if (thread?.environmentId === environmentId) {
      threadIds.add(thread.id);
    }
  }
  for (const [, threads] of queryClient.getQueriesData<Thread[]>({
    queryKey: threadsQueryKey(),
  })) {
    for (const thread of threads ?? []) {
      if (thread.environmentId === environmentId) {
        threadIds.add(thread.id);
      }
    }
  }
  return Array.from(threadIds);
}

function environmentChangeKindsIncludeThreadStorage(
  changeKinds: readonly EnvironmentChangeKind[],
): boolean {
  return changeKinds.includes("thread-storage-changed");
}

function environmentChangeKindsIncludePersistedEnvironment(
  changeKinds: readonly EnvironmentChangeKind[],
): boolean {
  return changeKinds.some((changeKind) =>
    PERSISTED_ENVIRONMENT_CHANGE_KINDS.includes(changeKind),
  );
}

function environmentChangeKindsIncludeWorkspaceState(
  changeKinds: readonly EnvironmentChangeKind[],
): boolean {
  return changeKinds.some((changeKind) =>
    WORKSPACE_STATE_CHANGE_KINDS.includes(changeKind),
  );
}

function environmentChangeKindsIncludeRefDerivedWorkspaceState(
  changeKinds: readonly EnvironmentChangeKind[],
): boolean {
  return changeKinds.some((changeKind) =>
    REF_DERIVED_WORKSPACE_STATE_CHANGE_KINDS.includes(changeKind),
  );
}

function environmentChangeKindsIncludeBranchList(
  changeKinds: readonly EnvironmentChangeKind[],
): boolean {
  return changeKinds.some((changeKind) =>
    BRANCH_LIST_CHANGE_KINDS.includes(changeKind),
  );
}

export function useWebSocket(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribeConnected = wsManager.onConnected(({ reconnected }) => {
      if (reconnected) {
        queryClient.invalidateQueries();
      } else {
        // On initial connect, refetch host-related queries that may have
        // resolved before the daemon connected to the server.
        queryClient.invalidateQueries({ queryKey: hostsQueryKey() });
        queryClient.invalidateQueries({ queryKey: allHostQueryKeyPrefix() });
      }
    });

    const changedThreadKinds = new Map<string, Set<ThreadChangeKind>>();
    const globalChangeKinds = new Set<ThreadChangeKind>();
    const environmentInvalidator = createBufferedEnvironmentInvalidator({
      debounceMs: ENVIRONMENT_INVALIDATION_DEBOUNCE_MS,
      flushChangedEnvironmentIds: (changedEnvironments) => {
        for (const { changeKinds, environmentId } of changedEnvironments) {
          const includeWorkspaceState =
            environmentChangeKindsIncludeWorkspaceState(changeKinds);

          if (environmentChangeKindsIncludePersistedEnvironment(changeKinds)) {
            for (const queryKey of getEnvironmentRecordInvalidationQueryKeys({
              environmentId,
            })) {
              queryClient.invalidateQueries({ queryKey });
            }
          }
          if (includeWorkspaceState) {
            for (const queryKey of getEnvironmentWorkspaceStateInvalidationQueryKeys(
              {
                environmentId,
              },
            )) {
              queryClient.invalidateQueries({ queryKey });
            }
          }
          if (
            !includeWorkspaceState &&
            environmentChangeKindsIncludeRefDerivedWorkspaceState(changeKinds)
          ) {
            for (const queryKey of getCachedEnvironmentRefWorkspaceStateInvalidationQueryKeys(
              queryClient,
              { environmentId },
            )) {
              queryClient.invalidateQueries({ exact: true, queryKey });
            }
          }
          if (environmentChangeKindsIncludeBranchList(changeKinds)) {
            for (const queryKey of getEnvironmentBranchListInvalidationQueryKeys(
              {
                environmentId,
              },
            )) {
              queryClient.invalidateQueries({ queryKey });
            }
          }
          if (!environmentChangeKindsIncludeThreadStorage(changeKinds)) {
            continue;
          }
          for (const threadId of collectCachedThreadIdsForEnvironment(
            queryClient,
            environmentId,
          )) {
            queryClient.invalidateQueries({
              queryKey: threadStorageFilesQueryKey(threadId),
            });
            queryClient.invalidateQueries({
              queryKey: threadStorageFilePreviewQueryKeyPrefix(threadId),
            });
          }
        }
      },
      maxWaitMs: ENVIRONMENT_INVALIDATION_MAX_WAIT_MS,
    });
    let shouldInvalidateThreads = false;
    let shouldInvalidateStatus = false;
    let shouldInvalidateAllThreadDrafts = false;
    let shouldInvalidateAllThreadPendingInteractions = false;
    let shouldInvalidateAllThreadTimeline = false;
    let shouldInvalidateAllThreadsById = false;

    const mergeThreadChanges = (
      threadId: string,
      changes: readonly ThreadChangeKind[],
    ) => {
      let entry = changedThreadKinds.get(threadId);
      if (!entry) {
        entry = new Set<ThreadChangeKind>();
        changedThreadKinds.set(threadId, entry);
      }
      for (const change of changes) {
        entry.add(change);
      }
    };

    const flushInvalidations = () => {
      if (shouldInvalidateThreads) {
        queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
      }

      if (shouldInvalidateAllThreadsById) {
        queryClient.invalidateQueries({ queryKey: allThreadQueryKeyPrefix() });
      }
      if (shouldInvalidateAllThreadDrafts) {
        queryClient.invalidateQueries({
          queryKey: allThreadDraftsQueryKeyPrefix(),
        });
      }
      if (shouldInvalidateAllThreadPendingInteractions) {
        queryClient.invalidateQueries({
          queryKey: allThreadPendingInteractionsQueryKeyPrefix(),
        });
      }
      if (shouldInvalidateAllThreadTimeline) {
        queryClient.invalidateQueries({
          queryKey: allThreadTimelineQueryKeyPrefix(),
        });
      }

      const changedIds = Array.from(changedThreadKinds.keys());
      for (const id of changedIds) {
        const changeKinds = changedThreadKinds.get(id);
        if (!changeKinds) continue;
        const flags = toThreadChangeFlags(Array.from(changeKinds));

        if (flags.threadChanged) {
          queryClient.invalidateQueries({ queryKey: threadQueryKey(id) });
        }
        if (flags.queueChanged) {
          queryClient.invalidateQueries({ queryKey: threadDraftsQueryKey(id) });
        }
        if (flags.interactionsChanged) {
          queryClient.invalidateQueries({
            queryKey: threadPendingInteractionsQueryKey(id),
          });
          void queryClient
            .fetchQuery({
              queryKey: threadPendingInteractionsQueryKey(id),
              queryFn: ({ signal }) =>
                api.listThreadPendingInteractions(id, signal),
            })
            .then((interactions) => {
              updateCachedThreadListPendingInteractionState(
                queryClient,
                id,
                interactions.length > 0,
              );
            })
            .catch(() => {
              queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
            });
        }
        if (flags.timelineChanged) {
          queryClient.invalidateQueries({
            queryKey: threadTimelineQueryKeyPrefix(id),
          });
        }
      }

      if (shouldInvalidateStatus) {
        queryClient.invalidateQueries({ queryKey: statusQueryKey() });
      }

      changedThreadKinds.clear();
      globalChangeKinds.clear();
      shouldInvalidateThreads = false;
      shouldInvalidateStatus = false;
      shouldInvalidateAllThreadDrafts = false;
      shouldInvalidateAllThreadPendingInteractions = false;
      shouldInvalidateAllThreadTimeline = false;
      shouldInvalidateAllThreadsById = false;
    };

    const invalidationScheduler = createDebouncedCallbackScheduler({
      debounceMs: INVALIDATION_DEBOUNCE_MS,
      maxWaitMs: INVALIDATION_MAX_WAIT_MS,
      onFlush: flushInvalidations,
    });

    const scheduleInvalidations = () => {
      invalidationScheduler.schedule();
    };

    // Connect to WebSocket
    wsManager.connect();

    wsManager.subscribe("thread");
    wsManager.subscribe("project");
    wsManager.subscribe("environment");
    wsManager.subscribe("host");
    wsManager.subscribe("system");

    // Invalidate React Query caches on changes
    const unsubscribe = wsManager.onChanged((message) => {
      switch (message.entity) {
        case "thread":
          if (message.id) {
            mergeThreadChanges(message.id, message.changes);
            const flags = toThreadChangeFlags(message.changes);
            if (flags.listChanged) {
              shouldInvalidateThreads = true;
              shouldInvalidateStatus = true;
            }
          } else {
            for (const change of message.changes) {
              globalChangeKinds.add(change);
            }
            const globalFlags = toThreadChangeFlags(
              Array.from(globalChangeKinds),
            );
            if (globalFlags.listChanged) {
              shouldInvalidateThreads = true;
              shouldInvalidateStatus = true;
            }
            shouldInvalidateAllThreadsById = globalFlags.threadChanged;
            shouldInvalidateAllThreadDrafts = globalFlags.queueChanged;
            shouldInvalidateAllThreadPendingInteractions =
              globalFlags.interactionsChanged;
            shouldInvalidateAllThreadTimeline = globalFlags.timelineChanged;
          }
          if (shouldFlushThreadChangesImmediately(message.changes)) {
            invalidationScheduler.flush();
          } else {
            scheduleInvalidations();
          }
          break;
        case "environment":
          if (message.id) {
            environmentInvalidator.markChanged(message.id, message.changes);
          }
          break;
        case "host":
          queryClient.invalidateQueries({ queryKey: hostsQueryKey() });
          queryClient.invalidateQueries({ queryKey: allHostQueryKeyPrefix() });
          queryClient.invalidateQueries({ queryKey: projectsQueryKey() });
          queryClient.invalidateQueries({
            queryKey: systemProvidersQueryKey(),
          });
          queryClient.invalidateQueries({
            queryKey: allAvailableModelsQueryKeyPrefix(),
          });
          break;
        case "project":
          queryClient.invalidateQueries({ queryKey: projectsQueryKey() });
          break;
        case "system":
          break;
        default:
          assertNever(message);
      }
    });

    return () => {
      invalidationScheduler.dispose();
      environmentInvalidator.dispose();
      unsubscribeConnected();
      unsubscribe();
      wsManager.unsubscribe("thread");
      wsManager.unsubscribe("project");
      wsManager.unsubscribe("environment");
      wsManager.unsubscribe("host");
      wsManager.unsubscribe("system");
    };
  }, [queryClient]);
}
