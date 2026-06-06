// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
  Active,
  ClientRect,
  DragEndEvent,
  Over,
  Translate,
} from "@dnd-kit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NeighborReorderRequest } from "@/lib/neighbor-reorder";
import {
  useNeighborReorderSortable,
  type NeighborReorderSortableCallbacks,
} from "./useNeighborReorderSortable";

interface TestItem {
  id: string;
  label: string;
}

interface HookHarnessProps {
  items: readonly TestItem[];
  onReorder: TestOnReorder;
}

interface DragEndEventArgs {
  activeId: string;
  overId: string | null;
}

type TestOnReorder = (
  request: NeighborReorderRequest,
  callbacks: NeighborReorderSortableCallbacks,
) => void;

const ZERO_RECT: ClientRect = {
  bottom: 0,
  height: 0,
  left: 0,
  right: 0,
  top: 0,
  width: 0,
};
const ZERO_TRANSLATE: Translate = { x: 0, y: 0 };

const ALPHA_ITEM: TestItem = { id: "a", label: "Alpha" };
const BETA_ITEM: TestItem = { id: "b", label: "Beta" };
const GAMMA_ITEM: TestItem = { id: "c", label: "Gamma" };
const DELTA_ITEM: TestItem = { id: "d", label: "Delta" };
const SERVER_ITEMS: TestItem[] = [
  ALPHA_ITEM,
  BETA_ITEM,
  GAMMA_ITEM,
  DELTA_ITEM,
];
const OPTIMISTIC_SERVER_ITEMS: TestItem[] = [
  ALPHA_ITEM,
  DELTA_ITEM,
  BETA_ITEM,
  GAMMA_ITEM,
];
const DIFFERENT_SERVER_ITEMS: TestItem[] = [
  DELTA_ITEM,
  ALPHA_ITEM,
  BETA_ITEM,
  GAMMA_ITEM,
];
const MISSING_OPTIMISTIC_ID_ITEMS: TestItem[] = [
  ALPHA_ITEM,
  BETA_ITEM,
  GAMMA_ITEM,
];

function getTestItemId(item: TestItem): string {
  return item.id;
}

function getLabels(items: readonly TestItem[]): string[] {
  return items.map((item) => item.label);
}

function createActive(id: string): Active {
  return {
    data: { current: undefined },
    id,
    rect: {
      current: {
        initial: null,
        translated: null,
      },
    },
  };
}

function createOver(id: string): Over {
  return {
    data: { current: undefined },
    disabled: false,
    id,
    rect: ZERO_RECT,
  };
}

function createDragEndEvent({
  activeId,
  overId,
}: DragEndEventArgs): DragEndEvent {
  return {
    active: createActive(activeId),
    activatorEvent: new Event("pointerup"),
    collisions: null,
    delta: ZERO_TRANSLATE,
    over: overId === null ? null : createOver(overId),
  };
}

function useHookHarness({ items, onReorder }: HookHarnessProps) {
  return useNeighborReorderSortable({
    disabled: false,
    getId: getTestItemId,
    items,
    onReorder,
  });
}

describe("useNeighborReorderSortable", () => {
  afterEach(() => {
    cleanup();
  });

  it("builds a neighbor request and updates rendered items optimistically", () => {
    const onReorder = vi.fn<TestOnReorder>();
    const { result } = renderHook(useHookHarness, {
      initialProps: {
        items: SERVER_ITEMS,
        onReorder,
      },
    });

    act(() => {
      result.current.handleDragEnd(
        createDragEndEvent({ activeId: "d", overId: "b" }),
      );
    });

    expect(onReorder).toHaveBeenCalledWith(
      {
        itemId: "d",
        previousItemId: "a",
        nextItemId: "b",
      },
      {
        onSettled: expect.any(Function),
      },
    );
    expect(getLabels(result.current.renderedItems)).toEqual([
      "Alpha",
      "Delta",
      "Beta",
      "Gamma",
    ]);
    expect(result.current.itemIds).toEqual(["a", "d", "b", "c"]);
  });

  it("cleans up optimistic order when the reorder settles", () => {
    let settleCallbacks: NeighborReorderSortableCallbacks | undefined;
    const onReorder = vi.fn<TestOnReorder>((_request, callbacks) => {
      settleCallbacks = callbacks;
    });
    const { result } = renderHook(useHookHarness, {
      initialProps: {
        items: SERVER_ITEMS,
        onReorder,
      },
    });

    act(() => {
      result.current.handleDragEnd(
        createDragEndEvent({ activeId: "d", overId: "b" }),
      );
    });
    expect(getLabels(result.current.renderedItems)).toEqual([
      "Alpha",
      "Delta",
      "Beta",
      "Gamma",
    ]);

    act(() => {
      settleCallbacks?.onSettled();
    });

    expect(getLabels(result.current.renderedItems)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
      "Delta",
    ]);
  });

  it("reconciles when server items match the optimistic order", async () => {
    const onReorder = vi.fn<TestOnReorder>();
    const { rerender, result } = renderHook(useHookHarness, {
      initialProps: {
        items: SERVER_ITEMS,
        onReorder,
      },
    });

    act(() => {
      result.current.handleDragEnd(
        createDragEndEvent({ activeId: "d", overId: "b" }),
      );
    });

    rerender({
      items: OPTIMISTIC_SERVER_ITEMS,
      onReorder,
    });

    await waitFor(() => {
      expect(result.current.renderedItems).toBe(OPTIMISTIC_SERVER_ITEMS);
    });

    rerender({
      items: DIFFERENT_SERVER_ITEMS,
      onReorder,
    });
    expect(getLabels(result.current.renderedItems)).toEqual([
      "Delta",
      "Alpha",
      "Beta",
      "Gamma",
    ]);
  });

  it("falls back to server items when an optimistic ID is missing", () => {
    const onReorder = vi.fn<TestOnReorder>();
    const { rerender, result } = renderHook(useHookHarness, {
      initialProps: {
        items: SERVER_ITEMS,
        onReorder,
      },
    });

    act(() => {
      result.current.handleDragEnd(
        createDragEndEvent({ activeId: "d", overId: "b" }),
      );
    });

    rerender({
      items: MISSING_OPTIMISTIC_ID_ITEMS,
      onReorder,
    });

    expect(getLabels(result.current.renderedItems)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
  });
});
