// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import type { PendingInteraction } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  statusQueryKey,
  threadPendingInteractionsQueryKey,
  threadQueryKey,
  threadTimelineQueryKeyPrefix,
  threadsQueryKey,
} from "../queries/query-keys";
import { useResolveThreadPendingInteraction } from "./thread-interaction-mutations";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();

  return {
    ...actual,
    resolveThreadPendingInteraction: vi.fn(),
  };
});

function createResolvedInteraction(): PendingInteraction {
  return {
    id: "pi_1",
    threadId: "thr_1",
    turnId: "turn_1",
    providerId: "codex",
    providerThreadId: "provider-thread-1",
    providerRequestId: "request-1",
    providerRequestMethod: "item/tool/requestUserInput",
    status: "resolved",
    payload: {
      kind: "user_input_request",
      itemId: "item_1",
      questions: [
        {
          id: "target",
          header: "Target",
          question: "Which environment should I use?",
          allowsOther: true,
          isSecret: false,
          multiSelect: false,
          options: [],
        },
      ],
    },
    resolution: {
      kind: "user_input_request",
      answers: {
        target: ["prod"],
      },
    },
    statusReason: null,
    createdAt: 1,
    resolvedAt: 2,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useResolveThreadPendingInteraction", () => {
  it("resolves an interaction and invalidates dependent thread queries", async () => {
    vi.mocked(api.resolveThreadPendingInteraction).mockResolvedValue(
      createResolvedInteraction(),
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(
      () => useResolveThreadPendingInteraction(),
      { wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({
        threadId: "thr_1",
        interactionId: "pi_1",
        resolution: {
          kind: "user_input_request",
          answers: {
            target: ["prod"],
          },
        },
      });
    });

    expect(api.resolveThreadPendingInteraction).toHaveBeenCalledWith(
      "thr_1",
      "pi_1",
      {
        kind: "user_input_request",
        answers: {
          target: ["prod"],
        },
      },
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: threadPendingInteractionsQueryKey("thr_1"),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: threadTimelineQueryKeyPrefix("thr_1"),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: threadQueryKey("thr_1"),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: threadsQueryKey(),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: statusQueryKey(),
    });
  });
});
