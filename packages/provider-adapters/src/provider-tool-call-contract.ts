import { z } from "zod";
import type {
  ProviderToolCallRequest,
  ProviderToolCallResponse,
} from "./provider-adapter.js";

const providerToolCallRequestSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  callId: z.string().min(1),
  tool: z.string().min(1),
  arguments: z.unknown(),
});

export const providerToolCallResponseSchema = z.object({
  success: z.boolean(),
  contentItems: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("inputText"),
        text: z.string(),
      }),
      z.object({
        type: z.literal("inputImage"),
        imageUrl: z.string().min(1),
      }),
    ]),
  ),
});

export function decodeProviderToolCallRequest(
  requestId: string | number,
  method: string,
  params: unknown,
): ProviderToolCallRequest | null {
  if (method !== "item/tool/call") {
    return null;
  }

  const parsed = providerToolCallRequestSchema.safeParse(params);
  if (!parsed.success) {
    return null;
  }

  return {
    requestId,
    ...parsed.data,
  };
}

export function encodeProviderToolCallResponse(
  response: ProviderToolCallResponse,
): ProviderToolCallResponse {
  return providerToolCallResponseSchema.parse(response);
}
