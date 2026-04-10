import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
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

type ClaudeSdkModelInfo = Pick<
  ModelInfo,
  | "value"
  | "displayName"
  | "description"
  | "supportsEffort"
  | "supportedEffortLevels"
>;

type ClaudeCodeCatalogEntry = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  requiresOneMillionContext: boolean;
  sourceModelValues: readonly string[];
  supportedReasoningEfforts: readonly ModelReasoningEffort[];
  defaultReasoningEffort: AvailableModel["defaultReasoningEffort"];
};

const SONNET_REASONING_EFFORTS: readonly ModelReasoningEffort[] = [
  LOW_REASONING_EFFORT,
  MEDIUM_REASONING_EFFORT,
  HIGH_REASONING_EFFORT,
];

const OPUS_REASONING_EFFORTS: readonly ModelReasoningEffort[] = [
  LOW_REASONING_EFFORT,
  MEDIUM_REASONING_EFFORT,
  HIGH_REASONING_EFFORT,
  XHIGH_REASONING_EFFORT,
];

const CLAUDE_CODE_CATALOG: readonly ClaudeCodeCatalogEntry[] = [
  {
    id: "sonnet[1m]",
    model: "sonnet[1m]",
    displayName: "Sonnet 4.6 (1M)",
    description: "Sonnet 4.6 with 1M context for long coding sessions",
    requiresOneMillionContext: true,
    sourceModelValues: ["sonnet[1m]"],
    supportedReasoningEfforts: SONNET_REASONING_EFFORTS,
    defaultReasoningEffort: "medium",
  },
  {
    id: "sonnet",
    model: "sonnet",
    displayName: "Sonnet 4.6",
    description: "Sonnet 4.6 for everyday coding tasks",
    requiresOneMillionContext: false,
    sourceModelValues: ["sonnet"],
    supportedReasoningEfforts: SONNET_REASONING_EFFORTS,
    defaultReasoningEffort: "medium",
  },
  {
    id: "opus[1m]",
    model: "opus[1m]",
    displayName: "Opus 4.6 (1M)",
    description: "Opus 4.6 with 1M context for complex long coding sessions",
    requiresOneMillionContext: true,
    sourceModelValues: ["opus[1m]"],
    supportedReasoningEfforts: OPUS_REASONING_EFFORTS,
    defaultReasoningEffort: "medium",
  },
  {
    id: "opus",
    model: "opus",
    displayName: "Opus 4.6",
    description: "Opus 4.6 for complex coding tasks",
    requiresOneMillionContext: false,
    sourceModelValues: ["opus"],
    supportedReasoningEfforts: OPUS_REASONING_EFFORTS,
    defaultReasoningEffort: "medium",
  },
];

function cloneReasoningEfforts(
  efforts: readonly ModelReasoningEffort[],
): ModelReasoningEffort[] {
  return efforts.map((effort) => ({ ...effort }));
}

function toClaudeReasoningEfforts(
  model: ClaudeSdkModelInfo,
): ModelReasoningEffort[] {
  if (!model.supportsEffort) {
    return [LOW_REASONING_EFFORT];
  }

  const levels = model.supportedEffortLevels ?? ["low", "medium", "high"];
  const efforts: ModelReasoningEffort[] = [];
  for (const level of levels) {
    if (level === "low") {
      efforts.push(LOW_REASONING_EFFORT);
      continue;
    }
    if (level === "medium") {
      efforts.push(MEDIUM_REASONING_EFFORT);
      continue;
    }
    if (level === "high") {
      efforts.push(HIGH_REASONING_EFFORT);
      continue;
    }
    if (level === "max") {
      efforts.push(XHIGH_REASONING_EFFORT);
    }
  }

  return efforts.length > 0 ? efforts : [LOW_REASONING_EFFORT];
}

function toDefaultReasoningEffort(
  supportedReasoningEfforts: readonly ModelReasoningEffort[],
): AvailableModel["defaultReasoningEffort"] {
  if (supportedReasoningEfforts.some((effort) => effort.reasoningEffort === "medium")) {
    return "medium";
  }
  return supportedReasoningEfforts[0]?.reasoningEffort ?? "low";
}

function findCatalogEntrySourceModelInfo(
  entry: ClaudeCodeCatalogEntry,
  modelInfos: readonly ClaudeSdkModelInfo[],
): ClaudeSdkModelInfo | undefined {
  for (const value of entry.sourceModelValues) {
    const modelInfo = modelInfos.find((candidate) => candidate.value === value);
    if (modelInfo) {
      return modelInfo;
    }
  }
  return undefined;
}

function buildCatalogModel(
  entry: ClaudeCodeCatalogEntry,
  modelInfos: readonly ClaudeSdkModelInfo[],
): AvailableModel {
  const sourceModelInfo = findCatalogEntrySourceModelInfo(entry, modelInfos);
  const supportedReasoningEfforts = sourceModelInfo
    ? toClaudeReasoningEfforts(sourceModelInfo)
    : cloneReasoningEfforts(entry.supportedReasoningEfforts);

  return {
    id: entry.id,
    model: entry.model,
    displayName: entry.displayName,
    description: sourceModelInfo?.description ?? entry.description,
    supportedReasoningEfforts,
    defaultReasoningEffort: sourceModelInfo
      ? toDefaultReasoningEffort(supportedReasoningEfforts)
      : entry.defaultReasoningEffort,
    isDefault: false,
  };
}

export function buildClaudeCodeAvailableModels(
  modelInfos: readonly ClaudeSdkModelInfo[],
): AvailableModel[] {
  const hasOneMillionContext = modelInfos.some((modelInfo) =>
    modelInfo.value.endsWith("[1m]"),
  );
  const models = CLAUDE_CODE_CATALOG
    .filter((entry) =>
      !entry.requiresOneMillionContext || hasOneMillionContext,
    )
    .map((entry) => buildCatalogModel(entry, modelInfos));

  return models.map((model, index) =>
    index === 0 ? { ...model, isDefault: true } : model,
  );
}

export function listFallbackClaudeCodeModels(): AvailableModel[] {
  return buildClaudeCodeAvailableModels([]);
}
