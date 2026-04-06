import type { ZodType } from "zod";

export function parseJsonValue(raw: string): unknown {
  return JSON.parse(raw);
}

export function parseJsonWithSchema<T>(
  raw: string,
  schema: ZodType<T>,
): T {
  return schema.parse(parseJsonValue(raw));
}
