import type { QueryClient } from "@tanstack/react-query";
import type { ThreadComposerBootstrapResponse } from "@bb/server-contract";
import * as api from "@/lib/api";
import {
  THREAD_COMPOSER_BOOTSTRAP_QUERY_KEY,
  THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY,
  THREAD_PENDING_INTERACTIONS_QUERY_KEY,
  THREAD_PROMPT_HISTORY_QUERY_KEY,
  THREAD_QUEUED_MESSAGES_QUERY_KEY,
  systemExecutionOptionsQueryKey,
  threadDefaultExecutionOptionsQueryKey,
  threadPendingInteractionsQueryKey,
  threadPromptHistoryQueryKey,
  threadQueuedMessagesQueryKey,
} from "../queries/query-keys";
import type { CacheOwnerDescriptor } from "./cache-owner-types";

interface ThreadComposerBootstrapHydrationArgs {
  bootstrap: ThreadComposerBootstrapResponse;
  environmentId: string | null;
  providerId: string | null;
  queryClient: QueryClient;
  threadId: string;
}

interface FetchAndHydrateThreadComposerBootstrapArgs {
  environmentId: string | null;
  providerId: string | null;
  queryClient: QueryClient;
  threadId: string;
}

export const composerCacheOwner = {
  id: "composer",
  ownedQueryRoots: [
    THREAD_COMPOSER_BOOTSTRAP_QUERY_KEY,
    THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY,
    THREAD_QUEUED_MESSAGES_QUERY_KEY,
    THREAD_PROMPT_HISTORY_QUERY_KEY,
    THREAD_PENDING_INTERACTIONS_QUERY_KEY,
  ],
  handledRealtimeEvents: [
    { entity: "thread", kind: "events-appended" },
    { entity: "thread", kind: "interactions-changed" },
    { entity: "thread", kind: "queue-changed" },
  ],
} satisfies CacheOwnerDescriptor;

export function hydrateThreadComposerBootstrap({
  bootstrap,
  environmentId,
  providerId,
  queryClient,
  threadId,
}: ThreadComposerBootstrapHydrationArgs): void {
  queryClient.setQueryData(
    threadDefaultExecutionOptionsQueryKey(threadId),
    bootstrap.defaultExecutionOptions,
  );
  queryClient.setQueryData(
    threadQueuedMessagesQueryKey(threadId),
    bootstrap.queuedMessages,
  );
  queryClient.setQueryData(
    threadPromptHistoryQueryKey(threadId),
    bootstrap.promptHistory,
  );
  queryClient.setQueryData(
    threadPendingInteractionsQueryKey(threadId),
    bootstrap.pendingInteractions,
  );
  queryClient.setQueryData(
    systemExecutionOptionsQueryKey({ environmentId, providerId }),
    bootstrap.executionOptions,
  );
}

export async function fetchAndHydrateThreadComposerBootstrap({
  environmentId,
  providerId,
  queryClient,
  threadId,
}: FetchAndHydrateThreadComposerBootstrapArgs): Promise<ThreadComposerBootstrapResponse> {
  const bootstrap = await api.getThreadComposerBootstrap(threadId);
  hydrateThreadComposerBootstrap({
    bootstrap,
    environmentId,
    providerId,
    queryClient,
    threadId,
  });
  return bootstrap;
}
