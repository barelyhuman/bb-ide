import type { HostType } from "@bb/domain";

export type HostObservedChange =
  | {
      kind: "workspace-status-changed";
      environmentId: string;
    }
  | {
      kind: "thread-storage-changed";
      environmentId: string;
      threadId: string;
    };

export interface WorkspaceWatchError {
  kind: "workspace-watch-error";
  environmentId: string;
  rootPath: string;
  message: string;
}

export interface ThreadStorageWatchError {
  kind: "thread-storage-watch-error";
  rootPath: string;
  message: string;
  environmentId?: string;
  threadId?: string;
}

export type HostWatchError = WorkspaceWatchError | ThreadStorageWatchError;

export interface ThreadStorageWatchTarget {
  environmentId: string;
  threadId: string;
}

export interface WatchWorkspaceArgs {
  environmentId: string;
  workspacePath: string;
  onChange: (event: HostObservedChange) => void;
  onWatchError: (error: WorkspaceWatchError) => void;
}

export interface WatchThreadStorageRootArgs {
  threadStorageRootPath: string;
  resolveThreadTarget: (threadId: string) => ThreadStorageWatchTarget | null;
  onChange: (event: HostObservedChange) => void;
  onWatchError: (error: ThreadStorageWatchError) => void;
}

export interface HostWatcher {
  watchWorkspace(args: WatchWorkspaceArgs): () => void;
  watchThreadStorageRoot(args: WatchThreadStorageRootArgs): () => void;
}

export interface CreateHostWatcherArgs {
  hostType: HostType;
}
