import {
  getProjectSourceByHost,
  listProjectSources,
} from "@bb/db";
import {
  isGitHubRepoProjectSource,
  type Environment,
  type GitHubRepoProjectSource,
  type LocalPathProjectSource,
} from "@bb/domain";
import type { CreateThreadRequest } from "@bb/server-contract";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";
import {
  requireEnvironment,
  requireHostWithStatus,
} from "./entity-lookup.js";

type ThreadRequestEnvironment = CreateThreadRequest["environment"];
type HostThreadRequestEnvironment = Extract<
  ThreadRequestEnvironment,
  { type: "host" }
>;
type ReuseThreadRequestEnvironment = Extract<
  ThreadRequestEnvironment,
  { type: "reuse" }
>;
type SandboxHostThreadRequestEnvironment = Extract<
  ThreadRequestEnvironment,
  { type: "sandbox-host" }
>;

export interface ResolveStableThreadRequestEnvironmentArgs {
  environment: ThreadRequestEnvironment;
  projectId: string;
}

export interface ResolvedHostThreadRequestEnvironment {
  hostId: string;
  localSource: LocalPathProjectSource | null;
  type: "host";
  unmanagedPath: string | null;
  workspace: HostThreadRequestEnvironment["workspace"];
}

export interface ResolvedReuseThreadRequestEnvironment {
  environment: Environment;
  type: "reuse";
}

export interface ResolvedSandboxHostThreadRequestEnvironment {
  cloneSource: GitHubRepoProjectSource;
  sandboxType: SandboxHostThreadRequestEnvironment["sandboxType"];
  type: "sandbox-host";
}

export type ResolvedStableThreadRequestEnvironment =
  | ResolvedHostThreadRequestEnvironment
  | ResolvedReuseThreadRequestEnvironment
  | ResolvedSandboxHostThreadRequestEnvironment;

function compareSandboxCloneSourcePreference(
  left: GitHubRepoProjectSource,
  right: GitHubRepoProjectSource,
): number {
  if (left.isDefault !== right.isDefault) {
    return left.isDefault ? -1 : 1;
  }
  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt;
  }
  return left.id.localeCompare(right.id);
}

export function resolveSandboxCloneSourceForProject(
  deps: Pick<AppDeps, "db">,
  args: { projectId: string },
): GitHubRepoProjectSource {
  const cloneSources = listProjectSources(deps.db, args.projectId)
    .filter(isGitHubRepoProjectSource)
    .sort(compareSandboxCloneSourcePreference);

  const cloneSource = cloneSources[0];
  if (!cloneSource) {
    throw new ApiError(
      409,
      "unsupported_operation",
      "Sandbox threads require a cloneable project source; local path sources are not supported yet",
    );
  }

  return cloneSource;
}

function resolveHostThreadRequestEnvironment(
  deps: Pick<AppDeps, "db">,
  environment: HostThreadRequestEnvironment,
  projectId: string,
): ResolvedHostThreadRequestEnvironment {
  requireHostWithStatus(deps.db, environment.hostId);

  if (
    environment.workspace.type === "unmanaged" &&
    environment.workspace.path !== null
  ) {
    return {
      hostId: environment.hostId,
      localSource: null,
      type: "host",
      unmanagedPath: environment.workspace.path,
      workspace: environment.workspace,
    };
  }

  const localSource = getProjectSourceByHost(
    deps.db,
    projectId,
    environment.hostId,
  );
  if (!localSource || localSource.type !== "local_path") {
    throw new ApiError(
      409,
      "invalid_request",
      "No project source configured for this host",
    );
  }

  return {
    hostId: environment.hostId,
    localSource,
    type: "host",
    unmanagedPath:
      environment.workspace.type === "unmanaged" ? localSource.path : null,
    workspace: environment.workspace,
  };
}

function resolveReuseThreadRequestEnvironment(
  deps: Pick<AppDeps, "db">,
  environment: ReuseThreadRequestEnvironment,
  projectId: string,
): ResolvedReuseThreadRequestEnvironment {
  const reusedEnvironment = requireEnvironment(deps.db, environment.environmentId);
  if (reusedEnvironment.projectId !== projectId) {
    throw new ApiError(
      409,
      "invalid_request",
      "Environment belongs to a different project",
    );
  }
  return {
    environment: reusedEnvironment,
    type: "reuse",
  };
}

export function resolveStableThreadRequestEnvironment(
  deps: Pick<AppDeps, "db">,
  args: ResolveStableThreadRequestEnvironmentArgs,
): ResolvedStableThreadRequestEnvironment {
  switch (args.environment.type) {
    case "host":
      return resolveHostThreadRequestEnvironment(
        deps,
        args.environment,
        args.projectId,
      );
    case "reuse":
      return resolveReuseThreadRequestEnvironment(
        deps,
        args.environment,
        args.projectId,
      );
    case "sandbox-host":
      return {
        cloneSource: resolveSandboxCloneSourceForProject(deps, {
          projectId: args.projectId,
        }),
        sandboxType: args.environment.sandboxType,
        type: "sandbox-host",
      };
    default: {
      const exhaustiveCheck: never = args.environment;
      throw new Error(`Unsupported thread request environment: ${exhaustiveCheck}`);
    }
  }
}
