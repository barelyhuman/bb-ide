import { useMediaQuery } from "@bb/ui-core";

export const POINTER_COARSE_QUERY = "(pointer: coarse)";

export function usePointerCoarse(): boolean {
  return useMediaQuery(POINTER_COARSE_QUERY);
}
