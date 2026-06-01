import { THREAD_TERMINALS_QUERY_KEY } from "../queries/query-keys";
import type { CacheOwnerDescriptor } from "./cache-owner-types";

export const terminalCacheOwner = {
  id: "terminal",
  ownedQueryRoots: [THREAD_TERMINALS_QUERY_KEY],
  handledRealtimeEvents: [{ entity: "thread", kind: "terminals-changed" }],
  bootstrapPolicy:
    "Owns terminal list query data and terminal mutation cache updates.",
  deletionBehavior: "Removes terminal projections when a thread is deleted.",
  reconnectBehavior: "Refreshes terminal projections after reconnect.",
} satisfies CacheOwnerDescriptor;
