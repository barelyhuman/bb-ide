import type { AvailableModel } from "@bb/domain";
import { z } from "zod";

const reasoningLevelSchema = z.enum(["low", "medium", "high", "xhigh"]);

const reasoningEffortOptionSchema = z
  .object({
    reasoningEffort: reasoningLevelSchema,
    description: z.string(),
  })
  .passthrough();

const DEFAULT_REASONING_EFFORTS: z.infer<typeof reasoningEffortOptionSchema>[] =
  [
    { reasoningEffort: "low", description: "Low reasoning effort" },
    { reasoningEffort: "medium", description: "Medium reasoning effort" },
    { reasoningEffort: "high", description: "High reasoning effort" },
    { reasoningEffort: "xhigh", description: "Extra high reasoning effort" },
  ];

const codexModelSchema = z
  .object({
    id: z.string(),
    model: z.string(),
    displayName: z.string().optional(),
    description: z.string().optional(),
    isDefault: z.boolean().optional(),
    supportedReasoningEfforts: z.array(reasoningEffortOptionSchema).optional(),
    defaultReasoningEffort: reasoningLevelSchema.optional(),
  })
  .passthrough();

const codexModelListResponseSchema = z
  .object({
    data: z.array(codexModelSchema),
  })
  .passthrough();

function toAvailableModel(
  raw: z.infer<typeof codexModelSchema>,
): AvailableModel {
  const efforts = raw.supportedReasoningEfforts?.length
    ? raw.supportedReasoningEfforts
    : DEFAULT_REASONING_EFFORTS;

  return {
    id: raw.id,
    model: raw.model,
    displayName: raw.displayName ?? raw.model,
    description: raw.description ?? "",
    supportedReasoningEfforts: efforts,
    defaultReasoningEffort:
      raw.defaultReasoningEffort ?? efforts[0].reasoningEffort,
    isDefault: raw.isDefault ?? false,
  };
}

export function parseModelsResponse(result: unknown): AvailableModel[] {
  const parsed = codexModelListResponseSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error("Invalid response from codex model/list.");
  }

  const models = parsed.data.data.map(toAvailableModel);

  if (models.length === 0) {
    throw new Error("Codex model/list returned no supported models.");
  }

  return models;
}
