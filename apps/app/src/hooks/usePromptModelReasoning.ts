import { useEffect, useMemo, useState } from "react";
import type {
  AvailableModel,
  ReasoningLevel,
  SandboxMode,
  SystemEnvironmentInfo,
} from "@beanbag/agent-core";
import {
  useAvailableModels,
  useSystemEnvironments,
  useSystemProvider,
} from "./useApi";

const MODEL_STORAGE_KEY = "beanbag.promptbox.model";
const REASONING_STORAGE_KEY = "beanbag.promptbox.reasoning";
const SANDBOX_STORAGE_KEY = "beanbag.promptbox.sandbox";
const ENVIRONMENT_STORAGE_KEY = "beanbag.promptbox.environment";

const FALLBACK_REASONING_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
] as const;

const FALLBACK_MODELS: AvailableModel[] = [
  {
    id: "gpt-5.3-codex",
    model: "gpt-5.3-codex",
    displayName: "gpt-5.3-codex",
    description: "Latest frontier agentic coding model.",
    supportedReasoningEfforts: FALLBACK_REASONING_OPTIONS.map((option) => ({
      reasoningEffort: option.value,
      description: `${option.label} reasoning effort`,
    })),
    defaultReasoningEffort: "medium",
    isDefault: true,
  },
];

const REASONING_LABELS: Record<ReasoningLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
};
const SANDBOX_OPTIONS: PromptOption<SandboxMode>[] = [
  { value: "read-only", label: "Read Only" },
  { value: "workspace-write", label: "Workspace Write" },
  {
    value: "danger-full-access",
    label: "Full Access",
    tone: "warning",
  },
];

interface PromptOption<T extends string> {
  value: T;
  label: string;
  tone?: "default" | "warning";
}

interface UsePromptModelReasoningOptions {
  scope?: "new-thread" | "thread";
  initialModel?: string;
  initialReasoningLevel?: ReasoningLevel;
  initialSandboxMode?: SandboxMode;
  initialEnvironmentId?: string;
}

function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
}

function isSandboxMode(value: unknown): value is SandboxMode {
  return (
    value === "read-only" ||
    value === "workspace-write" ||
    value === "danger-full-access"
  );
}

function getStoredModel(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(MODEL_STORAGE_KEY) ?? "";
}

function getStoredReasoningLevel(): ReasoningLevel {
  if (typeof window === "undefined") return "medium";
  const raw = window.localStorage.getItem(REASONING_STORAGE_KEY);
  return isReasoningLevel(raw) ? raw : "medium";
}

function getStoredSandboxMode(): SandboxMode {
  if (typeof window === "undefined") return "danger-full-access";
  const raw = window.localStorage.getItem(SANDBOX_STORAGE_KEY);
  return isSandboxMode(raw) ? raw : "danger-full-access";
}

function getStoredEnvironmentId(): string {
  if (typeof window === "undefined") return "local";
  return window.localStorage.getItem(ENVIRONMENT_STORAGE_KEY) ?? "local";
}

function toEnvironmentOptions(
  environments: readonly SystemEnvironmentInfo[] | undefined,
): PromptOption<string>[] {
  const source = environments && environments.length > 0
    ? environments
    : [
        {
          id: "local",
          displayName: "Local Workspace",
          capabilities: {
            isolatedFilesystem: false,
            ephemeralWorkspace: false,
            supportsCleanup: false,
          },
        },
      ];
  return source.map((environment) => ({
    value: environment.id,
    label: environment.displayName,
  }));
}

function formatModelLabel(value: string): string {
  return value
    .split("-")
    .map((part) => {
      if (part.toLowerCase() === "gpt") return "GPT";
      if (/^\d+(\.\d+)*$/.test(part)) return part;
      if (/^[a-z]+$/i.test(part)) {
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      }
      return part;
    })
    .join("-");
}

