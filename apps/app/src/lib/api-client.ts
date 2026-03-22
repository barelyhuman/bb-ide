import { createApiClient } from "@bb/server-contract";

const BASE_URL = typeof window === "undefined"
  ? "http://localhost"
  : window.location.origin;

const client = createApiClient(BASE_URL);

export const apiClient = client.api.v1;

export function toRelativeUrl(url: URL): string {
  return `${url.pathname}${url.search}`;
}
