import { useEffect, useRef } from "react"

/**
 * Fires `callback` when `matches` transitions between true/false.
 * Skips the initial mount so it never fires during hydration or first render.
 * Accepts a pre-computed boolean (e.g. from useIsMobile) to avoid
 * duplicate useMediaQuery subscriptions.
 */
export function useBreakpointCross(
  matches: boolean,
  callback: () => void,
): void {
  const prevRef = useRef(matches)
  const mountedRef = useRef(false)

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      prevRef.current = matches
      return
    }

    if (matches !== prevRef.current) {
      prevRef.current = matches
      callback()
    }
  }, [matches, callback])
}
