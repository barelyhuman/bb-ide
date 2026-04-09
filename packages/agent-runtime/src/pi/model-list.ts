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

/**
 * Best default model per provider. Subset of pi-mono's `defaultModelPerProvider`:
 * https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/model-resolver.ts
 */
export const PI_DEFAULT_MODEL_PER_PROVIDER: Partial<Record<string, string>> = {
  anthropic: "claude-opus-4-6",
  openai: "gpt-5.4",
  "openai-codex": "gpt-5.4",
  "amazon-bedrock": "us.anthropic.claude-opus-4-6-v1",
  google: "gemini-2.5-pro",
  "google-gemini-cli": "gemini-2.5-pro",
  "google-vertex": "gemini-3-pro-preview",
  openrouter: "openai/gpt-5.1-codex",
  "vercel-ai-gateway": "anthropic/claude-opus-4-6",
  xai: "grok-4-fast-non-reasoning",
  mistral: "devstral-medium-latest",
};

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

/**
 * Model IDs ending with a `-YYYYMMDD` date suffix are pinned versions; prefer aliases.
 * pi-mono uses this heuristic for resolution preference (preferring aliases over dated
 * versions when multiple models match a pattern). We go further and exclude dated
 * versions entirely, since our UI is a picker not a fuzzy resolver.
 * See `isAlias` in pi-mono's model-resolver.ts:
 * https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/model-resolver.ts
 */
const DATE_SUFFIX_PATTERN = /-\d{8}$/;

function isModelAlias(id: string): boolean {
  if (id.endsWith("-latest")) return true;
  return !DATE_SUFFIX_PATTERN.test(id);
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
      if (!isModelAlias(model.id)) {
        continue;
      }
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

export function toCanonicalPiModelId(provider: string, modelId: string): string {
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
  // Try the per-provider default for each provider represented in the list
  for (const model of models) {
    const provider = model.id.split("/")[0];
    const defaultId = PI_DEFAULT_MODEL_PER_PROVIDER[provider];
    if (defaultId && model.id === toCanonicalPiModelId(provider, defaultId)) {
      return model.id;
    }
  }
  return models[0]?.id;
}
