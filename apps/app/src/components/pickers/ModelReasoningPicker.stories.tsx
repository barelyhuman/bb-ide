import { useState } from "react";
import type { ReasoningLevel } from "@bb/domain";
import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { OpenAiIcon } from "@/components/icons/OpenAiIcon";
import { PiIcon } from "@/components/icons/PiIcon";
import type { PickerOption } from "./OptionPicker";
import { ModelReasoningPicker } from "./ModelReasoningPicker";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "pickers/Model Reasoning Picker",
};

const providerOptions: readonly PickerOption<string>[] = [
  { value: "codex", label: "Codex", icon: OpenAiIcon },
  { value: "claude-code", label: "Claude Code", icon: ClaudeIcon },
  { value: "pi", label: "Pi", icon: PiIcon },
];

const serviceTierSupportByProvider: Record<string, boolean> = {
  codex: true,
  "claude-code": false,
  pi: false,
};

// Realistic models from a running local server's /system/providers route.
const codexModels: readonly PickerOption<string>[] = [
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
];

const claudeModels: readonly PickerOption<string>[] = [
  { value: "claude-opus-4-7-1m", label: "Opus 4.7 (1M)" },
  { value: "claude-opus-4-7", label: "Opus 4.7" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5" },
];

const codexReasoning: readonly PickerOption<ReasoningLevel>[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
];

const claudeReasoning: readonly PickerOption<ReasoningLevel>[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
  { value: "max", label: "Max" },
];

const noop = () => {};

const codexBase = {
  providerOptions,
  serviceTierSupportByProvider,
  selectedProviderId: "codex",
  onSelectedProviderChange: noop,
  hasMultipleProviders: true,
  modelValue: "gpt-5.5",
  modelOptions: codexModels,
  onModelChange: noop,
  reasoningValue: "medium" as ReasoningLevel,
  reasoningOptions: codexReasoning,
  onReasoningChange: noop,
  fastModeEnabled: false,
  onFastModeChange: noop,
  showFastModeToggle: true,
};

const claudeBase = {
  ...codexBase,
  selectedProviderId: "claude-code",
  modelValue: "claude-sonnet-4-6",
  modelOptions: claudeModels,
  reasoningOptions: claudeReasoning,
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
