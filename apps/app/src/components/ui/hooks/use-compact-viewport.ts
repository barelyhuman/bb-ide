import { useMediaQuery } from "./use-media-query.js";

export const COMPACT_VIEWPORT_QUERY = "(max-width: 767px)";

export function useIsCompactViewport(): boolean {
  return useMediaQuery(COMPACT_VIEWPORT_QUERY);
}
