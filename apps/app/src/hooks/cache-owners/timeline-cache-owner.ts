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
} satisfies CacheOwnerDescriptor;
