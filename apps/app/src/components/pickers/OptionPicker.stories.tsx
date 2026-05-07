import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { OpenAiIcon } from "@/components/icons/OpenAiIcon";
import { PiIcon } from "@/components/icons/PiIcon";
import {
  OptionDisplay,
  OptionPicker,
  type PickerOption,
} from "./OptionPicker";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "ui/pickers/Option Picker",
};

// Mirrors REASONING_LABELS from useThreadCreationOptions.ts
const reasoningOptions: readonly PickerOption<string>[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
];

// Mirrors PERMISSION_MODE_OPTIONS from useThreadCreationOptions.ts
const permissionOptions: readonly PickerOption<string>[] = [
  { value: "full", label: "Full Access", tone: "warning" },
  { value: "workspace-write", label: "Workspace Write" },
  { value: "readonly", label: "Readonly" },
];

// Mirrors providerOptions from useThreadCreationOptions.ts (Claude Code / Codex / Pi)
const providerOptions: readonly PickerOption<string>[] = [
  { value: "claude-code", label: "Claude Code", icon: ClaudeIcon },
  { value: "codex", label: "Codex", icon: OpenAiIcon },
  { value: "pi", label: "Pi", icon: PiIcon },
];

const noop = () => {};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="default">
        <OptionPicker
          label="Reasoning"
          value="medium"
          options={reasoningOptions}
          onChange={noop}
        />
      </StoryRow>
      <StoryRow label="muted" hint="prompt-box treatment">
        <OptionPicker
          label="Reasoning"
          value="medium"
          options={reasoningOptions}
          onChange={noop}
          muted
        />
      </StoryRow>
      <StoryRow label="with icons">
        <OptionPicker
          label="Provider"
          value="claude-code"
          options={providerOptions}
          onChange={noop}
        />
      </StoryRow>
      <StoryRow label="warning option" hint='tone: "warning" on selected option'>
        <OptionPicker
          label="Permission mode"
          value="full"
          options={permissionOptions}
          onChange={noop}
        />
      </StoryRow>
      <StoryRow label="OptionDisplay" hint="non-interactive read-only variant">
        <OptionDisplay
          label="Provider"
          value="Claude Code"
          icon={ClaudeIcon}
        />
      </StoryRow>
      <StoryRow label="OptionDisplay muted" hint="muted prop">
        <OptionDisplay
          label="Provider"
          value="Claude Code"
          icon={ClaudeIcon}
          muted
        />
      </StoryRow>
      <StoryRow label="open menu" hint="defaultOpen + modal=false">
        <OptionPicker
          label="Permission mode"
          value="workspace-write"
          options={permissionOptions}
          onChange={noop}
          defaultOpen
          modal={false}
        />
      </StoryRow>
    </StoryCard>
  );
}
