import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryObserver } from "@tanstack/react-query";
import { createAppQueryClient } from "@/lib/query-client";
import {
  projectPromptHistoryQueryKey,
  statusQueryKey,
  threadListQueryKey,
  threadQueryKey,
} from "./queries/query-keys";
import { createRealtimeCacheEffects } from "./realtime-cache-effects";

const PROJECT_PROMPT_HISTORY_THREAD_CHANGES = [
  "thread-created",
  "thread-deleted",
  "archived-changed",
] as const;
const NON_PROJECT_PROMPT_HISTORY_THREAD_CHANGES = [
  "read-state-changed",
  "title-changed",
] as const;

function createRealtimeEffectsTestContext() {
  const queryClient = createAppQueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        retry: false,
      },
    },
    showMutationErrorToasts: false,
  });
  const effects = createRealtimeCacheEffects({ queryClient });
  const firstProjectHistoryKey = projectPromptHistoryQueryKey("project-1");
  const secondProjectHistoryKey = projectPromptHistoryQueryKey("project-2");

  queryClient.setQueryData(firstProjectHistoryKey, []);
  queryClient.setQueryData(secondProjectHistoryKey, []);

  return {
    effects,
    firstProjectHistoryKey,
    queryClient,
    secondProjectHistoryKey,
  };
}

describe("createRealtimeCacheEffects", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(PROJECT_PROMPT_HISTORY_THREAD_CHANGES)(
    "invalidates all cached project prompt histories for %s thread events",
    (change) => {
      vi.useFakeTimers();
      const {
        effects,
        firstProjectHistoryKey,
        queryClient,
        secondProjectHistoryKey,
      } = createRealtimeEffectsTestContext();

      effects.handleChanged({
        type: "changed",
        entity: "thread",
        id: "thr_1",
        changes: [change],
      });

      expect(
        queryClient.getQueryState(firstProjectHistoryKey)?.isInvalidated,
      ).not.toBe(true);
      expect(
        queryClient.getQueryState(secondProjectHistoryKey)?.isInvalidated,
      ).not.toBe(true);

      vi.advanceTimersByTime(50);

      expect(
        queryClient.getQueryState(firstProjectHistoryKey)?.isInvalidated,
      ).toBe(true);
      expect(
        queryClient.getQueryState(secondProjectHistoryKey)?.isInvalidated,
      ).toBe(true);

      effects.dispose();
    },
  );

  it.each(NON_PROJECT_PROMPT_HISTORY_THREAD_CHANGES)(
    "does not invalidate cached project prompt histories for %s thread events",
    (change) => {
      vi.useFakeTimers();
      const {
        effects,
        firstProjectHistoryKey,
        queryClient,
        secondProjectHistoryKey,
      } = createRealtimeEffectsTestContext();

      effects.handleChanged({
        type: "changed",
        entity: "thread",
        id: "thr_1",
        changes: [change],
      });

      vi.advanceTimersByTime(50);

      expect(
        queryClient.getQueryState(firstProjectHistoryKey)?.isInvalidated,
      ).not.toBe(true);
      expect(
        queryClient.getQueryState(secondProjectHistoryKey)?.isInvalidated,
      ).not.toBe(true);

      effects.dispose();
    },
  );

  it("does not refetch active thread queries for read-state changes", () => {
    vi.useFakeTimers();
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const threadKey = threadQueryKey("thr_1");
    const threadListKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    queryClient.setQueryData(threadKey, { id: "thr_1" });
    queryClient.setQueryData(threadListKey, []);
    queryClient.setQueryData(statusQueryKey(), {});
    const threadQueryFn = vi.fn(async () => null);
    const threadListQueryFn = vi.fn(async () => []);
    const threadObserver = new QueryObserver(queryClient, {
      queryKey: threadKey,
      queryFn: threadQueryFn,
      staleTime: Infinity,
    });
    const threadListObserver = new QueryObserver(queryClient, {
      queryKey: threadListKey,
      queryFn: threadListQueryFn,
      staleTime: Infinity,
    });
    const unsubscribeThread = threadObserver.subscribe(() => {});
    const unsubscribeThreadList = threadListObserver.subscribe(() => {});
    threadQueryFn.mockClear();
    threadListQueryFn.mockClear();

    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      changes: ["read-state-changed"],
    });
    vi.advanceTimersByTime(50);

    expect(threadQueryFn).not.toHaveBeenCalled();
    expect(threadListQueryFn).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(threadKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(threadListKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(statusQueryKey())?.isInvalidated).not.toBe(
      true,
    );

    unsubscribeThread();
    unsubscribeThreadList();
    effects.dispose();
  });

  it("invalidates all cached project prompt histories for project threads-changed events", () => {
    const {
      effects,
      firstProjectHistoryKey,
      queryClient,
      secondProjectHistoryKey,
    } = createRealtimeEffectsTestContext();

    effects.handleChanged({
      type: "changed",
      entity: "project",
      id: "project-1",
      changes: ["threads-changed"],
    });

    expect(
      queryClient.getQueryState(firstProjectHistoryKey)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(secondProjectHistoryKey)?.isInvalidated,
    ).toBe(true);

    effects.dispose();
  });
});
