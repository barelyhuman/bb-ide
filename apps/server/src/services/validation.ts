import type { ZodTypeAny } from "zod";
import { ZodError } from "zod";
import { ApiError } from "../errors.js";

export function parseValue<TSchema extends ZodTypeAny>(
  value: unknown,
  schema: TSchema,
): ReturnType<TSchema["parse"]> {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ApiError(
        400,
        "invalid_request",
        error.issues[0]?.message ?? "Invalid request",
      );
    }
    throw error;
  }
}

export function parseQueryValue(
  value: string | undefined,
  name: string,
): string {
  if (!value || value.trim().length === 0) {
    throw new ApiError(400, "invalid_request", `Missing query parameter: ${name}`);
  }
  return value;
}

export function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new ApiError(400, "invalid_request", `Invalid boolean value: ${value}`);
}

export function parseInteger(
  value: string,
  name: string,
): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new ApiError(400, "invalid_request", `Invalid integer for ${name}`);
  }
  return parsed;
}

export function parseOptionalInteger(
  value: string | undefined,
  name: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new ApiError(400, "invalid_request", `Invalid integer for ${name}`);
  }
  return parsed;
}
