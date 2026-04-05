import type { HostType } from "@bb/domain";
import type { WorkspaceStatusWatchArgs } from "@bb/workspace/watch-status";

export type WatchWorkspaceStatus = (
  cwd: string,
  args: WorkspaceStatusWatchArgs,
) => () => void;

export interface ResolveDefaultWatchWorkspaceStatusArgs {
  hostType: HostType;
}

/**
 * Ephemeral hosts intentionally skip workspace status watching.
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
