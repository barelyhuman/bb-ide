import type { ThreadEvent, ThreadEventItemType } from "@bb/domain";

export interface StoredEventItemFields {
  itemId: string | null;
  itemKind: ThreadEventItemType | null;
}

interface StoredEventItemIdentity {
  id: string;
  type: ThreadEventItemType;
}

function fromItem(args: StoredEventItemIdentity): StoredEventItemFields {
  return {
    itemId: args.id,
    itemKind: args.type,
  };
}

function fromItemId(itemId: string | undefined): StoredEventItemFields {
  return {
    itemId: itemId ?? null,
    itemKind: null,
  };
}

export function deriveStoredEventItemFields(
  event: ThreadEvent,
): StoredEventItemFields {
  switch (event.type) {
    case "item/started":
    case "item/completed":
      return fromItem(event.item);
    case "item/agentMessage/delta":
    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
    case "item/plan/delta":
    case "item/mcpToolCall/progress":
    case "item/toolCall/progress":
      return fromItemId(event.itemId);
    default:
      return {
        itemId: null,
        itemKind: null,
      };
  }
}
