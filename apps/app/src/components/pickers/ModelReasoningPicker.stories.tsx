import { useState } from "react";
import type { ReasoningLevel } from "@bb/domain";
import { ModelReasoningPicker } from "./ModelReasoningPicker";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import {
  STORY_CLAUDE_CODE_MODELS,
  STORY_CLAUDE_REASONING,
  STORY_CODEX_MODELS,
  STORY_CODEX_REASONING,
  STORY_PROVIDER_OPTIONS,
  STORY_SERVICE_TIER_SUPPORT,
} from "../../../.ladle/story-fixtures";

export default {
  title: "pickers/Model Reasoning Picker",
};

const noop = () => {};

const codexBase = {
  providerOptions: STORY_PROVIDER_OPTIONS,
  serviceTierSupportByProvider: STORY_SERVICE_TIER_SUPPORT,
  selectedProviderId: "codex",
  onSelectedProviderChange: noop,
  hasMultipleProviders: true,
  modelValue: "gpt-5.5",
  modelOptions: STORY_CODEX_MODELS,
  onModelChange: noop,
  reasoningValue: "medium" as ReasoningLevel,
  reasoningOptions: STORY_CODEX_REASONING,
  onReasoningChange: noop,
  fastModeEnabled: false,
  onFastModeChange: noop,
  showFastModeToggle: true,
};

const claudeBase = {
  ...codexBase,
  selectedProviderId: "claude-code",
  modelValue: "claude-sonnet-4-6",
  modelOptions: STORY_CLAUDE_CODE_MODELS,
  reasoningOptions: STORY_CLAUDE_REASONING,
  showFastModeToggle: false,
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="default"
        hint="codex selected, medium reasoning, fast mode supported"
      >
        <ModelReasoningPicker {...codexBase} />
      </StoryRow>
      <StoryRow label="muted" hint="prompt-box treatment">
        <ModelReasoningPicker {...codexBase} muted />
      </StoryRow>
      <StoryRow
        label="claude-code selected"
        hint="all five reasoning levels; no fast mode toggle"
      >
        <ModelReasoningPicker {...claudeBase} reasoningValue="max" />
      </StoryRow>
      <StoryRow label="fast mode active" hint="codex + fastModeEnabled">
        <ModelReasoningPicker {...codexBase} fastModeEnabled />
      </StoryRow>
      <StoryRow label="open menu" hint="defaultOpen + modal=false">
        <ModelReasoningPickerInteractive />
      </StoryRow>
    </StoryCard>
  );
}

function ModelReasoningPickerInteractive() {
  const [reasoningValue, setReasoningValue] = useState<ReasoningLevel>("medium");
  return (
    <ModelReasoningPicker
      {...codexBase}
      reasoningValue={reasoningValue}
      onReasoningChange={setReasoningValue}
      defaultOpen
      modal={false}
    />
  );
}
