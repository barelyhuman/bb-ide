import { createApiClient, type ApiClient } from "@bb/server-contract";
import { extractErrorMessage } from "@bb/core-ui";

export function createClient(baseUrl: string): ApiClient {
  return createApiClient(baseUrl);
}

export type Client = ReturnType<typeof createClient>;

function isTypeErrorWithCauseCode(err: unknown, expectedCode: string): boolean {
  if (!(err instanceof TypeError)) {
    return false;
  }
  const { cause } = err as Error & { cause?: unknown };
  if (!cause || typeof cause !== "object") {
    return false;
  }
  return "code" in cause && cause.code === expectedCode;
}

const ERROR_EXTRACT_OPTS = { legacyKeys: ["detail"] as const };

async function readHttpErrorMessage(res: Response): Promise<string> {
  const rawBody = await res.text().catch(() => "");
  const normalized = rawBody.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return res.statusText;
  }

  const contentType = res.headers.get("content-type");
  const shouldParseJson =
    (contentType?.includes("application/json") ?? false) ||
    normalized.startsWith("{") ||
    normalized.startsWith("[");
  if (!shouldParseJson) {
    return normalized;
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    return extractErrorMessage(parsed, ERROR_EXTRACT_OPTS) ?? normalized;
  } catch {
    return normalized;
  }
}

export async function unwrap<T>(
  responsePromise: Promise<Response>,
): Promise<T> {
  const res = await resolveResponse(responsePromise);
  const text = await res.text();
  return JSON.parse(text) as T;
}

export async function unwrapVoid(
  responsePromise: Promise<Response>,
): Promise<void> {
  await resolveResponse(responsePromise);
}

async function resolveResponse(
  responsePromise: Promise<Response>,
): Promise<Response> {
  let res: Response;
  try {
    res = await responsePromise;
  } catch (err) {
    if (isTypeErrorWithCauseCode(err, "ECONNREFUSED")) {
      throw new Error(
        "Cannot connect to BB server. Ensure it is running and BB_SERVER_URL is correct.",
      );
    }
    throw err;
  }
  if (!res.ok) {
    const message = await readHttpErrorMessage(res);
    throw new Error(`HTTP ${res.status}: ${message}`);
  }
  return res;
}
