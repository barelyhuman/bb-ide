import type {
  ProviderObservedToolCall,
  ProviderObservedToolCallCoverage,
  ProviderRawEventDescription,
  ProviderVisibilityMetadata,
} from "../provider-visibility.js";
import type { JsonRpcMessage } from "../provider-adapter.js";
import {
  getRecordProperty,
  getStringProperty,
  isRecord,
} from "../shared/provider-visibility-helpers.js";

const CODEX_WELL_KNOWN_TOOL_NAMES = [
  "closeAgent",
  "resumeAgent",
  "sendInput",
  "spawnAgent",
  "wait",
] as const;
const CODEX_WELL_KNOWN_TOOL_NAME_SET = new Set<string>(CODEX_WELL_KNOWN_TOOL_NAMES);

interface CodexObservedToolCallDetails {
  key: string;
  displayName: string;
}

function isIgnorableCodexMcpStartupStatus(event: JsonRpcMessage): boolean {
  if (event.method !== "mcpServer/startupStatus/updated" || !isRecord(event.params)) {
    return false;
  }

  const status = getStringProperty(event.params, "status");
  const error = getRecordProperty(event.params, "error");
  return (status === "starting" || status === "ready") && error === null;
}

function toCodexRawEventDescription(event: JsonRpcMessage): ProviderRawEventDescription {
  const kind = event.method;

  if (kind === "item/commandExecution/terminalInteraction") {
    if (isRecord(event.params)) {
      const stdin = getStringProperty(event.params, "stdin");
      if (stdin !== undefined && stdin.length === 0) {
        return { kind, coverage: "noise" };
      }
    }
    return { kind, coverage: "unknown" };
  }

  if (
    kind === "thread/started" ||
    kind === "thread/name/updated" ||
    kind === "thread/compacted" ||
    kind === "turn/started" ||
    kind === "turn/completed" ||
    kind === "item/started" ||
    kind === "item/completed" ||
    kind === "item/agentMessage/delta" ||
    kind === "item/commandExecution/outputDelta" ||
    kind === "item/fileChange/outputDelta" ||
    kind === "item/reasoning/summaryTextDelta" ||
    kind === "item/reasoning/textDelta" ||
    kind === "item/plan/delta" ||
    kind === "item/mcpToolCall/progress" ||
    kind === "thread/tokenUsage/updated" ||
    kind === "turn/plan/updated" ||
    kind === "turn/diff/updated" ||
    kind === "error" ||
    kind === "deprecationNotice" ||
    kind === "configWarning"
  ) {
    return { kind, coverage: "normalized" };
  }

  if (
    kind === "thread/status/changed" ||
    kind === "account/rateLimits/updated"
  ) {
    return { kind, coverage: "noise" };
  }

  if (isIgnorableCodexMcpStartupStatus(event)) {
    return { kind, coverage: "noise" };
  }

  return { kind, coverage: "unknown" };
}

function classifyCodexToolCallCoverage(
  details: CodexObservedToolCallDetails,
): ProviderObservedToolCallCoverage {
  if (details.key.startsWith("mcp:")) {
    return "accepted-fallback";
  }
  if (details.key.startsWith("dynamic:")) {
    return "accepted-fallback";
  }
  if (CODEX_WELL_KNOWN_TOOL_NAME_SET.has(details.displayName)) {
    return "well-known";
  }
  return "unknown";
}

function toCodexObservedToolCallDetails(event: JsonRpcMessage): CodexObservedToolCallDetails | null {
  if (event.method !== "item/started" || !isRecord(event.params)) {
    return null;
  }
  const item = getRecordProperty(event.params, "item");
  if (!item) {
    return null;
  }

  const itemType = getStringProperty(item, "type");
  if (itemType === "mcpToolCall") {
    const server = getStringProperty(item, "server");
    const tool = getStringProperty(item, "tool");
    if (!server || !tool) {
      return null;
    }
    return {
      key: `mcp:${server}:${tool}`,
      displayName: `${server}:${tool}`,
    };
  }

  if (itemType === "dynamicToolCall" || itemType === "collabAgentToolCall") {
    const tool = getStringProperty(item, "tool");
    if (!tool) {
      return null;
    }
    return {
      key: `${itemType === "dynamicToolCall" ? "dynamic" : "collab"}:${tool}`,
      displayName: tool,
    };
  }

  return null;
}

function toCodexObservedToolCalls(event: JsonRpcMessage): ProviderObservedToolCall[] {
  const details = toCodexObservedToolCallDetails(event);
  if (!details) {
    return [];
  }
  return [{
    key: details.key,
    displayName: details.displayName,
    coverage: classifyCodexToolCallCoverage(details),
  }];
}

export const codexVisibilityMetadata: ProviderVisibilityMetadata = {
  providerId: "codex",
  wellKnownToolNames: CODEX_WELL_KNOWN_TOOL_NAMES,
  describeRawEvent: toCodexRawEventDescription,
  extractObservedToolCalls: toCodexObservedToolCalls,
};
