import { useMediaQuery } from "@/hooks/useMediaQuery";

export const POINTER_COARSE_QUERY = "(pointer: coarse)";

export function usePointerCoarse(): boolean {
  return useMediaQuery(POINTER_COARSE_QUERY);
}
