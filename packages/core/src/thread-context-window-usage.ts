import type { ThreadContextWindowUsage } from "./api-types.js";
import type { ThreadEventRow } from "./types.js";
import {
  resolveProviderEventMethod,
  unwrapProviderEventPayload,
} from "./thread-event-normalization.js";
import { toRecord } from "./unknown-helpers.js";

interface ThreadContextWindowSignal {
  totalTokens?: number;
  modelContextWindow?: number;
}

function toNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

function toPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function decodeContextWindowSignal(event: ThreadEventRow): ThreadContextWindowSignal | null {
  const eventMethod = resolveProviderEventMethod(event.type, event.data);
  const payload = toRecord(unwrapProviderEventPayload(event.data));
  if (!payload) return null;

  if (eventMethod === "thread/tokenUsage/updated") {
    const tokenUsage = toRecord(payload.tokenUsage);
    const totalUsage = toRecord(tokenUsage?.total);
    const lastUsage = toRecord(tokenUsage?.last);
    const totalTokens =
      toNonNegativeNumber(lastUsage?.totalTokens) ??
      toNonNegativeNumber(totalUsage?.totalTokens);
    const modelContextWindow = toPositiveNumber(tokenUsage?.modelContextWindow);
    if (totalTokens === undefined && modelContextWindow === undefined) {
      return null;
    }
    return {
      totalTokens,
      modelContextWindow,
    };
  }

  // Provider event methods are open_external: unknown methods are intentionally ignored.
  return null;
}

export function extractThreadContextWindowUsage(
  events: readonly ThreadEventRow[],
): ThreadContextWindowUsage | null {
  let totalTokens: number | undefined;
  let modelContextWindow: number | undefined;

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const signal = decodeContextWindowSignal(events[index]);
    if (!signal) continue;

    if (totalTokens === undefined && signal.totalTokens !== undefined) {
      totalTokens = signal.totalTokens;
    }

    if (
      modelContextWindow === undefined &&
      signal.modelContextWindow !== undefined
    ) {
      modelContextWindow = signal.modelContextWindow;
    }

    if (totalTokens !== undefined && modelContextWindow !== undefined) {
      break;
    }
  }

  if (modelContextWindow === undefined) {
    return null;
  }

  return {
    totalTokens: totalTokens ?? 0,
    modelContextWindow,
  };
}
