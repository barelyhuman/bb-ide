import { getActiveSessionById } from "@bb/db";
import type { DbConnection } from "@bb/db";
import { ApiError } from "../errors.js";

export interface RequireAuthorizedActiveSessionArgs {
  hostId: string;
  sessionId: string;
}

export function requireActiveSession(db: DbConnection, sessionId: string) {
  const session = getActiveSessionById(db, { sessionId });

  if (!session) {
    throw new ApiError(401, "inactive_session", "Session is not active");
  }

  return session;
}

export function requireAuthorizedActiveSession(
  db: DbConnection,
  args: RequireAuthorizedActiveSessionArgs,
) {
  const session = requireActiveSession(db, args.sessionId);
  if (session.hostId !== args.hostId) {
    throw new ApiError(
      403,
      "invalid_request",
      "Session does not belong to the authenticated host",
    );
  }

  return session;
}
