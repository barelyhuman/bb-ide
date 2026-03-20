import { z } from "zod";

const jsonRpcErrorSchema = z.object({
  code: z.number(),
  message: z.string().optional(),
  data: z.unknown().optional(),
});

const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});

const jsonRpcSuccessResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  result: z.unknown(),
});

const jsonRpcErrorResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  error: jsonRpcErrorSchema,
});

const toolCallResultSchema = z.object({
  success: z.boolean().optional(),
  contentItems: z
    .array(
      z.object({
        type: z.string(),
        text: z.string().optional(),
      }),
    )
    .optional(),
});

export type BridgeJsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>;
export type BridgeJsonRpcResponse =
  | z.infer<typeof jsonRpcSuccessResponseSchema>
  | z.infer<typeof jsonRpcErrorResponseSchema>;

export function decodeBridgeJsonRpcRequest(input: unknown): BridgeJsonRpcRequest | null {
  const parsed = jsonRpcRequestSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function decodeBridgeJsonRpcResponse(input: unknown): BridgeJsonRpcResponse | null {
  const error = jsonRpcErrorResponseSchema.safeParse(input);
  if (error.success) return error.data;

  const success = jsonRpcSuccessResponseSchema.safeParse(input);
  return success.success ? success.data : null;
}

export function decodeToolCallResponsePayload(result: unknown): {
  content: string;
  isError: boolean;
} {
  const parsed = toolCallResultSchema.safeParse(result);
  if (!parsed.success) {
    return { content: "OK", isError: false };
  }

  const text =
    parsed.data.contentItems
      ?.filter((item) => item.type === "inputText" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n") ?? "";

  return {
    content: text || "OK",
    isError: parsed.data.success === false,
  };
}
