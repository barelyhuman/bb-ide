import {
  SIDEBAR_BOOTSTRAP_QUERY_KEY,
  THREADS_DISABLED_QUERY_KEY,
  THREADS_QUERY_KEY,
} from "../queries/query-keys";
import type { CacheOwnerDescriptor } from "./cache-owner-types";

export const threadListCacheOwner = {
  id: "thread-list",
  ownedQueryRoots: [
    THREADS_QUERY_KEY,
    THREADS_DISABLED_QUERY_KEY,
    SIDEBAR_BOOTSTRAP_QUERY_KEY,
  ],
  handledRealtimeEvents: [
    { entity: "thread", kind: "thread-created" },
    { entity: "thread", kind: "thread-deleted" },
    { entity: "thread", kind: "status-changed" },
    { entity: "thread", kind: "title-changed" },
    { entity: "thread", kind: "archived-changed" },
    { entity: "thread", kind: "pin-state-changed" },
    { entity: "thread", kind: "parent-changed" },
    { entity: "thread", kind: "read-state-changed" },
    { entity: "thread", kind: "manager-assignment-changed" },
    { entity: "thread", kind: "order-changed" },
    { entity: "project", kind: "project-created" },
    { entity: "project", kind: "project-updated" },
    { entity: "project", kind: "project-deleted" },
    { entity: "project", kind: "threads-changed" },
    { entity: "project", kind: "project-order-changed" },
  ],
  bootstrapPolicy:
    "Owns sidebar bootstrap and thread-list ingestion, including project thread membership projections.",
  deletionBehavior:
    "Removes deleted threads from list/sidebar projections and marks remote deletes for route reconciliation.",
  reconnectBehavior:
    "Refreshes list and sidebar projections after reconnect.",
} satisfies CacheOwnerDescriptor;
