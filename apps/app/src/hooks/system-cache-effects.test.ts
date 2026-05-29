import { describe, expect, it } from "vitest";
import { createAppQueryClient } from "@/lib/query-client";
import {
  allSystemExecutionOptionsQueryKeyPrefix,
  allThreadComposerBootstrapQueryKeyPrefix,
  sidebarBootstrapQueryKey,
  systemExecutionOptionsQueryKey,
  threadComposerBootstrapQueryKey,
} from "./queries/query-keys";
import {
  invalidateHostChangeDependentQueries,
  invalidateRealtimeQueriesAfterServerReconnect,
} from "./system-cache-effects";

function createCacheEffectQueryClient() {
  return createAppQueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        retry: false,
      },
    },
    showMutationErrorToasts: false,
  });
}

interface ScopedSystemExecutionOptionsKeyArgs {
  environmentId: string;
}

function scopedSystemExecutionOptionsKey({
  environmentId,
}: ScopedSystemExecutionOptionsKeyArgs) {
  return systemExecutionOptionsQueryKey({
    environmentId,
    providerId: "codex",
  });
}

const EMPTY_EXECUTION_OPTIONS = {
  providers: [],
  models: [],
  selectedOnlyModels: [],
  modelLoadError: null,
};

describe("system cache effects", () => {
  it("invalidates env-scoped execution options and composer bootstrap caches after reconnect", () => {
    const queryClient = createCacheEffectQueryClient();
    const executionOptionsKey = scopedSystemExecutionOptionsKey({
      environmentId: "env-1",
    });
    const composerBootstrapKey = threadComposerBootstrapQueryKey(
      "thread-1",
      "env-1",
    );
    const sidebarBootstrapKey = sidebarBootstrapQueryKey();
    queryClient.setQueryData(executionOptionsKey, EMPTY_EXECUTION_OPTIONS);
    queryClient.setQueryData(composerBootstrapKey, {
      defaultExecutionOptions: null,
      queuedMessages: [],
      executionOptions: EMPTY_EXECUTION_OPTIONS,
      pendingInteractions: [],
      promptHistory: [],
    });
    queryClient.setQueryData(sidebarBootstrapKey, {
      projects: [],
      personalProject: { threads: [] },
    });

    invalidateRealtimeQueriesAfterServerReconnect({ queryClient });

    expect(queryClient.getQueryState(executionOptionsKey)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(composerBootstrapKey)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(sidebarBootstrapKey)?.isInvalidated).toBe(
      true,
    );
  });

  it("invalidates all execution options and composer bootstrap caches after host changes", () => {
    const queryClient = createCacheEffectQueryClient();
    const executionOptionsKey = scopedSystemExecutionOptionsKey({
      environmentId: "env-1",
    });
    const composerBootstrapKey = threadComposerBootstrapQueryKey(
      "thread-1",
      "env-1",
    );
    const sidebarBootstrapKey = sidebarBootstrapQueryKey();
    queryClient.setQueryData(executionOptionsKey, EMPTY_EXECUTION_OPTIONS);
    queryClient.setQueryData(composerBootstrapKey, {
      defaultExecutionOptions: null,
      queuedMessages: [],
      executionOptions: EMPTY_EXECUTION_OPTIONS,
      pendingInteractions: [],
      promptHistory: [],
    });
    queryClient.setQueryData(sidebarBootstrapKey, {
      projects: [],
      personalProject: { threads: [] },
    });

    invalidateHostChangeDependentQueries({ queryClient });

    expect(
      queryClient.getQueryState(allSystemExecutionOptionsQueryKeyPrefix())
        ?.isInvalidated,
    ).toBeUndefined();
    expect(queryClient.getQueryState(executionOptionsKey)?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(allThreadComposerBootstrapQueryKeyPrefix())
        ?.isInvalidated,
    ).toBeUndefined();
    expect(queryClient.getQueryState(composerBootstrapKey)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(sidebarBootstrapKey)?.isInvalidated).toBe(
      true,
    );
  });
});
