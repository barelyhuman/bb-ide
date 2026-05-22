import {
  applyNeighborReorder,
  buildNeighborReorderRequest,
} from "./neighbor-reorder";

export interface QueuedMessageReorderItem {
  id: string;
}

export interface QueuedMessageReorderRequest {
  nextQueuedMessageId: string | null;
  previousQueuedMessageId: string | null;
  queuedMessageId: string;
}

export interface BuildQueuedMessageReorderRequestArgs<
  Item extends QueuedMessageReorderItem,
> {
  activeId: string;
  overId: string;
  queuedMessages: readonly Item[];
}

export interface ApplyQueuedMessageReorderArgs<
  Item extends QueuedMessageReorderItem,
> {
  queuedMessages: readonly Item[];
  request: QueuedMessageReorderRequest;
}

export function buildQueuedMessageReorderRequest<
  Item extends QueuedMessageReorderItem,
>({
  activeId,
  overId,
  queuedMessages,
}: BuildQueuedMessageReorderRequestArgs<Item>): QueuedMessageReorderRequest | null {
  const request = buildNeighborReorderRequest({
    activeId,
    items: queuedMessages,
    overId,
  });
  if (!request) {
    return null;
  }

  return {
    queuedMessageId: request.itemId,
    previousQueuedMessageId: request.previousItemId,
    nextQueuedMessageId: request.nextItemId,
  };
}

export function applyQueuedMessageReorder<
  Item extends QueuedMessageReorderItem,
>({ queuedMessages, request }: ApplyQueuedMessageReorderArgs<Item>): Item[] {
  return applyNeighborReorder({
    items: queuedMessages,
    request: {
      itemId: request.queuedMessageId,
      previousItemId: request.previousQueuedMessageId,
      nextItemId: request.nextQueuedMessageId,
    },
  });
}
