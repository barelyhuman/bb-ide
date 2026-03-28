/**
 * Shared fallback helpers for provider events that do not yet have a
 * first-class translation path. These summaries are now user-visible, so the
 * text generation here is part of the normal product surface rather than only
 * audit/debug output.
 */

import type { ThreadEvent } from "@bb/domain";
import type { ProviderUnhandledEvent } from "@bb/domain";
import type { ProviderVisibilityMetadata } from "../provider-visibility.js";
import type { JsonRpcMessage } from "../provider-adapter.js";
import {
  getRawSdkMessage,
  getRecordProperty,
  getStringProperty,
  isRecord,
  type StringRecord,
} from "./provider-visibility-helpers.js";

const HUMANIZED_EVENT_TOKEN_MAP: Record<string, string> = {
  api: "API",
  chatgpt: "ChatGPT",
  id: "ID",
  mcp: "MCP",
  oauth: "OAuth",
  sdk: "SDK",
  ui: "UI",
  url: "URL",
};

const MAX_UNHANDLED_VALUE_LENGTH = 120;

export interface CreateUnhandledProviderEventArgs {
  providerId: string;
  rawEvent: JsonRpcMessage;
  rawType: string;
  threadId?: string;
  providerThreadId?: string;
  turnId?: string;
  parentToolCallId?: string;
  summary?: string;
  payloadSummary?: string;
}

export interface BuildUnhandledProviderEventsArgs {
  providerId: string;
  rawEvent: JsonRpcMessage;
  visibilityMetadata: Pick<ProviderVisibilityMetadata, "describeRawEvent">;
  parentToolCallId?: string;
}

interface ProviderUnhandledText {
  summary: string;
  payloadSummary?: string;
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

function splitCamelCaseToken(token: string): string[] {
  return token
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter((part) => part.length > 0);
}

function humanizeEventToken(token: string): string {
  const normalized = token.toLowerCase();
  const mapped = HUMANIZED_EVENT_TOKEN_MAP[normalized];
  if (mapped) {
    return mapped;
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function humanizeRawType(rawType: string): string {
  const tokens = rawType
    .split(/[:/._-]+/u)
    .flatMap((token) => splitCamelCaseToken(token))
    .filter((token) => token.length > 0);
  return tokens.map((token) => humanizeEventToken(token)).join(" ");
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

function formatCandidateSummary(
  candidate: ProviderUnhandledSummaryCandidate,
): string {
  if (candidate.label === "message" || candidate.label === "error") {
    return candidate.value;
  }
  return `${candidate.label}: ${candidate.value}`;
}

function formatCandidateDetail(
  candidate: ProviderUnhandledSummaryCandidate,
): string {
  return `${candidate.label}: ${candidate.value}`;
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

function buildUnhandledText(
  args: CreateUnhandledProviderEventArgs,
): ProviderUnhandledText {
  const source = getUnhandledSummarySource(args.rawEvent);
  const candidates = source ? buildSummaryCandidates(source) : [];
  const summary =
    args.summary ??
    (candidates[0] ? formatCandidateSummary(candidates[0]) : humanizeRawType(args.rawType));
  const payloadSummary =
    args.payloadSummary ??
    (candidates.length > 1
      ? candidates
          .slice(1, 4)
          .map((candidate) => formatCandidateDetail(candidate))
          .join(" • ")
      : undefined);

  return {
    summary,
    ...(payloadSummary ? { payloadSummary } : {}),
  };
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
  const text = buildUnhandledText(args);
  const threadId = args.threadId ?? getThreadIdFromRawEvent(args.rawEvent);
  const providerThreadId = args.providerThreadId ?? threadId;
  const turnId = args.turnId ?? getTurnIdFromRawEvent(args.rawEvent);

  return {
    type: "provider/unhandled",
    threadId,
    providerThreadId,
    providerId: args.providerId,
    rawType: args.rawType,
    summary: text.summary,
    ...(text.payloadSummary ? { payloadSummary: text.payloadSummary } : {}),
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
