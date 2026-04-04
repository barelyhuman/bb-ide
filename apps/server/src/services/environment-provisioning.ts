import { claimManagedEnvironmentReprovision } from "@bb/db";
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
  SETUP_SCRIPT_NAME,
  SETUP_TIMEOUT_MS,
  requireSourceForHost,
} from "./thread-create-helpers.js";
import { requireConnectedHostSession } from "./entity-lookup.js";
import { tryTransition } from "./thread-transitions.js";

function toProvisioningLabel(
  workspaceProvisionType: Environment["workspaceProvisionType"],
): string {
  switch (workspaceProvisionType) {
    case "unmanaged":
      return "Environment";
    case "managed-worktree":
      return "Worktree";
    case "managed-clone":
      return "Clone";
  }
}

export const MANAGED_REPROVISION_QUEUED = "queued" as const;
export const MANAGED_REPROVISION_IN_PROGRESS = "already-provisioning" as const;
export type ManagedReprovisionResult =
  | typeof MANAGED_REPROVISION_QUEUED
  | typeof MANAGED_REPROVISION_IN_PROGRESS;

export function queueManagedEnvironmentReprovision(
  deps: Pick<AppDeps, "db" | "hub">,
  args: {
    environment: Environment;
    thread: Thread;
  },
): ManagedReprovisionResult {
  const provisionType = args.environment.workspaceProvisionType;
  if (!args.environment.managed || provisionType === "unmanaged") {
    throw new ApiError(
      409,
      "invalid_request",
      "Environment cannot be reprovisioned automatically",
    );
  }

  const source = requireSourceForHost(
    deps,
    args.thread.projectId,
    args.environment.hostId,
  );
  requireConnectedHostSession(deps, args.environment.hostId);

  const targetPath =
    args.environment.path ??
    buildManagedTargetPath(source.path, args.thread.projectId, args.thread.id);
  const branchName =
    args.environment.branchName ??
    buildManagedBranchNameFromSeed(
      args.thread.title ?? args.thread.titleFallback ?? args.thread.id,
      args.thread.id,
    );

  const claimed = claimManagedEnvironmentReprovision(
    deps.db,
    deps.hub,
    { environmentId: args.environment.id },
  );
  if (!claimed) {
    return MANAGED_REPROVISION_IN_PROGRESS;
  }

  if (args.thread.status === "idle") {
    tryTransition(deps.db, deps.hub, args.thread.id, "provisioning");
  }
  const provisionEventSequence = appendProvisioningEvent(deps, {
    threadId: args.thread.id,
    environmentId: args.environment.id,
    status: "started",
    entries: [
      {
        type: "step",
        key: "provision",
        text: `Provisioning ${toProvisioningLabel(args.environment.workspaceProvisionType).toLowerCase()}`,
        status: "started",
      },
    ],
  });
  queueEnvironmentProvision(deps, {
    branchName,
    environmentId: args.environment.id,
    hostId: args.environment.hostId,
    initiator: { threadId: args.thread.id, eventSequence: provisionEventSequence },
    sourcePath: source.path,
    targetPath,
    workspaceProvisionType: provisionType,
    setupScript: SETUP_SCRIPT_NAME,
    setupTimeoutMs: SETUP_TIMEOUT_MS,
  });
  return MANAGED_REPROVISION_QUEUED;
}
