import { describe, expect, it } from "vitest";
import {
  buildClaudeCodeAvailableModels,
  listFallbackClaudeCodeModels,
} from "./model-list.js";

describe("buildClaudeCodeAvailableModels", () => {
  it("builds the curated Claude alias catalog when 1M context is available", () => {
    expect(buildClaudeCodeAvailableModels([
      { value: "default" },
      { value: "sonnet" },
      { value: "sonnet[1m]" },
      { value: "haiku" },
    ])).toEqual([
      expect.objectContaining({
        id: "opus[1m]",
        model: "opus[1m]",
        displayName: "Opus 4.6 (1M)",
        description: "Opus 4.6 with 1M context for complex long coding sessions",
        isDefault: true,
      }),
      expect.objectContaining({
        id: "opus",
        model: "opus",
        displayName: "Opus 4.6",
        description: "Opus 4.6 for complex coding tasks",
        isDefault: false,
      }),
      expect.objectContaining({
        id: "sonnet[1m]",
        model: "sonnet[1m]",
        displayName: "Sonnet 4.6 (1M)",
        description: "Sonnet 4.6 with 1M context for long coding sessions",
        isDefault: false,
      }),
      expect.objectContaining({
        id: "sonnet",
        model: "sonnet",
        displayName: "Sonnet 4.6",
        description: "Sonnet 4.6 for everyday coding tasks",
        isDefault: false,
      }),
      expect.objectContaining({
        id: "haiku",
        model: "haiku",
        displayName: "Haiku 4.5",
        description: "Haiku 4.5 for quick answers",
        isDefault: false,
      }),
    ]);
  });

  it("hides 1M models when the SDK catalog has no 1M entries", () => {
    const models = buildClaudeCodeAvailableModels([
      { value: "default" },
      { value: "sonnet" },
      { value: "haiku" },
    ]);

    expect(models.map((model) => model.model)).toEqual([
      "opus",
      "sonnet",
      "haiku",
    ]);
    expect(models).toEqual([
      expect.objectContaining({
        id: "opus",
        model: "opus",
        displayName: "Opus 4.6",
        isDefault: true,
      }),
      expect.objectContaining({
        id: "sonnet",
        model: "sonnet",
        displayName: "Sonnet 4.6",
        isDefault: false,
      }),
      expect.objectContaining({
        id: "haiku",
        model: "haiku",
        displayName: "Haiku 4.5",
        isDefault: false,
      }),
    ]);
  });

  it("never exposes the Claude SDK default alias", () => {
    const models = buildClaudeCodeAvailableModels([
      { value: "default" },
      { value: "sonnet[1m]" },
    ]);

    expect(models.some((model) => model.model === "default")).toBe(false);
  });
});

describe("listFallbackClaudeCodeModels", () => {
  it("uses the non-1M curated catalog for SDK probe failures", () => {
    expect(listFallbackClaudeCodeModels().map((model) => model.model)).toEqual([
      "opus",
      "sonnet",
      "haiku",
    ]);
  });
});
