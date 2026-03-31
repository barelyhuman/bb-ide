import { useQueryClient, type QueryClient } from "@tanstack/react-query";

export function useApiClient(): QueryClient {
  return useQueryClient();
}
