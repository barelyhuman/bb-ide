import { upsertProjectExecutionDefaults } from "@bb/db";
import type { ResolvedThreadExecutionOptions } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import type { ThreadCreateServiceRequest } from "./thread-create-request.js";

export interface RememberProjectExecutionDefaultsForCreateArgs {
  execution: ResolvedThreadExecutionOptions;
  request: ThreadCreateServiceRequest;
}

function shouldRememberProjectExecutionDefaults(args: {
  automationId: string | null;
  type: "manager" | "standard";
}): boolean {
  return args.type === "standard" && args.automationId === null;
}

export function rememberProjectExecutionDefaultsForCreate(
  deps: Pick<AppDeps, "db">,
  args: RememberProjectExecutionDefaultsForCreateArgs,
): void {
  if (!shouldRememberProjectExecutionDefaults(args.request)) {
    return;
  }

  upsertProjectExecutionDefaults(deps.db, {
    projectId: args.request.projectId,
    providerId: args.request.providerId,
    ...args.execution,
  });
}
