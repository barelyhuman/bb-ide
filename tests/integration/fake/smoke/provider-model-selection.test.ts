import { describe, expect, it } from "vitest";
import type { AvailableModel } from "@bb/domain";
import { resolvePreferredTestModel } from "@bb/test-helpers";

function availableModel(model: string, isDefault: boolean): AvailableModel {
  return {
    id: model,
    model,
    displayName: model,
    description: model,
    supportedReasoningEfforts: [
      {
        reasoningEffort: "low",
        description: "Low",
      },
    ],
    defaultReasoningEffort: "low",
    isDefault,
  };
}

describe("provider model selection", () => {
  it("prefers Pi Anthropic subscription models before OpenAI Codex models", () => {
    const models = [
      availableModel("openai-codex/gpt-5.5", true),
      availableModel("anthropic/claude-haiku-4-5", false),
    ];

    expect(resolvePreferredTestModel({ providerId: "pi", models })).toBe(
      "anthropic/claude-haiku-4-5",
    );
  });

  it("falls back to the Pi OpenAI Codex model when Anthropic is unavailable", () => {
    const models = [
      availableModel("openai-codex/gpt-5.5", false),
      availableModel("openai-codex/gpt-5.4-mini", true),
    ];

    expect(resolvePreferredTestModel({ providerId: "pi", models })).toBe(
      "openai-codex/gpt-5.5",
    );
  });
});
