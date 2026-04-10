import { describe, expect, it } from "vitest";
import { createProviderForId } from "./provider-registry.js";

const providerIds = ["codex", "claude-code", "pi"] as const;

describe("provider cwd plumbing", () => {
  for (const providerId of providerIds) {
    it(`${providerId} includes cwd in thread/start`, () => {
      const adapter = createProviderForId(providerId);
      const command = adapter.buildCommand({
        type: "thread/start",
        threadId: "bb-thread-1",
        cwd: "/tmp/worktree",
      });

      expect(command).toMatchObject({
        jsonrpc: "2.0",
        method: "thread/start",
        params: {
          cwd: "/tmp/worktree",
        },
      });
    });

    it(`${providerId} includes cwd in thread/resume`, () => {
      const adapter = createProviderForId(providerId);
      const command = adapter.buildCommand({
        type: "thread/resume",
        threadId: "bb-thread-1",
        providerThreadId: "provider-thread-1",
        cwd: "/tmp/worktree",
      });

      expect(command).toMatchObject({
        jsonrpc: "2.0",
        method: "thread/resume",
        params: {
          cwd: "/tmp/worktree",
        },
      });
    });
  }
});
