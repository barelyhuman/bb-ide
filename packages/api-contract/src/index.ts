import { hc } from "hono/client";
import type { ApiRoutesType } from "./schema.js";

export type { ApiRoutesType } from "./schema.js";

export function createApiClient(baseUrl: string) {
  const apiClient = hc<ApiRoutesType>(`${baseUrl}/api/v1`);
  return {
    api: {
      v1: apiClient,
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
