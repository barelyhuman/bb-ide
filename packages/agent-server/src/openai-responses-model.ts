import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TITLE_MODEL = "gpt-5.1-codex-mini";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_UPSTREAM_ERROR_LENGTH = 220;

interface CodexAuthFile {
  OPENAI_API_KEY?: unknown;
}

interface OpenAIResponsesErrorPayload {
  error?: {
    message?: unknown;
  };
  message?: unknown;
}

export interface GenerateOpenAIResponsesTextArgs {
  prompt: string;
  model?: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface GenerateOpenAIResponsesTextResult {
  text: string;
  model: string;
  responseId?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeBaseUrl(): string {
  const raw = process.env.OPENAI_BASE_URL?.trim();
  if (!raw) return DEFAULT_OPENAI_BASE_URL;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function resolveModel(model?: string): string {
  const fromArgs = model?.trim();
  if (fromArgs) return fromArgs;
  const fromEnv = process.env.BB_INFERENCE_MODEL?.trim();
  if (fromEnv) return fromEnv;
  return DEFAULT_TITLE_MODEL;
}

function normalizeErrorText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function truncateErrorText(raw: string): string {
  return raw.length > MAX_UPSTREAM_ERROR_LENGTH
    ? `${raw.slice(0, MAX_UPSTREAM_ERROR_LENGTH - 1)}...`
    : raw;
}

function extractErrorMessage(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = normalizeErrorText(value);
    return normalized.length > 0 ? truncateErrorText(normalized) : null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const message = extractErrorMessage(entry);
      if (message) return message;
    }
    return null;
  }

  const record = asRecord(value);
  if (!record) return null;

  const candidates = [record.message, record.error, record.detail];
  for (const candidate of candidates) {
    const message = extractErrorMessage(candidate);
    if (message) return message;
  }

  return null;
}

function parseUpstreamErrorMessage(rawBody: string): string | null {
  const normalized = normalizeErrorText(rawBody);
  if (!normalized) return null;

  if (normalized.startsWith("{") || normalized.startsWith("[")) {
    try {
      const parsed = JSON.parse(normalized) as OpenAIResponsesErrorPayload;
      return (
        extractErrorMessage(parsed.error?.message) ??
        extractErrorMessage(parsed.message) ??
        extractErrorMessage(parsed)
      );
    } catch {
      return truncateErrorText(normalized);
    }
  }

  return truncateErrorText(normalized);
}

function collectOutputText(payload: Record<string, unknown>): string {
  const direct = payload.output_text;
  if (typeof direct === "string") return direct;
  if (Array.isArray(direct)) {
    const fragments = direct
      .map((entry) => (typeof entry === "string" ? entry : ""))
      .filter((entry) => entry.length > 0);
    if (fragments.length > 0) return fragments.join("");
  }

  const output = payload.output;
  if (!Array.isArray(output)) return "";

  const fragments: string[] = [];
  for (const item of output) {
    const outputItem = asRecord(item);
    if (!outputItem) continue;
    const content = outputItem.content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      const contentPart = asRecord(part);
      if (!contentPart) continue;
      if (typeof contentPart.text === "string" && contentPart.text.length > 0) {
        fragments.push(contentPart.text);
        continue;
      }
      if (
        typeof contentPart.output_text === "string" &&
        contentPart.output_text.length > 0
      ) {
        fragments.push(contentPart.output_text);
      }
    }
  }

  return fragments.join("");
}

async function readCodexAuthFile(): Promise<CodexAuthFile | null> {
  const authPath = resolve(homedir(), ".codex", "auth.json");
  try {
    const raw = await readFile(authPath, "utf8");
    const parsed = JSON.parse(raw);
    return asRecord(parsed) as CodexAuthFile | null;
  } catch {
    return null;
  }
}

function resolveApiKeyFromAuthFile(authFile: CodexAuthFile | null): string | null {
  const apiKeyFromEnv = process.env.OPENAI_API_KEY?.trim();
  if (apiKeyFromEnv) return apiKeyFromEnv;

  const maybeApiKey = authFile?.OPENAI_API_KEY;
  if (typeof maybeApiKey === "string" && maybeApiKey.trim().length > 0) {
    return maybeApiKey.trim();
  }

  if (
    maybeApiKey &&
    typeof maybeApiKey === "object" &&
    "value" in maybeApiKey &&
    typeof (maybeApiKey as { value?: unknown }).value === "string"
  ) {
    const value = (maybeApiKey as { value: string }).value.trim();
    if (value.length > 0) return value;
  }

  return null;
}

async function resolveOpenAIApiKey(): Promise<string | null> {
  const authFile = await readCodexAuthFile();
  return resolveApiKeyFromAuthFile(authFile);
}

export async function generateOpenAIResponsesText(
  args: GenerateOpenAIResponsesTextArgs,
): Promise<GenerateOpenAIResponsesTextResult> {
  const prompt = args.prompt.trim();
  if (!prompt) {
    throw new Error("OpenAI responses prompt cannot be empty.");
  }

  const apiKey = await resolveOpenAIApiKey();
  if (!apiKey) {
    throw new Error(
      "OpenAI API key is missing. Set OPENAI_API_KEY or run `codex login` with an API key saved in ~/.codex/auth.json.",
    );
  }

  const timeoutMs = Math.max(1, args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const model = resolveModel(args.model);
  const endpoint = `${normalizeBaseUrl()}/responses`;
  const requestBody: Record<string, unknown> = {
    model,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      },
    ],
    store: false,
  };

  if (args.maxOutputTokens !== undefined) {
    requestBody.max_output_tokens = args.maxOutputTokens;
  }
  if (args.temperature !== undefined) {
    requestBody.temperature = args.temperature;
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "beanbag-agent-server/openai-responses",
      },
      body: JSON.stringify(requestBody),
      signal: abortController.signal,
    });

    const rawBody = await response.text();
    const payload = rawBody ? (JSON.parse(rawBody) as unknown) : null;
    const payloadRecord = asRecord(payload);
    const responseId =
      payloadRecord && typeof payloadRecord.id === "string" ? payloadRecord.id : undefined;

    if (!response.ok) {
      const upstreamMessage =
        parseUpstreamErrorMessage(rawBody) ?? `request failed with status ${response.status}`;
      throw new Error(`OpenAI responses request failed: ${upstreamMessage}`);
    }

    if (!payloadRecord) {
      throw new Error("OpenAI responses returned an invalid JSON payload.");
    }

    const text = collectOutputText(payloadRecord).trim();
    if (!text) {
      throw new Error("OpenAI responses returned no text content.");
    }

    return {
      text,
      model,
      responseId,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.message.includes("aborted"))
    ) {
      throw new Error(`OpenAI responses request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
