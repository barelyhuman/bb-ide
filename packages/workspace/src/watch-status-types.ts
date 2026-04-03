export type WorkspaceStatusChangeCallback = () => void;

export interface WorkspaceStatusWatchError {
  message: string;
  rootPath: string;
}

export type WorkspaceStatusWatchErrorCallback = (
  error: WorkspaceStatusWatchError,
) => void;

export interface WorkspaceStatusWatchArgs {
  onChange: WorkspaceStatusChangeCallback;
  onWatchError: WorkspaceStatusWatchErrorCallback;
}
