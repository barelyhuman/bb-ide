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

interface MoveItemArgs<Item> {
  fromIndex: number;
  items: readonly Item[];
  toIndex: number;
}

function moveItem<Item>({
  fromIndex,
  items,
  toIndex,
}: MoveItemArgs<Item>): Item[] {
  const result = [...items];
  const movedItems = result.splice(fromIndex, 1);
  const movedItem = movedItems[0];
  if (!movedItem) {
    return result;
  }
  result.splice(toIndex, 0, movedItem);
  return result;
}

export function buildQueuedMessageReorderRequest<
  Item extends QueuedMessageReorderItem,
>({
  activeId,
  overId,
  queuedMessages,
}: BuildQueuedMessageReorderRequestArgs<Item>):
  | QueuedMessageReorderRequest
  | null {
  if (activeId === overId) {
    return null;
  }

  const oldIndex = queuedMessages.findIndex(
    (queuedMessage) => queuedMessage.id === activeId,
  );
  const newIndex = queuedMessages.findIndex(
    (queuedMessage) => queuedMessage.id === overId,
  );
  if (oldIndex === -1 || newIndex === -1) {
    return null;
  }

  const reorderedMessages = moveItem({
    items: queuedMessages,
    fromIndex: oldIndex,
    toIndex: newIndex,
  });
  const movedIndex = reorderedMessages.findIndex(
    (queuedMessage) => queuedMessage.id === activeId,
  );
  if (movedIndex === -1) {
    return null;
  }

  return {
    queuedMessageId: activeId,
    previousQueuedMessageId: reorderedMessages[movedIndex - 1]?.id ?? null,
    nextQueuedMessageId: reorderedMessages[movedIndex + 1]?.id ?? null,
  };
}

export function applyQueuedMessageReorder<
  Item extends QueuedMessageReorderItem,
>({
  queuedMessages,
  request,
}: ApplyQueuedMessageReorderArgs<Item>): Item[] {
  const movedIndex = queuedMessages.findIndex(
    (queuedMessage) => queuedMessage.id === request.queuedMessageId,
  );
  if (movedIndex === -1) {
    return [...queuedMessages];
  }

  const movedMessage = queuedMessages[movedIndex];
  if (!movedMessage) {
    return [...queuedMessages];
  }
  const remainingMessages = queuedMessages.filter(
    (queuedMessage) => queuedMessage.id !== request.queuedMessageId,
  );
  let insertIndex = 0;

  if (request.previousQueuedMessageId !== null) {
    const previousIndex = remainingMessages.findIndex(
      (queuedMessage) => queuedMessage.id === request.previousQueuedMessageId,
    );
    if (previousIndex === -1) {
      return [...queuedMessages];
    }
    insertIndex = previousIndex + 1;
  } else if (request.nextQueuedMessageId !== null) {
    const nextIndex = remainingMessages.findIndex(
      (queuedMessage) => queuedMessage.id === request.nextQueuedMessageId,
    );
    if (nextIndex === -1) {
      return [...queuedMessages];
    }
    insertIndex = nextIndex;
  }

  return [
    ...remainingMessages.slice(0, insertIndex),
    movedMessage,
    ...remainingMessages.slice(insertIndex),
  ];
}
