import {
  THREAD_TIMELINE_QUERY_KEY,
  THREAD_TIMELINE_TURN_SUMMARY_DETAILS_QUERY_KEY,
} from "../queries/query-keys";
import type { CacheOwnerDescriptor } from "./cache-owner-types";

export const timelineCacheOwner = {
  id: "timeline",
  ownedQueryRoots: [
    THREAD_TIMELINE_QUERY_KEY,
    THREAD_TIMELINE_TURN_SUMMARY_DETAILS_QUERY_KEY,
  ],
  handledRealtimeEvents: [
    { entity: "thread", kind: "thread-created" },
    { entity: "thread", kind: "thread-deleted" },
    { entity: "thread", kind: "events-appended" },
    { entity: "thread", kind: "interactions-changed" },
  ],
  bootstrapPolicy:
    "Owns timeline prefetch and turn-summary detail query families.",
  deletionBehavior:
    "Removes deleted thread timeline and turn-summary detail projections.",
  reconnectBehavior:
    "Refreshes timeline and turn-summary detail projections after reconnect.",
} satisfies CacheOwnerDescriptor;