export function usePromptModelReasoning(
  options?: UsePromptModelReasoningOptions,
) {
  const scope = options?.scope ?? "new-thread";
  const availableModelsQuery = useAvailableModels();
  const environmentsQuery = useSystemEnvironments();
  const providerInfoQuery = useSystemProvider();
  const supportsModelList =
    providerInfoQuery.data?.capabilities.supportsModelList ?? true;
  const supportsReasoningLevels =
    providerInfoQuery.data?.capabilities.supportsReasoningLevels ?? true;
  const [selectedModel, setSelectedModel] = useState<string>(() =>
    scope === "new-thread" ? getStoredModel() : (options?.initialModel ?? ""),
  );
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>(() =>
    scope === "new-thread"
      ? getStoredReasoningLevel()
      : (options?.initialReasoningLevel ?? "medium"),
  );
  const [sandboxMode, setSandboxMode] = useState<SandboxMode>(() =>
    scope === "new-thread"
      ? getStoredSandboxMode()
      : (options?.initialSandboxMode ?? "danger-full-access"),
  );
  const [environmentId, setEnvironmentId] = useState<string>(() =>
    scope === "new-thread"
      ? getStoredEnvironmentId()
      : (options?.initialEnvironmentId ?? "local"),
  );

  const availableModels = useMemo(
    () =>
      supportsModelList &&
      availableModelsQuery.data &&
      availableModelsQuery.data.length > 0
        ? availableModelsQuery.data
        : FALLBACK_MODELS,
    [availableModelsQuery.data, supportsModelList],
  );

  const modelOptions = useMemo(
    (): PromptOption<string>[] =>
      availableModels.map((model) => ({
        value: model.model,
        label: formatModelLabel(model.displayName || model.model),
      })),
    [availableModels],
  );

  const activeModel = useMemo(
    () =>
      availableModels.find((model) => model.model === selectedModel) ??
      availableModels.find((model) => model.isDefault) ??
      availableModels[0],
    [availableModels, selectedModel],
  );

  const reasoningOptions = useMemo(
    (): PromptOption<ReasoningLevel>[] => {
      if (!supportsReasoningLevels) {
        return [{ value: "medium", label: REASONING_LABELS.medium }];
      }
      const options: PromptOption<ReasoningLevel>[] = [];
      const seen = new Set<ReasoningLevel>();
      const efforts =
        activeModel?.supportedReasoningEfforts ??
        FALLBACK_MODELS[0].supportedReasoningEfforts;

      for (const effort of efforts) {
        if (seen.has(effort.reasoningEffort)) continue;
        seen.add(effort.reasoningEffort);
        options.push({
          value: effort.reasoningEffort,
          label: REASONING_LABELS[effort.reasoningEffort],
        });
      }

      if (options.length === 0) {
        return FALLBACK_REASONING_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
        }));
      }

      return options;
    },
    [activeModel, supportsReasoningLevels],
  );
  const environmentOptions = useMemo(
    () => toEnvironmentOptions(environmentsQuery.data),
    [environmentsQuery.data],
  );

  useEffect(() => {
    if (availableModels.length === 0) return;
    const hasSelection = availableModels.some(
      (model) => model.model === selectedModel,
    );
    if (hasSelection) return;

    const fallbackModel =
      availableModels.find((model) => model.isDefault)?.model ??
      availableModels[0].model;
    setSelectedModel(fallbackModel);
  }, [availableModels, selectedModel]);

  useEffect(() => {
    if (!supportsReasoningLevels && reasoningLevel !== "medium") {
      setReasoningLevel("medium");
      return;
    }
    if (!reasoningOptions.some((option) => option.value === reasoningLevel)) {
      setReasoningLevel(
        activeModel?.defaultReasoningEffort ?? reasoningOptions[0].value,
      );
    }
  }, [activeModel, reasoningLevel, reasoningOptions, supportsReasoningLevels]);

  useEffect(() => {
    if (environmentOptions.length === 0) return;
    const hasSelection = environmentOptions.some(
      (option) => option.value === environmentId,
    );
    if (hasSelection) return;
    setEnvironmentId(environmentOptions[0].value);
  }, [environmentId, environmentOptions]);

  useEffect(() => {
    if (scope !== "thread") return;
    if (options?.initialModel !== undefined) {
      setSelectedModel(options.initialModel);
    }
  }, [options?.initialModel, scope]);

  useEffect(() => {
    if (scope !== "thread") return;
    if (options?.initialReasoningLevel !== undefined) {
      setReasoningLevel(options.initialReasoningLevel);
    }
  }, [options?.initialReasoningLevel, scope]);

  useEffect(() => {
    if (scope !== "thread") return;
    if (options?.initialSandboxMode !== undefined) {
      setSandboxMode(options.initialSandboxMode);
    }
  }, [options?.initialSandboxMode, scope]);

  useEffect(() => {
    if (scope !== "thread") return;
    if (options?.initialEnvironmentId !== undefined) {
      setEnvironmentId(options.initialEnvironmentId);
    }
  }, [options?.initialEnvironmentId, scope]);

  useEffect(() => {
    if (scope !== "new-thread") return;
    if (typeof window === "undefined" || !selectedModel) return;
    window.localStorage.setItem(MODEL_STORAGE_KEY, selectedModel);
  }, [scope, selectedModel]);

  useEffect(() => {
    if (scope !== "new-thread") return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(REASONING_STORAGE_KEY, reasoningLevel);
  }, [scope, reasoningLevel]);

  useEffect(() => {
    if (scope !== "new-thread") return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SANDBOX_STORAGE_KEY, sandboxMode);
  }, [scope, sandboxMode]);

  useEffect(() => {
    if (scope !== "new-thread") return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ENVIRONMENT_STORAGE_KEY, environmentId);
  }, [environmentId, scope]);

  return {
    selectedModel,
    setSelectedModel,
    reasoningLevel,
    setReasoningLevel,
    sandboxMode,
    setSandboxMode,
    environmentId,
    setEnvironmentId,
    activeModel,
    modelOptions,
    reasoningOptions,
    sandboxOptions: SANDBOX_OPTIONS,
    environmentOptions,
    supportsModelList,
    supportsReasoningLevels,
  };
}
