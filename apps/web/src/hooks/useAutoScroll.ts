import { useRef, useCallback, useEffect } from "react"

const SCROLL_THRESHOLD = 40

export function useAutoScroll(dep: unknown) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickRef.current = distanceFromBottom < SCROLL_THRESHOLD
  }, [])

  useEffect(() => {
    if (stickRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [dep])

  return { containerRef, handleScroll }
}
