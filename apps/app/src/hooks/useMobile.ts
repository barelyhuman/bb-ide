import { useMediaQuery } from "@/hooks/useMediaQuery";

export const MOBILE_QUERY = "(max-width: 767px)";

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}
