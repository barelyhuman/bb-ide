import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AvailableModel, ThreadEvent } from "@beanbag/core";

vi.mock("../codex-models.js", () => ({
  listCodexModels: vi.fn(),
}));

import { listCodexModels } from "../codex-models.js";
import { createCodexProviderAdapter } from "../codex-provider-adapter.js";

function makeEvent(overrides: Partial<ThreadEvent> = {}): ThreadEvent {
  return {
    id: "evt-1",
    threadId: "thread-1",
    seq: 1,
    type: "turn/start",
    data: {},
    createdAt: 1000,
    ...overrides,
  };
}

describe("codex provider adapter", () => {
  const mockedListCodexModels = listCodexModels as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("canonicalizes turn lifecycle events", () => {
    const adapter = createCodexProviderAdapter();

    expect(
      adapter.toCanonicalEvent(
        makeEvent({
          type: "turn/start",
          data: {
            turnId: "turn-1",
            input: [{ type: "text", text: "Hello" }],
          },
        }),
      ),
    ).toEqual(
      makeEvent({
        type: "turn/started",
        data: {
          turnId: "turn-1",
          input: [{ type: "text", text: "Hello" }],
        },
      }),
    );

    expect(
      adapter.toCanonicalEvent(
        makeEvent({
          id: "evt-2",
          seq: 2,
          type: "turn/end",
          data: { turnId: "turn-1" },
        }),
      ),
    ).toEqual(
      makeEvent({
        id: "evt-2",
        seq: 2,
        type: "turn/completed",
        data: { turnId: "turn-1" },
      }),
    );
  });

  it("canonicalizes completed message events", () => {
    const adapter = createCodexProviderAdapter();

    const userEvent = adapter.toCanonicalEvent(
      makeEvent({
        type: "item/completed",
        data: {
          turnId: "turn-1",
          item: {
            id: "u-1",
            type: "userMessage",
            content: [
              { type: "inputText", text: "Can you fix this?" },
              { type: "localImage", path: "/tmp/screenshot.png" },
            ],
          },
        },
      }),
    );

    expect(userEvent.type).toBe("message/user");
    expect(userEvent.data).toEqual({
      role: "user",
      turnId: "turn-1",
      itemId: "u-1",
      text: "Can you fix this?",
      attachments: {
        webImages: 0,
        localImages: 1,
      },
    });

    const assistantEvent = adapter.toCanonicalEvent(
      makeEvent({
        id: "evt-2",
        seq: 2,
        type: "item/completed",
        data: {
          turnId: "turn-1",
          item: {
            id: "a-1",
            type: "agentMessage",
            text: "Implemented the fix.",
          },
        },
      }),
    );

    expect(assistantEvent.type).toBe("message/assistant");
    expect(assistantEvent.data).toEqual({
      role: "assistant",
      turnId: "turn-1",
      itemId: "a-1",
      text: "Implemented the fix.",
    });
  });

  it("canonicalizes delta, title, and unknown provider events", () => {
    const adapter = createCodexProviderAdapter();

    expect(
      adapter.toCanonicalEvent(
        makeEvent({
          type: "item/agentMessage/delta",
          data: { turnId: "turn-1", itemId: "a-1", delta: "hello" },
        }),
      ),
    ).toEqual(
      makeEvent({
        type: "message/assistant/delta",
        data: {
          role: "assistant",
          turnId: "turn-1",
          itemId: "a-1",
          text: "hello",
          delta: "hello",
        },
      }),
    );

    expect(
      adapter.toCanonicalEvent(
        makeEvent({
          id: "evt-2",
          seq: 2,
          type: "thread/name/updated",
          data: { threadName: "  Better title  " },
        }),
      ),
    ).toEqual(
      makeEvent({
        id: "evt-2",
        seq: 2,
        type: "thread/title/updated",
        data: { title: "Better title" },
      }),
    );

    const providerEvent = adapter.toCanonicalEvent(
      makeEvent({
        id: "evt-3",
        seq: 3,
        type: "item/started",
        data: { item: { id: "x" } },
      }),
    );
    expect(providerEvent.type).toBe("provider/event");
    expect(providerEvent.data).toEqual({
      provider: "codex",
      providerEventType: "item/started",
      payload: { item: { id: "x" } },
    });
  });

  it("canonicalizes command execution events into tool call lifecycle events", () => {
    const adapter = createCodexProviderAdapter();

    expect(
      adapter.toCanonicalEvent(
        makeEvent({
          type: "codex/event/exec_command_begin",
          data: {
            msg: {
              type: "exec_command_begin",
              call_id: "call-1",
              command: ["bash", "-lc", "pwd"],
            },
            cwd: "/repo",
          },
        }),
      ),
    ).toEqual(
      makeEvent({
        type: "tool/call/started",
        data: {
          toolName: "exec_command",
          callId: "call-1",
          command: "bash -lc pwd",
          cwd: "/repo",
        },
      }),
    );

    expect(
      adapter.toCanonicalEvent(
        makeEvent({
          id: "evt-2",
          seq: 2,
          type: "item/started",
          data: {
            turnId: "turn-1",
            item: {
              type: "commandExecution",
              id: "call-2",
              command: "npm test",
              cwd: "/repo",
            },
          },
        }),
      ),
    ).toEqual(
      makeEvent({
        id: "evt-2",
        seq: 2,
        type: "tool/call/started",
        data: {
          toolName: "exec_command",
          turnId: "turn-1",
          callId: "call-2",
          command: "npm test",
          cwd: "/repo",
        },
      }),
    );

    expect(
      adapter.toCanonicalEvent(
        makeEvent({
          id: "evt-3",
          seq: 3,
          type: "codex/event/exec_command_end",
          data: {
            msg: {
              type: "exec_command_end",
              call_id: "call-1",
              exit_code: 0,
              status: "completed",
              stdout: "ok",
            },
          },
        }),
      ),
    ).toEqual(
      makeEvent({
        id: "evt-3",
        seq: 3,
        type: "tool/call/completed",
        data: {
          toolName: "exec_command",
          callId: "call-1",
          status: "completed",
          exitCode: 0,
          output: "ok",
        },
      }),
    );

    expect(
      adapter.toCanonicalEvent(
        makeEvent({
          id: "evt-4",
          seq: 4,
          type: "item/completed",
          data: {
            item: {
              type: "commandExecution",
              id: "call-2",
              status: "completed",
              exitCode: 0,
              output: "ok",
            },
          },
        }),
      ),
    ).toEqual(
      makeEvent({
        id: "evt-4",
        seq: 4,
        type: "tool/call/completed",
        data: {
          toolName: "exec_command",
          callId: "call-2",
          status: "completed",
          exitCode: 0,
          output: "ok",
        },
      }),
    );
  });

  it("extracts output from canonical assistant events", () => {
    const adapter = createCodexProviderAdapter();

    const output = adapter.outputFromEvent(
      makeEvent({
        type: "message/assistant",
        data: { text: "Final answer" },
      }),
    );

    expect(output).toBe("Final answer");
  });

  it("lists models via codex model provider", async () => {
    const models: AvailableModel[] = [
      {
        id: "gpt-5.2-codex",
        model: "gpt-5.2-codex",
        displayName: "gpt-5.2-codex",
        description: "Frontier coding model",
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "Low effort" },
          { reasoningEffort: "medium", description: "Medium effort" },
        ],
        defaultReasoningEffort: "medium",
        isDefault: true,
      },
    ];
    mockedListCodexModels.mockResolvedValue(models);

    const adapter = createCodexProviderAdapter();
    await expect(adapter.listModels()).resolves.toEqual(models);
    expect(mockedListCodexModels).toHaveBeenCalledTimes(1);
  });
});
