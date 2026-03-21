import { extractErrorMessage } from "@bb/core";
import { renderTemplate } from "@bb/templates";
import { z } from "zod";
import { asNonEmptyString } from "./parse-utils.js";

const DEFAULT_API_KEY_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_CHATGPT_BASE_URL = "https://chatgpt.com/backend-api/codex";
const DEFAULT_TITLE_MODEL = "gpt-5.1-codex-mini";
const DEFAULT_RESPONSES_INSTRUCTIONS = renderTemplate(
  "openaiResponsesDefaultInstructions",
  {},
);
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_UPSTREAM_ERROR_LENGTH = 220;
const ERROR_EXTRACT_OPTS = {
  maxLength: MAX_UPSTREAM_ERROR_LENGTH,
  legacyKeys: ["error", "detail"] as const,
};

type ResponsesAuthMode = "apiKey" | "chatgpt";

interface ResolvedResponsesAuth {
  mode: ResponsesAuthMode;
  bearerToken: string;
  accountId?: string;
}

const openAIErrorPayloadSchema = z.object({
  error: z.object({ message: z.unknown().optional() }).optional(),
  message: z.unknown().optional(),
}).passthrough();

interface ParsedSseResponsePayload {
  text: string;
  responseId?: string;
}

const openAIResponseContentPartSchema = z.object({
  text: z.string().optional(),
  output_text: z.string().optional(),
}).passthrough();

const openAIResponseSchema = z.object({
  id: z.string().optional(),
  output_text: z.union([z.string(), z.array(z.string())]).optional(),
  output: z.array(z.object({
    content: z.array(openAIResponseContentPartSchema).optional(),
  }).passthrough()).optional(),
}).passthrough();

type DecodedOpenAIResponse = { id?: string; text: string };

const sseEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("response.output_text.delta"), delta: z.string() }),
  z.object({ type: z.literal("response.output_text.done"), text: z.string() }),
  z.object({ type: z.literal("response.created"), response: openAIResponseSchema }),
  z.object({ type: z.literal("response.in_progress"), response: openAIResponseSchema }),
  z.object({ type: z.literal("response.completed"), response: openAIResponseSchema }),
]);

type DecodedSseEvent = z.infer<typeof sseEventSchema>;

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

interface OpenAIResponsesRequestBody {
  model: string;
  input: string;
  instructions: string;
  stream: true;
  max_output_tokens?: number;
  temperature?: number;
}

function normalizeBaseUrl(authMode: ResponsesAuthMode): string {
  const raw = process.env.OPENAI_BASE_URL?.trim();
  if (!raw) {
    return authMode === "chatgpt" ? DEFAULT_CHATGPT_BASE_URL : DEFAULT_API_KEY_BASE_URL;
  }
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function resolveModel(model?: string): string {
  const fromArgs = model?.trim();
  if (fromArgs) return fromArgs;
  const fromEnv = process.env.BB_INFERENCE_MODEL?.trim();
  if (fromEnv) return fromEnv;
  return DEFAULT_TITLE_MODEL;
}

function parseUpstreamErrorMessage(rawBody: string): string | null {
  const normalized = rawBody.replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  if (normalized.startsWith("{") || normalized.startsWith("[")) {
    try {
      const parsed = openAIErrorPayloadSchema.safeParse(JSON.parse(normalized));
      if (parsed.success) {
        return (
          extractErrorMessage(parsed.data.error?.message, ERROR_EXTRACT_OPTS) ??
          extractErrorMessage(parsed.data.message, ERROR_EXTRACT_OPTS) ??
          extractErrorMessage(parsed.data, ERROR_EXTRACT_OPTS)
        );
      }
    } catch {
      return extractErrorMessage(normalized, ERROR_EXTRACT_OPTS);
    }
  }

  return extractErrorMessage(normalized, ERROR_EXTRACT_OPTS);
}

function isUnsupportedTemperatureError(message: string | null): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes("unsupported parameter") &&
    normalized.includes("temperature");
}

function decodeOpenAIResponse(value: unknown): DecodedOpenAIResponse | null {
  const parsed = openAIResponseSchema.safeParse(value);
  if (!parsed.success) return null;

  const { id, output_text, output } = parsed.data;

  if (typeof output_text === "string") {
    return { id: asNonEmptyString(id) ?? undefined, text: output_text };
  }

  if (Array.isArray(output_text)) {
    const joined = output_text.filter((s) => s.length > 0).join("");
    if (joined) {
      return { id: asNonEmptyString(id) ?? undefined, text: joined };
    }
  }

  const fragments: string[] = [];
  for (const item of output ?? []) {
    for (const part of item.content ?? []) {
      const text = asNonEmptyString(part.text) ?? asNonEmptyString(part.output_text);
      if (text) fragments.push(text);
    }
  }

  return { id: asNonEmptyString(id) ?? undefined, text: fragments.join("") };
}

