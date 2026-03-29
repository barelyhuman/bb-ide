import type {
  ProviderUnhandledDetailEntry,
  ProviderUnhandledEvent,
} from "@bb/domain";

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

function formatProviderUnhandledEntry(
  entry: ProviderUnhandledDetailEntry,
): string {
  const value = truncateUnhandledValue(entry.value.trim());
  if (entry.label === "message" || entry.label === "error") {
    return value;
  }
  return `${entry.label}: ${value}`;
}

export function buildProviderUnhandledDetail(
  event: ProviderUnhandledEvent,
): string {
  const detailLines: string[] = [];
  const detailEntries = event.detailEntries ?? [];

  if (detailEntries.length > 0) {
    detailLines.push(formatProviderUnhandledEntry(detailEntries[0]));
  } else {
    detailLines.push(humanizeRawType(event.rawType));
  }

  detailLines.push(`Raw event: ${event.rawType}`);

  for (const entry of detailEntries.slice(1)) {
    detailLines.push(formatProviderUnhandledEntry(entry));
  }

  return detailLines.join("\n");
}
