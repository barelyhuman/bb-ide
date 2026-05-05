import { useCallback, useMemo } from "react";
import type {
  WorkspaceOpenTarget,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import { toast } from "sonner";
import {
  resolvePreferredWorkspaceOpenTarget,
  useWorkspaceOpenTargetPreference,
} from "@/lib/workspace-open-target-preference";
import { useHostDaemon } from "./useHostDaemon";
import { useWorkspaceOpenTargets } from "./useWorkspaceOpenTargets";

const LOCAL_OPEN_FAILURE_TITLE = "Failed to open file locally";
const LOCALHOST_DISCONNECTED_OPEN_DESCRIPTION = "Localhost is disconnected.";
const LOCALHOST_NO_OPEN_TARGETS_DESCRIPTION = "No local editor is available.";

export interface UseLocalOpenTargetsArgs {
  enabled: boolean;
}

export interface OpenLocalPathRequest {
  lineNumber: number | null;
  path: string;
  workspaceRootPath: string;
}

export interface OpenPathInTargetArgs extends OpenLocalPathRequest {
  rememberTarget: boolean;
  targetId: WorkspaceOpenTargetId;
}

export interface OpenPathInPreferredTargetArgs extends OpenLocalPathRequest {}

export interface UseLocalOpenTargetsResult {
  canOpenPreferredTarget: boolean;
  openPathInPreferredTarget: (
    args: OpenPathInPreferredTargetArgs,
  ) => Promise<boolean>;
  openPathInTarget: (args: OpenPathInTargetArgs) => Promise<boolean>;
  preferredTarget: WorkspaceOpenTarget | null;
  workspaceOpenTargets: WorkspaceOpenTarget[];
}

interface OpenUnavailableDescriptionArgs {
  hasDaemon: boolean;
}

function getOpenUnavailableDescription(
  args: OpenUnavailableDescriptionArgs,
): string {
  if (!args.hasDaemon) {
    return LOCALHOST_DISCONNECTED_OPEN_DESCRIPTION;
  }

  return LOCALHOST_NO_OPEN_TARGETS_DESCRIPTION;
}

export function useLocalOpenTargets(
  args: UseLocalOpenTargetsArgs,
): UseLocalOpenTargetsResult {
  const { hasDaemon } = useHostDaemon();
  const { openWorkspace, workspaceOpenTargets } = useWorkspaceOpenTargets(args);
  const [preferredTargetId, setPreferredTargetId] =
    useWorkspaceOpenTargetPreference();
  const preferredTarget = useMemo(
    () =>
      resolvePreferredWorkspaceOpenTarget({
        preferredTargetId,
        targets: workspaceOpenTargets,
      }),
    [preferredTargetId, workspaceOpenTargets],
  );

  const openPathInTarget = useCallback(
    async (request: OpenPathInTargetArgs) => {
      const target = workspaceOpenTargets.find(
        (candidate) => candidate.id === request.targetId,
      );
      if (!target || !openWorkspace) {
        toast.error(LOCAL_OPEN_FAILURE_TITLE, {
          description: getOpenUnavailableDescription({
            hasDaemon,
          }),
        });
        return false;
      }

      if (request.rememberTarget) {
        setPreferredTargetId(request.targetId);
      }

      try {
        await openWorkspace({
          lineNumber: request.lineNumber,
          path: request.path,
          targetId: request.targetId,
          workspaceRootPath: request.workspaceRootPath,
        });
        return true;
      } catch (error) {
        toast.error(LOCAL_OPEN_FAILURE_TITLE, {
          description: error instanceof Error ? error.message : undefined,
        });
        return false;
      }
    },
    [
      hasDaemon,
      openWorkspace,
      setPreferredTargetId,
      workspaceOpenTargets,
    ],
  );

  const openPathInPreferredTarget = useCallback(
    async (request: OpenPathInPreferredTargetArgs) => {
      if (!preferredTarget) {
        toast.error(LOCAL_OPEN_FAILURE_TITLE, {
          description: getOpenUnavailableDescription({
            hasDaemon,
          }),
        });
        return false;
      }

      return openPathInTarget({
        lineNumber: request.lineNumber,
        path: request.path,
        rememberTarget: false,
        targetId: preferredTarget.id,
        workspaceRootPath: request.workspaceRootPath,
      });
    },
    [
      hasDaemon,
      openPathInTarget,
      preferredTarget,
    ],
  );

  return {
    canOpenPreferredTarget: preferredTarget !== null,
    openPathInPreferredTarget,
    openPathInTarget,
    preferredTarget,
    workspaceOpenTargets,
  };
}
