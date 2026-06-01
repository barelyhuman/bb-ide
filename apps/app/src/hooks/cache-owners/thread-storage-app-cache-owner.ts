import {
  THREAD_APPS_QUERY_KEY,
  THREAD_APP_MARKDOWN_PREVIEW_QUERY_KEY,
  THREAD_APP_QUERY_KEY,
  THREAD_STORAGE_FILES_QUERY_KEY,
  THREAD_STORAGE_FILE_PREVIEW_QUERY_KEY,
  THREAD_STORAGE_PATHS_QUERY_KEY,
} from "../queries/query-keys";
import type { CacheOwnerDescriptor } from "./cache-owner-types";

export const threadStorageAppCacheOwner = {
  id: "thread-storage-app",
  ownedQueryRoots: [
    THREAD_STORAGE_FILES_QUERY_KEY,
    THREAD_STORAGE_PATHS_QUERY_KEY,
    THREAD_STORAGE_FILE_PREVIEW_QUERY_KEY,
    THREAD_APPS_QUERY_KEY,
    THREAD_APP_QUERY_KEY,
    THREAD_APP_MARKDOWN_PREVIEW_QUERY_KEY,
  ],
  handledRealtimeEvents: [
    { entity: "environment", kind: "thread-storage-changed" },
    { entity: "thread", kind: "thread-deleted" },
  ],
} satisfies CacheOwnerDescriptor;
