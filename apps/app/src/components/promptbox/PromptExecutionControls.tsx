import type { ComponentProps } from "react";
import type { ReasoningLevel, SandboxMode, ServiceTier } from "@beanbag/agent-core";
import { PromptModelPicker } from "./PromptModelPicker";
import { PromptOptionPicker, type PromptOption } from "./PromptOptionPicker";

interface PromptExecutionControlsProps {
  supportsModelList: boolean;
  activeModel?: { model: string } | null;
  selectedModel: string;
  modelOptions: ComponentProps<typeof PromptModelPicker>["options"];
  onSelectedModelChange: ComponentProps<typeof PromptModelPicker>["onChange"];
  serviceTier?: ServiceTier;
  onServiceTierChange: (value: ServiceTier | undefined) => void;
  supportsServiceTier: boolean;
  supportsReasoningLevels: boolean;
  reasoningLevel: ReasoningLevel;
  reasoningOptions: readonly PromptOption<ReasoningLevel>[];
  onReasoningLevelChange: (value: ReasoningLevel) => void;
  sandboxMode?: SandboxMode;
  sandboxOptions: readonly PromptOption<SandboxMode>[];
  onSandboxModeChange: (value: SandboxMode) => void;
}

export function PromptExecutionControls({
  supportsModelList,
  activeModel,
  selectedModel,
  modelOptions,
  onSelectedModelChange,
  serviceTier,
  onServiceTierChange,
  supportsServiceTier,
  supportsReasoningLevels,
  reasoningLevel,
  reasoningOptions,
  onReasoningLevelChange,
  sandboxMode,
  sandboxOptions,
  onSandboxModeChange,
}: PromptExecutionControlsProps) {
  const resolvedSandboxMode = sandboxMode ?? sandboxOptions[0]?.value ?? "workspace-write";

  return (
    <>
      {supportsModelList && modelOptions.length > 0 ? (
        <PromptModelPicker
          value={activeModel?.model ?? selectedModel}
          options={modelOptions}
          onChange={onSelectedModelChange}
          fastModeEnabled={serviceTier === "fast"}
          onFastModeChange={(enabled) => onServiceTierChange(enabled ? "fast" : undefined)}
          showFastModeToggle={supportsServiceTier}
        />
      ) : null}
      {supportsReasoningLevels && reasoningOptions.length > 0 ? (
        <PromptOptionPicker
          label="Reasoning"
          value={reasoningLevel}
          options={reasoningOptions}
          onChange={onReasoningLevelChange}
        />
      ) : null}
      <PromptOptionPicker
        label="Sandbox"
        value={resolvedSandboxMode}
        options={sandboxOptions}
        onChange={onSandboxModeChange}
      />
    </>
  );
}
