import type { HostDaemonStatusDataChangePayload } from "@bb/host-daemon-contract";
import { statusDataKeySchema, type StatusDataKey } from "@bb/domain";
import {
  listHostStatusDataFromRoot,
  readStatusDataDirectoryFingerprintFromRoot,
} from "./command-handlers/status-data.js";
import {
  readPreviousValue,
  type StatusDataCache,
} from "./status-data-reporter-cache.js";

export interface StatusDataSnapshotGenerationArgs {
  generation: number;
}

export type StatusDataSnapshotGenerationGuard = (
  args: StatusDataSnapshotGenerationArgs,
) => boolean;

export type PostStatusDataChange = (
  payload: HostDaemonStatusDataChangePayload,
) => Promise<void>;

export interface ShouldSkipUnchangedStatusDataSnapshotArgs {
  cache: StatusDataCache;
  generation: number;
  isCurrentGeneration: StatusDataSnapshotGenerationGuard;
  threadId: string;
  threadStoragePath: string;
}

export interface ApplyStatusDataSnapshotDiffArgs {
  cache: StatusDataCache;
  generation: number;
  isCurrentGeneration: StatusDataSnapshotGenerationGuard;
  postChanges: boolean;
  postStatusDataChange: PostStatusDataChange;
  threadId: string;
  threadStoragePath: string;
}

export async function shouldSkipUnchangedStatusDataSnapshot(
  args: ShouldSkipUnchangedStatusDataSnapshotArgs,
): Promise<boolean> {
  const currentFingerprint = await readStatusDataDirectoryFingerprintFromRoot({
    rootPath: args.threadStoragePath,
  });
  if (!args.isCurrentGeneration({ generation: args.generation })) {
    return true;
  }
  return (
    args.cache.hasFingerprint({ threadId: args.threadId }) &&
    args.cache.getFingerprint({ threadId: args.threadId }) ===
      currentFingerprint
  );
}

export async function applyStatusDataSnapshotDiff(
  args: ApplyStatusDataSnapshotDiffArgs,
): Promise<void> {
  const result = await listHostStatusDataFromRoot({
    rootPath: args.threadStoragePath,
  });
  if (!args.isCurrentGeneration({ generation: args.generation })) {
    return;
  }
  const seenKeys = new Set<StatusDataKey>();

  for (const rawKey of Object.keys(result.versions).sort()) {
    if (!args.isCurrentGeneration({ generation: args.generation })) {
      return;
    }
    const key = statusDataKeySchema.parse(rawKey);
    const value = result.values[key];
    const version = result.versions[key];
    if (value === undefined || version === undefined) {
      continue;
    }
    seenKeys.add(key);
    const previous = args.cache.getValue({ key, threadId: args.threadId });
    if (previous?.version === version) {
      continue;
    }
    if (args.postChanges) {
      await args.postStatusDataChange({
        threadId: args.threadId,
        key,
        deleted: false,
        value,
        version,
        ...readPreviousValue(previous),
      });
      if (!args.isCurrentGeneration({ generation: args.generation })) {
        return;
      }
    }
    args.cache.setValue({
      key,
      threadId: args.threadId,
      value,
      version,
    });
  }

  for (const cached of args.cache.cachedKeysForThread({
    threadId: args.threadId,
  })) {
    if (!args.isCurrentGeneration({ generation: args.generation })) {
      return;
    }
    if (seenKeys.has(cached.key)) {
      continue;
    }
    const previous = args.cache.getValue({
      key: cached.key,
      threadId: args.threadId,
    });
    if (previous === undefined) {
      continue;
    }
    if (args.postChanges) {
      await args.postStatusDataChange({
        threadId: args.threadId,
        key: cached.key,
        deleted: true,
        value: null,
        version: null,
        ...readPreviousValue(previous),
      });
      if (!args.isCurrentGeneration({ generation: args.generation })) {
        return;
      }
    }
    args.cache.deleteValue({ key: cached.key, threadId: args.threadId });
  }
}
