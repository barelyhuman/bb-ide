/**
 * Shared helpers for provider adapter implementations.
 *
 * These are common behaviors that all (or most) provider adapters need.
 * They are NOT part of the ProviderAdapter contract — they are implementation
 * utilities that adapter authors can use.
 */

import type {
  PromptInput,
  ThreadEvent,
} from "@bb/core";
import { decodeThreadEventData } from "@bb/core";
import { renderTemplate } from "@bb/templates";
import type {
  ProviderDynamicTool,
  ProviderExecutionOptions,
  ProviderThreadContext,
} from "./provider-adapter.js";

const DEFAULT_BASE_INSTRUCTIONS = renderTemplate("agentBaseInstructions", {});

// ---------------------------------------------------------------------------
// Event type normalization
// ---------------------------------------------------------------------------

/** Normalize a provider event method string (e.g. "turn.started" → "turn/started"). */
export function normalizeProviderEventType(type: string): string {
  return type.toLowerCase().replaceAll(".", "/");
}

// ---------------------------------------------------------------------------
// Title helpers
// ---------------------------------------------------------------------------

/** Normalize and truncate a title string. Returns undefined if empty. */
export function normalizeTitle(value: string): string | undefined {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  if (normalized.length <= 60) return normalized;
  return `${normalized.slice(0, 57).trimEnd()}...`;
}

/** Derive a thread title from prompt input text. */
export function deriveThreadTitleFromInput(
  input?: PromptInput[],
): string | undefined {
  if (!input || input.length === 0) return undefined;
  const textChunk = input.find(
    (chunk): chunk is Extract<PromptInput, { type: "text" }> =>
      chunk.type === "text" && chunk.text.trim().length > 0,
  );
  if (!textChunk) return undefined;
  return normalizeTitle(textChunk.text);
}

// ---------------------------------------------------------------------------
// System instructions
// ---------------------------------------------------------------------------

/** Resolve base instructions, prepending the default if needed. */
export function resolveBaseInstructions(
  developerInstructions?: string,
): string {
  const trimmed = developerInstructions?.trim();
  if (!trimmed) return DEFAULT_BASE_INSTRUCTIONS;
  if (
    trimmed === DEFAULT_BASE_INSTRUCTIONS ||
    trimmed.startsWith(`${DEFAULT_BASE_INSTRUCTIONS}\n`)
  ) {
    return trimmed;
  }
  return `${DEFAULT_BASE_INSTRUCTIONS}\n\n${trimmed}`;
}

// ---------------------------------------------------------------------------
// Event output extraction
// ---------------------------------------------------------------------------

/** Extract agent message text from a completed item event. */
export function outputFromEvent(event: ThreadEvent): string | undefined {
  const normalizedType = normalizeProviderEventType(event.type);
  if (normalizedType !== "item/completed") return undefined;
  const decoded = decodeThreadEventData(event.data);
  if (decoded.item?.normalizedType !== "agentmessage") return undefined;
  return decoded.item.text.text || undefined;
}

// ---------------------------------------------------------------------------
// Param building helpers
// ---------------------------------------------------------------------------

/**
 * Merge execution options (model, service tier, reasoning level) into params.
 * Returns a new object — does not mutate the input.
 */
export function withExecutionOptions(
  params: Record<string, unknown>,
  options?: ProviderExecutionOptions,
): Record<string, unknown> {
  if (!options) return params;
  const next = { ...params };
  if (options.model) {
    next.model = options.model;
  }
  if (options.serviceTier) {
    next.service_tier = options.serviceTier;
  }
  if (options.reasoningLevel) {
    next.config = {
      ...toRecord(next.config),
      model_reasoning_effort: options.reasoningLevel,
    };
  }
  return next;
}

/**
 * Inject bb environment variables into the provider config's shell environment policy.
 * Returns a new object — does not mutate the input.
 */
export function withThreadEnvironmentPolicy(
  params: Record<string, unknown>,
  context: ProviderThreadContext,
): Record<string, unknown> {
  const entries: Record<string, string> = {};
  if (context.projectId) entries["shell_environment_policy.set.BB_PROJECT_ID"] = context.projectId;
  if (context.threadId) entries["shell_environment_policy.set.BB_THREAD_ID"] = context.threadId;
  if (context.serverUrl) entries["shell_environment_policy.set.BB_SERVER_URL"] = context.serverUrl;
  if (context.path) entries["shell_environment_policy.set.PATH"] = context.path;

  if (Object.keys(entries).length === 0) return params;

  return {
    ...params,
    config: { ...toRecord(params.config), ...entries },
  };
}

/** Safely read a value as a plain object. */
function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

// ---------------------------------------------------------------------------
// Dynamic tools
// ---------------------------------------------------------------------------

/** Clone dynamic tools for safe serialization to a provider process. */
export function cloneDynamicTools(
  dynamicTools?: ProviderDynamicTool[],
): Array<Record<string, unknown>> | undefined {
  if (!dynamicTools || dynamicTools.length === 0) return undefined;
  return dynamicTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: JSON.parse(JSON.stringify(tool.inputSchema)),
  }));
}
