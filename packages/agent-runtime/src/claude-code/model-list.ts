import type { AvailableModel } from "@bb/domain";
import {
  HIGH_REASONING_EFFORT,
  LOW_REASONING_EFFORT,
  MEDIUM_REASONING_EFFORT,
  XHIGH_REASONING_EFFORT,
} from "../shared/adapter-utils.js";

const CLAUDE_CODE_MODELS: AvailableModel[] = [
  {
    id: "claude-sonnet-4-6",
    model: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    description: "Fast, intelligent model for everyday coding tasks",
    supportedReasoningEfforts: [LOW_REASONING_EFFORT, MEDIUM_REASONING_EFFORT, HIGH_REASONING_EFFORT],
    defaultReasoningEffort: "medium",
    isDefault: true,
  },
  {
    id: "claude-opus-4-6",
    model: "claude-opus-4-6",
    displayName: "Claude Opus 4.6",
    description: "Most capable model for complex coding tasks",
    supportedReasoningEfforts: [LOW_REASONING_EFFORT, MEDIUM_REASONING_EFFORT, HIGH_REASONING_EFFORT, XHIGH_REASONING_EFFORT],
    defaultReasoningEffort: "medium",
    isDefault: false,
  },
  {
    id: "claude-haiku-4-5",
    model: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    description: "Fast, compact model for simple tasks",
    supportedReasoningEfforts: [LOW_REASONING_EFFORT, MEDIUM_REASONING_EFFORT],
    defaultReasoningEffort: "low",
    isDefault: false,
  },
];

export function listClaudeCodeModels(): AvailableModel[] {
  return CLAUDE_CODE_MODELS.map((model) => ({
    ...model,
    supportedReasoningEfforts: [...model.supportedReasoningEfforts],
  }));
}
