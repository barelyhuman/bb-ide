import { REPLAY_CAPTURES_QUERY_KEY } from "../queries/query-keys";
import type { CacheOwnerDescriptor } from "./cache-owner-types";

export const internalCacheOwner = {
  id: "internal",
  ownedQueryRoots: [REPLAY_CAPTURES_QUERY_KEY],
  handledRealtimeEvents: [],
} satisfies CacheOwnerDescriptor;
