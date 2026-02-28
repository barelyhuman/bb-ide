import {
  createProviderEventEnvelope,
  type ThreadEvent,
} from "@beanbag/agent-core";
import { describe, expect, it } from "vitest";
import {
  calculateContextWindowUsagePercent,
  extractThreadContextWindowUsage,
  formatCompactTokenCount,
} from "./thread-context-window-usage";

const EMPTY_TOKEN_BREAKDOWN = {
  totalTokens: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
};

function buildProviderEvent({
  seq,
  method,
  type = "thread/tokenUsage/updated",
  payload,
}: {
  seq: number;
  method: string;
  type?: ThreadEvent["type"];
  payload: unknown;
}): ThreadEvent {
  return {
    id: `event-${seq}`,
    threadId: "thread-1",
    seq,
    type,
    data: createProviderEventEnvelope({
      providerId: "codex",
      method,
      payload,
    }),
    createdAt: seq,
  };
}

describe("thread context window usage helpers", () => {
  it("extracts usage from the latest thread/tokenUsage/updated event", () => {
    const usage = extractThreadContextWindowUsage([
      buildProviderEvent({
        seq: 1,
        method: "thread/tokenUsage/updated",
        payload: {
          threadId: "provider-thread",
          turnId: "turn-1",
          tokenUsage: {
            total: {
              ...EMPTY_TOKEN_BREAKDOWN,
              totalTokens: 50000,
            },
            last: {
              ...EMPTY_TOKEN_BREAKDOWN,
              totalTokens: 9000,
            },
            modelContextWindow: 258400,
          },
        },
      }),
      buildProviderEvent({
        seq: 2,
        method: "thread/tokenUsage/updated",
        payload: {
          threadId: "provider-thread",
          turnId: "turn-2",
          tokenUsage: {
            total: {
              ...EMPTY_TOKEN_BREAKDOWN,
              totalTokens: 62000,
            },
            last: {
              ...EMPTY_TOKEN_BREAKDOWN,
              totalTokens: 32000,
            },
            modelContextWindow: 258400,
          },
        },
      }),
    ]);

    expect(usage).toEqual({
      totalTokens: 32000,
      modelContextWindow: 258400,
    });
  });

  it("falls back to task_started context window when token_count has no window", () => {
    const usage = extractThreadContextWindowUsage([
      buildProviderEvent({
        seq: 1,
        method: "codex/event/task_started",
        payload: {
          id: "turn-1",
          msg: {
            type: "task_started",
            model_context_window: 128000,
          },
        },
      }),
      buildProviderEvent({
        seq: 2,
        method: "codex/event/token_count",
        payload: {
          id: "turn-1",
          msg: {
            type: "token_count",
            info: {
              total_token_usage: {
                total_tokens: 4800,
              },
              model_context_window: null,
            },
          },
        },
      }),
    ]);

    expect(usage).toEqual({
      totalTokens: 4800,
      modelContextWindow: 128000,
    });
  });

  it("prefers last token usage over cumulative token usage for context sizing", () => {
    const usage = extractThreadContextWindowUsage([
      buildProviderEvent({
        seq: 1,
        method: "codex/event/token_count",
        payload: {
          id: "turn-9",
          msg: {
            type: "token_count",
            info: {
              total_token_usage: {
                total_tokens: 9000000,
              },
              last_token_usage: {
                total_tokens: 120000,
              },
              model_context_window: 258400,
            },
          },
        },
      }),
    ]);

    expect(usage).toEqual({
      totalTokens: 120000,
      modelContextWindow: 258400,
    });
  });

  it("returns null when context window data is unavailable", () => {
    const usage = extractThreadContextWindowUsage([
      buildProviderEvent({
        seq: 1,
        method: "codex/event/token_count",
        payload: {
          id: "turn-1",
          msg: {
            type: "token_count",
            info: null,
          },
        },
      }),
    ]);

    expect(usage).toBeNull();
  });

  it("formats compact token labels and usage percentages", () => {
    expect(formatCompactTokenCount(258400)).toBe("258k");
    expect(formatCompactTokenCount(999)).toBe("999");
    expect(calculateContextWindowUsagePercent({
      totalTokens: 32000,
      modelContextWindow: 258400,
    })).toBe(12);
  });
});
