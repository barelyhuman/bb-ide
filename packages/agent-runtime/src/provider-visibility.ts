import type { JsonRpcMessage } from "./provider-adapter.js";

export type ProviderRawEventCoverage = "normalized" | "noise" | "unknown";

export type ProviderObservedToolCallCoverage =
  | "well-known"
  | "accepted-fallback"
  | "unknown";

export interface ProviderRawEventDescription {
  kind: string;
  coverage: ProviderRawEventCoverage;
}

export interface ProviderObservedToolCall {
  key: string;
  displayName: string;
  coverage: ProviderObservedToolCallCoverage;
}

export interface ProviderVisibilityMetadata {
  providerId: string;
  wellKnownToolNames: readonly string[];
  describeRawEvent(event: JsonRpcMessage): ProviderRawEventDescription;
  extractObservedToolCalls(event: JsonRpcMessage): ProviderObservedToolCall[];
}
