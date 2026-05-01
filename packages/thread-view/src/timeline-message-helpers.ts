import type { EventProjectionMessage } from "./event-projection-types.js";

export interface IndexedTimelineMessage {
  index: number;
  message: EventProjectionMessage;
}

export function isTimelineTerminalMessage(
  message: EventProjectionMessage,
): boolean {
  return message.kind === "assistant-text" || message.kind === "error";
}

export function isTimelineUngroupableMessage(
  message: EventProjectionMessage,
): boolean {
  return message.kind === "user" || message.kind === "debug/raw-event";
}

export function toIndexedTimelineMessages(
  messages: readonly EventProjectionMessage[],
): IndexedTimelineMessage[] {
  return messages.map((message, index) => ({ index, message }));
}

export function findLastTerminalTimelineMessageIndex(
  messages: readonly IndexedTimelineMessage[],
): number | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const turnMessage = messages[index];
    if (turnMessage && isTimelineTerminalMessage(turnMessage.message)) {
      return turnMessage.index;
    }
  }
  return null;
}

export function findLastTerminalTimelineMessage(
  messages: readonly EventProjectionMessage[],
): EventProjectionMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && isTimelineTerminalMessage(message)) {
      return message;
    }
  }
  return undefined;
}
