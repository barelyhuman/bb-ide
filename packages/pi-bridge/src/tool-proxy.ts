import { Type } from "@mariozechner/pi-ai";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

export interface DynamicToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

export type ToolCallForwarder = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<{ content: string; isError?: boolean }>;

/**
 * Builds Pi-compatible ToolDefinition objects from dynamic tool definitions
 * that forward execution back to the daemon via the bridge protocol.
 */
export function buildDynamicTools(
  dynamicTools: DynamicToolDefinition[],
  forwardToolCall: ToolCallForwarder,
): ToolDefinition[] {
  return dynamicTools.map((def) => {
    const parameters = buildTypeBoxSchema(def.inputSchema);
    return {
      name: def.name,
      label: def.name,
      description: def.description,
      parameters,
      async execute(
        _toolCallId: string,
        params: Record<string, unknown>,
        _signal: AbortSignal | undefined,
      ) {
        const result = await forwardToolCall(def.name, params);
        return {
          content: [{ type: "text" as const, text: result.content }],
          details: {},
          ...(result.isError ? { isError: true } : {}),
        };
      },
    } as ToolDefinition;
  });
}

function buildTypeBoxSchema(inputSchema: unknown): ReturnType<typeof Type.Object> {
  if (
    !inputSchema ||
    typeof inputSchema !== "object" ||
    !("properties" in inputSchema)
  ) {
    return Type.Object({});
  }

  const schema = inputSchema as {
    properties?: Record<string, { type?: string }>;
  };

  if (!schema.properties) return Type.Object({});

  const shape: Record<string, ReturnType<typeof Type.String | typeof Type.Number | typeof Type.Boolean | typeof Type.Unknown>> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    switch (prop?.type) {
      case "string":
        shape[key] = Type.Optional(Type.String());
        break;
      case "number":
      case "integer":
        shape[key] = Type.Optional(Type.Number());
        break;
      case "boolean":
        shape[key] = Type.Optional(Type.Boolean());
        break;
      default:
        shape[key] = Type.Optional(Type.Unknown());
        break;
    }
  }

  return Type.Object(shape);
}
