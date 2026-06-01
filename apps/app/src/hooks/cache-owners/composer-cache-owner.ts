import {
  THREAD_COMPOSER_BOOTSTRAP_QUERY_KEY,
  THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY,
  THREAD_PENDING_INTERACTIONS_QUERY_KEY,
  THREAD_PROMPT_HISTORY_QUERY_KEY,
  THREAD_QUEUED_MESSAGES_QUERY_KEY,
} from "../queries/query-keys";
import type { CacheOwnerDescriptor } from "./cache-owner-types";

export const composerCacheOwner = {
  id: "composer",
  ownedQueryRoots: [
    THREAD_COMPOSER_BOOTSTRAP_QUERY_KEY,
    THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY,
    THREAD_QUEUED_MESSAGES_QUERY_KEY,
    THREAD_PROMPT_HISTORY_QUERY_KEY,
    THREAD_PENDING_INTERACTIONS_QUERY_KEY,
  ],
  handledRealtimeEvents: [
    { entity: "thread", kind: "events-appended" },
    { entity: "thread", kind: "interactions-changed" },
    { entity: "thread", kind: "queue-changed" },
    { entity: "host", kind: "host-connected" },
    { entity: "host", kind: "host-disconnected" },
    { entity: "system", kind: "config-changed" },
  ],
} satisfies CacheOwnerDescriptor;
