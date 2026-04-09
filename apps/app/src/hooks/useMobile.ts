import { useMediaQuery } from "usehooks-ts";

export const MOBILE_QUERY = "(max-width: 767px)";

export function useIsMobile() {
  return useMediaQuery(MOBILE_QUERY);
}
