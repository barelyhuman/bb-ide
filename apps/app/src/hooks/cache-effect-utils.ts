import type { QueryKeysArg } from "./cache-effect-types";

export function invalidateQueryKeys({
  queryClient,
  queryKeys,
}: QueryKeysArg): void {
  for (const queryKey of queryKeys) {
    queryClient.invalidateQueries({ queryKey });
  }
}
