import { useCallback, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  applyNeighborReorder,
  buildNeighborReorderRequest,
  type NeighborReorderRequest,
} from "@/lib/neighbor-reorder";

interface HasSameOptimisticOrderArgs<Item> {
  getId: (item: Item) => string;
  items: readonly Item[];
  order: readonly string[];
}

export interface NeighborReorderSortableCallbacks {
  onSettled: () => void;
}

export interface UseNeighborReorderSortableArgs<Item> {
  disabled: boolean;
  getId: (item: Item) => string;
  items: readonly Item[];
  onReorder: (
    request: NeighborReorderRequest,
    callbacks: NeighborReorderSortableCallbacks,
  ) => void;
}

export interface UseNeighborReorderSortableResult<Item> {
  handleDragEnd: (event: DragEndEvent) => void;
  itemIds: string[];
  renderedItems: readonly Item[];
}

function hasSameOptimisticOrder<Item>({
  getId,
  items,
  order,
}: HasSameOptimisticOrderArgs<Item>): boolean {
  if (order.length !== items.length) {
    return false;
  }

  return order.every((id, index) => {
    const currentItem = items[index];
    return currentItem !== undefined && id === getId(currentItem);
  });
}

export function useNeighborReorderSortable<Item>({
  disabled,
  getId,
  items,
  onReorder,
}: UseNeighborReorderSortableArgs<Item>): UseNeighborReorderSortableResult<Item> {
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);
  const renderedItems = useMemo(() => {
    if (!optimisticOrder) {
      return items;
    }

    const itemsById = new Map<string, Item>();
    for (const item of items) {
      itemsById.set(getId(item), item);
    }

    const orderedItems: Item[] = [];
    for (const id of optimisticOrder) {
      const item = itemsById.get(id);
      if (item === undefined) {
        return items;
      }
      orderedItems.push(item);
    }
    return orderedItems;
  }, [getId, items, optimisticOrder]);
  const itemIds = useMemo(
    () => renderedItems.map((item) => getId(item)),
    [getId, renderedItems],
  );
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (disabled) {
        return;
      }

      const { active, over } = event;
      if (
        !over ||
        typeof active.id !== "string" ||
        typeof over.id !== "string"
      ) {
        return;
      }

      const orderItems = renderedItems.map((item) => ({ id: getId(item) }));
      const request = buildNeighborReorderRequest({
        activeId: active.id,
        overId: over.id,
        items: orderItems,
      });
      if (!request) {
        return;
      }

      const nextOrder = applyNeighborReorder({
        items: orderItems,
        request,
      }).map((item) => item.id);
      flushSync(() => {
        setOptimisticOrder(nextOrder);
      });
      onReorder(request, {
        onSettled: () => {
          setOptimisticOrder(null);
        },
      });
    },
    [disabled, getId, onReorder, renderedItems],
  );

  useEffect(() => {
    if (!optimisticOrder) {
      return;
    }

    if (hasSameOptimisticOrder({ getId, items, order: optimisticOrder })) {
      setOptimisticOrder(null);
    }
  }, [getId, items, optimisticOrder]);

  return {
    handleDragEnd,
    itemIds,
    renderedItems,
  };
}
