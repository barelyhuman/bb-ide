import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the Agent SDK before importing bridge modules
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
  createSdkMcpServer: vi.fn(() => ({})),
  tool: vi.fn((_name, _desc, _schema, handler) => handler),
}));

import { BRIDGE_METHODS } from "../bridge.js";

describe("bridge", () => {
  it("exports expected RPC methods", () => {
    expect(BRIDGE_METHODS).toContain("initialize");
    expect(BRIDGE_METHODS).toContain("thread/start");
    expect(BRIDGE_METHODS).toContain("thread/resume");
    expect(BRIDGE_METHODS).toContain("turn/start");
    expect(BRIDGE_METHODS).toContain("turn/steer");
    expect(BRIDGE_METHODS).toContain("thread/stop");
  });
});
