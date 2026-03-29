import type {
  AvailableModel,
  ModelReasoningEffort,
} from "@bb/domain";
import {
  HIGH_REASONING_EFFORT,
  LOW_REASONING_EFFORT,
  MEDIUM_REASONING_EFFORT,
  XHIGH_REASONING_EFFORT,
} from "../shared/adapter-utils.js";

const PI_DEFAULT_MODEL_PREFERENCES = [
  "anthropic/claude-sonnet-4-20250514",
  "anthropic/claude-sonnet-4-6",
  "anthropic/claude-opus-4-20250514",
  "openai/codex-mini",
] as const;

export interface PiCatalogModel {
  id: string;
  input: string[];
  name: string;
  provider: string;
  reasoning: boolean;
  supportsXhigh: boolean;
}

export interface BuildPiAvailableModelsArgs<TProvider extends string> {
  providers: TProvider[];
  getModels: (provider: TProvider) => PiCatalogModel[];
  hasAuth: (provider: TProvider) => boolean;
}

export function buildPiAvailableModels<TProvider extends string>(
  args: BuildPiAvailableModelsArgs<TProvider>,
): AvailableModel[] {
  const models: AvailableModel[] = [];
  for (const provider of args.providers) {
    if (!args.hasAuth(provider)) {
      continue;
    }
    for (const model of args.getModels(provider)) {
      const canonicalId = toCanonicalPiModelId(provider, model.id);
      const supportedReasoningEfforts = getPiReasoningEfforts(model);
      models.push({
        id: canonicalId,
        model: canonicalId,
        displayName: model.name,
        description: describePiModel(model),
        supportedReasoningEfforts,
        defaultReasoningEffort: model.reasoning ? "medium" : "low",
        isDefault: false,
      });
    }
  }

  const defaultId = resolveDefaultPiModelId(models);
  return models.map((model) =>
    model.id === defaultId ? { ...model, isDefault: true } : model,
  );
}

function toCanonicalPiModelId(provider: string, modelId: string): string {
  return modelId.includes("/") ? modelId : `${provider}/${modelId}`;
}

function getPiReasoningEfforts(model: PiCatalogModel): ModelReasoningEffort[] {
  if (!model.reasoning) {
    return [LOW_REASONING_EFFORT];
  }

  const efforts = [LOW_REASONING_EFFORT, MEDIUM_REASONING_EFFORT, HIGH_REASONING_EFFORT];
  if (model.supportsXhigh) {
    efforts.push(XHIGH_REASONING_EFFORT);
  }
  return efforts;
}

function describePiModel(model: PiCatalogModel): string {
  const capabilities: string[] = [];
  capabilities.push(model.reasoning ? "reasoning" : "non-reasoning");
  if (model.input.includes("image")) {
    capabilities.push("multimodal");
  }

  const provider = model.provider.length > 0
    ? model.provider[0].toUpperCase() + model.provider.slice(1)
    : model.provider;
  return `${provider} ${capabilities.join(", ")} model via Pi`;
}

function resolveDefaultPiModelId(models: AvailableModel[]): string | undefined {
  for (const preferred of PI_DEFAULT_MODEL_PREFERENCES) {
    if (models.some((model) => model.id === preferred)) {
      return preferred;
    }
  }
  return models[0]?.id;
}
