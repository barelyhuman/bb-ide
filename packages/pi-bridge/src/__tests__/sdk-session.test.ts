import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSubscribe,
  mockPrompt,
  mockDispose,
  mockGetSessionStats,
  mockGetContextUsage,
  mockOpen,
  mockInMemory,
  mockSettingsInMemory,
  mockCreateAgentSession,
} = vi.hoisted(() => {
  const mockSubscribe = vi.fn(() => () => {});
  const mockPrompt = vi.fn();
  const mockDispose = vi.fn();
  const mockGetSessionStats = vi.fn();
  const mockGetContextUsage = vi.fn();
  const mockOpen = vi.fn((path: string) => ({ kind: "open", path }));
  const mockInMemory = vi.fn((cwd?: string) => ({ kind: "in-memory", cwd }));
  const mockSettingsInMemory = vi.fn(() => ({ kind: "settings" }));
  const mockCreateAgentSession = vi.fn(async () => ({
    session: {
      subscribe: mockSubscribe,
      prompt: mockPrompt,
      dispose: mockDispose,
      getSessionStats: mockGetSessionStats,
      getContextUsage: mockGetContextUsage,
      isStreaming: false,
    },
  }));

  return {
    mockSubscribe,
    mockPrompt,
    mockDispose,
    mockGetSessionStats,
    mockGetContextUsage,
    mockOpen,
    mockInMemory,
    mockSettingsInMemory,
    mockCreateAgentSession,
  };
});

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: mockCreateAgentSession,
  SessionManager: {
    open: mockOpen,
    inMemory: mockInMemory,
  },
  SettingsManager: {
    inMemory: mockSettingsInMemory,
  },
}));

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn(),
}));

import { PiSdkSession } from "../sdk-session.js";

describe("PiSdkSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens a persistent session file when provided", async () => {
    const session = new PiSdkSession(
      {
        cwd: "/tmp/project",
        sessionFilePath: "/tmp/pi-sessions/thread-1.jsonl",
      },
      vi.fn(),
      vi.fn(),
    );

    await session.start();

    expect(mockOpen).toHaveBeenCalledWith(
      "/tmp/pi-sessions/thread-1.jsonl",
      "/tmp/pi-sessions",
    );
    expect(mockInMemory).not.toHaveBeenCalled();
  });

  it("falls back to an in-memory session when no file path is provided", async () => {
    const session = new PiSdkSession(
      { cwd: "/tmp/project" },
      vi.fn(),
      vi.fn(),
    );

    await session.start();

    expect(mockInMemory).toHaveBeenCalledWith("/tmp/project");
    expect(mockOpen).not.toHaveBeenCalled();
  });
});
