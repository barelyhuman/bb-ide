import { BRANCH_LIST_LIMIT_MAX } from "@bb/host-daemon-contract";
import { ApiError } from "../errors.js";
import { parseOptionalInteger } from "../services/lib/validation.js";

const BRANCH_LIST_LIMIT_DEFAULT = 50;

export function normalizeBranchQuery(
  query: string | undefined,
): string | undefined {
  const trimmed = query?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseBranchListLimit(limit: string | undefined): number {
  const parsed = Math.min(
    parseOptionalInteger(limit, "limit") ?? BRANCH_LIST_LIMIT_DEFAULT,
    BRANCH_LIST_LIMIT_MAX,
  );
  if (parsed <= 0) {
    throw new ApiError(
      400,
      "invalid_request",
      "limit must be a positive integer",
    );
  }
  return parsed;
}
