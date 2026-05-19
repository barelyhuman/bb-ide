import type { ProviderErrorCategory } from "@bb/domain";
import type { EventProjectionErrorMessage } from "./event-projection-types.js";

interface TimelineErrorDisplay {
  title: string;
  detail: string | null;
}

const providerErrorCategoryTitles = {
  "active-turn-not-steerable": "Turn is not steerable",
  "bad-request": "Provider rejected request",
  billing: "Provider billing issue",
  "budget-exceeded": "Provider budget exceeded",
  "connection-failed": "Provider connection failed",
  "context-window-exceeded": "Context window exceeded",
  internal: "Provider internal error",
  "max-output-tokens": "Provider output token limit reached",
  "max-turns": "Maximum turns reached",
  overloaded: "Provider overloaded",
  policy: "Provider policy blocked request",
  "rate-limit": "Provider rate limit reached",
  sandbox: "Provider sandbox error",
  "stream-disconnected": "Provider stream disconnected",
  "structured-output-retries": "Structured output retries exhausted",
  "thread-rollback-failed": "Thread rollback failed",
  "too-many-failed-attempts": "Provider failed after too many attempts",
  unauthorized: "Provider authorization failed",
  unknown: "Provider error",
} satisfies Record<ProviderErrorCategory, string>;

const legacyReconnectProgressPattern = /^Reconnecting\.\.\.\s+\d+\/\d+$/;

function getLegacyProviderErrorTitle(
  message: EventProjectionErrorMessage,
): string | null {
  if (message.rawType !== "provider/error") {
    return null;
  }
  if (message.message !== "Provider error" || !message.detail) {
    return null;
  }

  const detailLines = message.detail
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const firstLine = detailLines[0];
  if (!firstLine) {
    return null;
  }

  if (legacyReconnectProgressPattern.test(firstLine)) {
    return detailLines[1] ?? firstLine;
  }

  return firstLine;
}

export function buildTimelineErrorDisplay(
  message: EventProjectionErrorMessage,
): TimelineErrorDisplay {
  if (
    message.rawType === "provider/error" &&
    message.providerErrorInfo &&
    message.providerErrorInfo.category !== "unknown"
  ) {
    return {
      title: providerErrorCategoryTitles[message.providerErrorInfo.category],
      detail: message.detail,
    };
  }

  return {
    title: getLegacyProviderErrorTitle(message) ?? message.message,
    detail: message.detail,
  };
}
