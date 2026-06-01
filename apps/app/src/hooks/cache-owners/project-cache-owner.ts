import {
  PROJECT_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY,
  PROJECT_PATHS_QUERY_KEY,
  PROJECT_PROMPT_HISTORY_QUERY_KEY,
  PROJECT_SOURCE_BRANCHES_QUERY_KEY,
  PROJECTS_QUERY_KEY,
} from "../queries/query-keys";
import type { CacheOwnerDescriptor } from "./cache-owner-types";

export const projectCacheOwner = {
  id: "project",
  ownedQueryRoots: [
    PROJECTS_QUERY_KEY,
    PROJECT_PATHS_QUERY_KEY,
    PROJECT_SOURCE_BRANCHES_QUERY_KEY,
    PROJECT_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY,
    PROJECT_PROMPT_HISTORY_QUERY_KEY,
  ],
  handledRealtimeEvents: [
    { entity: "project", kind: "project-created" },
    { entity: "project", kind: "project-updated" },
    { entity: "project", kind: "project-deleted" },
    { entity: "project", kind: "project-sources-changed" },
    { entity: "project", kind: "threads-changed" },
    { entity: "project", kind: "project-order-changed" },
    { entity: "project", kind: "automations-changed" },
    { entity: "project", kind: "nudges-changed" },
  ],
  bootstrapPolicy:
    "Owns project records, source/path/default/prompt projections, and project-scoped bootstrap ingestion.",
  deletionBehavior:
    "Removes deleted project records and delegates sidebar route cleanup through cache events.",
  reconnectBehavior:
    "Refreshes project records, source/path suggestions, and project prompt projections after reconnect.",
} satisfies CacheOwnerDescriptor;
