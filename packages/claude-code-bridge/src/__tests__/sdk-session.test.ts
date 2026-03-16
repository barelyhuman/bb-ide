import { describe, expect, it, vi, beforeEach } from "vitest";

const mockQueryInstance = {
  close: vi.fn(),
  interrupt: vi.fn(),
  [Symbol.asyncIterator]: vi.fn(),
};

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => mockQueryInstance),
}));

import { SdkSession, type SdkSessionOptions } from "../sdk-session.js";

const defaultOptions: SdkSessionOptions = {
  cwd: "/tmp/test",
  systemPrompt: "You are a test assistant.",
};

describe("SdkSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Make the query async iterable return immediately
    mockQueryInstance[Symbol.asyncIterator].mockReturnValue({
      next: vi.fn().mockResolvedValue({ value: undefined, done: true }),
      return: vi.fn().mockResolvedValue({ value: undefined, done: true }),
    });
  });

  it("starts with no session id", () => {
    const onMessage = vi.fn();
    const onDone = vi.fn();
    const session = new SdkSession(defaultOptions, onMessage, onDone);
    expect(session.getSessionId()).toBeUndefined();
    expect(session.getIsProcessing()).toBe(false);
  });

  it("pushInput queues messages before start", () => {
    const onMessage = vi.fn();
    const onDone = vi.fn();
    const session = new SdkSession(defaultOptions, onMessage, onDone);
    // Should not throw before start
    session.pushInput("hello");
  });

  it("stop cleans up state", () => {
    const onMessage = vi.fn();
    const onDone = vi.fn();
    const session = new SdkSession(defaultOptions, onMessage, onDone);
    session.start();
    session.stop();
    expect(mockQueryInstance.close).toHaveBeenCalled();
    expect(session.getIsProcessing()).toBe(false);
  });
});
