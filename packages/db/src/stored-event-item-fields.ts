import type { ThreadEventItemType, ThreadEventType } from "@bb/domain";

export interface StoredEventItemFields {
  itemId: string | null;
  itemKind: ThreadEventItemType | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toThreadEventItemType(value: unknown): ThreadEventItemType | null {
  switch (value) {
    case "userMessage":
    case "agentMessage":
    case "commandExecution":
    case "fileChange":
    case "webSearch":
    case "toolCall":
    case "reasoning":
    case "plan":
    case "contextCompaction":
      return value;
    default:
      return null;
  }
}

export function deriveStoredEventItemFields(args: {
  data: Record<string, unknown>;
  type: ThreadEventType;
}): StoredEventItemFields {
  switch (args.type) {
    case "item/started":
    case "item/completed": {
      const item = args.data.item;
      if (!isRecord(item)) {
        return {
          itemId: null,
          itemKind: null,
        };
      }

      return {
        itemId: toNullableString(item.id),
        itemKind: toThreadEventItemType(item.type),
      };
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
        itemId: toNullableString(args.data.itemId),
        itemKind: null,
      };
    default:
      return {
        itemId: null,
        itemKind: null,
      };
  }
}
