import type { Environment } from "@bb/domain";

export interface EnvironmentDisplayInfo {
  /** Human-readable label: "Primary", "Worktree", "Local", etc. */
  label: string;
  /** The environment kind for programmatic use */
  kind: "primary" | "worktree" | "local" | "unknown";
  /** The environment ID (for use with --environment flag) */
  id: string;
  /** The filesystem path, if available */
  path?: string;
  /** Whether bb manages this environment's lifecycle */
  managed: boolean;
}

/**
 * Produce a structured display object for an environment.
 */
export function formatEnvironmentDisplay(
  environment: Environment,
  projectRootPath?: string,
): EnvironmentDisplayInfo {
  const envPath = environment.path;

  // Determine kind + label
  const isPrimary =
    projectRootPath !== undefined &&
    envPath !== undefined &&
    normalizePath(envPath) === normalizePath(projectRootPath);

  if (isPrimary) {
    return {
      label: "Direct",
      kind: "primary",
      id: environment.id,
      path: envPath,
      managed: environment.managed,
    };
  }

  if (environment.managed && environment.provisionerId === "worktree") {
    const suffix = formatRelativePath(envPath, projectRootPath);
    const label = suffix ? `Worktree (${suffix})` : "Worktree";
    return {
      label,
      kind: "worktree",
      id: environment.id,
      path: envPath,
      managed: environment.managed,
    };
  }

  if (envPath) {
    return {
      label: "Local",
      kind: "local",
      id: environment.id,
      path: envPath,
      managed: environment.managed,
    };
  }

  return {
    label: "Unknown",
    kind: "unknown",
    id: environment.id,
    path: envPath,
    managed: environment.managed,
  };
}

function normalizePath(p: string): string {
  return p.replace(/\/+$/, "");
}

function formatRelativePath(
  path?: string,
  projectRootPath?: string,
): string | undefined {
  if (!path || !projectRootPath) {
    return path ? lastSegment(path) : undefined;
  }
  const normalizedRoot = normalizePath(projectRootPath);
  const normalizedPath = normalizePath(path);
  if (normalizedPath === normalizedRoot) {
    return undefined;
  }
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }
  return lastSegment(path);
}

function lastSegment(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}
