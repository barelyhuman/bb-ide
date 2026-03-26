import { updateEnvironment } from "@bb/db";
import type {
  Environment,
  Thread,
} from "@bb/domain";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import {
  appendProvisioningEvent,
} from "./thread-events.js";
import {
  buildManagedBranchNameFromSeed,
  buildManagedTargetPath,
  queueEnvironmentProvision,
  requireDefaultSource,
} from "./thread-create-helpers.js";
import { tryTransition } from "./thread-transitions.js";

function toProvisioningLabel(
  workspaceProvisionType: Environment["workspaceProvisionType"],
): string {
  switch (workspaceProvisionType) {
    case "managed-worktree":
      return "Worktree";
    case "managed-clone":
      return "Clone";
    default:
      return "Environment";
  }
}

export function queueManagedEnvironmentReprovision(
  deps: Pick<AppDeps, "db" | "hub">,
  args: {
    environment: Environment;
    thread: Thread;
  },
): void {
  if (
    !args.environment.managed ||
    !args.environment.workspaceProvisionType ||
    args.environment.workspaceProvisionType === "unmanaged"
  ) {
    throw new ApiError(
      409,
      "invalid_request",
      "Environment cannot be reprovisioned automatically",
    );
  }

  const defaultSource = requireDefaultSource(deps, args.thread.projectId);
  if (defaultSource.hostId !== args.environment.hostId) {
    throw new ApiError(
      409,
      "invalid_request",
      "Managed workspaces must run on the default source host",
    );
  }

  const targetPath =
    args.environment.path ??
    buildManagedTargetPath(defaultSource.path, args.thread.projectId, args.thread.id);
  const branchName =
    args.environment.branchName ??
    buildManagedBranchNameFromSeed(
      args.thread.title ?? args.thread.titleFallback ?? args.thread.id,
      args.thread.id,
    );

  updateEnvironment(deps.db, deps.hub, args.environment.id, {
    status: "provisioning",
  });
  if (args.thread.status === "idle") {
    tryTransition(deps.db, deps.hub, args.thread.id, "provisioning");
  }
  appendProvisioningEvent(deps, {
    threadId: args.thread.id,
    environmentId: args.environment.id,
    status: "started",
    entries: [
      {
        type: "step",
        key: "environment",
        text: `environment: ${toProvisioningLabel(args.environment.workspaceProvisionType)}`,
        status: "completed",
      },
    ],
  });
  queueEnvironmentProvision(deps, {
    branchName,
    environmentId: args.environment.id,
    hostId: args.environment.hostId,
    projectId: args.thread.projectId,
    sourcePath: defaultSource.path,
    targetPath,
    workspaceProvisionType: args.environment.workspaceProvisionType,
  });
}
