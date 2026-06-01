import type {
  EnvironmentChangeKind,
  HostChangeKind,
  ProjectChangeKind,
  RealtimeEntity,
  SystemChangeKind,
  ThreadChangeKind,
} from "@bb/domain";

export const CACHE_OWNER_IDS = [
  "project",
  "thread-list",
  "thread-detail",
  "timeline",
  "composer",
  "thread-storage-app",
  "environment-workspace",
  "terminal",
  "host-system",
  "internal",
] as const;

export type CacheOwnerId = (typeof CACHE_OWNER_IDS)[number];

export type CacheOwnerRealtimeEvent =
  | {
      entity: Extract<RealtimeEntity, "thread">;
      kind: ThreadChangeKind;
    }
  | {
      entity: Extract<RealtimeEntity, "project">;
      kind: ProjectChangeKind;
    }
  | {
      entity: Extract<RealtimeEntity, "environment">;
      kind: EnvironmentChangeKind;
    }
  | {
      entity: Extract<RealtimeEntity, "host">;
      kind: HostChangeKind;
    }
  | {
      entity: Extract<RealtimeEntity, "system">;
      kind: SystemChangeKind;
    };

export interface CacheOwnerDescriptor {
  handledRealtimeEvents: readonly CacheOwnerRealtimeEvent[];
  id: CacheOwnerId;
  ownedQueryRoots: readonly string[];
}
