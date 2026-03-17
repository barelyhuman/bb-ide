import { describe, expect, it } from "vitest";
import {
  createProviderAdapter,
  listAvailableProviderInfos,
} from "../provider-registry.js";

describe("provider registry", () => {
  it("creates codex provider with expected process command and args", () => {
    const provider = createProviderAdapter({ providerId: "codex" });
    expect(provider.id).toBe("codex");
    expect(provider.processCommand).toBe("codex");
    expect(provider.processArgs).toEqual(["app-server"]);
  });

  it("creates claude-code provider with expected process command and args", () => {
    const provider = createProviderAdapter({ providerId: "claude-code" });
    expect(provider.id).toBe("claude-code");
    expect(provider.processCommand).toBe("node");
    expect(provider.processArgs).toHaveLength(1);
    expect(provider.processArgs[0]).toMatch(/claude-code-bridge\/dist\/bridge\.js$/);
  });

  it("creates pi provider with expected process command and args", () => {
    const provider = createProviderAdapter({ providerId: "pi" });
    expect(provider.id).toBe("pi");
    expect(provider.processCommand).toBe("node");
    expect(provider.processArgs).toHaveLength(1);
    expect(provider.processArgs[0]).toMatch(/pi-bridge\/dist\/bridge\.js$/);
  });

  it("rejects unsupported adapters", () => {
    expect(() => createProviderAdapter({ providerId: "pi-mono" })).toThrow(
      'Unsupported provider "pi-mono"',
    );
  });

  it("lists provider catalog", () => {
    const ids = listAvailableProviderInfos().map((provider) => provider.id);
    expect(ids).toEqual(["codex", "claude-code", "pi"]);
  });
});
