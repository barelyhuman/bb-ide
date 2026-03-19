import { describe, expect, it } from "vitest";
import { decodePersistedEnvironmentDaemonCommand } from "../environment-daemon-command-decoder.js";

describe("decodePersistedEnvironmentDaemonCommand", () => {
  it("preserves dynamic tools on thread.resume commands", () => {
    const command = decodePersistedEnvironmentDaemonCommand({
      commandType: "thread.resume",
      payload: {
        type: "thread.resume",
        threadId: "thread-1",
        projectId: "project-1",
        providerThreadId: "provider-thread-1",
        context: {
          projectId: "project-1",
          threadId: "thread-1",
          serverUrl: "http://127.0.0.1:4311",
        },
        dynamicTools: [
          {
            name: "message_user",
            description: "Send a user-visible message.",
            inputSchema: {
              type: "object",
              properties: {
                message: { type: "string" },
              },
              required: ["message"],
            },
          },
        ],
      },
    });

    expect(command).toMatchObject({
      type: "thread.resume",
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      dynamicTools: [
        {
          name: "message_user",
          description: "Send a user-visible message.",
        },
      ],
    });
  });
});
