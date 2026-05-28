import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import {
  workspaceOpenTargetIdSchema,
  type WorkspaceOpenTarget,
  type WorkspaceOpenTargetCapabilities,
  type WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import { createNullableLocalStorageEnumStorage } from "./browser-storage";

export const WORKSPACE_OPEN_TARGET_STORAGE_KEY = "bb.workspaceOpenTarget";
export const FILE_OPEN_TARGET_STORAGE_KEY = "bb.fileOpenTarget";

export type StoredWorkspaceOpenTargetPreference = WorkspaceOpenTargetId | null;
export type WorkspaceOpenTargetCapability = keyof WorkspaceOpenTargetCapabilities;

interface ResolvePreferredWorkspaceOpenTargetArgs {
  capability: WorkspaceOpenTargetCapability;
  preferredTargetId: StoredWorkspaceOpenTargetPreference;
  targets: WorkspaceOpenTarget[];
}

interface SupportsWorkspaceOpenTargetCapabilityArgs {
  capability: WorkspaceOpenTargetCapability;
  target: WorkspaceOpenTarget;
}

export function supportsWorkspaceOpenTargetCapability(
  args: SupportsWorkspaceOpenTargetCapabilityArgs,
): boolean {
  return args.target.capabilities[args.capability];
}

export function isWorkspaceDirectoryOpenTarget(
  target: WorkspaceOpenTarget,
): boolean {
  return supportsWorkspaceOpenTargetCapability({
    capability: "openDirectory",
    target,
  });
}

export function isWorkspaceFileOpenTarget(target: WorkspaceOpenTarget): boolean {
  return supportsWorkspaceOpenTargetCapability({
    capability: "openFile",
    target,
  });
}

function resolveFallbackWorkspaceOpenTarget(
  capability: WorkspaceOpenTargetCapability,
  targets: WorkspaceOpenTarget[],
): WorkspaceOpenTarget | null {
  return (
    targets.find((target) =>
      supportsWorkspaceOpenTargetCapability({
        capability,
        target,
      }),
    ) ??
    null
  );
}

function isStoredWorkspaceOpenTargetPreference(
  value: string,
): value is WorkspaceOpenTargetId {
  return workspaceOpenTargetIdSchema.safeParse(value).success;
}

const workspaceOpenTargetPreferenceStorage =
  createNullableLocalStorageEnumStorage<WorkspaceOpenTargetId>(
    isStoredWorkspaceOpenTargetPreference,
  );

export const workspaceOpenTargetPreferenceAtom =
  atomWithStorage<StoredWorkspaceOpenTargetPreference>(
    WORKSPACE_OPEN_TARGET_STORAGE_KEY,
    null,
    workspaceOpenTargetPreferenceStorage,
    { getOnInit: true },
  );

export const fileOpenTargetPreferenceAtom =
  atomWithStorage<StoredWorkspaceOpenTargetPreference>(
    FILE_OPEN_TARGET_STORAGE_KEY,
    null,
    workspaceOpenTargetPreferenceStorage,
    { getOnInit: true },
  );

export function resolvePreferredWorkspaceOpenTarget(
  args: ResolvePreferredWorkspaceOpenTargetArgs,
): WorkspaceOpenTarget | null {
  if (args.preferredTargetId !== null) {
    const preferredTarget = args.targets.find(
      (target) =>
        target.id === args.preferredTargetId &&
        supportsWorkspaceOpenTargetCapability({
          capability: args.capability,
          target,
        }),
    );
    if (preferredTarget) {
      return preferredTarget;
    }
  }

  // Preserve stale preferences rather than clearing them. The app may be
  // temporarily unavailable and should become primary again after reinstall.
  return resolveFallbackWorkspaceOpenTarget(args.capability, args.targets);
}

export function useWorkspaceOpenTargetPreference() {
  return useAtom(workspaceOpenTargetPreferenceAtom);
}

export function useFileOpenTargetPreference() {
  return useAtom(fileOpenTargetPreferenceAtom);
}