function decodeSseEvent(value: unknown): DecodedSseEvent | null {
  const parsed = sseEventSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
}

function parseSseResponsePayload(rawBody: string): ParsedSseResponsePayload | null {
  if (!rawBody.includes("event:") || !rawBody.includes("data:")) {
    return null;
  }

  const blocks = rawBody.split(/\n\n+/);
  const textDeltas: string[] = [];
  const textDone: string[] = [];
  let textFromCompleted: string | null = null;
  let responseId: string | undefined;

  for (const block of blocks) {
    if (!block.trim()) continue;

    const dataLines = block
      .split("\n")
      .map((line) => line.trimStart())
      .filter((line) => line.startsWith("data:"));
    if (dataLines.length === 0) continue;

    const payloadRaw = dataLines
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n");
    if (!payloadRaw || payloadRaw === "[DONE]") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(payloadRaw);
    } catch {
      continue;
    }

    const event = decodeSseEvent(parsed);
    if (!event) continue;

    switch (event.type) {
      case "response.output_text.delta":
        textDeltas.push(event.delta);
        break;
      case "response.output_text.done":
        textDone.push(event.text);
        break;
      case "response.created":
      case "response.in_progress":
      case "response.completed": {
        const decoded = decodeOpenAIResponse(event.response);
        if (decoded) {
          responseId = decoded.id ?? responseId;
          if (decoded.text) {
            textFromCompleted = decoded.text;
          }
        }
        break;
      }
      default:
        event satisfies never;
    }
  }

  const text =
    textDone.join("") ||
    textDeltas.join("") ||
    textFromCompleted ||
    "";

  if (!text) return null;
  return { text, ...(responseId ? { responseId } : {}) };
}

async function resolveResponsesAuth(): Promise<ResolvedResponsesAuth> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (apiKey) {
    return {
      mode: "apiKey",
      bearerToken: apiKey,
    };
  }

  throw new Error("OpenAI auth is missing");
}

export async function generateOpenAIResponsesText(
  args: GenerateOpenAIResponsesTextArgs,
): Promise<GenerateOpenAIResponsesTextResult> {
  const auth = await resolveResponsesAuth();
  const model = resolveModel(args.model);
  const baseUrl = normalizeBaseUrl(auth.mode);
  const timeoutMs = Math.max(1, args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {
      authorization: `Bearer ${auth.bearerToken}`,
      "content-type": "application/json",
      ...(auth.accountId ? { "openai-account-id": auth.accountId } : {}),
    };
    const baseBody: OpenAIResponsesRequestBody = {
      model,
      input: args.prompt,
      instructions: DEFAULT_RESPONSES_INSTRUCTIONS,
      stream: true,
      ...(args.maxOutputTokens ? { max_output_tokens: args.maxOutputTokens } : {}),
      ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
    };

    const sendRequest = async (
      body: OpenAIResponsesRequestBody,
    ): Promise<GenerateOpenAIResponsesTextResult | null> => {
      const response = await fetch(`${baseUrl}/responses`, {
        method: "POST",
        signal: controller.signal,
        headers,
        body: JSON.stringify(body),
      });

      const rawBody = await response.text();
      if (!response.ok) {
        const message = parseUpstreamErrorMessage(rawBody);
        if (
          body.temperature !== undefined &&
          isUnsupportedTemperatureError(message)
        ) {
          return null;
        }
        throw new Error(message ?? `OpenAI error ${response.status}`);
      }

      const parsedSse = parseSseResponsePayload(rawBody);
      if (parsedSse) {
        return {
          text: parsedSse.text,
          model,
          ...(parsedSse.responseId ? { responseId: parsedSse.responseId } : {}),
        };
      }

      const decoded = decodeOpenAIResponse(JSON.parse(rawBody));
      if (!decoded?.text) {
        throw new Error("OpenAI response did not include output text");
      }

      return {
        text: decoded.text,
        model,
        ...(decoded.id ? { responseId: decoded.id } : {}),
      };
    };

    const firstAttempt = await sendRequest(baseBody);
    if (firstAttempt) {
      return firstAttempt;
    }

    const { temperature: _ignored, ...retryBody } = baseBody;
    const retryResult = await sendRequest(retryBody);
    if (!retryResult) {
      throw new Error("OpenAI responses request could not be retried without temperature");
    }
    return retryResult;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
