// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { ChangedMessage } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { threadQueryKey } from "./queries/query-keys";
import { useWebSocket } from "./useWebSocket";

type ChangedCallback = (message: ChangedMessage) => void;
type ConnectedCallback = (event: { reconnected: boolean }) => void;

const websocketMock = vi.hoisted(() => {
  const changedCallbacks = new Set<ChangedCallback>();
  const connectedCallbacks = new Set<ConnectedCallback>();
  const wsManager = {
    connect: vi.fn(),
    onChanged: vi.fn((callback: ChangedCallback) => {
      changedCallbacks.add(callback);
      return () => {
        changedCallbacks.delete(callback);
      };
    }),
    onConnected: vi.fn((callback: ConnectedCallback) => {
      connectedCallbacks.add(callback);
      return () => {
        connectedCallbacks.delete(callback);
      };
    }),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  };

  return {
    changedCallbacks,
    connectedCallbacks,
    emitChanged: (message: ChangedMessage) => {
      for (const callback of changedCallbacks) {
        callback(message);
      }
    },
    reset: () => {
      changedCallbacks.clear();
      connectedCallbacks.clear();
      wsManager.connect.mockClear();
      wsManager.onChanged.mockClear();
      wsManager.onConnected.mockClear();
      wsManager.subscribe.mockClear();
      wsManager.unsubscribe.mockClear();
    },
    wsManager,
  };
});

const routeOwnerMock = vi.hoisted(() => ({
  currentHandler: vi.fn(),
}));

vi.mock("../lib/ws", () => ({
  wsManager: websocketMock.wsManager,
}));

vi.mock("./cache-owners/resource-route-owner", () => ({
  useDeletedResourceRouteOwner: () => routeOwnerMock.currentHandler,
}));

describe("useWebSocket", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    websocketMock.reset();
    routeOwnerMock.currentHandler = vi.fn();
  });

  it("keeps buffered invalidations when the route-deletion handler changes identity", () => {
    vi.useFakeTimers();
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const threadKey = threadQueryKey("thr_1");
    queryClient.setQueryData(threadKey, { id: "thr_1" });

    const { rerender, unmount } = renderHook(
      ({ renderToken }) => {
        void renderToken;
        useWebSocket();
      },
      {
        initialProps: { renderToken: 1 },
        wrapper,
      },
    );

    act(() => {
      websocketMock.emitChanged({
        type: "changed",
        entity: "thread",
        id: "thr_1",
        changes: ["title-changed"],
      });
    });
    expect(queryClient.getQueryState(threadKey)?.isInvalidated).not.toBe(true);

    routeOwnerMock.currentHandler = vi.fn();
    rerender({ renderToken: 2 });

    expect(websocketMock.wsManager.onChanged).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(queryClient.getQueryState(threadKey)?.isInvalidated).toBe(true);

    unmount();
  });
});
