import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import {
  workspaceOpenTargetIdSchema,
  type WorkspaceOpenTarget,
  type WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import { createLocalStorageEnumStorage } from "./browser-storage";

const WORKSPACE_OPEN_TARGET_STORAGE_KEY = "bb.workspaceOpenTarget";

export type StoredWorkspaceOpenTargetPreference = "" | WorkspaceOpenTargetId;

interface ResolvePreferredWorkspaceOpenTargetArgs {
  preferredTargetId: StoredWorkspaceOpenTargetPreference;
  targets: WorkspaceOpenTarget[];
}

function isStoredWorkspaceOpenTargetPreference(
  value: string,
): value is StoredWorkspaceOpenTargetPreference {
  return value === "" || workspaceOpenTargetIdSchema.safeParse(value).success;
}

const workspaceOpenTargetPreferenceStorage =
  createLocalStorageEnumStorage<StoredWorkspaceOpenTargetPreference>(
    isStoredWorkspaceOpenTargetPreference,
  );

const workspaceOpenTargetPreferenceAtom =
  atomWithStorage<StoredWorkspaceOpenTargetPreference>(
    WORKSPACE_OPEN_TARGET_STORAGE_KEY,
    "",
    workspaceOpenTargetPreferenceStorage,
    { getOnInit: true },
  );

export function resolvePreferredWorkspaceOpenTarget(
  args: ResolvePreferredWorkspaceOpenTargetArgs,
): WorkspaceOpenTarget | null {
  if (args.preferredTargetId !== "") {
    const preferredTarget = args.targets.find(
      (target) => target.id === args.preferredTargetId,
    );
    if (preferredTarget) {
      return preferredTarget;
    }
  }

  return args.targets[0] ?? null;
}

export function useWorkspaceOpenTargetPreference() {
  return useAtom(workspaceOpenTargetPreferenceAtom);
}

