import type { HostType } from "@bb/domain";
import type { PathChangeWatchArgs } from "@bb/workspace/watch-path";
import type { WorkspaceStatusWatchArgs } from "@bb/workspace/watch-status";

export type WatchWorkspaceStatus = (
  cwd: string,
  args: WorkspaceStatusWatchArgs,
) => () => void;

export type WatchPathChanges = (
  watchedPath: string,
  args: PathChangeWatchArgs,
) => () => void;

export interface ResolveDefaultWatchWorkspaceStatusArgs {
  hostType: HostType;
}

/**
 * Ephemeral hosts intentionally skip native file-system watching.
 *
 * The watcher depends on @parcel/watcher, a native addon we do not package
 * into the sandbox runtime. Persistent hosts still resolve the real watcher.
 */
export async function resolveDefaultWatchWorkspaceStatus(
  args: ResolveDefaultWatchWorkspaceStatusArgs,
): Promise<WatchWorkspaceStatus | undefined> {
  if (args.hostType === "ephemeral") {
    return undefined;
  }

  const { watchWorkspaceStatus } = await import("@bb/workspace/watch-status");
  return watchWorkspaceStatus;
}

export async function resolveDefaultWatchPathChanges(
  args: ResolveDefaultWatchWorkspaceStatusArgs,
): Promise<WatchPathChanges | undefined> {
  if (args.hostType === "ephemeral") {
    return undefined;
  }

  const { watchPathChanges } = await import("@bb/workspace/watch-path");
  return watchPathChanges;
}
