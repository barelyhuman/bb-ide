import type { ThreadEvent, ThreadEventItemType } from "@bb/domain";

export interface StoredEventItemFields {
  itemId: string | null;
  itemKind: ThreadEventItemType | null;
}

function fromItem(args: {
  id: string;
  type: ThreadEventItemType;
}): StoredEventItemFields {
  return {
    itemId: args.id,
    itemKind: args.type,
  };
}

export function deriveStoredEventItemFields(
  event: ThreadEvent,
): StoredEventItemFields {
  switch (event.type) {
    case "item/started":
    case "item/completed": {
      return fromItem(event.item);
    }
    case "item/agentMessage/delta":
    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
    case "item/plan/delta":
    case "item/mcpToolCall/progress":
    case "item/toolCall/progress":
      return {
        itemId: event.itemId ?? null,
        itemKind: null,
      };
    default:
      return {
        itemId: null,
        itemKind: null,
      };
  }
}
