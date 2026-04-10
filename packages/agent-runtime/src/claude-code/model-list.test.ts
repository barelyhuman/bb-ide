import { describe, expect, it } from "vitest";
import {
  buildClaudeCodeAvailableModels,
  listFallbackClaudeCodeModels,
} from "./model-list.js";

describe("buildClaudeCodeAvailableModels", () => {
  it("builds the curated Claude alias catalog when 1M context is available", () => {
    expect(buildClaudeCodeAvailableModels([
      {
        value: "default",
        displayName: "Default (recommended)",
        description: "Opus 4.6 with 1M context [NEW] · Most capable for complex work",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "max"],
      },
      {
        value: "sonnet",
        displayName: "Sonnet",
        description: "Sonnet 4.6 · Best for everyday tasks",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high"],
      },
      {
        value: "sonnet[1m]",
        displayName: "Sonnet (1M context)",
        description: "Sonnet 4.6 with 1M context · Billed as extra usage",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high"],
      },
      {
        value: "haiku",
        displayName: "Haiku",
        description: "Haiku 4.5 · Fastest for quick answers",
      },
    ])).toEqual([
      expect.objectContaining({
        id: "sonnet[1m]",
        model: "sonnet[1m]",
        displayName: "Sonnet 4.6 (1M)",
        description: "Sonnet 4.6 with 1M context · Billed as extra usage",
        isDefault: true,
      }),
      expect.objectContaining({
        id: "sonnet",
        model: "sonnet",
        displayName: "Sonnet 4.6",
        description: "Sonnet 4.6 · Best for everyday tasks",
        isDefault: false,
      }),
      expect.objectContaining({
        id: "opus[1m]",
        model: "opus[1m]",
        displayName: "Opus 4.6 (1M)",
        description: "Opus 4.6 with 1M context for complex long coding sessions",
        isDefault: false,
      }),
      expect.objectContaining({
        id: "opus",
        model: "opus",
        displayName: "Opus 4.6",
        description: "Opus 4.6 for complex coding tasks",
        isDefault: false,
      }),
    ]);
  });

  it("hides 1M models when the SDK catalog has no 1M entries", () => {
    const models = buildClaudeCodeAvailableModels([
      {
        value: "default",
        displayName: "Default (recommended)",
        description: "Opus 4.6 · Most capable for complex work",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "max"],
      },
      {
        value: "sonnet",
        displayName: "Sonnet",
        description: "Sonnet 4.6 · Best for everyday tasks",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high"],
      },
    ]);

    expect(models.map((model) => model.model)).toEqual([
      "sonnet",
      "opus",
    ]);
    expect(models).toEqual([
      expect.objectContaining({
        id: "sonnet",
        model: "sonnet",
        displayName: "Sonnet 4.6",
        isDefault: true,
      }),
      expect.objectContaining({
        id: "opus",
        model: "opus",
        displayName: "Opus 4.6",
        isDefault: false,
      }),
    ]);
  });

  it("never exposes the Claude SDK default alias", () => {
    const models = buildClaudeCodeAvailableModels([
      {
        value: "default",
        displayName: "Default (recommended)",
        description: "Opus 4.6 with 1M context [NEW] · Most capable for complex work",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "max"],
      },
      {
        value: "sonnet[1m]",
        displayName: "Sonnet (1M context)",
        description: "Sonnet 4.6 with 1M context · Billed as extra usage",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high"],
      },
    ]);

    expect(models.some((model) => model.model === "default")).toBe(false);
  });
});

describe("listFallbackClaudeCodeModels", () => {
  it("uses the non-1M curated catalog for SDK probe failures", () => {
    expect(listFallbackClaudeCodeModels().map((model) => model.model)).toEqual([
      "sonnet",
      "opus",
    ]);
  });
});
