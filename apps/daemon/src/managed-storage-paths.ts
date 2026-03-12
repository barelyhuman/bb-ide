import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { expandHomeDirectory, resolveBeanbagPath } from "@beanbag/agent-core/storage-paths";
import {
  type Project,
  type Thread,
} from "@beanbag/agent-core";

function sanitizeSegment(value: string | undefined): string {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "environment";
}

export function resolveDefaultManagedWorktreeRoot(
  runtimeEnv: NodeJS.ProcessEnv,
): string {
  return resolveBeanbagPath(runtimeEnv, "worktrees");
}

export function resolveConfiguredWorktreeRoot(
  projectRoot: string,
  configuredRoot: string,
  runtimeEnv: NodeJS.ProcessEnv = process.env,
): { root: string; isGlobalRoot: boolean } {
  const normalizedRoot = expandHomeDirectory(configuredRoot.trim());
  if (normalizedRoot.length === 0) {
    return { root: resolveDefaultManagedWorktreeRoot(runtimeEnv), isGlobalRoot: true };
  }
  if (isAbsolute(normalizedRoot)) {
    return { root: normalizedRoot, isGlobalRoot: true };
  }
  return {
    root: resolve(projectRoot, normalizedRoot),
    isGlobalRoot: false,
  };
}

export function resolveManagedWorktreeRootForProject(
  project: Pick<Project, "id" | "rootPath">,
  runtimeEnv: NodeJS.ProcessEnv,
): { worktreeRoot: string; globalRoot?: string } {
  const configuredRoot = runtimeEnv.BEANBAG_WORKTREE_ROOT?.trim() ?? "";
  const { root, isGlobalRoot } = resolveConfiguredWorktreeRoot(
    project.rootPath,
    configuredRoot,
    runtimeEnv,
  );
  if (isGlobalRoot) {
    return {
      worktreeRoot: resolve(root, project.id),
      globalRoot: root,
    };
  }
  return {
    worktreeRoot: root,
  };
}

export function resolveManagedEnvironmentAgentStateFilePath(
  identity: Pick<Thread, "id" | "projectId" | "environmentId">,
  runtimeEnv: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const environmentId = identity.environmentId?.trim();
  if (!environmentId) {
    return undefined;
  }

  return join(
    resolveBeanbagPath(runtimeEnv, "environment-agents"),
    sanitizeSegment(identity.projectId),
    `${sanitizeSegment(environmentId)}-${sanitizeSegment(identity.id)}.json`,
  );
}

function hashWorkspaceRoot(workspaceRootPath: string): string {
  return createHash("sha1")
    .update(workspaceRootPath)
    .digest("hex")
    .slice(0, 12);
}

function resolveManagedEnvironmentAgentHashedStateFilePath(args: {
  projectId: string;
  threadId: string;
  environmentId: string;
  workspaceRootPath: string;
  runtimeEnv?: NodeJS.ProcessEnv;
}): string {
  return join(
    resolveBeanbagPath(args.runtimeEnv ?? process.env, "environment-agents"),
    sanitizeSegment(args.projectId),
    `${sanitizeSegment(args.environmentId)}-${sanitizeSegment(args.threadId)}-${hashWorkspaceRoot(args.workspaceRootPath)}.json`,
  );
}

export function resolveManagedEnvironmentAgentStateFilePaths(args: {
  thread: Pick<Thread, "id" | "projectId" | "environmentId">;
  project?: Pick<Project, "id" | "rootPath">;
  runtimeEnv: NodeJS.ProcessEnv;
}): string[] {
  const legacyPath = resolveManagedEnvironmentAgentStateFilePath(args.thread, args.runtimeEnv);
  if (!legacyPath) {
    return [];
  }

  const environmentId = args.thread.environmentId?.trim();
  if (!environmentId || !args.project) {
    return [legacyPath];
  }

  let workspaceRootPath: string | undefined;
  switch (environmentId) {
    case "local":
      workspaceRootPath = args.project.rootPath;
      break;
    case "worktree":
    case "docker":
      workspaceRootPath = resolve(
        resolveManagedWorktreeRootForProject(args.project, args.runtimeEnv).worktreeRoot,
        args.thread.id,
      );
      break;
    default:
      // Unknown environment ids may manage their own state layout. Keep the legacy path only.
      break;
  }

  if (!workspaceRootPath) {
    return [legacyPath];
  }

  return [
    resolveManagedEnvironmentAgentHashedStateFilePath({
      projectId: args.thread.projectId,
      threadId: args.thread.id,
      environmentId,
      workspaceRootPath,
      runtimeEnv: args.runtimeEnv,
    }),
    legacyPath,
  ];
}
