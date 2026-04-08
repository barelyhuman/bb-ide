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
  origin: ThreadCreateServiceRequest["origin"];
}): boolean {
  return args.origin === "app" && args.automationId === null;
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
    threadType: args.request.type,
    model: args.execution.model,
    reasoningLevel: args.execution.reasoningLevel,
    sandboxMode: args.execution.sandboxMode,
    serviceTier: args.execution.serviceTier,
  });
}
