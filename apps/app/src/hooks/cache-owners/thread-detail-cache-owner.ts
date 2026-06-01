import {
  THREAD_DETAIL_BOOTSTRAP_QUERY_KEY,
  THREAD_QUERY_KEY,
} from "../queries/query-keys";
import type { CacheOwnerDescriptor } from "./cache-owner-types";

export const threadDetailCacheOwner = {
  id: "thread-detail",
  ownedQueryRoots: [THREAD_QUERY_KEY, THREAD_DETAIL_BOOTSTRAP_QUERY_KEY],
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
  ],
  bootstrapPolicy:
    "Owns thread detail bootstrap ingestion and placeholder-to-detail reconciliation.",
  deletionBehavior:
    "Removes deleted thread detail/bootstrap projections and exposes tombstone state to route reconciliation.",
  reconnectBehavior:
    "Refreshes mounted thread detail and bootstrap projections after reconnect.",
} satisfies CacheOwnerDescriptor;
