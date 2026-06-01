import { REPLAY_CAPTURES_QUERY_KEY } from "../queries/query-keys";
import type { CacheOwnerDescriptor } from "./cache-owner-types";

export const internalCacheOwner = {
  id: "internal",
  ownedQueryRoots: [REPLAY_CAPTURES_QUERY_KEY],
  handledRealtimeEvents: [],
  bootstrapPolicy: "Owns internal/replay tooling cache surfaces.",
  deletionBehavior: "Internal cache surfaces are not resource tombstones.",
  reconnectBehavior: "Internal cache surfaces refresh only through explicit tooling actions.",
} satisfies CacheOwnerDescriptor;
