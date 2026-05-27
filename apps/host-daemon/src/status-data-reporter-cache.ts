import type { JsonValue, StatusDataKey } from "@bb/domain";
import type { StatusDataDirectoryFingerprint } from "./command-handlers/status-data.js";

export interface CachedStatusDataValue {
  value: JsonValue;
  version: string;
}

export interface StatusDataCacheKeyArgs {
  key: StatusDataKey;
  threadId: string;
}

export interface CachedStatusDataKey {
  cacheKey: string;
  key: StatusDataKey;
}

export interface SetCachedStatusDataValueArgs
  extends StatusDataCacheKeyArgs,
    CachedStatusDataValue {}

export interface ThreadIdArgs {
  threadId: string;
}

export interface ReplaceTrackedThreadIdsArgs {
  threadIds: ReadonlySet<string>;
}

export interface SetThreadFingerprintArgs extends ThreadIdArgs {
  fingerprint: StatusDataDirectoryFingerprint | null;
}

export interface StatusDataPreviousMetadata {
  previousValue: JsonValue | null;
  previousValuePresent: boolean;
  previousVersion: string | null;
}

export function statusDataCacheKey(args: StatusDataCacheKeyArgs): string {
  return `${args.threadId}\0${args.key}`;
}

export function readPreviousValue(
  cached: CachedStatusDataValue | undefined,
): StatusDataPreviousMetadata {
  return {
    previousValue: cached?.value ?? null,
    previousValuePresent: cached !== undefined,
    previousVersion: cached?.version ?? null,
  };
}

export class StatusDataCache {
  private readonly values = new Map<string, CachedStatusDataValue>();
  private readonly fingerprintsByThreadId = new Map<
    string,
    StatusDataDirectoryFingerprint | null
  >();
  private readonly keysByThreadId = new Map<string, Set<StatusDataKey>>();
  // Threads remain tracked even when they have no STATUS-data keys yet.
  private readonly trackedThreadIds = new Set<string>();

  replaceTrackedThreadIds(args: ReplaceTrackedThreadIdsArgs): Set<string> {
    const previouslyTrackedThreadIds = new Set(this.trackedThreadIds);
    this.pruneUntrackedThreadState(args);
    this.trackedThreadIds.clear();
    for (const threadId of args.threadIds) {
      this.trackedThreadIds.add(threadId);
    }
    return previouslyTrackedThreadIds;
  }

  trackThread(args: ThreadIdArgs): void {
    this.trackedThreadIds.add(args.threadId);
  }

  isTracked(args: ThreadIdArgs): boolean {
    return this.trackedThreadIds.has(args.threadId);
  }

  getValue(args: StatusDataCacheKeyArgs): CachedStatusDataValue | undefined {
    return this.values.get(statusDataCacheKey(args));
  }

  setValue(args: SetCachedStatusDataValueArgs): void {
    this.values.set(statusDataCacheKey(args), {
      value: args.value,
      version: args.version,
    });
    let keys = this.keysByThreadId.get(args.threadId);
    if (!keys) {
      keys = new Set<StatusDataKey>();
      this.keysByThreadId.set(args.threadId, keys);
    }
    keys.add(args.key);
  }

  deleteValue(args: StatusDataCacheKeyArgs): void {
    this.values.delete(statusDataCacheKey(args));
    const keys = this.keysByThreadId.get(args.threadId);
    if (!keys) {
      return;
    }
    keys.delete(args.key);
    if (keys.size === 0) {
      this.keysByThreadId.delete(args.threadId);
    }
  }

  cachedKeysForThread(args: ThreadIdArgs): CachedStatusDataKey[] {
    return Array.from(this.keysByThreadId.get(args.threadId) ?? [])
      .sort()
      .map((key) => ({
        key,
        cacheKey: statusDataCacheKey({ key, threadId: args.threadId }),
      }));
  }

  hasFingerprint(args: ThreadIdArgs): boolean {
    return this.fingerprintsByThreadId.has(args.threadId);
  }

  getFingerprint(
    args: ThreadIdArgs,
  ): StatusDataDirectoryFingerprint | null | undefined {
    return this.fingerprintsByThreadId.get(args.threadId);
  }

  setFingerprint(args: SetThreadFingerprintArgs): void {
    this.fingerprintsByThreadId.set(args.threadId, args.fingerprint);
  }

  private pruneUntrackedThreadState(args: ReplaceTrackedThreadIdsArgs): void {
    for (const threadId of Array.from(this.trackedThreadIds)) {
      if (args.threadIds.has(threadId)) {
        continue;
      }
      for (const cached of this.cachedKeysForThread({ threadId })) {
        this.values.delete(cached.cacheKey);
      }
      this.fingerprintsByThreadId.delete(threadId);
      this.keysByThreadId.delete(threadId);
      this.trackedThreadIds.delete(threadId);
    }
  }
}
