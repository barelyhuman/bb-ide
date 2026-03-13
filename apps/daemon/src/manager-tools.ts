import { toRecord } from "@beanbag/agent-core";
import { ProviderToolHost, type ProviderToolDefinition } from "@beanbag/agent-server";
import { invalidRequestError } from "./domain-errors.js";
import type { Orchestrator } from "./orchestrator.js";

const MESSAGE_USER_TOOL_NAME = "message_user";

function parseMessageUserArguments(args: unknown): { message: string } {
  const record = toRecord(args);
  const message = typeof record?.message === "string" ? record.message.trim() : "";
  if (message.length === 0) {
    throw invalidRequestError("message_user requires a non-empty message string");
  }
  return { message };
}

export function createManagerProviderToolHost(args: {
  getThreadManager: () => Orchestrator | undefined;
}): ProviderToolHost {
  const tools: ProviderToolDefinition[] = [
    {
      name: MESSAGE_USER_TOOL_NAME,
      description: "Send a user-visible message from the manager to the user.",
      inputSchema: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message to publish to the user.",
          },
        },
        required: ["message"],
        additionalProperties: false,
      },
      async execute({ call, context }) {
        const threadManager = args.getThreadManager();
        if (!threadManager) {
          throw new Error("Manager tool host is unavailable");
        }
        const parsed = parseMessageUserArguments(call.arguments);
        await threadManager.messageUser(context.threadId, {
          text: parsed.message,
          toolCallId: call.callId,
          turnId: call.turnId,
        });
        return "Message sent to the user.";
      },
    },
  ];

  return new ProviderToolHost(tools);
}
