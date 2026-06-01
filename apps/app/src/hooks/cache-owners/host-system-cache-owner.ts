import {
  HOSTS_QUERY_KEY,
  HOST_QUERY_KEY,
  LOCAL_PATH_EXISTENCE_QUERY_KEY,
  LOCAL_PROVIDER_CLI_STATUS_QUERY_KEY,
  MANAGER_TEMPLATES_QUERY_KEY,
  SYSTEM_CONFIG_QUERY_KEY,
  SYSTEM_EXECUTION_OPTIONS_QUERY_KEY,
  SYSTEM_PROVIDERS_QUERY_KEY,
  SYSTEM_VERSION_QUERY_KEY,
} from "../queries/query-keys";
import type { CacheOwnerDescriptor } from "./cache-owner-types";

export const hostSystemCacheOwner = {
  id: "host-system",
  ownedQueryRoots: [
    HOSTS_QUERY_KEY,
    HOST_QUERY_KEY,
    SYSTEM_PROVIDERS_QUERY_KEY,
    SYSTEM_CONFIG_QUERY_KEY,
    SYSTEM_EXECUTION_OPTIONS_QUERY_KEY,
    SYSTEM_VERSION_QUERY_KEY,
    LOCAL_PROVIDER_CLI_STATUS_QUERY_KEY,
    MANAGER_TEMPLATES_QUERY_KEY,
    LOCAL_PATH_EXISTENCE_QUERY_KEY,
  ],
  handledRealtimeEvents: [
    { entity: "host", kind: "host-connected" },
    { entity: "host", kind: "host-disconnected" },
    { entity: "system", kind: "config-changed" },
  ],
  bootstrapPolicy:
    "Owns host/system query families and host data ingested from thread detail bootstrap.",
  deletionBehavior:
    "Refreshes dependent host/system projections when host availability changes.",
  reconnectBehavior:
    "Refreshes host availability, provider, execution-option, and path-existence projections after reconnect.",
} satisfies CacheOwnerDescriptor;
