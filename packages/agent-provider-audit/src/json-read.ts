import { readFileSync } from "node:fs";
import { z } from "zod";

export interface ReadJsonFileArgs<TSchema extends z.ZodTypeAny> {
  filePath: string;
  schema: TSchema;
}

export function readJsonFile<TSchema extends z.ZodTypeAny>(
  args: ReadJsonFileArgs<TSchema>,
): z.output<TSchema> {
  const parsed = JSON.parse(readFileSync(args.filePath, "utf8")) as unknown;
  return args.schema.parse(parsed);
}
