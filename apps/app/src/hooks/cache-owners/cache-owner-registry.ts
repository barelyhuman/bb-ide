import { composerCacheOwner } from "./composer-cache-owner";
import { environmentWorkspaceCacheOwner } from "./environment-workspace-cache-owner";
import { hostSystemCacheOwner } from "./host-system-cache-owner";
import { internalCacheOwner } from "./internal-cache-owner";
import { projectCacheOwner } from "./project-cache-owner";
import { terminalCacheOwner } from "./terminal-cache-owner";
import { threadDetailCacheOwner } from "./thread-detail-cache-owner";
import { threadListCacheOwner } from "./thread-list-cache-owner";
import { threadStorageAppCacheOwner } from "./thread-storage-app-cache-owner";
import { timelineCacheOwner } from "./timeline-cache-owner";

export const cacheOwnerRegistry = [
  projectCacheOwner,
  threadListCacheOwner,
  threadDetailCacheOwner,
  timelineCacheOwner,
  composerCacheOwner,
  threadStorageAppCacheOwner,
  environmentWorkspaceCacheOwner,
  terminalCacheOwner,
  hostSystemCacheOwner,
  internalCacheOwner,
] as const;

export type CacheOwnerRegistry = typeof cacheOwnerRegistry;
