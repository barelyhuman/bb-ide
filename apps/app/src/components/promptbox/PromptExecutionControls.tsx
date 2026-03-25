import type { ReasoningLevel, SandboxMode, ServiceTier } from "@bb/domain";
import { formatModelLabel } from "@/hooks/useThreadCreationOptions";
import { PromptProviderModelPicker } from "./PromptProviderModelPicker";
import { PromptOptionPicker, PromptOptionDisplay, type PromptOption } from "./PromptOptionPicker";

export interface PromptExecutionProviderConfig {
  options?: readonly PromptOption<string>[];
  selectedId?: string;
  onChange?: (value: string) => void;
  hasMultiple?: boolean;
  displayName?: string;
  readOnly?: boolean;
}

export interface PromptExecutionModelConfig {
  active?: { model: string } | null;
  selected: string;
  options: readonly PromptOption<string>[];
  onChange: (value: string) => void;
}

export interface PromptExecutionServiceTierConfig {
  value?: ServiceTier;
  onChange: (value: ServiceTier | undefined) => void;
  supported: boolean;
}

export interface PromptExecutionReasoningConfig {
  value: ReasoningLevel;
  options: readonly PromptOption<ReasoningLevel>[];
  onChange: (value: ReasoningLevel) => void;
}

export interface PromptExecutionSandboxConfig {
  value?: SandboxMode;
  options: readonly PromptOption<SandboxMode>[];
  onChange: (value: SandboxMode) => void;
}

export interface PromptExecutionControlsProps {
  provider: PromptExecutionProviderConfig;
  model: PromptExecutionModelConfig;
  serviceTier?: PromptExecutionServiceTierConfig;
  reasoning: PromptExecutionReasoningConfig;
  sandbox: PromptExecutionSandboxConfig;
}

export function PromptExecutionControls({
  provider,
  model,
  serviceTier,
  reasoning,
  sandbox,
}: PromptExecutionControlsProps) {
  const resolvedSandboxMode = sandbox.value ?? sandbox.options[0]?.value ?? "workspace-write";
  const handleProviderChange = provider.onChange ?? (() => {});
  const handleServiceTierChange = serviceTier?.onChange ?? (() => {});

  // Show read-only provider label when provider is locked (thread follow-up)
  // and there's no model list to show in the unified picker.
  const showReadOnlyProvider =
    provider.hasMultiple &&
    provider.readOnly &&
    provider.displayName &&
    model.options.length === 0;

  const showModelPicker = model.options.length > 0;

  return (
    <>
      {showReadOnlyProvider ? (
        <PromptOptionDisplay
          label="Provider"
          value={provider.displayName}
          icon={provider.options?.find((candidate) => candidate.value === provider.selectedId)?.icon}
        />
      ) : null}
      {showModelPicker ? (
        <PromptProviderModelPicker
          providerOptions={provider.options ?? []}
          selectedProviderId={provider.selectedId ?? ""}
          onSelectedProviderChange={handleProviderChange}
          hasMultipleProviders={provider.hasMultiple ?? false}
          providerReadOnly={provider.readOnly}
          modelValue={model.active?.model ?? model.selected}
          modelOptions={model.options}
          onModelChange={model.onChange}
          formatModelLabel={formatModelLabel}
          fastModeEnabled={serviceTier?.value === "fast"}
          onFastModeChange={(enabled) => handleServiceTierChange(enabled ? "fast" : undefined)}
          showFastModeToggle={serviceTier?.supported ?? false}
        />
      ) : null}
      {reasoning.options.length > 0 ? (
        <PromptOptionPicker
          label="Reasoning"
          value={reasoning.value}
          options={reasoning.options}
          onChange={reasoning.onChange}
        />
      ) : null}
      <PromptOptionPicker
        label="Sandbox"
        value={resolvedSandboxMode}
        options={sandbox.options}
        onChange={sandbox.onChange}
      />
    </>
  );
}
