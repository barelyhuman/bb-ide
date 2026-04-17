import { availableModelSchema, type AvailableModel } from "@bb/domain";

export function parseAvailableModelList(result: unknown): AvailableModel[] {
  if (!Array.isArray(result)) {
    throw new Error("Expected provider model/list response to be an array.");
  }

  const models: AvailableModel[] = [];
  for (const entry of result) {
    models.push(availableModelSchema.parse(entry));
  }
  return models;
}
