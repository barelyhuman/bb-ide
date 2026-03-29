/**
 * Shared fallback helpers for provider events that do not yet have a
 * first-class translation path. These summaries are now user-visible, so the
 * text generation here is part of the normal product surface rather than only
 * audit/debug output.
 */

import type { ThreadEvent } from "@bb/domain";
import type {
  ProviderUnhandledDetailEntry,
  ProviderUnhandledEvent,
} from "@bb/domain";
import type { ProviderVisibilityMetadata } from "../provider-visibility.js";
import type { JsonRpcMessage } from "../provider-adapter.js";
import {
  getRawSdkMessage,
  getRecordProperty,
  getStringProperty,
  isRecord,
  type StringRecord,
} from "./provider-visibility-helpers.js";

const MAX_UNHANDLED_VALUE_LENGTH = 120;

export interface CreateUnhandledProviderEventArgs {
  providerId: string;
  rawEvent: JsonRpcMessage;
  rawType: string;
  threadId?: string;
  providerThreadId?: string;
  turnId?: string;
  parentToolCallId?: string;
  detailEntries?: ProviderUnhandledDetailEntry[];
}

export interface BuildUnhandledProviderEventsArgs {
  providerId: string;
  rawEvent: JsonRpcMessage;
  visibilityMetadata: Pick<ProviderVisibilityMetadata, "describeRawEvent">;
  parentToolCallId?: string;
}

interface ProviderUnhandledSummaryCandidate {
  label: string;
  value: string;
}

function truncateUnhandledValue(value: string): string {
  return value.length <= MAX_UNHANDLED_VALUE_LENGTH
    ? value
    : `${value.slice(0, MAX_UNHANDLED_VALUE_LENGTH - 1)}…`;
}

function buildSummaryCandidate(
  label: string,
  value: string | undefined,
): ProviderUnhandledSummaryCandidate | null {
  if (!value) {
    return null;
  }

  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    return null;
  }

  return {
    label,
    value: truncateUnhandledValue(trimmedValue),
  };
}

function getNestedStringValue(
  value: StringRecord,
  key: string,
  nestedKey: string,
): string | undefined {
  const nested = getRecordProperty(value, key);
  if (!nested) {
    return undefined;
  }
  return getStringProperty(nested, nestedKey);
}

function buildSummaryCandidates(
  value: StringRecord,
): ProviderUnhandledSummaryCandidate[] {
  const candidates = [
    buildSummaryCandidate("item", getNestedStringValue(value, "item", "type")),
    buildSummaryCandidate("error", getNestedStringValue(value, "error", "message")),
    buildSummaryCandidate(
      "assistant event",
      getNestedStringValue(value, "assistantMessageEvent", "type"),
    ),
    buildSummaryCandidate("event", getNestedStringValue(value, "event", "type")),
    buildSummaryCandidate("subtype", getStringProperty(value, "subtype")),
    buildSummaryCandidate("tool", getStringProperty(value, "toolName")),
    buildSummaryCandidate("tool", getStringProperty(value, "tool")),
    buildSummaryCandidate("status", getStringProperty(value, "status")),
    buildSummaryCandidate("message", getStringProperty(value, "message")),
    buildSummaryCandidate("name", getStringProperty(value, "name")),
  ].filter((candidate): candidate is ProviderUnhandledSummaryCandidate => candidate !== null);

  const deduped = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.label}:${candidate.value}`;
    if (deduped.has(key)) {
      return false;
    }
    deduped.add(key);
    return true;
  });
}

function getUnhandledSummarySource(
  rawEvent: JsonRpcMessage,
): StringRecord | null {
  const rawSdkMessage = getRawSdkMessage(rawEvent);
  if (rawSdkMessage) {
    return rawSdkMessage;
  }

  if (!isRecord(rawEvent.params)) {
    return null;
  }

  return rawEvent.params;
}

function buildUnhandledDetailEntries(
  args: CreateUnhandledProviderEventArgs,
): ProviderUnhandledDetailEntry[] | undefined {
  if (args.detailEntries && args.detailEntries.length > 0) {
    return args.detailEntries;
  }

  const source = getUnhandledSummarySource(args.rawEvent);
  const candidates = source ? buildSummaryCandidates(source) : [];

  if (candidates.length === 0) {
    return undefined;
  }

  return candidates.slice(0, 4).map((candidate) => ({
    label: candidate.label,
    value: candidate.value,
  }));
}

function getThreadIdFromRawEvent(rawEvent: JsonRpcMessage): string {
  if (!isRecord(rawEvent.params)) {
    return "";
  }
  return getStringProperty(rawEvent.params, "threadId") ?? "";
}

function getTurnIdFromRawEvent(rawEvent: JsonRpcMessage): string | undefined {
  if (!isRecord(rawEvent.params)) {
    return undefined;
  }
  return getStringProperty(rawEvent.params, "turnId");
}

export function createUnhandledProviderEvent(
  args: CreateUnhandledProviderEventArgs,
): ProviderUnhandledEvent {
  const detailEntries = buildUnhandledDetailEntries(args);
  const threadId = args.threadId ?? getThreadIdFromRawEvent(args.rawEvent);
  const providerThreadId = args.providerThreadId ?? threadId;
  const turnId = args.turnId ?? getTurnIdFromRawEvent(args.rawEvent);

  return {
    type: "provider/unhandled",
    threadId,
    providerThreadId,
    providerId: args.providerId,
    rawType: args.rawType,
    ...(detailEntries ? { detailEntries } : {}),
    ...(turnId ? { turnId } : {}),
    ...(args.parentToolCallId ? { parentToolCallId: args.parentToolCallId } : {}),
  };
}

export function buildUnhandledProviderEvents(
  args: BuildUnhandledProviderEventsArgs,
): ThreadEvent[] {
  const description = args.visibilityMetadata.describeRawEvent(args.rawEvent);
  if (description.coverage !== "unknown") {
    return [];
  }

  return [
    createUnhandledProviderEvent({
      providerId: args.providerId,
      rawEvent: args.rawEvent,
      rawType: description.kind,
      ...(args.parentToolCallId
        ? { parentToolCallId: args.parentToolCallId }
        : {}),
    }),
  ];
}
