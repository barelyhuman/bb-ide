import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { OpenAiIcon } from "@/components/icons/OpenAiIcon";
import { PiIcon } from "@/components/icons/PiIcon";
import type { PickerOption } from "./OptionPicker";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "ui/pickers/Provider Model Picker",
};

// Mirrors providerOptions in useThreadCreationOptions.ts (the real bb providers)
const providerOptions: readonly PickerOption<string>[] = [
  { value: "claude-code", label: "Claude Code", icon: ClaudeIcon },
  { value: "codex", label: "Codex", icon: OpenAiIcon },
  { value: "pi", label: "Pi", icon: PiIcon },
];

const claudeModels: readonly PickerOption<string>[] = [
  { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
];

const noop = () => {};

const baseProps = {
  providerOptions,
  selectedProviderId: "claude-code",
  onSelectedProviderChange: noop,
  hasMultipleProviders: true,
  modelValue: "claude-sonnet-4-6",
  modelOptions: claudeModels,
  onModelChange: noop,
  fastModeEnabled: false,
  onFastModeChange: noop,
  showFastModeToggle: false,
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="default">
        <ProviderModelPicker {...baseProps} />
      </StoryRow>
      <StoryRow label="muted" hint="prompt-box treatment">
        <ProviderModelPicker {...baseProps} muted />
      </StoryRow>
      <StoryRow
        label="single provider"
        hint="hasMultipleProviders=false hides tabs"
      >
        <ProviderModelPicker {...baseProps} hasMultipleProviders={false} />
      </StoryRow>
      <StoryRow label="provider read-only" hint="providerReadOnly=true">
        <ProviderModelPicker {...baseProps} providerReadOnly />
      </StoryRow>
      <StoryRow label="fast mode toggle" hint="serviceTier supported">
        <ProviderModelPicker
          {...baseProps}
          showFastModeToggle
          fastModeEnabled
        />
      </StoryRow>
      <StoryRow label="open popover" hint="defaultOpen + modal=false">
        <ProviderModelPicker
          {...baseProps}
          showFastModeToggle
          defaultOpen
          modal={false}
        />
      </StoryRow>
    </StoryCard>
  );
}
