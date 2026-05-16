import { describe, expect, it } from "vitest";
import {
  getBuiltInAgentProviderInfo,
  listBuiltInAgentProviderInfos,
  PI_DEFAULT_MODEL_PER_PROVIDER,
  resolvePiDefaultModelId,
} from "../src/index.js";

describe("agent provider catalog", () => {
  it("lists built-in providers with shared display metadata", () => {
    expect(listBuiltInAgentProviderInfos()).toEqual([
      {
        id: "codex",
        displayName: "Codex",
        capabilities: {
          supportsArchive: true,
          supportsRename: true,
          supportsServiceTier: true,
          supportsUserQuestion: false,
          supportedPermissionModes: ["full", "workspace-write", "readonly"],
        },
        available: true,
      },
      {
        id: "claude-code",
        displayName: "Claude Code",
        capabilities: {
          supportsArchive: false,
          supportsRename: false,
          supportsServiceTier: false,
          supportsUserQuestion: true,
          supportedPermissionModes: ["full", "workspace-write", "readonly"],
        },
        available: true,
      },
      {
        id: "pi",
        displayName: "Pi",
        capabilities: {
          supportsArchive: false,
          supportsRename: false,
          supportsServiceTier: false,
          supportsUserQuestion: false,
          supportedPermissionModes: ["full"],
        },
        available: true,
      },
    ]);
  });

  it("returns cloned catalog entries", () => {
    const provider = getBuiltInAgentProviderInfo("codex");
    provider.displayName = "Mutated";

    expect(getBuiltInAgentProviderInfo("codex").displayName).toBe("Codex");
  });

  it("exposes pi default model declarations", () => {
    expect(PI_DEFAULT_MODEL_PER_PROVIDER["openai-codex"]).toBe("gpt-5.5");
    expect(resolvePiDefaultModelId("anthropic")).toBe("claude-opus-4-7");
  });
});
