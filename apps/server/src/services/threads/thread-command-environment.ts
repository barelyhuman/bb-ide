import type { Environment, Thread } from "@bb/domain";
import type { DbConnection } from "@bb/db";
import type { WorkSessionDeps } from "../../types.js";
import { requireEnvironment } from "../lib/entity-lookup.js";
import {
  threadEnvironmentUnavailableDetails,
  throwThreadEnvironmentUnavailable,
} from "../lib/lifecycle-api-errors.js";

export type ThreadCommandEnvironmentSource = Pick<
  Thread,
  "createdAt" | "environmentId" | "id" | "projectId" | "updatedAt"
>;

export interface RequireThreadCommandEnvironmentArgs {
  thread: ThreadCommandEnvironmentSource;
}

export interface RequireThreadHostCommandEnvironmentArgs {
  db: DbConnection;
  thread: ThreadCommandEnvironmentSource;
}

export interface ThreadHostCommandEnvironment {
  hostId: string;
  id: string;
}

export function requireThreadHostCommandEnvironment(
  args: RequireThreadHostCommandEnvironmentArgs,
): ThreadHostCommandEnvironment {
  if (args.thread.environmentId !== null) {
    const environment = requireEnvironment(args.db, args.thread.environmentId);
    return {
      id: environment.id,
      hostId: environment.hostId,
    };
  }

  throwThreadEnvironmentUnavailable(
    threadEnvironmentUnavailableDetails("never_attached", null),
  );
}

export async function requireThreadCommandEnvironment(
  deps: WorkSessionDeps,
  args: RequireThreadCommandEnvironmentArgs,
): Promise<Environment> {
  if (args.thread.environmentId !== null) {
    return requireEnvironment(deps.db, args.thread.environmentId);
  }

  throwThreadEnvironmentUnavailable(
    threadEnvironmentUnavailableDetails("never_attached", null),
  );
}
